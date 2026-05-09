import { Router } from 'express';
import sql from 'mssql';
import { requireRole, requireSuperAdmin } from '../middleware/auth.js';
import type { AgentLoop } from '../services/agent-loop.js';
import { query, execute, queryOne } from '../services/database.js';
import { recordEvent, type AgentEvent } from '../services/agent-events.js';
import { MODEL_PRICING } from '../services/llm-service.js';
import { resolveStatusName, resolveStatusFromCache } from '../utils/jira-status.js';
import { RespondResultSchema, type RespondResult } from '../services/respond-schema.js';
import { ResolveSummarySchema, type ResolveSummaryResult } from '../services/resolve-schema.js';
import { ChaseResultSchema, type ChaseResult } from '../services/chase-schema.js';
import { loadPrompt } from '../services/prompt-loader.js';
import { z } from 'zod';
import { JIRA_FIELDS } from '../../shared/jira-fields.js';
import { buildResolveFields } from '../utils/jira-resolve-fields.js';
import type { AssignmentEngine, Pool } from '../services/assignment-engine.js';
import type { AgentAvailabilityService, AvailabilityStatus } from '../services/agent-availability.js';
import type { TicketClassifier } from '../services/ticket-classifier.js';
import type { BriefEngine } from '../services/brief-engine.js';
import type { KpiPipeline } from '../services/kpi-pipeline.js';
import type { QaPipeline } from '../services/qa-pipeline.js';
import type { PipelineMonitor } from '../services/pipeline-monitor.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraCacheQueries } from '../services/jira-cache-queries.js';
import type { JiraSyncService } from '../services/jira-sync-service.js';
import type { SuggestionEngine } from '../services/suggestion-engine.js';
import type { RiskScorer } from '../services/risk-scorer.js';
import type { EscalationLogService } from '../services/escalation-log-service.js';
import type { DriftDetector } from '../services/drift-detector.js';
import type { UserQueries, UserTeamQueries, TeamQueries, AutoRuleOverrideQueries } from '../db/queries.js';
import type { JiraUserClientFactory } from '../services/jira-user-client.js';
import { HygieneChecker } from '../services/hygiene-checker.js';
import { createWorkingDayClock } from '../../shared/utils/workingDayClock.js';

interface AgentRouteDeps {
  agentLoop: AgentLoop;
  assignmentEngine: AssignmentEngine;
  availabilityService: AgentAvailabilityService;
  ticketClassifier: TicketClassifier;
  briefEngine: BriefEngine;
  kpiPipeline: KpiPipeline;
  qaPipeline: QaPipeline;
  pipelineMonitor: PipelineMonitor;
  settingsQueries: FileSettingsQueries;
  jiraCache: JiraCacheQueries;
  jiraSyncService: JiraSyncService | null;
  suggestionEngine: SuggestionEngine | null;
  riskScorer: RiskScorer | null;
  escalationLog: EscalationLogService | null;
  driftDetector: DriftDetector | null;
  userQueries: UserQueries | null;
  userTeamQueries: UserTeamQueries | null;
  teamQueries: TeamQueries | null;
  autoRuleOverrideQueries: AutoRuleOverrideQueries | null;
  jiraUserClientFactory: JiraUserClientFactory | null;
}

