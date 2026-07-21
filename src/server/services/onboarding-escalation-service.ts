import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import type { EmailService } from './email.js';
import { query, queryOne, execute } from './database.js';
import { PortalDashboardService } from './portal-dashboards.js';
import {
  OnboardingEscalationPolicySchema,
  type OnboardingEscalationPolicy,
  type EscalationLevel,
  type EscalationRecipient,
} from '../../shared/portal-types.js';
import type { OnboardingDashboardRow } from '../../shared/portal-types.js';

const JIRA_BROWSE_BASE = 'https://nurturtech.atlassian.net/browse/';

/** Whole working days (Mon–Fri) between an ISO date and now. */
function workingDaysSince(iso: string): number {
  const start = new Date(iso);
  if (isNaN(start.getTime())) return 0;
  const cur = new Date(start); cur.setHours(0, 0, 0, 0);
  const last = new Date(); last.setHours(0, 0, 0, 0);
  let days = 0;
  while (cur < last) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Drives scheduled onboarding progress updates + escalations from each org's
// configured policy. Fires each level once per onboarding (deduped in
// onboarding_escalation_log). Nothing is sent unless the org's policy is enabled.
export class OnboardingEscalationService {
  private dashboards: PortalDashboardService;

  constructor(
    private settings: FileSettingsQueries,
    jiraClient: JiraRestClient | null,
    private email: EmailService,
  ) {
    this.dashboards = new PortalDashboardService(settings, jiraClient);
  }

  /** Don't email outside UK working hours — a threshold crossed overnight is
   *  picked up on the next in-hours scan (dedup makes that safe). */
  private withinSendingWindow(): boolean {
    const now = new Date();
    const dow = now.getDay();
    if (dow === 0 || dow === 6) return false;
    const hour = now.getHours();
    return hour >= 8 && hour < 18;
  }

  async runScan(): Promise<void> {
    if (this.settings.get('onboarding_escalations_master_enabled') === 'false') return;
    if (!this.withinSendingWindow()) return;
    if (!this.email.isConfigured()) {
      console.warn('[escalation] Email not configured — skipping scan');
      return;
    }

    const orgs = await query<{ id: number; name: string; escalation_policy: string | null }>(
      `SELECT id, name, escalation_policy FROM portal_organisations WHERE escalation_policy IS NOT NULL`,
    );

    for (const org of orgs) {
      let policy: OnboardingEscalationPolicy;
      try {
        const parsed = OnboardingEscalationPolicySchema.safeParse(JSON.parse(org.escalation_policy || '{}'));
        if (!parsed.success || !parsed.data.enabled || parsed.data.levels.length === 0) continue;
        policy = parsed.data;
      } catch { continue; }

      try {
        await this.scanOrg(org.id, org.name, policy);
      } catch (err) {
        console.error(`[escalation] Scan failed for org ${org.id} (${org.name}):`, err instanceof Error ? err.message : err);
      }
    }
  }

  private async scanOrg(orgId: number, orgName: string, policy: OnboardingEscalationPolicy): Promise<void> {
    const dashboard = await this.dashboards.getOnboardingDashboard(orgId);
    if (dashboard.rows.length === 0) return;

    for (const row of dashboard.rows) {
      const age = policy.workingDays ? workingDaysSince(row.created) : row.ageDays;
      for (const level of policy.levels) {
        if (age < level.day) continue;

        if (level.sendCustomerUpdate && level.customerRecipients.some(r => r.email.trim())) {
          await this.fireOnce(orgId, row.key, level.day, 'update', level.customerRecipients,
            () => this.customerUpdateEmail(orgName, row, level));
        }
        if (level.escalate && level.escalationRecipients.some(r => r.email.trim())) {
          const recipients = [...level.escalationRecipients, ...level.informRecipients];
          await this.fireOnce(orgId, row.key, level.day, 'escalation', recipients,
            (r) => this.escalationEmail(orgName, row, level, r, level.informRecipients.includes(r)));
        }
      }
    }
  }

  /** Send once per (org, ticket, level, kind). Records the log row only after at
   *  least one email is dispatched, so a total failure is retried next scan. */
  private async fireOnce(
    orgId: number, ticketKey: string, day: number, kind: 'update' | 'escalation',
    recipients: EscalationRecipient[],
    build: (r: EscalationRecipient) => { subject: string; html: string; text: string },
  ): Promise<void> {
    const already = await queryOne<{ id: number }>(
      `SELECT id FROM onboarding_escalation_log WHERE org_id = ? AND ticket_key = ? AND level_day = ? AND kind = ?`,
      [orgId, ticketKey, day, kind],
    );
    if (already) return;

    const valid = recipients.filter(r => r.email.trim());
    let sent = 0;
    const sentTo: string[] = [];
    for (const r of valid) {
      const { subject, html, text } = build(r);
      try {
        await this.email.send({ to: r.email.trim(), subject, html, text });
        sent++;
        sentTo.push(r.email.trim());
      } catch (err) {
        console.error(`[escalation] Failed to email ${r.email} for ${ticketKey} (day ${day}, ${kind}):`, err instanceof Error ? err.message : err);
      }
    }

    if (sent > 0) {
      try {
        await execute(
          `INSERT INTO onboarding_escalation_log (org_id, ticket_key, level_day, kind, recipients)
           VALUES (?, ?, ?, ?, ?)`,
          [orgId, ticketKey, day, kind, sentTo.join(', ')],
        );
      } catch (err) {
        // Unique-constraint race (another scan tick) — safe to ignore.
        console.warn(`[escalation] Log insert skipped for ${ticketKey} (day ${day}, ${kind}):`, err instanceof Error ? err.message : err);
      }
      console.log(`[escalation] ${kind} day ${day} sent for ${ticketKey} → ${sentTo.join(', ')}`);
    }
  }

  private ticketLine(row: OnboardingDashboardRow): string {
    return `${row.summary} (${row.key})`;
  }

  private customerUpdateEmail(orgName: string, row: OnboardingDashboardRow, level: EscalationLevel) {
    const link = `${JIRA_BROWSE_BASE}${row.key}`;
    const subject = `Onboarding progress update — ${row.summary}`;
    const noteHtml = level.note ? `<p>${esc(level.note)}</p>` : '';
    const html = `
      <p>Hello,</p>
      <p>Here is your onboarding progress update for <strong>${esc(row.summary)}</strong>.</p>
      <ul>
        <li><strong>Reference:</strong> ${esc(row.key)}</li>
        <li><strong>Current stage:</strong> ${esc(row.stage)}</li>
        <li><strong>Days since logged:</strong> ${row.ageDays}</li>
      </ul>
      ${noteHtml}
      <p>We will continue to keep you updated as the work progresses.</p>
      <p>Kind regards,<br/>The Nurtur Onboarding Team</p>
      <p style="font-size:12px;color:#888">Ref: <a href="${link}">${esc(row.key)}</a></p>`;
    const text = `Onboarding progress update for ${this.ticketLine(row)}.\n`
      + `Current stage: ${row.stage}. Days since logged: ${row.ageDays}.\n`
      + (level.note ? `\n${level.note}\n` : '')
      + `\nKind regards,\nThe Nurtur Onboarding Team\n${link}`;
    return { subject, html, text };
  }

  private escalationEmail(orgName: string, row: OnboardingDashboardRow, level: EscalationLevel, recipient: EscalationRecipient, informOnly: boolean) {
    const link = `${JIRA_BROWSE_BASE}${row.key}`;
    const subject = `[Onboarding escalation — Day ${level.day}] ${row.summary} (${orgName})`;
    const banner = informOnly
      ? '<p style="color:#8a6d00"><strong>For your information</strong> — an escalation has been raised on this onboarding. No action is required from you.</p>'
      : '<p style="color:#b00020"><strong>Escalation — action required.</strong></p>';
    const noteHtml = level.note ? `<p>${esc(level.note)}</p>` : '';
    const html = `
      ${banner}
      <p>The following onboarding for <strong>${esc(orgName)}</strong> has reached <strong>Day ${level.day}</strong> (${esc(level.name)}) and is not yet complete:</p>
      <ul>
        <li><strong>Onboarding:</strong> ${esc(row.summary)}</li>
        <li><strong>Reference:</strong> <a href="${link}">${esc(row.key)}</a></li>
        <li><strong>Current stage:</strong> ${esc(row.stage)}</li>
        <li><strong>Owner:</strong> ${esc(row.owner || 'Unassigned')}</li>
        <li><strong>Days since logged:</strong> ${row.ageDays}</li>
      </ul>
      ${noteHtml}`;
    const text = `${informOnly ? 'FYI — an escalation has been raised (no action required).' : 'ESCALATION — action required.'}\n\n`
      + `${orgName} onboarding "${row.summary}" (${row.key}) reached Day ${level.day} (${level.name}) and is not complete.\n`
      + `Stage: ${row.stage}. Owner: ${row.owner || 'Unassigned'}. Days since logged: ${row.ageDays}.\n`
      + (level.note ? `\n${level.note}\n` : '')
      + `\n${link}`;
    return { subject, html, text };
  }
}
