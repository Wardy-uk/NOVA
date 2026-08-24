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
  status_name: string | null;
  status_category: string | null;
  resolution_name: string | null;
  jira_created: string | null;
  reporter_email: string | null;
  fields_json: string | null;
}

interface TicketContext {
  found: boolean;
  ticket?: CachedTicket;
  status: string | null;
  statusCategory: string | null;
  resolved: boolean;
  created: Date | null;
  resolvedAt: Date | null;
  ageHours: number | null;
}

/** Look up a cached ticket and snapshot its lifecycle context (state + age) at
 *  rating time. CSAT is accepted at ANY lifecycle point — the only gate is that
 *  the ticket must actually exist (so guessed keys can't bank junk ratings). The
 *  captured state/age turns "rated an unresolved ticket" into signal, not noise. */
async function loadTicketContext(issueKey: string): Promise<TicketContext> {
  const ticket = await queryOne<CachedTicket>(
    `SELECT summary, status_name, status_category, resolution_name, jira_created, reporter_email, fields_json
     FROM jira_issue_cache WHERE issue_key = ?`,
    [issueKey],
  );
  if (!ticket) {
    return { found: false, status: null, statusCategory: null, resolved: false, created: null, resolvedAt: null, ageHours: null };
  }

  const resolved = ticket.status_category === 'Done' || !!ticket.resolution_name;

  let resolvedAt: Date | null = null;
  if (ticket.fields_json) {
    try {
      const rd = JSON.parse(ticket.fields_json)?.resolutiondate;
      if (rd) resolvedAt = new Date(rd);
    } catch { /* ignore malformed cache */ }
  }

  const created = ticket.jira_created ? new Date(ticket.jira_created) : null;
  const ageHours = created && !Number.isNaN(created.getTime())
    ? Math.round((Date.now() - created.getTime()) / 3_600_000)
    : null;

  return {
    found: true,
    ticket,
    status: ticket.status_name,
    statusCategory: ticket.status_category,
    resolved,
    created: created && !Number.isNaN(created.getTime()) ? created : null,
    resolvedAt: resolvedAt && !Number.isNaN(resolvedAt.getTime()) ? resolvedAt : null,
    ageHours,
  };
}

