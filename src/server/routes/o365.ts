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

  // POST /api/o365/todo/tasks/batch — create multiple To-Do tasks
  router.post('/todo/tasks/batch', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'create-todo-task');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'create-todo-task tool not available', tools });
      return;
    }

    const { titles, taskListId, dueDateTime } = req.body;
    if (!Array.isArray(titles) || titles.length === 0) {
      res.status(400).json({ ok: false, error: 'titles array is required' });
      return;
    }

    const results: Array<{ title: string; ok: boolean; error?: string }> = [];
    for (const rawTitle of titles) {
      const title = String(rawTitle).trim();
      if (!title) continue;
      try {
        const args: Record<string, unknown> = { title };
        if (taskListId) args.taskListId = taskListId;
        if (dueDateTime) args.dueDateTime = dueDateTime;
        const result = await mcpManager.callTool('msgraph', toolName, args);
        // Check for error in the tool result
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        if (resultStr.toLowerCase().includes('error')) {
          console.warn(`[O365] Batch create "${title}" — tool returned possible error:`, resultStr.substring(0, 300));
          results.push({ title, ok: false, error: resultStr.substring(0, 200) });
        } else {
          results.push({ title, ok: true });
        }
      } catch (err) {
        console.error(`[O365] Batch create "${title}" failed:`, err instanceof Error ? err.message : err);
        results.push({ title, ok: false, error: err instanceof Error ? err.message : 'Failed' });
      }
    }

    const created = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok).length;
    res.json({ ok: true, data: { created, failed, total: results.length, results } });
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

  // ---- Calendar routes ----

  // GET /api/o365/calendars — list user's calendars
  router.get('/calendars', async (_req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'list-calendars');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'list-calendars tool not available', tools });
      return;
    }
    try {
      const result = await mcpManager.callTool('msgraph', toolName, {});
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to list calendars' });
    }
  });

  // POST /api/o365/calendar/events — create a calendar event
  router.post('/calendar/events', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'create-calendar-event');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'create-calendar-event tool not available', tools });
      return;
    }

    const { subject, start, end, body, location, attendees, isAllDay, calendarId } = req.body;
    if (!subject?.trim() || !start || !end) {
      res.status(400).json({ ok: false, error: 'subject, start, and end are required' });
      return;
    }

    try {
      const args: Record<string, unknown> = { subject, start, end };
      if (body) args.body = body;
      if (location) args.location = location;
      if (attendees) args.attendees = attendees;
      if (isAllDay !== undefined) args.isAllDay = isAllDay;
      if (calendarId) args.calendarId = calendarId;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create event' });
    }
  });

  // PATCH /api/o365/calendar/events/:eventId — update a calendar event
  router.patch('/calendar/events/:eventId', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'update-calendar-event');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'update-calendar-event tool not available', tools });
      return;
    }

    const { eventId } = req.params;
    const { subject, start, end, body, location, attendees, isAllDay } = req.body;

    try {
      const args: Record<string, unknown> = { eventId };
      if (subject !== undefined) args.subject = subject;
      if (start !== undefined) args.start = start;
      if (end !== undefined) args.end = end;
      if (body !== undefined) args.body = body;
      if (location !== undefined) args.location = location;
      if (attendees !== undefined) args.attendees = attendees;
      if (isAllDay !== undefined) args.isAllDay = isAllDay;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update event' });
    }
  });

  // GET /api/o365/calendar/events/:eventId — get a specific event
  router.get('/calendar/events/:eventId', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'get-calendar-event');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'get-calendar-event tool not available', tools });
      return;
    }
    try {
      const result = await mcpManager.callTool('msgraph', toolName, { eventId: req.params.eventId });
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get event' });
    }
  });

  // DELETE /api/o365/calendar/events/:eventId — delete a calendar event
  router.delete('/calendar/events/:eventId', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'delete-calendar-event');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'delete-calendar-event tool not available', tools });
      return;
    }
    try {
      const result = await mcpManager.callTool('msgraph', toolName, { eventId: req.params.eventId });
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to delete event' });
    }
  });

  // ---- Email routes ----

  // POST /api/o365/mail/send — send a new email
  router.post('/mail/send', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'send-mail');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'send-mail tool not available', tools });
      return;
    }

    const { to, subject, body, cc, bcc, importance } = req.body;
    if (!to?.trim() || !subject?.trim() || !body?.trim()) {
      res.status(400).json({ ok: false, error: 'to, subject, and body are required' });
      return;
    }

    try {
      const args: Record<string, unknown> = {
        to: to.trim(),
        subject: subject.trim(),
        body: body.trim(),
      };
      if (cc?.trim()) args.cc = cc.trim();
      if (bcc?.trim()) args.bcc = bcc.trim();
      if (importance) args.importance = importance;

      const result = await mcpManager.callTool('msgraph', toolName, args);
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to send email',
      });
    }
  });

  // GET /api/o365/mail/:messageId — get full email details
  router.get('/mail/:messageId', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'get-mail-message');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'get-mail-message tool not available', tools });
      return;
    }

    try {
      const result = await mcpManager.callTool('msgraph', toolName, {
        messageId: req.params.messageId,
      });
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to get email',
      });
    }
  });

  // POST /api/o365/mail/:messageId/reply — reply to an email
  // Uses send-mail with quoted original + reply-to address
  router.post('/mail/:messageId/reply', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');

    // Prefer native reply tool if available, fall back to send-mail
    const replyTool = tools.find(t => t === 'reply-mail-message' || t === 'reply-to-mail');
    const sendTool = tools.find(t => t === 'send-mail');

    if (!replyTool && !sendTool) {
      res.status(501).json({ ok: false, error: 'No mail reply or send tool available', tools });
      return;
    }

    const { body, replyTo, originalSubject, originalBody, replyAll } = req.body;
    if (!body?.trim()) {
      res.status(400).json({ ok: false, error: 'body is required' });
      return;
    }

    try {
      if (replyTool) {
        // Use native reply tool
        const args: Record<string, unknown> = {
          messageId: req.params.messageId,
          comment: body.trim(),
        };
        if (replyAll) args.replyAll = true;
        const result = await mcpManager.callTool('msgraph', replyTool, args);
        res.json({ ok: true, data: parseToolResult(result) });
      } else {
        // Fallback: compose reply via send-mail
        if (!replyTo?.trim()) {
          res.status(400).json({ ok: false, error: 'replyTo is required when using send-mail fallback' });
          return;
        }
        const subject = originalSubject
          ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
          : 'Re:';
        const quotedBody = originalBody
          ? `${body.trim()}\n\n---\nOriginal message:\n${originalBody}`
          : body.trim();

        const result = await mcpManager.callTool('msgraph', sendTool!, {
          to: replyTo.trim(),
          subject,
          body: quotedBody,
        });
        res.json({ ok: true, data: parseToolResult(result) });
      }
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to reply',
      });
    }
  });

  // POST /api/o365/mail/:messageId/forward — forward an email
  router.post('/mail/:messageId/forward', async (req, res) => {
    const tools = mcpManager.getServerTools('msgraph');

    const forwardTool = tools.find(t => t === 'forward-mail-message' || t === 'forward-mail');
    const sendTool = tools.find(t => t === 'send-mail');

    if (!forwardTool && !sendTool) {
      res.status(501).json({ ok: false, error: 'No mail forward or send tool available', tools });
      return;
    }

    const { to, body, originalSubject, originalBody, originalFrom } = req.body;
    if (!to?.trim()) {
      res.status(400).json({ ok: false, error: 'to is required' });
      return;
    }

    try {
      if (forwardTool) {
        const args: Record<string, unknown> = {
          messageId: req.params.messageId,
          to: to.trim(),
        };
        if (body?.trim()) args.comment = body.trim();
        const result = await mcpManager.callTool('msgraph', forwardTool, args);
        res.json({ ok: true, data: parseToolResult(result) });
      } else {
        // Fallback: compose forward via send-mail
        const subject = originalSubject
          ? (originalSubject.startsWith('Fwd:') ? originalSubject : `Fwd: ${originalSubject}`)
          : 'Fwd:';
        const intro = body?.trim() ? `${body.trim()}\n\n` : '';
        const forwarded = originalBody
          ? `${intro}---------- Forwarded message ----------\nFrom: ${originalFrom ?? 'Unknown'}\nSubject: ${originalSubject ?? ''}\n\n${originalBody}`
          : intro || '(forwarded)';

        const result = await mcpManager.callTool('msgraph', sendTool!, {
          to: to.trim(),
          subject,
          body: forwarded,
        });
        res.json({ ok: true, data: parseToolResult(result) });
      }
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to forward',
      });
    }
  });

  // GET /api/o365/mail/folders — list mail folders
  router.get('/mail/folders', async (_req, res) => {
    const tools = mcpManager.getServerTools('msgraph');
    const toolName = tools.find(t => t === 'list-mail-folders');
    if (!toolName) {
      res.status(501).json({ ok: false, error: 'list-mail-folders tool not available', tools });
      return;
    }

    try {
      const result = await mcpManager.callTool('msgraph', toolName, {});
      res.json({ ok: true, data: parseToolResult(result) });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to list folders',
      });
    }
  });

  return router;
}
