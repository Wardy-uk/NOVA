#!/usr/bin/env tsx
/**
 * KPX-WP11 diagnostic — read-only assessment of clean-sheet KPI data freshness
 * and backfill source availability. Writes NOTHING. Reports current row counts,
 * freshness, and what historical source data exists in the NOVA main pool.
 */
import 'dotenv/config';
import { initPool, query, closePool } from '../../src/server/services/database.js';

async function safeCount(label: string, sqlText: string, params: unknown[] = []): Promise<void> {
  try {
    const rows = await query<Record<string, unknown>>(sqlText, params);
    console.log(`  ${label}:`, JSON.stringify(rows.length === 1 ? rows[0] : rows));
  } catch (err) {
    console.log(`  ${label}: ERROR ${err instanceof Error ? err.message : err}`);
  }
}

async function main(): Promise<void> {
  await initPool();
  console.log('\n=== CLEAN-SHEET TABLE ROW COUNTS ===');
  await safeCount('kpi_snapshots', `SELECT COUNT(*) AS n, MIN(snapshot_at) AS min_at, MAX(snapshot_at) AS max_at FROM kpi_snapshots`);
  await safeCount('kpi_daily', `SELECT COUNT(*) AS n, MIN(report_date) AS min_d, MAX(report_date) AS max_d, COUNT(DISTINCT report_date) AS days FROM kpi_daily`);
  await safeCount('kpi_agent_daily', `SELECT COUNT(*) AS n, MIN(report_date) AS min_d, MAX(report_date) AS max_d, COUNT(DISTINCT report_date) AS days FROM kpi_agent_daily`);
  await safeCount('kpi_eod_snapshot', `SELECT COUNT(*) AS n, MIN(snapshot_date) AS min_d, MAX(snapshot_date) AS max_d, COUNT(DISTINCT snapshot_date) AS days FROM kpi_eod_snapshot`);
  await safeCount('kpi_manual_entries', `SELECT COUNT(*) AS n FROM kpi_manual_entries`);

  console.log('\n=== kpi_daily BY SPACE ===');
  await safeCount('per-space', `SELECT space_key, COUNT(*) AS rows, COUNT(DISTINCT report_date) AS days, MIN(report_date) AS min_d, MAX(report_date) AS max_d FROM kpi_daily GROUP BY space_key`);

  console.log('\n=== kpi_daily BY metric_key ===');
  await safeCount('per-metric', `SELECT metric_key, COUNT(*) AS rows, COUNT(DISTINCT report_date) AS days FROM kpi_daily GROUP BY metric_key ORDER BY rows DESC`);

  console.log('\n=== SPACES CONFIG ===');
  await safeCount('spaces', `SELECT space_key, jira_project, is_jira_space, is_active, timezone FROM kpi_spaces ORDER BY space_key`);

  console.log('\n=== SOURCE: jira_issue_cache ===');
  await safeCount('cache total', `SELECT COUNT(*) AS n FROM jira_issue_cache`);
  await safeCount('cache by project', `SELECT project_key, COUNT(*) AS n, SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved, MIN(jira_created) AS min_created, MAX(jira_updated) AS max_updated FROM jira_issue_cache GROUP BY project_key ORDER BY n DESC`);
  await safeCount('resolved_at span', `SELECT MIN(resolved_at) AS min_resolved, MAX(resolved_at) AS max_resolved, COUNT(*) AS resolved_rows FROM jira_issue_cache WHERE resolved_at IS NOT NULL`);
  await safeCount('comment cache', `SELECT COUNT(*) AS n, SUM(CASE WHEN is_public=1 THEN 1 ELSE 0 END) AS public_n FROM jira_comment_cache`);

  console.log('\n=== SOURCE: escalation_log ===');
  await safeCount('escalation_log', `SELECT COUNT(*) AS n, COUNT(DISTINCT escalation_type) AS types FROM escalation_log`);
  await safeCount('escalation types', `SELECT escalation_type, COUNT(*) AS n FROM escalation_log GROUP BY escalation_type`);

  await closePool();
}

main().catch((err) => { console.error('DIAG FAILED:', err instanceof Error ? err.stack : err); process.exit(1); });
