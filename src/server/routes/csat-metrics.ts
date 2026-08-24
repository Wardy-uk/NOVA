import { Router, type Request, type Response } from 'express';
import { query } from '../services/database.js';

/** CSAT adoption + response instrumentation.
 *
 *  The experiment is not the CSAT score — it is whether agents run the macro.
 *  Adoption  = resolved tickets whose public comments contain a /portal/csat/ link ÷ resolved tickets.
 *  Response  = ratings received ÷ links sent.
 *  Reported per agent (by resolving assignee) and team-wide.
 *
 *  NOTE: `jira_issue_cache` has no dedicated resolutiondate column, so the resolved
 *  window uses `jira_updated` on Done tickets as a proxy. Good enough for a weekly
 *  adoption snapshot; not a precise resolved-in-range count.
 */
/** 60s response cache, keyed on the query string.
 *
 *  The NOVA database runs at or near 100% data IO for long stretches (the Jira
 *  sync MERGEs into a 1GB comment cache), so a query that costs milliseconds on
 *  an idle server can miss a 30s request timeout entirely. Adoption numbers move
 *  on a sync cadence, not per second — re-running this per tab switch buys
 *  nothing and competes with the sync for the I/O it is starved of.
 */
const cache = new Map<string, { at: number; body: unknown }>();
const CACHE_MS = 60_000;

/** Timeouts here are a busy database, not a bug in the request — say so, rather
 *  than showing the customer-facing screen a raw driver message. */
function failed(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : 'Failed to load CSAT metrics';
  const busy = /timeout/i.test(msg);
  res.status(busy ? 503 : 500).json({
    ok: false,
    error: busy
      ? 'The NOVA database is saturated right now (Jira sync I/O) and this query timed out. Try again in a minute.'
      : msg,
    busy,
  });
}

