import { Router, type Request, type Response } from 'express';
import type { DevReviewQueries } from '../db/dev-review-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { FileUserQueries } from '../db/user-store.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { TeamQueries } from '../db/queries.js';
import type { JiraRestClient } from '../services/jira-client.js';
import { saveDb } from '../db/schema.js';
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
      // Only fetch fields actually rendered in the queue card (summary,
      // TL;DR preview, product chip, age, claimed indicator). Heavy
      // escalation textareas (Agent Summary, Troubleshooting, Expected
      // Outcome, Environment, Development Details) are big ADF docs and
      // are loaded only when the user clicks into a ticket via /ticket/:key.
      const fields = [
        'summary', 'status', 'assignee', 'reporter', 'updated',
        CF_CURRENT_TIER, CF_TLDR, CF_NURTUR_PRODUCT,
      ];

      let issues: Array<{ key: string; fields: Record<string, unknown> }> = [];
      try {
        const result = await client.searchJqlAll(jql, fields, 200);
        issues = result.issues;
      } catch (e) {
        res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Jira search failed' });
        return;
      }

      // Sync NOVA state: upsert anything newly seen, archive anything no longer in T3.
      //
      // Performance note: every per-row write previously called saveDb() which
      // flushes the entire sql.js DB to disk. With ~20 active tickets that was
      // 40+ disk writes per queue load. We now defer all writes and call
      // saveDb() ONCE at the end of the sync block. Crash-window data loss is
      // bounded by the 15s periodic flush — and these rows are all derivable
      // from Jira state on the next poll anyway.
      let dirty = false;
      const liveKeys = new Set(issues.map((i) => i.key));
      for (const issue of issues) {
        const submitter = (issue.fields.assignee as { emailAddress?: string } | null)?.emailAddress || null;
        devQueries.upsertFromPoll(issue.key, submitter, { defer: true });
        const product = (issue.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null;
        devQueries.setTeam(issue.key, productToTeam(product), { defer: true });
        dirty = true;
      }
      // Archive stale rows
      for (const row of devQueries.listQueue()) {
        if (!liveKeys.has(row.jira_key)) {
          devQueries.archive(row.jira_key, { defer: true });
          dirty = true;
        }
      }
      if (dirty) saveDb();

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

  // ── Comment (single-shot Waiting On Assignee transition with internal note) ──
  //
  // The "Waiting On Assignee" transition in Jira has a mandatory internal
  // comment field on its transition screen PLUS a handful of other required
  // fields (TL;DR, Nurtur Product, Sub Category, Priority, Due date, Agent
  // Next Update). A standalone addComment followed by an unadorned transition
  // fails the workflow validator.
  //
  // Single-shot approach:
  //   1. Discover the transition + its required fields via getTransitionsWithFields
  //   2. Fetch current values of those required fields from the issue
  //   3. Normalise each value for write-back shape
  //   4. POST the transition with fields + internal comment in one call
  //   5. Fetch the newest comment afterwards and store its Jira ID so the
  //      watcher doesn't re-import it as an external reply

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
      // Step 1: discover transitions + field schemas
      const meta = await client.getTransitionsWithFields(key) as {
        transitions?: Array<{
          id: string;
          name?: string;
          fields?: Record<string, {
            required?: boolean;
            schema?: { type?: string; custom?: string; items?: string };
          }>;
        }>;
      };
      const transitions = meta.transitions || [];
      const settingOverride = settingsQueries.getAll().dev_review_wait_transition_id;
      let waitTransition = settingOverride
        ? transitions.find((t) => t.id === String(settingOverride))
        : transitions.find((t) => /waiting on assignee/i.test(t.name || ''));
      if (!waitTransition) waitTransition = transitions.find((t) => /waiting/i.test(t.name || ''));

      if (!waitTransition) {
        // No transition available — post a standalone internal comment so the
        // dev's note isn't lost, and warn the caller.
        try {
          const r = await client.addComment(key, prefixed, { internal: true });
          devQueries.markThreadSynced(threadId, (r as { id?: string } | null)?.id ?? null);
        } catch (e) {
          devQueries.markThreadSyncFailed(threadId, e instanceof Error ? e.message : 'comment failed');
        }
        res.json({ ok: true, waitingSet: false, warning: 'Waiting On Assignee transition not found — comment posted but status not changed' });
        return;
      }

      // Include EVERY writeable field on the transition screen. Jira's
      // workflow validators can run on any field on the screen, so we
      // round-trip current values rather than trusting the `required` flag.
      //
      // Excluded:
      //  - "comment" pseudo-field (we handle that via update.comment)
      //  - sd-* schema types: these are Service Desk display-only pseudo-
      //    fields (Request Type, SLAs etc.) that live on many JSM workflow
      //    screens for display but are not writeable via REST. Writing them
      //    back returns "Operation value must be a string" and blows up the
      //    transition. Strip them before we even try.
      const fieldMetas = waitTransition.fields || {};
      const isSdPseudoField = (fieldId: string): boolean => {
        const t = fieldMetas[fieldId]?.schema?.type || '';
        return t.startsWith('sd-');
      };
      const screenFieldIds = Object.keys(fieldMetas)
        .filter((id) => id !== 'comment')
        .filter((id) => !isSdPseudoField(id));

      // Step 2: fetch current values of those screen fields and normalise
      // for write-back using the schema from the transitions response.
      // Different Jira field types need different write shapes:
      //   string          → plain string OR ADF doc object (for textareas)
      //   option/priority → { id }
      //   user            → { accountId }
      //   date/datetime   → ISO string
      //   number          → number
      //   array           → pass through as-is
      const passFields: Record<string, unknown> = {};
      if (screenFieldIds.length > 0) {
        const issue = await client.getIssue(key, screenFieldIds);
        const currentFields = (issue?.fields || {}) as Record<string, unknown>;
        const fieldMetas = waitTransition.fields || {};

        for (const fieldId of screenFieldIds) {
          const val = currentFields[fieldId];
          if (val === null || val === undefined) continue;
          const schemaType = fieldMetas[fieldId]?.schema?.type;

          // Detect an ADF doc — some textareas return rich-text as a doc
          const isAdfDoc = typeof val === 'object' && val !== null && !Array.isArray(val)
            && (val as { type?: string }).type === 'doc';

          switch (schemaType) {
            case 'string':
              // Textarea fields send ADF back in; simple text fields want a
              // plain string. Preserve whichever format we read.
              if (isAdfDoc) {
                passFields[fieldId] = val;
              } else if (typeof val === 'string') {
                passFields[fieldId] = val;
              } else {
                passFields[fieldId] = String(val);
              }
              break;
            case 'option':
            case 'priority':
            case 'issuetype':
            case 'resolution':
            case 'securitylevel':
              if (typeof val === 'object' && val !== null) {
                const obj = val as Record<string, unknown>;
                if ('id' in obj && obj.id != null) passFields[fieldId] = { id: String(obj.id) };
                else if ('value' in obj) passFields[fieldId] = { value: obj.value };
                else if ('name' in obj) passFields[fieldId] = { name: obj.name };
              }
              break;
            case 'user':
              if (typeof val === 'object' && val !== null) {
                const obj = val as Record<string, unknown>;
                if ('accountId' in obj) passFields[fieldId] = { accountId: obj.accountId };
              }
              break;
            case 'date':
            case 'datetime':
            case 'number':
              passFields[fieldId] = val;
              break;
            case 'array':
              if (Array.isArray(val)) passFields[fieldId] = val;
              break;
            case 'any':
            default:
              // Unknown schema — pass through as-is, but if it's a plain
              // object-with-id that looks like an option, wrap it to be safe.
              if (typeof val === 'object' && val !== null && !Array.isArray(val) && !isAdfDoc) {
                const obj = val as Record<string, unknown>;
                if ('id' in obj && obj.id != null) {
                  passFields[fieldId] = { id: String(obj.id) };
                  break;
                }
                if ('value' in obj) {
                  passFields[fieldId] = { value: obj.value };
                  break;
                }
              }
              passFields[fieldId] = val;
              break;
          }
        }
      }

      // Admin-configurable escape hatch — comma-separated field IDs to drop
      // before the call. Useful if a future NT workflow adds another awkward
      // field and we need to skip it without a code change.
      const excludeRaw = String(settingsQueries.getAll().dev_review_wait_field_exclude || '');
      const excludeSet = new Set(excludeRaw.split(',').map((s) => s.trim()).filter(Boolean));
      for (const id of excludeSet) delete passFields[id];

      console.log(`[DevReview/comment] ${key} → transition ${waitTransition.id} (${waitTransition.name})`);
      console.log(`[DevReview/comment] fields: ${Object.keys(passFields).join(', ') || '(none)'}`);

      // Step 3: single-shot transition + internal comment
      await client.transitionIssue(key, waitTransition.id, {
        fields: passFields,
        comment: { body: adfDoc(prefixed), internal: true },
      });

      devQueries.setStatus(key, 'waiting_on_assignee');

      // Step 4: find the comment we just added so the watcher doesn't
      // re-import it as an external reply (matches by body prefix).
      let newCommentId: string | null = null;
      try {
        const recent = await client.getComments(key, 5);
        const mine = recent.find((c) => {
          const walk = (n: unknown): string => {
            if (!n) return '';
            if (typeof n === 'string') return n;
            const node = n as { text?: string; content?: unknown[] };
            if (node.text) return node.text;
            if (Array.isArray(node.content)) return node.content.map(walk).join('');
            return '';
          };
          const text = walk(c.body);
          return text.startsWith(`🛠️ Developer comment — ${display}`);
        });
        if (mine) newCommentId = mine.id;
      } catch { /* non-fatal */ }

      devQueries.markThreadSynced(threadId, newCommentId);
      // Purge any stale failed entries from earlier attempts so the
      // Activity panel shows a clean history.
      const purged = devQueries.purgeFailedThreadEntries(key, threadId);
      if (purged > 0) console.log(`[DevReview/comment] Purged ${purged} stale failed entries for ${key}`);
      res.json({ ok: true, waitingSet: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transition failed';
      console.error(`[DevReview/comment] Transition failed for ${String(req.params.key)}: ${msg}`);

      // Fallback: post the internal comment standalone so the dev's note
      // isn't lost. The status won't flip, but the comment will be visible
      // in Jira (and on the next Jira→NOVA comment sync). We ignore errors
      // from this fallback because we still want to surface the original
      // transition error to the UI.
      let fallbackId: string | null = null;
      try {
        const r = await client.addComment(String(req.params.key), prefixed, { internal: true });
        fallbackId = (r as { id?: string } | null)?.id ?? null;
        devQueries.markThreadSynced(threadId, fallbackId);
      } catch (fallbackErr) {
        devQueries.markThreadSyncFailed(threadId, msg);
        console.error(`[DevReview/comment] Fallback comment also failed: ${fallbackErr instanceof Error ? fallbackErr.message : fallbackErr}`);
      }

      res.status(502).json({
        ok: false,
        error: `Transition to Waiting On Assignee failed: ${msg}`,
        commentPosted: fallbackId !== null,
      });
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

      // Best-effort second internal comment aimed at the T2 agent who owns
      // the ticket — tells them the ticket is with development and prompts
      // them to update the customer. Wrapped in its own try/catch so a
      // failure here never breaks the accept response.
      try {
        const agentNoticeText =
          `📋 Action required — ${display} has accepted this ticket into the development backlog.\n\n` +
          `Please update the customer to let them know their ticket is now with the development team. ` +
          `You can expect updates from development every 5 working days. ` +
          `If there is no update after 5 working days, chase via the Jira comment thread.`;
        await client.addComment(key, agentNoticeText, { internal: true });
      } catch (noticeErr) {
        console.warn(`[DevReview/accept] Failed to post agent-notice comment for ${key}: ${noticeErr instanceof Error ? noticeErr.message : noticeErr}`);
      }

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
