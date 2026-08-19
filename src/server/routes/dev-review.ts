import { Router, type Request, type Response } from 'express';
import type { DevReviewQueries } from '../db/dev-review-queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { UserQueries, UserTeamQueries } from '../db/queries.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { TeamQueries } from '../db/queries.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { JiraCacheQueries } from '../services/jira-cache-queries.js';
import type { JiraSyncService } from '../services/jira-sync-service.js';
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
/** How far behind the Jira sync may fall before the queue ignores the cache
 *  and reads Jira live. The sync runs every 45s, so 15m is a wide margin. */
const CACHE_MAX_AGE_MS = 15 * 60_000;

const CF_CURRENT_TIER = 'customfield_12981';
const CF_TLDR = 'customfield_13184';
const CF_AGENT_SUMMARY = 'customfield_13185';
const CF_TROUBLESHOOTING = 'customfield_13212';
const CF_ESCALATION_REASON = 'customfield_13186';
const CF_EXPECTED_OUTCOME = 'customfield_13214';
const CF_ISSUE_ENVIRONMENT = 'customfield_13213';
const CF_NURTUR_PRODUCT = 'customfield_13183';
const CF_DEVELOPMENT_DETAILS = 'customfield_13215';
const CF_STORY_TYPE = 'customfield_15014';
const CF_BC_ACCOUNT = 'customfield_14626';

// Story Type — mandatory on the dev Bug create screen (EP, APPS). The
// reviewer picks one in the Accept modal; option id → allowed set.
const STORY_TYPE_OPTIONS: Record<string, string> = {
  '14231': 'New Feature',
  '14232': 'Tech Debt',
  '14233': 'Keeping Lights On',
  '14234': 'Discovery / Spike',
};

// Tier 3 option id for CurrentTier
const TIER_ID_T3 = '13063';
const TIER_ID_T2 = '13062';
const TIER_ID_DEVELOPMENT = '13064';

/** Map a Jira Nurtur Product value to a Dev Team bucket. All TPJ variants
 *  collapse into a single "TPJ" bucket. Unknown products pass through as-is;
 *  null/undefined → 'Unassigned'. */
export function productToTeam(product: string | null | undefined): string {
  if (!product) return 'Unassigned';
  if (product.startsWith('The Property Jungle')) return 'TPJ';
  return product;
}

/** Resolve ADF media UUIDs → numeric Jira attachment IDs.
 *  Walks the ADF tree, finds media nodes, and replaces the UUID `id` with
 *  the real attachment ID from the issue's attachment list. This means the
 *  frontend proxy URL just needs `/api/jira/attachment/{numericId}`. */
function resolveAdfMedia(adf: unknown, attachmentMap: Map<string, string>): void {
  if (!adf || typeof adf !== 'object') return;
  const node = adf as Record<string, unknown>;
  if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs) {
    const attrs = node.attrs as Record<string, unknown>;
    const mediaId = attrs.id as string;
    if (mediaId && attachmentMap.has(mediaId)) {
      attrs.id = attachmentMap.get(mediaId)!;
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) resolveAdfMedia(child, attachmentMap);
  }
}

/** Build a map of filename → numeric attachment ID for an issue's attachments.
 *  Since Jira doesn't expose mediaApiFileId via REST, we match media UUIDs
 *  by walking comments to find which filename each UUID refers to, then
 *  look up the attachment by filename. */
