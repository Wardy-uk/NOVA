import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import { JiraRestClient } from './jira-client.js';
import { getOrgScope, buildScopeJqlBranches, matchesOrgScope, type OrgScope } from './portal-org-scope.js';
import type {
  OnboardingDashboardResponse,
  OnboardingDashboardRow,
  SupportDashboardResponse,
  SupportDashboardRow,
  PortalOrgFeatures,
  PortalOrgBranding,
} from '../../shared/portal-types.js';
import { parseSupportRoutes, firstNameOnly } from '../../shared/portal-types.js';

// Customer-facing Onboarding + Support dashboards.
//
// Data comes LIVE from Jira (not the NT-only jira_issue_cache) so it spans every
// project the customer has tickets in. Each org is scoped by BC Account Number
// (Jira customfield_14626) OR a set of reporter identities — mirroring the source
// JQL, correctly bracketed so the open-status filter applies to both branches.

const MS_PER_DAY = 86_400_000;

// Jira custom fields (discovered from the live instance)
const CF_JSM_REQUEST_TYPE = 'customfield_12800'; // JSM customer Request Type (Escalation, Onboarding, Delivery QA…) — nested {requestType:{name}}
const CF_SLA_REQUEST_TYPE = 'customfield_13482'; // "SLA Request Type" (Incident/Service Request…) — secondary
const CF_TIER = 'customfield_12981';
const CF_BC_ACCOUNT = 'customfield_14626';
const CF_SPRINT = 'customfield_10007';
const CF_RESOLUTION_SLA = 'customfield_12805'; // "Time to resolution"

const JIRA_FIELDS = [
  'summary', 'status', 'assignee', 'reporter', 'created', 'updated',
  'priority', 'issuetype', 'project', 'labels',
  CF_JSM_REQUEST_TYPE, CF_SLA_REQUEST_TYPE, CF_TIER, CF_BC_ACCOUNT, CF_SPRINT, CF_RESOLUTION_SLA,
];

const DEFAULT_EXCLUDE_STATUSES = ['Closed', 'Done', 'Released', 'Resolved', 'Promoted', 'Declined', 'Cancelled'];
const DEFAULT_ONBOARDING_TOKENS = ['onboard', 'delivery'];
const DEFAULT_TPJ_PROJECTS = ['tpj', 'ntpj'];
// Tier buckets for the second KPI row (current tier = cf12981)
const DEFAULT_TIER_SUPPORT = ['customer care', 'tier 2', 'tier2', 't2', 'tier 1', 't1'];
const DEFAULT_TIER_T3 = ['tier 3', 'tier3', 't3'];
const DEFAULT_TIER_DEVELOPMENT = ['development'];

const DEFAULT_DEV_STATUSES = [
  'waiting on development', 'in development', 'development', 'backlog',
  'selected for development', 'ready for development', 'to do', 'awaiting sprint',
];

const CACHE_TTL_MS = 30_000;

// Default owner for portal-raised escalations — Nick Ward (nickw@nurtur.tech).
// Override per-deployment via the portal_escalation_assignee_account_id setting.
const DEFAULT_ESCALATION_ASSIGNEE_ACCOUNT_ID = '712020:f108bd7f-b362-41d7-83ca-f8c0c0bbac65';

