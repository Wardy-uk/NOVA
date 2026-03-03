import { Router } from 'express';
import type { TaskQueries, UserSettingsQueries } from '../db/queries.js';
import type { McpClientManager } from '../services/mcp-client.js';
import { JiraRestClient, JiraApiError } from '../services/jira-client.js';
import { getLastJiraSearchText } from '../services/aggregator.js';

const JIRA_TOOL_CANDIDATES = {
  getIssue: ['jira_get_issue', 'jira_get_issue_by_key', 'jira_issue_get'],
  updateIssue: ['update_issue', 'jira_update_issue', 'jira_update_issue_fields'],
  addComment: ['jira_add_comment', 'jira_create_comment'],
  listTransitions: ['jira_get_transitions', 'jira_list_transitions'],
  transitionIssue: ['transition_issue', 'jira_transition_issue', 'jira_do_transition', 'jira_transition'],
  createIssue: ['jira_create_issue', 'jira_create'],
  searchIssues: ['jira_search', 'jira_search_issues', 'searchJiraIssuesUsingJql'],
  getProjects: ['jira_get_projects', 'getVisibleJiraProjects', 'getVisibleJiraProjectsList'],
  searchUsers: ['jira_search_users', 'jira_find_users', 'jira_get_users', 'jira_user_search'],
};

type ToolKey = keyof typeof JIRA_TOOL_CANDIDATES;

function pickTool(tools: string[], key: ToolKey): string | null {
  const candidates = JIRA_TOOL_CANDIDATES[key];
  for (const name of candidates) {
    if (tools.includes(name)) return name;
  }
  return null;
}

