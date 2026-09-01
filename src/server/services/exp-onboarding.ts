/**
 * eXp "Notification of New Agent Joining" ticket creator (NT-24880).
 *
 * The simplified sibling of GuildOnboardingService: one onboarding record per
 * joining agent, and each record produces exactly TWO tickets — a QA parent and
 * an Onboarding child, linked (child blocks parent) exactly as the Guild fan-out
 * links its seven children. No 30-day SLA, no milestones, no digest.
 *
 * Idempotent: each key is persisted the moment its issue is created, so a retry
 * skips anything already present and never double-creates.
 *
 * Config (settings-overridable, Guild/orchestrator keys reused as fallback):
 *   jira_exp_project | jira_ob_project | jira_onboarding_project   (default NT)
 *   jira_exp_issue_type | jira_ob_issue_type                       (default Support)
 *   jira_exp_request_type_field | jira_ob_request_type_field
 *   jira_exp_rt_qa_id | jira_ob_rt_qa_id | jira_rt_delivery_qa_id
 *   jira_exp_rt_onboarding_id | jira_ob_rt_onboarding_id | jira_rt_onboarding_id
 *   jira_exp_link_type | jira_ob_link_type                         (default Blocks)
 *   exp_ob_company_name        (default "EXP WORLD UK LIMITED")
 *   exp_ob_qa_summary          template, {agent} placeholder
 *   exp_ob_onboarding_summary  template, {agent} placeholder
 */
import { JiraRestClient, buildAdfDescription } from './jira-client.js';
import { expMicrositeUrl, type PortalExpAgentInput } from '../../shared/portal-types.js';
import type { OnboardingRecord, OnboardingRecordQueries } from '../db/queries.js';

/** The standing instructions that appear on every eXp joiner request — they are
 *  shouted in every email eXp send, so they go on every ticket we raise. */
const STANDING_INSTRUCTIONS = [
  'ALL USERS TO BE ADDED AS AGENTS, NOT ADMIN.',
  'LeadPro: please enable the Abandoned Basket for the IVT to the agent email address above.',
];

interface ExpConfig {
  projectKey: string;
  issueTypeName: string;
  requestTypeField: string;
  qaRequestTypeId: string;
  onboardingRequestTypeId: string;
  linkTypeName: string;
  companyName: string;
  qaSummary: string;
  onboardingSummary: string;
  serviceDeskId: string;
  currentTierField: string;
  currentTierValue: string;
}

export interface ExpCreateResult {
  qaKey: string;
  onboardingKey: string;
  createdCount: number;
  linked: boolean;
  existing: boolean;
}

type SettingsGet = (key: string) => string | null | undefined;

export class ExpOnboardingService {
  constructor(
    private jira: JiraRestClient,
    private records: OnboardingRecordQueries,
    private settingsGet: SettingsGet,
    private log: (msg: string) => void = console.log,
  ) {}

  private resolveConfig(): ExpConfig {
    const s = this.settingsGet;
    const pick = (...keys: string[]): string => {
      for (const k of keys) { const v = s(k); if (v) return v; }
      return '';
    };
    return {
      projectKey: pick('jira_exp_project', 'jira_ob_project', 'jira_onboarding_project') || 'NT',
      issueTypeName: pick('jira_exp_issue_type', 'jira_ob_issue_type', 'jira_onboarding_issue_type') || 'Support',
      requestTypeField: pick('jira_exp_request_type_field', 'jira_ob_request_type_field', 'jira_request_type_field'),
      qaRequestTypeId: pick('jira_exp_rt_qa_id', 'jira_ob_rt_qa_id', 'jira_rt_delivery_qa_id'),
      onboardingRequestTypeId: pick('jira_exp_rt_onboarding_id', 'jira_ob_rt_onboarding_id', 'jira_rt_onboarding_id'),
      linkTypeName: pick('jira_exp_link_type', 'jira_ob_link_type', 'jira_link_type_name') || 'Blocks',
      companyName: s('exp_ob_company_name') || 'EXP WORLD UK LIMITED',
      qaSummary: s('exp_ob_qa_summary') || 'eXp QA – {agent}',
      onboardingSummary: s('exp_ob_onboarding_summary') || 'eXp New Agent Onboarding – {agent}',
      serviceDeskId: pick('jira_exp_service_desk_id', 'jira_ob_service_desk_id', 'portal_nt_service_desk_id') || '50',
      currentTierField: s('jira_ob_current_tier_field') || 'customfield_12981',
      currentTierValue: s('jira_ob_current_tier') || 'Production',
    };
  }