async function buildAttachmentMap(
  client: JiraRestClient,
  issueKey: string,
  adfBodies: unknown[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Collect all media UUIDs and their alt/filename from the ADF bodies
  const mediaNodes: Array<{ id: string; alt?: string }> = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as Record<string, unknown>;
    if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs) {
      const attrs = node.attrs as Record<string, unknown>;
      if (attrs.id && attrs.type !== 'external') {
        mediaNodes.push({ id: attrs.id as string, alt: attrs.alt as string | undefined });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  for (const body of adfBodies) walk(body);
  if (mediaNodes.length === 0) return map;

  // Fetch the issue's attachments
  try {
    const issue = await client.getIssue(issueKey, ['attachment']);
    const attachments = (issue?.fields?.attachment as Array<{ id: string; filename: string; mimeType?: string }>) ?? [];
    if (attachments.length === 0) return map;

    // Match by filename (from ADF alt text)
    for (const media of mediaNodes) {
      if (media.alt) {
        const att = attachments.find(a => a.filename === media.alt);
        if (att) { map.set(media.id, att.id); continue; }
      }
      // Single image fallback
      const images = attachments.filter(a => a.mimeType?.startsWith('image/'));
      if (images.length === 1 && !map.has(media.id)) {
        map.set(media.id, images[0].id);
      }
    }
  } catch (err) {
    console.warn(`[dev-review] Failed to fetch attachments for ${issueKey}: ${err instanceof Error ? err.message : err}`);
  }
  return map;
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

/** Build the support-ticket brief used for the dev work item — shared by
 *  Accept (new Bug description) and Link Existing (comment on the existing
 *  item) so a developer gets the SAME context either way. Returns the plain
 *  text plus the support ticket's summary and Nurtur Product for the caller. */
async function buildWorkItemBrief(
  client: JiraRestClient,
  ntKey: string,
  tldr: string,
  developmentDetails: string,
  workItemComment: string,
): Promise<{ text: string; summary: string; nurturProduct: string | null }> {
  const issue = await client.getIssue(ntKey, [
    'summary', 'reporter', 'priority',
    CF_TLDR, CF_AGENT_SUMMARY, CF_TROUBLESHOOTING,
    CF_EXPECTED_OUTCOME, CF_ISSUE_ENVIRONMENT, CF_NURTUR_PRODUCT,
  ]);
  const f = (issue?.fields || {}) as Record<string, unknown>;
  const reporterName = (f.reporter as { displayName?: string } | null)?.displayName || 'Unknown';
  const priorityName = (f.priority as { name?: string } | null)?.name || 'Unknown';
  const summary = (f.summary as string) || '(no summary)';
  const briefAgentSummary = adfToPlainText(f[CF_AGENT_SUMMARY]) || 'None';
  const briefTroubleshooting = adfToPlainText(f[CF_TROUBLESHOOTING]) || 'None';
  const briefExpectedOutcome = adfToPlainText(f[CF_EXPECTED_OUTCOME]) || 'None';
  const briefEnvironment = adfToPlainText(f[CF_ISSUE_ENVIRONMENT]) || 'None';
  const nurturProduct = (f[CF_NURTUR_PRODUCT] as { value?: string } | null)?.value || null;
  const text =
    `Support Ticket: ${ntKey}\n` +
    `Customer: ${reporterName}\n` +
    `Priority: ${priorityName}\n\n` +
    `── TL;DR ──\n${tldr}\n\n` +
    `── Development Details ──\n${developmentDetails}\n\n` +
    `── Agent Summary ──\n${briefAgentSummary}\n\n` +
    `── Troubleshooting Performed ──\n${briefTroubleshooting}\n\n` +
    `── Expected Outcome ──\n${briefExpectedOutcome}\n\n` +
    `── Environment ──\n${briefEnvironment}\n\n` +
    `── Developer Comment ──\n${workItemComment || 'None'}`;
  return { text, summary, nurturProduct };
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
  cache?: JiraCacheQueries,
  syncService?: JiraSyncService | null,
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
      const t0 = Date.now();
      let issues: Array<{ key: string; fields: Record<string, unknown> }> = [];
      let dataSource: 'cache' | 'api' = 'cache';

      // Only trust the cache while the Jira sync is actually keeping it current.
      // A frozen sync makes the cache lie in both directions: freshly escalated
      // tickets never appear, and returned ones never leave (the background
      // state sync below re-opens them from the stale T3 list).
      const syncStatus = syncService?.getStatus();
      const syncAgeMs = syncStatus?.lastSyncAt ? Date.now() - new Date(syncStatus.lastSyncAt).getTime() : Infinity;
      const cacheUsable = !!cache && syncAgeMs <= CACHE_MAX_AGE_MS;
      if (!cacheUsable && cache) {
        console.warn(`[dev-review] Jira cache stale (last sync ${syncStatus?.lastSyncAt ?? 'never'}) — querying Jira live`);
      }

      // Try cache first — even if full sync hasn't completed, partial data may exist
      if (cacheUsable && cache) {
        try {
          const cached = await cache.getTier3Issues();
          if (cached.length > 0) {
            issues = cached.map(ci => ({
              key: ci.issue_key,
              fields: {
                summary: ci.summary,
                status: { name: ci.status_name, statusCategory: { key: ci.status_category } },
                assignee: ci.assignee_email ? { displayName: ci.assignee_display, emailAddress: ci.assignee_email, accountId: ci.assignee_account_id } : null,
                reporter: ci.reporter_email ? { displayName: ci.reporter_display, emailAddress: ci.reporter_email } : null,
                updated: ci.jira_updated?.toISOString() ?? null,
                [CF_CURRENT_TIER]: ci.current_tier ? { value: ci.current_tier } : null,
                [CF_TLDR]: ci.tldr_text ?? null,
                [CF_NURTUR_PRODUCT]: ci.nurtur_product ? { value: ci.nurtur_product } : null,
              },
            }));
          }
        } catch (cacheErr) {
          console.warn('[dev-review] Cache query failed, trying live API:', cacheErr instanceof Error ? cacheErr.message : cacheErr);
        }
      }

      // Fall back to live Jira only if cache returned nothing
      if (issues.length === 0) {
        dataSource = 'api';
        const client = getJiraClient();
        if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }

        const jql = `project = NT AND cf[12981] = "Tier 3" AND statusCategory != Done ORDER BY updated DESC`;
        const fields = [
          'summary', 'status', 'assignee', 'reporter', 'updated',
          CF_CURRENT_TIER, CF_TLDR, CF_NURTUR_PRODUCT,
        ];

        try {
          const result = await client.searchJqlAll(jql, fields, 200);
          issues = result.issues;
        } catch (e) {
          res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'Jira search failed' });
          return;
        }
      }

      // Sync NOVA state in the background — don't block the response.
      // These writes are all derivable from Jira state on the next poll,
      // so fire-and-forget is safe here.
      const syncKeys = issues.map(i => i.key);
      const syncIssues = issues.map(i => ({
        key: i.key,
        submitter: (i.fields.assignee as { emailAddress?: string } | null)?.emailAddress || null,
        product: (i.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null,
      }));
      setImmediate(async () => {
        try {
          const liveKeys = new Set(syncKeys);
          for (const si of syncIssues) {
            await devQueries.upsertFromPoll(si.key, si.submitter);
            await devQueries.setTeam(si.key, productToTeam(si.product));
          }
          for (const row of await devQueries.listQueue()) {
            if (!liveKeys.has(row.jira_key)) {
              await devQueries.archive(row.jira_key);
            }
          }
        } catch (err) {
          console.warn('[dev-review] Background state sync failed:', err instanceof Error ? err.message : err);
        }
      });
      // Merge: batch-fetch all NOVA states in one query, then attach to each issue
      const stateMap = await devQueries.getStatesForKeys(issues.map(i => i.key));

      // Build a map of user_id → display_name for claimed tickets
      const claimerIds = new Set<number>();
      for (const s of stateMap.values()) {
        if (s.claimed_by_user_id) claimerIds.add(s.claimed_by_user_id);
      }
      const claimerDisplayMap = new Map<number, string>();
      for (const uid of claimerIds) {
        const u = await userQueries.getById(uid);
        if (u) claimerDisplayMap.set(uid, u.display_name || u.username);
      }

      let enriched = issues.map((issue) => {
        const product = (issue.fields as { customfield_13183?: { value?: string } }).customfield_13183?.value || null;
        const st = stateMap.get(issue.key) || null;
        return {
          key: issue.key,
          fields: issue.fields,
          state: st,
          team: productToTeam(product),
          claimed_by_display: st?.claimed_by_user_id ? claimerDisplayMap.get(st.claimed_by_user_id) || null : null,
        };
      });

      // Hide tickets NOVA has already resolved (accepted into development /
      // returned to T2) even if the Jira cache hasn't yet picked up the tier
      // change. Without this an accepted ticket lingers in the queue until the
      // next cache sync, and the queue count drifts from the wallboard — which
      // already counts dev_review_state and excludes these statuses.
      enriched = enriched.filter(
        (item) => item.state?.status !== 'accepted' && item.state?.status !== 'returned',
      );

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
            enriched = enriched.filter((item) =>
              allProducts.has(item.team) || item.state?.claimed_by_user_id === req.user!.id
            );
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

      const elapsed = Date.now() - t0;
      if (elapsed > 500) {
        console.warn(`[dev-review/queue] took ${elapsed}ms (source=${dataSource}, items=${enriched.length})`);
      }

      res.json({
        ok: true,
        data: enriched,
        meta: {
          dataSource,
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
      const t0 = Date.now();
      const key = String(req.params.key);
      let issueFields: Record<string, unknown> | null = null;
      let detailSource: 'cache' | 'api' = 'cache';

      if (cache) {
        const ci = await cache.getIssue(key);
        if (ci?.fields_json) {
          issueFields = JSON.parse(ci.fields_json);
        }
      }

      // Fallback to live API if not in cache
      if (!issueFields) {
        detailSource = 'api';
        const client = getJiraClient();
        if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }
        const issue = await client.getIssue(key, [
          'summary', 'description', 'status', 'assignee', 'reporter', 'priority',
          'created', 'updated', 'duedate', 'issuetype',
          CF_CURRENT_TIER, CF_TLDR, CF_AGENT_SUMMARY, CF_TROUBLESHOOTING,
          CF_ESCALATION_REASON, CF_EXPECTED_OUTCOME, CF_ISSUE_ENVIRONMENT, CF_NURTUR_PRODUCT,
          CF_DEVELOPMENT_DETAILS, CF_BC_ACCOUNT,
        ]);
        if (!issue) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
        issueFields = issue.fields;
      }

      // Comments: prefer cache, fall back to live API
      let jiraComments: Array<{ id: string; author: { displayName: string; accountId?: string; emailAddress?: string }; body: unknown; created: string; jsdPublic?: boolean }> = [];
      if (cache && syncService?.isReady()) {
        const cached = await cache.getComments(key, 20);
        jiraComments = cached.map(c => ({
          id: c.jira_comment_id,
          author: { displayName: c.author_display ?? 'Unknown', accountId: c.author_account_id ?? undefined, emailAddress: c.author_email ?? undefined },
          body: c.body_adf ? JSON.parse(c.body_adf) : null,
          created: c.jira_created?.toISOString() ?? '',
          jsdPublic: c.is_public,
        }));
      } else {
        const client = getJiraClient();
        if (client) {
          jiraComments = await client.getComments(key, 20).catch(() => []);
        }
      }

      const tComments = Date.now();

      // Trigger background cache refresh for this issue (non-blocking)
      if (syncService) {
        syncService.syncSingleIssue(key).catch(() => {});
      }

      // Batch-fetch known comment IDs in one query (avoids N+1 hasJiraComment)
      const knownCommentIds = await devQueries.getKnownJiraCommentIds(key);
      let importedExternal = 0;
      for (const c of jiraComments) {
        if (knownCommentIds.has(c.id)) continue;
        const body = adfToPlainText(c.body);
        const authorName = c.author?.displayName || 'Unknown';
        await devQueries.addExternalJiraComment({
          jira_key: key,
          author_display: authorName,
          body,
          body_adf: c.body && typeof c.body === 'object' ? c.body : undefined,
          jira_comment_id: c.id,
          author_account_id: c.author?.accountId,
          internal: c.jsdPublic === false,
        });
        importedExternal++;
      }
      // Any new external reply flips waiting_on_assignee → in_review
      if (importedExternal > 0) {
        const cur = await devQueries.getState(key);
        if (cur?.status === 'waiting_on_assignee') {
          await devQueries.setStatus(key, 'in_review');
        }
      }

      const [state, thread] = await Promise.all([
        devQueries.getState(key),
        devQueries.getThread(key),
      ]);

      const elapsed = Date.now() - t0;
      if (elapsed > 500) {
        console.warn(`[dev-review/detail] ${key} took ${elapsed}ms (source=${detailSource}, comments=${Date.now() - tComments}ms, imported=${importedExternal})`);
      }

      let claimed_by_display: string | null = null;
      if (state?.claimed_by_user_id) {
        const u = await userQueries.getById(state.claimed_by_user_id);
        if (u) claimed_by_display = u.display_name || u.username;
      }

      // Resolve ADF media UUIDs → numeric attachment IDs before sending to client
      const allAdfBodies: unknown[] = [];
      for (const t of thread) {
        if (t.body_adf) {
          try { allAdfBodies.push(JSON.parse(t.body_adf)); } catch { /* skip corrupt */ }
        }
      }
      for (const c of jiraComments) {
        if (c.body && typeof c.body === 'object') allAdfBodies.push(c.body);
      }
      const client = getJiraClient();
      if (client && allAdfBodies.length > 0) {
        const attachMap = await buildAttachmentMap(client, key, allAdfBodies);
        if (attachMap.size > 0) {
          for (const t of thread) {
            if (t.body_adf) {
              try {
                const parsed = JSON.parse(t.body_adf);
                resolveAdfMedia(parsed, attachMap);
                (t as any).body_adf = JSON.stringify(parsed);
              } catch { /* skip */ }
            }
          }
          for (const c of jiraComments) {
            if (c.body && typeof c.body === 'object') resolveAdfMedia(c.body, attachMap);
          }
        }
      }

      res.json({ ok: true, data: { key, fields: issueFields, state, thread, jiraComments, claimed_by_display } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'detail failed' });
    }
  });

  // ── Claim guard — actions require the requesting user to hold the claim ──

  async function requireClaim(req: Request, res: Response): Promise<boolean> {
    if (!req.user) { res.status(401).json({ ok: false }); return false; }
    const state = await devQueries.getState(String(req.params.key));
    if (!state || state.claimed_by_user_id !== req.user.id) {
      res.status(403).json({ ok: false, error: 'You must claim this ticket before taking action' });
      return false;
    }
    return true;
  }

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
    if (!await requireClaim(req, res)) return;
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
    if (!await requireClaim(req, res)) return;
    const priority = req.body?.priority as 'low' | 'normal' | 'high';
    if (!['low', 'normal', 'high'].includes(priority)) {
      res.status(400).json({ ok: false, error: 'Invalid priority' }); return;
    }
    await devQueries.setPriority(String(req.params.key), priority);
    res.json({ ok: true });
  });

  // ── Comment (plain internal Jira comment, no status change) ───────────
  //
  // A developer comment is just a comment: it posts to the Jira ticket as an
  // internal note tagged with the dev's name, and changes nothing else.
  // Status transitions are the job of Accept / Return — commenting must not
  // silently flip the ticket. The comment is stored in the local thread first
  // (so it always appears in NOVA), then pushed to Jira; on failure we mark
  // the thread entry failed and enqueue an outbox retry (op='comment').

  router.post('/ticket/:key/comment', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    if (!await requireClaim(req, res)) return;
    const body = String(req.body?.body ?? '').trim();
    if (!body) { res.status(400).json({ ok: false, error: 'Body required' }); return; }

    const key = String(req.params.key);
    const display = await userDisplay(req);
    const prefixed = `🛠️ Developer comment — ${display}\n\n${body}`;
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
      await devQueries.addOutbox({ jira_key: key, op: 'comment', payload: { body: prefixed } });
      res.status(503).json({ ok: false, error: 'Jira not configured' });
      return;
    }

    try {
      // Post as a standalone internal comment, preserving line breaks via ADF.
      // addCommentAdf returns the created comment, whose id we store so the
      // Jira→NOVA import loop doesn't re-import it as an external reply.
      const r = await client.addCommentAdf(key, adfDoc(prefixed), { internal: true });
      const newCommentId = (r as { id?: string } | null)?.id ?? null;
      await devQueries.markThreadSynced(threadId, newCommentId);
      // Purge any stale failed entries from earlier attempts so the
      // Activity panel shows a clean history.
      const purged = await devQueries.purgeFailedThreadEntries(key, threadId);
      if (purged > 0) console.log(`[DevReview/comment] Purged ${purged} stale failed entries for ${key}`);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Comment failed';
      console.error(`[DevReview/comment] Failed to post comment for ${key}: ${msg}`);
      await devQueries.markThreadSyncFailed(threadId, msg);
      await devQueries.addOutbox({ jira_key: key, op: 'comment', payload: { body: prefixed } });
      res.status(502).json({ ok: false, error: msg });
    }
  });

  // ── Accept (Jira transition → Development) ────────────────────────────
  // Sets CurrentTier=Development AND populates the Escalate-to-Development
  // screen fields (TL;DR + Development Details). Both fields are passed as
  // ADF docs since they're configured as rich text in the NT workflow.

  router.post('/ticket/:key/accept', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    if (!await requireClaim(req, res)) return;
    const client = getJiraClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }

    const key = String(req.params.key);
    const note = String(req.body?.note || '').trim();
    const tldr = String(req.body?.tldr || '').trim();
    const developmentDetails = String(req.body?.developmentDetails || '').trim();
    const workItemComment = String(req.body?.workItemComment || '').trim();
    const storyType = String(req.body?.storyType || '').trim();
    const bcAccount = String(req.body?.bcAccount || '').trim();
    const display = await userDisplay(req);

    if (!tldr) {
      res.status(400).json({ ok: false, error: 'TL;DR is required by the Escalate to Development screen' });
      return;
    }
    if (!developmentDetails) {
      res.status(400).json({ ok: false, error: 'Development Details is required by the Escalate to Development screen' });
      return;
    }
    if (!STORY_TYPE_OPTIONS[storyType]) {
      res.status(400).json({ ok: false, error: 'Story Type is required — select one before accepting into development' });
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

    // The Escalate to Development screen now mandates a BC Account number.
    // Set the reviewer-supplied value via a normal edit BEFORE the transition
    // so the validator is satisfied regardless of whether the field survives
    // on the transition screen. Non-fatal on failure — if it's still missing
    // the transition below returns the raw Jira validator error.
    if (bcAccount) {
      try {
        await client.updateFields(key, { [CF_BC_ACCOUNT]: bcAccount });
      } catch (bcErr) {
        console.warn(`[DevReview/accept] Failed to set BC Account number on ${key}: ${bcErr instanceof Error ? bcErr.message : bcErr}`);
      }
    }

    // Step 1 — transition with screen fields + comment. The transition
    // screen mandates TL;DR, Development Details, and Comment. Post-
    // functions clear the assignee, so we restore it in step 2.
    const transitionComment = note || `Accepted into development backlog by ${display}`;
    try {
      try {
        await client.transitionIssue(key, transitionId, {
          fields: {
            [CF_TLDR]: adfDoc(tldr),
            [CF_DEVELOPMENT_DETAILS]: adfDoc(developmentDetails),
          },
          comment: {
            body: adfDoc(transitionComment),
            internal: true,
          },
        });
      } catch (fieldErr: unknown) {
        const fieldMsg = fieldErr instanceof Error ? fieldErr.message : String(fieldErr);
        if (fieldMsg.includes('cannot be set') || fieldMsg.includes('not on the appropriate screen')) {
          console.warn(`[dev-review] ${key}: transition fields rejected, retrying without custom fields`);
          await client.transitionIssue(key, transitionId, {
            comment: {
              body: adfDoc(transitionComment),
              internal: true,
            },
          });
        } else {
          throw fieldErr;
        }
      }
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

    // Step 2 — restore the original assignee (post-functions clear it) AND
    // move CurrentTier off Tier 3 → Development. The Escalate to Development
    // transition doesn't change CurrentTier on its own, so without this the
    // ticket stays at Tier 3 and keeps appearing in the dev review queue.
    // TL;DR + Development Details were already set during the transition.
    // Logged loudly on failure — the accept is already committed in
    // NOVA and the ticket has moved in Jira, so we return ok: true with
    // a warnings list rather than failing the whole request.
    const postUpdatePayload: Record<string, unknown> = {
      [CF_CURRENT_TIER]: { id: TIER_ID_DEVELOPMENT },
    };
    if (originalAssigneeAccountId) {
      postUpdatePayload.assignee = { accountId: originalAssigneeAccountId };
    }
    const warnings: string[] = [];
    try {
      await client.updateFields(key, postUpdatePayload);
    } catch (postErr) {
      const msg = postErr instanceof Error ? postErr.message : 'post-transition update failed';
      console.warn(`[DevReview/accept] Post-transition field update failed for ${key}: ${msg}`);
      warnings.push(`Field update after transition failed (ticket may linger in queue): ${msg}`);
    }
    // Refresh this issue in the Jira cache so the new tier propagates and the
    // ticket drops out of getTier3Issues() promptly — otherwise the queue can
    // re-open the accepted state row on its next poll.
    if (syncService) syncService.syncSingleIssue(key).catch(() => {});

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
        const ticketState = await devQueries.getState(key);
        const ticketTeam = ticketState?.team || 'Unassigned';
        const match = userTeams.find(t => t.jira_products?.includes(ticketTeam));
        targetProjectKey = (match ?? userTeams[0]).jira_project_key?.trim() || null;
      }
    }

    // Fallback: use the ticket's assigned team project key
    if (!targetProjectKey) {
      const ticketState = await devQueries.getState(key);
      const ticketTeam = ticketState?.team;
      if (ticketTeam) {
        const allTeams = await teamQueries.getAll();
        const teamMatch = allTeams.find(t =>
          t.name.toLowerCase() === ticketTeam.toLowerCase() ||
          t.jira_products?.some(p => p.toLowerCase() === ticketTeam.toLowerCase()),
        );
        targetProjectKey = teamMatch?.jira_project_key?.trim() || null;
      }
    }

    if (!targetProjectKey) {
      console.warn(`[DevReview/accept] No jira_project_key for user or ticket team — skipping Bug creation for ${key}`);
      warnings.push('No Jira project key configured for your team — work item not created');
    } else {
      try {
        // Build the same brief Link Existing posts to its work item, so both
        // paths give the developer identical context.
        const brief = await buildWorkItemBrief(client, key, tldr, developmentDetails, workItemComment);
        const nurturProduct = brief.nurturProduct;

        const baseFields = {
          project: { key: targetProjectKey },
          issuetype: { name: 'Bug' },
          summary: `[Support] ${brief.summary}`,
          description: adfDoc(brief.text),
          customfield_14147: { id: '13596' }, // Work Classification: General Maintenance
          [CF_STORY_TYPE]: { id: storyType }, // Story Type — reviewer-selected, mandatory on dev Bug screen
        };
        // Mirror the support ticket's Nurtur Product onto the Bug when set.
        // If the field/option isn't valid for the target project, fall back to
        // creating the Bug without it rather than failing the whole accept.
        let createdBug;
        try {
          createdBug = await client.createIssue({
            fields: {
              ...baseFields,
              ...(nurturProduct ? { [CF_NURTUR_PRODUCT]: { value: nurturProduct } } : {}),
            },
          });
        } catch (createErr: unknown) {
          const createMsg = createErr instanceof Error ? createErr.message : String(createErr);
          if (nurturProduct && (createMsg.includes('cannot be set') || createMsg.includes('not on the appropriate screen') || createMsg.includes('customfield_13183'))) {
            console.warn(`[DevReview/accept] Nurtur Product rejected for ${targetProjectKey}, creating Bug without it: ${createMsg}`);
            warnings.push(`Bug created without Nurtur Product (not valid for ${targetProjectKey})`);
            createdBug = await client.createIssue({ fields: baseFields });
          } else {
            throw createErr;
          }
        }
        workItemKey = createdBug.key;
        console.log(`[DevReview/accept] Created Bug ${workItemKey} in ${targetProjectKey} for ${key}`);
        await devQueries.markAccepted(key, workItemKey);

        // Link the Bug to the NT support ticket
        try {
          await client.createIssueLink({
            type: { name: 'Developer Escalations' },
            outwardIssue: { key: createdBug.key },
            inwardIssue: { key },
          });
        } catch (linkErr) {
          const msg = linkErr instanceof Error ? linkErr.message : 'Link creation failed';
          console.error(`[DevReview/accept] Issue link failed for ${key} → ${createdBug.key}: ${msg}`);
          warnings.push(`Bug created (${createdBug.key}) but link failed: ${msg}`);
        }

        // Post customer-facing comment on the NT ticket
        try {
          const customerComment =
            `Thank you for raising this with us.\n\n` +
            `Following review by our Development team, this has been confirmed as requiring development work and has now been accepted into our development pipeline.\n\n` +
            `Your reference for this work is ${createdBug.key} — please quote this in any follow-up communication.\n\n` +
            `Development work is prioritised alongside our wider roadmap and may take up to 60 working days to complete, depending on prioritisation.\n\n` +
            `We'll keep you updated as this progresses. If you have any concerns or need to discuss prioritisation, please contact your Account Manager.`;
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

  // ── Link Existing (skip Bug creation, link user-supplied work item) ───
  // Mirrors Accept but instead of creating a new Bug, validates and links
  // an existing Jira work item provided by the reviewer.

  router.post('/ticket/:key/link-existing', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    if (!await requireClaim(req, res)) return;
    const client = getJiraClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }

    const key = String(req.params.key);
    const workItemKey = String(req.body?.workItemKey || '').trim();
    const note = String(req.body?.note || '').trim();
    const tldr = String(req.body?.tldr || '').trim();
    const developmentDetails = String(req.body?.developmentDetails || '').trim();
    const workItemComment = String(req.body?.workItemComment || '').trim();
    const bcAccount = String(req.body?.bcAccount || '').trim();
    const display = await userDisplay(req);

    if (!workItemKey || !/^[A-Z]+-\d+$/.test(workItemKey)) {
      res.status(400).json({ ok: false, error: 'A valid Jira work item key is required (e.g. BYM-1234)' });
      return;
    }
    if (!tldr) {
      res.status(400).json({ ok: false, error: 'TL;DR is required by the Escalate to Development screen' });
      return;
    }
    if (!developmentDetails) {
      res.status(400).json({ ok: false, error: 'Development Details is required by the Escalate to Development screen' });
      return;
    }

    // Validate the work item actually exists in Jira
    try {
      await client.getIssue(workItemKey, ['summary', 'status']);
    } catch (lookupErr) {
      const msg = lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
      res.status(400).json({ ok: false, error: `Work item not found: ${workItemKey}` });
      return;
    }

    const threadId = await devQueries.addThreadEntry({
      jira_key: key,
      user_id: req.user.id,
      user_display: display,
      kind: 'link_existing',
      body: note || `Linked to existing work item ${workItemKey}`,
      meta: { tldr, developmentDetails, workItemKey },
      syncState: 'pending',
    });

    // Capture the current assignee BEFORE the transition
    let originalAssigneeAccountId: string | null = null;
    try {
      const currentIssue = await client.getIssue(key, ['assignee']);
      const assignee = (currentIssue?.fields as { assignee?: { accountId?: string } | null } | undefined)?.assignee;
      originalAssigneeAccountId = assignee?.accountId ?? null;
    } catch { /* non-fatal */ }

    // Discover and execute Escalate to Development transition (same logic as Accept)
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
    if (transitionId) {
      const available = await findTransitionByName(new RegExp(`^${transitionId}$`));
      if (!available) transitionId = '';
    }
    if (!transitionId) {
      transitionId = (await findTransitionByName(/escalate.*development/i)) || '';
    }
    if (!transitionId) {
      const wipId = await findTransitionByName(/work\s*in\s*progress|^wip$/i);
      if (wipId) {
        try {
          await client.transitionIssue(key, wipId);
          transitionId = (await findTransitionByName(/escalate.*development/i)) || '';
        } catch (wipErr) {
          console.warn(`[DevReview/link-existing] WIP pre-transition failed for ${key}: ${wipErr instanceof Error ? wipErr.message : wipErr}`);
        }
      }
    }
    if (!transitionId) {
      const msg = 'Escalate to Development transition not reachable from current status';
      await devQueries.markThreadSyncFailed(threadId, msg);
      res.status(409).json({ ok: false, error: msg });
      return;
    }

    // The Escalate to Development screen mandates a BC Account number. Set the
    // reviewer-supplied value before the transition so the validator passes.
    if (bcAccount) {
      try {
        await client.updateFields(key, { [CF_BC_ACCOUNT]: bcAccount });
      } catch (bcErr) {
        console.warn(`[DevReview/link-existing] Failed to set BC Account number on ${key}: ${bcErr instanceof Error ? bcErr.message : bcErr}`);
      }
    }

    // Step 1 — transition with screen fields + comment
    const transitionComment = note || `Linked to existing work item ${workItemKey} by ${display}`;
    try {
      try {
        await client.transitionIssue(key, transitionId, {
          fields: {
            [CF_TLDR]: adfDoc(tldr),
            [CF_DEVELOPMENT_DETAILS]: adfDoc(developmentDetails),
          },
          comment: {
            body: adfDoc(transitionComment),
            internal: true,
          },
        });
      } catch (fieldErr: unknown) {
        const fieldMsg = fieldErr instanceof Error ? fieldErr.message : String(fieldErr);
        if (fieldMsg.includes('cannot be set') || fieldMsg.includes('not on the appropriate screen')) {
          console.warn(`[dev-review] ${key}: transition fields rejected, retrying without custom fields`);
          await client.transitionIssue(key, transitionId, {
            comment: {
              body: adfDoc(transitionComment),
              internal: true,
            },
          });
        } else {
          throw fieldErr;
        }
      }
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
    await devQueries.markAccepted(key, workItemKey);

    // Step 2 — restore the original assignee AND move CurrentTier off Tier 3
    // → Development so the ticket leaves the dev review queue (the transition
    // doesn't change CurrentTier on its own).
    const warnings: string[] = [];
    const postUpdatePayload: Record<string, unknown> = {
      [CF_CURRENT_TIER]: { id: TIER_ID_DEVELOPMENT },
    };
    if (originalAssigneeAccountId) {
      postUpdatePayload.assignee = { accountId: originalAssigneeAccountId };
    }
    try {
      await client.updateFields(key, postUpdatePayload);
    } catch (postErr) {
      const msg = postErr instanceof Error ? postErr.message : 'post-transition update failed';
      console.warn(`[DevReview/link-existing] Post-transition field update failed for ${key}: ${msg}`);
      warnings.push(`Field update after transition failed (ticket may linger in queue): ${msg}`);
    }
    // Refresh the Jira cache so the tier change propagates and the ticket
    // drops out of getTier3Issues() promptly.
    if (syncService) syncService.syncSingleIssue(key).catch(() => {});

    // Step 3 — internal comment aimed at the T2 agent (fire-and-forget)
    const agentNoticeText =
      `📋 Action required — ${display} has accepted this ticket into the development backlog.\n\n` +
      `Please update the customer to let them know their ticket is now with the development team. ` +
      `You can expect updates from development every 5 working days. ` +
      `If there is no update after 5 working days, chase via the Jira comment thread.`;
    client.addComment(key, agentNoticeText, { internal: true }).catch((noticeErr) => {
      console.warn(`[DevReview/link-existing] Failed to post agent-notice comment for ${key}: ${noticeErr instanceof Error ? noticeErr.message : noticeErr}`);
    });

    // Step 4 — link the existing work item to the NT support ticket
    try {
      await client.createIssueLink({
        type: { name: 'Developer Escalations' },
        outwardIssue: { key: workItemKey },
        inwardIssue: { key },
      });
    } catch (linkErr) {
      const msg = linkErr instanceof Error ? linkErr.message : 'Link creation failed';
      console.error(`[DevReview/link-existing] Issue link failed for ${key} → ${workItemKey}: ${msg}`);
      warnings.push(`Link creation failed: ${msg}`);
    }

    // Step 4b — post the support-ticket brief onto the existing work item.
    // Accept embeds this in a NEW Bug's description; here we can't overwrite an
    // existing item's description, so we post the same brief as a comment so
    // the developer has identical context. Non-fatal on failure.
    try {
      const brief = await buildWorkItemBrief(client, key, tldr, developmentDetails, workItemComment);
      const workItemBrief = `🔗 Linked from support ticket ${key} by ${display}\n\n${brief.text}`;
      await client.addComment(workItemKey, workItemBrief);
    } catch (briefErr) {
      const msg = briefErr instanceof Error ? briefErr.message : 'Work item brief failed';
      console.error(`[DevReview/link-existing] Failed to post brief to ${workItemKey}: ${msg}`);
      warnings.push(`Linked ${workItemKey} but couldn't post the support brief to it: ${msg}`);
    }

    // Step 5 — customer-facing comment
    try {
      const customerComment =
        `Thank you for raising this with us.\n\n` +
        `Following review by our Development team, this has been confirmed as requiring development work and has been linked to an existing item in our development pipeline.\n\n` +
        `Your reference for this work is ${workItemKey} — please quote this in any follow-up communication.\n\n` +
        `We'll keep you updated as this progresses. If you have any concerns or need to discuss prioritisation, please contact your Account Manager.`;
      await client.addComment(key, customerComment);
    } catch (commentErr) {
      const msg = commentErr instanceof Error ? commentErr.message : 'Customer comment failed';
      console.error(`[DevReview/link-existing] Customer comment failed for ${key}: ${msg}`);
      warnings.push(`Customer comment failed: ${msg}`);
    }

    res.json({ ok: true, workItemKey, warnings: warnings.length > 0 ? warnings : undefined });
  });

  // ── Return (back to T2 with mandatory next steps) ─────────────────────

  router.post('/ticket/:key/return', async (req: Request, res: Response) => {
    if (!req.user) { res.status(401).json({ ok: false }); return; }
    if (!await requireClaim(req, res)) return;
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
      internal: true,
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
        await client.addComment(String(req.params.key), commentText, { internal: true });
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
      await devQueries.unclaim(String(req.params.key));

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

  // ── Backfill body_adf for existing thread entries ─────────────────────
  router.post('/backfill-adf', async (req: Request, res: Response) => {
    if (!req.user || !isAdmin(req.user.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    const client = getJiraClient();
    if (!client) { res.status(503).json({ ok: false, error: 'No Jira client available' }); return; }

    try {
      // Find all thread entries with a jira_comment_id but no body_adf
      const rows = await devQueries.getThreadEntriesMissingAdf();
      const keyGroups = new Map<string, Array<{ id: number; jira_comment_id: string }>>();
      for (const r of rows) {
        const group = keyGroups.get(r.jira_key) ?? [];
        group.push({ id: r.id, jira_comment_id: r.jira_comment_id });
        keyGroups.set(r.jira_key, group);
      }

      let updated = 0;
      let failed = 0;
      for (const [key, entries] of keyGroups) {
        try {
          const comments = await client.getComments(key, 50);
          const byId = new Map(comments.map(c => [c.id, c]));
          for (const entry of entries) {
            const jiraComment = byId.get(entry.jira_comment_id);
            if (jiraComment?.body && typeof jiraComment.body === 'object') {
              await devQueries.updateThreadAdf(entry.id, JSON.stringify(jiraComment.body));
              updated++;
            }
          }
        } catch (err) {
          console.warn(`[backfill-adf] Failed for ${key}: ${err instanceof Error ? err.message : err}`);
          failed++;
        }
      }

      console.log(`[backfill-adf] Done: ${updated} updated, ${failed} tickets failed, ${keyGroups.size} tickets scanned`);
      res.json({ ok: true, data: { tickets_scanned: keyGroups.size, entries_updated: updated, tickets_failed: failed } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backfill failed' });
    }
  });

  return router;
}
