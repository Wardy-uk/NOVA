import { Router } from 'express';
import { query } from '../services/database.js';
import { requireRole } from '../middleware/auth.js';

/**
 * Warning signals, in one place, for someone deciding where to look.
 *
 * NOVA already produced almost all of this and nobody saw any of it. Over 18-19 Sep 2026 the
 * risk scorer had been dead for three and a half weeks, proactive SLA management had never run
 * once, the incident scan had been failing on invalid SQL every fifteen minutes since it
 * shipped, and 26 P1 cancellations hit an empty assignment pool with nothing raised. Each was
 * found by reading logs or querying tables directly. None of it was on a screen.
 *
 * So the rule here: every section answers "is something going wrong right now, and where",
 * and each carries enough context to act without opening Jira first. Sections fail
 * independently — on a bad day this page is exactly what you cannot afford to lose wholesale,
 * and a section that cannot be read says so rather than rendering an empty list as calm.
 */
export function createManagementSignalsRoutes(): Router {
  const router = Router();
  router.use(requireRole('admin', 'super_admin', 'editor'));

  router.get('/', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 7, 90);
    const out: Record<string, unknown> = { generatedAt: new Date().toISOString(), days };

    const section = async <T>(name: string, fn: () => Promise<T>) => {
      try {
        out[name] = { ok: true, data: await fn(), error: null };
      } catch (err) {
        out[name] = { ok: false, data: null, error: err instanceof Error ? err.message : 'Query failed' };
      }
    };

    // Tickets forecast to escalate that have not escalated yet — the point of the predictor.
    await section('escalationRisk', () => query(
      `SELECT TOP 25 p.ticket_key, p.probability, p.reasoning, p.predicted_at,
              c.summary, c.status_name, c.assignee_display, c.priority_name
       FROM agent_escalation_predictions p
       LEFT JOIN jira_issue_cache c ON c.issue_key = p.ticket_key
       WHERE p.actual_outcome IS NULL
         AND p.predicted_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY p.probability DESC`, [days]));

    // Does the forecast deserve to be believed? Shown next to it on purpose.
    await section('predictionAccuracy', () => query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN actual_outcome IS NULL THEN 1 ELSE 0 END) AS pending
       FROM agent_escalation_predictions
       WHERE predicted_at >= DATEADD(day, -?, GETUTCDATE())`, [days]));

    // Reactive counterpart to the above: what the risk scorer has flagged and nobody cleared.
    await section('flaggedTickets', () => query(
      `SELECT TOP 25 f.ticket_key, f.risk_score, f.summary, f.assignee, f.flagged_at
       FROM agent_flagged_tickets f
       WHERE f.flagged_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY f.risk_score DESC`, [days]));

    // The FRT safety net's fire rate IS the health metric. Every ack stops the SLA clock, so
    // a busy net makes First Reply Time read green precisely when the reply pipeline is
    // failing — the number that should raise the alarm becomes the one hiding it.
    await section('safetyNetAcks', () => query(
      `SELECT CAST(acked_at AS DATE) AS day,
              COUNT(*) AS total,
              SUM(CASE WHEN machine_raised = 1 THEN 1 ELSE 0 END) AS machine,
              SUM(CASE WHEN machine_raised = 0 THEN 1 ELSE 0 END) AS customer
       FROM frt_ack_log
       WHERE acked_at >= DATEADD(day, -?, GETUTCDATE())
       GROUP BY CAST(acked_at AS DATE) ORDER BY day DESC`, [days]));

    // Tickets NOVA could not hand to anyone. 26 of these on a Saturday morning was the whole
    // incident; each one was a P1 with billing exposure and nobody knew.
    await section('assignmentFailures', () => query(
      `SELECT TOP 25 ticket_key, pool, project_key, last_error, created_at, retry_count
       FROM assignment_retry_queue
       WHERE resolved = 0
       ORDER BY created_at DESC`, []));

    // Proactive SLA work. Empty here for months meant "never ran", not "nothing at risk".
    await section('slaInterventions', () => query(
      `SELECT TOP 25 ticket_key, sla_type, minutes_remaining, intervention_type, created_at
       FROM agent_sla_interventions
       WHERE created_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY created_at DESC`, [days]));

    // Clusters suggesting one underlying fault rather than N unrelated tickets.
    await section('incidents', () => query(
      `SELECT TOP 10 incident_key, summary, ticket_count, detected_at
       FROM agent_incidents
       WHERE detected_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY detected_at DESC`, [days]));

    // What NOVA itself could not do. This is where a silently failing feature shows up first.
    await section('agentErrors', () => query(
      `SELECT TOP 20 source, severity, message, occurred_at
       FROM error_log
       WHERE occurred_at >= DATEADD(day, -?, GETUTCDATE())
         AND resolved = 0
       ORDER BY occurred_at DESC`, [days]));

    res.json({ ok: true, data: out });
  });

  return router;
}
