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
  /** Build a JiraRestClient for the requesting user — tries global client first,
   *  then per-user OAuth tokens. */
  function getClientForUser(userId?: number): JiraRestClient | null {
    // 1. Try global / onboarding client
    const globalClient = getJiraClient?.() ?? null;
    if (globalClient) return globalClient;

    // 2. Try per-user OAuth tokens
    if (userId && userSettingsQueries) {
      const cloudId = userSettingsQueries.get(userId, 'jira_cloud_id');
      const accessToken = userSettingsQueries.get(userId, 'jira_access_token');
      if (cloudId && accessToken) {
        return new JiraRestClient({ cloudId, accessToken });
      }
    }

    return null;
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
      let fieldOptions: Record<string, Array<{ value: string; id?: string }>> | undefined;
      try {
        const userId = (req as any).user?.id as number | undefined;
        const restClient = getClientForUser(userId);
        if (restClient) {
          fieldOptions = {};

          // 1. Transition fields — includes fields only available during transitions
          try {
            const txnData = await restClient.getTransitionsWithFields(key);
            const txns = (txnData as Record<string, unknown>)?.transitions as Array<Record<string, unknown>> | undefined;
            if (txns) {
              for (const txn of txns) {
                const txnFields = txn.fields as Record<string, Record<string, unknown>> | undefined;
                if (!txnFields) continue;
                for (const [fieldKey, fieldMeta] of Object.entries(txnFields)) {
                  if (fieldOptions[fieldKey]) continue; // already have options for this field
                  const allowed = fieldMeta?.allowedValues as Array<Record<string, unknown>> | undefined;
                  if (allowed && allowed.length > 0) {
                    fieldOptions[fieldKey] = allowed.map((v) => ({
                      value: (v.value as string) ?? (v.name as string) ?? String(v.id),
                      id: v.id as string | undefined,
                    })).filter((v) => v.value);
                  }
                }
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
        }
      } catch (outerErr) {
        console.warn(`[Jira] field options for ${key} failed:`, outerErr instanceof Error ? outerErr.message : outerErr);
      }

      res.json({ ok: true, data: parseToolResult(result), fieldOptions });
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
          } else {
            console.warn(`[Jira] No REST client or MCP update tool — fields not updated for ${key}`);
          }
        }
      }

      // 2. Add comment — prefer REST (supports visibility), fall back to MCP (public only)
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
            if (commentVisibility === 'internal') {
              console.warn(`[Jira] No REST client — internal comment on ${key} will be posted as public via MCP`);
            }
            const result = await callWithFallback(mcpManager, commentTool, [
              { issue_key: key, body: comment },
            ]);
            results.comment = parseToolResult(result);
          } else {
            console.warn(`[Jira] No REST client or MCP comment tool — comment not posted for ${key}`);
          }
        }
      }

      // 3. Transition — prefer REST, fall back to MCP
      if (transition) {
        const transId = String(transition);
        if (restClient) {
          console.log(`[Jira] Transitioning ${key} to ${transId} via REST`);
          await restClient.transitionIssue(key, transId);
          results.transition = { ok: true };
        } else {
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
