import { Router } from 'express';
import { requireRole, requireSuperAdmin } from '../middleware/auth.js';
import type { AgentLoop } from '../services/agent-loop.js';
import { query, execute } from '../services/database.js';
import { MODEL_PRICING } from '../services/llm-service.js';
import { resolveStatusName, resolveStatusFromCache } from '../utils/jira-status.js';
import { RespondResultSchema, type RespondResult } from '../services/respond-schema.js';
import { ResolveSummarySchema, type ResolveSummaryResult } from '../services/resolve-schema.js';
import { loadPrompt } from '../services/prompt-loader.js';
import type { AssignmentEngine, Pool } from '../services/assignment-engine.js';
import type { AgentAvailabilityService, AvailabilityStatus } from '../services/agent-availability.js';
import type { TicketClassifier } from '../services/ticket-classifier.js';
import type { BriefEngine } from '../services/brief-engine.js';
import type { CoachingEngine } from '../services/coach.js';
import type { KpiPipeline } from '../services/kpi-pipeline.js';
import type { QaPipeline } from '../services/qa-pipeline.js';
import type { PipelineMonitor } from '../services/pipeline-monitor.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraCacheQueries } from '../services/jira-cache-queries.js';
import type { JiraSyncService } from '../services/jira-sync-service.js';
import type { SuggestionEngine } from '../services/suggestion-engine.js';
import type { RiskScorer } from '../services/risk-scorer.js';

interface AgentRouteDeps {
  agentLoop: AgentLoop;
  assignmentEngine: AssignmentEngine;
  availabilityService: AgentAvailabilityService;
  ticketClassifier: TicketClassifier;
  briefEngine: BriefEngine;
  coachingEngine: CoachingEngine;
  kpiPipeline: KpiPipeline;
  qaPipeline: QaPipeline;
  pipelineMonitor: PipelineMonitor;
  settingsQueries: FileSettingsQueries;
  jiraCache: JiraCacheQueries;
  jiraSyncService: JiraSyncService | null;
  suggestionEngine: SuggestionEngine | null;
  riskScorer: RiskScorer | null;
}

