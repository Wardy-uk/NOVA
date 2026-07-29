/**
 * Guild / BYM onboarding ticket creator (backlog #8, R3).
 *
 * From one portal onboarding submission, creates the QA parent + 7 linked child
 * tickets in Jira Service Management and writes every key back onto the
 * `onboarding_records` row. Reuses the same Jira primitives as the general
 * OnboardingOrchestrator (createIssue / createIssueLink) but stays isolated to
 * the fixed Guild channel — the 7 children are a fixed set, not matrix-driven.
 *
 * Idempotent: each key is persisted the moment its issue is created, and a retry
 * skips anything already present, so a partial failure never double-creates.
 *
 * Config (all settings-overridable, orchestrator keys reused as fallback):
 *   jira_ob_project | jira_onboarding_project            (default NT)
 *   jira_ob_issue_type | jira_onboarding_issue_type      (default Support)
 *   jira_ob_request_type_field | jira_request_type_field
 *   jira_ob_rt_qa_id | jira_rt_delivery_qa_id            (parent request type)
 *   jira_ob_rt_onboarding_id | jira_rt_onboarding_id     (child request type)
 *   jira_ob_link_type | jira_link_type_name              (default Blocks)
 *   guild_ob_parent_label                                (default "QA")
 *   guild_ob_name_template  — placeholders {office} {branch} {suffix} {label}
 * Naming string format is an open BA item (spec §7); the defaults below match
 * the annotated examples ("Sibley QA – Sibley Pars Ashford", "INTS – …").
 */
import { JiraRestClient, buildAdfDescription } from './jira-client.js';
import type { OnboardingRecord, OnboardingRecordQueries } from '../db/queries.js';

/** The fixed 7 child workstreams, in sheet order. `key` is the stable machine
 *  key stored in child_keys JSON; `label` is used in the ticket summary. */
export const GUILD_CHILDREN = [
  { key: 'leadpro', label: 'Leadpro' },
  { key: 'instance', label: 'BYM Instance' },
  { key: 'ints', label: 'INTS' },
  { key: 'design', label: 'Design & Support' },
  { key: 'ars', label: 'ARS' },
  { key: 'cat', label: 'CAT' },
  { key: 'users', label: 'Set up Users' },
] as const;

export type GuildChildKey = (typeof GUILD_CHILDREN)[number]['key'];

interface GuildConfig {
  projectKey: string;
  issueTypeName: string;
  requestTypeField: string;
  qaRequestTypeId: string;
  childRequestTypeId: string;
  linkTypeName: string;
  parentLabel: string;
}

export interface GuildCreateResult {
  parentKey: string;
  childKeys: Record<string, string>;
  createdCount: number;
  linkedCount: number;
  existing: boolean;
}

type SettingsGet = (key: string) => string | undefined;

export class GuildOnboardingService {
  constructor(
    private jira: JiraRestClient,
    private records: OnboardingRecordQueries,
    private settingsGet: SettingsGet,
    private log: (msg: string) => void = console.log,
  ) {}

  private resolveConfig(): GuildConfig {
    const s = this.settingsGet;
    const pick = (...keys: string[]): string => {
      for (const k of keys) { const v = s(k); if (v !== undefined && v !== '') return v; }
      return '';
    };
    return {
      projectKey: pick('jira_ob_project', 'jira_onboarding_project') || 'NT',
      issueTypeName: pick('jira_ob_issue_type', 'jira_onboarding_issue_type') || 'Support',
      requestTypeField: pick('jira_ob_request_type_field', 'jira_request_type_field'),
      qaRequestTypeId: pick('jira_ob_rt_qa_id', 'jira_rt_delivery_qa_id'),
      childRequestTypeId: pick('jira_ob_rt_onboarding_id', 'jira_rt_onboarding_id'),
      linkTypeName: pick('jira_ob_link_type', 'jira_link_type_name') || 'Blocks',
      parentLabel: s('guild_ob_parent_label') || 'QA',
    };
  }

  /** "{office} {branch}" trimmed — the shared suffix for every ticket name. */
  private suffix(office: string, branch: string): string {
    return [office, branch].map(x => (x || '').trim()).filter(Boolean).join(' ');
  }

  private childSummary(label: string, office: string, branch: string): string {
    return `${label} – ${this.suffix(office, branch)}`.trim();
  }

  private parentSummary(office: string, branch: string, cfg: GuildConfig): string {
    const office_ = (office || '').trim();
    return `${office_} ${cfg.parentLabel} – ${this.suffix(office, branch)}`.trim();
  }