  /** JSM servicedeskapi must be called on the DIRECT site URL with Basic auth —
   *  the api.atlassian.com gateway client rejects it. Build one from settings. */
  private buildDirectClient(): JiraRestClient | null {
    const siteUrl = (this.settingsGet('jira_url') || '').replace(/\/+$/, '');
    const email = this.settingsGet('jira_username');
    const token = this.settingsGet('jira_token');
    if (siteUrl && email && token) return new JiraRestClient({ baseUrl: siteUrl, email, apiToken: token });
    return null;
  }

  /** Create one ticket, preferring a JSM customer request raised ON BEHALF OF the
   *  submitter; falls back to raising without a reporter, then to createIssue. */
  private async createTicket(
    sdClient: JiraRestClient, cfg: ExpConfig, summary: string, descLines: string[],
    requestTypeId: string, reporterEmail: string | null,
  ): Promise<string> {
    const descText = descLines.join('\n');
    let key = '';
    if (requestTypeId && cfg.serviceDeskId) {
      const requestFieldValues = { summary, description: descText };
      try {
        const created = await sdClient.createServiceDeskRequest({ serviceDeskId: cfg.serviceDeskId, requestTypeId, requestFieldValues, raiseOnBehalfOf: reporterEmail || undefined });
        key = created.issueKey;
      } catch (err) {
        this.log(`[eXp] servicedesk create${reporterEmail ? ` on behalf of ${reporterEmail}` : ''} failed: ${err instanceof Error ? err.message : err}`);
        if (reporterEmail) {
          try {
            const created = await sdClient.createServiceDeskRequest({ serviceDeskId: cfg.serviceDeskId, requestTypeId, requestFieldValues });
            key = created.issueKey;
          } catch (err2) {
            this.log(`[eXp] servicedesk create (no reporter) failed, falling back to createIssue: ${err2 instanceof Error ? err2.message : err2}`);
          }
        }
      }
    }
    if (!key) {
      const fields: Record<string, unknown> = {
        project: { key: cfg.projectKey }, issuetype: { name: cfg.issueTypeName }, summary,
        description: buildAdfDescription([{ text: descText }]),
      };
      if (cfg.requestTypeField && requestTypeId) fields[cfg.requestTypeField] = { id: requestTypeId };
      const created = await this.jira.createIssue({ fields });
      key = created.key;
    }
    if (key && cfg.currentTierField && cfg.currentTierValue) {
      try {
        await sdClient.updateFields(key, { [cfg.currentTierField]: { value: cfg.currentTierValue } });
      } catch (err) {
        this.log(`[eXp] set Current Tier on ${key} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    return key;
  }

  /** The agent detail block both tickets carry. */
  private agentLines(agent: PortalExpAgentInput, cfg: ExpConfig, ref: string): string[] {
    const url = expMicrositeUrl(agent);
    const lines = [
      `Agent Full Name: ${agent.name}`,
      `Agent Email Address: ${agent.email}`,
    ];
    if (agent.phone) lines.push(`Agent Phone Number: ${agent.phone}`);
    if (agent.address) lines.push(`Agent Registered Address: ${agent.address}`);
    lines.push(`Registered company name: ${cfg.companyName}`);
    lines.push(agent.hasMicrosite
      ? `eXp Agent Microsite: Yes — ${url}`
      : `eXp Agent Microsite: No — LeadPro URL: ${url}`);
    if (agent.existingAgent) {
      lines.push('Existing agent: this person may already exist in LeadPro — add a NEW IVT to that account rather than creating a duplicate. eXp will cc Loop to confirm the format of the new IVT.');
    }
    lines.push(...STANDING_INSTRUCTIONS);
    if (agent.notes) lines.push(`Notes: ${agent.notes}`);
    lines.push(`Onboarding Ref: ${ref}`);
    return lines;
  }

  private summary(template: string, agentName: string): string {
    return template.replace(/\{agent\}/g, agentName).trim();
  }

  /** Create (or resume) the QA + Onboarding pair for one eXp joiner record.
   *  Persists each key as it goes; safe to re-run. */
  async createForRecord(record: OnboardingRecord): Promise<ExpCreateResult> {
    const cfg = this.resolveConfig();
    const ref = record.onboarding_ref;
    const prefix = `[eXp:${ref}]`;
    const agent: PortalExpAgentInput = (() => {
      try { return JSON.parse(record.setup_data || '{}') as PortalExpAgentInput; }
      catch { return { name: record.branch_name || '', email: '', hasMicrosite: false, existingAgent: false }; }
    })();
    const agentName = agent.name || record.branch_name || 'New agent';

    let qaKey = record.parent_key || '';
    const childKeys: Record<string, string> = (() => {
      try { return record.child_keys ? JSON.parse(record.child_keys) : {}; } catch { return {}; }
    })();
    const alreadyHadQa = !!qaKey;
    let createdCount = 0;
    let linked = false;
    const sdClient = this.buildDirectClient() ?? this.jira;
    const reporterEmail = record.reporter_email || null;
    const detail = this.agentLines(agent, cfg, ref);

    try {
      if (!qaKey) {
        qaKey = await this.createTicket(sdClient, cfg,
          this.summary(cfg.qaSummary, agentName),
          ['eXp – QA for a new agent joining.', '', ...detail],
          cfg.qaRequestTypeId, reporterEmail);
        createdCount++;
        this.log(`${prefix} Created QA: ${qaKey}`);
        await this.records.update(record.id, { parent_key: qaKey });
      }

      if (!childKeys.onboarding) {
        childKeys.onboarding = await this.createTicket(sdClient, cfg,
          this.summary(cfg.onboardingSummary, agentName),
          ['eXp – Notification of a new agent joining. Please set the agent up as below.', '', ...detail],
          cfg.onboardingRequestTypeId, reporterEmail);
        createdCount++;
        this.log(`${prefix} Created Onboarding: ${childKeys.onboarding}`);
        await this.records.update(record.id, { child_keys: JSON.stringify(childKeys) });
      }

      // Link Onboarding → QA (onboarding blocks QA), skipping an existing link.
      const qaIssue = await this.jira.getIssue(qaKey, ['issuelinks']);
      const existingLinked = new Set<string>();
      for (const link of (qaIssue?.fields?.issuelinks as Array<{ inwardIssue?: { key: string }; outwardIssue?: { key: string } }> | undefined) ?? []) {
        if (link.inwardIssue?.key) existingLinked.add(link.inwardIssue.key);
        if (link.outwardIssue?.key) existingLinked.add(link.outwardIssue.key);
      }
      if (!existingLinked.has(childKeys.onboarding)) {
        try {
          await this.jira.createIssueLink({ type: { name: cfg.linkTypeName }, outwardIssue: { key: childKeys.onboarding }, inwardIssue: { key: qaKey } });
          linked = true;
        } catch (err) {
          this.log(`${prefix} ERROR linking ${childKeys.onboarding} → ${qaKey}: ${err instanceof Error ? err.message : err}`);
        }
      }

      await this.records.update(record.id, {
        status: 'success', parent_key: qaKey, child_keys: JSON.stringify(childKeys),
      });
      this.log(`${prefix} Complete — QA ${qaKey}, Onboarding ${childKeys.onboarding}`);
      return { qaKey, onboardingKey: childKeys.onboarding, createdCount, linked, existing: alreadyHadQa };
    } catch (err) {
      await this.records.update(record.id, {
        status: 'error',
        parent_key: qaKey || null,
        child_keys: Object.keys(childKeys).length ? JSON.stringify(childKeys) : null,
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
