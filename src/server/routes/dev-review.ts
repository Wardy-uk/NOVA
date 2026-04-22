import { Router, type Request, type Response } from 'express';
import type { DevReviewQueries } from '../db/dev-review-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { UserQueries, UserTeamQueries } from '../db/queries.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { TeamQueries } from '../db/queries.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { AreaAccessGuard } from '../middleware/auth.js';
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

/** Walk an ADF doc and extract plain text — used when importing Jira
 *  comments into the local thread. Mirrors the helper in the background
 *  watcher in index.ts. */
function adfToPlainText(adf: unknown): string {
  const walk = (n: unknown): string => {
    if (!n) return '';
    if (typeof n === 'string') return n;
    const node = n as { text?: string; type?: string; content?: unknown[] };
    if (node.text) return node.text;
    if (Array.isArray(node.content)) {
      const inner = node.content.map(walk).join('');
      return node.type === 'paragraph' || node.type === 'heading' ? inner + '\n' : inner;
    }
    return '';
  };
  return walk(adf).trim();
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
  userQueries: UserQueries,
  notificationQueries: NotificationQueries,
  teamQueries: TeamQueries,
  requireAreaAccess: AreaAccessGuard,
  getJiraClient: () => JiraRestClient | null,
  userTeamQueries?: UserTeamQueries,
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

  // Gate: devreview area access (configured in Admin > Permissions)
  router.use(requireAreaAccess('devreview', 'view'));

  const userDisplay = async (req: Request): Promise<string> => {
    if (!req.user) return 'Unknown';
    const u = await userQueries.getById(req.user.id);
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
      const liveKeys = new Set(issues.map((i) => i.key));
      for (const issue of issues) {
        const submitter = (issue.fields.assignee as { emailAddress?: string } | null)?.emailAddress || null;
        await devQueries.upsertFromPoll(issue.key, submitter);
        const product = (issue.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null;
        await devQueries.setTeam(issue.key, productToTeam(product));
      }
      // Archive stale rows
      for (const row of await devQueries.listQueue()) {
        if (!liveKeys.has(row.jira_key)) {
          await devQueries.archive(row.jira_key);
        }
      }
      // Merge: batch-fetch all NOVA states in one query, then attach to each issue
      const stateMap = await devQueries.getStatesForKeys(issues.map(i => i.key));
      let enriched = issues.map((issue) => {
        const product = (issue.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null;
        return {
          key: issue.key,
          fields: issue.fields,
          state: stateMap.get(issue.key) || null,
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
      let userTeamNames: string[] = [];
      if (req.user && !isAdmin(req.user.role)) {
        // Aggregate allowed products from ALL of the user's teams
        const userTeams = userTeamQueries
          ? await userTeamQueries.getTeamsForUser(req.user.id, teamQueries)
          : [];
        // Fallback to legacy team_id if no user_teams rows
        if (userTeams.length === 0) {
          const user = await userQueries.getById(req.user.id);
          if (user?.team_id) {
            const t = await teamQueries.getById(user.team_id);
            if (t) userTeams.push(t);
          }
        }
        const allProducts = new Set<string>();
        for (const t of userTeams) {
          if (t.jira_products && t.jira_products.length > 0) {
            for (const p of t.jira_products) allProducts.add(p);
            userTeamNames.push(t.name);
          }
        }
        if (allProducts.size > 0) {
          userTeamFilterActive = true;
          if (!showAll) {
            enriched = enriched.filter((item) => allProducts.has(item.team));
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
        return new Date(b.state?.last_action_at || 0).getTime() - new Date(a.state?.last_action_at || 0).getTime();
      });

      res.json({
        ok: true,
        data: enriched,
        meta: {
          userTeamFilterActive,
          userTeamName: userTeamNames.length > 0 ? userTeamNames.join(', ') : null,
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

      // Pull the latest 20 Jira comments and import any not yet in the
      // local thread. Same logic as the global comment watcher but scoped
      // to this single ticket — gives the detail pane near-real-time
      // freshness without waiting for the 2-min sweep.
      const jiraComments = await client.getComments(key, 20).catch(() => []);
      let importedExternal = 0;
      for (const c of jiraComments) {
        if (await devQueries.hasJiraComment(key, c.id)) continue;
        const body = adfToPlainText(c.body);
        const authorName = c.author?.displayName || 'Unknown';
        await devQueries.addExternalJiraComment({
          jira_key: key,
          author_display: authorName,
          body,
          jira_comment_id: c.id,
          author_account_id: c.author?.accountId,
          internal: c.jsdPublic === false,
        });
        importedExternal++;
      }
      // Any new external reply flips waiting_on_assignee → in_review so
      // the queue immediately reflects "ball back in dev court".
      if (importedExternal > 0) {
        const cur = await devQueries.getState(key);
        if (cur?.status === 'waiting_on_assignee') {
          await devQueries.setStatus(key, 'in_review');
        }
      }

      const state = await devQueries.getState(key);
      const thread = await devQueries.getThread(key);

      res.json({ ok: true, data: { key, fields: issue.fields, state, thread, jiraComments } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'detail failed' });
    }
  });

  // ── Claim / unclaim / fast-track / priority ────────────────────────────

  router.post('/ticket/:key/claim', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    await devQueries.claim(String(req.params.key), req.user.id);
    await devQueries.addThreadEntry({
      jira_key: String(req.params.key),
      user_id: req.user.id,
      user_display: await userDisplay(req),
      kind: 'claim',
      body: `${await userDisplay(req)} claimed this ticket`,
      syncState: 'skip',
    });
    res.json({ ok: true });
  });

  router.post('/ticket/:key/unclaim', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    await devQueries.unclaim(String(req.params.key));
    res.json({ ok: true });
  });

  router.post('/ticket/:key/fast-track', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const on = !!req.body?.on;
    await devQueries.setFastTrack(String(req.params.key), on);
    await devQueries.addThreadEntry({
      jira_key: String(req.params.key),
      user_id: req.user.id,
      user_display: await userDisplay(req),
      kind: 'fasttrack',
      body: on ? 'Flagged as fast-track' : 'Fast-track cleared',
      syncState: 'skip',
    });
    res.json({ ok: true });
  });

  router.post('/ticket/:key/priority', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    const priority = req.body?.priority as 'low' | 'normal' | 'high';
    if (!['low', 'normal', 'high'].includes(priority)) {
      res.status(400).json({ ok: false, error: 'Invalid priority' }); return;
    }
    await devQueries.setPriority(String(req.params.key), priority);
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
    const display = await userDisplay(req);
    const threadId = await devQueries.addThreadEntry({
      jira_key: key,
      user_id: req.user.id,
      user_display: display,
      kind: 'comment',
      body,
      syncState: 'pending',
    });

    const client = getJiraClient();
    if (!client) {
      await devQueries.markThreadSyncFailed(threadId, 'Jira not configured');
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
          await devQueries.markThreadSynced(threadId, (r as { id?: string } | null)?.id ?? null);
        } catch (e) {
          await devQueries.markThreadSyncFailed(threadId, e instanceof Error ? e.message : 'comment failed');
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

      await devQueries.setStatus(key, 'waiting_on_assignee');

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

      await devQueries.markThreadSynced(threadId, newCommentId);
      // Purge any stale failed entries from earlier attempts so the
      // Activity panel shows a clean history.
      const purged = await devQueries.purgeFailedThreadEntries(key, threadId);
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
        await devQueries.markThreadSynced(threadId, fallbackId);
      } catch (fallbackErr) {
        await devQueries.markThreadSyncFailed(threadId, msg);
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
    const note = String(req.body?.note || '').trim();
    const tldr = String(req.body?.tldr || '').trim();
    const developmentDetails = String(req.body?.developmentDetails || '').trim();
    const workItemComment = String(req.body?.workItemComment || '').trim();
    const display = await userDisplay(req);

    if (!tldr) {
      res.status(400).json({ ok: false, error: 'TL;DR is required by the Escalate to Development screen' });
      return;
    }

    const threadId = await devQueries.addThreadEntry({
      jira_key: key,
      user_id: req.user.id,
      user_display: display,
      kind: 'accept',
      body: note || 'Accepted to development backlog',
      meta: { tldr, developmentDetails },
      syncState: 'pending',
    });

    // Capture the current assignee BEFORE the transition. The Escalate to
    // Development post-function clears the assignee AND any TL;DR /
    // Development Details we'd set. We restore everything in a single
    // updateFields call AFTER the transition so post-functions can't
    // clobber our writes.
    let originalAssigneeAccountId: string | null = null;
    try {
      const currentIssue = await client.getIssue(key, ['assignee']);
      const assignee = (currentIssue?.fields as { assignee?: { accountId?: string } | null } | undefined)?.assignee;
      originalAssigneeAccountId = assignee?.accountId ?? null;
    } catch { /* non-fatal — skip restore step if we can't read */ }

    // Discover the actual Escalate to Development transition id for THIS
    // ticket's current status. Accept is called from anywhere in the
    // workflow (Open, Work In Progress, Waiting On Partner, Waiting on
    // Assignee, etc.) and the transition we want isn't always directly
    // reachable. If it's not available from the current status, chain
    // through 'Work In Progress' first, which sits between the various
    // waiting states and the escalate-to-development transition.
    const findTransitionByName = async (rx: RegExp): Promise<string | null> => {
      try {
        const meta = await client.getTransitionsWithFields(key) as {
          transitions?: Array<{ id: string; name?: string }>;
        };
        const t = (meta.transitions || []).find((x) => rx.test(x.name || ''));
        return t?.id || null;
      } catch { return null; }
    };

    let transitionId = String(
      settingsQueries.getAll().dev_review_accept_transition_id || '',
    );
    // If admin has pinned an ID but it's not in the available set, fall back to name discovery
    if (transitionId) {
      const available = await findTransitionByName(new RegExp(`^${transitionId}$`));
      if (!available) transitionId = '';
    }
    if (!transitionId) {
      transitionId = (await findTransitionByName(/escalate.*development/i)) || '';
    }
    if (!transitionId) {
      // Not directly reachable — chain through Work In Progress
      const wipId = await findTransitionByName(/work\s*in\s*progress|^wip$/i);
      if (wipId) {
        try {
          await client.transitionIssue(key, wipId);
          transitionId = (await findTransitionByName(/escalate.*development/i)) || '';
        } catch (wipErr) {
          console.warn(`[DevReview/accept] WIP pre-transition failed for ${key}: ${wipErr instanceof Error ? wipErr.message : wipErr}`);
        }
      }
    }
    if (!transitionId) {
      const msg = 'Escalate to Development transition not reachable from current status';
      await devQueries.markThreadSyncFailed(threadId, msg);
      res.status(409).json({ ok: false, error: msg });
      return;
    }

    // Step 1 — bare transition (no fields, no comment). The transition
    // screen doesn't include TL;DR / Dev Details / comment, and its
    // post-function clears the assignee. We do all writes in step 2
    // to avoid fighting those post-functions.
    try {
      await client.transitionIssue(key, transitionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transition failed';
      await devQueries.markThreadSyncFailed(threadId, msg);
      await devQueries.addOutbox({
        jira_key: key,
        op: 'accept',
        payload: { transitionId, tldr, developmentDetails },
      });
      res.status(502).json({ ok: false, error: msg });
      return;
    }

    await devQueries.markThreadSynced(threadId, null);
    await devQueries.markAccepted(key);

    // Step 2 — single updateFields call writing TL;DR, Development Details
    // and restoring the original assignee. Runs AFTER the transition so
    // any post-functions that clear these fields have already fired.
    // Logged loudly on failure — the accept is already committed in
    // NOVA and the ticket has moved in Jira, so we return ok: true with
    // a warnings list rather than failing the whole request.
    const postUpdatePayload: Record<string, unknown> = {
      [CF_TLDR]: adfDoc(tldr),
    };
    if (developmentDetails) postUpdatePayload[CF_DEVELOPMENT_DETAILS] = adfDoc(developmentDetails);
    if (originalAssigneeAccountId) {
      postUpdatePayload.assignee = { accountId: originalAssigneeAccountId };
    }
    const warnings: string[] = [];
    try {
      await client.updateFields(key, postUpdatePayload);
    } catch (postErr) {
      const msg = postErr instanceof Error ? postErr.message : 'post-transition update failed';
      console.warn(`[DevReview/accept] Post-transition field update failed for ${key}: ${msg}`);
      warnings.push(`Field update after transition failed: ${msg}`);
    }

    // Step 3 — internal comment aimed at the T2 agent. Fire-and-forget
    // so a slow/hung Jira call can't time out the accept response.
    const agentNoticeText =
      `📋 Action required — ${display} has accepted this ticket into the development backlog.\n\n` +
      `Please update the customer to let them know their ticket is now with the development team. ` +
      `You can expect updates from development every 5 working days. ` +
      `If there is no update after 5 working days, chase via the Jira comment thread.`;
    client.addComment(key, agentNoticeText, { internal: true }).catch((noticeErr) => {
      console.warn(`[DevReview/accept] Failed to post agent-notice comment for ${key}: ${noticeErr instanceof Error ? noticeErr.message : noticeErr}`);
    });

    // Step 4 — Create linked Bug work item in the dev team's Jira project
    let workItemKey: string | null = null;
    let targetProjectKey: string | null = null;
    if (req.user) {
      // Find the best project key from the user's teams
      const userTeams = userTeamQueries
        ? await userTeamQueries.getTeamsForUser(req.user.id, teamQueries)
        : [];
      // Fallback to legacy team_id
      if (userTeams.length === 0) {
        const user = await userQueries.getById(req.user.id);
        if (user?.team_id) {
          const t = await teamQueries.getById(user.team_id);
          if (t) userTeams.push(t);
        }
      }
      if (userTeams.length === 1) {
        targetProjectKey = userTeams[0].jira_project_key?.trim() || null;
      } else if (userTeams.length > 1) {
        // Pick the team whose products match the ticket's product
        const ticketState = await devQueries.getState(key);
        const ticketTeam = ticketState?.team || 'Unassigned';
        const match = userTeams.find(t => t.jira_products?.includes(ticketTeam));
        targetProjectKey = (match ?? userTeams[0]).jira_project_key?.trim() || null;
      }
    }

    if (!targetProjectKey) {
      console.warn(`[DevReview/accept] No jira_project_key for accepting user's team — skipping Bug creation for ${key}`);
      warnings.push('No Jira project key configured for your team — work item not created');
    } else {
      try {
        // Fetch the full issue fields for the Bug description
        const issueForBug = await client.getIssue(key, [
          'summary', 'reporter', 'priority',
          CF_TLDR, CF_AGENT_SUMMARY, CF_TROUBLESHOOTING,
          CF_EXPECTED_OUTCOME, CF_ISSUE_ENVIRONMENT,
        ]);
        const issueFields = (issueForBug?.fields || {}) as Record<string, unknown>;
        const reporterName = (issueFields.reporter as { displayName?: string } | null)?.displayName || 'Unknown';
        const priorityName = (issueFields.priority as { name?: string } | null)?.name || 'Unknown';
        const issueSummary = (issueFields.summary as string) || '(no summary)';

        const briefTldr = adfToPlainText(issueFields[CF_TLDR]) || tldr || '(none)';
        const briefAgentSummary = adfToPlainText(issueFields[CF_AGENT_SUMMARY]) || 'None';
        const briefTroubleshooting = adfToPlainText(issueFields[CF_TROUBLESHOOTING]) || 'None';
        const briefExpectedOutcome = adfToPlainText(issueFields[CF_EXPECTED_OUTCOME]) || 'None';
        const briefEnvironment = adfToPlainText(issueFields[CF_ISSUE_ENVIRONMENT]) || 'None';

        const descriptionText =
          `Support Ticket: ${key}\n` +
          `Customer: ${reporterName}\n` +
          `Priority: ${priorityName}\n\n` +
          `── TL;DR ──\n${briefTldr}\n\n` +
          `── Agent Summary ──\n${briefAgentSummary}\n\n` +
          `── Troubleshooting Performed ──\n${briefTroubleshooting}\n\n` +
          `── Expected Outcome ──\n${briefExpectedOutcome}\n\n` +
          `── Environment ──\n${briefEnvironment}\n\n` +
          `── Developer Comment ──\n${workItemComment || 'None'}`;

        const createdBug = await client.createIssue({
          fields: {
            project: { key: targetProjectKey },
            issuetype: { name: 'Bug' },
            summary: `[Support] ${issueSummary}`,
            description: adfDoc(descriptionText),
          },
        });
        workItemKey = createdBug.key;
        console.log(`[DevReview/accept] Created Bug ${workItemKey} in ${targetProjectKey} for ${key}`);

        // Link the Bug to the NT support ticket
        try {
          await client.createIssueLink({
            type: { name: 'Relates' },
            inwardIssue: { key: createdBug.key },
            outwardIssue: { key },
          });
        } catch (linkErr) {
          const msg = linkErr instanceof Error ? linkErr.message : 'Link creation failed';
          console.error(`[DevReview/accept] Issue link failed for ${key} → ${createdBug.key}: ${msg}`);
          warnings.push(`Bug created (${createdBug.key}) but link failed: ${msg}`);
        }

        // Post customer-facing comment on the NT ticket
        try {
          const customerComment =
            'This issue requires work by our development team. ' +
            'Development work operates under a 60 working day SLA. ' +
            'If you have any concerns or wish to escalate, please contact your Account Manager.';
          await client.addComment(key, customerComment);
        } catch (commentErr) {
          const msg = commentErr instanceof Error ? commentErr.message : 'Customer comment failed';
          console.error(`[DevReview/accept] Customer comment failed for ${key}: ${msg}`);
          warnings.push(`Customer comment failed: ${msg}`);
        }
      } catch (bugErr) {
        const msg = bugErr instanceof Error ? bugErr.message : 'Bug creation failed';
        console.error(`[DevReview/accept] Bug creation failed for ${key}: ${msg}`);
        warnings.push(`Work item creation failed: ${msg}`);
      }
    }

    res.json({ ok: true, workItemKey, warnings: warnings.length > 0 ? warnings : undefined });
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
    const display = await userDisplay(req);

    const threadId = await devQueries.addThreadEntry({
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
    const state = await devQueries.getState(String(req.params.key));
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

      await devQueries.markThreadSynced(threadId, null);
      await devQueries.markReturned(String(req.params.key));

      // Notify the original submitter in NOVA (best-effort; never blocks response)
      try {
        if (submitter) {
          const allUsers = await userQueries.getAll();
          // Match by email (since Jira emailAddress is what we stored), then username
          const match = allUsers.find((u) => (u.email && u.email.toLowerCase() === submitter.toLowerCase()))
            || allUsers.find((u) => u.username.toLowerCase() === submitter.toLowerCase());
          if (match) {
            await notificationQueries.create({
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
      await devQueries.markThreadSyncFailed(threadId, msg);
      await devQueries.addOutbox({
        jira_key: String(req.params.key),
        op: 'return',
        payload: { returnTransitionId, commentText, nextSteps },
      });
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ── Dashboard aggregations ────────────────────────────────────────────

  router.get('/dashboard', async (_req: Request, res: Response) => {
    try {
      const data = await devQueries.getDashboard();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'dashboard failed' });
    }
  });

  // ── Outbox visibility (admin diagnostic) ──────────────────────────────

  router.get('/outbox', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false }); return; }
    res.json({ ok: true, data: await devQueries.pendingOutbox(100) });
  });

  return router;
}
