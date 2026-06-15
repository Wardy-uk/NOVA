// B1 (KPI retirement parity): maintain dbo.Agent's live operational stat columns
// (OpenTickets_*, SolvedTickets_*, OldestTicket*) from the Rebuild kpi-agent engine.
//
// These columns feed round-robin (assignment-engine), the agent-admin endpoints
// (kpi-data.ts), and the legacy breach board read paths. Historically only n8n and
// the legacy kpi-pipeline `refreshAllAgentMetrics` kept them fresh — both of which
// are being retired. This makes the Rebuild engine the single owner, reading the
// already-computed live snapshot (60s-cached, corrected definitions) and writing it
// back so the dependency survives n8n + kpi-pipeline going dark.

import sql from 'mssql';
import type { JiraRestClient } from '../jira-client.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import { getKpiPool } from '../kpi-pipeline.js';
import { getAgentLiveSnapshot } from './index.js';

/**
 * Write the Rebuild engine's per-agent tier-1 stocks back into dbo.Agent. The live
 * snapshot's roster already covers every active NT/NOVA_AI agent (open=0 when they
 * hold no tickets), so a per-agent UPDATE keyed on AccountId naturally zeroes anyone
 * who has cleared their queue — no separate zeroing pass needed. Never throws.
 */
export async function syncAgentRosterStats(
  settings: SettingsQueries,
  jira: JiraRestClient,
): Promise<{ updated: number; total: number }> {
  try {
    const pool = await getKpiPool(settings);
    const snap = await getAgentLiveSnapshot(settings, jira);

    // OldestTicketKey is a later-added column; guard so older schemas still update.
    const hasOldestKey = (await pool.request().query(
      `SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'OldestTicketKey'`,
    )).recordset.length > 0;

    let updated = 0;
    for (const a of snap.agents) {
      if (!a.accountId) continue;
      const req = pool.request();
      req.input('accountId', sql.NVarChar(100), a.accountId);
      req.input('openTotal', sql.Int, a.open);
      req.input('over2h', sql.Int, a.overSla);
      req.input('noUpdate', sql.Int, a.noReply);
      req.input('solvedToday', sql.Int, a.solvedToday);
      req.input('solvedWeek', sql.Int, a.solvedWeek);
      req.input('oldestDays', sql.Int, a.oldestDays);
      if (hasOldestKey) req.input('oldestKey', sql.NVarChar(50), a.oldestKey ?? null);

      const result = await req.query(`
        UPDATE dbo.Agent SET
          OpenTickets_Total = @openTotal,
          OpenTickets_Over2Hours = @over2h,
          OpenTickets_NoUpdateToday = @noUpdate,
          SolvedTickets_Today = @solvedToday,
          SolvedTickets_ThisWeek = @solvedWeek,
          OldestTicketDays = @oldestDays,
          ${hasOldestKey ? 'OldestTicketKey = @oldestKey,' : ''}
          TicketsSnapshotAt = GETUTCDATE()
        WHERE AccountId = @accountId
      `);
      if (result.rowsAffected[0] > 0) updated++;
    }

    console.log(`[kpi-agent] roster stats sync: ${updated}/${snap.agents.length} agents updated in dbo.Agent`);
    return { updated, total: snap.agents.length };
  } catch (err) {
    console.error('[kpi-agent] syncAgentRosterStats failed:', err instanceof Error ? err.message : err);
    return { updated: 0, total: 0 };
  }
}
