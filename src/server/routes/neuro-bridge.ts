import { Router } from 'express';
import type { McpClientManager } from '../services/mcp-client.js';
import type { Request, Response } from 'express';

// Hardcoded allowed identity — this bridge is for Nick only
const ALLOWED_USERNAME = 'nickw';
const ALLOWED_EMAIL = 'nickw@nurtur.tech';

function parseToolResult(result: unknown): unknown {
  const obj = result as { content?: Array<{ text?: string }> };
  const text = obj?.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

function bridgeAuth(req: Request, res: Response): boolean {
  const secret = process.env.NEURO_BRIDGE_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: 'Bridge not configured' });
    return false;
  }
  const provided = req.headers['x-neuro-bridge-secret'];
  if (provided !== secret) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function createNeuroBridgeRoutes(mcpManager: McpClientManager): Router {
  const router = Router();

  // GET /api/neuro-bridge/status — check bridge is up and Graph is connected
  router.get('/status', (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const tools = mcpManager.getServerTools('msgraph');
    res.json({
      ok: true,
      identity: { username: ALLOWED_USERNAME, email: ALLOWED_EMAIL },
      graphTools: tools.length,
      tools: tools
    });
  });

  // GET /api/neuro-bridge/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get('/calendar', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t =>
      t === 'get-calendar-view' || t === 'list-specific-calendar-events' ||
      t === 'list-calendar-events' || t === 'get-calendar-events' || t === 'list-events'
    );
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Calendar events tool not available', tools });
      return;
    }
    try {
      const args: Record<string, unknown> = {};
      if (req.query.start) args.startDateTime = `${req.query.start}T00:00:00`;
      if (req.query.end) args.endDateTime = `${req.query.end}T23:59:59`;
      if (req.query.calendarId) args.calendarId = req.query.calendarId;
      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/neuro-bridge/mail?count=20
  router.get('/mail', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t =>
      t === 'list-mail-messages' || t === 'get-mail-messages' || t === 'list-messages' ||
      t === 'list-mail-folder-messages' || t.includes('mail') && t.includes('list')
    ) || tools.find(t => t.includes('mail') || t.includes('message'));
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Mail list tool not available', tools });
      return;
    }
    try {
      const args: Record<string, unknown> = {};
      if (req.query.count) args.top = parseInt(req.query.count as string, 10);
      if (req.query.folder) args.folderId = req.query.folder;
      if (req.query.unreadOnly) args.filter = "isRead eq false";
      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/neuro-bridge/planner/tasks
  router.get('/planner/tasks', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t =>
      t === 'list-planner-tasks' || t === 'get-planner-tasks' || t === 'list-my-planner-tasks'
    ) || tools.find(t => t.includes('planner'));
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'Planner tasks tool not available', tools });
      return;
    }
    try {
      const args: Record<string, unknown> = {};
      if (req.query.planId) args.planId = req.query.planId;
      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // GET /api/neuro-bridge/todo/tasks
  router.get('/todo/tasks', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t =>
      t === 'list-todo-tasks' || t === 'get-todo-tasks' || t === 'list-tasks'
    ) || tools.find(t => t.includes('todo'));
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'ToDo tasks tool not available', tools });
      return;
    }
    try {
      const args: Record<string, unknown> = {};
      if (req.query.listId) args.taskListId = req.query.listId;
      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  return router;
}
