import sql from 'mssql';
import type Database from 'better-sqlite3';
import type { SettingsQueries } from '../db/settings-store.js';

let pool: sql.ConnectionPool | null = null;

async function getPool(settings: Record<string, string>): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  const server = settings.kpi_sql_server;
  const database = settings.kpi_sql_database;
  const user = settings.kpi_sql_user;
  const password = settings.kpi_sql_password;

  if (!server || !database || !user || !password) {
    throw new Error('KPI SQL Server not configured — skipping Calyx KPI sync');
  }

  pool = await new sql.ConnectionPool({
    server,
    database,
    user,
    password,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
    requestTimeout: 30000,
  }).connect();

  return pool;
}

function computeRag(value: number, target: number, direction: string): number {
  if (direction === 'Higher is better') {
    if (value >= target) return 1; // green
    if (value >= target * 0.8) return 2; // amber
    return 3; // red
  }
  // Lower is better
  if (value <= target) return 1;
  if (value <= target * 1.5) return 2;
  return 3;
}

interface KpiRow {
  kpi: string;
  kpiGroup: string;
  count: number;
  target: number;
  direction: string;
}

export async function syncCalyxKpisToNova(db: Database.Database, settingsQueries: SettingsQueries): Promise<void> {
  const settings = settingsQueries.getAll();
  let p: sql.ConnectionPool;
  try {
    p = await getPool(settings);
  } catch (err) {
    console.log(`[calyx-kpi-sync] ${err instanceof Error ? err.message : 'Pool error'}`);
    return;
  }

  try {
    // Open tickets
    const openTickets = (db.prepare(`SELECT COUNT(*) as n FROM calyx_tickets WHERE status NOT IN ('resolved','closed')`).get() as any).n;
    const p1Open = (db.prepare(`SELECT COUNT(*) as n FROM calyx_tickets WHERE priority='P1' AND status NOT IN ('resolved','closed')`).get() as any).n;
    const breached = (db.prepare(`SELECT COUNT(*) as n FROM calyx_tickets WHERE resolution_due_at < datetime('now') AND status NOT IN ('resolved','closed')`).get() as any).n;

    // 30-day SLA compliance
    const from30 = new Date(Date.now() - 30 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const sla = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN frt_met_at IS NOT NULL AND frt_due_at IS NOT NULL AND frt_met_at <= frt_due_at THEN 1 ELSE 0 END) as frt_met,
        SUM(CASE WHEN resolved_at IS NOT NULL AND resolution_due_at IS NOT NULL AND resolved_at <= resolution_due_at THEN 1 ELSE 0 END) as res_met
      FROM calyx_tickets WHERE created_at BETWEEN ? AND ?
    `).get(from30, now) as any;

    const total = sla.total || 1;
    const frtPct = Math.round(1000 * (sla.frt_met || 0) / total) / 10;
    const resPct = Math.round(1000 * (sla.res_met || 0) / total) / 10;

    // CSAT
    const csatRow = db.prepare(`
      SELECT ROUND(AVG(csat_score), 1) as avg FROM calyx_csat_surveys WHERE responded_at IS NOT NULL AND sent_at BETWEEN ? AND ?
    `).get(from30, now) as any;
    const csatAvg = csatRow.avg || 0;

    // FCR
    const fcrRow = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN id NOT IN (
          SELECT DISTINCT ticket_id FROM calyx_ticket_events WHERE event_type = 'escalated'
        ) THEN 1 ELSE 0 END) as fcr
      FROM calyx_tickets WHERE status IN ('resolved','closed') AND created_at BETWEEN ? AND ?
    `).get(from30, now) as any;
    const fcrPct = (fcrRow.total || 0) > 0 ? Math.round(1000 * (fcrRow.fcr || 0) / fcrRow.total) / 10 : 0;

    const metrics: KpiRow[] = [
      { kpi: 'Calyx: Open Tickets', kpiGroup: 'Calyx', count: openTickets, target: 20, direction: 'Lower is better' },
      { kpi: 'Calyx: P1 Open', kpiGroup: 'Calyx', count: p1Open, target: 0, direction: 'Lower is better' },
      { kpi: 'Calyx: SLA Breached', kpiGroup: 'Calyx', count: breached, target: 0, direction: 'Lower is better' },
      { kpi: 'Calyx: FRT Compliance %', kpiGroup: 'Calyx', count: frtPct, target: 85, direction: 'Higher is better' },
      { kpi: 'Calyx: Resolution Compliance %', kpiGroup: 'Calyx', count: resPct, target: 85, direction: 'Higher is better' },
      { kpi: 'Calyx: CSAT Average', kpiGroup: 'Calyx', count: csatAvg, target: 4, direction: 'Higher is better' },
      { kpi: 'Calyx: FCR Rate %', kpiGroup: 'Calyx', count: fcrPct, target: 70, direction: 'Higher is better' },
    ];

    // Add per-SLO rows
    const slos = db.prepare(`
      SELECT s.id, s.name, s.target_minutes,
        COUNT(t.id) as total,
        SUM(CASE WHEN t.breached = 0 AND t.completed_at IS NOT NULL THEN 1 ELSE 0 END) as met
      FROM calyx_slos s
      LEFT JOIN calyx_ticket_slo_tracking t ON t.slo_id = s.id AND t.started_at BETWEEN ? AND ?
      WHERE s.is_active = 1 GROUP BY s.id
    `).all(from30, now) as any[];

    for (const slo of slos) {
      const pct = slo.total > 0 ? Math.round(1000 * slo.met / slo.total) / 10 : 100;
      metrics.push({
        kpi: `Calyx SLO: ${slo.name}`,
        kpiGroup: 'Calyx SLOs',
        count: pct,
        target: 90,
        direction: 'Higher is better',
      });
    }

    // Upsert into Azure SQL
    const today = new Date().toISOString().slice(0, 10);

    for (const m of metrics) {
      const rag = computeRag(m.count, m.target, m.direction);
      const request = p.request();
      request.input('kpi', sql.NVarChar, m.kpi);
      request.input('kpiGroup', sql.NVarChar, m.kpiGroup);
      request.input('count', sql.Float, m.count);
      request.input('target', sql.Float, m.target);
      request.input('direction', sql.NVarChar, m.direction);
      request.input('rag', sql.Int, rag);
      request.input('date', sql.Date, today);

      await request.query(`
        MERGE dbo.jira_kpi_daily AS t
        USING (SELECT @date AS CreatedAt, @kpi AS kpi) AS s
        ON CAST(t.CreatedAt AS DATE) = s.CreatedAt AND t.kpi = s.kpi
        WHEN MATCHED THEN UPDATE SET
          kpiGroup = @kpiGroup,
          [count] = @count,
          target = @target,
          direction = @direction,
          rag = @rag
        WHEN NOT MATCHED THEN INSERT
          (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
        VALUES
          (@kpi, @kpiGroup, @count, @target, @direction, @rag, @date);
      `);
    }

    console.log(`[calyx-kpi-sync] Synced ${metrics.length} metrics to jira_kpi_daily`);
  } catch (err) {
    console.error('[calyx-kpi-sync] Error:', err instanceof Error ? err.message : err);
  }
}
