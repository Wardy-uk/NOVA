import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import sql from 'mssql';
import { query, queryOne, execute, executeAndGetId } from '../services/database.js';
import type { UserQueries } from '../db/queries.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { McpClientManager } from '../services/mcp-client.js';
import { LlmService } from '../services/llm-service.js';
import { isAdmin } from '../utils/role-helpers.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

let kpiPool: sql.ConnectionPool | null = null;
async function getKpiPool(settings: FileSettingsQueries): Promise<sql.ConnectionPool> {
  if (kpiPool?.connected) return kpiPool;
  const all = settings.getAll();
  const server = all.kpi_sql_server;
  const database = all.kpi_sql_database;
  const user = all.kpi_sql_user;
  const password = all.kpi_sql_password;
  if (!server || !database || !user || !password) {
    throw new Error('KPI SQL Server not configured');
  }
  kpiPool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();
  return kpiPool;
}

interface PeopleDeps {
  userQueries: UserQueries;
  settingsQueries: FileSettingsQueries;
  mcpManager: McpClientManager;
  notificationQueries: NotificationQueries;
}

export async function generatePrepForAgent(
  agentName: string,
  settingsQueries: FileSettingsQueries,
  notificationQueries: NotificationQueries,
  adminUserId?: number,
): Promise<{ snapshotId: number; prep: any }> {
  const lastSnap = await queryOne<{ snapshot_date: string }>(`
    SELECT TOP 1 snapshot_date FROM agent_121_snapshots
    WHERE agent_name = ? ORDER BY snapshot_date DESC
  `, [agentName]);

  const sinceDate = lastSnap?.snapshot_date
    ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const kpiDb = await getKpiPool(settingsQueries);

  const kpiReq = kpiDb.request();
  kpiReq.input('agent', sql.NVarChar, agentName);
  kpiReq.input('since', sql.NVarChar, sinceDate);
  const kpiResult = await kpiReq.query(`
    SELECT * FROM dbo.jira_agent_kpi_daily
    WHERE AgentName = @agent AND KpiDate >= @since
    ORDER BY KpiDate DESC
  `);
  const kpiRows = kpiResult.recordset;

  const qaReq = kpiDb.request();
  qaReq.input('agent', sql.NVarChar, agentName);
  qaReq.input('since', sql.NVarChar, sinceDate);
  const qaResult = await qaReq.query(`
    SELECT TOP 20 TicketKey, OverallScore, TrafficLight, QADate, Comments
    FROM dbo.jira_qa_results
    WHERE AgentName = @agent AND QADate >= @since
    ORDER BY QADate DESC
  `);
  const qaRows = qaResult.recordset;

  const concerningQa = qaRows.filter((r: any) =>
    r.TrafficLight === 'RED' || (r.OverallScore != null && r.OverallScore < 6.5)
  );

  const plan = await queryOne<any>(`
    SELECT * FROM agent_development_plans
    WHERE agent_name = ? AND status IN ('active', 'deferred')
  `, [agentName]);

  let goals: any[] = [];
  let training: any[] = [];
  if (plan) {
    goals = await query<any>(`
      SELECT * FROM agent_development_goals WHERE plan_id = ? ORDER BY sort_order
    `, [plan.id]);
    training = await query<any>(`
      SELECT * FROM agent_training_items WHERE plan_id = ? ORDER BY sort_order
    `, [plan.id]);
  }

  const openActions = await query<any>(`
    SELECT * FROM agent_121_actions
    WHERE agent_name = ? AND status IN ('open', 'in_progress')
    ORDER BY created_at DESC
  `, [agentName]);

  const kpiSummary: Record<string, number> = {};
  if (kpiRows.length > 0) {
    const numericKeys = ['TicketsResolved', 'TicketsPerHour', 'AvgOpenTickets',
      'AvgOver2hOverdue', 'AvgNoUpdateToday', 'OldestTicketDays',
      'QAOverallAvg', 'QAAccuracyAvg', 'QAClarityAvg', 'QAToneAvg',
      'GoldenRulesAvg', 'OwnershipAvg', 'NextActionAvg', 'TimeframeAvg',
      'FrtCompliancePercent', 'ResolutionSlaPercent'];
    for (const key of numericKeys) {
      const vals = kpiRows.map((r: any) => r[key]).filter((v: any) => v != null);
      if (vals.length > 0) {
        kpiSummary[key] = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
      }
    }
  }

  const systemPrompt = `You are an assistant helping a support team manager prepare for a 1-2-1 meeting with a team member.
Generate a structured prep document. Be specific, reference actual numbers and tickets. Keep it concise and actionable.
Focus on: what's improved, what needs attention, goal progress, and suggested talking points.`;

  const userMessage = `Agent: ${agentName}
Period: ${sinceDate} to today
Role: ${plan?.role_title ?? 'Support Agent'} (${plan?.function_name ?? 'Technical Support'})

## KPI Averages (period)
${JSON.stringify(kpiSummary, null, 2)}

## Recent KPI Trend (last 5 days)
${JSON.stringify(kpiRows.slice(0, 5).map((r: any) => ({
  date: r.KpiDate, resolved: r.TicketsResolved, tph: r.TicketsPerHour,
  qa: r.QAOverallAvg, gr: r.GoldenRulesAvg, frt: r.FrtCompliancePercent
})), null, 2)}

## QA Concerns (RED / low-scoring)
${concerningQa.length > 0
  ? concerningQa.map((r: any) => `- ${r.TicketKey}: score ${r.OverallScore}, ${r.TrafficLight}${r.Comments ? ' — ' + r.Comments : ''}`).join('\n')
  : 'None — all QA results acceptable'}

## Development Goals
${goals.map((g: any) => `- [${g.status}] ${g.title}: ${g.description ?? ''}${g.metric_key ? ` (target: ${g.metric_key} ≥ ${g.metric_target})` : ''}${g.target_date ? ` by ${g.target_date}` : ''}`).join('\n') || 'No goals set'}

## Training Items
${training.map((t: any) => `- [${t.completed ? 'DONE' : 'TODO'}] ${t.title}`).join('\n') || 'No training items'}

## Outstanding Actions from Previous 1-2-1
${openActions.map((a: any) => `- [${a.status}] ${a.description} (owner: ${a.owner ?? 'unassigned'}${a.due_date ? ', due: ' + a.due_date : ''})`).join('\n') || 'No outstanding actions'}

## Role Context
${plan?.role_clarity ?? 'No role clarity statement set'}

## Important Context
${plan?.important_context ?? 'None'}`;

  const prepSchema = z.object({
    summary: z.string(),
    whats_improved: z.array(z.string()),
    needs_attention: z.array(z.string()),
    goal_progress: z.array(z.object({
      goal: z.string(),
      status: z.string(),
      notes: z.string(),
    })),
    qa_highlights: z.array(z.string()),
    suggested_talking_points: z.array(z.string()),
    suggested_actions: z.array(z.string()),
  });

  const llmService = new LlmService(settingsQueries);
  const llmResult = await llmService.call(systemPrompt, userMessage, prepSchema, {
    callType: '121-prep',
    tier: 'fast',
    maxTokens: 2048,
    temperature: 0.4,
  });

  const latestKpi = kpiRows[0] ?? {};
  const metricsJson = {
    ...kpiSummary,
    latestDate: latestKpi.KpiDate ?? null,
    periodDays: kpiRows.length,
  };

  const goalsJson = goals.map((g: any) => ({
    id: g.id, title: g.title, status: g.status,
    metric_key: g.metric_key, metric_target: g.metric_target,
    current_value: g.metric_key ? (kpiSummary[g.metric_key] ?? null) : null,
  }));

  const snapshotId = await executeAndGetId(`
    INSERT INTO agent_121_snapshots
      (agent_name, snapshot_date, metrics_json, goals_json, prep_json, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    agentName,
    new Date().toISOString().slice(0, 10),
    JSON.stringify(metricsJson),
    JSON.stringify(goalsJson),
    JSON.stringify(llmResult.data),
    `Auto-generated prep (${llmResult.provider}/${llmResult.model})`,
  ]);

  if (adminUserId) {
    await notificationQueries.create({
      user_id: adminUserId,
      type: '121-prep',
      title: `1-2-1 prep ready for ${agentName}`,
      message: llmResult.data.summary,
      entity_type: 'agent_121_snapshot',
      entity_id: String(snapshotId),
    });
  }

  return { snapshotId, prep: llmResult.data };
}

export function createPeopleRoutes(deps: PeopleDeps): Router {
  const { userQueries, settingsQueries, mcpManager, notificationQueries } = deps;
  const router = Router();

  // Resolve the agent_name for non-admin users based on their display_name
  async function resolveAgentScope(req: Request): Promise<string | null> {
    if (!req.user || isAdmin(req.user.role)) return null;
    const user = await userQueries.getById(req.user.id);
    return user?.display_name || null;
  }

  // ── Roster (admin only) ──

  router.get('/roster', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const soon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      const plans = await query(`
        SELECT p.id, p.agent_name, p.plan_period, p.role_title, p.function_name, p.status, p.manager_status,
               (SELECT COUNT(*) FROM agent_development_goals g WHERE g.plan_id = p.id) AS goal_count,
               (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id AND t.completed = 1) AS training_done,
               (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id) AS training_total,
               (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id AND t.completed = 0 AND t.target_date IS NOT NULL AND t.target_date < ?) AS training_overdue,
               (SELECT COUNT(*) FROM agent_training_items t WHERE t.plan_id = p.id AND t.completed = 0 AND t.target_date IS NOT NULL AND t.target_date >= ? AND t.target_date <= ?) AS training_due_soon
        FROM agent_development_plans p
        WHERE p.status IN ('active', 'deferred')
        ORDER BY p.agent_name
      `, [today, today, soon]);
      res.json({ ok: true, data: plans });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Batch calendar lookup for roster ──

  router.get('/roster/calendar', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }

      const tools = mcpManager.getServerTools('msgraph');
      const hasCalendarView = tools.includes('get-calendar-view') || tools.includes('list-calendar-events');

      if (!hasCalendarView) {
        res.json({ ok: true, data: {} });
        return;
      }

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 86400000);

      const toolName = tools.includes('get-calendar-view') ? 'get-calendar-view' : 'list-calendar-events';
      const result = await mcpManager.callTool('msgraph', toolName, {
        startDateTime: now.toISOString(),
        endDateTime: futureDate.toISOString(),
      });

      const content = result as any;
      const text = content?.content?.[0]?.text;
      let events: any[] = [];
      if (text) {
        try {
          const parsed = JSON.parse(text);
          events = Array.isArray(parsed) ? parsed : (parsed?.value ?? []);
        } catch { events = []; }
      }

      // Get all active agent names
      const agents = await query<{ agent_name: string }>(`
        SELECT agent_name FROM agent_development_plans WHERE status IN ('active', 'deferred')
      `);

      const result121: Record<string, { subject: string; start: string } | null> = {};

      for (const agent of agents) {
        const firstName = agent.agent_name.split(' ')[0].toLowerCase();
        const match = events.find((e: any) => {
          const subject = (e.subject ?? e.Subject ?? '').toLowerCase();
          return subject.includes(firstName) && (
            subject.includes('1-2-1') || subject.includes('121') ||
            subject.includes('one to one') || subject.includes('1:1') ||
            subject.includes('catch up') || subject.includes('catchup')
          );
        });
        result121[agent.agent_name] = match ? {
          subject: match.subject ?? match.Subject,
          start: match.start?.dateTime ?? match.Start?.DateTime ?? match.start,
        } : null;
      }

      res.json({ ok: true, data: result121 });
    } catch (err: any) {
      console.error('[people] batch calendar error:', err);
      res.json({ ok: true, data: {} });
    }
  });

  // ── Survey satisfaction scores (per agent) ──

  router.get('/roster/survey-scores', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }

      // Get the most recent closed or active survey
      const latestSurvey = await queryOne<any>(`
        SELECT TOP 1 id FROM surveys
        WHERE status IN ('active', 'closed')
        ORDER BY created_at DESC
      `);

      if (!latestSurvey) {
        res.json({ ok: true, data: {} });
        return;
      }

      // Get scale_5 question IDs for this survey
      const questions = await query<any>(`
        SELECT id FROM survey_questions
        WHERE survey_id = ? AND question_type = 'scale_5'
      `, [latestSurvey.id]);

      if (questions.length === 0) {
        res.json({ ok: true, data: {} });
        return;
      }

      // Join responses → recipients to get display_name per response
      const rows = await query<any>(`
        SELECT sr.display_name, resp.answers
        FROM survey_responses resp
        JOIN survey_recipients sr ON sr.token = resp.token AND sr.survey_id = resp.survey_id
        WHERE resp.survey_id = ?
      `, [latestSurvey.id]);

      // Aggregate per-agent: average all scale_5 answers
      const qIds = new Set(questions.map((q: any) => q.id));
      const agentScores: Record<string, { sum: number; count: number }> = {};

      for (const row of rows) {
        const name = row.display_name;
        try {
          const answers = JSON.parse(row.answers) as Array<{ question_id: number; value: string | number }>;
          for (const a of answers) {
            if (qIds.has(a.question_id)) {
              const val = Number(a.value);
              if (!isNaN(val) && val >= 1 && val <= 5) {
                if (!agentScores[name]) agentScores[name] = { sum: 0, count: 0 };
                agentScores[name].sum += val;
                agentScores[name].count++;
              }
            }
          }
        } catch { /* skip bad JSON */ }
      }

      const result: Record<string, number> = {};
      for (const [name, { sum, count }] of Object.entries(agentScores)) {
        result[name] = Math.round((sum / count) * 100) / 100;
      }

      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Agent view data ──

  router.get('/agent/:agentName', async (req: Request, res: Response) => {
    try {
      const agentName = decodeURIComponent(String(req.params.agentName));
      const scope = await resolveAgentScope(req);
      if (scope && scope !== agentName) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      const plan = await queryOne(`
        SELECT * FROM agent_development_plans
        WHERE agent_name = ? AND status IN ('active', 'deferred')
      `, [agentName]);

      if (!plan) {
        res.json({ ok: true, data: null });
        return;
      }

      const goals = await query(`
        SELECT * FROM agent_development_goals WHERE plan_id = ? ORDER BY sort_order
      `, [(plan as any).id]);

      const training = await query(`
        SELECT * FROM agent_training_items WHERE plan_id = ? ORDER BY sort_order
      `, [(plan as any).id]);

      res.json({ ok: true, data: { plan, goals, training } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Plan CRUD ──

  router.get('/agent/:agentName/plan', async (req: Request, res: Response) => {
    try {
      const agentName = decodeURIComponent(String(req.params.agentName));
      const scope = await resolveAgentScope(req);
      if (scope && scope !== agentName) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      const plan = await queryOne(`
        SELECT * FROM agent_development_plans
        WHERE agent_name = ? AND status IN ('active', 'deferred')
      `, [agentName]);

      if (!plan) {
        res.json({ ok: true, data: null });
        return;
      }

      const goals = await query(`
        SELECT * FROM agent_development_goals WHERE plan_id = ? ORDER BY sort_order
      `, [(plan as any).id]);

      const training = await query(`
        SELECT * FROM agent_training_items WHERE plan_id = ? ORDER BY sort_order
      `, [(plan as any).id]);

      res.json({ ok: true, data: { plan, goals, training } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.put('/agent/:agentName/plan', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      const { role_title, function_name, plan_period, role_clarity, strengths, important_context, status, manager_status } = req.body;

      const existing = await queryOne<any>(`
        SELECT id FROM agent_development_plans
        WHERE agent_name = ? AND status IN ('active', 'deferred')
      `, [agentName]);

      if (existing) {
        await execute(`
          UPDATE agent_development_plans SET
            role_title = COALESCE(?, role_title),
            function_name = COALESCE(?, function_name),
            plan_period = COALESCE(?, plan_period),
            role_clarity = COALESCE(?, role_clarity),
            strengths = COALESCE(?, strengths),
            important_context = ?,
            status = COALESCE(?, status),
            manager_status = COALESCE(?, manager_status),
            updated_at = GETUTCDATE()
          WHERE id = ?
        `, [role_title, function_name, plan_period, role_clarity,
            strengths ? JSON.stringify(strengths) : null,
            important_context ?? null, status, manager_status ?? null, existing.id]);
        res.json({ ok: true, data: { id: existing.id } });
      } else {
        const id = await executeAndGetId(`
          INSERT INTO agent_development_plans
            (agent_name, role_title, function_name, plan_period, role_clarity, strengths, important_context, status, manager_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [agentName, role_title, function_name, plan_period, role_clarity,
            strengths ? JSON.stringify(strengths) : null,
            important_context ?? null, status || 'active', manager_status ?? null]);
        res.json({ ok: true, data: { id } });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Goals ──

  router.put('/goals/:goalId', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const goalId = Number(req.params.goalId);
      const { title, description, measure_description, metric_key, metric_target, target_date, status, sort_order } = req.body;

      await execute(`
        UPDATE agent_development_goals SET
          title = COALESCE(?, title),
          description = COALESCE(?, description),
          measure_description = COALESCE(?, measure_description),
          metric_key = ?,
          metric_target = ?,
          target_date = COALESCE(?, target_date),
          status = COALESCE(?, status),
          sort_order = COALESCE(?, sort_order)
        WHERE id = ?
      `, [title, description, measure_description,
          metric_key ?? null, metric_target ?? null,
          target_date, status, sort_order, goalId]);

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Training items ──

  router.put('/training/:itemId', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const itemId = Number(req.params.itemId);
      const { completed } = req.body;
      const isComplete = completed ? 1 : 0;

      await execute(`
        UPDATE agent_training_items SET
          completed = ?,
          completed_at = ${isComplete ? 'GETUTCDATE()' : 'NULL'}
        WHERE id = ?
      `, [isComplete, itemId]);

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── 1-2-1 Snapshots ──

  router.post('/agent/:agentName/snapshot', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      const { snapshot_date, metrics_json, goals_json, prep_json, transcript_md, notes } = req.body;

      const id = await executeAndGetId(`
        INSERT INTO agent_121_snapshots
          (agent_name, snapshot_date, metrics_json, goals_json, prep_json, transcript_md, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [agentName, snapshot_date || new Date().toISOString().slice(0, 10),
          metrics_json ? JSON.stringify(metrics_json) : null,
          goals_json ? JSON.stringify(goals_json) : null,
          prep_json ? JSON.stringify(prep_json) : null,
          transcript_md ?? null, notes ?? null]);

      res.json({ ok: true, data: { id } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.get('/agent/:agentName/snapshots', async (req: Request, res: Response) => {
    try {
      const agentName = decodeURIComponent(String(req.params.agentName));
      const scope = await resolveAgentScope(req);
      if (scope && scope !== agentName) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      const snapshots = await query(`
        SELECT * FROM agent_121_snapshots
        WHERE agent_name = ?
        ORDER BY snapshot_date DESC
      `, [agentName]);

      res.json({ ok: true, data: snapshots });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Actions ──

  router.get('/agent/:agentName/actions', async (req: Request, res: Response) => {
    try {
      const agentName = decodeURIComponent(String(req.params.agentName));
      const scope = await resolveAgentScope(req);
      if (scope && scope !== agentName) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      const actionsData = await query(`
        SELECT * FROM agent_121_actions
        WHERE agent_name = ?
        ORDER BY created_at DESC
      `, [agentName]);

      res.json({ ok: true, data: actionsData });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/agent/:agentName/actions', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      const { snapshot_id, description, owner, due_date } = req.body;

      if (!description) {
        res.status(400).json({ ok: false, error: 'description required' });
        return;
      }

      const id = await executeAndGetId(`
        INSERT INTO agent_121_actions
          (snapshot_id, agent_name, description, owner, due_date)
        VALUES (?, ?, ?, ?, ?)
      `, [snapshot_id ?? null, agentName, description, owner ?? null, due_date ?? null]);

      res.json({ ok: true, data: { id } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.put('/actions/:actionId', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const actionId = Number(req.params.actionId);
      const { description, owner, due_date, status } = req.body;

      const completedClause = status === 'complete' ? ', completed_at = GETUTCDATE()' : '';

      await execute(`
        UPDATE agent_121_actions SET
          description = COALESCE(?, description),
          owner = COALESCE(?, owner),
          due_date = ?,
          status = COALESCE(?, status)
          ${completedClause}
        WHERE id = ?
      `, [description, owner, due_date ?? null, status, actionId]);

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Generate AI 1-2-1 Prep ──

  router.post('/agent/:agentName/generate-prep', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      const result = await generatePrepForAgent(agentName, settingsQueries, notificationQueries, req.user.id);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      console.error('[people] generate-prep error:', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Enhanced snapshot (auto-freeze metrics) ──

  router.post('/agent/:agentName/snapshot/freeze', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      const { notes, transcript_md } = req.body;

      // Auto-freeze latest KPI row
      const latestKpi = await queryOne<any>(`
        SELECT TOP 1 * FROM jira_agent_kpi_daily
        WHERE AgentName = ? ORDER BY KpiDate DESC
      `, [agentName]);

      const metricsJson = latestKpi ? {
        KpiDate: latestKpi.KpiDate,
        TicketsResolved: latestKpi.TicketsResolved,
        TicketsPerHour: latestKpi.TicketsPerHour,
        AvgOpenTickets: latestKpi.AvgOpenTickets,
        QAOverallAvg: latestKpi.QAOverallAvg,
        GoldenRulesAvg: latestKpi.GoldenRulesAvg,
        FrtCompliancePercent: latestKpi.FrtCompliancePercent,
        ResolutionSlaPercent: latestKpi.ResolutionSlaPercent,
      } : null;

      // Auto-freeze current goal statuses
      const plan = await queryOne<any>(`
        SELECT id FROM agent_development_plans
        WHERE agent_name = ? AND status IN ('active', 'deferred')
      `, [agentName]);

      let goalsJson = null;
      if (plan) {
        const goals = await query<any>(`
          SELECT id, title, status, metric_key, metric_target FROM agent_development_goals
          WHERE plan_id = ? ORDER BY sort_order
        `, [plan.id]);
        goalsJson = goals.map((g: any) => ({
          id: g.id, title: g.title, status: g.status,
          metric_key: g.metric_key, metric_target: g.metric_target,
        }));
      }

      const id = await executeAndGetId(`
        INSERT INTO agent_121_snapshots
          (agent_name, snapshot_date, metrics_json, goals_json, transcript_md, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        agentName,
        new Date().toISOString().slice(0, 10),
        metricsJson ? JSON.stringify(metricsJson) : null,
        goalsJson ? JSON.stringify(goalsJson) : null,
        transcript_md ?? null,
        notes ?? null,
      ]);

      res.json({ ok: true, data: { id } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Calendar — next 1-2-1 from O365 ──

  router.get('/agent/:agentName/calendar', async (req: Request, res: Response) => {
    try {
      const agentName = decodeURIComponent(String(req.params.agentName));
      const scope = await resolveAgentScope(req);
      if (scope && scope !== agentName) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      const tools = mcpManager.getServerTools('msgraph');
      const hasCalendarView = tools.includes('get-calendar-view') || tools.includes('list-calendar-events');

      if (!hasCalendarView) {
        res.json({ ok: true, data: null, reason: 'Calendar tools not available' });
        return;
      }

      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 86400000);

      const toolName = tools.includes('get-calendar-view') ? 'get-calendar-view' : 'list-calendar-events';
      const result = await mcpManager.callTool('msgraph', toolName, {
        startDateTime: now.toISOString(),
        endDateTime: futureDate.toISOString(),
      });

      // Parse MCP result
      const content = result as any;
      const text = content?.content?.[0]?.text;
      let events: any[] = [];
      if (text) {
        try {
          const parsed = JSON.parse(text);
          events = Array.isArray(parsed) ? parsed : (parsed?.value ?? []);
        } catch { events = []; }
      }

      // Find first event matching agent name (case-insensitive)
      const firstName = agentName.split(' ')[0].toLowerCase();
      const match = Array.isArray(events) ? events.find((e: any) => {
        const subject = (e.subject ?? e.Subject ?? '').toLowerCase();
        return subject.includes(firstName) && (
          subject.includes('1-2-1') || subject.includes('121') ||
          subject.includes('one to one') || subject.includes('1:1') ||
          subject.includes('catch up') || subject.includes('catchup')
        );
      }) : null;

      if (match) {
        res.json({
          ok: true,
          data: {
            subject: match.subject ?? match.Subject,
            start: match.start?.dateTime ?? match.Start?.DateTime ?? match.start,
            end: match.end?.dateTime ?? match.End?.DateTime ?? match.end,
          },
        });
      } else {
        res.json({ ok: true, data: null });
      }
    } catch (err: any) {
      console.error('[people] calendar lookup error:', err);
      res.json({ ok: true, data: null, reason: err.message });
    }
  });

  // ── Plaud integration stubs ──

  router.post('/agent/:agentName/import-plaud', async (req: Request, res: Response) => {
    res.status(501).json({ ok: false, error: 'Plaud import not yet implemented. See NOVA-Plaud-Integration-Notes.md for service design.' });
  });

  router.get('/agent/:agentName/plaud-recordings', async (req: Request, res: Response) => {
    res.status(501).json({ ok: false, error: 'Plaud recordings endpoint not yet implemented. See NOVA-Plaud-Integration-Notes.md for API details.' });
  });

  return router;
}
