import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { queryOne, execute } from '../services/database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from '../services/jira-client.js';

interface CsatRouteDeps {
  settings: Pick<SettingsQueries, 'get'>;
  getJiraClient: () => JiraRestClient | null;
}

// A Jira issue key (NT-1234, NTPJ-55) vs the legacy 64-char hex token.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const isIssueKey = (v: string) => ISSUE_KEY_RE.test(v);

// ── Simple in-memory IP rate limiter ──
// Endpoint is public and issue keys are guessable, so cap how fast one IP can
// walk the range. Not distributed — good enough for a single-node deployment.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20;
const rlBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = rlBuckets.get(ip);
  if (!b || now > b.resetAt) {
    rlBuckets.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RL_MAX;
}

interface CachedTicket {
  summary: string | null;
  status_category: string | null;
  resolution_name: string | null;
  jira_updated: string | null;
  reporter_email: string | null;
  fields_json: string | null;
}

interface EligibleResult {
  ok: boolean;
  reason?: 'not_found' | 'not_resolved' | 'expired';
  ticket?: CachedTicket;
}

/** Look up a cached ticket and decide whether it is eligible for a CSAT rating:
 *  it must exist, be resolved, and have resolved within the accept window. */
async function loadEligibleTicket(
  issueKey: string,
  windowDays: number,
): Promise<EligibleResult> {
  const ticket = await queryOne<CachedTicket>(
    `SELECT summary, status_category, resolution_name, jira_updated, reporter_email, fields_json
     FROM jira_issue_cache WHERE issue_key = ?`,
    [issueKey],
  );
  if (!ticket) return { ok: false, reason: 'not_found' };

  const resolved = ticket.status_category === 'Done' || !!ticket.resolution_name;
  if (!resolved) return { ok: false, reason: 'not_resolved' };

  // Resolved-within-N-days: prefer Jira's resolutiondate, fall back to jira_updated.
  let resolvedAt: number | null = null;
  if (ticket.fields_json) {
    try {
      const rd = JSON.parse(ticket.fields_json)?.resolutiondate;
      if (rd) resolvedAt = new Date(rd).getTime();
    } catch { /* ignore malformed cache */ }
  }
  if (resolvedAt == null && ticket.jira_updated) resolvedAt = new Date(ticket.jira_updated).getTime();
  if (resolvedAt == null || Number.isNaN(resolvedAt)) return { ok: false, reason: 'expired' };

  const ageDays = (Date.now() - resolvedAt) / 86_400_000;
  if (ageDays > windowDays) return { ok: false, reason: 'expired' };

  return { ok: true, ticket };
}

