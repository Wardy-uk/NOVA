import { Router, type Request, type Response } from 'express';
import type { DevReviewQueries } from '../db/dev-review-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { FileUserQueries } from '../db/user-store.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { TeamQueries } from '../db/queries.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { isAdmin } from '../utils/role-helpers.js';

/**
 * Dev Review Queue routes.
 *
 * The "queue" is a live JQL query: tickets in project NT where CurrentTier = Tier 3.
 * NOVA overlays a thin state layer (dev_review_state) for claims, fast-track flag,
 * internal priority, and an append-only comment thread that syncs as internal
 * Jira comments tagged with the developer's name.
 *
 * Accept  → Jira transition dev_review_accept_transition_id (default 141 = Escalate to Development)
 * Return  → Jira transition dev_review_return_transition_id (default updateFields to Tier 2)
 *         + required next-steps comment + reassign to original submitter
 */

// Custom field IDs — documented in memory/jira-nt-field-ids.md
const CF_CURRENT_TIER = 'customfield_12981';
const CF_TLDR = 'customfield_13184';
const CF_AGENT_SUMMARY = 'customfield_13185';
const CF_TROUBLESHOOTING = 'customfield_13212';
const CF_ESCALATION_REASON = 'customfield_13186';
const CF_EXPECTED_OUTCOME = 'customfield_13214';
const CF_ISSUE_ENVIRONMENT = 'customfield_13213';
const CF_NURTUR_PRODUCT = 'customfield_13183';
const CF_DEVELOPMENT_DETAILS = 'customfield_13215';

// Tier 3 option id for CurrentTier
const TIER_ID_T3 = '13063';
const TIER_ID_T2 = '13062';

/** Map a Jira Nurtur Product value to a Dev Team bucket. All TPJ variants
 *  collapse into a single "TPJ" bucket. Unknown products pass through as-is;
 *  null/undefined → 'Unassigned'. */
export function productToTeam(product: string | null | undefined): string {
  if (!product) return 'Unassigned';
  if (product.startsWith('The Property Jungle')) return 'TPJ';
  return product;
}

/** Build an ADF doc from plain text — Jira Cloud rich text fields require this. */
function adfDoc(text: string): object {
  const paragraphs = text.split(/\n\n+/).map((para) => ({
    type: 'paragraph',
    content: para
      ? para.split('\n').flatMap((line, i, arr) => {
          const out: object[] = [{ type: 'text', text: line }];
          if (i < arr.length - 1) out.push({ type: 'hardBreak' });
          return out;
        })
      : [],
  }));
  return { type: 'doc', version: 1, content: paragraphs };
}

