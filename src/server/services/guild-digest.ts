/**
 * Guild/BYM onboarding — weekly digest + INTS escalation sweep (backlog #8, R8/R4).
 *
 * Per-org (level 2/3): each runs only for orgs whose toggle is on
 * (portal_organisations.guild_digest_enabled / guild_ints_escalations_enabled),
 * using that org's recipient config (onboarding_config JSON, set by the org's
 * admin on the "Onboarding Configuration" portal page).
 *
 * R8: ONE Monday email per org covering all its open deliveries (a digest, not
 *     one email per ticket). Replaces per-update emails for the Guild channel.
 * R4: INTS is the only child that escalates — day 7/14/21/30 — deduped via
 *     onboarding_escalation_log (kind guild_ints).
 */
import type { GuildDashboardService } from './guild-dashboard.js';
import type { EmailService } from './email.js';
import type { GuildOnboardingRow, OnboardingOrgConfig } from '../../shared/portal-types.js';
import { OnboardingOrgConfigSchema, DEFAULT_ONBOARDING_ORG_CONFIG } from '../../shared/portal-types.js';
import { INTS_LADDER } from './guild-onboarding-sla.js';
import { query, queryOne, execute } from './database.js';

function csv(v: string | undefined): string[] {
  return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}
function officeLabel(r: GuildOnboardingRow): string {
  return [r.officeName, r.branchName].filter(Boolean).join(' — ') || '(unnamed)';
}
function isOpen(r: GuildOnboardingRow): boolean {
  // Only setup-stage records are live deliveries; application-stage are still
  // awaiting the setup form (no tickets/SLA yet).
  return r.stage === 'setup' && r.slaRag !== 'met';
}

export class GuildDigestService {
  constructor(
    private dashboard: GuildDashboardService,
    private email: EmailService,
    private settingsGet: (key: string) => string | undefined = () => undefined,
    private log: (msg: string) => void = console.log,
  ) {}

  /** Orgs whose given per-org toggle is on, with their parsed recipient config. */
  private async orgsWithFlag(flagCol: 'guild_digest_enabled' | 'guild_ints_escalations_enabled'): Promise<Array<{ orgId: number; config: OnboardingOrgConfig }>> {
    const rows = await query<{ id: number; onboarding_config: string | null }>(
      `SELECT id, onboarding_config FROM portal_organisations WHERE ${flagCol} = 1`,
    );
    return rows.map(r => {
      let config = DEFAULT_ONBOARDING_ORG_CONFIG;
      if (r.onboarding_config) {
        const parsed = OnboardingOrgConfigSchema.safeParse((() => { try { return JSON.parse(r.onboarding_config!); } catch { return {}; } })());
        if (parsed.success) config = parsed.data;
      }
      return { orgId: r.id, config };
    });
  }

  /** R8 — one Monday digest per enabled org, to that org's recipients. */
  async sendWeeklyDigest(): Promise<{ orgsSent: number; rows: number }> {
    if (!this.email.isConfigured()) return { orgsSent: 0, rows: 0 };
    const orgs = await this.orgsWithFlag('guild_digest_enabled');
    let orgsSent = 0;
    let totalRows = 0;
    for (const { orgId, config } of orgs) {
      const recipients = csv(config.digestRecipients);
      if (recipients.length === 0) continue;
      const { rows } = await this.dashboard.getDashboard({ orgId });
      const open = rows.filter(isOpen);
      if (open.length === 0) continue;
      const html = this.buildDigestHtml(open);
      const text = open.map(r =>
        `${officeLabel(r)} — SLA ${r.slaBreached ? 'BREACHED' : `${r.slaDaysRemaining}d left`}`
        + (r.intsEscalationLevel > 0 ? ` — INTS escalation day ${r.intsEscalationLevel}` : '')
        + `\n  ${r.milestones.filter(m => m.kind === 'ticket').map(m => `${m.label}: ${m.detail || m.state}`).join('; ')}`,
      ).join('\n\n');
      await this.email.send({
        to: recipients.join(', '),
        subject: `Guild onboarding — weekly status (${open.length} open)`,
        text, html,
      });
      orgsSent++;
      totalRows += open.length;
      this.log(`[guild-digest] org ${orgId}: sent digest for ${open.length} open → ${recipients.join(', ')}`);
    }
    return { orgsSent, rows: totalRows };
  }

