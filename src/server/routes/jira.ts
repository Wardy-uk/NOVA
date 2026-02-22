import { Router } from 'express';
import type { TaskQueries } from '../db/queries.js';
import type { McpClientManager } from '../services/mcp-client.js';
import { getLastJiraSearchText } from '../services/aggregator.js';

const JIRA_TOOL_CANDIDATES = {
  getIssue: ['jira_get_issue', 'jira_get_issue_by_key', 'jira_issue_get'],
  updateIssue: ['jira_update_issue', 'jira_update_issue_fields'],
  addComment: ['jira_add_comment', 'jira_create_comment'],
  listTransitions: ['jira_get_transitions', 'jira_list_transitions'],
  transitionIssue: ['jira_transition_issue', 'jira_do_transition'],
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
  for (const args of argsList) {
    try {
      const result = await mcp.callTool('jira', toolName, args);
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('Unknown Jira tool error');
}

export function createJiraRoutes(
  mcpManager: McpClientManager,
  taskQueries: TaskQueries
): Router {
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

    const { fields, comment, transition } = req.body as {
      fields?: Record<string, unknown>;
      comment?: string;
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
          { issueKey: key, fields },
          { key, fields },
          { issueIdOrKey: key, fields },
          { id: key, fields },
        ]);
        results.update = parseToolResult(result);
      }

      if (comment && commentTool) {
        const result = await callWithFallback(mcpManager, commentTool, [
          { issueKey: key, body: comment },
          { key, body: comment },
          { issueIdOrKey: key, body: comment },
          { issueKey: key, comment },
          { key, comment },
        ]);
        results.comment = parseToolResult(result);
      }

      if (transition && transitionTool) {
        const result = await callWithFallback(mcpManager, transitionTool, [
          { issueKey: key, transitionId: transition },
          { key, transitionId: transition },
          { issueKey: key, transition: transition },
          { key, transition: transition },
          { issueIdOrKey: key, transitionId: transition },
        ]);
        results.transition = parseToolResult(result);
      }

      res.json({ ok: true, data: results });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update issue',
      });
    }
  });

  return router;
}
