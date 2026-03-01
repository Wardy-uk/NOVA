import { Router } from 'express';
import type { TaskQueries, UserSettingsQueries } from '../db/queries.js';
import type { McpClientManager } from '../services/mcp-client.js';
import { JiraRestClient } from '../services/jira-client.js';
import { getLastJiraSearchText } from '../services/aggregator.js';

const JIRA_TOOL_CANDIDATES = {
  getIssue: ['jira_get_issue', 'jira_get_issue_by_key', 'jira_issue_get'],
  updateIssue: ['jira_update_issue', 'jira_update_issue_fields'],
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
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch transitions',
      });
    }
  });

  router.patch('/issues/:key', async (req, res) => {
    const key = req.params.key;
    const tools = mcpManager.getServerTools('jira');
    const updateTool = pickTool(tools, 'updateIssue');
    const commentTool = pickTool(tools, 'addComment');
    const transitionTool = pickTool(tools, 'transitionIssue');

    const { fields, comment, commentVisibility, transition } = req.body as {
      fields?: Record<string, unknown>;
      comment?: string;
      commentVisibility?: 'internal' | 'public';
      transition?: string;
    };

    if (!updateTool && !commentTool && !transitionTool) {
      res.status(501).json({
        ok: false,
        error: 'No Jira update tools available',
        tools,
      });
      return;
    }

    const results: Record<string, unknown> = {};

    try {
      if (fields && updateTool) {
        const result = await callWithFallback(mcpManager, updateTool, [
          { issue_key: key, fields },
          { issueKey: key, fields },
          { key, fields },
          { issueIdOrKey: key, fields },
        ]);
        results.update = parseToolResult(result);
      }

      if (comment) {
        const userId = (req as any).user?.id as number | undefined;
        const restClient = getClientForUser(userId);

        if (commentVisibility === 'internal' && restClient) {
          // Internal comment — must use REST API for visibility support
          const role = getSettings?.()?.jira_internal_comment_role || 'Service Desk Team';
          results.comment = await restClient.addComment(key, comment, {
            visibility: { type: 'role', value: role },
          });
        } else if (commentTool) {
          // Public comment via MCP
          const result = await callWithFallback(mcpManager, commentTool, [
            { issue_key: key, body: comment },
            { issueKey: key, body: comment },
            { key, body: comment },
            { issue_key: key, comment },
            { issueKey: key, comment },
          ]);
          results.comment = parseToolResult(result);
        } else if (restClient) {
          // No MCP comment tool — use REST API (public)
          results.comment = await restClient.addComment(key, comment);
        } else {
          console.warn('[Jira] No comment tool or REST client available — comment not posted');
        }
      }

      if (transition) {
        if (!transitionTool) {
          res.status(501).json({
            ok: false,
            error: 'Jira transition tool not available. Available tools: ' + tools.filter(t => t.includes('transition')).join(', '),
            tools,
          });
          return;
        }
        const transId = String(transition);
        console.log(`[Jira] Transitioning ${key} with tool=${transitionTool}, transition_id=${transId}`);
        // transition_issue expects exactly: issue_key (str) + transition_id (str)
        const result = await callWithFallback(mcpManager, transitionTool, [
          { issue_key: key, transition_id: transId },
        ]);
        const parsed = parseToolResult(result);
        console.log(`[Jira] Transition result for ${key}:`, JSON.stringify(parsed).slice(0, 500));
        results.transition = parsed;
      }

      res.json({ ok: true, data: results });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update issue',
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