function parseList(raw: string | undefined | null, fallback: string[]): string[] {
  if (!raw) return fallback;
  const items = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
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

interface NormalisedIssue {
  key: string;
  summary: string;
  status: string;
  owner: string | null;
  reporterEmail: string | null;
  created: string;
  updated: string;
  priority: string;
  priorityId: string;
  issuetype: string;
  project: string;
  projectType: string;
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

  // Per-org feature toggles. Fails CLOSED: an org with no row is a misconfigured
  // tenant, not a privileged one. (Internal staff always have a real org row —
  // the portal auth middleware creates 'nurtur-internal' on first request.)
  async getOrgFeatures(orgId: number): Promise<PortalOrgFeatures> {
    const row = await queryOne<{ feat_get_help: number; feat_kb: number; feat_support: number; feat_onboarding: number; feat_raise_ticket: number; support_routes: string | null; guild_onboarding_enabled: number }>(
      `SELECT feat_get_help, feat_kb, feat_support, feat_onboarding, feat_raise_ticket, support_routes, guild_onboarding_enabled FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    if (!row) {
      console.warn(`[portal] No organisation row for orgId=${orgId} — hiding all features`);
      return { getHelp: false, kb: false, support: false, onboarding: false, raiseTicket: false };
    }
    return {
      getHelp: !!row.feat_get_help,
      kb: !!row.feat_kb,
      support: !!row.feat_support,
      onboarding: !!row.feat_onboarding,
      raiseTicket: !!row.feat_raise_ticket,
      supportRoutes: parseSupportRoutes(row.support_routes),
      guildOnboarding: !!row.guild_onboarding_enabled,
    };
  }

  async getOrgBranding(orgId: number): Promise<PortalOrgBranding> {
    const row = await queryOne<{
      brand_website_url: string | null; brand_logo_url: string | null;
      brand_primary: string | null; brand_secondary: string | null; brand_font: string | null;
    }>(
      `SELECT brand_website_url, brand_logo_url, brand_primary, brand_secondary, brand_font
       FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    return {
      websiteUrl: row?.brand_website_url || null,
      logoUrl: row?.brand_logo_url || null,
      primary: row?.brand_primary || null,
      secondary: row?.brand_secondary || null,
      font: row?.brand_font || null,
    };
  }

  async getOrgScope(orgId: number): Promise<OrgScope> {
    return getOrgScope(orgId);
  }

  private buildJql(scope: OrgScope): string | null {
    const branches = buildScopeJqlBranches(scope);
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
    // The JQL is only a prefilter — cf[14626] can only be matched fuzzily (`~`),
    // so BC account "123" also pulls back "1234". Re-check every issue exactly.
    const scoped = (result.issues || []).filter((iss: any) => matchesOrgScope(scope, iss));
    const dropped = (result.issues || []).length - scoped.length;
    if (dropped > 0) {
      console.warn(`[portal] org ${orgId}: dropped ${dropped} issue(s) that matched the JQL prefilter but not the exact org scope`);
    }
    const issues: NormalisedIssue[] = scoped.map((iss: any) => {
      const f = iss.fields ?? {};
      const sla = f[CF_RESOLUTION_SLA];
      const slaBreached = !!(sla?.ongoingCycle?.breached
        || (Array.isArray(sla?.completedCycles) && sla.completedCycles.some((c: any) => c?.breached)));
      const sprint = f[CF_SPRINT];
      return {
        key: iss.key,
        summary: f.summary || '',
        status: f.status?.name || 'Unknown',
        owner: firstNameOnly(f.assignee?.displayName),
        reporterEmail: f.reporter?.emailAddress || null,
        created: f.created || '',
        updated: f.updated || f.created || '',
        priority: f.priority?.name || 'Medium',
        priorityId: f.priority?.id || '',
        issuetype: f.issuetype?.name || '',
        project: f.project?.key || '',
        projectType: f.project?.projectTypeKey || '',
        labels: Array.isArray(f.labels) ? f.labels.join(' ') : '',
        // JSM request type is nested ({requestType:{name}}); combine with the SLA
        // request type so onboarding/escalation detection sees both taxonomies.
        requestType: [f[CF_JSM_REQUEST_TYPE]?.requestType?.name, cfValue(f[CF_SLA_REQUEST_TYPE])]
          .filter(Boolean).join(' '),
        tier: cfValue(f[CF_TIER]),
        hasSprint: Array.isArray(sprint) ? sprint.length > 0 : !!sprint,
        slaBreached,
      };
    });

    // JSM only — exclude Jira Software / Business work items (Epics, Stories, dev
    // tasks). Service-desk projects are projectTypeKey = 'service_desk'.
    const allowedTypes = parseList(this.setting('portal_dashboard_project_types'), ['service_desk'])
      .map(t => t.toLowerCase());
    const jsm = issues.filter(i => allowedTypes.includes(i.projectType.toLowerCase()));

    this.cache.set(orgId, { at: Date.now(), issues: jsm });
    return jsm;
  }

  // The JSM Service Desk API + customer user-search must use the DIRECT site URL
  // with Basic auth — the api.atlassian.com/ex/jira/{cloudId} gateway client
  // rejects servicedeskapi and doesn't resolve portal customer accounts.
  private directServiceDeskClient(): JiraRestClient | null {
    const siteUrl = (this.setting('jira_url') || '').replace(/\/+$/, '');
    const email = this.setting('jira_username');
    const token = this.setting('jira_token');
    if (siteUrl && email && token) return new JiraRestClient({ baseUrl: siteUrl, email, apiToken: token });
    return null;
  }

  private async resolveAccountId(email: string): Promise<string | null> {
    const client = this.directServiceDeskClient() ?? this.jira;
    if (!client || !email) return null;
    try {
      const users = await client.searchUsers(email, 10);
      const exact = users.find(u => (u.emailAddress || '').toLowerCase() === email.toLowerCase());
      return (exact || users[0])?.accountId || null;
    } catch {
      return null;
    }
  }

  // ── My Tickets listing (role-scoped) ──
  // scope 'mine' = reporter is the current user; scope 'org' = the org's BC-Account
  // + reporter scope (same population the Support dashboard uses). JSM only.
  async listTickets(opts: {
    orgId: number; userEmail: string; scope: 'mine' | 'org';
    status?: 'all' | 'open' | 'resolved'; search?: string;
  }): Promise<import('../../shared/portal-types.js').PortalOrgTicket[]> {
    if (!this.jira) return [];

    let scopeClause: string;
    // Set for the 'org' scope only: the JQL BC branch is fuzzy, so results must be
    // re-checked exactly. 'mine' is an exact reporter match and needs no re-check
    // (and must not be re-checked — a user's own ticket may carry no BC account).
    let exactScope: OrgScope | null = null;
    if (opts.scope === 'mine') {
      const accountId = await this.resolveAccountId(opts.userEmail);
      if (!accountId) return [];
      scopeClause = `reporter = "${accountId}"`;
    } else {
      exactScope = await this.getOrgScope(opts.orgId);
      const branches = buildScopeJqlBranches(exactScope);
      if (!branches.length) return [];
      scopeClause = `(${branches.join(' OR ')})`;
    }

    const statusClause = opts.status === 'open' ? 'statusCategory != Done'
      : opts.status === 'resolved' ? 'statusCategory = Done' : null;
    const searchClause = opts.search ? `summary ~ ${JSON.stringify(opts.search)}` : null;
    const jql = [scopeClause, statusClause, searchClause].filter(Boolean).join(' AND ') + ' ORDER BY created DESC';

    const result = await this.jira.searchJqlAll(jql, JIRA_FIELDS, 200);
    const allowedTypes = parseList(this.setting('portal_dashboard_project_types'), ['service_desk']).map(t => t.toLowerCase());
    const escalationTokens = parseList(this.setting('portal_escalation_request_types'), ['escalation']).map(t => t.toLowerCase());

    const rows = (result.issues || [])
      .filter((iss: any) => !exactScope || matchesOrgScope(exactScope, iss))
      .map((iss: any) => {
        const f = iss.fields ?? {};
        const requestType = [f[CF_JSM_REQUEST_TYPE]?.requestType?.name, cfValue(f[CF_SLA_REQUEST_TYPE])].filter(Boolean).join(' ');
        return {
          key: iss.key,
          summary: f.summary || '',
          status: f.status?.name || 'Unknown',
          priority: f.priority?.name || 'Medium',
          tier: cfValue(f[CF_TIER]),
          requestType,
          reporter: f.reporter?.emailAddress || f.reporter?.displayName || null,
          assignee: f.assignee?.displayName || null,
          created: f.created || '',
          updated: f.updated || f.created || '',
          isEscalation: escalationTokens.some(t => requestType.toLowerCase().includes(t)),
          escalationKey: null as string | null,
          _projectType: (f.project?.projectTypeKey || '').toLowerCase(),
        };
      })
      .filter((t: any) => allowedTypes.includes(t._projectType))
      .map(({ _projectType, ...t }: any) => t);

    // Attach the escalation ticket key for any of these originals that have been escalated.
    const escMap = await this.getEscalationMap(rows.map((r: any) => r.key));
    for (const r of rows) r.escalationKey = escMap.get(r.key) ?? null;
    return rows;
  }

  private async getEscalationMap(keys: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!keys.length) return map;
    const placeholders = keys.map(() => '?').join(', ');
    const rows = await query<{ original_key: string; escalation_key: string }>(
      `SELECT original_key, escalation_key FROM portal_escalations
       WHERE original_key IN (${placeholders}) ORDER BY id ASC`,
      keys,
    );
    for (const r of rows) map.set(r.original_key, r.escalation_key); // latest wins
    return map;
  }

  // ── Escalate a ticket ──
  // Creates a new Escalation request (JSM Request Type = Escalation) linked back
  // to the original ticket. Manager-only (enforced at the route).
  async escalateTicket(originalKey: string, reason: string, byEmail: string, orgId?: number): Promise<{ key: string }> {
    if (!this.jira) throw new Error('Jira is not configured');
    const serviceDeskId = this.setting('portal_escalation_service_desk_id') || '50';
    const requestTypeId = this.setting('portal_escalation_request_type_id') || '1237';
    const linkType = this.setting('portal_escalation_link_type') || 'Relates';

    const orig = await this.jira.getIssue(originalKey, ['summary']);
    const origSummary = (orig?.fields as any)?.summary || originalKey;
    const raiseOnBehalfOf = await this.resolveAccountId(byEmail);

    // Service Desk API must be called on the direct site URL (see helper note).
    const sdClient = this.directServiceDeskClient() ?? this.jira;

    const requestFieldValues = {
      summary: `ESCALATION - ${originalKey} - ${origSummary}`.slice(0, 250),
      description: `Escalated from ${originalKey} by ${byEmail}.\n\nReason:\n${reason}`,
    };
    let created: { issueKey: string; issueId: string };
    try {
      created = await sdClient.createServiceDeskRequest({
        serviceDeskId,
        requestTypeId,
        requestFieldValues,
        ...(raiseOnBehalfOf ? { raiseOnBehalfOf } : {}),
      });
    } catch (err) {
      // The Escalation request type is agent-only, so raising it on behalf of a
      // customer is rejected ("requestTypeNotFound"). Retry as the agent account.
      if (raiseOnBehalfOf) {
        console.warn(`[portal-escalate] raiseOnBehalfOf rejected for ${originalKey}, retrying as agent:`, err instanceof Error ? err.message : err);
        created = await sdClient.createServiceDeskRequest({ serviceDeskId, requestTypeId, requestFieldValues });
      } else {
        throw err;
      }
    }

    try {
      await this.jira.createIssueLink({
        type: { name: linkType },
        inwardIssue: { key: created.issueKey },
        outwardIssue: { key: originalKey },
      });
    } catch (err) {
      console.warn(`[portal-escalate] created ${created.issueKey} but link to ${originalKey} failed:`, err instanceof Error ? err.message : err);
    }

    // Escalations always route to a fixed owner (mirrors the existing NOVA
    // email-escalation process). Defaults to Nick Ward; a setting can override.
    const ownerEmail = this.setting('portal_escalation_assignee_email');
    const ownerAccountId = this.setting('portal_escalation_assignee_account_id')
      || (ownerEmail ? await this.resolveAccountId(ownerEmail) : null)
      || DEFAULT_ESCALATION_ASSIGNEE_ACCOUNT_ID;
    if (ownerAccountId) {
      try {
        await sdClient.updateFields(created.issueKey, { assignee: { accountId: ownerAccountId } });
      } catch (err) {
        console.warn(`[portal-escalate] could not assign ${created.issueKey} to owner:`, err instanceof Error ? err.message : err);
      }
    }

    // Record the link so the portal can show/open the escalation on the original.
    try {
      await execute(
        `INSERT INTO portal_escalations (original_key, escalation_key, org_id, created_by_email, reason)
         VALUES (?, ?, ?, ?, ?)`,
        [originalKey, created.issueKey, orgId ?? null, byEmail, reason],
      );
    } catch (err) {
      console.warn('[portal-escalate] could not record escalation:', err instanceof Error ? err.message : err);
    }

    return { key: created.issueKey };
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
          reporterEmail: i.reporterEmail,
          created: i.created,
          ageDays,
          ageBucket: onboardingBucket(ageDays),
          priority: i.priority,
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

  private tierGroup(iss: NormalisedIssue, support: string[], t3: string[], dev: string[]): SupportDashboardRow['tierGroup'] {
    const t = (iss.tier || '').toLowerCase();
    if (t3.includes(t)) return 't3';
    if (dev.includes(t)) return 'development';
    if (support.includes(t) || t === '') return 'support'; // blank tier defaults to Customer Care
    return 'other';
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
    // Escalations = JSM Request Type contains "Escalation" (configurable).
    const escalationTokens = parseList(this.setting('portal_escalation_request_types'), ['escalation']).map(t => t.toLowerCase());
    // Business Critical = Jira Blocker (priority id 1 in this instance; name is
    // localised so we match by id).
    const blockerPriorityId = this.setting('portal_business_critical_priority_id') || '1';
    const tierSupport = parseList(this.setting('portal_tier_support'), DEFAULT_TIER_SUPPORT).map(t => t.toLowerCase());
    const tierT3 = parseList(this.setting('portal_tier_t3'), DEFAULT_TIER_T3).map(t => t.toLowerCase());
    const tierDev = parseList(this.setting('portal_tier_development'), DEFAULT_TIER_DEVELOPMENT).map(t => t.toLowerCase());

    const issues = await this.getOpenIssues(orgId, scope);
    const rows: SupportDashboardRow[] = issues
      .filter(i => !this.isOnboarding(i, onboardingTokens))
      .map(i => {
        const daysSinceUpdate = wholeDaysSince(i.updated);
        const sprintState = this.sprintState(i, devStatuses);
        const tierGroup = this.tierGroup(i, tierSupport, tierT3, tierDev);
        // "No update 3+ days" only counts pre-development tickets (customer care /
        // tier 2/3 triage). Development + awaiting-sprint tickets are expected to
        // sit (waiting on sprints / automated Jira updates), so they're excluded.
        const preDevelopment = sprintState === 'na' && tierGroup !== 'development';
        return {
          key: i.key,
          summary: i.summary,
          owner: i.owner,
          type: this.resolveType(i, tpjProjects),
          status: i.status,
          created: i.created,
          ageDays: wholeDaysSince(i.created),
          daysSinceUpdate,
          stale: daysSinceUpdate >= 3 && preDevelopment,
          overSla: i.slaBreached,
          businessCritical: i.priorityId === blockerPriorityId || i.priority.toLowerCase() === 'blocker',
          priority: i.priority,
          sprintState,
          tierGroup,
          escalation: escalationTokens.some(t => i.requestType.toLowerCase().includes(t)),
        };
      });

    const summary = {
      total: rows.length,
      stale: rows.filter(r => r.stale).length,
      overSla: rows.filter(r => r.overSla).length,
      businessCritical: rows.filter(r => r.businessCritical).length,
      awaitingSprint: rows.filter(r => r.sprintState === 'awaiting').length,
      allocatedSprint: rows.filter(r => r.sprintState === 'allocated').length,
      escalations: rows.filter(r => r.escalation).length,
      tierSupport: rows.filter(r => r.tierGroup === 'support').length,
      tierT3: rows.filter(r => r.tierGroup === 't3').length,
      tierDevelopment: rows.filter(r => r.tierGroup === 'development').length,
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
  return { total: 0, stale: 0, overSla: 0, businessCritical: 0, awaitingSprint: 0, allocatedSprint: 0, escalations: 0, tierSupport: 0, tierT3: 0, tierDevelopment: 0 };
}