function parseToolResult(result: unknown): unknown {
  const obj = result as { content?: Array<{ text?: string }> };
  const text = obj?.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function callWithFallback(
  mcp: McpClientManager,
  toolName: string,
  argsList: Array<Record<string, unknown>>
): Promise<unknown> {
  let lastError: unknown;
  for (let i = 0; i < argsList.length; i++) {
    const args = argsList[i];
    try {
      console.log(`[Jira] callWithFallback ${toolName} attempt ${i + 1}/${argsList.length}: ${JSON.stringify(Object.keys(args))}`);
      const result = await mcp.callTool('jira', toolName, args);
      // MCP tools can return isError: true without throwing
      const obj = result as { isError?: boolean; content?: Array<{ text?: string }> };
      if (obj?.isError) {
        const errText = obj.content?.[0]?.text ?? 'MCP tool returned error';
        console.warn(`[Jira] ${toolName} attempt ${i + 1} isError: ${errText.slice(0, 300)}`);
        lastError = new Error(errText);
        continue; // try next arg variant
      }
      return result;
    } catch (err) {
      console.warn(`[Jira] ${toolName} attempt ${i + 1} threw: ${err instanceof Error ? err.message.slice(0, 300) : err}`);
      lastError = err;
    }
  }
  throw lastError ?? new Error('Unknown Jira tool error');
}

// Jira option-type custom fields — REST API requires { value: "..." } wrapping
const OPTION_FIELDS = new Set([
  'customfield_13183',  // Nurtur Product
  'customfield_12981',  // Current Tier
]);

// Jira rich-text fields — REST API requires Atlassian Document Format (ADF)
const ADF_FIELDS = new Set([
  'customfield_13184',  // TL;DR
  'description',
]);

/** Wrap a plain string in minimal ADF document format. */
function toAdf(text: string): object {
  return {
    version: 1,
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

/** Format field values for the Jira REST API.
 *  Option fields → { value: "..." }, ADF fields → doc format, others → as-is. */
function formatFieldsForRest(fields: Record<string, unknown>): Record<string, unknown> {
  const formatted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (val && typeof val === 'string' && OPTION_FIELDS.has(key)) {
      formatted[key] = { value: val };
    } else if (val && typeof val === 'string' && ADF_FIELDS.has(key)) {
      formatted[key] = toAdf(val);
    } else {
      formatted[key] = val;
    }
  }
  return formatted;
}

export function createJiraRoutes(
  mcpManager: McpClientManager,
  taskQueries: TaskQueries,
  getJiraClient?: () => JiraRestClient | null,
  getSettings?: () => Record<string, string>,
  userSettingsQueries?: UserSettingsQueries
): Router {
  /** Build a JiraRestClient for the requesting user.
   *  Personal credentials first → then global fallback. */
  function getClientForUser(userId?: number): JiraRestClient | null {
    if (userId && userSettingsQueries) {
      // 1. Per-user OAuth tokens (from Jira OAuth login)
      const cloudId = userSettingsQueries.get(userId, 'jira_cloud_id');
      const accessToken = userSettingsQueries.get(userId, 'jira_access_token');
      if (cloudId && accessToken) {
        return new JiraRestClient({ cloudId, accessToken });
      }

      // 2. Per-user Basic auth credentials (from My Settings > Jira)
      const userEnabled = userSettingsQueries.get(userId, 'jira_enabled');
      const userUrl = userSettingsQueries.get(userId, 'jira_url');
      const userEmail = userSettingsQueries.get(userId, 'jira_username');
      const userToken = userSettingsQueries.get(userId, 'jira_token');
      if (userEnabled === 'true' && userUrl && userEmail && userToken) {
        return new JiraRestClient({ baseUrl: userUrl, email: userEmail, apiToken: userToken });
      }
    }

    // 3. Fall back to global client (Admin > Jira Global)
    return getJiraClient?.() ?? null;
  }
  const router = Router();

  router.get('/tools', (_req, res) => {
    res.json({ ok: true, data: { tools: mcpManager.getServerTools('jira') } });
  });

  router.get('/debug/last-search', (_req, res) => {
    res.json({ ok: true, data: { text: getLastJiraSearchText() } });
  });

  router.get('/issues/:key', async (req, res) => {
    const key = req.params.key;
    const tools = mcpManager.getServerTools('jira');
    const toolName = pickTool(tools, 'getIssue');

    if (!toolName) {
      const task = taskQueries.getById(`jira:${key}`);
      if (!task?.raw_data) {
        res.status(501).json({
          ok: false,
          error: 'Jira get issue tool not available',
          tools,
        });
        return;
      }
      res.json({ ok: true, data: task.raw_data });
      return;
    }

    try {
      const result = await callWithFallback(mcpManager, toolName, [
        { issue_key: key },
        { issueKey: key },
        { key },
        { id: key },
        { issueIdOrKey: key },
      ]);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch issue',
      });
    }
  });

  router.get('/issues/:key/editmeta', async (req, res) => {
    const key = req.params.key;
    const userId = (req as any).user?.id as number | undefined;
    console.log(`[Jira] editmeta request for ${key}, userId=${userId}`);
    const restClient = getClientForUser(userId);
    if (!restClient) {
      console.warn(`[Jira] editmeta for ${key}: No REST client available (userId=${userId})`);
      res.status(501).json({ ok: false, error: 'No Jira REST client available' });
      return;
    }
    try {
      const meta = await restClient.getEditMeta(key);
      const fieldKeys = meta?.fields ? Object.keys(meta.fields as object) : [];
      console.log(`[Jira] editmeta for ${key}: ${fieldKeys.length} fields — keys: ${fieldKeys.slice(0, 15).join(', ')}${fieldKeys.length > 15 ? '...' : ''}`);
      res.json({ ok: true, data: meta });
    } catch (err) {
      console.error(`[Jira] editmeta for ${key} failed:`, err instanceof Error ? err.message : err);
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch edit metadata',
      });
    }
  });

  router.get('/issues/:key/transitions', async (req, res) => {
    const key = req.params.key;
    const tools = mcpManager.getServerTools('jira');
    const toolName = pickTool(tools, 'listTransitions');
    if (!toolName) {
      res.status(501).json({
        ok: false,
        error: 'Jira transitions tool not available',
        tools,
      });
      return;
    }

    try {
      const result = await callWithFallback(mcpManager, toolName, [
        { issue_key: key },
        { issueKey: key },
        { key },
        { id: key },
        { issueIdOrKey: key },
      ]);

      // Fetch field options from REST transitions API (has per-transition field screens)
      // AND editmeta (has general edit screen fields). Merge both for complete coverage.
      // Also build per-transition field metadata for the UI debug log.
      let fieldOptions: Record<string, Array<{ value: string; id?: string }>> | undefined;
      let transitionFields: Record<string, Array<{
        key: string; name: string; required: boolean; type: string;
        allowedValues?: Array<{ value: string; id?: string }>;
      }>> | undefined;
      try {
        const userId = (req as any).user?.id as number | undefined;
        const restClient = getClientForUser(userId);
        if (restClient) {
          fieldOptions = {};
          transitionFields = {};

          // 1. Transition fields — includes fields only available during transitions
          try {
            const txnData = await restClient.getTransitionsWithFields(key);
            const txns = (txnData as Record<string, unknown>)?.transitions as Array<Record<string, unknown>> | undefined;
            if (txns) {
              for (const txn of txns) {
                const txnName = (txn.name as string) ?? String(txn.id);
                const txnId = String(txn.id);
                const txnFields = txn.fields as Record<string, Record<string, unknown>> | undefined;

                // Build per-transition field list
                const fieldList: typeof transitionFields[string] = [];
                if (txnFields) {
                  for (const [fieldKey, fieldMeta] of Object.entries(txnFields)) {
                    const schema = fieldMeta?.schema as Record<string, unknown> | undefined;
                    const fieldEntry: typeof fieldList[number] = {
                      key: fieldKey,
                      name: (fieldMeta?.name as string) ?? fieldKey,
                      required: !!(fieldMeta?.required),
                      type: (schema?.type as string) ?? (schema?.custom as string) ?? 'unknown',
                    };
                    const allowed = fieldMeta?.allowedValues as Array<Record<string, unknown>> | undefined;
                    if (allowed && allowed.length > 0) {
                      const mapped = allowed.map((v) => ({
                        value: (v.value as string) ?? (v.name as string) ?? String(v.id),
                        id: v.id as string | undefined,
                      })).filter((v) => v.value);
                      fieldEntry.allowedValues = mapped;
                      // Also populate top-level fieldOptions
                      if (!fieldOptions![fieldKey]) {
                        fieldOptions![fieldKey] = mapped;
                      }
                    }
                    fieldList.push(fieldEntry);
                  }
                }
                transitionFields[`${txnId}:${txnName}`] = fieldList;
              }
            }
            console.log(`[Jira] transition fields for ${key}: ${Object.keys(fieldOptions).length} fields with options — ${JSON.stringify(Object.keys(fieldOptions))}`);
          } catch (txnErr) {
            console.warn(`[Jira] transition fields for ${key} failed:`, txnErr instanceof Error ? txnErr.message : txnErr);
          }

          // 2. Editmeta fields — includes fields editable on the standard edit screen
          try {
            const meta = await restClient.getEditMeta(key);
            const fields = (meta as Record<string, unknown>)?.fields as Record<string, Record<string, unknown>> | undefined;
            if (fields) {
              for (const [fieldKey, fieldMeta] of Object.entries(fields)) {
                if (fieldOptions[fieldKey]) continue; // transition fields take priority
                const allowed = fieldMeta?.allowedValues as Array<Record<string, unknown>> | undefined;
                if (allowed && allowed.length > 0) {
                  fieldOptions[fieldKey] = allowed.map((v) => ({
                    value: (v.value as string) ?? (v.name as string) ?? String(v.id),
                    id: v.id as string | undefined,
                  })).filter((v) => v.value);
                }
              }
              console.log(`[Jira] editmeta for ${key}: total ${Object.keys(fieldOptions).length} fields with options`);
            }
          } catch (editErr) {
            console.warn(`[Jira] editmeta for ${key} failed:`, editErr instanceof Error ? editErr.message : editErr);
          }

          // 3. Direct field context API — fallback for option fields not found above
          for (const optField of OPTION_FIELDS) {
            if (fieldOptions[optField]) continue; // already have options
            try {
              const opts = await restClient.getFieldOptions(optField);
              if (opts.length > 0) {
                fieldOptions[optField] = opts.map((v) => ({ value: v.value, id: v.id }));
                console.log(`[Jira] field context for ${optField}: ${opts.length} options`);
              }
            } catch (fieldErr) {
              console.warn(`[Jira] field context for ${optField} failed:`, fieldErr instanceof Error ? fieldErr.message : fieldErr);
            }
          }

          console.log(`[Jira] final fieldOptions for ${key}: ${JSON.stringify(Object.keys(fieldOptions))}`);
        }
      } catch (outerErr) {
        console.warn(`[Jira] field options for ${key} failed:`, outerErr instanceof Error ? outerErr.message : outerErr);
      }

      res.json({ ok: true, data: parseToolResult(result), fieldOptions, transitionFields });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch transitions',
      });
    }
  });

  router.patch('/issues/:key', async (req, res) => {
    const key = req.params.key;
    const userId = (req as any).user?.id as number | undefined;
    const restClient = getClientForUser(userId);

    const { fields, comment, commentVisibility, transition } = req.body as {
      fields?: Record<string, unknown>;
      comment?: string;
      commentVisibility?: 'internal' | 'public';
      transition?: string;
    };

    const results: Record<string, unknown> = {};

    try {
      // When transitioning, only send fields that are on the transition screen.
      // Fields not on the screen are sent as a separate update afterwards.
      if (transition && restClient) {
        const transId = String(transition);

        // Discover which fields the transition screen accepts
        let screenFields: Set<string> | null = null;
        try {
          const txnData = await restClient.getTransitionsWithFields(key);
          const txns = (txnData as Record<string, unknown>)?.transitions as Array<Record<string, unknown>> | undefined;
          const match = txns?.find((t) => String(t.id) === transId);
          if (match?.fields) {
            screenFields = new Set(Object.keys(match.fields as Record<string, unknown>));
          }
        } catch (e) {
          console.warn(`[Jira] Could not fetch transition screen fields for ${key}:`, e instanceof Error ? e.message : e);
        }

        // Split fields into those on the transition screen vs those that need a separate update
        let transitionFormatted: Record<string, unknown> | undefined;
        let remainingFields: Record<string, unknown> | undefined;
        if (fields && Object.keys(fields).length > 0) {
          if (screenFields) {
            const onScreen: Record<string, unknown> = {};
            const offScreen: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(fields)) {
              if (screenFields.has(k)) onScreen[k] = v;
              else offScreen[k] = v;
            }
            if (Object.keys(onScreen).length > 0) transitionFormatted = formatFieldsForRest(onScreen);
            if (Object.keys(offScreen).length > 0) remainingFields = offScreen;
            console.log(`[Jira] Transition ${transId} screen fields: [${[...screenFields].join(',')}], sending: [${Object.keys(onScreen).join(',')}], deferred: [${Object.keys(offScreen).join(',')}]`);
          } else {
            // Couldn't determine screen fields — send all (best effort)
            transitionFormatted = formatFieldsForRest(fields);
          }
        }

        // Add comment BEFORE the transition so it appears before the status change
        if (comment?.trim()) {
          const visibility = commentVisibility === 'internal'
            ? { type: 'role', value: getSettings?.()?.jira_internal_comment_role || 'Service Desk Team' }
            : undefined;
          console.log(`[Jira] Adding comment to ${key} before transition (${commentVisibility})`);
          await restClient.addComment(key, comment.trim(), visibility ? { visibility } : undefined);
          results.comment = { ok: true };
        }

        console.log(`[Jira] Transitioning ${key} to ${transId} via REST (fields: ${transitionFormatted ? Object.keys(transitionFormatted).join(',') : 'none'})`);
        await restClient.transitionIssue(key, transId, {
          fields: transitionFormatted,
        });
        results.transition = { ok: true };
        if (transitionFormatted) results.update = { ok: true };

        // Send deferred fields as a separate update (not on transition screen)
        if (remainingFields && Object.keys(remainingFields).length > 0) {
          try {
            const formatted = formatFieldsForRest(remainingFields);
            console.log(`[Jira] Updating deferred fields on ${key} via REST:`, JSON.stringify(formatted));
            await restClient.updateFields(key, formatted);
            results.deferredUpdate = { ok: true, fields: Object.keys(remainingFields) };
          } catch (deferErr) {
            console.warn(`[Jira] Deferred field update on ${key} failed:`, deferErr instanceof Error ? deferErr.message : deferErr);
            results.deferredUpdate = { ok: false, error: deferErr instanceof Error ? deferErr.message : String(deferErr) };
          }
        }
      } else {
        // No transition — update fields and comment separately

        // 1. Update fields — prefer REST, fall back to MCP
        if (fields && Object.keys(fields).length > 0) {
          if (restClient) {
            const formatted = formatFieldsForRest(fields);
            console.log(`[Jira] Updating fields on ${key} via REST:`, JSON.stringify(formatted));
            await restClient.updateFields(key, formatted);
            results.update = { ok: true };
          } else {
            const tools = mcpManager.getServerTools('jira');
            const updateTool = pickTool(tools, 'updateIssue');
            if (updateTool) {
              const result = await callWithFallback(mcpManager, updateTool, [
                { issue_key: key, fields: JSON.stringify(fields) },
              ]);
              results.update = parseToolResult(result);
            }
          }
        }

        // 2. Add comment — prefer REST (supports visibility), fall back to MCP
        if (comment) {
          if (restClient) {
            const visibility = commentVisibility === 'internal'
              ? { type: 'role', value: getSettings?.()?.jira_internal_comment_role || 'Service Desk Team' }
              : undefined;
            console.log(`[Jira] Adding ${commentVisibility ?? 'public'} comment on ${key} via REST`);
            results.comment = await restClient.addComment(key, comment, visibility ? { visibility } : undefined);
          } else {
            const tools = mcpManager.getServerTools('jira');
            const commentTool = pickTool(tools, 'addComment');
            if (commentTool) {
              const result = await callWithFallback(mcpManager, commentTool, [
                { issue_key: key, body: comment },
              ]);
              results.comment = parseToolResult(result);
            }
          }
        }

        // 3. Transition (no REST client — MCP fallback)
        if (transition) {
          const transId = String(transition);
          const tools = mcpManager.getServerTools('jira');
          const transitionTool = pickTool(tools, 'transitionIssue');
          if (transitionTool) {
            const result = await callWithFallback(mcpManager, transitionTool, [
              { issue_key: key, transition_id: transId },
            ]);
            results.transition = parseToolResult(result);
          } else {
            throw new Error('No REST client or MCP transition tool available');
          }
        }
      }

      res.json({ ok: true, data: results });
    } catch (err) {
      const detail = err instanceof JiraApiError
        ? JSON.stringify(err.body, null, 2)
        : err instanceof Error ? err.message : String(err);
      console.error(`[Jira] PATCH ${key} failed:`, detail);
      res.status(500).json({
        ok: false,
        error: err instanceof JiraApiError
          ? `Jira API ${err.statusCode}: ${JSON.stringify(err.body)}`
          : err instanceof Error ? err.message : 'Failed to update issue',
      });
    }
  });

  // --- Jira Automations ---

  // Search issues with JQL
  router.post('/search', async (req, res) => {
    const tools = mcpManager.getServerTools('jira');
    const toolName = pickTool(tools, 'searchIssues');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Jira search tool not available', tools });
      return;
    }

    const { jql, limit } = req.body as { jql: string; limit?: number };
    if (!jql?.trim()) {
      res.status(400).json({ ok: false, error: 'JQL query is required' });
      return;
    }

    try {
      const result = await callWithFallback(mcpManager, toolName, [
        { jql, limit: limit ?? 20 },
        { query: jql, max_results: limit ?? 20 },
        { jql, maxResults: limit ?? 20 },
      ]);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'JQL search failed',
      });
    }
  });

  // List projects
  router.get('/projects', async (_req, res) => {
    const tools = mcpManager.getServerTools('jira');
    const toolName = pickTool(tools, 'getProjects');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Jira projects tool not available', tools });
      return;
    }

    try {
      const result = await mcpManager.callTool('jira', toolName, {});
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch projects',
      });
    }
  });

  // Create issue
  router.post('/issues', async (req, res) => {
    const tools = mcpManager.getServerTools('jira');
    const toolName = pickTool(tools, 'createIssue');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Jira create issue tool not available', tools });
      return;
    }

    const { project_key, issue_type, summary, description } = req.body as {
      project_key: string;
      issue_type: string;
      summary: string;
      description?: string;
    };

    if (!project_key || !summary) {
      res.status(400).json({ ok: false, error: 'project_key and summary are required' });
      return;
    }

    try {
      const result = await callWithFallback(mcpManager, toolName, [
        { project_key, issue_type: issue_type || 'Task', summary, description: description ?? '' },
        { projectKey: project_key, issueType: issue_type || 'Task', summary, description: description ?? '' },
      ]);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to create issue',
      });
    }
  });

  // Batch Jira status lookup — returns status info for multiple keys at once
  router.post('/batch-status', async (req, res) => {
    const { keys } = req.body as { keys?: string[] };
    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      res.json({ ok: true, data: {} });
      return;
    }
    // Cap at 50 keys per request (JQL IN clause limit)
    const trimmed = keys.slice(0, 50);

    const userId = (req as any).user?.id as number | undefined;
    const client = getClientForUser(userId);
    if (!client) {
      res.status(501).json({ ok: false, error: 'No Jira client available' });
      return;
    }

    try {
      const jql = `key IN (${trimmed.map(k => `"${k}"`).join(',')})`;
      const result = await client.searchJql(jql, ['summary', 'status', 'priority', 'assignee', 'duedate'], trimmed.length);
      const statuses: Record<string, {
        status: string;
        statusCategory: string;
        summary: string;
        assignee: string | null;
        priority: string | null;
        duedate: string | null;
      }> = {};
      for (const issue of result.issues) {
        const fields = issue.fields ?? {};
        const statusObj = fields.status as { name?: string; statusCategory?: { name?: string; key?: string } } | undefined;
        const assigneeObj = fields.assignee as { displayName?: string } | undefined;
        const priorityObj = fields.priority as { name?: string } | undefined;
        statuses[issue.key] = {
          status: statusObj?.name ?? 'Unknown',
          statusCategory: statusObj?.statusCategory?.key ?? statusObj?.statusCategory?.name ?? 'undefined',
          summary: (fields.summary as string) ?? '',
          assignee: assigneeObj?.displayName ?? null,
          priority: priorityObj?.name ?? null,
          duedate: (fields.duedate as string) ?? null,
        };
      }
      res.json({ ok: true, data: statuses });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Batch status fetch failed',
      });
    }
  });

  // Search users (for assignee picker)
  router.get('/users/search', async (req, res) => {
    const query = (req.query.query as string ?? '').trim();
    if (!query) {
      res.status(400).json({ ok: false, error: 'query parameter is required' });
      return;
    }

    const tools = mcpManager.getServerTools('jira');
    const toolName = pickTool(tools, 'searchUsers');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Jira user search tool not available', tools });
      return;
    }

    try {
      const result = await callWithFallback(mcpManager, toolName, [
        { query },
        { query, maxResults: 10 },
        { username: query },
        { search: query },
      ]);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'User search failed',
      });
    }
  });

  return router;
}
