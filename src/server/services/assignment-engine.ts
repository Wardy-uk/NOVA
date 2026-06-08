import sql from 'mssql';
import { query, queryOne, execute, executeAndGetId } from './database.js';
import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { createWorkingDayClock, type WorkingDayClock } from '../../shared/utils/workingDayClock.js';

export type Pool = 'cc' | 't2' | 'tpj' | 'digital' | 'production';

export interface RosterAgent {
  id: number;
  jira_account_id: string;
  display_name: string;
  email: string | null;
  pool: Pool;
  department?: string | null;
  skills: string[] | null;
  max_capacity: number;
  max_tickets_cc: number | null;
  max_tickets_t2t3: number | null;
  active: boolean;
  is_current_agent: boolean;
  last_assigned_at: Date | null;
}

export interface AssignmentResult {
  agent: RosterAgent;
  reason: string;
  openTicketCount: number;
}

interface AgentLoad {
  agent: RosterAgent;
  openCount: number;
  capacityRatio: number;
}

export interface WorkloadBuckets {
  total: number;
  cc: number;
  t2t3: number;
  tpj: number;
}

interface ProjectPoolConfig {
  defaultPool: Pool;
  allowedPools: Pool[];
}

const TEAM_TO_POOL: Record<string, Pool> = {
  cc: 'cc',
  customercare: 'cc',
  'customer care': 'cc',
  t2: 't2',
  t3: 't2',
  support: 't2',
  tpj: 'tpj',
  digital: 'digital',
  digitaldesign: 'digital',
};

function normalizePool(team: string | null): Pool {
  if (!team) return 'cc';
  const key = team.toLowerCase().trim();
  return TEAM_TO_POOL[key] ?? 'cc';
}

export class AssignmentEngine {
  private kpiPool: sql.ConnectionPool | null = null;
  private workingDayClock: WorkingDayClock;
  private bankHolidaysHash: string = '';
  private approvalQueries: { withdrawByTicketKey(ticketKey: string, reason: string): Promise<number> } | null = null;
  private retryQueries: { insert(ticketKey: string, pool: string, projectKey: string, error?: string): Promise<number>; markResolved(ticketKey: string, reason: string): Promise<void> } | null = null;
  // Recent assignments made this process, by agent account id (timestamps). Folded into the
  // workload snapshot so a batch/sweep can't pile every ticket onto whoever was lowest at the
  // start — the snapshot (KPI/cache) lags behind by minutes, so we track in-flight here.
  private recentAssignments = new Map<string, number[]>();

  constructor(
    private jiraClient: JiraRestClient,
    private settingsQueries: SettingsQueries,
    private jiraProject: string = 'NT',
  ) {
    this.workingDayClock = this.buildWorkingDayClock();
  }

  setApprovalQueries(aq: { withdrawByTicketKey(ticketKey: string, reason: string): Promise<number> }): void {
    this.approvalQueries = aq;
  }

  setRetryQueries(rq: { insert(ticketKey: string, pool: string, projectKey: string, error?: string): Promise<number>; markResolved(ticketKey: string, reason: string): Promise<void> }): void {
    this.retryQueries = rq;
  }

  private async getKpiPool(): Promise<sql.ConnectionPool> {
    if (this.kpiPool?.connected) return this.kpiPool;
    const server = this.settingsQueries.get('kpi_sql_server');
    const database = this.settingsQueries.get('kpi_sql_database');
    const user = this.settingsQueries.get('kpi_sql_user');
    const password = this.settingsQueries.get('kpi_sql_password');
    if (!server || !database || !user || !password) {
      throw new Error('KPI SQL not configured — set kpi_sql_server/database/user/password in Settings');
    }
    this.kpiPool = await new sql.ConnectionPool({
      server, database, user, password,
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
    }).connect();
    return this.kpiPool;
  }

