import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { queryOne } from '../services/database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { resolveFailedJobsAgent, runFailedJobsTicket, ukToday, dueMinuteOfDay, isTicketDay } from '../services/failed-jobs-ticket.js';

export function createFailedJobsRoutes(deps: {
  settings: SettingsQueries;
  getJiraClient: () => JiraRestClient | null;
}): Router {
  const router = Router();
  router.use(requireRole('admin'));

  /** Today's rota owner and ticket. Read-only — never moves the Grafana flag. */
  router.get('/status', async (_req, res) => {
    try {
      const date = ukToday();
      const log = await queryOne<{
        issue_key: string | null; agent_name: string | null; reassigned: boolean; note: string | null;
      }>(
        `SELECT issue_key, agent_name, reassigned, note FROM failed_jobs_ticket_log WHERE ticket_date = ?`,
        [date],
      );

      let owner: string | null = null;
      let wouldReassign = false;
      let ownerError: string | null = null;
      try {
        const resolved = await resolveFailedJobsAgent(deps.settings, date, { applyFlag: false });
        owner = resolved.agent?.displayName ?? null;
        wouldReassign = resolved.reassigned;
      } catch (err) {
        ownerError = err instanceof Error ? err.message : 'Could not read the agent roster';
      }

      const due = dueMinuteOfDay(deps.settings);
      res.json({
        ok: true,
        data: {
          date,
          enabled: deps.settings.get('failed_jobs_ticket_enabled') === 'true',
          isTicketDay: isTicketDay(deps.settings),
          dueTime: `${String(Math.floor(due / 60)).padStart(2, '0')}:${String(due % 60).padStart(2, '0')}`,
          owner,
          ownerError,
          wouldReassign,
          issueKey: log?.issue_key ?? null,
          ticketAgent: log?.agent_name ?? null,
          reassigned: !!log?.reassigned,
          note: log?.note ?? null,
        },
      });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  /** Raise today's ticket now. `force` raises a second one for a day already done. */
  router.post('/run', async (req, res) => {
    try {
      const result = await runFailedJobsTicket(deps.settings, deps.getJiraClient(), {
        force: req.body?.force === true,
      });
      res.json({ ok: result.ok, data: result, error: result.error ?? result.skipped });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  return router;
}
