import sql from 'mssql';
import { query, queryOne, execute, executeAndGetId } from './database.js';
import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { createWorkingDayClock, type WorkingDayClock } from '../../shared/utils/workingDayClock.js';

export type Pool = 'cc' | 't2' | 'tpj' | 'digital';

export interface RosterAgent {
  id: number;
  jira_account_id: string;
  display_name: string;
  email: string | null;
  pool: Pool;
  skills: string[] | null;
  max_capacity: number;
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
  tpj: 'tpj',
  digital: 'digital',
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

  constructor(
    private jiraClient: JiraRestClient,
    private settingsQueries: SettingsQueries,
    private jiraProject: string = 'NT',
  ) {
    this.workingDayClock = this.buildWorkingDayClock();
  }

  private async getKpiPool(): Promise<sql.ConnectionPool> {
    if (this.kpiPool?.connected) return this.kpiPool;
    const all = this.settingsQueries.getAll();
    const server = all.kpi_sql_server;
    const database = all.kpi_sql_database;
    const user = all.kpi_sql_user;
    const password = all.kpi_sql_password;
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

  async assign(ticketKey: string, pool: Pool = 'cc', preferredSkills?: string[], projectKey?: string): Promise<AssignmentResult | null> {
    this.refreshClockIfNeeded();
    if (!this.workingDayClock.isWorkingTime(new Date())) {
      console.log(`[assignment] Outside working hours — skipping assignment for ${ticketKey}`);
      return null;
    }

    const project = projectKey || this.resolveProjectFromTicketKey(ticketKey);
    pool = this.validatePoolForProject(pool, project);

    const available = await this.getAvailableAgents(pool);
    if (available.length === 0) return null;

    const loads = await this.getAgentLoads(available);
    let ranked = this.rankByCapacity(loads);

    if (preferredSkills?.length) {
      ranked = this.boostBySkills(ranked, preferredSkills);
    }

    const chosen = ranked[0];
    if (!chosen) return null;

    await this.recordAssignment(ticketKey, pool, chosen, project);
    await this.updateLastAssigned(chosen.agent.id);

    return {
      agent: chosen.agent,
      reason: this.buildReason(chosen, preferredSkills),
      openTicketCount: chosen.openCount,
    };
  }

  async assignToJira(ticketKey: string, pool: Pool = 'cc', preferredSkills?: string[], projectKey?: string): Promise<AssignmentResult | null> {
    const result = await this.assign(ticketKey, pool, preferredSkills, projectKey);
    if (!result) return null;

    await this.jiraClient.updateFields(ticketKey, {
      assignee: { accountId: result.agent.jira_account_id },
    });

    return result;
  }

  async assignWithFallback(ticketKey: string, pool: Pool, project: string, preferredSkills?: string[]): Promise<AssignmentResult | null> {
    let result = await this.assignToJira(ticketKey, pool, preferredSkills, project);
    if (result) return result;

    if (pool !== 'cc') {
      console.log(`[assignment] No agents in ${pool} for ${project}, falling back to cc`);
      result = await this.assignToJira(ticketKey, 'cc', preferredSkills, project);
      if (result) return result;
    }

    if (pool !== 't2') {
      console.log(`[assignment] No agents in cc for ${project}, falling back to t2`);
      result = await this.assignToJira(ticketKey, 't2', preferredSkills, project);
      if (result) return result;
    }

    return null;
  }

  async postAssignmentComment(ticketKey: string, assignment: AssignmentResult): Promise<void> {
    const comment = `[NOVA Round Robin] Auto-assigned to ${assignment.agent.display_name}\n` +
      `Pool: ${assignment.agent.pool.toUpperCase()} | ${assignment.reason}`;
    try {
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
    const raw = this.settingsQueries.get('agent_jira_project') || 'NT';
    return raw.split(',').map(p => p.trim()).filter(Boolean);
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

    return active.filter(a => !unavailableIds.has(a.id));
  }

  async getAllAgents(pool?: Pool): Promise<RosterAgent[]> {
    const p = await this.getKpiPool();
    const result = await p.request().query(`
      SELECT AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team,
             IsActive, ISNULL(MaxTickets, 10) AS MaxTickets
      FROM dbo.Agent
      WHERE Department = 'NT'
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
    const p = await this.getKpiPool();
    const req = p.request();
    req.input('agentId', sql.Int, id);
    const result = await req.query(`
      SELECT AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team,
             IsActive, ISNULL(MaxTickets, 10) AS MaxTickets
      FROM dbo.Agent
      WHERE AgentId = @agentId
    `);
    const row = result.recordset[0];
    if (!row) return undefined;

    const stateRow = await queryOne<{
      agent_id: number; is_current_agent: number; last_assigned_at: string | null;
    }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state WHERE agent_id = ?`, [id]);

    const stateMap = new Map<number, any>();
    if (stateRow) stateMap.set(stateRow.agent_id, stateRow);
    return this.mapAgentRow(row, stateMap);
  }

  async getAgentByJiraId(jiraAccountId: string): Promise<RosterAgent | undefined> {
    const p = await this.getKpiPool();
    const req = p.request();
    req.input('accountId', sql.NVarChar, jiraAccountId);
    const result = await req.query(`
      SELECT AgentId, AccountId, AgentName, AgentSurname, AgentKey, Team,
             IsActive, ISNULL(MaxTickets, 10) AS MaxTickets
      FROM dbo.Agent
      WHERE AccountId = @accountId
    `);
    const row = result.recordset[0];
    if (!row) return undefined;

    const stateRow = await queryOne<{
      agent_id: number; is_current_agent: number; last_assigned_at: string | null;
    }>(`SELECT agent_id, is_current_agent, last_assigned_at FROM agent_assignment_state WHERE agent_id = ?`, [row.AgentId]);

    const stateMap = new Map<number, any>();
    if (stateRow) stateMap.set(stateRow.agent_id, stateRow);
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
       WHEN NOT MATCHED THEN INSERT (agent_id, is_current_agent) VALUES (?, 1)`,
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

  private async getAgentLoads(agents: RosterAgent[]): Promise<AgentLoad[]> {
    const loads: AgentLoad[] = [];
    const projects = this.getConfiguredProjects();
    const projectJql = projects.length === 1 ? `project = ${projects[0]}` : `project IN (${projects.join(', ')})`;

    for (const agent of agents) {
      let openCount = 0;
      try {
        const jql = `${projectJql} AND assignee = "${agent.jira_account_id}" AND resolution = EMPTY`;
        openCount = await this.jiraClient.jqlCount(jql);
        if (openCount < 0) openCount = 0;
      } catch {
        openCount = 0;
      }

      loads.push({
        agent,
        openCount,
        capacityRatio: agent.max_capacity > 0 ? openCount / agent.max_capacity : 1,
      });
    }

    return loads;
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

  private async recordAssignment(ticketKey: string, pool: Pool, chosen: AgentLoad, project: string = 'NT'): Promise<void> {
    await executeAndGetId(`
      INSERT INTO agent_assignment_log (ticket_key, pool, assigned_to, reason, open_ticket_count, project_key)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [ticketKey, pool, chosen.agent.display_name, this.buildReason(chosen), chosen.openCount, project]);
  }

  private async updateLastAssigned(agentId: number): Promise<void> {
    await execute(
      `MERGE agent_assignment_state AS target
       USING (SELECT ? AS agent_id) AS source ON target.agent_id = source.agent_id
       WHEN MATCHED THEN UPDATE SET last_assigned_at = GETUTCDATE(), updated_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (agent_id, last_assigned_at) VALUES (?, GETUTCDATE())`,
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

  private mapAgentRow(
    row: any,
    stateMap: Map<number, { is_current_agent: number; last_assigned_at: string | null }>,
  ): RosterAgent {
    const state = stateMap.get(row.AgentId);
    const name = [row.AgentName?.trim(), row.AgentSurname?.trim()].filter(Boolean).join(' ');
    return {
      id: row.AgentId,
      jira_account_id: row.AccountId ?? '',
      display_name: name || `Agent ${row.AgentId}`,
      email: row.AgentKey?.trim() || null,
      pool: normalizePool(row.Team),
      skills: null,
      max_capacity: row.MaxTickets ?? 10,
      active: !!row.IsActive,
      is_current_agent: !!(state?.is_current_agent),
      last_assigned_at: state?.last_assigned_at ? new Date(state.last_assigned_at) : null,
    };
  }

  private buildWorkingDayClock(): WorkingDayClock {
    const bankHolidays = this.loadBankHolidays();
    this.bankHolidaysHash = bankHolidays.join(',');
    return createWorkingDayClock(
      { start: 9, end: 17, timezone: 'Europe/London', daysOfWeek: [1, 2, 3, 4, 5] },
      bankHolidays,
    );
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
    const config = this.getProjectPoolConfig(project);
    if (!config) return pool;
    if (!config.allowedPools.includes(pool)) {
      console.warn(`[assignment] Pool ${pool} not allowed for ${project}, using default ${config.defaultPool}`);
      return config.defaultPool;
    }
    return pool;
  }
}