  async assign(ticketKey: string, pool: Pool = 'cc', preferredSkills?: string[], projectKey?: string, options?: { reporterEmail?: string; complexity?: number }): Promise<AssignmentResult | null> {
    this.refreshClockIfNeeded();
    if (!this.workingDayClock.isWorkingTime(new Date())) {
      console.log(`[assignment] Outside working hours — skipping assignment for ${ticketKey}`);
      return null;
    }

    const project = projectKey || this.resolveProjectFromTicketKey(ticketKey);
    pool = this.validatePoolForProject(pool, project);

    const available = (await this.getAvailableAgents(pool))
      .filter(agent => this.isAgentEligibleForProject(agent, project));
    if (available.length === 0) return null;

    const allBuckets = await this.getAgentLoadsBatch(available);

    // Fold in assignments made in the last few minutes that the workload snapshot
    // (KPI/cache) hasn't reflected yet. Without this, every ticket in a sweep sees the
    // same stale snapshot and piles onto whoever was lowest at the start (e.g. all of a
    // backlog landing on one agent and blowing past their cap).
    for (const agent of available) {
      const recent = this.getRecentAssignmentCount(agent.jira_account_id);
      if (recent === 0) continue;
      const b = allBuckets.get(agent.jira_account_id);
      if (!b) continue;
      b.total += recent;
      if (pool === 'cc') b.cc += recent;
      else if (pool === 't2') b.t2t3 += recent;
      else if (pool === 'tpj') b.tpj += recent;
    }

    // TPJ stickiness: domain-based, overrides caps (n8n parity)
    if (pool === 'tpj' && options?.reporterEmail) {
      const sticky = await this.findStickyAgent(options.reporterEmail, available);
      if (sticky) {
        const buckets = allBuckets.get(sticky.jira_account_id) || { total: 0, cc: 0, t2t3: 0, tpj: 0 };
        const result: AssignmentResult = {
          agent: sticky,
          reason: `customer stickiness | ${buckets.total}/${sticky.max_capacity} tickets`,
          openTicketCount: buckets.total,
        };
        try { await this.recordAssignment(ticketKey, pool, { agent: sticky, openCount: buckets.total, capacityRatio: 0 }, project, 'customer_stickiness'); }
        catch (err) { console.error(`[assignment] recordAssignment failed for ${ticketKey}:`, err instanceof Error ? err.message : err); }
        try { await this.updateLastAssigned(sticky.id); }
        catch (err) { console.error(`[assignment] updateLastAssigned failed for agent ${sticky.id}:`, err instanceof Error ? err.message : err); }
        return result;
      }
    }

    // Build eligible list with dual-cap check (overall + pool-specific)
    const eligible = available
      .map(agent => ({
        agent,
        buckets: allBuckets.get(agent.jira_account_id) || { total: 0, cc: 0, t2t3: 0, tpj: 0 },
      }))
      .filter(({ agent, buckets }) => this.isEligible(agent, buckets, pool));

    if (eligible.length === 0) return null;

    // Rank by lowest absolute count (n8n parity)
    const ranked = this.rankByWorkload(eligible, pool);
    let assignmentReason: string = 'capacity_best';

    // Customer continuity for non-TPJ pools (NOVA addition, kept for CC/T2)
    const continuityEnabled = this.settingsQueries.get('assignment_customer_continuity_enabled') !== 'false';
    if (continuityEnabled && pool !== 'tpj' && options?.reporterEmail) {
      const loads = ranked.map(({ agent, buckets }) => ({ agent, openCount: buckets.total, capacityRatio: agent.max_capacity > 0 ? buckets.total / agent.max_capacity : 1 }));
      const continuityResult = await this.boostByCustomerContinuity(loads, options.reporterEmail);
      if (continuityResult.boosted) {
        const chosen = continuityResult.ranked[0];
        assignmentReason = 'customer_continuity';
        const chosenBuckets = allBuckets.get(chosen.agent.jira_account_id) || { total: 0, cc: 0, t2t3: 0, tpj: 0 };
        const result: AssignmentResult = {
          agent: chosen.agent,
          reason: this.buildReasonFromBuckets(chosen.agent, chosenBuckets, pool),
          openTicketCount: chosenBuckets.total,
        };
        try { await this.recordAssignment(ticketKey, pool, chosen, project, assignmentReason); }
        catch (err) { console.error(`[assignment] recordAssignment failed for ${ticketKey}:`, err instanceof Error ? err.message : err); }
        try { await this.updateLastAssigned(chosen.agent.id); }
        catch (err) { console.error(`[assignment] updateLastAssigned failed for agent ${chosen.agent.id}:`, err instanceof Error ? err.message : err); }
        return result;
      }
    }

    const chosen = ranked[0];
    const chosenBuckets = chosen.buckets;

    if (preferredSkills?.length) {
      const loads = ranked.map(({ agent, buckets }) => ({ agent, openCount: buckets.total, capacityRatio: agent.max_capacity > 0 ? buckets.total / agent.max_capacity : 1 }));
      const skillRanked = this.boostBySkills(loads, preferredSkills);
      if (skillRanked[0]?.agent.jira_account_id !== chosen.agent.jira_account_id) {
        assignmentReason = 'skill_match';
        const skillChosen = skillRanked[0];
        const skillBuckets = allBuckets.get(skillChosen.agent.jira_account_id) || { total: 0, cc: 0, t2t3: 0, tpj: 0 };
        const result: AssignmentResult = {
          agent: skillChosen.agent,
          reason: this.buildReasonFromBuckets(skillChosen.agent, skillBuckets, pool),
          openTicketCount: skillBuckets.total,
        };
        try { await this.recordAssignment(ticketKey, pool, skillChosen, project, assignmentReason); }
        catch (err) { console.error(`[assignment] recordAssignment failed for ${ticketKey}:`, err instanceof Error ? err.message : err); }
        try { await this.updateLastAssigned(skillChosen.agent.id); }
        catch (err) { console.error(`[assignment] updateLastAssigned failed for agent ${skillChosen.agent.id}:`, err instanceof Error ? err.message : err); }
        return result;
      }
    }

    const result: AssignmentResult = {
      agent: chosen.agent,
      reason: this.buildReasonFromBuckets(chosen.agent, chosenBuckets, pool),
      openTicketCount: chosenBuckets.total,
    };

    try { await this.recordAssignment(ticketKey, pool, { agent: chosen.agent, openCount: chosenBuckets.total, capacityRatio: 0 }, project, assignmentReason); }
    catch (err) { console.error(`[assignment] recordAssignment failed for ${ticketKey}:`, err instanceof Error ? err.message : err); }
    try { await this.updateLastAssigned(chosen.agent.id); }
    catch (err) { console.error(`[assignment] updateLastAssigned failed for agent ${chosen.agent.id}:`, err instanceof Error ? err.message : err); }

    return result;
  }

  async assignToJira(ticketKey: string, pool: Pool = 'cc', preferredSkills?: string[], projectKey?: string): Promise<AssignmentResult | null> {
    const result = await this.assign(ticketKey, pool, preferredSkills, projectKey);
    if (!result) return null;

    await this.jiraClient.updateFields(ticketKey, {
      assignee: { accountId: result.agent.jira_account_id },
    });

    // Auto-withdraw pending approvals when a human agent is assigned
    if (this.approvalQueries) {
      try {
        await this.approvalQueries.withdrawByTicketKey(ticketKey, `assigned-to-${result.agent.display_name}`);
      } catch { /* best effort */ }
    }

    // Mark resolved in retry queue if it was queued
    if (this.retryQueries) {
      try { await this.retryQueries.markResolved(ticketKey, `assigned-to-${result.agent.display_name}`); }
      catch { /* best effort */ }
    }

    return result;
  }