  private buildDigestHtml(rows: GuildOnboardingRow[]): string {
    const ragColor: Record<string, string> = { green: '#16a34a', amber: '#d97706', red: '#dc2626', met: '#2563eb' };
    const body = rows.map(r => {
      const tickets = r.milestones.filter(m => m.kind === 'ticket')
        .map(m => `${m.label}: <strong>${m.detail || m.state}</strong>`).join(' · ');
      const sla = r.slaBreached ? 'BREACHED' : `${r.slaDaysRemaining} days left`;
      const ints = r.intsEscalationLevel > 0 ? `<span style="color:#dc2626">INTS escalation — day ${r.intsEscalationLevel}</span>` : '—';
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${officeLabel(r)}<br><span style="color:#888;font-size:11px">${r.parentKey || ''}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${ragColor[r.slaRag]}">${sla}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${ints}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${tickets}</td>
      </tr>`;
    }).join('');
    return `<div style="font-family:Arial,sans-serif;color:#222">
      <h2>Guild onboarding — weekly status</h2>
      <p>${rows.length} open ${rows.length === 1 ? 'delivery' : 'deliveries'}.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr style="text-align:left;color:#666">
          <th style="padding:6px 10px">Set-up</th><th style="padding:6px 10px">30-day SLA</th>
          <th style="padding:6px 10px">Escalation</th><th style="padding:6px 10px">Workstreams</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  }

  /** R4 — fire INTS escalations at each crossed threshold, once each, per enabled org. */
  async runIntsEscalations(): Promise<{ fired: number }> {
    if (!this.email.isConfigured()) return { fired: 0 };
    const orgs = await this.orgsWithFlag('guild_ints_escalations_enabled');
    let fired = 0;
    for (const { orgId, config } of orgs) {
      const { rows } = await this.dashboard.getDashboard({ orgId });
      for (const r of rows) {
        if (!r.intsKey || r.orgId == null || r.intsEscalationLevel === 0) continue;
        for (const day of INTS_LADDER) {
          if (day > r.intsEscalationLevel) break;
          if (await this.fireIntsOnce(r, day, config)) fired++;
        }
      }
    }
    return { fired };
  }

  private recipientsFor(day: number, config: OnboardingOrgConfig): string[] {
    // Fallback to the global onboarding inbox if the org hasn't set INTS recipients.
    const fallback = csv(this.settingsGet('onboarding_inbox_email'));
    if (day === 7) return csv(config.intsNudgeEmail).concat(fallback);
    if (day === 14) return csv(config.intsLeadEmail).concat(fallback);
    if (day === 21) return csv(config.intsManagerEmail).concat(fallback);
    // Day 30 — SLA breach: lead + manager.
    return csv(config.intsLeadEmail).concat(csv(config.intsManagerEmail)).concat(fallback);
  }

  private async fireIntsOnce(r: GuildOnboardingRow, day: number, config: OnboardingOrgConfig): Promise<boolean> {
    const already = await queryOne<{ id: number }>(
      `SELECT id FROM onboarding_escalation_log WHERE org_id = ? AND ticket_key = ? AND level_day = ? AND kind = ?`,
      [r.orgId, r.intsKey, day, 'guild_ints'],
    );
    if (already) return false;
    const recipients = [...new Set(this.recipientsFor(day, config))];
    if (recipients.length === 0) return false;

    const label = day === 7 ? 'Reminder' : day === 14 ? 'Escalation to onboarding lead'
      : day === 21 ? 'Escalation to manager' : 'Overall SLA breach';
    const office = officeLabel(r);
    const subject = `Guild INTS — day ${day} ${label}: ${office} (${r.intsKey})`;
    const text = `INTS integration for ${office} has reached day ${day} without completion.\n\n`
      + `Action: ${label}\nINTS ticket: ${r.intsKey}\nQA parent: ${r.parentKey}\n`
      + `30-day SLA: ${r.slaBreached ? 'BREACHED' : `${r.slaDaysRemaining} days left`}\nRef: ${r.ref}`;
    const html = `<div style="font-family:Arial,sans-serif;color:#222">
      <p>INTS integration for <strong>${office}</strong> has reached <strong>day ${day}</strong> without completion.</p>
      <p><strong>Action:</strong> ${label}<br><strong>INTS ticket:</strong> ${r.intsKey}<br>
      <strong>QA parent:</strong> ${r.parentKey}<br>
      <strong>30-day SLA:</strong> ${r.slaBreached ? 'BREACHED' : `${r.slaDaysRemaining} days left`}<br>
      <strong>Ref:</strong> ${r.ref}</p></div>`;

    let sent = 0;
    const sentTo: string[] = [];
    for (const to of recipients) {
      try { await this.email.send({ to, subject, text, html }); sent++; sentTo.push(to); }
      catch (err) { this.log(`[guild-ints] Failed to email ${to} for ${r.intsKey} day ${day}: ${err instanceof Error ? err.message : err}`); }
    }
    if (sent === 0) return false;
    try {
      await execute(
        `INSERT INTO onboarding_escalation_log (org_id, ticket_key, level_day, kind, recipients) VALUES (?, ?, ?, ?, ?)`,
        [r.orgId, r.intsKey, day, 'guild_ints', sentTo.join(', ')],
      );
    } catch (err) {
      this.log(`[guild-ints] Log insert skipped for ${r.intsKey} day ${day}: ${err instanceof Error ? err.message : err}`);
    }
    this.log(`[guild-ints] Day ${day} ${label} sent for ${r.intsKey} → ${sentTo.join(', ')}`);
    return true;
  }
}