export function createPortalCsatRoutes(deps: CsatRouteDeps): Router {
  const router = Router();

  const acceptWindowDays = () => {
    const n = Number(deps.settings.get('csat_accept_window_days'));
    return Number.isFinite(n) && n > 0 ? n : 14;
  };
  const clientIp = (req: Request) =>
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() || req.ip || 'unknown';

  // ── Public — look up survey by issue key (agent-macro flow) ──
  router.get('/:token', async (req: Request, res: Response) => {
    const param = String(req.params.token);
    if (rateLimited(clientIp(req))) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }

    try {
      if (isIssueKey(param)) {
        const issueKey = param.toUpperCase();

        // Already rated? First-write-wins — surface the completed state.
        const existing = await queryOne<{ responded_at: string | null }>(
          `SELECT responded_at FROM portal_csat_surveys WHERE jira_issue_key = ?`,
          [issueKey],
        );
        if (existing?.responded_at) {
          res.json({ ok: false, error: 'already_responded' });
          return;
        }

        const eligible = await loadEligibleTicket(issueKey, acceptWindowDays());
        if (!eligible.ok) {
          const code = eligible.reason === 'not_found' ? 404 : 200;
          res.status(code).json({ ok: false, error: eligible.reason === 'expired' ? 'expired' : 'not_found' });
          return;
        }

        res.json({
          ok: true,
          data: { ticketKey: issueKey, summary: eligible.ticket?.summary || issueKey },
        });
        return;
      }

      // ── Legacy token flow (back-compat) ──
      const row = await queryOne<{
        id: number;
        jira_issue_key: string;
        responded_at: string | null;
        expires_at: string;
      }>(
        `SELECT cs.id, cs.jira_issue_key, cs.responded_at, cs.expires_at
         FROM portal_csat_surveys cs WHERE cs.token = ?`,
        [param],
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

      const ticket = await queryOne<{ summary: string }>(
        `SELECT summary FROM jira_issue_cache WHERE issue_key = ?`,
        [row.jira_issue_key],
      );
      res.json({
        ok: true,
        data: { ticketKey: row.jira_issue_key, summary: ticket?.summary || row.jira_issue_key },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load survey' });
    }
  });

  // ── Public — submit survey response ──
  router.post('/:token', async (req: Request, res: Response) => {
    const param = String(req.params.token);
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }

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
      let surveyId: number;
      let issueKey: string;

      if (isIssueKey(param)) {
        issueKey = param.toUpperCase();

        // Guard: ticket must exist, be resolved, and be within the accept window.
        const eligible = await loadEligibleTicket(issueKey, acceptWindowDays());
        if (!eligible.ok) {
          const code = eligible.reason === 'not_found' ? 404 : 200;
          res.status(code).json({ ok: false, error: eligible.reason === 'expired' ? 'expired' : 'not_found' });
          return;
        }

        // First-write-wins per ticket. Log (don't overwrite) subsequent attempts.
        const existing = await queryOne<{ id: number; responded_at: string | null }>(
          `SELECT id, responded_at FROM portal_csat_surveys WHERE jira_issue_key = ?`,
          [issueKey],
        );
        if (existing?.responded_at) {
          console.log(`[csat] Duplicate rating attempt for ${issueKey} from ${ip} — ignored (first-write-wins)`);
          res.json({ ok: false, error: 'already_responded' });
          return;
        }

        if (existing) {
          surveyId = existing.id;
          await execute(
            `UPDATE portal_csat_surveys
             SET csat_score = ?, ease_score = ?, effort_score = ?, comment = ?, responded_at = GETUTCDATE()
             WHERE id = ?`,
            [csatScore, easeScore || null, effortScore || null, comment || null, surveyId],
          );
        } else {
          // Lazy row: agent-macro links have no pre-generated survey.
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + acceptWindowDays() * 86_400_000);
          const reporterEmail = eligible.ticket?.reporter_email ?? null;
          const user = reporterEmail
            ? await queryOne<{ id: number; org_id: number }>(
                `SELECT id, org_id FROM portal_users WHERE email = ?`,
                [reporterEmail],
              )
            : null;
          const inserted = await queryOne<{ id: number }>(
            `INSERT INTO portal_csat_surveys
               (token, jira_issue_key, portal_user_id, org_id, csat_score, ease_score, effort_score, comment, expires_at, responded_at)
             OUTPUT INSERTED.id
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE())`,
            [token, issueKey, user?.id ?? null, user?.org_id ?? null,
             csatScore, easeScore || null, effortScore || null, comment || null, expiresAt],
          );
          surveyId = inserted!.id;
        }
      } else {
        // ── Legacy token flow ──
        const row = await queryOne<{ id: number; jira_issue_key: string; responded_at: string | null; expires_at: string }>(
          `SELECT id, jira_issue_key, responded_at, expires_at FROM portal_csat_surveys WHERE token = ?`,
          [param],
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
        surveyId = row.id;
        issueKey = row.jira_issue_key;
        await execute(
          `UPDATE portal_csat_surveys
           SET csat_score = ?, ease_score = ?, effort_score = ?, comment = ?, responded_at = GETUTCDATE()
           WHERE id = ?`,
          [csatScore, easeScore || null, effortScore || null, comment || null, surveyId],
        );
      }

      // Mirror to a writable Jira field so legacy JQL/dashboards keep working.
      // Native Satisfaction (customfield_12802) is read-only via the API, so we
      // write a dedicated NOVA CSAT field configured in settings. Best-effort:
      // NOVA is the source of truth; never fail the customer's submission on this.
      await mirrorToJira(deps, issueKey, Number(csatScore), comment).catch(err =>
        console.warn(`[csat] Jira mirror write failed for ${issueKey}:`, err instanceof Error ? err.message : err),
      );

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to submit survey' });
    }
  });

  // ── Public — append an optional comment AFTER the rating has been banked ──
  // The page captures the rating on tap (first POST), then offers a comment box.
  // First-comment-wins, and only within a short grace window after responding.
  const COMMENT_GRACE_MS = 30 * 60_000;
  router.post('/:token/comment', async (req: Request, res: Response) => {
    const param = String(req.params.token);
    if (rateLimited(clientIp(req))) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!comment) {
      res.status(400).json({ ok: false, error: 'comment is required' });
      return;
    }

    try {
      const col = isIssueKey(param) ? 'jira_issue_key' : 'token';
      const value = isIssueKey(param) ? param.toUpperCase() : param;
      const row = await queryOne<{ id: number; jira_issue_key: string; responded_at: string | null; comment: string | null }>(
        `SELECT id, jira_issue_key, responded_at, comment FROM portal_csat_surveys WHERE ${col} = ?`,
        [value],
      );
      if (!row || !row.responded_at) {
        res.json({ ok: false, error: 'no_rating' });
        return;
      }
      if (row.comment) {
        res.json({ ok: false, error: 'already_commented' });
        return;
      }
      if (Date.now() - new Date(row.responded_at).getTime() > COMMENT_GRACE_MS) {
        res.json({ ok: false, error: 'expired' });
        return;
      }
      await execute(`UPDATE portal_csat_surveys SET comment = ? WHERE id = ?`, [comment, row.id]);

      // Mirror the comment into the Jira comment field if one is configured.
      const commentFieldId = deps.settings.get('csat_jira_mirror_comment_field');
      if (commentFieldId) {
        const client = deps.getJiraClient();
        if (client) {
          await client.updateFields(row.jira_issue_key, { [commentFieldId]: comment }).catch(err =>
            console.warn(`[csat] Jira comment mirror failed for ${row.jira_issue_key}:`, err instanceof Error ? err.message : err),
          );
        }
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to save comment' });
    }
  });

  return router;
}

/** Write the rating into a NOVA-owned, writable Jira custom field (number 1-5).
 *  Configured via `csat_jira_mirror_field` (e.g. "customfield_12805"); no-op if blank. */
async function mirrorToJira(
  deps: CsatRouteDeps,
  issueKey: string,
  score: number,
  comment: string | null | undefined,
): Promise<void> {
  const fieldId = deps.settings.get('csat_jira_mirror_field');
  if (!fieldId) return;
  const client = deps.getJiraClient();
  if (!client) return;

  const fields: Record<string, unknown> = { [fieldId]: score };
  const commentFieldId = deps.settings.get('csat_jira_mirror_comment_field');
  if (commentFieldId && comment) fields[commentFieldId] = comment;

  await client.updateFields(issueKey, fields);
  console.log(`[csat] Mirrored rating ${score} for ${issueKey} → ${fieldId}`);
}

// Helper to generate a CSAT survey for a resolved ticket (auto-poster / token flow).
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
