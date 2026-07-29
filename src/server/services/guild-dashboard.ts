/**
 * Guild/BYM onboarding dashboard (backlog #8, R5).
 *
 * One row per onboarding record, assembling: live JSM status for the parent + 7
 * children, the 30-day SLA state, the INTS escalation level, the staff-edited
 * manual fields, and the milestone progress line (sheet columns in order).
 * Replaces the "BYM Onboarding Status.xlsx" Guild tracker.
 */
import type { JiraRestClient } from './jira-client.js';
import type { OnboardingRecord, OnboardingRecordQueries } from '../db/queries.js';
import type { GuildMilestoneView, GuildOnboardingRow, GuildOnboardingDashboardResponse } from '../../shared/portal-types.js';
import {
  GUILD_MILESTONES, GUILD_MANUAL_FIELDS, jiraStatusToState, computeSla, computeIntsLevel,
  type GuildMilestoneState,
} from './guild-onboarding-sla.js';

const MANUAL_TYPE = new Map(GUILD_MANUAL_FIELDS.map(f => [f.key, f.type]));

function manualState(val: unknown, type: 'date' | 'flag' | 'text' | undefined): { state: GuildMilestoneState; detail: string | null } {
  if (type === 'flag') return { state: val ? 'done' : 'pending', detail: val ? 'Yes' : null };
  const s = val !== undefined && val !== null && val !== '' ? String(val) : null;
  return { state: s ? 'done' : 'pending', detail: s };
}

export class GuildDashboardService {
  constructor(
    private jira: JiraRestClient | null,
    private records: OnboardingRecordQueries,
  ) {}

  async getDashboard(opts?: { orgId?: number }): Promise<GuildOnboardingDashboardResponse> {
    const records = opts?.orgId != null
      ? await this.records.listByOrg(opts.orgId)
      : await this.records.listByChannel('guild');

    // One Jira fetch for every parent + child key across all records.
    const allKeys = new Set<string>();
    for (const r of records) {
      if (r.parent_key) allKeys.add(r.parent_key);
      for (const k of Object.values(this.parseChildKeys(r))) if (k) allKeys.add(k);
    }
    const statusByKey = await this.fetchStatuses([...allKeys]);

    const now = new Date();
    const rows = records.map(r => this.buildRow(r, statusByKey, now));
    return { rows, generatedAt: now.toISOString() };
  }

  private parseChildKeys(r: OnboardingRecord): Record<string, string> {
    try { return r.child_keys ? JSON.parse(r.child_keys) : {}; } catch { return {}; }
  }

  private async fetchStatuses(keys: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.jira || keys.length === 0) return out;
    // JQL `key in (...)`, paged; statuses only.
    const jql = `key in (${keys.map(k => `"${k}"`).join(',')})`;
    try {
      const res = await this.jira.searchJqlAll(jql, ['status'], Math.max(100, keys.length));
      for (const iss of res.issues) {
        const status = ((iss.fields?.status as { name?: string } | undefined)?.name)
          || (typeof iss.fields?.status === 'string' ? iss.fields.status as string : null);
        if (status) out.set(iss.key, status);
      }
    } catch (err) {
      console.warn('[guild-dashboard] status fetch failed:', err instanceof Error ? err.message : err);
    }
    return out;
  }

  private buildRow(r: OnboardingRecord, statusByKey: Map<string, string>, now: Date): GuildOnboardingRow {
    const childKeys = this.parseChildKeys(r);
    const manual: Record<string, unknown> = (() => {
      try { return r.manual_fields ? JSON.parse(r.manual_fields) : {}; } catch { return {}; }
    })();

    const parentStatus = r.parent_key ? statusByKey.get(r.parent_key) ?? null : null;
    const parentDone = jiraStatusToState(parentStatus) === 'done';
    const intsKey = childKeys.ints || null;
    const intsStatus = intsKey ? statusByKey.get(intsKey) ?? null : null;
    const intsDone = jiraStatusToState(intsStatus) === 'done';

    const submission = new Date(r.submission_date);
    const sla = computeSla(submission, now, parentDone);
    const intsLevel = computeIntsLevel(submission, now, intsDone);

    const milestones: GuildMilestoneView[] = GUILD_MILESTONES.map(def => {
      if (def.kind === 'ticket') {
        const key = def.childKey === 'parent' ? r.parent_key : childKeys[def.childKey as string];
        const status = key ? statusByKey.get(key) ?? null : null;
        return { key: def.key, label: def.label, kind: 'ticket', state: key ? jiraStatusToState(status) : 'pending', detail: status, jiraKey: key || null };
      }
      if (def.kind === 'manual') {
        const { state, detail } = manualState(manual[def.manualKey!], MANUAL_TYPE.get(def.manualKey!));
        return { key: def.key, label: def.label, kind: 'manual', state, detail, jiraKey: null };
      }
      // calculated
      if (def.calc === 'sla30Day') {
        return { key: def.key, label: def.label, kind: 'calculated', state: sla.rag === 'met' ? 'done' : (sla.breached ? 'na' : 'in_progress'), detail: sla.sla30Day, jiraKey: null };
      }
      // crmCreated — rule pending BA (spec §7). Reflect a manual override if set.
      const crm = manual.crmCreated;
      return { key: def.key, label: def.label, kind: 'calculated', state: crm ? 'done' : 'pending', detail: crm ? String(crm) : 'Rule pending (BA)', jiraKey: null };
    });

    return {
      id: r.id,
      ref: r.onboarding_ref,
      officeName: r.office_name,
      branchName: r.branch_name,
      submissionDate: r.submission_date,
      invoiceCommencementDate: r.invoice_commencement_date,
      parentKey: r.parent_key,
      parentStatus,
      status: r.status,
      sla30Day: sla.sla30Day,
      slaDaysRemaining: sla.daysRemaining,
      slaRag: sla.rag,
      slaBreached: sla.breached,
      intsEscalationLevel: intsLevel,
      intsKey,
      milestones,
      manualFields: manual,
    };
  }
}
