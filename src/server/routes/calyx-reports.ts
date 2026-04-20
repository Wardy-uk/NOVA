import { Router } from 'express';
import type Database from 'better-sqlite3';

export function createCalyxReportRoutes(db: Database.Database): Router {
  const router = Router();

  function dateRange(req: any): { from: string; to: string } {
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const from = (req.query.from as string) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    return { from: from + ' 00:00:00', to: to + ' 23:59:59' };
  }

  // ── SLA Compliance ──
  router.get('/reports/sla-compliance', (req, res) => {
    try {
      const { from, to } = dateRange(req);
      const teamId = req.query.team_id as string | undefined;

      let where = 'WHERE t.created_at BETWEEN ? AND ?';
      const params: any[] = [from, to];
      if (teamId) { where += ' AND t.team_id = ?'; params.push(teamId); }

      const row = db.prepare(`
        SELECT
          COUNT(*) as total_tickets,
          SUM(CASE WHEN t.frt_met_at IS NOT NULL AND t.frt_met_at <= t.frt_due_at THEN 1 ELSE 0 END) as frt_met,
          SUM(CASE WHEN t.frt_met_at IS NOT NULL AND t.frt_met_at > t.frt_due_at THEN 1 ELSE 0 END) as frt_breached,
          SUM(CASE WHEN t.resolved_at IS NOT NULL AND t.resolution_due_at IS NOT NULL AND t.resolved_at <= t.resolution_due_at THEN 1 ELSE 0 END) as resolution_met,
          SUM(CASE WHEN t.resolved_at IS NOT NULL AND t.resolution_due_at IS NOT NULL AND t.resolved_at > t.resolution_due_at THEN 1 ELSE 0 END) as resolution_breached,
          ROUND(AVG(CASE WHEN t.resolved_at IS NOT NULL THEN
            (julianday(t.resolved_at) - julianday(t.created_at)) * 24
          END), 1) as avg_resolution_hours
        FROM calyx_tickets t ${where}
      `).get(...params) as any;

      const total = row.total_tickets || 0;
      const frtMet = row.frt_met || 0;
      const resMet = row.resolution_met || 0;

      res.json({
        ok: true,
        data: {
          total_tickets: total,
          frt_met: frtMet,
          frt_compliance_pct: total > 0 ? Math.round(1000 * frtMet / total) / 10 : 0,
          frt_breached: row.frt_breached || 0,
          resolution_met: resMet,
          resolution_compliance_pct: total > 0 ? Math.round(1000 * resMet / total) / 10 : 0,
          resolution_breached: row.resolution_breached || 0,
          avg_resolution_hours: row.avg_resolution_hours || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── SLO Compliance ──
  router.get('/reports/slo-compliance', (req, res) => {
    try {
      const { from, to } = dateRange(req);

      const rows = db.prepare(`
        SELECT s.id, s.name, s.metric_type, s.target_minutes,
          COUNT(t.id) as total,
          SUM(CASE WHEN t.breached = 0 AND t.completed_at IS NOT NULL THEN 1 ELSE 0 END) as met,
          SUM(CASE WHEN t.breached = 1 THEN 1 ELSE 0 END) as breached,
          ROUND(100.0 * SUM(CASE WHEN t.breached = 0 AND t.completed_at IS NOT NULL THEN 1 ELSE 0 END)
                / NULLIF(COUNT(t.id), 0), 1) as compliance_pct,
          ROUND(AVG(CASE WHEN t.breached = 1 THEN t.breach_minutes END), 0) as avg_breach_mins
        FROM calyx_slos s
        LEFT JOIN calyx_ticket_slo_tracking t ON t.slo_id = s.id
          AND t.started_at BETWEEN ? AND ?
        WHERE s.is_active = 1
        GROUP BY s.id ORDER BY compliance_pct ASC
      `).all(from, to);

      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── Volume Trends ──
  router.get('/reports/volume', (req, res) => {
    try {
      const { from, to } = dateRange(req);

      const daily = db.prepare(`
        SELECT date(created_at) as period,
          COUNT(*) as created,
          SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) as resolved
        FROM calyx_tickets
        WHERE created_at BETWEEN ? AND ?
        GROUP BY date(created_at) ORDER BY period ASC
      `).all(from, to);

      const byTeam = db.prepare(`
        SELECT tm.name as team, COUNT(*) as count
        FROM calyx_tickets t JOIN calyx_teams tm ON tm.id = t.team_id
        WHERE t.created_at BETWEEN ? AND ?
        GROUP BY t.team_id ORDER BY count DESC
      `).all(from, to);

      const byCategory = db.prepare(`
        SELECT COALESCE(c.name, 'Uncategorised') as category, COUNT(*) as count
        FROM calyx_tickets t LEFT JOIN calyx_categories c ON c.id = t.category_id
        WHERE t.created_at BETWEEN ? AND ?
        GROUP BY t.category_id ORDER BY count DESC
      `).all(from, to);

      const byPriority = db.prepare(`
        SELECT priority, COUNT(*) as count
        FROM calyx_tickets
        WHERE created_at BETWEEN ? AND ?
        GROUP BY priority ORDER BY priority ASC
      `).all(from, to);

      res.json({ ok: true, data: { daily, by_team: byTeam, by_category: byCategory, by_priority: byPriority } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── FCR Rate ──
  router.get('/reports/fcr', (req, res) => {
    try {
      const { from, to } = dateRange(req);
      const teamId = req.query.team_id as string | undefined;

      let where = "WHERE status IN ('resolved','closed') AND created_at BETWEEN ? AND ?";
      const params: any[] = [from, to];
      if (teamId) { where += ' AND team_id = ?'; params.push(teamId); }

      const row = db.prepare(`
        SELECT
          COUNT(*) as total_resolved,
          SUM(CASE WHEN id NOT IN (
            SELECT DISTINCT ticket_id FROM calyx_ticket_events WHERE event_type = 'escalated'
          ) THEN 1 ELSE 0 END) as resolved_first_contact
        FROM calyx_tickets ${where}
      `).get(...params) as any;

      const total = row.total_resolved || 0;
      const fcr = row.resolved_first_contact || 0;

      res.json({
        ok: true,
        data: {
          total_resolved: total,
          resolved_first_contact: fcr,
          fcr_pct: total > 0 ? Math.round(1000 * fcr / total) / 10 : 0,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── Watermelon Report ──
  router.get('/reports/watermelon', (req, res) => {
    try {
      const { from, to } = dateRange(req);

      // SLA compliance
      const sla = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN frt_met_at IS NOT NULL AND frt_due_at IS NOT NULL AND frt_met_at <= frt_due_at THEN 1 ELSE 0 END) as frt_met,
          SUM(CASE WHEN resolved_at IS NOT NULL AND resolution_due_at IS NOT NULL AND resolved_at <= resolution_due_at THEN 1 ELSE 0 END) as res_met
        FROM calyx_tickets WHERE created_at BETWEEN ? AND ?
      `).get(from, to) as any;

      const total = sla.total || 0;
      const frtPct = total > 0 ? Math.round(1000 * (sla.frt_met || 0) / total) / 10 : 0;
      const resPct = total > 0 ? Math.round(1000 * (sla.res_met || 0) / total) / 10 : 0;

      // CSAT
      const csat = db.prepare(`
        SELECT
          AVG(csat_score) as csat_avg,
          AVG(xla_score) as xla_avg,
          COUNT(responded_at) as responded,
          COUNT(*) as sent,
          SUM(CASE WHEN csat_score = 1 THEN 1 ELSE 0 END) as s1,
          SUM(CASE WHEN csat_score = 2 THEN 1 ELSE 0 END) as s2,
          SUM(CASE WHEN csat_score = 3 THEN 1 ELSE 0 END) as s3,
          SUM(CASE WHEN csat_score = 4 THEN 1 ELSE 0 END) as s4,
          SUM(CASE WHEN csat_score = 5 THEN 1 ELSE 0 END) as s5
        FROM calyx_csat_surveys WHERE sent_at BETWEEN ? AND ?
      `).get(from, to) as any;

      const csatAvg = csat.csat_avg ? Math.round(csat.csat_avg * 10) / 10 : null;
      const xlaAvg = csat.xla_avg ? Math.round(csat.xla_avg * 10) / 10 : null;

      // RAG thresholds
      const slaRag = frtPct >= 85 && resPct >= 85 ? 'green' : frtPct >= 70 && resPct >= 70 ? 'amber' : 'red';
      const csatRag = csatAvg === null ? 'grey' : csatAvg >= 4.0 ? 'green' : csatAvg >= 3.0 ? 'amber' : 'red';

      const watermelon = slaRag === 'green' && (csatRag === 'amber' || csatRag === 'red');

      // Monthly trend (last 6 months)
      const trend = db.prepare(`
        SELECT strftime('%Y-%m', t.created_at) as period,
          ROUND(100.0 * SUM(CASE WHEN t.frt_met_at IS NOT NULL AND t.frt_due_at IS NOT NULL AND t.frt_met_at <= t.frt_due_at THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) as sla_pct,
          ROUND(AVG(cs.csat_score), 1) as csat_avg
        FROM calyx_tickets t
        LEFT JOIN calyx_csat_surveys cs ON cs.ticket_id = t.id AND cs.responded_at IS NOT NULL
        WHERE t.created_at >= date('now', '-6 months')
        GROUP BY period ORDER BY period ASC
      `).all();

      res.json({
        ok: true,
        data: {
          sla_frt_pct: frtPct,
          sla_resolution_pct: resPct,
          sla_rag: slaRag,
          csat_avg: csatAvg,
          xla_avg: xlaAvg,
          csat_rag: csatRag,
          watermelon,
          watermelon_message: watermelon ? 'SLA targets are being met but customer satisfaction is below target' : null,
          csat_response_rate_pct: csat.sent > 0 ? Math.round(1000 * csat.responded / csat.sent) / 10 : 0,
          csat_by_score: { '1': csat.s1 || 0, '2': csat.s2 || 0, '3': csat.s3 || 0, '4': csat.s4 || 0, '5': csat.s5 || 0 },
          trend,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── Shift-Left (Escalation Rates) ──
  router.get('/reports/shift-left', (req, res) => {
    try {
      const { from, to } = dateRange(req);

      const totalTickets = (db.prepare(
        'SELECT COUNT(*) as n FROM calyx_tickets WHERE created_at BETWEEN ? AND ?'
      ).get(from, to) as any).n || 1;

      const rows = db.prepare(`
        SELECT te.to_value as escalated_to_team, COUNT(*) as escalation_count,
          ROUND(100.0 * COUNT(*) / ?, 1) as escalation_rate_pct
        FROM calyx_ticket_events te
        WHERE te.event_type = 'escalated' AND te.created_at BETWEEN ? AND ?
        GROUP BY te.to_value
      `).all(totalTickets, from, to);

      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── Agent Performance ──
  router.get('/reports/agent-performance', (req, res) => {
    try {
      const { from, to } = dateRange(req);
      const teamId = req.query.team_id as string | undefined;

      let where = 'WHERE t.created_at BETWEEN ? AND ?';
      const params: any[] = [from, to];
      if (teamId) { where += ' AND t.team_id = ?'; params.push(teamId); }

      const rows = db.prepare(`
        SELECT
          a.id as agent_id, a.display_name,
          COUNT(t.id) as tickets_handled,
          SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END) as resolved,
          ROUND(AVG(cs.csat_score), 1) as avg_csat,
          ROUND(AVG(cs.xla_score), 1) as avg_xla,
          ROUND(100.0 * SUM(CASE WHEN t.resolved_at IS NOT NULL AND t.resolution_due_at IS NOT NULL AND t.resolved_at <= t.resolution_due_at THEN 1 ELSE 0 END)
                / NULLIF(COUNT(t.id), 0), 1) as sla_compliance_pct,
          ROUND(100.0 * SUM(CASE WHEN t.status IN ('resolved','closed') AND t.id NOT IN (
            SELECT DISTINCT ticket_id FROM calyx_ticket_events WHERE event_type = 'escalated'
          ) THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END), 0), 1) as fcr_pct
        FROM calyx_agents a
        LEFT JOIN calyx_tickets t ON t.assigned_agent_id = a.id AND t.created_at BETWEEN ? AND ?
        LEFT JOIN calyx_csat_surveys cs ON cs.ticket_id = t.id AND cs.responded_at IS NOT NULL
        ${teamId ? 'WHERE t.team_id = ?' : ''}
        GROUP BY a.id ORDER BY tickets_handled DESC
      `).all(...params, ...params, ...(teamId ? [teamId] : []));

      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  // ── Service Review Pack ──
  router.get('/reports/service-review', (req, res) => {
    try {
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const month = parseInt(req.query.month as string) || (new Date().getMonth() + 1);
      const from = `${year}-${String(month).padStart(2, '0')}-01 00:00:00`;
      const toDate = new Date(year, month, 0); // last day of month
      const to = `${year}-${String(month).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')} 23:59:59`;
      const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

      // Executive summary
      const exec = db.prepare(`
        SELECT
          COUNT(*) as total_tickets,
          SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) as open_count
        FROM calyx_tickets WHERE created_at BETWEEN ? AND ?
      `).get(from, to) as any;

      const slaRow = db.prepare(`
        SELECT
          ROUND(100.0 * SUM(CASE WHEN frt_met_at IS NOT NULL AND frt_due_at IS NOT NULL AND frt_met_at <= frt_due_at THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) as frt_pct,
          ROUND(100.0 * SUM(CASE WHEN resolved_at IS NOT NULL AND resolution_due_at IS NOT NULL AND resolved_at <= resolution_due_at THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) as res_pct
        FROM calyx_tickets WHERE created_at BETWEEN ? AND ?
      `).get(from, to) as any;

      const csatRow = db.prepare(`
        SELECT ROUND(AVG(csat_score), 1) as avg FROM calyx_csat_surveys WHERE sent_at BETWEEN ? AND ? AND responded_at IS NOT NULL
      `).get(from, to) as any;

      const frtPct = slaRow.frt_pct || 0;
      const resPct = slaRow.res_pct || 0;
      const csatAvg = csatRow.avg || 0;
      const slaGreen = frtPct >= 85 && resPct >= 85;
      const csatGreen = csatAvg >= 4.0;

      // SLO compliance
      const sloCompliance = db.prepare(`
        SELECT s.name, s.metric_type, s.target_minutes,
          COUNT(t.id) as total,
          SUM(CASE WHEN t.breached = 0 AND t.completed_at IS NOT NULL THEN 1 ELSE 0 END) as met,
          ROUND(100.0 * SUM(CASE WHEN t.breached = 0 AND t.completed_at IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(t.id), 0), 1) as compliance_pct
        FROM calyx_slos s
        LEFT JOIN calyx_ticket_slo_tracking t ON t.slo_id = s.id AND t.started_at BETWEEN ? AND ?
        WHERE s.is_active = 1 GROUP BY s.id
      `).all(from, to);

      // Volume by week
      const volumeByWeek = db.prepare(`
        SELECT strftime('%W', created_at) as week_num,
          MIN(date(created_at)) as week_start,
          COUNT(*) as created,
          SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) as resolved
        FROM calyx_tickets WHERE created_at BETWEEN ? AND ?
        GROUP BY week_num ORDER BY week_num ASC
      `).all(from, to);

      // Top categories
      const topCategories = db.prepare(`
        SELECT COALESCE(c.name, 'Uncategorised') as category, COUNT(*) as count
        FROM calyx_tickets t LEFT JOIN calyx_categories c ON c.id = t.category_id
        WHERE t.created_at BETWEEN ? AND ?
        GROUP BY t.category_id ORDER BY count DESC LIMIT 10
      `).all(from, to);

      // Escalation summary
      const escalations = db.prepare(`
        SELECT te.to_value as team, COUNT(*) as count
        FROM calyx_ticket_events te
        WHERE te.event_type = 'escalated' AND te.created_at BETWEEN ? AND ?
        GROUP BY te.to_value
      `).all(from, to);

      // Agent performance
      const agents = db.prepare(`
        SELECT a.display_name,
          COUNT(t.id) as tickets,
          ROUND(AVG(cs.csat_score), 1) as avg_csat,
          ROUND(100.0 * SUM(CASE WHEN t.resolved_at IS NOT NULL AND t.resolution_due_at IS NOT NULL AND t.resolved_at <= t.resolution_due_at THEN 1 ELSE 0 END)
                / NULLIF(COUNT(t.id), 0), 1) as sla_pct
        FROM calyx_agents a
        LEFT JOIN calyx_tickets t ON t.assigned_agent_id = a.id AND t.created_at BETWEEN ? AND ?
        LEFT JOIN calyx_csat_surveys cs ON cs.ticket_id = t.id AND cs.responded_at IS NOT NULL
        GROUP BY a.id HAVING tickets > 0 ORDER BY tickets DESC
      `).all(from, to);

      // Open problems
      const problems = db.prepare(`
        SELECT reference, title, status FROM calyx_problems WHERE status NOT IN ('resolved','closed')
      `).all();

      // Completed improvements this month
      const improvements = db.prepare(`
        SELECT reference, title FROM calyx_improvements WHERE status = 'complete' AND updated_at BETWEEN ? AND ?
      `).all(from, to);

      // Major incidents
      const incidents = db.prepare(`
        SELECT title, declared_at, resolved_at, impact_statement FROM calyx_major_incidents WHERE declared_at BETWEEN ? AND ?
      `).all(from, to);

      res.json({
        ok: true,
        data: {
          period: `${monthNames[month - 1]} ${year}`,
          generated_at: new Date().toISOString(),
          executive_summary: {
            total_tickets: exec.total_tickets || 0,
            resolved: exec.resolved || 0,
            open: exec.open_count || 0,
            sla_frt_pct: frtPct,
            sla_resolution_pct: resPct,
            csat_avg: csatAvg,
            watermelon: slaGreen && !csatGreen,
          },
          sla_compliance: { frt_pct: frtPct, resolution_pct: resPct },
          slo_compliance: sloCompliance,
          volume_by_week: volumeByWeek,
          top_categories: topCategories,
          escalation_summary: escalations,
          agent_performance: agents,
          open_problems: problems,
          completed_improvements: improvements,
          major_incidents: incidents,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' });
    }
  });

  return router;
}