  /** Create (or resume) the QA parent + 7 children for a Guild onboarding record.
   *  Persists each key as it goes; safe to re-run. */
  async createForRecord(record: OnboardingRecord): Promise<GuildCreateResult> {
    const cfg = this.resolveConfig();
    const office = record.office_name || '';
    const branch = record.branch_name || '';
    const ref = record.onboarding_ref;
    const prefix = `[Guild:${ref}]`;

    let parentKey = record.parent_key || '';
    const childKeys: Record<string, string> = record.child_keys ? JSON.parse(record.child_keys) : {};
    const alreadyHadParent = !!parentKey;
    let createdCount = 0;
    let linkedCount = 0;

    try {
      // 1. Parent QA
      if (!parentKey) {
        const fields: Record<string, unknown> = {
          project: { key: cfg.projectKey },
          issuetype: { name: cfg.issueTypeName },
          summary: this.parentSummary(office, branch, cfg),
          description: buildAdfDescription([
            { heading: 'BYM – QA' },
            { text: `Office: ${office}` },
            { text: `Branch: ${branch}` },
            { text: `Onboarding Ref: ${ref}` },
            ...(record.invoice_commencement_date ? [{ text: `Invoice commencement: ${record.invoice_commencement_date}` }] : []),
          ]),
        };
        if (cfg.requestTypeField && cfg.qaRequestTypeId) fields[cfg.requestTypeField] = { id: cfg.qaRequestTypeId };
        const created = await this.jira.createIssue({ fields });
        parentKey = created.key;
        createdCount++;
        this.log(`${prefix} Created parent QA: ${parentKey}`);
        await this.records.update(record.id, { parent_key: parentKey });
      }

      // 2. Children (fixed set)
      for (const child of GUILD_CHILDREN) {
        if (childKeys[child.key]) continue;
        const fields: Record<string, unknown> = {
          project: { key: cfg.projectKey },
          issuetype: { name: cfg.issueTypeName },
          summary: this.childSummary(child.label, office, branch),
          description: buildAdfDescription([
            { heading: `${child.label} — Onboarding` },
            { text: `Office: ${office}` },
            { text: `Branch: ${branch}` },
            { text: `Onboarding Ref: ${ref}` },
          ]),
        };
        if (cfg.requestTypeField && cfg.childRequestTypeId) fields[cfg.requestTypeField] = { id: cfg.childRequestTypeId };
        const created = await this.jira.createIssue({ fields });
        childKeys[child.key] = created.key;
        createdCount++;
        this.log(`${prefix} Created child ${child.key}: ${created.key}`);
        await this.records.update(record.id, { child_keys: JSON.stringify(childKeys) });
      }

      // 3. Link each child → parent (child blocks parent), skipping existing links
      const parentIssue = await this.jira.getIssue(parentKey, ['issuelinks']);
      const existingLinked = new Set<string>();
      for (const link of (parentIssue?.fields?.issuelinks as Array<{ inwardIssue?: { key: string }; outwardIssue?: { key: string } }> | undefined) ?? []) {
        if (link.inwardIssue?.key) existingLinked.add(link.inwardIssue.key);
        if (link.outwardIssue?.key) existingLinked.add(link.outwardIssue.key);
      }
      for (const key of Object.values(childKeys)) {
        if (existingLinked.has(key)) continue;
        try {
          await this.jira.createIssueLink({ type: { name: cfg.linkTypeName }, outwardIssue: { key }, inwardIssue: { key: parentKey } });
          linkedCount++;
        } catch (err) {
          this.log(`${prefix} ERROR linking ${key} → ${parentKey}: ${err instanceof Error ? err.message : err}`);
        }
      }

      const complete = Object.keys(childKeys).length === GUILD_CHILDREN.length;
      await this.records.update(record.id, {
        status: complete ? 'success' : 'partial',
        parent_key: parentKey,
        child_keys: JSON.stringify(childKeys),
      });
      this.log(`${prefix} Complete — parent ${parentKey}, children ${Object.keys(childKeys).length}/${GUILD_CHILDREN.length}`);
      return { parentKey, childKeys, createdCount, linkedCount, existing: alreadyHadParent };
    } catch (err) {
      await this.records.update(record.id, {
        status: 'error',
        parent_key: parentKey || null,
        child_keys: Object.keys(childKeys).length ? JSON.stringify(childKeys) : null,
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
