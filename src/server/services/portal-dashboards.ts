import { queryOne } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import type {
  OnboardingDashboardResponse,
  OnboardingDashboardRow,
  SupportDashboardResponse,
  SupportDashboardRow,
  PortalOrgFeatures,
} from '../../shared/portal-types.js';

// Customer-facing Onboarding + Support dashboards.
//
// Data comes LIVE from Jira (not the NT-only jira_issue_cache) so it spans every
// project the customer has tickets in. Each org is scoped by BC Account Number
// (Jira customfield_14626) OR a set of reporter identities — mirroring the source
// JQL, correctly bracketed so the open-status filter applies to both branches.

const MS_PER_DAY = 86_400_000;

// Jira custom fields (discovered from the live instance)
const CF_REQUEST_TYPE = 'customfield_13482';
const CF_TIER = 'customfield_12981';
const CF_BC_ACCOUNT = 'customfield_14626';
const CF_SPRINT = 'customfield_10007';
const CF_RESOLUTION_SLA = 'customfield_12805'; // "Time to resolution"

const JIRA_FIELDS = [
  'summary', 'status', 'assignee', 'reporter', 'created', 'updated',
  'priority', 'issuetype', 'project', 'labels',
  CF_REQUEST_TYPE, CF_TIER, CF_BC_ACCOUNT, CF_SPRINT, CF_RESOLUTION_SLA,
];

const DEFAULT_EXCLUDE_STATUSES = ['Closed', 'Done', 'Released', 'Resolved', 'Promoted', 'Declined', 'Cancelled'];
const DEFAULT_ONBOARDING_TOKENS = ['onboard', 'delivery'];
const DEFAULT_TPJ_PROJECTS = ['tpj', 'ntpj'];
const DEFAULT_DEV_STATUSES = [
  'waiting on development', 'in development', 'development', 'backlog',
  'selected for development', 'ready for development', 'to do', 'awaiting sprint',
];

const CACHE_TTL_MS = 30_000;

function parseList(raw: string | undefined | null, fallback: string[]): string[] {
  if (!raw) return fallback;
  const items = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function parseReporters(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const token = part.trim().replace(/^["']|["']$/g, '');
    if (token) out.push(token);
  }
  return out;
}

function wholeDaysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / MS_PER_DAY));
}

function cfValue(v: any): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(cfValue).filter(Boolean).join(', ') || null;
  return v.value ?? v.name ?? null;
}

interface OrgScope {
  bcAccount: string | null;
  reporters: string[];
}

interface NormalisedIssue {
  key: string;
  summary: string;
  status: string;
  owner: string | null;
  created: string;
  updated: string;
  priority: string;
  issuetype: string;
  project: string;
  labels: string;
  requestType: string;
  tier: string | null;
  hasSprint: boolean;
  slaBreached: boolean;
}

export class PortalDashboardService {
  private cache = new Map<number, { at: number; issues: NormalisedIssue[] }>();

  constructor(private settings: FileSettingsQueries | undefined, private jira: JiraRestClient | null) {}

  private setting(key: string): string | undefined {
    return this.settings?.get(key) as string | undefined;
  }

