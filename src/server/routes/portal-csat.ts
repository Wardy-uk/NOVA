import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { queryOne, execute } from '../services/database.js';

export function createPortalCsatRoutes(): Router {
  const router = Router();

  // Public — look up survey by token
  router.get('/:token', async (req: Request, res: Response) => {
    try {
      const row = await queryOne<{
        id: number;
        jira_issue_key: string;
        responded_at: string | null;
        expires_at: string;
      }>(
        `SELECT cs.id, cs.jira_issue_key, cs.responded_at, cs.expires_at
         FROM portal_csat_surveys cs WHERE cs.token = ?`,
        [req.params.token],
      );

      if (!row) {
        res.status(404).json({ ok: false, error: 'Survey not found' });
        return;
      }

      if (row.responded_at) {
        res.json({ ok: false, error: 'already_responded' });
        return;
      }

      if (new Date(row.expires_at) < new Date()) {
        res.json({ ok: false, error: 'expired' });
        return;
      }

      // Get ticket summary from jira_issue_cache
      const ticket = await queryOne<{ summary: string }>(
        `SELECT summary FROM jira_issue_cache WHERE issue_key = ?`,
        [row.jira_issue_key],
      );

      res.json({
        ok: true,
        data: {
          ticketKey: row.jira_issue_key,
          summary: ticket?.summary || row.jira_issue_key,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load survey' });
    }
  });

  // Public — submit survey response
  router.post('/:token', async (req: Request, res: Response) => {
    const { csatScore, easeScore, effortScore, comment } = req.body;

    // Validate scores 1-5
    for (const [name, val] of [['csatScore', csatScore], ['easeScore', easeScore], ['effortScore', effortScore]] as const) {
      if (val !== undefined && val !== null) {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          res.status(400).json({ ok: false, error: `${name} must be 1-5` });
          return;
        }
      }
    }

    if (!csatScore) {
      res.status(400).json({ ok: false, error: 'csatScore is required (1-5)' });
      return;
    }

    try {
      const row = await queryOne<{ id: number; responded_at: string | null; expires_at: string }>(
        `SELECT id, responded_at, expires_at FROM portal_csat_surveys WHERE token = ?`,
        [req.params.token],
      );

      if (!row) {
        res.status(404).json({ ok: false, error: 'Survey not found' });
        return;
      }

      if (row.responded_at) {
        res.json({ ok: false, error: 'already_responded' });
        return;
      }

      if (new Date(row.expires_at) < new Date()) {
        res.json({ ok: false, error: 'expired' });
        return;
      }

      await execute(
        `UPDATE portal_csat_surveys
         SET csat_score = ?, ease_score = ?, effort_score = ?, comment = ?, responded_at = GETUTCDATE()
         WHERE id = ?`,
        [csatScore, easeScore || null, effortScore || null, comment || null, row.id],
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit survey' });
    }
  });

  return router;
}

// Helper to generate a CSAT survey for a resolved ticket
export async function generateCsatSurvey(
  jiraIssueKey: string,
  reporterEmail: string | null,
): Promise<string | null> {
  // Link to a portal user if one happens to exist for this reporter, but don't
  // require it — the survey link is posted on the ticket itself, so it works for
  // any resolved ticket regardless of whether the reporter uses the portal.
  const user = reporterEmail
    ? await queryOne<{ id: number; org_id: number }>(
        `SELECT id, org_id FROM portal_users WHERE email = ?`,
        [reporterEmail],
      )
    : null;

  // Check if a survey already exists for this ticket
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM portal_csat_surveys WHERE jira_issue_key = ?`,
    [jiraIssueKey],
  );
  if (existing) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await execute(
    `INSERT INTO portal_csat_surveys (token, jira_issue_key, portal_user_id, org_id, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, jiraIssueKey, user?.id ?? null, user?.org_id ?? null, expiresAt],
  );

  console.log(`[csat] Survey generated for ${jiraIssueKey} → /portal/csat/${token}`);
  return token;
}