  async assignWithFallback(ticketKey: string, pool: Pool, project: string, preferredSkills?: string[]): Promise<AssignmentResult | null> {
    // No cross-tier fallback: a ticket stays in its assigned pool. New tickets default
    // to CC; only a routing rule pushes to T2/TPJ. If the assigned pool has no available
    // agent we queue for retry rather than spilling to another tier — T2 must never fall
    // to CC, and CC must never fall to T2.
    const fallbackChain: Pool[] = [pool];

    for (const tryPool of fallbackChain) {
      const result = await this.assignToJira(ticketKey, tryPool, preferredSkills, project);
      if (result) return result;
      console.log(`[assignment] No agents in ${tryPool} for ${project}, trying next pool`);
    }

    // All pools exhausted — queue for automatic retry + post internal note (dedup within 2h)
    const exhaustionMsg = `No agents available in any pool (tried: ${fallbackChain.join(', ')})`;
    console.warn(`[assignment] All pools exhausted for ${ticketKey}: ${exhaustionMsg}`);

    if (this.retryQueries) {
      try { await this.retryQueries.insert(ticketKey, pool, project, exhaustionMsg); }
      catch (err) { console.warn(`[assignment] Failed to queue ${ticketKey} for retry:`, err instanceof Error ? err.message : err); }
    }

    try {
      const comments = await this.jiraClient.getComments(ticketKey, 10);
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const alreadyNoted = comments.some(c =>
        JSON.stringify(c.body).includes('Assignment failed') &&
        new Date(c.created).getTime() > twoHoursAgo
      );
      if (!alreadyNoted) {
        await this.jiraClient.addComment(
          ticketKey,
          `⚠️ Assignment failed — no agents available in any pool (tried: ${fallbackChain.join(', ')}). Queued for automatic retry during working hours.`,
          { internal: true },
        );
      }
    } catch (err) {
      console.warn(`[assignment] Failed to post exhaustion note on ${ticketKey}:`, err instanceof Error ? err.message : err);
    }

    return null;
  }

  async postAssignmentComment(ticketKey: string, assignment: AssignmentResult): Promise<void> {
    const comment = `[NOVA Round Robin] Auto-assigned to ${assignment.agent.display_name}\n` +
      `Pool: ${assignment.agent.pool.toUpperCase()} | ${assignment.reason}`;
    try {
      // Dedup: skip if this agent was already assigned via round-robin recently
      const recent = await this.jiraClient.getComments(ticketKey, 5);
      const isDupe = recent.some(c => {
        const text = JSON.stringify(c.body ?? '');
        return text.includes('NOVA Round Robin') && text.includes(assignment.agent.display_name);
      });
      if (isDupe) {
        console.log(`[assignment] Skipping duplicate comment for ${ticketKey} — already assigned to ${assignment.agent.display_name}`);
        return;
      }
      await this.jiraClient.addComment(ticketKey, comment, { internal: true });
    } catch (err) {
      console.warn(`[assignment] Failed to post assignment comment for ${ticketKey}:`, err instanceof Error ? err.message : err);
    }
  }

  isWorkingTime(): boolean {
    this.refreshClockIfNeeded();
    return this.workingDayClock.isWorkingTime(new Date());
  }

  resolveProjectFromTicketKey(ticketKey: string): string {
    const match = ticketKey.match(/^([A-Z]+)-/);
    return match?.[1] || 'NT';
  }

  getConfiguredProjects(): string[] {
    // assignment_projects is the dedicated setting for round-robin scope.
    // Falls back to agent_jira_project so existing setups work unchanged.
    const raw = this.settingsQueries.get('assignment_projects')
      || this.settingsQueries.get('agent_jira_project')
      || 'NT';
    return raw.split(',').map(p => p.trim()).filter(Boolean);
  }

  validateProjectConfig(): void {
    const projects = this.getConfiguredProjects();
    const expected = ['NT', 'NTPJ'];
    for (const proj of expected) {
      if (!projects.includes(proj)) {
        console.warn(`[assignment] ⚠️ Project ${proj} is not in assignment_projects (${projects.join(', ')}). Tickets in ${proj} won't be included in capacity calculations.`);
      }
    }
  }

  async getAvailableAgents(pool: Pool): Promise<RosterAgent[]> {
    const agents = await this.getAllAgents(pool);
    const active = agents.filter(a => a.active);
    if (active.length === 0) return [];

    const today = new Date().toISOString().slice(0, 10);
    const availRows = await query<{ roster_id: number; status: string }>(
      `SELECT roster_id, status FROM agent_availability
       WHERE available_date = ? AND roster_id IN (${active.map(() => '?').join(',')})`,
      [today, ...active.map(a => a.id)],
    );

    const unavailableIds = new Set(
      availRows
        .filter(r => r.status !== 'available' && r.status !== 'wfh')
        .map(r => r.roster_id),
    );

    const available = active.filter(a => !unavailableIds.has(a.id));
    if (unavailableIds.size > 0) {
      const excluded = active.filter(a => unavailableIds.has(a.id)).map(a => a.display_name);
      console.log(`[assignment] Pool ${pool}: ${available.length} available, excluded ${excluded.length} unavailable: ${excluded.join(', ')}`);
    }
    return available;
  }

  async getAllAgents(pool?: Pool): Promise<RosterAgent[]> {
    // Primary source: agent_roster (local NOVA DB, managed by Agent Admin UI)
    const rosterAgents = await this.getAllAgentsFromRoster(pool);
    if (rosterAgents.length > 0) return rosterAgents;

    // Fallback: KPI dbo.Agent (legacy path for pools not yet in agent_roster)
    return this.getAllAgentsFromKpi(pool);
  }