  // Per-org feature toggles. If the org has no row (e.g. internal admin, orgId 0)
  // everything is visible so we never hide features from staff.
  async getOrgFeatures(orgId: number): Promise<PortalOrgFeatures> {
    const row = await queryOne<{ feat_get_help: number; feat_kb: number; feat_support: number; feat_onboarding: number }>(
      `SELECT feat_get_help, feat_kb, feat_support, feat_onboarding FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    if (!row) return { getHelp: true, kb: true, support: true, onboarding: true };
    return {
      getHelp: !!row.feat_get_help,
      kb: !!row.feat_kb,
      support: !!row.feat_support,
      onboarding: !!row.feat_onboarding,
    };
  }

  async getOrgScope(orgId: number): Promise<OrgScope> {
    const row = await queryOne<{ bc_account_number: string | null; scope_reporters: string | null }>(
      `SELECT bc_account_number, scope_reporters FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    const bc = row?.bc_account_number?.trim();
    return { bcAccount: bc || null, reporters: parseReporters(row?.scope_reporters) };
  }

  private buildJql(scope: OrgScope): string | null {
    const branches: string[] = [];
    if (scope.reporters.length) {
      // Account ids / qm: ids are safe unquoted (Jira accepts ':' and '-').
      // Anything with a reserved char (e.g. '@' in an email) must be quoted.
      const list = scope.reporters
        .map(r => (/[@\s(),]/.test(r) ? JSON.stringify(r) : r))
        .join(', ');
      branches.push(`reporter in (${list})`);
    }
    if (scope.bcAccount) {
      branches.push(`cf[14626] ~ ${JSON.stringify(scope.bcAccount)}`);
    }
    if (!branches.length) return null;

    const exclude = parseList(this.setting('portal_open_exclude_statuses'), DEFAULT_EXCLUDE_STATUSES);
    const statusList = exclude.map(s => JSON.stringify(s)).join(', ');
    // Bracketed so the status filter applies to BOTH the reporter and BC branches.
    return `status NOT IN (${statusList}) AND (${branches.join(' OR ')}) ORDER BY created ASC`;
  }

  private async getOpenIssues(orgId: number, scope: OrgScope): Promise<NormalisedIssue[]> {
    const cached = this.cache.get(orgId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.issues;

    const jql = this.buildJql(scope);
    if (!jql || !this.jira) return [];

    const result = await this.jira.searchJqlAll(jql, JIRA_FIELDS, 500);
    const issues: NormalisedIssue[] = (result.issues || []).map((iss: any) => {
      const f = iss.fields ?? {};
      const sla = f[CF_RESOLUTION_SLA];
      const slaBreached = !!(sla?.ongoingCycle?.breached
        || (Array.isArray(sla?.completedCycles) && sla.completedCycles.some((c: any) => c?.breached)));
      const sprint = f[CF_SPRINT];
      return {
        key: iss.key,
        summary: f.summary || '',
        status: f.status?.name || 'Unknown',
        owner: f.assignee?.displayName || null,
        created: f.created || '',
        updated: f.updated || f.created || '',
        priority: f.priority?.name || 'Medium',
        issuetype: f.issuetype?.name || '',
        project: f.project?.key || '',
        labels: Array.isArray(f.labels) ? f.labels.join(' ') : '',
        requestType: cfValue(f[CF_REQUEST_TYPE]) || '',
        tier: cfValue(f[CF_TIER]),
        hasSprint: Array.isArray(sprint) ? sprint.length > 0 : !!sprint,
        slaBreached,
      };
    });

    this.cache.set(orgId, { at: Date.now(), issues });
    return issues;
  }

  private isOnboarding(iss: NormalisedIssue, tokens: string[]): boolean {
    const rt = iss.requestType.toLowerCase();
    const it = iss.issuetype.toLowerCase();
    return tokens.some(t => rt.includes(t) || it.includes(t));
  }

  // ── Onboarding ──

  async getOnboardingDashboard(orgId: number): Promise<OnboardingDashboardResponse> {
    const scope = await this.getOrgScope(orgId);
    if (!scope.bcAccount && !scope.reporters.length) {
      return { summary: emptyOnboardingSummary(), rows: [], bcAccountNumber: null };
    }
    const tokens = parseList(this.setting('portal_onboarding_request_types'), DEFAULT_ONBOARDING_TOKENS)
      .map(t => t.toLowerCase());

    const issues = await this.getOpenIssues(orgId, scope);
    const rows: OnboardingDashboardRow[] = issues
      .filter(i => this.isOnboarding(i, tokens))
      .map(i => {
        const ageDays = wholeDaysSince(i.created);
        return {
          key: i.key,
          summary: i.summary,
          stage: i.status,
          owner: i.owner,
          created: i.created,
          ageDays,
          ageBucket: onboardingBucket(ageDays),
        };
      });

    const summary = {
      total: rows.length,
      over7: rows.filter(r => r.ageDays > 7).length,
      over14: rows.filter(r => r.ageDays > 14).length,
      over21: rows.filter(r => r.ageDays > 21).length,
      breach: rows.filter(r => r.ageDays > 30).length,
    };
    return { summary, rows, bcAccountNumber: scope.bcAccount };
  }

  // ── Support ──

  private resolveType(iss: NormalisedIssue, tpjProjects: string[]): string {
    if (tpjProjects.includes(iss.project.toLowerCase())) return 'TPJ';
    if (`${iss.labels} ${iss.summary}`.toLowerCase().includes('starberry')) return 'Starberry';
    if (iss.tier) return iss.tier;
    return iss.issuetype || 'Other';
  }

  private sprintState(iss: NormalisedIssue, devStatuses: string[]): 'allocated' | 'awaiting' | 'na' {
    if (iss.hasSprint) return 'allocated';
    return devStatuses.includes(iss.status.toLowerCase()) ? 'awaiting' : 'na';
  }

  async getSupportDashboard(orgId: number): Promise<SupportDashboardResponse> {
    const scope = await this.getOrgScope(orgId);
    if (!scope.bcAccount && !scope.reporters.length) {
      return { summary: emptySupportSummary(), rows: [], bcAccountNumber: null };
    }
    const onboardingTokens = parseList(this.setting('portal_onboarding_request_types'), DEFAULT_ONBOARDING_TOKENS)
      .map(t => t.toLowerCase());
    const tpjProjects = parseList(this.setting('portal_tpj_project_keys'), DEFAULT_TPJ_PROJECTS)
      .map(t => t.toLowerCase());
    const devStatuses = parseList(this.setting('portal_dev_statuses'), DEFAULT_DEV_STATUSES)
      .map(t => t.toLowerCase());

    const issues = await this.getOpenIssues(orgId, scope);
    const rows: SupportDashboardRow[] = issues
      .filter(i => !this.isOnboarding(i, onboardingTokens))
      .map(i => {
        const daysSinceUpdate = wholeDaysSince(i.updated);
        return {
          key: i.key,
          summary: i.summary,
          owner: i.owner,
          type: this.resolveType(i, tpjProjects),
          status: i.status,
          created: i.created,
          ageDays: wholeDaysSince(i.created),
          daysSinceUpdate,
          stale: daysSinceUpdate >= 3,
          overSla: i.slaBreached,
          businessCritical: i.priority.toLowerCase() === 'blocker',
          priority: i.priority,
          sprintState: this.sprintState(i, devStatuses),
        };
      });

    const summary = {
      total: rows.length,
      stale: rows.filter(r => r.stale).length,
      overSla: rows.filter(r => r.overSla).length,
      businessCritical: rows.filter(r => r.businessCritical).length,
      awaitingSprint: rows.filter(r => r.sprintState === 'awaiting').length,
      allocatedSprint: rows.filter(r => r.sprintState === 'allocated').length,
    };
    return { summary, rows, bcAccountNumber: scope.bcAccount };
  }
}

function onboardingBucket(ageDays: number): OnboardingDashboardRow['ageBucket'] {
  if (ageDays > 30) return 'breach';
  if (ageDays > 21) return 'over21';
  if (ageDays > 14) return 'over14';
  if (ageDays > 7) return 'over7';
  return 'ok';
}

function emptyOnboardingSummary() {
  return { total: 0, over7: 0, over14: 0, over21: 0, breach: 0 };
}

function emptySupportSummary() {
  return { total: 0, stale: 0, overSla: 0, businessCritical: 0, awaitingSprint: 0, allocatedSprint: 0 };
}
