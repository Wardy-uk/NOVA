/**
 * Guild/BYM onboarding — weekly digest + INTS escalation sweep (backlog #8, R8/R4).
 *
 * R8: ONE Monday email to Guild covering ALL open deliveries (a digest, not one
 *     email per ticket). Replaces the per-update emails for the Guild channel —
 *     Guild status otherwise lives on the dashboard. (The general per-org
 *     escalation engine is untouched; it still serves non-Guild orgs.)
 * R4: INTS is the only child that escalates — day 7/14/21/30. Fired here to
 *     internal recipients, deduped via onboarding_escalation_log (kind guild_ints).
 *
 * Recipients are settings-driven (exact addresses/roles are a BA item, spec §7).
 */
import type { GuildDashboardService } from './guild-dashboard.js';
import type { EmailService } from './email.js';
import type { GuildOnboardingRow } from '../../shared/portal-types.js';
import { INTS_LADDER } from './guild-onboarding-sla.js';
import { execute, queryOne } from './database.js';

type SettingsGet = (key: string) => string | undefined;

function csv(v: string | undefined): string[] {
  return (v || '').split(',').map(s => s.trim()).filter(Boolean);
}
function officeLabel(r: GuildOnboardingRow): string {
  return [r.officeName, r.branchName].filter(Boolean).join(' — ') || '(unnamed)';
}
function isOpen(r: GuildOnboardingRow): boolean {
  return r.slaRag !== 'met';
}

export class GuildDigestService {
  constructor(
    private dashboard: GuildDashboardService,
    private email: EmailService,
    private settingsGet: SettingsGet,
    private log: (msg: string) => void = console.log,
  ) {}

  private enabled(key: string): boolean {
    return /^(true|1|on|yes)$/i.test(this.settingsGet(key) || '');
  }

  /** R8 — Monday digest of every open Guild delivery, one email to Guild. */
  async sendWeeklyDigest(): Promise<{ sent: boolean; rows: number }> {
    if (!this.enabled('guild_digest_enabled')) return { sent: false, rows: 0 };
    if (!this.email.isConfigured()) return { sent: false, rows: 0 };
    const recipients = csv(this.settingsGet('guild_digest_recipients'));
    if (recipients.length === 0) { this.log('[guild-digest] No recipients set'); return { sent: false, rows: 0 }; }

    const { rows } = await this.dashboard.getDashboard();
    const open = rows.filter(isOpen);
    if (open.length === 0) { this.log('[guild-digest] No open deliveries — skipping'); return { sent: false, rows: 0 }; }

    const html = this.buildDigestHtml(open);
    const text = open.map(r =>
      `${officeLabel(r)} — SLA ${r.slaBreached ? 'BREACHED' : `${r.slaDaysRemaining}d left`}`
      + (r.intsEscalationLevel > 0 ? ` — INTS escalation day ${r.intsEscalationLevel}` : '')
      + `\n  ${r.milestones.filter(m => m.kind === 'ticket').map(m => `${m.label}: ${m.detail || m.state}`).join('; ')}`,
    ).join('\n\n');

    await this.email.send({
      to: recipients.join(', '),
      subject: `Guild onboarding — weekly status (${open.length} open)`,
      text,
      html,
    });
    this.log(`[guild-digest] Sent weekly digest for ${open.length} open deliveries to ${recipients.join(', ')}`);
    return { sent: true, rows: open.length };
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

  /** R4 — fire INTS escalations at each crossed threshold, once each. */
  async runIntsEscalations(): Promise<{ fired: number }> {
    if (!this.enabled('guild_ints_escalations_enabled')) return { fired: 0 };
    if (!this.email.isConfigured()) return { fired: 0 };
    const { rows } = await this.dashboard.getDashboard();
    let fired = 0;
    for (const r of rows) {
      if (!r.intsKey || r.orgId == null || r.intsEscalationLevel === 0) continue;
      for (const day of INTS_LADDER) {
        if (day > r.intsEscalationLevel) break;
        const did = await this.fireIntsOnce(r, day);
        if (did) fired++;
      }
    }
    return { fired };
  }

  private recipientsFor(day: number): string[] {
    const fallback = csv(this.settingsGet('onboarding_inbox_email'));
    if (day === 7) return csv(this.settingsGet('guild_ints_nudge_email')).concat(fallback);
    if (day === 14) return csv(this.settingsGet('guild_ints_lead_email')).concat(fallback);
    if (day === 21) return csv(this.settingsGet('guild_ints_manager_email')).concat(fallback);
    // Day 30 — SLA breach: lead + manager.
    return csv(this.settingsGet('guild_ints_lead_email'))
      .concat(csv(this.settingsGet('guild_ints_manager_email')))
      .concat(fallback);
  }

  private async fireIntsOnce(r: GuildOnboardingRow, day: number): Promise<boolean> {
    const already = await queryOne<{ id: number }>(
      `SELECT id FROM onboarding_escalation_log WHERE org_id = ? AND ticket_key = ? AND level_day = ? AND kind = ?`,
      [r.orgId, r.intsKey, day, 'guild_ints'],
    );
    if (already) return false;
    const recipients = [...new Set(this.recipientsFor(day))];
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