  private async getAllAgentsFromRoster(pool?: Pool): Promise<RosterAgent[]> {
    const conditions = ['active = 1'];
    const params: unknown[] = [];
    if (pool) { conditions.push('pool = ?'); params.push(pool); }
    const rows = await query<{
      id: number; jira_account_id: string; display_name: string; email: string | null;
      pool: string; skills: string | null; max_capacity: number; max_tickets_cc: number | null; max_tickets_t2t3: number | null; active: number;
    }>(
      `SELECT id, jira_account_id, display_name, email, pool, skills, max_capacity, max_tickets_cc, max_tickets_t2t3, active
       FROM agent_roster WHERE ${conditions.join(' AND ')}
       ORDER BY pool, display_name`,
      params,
    );

    if (rows.length === 0) return [];

    const departmentMap = await this.getKpiDepartmentMap(rows.map(row => row.jira_account_id));
    const stateRows = await query<{
      agent_id: number; is_current_agent: number; last_assigned_at: string | null;
    }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state`);
    const stateMap = new Map(stateRows.map(r => [r.agent_id, r]));

    return rows.map(row => {
      const state = stateMap.get(row.id);
      let parsedSkills: string[] | null = null;
      if (row.skills) {
        try { parsedSkills = JSON.parse(row.skills); } catch { /* ignore */ }
      }
      return {
        id: row.id,
        jira_account_id: row.jira_account_id,
        display_name: row.display_name,
        email: row.email,
        pool: normalizePool(row.pool),
        department: departmentMap.get(row.jira_account_id) ?? null,
        skills: parsedSkills,
        max_capacity: row.max_capacity ?? 15,
        max_tickets_cc: row.max_tickets_cc ?? null,
        max_tickets_t2t3: row.max_tickets_t2t3 ?? null,
        active: !!row.active,
        is_current_agent: !!(state?.is_current_agent),
        last_assigned_at: state?.last_assigned_at ? new Date(state.last_assigned_at) : null,
      };
    });
  }

  private async getAllAgentsFromKpi(pool?: Pool): Promise<RosterAgent[]> {
    const p = await this.getKpiPool();
    const result = await p.request().query(`
      SELECT AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team,
             Department, IsActive, ISNULL(MaxTickets, 10) AS MaxTickets,
             MaxTicketsCustomerCare, MaxTicketsT2T3
      FROM dbo.Agent
      WHERE Department IN ('NT', 'NTPJ')
      ORDER BY Team, AgentName
    `);

    const stateRows = await query<{
      agent_id: number; is_current_agent: number; last_assigned_at: string | null;
    }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state`);
    const stateMap = new Map(stateRows.map(r => [r.agent_id, r]));

    const agents = result.recordset.map((row: any) => this.mapAgentRow(row, stateMap));

