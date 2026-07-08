import { query, queryOne } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type {
  OnboardingDashboardResponse,
  OnboardingDashboardRow,
  SupportDashboardResponse,
  SupportDashboardRow,
} from '../../shared/portal-types.js';

// Customer-facing Onboarding + Support dashboards.
// Scoped per-customer by BC Account Number (Jira customfield_14626), read from
// portal_organisations.bc_account_number. All data comes from jira_issue_cache
// (populated by the Jira sync). Stage/owner/age come straight from Jira per v1.

interface OpenIssueRow {
  issue_key: string;
  summary: string | null;
  status_name: string | null;
  status_category: string | null;
  priority_name: string | null;
  issuetype_name: string | null;
  current_tier: string | null;
  request_type: string | null;
  project_key: string | null;
  labels: string | null;
  assignee_display: string | null;
  jira_created: string | null;
  jira_updated: string | null;
  sla_breach_time: string | null;
  sla_breached: boolean | number | null;
}

const MS_PER_DAY = 86_400_000;

function parseList(raw: string | undefined | null, fallback: string[]): string[] {
  if (!raw) return fallback;
  const items = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function wholeDaysSince(iso: string | null): number {
  if (!iso) return 0;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / MS_PER_DAY));
}

// Parse the per-org reporter list (newline/comma separated). Entries may be
// emails, display names, or account ids (incl. JSM "qm:orgid:accountid" form —
// we also index the trailing accountId segment).
function parseReporters(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(/[\n,]/)) {
    const token = part.trim().replace(/^["']|["']$/g, '').toLowerCase();
    if (!token) continue;
    out.add(token);
    if (token.includes(':')) out.add(token.slice(token.lastIndexOf(':') + 1));
  }
  return [...out];
}

interface OrgScope {
  bcAccount: string | null;
  reporters: string[];
}

export class PortalDashboardService {
  constructor(private settings?: FileSettingsQueries) {}

  private setting(key: string): string | undefined {
    return this.settings?.get(key) as string | undefined;
  }

  async getOrgScope(orgId: number): Promise<OrgScope> {
    const row = await queryOne<{ bc_account_number: string | null; scope_reporters: string | null }>(
      `SELECT bc_account_number, scope_reporters FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    const bc = row?.bc_account_number?.trim();
    return {
      bcAccount: bc ? bc : null,
      reporters: parseReporters(row?.scope_reporters),
    };
  }

  // Open tickets for the customer: BC Account match OR any configured reporter
  // (email / display name / account id). Mirrors the source JQL's reporter-set
  // OR BC-Account-Number logic, restricted to unresolved.
  private async getOpenIssues(scope: OrgScope): Promise<OpenIssueRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (scope.bcAccount) {
      clauses.push(`bc_account_number = ?`);
      params.push(scope.bcAccount);
    }
    if (scope.reporters.length) {
      const placeholders = scope.reporters.map(() => '?').join(', ');
      clauses.push(`LOWER(reporter_email) IN (${placeholders})`);
      params.push(...scope.reporters);
      clauses.push(`LOWER(reporter_display) IN (${placeholders})`);
      params.push(...scope.reporters);
      clauses.push(`LOWER(reporter_account_id) IN (${placeholders})`);
      params.push(...scope.reporters);
    }
    if (!clauses.length) return [];

    return query<OpenIssueRow>(
      `SELECT issue_key, summary, status_name, status_category, priority_name,
              issuetype_name, current_tier, request_type, project_key, labels,
              assignee_display, jira_created, jira_updated,
              sla_breach_time, sla_breached
       FROM jira_issue_cache
       WHERE (${clauses.join(' OR ')})
         AND (status_category IS NULL OR status_category <> 'done')
       ORDER BY jira_created ASC`,
      params,
    );
  }

  // ── Onboarding ──

  private isOnboarding(row: OpenIssueRow, tokens: string[], projectKeys: string[]): boolean {
    const proj = (row.project_key || '').toLowerCase();
    if (projectKeys.length && projectKeys.includes(proj)) return true;
    const rt = (row.request_type || '').toLowerCase();
    const type = (row.issuetype_name || '').toLowerCase();
    return tokens.some(t => rt.includes(t) || type.includes(t));
  }

  async getOnboardingDashboard(orgId: number): Promise<OnboardingDashboardResponse> {
    const scope = await this.getOrgScope(orgId);
    if (!scope.bcAccount && !scope.reporters.length) {
      return { summary: emptyOnboardingSummary(), rows: [], bcAccountNumber: null };
    }

    const tokens = parseList(this.setting('portal_onboarding_request_types'), ['onboard', 'delivery']);
    const projectKeys = parseList(this.setting('portal_onboarding_project_keys'), []);

    const issues = await this.getOpenIssues(scope);
    const rows: OnboardingDashboardRow[] = issues
      .filter(r => this.isOnboarding(r, tokens, projectKeys))
      .map(r => {
        const ageDays = wholeDaysSince(r.jira_created);
        return {
          key: r.issue_key,
          summary: r.summary || '',
          stage: r.status_name || 'Unknown',
          owner: r.assignee_display || null,
          created: r.jira_created || '',
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

  private resolveType(row: OpenIssueRow, tpjProjects: string[]): string {
    const proj = (row.project_key || '').toLowerCase();
    if (tpjProjects.includes(proj)) return 'TPJ';
    const haystack = `${row.labels || ''} ${row.summary || ''}`.toLowerCase();
    if (haystack.includes('starberry')) return 'Starberry';
    if (row.current_tier) return row.current_tier;
    return row.issuetype_name || 'Other';
  }

  private sprintState(status: string, awaiting: string[], inSprint: string[]): 'allocated' | 'awaiting' | 'na' {
    const s = status.toLowerCase();
    if (awaiting.some(a => s.includes(a))) return 'awaiting';
    if (inSprint.some(a => s.includes(a))) return 'allocated';
    return 'na';
  }

  private isOverSla(row: OpenIssueRow): boolean {
    if (row.sla_breached === true || row.sla_breached === 1) return true;
    if (row.sla_breach_time) {
      const t = new Date(row.sla_breach_time).getTime();
      if (!Number.isNaN(t) && t <= Date.now()) return true;
    }
    return false;
  }

  async getSupportDashboard(orgId: number): Promise<SupportDashboardResponse> {
    const scope = await this.getOrgScope(orgId);
    if (!scope.bcAccount && !scope.reporters.length) {
      return { summary: emptySupportSummary(), rows: [], bcAccountNumber: null };
    }

    const onboardingTokens = parseList(this.setting('portal_onboarding_request_types'), ['onboard', 'delivery']);
    const onboardingProjects = parseList(this.setting('portal_onboarding_project_keys'), []);
    const tpjProjects = parseList(this.setting('portal_tpj_project_keys'), ['tpj', 'ntpj']);
    const awaitingSprint = parseList(this.setting('portal_awaiting_sprint_statuses'), ['awaiting sprint']);
    const inSprint = parseList(
      this.setting('portal_in_sprint_statuses'),
      ['in development', 'awaiting testing', 'scheduled for release', 'in progress'],
    );

    const issues = await this.getOpenIssues(scope);
    const rows: SupportDashboardRow[] = issues
      .filter(r => !this.isOnboarding(r, onboardingTokens, onboardingProjects))
      .map(r => {
        const status = r.status_name || 'Unknown';
        const daysSinceUpdate = wholeDaysSince(r.jira_updated);
        return {
          key: r.issue_key,
          summary: r.summary || '',
          owner: r.assignee_display || null,
          type: this.resolveType(r, tpjProjects),
          status,
          created: r.jira_created || '',
          ageDays: wholeDaysSince(r.jira_created),
          daysSinceUpdate,
          stale: daysSinceUpdate >= 3,
          overSla: this.isOverSla(r),
          businessCritical: (r.priority_name || '').toLowerCase() === 'blocker',
          priority: r.priority_name || 'Medium',
          sprintState: this.sprintState(status, awaitingSprint, inSprint),
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