export function createPortalCsatRoutes(deps: CsatRouteDeps): Router {
  const router = Router();

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

        // Already rated? Hand back the current rating so the page can prefill it —
        // opinions change and mis-taps happen, so re-rating is allowed.
        const existing = await queryOne<{ csat_score: number | null; comment: string | null; responded_at: string | null }>(
          `SELECT csat_score, comment, responded_at FROM portal_csat_surveys WHERE jira_issue_key = ?`,
          [issueKey],
        );

        // Only gate: the ticket must exist in cache. Rating is accepted at any state.
        const ctx = await loadTicketContext(issueKey);
        if (!ctx.found) {
          res.status(404).json({ ok: false, error: 'not_found' });
          return;
        }

        res.json({
          ok: true,
          data: {
            ticketKey: issueKey,
            summary: ctx.ticket?.summary || issueKey,
            existingRating: existing?.responded_at ? existing.csat_score : null,
            existingComment: existing?.responded_at ? existing.comment : null,
          },
        });
        return;
      }

      // ── Legacy token flow (back-compat) ──
      const row = await queryOne<{
        id: number;
        jira_issue_key: string;
        csat_score: number | null;
        comment: string | null;
        responded_at: string | null;
        expires_at: string;
      }>(
        `SELECT cs.id, cs.jira_issue_key, cs.csat_score, cs.comment, cs.responded_at, cs.expires_at
         FROM portal_csat_surveys cs WHERE cs.token = ?`,
        [param],
      );

      if (!row) {
        res.status(404).json({ ok: false, error: 'Survey not found' });
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
        data: {
          ticketKey: row.jira_issue_key,
          summary: ticket?.summary || row.jira_issue_key,
          existingRating: row.responded_at ? row.csat_score : null,
          existingComment: row.responded_at ? row.comment : null,
        },
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

        // Only gate: the ticket must exist. Rating accepted at any lifecycle point;
        // we snapshot its state + age so ratings become lifecycle signal.
        const ctx = await loadTicketContext(issueKey);
        if (!ctx.found) {
          res.status(404).json({ ok: false, error: 'not_found' });
          return;
        }

        // Latest-rating-wins per ticket: people change their mind, and a mis-tapped
        // star should be fixable. The original is preserved in first_* on re-rate.
        const existing = await queryOne<{ id: number; csat_score: number | null; responded_at: string | null }>(
          `SELECT id, csat_score, responded_at FROM portal_csat_surveys WHERE jira_issue_key = ?`,
          [issueKey],
        );

        if (existing) {
          surveyId = existing.id;
          const isRerate = !!existing.responded_at;
          await execute(
            `UPDATE portal_csat_surveys
             SET first_csat_score = COALESCE(first_csat_score, csat_score),
                 first_responded_at = COALESCE(first_responded_at, responded_at),
                 revision_count = revision_count + CASE WHEN responded_at IS NULL THEN 0 ELSE 1 END,
                 csat_score = ?,
                 ease_score = COALESCE(?, ease_score), effort_score = COALESCE(?, effort_score),
                 comment = COALESCE(?, comment), responded_at = GETUTCDATE(),
                 ticket_status = ?, ticket_status_category = ?, ticket_resolved = ?, ticket_created = ?, ticket_resolved_at = ?, ticket_age_hours = ?
             WHERE id = ?`,
            [csatScore, easeScore || null, effortScore || null, comment || null,
             ctx.status, ctx.statusCategory, ctx.resolved ? 1 : 0, ctx.created, ctx.resolvedAt, ctx.ageHours, surveyId],
          );
          if (isRerate) {
            console.log(`[csat] Re-rated ${issueKey}: ${existing.csat_score} → ${csatScore} (from ${ip})`);
          }
        } else {
          // Lazy row: agent-macro links have no pre-generated survey.
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 365 * 86_400_000);
          const reporterEmail = ctx.ticket?.reporter_email ?? null;
          const user = reporterEmail
            ? await queryOne<{ id: number; org_id: number }>(
                `SELECT id, org_id FROM portal_users WHERE email = ?`,
                [reporterEmail],
              )
            : null;
          const inserted = await queryOne<{ id: number }>(
            `INSERT INTO portal_csat_surveys
               (token, jira_issue_key, portal_user_id, org_id, csat_score, ease_score, effort_score, comment, expires_at, responded_at,
                ticket_status, ticket_status_category, ticket_resolved, ticket_created, ticket_resolved_at, ticket_age_hours)
             OUTPUT INSERTED.id
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE(), ?, ?, ?, ?, ?, ?)`,
            [token, issueKey, user?.id ?? null, user?.org_id ?? null,
             csatScore, easeScore || null, effortScore || null, comment || null, expiresAt,
             ctx.status, ctx.statusCategory, ctx.resolved ? 1 : 0, ctx.created, ctx.resolvedAt, ctx.ageHours],
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
        if (new Date(row.expires_at) < new Date()) {
          res.json({ ok: false, error: 'expired' });
          return;
        }
        surveyId = row.id;
        issueKey = row.jira_issue_key;
        // Latest-rating-wins here too — same reasoning as the issue-key flow.
        await execute(
          `UPDATE portal_csat_surveys
           SET first_csat_score = COALESCE(first_csat_score, csat_score),
               first_responded_at = COALESCE(first_responded_at, responded_at),
               revision_count = revision_count + CASE WHEN responded_at IS NULL THEN 0 ELSE 1 END,
               csat_score = ?,
               ease_score = COALESCE(?, ease_score), effort_score = COALESCE(?, effort_score),
               comment = COALESCE(?, comment), responded_at = GETUTCDATE()
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
  // A later comment replaces the earlier one, within a grace window after rating.
  // Grace runs from the latest rating, so a re-rate reopens the comment box.
  // 24h, not 30 minutes: people tap a star, get pulled away, and come back to the
  // open tab later — a comment is the whole reason to keep the page open, and the
  // rating is already banked, so refusing it loses the only qualitative signal we get.
  const COMMENT_GRACE_MS = 24 * 60 * 60_000;
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
      const row = await queryOne<{ id: number; jira_issue_key: string; csat_score: number | null; responded_at: string | null; comment: string | null }>(
        `SELECT id, jira_issue_key, csat_score, responded_at, comment FROM portal_csat_surveys WHERE ${col} = ?`,
        [value],
      );
      if (!row || !row.responded_at) {
        res.json({ ok: false, error: 'no_rating' });
        return;
      }
      // A revised comment replaces the previous one — the grace window below is
      // measured from the LATEST rating, so re-rating reopens it.
      if (Date.now() - new Date(row.responded_at).getTime() > COMMENT_GRACE_MS) {
        res.json({ ok: false, error: 'expired' });
        return;
      }
      // Store in NOVA (source of truth).
      await execute(`UPDATE portal_csat_surveys SET comment = ? WHERE id = ?`, [comment, row.id]);

      // Paste it onto the Jira ticket as an internal note so agents see the feedback
      // (internal — doesn't re-notify the customer). Best-effort; never fails the save.
      const client = deps.getJiraClient();
      if (client) {
        const rated = row.csat_score ? ` — rated ${row.csat_score}/5` : '';
        const noteText = `Customer CSAT feedback${rated}:\n${comment}`;
        await client.addComment(row.jira_issue_key, noteText, { internal: true }).catch(err =>
          console.warn(`[csat] Jira comment post failed for ${row.jira_issue_key}:`, err instanceof Error ? err.message : err),
        );
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