    if (pool) return agents.filter(a => a.pool === pool);
    return agents;
  }

  async getAgent(id: number): Promise<RosterAgent | undefined> {
    // Try agent_roster first
    const rosterRow = await queryOne<{
      id: number; jira_account_id: string; display_name: string; email: string | null;
      pool: string; skills: string | null; max_capacity: number; max_tickets_cc: number | null; max_tickets_t2t3: number | null; active: number;
    }>(`SELECT id, jira_account_id, display_name, email, pool, skills, max_capacity, max_tickets_cc, max_tickets_t2t3, active FROM agent_roster WHERE id = ?`, [id]);

    if (rosterRow) {
      const stateRow = await queryOne<{
        agent_id: number; is_current_agent: number; last_assigned_at: string | null;
      }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state WHERE agent_id = ?`, [id]);
      let parsedSkills: string[] | null = null;
      if (rosterRow.skills) { try { parsedSkills = JSON.parse(rosterRow.skills); } catch { /* ignore */ } }
      return {
        id: rosterRow.id, jira_account_id: rosterRow.jira_account_id,
        display_name: rosterRow.display_name, email: rosterRow.email,
        pool: normalizePool(rosterRow.pool), skills: parsedSkills,
        max_capacity: rosterRow.max_capacity ?? 15,
        max_tickets_cc: rosterRow.max_tickets_cc ?? null,
        max_tickets_t2t3: rosterRow.max_tickets_t2t3 ?? null,
        active: !!rosterRow.active,
        is_current_agent: !!(stateRow?.is_current_agent),
        last_assigned_at: stateRow?.last_assigned_at ? new Date(stateRow.last_assigned_at) : null,
      };
    }

    // Fallback: KPI dbo.Agent
    const p = await this.getKpiPool();
    const req = p.request();
    req.input('agentId', sql.Int, id);
    const result = await req.query(`
      SELECT AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team,
             Department, IsActive, ISNULL(MaxTickets, 10) AS MaxTickets,
             MaxTicketsCustomerCare, MaxTicketsT2T3
      FROM dbo.Agent
      WHERE AgentId = @agentId
    `);
    const row = result.recordset[0];
    if (!row) return undefined;

    const stateRow2 = await queryOne<{
      agent_id: number; is_current_agent: number; last_assigned_at: string | null;
    }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state WHERE agent_id = ?`, [id]);

    const stateMap = new Map<number, any>();
    if (stateRow2) stateMap.set(stateRow2.agent_id, stateRow2);
    return this.mapAgentRow(row, stateMap);
  }

  async getAgentByJiraId(jiraAccountId: string): Promise<RosterAgent | undefined> {
    // Try agent_roster first
    const rosterRow = await queryOne<{
      id: number; jira_account_id: string; display_name: string; email: string | null;
      pool: string; skills: string | null; max_capacity: number; max_tickets_cc: number | null; max_tickets_t2t3: number | null; active: number;
    }>(`SELECT id, jira_account_id, display_name, email, pool, skills, max_capacity, max_tickets_cc, max_tickets_t2t3, active FROM agent_roster WHERE jira_account_id = ?`, [jiraAccountId]);

    if (rosterRow) {
      const stateRow = await queryOne<{
        agent_id: number; is_current_agent: number; last_assigned_at: string | null;
      }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state WHERE agent_id = ?`, [rosterRow.id]);
      let parsedSkills: string[] | null = null;
      if (rosterRow.skills) { try { parsedSkills = JSON.parse(rosterRow.skills); } catch { /* ignore */ } }
      return {
        id: rosterRow.id, jira_account_id: rosterRow.jira_account_id,
        display_name: rosterRow.display_name, email: rosterRow.email,
        pool: normalizePool(rosterRow.pool), skills: parsedSkills,
        max_capacity: rosterRow.max_capacity ?? 15,
        max_tickets_cc: rosterRow.max_tickets_cc ?? null,
        max_tickets_t2t3: rosterRow.max_tickets_t2t3 ?? null,
        active: !!rosterRow.active,
        is_current_agent: !!(stateRow?.is_current_agent),
        last_assigned_at: stateRow?.last_assigned_at ? new Date(stateRow.last_assigned_at) : null,
      };
    }

    // Fallback: KPI dbo.Agent
    const p = await this.getKpiPool();
    const req = p.request();
    req.input('accountId', sql.NVarChar, jiraAccountId);
    const result = await req.query(`
      SELECT AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team,
             Department, IsActive, ISNULL(MaxTickets, 10) AS MaxTickets,
             MaxTicketsCustomerCare, MaxTicketsT2T3
      FROM dbo.Agent
      WHERE AccountId = @accountId
    `);
    const row = result.recordset[0];
    if (!row) return undefined;

    const stateRow2 = await queryOne<{
      agent_id: number; is_current_agent: number; last_assigned_at: string | null;
    }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state WHERE agent_id = ?`, [row.AgentId]);

    const stateMap = new Map<number, any>();
    if (stateRow2) stateMap.set(stateRow2.agent_id, stateRow2);
    return this.mapAgentRow(row, stateMap);
  }

  async rotateCurrentAgent(pool: Pool = 'cc'): Promise<RosterAgent | null> {
    const agents = await this.getAvailableAgents(pool);
    if (agents.length === 0) return null;

    const currentIdx = agents.findIndex(a => a.is_current_agent);
    const nextIdx = (currentIdx + 1) % agents.length;
    const next = agents[nextIdx];

    const poolAgentIds = agents.map(a => a.id);
    await execute(
      `UPDATE agent_assignment_state SET is_current_agent = 0
       WHERE agent_id IN (${poolAgentIds.map(() => '?').join(',')})`,
      poolAgentIds,
    );
    await execute(
      `MERGE agent_assignment_state AS target
       USING (SELECT ? AS agent_id) AS source ON target.agent_id = source.agent_id
       WHEN MATCHED THEN UPDATE SET is_current_agent = 1, updated_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (agent_id, is_current_agent) VALUES (?, 1);`,
      [next.id, next.id],
    );

    return { ...next, is_current_agent: true };
  }

  async getCurrentAgent(pool: Pool = 'cc'): Promise<RosterAgent | null> {
    const stateRow = await queryOne<{ agent_id: number }>(
      `SELECT agent_id FROM agent_assignment_state WHERE is_current_agent = 1`,
    );
    if (!stateRow) return null;

    const agent = await this.getAgent(stateRow.agent_id);
    if (!agent || !agent.active || agent.pool !== pool) return null;
    return agent;
  }

  async getAssignmentLog(limit: number = 50, projectKey?: string): Promise<any[]> {
    if (projectKey) {
      return query(
        `SELECT * FROM agent_assignment_log WHERE project_key = ? ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
        [projectKey, limit],
      );
    }
    return query(
      `SELECT * FROM agent_assignment_log ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
      [limit],
    );
  }

  async getPoolStats(): Promise<Record<Pool, { total: number; available: number; avgLoad: number }>> {
    const pools: Pool[] = ['cc', 't2', 'tpj', 'digital'];
    const result = {} as Record<Pool, { total: number; available: number; avgLoad: number }>;

    for (const pool of pools) {
      const all = await this.getAllAgents(pool);
      const available = await this.getAvailableAgents(pool);
      const loads = available.length > 0 ? await this.getAgentLoads(available) : [];
      const avgLoad = loads.length > 0 ? loads.reduce((s, l) => s + l.capacityRatio, 0) / loads.length : 0;
      result[pool] = { total: all.length, available: available.length, avgLoad: Math.round(avgLoad * 100) / 100 };
    }

    return result;
  }

  // --- Private helpers ---

  private async getAgentLoadsBatch(agents: RosterAgent[]): Promise<Map<string, WorkloadBuckets>> {
    const projects = this.getConfiguredProjects();
    const projectPlaceholders = projects.map(() => '?').join(', ');

    const rows = await query<{
      assignee_account_id: string;
      project_key: string;
      current_tier: string | null;
      labels: string | null;
      cnt: number;
    }>(
      `SELECT assignee_account_id, project_key, current_tier, labels, COUNT(*) as cnt
       FROM jira_issue_cache
       WHERE assignee_account_id IS NOT NULL
         AND status_category != 'done'
         AND project_key IN (${projectPlaceholders})
         AND (current_tier IS NULL OR current_tier != 'Development')
       GROUP BY assignee_account_id, project_key, current_tier, labels`,
      projects,
    );

    const buckets = new Map<string, WorkloadBuckets>();
    for (const agent of agents) {
      buckets.set(agent.jira_account_id, { total: 0, cc: 0, t2t3: 0, tpj: 0 });
    }

    for (const row of rows) {
      const b = buckets.get(row.assignee_account_id);
      if (!b) continue;
      b.total += row.cnt;

      const labels = (row.labels || '').toLowerCase();
      if (labels.includes('int_setup')) {
        b.tpj += row.cnt;
      } else {
        const tier = (row.current_tier || '').trim().toLowerCase();
        if (tier === '' || tier === 'customer care' || tier === 't1' || tier.startsWith('tier 1') || tier.startsWith('tier1')) {
          b.cc += row.cnt;
        } else if (tier.startsWith('t2') || tier.startsWith('t3') || tier.startsWith('tier 2') || tier.startsWith('tier2') || tier.startsWith('tier 3') || tier.startsWith('tier3') || tier === 'production') {
          b.t2t3 += row.cnt;
        }
      }
    }

    return buckets;
  }

  // Legacy method kept for getPoolStats() compatibility
  private async getAgentLoads(agents: RosterAgent[], complexityWeight: number = 1): Promise<AgentLoad[]> {
    const allBuckets = await this.getAgentLoadsBatch(agents);
    return agents.map(agent => {
      const b = allBuckets.get(agent.jira_account_id) || { total: 0, cc: 0, t2t3: 0, tpj: 0 };
      const effectiveLoad = b.total + Math.max(0, complexityWeight - 1);
      return {
        agent,
        openCount: b.total,
        capacityRatio: agent.max_capacity > 0 ? effectiveLoad / agent.max_capacity : 1,
      };
    });
  }

  private async boostByCustomerContinuity(
    ranked: AgentLoad[],
    reporterEmail: string,
  ): Promise<{ ranked: AgentLoad[]; boosted: boolean }> {
    const days = parseInt(this.settingsQueries.get('assignment_customer_continuity_days') ?? '30', 10);
    const previous = await queryOne<{ assignee_account_id: string; assignee_name: string }>(
      `SELECT TOP 1 assignee_account_id, assignee_name FROM jira_issue_cache
       WHERE reporter_email = ?
         AND status_name IN ('Done', 'Resolved', 'Closed')
         AND resolved_date >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY resolved_date DESC`,
      [reporterEmail, days],
    );

    if (!previous?.assignee_account_id) return { ranked, boosted: false };

    const idx = ranked.findIndex(r => r.agent.jira_account_id === previous.assignee_account_id);
    if (idx <= 0) return { ranked, boosted: idx === 0 };

    // Only boost if the agent isn't at capacity
    const agent = ranked[idx];
    if (agent.capacityRatio >= 0.9) return { ranked, boosted: false };

    const boosted = [agent, ...ranked.filter((_, i) => i !== idx)];
    console.log(`[assignment] Customer continuity: boosting ${previous.assignee_name} for repeat reporter ${reporterEmail}`);
    return { ranked: boosted, boosted: true };
  }

  private isEligible(agent: RosterAgent, buckets: WorkloadBuckets, pool: Pool): boolean {
    const maxTotal = agent.max_capacity || 15;
    if (buckets.total >= maxTotal) return false;

    switch (pool) {
      case 'cc': {
        const maxCC = agent.max_tickets_cc ?? maxTotal;
        const effectiveCc = Math.max(0, buckets.cc);
        return effectiveCc < maxCC;
      }
      case 't2': {
        const maxT2 = agent.max_tickets_t2t3 ?? maxTotal;
        return buckets.t2t3 < maxT2;
      }
      case 'tpj': {
        const maxTPJ = agent.max_tickets_t2t3 ?? maxTotal;
        return buckets.tpj < maxTPJ;
      }
      default:
        return buckets.total < maxTotal;
    }
  }

  private rankByWorkload(
    agents: Array<{ agent: RosterAgent; buckets: WorkloadBuckets }>,
    pool: Pool,
  ): Array<{ agent: RosterAgent; buckets: WorkloadBuckets }> {
    return [...agents].sort((a, b) => {
      if (a.buckets.total !== b.buckets.total) return a.buckets.total - b.buckets.total;
      const aPool = this.getPoolCount(a.buckets, pool);
      const bPool = this.getPoolCount(b.buckets, pool);
      if (aPool !== bPool) return aPool - bPool;
      const aTime = a.agent.last_assigned_at?.getTime() ?? 0;
      const bTime = b.agent.last_assigned_at?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;
      return (a.agent.display_name || '').localeCompare(b.agent.display_name || '');
    });
  }

  private getPoolCount(b: WorkloadBuckets, pool: Pool): number {
    switch (pool) {
      case 'cc': return b.cc;
      case 't2': return b.t2t3;
      case 'tpj': return b.tpj;
      default: return b.total;
    }
  }

  private async findStickyAgent(
    reporterEmail: string,
    tpjAgents: RosterAgent[],
  ): Promise<RosterAgent | null> {
    const atIdx = reporterEmail.lastIndexOf('@');
    if (atIdx < 0) return null;
    const domain = reporterEmail.slice(atIdx + 1).trim().toLowerCase();
    if (!domain || domain === 'nurtur.tech') return null;

    const match = await queryOne<{ assignee_account_id: string }>(
      `SELECT TOP 1 c.assignee_account_id
       FROM jira_issue_cache c
       WHERE c.project_key = 'NTPJ'
         AND c.status_category != 'done'
         AND c.assignee_account_id IS NOT NULL
         AND c.reporter_email LIKE ?
       ORDER BY c.jira_updated DESC, c.jira_created DESC`,
      [`%@${domain}`],
    );

    if (!match?.assignee_account_id) return null;

    const agent = tpjAgents.find(a => a.jira_account_id === match.assignee_account_id);
    if (!agent || !agent.active) return null;

    console.log(`[assignment] TPJ stickiness: domain ${domain} → ${agent.display_name}`);
    return agent;
  }

  private buildReasonFromBuckets(agent: RosterAgent, buckets: WorkloadBuckets, pool: Pool): string {
    const poolCount = this.getPoolCount(buckets, pool);
    const poolCap = pool === 'cc'
      ? (agent.max_tickets_cc ?? agent.max_capacity)
      : (agent.max_tickets_t2t3 ?? agent.max_capacity);
    return `capacity ${buckets.total}/${agent.max_capacity} | pool ${poolCount}/${poolCap}`;
  }

  private rankByCapacity(loads: AgentLoad[]): AgentLoad[] {
    return [...loads].sort((a, b) => {
      if (a.capacityRatio !== b.capacityRatio) return a.capacityRatio - b.capacityRatio;
      const aTime = a.agent.last_assigned_at?.getTime() ?? 0;
      const bTime = b.agent.last_assigned_at?.getTime() ?? 0;
      return aTime - bTime;
    });
  }

  private boostBySkills(ranked: AgentLoad[], skills: string[]): AgentLoad[] {
    const skillSet = new Set(skills.map(s => s.toLowerCase()));
    return [...ranked].sort((a, b) => {
      const aMatch = a.agent.skills?.filter(s => skillSet.has(s.toLowerCase())).length ?? 0;
      const bMatch = b.agent.skills?.filter(s => skillSet.has(s.toLowerCase())).length ?? 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return a.capacityRatio - b.capacityRatio;
    });
  }

  private async recordAssignment(ticketKey: string, pool: Pool, chosen: AgentLoad, project: string = 'NT', assignmentReason: string = 'capacity_best'): Promise<void> {
    // Track in-flight so the next pick in this batch sees this agent as fuller.
    this.noteRecentAssignment(chosen.agent.jira_account_id);
    await executeAndGetId(`
      INSERT INTO agent_assignment_log (ticket_key, pool, assigned_to, reason, open_ticket_count, project_key, assignment_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [ticketKey, pool, chosen.agent.display_name, this.buildReason(chosen), chosen.openCount, project, assignmentReason]);
  }

  /** Count of assignments made to this agent within the recent-TTL window (default 15 min). */
  private getRecentAssignmentCount(accountId: string): number {
    const arr = this.recentAssignments.get(accountId);
    if (!arr || arr.length === 0) return 0;
    const ttlMs = (parseFloat(this.settingsQueries.get('assignment_recent_ttl_mins') || '') || 15) * 60_000;
    const cutoff = Date.now() - ttlMs;
    const fresh = arr.filter(ts => ts >= cutoff);
    if (fresh.length !== arr.length) this.recentAssignments.set(accountId, fresh);
    return fresh.length;
  }

  private noteRecentAssignment(accountId: string): void {
    const arr = this.recentAssignments.get(accountId) ?? [];
    arr.push(Date.now());
    this.recentAssignments.set(accountId, arr);
  }

  private async updateLastAssigned(agentId: number): Promise<void> {
    await execute(
      `MERGE agent_assignment_state AS target
       USING (SELECT ? AS agent_id) AS source ON target.agent_id = source.agent_id
       WHEN MATCHED THEN UPDATE SET last_assigned_at = GETUTCDATE(), updated_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (agent_id, last_assigned_at) VALUES (?, GETUTCDATE());`,
      [agentId, agentId],
    );
  }

  private buildReason(chosen: AgentLoad, skills?: string[]): string {
    const parts: string[] = [];
    parts.push(`capacity ${Math.round(chosen.capacityRatio * 100)}%`);
    parts.push(`${chosen.openCount}/${chosen.agent.max_capacity} tickets`);
    if (skills?.length) {
      const matched = chosen.agent.skills?.filter(s => skills.map(sk => sk.toLowerCase()).includes(s.toLowerCase())) ?? [];
      if (matched.length > 0) parts.push(`skill match: ${matched.join(', ')}`);
    }
    return parts.join(' | ');
  }

  private async getKpiDepartmentMap(accountIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(accountIds.map(id => decodeURIComponent(id || '').trim()).filter(Boolean))];
    if (ids.length === 0) return new Map<string, string>();
    try {
      const p = await this.getKpiPool();
      const req = p.request();
      const placeholders = ids.map((_, idx) => `@acc${idx}`);
      ids.forEach((id, idx) => req.input(`acc${idx}`, sql.NVarChar, id));
      const result = await req.query(`
        SELECT AccountId, Department
        FROM dbo.Agent
        WHERE IsActive = 1 AND AccountId IN (${placeholders.join(', ')})
      `);
      return new Map<string, string>(
        result.recordset.map((row: any) => [decodeURIComponent(row.AccountId ?? ''), (row.Department ?? '').trim()]),
      );
    } catch {
      return new Map<string, string>();
    }
  }

  private isAgentEligibleForProject(agent: RosterAgent, project: string): boolean {
    const dept = (agent.department || '').trim().toUpperCase();
    if (project === 'NTPJ') {
      return dept === 'NTPJ';
    }
    if (project === 'NT') {
      return dept !== 'NTPJ';
    }
    return true;
  }

  private mapAgentRow(
    row: any,
    stateMap: Map<number, { is_current_agent: number; last_assigned_at: string | null }>,
  ): RosterAgent {
    const state = stateMap.get(row.AgentId);
    const name = [row.AgentName?.trim(), row.AgentSurname?.trim()].filter(Boolean).join(' ');
    return {
      id: row.AgentId,
      jira_account_id: decodeURIComponent(row.AccountId ?? ''),
      display_name: name || `Agent ${row.AgentId}`,
      email: row.AgentKey?.trim() || null,
      pool: normalizePool(row.Team),
      department: row.Department?.trim() || null,
      skills: null,
      max_capacity: row.MaxTickets ?? 10,
      max_tickets_cc: row.MaxTicketsCustomerCare ?? null,
      max_tickets_t2t3: row.MaxTicketsT2T3 ?? null,
      active: !!row.IsActive,
      is_current_agent: !!(state?.is_current_agent),
      last_assigned_at: state?.last_assigned_at ? new Date(state.last_assigned_at) : null,
    };
  }

  private buildWorkingDayClock(): WorkingDayClock {
    const bankHolidays = this.loadBankHolidays();
    this.bankHolidaysHash = bankHolidays.join(',');
    // Align assignment hours with the agent loop / team working hours (agent_working_hours,
    // default 08:00-18:00). Previously hardcoded to 09:00-17:00, which left round-robin dark
    // before 09:00 and after 17:00 even while the loop was active — so the morning restart
    // catch-up could triage tickets but not assign them until 09:00.
    const { start, end } = this.parseWorkingHours();
    return createWorkingDayClock(
      { start, end, timezone: 'Europe/London', daysOfWeek: this.parseWorkingDays() },
      bankHolidays,
    );
  }

  /** Parse agent_working_hours ("HH:MM-HH:MM") into integer start/end hours. Defaults to 08-18. */
  private parseWorkingHours(): { start: number; end: number } {
    const raw = (this.settingsQueries.get('agent_working_hours') || '08:00-18:00').trim();
    const m = raw.match(/^(\d{1,2}):\d{2}-(\d{1,2}):\d{2}$/);
    if (!m) return { start: 8, end: 18 };
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    if (isNaN(start) || isNaN(end) || start >= end) return { start: 8, end: 18 };
    return { start, end };
  }

  /** Parse agent_working_days ("1,2,3,4,5", 0=Sun) into a day array. Defaults to Mon-Fri. */
  private parseWorkingDays(): number[] {
    const raw = (this.settingsQueries.get('agent_working_days') || '').trim();
    if (!raw) return [1, 2, 3, 4, 5];
    const days = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0 && n <= 6);
    return days.length ? days : [1, 2, 3, 4, 5];
  }

  private loadBankHolidays(): string[] {
    const raw = this.settingsQueries.get('agent_bank_holidays') || '[]';
    try { return JSON.parse(raw); } catch { return []; }
  }

  private refreshClockIfNeeded(): void {
    const current = (this.settingsQueries.get('agent_bank_holidays') || '[]');
    let holidays: string[];
    try { holidays = JSON.parse(current); } catch { holidays = []; }
    const hash = holidays.join(',');
    if (hash !== this.bankHolidaysHash) {
      this.workingDayClock = this.buildWorkingDayClock();
      console.log(`[assignment] Bank holidays updated — rebuilt working day clock`);
    }
  }

  private getProjectPoolConfig(project: string): ProjectPoolConfig | null {
    const raw = this.settingsQueries.get('agent_assignment_project_pools');
    if (!raw) return null;
    try {
      const config = JSON.parse(raw) as Record<string, ProjectPoolConfig>;
      return config[project] ?? null;
    } catch { return null; }
  }

  private validatePoolForProject(pool: Pool, project: string): Pool {
    if (project === 'NTPJ') {
      const allowedNtpjPools = new Set<Pool>(['cc', 't2', 'tpj']);
      if (!allowedNtpjPools.has(pool)) {
        console.warn(`[assignment] Pool ${pool} not allowed for ${project}, using default cc`);
        return 'cc';
      }
      return pool;
    }

    const config = this.getProjectPoolConfig(project);
    if (!config) return pool;
    if (!config.allowedPools.includes(pool)) {
      // Never coerce across tiers (that would put e.g. a T2 ticket on a CC agent).
      // Keep the routed pool; if it has no agents the caller queues for retry.
      console.warn(`[assignment] Pool ${pool} not in allowedPools for ${project}; keeping pool (no cross-tier coercion)`);
      return pool;
    }
    return pool;
  }

  async seedPoolCapsFromKpi(): Promise<number> {
    try {
      const p = await this.getKpiPool();
      const result = await p.request().query(`
        SELECT AccountId, MaxTicketsCustomerCare, MaxTicketsT2T3
        FROM dbo.Agent
        WHERE IsActive = 1 AND AccountId IS NOT NULL
      `);

      let updated = 0;
      for (const row of result.recordset) {
        const { AccountId, MaxTicketsCustomerCare, MaxTicketsT2T3 } = row;
        if (MaxTicketsCustomerCare == null && MaxTicketsT2T3 == null) continue;
        const res = await execute(
          `UPDATE agent_roster SET max_tickets_cc = ?, max_tickets_t2t3 = ?, updated_at = GETUTCDATE()
           WHERE jira_account_id = ? AND (max_tickets_cc IS NULL OR max_tickets_t2t3 IS NULL)`,
          [MaxTicketsCustomerCare ?? null, MaxTicketsT2T3 ?? null, AccountId],
        );
        if (res.rowsAffected > 0) updated++;
      }

      if (updated > 0) {
        console.log(`[assignment] Seeded per-pool caps from KPI for ${updated} agents`);
      }
      return updated;
    } catch (err) {
      console.warn('[assignment] Failed to seed pool caps from KPI:', err instanceof Error ? err.message : err);
      return 0;
    }
  }
}
