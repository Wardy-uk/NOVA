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
export function createCsatMetricsRoutes(): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
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

      res.json({
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
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to load CSAT metrics' });
    }
  });

  return router;
}
