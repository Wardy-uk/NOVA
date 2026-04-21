import { query, queryOne, execute, executeAndGetId } from './database.js';
import type { JiraRestClient } from './jira-client.js';

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

export class AssignmentEngine {
  constructor(private jiraClient: JiraRestClient, private jiraProject: string = 'NT') {}

  async assign(ticketKey: string, pool: Pool = 'cc', preferredSkills?: string[]): Promise<AssignmentResult | null> {
    const available = await this.getAvailableAgents(pool);
    if (available.length === 0) return null;

    const loads = await this.getAgentLoads(available);

    let ranked = this.rankByCapacity(loads);

    if (preferredSkills?.length) {
      ranked = this.boostBySkills(ranked, preferredSkills);
    }

    const chosen = ranked[0];
    if (!chosen) return null;

    await this.recordAssignment(ticketKey, pool, chosen);
    await this.updateLastAssigned(chosen.agent.id);

    return {
      agent: chosen.agent,
      reason: this.buildReason(chosen, preferredSkills),
      openTicketCount: chosen.openCount,
    };
  }

  async assignToJira(ticketKey: string, pool: Pool = 'cc', preferredSkills?: string[]): Promise<AssignmentResult | null> {
    const result = await this.assign(ticketKey, pool, preferredSkills);
    if (!result) return null;

    await this.jiraClient.updateFields(ticketKey, {
      assignee: { accountId: result.agent.jira_account_id },
    });

    return result;
  }

  async getAvailableAgents(pool: Pool): Promise<RosterAgent[]> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await query<any>(`
      SELECT r.*
      FROM agent_roster r
      LEFT JOIN agent_availability a ON a.roster_id = r.id AND a.available_date = ?
      WHERE r.pool = ? AND r.active = 1
        AND (a.id IS NULL OR a.status = 'available')
      ORDER BY r.display_name
    `, [today, pool]);

    return rows.map(this.mapRosterRow);
  }

  async getAllAgents(pool?: Pool): Promise<RosterAgent[]> {
    const sql = pool
      ? `SELECT * FROM agent_roster WHERE pool = ? ORDER BY active DESC, display_name`
      : `SELECT * FROM agent_roster ORDER BY pool, active DESC, display_name`;
    const rows = await query<any>(sql, pool ? [pool] : []);
    return rows.map(this.mapRosterRow);
  }

  async getAgent(id: number): Promise<RosterAgent | undefined> {
    const row = await queryOne<any>(`SELECT * FROM agent_roster WHERE id = ?`, [id]);
    return row ? this.mapRosterRow(row) : undefined;
  }

  async getAgentByJiraId(jiraAccountId: string): Promise<RosterAgent | undefined> {
    const row = await queryOne<any>(`SELECT * FROM agent_roster WHERE jira_account_id = ?`, [jiraAccountId]);
    return row ? this.mapRosterRow(row) : undefined;
  }

  async createAgent(data: Omit<RosterAgent, 'id' | 'last_assigned_at'>): Promise<number> {
    return executeAndGetId(`
      INSERT INTO agent_roster (jira_account_id, display_name, email, pool, skills, max_capacity, active, is_current_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.jira_account_id, data.display_name, data.email, data.pool,
      data.skills ? JSON.stringify(data.skills) : null,
      data.max_capacity, data.active ? 1 : 0, data.is_current_agent ? 1 : 0,
    ]);
  }

  async updateAgent(id: number, updates: Partial<RosterAgent>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.display_name !== undefined) { sets.push('display_name = ?'); params.push(updates.display_name); }
    if (updates.email !== undefined) { sets.push('email = ?'); params.push(updates.email); }
    if (updates.pool !== undefined) { sets.push('pool = ?'); params.push(updates.pool); }
    if (updates.skills !== undefined) { sets.push('skills = ?'); params.push(updates.skills ? JSON.stringify(updates.skills) : null); }
    if (updates.max_capacity !== undefined) { sets.push('max_capacity = ?'); params.push(updates.max_capacity); }
    if (updates.active !== undefined) { sets.push('active = ?'); params.push(updates.active ? 1 : 0); }
    if (updates.is_current_agent !== undefined) { sets.push('is_current_agent = ?'); params.push(updates.is_current_agent ? 1 : 0); }

    if (sets.length === 0) return;
    sets.push('updated_at = GETUTCDATE()');
    params.push(id);

    await execute(`UPDATE agent_roster SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteAgent(id: number): Promise<void> {
    await execute(`DELETE FROM agent_roster WHERE id = ?`, [id]);
  }

  async rotateCurrentAgent(pool: Pool = 'cc'): Promise<RosterAgent | null> {
    const agents = await this.getAvailableAgents(pool);
    if (agents.length === 0) return null;

    const currentIdx = agents.findIndex(a => a.is_current_agent);
    const nextIdx = (currentIdx + 1) % agents.length;
    const next = agents[nextIdx];

    await execute(`UPDATE agent_roster SET is_current_agent = 0 WHERE pool = ?`, [pool]);
    await execute(`UPDATE agent_roster SET is_current_agent = 1 WHERE id = ?`, [next.id]);

    return next;
  }

  async getCurrentAgent(pool: Pool = 'cc'): Promise<RosterAgent | null> {
    const row = await queryOne<any>(
      `SELECT * FROM agent_roster WHERE pool = ? AND is_current_agent = 1 AND active = 1`,
      [pool],
    );
    return row ? this.mapRosterRow(row) : null;
  }

  async getAssignmentLog(limit: number = 50): Promise<any[]> {
    return query(`SELECT * FROM agent_assignment_log ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`, [limit]);
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

    for (const agent of agents) {
      let openCount = 0;
      try {
        const jql = `project = ${this.jiraProject} AND assignee = "${agent.jira_account_id}" AND resolution = EMPTY`;
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

  private async recordAssignment(ticketKey: string, pool: Pool, chosen: AgentLoad): Promise<void> {
    await executeAndGetId(`
      INSERT INTO agent_assignment_log (ticket_key, pool, assigned_to, reason, open_ticket_count)
      VALUES (?, ?, ?, ?, ?)
    `, [ticketKey, pool, chosen.agent.display_name, this.buildReason(chosen), chosen.openCount]);
  }

  private async updateLastAssigned(agentId: number): Promise<void> {
    await execute(`UPDATE agent_roster SET last_assigned_at = GETUTCDATE(), updated_at = GETUTCDATE() WHERE id = ?`, [agentId]);
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

  private mapRosterRow(row: any): RosterAgent {
    return {
      id: row.id,
      jira_account_id: row.jira_account_id,
      display_name: row.display_name,
      email: row.email,
      pool: row.pool as Pool,
      skills: row.skills ? JSON.parse(row.skills) : null,
      max_capacity: row.max_capacity,
      active: !!row.active,
      is_current_agent: !!row.is_current_agent,
      last_assigned_at: row.last_assigned_at ? new Date(row.last_assigned_at) : null,
    };
  }
}
