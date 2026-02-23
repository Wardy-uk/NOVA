import { Router } from 'express';
import type { McpClientManager } from '../services/mcp-client.js';

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

export function createO365Routes(mcpManager: McpClientManager): Router {
  const router = Router();

  // GET /api/o365/tools — list available msgraph tools
  router.get('/tools', (_req, res) => {
    res.json({ ok: true, data: { tools: mcpManager.getServerTools('msgraph') } });
  });

  // POST /api/o365/planner/tasks — create a Planner task
  router.post('/planner/tasks', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'create-planner-task');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'create-planner-task tool not available', tools });
      return;
    }

    const { planId, title, description, dueDateTime, priority, assignments } = req.body;
    if (!title?.trim()) {
      res.status(400).json({ ok: false, error: 'title is required' });
      return;
    }

    try {
      const args: Record<string, unknown> = { title };
      if (planId) args.planId = planId;
      if (description) args.description = description;
      if (dueDateTime) args.dueDateTime = dueDateTime;
      if (priority !== undefined) args.priority = priority;
      if (assignments) args.assignments = assignments;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to create planner task',
      });
    }
  });

  // PATCH /api/o365/planner/tasks/:taskId — update a Planner task
  router.patch('/planner/tasks/:taskId', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'update-planner-task');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'update-planner-task tool not available', tools });
      return;
    }

    const { taskId } = req.params;
    const { title, description, dueDateTime, priority, percentComplete } = req.body;

    try {
      const args: Record<string, unknown> = { taskId };
      if (title !== undefined) args.title = title;
      if (description !== undefined) args.description = description;
      if (dueDateTime !== undefined) args.dueDateTime = dueDateTime;
      if (priority !== undefined) args.priority = priority;
      if (percentComplete !== undefined) args.percentComplete = percentComplete;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update planner task',
      });
    }
  });

  // POST /api/o365/todo/tasks — create a To-Do task
  router.post('/todo/tasks', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'create-todo-task');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'create-todo-task tool not available', tools });
      return;
    }

    const { taskListId, title, body, dueDateTime, importance } = req.body;
    if (!title?.trim()) {
      res.status(400).json({ ok: false, error: 'title is required' });
      return;
    }

    try {
      const args: Record<string, unknown> = { title };
      if (taskListId) args.taskListId = taskListId;
      if (body) args.body = body;
      if (dueDateTime) args.dueDateTime = dueDateTime;
      if (importance) args.importance = importance;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to create todo task',
      });
    }
  });

  // PATCH /api/o365/todo/tasks/:taskId — update a To-Do task
  router.patch('/todo/tasks/:taskId', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'update-todo-task');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'update-todo-task tool not available', tools });
      return;
    }

    const { taskId } = req.params;
    const { taskListId, title, body, dueDateTime, importance, status } = req.body;

    try {
      const args: Record<string, unknown> = { taskId };
      if (taskListId) args.taskListId = taskListId;
      if (title !== undefined) args.title = title;
      if (body !== undefined) args.body = body;
      if (dueDateTime !== undefined) args.dueDateTime = dueDateTime;
      if (importance !== undefined) args.importance = importance;
      if (status !== undefined) args.status = status;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update todo task',
      });
    }
  });

  // GET /api/o365/planner/plans — list available plans for task creation
  router.get('/planner/plans', async (_req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'list-planner-plans' || t === 'get-planner-plans');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'list planner plans tool not available', tools });
      return;
    }

    try {
      const result = await mcpManager.callTool('msgraph', toolName, {});
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to list plans',
      });
    }
  });

  // GET /api/o365/todo/lists — list To-Do task lists
  router.get('/todo/lists', async (_req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'list-todo-task-lists');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'list-todo-task-lists tool not available', tools });
      return;
    }

    try {
      const result = await mcpManager.callTool('msgraph', toolName, {});
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to list todo lists',
      });
    }
  });

  return router;
}