export function createDevReviewRoutes(
  devQueries: DevReviewQueries,
  settingsQueries: SettingsQueries,
  userQueries: FileUserQueries,
  notificationQueries: NotificationQueries,
  teamQueries: TeamQueries,
  getJiraClient: () => JiraRestClient | null,
): Router {
  const router = Router();

  // Auto-discover transition IDs per target status, cached in-memory for the
  // life of the server process. Falls back to the setting override if set.
  const transitionCache = new Map<string, string>();
  async function resolveTransitionId(
    client: JiraRestClient,
    sampleKey: string,
    targetStatusName: string,
    overrideSettingKey?: string,
  ): Promise<string | null> {
    if (overrideSettingKey) {
      const s = settingsQueries.getAll();
      const override = s[overrideSettingKey];
      if (override) return String(override);
    }
    const cached = transitionCache.get(targetStatusName.toLowerCase());
    if (cached) return cached;
    try {
      const meta = await client.getTransitionsWithFields(sampleKey) as { transitions?: Array<{ id: string; name?: string; to?: { name?: string } }> };
      const transitions = meta.transitions || [];
      const want = targetStatusName.toLowerCase();
      const match = transitions.find((t) =>
        (t.name || '').toLowerCase().includes(want) ||
        (t.to?.name || '').toLowerCase() === want,
      );
      if (match) {
        transitionCache.set(want, match.id);
        return match.id;
      }
    } catch { /* fall through */ }
    return null;
  }

  // Gate: developer role or admin
  router.use((req: Request, res: Response, next) => {
    const u = req.user;
    if (!u) { res.status(401).json({ ok: false, error: 'Unauthorized' }); return; }
    const roles = u.role?.split(',').map((r) => r.trim()) ?? [];
    if (!roles.includes('admin') && !roles.includes('developer')) {
      res.status(403).json({ ok: false, error: 'Developer role required' });
      return;
    }
    next();
  });

  const userDisplay = (req: Request): string => {
    if (!req.user) return 'Unknown';
    const u = userQueries.getById(req.user.id);
    return u?.display_name || u?.username || req.user.username || 'Unknown';
  };

  // ── Queue listing (live JQL + state overlay) ──────────────────────────

  router.get('/queue', async (req: Request, res: Response) => {
    try {
      const client = getJiraClient();
      if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }

      const jql = `project = NT AND cf[12981] = "Tier 3" AND statusCategory != Done ORDER BY updated DESC`;
      const fields = [
        'summary', 'status', 'assignee', 'reporter', 'priority', 'created', 'updated',
        'duedate', 'issuetype',
        CF_CURRENT_TIER, CF_TLDR, CF_AGENT_SUMMARY, CF_TROUBLESHOOTING,
        CF_ESCALATION_REASON, CF_EXPECTED_OUTCOME, CF_ISSUE_ENVIRONMENT, CF_NURTUR_PRODUCT,
        CF_DEVELOPMENT_DETAILS,
      ];

      let issues: Array<{ key: string; fields: Record<string, unknown> }> = [];
      try {
        const result = await client.searchJqlAll(jql, fields, 200);
        issues = result.issues;
      } catch (e) {
        res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Jira search failed' });
        return;
      }

      // Sync NOVA state: upsert anything newly seen, archive anything no longer in T3
      const liveKeys = new Set(issues.map((i) => i.key));
      for (const issue of issues) {
        const submitter = (issue.fields.assignee as { emailAddress?: string } | null)?.emailAddress || null;
        devQueries.upsertFromPoll(issue.key, submitter);
        const product = (issue.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null;
        devQueries.setTeam(issue.key, productToTeam(product));
      }
      // Archive stale rows
      for (const row of devQueries.listQueue()) {
        if (!liveKeys.has(row.jira_key)) devQueries.archive(row.jira_key);
      }

      // Merge: for each live issue, attach NOVA state + resolved team
      let enriched = issues.map((issue) => {
        const state = devQueries.getState(issue.key);
        const product = (issue.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null;
        return {
          key: issue.key,
          fields: issue.fields,
          state: state || null,
          team: productToTeam(product),
        };
      });

      // Filter by user's NOVA team jira_products. Admins always see all.
      // If the user's team has no products set (NULL or empty), they see all
      // (this is the default for the Support team). Otherwise only tickets
      // whose productToTeam value matches one of the allowed products.
      //
      // Override: ?showAll=1 bypasses the filter. The UI exposes this as a
      // toggle so a dev can temporarily see the full queue (useful for
      // covering another team or spotting cross-product issues). We also
      // report whether the current user has a team filter so the UI can
      // show/hide the toggle accordingly.
      const showAll = req.query.showAll === '1';
      let userTeamFilterActive = false;
      let userTeamName: string | null = null;
      if (req.user && !isAdmin(req.user.role)) {
        const user = userQueries.getById(req.user.id);
        if (user?.team_id) {
          const team = teamQueries.getById(user.team_id);
          const allowed = team?.jira_products;
          if (allowed && allowed.length > 0) {
            userTeamFilterActive = true;
            userTeamName = team?.name ?? null;
            if (!showAll) {
              const allowedSet = new Set(allowed);
              enriched = enriched.filter((item) => allowedSet.has(item.team));
            }
          }
        }
      }

      // Sort: fast_track first, then pending/in_review, then last_action_at
      enriched.sort((a, b) => {
        const aFt = a.state?.fast_track ? 1 : 0;
        const bFt = b.state?.fast_track ? 1 : 0;
        if (aFt !== bFt) return bFt - aFt;
        const rank = (s: string | undefined) =>
          s === 'pending' ? 0 : s === 'in_review' ? 1 : s === 'returned' ? 2 : 3;
        const diff = rank(a.state?.status) - rank(b.state?.status);
        if (diff !== 0) return diff;
        return (b.state?.last_action_at || '').localeCompare(a.state?.last_action_at || '');
      });

      res.json({
        ok: true,
        data: enriched,
        meta: {
          userTeamFilterActive,
          userTeamName,
          showingAll: showAll || !userTeamFilterActive,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'queue failed' });
    }
  });

  // ── Ticket detail (single issue + thread) ─────────────────────────────

  router.get('/ticket/:key', async (req: Request, res: Response) => {
    try {
      const client = getJiraClient();
      if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }
      const key = String(req.params.key);

      const issue = await client.getIssue(key, [
        'summary', 'description', 'status', 'assignee', 'reporter', 'priority',
        'created', 'updated', 'duedate', 'issuetype',
        CF_CURRENT_TIER, CF_TLDR, CF_AGENT_SUMMARY, CF_TROUBLESHOOTING,
        CF_ESCALATION_REASON, CF_EXPECTED_OUTCOME, CF_ISSUE_ENVIRONMENT, CF_NURTUR_PRODUCT,
        CF_DEVELOPMENT_DETAILS,
      ]);

      if (!issue) { res.status(404).json({ ok: false, error: 'Not found' }); return; }

      const state = devQueries.getState(key);
      const thread = devQueries.getThread(key);
      const jiraComments = await client.getComments(key, 20).catch(() => []);

      res.json({ ok: true, data: { key, fields: issue.fields, state, thread, jiraComments } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'detail failed' });
    }
  });

  // ── Claim / unclaim / fast-track / priority ────────────────────────────

  router.post('/ticket/:key/claim', (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    devQueries.claim(String(req.params.key), req.user.id);
    devQueries.addThreadEntry({
      jira_key: String(req.params.key),
      user_id: req.user.id,
      user_display: userDisplay(req),
      kind: 'claim',
      body: `${userDisplay(req)} claimed this ticket`,
      syncState: 'skip',
    });
    res.json({ ok: true });
  });

  router.post('/ticket/:key/unclaim', (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    devQueries.unclaim(String(req.params.key));
    res.json({ ok: true });
  });

  router.post('/ticket/:key/fast-track', (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const on = !!req.body?.on;
    devQueries.setFastTrack(String(req.params.key), on);
    devQueries.addThreadEntry({
      jira_key: String(req.params.key),
      user_id: req.user.id,
      user_display: userDisplay(req),
      kind: 'fasttrack',
      body: on ? 'Flagged as fast-track' : 'Fast-track cleared',
      syncState: 'skip',
    });
    res.json({ ok: true });
  });

  router.post('/ticket/:key/priority', (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const priority = req.body?.priority as 'low' | 'normal' | 'high';
    if (!['low', 'normal', 'high'].includes(priority)) {
      res.status(400).json({ ok: false, error: 'Invalid priority' }); return;
    }
    devQueries.setPriority(String(req.params.key), priority);
    res.json({ ok: true });
  });

  // ── Comment (posts internal Jira comment + transitions Waiting On Assignee) ──
  // Internal comment only — never falls back to public. If the internal post
  // fails, the request fails; nothing leaks to the customer portal. After a
  // successful post, transitions the ticket to "Waiting On Assignee" and
  // mirrors that state in NOVA so the queue shows who's waiting on whom.

  router.post('/ticket/:key/comment', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const body = String(req.body?.body ?? '').trim();
    if (!body) { res.status(400).json({ ok: false, error: 'Body required' }); return; }

    const key = String(req.params.key);
    const display = userDisplay(req);
    const threadId = devQueries.addThreadEntry({
      jira_key: key,
      user_id: req.user.id,
      user_display: display,
      kind: 'comment',
      body,
      syncState: 'pending',
    });

    const client = getJiraClient();
    if (!client) {
      devQueries.markThreadSyncFailed(threadId, 'Jira not configured');
      res.status(503).json({ ok: false, error: 'Jira not configured' });
      return;
    }

    const prefixed = `🛠️ Developer comment — ${display}\n\n${body}`;
    try {
      const result = await client.addComment(key, prefixed, { internal: true });
      const jiraCommentId = (result as { id?: string } | null)?.id ?? null;
      devQueries.markThreadSynced(threadId, jiraCommentId);

      // Transition → Waiting On Assignee (auto-discovered or overridden via setting)
      let waitingSet = false;
      const waitTransitionId = await resolveTransitionId(
        client, key, 'Waiting On Assignee', 'dev_review_wait_transition_id',
      );
      if (waitTransitionId) {
        try {
          await client.transitionIssue(key, waitTransitionId);
          devQueries.setStatus(key, 'waiting_on_assignee');
          waitingSet = true;
        } catch (transErr) {
          console.warn(`[DevReview] Transition to Waiting On Assignee failed for ${key}: ${transErr instanceof Error ? transErr.message : transErr}`);
        }
      } else {
        console.warn(`[DevReview] Could not resolve 'Waiting On Assignee' transition for ${key}`);
      }

      res.json({ ok: true, waitingSet });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      devQueries.markThreadSyncFailed(threadId, msg);
      res.status(502).json({ ok: false, error: `Failed to post internal comment: ${msg}` });
    }
  });

  // ── Accept (Jira transition → Development) ────────────────────────────
  // Sets CurrentTier=Development AND populates the Escalate-to-Development
  // screen fields (TL;DR + Development Details). Both fields are passed as
  // ADF docs since they're configured as rich text in the NT workflow.

  router.post('/ticket/:key/accept', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const client = getJiraClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }

    const key = String(req.params.key);
    const s = settingsQueries.getAll();
    const transitionId = String(s.dev_review_accept_transition_id || '141');
    const note = String(req.body?.note || '').trim();
    const tldr = String(req.body?.tldr || '').trim();
    const developmentDetails = String(req.body?.developmentDetails || '').trim();
    const display = userDisplay(req);

    if (!tldr) {
      res.status(400).json({ ok: false, error: 'TL;DR is required by the Escalate to Development screen' });
      return;
    }

    const threadId = devQueries.addThreadEntry({
      jira_key: key,
      user_id: req.user.id,
      user_display: display,
      kind: 'accept',
      body: note || 'Accepted to development backlog',
      meta: { tldr, developmentDetails },
      syncState: 'pending',
    });

    const commentText = `✅ Accepted to development by ${display}${note ? `\n\n${note}` : ''}`;

    const fields: Record<string, unknown> = {
      [CF_TLDR]: adfDoc(tldr),
    };
    if (developmentDetails) {
      fields[CF_DEVELOPMENT_DETAILS] = adfDoc(developmentDetails);
    }

    try {
      await client.transitionIssue(key, transitionId, {
        fields,
        comment: { body: adfDoc(commentText) },
      });
      devQueries.markThreadSynced(threadId, null);
      devQueries.markAccepted(key);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transition failed';
      devQueries.markThreadSyncFailed(threadId, msg);
      devQueries.addOutbox({
        jira_key: key,
        op: 'accept',
        payload: { transitionId, commentText, tldr, developmentDetails },
      });
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ── Return (back to T2 with mandatory next steps) ─────────────────────

  router.post('/ticket/:key/return', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const nextSteps = String(req.body?.nextSteps || '').trim();
    if (nextSteps.length < 10) {
      res.status(400).json({ ok: false, error: 'Next steps required (min 10 chars)' }); return;
    }
    const client = getJiraClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }

    const s = settingsQueries.getAll();
    const returnTransitionId = s.dev_review_return_transition_id ? String(s.dev_review_return_transition_id) : '';
    const display = userDisplay(req);

    const threadId = devQueries.addThreadEntry({
      jira_key: String(req.params.key),
      user_id: req.user.id,
      user_display: display,
      kind: 'return',
      body: nextSteps,
      meta: { returnTransitionId: returnTransitionId || 'field-update' },
      syncState: 'pending',
    });

    const commentText = `↩️ Returned to Customer Care by ${display}\n\nNext steps:\n${nextSteps}`;
    const commentAdf = {
      body: {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }],
      },
    };

    // Look up original assignee to reassign
    const state = devQueries.getState(String(req.params.key));
    const submitter = state?.submitted_by_username || null;

    try {
      if (returnTransitionId) {
        await client.transitionIssue(String(req.params.key), returnTransitionId, { comment: commentAdf });
      } else {
        // No configured transition → update CurrentTier field directly + post comment
        await client.updateFields(String(req.params.key), { [CF_CURRENT_TIER]: { id: TIER_ID_T2 } });
        await client.addComment(String(req.params.key), commentText);
      }

      // Best-effort reassign
      if (submitter) {
        try {
          const users = await client.searchUsers(submitter, 1);
          if (users[0]?.accountId) {
            await client.updateFields(String(req.params.key), { assignee: { accountId: users[0].accountId } });
          }
        } catch { /* non-fatal */ }
      }

      devQueries.markThreadSynced(threadId, null);
      devQueries.markReturned(String(req.params.key));

      // Notify the original submitter in NOVA (best-effort; never blocks response)
      try {
        if (submitter) {
          const allUsers = userQueries.getAll();
          // Match by email (since Jira emailAddress is what we stored), then username
          const match = allUsers.find((u) => (u.email && u.email.toLowerCase() === submitter.toLowerCase()))
            || allUsers.find((u) => u.username.toLowerCase() === submitter.toLowerCase());
          if (match) {
            notificationQueries.create({
              user_id: match.id,
              type: 'dev_review_returned',
              title: `Dev returned ${String(req.params.key)} with next steps`,
              message: nextSteps.slice(0, 200),
              entity_type: 'jira_ticket',
              entity_id: String(req.params.key),
            });
          }
        }
      } catch { /* non-fatal */ }

      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Return failed';
      devQueries.markThreadSyncFailed(threadId, msg);
      devQueries.addOutbox({
        jira_key: String(req.params.key),
        op: 'return',
        payload: { returnTransitionId, commentText, nextSteps },
      });
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ── Dashboard aggregations ────────────────────────────────────────────

  router.get('/dashboard', (_req: Request, res: Response) => {
    try {
      const data = devQueries.getDashboard();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'dashboard failed' });
    }
  });

  // ── Outbox visibility (admin diagnostic) ──────────────────────────────

  router.get('/outbox', (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false }); return; }
    res.json({ ok: true, data: devQueries.pendingOutbox(100) });
  });

  return router;
}
