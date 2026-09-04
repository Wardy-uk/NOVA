import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import sql from 'mssql';
import { query, queryOne, execute, executeAndGetId } from '../services/database.js';
import { getAllInRange } from '../services/kpi-agent/store.js';
import { toLegacyAgentRow, isoDaysAgo } from '../services/kpi-agent/legacy-shape.js';
import type { UserQueries } from '../db/queries.js';
import type { NotificationQueries } from '../db/notifications.js';
import type { McpClientManager } from '../services/mcp-client.js';
import { LlmService } from '../services/llm-service.js';
import { isAdmin } from '../utils/role-helpers.js';
import { upsertBooking, cancelOpenSessions } from '../services/one21-service.js';
import { gatherPrepSignals, signalsToPrompt } from '../services/one21-prep-signals.js';
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

  // Rebuild store, mapped to the legacy column names this function already reads.
  const kpiRows = (await getAllInRange(sinceDate, new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })))
    .filter(x => x.agentName === agentName)
    .sort((x, y) => y.date.localeCompare(x.date))
    .map(x => toLegacyAgentRow(x, x.date)) as any[];

  const qaReq = kpiDb.request();
  qaReq.input('agent', sql.NVarChar, agentName);
  qaReq.input('since', sql.NVarChar, sinceDate);
  const qaResult = await qaReq.query(`
    SELECT TOP 20 issueKey, overallScore, grade, isConcerning, CreatedAt
    FROM dbo.jira_qa_results
    WHERE assigneeName = @agent AND CAST(CreatedAt AS DATE) >= @since
      AND ISNULL(qaType, '') <> 'excluded'
    ORDER BY CreatedAt DESC
  `);
  const qaRows = qaResult.recordset;

  const concerningQa = qaRows.filter((r: any) =>
    r.grade === 'RED' || r.isConcerning === true || r.isConcerning === 1 || (r.overallScore != null && r.overallScore < 6.5)
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
    // These are averaged by name straight off the row. Five of the old names —
    // TicketsResolved, AvgOpenTickets, AvgOver2hOverdue, AvgNoUpdateToday and
    // ResolutionSlaPercent — are not columns and never have been, so those five
    // signals were silently absent from every 1-2-1 prep ever generated. Corrected
    // to the real names.
    const numericKeys = ['SolvedTickets_Today', 'TicketsPerHour', 'OpenTickets_Total',
      'OpenTickets_Over2Hours', 'OpenTickets_NoUpdateToday', 'OldestTicketDays',
      'QAOverallAvg', 'QAAccuracyAvg', 'QAClarityAvg', 'QAToneAvg',
      'GoldenRulesAvg', 'OwnershipAvg', 'NextActionAvg', 'TimeframeAvg',
      'SLACompliancePct'];
    for (const key of numericKeys) {
      const vals = kpiRows.map((r: any) => r[key]).filter((v: any) => v != null);
      if (vals.length > 0) {
        kpiSummary[key] = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
      }
    }
  }

  // The richer signals — escalations, AI-agent interaction, coaching signals, named QA
  // tickets, movement vs the previous period. These were the whole point of the separate
  // Briefing121Service, which never worked because it was keyed on a display name where
  // a Jira account id was needed. See one21-prep-signals.ts.
  const signals = await gatherPrepSignals(settingsQueries, agentName, sinceDate, qaRows as any);

  const systemPrompt = `You are an assistant helping a support team manager prepare for a 1-2-1 meeting with a team member.
Generate a structured prep document. Be specific, reference actual numbers and TICKET KEYS. Keep it concise and actionable.
Focus on: what's improved, what needs attention, goal progress, and suggested talking points.

Ground every point in the data given. Never infer a number that is not there, and treat
anything listed as unavailable as UNKNOWN — never as zero, and never as a finding.

You MUST respond with a single flat JSON object with exactly these keys:
{
  "summary": "string — brief overall assessment",
  "whats_improved": ["string array of improvements"],
  "needs_attention": ["string array of concerns"],
  "goal_progress": [{"goal": "string", "status": "string", "notes": "string"}],
  "qa_highlights": ["string array of QA observations, citing ticket keys"],
  "suggested_talking_points": ["string array"],
  "suggested_actions": ["string array"]
}
Do NOT nest the response inside another object. Return the flat JSON object directly.`;

  const userMessage = `Agent: ${agentName}
Period: ${sinceDate} to today
Role: ${plan?.role_title ?? 'Support Agent'} (${plan?.function_name ?? 'Technical Support'})

## KPI Averages (period)
${JSON.stringify(kpiSummary, null, 2)}

## Recent KPI Trend (last 5 days)
${JSON.stringify(kpiRows.slice(0, 5).map((r: any) => ({
  date: r.ReportDate, resolved: r.SolvedTickets_Today, tph: r.TicketsPerHour,
  qa: r.QAOverallAvg, gr: r.GoldenRulesAvg, frt: r.FrtCompliancePercent
})), null, 2)}

## QA Concerns (RED / low-scoring / concerning)
${concerningQa.length > 0
  ? concerningQa.map((r: any) => `- ${r.issueKey}: score ${r.overallScore}, grade ${r.grade}${r.isConcerning ? ' [CONCERNING]' : ''}`).join('\n')
  : 'None — all QA results acceptable'}

${signalsToPrompt(signals)}

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

  const prepSchema = z.preprocess((val: any) => {
    if (val && typeof val === 'object' && !val.whats_improved && !val.needs_attention) {
      const keys = Object.keys(val);
      if (keys.length === 1 && typeof val[keys[0]] === 'object') return val[keys[0]];
    }
    return val;
  }, z.object({
    summary: z.preprocess((v) => typeof v === 'object' && v !== null ? JSON.stringify(v) : v, z.string()),
    whats_improved: z.array(z.string()).default([]),
    needs_attention: z.array(z.string()).default([]),
    goal_progress: z.array(z.object({
      goal: z.string(),
      status: z.string(),
      notes: z.string().default(''),
    })).default([]),
    qa_highlights: z.array(z.string()).default([]),
    suggested_talking_points: z.array(z.string()).default([]),
    suggested_actions: z.array(z.string()).default([]),
  }));

  const llmService = new LlmService(settingsQueries);
  const llmResult = await llmService.call(systemPrompt, userMessage, prepSchema, {
    callType: '121-prep',
    maxTokens: 2048,
    temperature: 0.4,
  });

  const latestKpi = kpiRows[0] ?? {};
  const metricsJson = {
    ...kpiSummary,
    latestDate: latestKpi.ReportDate ?? null,
    periodDays: kpiRows.length,
  };

  // The gathered signals ride along inside prep_json, so every existing reader —
  // getSessionDetail, stage 2, the manager email — gets them without a schema change,
  // and the numbers on screen are the same ones the model reasoned over rather than a
  // second query that could disagree with it.
  const prepJson = { ...llmResult.data, signals };

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
    JSON.stringify(prepJson),
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

  return { snapshotId, prep: prepJson };
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

  // ── 1-2-1 scheduling ──
  //
  // NOVA holds the session; NEURO holds the calendar. The date can be set here or pushed
  // over the NEURO bridge, and both go through `upsertBooking` so they cannot disagree
  // about what a reschedule does to prep state. NOVA writes no Outlook event — see the
  // note on POST /agent/:name/next-121 below.
  const OPEN_121_STATUSES = "('scheduled','prep_sent','awaiting_agent','ready','in_progress')";

  // Batch: per-agent next (open) + last (completed) 1-2-1 dates for the My Team grid.
  router.get('/roster/sessions', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const today = new Date().toISOString().slice(0, 10);

      const open = await query<{ agent_name: string; id: number; scheduled_date: string; status: string }>(`
        SELECT s.agent_name, s.id, s.scheduled_date, s.status
        FROM agent_121_sessions s
        INNER JOIN (
          SELECT agent_name, MIN(scheduled_date) AS d
          FROM agent_121_sessions
          WHERE status IN ${OPEN_121_STATUSES}
          GROUP BY agent_name
        ) m ON m.agent_name = s.agent_name AND m.d = s.scheduled_date
        WHERE s.status IN ${OPEN_121_STATUSES}
      `);

      const last = await query<{ agent_name: string; last_date: string }>(`
        SELECT agent_name, MAX(scheduled_date) AS last_date
        FROM agent_121_sessions
        WHERE status = 'complete'
        GROUP BY agent_name
      `);

      const result: Record<string, {
        nextSessionId: number | null; nextDate: string | null; status: string | null;
        overdue: boolean; lastDate: string | null;
      }> = {};

      for (const row of open) {
        result[row.agent_name] = {
          nextSessionId: row.id,
          nextDate: row.scheduled_date,
          status: row.status,
          overdue: row.scheduled_date < today,
          lastDate: null,
        };
      }
      for (const row of last) {
        if (!result[row.agent_name]) {
          result[row.agent_name] = { nextSessionId: null, nextDate: null, status: null, overdue: false, lastDate: row.last_date };
        } else {
          result[row.agent_name].lastDate = row.last_date;
        }
      }

      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Set / reschedule the next 1-2-1 date (upsert the agent's single open session).
  router.post('/agent/:agentName/next-121', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      const date = String(req.body?.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ ok: false, error: 'date (YYYY-MM-DD) required' });
        return;
      }

      // Shares one implementation with the NEURO bridge, so a date set here and a date
      // booked in NEURO cannot drift apart in how they reset prep state.
      //
      // NOTE: this no longer writes an Outlook event. NEURO owns the calendar — it picks
      // a free slot, checks clashes and actually invites the person, none of which the old
      // mirror here did (it hardcoded 10:00-10:30 with no attendee). Two writers meant two
      // events in the diary. Setting a date here books nothing: use NEURO for that, or
      // put it in the diary yourself.
      const result = await upsertBooking(agentName, date);

      res.json({ ok: true, data: { id: result.sessionId, scheduled_date: date } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Cancel the agent's open 1-2-1 (clears the next date).
  router.post('/agent/:agentName/next-121/cancel', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }
      const agentName = decodeURIComponent(String(req.params.agentName));
      // The Outlook event is NEURO's now, so this cancels NOVA's session and reports the
      // event ids rather than deleting them — the invitee has already accepted, and
      // pulling the meeting out of their diary is a decision for the side that put it
      // there. Cancel it in NEURO to remove the event itself.
      const result = await cancelOpenSessions(agentName);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Survey satisfaction scores (per agent) ──
  //
  // Permanently empty. This used to join survey_responses back to survey_recipients
  // on the shared token and report each named agent's own satisfaction score — which
  // is precisely what the survey invitation promises will never happen. The token was
  // removed from survey_responses to make that join impossible (see routes/surveys.ts),
  // so there is no per-agent figure to return and there must not be one. Survey results
  // are only available in aggregate, above a minimum response count.
  //
  // The endpoint is kept so the roster keeps rendering; satisfaction simply reads as
  // "no data" there.

  router.get('/roster/survey-scores', async (req: Request, res: Response) => {
    try {
      if (!req.user || !isAdmin(req.user.role)) {
        res.status(403).json({ ok: false, error: 'Admin only' });
        return;
      }

      res.json({ ok: true, data: {} });
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
        // `important_context` is the one field a caller is allowed to CLEAR, so it can't
        // be COALESCE'd like the rest — but writing `?` unconditionally meant every
        // partial update wiped it. The roster grid's status chip sends `{manager_status}`
        // alone, so changing someone's status silently destroyed whatever context had
        // been written on their profile. Presence in the body is what decides now:
        // send the key to change it (null clears), omit it to leave it alone.
        const clearsContext = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'important_context');
        await execute(`
          UPDATE agent_development_plans SET
            role_title = COALESCE(?, role_title),
            function_name = COALESCE(?, function_name),
            plan_period = COALESCE(?, plan_period),
            role_clarity = COALESCE(?, role_clarity),
            strengths = COALESCE(?, strengths),
            important_context = CASE WHEN ? = 1 THEN ? ELSE important_context END,
            status = COALESCE(?, status),
            manager_status = COALESCE(?, manager_status),
            updated_at = GETUTCDATE()
          WHERE id = ?
        `, [role_title, function_name, plan_period, role_clarity,
            strengths ? JSON.stringify(strengths) : null,
            clearsContext ? 1 : 0, important_context ?? null,
            status, manager_status ?? null, existing.id]);
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
      res.status(500).json({ ok: false, error: err.message, stack: err.stack });
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

      // Auto-freeze the latest KPI row, from the Rebuild store.
      //
      // This used to SELECT * FROM jira_agent_kpi_daily against the NOVA database —
      // where that table does not live — and then read TicketsResolved,
      // AvgOpenTickets and ResolutionSlaPercent, none of which are columns of it
      // anywhere. Every 1-2-1 snapshot has therefore frozen a row of nulls.
      const recent = (await getAllInRange(isoDaysAgo(30), new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' })))
        .filter(x => x.agentName === agentName)
        .sort((x, y) => y.date.localeCompare(x.date));
      const latestKpi = recent.length > 0 ? toLegacyAgentRow(recent[0], recent[0].date) : null;

      const metricsJson = latestKpi ? {
        ReportDate: latestKpi.ReportDate,
        TicketsResolved: latestKpi.SolvedTickets_Today,
        TicketsPerHour: latestKpi.TicketsPerHour,
        AvgOpenTickets: latestKpi.OpenTickets_Total,
        OldestTicketDays: latestKpi.OldestTicketDays,
        QAOverallAvg: latestKpi.QAOverallAvg,
        GoldenRulesAvg: latestKpi.GoldenRulesAvg,
        FrtCompliancePercent: latestKpi.FrtCompliancePercent,
        ResolutionSlaPercent: latestKpi.SLACompliancePct,
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

  // ── Aged Tickets ──

  router.get('/agent/:agentName/aged-tickets', async (req: Request, res: Response) => {
    try {
      const agentName = decodeURIComponent(String(req.params.agentName));
      const scope = await resolveAgentScope(req);
      if (scope && scope !== agentName) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      // Bucket on request_type, NOT issuetype_name: every open NT ticket carries
      // issuetype_name 'Support', so the old substring match on 'incident' / 'request' /
      // 'onboarding' matched nothing and this section reported 0 across the board
      // regardless of how aged the queue actually was.
      //
      // Tickets parked at tier Development are excluded for the same reason they are
      // excluded from the open-ticket stocks — Dev owns the fix, not the agent — and are
      // returned separately as `development` so the pile stays visible.
      //
      // Scoped to project NT to match the agent KPI stocks (compute.ts), so the two
      // sections of the profile agree with each other.
      const rows = await query<{
        request_type: string | null;
        current_tier: string | null;
        status_name: string | null;
        age_days: number;
        issue_key: string;
        summary: string;
        priority_name: string;
      }>(`
        SELECT request_type,
               current_tier,
               status_name,
               DATEDIFF(day, jira_created, GETUTCDATE()) AS age_days,
               issue_key, summary, priority_name
        FROM jira_issue_cache
        WHERE project_key = 'NT'
          AND (assignee_display = ? OR assignee_display LIKE ? + '%' OR ? LIKE assignee_display + '%')
          AND status_category NOT IN ('Done', 'done')
          AND resolution_name IS NULL
        ORDER BY jira_created ASC
      `, [agentName, agentName, agentName]);

      const isDev = (r: { current_tier: string | null }) => (r.current_tier || '').toLowerCase() === 'development';
      const rt = (r: { request_type: string | null }) => (r.request_type || '').trim().toLowerCase();

      const actionable = rows.filter(r => !isDev(r));
      const development = rows.filter(isDev);

      const incidents = actionable.filter(r => rt(r) === 'incident' && r.age_days > 5);
      const serviceRequests = actionable.filter(
        r => (rt(r) === 'service request' || rt(r) === 'tpj request' || rt(r) === 'emailed request') && r.age_days > 10,
      );
      const onboarding = actionable.filter(
        r => (rt(r) === 'onboarding' || rt(r) === 'delivery qa') && r.age_days > 15,
      );
      // Roughly 10% of open NT tickets have no request_type cached. Without a bucket of
      // their own they would drop out of the section silently — an empty board that only
      // looks clean.
      const other = actionable.filter(r => rt(r) === '' && r.age_days > 10);

      // The live oldest actionable ticket. The profile card used to take the MAX of
      // jira_agent_kpi_daily.OldestTicketDays across the whole range, so it reported the
      // worst any single day had ever been and could never come down — Hope showed 253
      // days from a Development ticket last seen on 27 Aug while her real oldest was 19.
      // That column is also unreliable (every agent's row for today is 0). Computing it
      // here from the same live rows the buckets use keeps the whole section consistent.
      //
      // Mirrors compute.ts: statuses the agent cannot action do not count towards oldest.
      const NOT_ACTIONABLE = new Set(['waiting on requestor', 'waiting on partner', 'waiting on development']);
      const oldestRow = actionable
        .filter(r => !NOT_ACTIONABLE.has((r.status_name || '').toLowerCase()))
        .reduce<typeof rows[number] | null>((best, r) => (best === null || r.age_days > best.age_days ? r : best), null);

      const bucket = (list: typeof rows) => ({ count: list.length, tickets: list.slice(0, 10) });

      res.json({
        ok: true,
        data: {
          incidents: bucket(incidents),
          serviceRequests: bucket(serviceRequests),
          onboarding: bucket(onboarding),
          other: bucket(other),
          development: bucket(development),
          oldest: oldestRow
            ? { days: oldestRow.age_days, issue_key: oldestRow.issue_key, summary: oldestRow.summary }
            : null,
          _debug: { agentName, totalOpen: rows.length, requestTypes: [...new Set(rows.map(r => r.request_type))] },
        },
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
