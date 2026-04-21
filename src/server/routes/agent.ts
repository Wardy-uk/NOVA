import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import type { AgentLoop } from '../services/agent-loop.js';
import { query, execute } from '../services/database.js';
import { RespondResultSchema, type RespondResult } from '../services/respond-schema.js';
import { ResolveSummarySchema, type ResolveSummaryResult } from '../services/resolve-schema.js';
import { loadPrompt } from '../services/prompt-loader.js';

export function createAgentRoutes(agentLoop: AgentLoop): Router {
  const router = Router();

  router.use(requireRole('admin'));

  router.get('/status', (_req, res) => {
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/start', (_req, res) => {
    agentLoop.start();
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/stop', (_req, res) => {
    agentLoop.stop();
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/pause', (_req, res) => {
    agentLoop.pause();
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/resume', (_req, res) => {
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

  router.post('/autonomy/kill-switch', async (_req, res) => {
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
        { tier: 'fast', ticketId: ticketKey, callType: 'quick_reply', temperature: 0.3 },
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
        { tier: 'fast', ticketId: ticketKey, callType: 'quick_resolve', temperature: 0.3 },
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
          status: (f.status as any)?.name ?? 'Unknown',
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
      const jira = agentLoop.getJiraClient();
      const project = req.query.project as string || 'NT';
      const assigneeFilter = req.query.assignee as string | undefined;

      const fields = [
        'summary', 'description', 'status', 'priority', 'issuetype',
        'assignee', 'reporter', 'created', 'updated',
        'customfield_10020', 'customfield_10010', 'labels',
      ];

      let jql = `project = ${project} AND resolution = EMPTY`;
      if (assigneeFilter) {
        jql += assigneeFilter === 'unassigned'
          ? ' AND assignee is EMPTY'
          : ` AND assignee = "${assigneeFilter}"`;
      }
      jql += ' ORDER BY created DESC';

      const result = await jira.searchJqlAll(jql, fields, 200);

      // Batch-fetch latest AI decision for each ticket
      const ticketKeys = result.issues.map((i: any) => i.key);
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
      const tickets = result.issues.map((issue: any) => {
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
          aiSummary = classCategory
            ? `${actionLabel} — ${classCategory}`
            : actionLabel;
        }

        const createdAt = new Date(f.created ?? '');
        const ageMinutes = Math.round((now - createdAt.getTime()) / 60000);

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

      res.json({ ok: true, data: { tickets, total: tickets.length, source: 'jira', cached: false } });
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

  return router;
}