export function createCsatMetricsRoutes(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    const cacheKey = `metrics:${req.originalUrl}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      res.json(hit.body);
      return;
    }
    try {
      // Default window: last 7 days.
      const now = new Date();
      const to = req.query.to ? new Date(String(req.query.to)) : now;
      const from = req.query.from
        ? new Date(String(req.query.from))
        : new Date(now.getTime() - 7 * 86_400_000);
      // Exclusive upper bound at end of the given 'to' day.
      const toExclusive = new Date(to.getTime() + 86_400_000);

      const rows = await query<{
        agent: string;
        resolved: number;
        links_sent: number;
        ratings_received: number;
        avg_rating: number | null;
      }>(
        // Uses the has_csat_link flag (set at sync time, filtered-indexed) so we never
        // LIKE-scan comment bodies — that was a >90s full scan over 100k rows.
        `WITH resolved AS (
           SELECT c.issue_key, COALESCE(c.assignee_display, 'Unassigned') AS agent,
                  CASE WHEN EXISTS (
                    SELECT 1 FROM jira_comment_cache cc
                    WHERE cc.issue_key = c.issue_key
                      AND cc.is_public = 1
                      AND cc.has_csat_link = 1
                  ) THEN 1 ELSE 0 END AS has_link
           FROM jira_issue_cache c
           WHERE c.status_category = 'Done'
             AND c.jira_updated >= ? AND c.jira_updated < ?
         )
         SELECT r.agent,
                COUNT(*) AS resolved,
                SUM(r.has_link) AS links_sent,
                SUM(CASE WHEN s.jira_issue_key IS NOT NULL THEN 1 ELSE 0 END) AS ratings_received,
                AVG(CASE WHEN s.jira_issue_key IS NOT NULL THEN CAST(s.csat_score AS FLOAT) END) AS avg_rating
         FROM resolved r
         LEFT JOIN portal_csat_surveys s
                ON s.jira_issue_key = r.issue_key AND s.responded_at IS NOT NULL
         GROUP BY r.agent
         ORDER BY resolved DESC`,
        [from, toExclusive],
      );

      const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

      const agents = rows.map(r => ({
        agent: r.agent,
        resolved: r.resolved,
        linksSent: r.links_sent,
        adoptionPct: pct(r.links_sent, r.resolved),
        ratingsReceived: r.ratings_received,
        responsePct: pct(r.ratings_received, r.links_sent),
        avgRating: r.avg_rating != null ? Math.round(r.avg_rating * 100) / 100 : null,
      }));

      const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
      const totResolved = sum(r => r.resolved);
      const totLinks = sum(r => r.links_sent);
      const totRatings = sum(r => r.ratings_received);
      // Exact team average = Σ(agentAvg × ratings) / Σ(ratings).
      const weighted = rows.reduce((a, r) => a + (r.avg_rating != null ? r.avg_rating * r.ratings_received : 0), 0);

      const body = {
        ok: true,
        data: {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          team: {
            resolved: totResolved,
            linksSent: totLinks,
            adoptionPct: pct(totLinks, totResolved),
            ratingsReceived: totRatings,
            responsePct: pct(totRatings, totLinks),
            avgRating: totRatings > 0 ? Math.round((weighted / totRatings) * 100) / 100 : null,
          },
          agents,
        },
      };
      cache.set(cacheKey, { at: Date.now(), body });
      res.json(body);
    } catch (err) {
      failed(res, err);
    }
  });

  /** Individual ratings behind the tiles — one row per rated ticket.
   *
   *  Two windows, and they answer different questions, so the mode is explicit
   *  rather than guessed:
   *    mode=resolved (default) — ratings on tickets RESOLVED in the window. Same
   *      population as the tiles above, so the row count matches the Ratings tile.
   *    mode=rated — ratings RECEIVED in the window, whenever the ticket closed.
   *      A rating that lands three weeks after resolution is invisible in the
   *      first mode; it is real feedback and must be reachable somewhere.
   */
  router.get('/responses', async (req: Request, res: Response) => {
    const cacheKey = `responses:${req.originalUrl}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      res.json(hit.body);
      return;
    }
    try {
      const now = new Date();
      const to = req.query.to ? new Date(String(req.query.to)) : now;
      const from = req.query.from
        ? new Date(String(req.query.from))
        : new Date(now.getTime() - 7 * 86_400_000);
      const toExclusive = new Date(to.getTime() + 86_400_000);
      const mode = String(req.query.mode || 'resolved') === 'rated' ? 'rated' : 'resolved';
      const agent = req.query.agent ? String(req.query.agent) : null;
      // Bounded, and the bound is reported so a truncated list never reads as the whole population.
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

      const params: unknown[] = [];
      const where: string[] = ['s.responded_at IS NOT NULL'];
      if (mode === 'rated') {
        where.push('s.responded_at >= ? AND s.responded_at < ?');
        params.push(from, toExclusive);
      } else {
        where.push("c.status_category = 'Done' AND c.jira_updated >= ? AND c.jira_updated < ?");
        params.push(from, toExclusive);
      }
      if (agent) {
        where.push("COALESCE(c.assignee_display, 'Unassigned') = ?");
        params.push(agent);
      }

      const rows = await query<{
        issue_key: string;
        summary: string | null;
        agent: string;
        csat_score: number | null;
        first_csat_score: number | null;
        revision_count: number;
        comment: string | null;
        responded_at: string;
        ticket_status: string | null;
        ticket_resolved: boolean | number | null;
        ticket_age_hours: number | null;
      }>(
        `SELECT TOP (${limit})
                s.jira_issue_key AS issue_key,
                c.summary,
                COALESCE(c.assignee_display, 'Unassigned') AS agent,
                s.csat_score, s.first_csat_score, s.revision_count, s.comment,
                s.responded_at, s.ticket_status, s.ticket_resolved, s.ticket_age_hours
         FROM portal_csat_surveys s
         LEFT JOIN jira_issue_cache c ON c.issue_key = s.jira_issue_key
         WHERE ${where.join(' AND ')}
         ORDER BY s.responded_at DESC`,
        params,
      );

      const body = {
        ok: true,
        data: {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          mode,
          agent,
          limit,
          truncated: rows.length === limit,
          responses: rows.map(r => ({
            issueKey: r.issue_key,
            summary: r.summary || r.issue_key,
            agent: r.agent,
            score: r.csat_score,
            // Only meaningful when the customer actually changed their mind.
            firstScore: r.revision_count > 0 ? r.first_csat_score : null,
            revisionCount: r.revision_count,
            comment: r.comment,
            respondedAt: r.responded_at,
            ticketStatus: r.ticket_status,
            // Rated before the ticket closed — signal, not noise.
            ratedUnresolved: r.ticket_resolved === false || r.ticket_resolved === 0,
            ticketAgeHours: r.ticket_age_hours,
          })),
        },
      };
      cache.set(cacheKey, { at: Date.now(), body });
      res.json(body);
    } catch (err) {
      failed(res, err);
    }
  });

  return router;
}
