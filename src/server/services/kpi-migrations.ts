// One-time KPI data migrations.
//
// Each migration is guarded by a settings flag so it runs exactly once per
// environment (the flag lives in settings.json under DATA_DIR, which survives
// deploys). Run on startup, after the server is listening, fire-and-forget — a
// failure logs and leaves the flag unset so it retries on the next deploy.
//
// Migrations target the KPI Azure SQL (`techservicesjsm`) via getKpiPool — only
// NOVA-populated tables (jira_kpi_daily, KpiTargets). Never the forbidden raw
// Jira tables.

import type { SettingsQueries } from '../db/settings-store.js';
import { getKpiPool } from './kpi-pipeline.js';

/** Backfill historical New Tickets Today rows to the <90/90–110/>110 RAG band. */
async function backfillNewTicketVolumeRag(settings: SettingsQueries): Promise<void> {
  // Flag bumped to v3 when the band was reverted 120/150 → 90/110, so the
  // backfill re-runs once more even if an earlier backfill already applied.
  const FLAG = 'kpi_migration_newvol_rag_band_v3';
  if (settings.get(FLAG) === 'done') return;

  const pool = await getKpiPool(settings);
  // jira_kpi_daily is the source the dashboards read. Recolour every historical
  // New Tickets Today row to the new band and align the stored target/direction.
  const res = await pool.request().query(`
    UPDATE dbo.jira_kpi_daily
    SET rag = CASE WHEN [count] < 90 THEN 1 WHEN [count] <= 110 THEN 2 ELSE 3 END,
        target = 90, direction = 'Lower is better'
    WHERE kpi = 'New Tickets Today';
  `);
  // Align the master target if a stale row exists (table may not exist in all envs).
  try {
    await pool.request().query(`
      UPDATE dbo.KpiTargets SET TargetValue = 90 WHERE KpiName = 'New Tickets Today';
    `);
  } catch { /* KpiTargets optional */ }

  const rows = Array.isArray(res.rowsAffected) ? res.rowsAffected.reduce((a, b) => a + b, 0) : 0;
  settings.set(FLAG, 'done');
  console.log(`[N.O.V.A] KPI migration: New Tickets Today RAG backfilled (${rows} rows) — band <90/90–110/>110`);
}

/** Run all pending one-time KPI migrations. Safe to call on every startup. */
export async function runKpiMigrations(settings: SettingsQueries): Promise<void> {
  const tasks: Array<[string, () => Promise<void>]> = [
    ['newvol-rag-band', () => backfillNewTicketVolumeRag(settings)],
  ];
  for (const [name, run] of tasks) {
    try {
      await run();
    } catch (err) {
      console.warn(`[N.O.V.A] KPI migration "${name}" failed (will retry next deploy):`, err instanceof Error ? err.message : err);
    }
  }
}