export function createAgentRoutes(agentLoop: AgentLoop, deps?: Partial<Omit<AgentRouteDeps, 'agentLoop'>>): Router {
  const router = Router();

  async function requireJiraForUser(req: any, res: any): Promise<import('../services/jira-client.js').JiraRestClient | null> {
    const userId = req.user?.id as number | undefined;
    if (!userId || !deps?.jiraUserClientFactory) {
      res.status(403).json({ ok: false, error: 'Jira account not connected. Go to My Settings → Jira Account and click "Connect Jira" before taking actions.', code: 'JIRA_NOT_CONNECTED' });
      return null;
    }
    const client = await deps.jiraUserClientFactory.getClientForUser(userId);
    if (!client) {
      res.status(403).json({ ok: false, error: 'Jira account not connected. Go to My Settings → Jira Account and click "Connect Jira" before taking actions.', code: 'JIRA_NOT_CONNECTED' });
      return null;
    }
    return client;
  }

  let kpiPool: sql.ConnectionPool | null = null;
  async function getKpiPool(): Promise<sql.ConnectionPool> {
    if (kpiPool?.connected) return kpiPool;
    const s = deps?.settingsQueries?.getAll();
    if (!s?.kpi_sql_server || !s?.kpi_sql_database || !s?.kpi_sql_user || !s?.kpi_sql_password) {
      throw new Error('KPI SQL Server not configured');
    }
    kpiPool = await new sql.ConnectionPool({
      server: s.kpi_sql_server, database: s.kpi_sql_database,
      user: s.kpi_sql_user, password: s.kpi_sql_password,
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
    }).connect();
    return kpiPool;
  }

  router.use(requireRole('admin', 'super_admin'));

  router.get('/status', (_req, res) => {
    res.json({ ok: true, data: agentLoop.status });
  });

  router.get('/working-hours-debug', (_req, res) => {
    res.json({ ok: true, data: agentLoop.getWorkingHoursDebug() });
  });

  router.post('/start', requireSuperAdmin(), async (_req, res) => {
    agentLoop.start();
    deps?.settingsQueries?.set('agent_enabled', 'true');
    try { await execute(`MERGE agent_config AS t USING (SELECT 'agent_enabled' AS config_key) AS s ON t.config_key = s.config_key WHEN MATCHED THEN UPDATE SET config_value = 'true', updated_at = GETUTCDATE() WHEN NOT MATCHED THEN INSERT (config_key, config_value) VALUES ('agent_enabled', 'true');`); } catch {}
    res.json({ ok: true, data: agentLoop.status });
  });

  router.post('/stop', requireSuperAdmin(), async (_req, res) => {
    agentLoop.stop();
    deps?.settingsQueries?.set('agent_enabled', 'false');
    try { await execute(`MERGE agent_config AS t USING (SELECT 'agent_enabled' AS config_key) AS s ON t.config_key = s.config_key WHEN MATCHED THEN UPDATE SET config_value = 'false', updated_at = GETUTCDATE() WHEN NOT MATCHED THEN INSERT (config_key, config_value) VALUES ('agent_enabled', 'false');`); } catch {}
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

  router.post('/weekend-override', requireSuperAdmin(), (req, res) => {
    const { until } = req.body as { until?: string };
    if (!until) {
      res.json({ ok: false, error: 'Missing "until" datetime' });
      return;
    }
    const dt = new Date(until);
    if (isNaN(dt.getTime()) || dt.getTime() <= Date.now()) {
      res.json({ ok: false, error: 'Invalid or past datetime' });
      return;
    }
    agentLoop.setWeekendOverride(dt);
    res.json({ ok: true, data: agentLoop.status });
  });

  router.delete('/weekend-override', requireSuperAdmin(), (_req, res) => {
    agentLoop.clearWeekendOverride();
    res.json({ ok: true, data: agentLoop.status });
  });

  router.get('/decisions', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 500);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const observer = agentLoop.getObserver();
    const [decisions, total] = await Promise.all([
      observer.getDecisions(limit, offset),
      observer.getDecisionsCount(),
    ]);
    res.json({ ok: true, data: decisions, total });
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

  router.post('/backfill', requireRole('admin'), async (_req, res) => {
    try {
      const result = await agentLoop.runBackfillSweep();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Backfill failed' });
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

  router.get('/costs/by-mode', requireSuperAdmin(), async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 365);
    try {
      const workingHours = deps?.settingsQueries?.get('agent_working_hours') || '08:00-18:00';
      const workingDays = deps?.settingsQueries?.get('agent_working_days') || '1,2,3,4,5';
      const data = await agentLoop.getObserver().getCostsByMode(days, workingHours, workingDays);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get costs by mode' });
    }
  });

  // ── Hybrid action log ──

  router.get('/hybrid-actions', requireSuperAdmin(), async (_req, res) => {
    try {
      const limit = Math.min(parseInt(_req.query.limit as string, 10) || 50, 200);
      const rows = await query(
        'SELECT TOP(?) * FROM hybrid_action_log ORDER BY created_at DESC',
        [limit],
      );
      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get hybrid actions' });
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

  router.get('/flagged/score-distribution', async (_req, res) => {
    if (!deps?.riskScorer) return res.json({ ok: true, data: [] });
    try {
      const projects = (deps.settingsQueries?.get('agent_jira_project') || 'NT').split(',').map((p: string) => p.trim());
      const data = await deps.riskScorer.getScoreDistribution(projects);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get score distribution' });
    }
  });

  router.get('/flagged/diagnose/:key', async (req, res) => {
    if (!deps?.riskScorer) return res.status(503).json({ ok: false, error: 'Risk scorer not available' });
    try {
      const data = await deps.riskScorer.diagnoseTicket(req.params.key);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Diagnosis failed' });
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

  // ── Auto-Rules (deterministic) ──

  router.get('/auto-rules', async (_req, res) => {
    try {
      const rules = await agentLoop.getAutoRulesEngine().getRulesWithStats();
      res.json({ ok: true, data: { rules } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get auto-rules' });
    }
  });

  router.put('/auto-rules/:ruleId/enabled', async (req, res) => {
    const { ruleId } = req.params;
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ ok: false, error: 'enabled must be a boolean' });
      return;
    }
    const engine = agentLoop.getAutoRulesEngine();
    const validIds = engine.getRules().map(r => r.id);
    if (!validIds.includes(ruleId)) {
      res.status(404).json({ ok: false, error: `Unknown rule ID '${ruleId}'` });
      return;
    }
    try {
      const oq = deps?.autoRuleOverrideQueries;
      if (!oq) { res.status(503).json({ ok: false, error: 'Override queries not available' }); return; }
      await oq.setEnabled(ruleId, enabled, req.user?.username ?? 'unknown');
      engine.invalidateOverrideCache();
      console.log(`[auto-rules] Rule '${ruleId}' ${enabled ? 'enabled' : 'disabled'} by ${req.user?.username ?? 'unknown'}`);
      res.json({ ok: true, data: { ruleId, enabled } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update rule' });
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
           STRING_AGG(ticket_id, ', ') as ticket_ids,
           MIN(id) as id,
           MAX(assigned_to) as assigned_to,
           MAX(jira_ticket_key) as jira_ticket_key
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

  router.patch('/kb-gaps/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { assigned_to } = req.body;
    try {
      await execute(
        `UPDATE kb_gap_log SET assigned_to = ? WHERE id = ? OR (category = (SELECT category FROM kb_gap_log WHERE id = ?) AND ISNULL(suggested_title, '') = ISNULL((SELECT suggested_title FROM kb_gap_log WHERE id = ?), ''))`,
        [assigned_to ?? null, id, id, id],
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update KB gap' });
    }
  });

  router.post('/kb-gaps/:id/create-ticket', requireRole('admin'), async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    try {
      const gap = await queryOne<{ id: number; category: string; suggested_title: string; reason: string; assigned_to: string; jira_ticket_key: string; ticket_ids: string }>(
        `SELECT TOP 1 id, category, suggested_title, reason, assigned_to, jira_ticket_key,
                (SELECT STRING_AGG(ticket_id, ', ') FROM kb_gap_log g2 WHERE g2.category = g1.category AND ISNULL(g2.suggested_title, '') = ISNULL(g1.suggested_title, '')) as ticket_ids
         FROM kb_gap_log g1 WHERE id = ?`,
        [id],
      );
      if (!gap) { res.status(404).json({ ok: false, error: 'KB gap not found' }); return; }
      if (gap.jira_ticket_key) { res.json({ ok: true, data: { ticket_key: gap.jira_ticket_key, already_exists: true } }); return; }

      const jiraClient = agentLoop.getJiraClient();
      const project = deps?.settingsQueries?.get('kb_jira_project') || deps?.settingsQueries?.get('agent_jira_project')?.split(',')[0]?.trim() || 'NT';
      const issueType = deps?.settingsQueries?.get('kb_jira_issue_type') || 'Task';

      const description = [
        `*AI-identified knowledge base gap*\n`,
        gap.reason ? `*Why:* ${gap.reason}\n` : '',
        gap.ticket_ids ? `*Referenced tickets:* ${gap.ticket_ids}\n` : '',
        gap.category ? `*Category:* ${gap.category}` : '',
      ].filter(Boolean).join('\n');

      const fields: Record<string, unknown> = {
        project: { key: project },
        issuetype: { name: issueType },
        summary: `Create KB Article: ${gap.suggested_title || gap.category || 'Untitled'}`.slice(0, 255),
        description: {
          type: 'doc', version: 1,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }],
        },
        labels: ['kb-article', 'ai-identified'],
      };

      if (gap.assigned_to) {
        const roster = await queryOne<{ jira_account_id: string }>(
          `SELECT jira_account_id FROM agent_roster WHERE display_name = ? AND active = 1`,
          [gap.assigned_to],
        );
        if (roster?.jira_account_id) {
          fields.assignee = { accountId: roster.jira_account_id };
        }
      }

      const created = await jiraClient.createIssue({ fields });

      await execute(
        `UPDATE kb_gap_log SET jira_ticket_key = ? WHERE id = ? OR (category = (SELECT category FROM kb_gap_log WHERE id = ?) AND ISNULL(suggested_title, '') = ISNULL((SELECT suggested_title FROM kb_gap_log WHERE id = ?), ''))`,
        [created.key, id, id, id],
      );

      res.json({ ok: true, data: { ticket_key: created.key, ticket_url: `https://nurtur.atlassian.net/browse/${created.key}` } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create Jira ticket' });
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
      const jira = await requireJiraForUser(req, res);
      if (!jira) return;
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
      const jira = await requireJiraForUser(req, res);
      if (!jira) return;
      const username = (req as any).user?.username ?? 'unknown';
      const briefText = `🔺 Escalation from NOVA\n\nEscalated by: ${username}\nReason: ${reason ?? 'Not specified'}\n\nThis ticket requires specialist attention. Please review and assign to the appropriate team.`;
      await jira.addComment(ticketKey, briefText, { internal: true });
      res.json({ ok: true, data: { ticketKey, escalated: true } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to escalate' });
    }
  });

  // SOP-002 gated escalation
  const ESCALATION_TRANSITION_IDS: Record<string, string> = {
    tier2: '101',
    production: '14',
    development: '141',
  };
  const ESCALATION_DESTINATION_LABELS: Record<string, string> = {
    tier2: 'Tier 2',
    production: 'Production',
    development: 'Development',
  };

  router.post('/escalate', async (req, res) => {
    const { ticketKey, destination, reason, troubleshooting, summary } = req.body;
    if (!ticketKey || !destination || !reason || !troubleshooting || !summary) {
      res.status(400).json({ ok: false, error: 'All fields required: ticketKey, destination, reason, troubleshooting, summary' });
      return;
    }
    const transitionId = ESCALATION_TRANSITION_IDS[destination];
    if (!transitionId) {
      res.status(400).json({ ok: false, error: `Invalid destination: ${destination}` });
      return;
    }

    const username = (req as any).user?.username ?? 'unknown';
    const destLabel = ESCALATION_DESTINATION_LABELS[destination] ?? destination;

    const commentLines = [
      '── NOVA Escalation (SOP-002) ──',
      `Escalated by: ${username}`,
      `Destination: ${destLabel}`,
      `Reason: ${reason}`,
      '',
      'Troubleshooting performed:',
      troubleshooting,
      '',
      'Agent summary:',
      summary,
      '───────���───────────────────────',
    ];

    const commentText = commentLines.join('\n');

    const jira = await requireJiraForUser(req, res);
    if (!jira) return;
    let transitionError: string | null = null;
    let escalationId: number | null = null;

    try {
      await jira.addComment(ticketKey, commentText, { internal: true });
    } catch {
      // Comment failure is not fatal — try the transition anyway
    }

    try {
      await jira.transitionIssue(ticketKey, transitionId);
    } catch (err) {
      transitionError = err instanceof Error ? err.message : 'Transition failed';
    }

    // Log to escalation_log
    try {
      if (deps?.escalationLog) {
        escalationId = await deps.escalationLog.log({
          ticket_key: ticketKey,
          escalation_type: 'manual',
          to_tier: destLabel,
          reason_code: reason,
          reason_label: reason,
          escalated_by: username,
          notes: summary,
          source: 'manual_sop002',
        });
      }
    } catch { /* log failure is not fatal */ }

    // Emit agent event
    try {
      await recordEvent('action_taken', username, ticketKey, {
        action_type: 'escalate',
        destination,
        reason,
        transition_id: transitionId,
        transition_error: transitionError,
      });
    } catch { /* event failure is not fatal */ }

    if (transitionError) {
      res.json({ ok: true, data: { escalationId, transitionedTo: null, warning: transitionError } });
    } else {
      res.json({ ok: true, data: { escalationId, transitionedTo: destLabel } });
    }
  });

  // ── Holding update (SOP-008) ──

  router.post('/holding-update/draft', async (req, res) => {
    const { ticketKey, tone } = req.body as { ticketKey?: string; tone?: string };
    if (!ticketKey) {
      res.status(400).json({ ok: false, error: 'ticketKey is required' });
      return;
    }
    try {
      const jira = agentLoop.getJiraClient();
      const llm = agentLoop.getLlmService();

      const issue = await jira.getIssue(ticketKey, [
        'summary', 'status', 'priority', 'comment',
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

      const conversation = (comments ?? [])
        .slice(-5)
        .map(c => {
          const isInternal = c.properties?.some(p => p.key === 'sd.public.comment' && p.value?.internal) ?? false;
          return `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}${isInternal ? ' (internal)' : ''}:\n${typeof c.body === 'string' ? c.body.slice(0, 500) : '(complex body)'}`;
        })
        .join('\n\n---\n\n');

      const systemPrompt = loadPrompt('holding-update', {
        ticket_key: ticketKey,
        summary: (f.summary as string) ?? '',
        status: (f.status as any)?.name ?? 'Unknown',
        priority: (f.priority as any)?.name ?? 'Medium',
        conversation: conversation || '(no comments)',
        tone: tone === 'formal' ? 'formal' : 'friendly',
      });

      const HoldingDraftSchema = z.object({ draft: z.string() });
      const result = await llm.call(
        systemPrompt,
        'Generate a holding update for this ticket.',
        HoldingDraftSchema,
        { ticketId: ticketKey, callType: 'holding_update', temperature: 0.4 },
      );

      res.json({ ok: true, data: { draft: result.data.draft } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate draft' });
    }
  });

  router.post('/holding-update/send', async (req, res) => {
    const { ticketKey, message, nextUpdateAt, tone } = req.body as {
      ticketKey?: string;
      message?: string;
      nextUpdateAt?: string;
      tone?: string;
    };
    if (!ticketKey || !message || !nextUpdateAt) {
      res.status(400).json({ ok: false, error: 'ticketKey, message, and nextUpdateAt are required' });
      return;
    }

    const jira = await requireJiraForUser(req, res);
    if (!jira) return;
    const username = (req as any).user?.username ?? 'unknown';

    try {
      // Public customer-facing comment (NOT internal)
      await jira.addComment(ticketKey, message);

      // Set Agent Next Update field
      await jira.updateFields(ticketKey, {
        [JIRA_FIELDS.AGENT_NEXT_UPDATE]: nextUpdateAt,
      });

      // Emit action_taken event
      await recordEvent('action_taken', username, ticketKey, {
        action_type: 'holding_update',
        tone: tone ?? 'friendly',
        message_length: message.length,
        next_update_at: nextUpdateAt,
      });

      // Emit next_update_commitment_set event
      const committedAt = new Date().toISOString();
      const dueAt = new Date(nextUpdateAt);
      const msOut = dueAt.getTime() - Date.now();
      const workingDaysOut = Math.round(msOut / (1000 * 60 * 60 * 8)) / 1;
      await recordEvent('next_update_commitment_set', username, ticketKey, {
        committed_at: committedAt,
        due_at: nextUpdateAt,
        working_days_out: workingDaysOut > 0 ? workingDaysOut : 1,
        set_via: 'holding_update',
      });

      res.json({ ok: true, data: { ticketKey, commentPosted: true, nextUpdateAt } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send holding update' });
    }
  });

  // ── Hygiene Pass (SOP-012) ──

  const hygieneClock = createWorkingDayClock();
  const hygieneChecker = new HygieneChecker(hygieneClock);

  router.post('/hygiene/run', async (req, res) => {
    const username = (req as any).user?.username ?? 'unknown';
    try {
      const cache = deps?.jiraCache;
      if (!cache) {
        res.status(503).json({ ok: false, error: 'Jira cache not available' });
        return;
      }

      const userQueries = deps?.userQueries;
      const user = userQueries ? (await userQueries.getAll()).find(u => u.username === username) : null;
      const agentEmail = user?.email ?? username;

      const tickets = await cache.getByAssignee(agentEmail, ['NT']);
      const agentAccountId = tickets[0]?.assignee_account_id ?? '';
      if (tickets.length === 0) {
        res.json({ ok: true, data: { agentId: username, hourBlock: new Date().toISOString().slice(0, 13) + ':00', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), ticketCount: 0, failedTickets: [], passedCount: 0 } });
        return;
      }

      const startMs = Date.now();
      const result = await hygieneChecker.runPass({
        agentId: username,
        agentAccountId,
        tickets,
        getComments: (ticketKey) => cache.getComments(ticketKey, 10),
        getAgentNextUpdate: async (ticketKey) => {
          const issue = tickets.find(t => t.issue_key === ticketKey);
          return issue?.agent_next_update ?? null;
        },
      });
      const durationMs = Date.now() - startMs;

      for (const failed of result.failedTickets) {
        await recordEvent('hygiene_flagged', username, failed.ticketKey, {
          failed_checks: failed.checks.filter(c => !c.passed).map(c => c.id),
          detail: failed.checks.filter(c => !c.passed).map(c => c.detail).join('; '),
        });
      }

      await recordEvent('hygiene_pass_completed', username, null, {
        hour_block: result.hourBlock,
        ticket_count: result.ticketCount,
        fails: result.failedTickets.length,
        duration_ms: durationMs,
      });

      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to run hygiene pass' });
    }
  });

  router.get('/hygiene/status', async (req, res) => {
    const username = (req as any).user?.username ?? 'unknown';
    try {
      const todayEvents = await query<{ id: number; event_type: string; ticket_key: string | null; payload: string; created_at: string }>(
        `SELECT id, event_type, ticket_key, payload, created_at
         FROM agent_events
         WHERE agent_id = ? AND event_type IN ('hygiene_pass_completed', 'hygiene_flagged', 'action_taken')
           AND created_at >= CAST(SYSUTCDATETIME() AS DATE)
         ORDER BY created_at DESC`,
        [username],
      );

      const passes = todayEvents.filter(e => e.event_type === 'hygiene_pass_completed');
      const lastPass = passes[0] ?? null;
      const lastPassPayload = lastPass ? (typeof lastPass.payload === 'string' ? JSON.parse(lastPass.payload) : lastPass.payload) : null;

      const flaggedEvents = todayEvents.filter(e => e.event_type === 'hygiene_flagged' && e.ticket_key);
      const dismissEvents = todayEvents.filter(e => {
        if (e.event_type !== 'action_taken') return false;
        const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
        return p.action_type === 'hygiene_dismiss';
      });

      const dismissedKeys = new Set(dismissEvents.map(e => e.ticket_key));

      const flaggedTickets = flaggedEvents
        .filter(e => !dismissedKeys.has(e.ticket_key))
        .reduce((acc, e) => {
          if (acc.find(a => a.ticketKey === e.ticket_key)) return acc;
          const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
          acc.push({
            ticketKey: e.ticket_key!,
            failedChecks: p.failed_checks ?? [],
            detail: p.detail ?? '',
            flaggedAt: e.created_at,
            resolved: false,
          });
          return acc;
        }, [] as Array<{ ticketKey: string; failedChecks: string[]; detail: string; flaggedAt: string; resolved: boolean }>);

      const now = new Date();
      const currentHour = now.toISOString().slice(0, 13) + ':00';
      const hasPassThisHour = passes.some(p => {
        const pp = typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload;
        return pp.hour_block === currentHour;
      });
      const hygieneDue = hygieneClock.isWorkingTime(now) && !hasPassThisHour;

      const workingHoursElapsed = Math.max(1, Math.floor(
        (now.getHours() >= 9 ? Math.min(now.getHours(), 17) - 9 : 0),
      ));
      const compliancePercent = workingHoursElapsed > 0
        ? Math.round((passes.length / workingHoursElapsed) * 100)
        : 100;

      res.json({
        ok: true,
        data: {
          lastPassAt: lastPass?.created_at ?? null,
          lastPassHourBlock: lastPassPayload?.hour_block ?? null,
          flaggedTickets,
          passesTodayCount: passes.length,
          compliancePercent: Math.min(100, compliancePercent),
          hygieneDue,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get hygiene status' });
    }
  });

  router.post('/hygiene/dismiss', async (req, res) => {
    const { ticketKey, resolution } = req.body as { ticketKey?: string; resolution?: string };
    if (!ticketKey || !resolution) {
      res.status(400).json({ ok: false, error: 'ticketKey and resolution are required' });
      return;
    }
    const validResolutions = ['actioned', 'deferred', 'false_positive'];
    if (!validResolutions.includes(resolution)) {
      res.status(400).json({ ok: false, error: `resolution must be one of: ${validResolutions.join(', ')}` });
      return;
    }
    const username = (req as any).user?.username ?? 'unknown';
    try {
      await recordEvent('action_taken', username, ticketKey, {
        action_type: 'hygiene_dismiss',
        resolution,
      });
      res.json({ ok: true, data: { ticketKey, resolution } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to dismiss hygiene flag' });
    }
  });

  // ── Chase (SOP-003) ──

  router.post('/chase/draft', async (req, res) => {
    const { ticketKey } = req.body as { ticketKey?: string };
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
      const comments = ((f.comment as any)?.comments as Array<{
        author?: { displayName?: string; emailAddress?: string };
        body?: string;
        created?: string;
        properties?: Array<{ key: string; value?: { internal?: boolean } }>;
      }>) ?? [];

      const assigneeEmail = (f.assignee as any)?.emailAddress ?? '';
      const publicComments = comments.filter(c => {
        const isInternal = c.properties?.some(p => p.key === 'sd.public.comment' && p.value?.internal) ?? false;
        return !isInternal;
      });
      const lastAgentComment = publicComments.reverse().find(c =>
        c.author?.emailAddress === assigneeEmail || !(c.author?.emailAddress),
      );

      let daysWaiting = 0;
      if (lastAgentComment?.created) {
        const hoursSince = hygieneClock.workingHoursBetween(new Date(lastAgentComment.created), new Date());
        daysWaiting = Math.round((hoursSince / 8) * 10) / 10;
      }

      if (daysWaiting < 2) {
        res.json({ ok: false, error: `Too early to chase — only ${daysWaiting} working days` });
        return;
      }

      let stage: 'day2_nudge' | 'day4_warning' | 'day5_close';
      if (daysWaiting >= 5) stage = 'day5_close';
      else if (daysWaiting >= 4) stage = 'day4_warning';
      else stage = 'day2_nudge';

      if (stage === 'day5_close') {
        res.json({ ok: true, data: { ticketKey, stage, daysWaiting, redirectToClose: true } });
        return;
      }

      const conversationThread = comments
        .slice(-10)
        .map(c => {
          const isInternal = c.properties?.some(p => p.key === 'sd.public.comment' && p.value?.internal) ?? false;
          return `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}${isInternal ? ' (internal)' : ''}:\n${typeof c.body === 'string' ? c.body.slice(0, 500) : '(complex body)'}`;
        })
        .join('\n\n---\n\n');

      const systemPrompt = loadPrompt('chase', {
        ticket_key: ticketKey,
        summary: (f.summary as string) ?? '',
        description: ((f.description as string) ?? '').slice(0, 1000),
        priority: (f.priority as any)?.name ?? 'Medium',
        reporter: (f.reporter as any)?.displayName ?? 'Unknown',
        organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? 'Unknown',
        status: (f.status as any)?.name ?? 'Unknown',
        days_waiting: String(Math.round(daysWaiting)),
        conversation_thread: conversationThread || '(no comments)',
      });

      const result = await llm.call<ChaseResult>(
        systemPrompt,
        'Draft a chase follow-up for this ticket.',
        ChaseResultSchema,
        { ticketId: ticketKey, callType: 'chase_draft', temperature: 0.4 },
      );

      res.json({
        ok: true,
        data: {
          ticketKey,
          stage,
          daysWaiting,
          draftMessage: result.data.draft_response,
          tone: result.data.tone_check,
          provider: result.provider,
          model: result.model,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to draft chase' });
    }
  });

  router.post('/chase/send', async (req, res) => {
    const { ticketKey, message, stage } = req.body as { ticketKey?: string; message?: string; stage?: string };
    if (!ticketKey || !message || message.length < 10) {
      res.status(400).json({ ok: false, error: 'ticketKey and message (min 10 chars) are required' });
      return;
    }
    const username = (req as any).user?.username ?? 'unknown';
    try {
      const jira = await requireJiraForUser(req, res);
      if (!jira) return;
      await jira.addComment(ticketKey, message);

      await recordEvent('action_taken', username, ticketKey, {
        action_type: 'chase',
        stage: stage ?? 'unknown',
        message_length: message.length,
      });

      res.json({ ok: true, data: { ticketKey, commentPosted: true, stage } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send chase' });
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
    const { ticketKey, customerMessage, resolutionSummary, resolutionType, nurturProduct, subCategory } = req.body;
    if (!ticketKey || !customerMessage || !resolutionSummary || !resolutionType) {
      res.status(400).json({ ok: false, error: 'ticketKey, customerMessage, resolutionSummary, and resolutionType are required' });
      return;
    }
    const username = (req as any).user?.username ?? 'unknown';
    try {
      const jira = await requireJiraForUser(req, res);
      if (!jira) return;

      const { fields, comment } = buildResolveFields({
        tldr: resolutionSummary,
        resolution: resolutionType,
        comment: customerMessage,
        product: nurturProduct,
        subCategory: subCategory,
      });

      await jira.transitionIssue(ticketKey, '17', { fields, comment });

      await recordEvent('action_taken', username, ticketKey, {
        action_type: 'close_ticket',
        resolution_type: resolutionType,
        message_length: customerMessage.length,
        via: 'close_panel',
      });

      res.json({ ok: true, data: { ticketKey, resolved: true } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to resolve' });
    }
  });

  // SOP-004 route ticket
  const MODEL_A_DESTINATIONS = new Set(['NTPJ', 'Finance', 'Starberry', 'Yomdel']);
  const MODEL_B_DESTINATIONS = new Set(['Tech Services', 'Dev team']);

  router.post('/route', async (req, res) => {
    const { ticketKey, model, destination, reason, internalNote } = req.body;
    if (!ticketKey || !model || !destination || !reason) {
      res.status(400).json({ ok: false, error: 'ticketKey, model, destination, and reason are required' });
      return;
    }
    if (reason.length < 10) {
      res.status(400).json({ ok: false, error: 'Reason must be at least 10 characters' });
      return;
    }

    const username = (req as any).user?.username ?? 'unknown';
    const jira = await requireJiraForUser(req, res);
    if (!jira) return;

    // Load configurable project key mapping
    const routeProjectsSetting = deps?.settingsQueries?.get('route_destination_projects');
    let routeProjects: Record<string, string | null> = {
      NTPJ: 'NTPJ', Finance: null, Starberry: null, Yomdel: null, 'Tech Services': null,
    };
    if (routeProjectsSetting) {
      try { routeProjects = JSON.parse(routeProjectsSetting); } catch { /* use defaults */ }
    }

    if (model === 'A') {
      if (!MODEL_A_DESTINATIONS.has(destination)) {
        res.status(400).json({ ok: false, error: `Invalid Model A destination: ${destination}. Valid: ${[...MODEL_A_DESTINATIONS].join(', ')}` });
        return;
      }
      const projectKey = routeProjects[destination];
      if (!projectKey) {
        res.status(400).json({ ok: false, error: `Jira project key not configured for "${destination}". Ask an admin to set route_destination_projects in NOVA settings.` });
        return;
      }

      try {
        const original = await jira.getIssue(ticketKey, ['summary', 'description', 'reporter', 'priority', 'comment']);
        if (!original) {
          res.status(404).json({ ok: false, error: `Ticket ${ticketKey} not found` });
          return;
        }

        const f = original.fields as Record<string, any>;
        const summary = f?.summary ?? ticketKey;
        const description = f?.description;
        const reporterName = f?.reporter?.displayName ?? 'Customer';
        const priority = f?.priority;

        const newIssueFields: Record<string, unknown> = {
          project: { key: projectKey },
          summary,
          issuetype: { name: 'Task' },
        };
        if (description) newIssueFields.description = description;
        if (priority) newIssueFields.priority = { id: priority.id };

        const created = await jira.createIssue({ fields: newIssueFields });
        const newTicketKey = created.key;

        await jira.addComment(newTicketKey, `Routed from ${ticketKey}. Original reporter: ${reporterName}. Reason: ${reason}${internalNote ? `\n\nAdditional context: ${internalNote}` : ''}`, { internal: true });

        const { fields: resolveFields, comment } = buildResolveFields({
          tldr: `Routed to ${destination} — ${reason}`,
          resolution: 'Request Cancelled / Withdrawn',
          comment: `Hi ${reporterName}, I've transferred this to our ${destination} team who are better placed to help with this. You'll receive a notification from the new ticket shortly. Your new reference is ${newTicketKey}.`,
        });

        await jira.transitionIssue(ticketKey, '17', { fields: resolveFields, comment });

        try {
          await jira.createIssueLink({
            type: { name: 'Relates' },
            inwardIssue: { key: ticketKey },
            outwardIssue: { key: newTicketKey },
          });
        } catch { /* linking is best-effort */ }

        await recordEvent('action_taken', username, ticketKey, {
          action_type: 'route',
          model: 'A',
          destination,
          new_ticket_key: newTicketKey,
          reason,
        });

        res.json({ ok: true, data: { ticketKey, newTicketKey, model: 'A', destination, closed: true } });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to route ticket (Model A)' });
      }

    } else if (model === 'B') {
      if (!MODEL_B_DESTINATIONS.has(destination)) {
        res.status(400).json({ ok: false, error: `Invalid Model B destination: ${destination}. Valid: ${[...MODEL_B_DESTINATIONS].join(', ')}` });
        return;
      }
      if (destination === 'Dev team') {
        res.status(400).json({ ok: false, error: 'Dev team routing goes through T2 escalation (SOP-002 → SOP-007). Use the Escalate action instead.' });
        return;
      }

      try {
        const original = await jira.getIssue(ticketKey, ['summary', 'description', 'reporter', 'priority']);
        if (!original) {
          res.status(404).json({ ok: false, error: `Ticket ${ticketKey} not found` });
          return;
        }

        const f = original.fields as Record<string, any>;
        const summary = f?.summary ?? ticketKey;
        const description = f?.description;
        const reporterName = f?.reporter?.displayName ?? 'Customer';
        const priority = f?.priority;

        const projectKey = routeProjects[destination];
        let parallelKey: string | null = null;

        if (projectKey) {
          const newFields: Record<string, unknown> = {
            project: { key: projectKey },
            summary: `[Parallel] ${summary}`,
            issuetype: { name: 'Task' },
          };
          if (description) newFields.description = description;
          if (priority) newFields.priority = { id: priority.id };

          const created = await jira.createIssue({ fields: newFields });
          parallelKey = created.key;

          try {
            await jira.createIssueLink({
              type: { name: 'Relates' },
              inwardIssue: { key: ticketKey },
              outwardIssue: { key: parallelKey },
            });
          } catch { /* linking is best-effort */ }
        }

        await jira.addComment(ticketKey, `Parallel ticket created: ${parallelKey ?? 'N/A (no project key configured)'}. Chasing cadence: every 3 working days. Agent retains customer ownership.${internalNote ? `\n\nAdditional context: ${internalNote}` : ''}`, { internal: true });

        const nextChaseDate = new Date();
        let daysAdded = 0;
        while (daysAdded < 3) {
          nextChaseDate.setDate(nextChaseDate.getDate() + 1);
          const dow = nextChaseDate.getDay();
          if (dow !== 0 && dow !== 6) daysAdded++;
        }
        const chaseDateStr = nextChaseDate.toISOString().split('T')[0];

        await jira.addComment(ticketKey, `Hi ${reporterName}, I'm coordinating with our ${destination} team on this. I'll keep you updated — you can expect to hear from me by ${chaseDateStr}.`);

        try {
          await jira.updateFields(ticketKey, { [JIRA_FIELDS.AGENT_NEXT_UPDATE]: chaseDateStr });
        } catch { /* best-effort */ }

        await recordEvent('action_taken', username, ticketKey, {
          action_type: 'route',
          model: 'B',
          destination,
          parallel_ticket_key: parallelKey,
          reason,
        });

        res.json({ ok: true, data: { ticketKey, parallelTicketKey: parallelKey, model: 'B', destination, closed: false } });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to route ticket (Model B)' });
      }

    } else {
      res.status(400).json({ ok: false, error: 'model must be "A" or "B"' });
    }
  });

  // ── Manager Dashboard endpoints ──

  function periodToDateFilter(period: string, alias = 'e'): string {
    if (period === 'week') return `AND ${alias}.created_at >= DATEADD(DAY, -7, SYSUTCDATETIME())`;
    if (period === 'month') return `AND ${alias}.created_at >= DATEADD(DAY, -30, SYSUTCDATETIME())`;
    return `AND ${alias}.created_at >= CAST(SYSUTCDATETIME() AS DATE)`;
  }

  function workingHoursInPeriod(period: string): number {
    const now = new Date();
    let start: Date;
    if (period === 'month') { start = new Date(now); start.setDate(start.getDate() - 30); }
    else if (period === 'week') { start = new Date(now); start.setDate(start.getDate() - 7); }
    else { start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0); }
    const clock = createWorkingDayClock();
    return Math.max(0, clock.workingHoursBetween(start, now));
  }

  router.get('/manager/overview', async (req, res) => {
    const period = (req.query.period as string) || 'today';
    const pool = (req.query.pool as string) || 'all';
    const dateFilter = periodToDateFilter(period);
    const poolFilter = pool !== 'all' ? `AND ar.pool = '${pool.replace(/'/g, '')}'` : '';

    try {
      const actionRows = await query<{ agent_id: string; action_type: string; time_to_action_ms: number | null }>(
        `SELECT e.agent_id, JSON_VALUE(e.payload, '$.action_type') AS action_type,
                CAST(JSON_VALUE(e.payload, '$.time_to_action_ms') AS FLOAT) AS time_to_action_ms
         FROM agent_events e
         LEFT JOIN agent_roster ar ON e.agent_id = ar.display_name
         WHERE e.event_type = 'action_taken' ${dateFilter} ${poolFilter}`,
        [],
      );

      const deferRows = await query<{ agent_id: string; reason: string }>(
        `SELECT e.agent_id, JSON_VALUE(e.payload, '$.reason') AS reason
         FROM agent_events e
         LEFT JOIN agent_roster ar ON e.agent_id = ar.display_name
         WHERE e.event_type = 'action_deferred' ${dateFilter} ${poolFilter}`,
        [],
      );

      const hygieneRows = await query<{ agent_id: string; hour_block: string; fails: number; ticket_count: number; duration_ms: number }>(
        `SELECT e.agent_id,
                JSON_VALUE(e.payload, '$.hour_block') AS hour_block,
                CAST(JSON_VALUE(e.payload, '$.fails') AS INT) AS fails,
                CAST(JSON_VALUE(e.payload, '$.ticket_count') AS INT) AS ticket_count,
                CAST(JSON_VALUE(e.payload, '$.duration_ms') AS FLOAT) AS duration_ms
         FROM agent_events e
         LEFT JOIN agent_roster ar ON e.agent_id = ar.display_name
         WHERE e.event_type = 'hygiene_pass_completed' ${dateFilter} ${poolFilter}`,
        [],
      );

      const backstopRows = await query<{ agent_id: string; ticket_key: string; days_in_state: number; created_at: string }>(
        `SELECT e.agent_id, e.ticket_key,
                CAST(JSON_VALUE(e.payload, '$.days_in_state') AS INT) AS days_in_state,
                e.created_at
         FROM agent_events e
         LEFT JOIN agent_roster ar ON e.agent_id = ar.display_name
         WHERE e.event_type = 'auto_close_backstop_fired' ${dateFilter} ${poolFilter}`,
        [],
      );

      const commitmentRows = await query<{ agent_id: string; ticket_key: string; committed_at: string; due_at: string; working_days_out: number }>(
        `SELECT e.agent_id, e.ticket_key,
                JSON_VALUE(e.payload, '$.committed_at') AS committed_at,
                JSON_VALUE(e.payload, '$.due_at') AS due_at,
                CAST(JSON_VALUE(e.payload, '$.working_days_out') AS INT) AS working_days_out
         FROM agent_events e
         LEFT JOIN agent_roster ar ON e.agent_id = ar.display_name
         WHERE e.event_type = 'next_update_commitment_set' ${dateFilter} ${poolFilter}`,
        [],
      );

      const commitmentMetKeys = new Set(
        (await query<{ ticket_key: string }>(
          `SELECT DISTINCT e.ticket_key FROM agent_events e WHERE e.event_type = 'action_taken' AND JSON_VALUE(e.payload, '$.action_type') = 'commitment_met' ${dateFilter}`, [],
        )).map(r => r.ticket_key),
      );

      const overrideRows = await query<{ agent_id: string }>(
        `SELECT e.agent_id FROM agent_events e
         LEFT JOIN agent_roster ar ON e.agent_id = ar.display_name
         WHERE e.event_type = 'rank_override' ${dateFilter} ${poolFilter}`,
        [],
      );

      const kbGapCount = (await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_events e
         WHERE e.event_type = 'action_taken' AND JSON_VALUE(e.payload, '$.action_type') = 'kb_gap_logged' ${dateFilter}`,
        [],
      ))[0]?.cnt ?? 0;

      // Overdue customers — live check
      let customersOverdue = 0;
      try {
        const perceiver = agentLoop.getPerceiver();
        if (perceiver) {
          const openIssues = perceiver.getLastOpenIssues();
          const clock = createWorkingDayClock();
          const now = new Date();
          for (const issue of openIssues) {
            const f = issue.fields as Record<string, any>;
            const nextUpdate = f?.[JIRA_FIELDS.AGENT_NEXT_UPDATE];
            if (nextUpdate && new Date(nextUpdate) < now) { customersOverdue++; continue; }
            const comments = (f?.comment as any)?.comments ?? [];
            const lastPublic = [...comments].reverse().find((c: any) => !c.properties?.find((p: any) => p.key === 'sd.public.comment' && p.value?.internal));
            if (lastPublic) {
              const hours = clock.workingHoursBetween(new Date(lastPublic.created), now);
              if (hours > 16) customersOverdue++;
            }
          }
        }
      } catch { /* best-effort */ }

      // Hourly activity heatmap
      const hourlyRows = await query<{ hour: number; day: string; eventCount: number }>(
        `SELECT DATEPART(HOUR, e.created_at) AS hour,
                CONVERT(VARCHAR(10), e.created_at, 23) AS day,
                COUNT(*) AS eventCount
         FROM agent_events e
         WHERE e.event_type IN ('action_taken', 'action_deferred', 'hygiene_pass_completed') ${dateFilter}
         GROUP BY DATEPART(HOUR, e.created_at), CONVERT(VARCHAR(10), e.created_at, 23)
         ORDER BY day, hour`,
        [],
      );

      // Build agent roster map
      const rosterRows = await query<{ display_name: string; pool: string }>(
        `SELECT display_name, pool FROM agent_roster WHERE active = 1 ${pool !== 'all' ? `AND pool = '${pool.replace(/'/g, '')}'` : ''}`,
        [],
      );
      const agentNames = new Map(rosterRows.map(r => [r.display_name, r.pool]));

      // Aggregate all unique agent IDs from events
      const allAgentIds = new Set([
        ...actionRows.map(r => r.agent_id),
        ...deferRows.map(r => r.agent_id),
        ...hygieneRows.map(r => r.agent_id),
        ...backstopRows.map(r => r.agent_id),
        ...commitmentRows.map(r => r.agent_id),
        ...overrideRows.map(r => r.agent_id),
      ].filter(Boolean));

      // Per-agent stats
      const ttaValues = actionRows.filter(r => r.time_to_action_ms != null).map(r => r.time_to_action_ms!);
      const avgTimeToAction = ttaValues.length > 0 ? ttaValues.reduce((a, b) => a + b, 0) / ttaValues.length : null;

      const expectedHours = workingHoursInPeriod(period);
      const totalHygieneExpected = Math.floor(expectedHours) * rosterRows.length;
      const totalHygienePasses = hygieneRows.length;
      const hygieneCompliance = totalHygieneExpected > 0 ? Math.round((totalHygienePasses / totalHygieneExpected) * 100) : 100;

      const totalCommitments = commitmentRows.length;
      const metCount = commitmentRows.filter(r => commitmentMetKeys.has(r.ticket_key)).length;
      const now = new Date();
      const missedCount = commitmentRows.filter(r => !commitmentMetKeys.has(r.ticket_key) && r.due_at && new Date(r.due_at) < now).length;
      const commitmentsMet = totalCommitments > 0 ? Math.round((metCount / totalCommitments) * 100) : 100;

      const agents = [...allAgentIds].map(agentId => {
        const agentActions = actionRows.filter(r => r.agent_id === agentId);
        const agentTta = agentActions.filter(r => r.time_to_action_ms != null).map(r => r.time_to_action_ms!);
        const agentDefers = deferRows.filter(r => r.agent_id === agentId);
        const agentHygiene = hygieneRows.filter(r => r.agent_id === agentId);
        const agentBackstops = backstopRows.filter(r => r.agent_id === agentId);
        const agentCommitments = commitmentRows.filter(r => r.agent_id === agentId);
        const agentOverrides = overrideRows.filter(r => r.agent_id === agentId);
        const agentCommitmentsMet = agentCommitments.filter(r => commitmentMetKeys.has(r.ticket_key)).length;
        const agentCommitmentsMissed = agentCommitments.filter(r => !commitmentMetKeys.has(r.ticket_key) && r.due_at && new Date(r.due_at) < now).length;

        return {
          agentId,
          agentName: agentId,
          pool: agentNames.get(agentId) ?? 'unknown',
          actionsTaken: agentActions.length,
          avgTimeToAction: agentTta.length > 0 ? agentTta.reduce((a, b) => a + b, 0) / agentTta.length : null,
          deferrals: agentDefers.length,
          hygienePassCount: agentHygiene.length,
          hygieneExpected: Math.floor(expectedHours),
          hygieneCompliance: Math.floor(expectedHours) > 0 ? Math.round((agentHygiene.length / Math.floor(expectedHours)) * 100) : 100,
          autoCloseBackstops: agentBackstops.length,
          commitmentsSet: agentCommitments.length,
          commitmentsMet: agentCommitmentsMet,
          commitmentsMissed: agentCommitmentsMissed,
          stretchCommitments: agentCommitments.filter(r => (r.working_days_out ?? 0) >= 5).length,
          rankOverrides: agentOverrides.length,
        };
      });

      // Action breakdown
      const actionCounts = new Map<string, number>();
      for (const r of actionRows) {
        const t = r.action_type ?? 'unknown';
        actionCounts.set(t, (actionCounts.get(t) ?? 0) + 1);
      }
      const actionBreakdown = [...actionCounts.entries()].map(([actionType, count]) => ({ actionType, count })).sort((a, b) => b.count - a.count);

      // Defer breakdown
      const deferCounts = new Map<string, number>();
      for (const r of deferRows) {
        const reason = r.reason ?? 'unknown';
        deferCounts.set(reason, (deferCounts.get(reason) ?? 0) + 1);
      }
      const deferBreakdown = [...deferCounts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);

      res.json({
        ok: true,
        data: {
          period,
          pool,
          kpis: {
            avgTimeToAction,
            hygieneCompliance,
            autoCloseBackstops: backstopRows.length,
            commitmentsMet,
            kbGapsLogged: kbGapCount,
            customersOverdue,
          },
          agents,
          actionBreakdown,
          deferBreakdown,
          hourlyActivity: hourlyRows,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Manager overview failed' });
    }
  });

  router.get('/manager/agent/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const period = (req.query.period as string) || 'today';
    const dateFilter = periodToDateFilter(period);

    try {
      const recentEvents = (await query<AgentEvent>(
        `SELECT TOP(50) e.id, e.event_type, e.ticket_key, e.agent_id, e.payload, e.created_at
         FROM agent_events e
         WHERE e.agent_id = ? ${dateFilter}
         ORDER BY e.created_at DESC`,
        [agentId],
      )).map(r => {
        if (typeof r.payload === 'string') try { r.payload = JSON.parse(r.payload as any); } catch { r.payload = {}; }
        return { eventType: r.event_type, ticketKey: r.ticket_key, payload: r.payload, createdAt: r.created_at };
      });

      const commitmentRows = await query<{ ticket_key: string; committed_at: string; due_at: string; working_days_out: number; created_at: string }>(
        `SELECT e.ticket_key,
                JSON_VALUE(e.payload, '$.committed_at') AS committed_at,
                JSON_VALUE(e.payload, '$.due_at') AS due_at,
                CAST(JSON_VALUE(e.payload, '$.working_days_out') AS INT) AS working_days_out,
                e.created_at
         FROM agent_events e
         WHERE e.agent_id = ? AND e.event_type = 'next_update_commitment_set' ${dateFilter}
         ORDER BY e.created_at DESC`,
        [agentId],
      );

      const metKeys = new Set(
        (await query<{ ticket_key: string; created_at: string }>(
          `SELECT e.ticket_key, e.created_at FROM agent_events e
           WHERE e.agent_id = ? AND e.event_type = 'action_taken' AND JSON_VALUE(e.payload, '$.action_type') = 'commitment_met' ${dateFilter}`,
          [agentId],
        )).map(r => r.ticket_key),
      );

      const now = new Date();
      const commitments = commitmentRows.map(r => {
        const isPast = r.due_at && new Date(r.due_at) < now;
        const met = metKeys.has(r.ticket_key);
        return {
          ticketKey: r.ticket_key,
          committedAt: r.committed_at ?? r.created_at,
          dueAt: r.due_at,
          workingDaysOut: r.working_days_out ?? 0,
          status: met ? 'met' as const : (isPast ? 'missed' as const : 'pending' as const),
          isStretch: (r.working_days_out ?? 0) >= 5,
        };
      });

      const hygienePasses = (await query<{ hour_block: string; ticket_count: number; fails: number; duration_ms: number; created_at: string }>(
        `SELECT JSON_VALUE(e.payload, '$.hour_block') AS hour_block,
                CAST(JSON_VALUE(e.payload, '$.ticket_count') AS INT) AS ticket_count,
                CAST(JSON_VALUE(e.payload, '$.fails') AS INT) AS fails,
                CAST(JSON_VALUE(e.payload, '$.duration_ms') AS FLOAT) AS duration_ms,
                e.created_at
         FROM agent_events e
         WHERE e.agent_id = ? AND e.event_type = 'hygiene_pass_completed' ${dateFilter}
         ORDER BY e.created_at DESC`,
        [agentId],
      )).map(r => ({
        hourBlock: r.hour_block,
        ticketCount: r.ticket_count,
        fails: r.fails,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      }));

      const backstops = (await query<{ ticket_key: string; days_in_state: number; created_at: string }>(
        `SELECT e.ticket_key,
                CAST(JSON_VALUE(e.payload, '$.days_in_state') AS INT) AS days_in_state,
                e.created_at
         FROM agent_events e
         WHERE e.agent_id = ? AND e.event_type = 'auto_close_backstop_fired' ${dateFilter}`,
        [agentId],
      )).map(r => ({ ticketKey: r.ticket_key, daysInState: r.days_in_state, createdAt: r.created_at }));

      const rankOverrides = (await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_events e WHERE e.agent_id = ? AND e.event_type = 'rank_override' ${dateFilter}`,
        [agentId],
      ))[0]?.cnt ?? 0;

      const rosterRow = await query<{ display_name: string }>(
        `SELECT TOP(1) display_name FROM agent_roster WHERE display_name = ?`,
        [agentId],
      );

      res.json({
        ok: true,
        data: {
          agentId,
          agentName: rosterRow[0]?.display_name ?? agentId,
          period,
          recentEvents,
          commitments,
          hygienePasses,
          qualitySignals: {
            autoCloseBackstops: backstops,
            declinedEscalations: 0,
            rankOverrides,
          },
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Agent detail failed' });
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
          output_category: string | null; approval_required: boolean;
          approval_status: string | null; shadow_mode: boolean;
          created_at: string; event_type: string;
        }>(
          `SELECT d.ticket_id, d.action, d.confidence,
             JSON_VALUE(d.output, '$.classification.category') as output_category,
             d.approval_required, d.approval_status, d.shadow_mode,
             d.created_at, d.event_type
           FROM agent_decisions d
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
          const actionLabel = ai.action === 'draft_response' ? 'Respond'
            : ai.action === 'escalate' ? 'Escalate'
            : ai.action === 'assign' ? 'Assign'
            : ai.action === 'chase' ? 'Chase'
            : ai.action === 'no_action' ? 'No action'
            : ai.action;
          aiSummary = ai.output_category ? `${actionLabel} — ${ai.output_category}` : actionLabel;
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
          'summary', 'status', 'priority', 'issuetype',
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

      // Batch-fetch latest AI decision for each ticket (lightweight — no reasoning/output/inputs blobs)
      const ticketKeys = rawIssues.map(i => i.key);
      let aiDecisions: Record<string, any> = {};
      if (ticketKeys.length > 0) {
        const placeholders = ticketKeys.map(() => '?').join(',');
        const rows = await query<{
          ticket_id: string; action: string; confidence: number;
          output_category: string | null; approval_required: boolean;
          approval_status: string | null; shadow_mode: boolean;
          created_at: string; event_type: string;
        }>(
          `SELECT d.ticket_id, d.action, d.confidence,
             JSON_VALUE(d.output, '$.classification.category') as output_category,
             d.approval_required, d.approval_status, d.shadow_mode,
             d.created_at, d.event_type
           FROM agent_decisions d
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
          const actionLabel = ai.action === 'draft_response' ? 'Respond'
            : ai.action === 'escalate' ? 'Escalate'
            : ai.action === 'assign' ? 'Assign'
            : ai.action === 'chase' ? 'Chase'
            : ai.action === 'no_action' ? 'No action'
            : ai.action;
          aiSummary = ai.output_category
            ? `${actionLabel} — ${ai.output_category}`
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
      const raw = await suggestionEngine.getSuggestions(type, status);
      const data = await suggestionEngine.enrichSuggestions(raw);
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

  router.post('/suggestions/:id/snooze', async (req, res) => {
    if (!suggestionEngine) { res.status(404).json({ ok: false, error: 'Suggestions not available' }); return; }
    try {
      const days = parseInt(req.body?.days) || 14;
      const ok = await suggestionEngine.snoozeSuggestion(parseInt(req.params.id), days);
      if (!ok) { res.status(404).json({ ok: false, error: 'Suggestion not found or already processed' }); return; }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to snooze suggestion' });
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

      try {
        await deps?.escalationLog?.log({
          ticket_key: ticketKey,
          escalation_type: 'manual',
          to_tier: 'T2',
          reason_code: reasonCode,
          reason_label: reasonLabel ?? reasonCode,
          escalated_by: username,
          assigned_to: assignToAgentId ? String(assignToAgentId) : undefined,
          notes: additionalNotes,
          source: 'nova',
        });
      } catch (e) {
        console.warn('[escalation] Failed to log:', e instanceof Error ? e.message : e);
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

  // ── Coaching (WP-14) — sourced from KPI SQL jira_qa_results + Jira_QA_GoldenRules ──

  router.get('/coaching/team', async (req, res) => {
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);
    try {
      // Resolve team member display names for filtering
      let teamMemberNames: Set<string> | null = null;
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const isAdmin = userRole?.split(',').some(r => r.trim() === 'admin' || r.trim() === 'super_admin');

      if (!isAdmin && userId && deps?.userTeamQueries && deps?.userQueries && deps?.teamQueries) {
        const teamIds = await deps.userTeamQueries.getTeamIdsForUser(userId);
        if (teamIds.length > 0) {
          const memberIds = new Set<number>();
          for (const tid of teamIds) {
            const uids = await deps.userTeamQueries.getUserIdsForTeam(tid);
            for (const uid of uids) memberIds.add(uid);
          }
          const allUsers = await deps.userQueries.getAll();
          teamMemberNames = new Set(
            allUsers
              .filter(u => memberIds.has(u.id) && u.display_name)
              .map(u => u.display_name!.toLowerCase()),
          );
        }
      }

      const p = await getKpiPool();
      const result = await p.request().query(`
        DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));

        SELECT
          q.assigneeName AS agent_name,
          COUNT(*) AS assessments,
          AVG(CAST(q.overallScore AS FLOAT)) AS avg_qa_overall,
          SUM(CASE WHEN q.grade = 'GREEN' THEN 1 ELSE 0 END) AS green_count,
          SUM(CASE WHEN q.grade = 'AMBER' THEN 1 ELSE 0 END) AS amber_count,
          SUM(CASE WHEN q.grade = 'RED' THEN 1 ELSE 0 END) AS red_count,
          SUM(CAST(q.isConcerning AS INT)) AS concerning_count
        FROM dbo.jira_qa_results q
        WHERE CAST(q.CreatedAt AS DATE) >= @since
          AND ISNULL(q.qaType, '') <> 'excluded'
          AND q.assigneeName IS NOT NULL AND q.assigneeName <> ''
        GROUP BY q.assigneeName
        ORDER BY AVG(CAST(q.overallScore AS FLOAT)) DESC
      `);

      const grResult = await p.request().query(`
        DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));

        SELECT
          g.Assignee AS agent_name,
          AVG(CAST(g.OverallScore AS FLOAT)) AS avg_gr_overall,
          AVG(CAST(g.Rule1Score AS FLOAT)) AS avg_ownership,
          AVG(CAST(g.Rule2Score AS FLOAT)) AS avg_next_action,
          AVG(CAST(g.Rule3Score AS FLOAT)) AS avg_timeframe
        FROM dbo.Jira_QA_GoldenRules g
        WHERE CAST(g.CreatedAt AS DATE) >= @since
          AND g.Assignee IS NOT NULL AND g.Assignee <> ''
        GROUP BY g.Assignee
      `);

      const grMap: Record<string, any> = {};
      for (const r of grResult.recordset) grMap[r.agent_name] = r;

      let rows: any[] = result.recordset;
      if (teamMemberNames) {
        rows = rows.filter((row: any) => teamMemberNames!.has((row.agent_name as string).toLowerCase()));
      }

      const data = rows.map((row: any) => {
        const gr = grMap[row.agent_name];
        return {
          agent_name: row.agent_name,
          assessments: row.assessments,
          avg_qa_overall: row.avg_qa_overall != null ? Math.round(row.avg_qa_overall * 10) / 10 : null,
          avg_ownership: gr?.avg_ownership != null ? Math.round(gr.avg_ownership * 10) / 10 : null,
          avg_next_action: gr?.avg_next_action != null ? Math.round(gr.avg_next_action * 10) / 10 : null,
          avg_timeframe: gr?.avg_timeframe != null ? Math.round(gr.avg_timeframe * 10) / 10 : null,
          avg_gr_overall: gr?.avg_gr_overall != null ? Math.round(gr.avg_gr_overall * 10) / 10 : null,
          green_count: row.green_count,
          amber_count: row.amber_count,
          red_count: row.red_count,
          concerning_count: row.concerning_count,
        };
      });

      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get team scores' });
    }
  });

  router.get('/coaching/agent/:agentName', async (req, res) => {
    const agentName = decodeURIComponent(req.params.agentName);
    const days = Math.min(parseInt(req.query.days as string, 10) || 30, 90);
    if (!agentName) {
      res.status(400).json({ ok: false, error: 'Agent name required' });
      return;
    }
    try {
      const p = await getKpiPool();
      const safeName = agentName.replace(/'/g, "''");

      const [qaAvg, grAvg, trend, concerns] = await Promise.all([
        p.request().query(`
          DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
          SELECT
            COUNT(*) AS total,
            AVG(CAST(overallScore AS FLOAT)) AS avg_overall,
            AVG(CAST(clarityScore AS FLOAT)) AS avg_clarity,
            AVG(CAST(toneScore AS FLOAT)) AS avg_tone,
            SUM(CASE WHEN grade = 'GREEN' THEN 1 ELSE 0 END) AS green_count,
            SUM(CASE WHEN grade = 'AMBER' THEN 1 ELSE 0 END) AS amber_count,
            SUM(CASE WHEN grade = 'RED' THEN 1 ELSE 0 END) AS red_count,
            SUM(CAST(isConcerning AS INT)) AS concerning_count
          FROM dbo.jira_qa_results
          WHERE assigneeName = '${safeName}'
            AND CAST(CreatedAt AS DATE) >= @since
            AND ISNULL(qaType, '') <> 'excluded'
        `),
        p.request().query(`
          DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
          SELECT
            AVG(CAST(OverallScore AS FLOAT)) AS avg_gr_overall,
            AVG(CAST(Rule1Score AS FLOAT)) AS avg_ownership,
            AVG(CAST(Rule2Score AS FLOAT)) AS avg_next_action,
            AVG(CAST(Rule3Score AS FLOAT)) AS avg_timeframe
          FROM dbo.Jira_QA_GoldenRules
          WHERE Assignee = '${safeName}'
            AND CAST(CreatedAt AS DATE) >= @since
        `),
        p.request().query(`
          DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
          SELECT CAST(CreatedAt AS DATE) AS day,
                 AVG(CAST(overallScore AS FLOAT)) AS avg_score,
                 COUNT(*) AS count
          FROM dbo.jira_qa_results
          WHERE assigneeName = '${safeName}'
            AND CAST(CreatedAt AS DATE) >= @since
            AND ISNULL(qaType, '') <> 'excluded'
          GROUP BY CAST(CreatedAt AS DATE)
          ORDER BY day
        `),
        p.request().query(`
          DECLARE @since DATE = DATEADD(DAY, -${days}, CAST(GETUTCDATE() AS DATE));
          SELECT TOP 20
            issueKey AS issue_key, grade,
            CAST(overallScore AS FLOAT) AS overall_score,
            category, coachingPoints AS coaching_points,
            CONVERT(VARCHAR(23), CreatedAt, 126) AS processed_at
          FROM dbo.jira_qa_results
          WHERE assigneeName = '${safeName}'
            AND CAST(CreatedAt AS DATE) >= @since
            AND (grade = 'RED' OR isConcerning = 1)
            AND ISNULL(qaType, '') <> 'excluded'
          ORDER BY CreatedAt DESC
        `),
      ]);

      const qa = qaAvg.recordset[0];
      const gr = grAvg.recordset[0];

      const data = {
        averages: qa?.total > 0 ? {
          qa_overall: qa.avg_overall != null ? Math.round(qa.avg_overall * 10) / 10 : null,
          clarity: qa.avg_clarity != null ? Math.round(qa.avg_clarity * 10) / 10 : null,
          tone: qa.avg_tone != null ? Math.round(qa.avg_tone * 10) / 10 : null,
          ownership: gr?.avg_ownership != null ? Math.round(gr.avg_ownership * 10) / 10 : null,
          next_action: gr?.avg_next_action != null ? Math.round(gr.avg_next_action * 10) / 10 : null,
          timeframe: gr?.avg_timeframe != null ? Math.round(gr.avg_timeframe * 10) / 10 : null,
          gr_overall: gr?.avg_gr_overall != null ? Math.round(gr.avg_gr_overall * 10) / 10 : null,
        } : null,
        trend: trend.recordset.map((r: any) => ({
          day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
          avg_score: Math.round((r.avg_score ?? 0) * 10) / 10,
          count: r.count,
        })),
        totalAssessments: qa?.total ?? 0,
        gradeBreakdown: {
          green: qa?.green_count ?? 0,
          amber: qa?.amber_count ?? 0,
          red: qa?.red_count ?? 0,
        },
        concerningTickets: concerns.recordset,
      };

      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get agent scores' });
    }
  });

  router.get('/coaching/nudges', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const agent = req.query.agent as string | undefined;
    try {
      // Resolve team member display names for filtering (same as /coaching/team)
      let teamMemberNames: Set<string> | null = null;
      const userId = (req as any).user?.id as number | undefined;
      const userRole = (req as any).user?.role as string | undefined;
      const isAdmin = userRole?.split(',').some(r => r.trim() === 'admin' || r.trim() === 'super_admin');

      if (!isAdmin && userId && deps?.userTeamQueries && deps?.userQueries && deps?.teamQueries) {
        const teamIds = await deps.userTeamQueries.getTeamIdsForUser(userId);
        if (teamIds.length > 0) {
          const memberIds = new Set<number>();
          for (const tid of teamIds) {
            const uids = await deps.userTeamQueries.getUserIdsForTeam(tid);
            for (const uid of uids) memberIds.add(uid);
          }
          const allUsers = await deps.userQueries.getAll();
          teamMemberNames = new Set(
            allUsers
              .filter(u => memberIds.has(u.id) && u.display_name)
              .map(u => u.display_name!.toLowerCase()),
          );
        }
      }

      const p = await getKpiPool();
      const agentFilter = agent ? `AND r.assigneeName = '${agent.replace(/'/g, "''")}'` : '';
      const result = await p.request().query(`
        SELECT TOP ${limit}
          r.issueKey AS issue_key,
          r.assigneeName AS agent_name,
          r.grade,
          CAST(r.overallScore AS FLOAT) AS overall_score,
          r.coachingPoints AS coaching_points,
          r.category,
          CONVERT(VARCHAR(23), r.CreatedAt, 126) AS processed_at
        FROM dbo.jira_qa_results r
        WHERE (r.grade = 'RED' OR r.isConcerning = 1)
          AND ISNULL(r.qaType, '') <> 'excluded'
          ${agentFilter}
        ORDER BY r.CreatedAt DESC
      `);

      let rows: any[] = result.recordset;
      if (teamMemberNames) {
        rows = rows.filter((row: any) => teamMemberNames!.has((row.agent_name as string).toLowerCase()));
      }

      res.json({ ok: true, data: rows });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get coaching concerns' });
    }
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

  // Agent CRUD is managed via KPI agent-admin endpoints (kpi-data routes).
  // POST/PUT/DELETE roster routes removed — dbo.Agent on KPI DB is the source of truth.

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

  // ── WP-62: Drift Detection ──

  router.get('/pipeline/drift', async (_req, res) => {
    try {
      const dd = deps?.driftDetector;
      if (!dd) { res.status(503).json({ ok: false, error: 'Drift detector not available' }); return; }
      const snapshots = await dd.getSnapshots(100);
      res.json({ ok: true, data: snapshots });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get drift snapshots' });
    }
  });

  router.get('/pipeline/drift/trend/:callType', async (req, res) => {
    try {
      const dd = deps?.driftDetector;
      if (!dd) { res.status(503).json({ ok: false, error: 'Drift detector not available' }); return; }
      const trend = await dd.getTrend(req.params.callType, 12);
      res.json({ ok: true, data: trend });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get drift trend' });
    }
  });

  router.post('/pipeline/drift/run', requireRole('admin'), async (_req, res) => {
    try {
      const dd = deps?.driftDetector;
      if (!dd) { res.status(503).json({ ok: false, error: 'Drift detector not available' }); return; }
      const segments = await dd.snapshotDrift();
      res.json({ ok: true, data: segments });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Drift snapshot failed' });
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

  // ── Decision-level approve/decline (fallback when no approval_queue record) ──

  router.post('/decisions/:id/decide', requireSuperAdmin(), async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid ID' }); return; }

    const { action, declineReason, editedResponse } = req.body;
    if (!action || !['approve', 'confirm', 'execute', 'decline'].includes(action)) {
      res.status(400).json({ ok: false, error: 'action must be "approve", "confirm", "execute", or "decline"' });
      return;
    }
    if (action === 'decline' && (!declineReason || !declineReason.trim())) {
      res.status(400).json({ ok: false, error: 'A reason is required when declining' });
      return;
    }

    const statusMap: Record<string, string> = {
      approve: 'approved',
      confirm: 'confirmed',
      execute: 'executed',
      decline: 'declined',
    };
    const user = (req as any).user;
    const newStatus = statusMap[action];

    try {
      const rows = await query<{ ticket_id: string; approval_status: string | null }>(
        `SELECT ticket_id, approval_status FROM agent_decisions WHERE id = ?`, [id],
      );
      if (!rows.length) { res.status(404).json({ ok: false, error: 'Decision not found' }); return; }
      if (rows[0].approval_status && rows[0].approval_status !== 'pending') {
        res.status(409).json({ ok: false, error: `Already ${rows[0].approval_status}` });
        return;
      }

      await execute(
        `UPDATE agent_decisions SET approval_status = ?, resolved_at = GETUTCDATE(), resolved_by = ? WHERE id = ?`,
        [newStatus, user.username, id],
      );

      // Also update matching approval_queue entry if one exists
      const ticketId = rows[0].ticket_id;
      try {
        await execute(
          `UPDATE approval_queue SET status = ?, decided_by = ?, decided_at = GETUTCDATE(), decline_reason = ? WHERE ticket_id = ? AND status IN ('pending', 'timed_out')`,
          [newStatus, user.username, action === 'decline' ? declineReason.trim() : null, ticketId],
        );
      } catch { /* approval_queue may not have a matching entry */ }

      // Enhanced hybrid: feed learning loop for confirm/execute
      if (action === 'confirm' || action === 'execute') {
        const fullDecision = await queryOne<{ ticket_id: string; output: string; shadow_mode: number; action: string }>(
          `SELECT ticket_id, output, shadow_mode, action FROM agent_decisions WHERE id = ?`, [id],
        );
        if (fullDecision) {
          let output: any = {};
          try { output = JSON.parse(fullDecision.output || '{}'); } catch { /* best effort */ }
          const category = output.classification?.category ?? 'unknown';

          try {
            await execute(
              `INSERT INTO ai_learnings (ticket_key, category, ai_draft, learning, submitted_by)
               VALUES (?, ?, ?, ?, ?)`,
              [
                fullDecision.ticket_id,
                category,
                (output.draft_response ?? '').slice(0, 2000),
                action === 'confirm'
                  ? `Shadow decision confirmed as correct. Action: ${fullDecision.action}. Category: ${category}.`
                  : `Shadow decision executed by human override. Action: ${fullDecision.action}. Category: ${category}.`,
                user.username,
              ],
            );
          } catch { /* best effort */ }

          // Execute the Jira action only for 'execute'
          if (action === 'execute') {
            const draftResponse = output.draft_response || '';
            if (draftResponse) {
              try {
                await agentLoop.handleApprovalCallback(
                  'approve',
                  fullDecision.ticket_id,
                  undefined,
                  editedResponse || draftResponse,
                  user.username,
                );
                console.log(`[agent] Enhanced hybrid execute: ${fullDecision.ticket_id} by ${user.username}`);
              } catch (err) {
                console.warn(`[agent] Execute callback failed for ${fullDecision.ticket_id}:`, err instanceof Error ? err.message : err);
              }
            }
          }
        }
      }

      res.json({ ok: true, data: { id, status: newStatus } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to decide' });
    }
  });

  // ── AI Next Action recommendation ──

  const nextActionCache = new Map<string, { data: unknown; expiresAt: number; issueUpdated: string | null }>();
  const NEXT_ACTION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  let nextActionMissingCount = 0;

  router.get('/next-action/missing-count', requireRole('admin'), (_req, res) => {
    res.json({ ok: true, data: { count: nextActionMissingCount } });
  });

  router.get('/next-action/:ticketKey', requireRole('admin'), async (req, res) => {
    const ticketKey = String(req.params.ticketKey);
    try {
      const jira = agentLoop.getJiraClient();
      const llm = agentLoop.getLlmService();

      const issue = await jira.getIssue(ticketKey, [
        'summary', 'description', 'status', 'priority', 'reporter',
        'assignee', 'created', 'updated', 'comment', 'issuetype',
        'customfield_12981',
      ]);
      if (!issue) {
        res.status(404).json({ ok: false, error: `Ticket ${ticketKey} not found` });
        return;
      }

      const f = issue.fields;
      const issueUpdated = (f.updated as string) ?? null;

      // Check cache — bust on ticket update
      const cached = nextActionCache.get(ticketKey);
      if (cached && Date.now() < cached.expiresAt && cached.issueUpdated === issueUpdated) {
        res.json({ ok: true, data: cached.data });
        return;
      }

      // Check if agent has any decision on this ticket
      const decisions = await query(
        `SELECT TOP 1 id, action, confidence FROM agent_decisions WHERE ticket_id = ? ORDER BY decided_at DESC`,
        [ticketKey],
      );

      if (!decisions || decisions.length === 0) {
        nextActionMissingCount++;
        const fallback = {
          state: 'no_context' as const,
          headline: 'No agent context yet — this ticket hasn\'t been processed by the AI agent.',
          body: 'Tickets reach this state only when assignment beat AI processing, or processing failed silently.',
          primaryAction: { label: 'Run agent on this ticket', jiraTransition: null },
          generatedAt: new Date().toISOString(),
        };
        res.json({ ok: true, data: fallback });
        return;
      }

      // Build activity from last 5 comments
      const comments = ((f.comment as any)?.comments as Array<{
        author?: { displayName?: string };
        body?: string;
        created?: string;
        properties?: Array<{ key: string; value?: { internal?: boolean } }>;
      }>) ?? [];

      const last5 = comments.slice(-5).map(c => {
        const isInternal = c.properties?.some(p => p.key === 'sd.public.comment' && p.value?.internal) ?? false;
        const body = typeof c.body === 'string' ? c.body.slice(0, 300) : '(complex body)';
        return `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}${isInternal ? ' (internal)' : ''}: ${body}`;
      }).join('\n');

      // Determine SLA state
      const statusName = (f.status as any)?.name ?? 'Unknown';
      const updated = f.updated as string | undefined;
      const created = f.created as string | undefined;
      const timeInStatusMs = updated ? Date.now() - new Date(updated as string).getTime() : 0;
      const timeInStatusHrs = Math.round(timeInStatusMs / 3600000);

      const tierRaw = f.customfield_12981;
      const tier = typeof tierRaw === 'string' ? tierRaw : (tierRaw as any)?.value ?? 'Unknown';

      // Check if last comment was from the team asking the customer
      const lastComment = comments.length > 0 ? comments[comments.length - 1] : null;
      const awaitingCustomer = statusName.toLowerCase().includes('waiting on requestor')
        || statusName.toLowerCase().includes('waiting for customer');

      const prompt = loadPrompt('ticket-next-action', {
        ticketKey,
        summary: (f.summary as string) ?? '',
        status: statusName,
        tier,
        timeInStatus: `${timeInStatusHrs}h`,
        activity: last5 || 'No comments recorded.',
        slaState: timeInStatusHrs > 24 ? 'Approaching breach' : 'Within SLA',
        awaitingCustomer: awaitingCustomer ? 'Yes' : 'No',
      });

      const NextActionSchema = z.object({
        state: z.enum(['action_ready', 'waiting', 'stalled']),
        headline: z.string(),
        body: z.string(),
        primaryAction: z.object({
          label: z.string(),
          jiraTransition: z.string().nullable(),
        }),
      });

      const result = await llm.call(
        prompt,
        `Ticket ${ticketKey}: ${(f.summary as string) ?? ''}\nStatus: ${statusName}\nTier: ${tier}`,
        NextActionSchema,
        { callType: 'next_action', ticketId: ticketKey, maxTokens: 512 },
      );

      const responseData = {
        ...result.data,
        generatedAt: new Date().toISOString(),
        inputs: {
          ticketKey,
          summary: (f.summary as string) ?? '',
          status: statusName,
          tier,
          timeInStatus: `${timeInStatusHrs}h`,
          activityCount: comments.length,
          awaitingCustomer,
        },
      };

      nextActionCache.set(ticketKey, { data: responseData, expiresAt: Date.now() + NEXT_ACTION_CACHE_TTL, issueUpdated });

      res.json({ ok: true, data: responseData });
    } catch (err) {
      console.error(`[agent/next-action] Error for ${ticketKey}:`, err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to generate next action' });
    }
  });

  return router;
}

