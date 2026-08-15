import { Router } from 'express';
import type { McpClientManager } from '../services/mcp-client.js';
import type { Request, Response } from 'express';
import type { RiskScorer } from '../services/risk-scorer.js';
import type { JiraRestClient } from '../services/jira-client.js';
import type { ManualEscalationService } from '../services/manual-escalation-service.js';
import { groupFlaggedByReason } from '../services/risk-scorer.js';

// Hardcoded allowed identity — this bridge is for Nick only
const ALLOWED_USERNAME = 'nickw';
const ALLOWED_EMAIL = 'nickw@nurtur.tech';

/** Who an escalation raised over this bridge is signed as, in the internal Jira
 *  comment the assignee reads. Safe to hardcode precisely because the bridge is
 *  single-identity by construction — see ALLOWED_USERNAME above. */
const BRIDGE_ATTRIBUTION = 'Nick Ward';

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

export function createNeuroBridgeRoutes(
  mcpManager: McpClientManager,
  getRiskScorer?: () => RiskScorer | null,
  // Lazy, because the Jira client and the escalation service are built further
  // down index.ts than this router is mounted — the bridge has to sit in front
  // of the JWT middleware, so it is wired early and resolves its deps per request.
  escalationDeps?: {
    getJiraClient: () => JiraRestClient | null;
    getManualEscalation: () => ManualEscalationService | null;
  },
): Router {
  const router = Router();

  // ── Escalation over the bridge ───────────────────────────────────────────
  //
  // NEURO escalates through here rather than through a NOVA service account.
  // The account route needed a password nobody had, and it signed the internal
  // comment "Escalated by sara" — a robot reaching into someone's ticket. This
  // bridge is already hardcoded to Nick and nobody else, so attribution is a
  // fact about the route rather than a lookup table: anything arriving here IS
  // from him, which is exactly what manual escalation is scoped to in v1.

  router.get('/escalation-reasons', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const svc = escalationDeps?.getManualEscalation();
    if (!svc) { res.status(503).json({ ok: false, error: 'Escalation not available' }); return; }
    try {
      const kind = req.query.kind === 'capability' ? 'capability' : 'urgency';
      res.json({ ok: true, data: await svc.listReasons(kind) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Enough of a ticket to know it is the right one before escalating it.
  router.get('/ticket/:key', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const jira = escalationDeps?.getJiraClient();
    if (!jira) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }
    const key = String(req.params.key || '').toUpperCase();
    try {
      const issue = await jira.getIssue(key, ['*navigable']);
      if (!issue) { res.status(404).json({ ok: false, error: `${key} not found` }); return; }
      let comments: unknown[] = [];
      try {
        comments = (await jira.getComments(key, 10)).map((c: any) => ({
          author: c.author?.displayName ?? 'Unknown',
          created: c.created,
          body: c.body,
          // A JSM internal note must never be mistaken for something the
          // customer has already been told.
          jsdPublic: c.jsdPublic ?? !(c.properties?.some?.(
            (p: any) => p.key === 'sd.public.comment' && p.value?.internal === true)),
        }));
      } catch { comments = []; }
      res.json({ ok: true, data: { key: issue.key, ...issue.fields, comments } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  router.post('/escalate', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const svc = escalationDeps?.getManualEscalation();
    if (!svc) { res.status(503).json({ ok: false, error: 'Escalation not available' }); return; }
    try {
      const { ticket_key, reason_code, needed_by, notes } = req.body ?? {};
      const data = await svc.escalate({
        ticket_key, reason_code, needed_by, notes,
        escalated_by: BRIDGE_ATTRIBUTION,
      });
      res.json({ ok: true, data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to escalate';
      const clientError = /required|Unknown reason_code|is retired|not found|must be YYYY-MM-DD/.test(msg);
      res.status(clientError ? 400 : 500).json({ ok: false, error: msg });
    }
  });

  // GET /api/neuro-bridge/flagged — "Nick, look at this" feed for NUERO Focus.
  // Same grouped shape NOVA's own calm board uses; NUERO pulls this on a timer.
  router.get('/flagged', async (req, res) => {
    if (!bridgeAuth(req, res)) return;
    const riskScorer = getRiskScorer?.();
    if (!riskScorer) {
      res.json({ ok: true, data: { total: 0, groups: [], generatedAt: new Date().toISOString() } });
      return;
    }
    try {
      const min = parseInt(req.query.min as string, 10) || 0;
      const pending = await riskScorer.getFlagged('pending');
      res.json({ ok: true, data: groupFlaggedByReason(pending, min) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

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
    const toolName = ['get-calendar-view', 'list-calendar-events', 'get-calendar-events'].find(n => tools.includes(n));
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
    const toolName = ['list-mail-messages', 'get-mail-messages'].find(n => tools.includes(n));
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

  return router;
}
