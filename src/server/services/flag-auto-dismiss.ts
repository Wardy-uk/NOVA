import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute } from './database.js';
import { logError } from './error-log.js';

interface SweepResult {
  resolved: number;
  aged_out: number;
  auto_handled: number;
  total: number;
}

interface FlagRow {
  id: number;
  ticket_key: string;
}

export class FlagAutoDismissService {
  constructor(private settings: SettingsQueries) {}

  async sweep(): Promise<SweepResult> {
    const dismissResolved = (await this.settings.get('agent_flag_auto_dismiss_resolved')) !== 'false';
    const ageDays = parseInt((await this.settings.get('agent_flag_auto_dismiss_age_days')) || '14', 10);
    const riskThreshold = parseInt((await this.settings.get('agent_flag_auto_dismiss_risk_threshold')) || '50', 10);

    let resolved = 0;
    let aged_out = 0;
    let auto_handled = 0;

    // Each sweep branch is isolated: one failing query must not abort the whole
    // job (and its error surfaces centrally instead of killing the sweep).
    if (dismissResolved) {
      try {
        const rows = await query<FlagRow>(
          `SELECT f.id, f.ticket_key FROM agent_flagged_tickets f
           INNER JOIN jira_issue_cache j ON f.ticket_key = j.issue_key
           WHERE f.status = 'open' AND j.status_name IN ('Done', 'Resolved', 'Closed')`
        );
        for (const row of rows) {
          await this.dismiss(row.id, row.ticket_key, 'ticket_resolved');
        }
        resolved = rows.length;
      } catch (err) {
        await logError('flag-auto-dismiss', err, { context: { phase: 'resolved' } });
      }
    }

    try {
      const agedRows = await query<FlagRow>(
        `SELECT id, ticket_key FROM agent_flagged_tickets
         WHERE status = 'open' AND risk_score < ?
         AND flagged_at < DATEADD(DAY, -?, GETUTCDATE())`,
        [riskThreshold, ageDays]
      );
      for (const row of agedRows) {
        await this.dismiss(row.id, row.ticket_key, 'aged_out');
      }
      aged_out = agedRows.length;
    } catch (err) {
      await logError('flag-auto-dismiss', err, { context: { phase: 'aged_out' } });
    }

    try {
      const autoRows = await query<FlagRow>(
        // agent_auto_rule_log was never created by any migration and never
        // written to, so this branch threw "Invalid object name" on every sweep
        // (328 in a week) and no flag was ever auto-dismissed. Auto-rule matches
        // have always lived in agent_decisions as action 'auto_rule_<id>' —
        // the same source wasAlreadyActioned() reads. Shadow-mode matches are
        // excluded: nothing actually happened to the ticket.
        `SELECT f.id, f.ticket_key FROM agent_flagged_tickets f
         WHERE f.status = 'open' AND EXISTS (
           SELECT 1 FROM agent_decisions a
           WHERE a.ticket_id = f.ticket_key
             AND a.action LIKE 'auto_rule_%'
             AND a.created_at > f.flagged_at
             AND ISNULL(CASE WHEN ISJSON(a.output) = 1 THEN JSON_VALUE(a.output, '$.shadow') END, 'false') <> 'true'
         )`
      );
      for (const row of autoRows) {
        await this.dismiss(row.id, row.ticket_key, 'auto_handled');
      }
      auto_handled = autoRows.length;
    } catch (err) {
      await logError('flag-auto-dismiss', err, { context: { phase: 'auto_handled' } });
    }

    return { resolved, aged_out, auto_handled, total: resolved + aged_out + auto_handled };
  }

  private async dismiss(id: number, ticketKey: string, reason: string): Promise<void> {
    await execute(
      `UPDATE agent_flagged_tickets SET status = 'dismissed', dismiss_reason = ?, dismissed_at = GETUTCDATE() WHERE id = ?`,
      [reason, id]
    );
    await execute(
      `INSERT INTO agent_alerts (type, severity, title, body, ticket_key, created_at)
       VALUES ('flag_auto_dismissed', 'info', ?, ?, ?, GETUTCDATE())`,
      [`Flag dismissed: ${ticketKey}`, `Auto-dismissed with reason: ${reason}`, ticketKey]
    );
  }
}
