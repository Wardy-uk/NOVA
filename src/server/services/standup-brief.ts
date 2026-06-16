/**
 * Pre-standup Jira brief — the per-agent ticket list shown above the submissions
 * on the manager dashboard, and used to enrich the morning prompt emails.
 *
 * JQL (fixed): open NT tickets in the three active tiers, grouped by assignee.
 *   project = NT AND "Current Tier" in ("Customer Care","Tier 2","Production")
 *   AND statusCategory != Done ORDER BY assignee ASC, created ASC
 *
 * Current Tier = customfield_12981 (see jira_issue_cache.current_tier elsewhere).
 */
import type { JiraRestClient } from './jira-client.js';

export const STANDUP_BRIEF_JQL =
  'project = NT AND "Current Tier" in ("Customer Care","Tier 2","Production") ' +
  'AND statusCategory != Done ORDER BY assignee ASC, created ASC';

export type BriefCategory = 'cc' | 'tier2' | 'production' | 'design' | 'other';

export interface BriefTicket {
  key: string;
  summary: string;
  assignee: string;
  tier: string;
  category: BriefCategory;
  status: string;
  created: string | null;
  ageDays: number | null;
  over5: boolean;
}

export interface BriefAgent {
  agent_name: string;
  tickets: BriefTicket[];
  total: number;
  over5_count: number;
  oldest: { key: string; ageDays: number } | null;
}

export interface StandupBrief {
  generated_at: string;
  jql: string;
  total_tickets: number;
  agents: BriefAgent[];
}

function ageInDays(created: string | null): number | null {
  if (!created) return null;
  const ms = Date.now() - new Date(created).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function categorise(tier: string, labels: string[], components: string[]): BriefCategory {
  const lower = tier.toLowerCase();
  // "Design" isn't a tier — it's flagged via a label/component on a tiered ticket.
  if ([...labels, ...components].some((x) => /design/i.test(x))) return 'design';
  if (lower.includes('customer care')) return 'cc';
  if (lower.includes('tier 2')) return 'tier2';
  if (lower.includes('production')) return 'production';
  return 'other';
}

/** Build the brief by querying Jira live. Throws if no client is available. */
export async function buildStandupBrief(client: JiraRestClient): Promise<StandupBrief> {
  const result = await client.searchJqlAll(
    STANDUP_BRIEF_JQL,
    ['summary', 'status', 'created', 'assignee', 'customfield_12981', 'labels', 'components'],
    500,
  );

  const byAgent = new Map<string, BriefTicket[]>();
  for (const issue of result.issues) {
    const f = issue.fields as Record<string, any>;
    const assignee = f.assignee?.displayName?.trim() || 'Unassigned';
    const tier = (f.customfield_12981?.value ?? f.customfield_12981 ?? '').toString();
    const labels: string[] = Array.isArray(f.labels) ? f.labels : [];
    const components: string[] = Array.isArray(f.components) ? f.components.map((c: any) => c?.name ?? '') : [];
    const created = f.created ?? null;
    const ageDays = ageInDays(created);
    const ticket: BriefTicket = {
      key: issue.key,
      summary: (f.summary ?? '').toString(),
      assignee,
      tier,
      category: categorise(tier, labels, components),
      status: f.status?.name ?? '',
      created,
      ageDays,
      over5: ageDays != null && ageDays > 5,
    };
    const list = byAgent.get(assignee) ?? [];
    list.push(ticket);
    byAgent.set(assignee, list);
  }

  const agents: BriefAgent[] = [...byAgent.entries()]
    .map(([agent_name, tickets]) => {
      const withAge = tickets.filter((t) => t.ageDays != null);
      const oldest = withAge.length
        ? withAge.reduce((a, b) => (b.ageDays! > a.ageDays! ? b : a))
        : null;
      return {
        agent_name,
        tickets,
        total: tickets.length,
        over5_count: tickets.filter((t) => t.over5).length,
        oldest: oldest ? { key: oldest.key, ageDays: oldest.ageDays! } : null,
      };
    })
    .sort((a, b) => a.agent_name.localeCompare(b.agent_name));

  return {
    generated_at: new Date().toISOString(),
    jql: STANDUP_BRIEF_JQL,
    total_tickets: result.issues.length,
    agents,
  };
}

/** Look up one agent's brief summary by display name (best-effort name match). */
export function findAgentBrief(brief: StandupBrief | null, agentName: string): BriefAgent | null {
  if (!brief) return null;
  const target = agentName.trim().toLowerCase();
  return (
    brief.agents.find((a) => a.agent_name.trim().toLowerCase() === target) ??
    brief.agents.find((a) => a.agent_name.trim().toLowerCase().includes(target)) ??
    null
  );
}