export function createAgentRoutes(agentLoop: AgentLoop, deps?: Partial<Omit<AgentRouteDeps, 'agentLoop'>>): Router {
  const router = Router();

  router.use(requireRole('admin', 'super_admin'));

  router.get('/status', (_req, res) => {
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/start', requireSuperAdmin(), (_req, res) => {
    agentLoop.start();
    deps?.settingsQueries?.set('agent_enabled', 'true');
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/stop', requireSuperAdmin(), (_req, res) => {
    agentLoop.stop();
    deps?.settingsQueries?.set('agent_enabled', 'false');
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/pause', requireSuperAdmin(), (_req, res) => {
    agentLoop.pause();
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/resume', requireSuperAdmin(), (_req, res) => {
    agentLoop.resume();
    res.json({ ok: true, data: agentLoop.status });
  });

  router.get('/decisions', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const decisions = await agentLoop.getObserver().getDecisions(limit, offset);
    res.json({ ok: true, data: decisions });
  });

  router.get('/decisions/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid decision ID' });
      return;
    }
    const decision = await agentLoop.getObserver().getDecisionById(id);
    if (!decision) {
      res.status(404).json({ ok: false, error: 'Decision not found' });
      return;
    }
    res.json({ ok: true, data: decision });
  });

  router.get('/decisions/ticket/:key', async (req, res) => {
    const decisions = await agentLoop.getObserver().getDecisionsByTicket(req.params.key);
    res.json({ ok: true, data: decisions });
  });

  router.post('/replay', async (req, res) => {
    const { decisionId } = req.body;
    if (!decisionId) {
      res.status(400).json({ ok: false, error: 'decisionId is required' });
      return;
    }
    const original = await agentLoop.getObserver().getDecisionById(decisionId);
    if (!original) {
      res.status(404).json({ ok: false, error: 'Original decision not found' });
      return;
    }
    res.json({
      ok: true,
      data: {
        message: 'Replay not yet implemented — returns original decision for now.',
        original,
      },
    });
  });

  router.get('/guardrails', (_req, res) => {
    res.json({ ok: true, data: agentLoop.getGuardrails().getRules() });
  });

  router.put('/guardrails/:ruleId', (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ ok: false, error: 'enabled (boolean) is required' });
      return;
    }
    const updated = agentLoop.getGuardrails().setRuleEnabled(req.params.ruleId, enabled);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'Rule not found' });
      return;
    }
    res.json({ ok: true, data: agentLoop.getGuardrails().getRules() });
  });

  router.post('/guardrails', (req, res) => {
    const { id, description, severity, pattern, enabled } = req.body;
    if (!id || !description || !severity || !pattern) {
      res.status(400).json({ ok: false, error: 'id, description, severity, and pattern are required' });
      return;
    }
    const result = agentLoop.getGuardrails().addCustomRule({
      id, description,
      severity: severity === 'warn' ? 'warn' : 'block',
      pattern,
      enabled: enabled !== false,
    });
    if (!result.ok) { res.status(400).json(result); return; }
    res.json({ ok: true, data: agentLoop.getGuardrails().getRules() });
  });

  router.patch('/guardrails/:ruleId', (req, res) => {
    const { description, severity, pattern, enabled } = req.body;
    const result = agentLoop.getGuardrails().updateCustomRule(req.params.ruleId, {
      ...(description !== undefined && { description }),
      ...(severity !== undefined && { severity: severity === 'warn' ? 'warn' : 'block' }),
      ...(pattern !== undefined && { pattern }),
      ...(enabled !== undefined && { enabled }),
    });
    if (!result.ok) { res.status(400).json(result); return; }
    res.json({ ok: true, data: agentLoop.getGuardrails().getRules() });
  });

  router.delete('/guardrails/:ruleId', (req, res) => {
    const result = agentLoop.getGuardrails().deleteCustomRule(req.params.ruleId);
    if (!result.ok) { res.status(400).json(result); return; }
    res.json({ ok: true, data: agentLoop.getGuardrails().getRules() });
  });

  router.post('/sweep', async (_req, res) => {
    try {
      // Manual sweep trigger (runs immediately, outside normal tick schedule)
      const shadow = agentLoop.status.shadowMode;
      // The sweep is internal to the agent loop — expose status for now
      res.json({ ok: true, data: { message: 'Sweep will run on next scheduled tick, or restart the agent to trigger immediately.', shadowMode: shadow } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Sweep failed' });
    }
  });

  router.get('/stats', async (_req, res) => {
    try {
      const stats = await agentLoop.getObserver().getStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get stats' });
    }
  });

  router.get('/providers', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 7, 90);
    try {
      const stats = await agentLoop.getObserver().getProviderStats(days);
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get provider stats' });
    }
  });

  router.get('/costs/pricing', requireSuperAdmin(), (_req, res) => {
    res.json({ ok: true, data: MODEL_PRICING });
  });

  router.get('/costs/trend', requireSuperAdmin(), async (req, res) => {
    const start = req.query.start as string;
    const end = req.query.end as string;
    if (!start || !end) return res.status(400).json({ ok: false, error: 'start and end query params required' });
    try {
      const data = await agentLoop.getObserver().getCostTrend(start, end);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get cost trend' });
    }
  });

  router.get('/costs', requireSuperAdmin(), async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 365);
    try {
      const data = await agentLoop.getObserver().getCostSummary(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get cost data' });
    }
  });

  // ── Flagged tickets (risk alerting) ──

  router.get('/flagged', async (_req, res) => {
    if (!deps?.riskScorer) return res.status(503).json({ ok: false, error: 'Risk scorer not available' });
    try {
      const data = await deps.riskScorer.getFlagged();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get flagged tickets' });
    }
  });

  router.get('/flagged/summary', async (_req, res) => {
    if (!deps?.riskScorer) return res.json({ ok: true, data: { count: 0, highestRisk: null, avgScore: 0 } });
    try {
      const data = await deps.riskScorer.getFlaggedSummary();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get flagged summary' });
    }
  });

  router.post('/flagged/:key/review', async (req, res) => {
    if (!deps?.riskScorer) return res.status(503).json({ ok: false, error: 'Risk scorer not available' });
    const { key } = req.params;
    const dismiss = req.body?.dismiss === true;
    const username = (req as any).user?.username ?? 'unknown';
    try {
      await deps.riskScorer.reviewTicket(key, username, dismiss);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to review ticket' });
    }
  });

  router.get('/confidence-history', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);
    try {
      const history = await agentLoop.getObserver().getConfidenceHistory(days);
      res.json({ ok: true, data: history });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get confidence history' });
    }
  });

  router.get('/overrides', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    try {
      const overrides = await agentLoop.getObserver().getOverrideLog(limit);
      res.json({ ok: true, data: overrides });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get override log' });
    }
  });

  // ── Autonomy Engine ──

  router.get('/autonomy', async (_req, res) => {
    try {
      const rules = await agentLoop.getAutonomyEngine().getRules();
      res.json({ ok: true, data: rules });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get autonomy rules' });
    }
  });

  router.post('/autonomy', async (req, res) => {
    const { category, subCategory, enabled, minConfidence, minAcceptRate, minQaScore, minDecisions, autonomousActions } = req.body;
    if (!category) {
      res.status(400).json({ ok: false, error: 'category is required' });
      return;
    }
    try {
      const id = await agentLoop.getAutonomyEngine().createRule({
        category,
        subCategory: subCategory ?? null,
        enabled: enabled ?? false,
        minConfidence: minConfidence ?? 0.90,
        minAcceptRate: minAcceptRate ?? 90.0,
        minQaScore: minQaScore ?? 4.0,
        minDecisions: minDecisions ?? 50,
        autonomousActions: autonomousActions ?? ['draft_response'],
        updatedBy: (req as any).user?.username ?? null,
      });
      const rule = await agentLoop.getAutonomyEngine().getRule(id);
      res.json({ ok: true, data: rule });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create autonomy rule' });
    }
  });

  router.put('/autonomy/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid rule ID' });
      return;
    }
    try {
      const updated = await agentLoop.getAutonomyEngine().updateRule(id, {
        ...req.body,
        updatedBy: (req as any).user?.username ?? null,
      });
      if (!updated) {
        res.status(404).json({ ok: false, error: 'Rule not found' });
        return;
      }
      const rule = await agentLoop.getAutonomyEngine().getRule(id);
      res.json({ ok: true, data: rule });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update autonomy rule' });
    }
  });

  router.delete('/autonomy/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid rule ID' });
      return;
    }
    try {
      const deleted = await agentLoop.getAutonomyEngine().deleteRule(id);
      if (!deleted) {
        res.status(404).json({ ok: false, error: 'Rule not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to delete autonomy rule' });
    }
  });

  router.get('/autonomy/:category/stats', async (req, res) => {
    try {
      const stats = await agentLoop.getAutonomyEngine().getCategoryStatsPublic(
        req.params.category,
        req.query.subCategory as string | undefined,
      );
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get category stats' });
    }
  });

  router.post('/autonomy/kill-switch', requireSuperAdmin(), async (_req, res) => {
    try {
      await agentLoop.getAutonomyEngine().killSwitch();
      res.json({ ok: true, data: { message: 'All autonomy rules disabled.' } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Kill switch failed' });
    }
  });

  // ── Alerts ──

  router.get('/alerts', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const includeAcknowledged = req.query.includeAcknowledged === 'true';
    try {
      const alerts = await agentLoop.getAlertService().getAlerts(limit, includeAcknowledged);
      res.json({ ok: true, data: alerts });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get alerts' });
    }
  });

  router.post('/alerts/:id/acknowledge', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid alert ID' });
      return;
    }
    try {
      const username = (req as any).user?.username ?? 'unknown';
      const acknowledged = await agentLoop.getAlertService().acknowledgeAlert(id, username);
      if (!acknowledged) {
        res.status(404).json({ ok: false, error: 'Alert not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to acknowledge alert' });
    }
  });

  router.post('/alerts/acknowledge-all', async (req, res) => {
    try {
      const username = (req as any).user?.username ?? 'unknown';
      const count = await agentLoop.getAlertService().acknowledgeAll(username);
      res.json({ ok: true, data: { acknowledged: count } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to acknowledge alerts' });
    }
  });

  // ── KB Gaps ──

  router.get('/kb-gaps', async (req, res) => {
    const status = (req.query.status as string) || 'open';
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 100, 500);
    try {
      const rows = await query(
        `SELECT
           category, suggested_title,
           COUNT(*) as frequency,
           MIN(created_at) as first_seen,
           MAX(created_at) as last_seen,
           STRING_AGG(ticket_id, ', ') as ticket_ids
         FROM kb_gap_log
         WHERE status = ?
         GROUP BY category, suggested_title
         ORDER BY COUNT(*) DESC, MAX(created_at) DESC
         OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
        [status, limit],
      );
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get KB gaps' });
    }
  });

  router.get('/kb-gaps/counts', async (_req, res) => {
    try {
      const rows = await query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(DISTINCT CONCAT(category, '||', ISNULL(suggested_title, ''))) as cnt
         FROM kb_gap_log
         GROUP BY status`,
      );
      const counts: Record<string, number> = { open: 0, article_drafted: 0, article_published: 0, dismissed: 0 };
      for (const r of rows) counts[r.status] = r.cnt;
      res.json({ ok: true, data: counts });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get KB gap counts' });
    }
  });

  router.put('/kb-gaps/:id/status', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status: newStatus } = req.body;
    const valid = ['open', 'article_drafted', 'article_published', 'dismissed'];
    if (!valid.includes(newStatus)) {
      res.status(400).json({ ok: false, error: `status must be one of: ${valid.join(', ')}` });
      return;
    }
    try {
      await execute(
        `UPDATE kb_gap_log SET status = ?, resolved_at = CASE WHEN ? IN ('article_published', 'dismissed') THEN GETUTCDATE() ELSE NULL END WHERE id = ?`,
        [newStatus, newStatus, id],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update KB gap' });
    }
  });

  router.post('/kb-gaps/dismiss', async (req, res) => {
    const { category, suggestedTitle } = req.body;
    if (!category) {
      res.status(400).json({ ok: false, error: 'category is required' });
      return;
    }
    try {
      await execute(
        `UPDATE kb_gap_log SET status = 'dismissed', resolved_at = GETUTCDATE()
         WHERE status = 'open' AND category = ? ${suggestedTitle ? 'AND suggested_title = ?' : ''}`,
        suggestedTitle ? [category, suggestedTitle] : [category],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to dismiss KB gaps' });
    }
  });

  // ── Quick Actions ──

  router.post('/quick-actions/draft-reply', async (req, res) => {
    const { ticketKey } = req.body;
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();
      const llm = agentLoop.getLlmService();

      const issue = await jira.getIssue(ticketKey, [
        'summary', 'description', 'status', 'priority', 'reporter',
        'assignee', 'created', 'updated', 'comment', 'issuetype',
      ]);
      if (!issue) {
        res.status(404).json({ ok: false, error: `Ticket ${ticketKey} not found` });
        return;
      }
      const f = issue.fields;
      const comments = (f.comment as any)?.comments as Array<{
        author?: { displayName?: string };
        body?: string;
        created?: string;
        properties?: Array<{ key: string; value?: { internal?: boolean } }>;
      }> | undefined;

      const conversationThread = (comments ?? [])
        .slice(-10)
        .map(c => {
          const isInternal = c.properties?.some(p => p.key === 'sd.public.comment' && p.value?.internal) ?? false;
          return `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}${isInternal ? ' (internal)' : ''}:\n${typeof c.body === 'string' ? c.body.slice(0, 500) : '(complex body)'}`;
        })
        .join('\n\n---\n\n');

      const systemPrompt = loadPrompt('respond', {
        ticket_key: ticketKey,
        summary: (f.summary as string) ?? '',
        description: ((f.description as string) ?? '').slice(0, 1000),
        request_type: (f.issuetype as any)?.name ?? 'Not specified',
        priority: (f.priority as any)?.name ?? 'Medium',
        status: (f.status as any)?.name ?? 'Unknown',
        assignee: (f.assignee as any)?.displayName ?? 'Unassigned',
        reporter: (f.reporter as any)?.displayName ?? 'Unknown',
        organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? 'Unknown',
        created: (f.created as string) ?? '',
        previous_triage: 'Not available',
        conversation_thread: conversationThread || '(no comments)',
        customer_context: 'Quick action — manual reply from NOVA',
        kb_matches: '(not queried for quick actions)',
      });

      const result = await llm.call<RespondResult>(
        systemPrompt,
        'Draft a response to this ticket based on the conversation so far.',
        RespondResultSchema,
        { ticketId: ticketKey, callType: 'quick_reply', temperature: 0.3 },
      );

      res.json({
        ok: true,
        data: {
          ticketKey,
          draftResponse: result.data.draft_response,
          internalNote: result.data.internal_note,
          intent: result.data.intent,
          sentiment: result.data.sentiment,
          recommendedAction: result.data.recommended_action,
          provider: result.provider,
          model: result.model,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to draft reply' });
    }
  });

  router.post('/quick-actions/send-reply', async (req, res) => {
    const { ticketKey, message, internal } = req.body;
    if (!ticketKey || !message) {
      res.status(400).json({ ok: false, error: 'ticketKey and message are required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();
      await jira.addComment(ticketKey, message, { internal: internal === true });
      res.json({ ok: true, data: { ticketKey, posted: true, internal: internal === true } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send reply' });
    }
  });

  router.post('/quick-actions/escalate', async (req, res) => {
    const { ticketKey, reason } = req.body;
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();
      const username = (req as any).user?.username ?? 'unknown';
      const briefText = `🔺 Escalation from NOVA\n\nEscalated by: ${username}\nReason: ${reason ?? 'Not specified'}\n\nThis ticket requires specialist attention. Please review and assign to the appropriate team.`;
      await jira.addComment(ticketKey, briefText, { internal: true });
      res.json({ ok: true, data: { ticketKey, escalated: true } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to escalate' });
    }
  });

  router.post('/quick-actions/draft-resolve', async (req, res) => {
    const { ticketKey } = req.body;
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();
      const llm = agentLoop.getLlmService();

      const issue = await jira.getIssue(ticketKey, [
        'summary', 'description', 'status', 'priority', 'reporter',
        'assignee', 'created', 'comment',
      ]);
      if (!issue) {
        res.status(404).json({ ok: false, error: `Ticket ${ticketKey} not found` });
        return;
      }
      const f = issue.fields;
      const comments = (f.comment as any)?.comments as Array<{
        author?: { displayName?: string };
        body?: string;
        created?: string;
      }> | undefined;

      const conversationThread = (comments ?? [])
        .slice(-10)
        .map(c => `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}:\n${typeof c.body === 'string' ? c.body.slice(0, 500) : '(complex body)'}`)
        .join('\n\n---\n\n');

      const systemPrompt = loadPrompt('resolve-summary', {
        ticket_key: ticketKey,
        summary: (f.summary as string) ?? '',
        description: ((f.description as string) ?? '').slice(0, 1000),
        priority: (f.priority as any)?.name ?? 'Medium',
        reporter: (f.reporter as any)?.displayName ?? 'Unknown',
        organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? 'Unknown',
        conversation_thread: conversationThread || '(no comments)',
      });

      const result = await llm.call<ResolveSummaryResult>(
        systemPrompt,
        'Draft a resolution summary and closing message for this ticket.',
        ResolveSummarySchema,
        { ticketId: ticketKey, callType: 'quick_resolve', temperature: 0.3 },
      );

      res.json({
        ok: true,
        data: {
          ticketKey,
          resolutionSummary: result.data.resolution_summary,
          customerMessage: result.data.customer_message,
          provider: result.provider,
          model: result.model,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to draft resolve' });
    }
  });

  router.post('/quick-actions/resolve', async (req, res) => {
    const { ticketKey, customerMessage, resolutionSummary, transitionId } = req.body;
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();

      if (customerMessage) {
        await jira.addComment(ticketKey, customerMessage, { internal: false });
      }

      if (transitionId) {
        await jira.transitionIssue(ticketKey, transitionId);
      }

      res.json({ ok: true, data: { ticketKey, resolved: true, transitioned: !!transitionId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to resolve' });
    }
  });

  router.get('/quick-actions/transitions/:ticketKey', async (req, res) => {
    try {
      const jira = agentLoop.getJiraClient();
      const result = await jira.getTransitionsWithFields(req.params.ticketKey);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get transitions' });
    }
  });

  // ── Workspace ──

  router.get('/workspace/queue-fast', async (_req, res) => {
    try {
      const perceiver = agentLoop.getPerceiver();
      const cachedIssues = perceiver.getLastOpenIssues();

      if (cachedIssues.length === 0) {
        res.json({ ok: true, data: { tickets: [], total: 0, source: 'perceiver', cached: true } });
        return;
      }

      const ticketKeys = cachedIssues.map(i => i.key);
      let aiDecisions: Record<string, any> = {};
      if (ticketKeys.length > 0) {
        const placeholders = ticketKeys.map(() => '?').join(',');
        const rows = await query<{
          ticket_id: string; action: string; confidence: number;
          reasoning: string; output: string; approval_required: boolean;
          approval_status: string | null; shadow_mode: boolean;
          created_at: string; event_type: string;
        }>(
          `SELECT d.* FROM agent_decisions d
           INNER JOIN (
             SELECT ticket_id, MAX(id) as max_id
             FROM agent_decisions
             WHERE ticket_id IN (${placeholders})
             GROUP BY ticket_id
           ) latest ON d.id = latest.max_id`,
          ticketKeys,
        );
        for (const row of rows) {
          aiDecisions[row.ticket_id] = row;
        }
      }

      const now = Date.now();
      const priorityOrder: Record<string, number> = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

      const tickets = cachedIssues.map((issue: any) => {
        const f = issue.fields;
        const slaField = f.customfield_10010;
        let slaStatus: 'ok' | 'at_risk' | 'breached' = 'ok';
        let slaMinutesRemaining: number | null = null;
        let slaType: string | null = null;

        if (slaField) {
          const ongoing = slaField?.ongoingCycle;
          if (ongoing?.breachTime?.epochMillis) {
            const remaining = (ongoing.breachTime.epochMillis - now) / 60000;
            slaMinutesRemaining = Math.round(remaining);
            slaType = ongoing.goalName ?? 'unknown';
            if (remaining <= 0) slaStatus = 'breached';
            else if (remaining <= 60) slaStatus = 'at_risk';
          }
          if (slaField?.completedCycles) {
            for (const cycle of slaField.completedCycles) {
              if (cycle.breached) { slaStatus = 'breached'; break; }
            }
          }
        }

        const ai = aiDecisions[issue.key] ?? null;
        let aiSummary: string | null = null;
        if (ai) {
          let outputParsed: any = null;
          try { outputParsed = typeof ai.output === 'string' ? JSON.parse(ai.output) : ai.output; } catch {}
          const actionLabel = ai.action === 'draft_response' ? 'Respond'
            : ai.action === 'escalate' ? 'Escalate'
            : ai.action === 'assign' ? 'Assign'
            : ai.action === 'chase' ? 'Chase'
            : ai.action === 'no_action' ? 'No action'
            : ai.action;
          const classCategory = outputParsed?.classification?.category;
          aiSummary = classCategory ? `${actionLabel} — ${classCategory}` : actionLabel;
        }

        const createdAt = new Date(f.created ?? '');
        const ageMinutes = Math.round((now - createdAt.getTime()) / 60000);

        return {
          key: issue.key,
          id: issue.id,
          summary: f.summary ?? '',
          status: resolveStatusName(f.status) ?? 'Unknown',
          statusCategory: (f.status as any)?.statusCategory?.key ?? 'undefined',
          priority: (f.priority as any)?.name ?? 'Medium',
          priorityOrder: priorityOrder[(f.priority as any)?.name] ?? 2,
          issueType: (f.issuetype as any)?.name ?? '',
          assignee: (f.assignee as any)?.displayName ?? null,
          assigneeAccountId: (f.assignee as any)?.accountId ?? null,
          reporter: (f.reporter as any)?.displayName ?? null,
          organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? null,
          requestType: (f.customfield_10020 as any)?.requestType?.name ?? null,
          labels: f.labels ?? [],
          created: f.created ?? '',
          updated: f.updated ?? '',
          ageMinutes,
          sla: { status: slaStatus, minutesRemaining: slaMinutesRemaining, type: slaType },
          ai: ai ? {
            action: ai.action,
            confidence: ai.confidence,
            approvalRequired: ai.approval_required,
            approvalStatus: ai.approval_status,
            shadowMode: ai.shadow_mode,
            summary: aiSummary,
            eventType: ai.event_type,
            decidedAt: ai.created_at,
          } : null,
        };
      });

      tickets.sort((a: any, b: any) => {
        const slaOrd: Record<string, number> = { breached: 0, at_risk: 1, ok: 2 };
        const slaA = slaOrd[a.sla.status] ?? 2;
        const slaB = slaOrd[b.sla.status] ?? 2;
        if (slaA !== slaB) return slaA - slaB;
        if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
        return b.ageMinutes - a.ageMinutes;
      });

      res.json({ ok: true, data: { tickets, total: tickets.length, source: 'perceiver', cached: true } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get cached queue' });
    }
  });

  router.get('/workspace/queue', async (req, res) => {
    try {
      const cache = deps?.jiraCache;
      const syncReady = deps?.jiraSyncService?.isReady();
      const projectSetting = agentLoop.getSettings().get('agent_jira_project') || 'NT';
      const projects = projectSetting.split(',').map(p => p.trim()).filter(Boolean);
      const assigneeFilter = req.query.assignee as string | undefined;
      const projectFilterParam = req.query.project as string | undefined;
      const tierFilter = req.query.tier as string | undefined;

      let rawIssues: Array<{ key: string; id: string; fields: Record<string, any> }>;

      if (cache && syncReady) {
        const cached = await cache.getOpenIssues(projectFilterParam ? [projectFilterParam] : projects);
        rawIssues = cached.map(ci => ({
          key: ci.issue_key,
          id: ci.jira_id,
          fields: {
            summary: ci.summary,
            status: { name: resolveStatusFromCache(ci.status_name, ci.status_category), statusCategory: { key: ci.status_category } },
            priority: { name: ci.priority_name },
            issuetype: { name: ci.issuetype_name },
            assignee: ci.assignee_account_id ? { displayName: ci.assignee_display, accountId: ci.assignee_account_id, emailAddress: ci.assignee_email } : null,
            reporter: ci.reporter_display ? { displayName: ci.reporter_display, emailAddress: ci.reporter_email } : null,
            created: ci.jira_created?.toISOString() ?? null,
            updated: ci.jira_updated?.toISOString() ?? null,
            labels: ci.labels ? ci.labels.split(';') : [],
            customfield_10020: ci.request_type ? { requestType: { name: ci.request_type } } : null,
            customfield_12981: ci.current_tier ? { value: ci.current_tier } : null,
            _sla_breach_time: ci.sla_breach_time,
            _sla_breached: ci.sla_breached,
          },
        }));
      } else {
        const jira = agentLoop.getJiraClient();
        const projectJql = projects.length === 1 ? `project = ${projects[0]}` : `project IN (${projects.join(', ')})`;

        const fields = [
          'summary', 'description', 'status', 'priority', 'issuetype',
          'assignee', 'reporter', 'created', 'updated',
          'customfield_10020', 'customfield_10010', 'customfield_12981', 'labels',
        ];

        let jql = `${projectJql} AND statusCategory IN ("To Do", "In Progress")`;
        if (assigneeFilter) {
          jql += assigneeFilter === 'unassigned'
            ? ' AND assignee is EMPTY'
            : ` AND assignee = "${assigneeFilter}"`;
        }
        jql += ' ORDER BY created DESC';

        const result = await jira.searchJqlAll(jql, fields, 1000);
        rawIssues = result.issues;
      }

      // Apply assignee filter (for cache path)
      if (assigneeFilter && cache && syncReady) {
        rawIssues = rawIssues.filter(i => {
          if (assigneeFilter === 'unassigned') return !i.fields.assignee;
          return i.fields.assignee?.displayName === assigneeFilter || i.fields.assignee?.accountId === assigneeFilter;
        });
      }

      // Apply tier filter (multi-select, comma-separated)
      if (tierFilter) {
        const tiers = new Set(tierFilter.split(',').map(t => t.trim()));
        rawIssues = rawIssues.filter(i => {
          const tier = i.fields.customfield_12981?.value ?? null;
          if (tiers.has('none')) return !tier || tiers.has(tier);
          return tier && tiers.has(tier);
        });
      }

      // Apply project filter (for cache path when filtering to subset)
      if (projectFilterParam && !(cache && syncReady)) {
        rawIssues = rawIssues.filter(i => i.key.startsWith(projectFilterParam + '-'));
      }

      // Batch-fetch latest AI decision for each ticket
      const ticketKeys = rawIssues.map(i => i.key);
      let aiDecisions: Record<string, any> = {};
      if (ticketKeys.length > 0) {
        const placeholders = ticketKeys.map(() => '?').join(',');
        const rows = await query<{
          ticket_id: string; action: string; confidence: number;
          reasoning: string; output: string; approval_required: boolean;
          approval_status: string | null; shadow_mode: boolean;
          created_at: string; event_type: string;
        }>(
          `SELECT d.* FROM agent_decisions d
           INNER JOIN (
             SELECT ticket_id, MAX(id) as max_id
             FROM agent_decisions
             WHERE ticket_id IN (${placeholders})
             GROUP BY ticket_id
           ) latest ON d.id = latest.max_id`,
          ticketKeys,
        );
        for (const row of rows) {
          aiDecisions[row.ticket_id] = row;
        }
      }

      const now = Date.now();
      const tickets = rawIssues.map(issue => {
        const f = issue.fields;
        let slaStatus: 'ok' | 'at_risk' | 'breached' = 'ok';
        let slaMinutesRemaining: number | null = null;
        let slaType: string | null = null;

        // Cache path: use denormalized SLA fields
        if (f._sla_breach_time) {
          const breachMs = new Date(f._sla_breach_time).getTime();
          const remaining = (breachMs - now) / 60000;
          slaMinutesRemaining = Math.round(remaining);
          if (remaining <= 0 || f._sla_breached) slaStatus = 'breached';
          else if (remaining <= 60) slaStatus = 'at_risk';
        } else if (f._sla_breached) {
          slaStatus = 'breached';
        }

        // Live API path: use raw SLA field
        const slaField = f.customfield_10010;
        if (slaField) {
          const ongoing = slaField?.ongoingCycle;
          if (ongoing?.breachTime?.epochMillis) {
            const remaining = (ongoing.breachTime.epochMillis - now) / 60000;
            slaMinutesRemaining = Math.round(remaining);
            slaType = ongoing.goalName ?? 'unknown';
            if (remaining <= 0) slaStatus = 'breached';
            else if (remaining <= 60) slaStatus = 'at_risk';
          }
          if (slaField?.completedCycles) {
            for (const cycle of slaField.completedCycles) {
              if (cycle.breached) { slaStatus = 'breached'; break; }
            }
          }
        }

        const ai = aiDecisions[issue.key] ?? null;
        let aiSummary: string | null = null;
        if (ai) {
          let outputParsed: any = null;
          try { outputParsed = typeof ai.output === 'string' ? JSON.parse(ai.output) : ai.output; } catch {}
          const actionLabel = ai.action === 'draft_response' ? 'Respond'
            : ai.action === 'escalate' ? 'Escalate'
            : ai.action === 'assign' ? 'Assign'
            : ai.action === 'chase' ? 'Chase'
            : ai.action === 'no_action' ? 'No action'
            : ai.action;
          const classCategory = outputParsed?.classification?.category;
          aiSummary = classCategory
            ? `${actionLabel} — ${classCategory}`
            : actionLabel;
        }

        const createdAt = new Date(f.created ?? '');
        const ageMinutes = Math.round((now - createdAt.getTime()) / 60000);
        const currentTier = f.customfield_12981?.value ?? null;

        const priorityOrder: Record<string, number> = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 };

        return {
          key: issue.key,
          id: issue.id,
          summary: f.summary ?? '',
          status: f.status?.name ?? 'Unknown',
          statusCategory: f.status?.statusCategory?.key ?? 'undefined',
          priority: f.priority?.name ?? 'Medium',
          priorityOrder: priorityOrder[f.priority?.name] ?? 2,
          issueType: f.issuetype?.name ?? '',
          assignee: f.assignee?.displayName ?? null,
          assigneeAccountId: f.assignee?.accountId ?? null,
          reporter: f.reporter?.displayName ?? null,
          organisation: f.reporter?.emailAddress?.split('@')[1] ?? null,
          requestType: f.customfield_10020?.requestType?.name ?? null,
          currentTier,
          project: issue.key.split('-')[0],
          labels: f.labels ?? [],
          created: f.created ?? '',
          updated: f.updated ?? '',
          ageMinutes,
          sla: {
            status: slaStatus,
            minutesRemaining: slaMinutesRemaining,
            type: slaType,
          },
          ai: ai ? {
            action: ai.action,
            confidence: ai.confidence,
            approvalRequired: ai.approval_required,
            approvalStatus: ai.approval_status,
            shadowMode: ai.shadow_mode,
            summary: aiSummary,
            eventType: ai.event_type,
            decidedAt: ai.created_at,
          } : null,
        };
      });

      // Sort: breached first, then at_risk, then by priority, then by age
      tickets.sort((a: any, b: any) => {
        const slaOrder: Record<string, number> = { breached: 0, at_risk: 1, ok: 2 };
        const slaA = slaOrder[a.sla.status] ?? 2;
        const slaB = slaOrder[b.sla.status] ?? 2;
        if (slaA !== slaB) return slaA - slaB;
        if (a.priorityOrder !== b.priorityOrder) return a.priorityOrder - b.priorityOrder;
        return b.ageMinutes - a.ageMinutes;
      });

      // Collect distinct values for filter dropdowns
      const allTiers = new Set<string>();
      const allProjects = new Set<string>();
      for (const t of tickets) {
        if (t.currentTier) allTiers.add(t.currentTier);
        allProjects.add(t.project);
      }

      res.json({ ok: true, data: {
        tickets, total: tickets.length,
        source: (cache && syncReady) ? 'cache' : 'jira', cached: !!(cache && syncReady),
        filters: { tiers: [...allTiers].sort(), projects: [...allProjects].sort() },
      } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get workspace queue' });
    }
  });

  router.get('/workspace/ticket/:key', async (req, res) => {
    try {
      const jira = agentLoop.getJiraClient();
      const issue = await jira.getIssue(req.params.key, [
        'summary', 'description', 'status', 'priority', 'issuetype',
        'assignee', 'reporter', 'created', 'updated',
        'customfield_10020', 'customfield_10010', 'labels', 'comment',
      ]);
      if (!issue) {
        res.status(404).json({ ok: false, error: 'Ticket not found' });
        return;
      }
      const decisions = await agentLoop.getObserver().getDecisionsByTicket(req.params.key, 5);
      res.json({ ok: true, data: { issue, decisions } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get ticket' });
    }
  });

  // ── Health ──

  router.get('/health', (_req, res) => {
    const healthy = agentLoop.isHealthy;
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      data: {
        healthy,
        ...agentLoop.status,
      },
    });
  });

  router.get('/llm-status', requireSuperAdmin(), (_req, res) => {
    const diag = agentLoop.getLlmService().getDiagnostics();
    res.json({ ok: true, data: diag });
  });

  // ── Suggestions ──

  const suggestionEngine = deps?.suggestionEngine;

  router.get('/suggestions', async (req, res) => {
    if (!suggestionEngine) { res.json({ ok: true, data: [] }); return; }
    try {
      const type = req.query.type as 'guardrail' | 'autonomy' | undefined;
      const status = (req.query.status as string) ?? 'pending';
      const data = await suggestionEngine.getSuggestions(type, status);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get suggestions' });
    }
  });

  router.post('/suggestions/refresh', async (_req, res) => {
    if (!suggestionEngine) { res.json({ ok: true, data: { created: 0 } }); return; }
    try {
      const created = await suggestionEngine.generateSuggestions();
      res.json({ ok: true, data: { created } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to refresh suggestions' });
    }
  });

  router.post('/suggestions/:id/apply', async (req, res) => {
    if (!suggestionEngine) { res.status(404).json({ ok: false, error: 'Suggestions not available' }); return; }
    try {
      const suggestion = await suggestionEngine.applySuggestion(parseInt(req.params.id));
      if (!suggestion) { res.status(404).json({ ok: false, error: 'Suggestion not found or already processed' }); return; }

      // Auto-apply the suggestion to the relevant system
      const s = suggestion.suggestion;
      if (suggestion.type === 'guardrail') {
        if (s.action === 'disable_rule' && s.ruleId) {
          agentLoop.getGuardrails().setRuleEnabled(s.ruleId as string, false);
        }
      } else if (suggestion.type === 'autonomy') {
        if (s.action === 'enable_autonomy' || s.action === 'new_category') {
          const autonomy = agentLoop.getAutonomyEngine();
          await autonomy.createRule({
            category: s.category as string,
            subCategory: null,
            enabled: true,
            minConfidence: (s.suggestedConfidence as number) ?? 0.85,
            minAcceptRate: (s.suggestedAcceptRate as number) ?? 90,
            minQaScore: 0,
            minDecisions: (s.suggestedMinDecisions as number) ?? 50,
            autonomousActions: ['draft_response'],
            updatedBy: (req as any).user?.username ?? 'system',
          });
        } else if ((s.action === 'raise_threshold' || s.action === 'lower_threshold') && s.ruleId) {
          const autonomy = agentLoop.getAutonomyEngine();
          await autonomy.updateRule(s.ruleId as number, {
            minConfidence: s.suggestedConfidence as number,
            updatedBy: (req as any).user?.username ?? 'system',
          });
        }
      }

      res.json({ ok: true, data: suggestion });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to apply suggestion' });
    }
  });

  router.post('/suggestions/:id/dismiss', async (req, res) => {
    if (!suggestionEngine) { res.status(404).json({ ok: false, error: 'Suggestions not available' }); return; }
    try {
      const ok = await suggestionEngine.dismissSuggestion(parseInt(req.params.id));
      if (!ok) { res.status(404).json({ ok: false, error: 'Suggestion not found or already processed' }); return; }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to dismiss suggestion' });
    }
  });

  // ── Escalation (WP-13) ──

  router.get('/escalation/reasons', async (_req, res) => {
    try {
      const rows = await query<any>(
        `SELECT id, reason_code, label, requires_troubleshooting, troubleshooting_checklist, sort_order
         FROM escalation_reasons WHERE active = 1 ORDER BY sort_order`,
      );
      const data = rows.map((r: any) => ({
        ...r,
        troubleshooting_checklist: r.troubleshooting_checklist ? JSON.parse(r.troubleshooting_checklist) : [],
      }));
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get escalation reasons' });
    }
  });

  router.get('/escalation/t2-agents', async (_req, res) => {
    try {
      const assignment = deps?.assignmentEngine;
      if (!assignment) {
        res.json({ ok: true, data: [] });
        return;
      }
      const agents = await assignment.getAvailableAgents('t2');
      res.json({ ok: true, data: agents });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get T2 agents' });
    }
  });

  router.post('/escalation/execute', async (req, res) => {
    const { ticketKey, reasonCode, reasonLabel, troubleshootingDone, assignToAgentId, additionalNotes, briefText } = req.body;
    if (!ticketKey || !reasonCode) {
      res.status(400).json({ ok: false, error: 'ticketKey and reasonCode are required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();
      const username = (req as any).user?.username ?? 'unknown';

      const escalationNote = [
        `🔺 Escalation via SOP-002 Gate`,
        ``,
        `Escalated by: ${username}`,
        `Reason: ${reasonLabel ?? reasonCode}`,
        troubleshootingDone?.length > 0 ? `\nTroubleshooting completed:\n${troubleshootingDone.map((s: string) => `  ✓ ${s}`).join('\n')}` : '',
        additionalNotes ? `\nNotes: ${additionalNotes}` : '',
      ].filter(Boolean).join('\n');

      await jira.addComment(ticketKey, escalationNote, { internal: true });

      if (assignToAgentId && deps?.assignmentEngine) {
        const agent = await deps.assignmentEngine.getAgent(assignToAgentId);
        if (agent) {
          await jira.updateFields(ticketKey, {
            assignee: { accountId: agent.jira_account_id },
          });
        }
      }

      res.json({ ok: true, data: { ticketKey, escalated: true } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Escalation failed' });
    }
  });

  // ── Briefs (WP-13) ──

  router.post('/brief/generate', async (req, res) => {
    const { ticketKey } = req.body;
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const briefEngine = deps?.briefEngine;
      if (!briefEngine) {
        res.status(503).json({ ok: false, error: 'Brief engine not available' });
        return;
      }
      const brief = await briefEngine.generateBrief(ticketKey);
      if (!brief) {
        res.status(404).json({ ok: false, error: 'Ticket not found' });
        return;
      }
      res.json({ ok: true, data: brief });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate brief' });
    }
  });

  router.post('/brief/post-to-jira', async (req, res) => {
    const { ticketKey, brief } = req.body;
    if (!ticketKey || !brief) {
      res.status(400).json({ ok: false, error: 'ticketKey and brief are required' });
      return;
    }
    try {
      const briefEngine = deps?.briefEngine;
      if (!briefEngine) {
        res.status(503).json({ ok: false, error: 'Brief engine not available' });
        return;
      }
      await briefEngine.postBriefToJira(ticketKey, brief);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to post brief' });
    }
  });

  // ── Classification (WP-18) ──

  router.get('/classifications', async (req, res) => {
    const ticketKey = req.query.ticketKey as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    try {
      const classifier = deps?.ticketClassifier;
      if (!classifier) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await classifier.getClassifications(ticketKey, limit);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get classifications' });
    }
  });

  router.get('/classifications/breakdown', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 180);
    try {
      const classifier = deps?.ticketClassifier;
      if (!classifier) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await classifier.getCategoryBreakdown(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get classification breakdown' });
    }
  });

  router.post('/classifications/run', async (_req, res) => {
    try {
      const classifier = deps?.ticketClassifier;
      if (!classifier) {
        res.status(503).json({ ok: false, error: 'Classifier not available' });
        return;
      }
      const results = await classifier.classifyResolved();
      res.json({ ok: true, data: { classified: results.length } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Classification run failed' });
    }
  });

  router.get('/trends', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 180);
    try {
      const classifier = deps?.ticketClassifier;
      if (!classifier) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await classifier.getTrendSnapshots(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get trends' });
    }
  });

  router.post('/trends/run', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 7, 30);
    try {
      const classifier = deps?.ticketClassifier;
      if (!classifier) {
        res.status(503).json({ ok: false, error: 'Classifier not available' });
        return;
      }
      const result = await classifier.runTrendAnalysis(days);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Trend analysis failed' });
    }
  });

  // ── Coaching (WP-14) ──

  router.get('/coaching/team', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);
    try {
      const coach = deps?.coachingEngine;
      if (!coach) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await coach.getTeamScores(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get team scores' });
    }
  });

  router.get('/coaching/agent/:agentUserId', async (req, res) => {
    const agentUserId = parseInt(req.params.agentUserId, 10);
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);
    if (isNaN(agentUserId)) {
      res.status(400).json({ ok: false, error: 'Invalid agent user ID' });
      return;
    }
    try {
      const coach = deps?.coachingEngine;
      if (!coach) {
        res.json({ ok: true, data: null });
        return;
      }
      const data = await coach.getAgentScores(agentUserId, days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get agent scores' });
    }
  });

  router.get('/coaching/nudges', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const agentUserId = req.query.agentUserId ? parseInt(req.query.agentUserId as string, 10) : undefined;
    try {
      const coach = deps?.coachingEngine;
      if (!coach) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await coach.getNudgeHistory(limit, agentUserId);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get nudge history' });
    }
  });

  router.post('/coaching/assess', async (req, res) => {
    const { ticketKey, agentAccountId, responseText } = req.body;
    if (!ticketKey || !agentAccountId || !responseText) {
      res.status(400).json({ ok: false, error: 'ticketKey, agentAccountId, and responseText are required' });
      return;
    }
    try {
      const coach = deps?.coachingEngine;
      if (!coach) {
        res.status(503).json({ ok: false, error: 'Coaching engine not available' });
        return;
      }
      const result = await coach.assessResponse(ticketKey, agentAccountId, responseText);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Assessment failed' });
    }
  });

  router.put('/coaching/visibility', (req, res) => {
    const { visibility } = req.body;
    const valid = ['off', 'agent', 'manager'];
    if (!valid.includes(visibility)) {
      res.status(400).json({ ok: false, error: `visibility must be one of: ${valid.join(', ')}` });
      return;
    }
    const coach = deps?.coachingEngine;
    if (!coach) {
      res.status(503).json({ ok: false, error: 'Coaching engine not available' });
      return;
    }
    coach.setVisibility(visibility);
    res.json({ ok: true, data: { visibility } });
  });

  // ── Roster & Assignment (WP-19) ──

  router.get('/roster', async (req, res) => {
    const pool = req.query.pool as Pool | undefined;
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await engine.getAllAgents(pool);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get roster' });
    }
  });

  router.post('/roster', async (req, res) => {
    const { jira_account_id, display_name, email, pool, skills, max_capacity, active, is_current_agent } = req.body;
    if (!jira_account_id || !display_name || !pool) {
      res.status(400).json({ ok: false, error: 'jira_account_id, display_name, and pool are required' });
      return;
    }
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.status(503).json({ ok: false, error: 'Assignment engine not available' });
        return;
      }
      const id = await engine.createAgent({
        jira_account_id, display_name, email: email ?? null,
        pool, skills: skills ?? null, max_capacity: max_capacity ?? 10,
        active: active ?? true, is_current_agent: is_current_agent ?? false,
      });
      const agent = await engine.getAgent(id);
      res.json({ ok: true, data: agent });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create agent' });
    }
  });

  router.put('/roster/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid agent ID' });
      return;
    }
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.status(503).json({ ok: false, error: 'Assignment engine not available' });
        return;
      }
      await engine.updateAgent(id, req.body);
      const agent = await engine.getAgent(id);
      res.json({ ok: true, data: agent });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update agent' });
    }
  });

  router.delete('/roster/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid agent ID' });
      return;
    }
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.status(503).json({ ok: false, error: 'Assignment engine not available' });
        return;
      }
      await engine.deleteAgent(id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to delete agent' });
    }
  });

  router.get('/roster/stats', async (_req, res) => {
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.json({ ok: true, data: {} });
        return;
      }
      const data = await engine.getPoolStats();
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get pool stats' });
    }
  });

  router.post('/roster/assign', async (req, res) => {
    const { ticketKey, pool, preferredSkills } = req.body;
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.status(503).json({ ok: false, error: 'Assignment engine not available' });
        return;
      }
      const result = await engine.assignToJira(ticketKey, pool ?? 'cc', preferredSkills);
      if (!result) {
        res.status(404).json({ ok: false, error: 'No available agents in pool' });
        return;
      }
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Assignment failed' });
    }
  });

  router.get('/roster/assignment-log', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    try {
      const engine = deps?.assignmentEngine;
      if (!engine) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await engine.getAssignmentLog(limit);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get assignment log' });
    }
  });

  // ── Availability (WP-19) ──

  router.get('/availability/snapshot', async (req, res) => {
    const date = (req.query.date as string) ?? new Date().toISOString().slice(0, 10);
    const pool = req.query.pool as string | undefined;
    try {
      const svc = deps?.availabilityService;
      if (!svc) {
        res.json({ ok: true, data: { date, available: [], unavailable: [], totalRoster: 0, availableCount: 0 } });
        return;
      }
      const data = await svc.getDaySnapshot(date, pool);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get availability' });
    }
  });

  router.post('/availability', async (req, res) => {
    const { rosterId, date, status, reason } = req.body;
    if (!rosterId || !date || !status) {
      res.status(400).json({ ok: false, error: 'rosterId, date, and status are required' });
      return;
    }
    try {
      const svc = deps?.availabilityService;
      if (!svc) {
        res.status(503).json({ ok: false, error: 'Availability service not available' });
        return;
      }
      await svc.setAvailability(rosterId, date, status as AvailabilityStatus, reason);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to set availability' });
    }
  });

  router.get('/availability/upcoming', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 14, 60);
    try {
      const svc = deps?.availabilityService;
      if (!svc) {
        res.json({ ok: true, data: [] });
        return;
      }
      const data = await svc.getUpcomingAbsences(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get upcoming absences' });
    }
  });

  router.get('/availability/capacity', async (req, res) => {
    const pool = req.query.pool as string | undefined;
    try {
      const svc = deps?.availabilityService;
      if (!svc) {
        res.json({ ok: true, data: {} });
        return;
      }
      const data = await svc.getCapacitySummary(pool);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get capacity' });
    }
  });

  // ── KPI Pipeline (WP-16) ──

  router.post('/kpi/snapshot', async (_req, res) => {
    try {
      const kpi = deps?.kpiPipeline;
      if (!kpi) { res.status(503).json({ ok: false, error: 'KPI pipeline not available' }); return; }
      const result = await kpi.collectJiraSnapshot();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'KPI snapshot failed' });
    }
  });

  router.post('/kpi/agent-snapshot', async (_req, res) => {
    try {
      const kpi = deps?.kpiPipeline;
      if (!kpi) { res.status(503).json({ ok: false, error: 'KPI pipeline not available' }); return; }
      const result = await kpi.snapshotAgentKpis();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Agent KPI snapshot failed' });
    }
  });

  router.post('/kpi/daily-digest', async (_req, res) => {
    try {
      const kpi = deps?.kpiPipeline;
      if (!kpi) { res.status(503).json({ ok: false, error: 'KPI pipeline not available' }); return; }
      const digest = await kpi.generateDailyDigest();
      res.json({ ok: true, data: digest });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Daily digest failed' });
    }
  });

  router.post('/kpi/weekly-digest', async (_req, res) => {
    try {
      const kpi = deps?.kpiPipeline;
      if (!kpi) { res.status(503).json({ ok: false, error: 'KPI pipeline not available' }); return; }
      const digest = await kpi.generateWeeklyDigest();
      res.json({ ok: true, data: digest });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Weekly digest failed' });
    }
  });

  router.get('/kpi/digest/:period', async (req, res) => {
    try {
      const kpi = deps?.kpiPipeline;
      if (!kpi) { res.status(503).json({ ok: false, error: 'KPI pipeline not available' }); return; }
      const period = req.params.period as 'daily' | 'weekly';
      if (period !== 'daily' && period !== 'weekly') {
        res.status(400).json({ ok: false, error: 'period must be daily or weekly' });
        return;
      }
      const digest = await kpi.getLatestDigest(period);
      res.json({ ok: true, data: digest });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get digest' });
    }
  });

  // ── QA Pipeline (WP-17) ──

  router.post('/qa/score-resolved', async (req, res) => {
    try {
      const qa = deps?.qaPipeline;
      if (!qa) { res.status(503).json({ ok: false, error: 'QA pipeline not available' }); return; }
      const hours = parseInt(req.query.hours as string, 10) || 24;
      const results = await qa.scoreRecentlyResolved(hours);
      res.json({ ok: true, data: { scored: results.length, results } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'QA scoring failed' });
    }
  });

  router.get('/qa/results', async (req, res) => {
    try {
      const qa = deps?.qaPipeline;
      if (!qa) { res.status(503).json({ ok: false, error: 'QA pipeline not available' }); return; }
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const results = await qa.getQaResults(limit);
      res.json({ ok: true, data: results });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get QA results' });
    }
  });

  // ── Pipeline Monitoring ──

  router.get('/pipeline/stats', async (_req, res) => {
    try {
      const mon = deps?.pipelineMonitor;
      if (!mon) { res.status(503).json({ ok: false, error: 'Pipeline monitor not available' }); return; }
      const stats = await mon.getStats();
      res.json({ ok: true, data: stats });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get pipeline stats' });
    }
  });

  router.get('/pipeline/runs', async (req, res) => {
    try {
      const mon = deps?.pipelineMonitor;
      if (!mon) { res.status(503).json({ ok: false, error: 'Pipeline monitor not available' }); return; }
      const pipeline = req.query.pipeline as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
      const runs = await mon.getRunHistory(pipeline, limit);
      res.json({ ok: true, data: runs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get pipeline runs' });
    }
  });

  router.get('/pipeline/compare/:pipeline', async (req, res) => {
    try {
      const mon = deps?.pipelineMonitor;
      if (!mon) { res.status(503).json({ ok: false, error: 'Pipeline monitor not available' }); return; }
      const pipeline = req.params.pipeline;
      const days = Math.min(parseInt(req.query.days as string, 10) || 7, 30);
      const comparison = await mon.compare(pipeline, days);
      res.json({ ok: true, data: comparison });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Comparison failed' });
    }
  });

  router.get('/pipeline/uat-compare', async (req, res) => {
    try {
      const mon = deps?.pipelineMonitor;
      if (!mon) { res.status(503).json({ ok: false, error: 'Pipeline monitor not available' }); return; }
      const table = req.query.table as string;
      const days = Math.min(parseInt(req.query.days as string, 10) || 7, 30);
      if (!table) { res.status(400).json({ ok: false, error: 'table query param required' }); return; }
      const data = await mon.compareTable(table, days);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'UAT comparison failed' });
    }
  });

  router.post('/pipeline/truncate-uat', async (_req, res) => {
    try {
      const mon = deps?.pipelineMonitor;
      if (!mon) { res.status(503).json({ ok: false, error: 'Pipeline monitor not available' }); return; }
      const result = await mon.truncateUatTables();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Truncate failed' });
    }
  });

  // ── Lifecycle (WP-23b) ──

  const LIFECYCLE_SETTINGS_KEYS = [
    'agent_approval_timeout_mins',
    'agent_auto_approve_threshold',
    'agent_awaiting_customer_hours',
    'agent_retriage_interval_hours',
    'agent_abandoned_approval_alert_mins',
    'agent_assigned_ticket_mode',
    'agent_human_inaction_hours',
  ] as const;

  const LIFECYCLE_DEFAULTS: Record<string, string> = {
    agent_approval_timeout_mins: '30',
    agent_auto_approve_threshold: '0.85',
    agent_awaiting_customer_hours: '48',
    agent_retriage_interval_hours: '24',
    agent_abandoned_approval_alert_mins: '15',
    agent_assigned_ticket_mode: 'observer',
    agent_human_inaction_hours: '4',
  };

  router.get('/lifecycle/breakdown', async (_req, res) => {
    try {
      const lm = agentLoop.getLifecycleManager();
      const breakdown = await lm.getTicketState().getLifecycleBreakdown();
      res.json({ ok: true, data: breakdown });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get lifecycle breakdown' });
    }
  });

  router.get('/lifecycle/approval-health', async (_req, res) => {
    try {
      const lm = agentLoop.getLifecycleManager();
      const health = await lm.getTicketState().getApprovalHealth();
      res.json({ ok: true, data: health });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get approval health' });
    }
  });

  router.get('/lifecycle/settings', (_req, res) => {
    const settings = deps?.settingsQueries;
    if (!settings) {
      res.status(503).json({ ok: false, error: 'Settings not available' });
      return;
    }
    const data: Record<string, string> = {};
    for (const key of LIFECYCLE_SETTINGS_KEYS) {
      data[key] = settings.get(key) ?? LIFECYCLE_DEFAULTS[key] ?? '';
    }
    res.json({ ok: true, data });
  });

  router.put('/lifecycle/settings', (req, res) => {
    const settings = deps?.settingsQueries;
    if (!settings) {
      res.status(503).json({ ok: false, error: 'Settings not available' });
      return;
    }
    const body = req.body as Record<string, string>;
    const validKeys = new Set<string>(LIFECYCLE_SETTINGS_KEYS);
    for (const [key, value] of Object.entries(body)) {
      if (validKeys.has(key)) {
        settings.set(key, String(value));
      }
    }
    const data: Record<string, string> = {};
    for (const key of LIFECYCLE_SETTINGS_KEYS) {
      data[key] = settings.get(key) ?? LIFECYCLE_DEFAULTS[key] ?? '';
    }
    res.json({ ok: true, data });
  });

  router.get('/lifecycle/tickets', async (req, res) => {
    try {
      const lm = agentLoop.getLifecycleManager();
      const lifecycle = req.query.lifecycle as string | undefined;
      const states = lifecycle ? lifecycle.split(',') as any[] : undefined;
      const tickets = await lm.getTicketState().getAll(states);
      res.json({ ok: true, data: tickets });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get lifecycle tickets' });
    }
  });

  return router;
}

