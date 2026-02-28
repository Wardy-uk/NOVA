import { z } from 'zod';
import { JiraRestClient, buildAdfDescription, type JiraIssue } from './jira-client.js';
import type { OnboardingConfigQueries, OnboardingRunQueries, ResolvedTicketGroup } from '../db/queries.js';

// ── Payload schema ──

export const OnboardingPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  onboardingRef: z.string().min(1),
  saleType: z.string().min(1),
  customer: z.object({ name: z.string().min(1) }),
  targetDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  config: z.record(z.unknown()).default({}),
});

export type OnboardingPayload = z.infer<typeof OnboardingPayloadSchema>;

export interface OnboardingResult {
  parentKey: string;
  childKeys: string[];
  createdCount: number;
  linkedCount: number;
  existing: boolean;
  dryRun: boolean;
  details?: {
    parentSummary: string;
    childSummaries: string[];
    childGroups?: Array<{ ticketGroupId: number | null; ticketGroupName: string; summary: string }>;
  };
}

export interface OnboardingConfig {
  projectKey: string;
  issueTypeName: string;
  requestTypeField: string;
  deliveryQaRequestTypeId: string;
  onboardingRequestTypeId: string;
  linkTypeName: string;
  defaultPriority: string;
}

const DEFAULT_CONFIG: OnboardingConfig = {
  projectKey: 'NT',
  issueTypeName: 'Service Request',
  requestTypeField: 'customfield_10010',
  deliveryQaRequestTypeId: '',
  onboardingRequestTypeId: '',
  linkTypeName: 'Blocks',
  defaultPriority: 'Medium',
};

// ── Summary formatters ──

function parentSummary(customerName: string, ref: string): string {
  return `Quality Assurance - ${customerName} (${ref})`;
}

function childSummary(customerName: string, group: ResolvedTicketGroup, ref: string): string {
  const capNames = group.capabilities.map(c => c.capabilityName).join(', ');
  return `Set up ${capNames} for ${customerName} (${ref})`;
}

// ── Orchestrator ──

export class OnboardingOrchestrator {
  private config: OnboardingConfig;

  constructor(
    private jira: JiraRestClient,
    private configQueries: OnboardingConfigQueries,
    private runQueries: OnboardingRunQueries,
    private settingsGetter: () => Record<string, string>,
    private log: (msg: string) => void = console.log
  ) {
    this.config = DEFAULT_CONFIG;
  }

  private refreshConfig(): void {
    const s = this.settingsGetter();
    this.config = {
      projectKey: s.jira_ob_project || s.jira_onboarding_project || DEFAULT_CONFIG.projectKey,
      issueTypeName: s.jira_ob_issue_type || s.jira_onboarding_issue_type || DEFAULT_CONFIG.issueTypeName,
      requestTypeField: s.jira_ob_request_type_field || s.jira_request_type_field || DEFAULT_CONFIG.requestTypeField,
      deliveryQaRequestTypeId: s.jira_ob_rt_qa_id || s.jira_rt_delivery_qa_id || '',
      onboardingRequestTypeId: s.jira_ob_rt_onboarding_id || s.jira_rt_onboarding_id || '',
      linkTypeName: s.jira_ob_link_type || s.jira_link_type_name || DEFAULT_CONFIG.linkTypeName,
      defaultPriority: DEFAULT_CONFIG.defaultPriority,
    };
  }

  async execute(payload: OnboardingPayload, options?: { dryRun?: boolean; userId?: number; filterGroupIds?: number[] }): Promise<OnboardingResult> {
    const { onboardingRef } = payload;
    const dryRun = options?.dryRun ?? false;
    const prefix = `[Onboarding:${onboardingRef}]`;

    this.refreshConfig();

    // 1. Validate
    this.log(`${prefix} Starting${dryRun ? ' (DRY RUN)' : ''}...`);

    // 2. Check local DB for cached successful run
    if (!dryRun) {
      const existing = this.runQueries.getByRef(onboardingRef);
      if (existing && existing.parent_key) {
        this.log(`${prefix} Already completed (run #${existing.id}), returning cached result`);
        return {
          parentKey: existing.parent_key,
          childKeys: existing.child_keys ? JSON.parse(existing.child_keys) : [],
          createdCount: 0,
          linkedCount: 0,
          existing: true,
          dryRun: false,
        };
      }
    }

    // 3. Resolve matrix — returns ticket groups, each with their X'd capabilities
    let ticketGroups = this.configQueries.resolveForSaleType(payload.saleType);
    if (ticketGroups.length === 0) {
      throw new Error(`No capabilities found for sale type "${payload.saleType}". Check the onboarding configuration.`);
    }

    // Filter to specific groups if requested (milestone workflow creates tickets per-stage)
    if (options?.filterGroupIds && options.filterGroupIds.length > 0) {
      const filterSet = new Set(options.filterGroupIds);
      ticketGroups = ticketGroups.filter(g => g.ticketGroupId != null && filterSet.has(g.ticketGroupId));
      if (ticketGroups.length === 0) {
        this.log(`${prefix} No matching ticket groups after filter — skipping`);
        return { parentKey: '', childKeys: [], createdCount: 0, linkedCount: 0, existing: false, dryRun };
      }
    }

    this.log(`${prefix} Resolved ${ticketGroups.length} ticket groups for "${payload.saleType}"`);

    // 4. Build summaries — one child ticket per ticket group
    const pSummary = parentSummary(payload.customer.name, onboardingRef);
    const childSummaries = ticketGroups.map(group =>
      childSummary(payload.customer.name, group, onboardingRef)
    );

    // 5. Dry run — return planned summaries
    if (dryRun) {
      return {
        parentKey: '(dry-run)',
        childKeys: childSummaries.map(() => '(dry-run)'),
        createdCount: 0,
        linkedCount: 0,
        existing: false,
        dryRun: true,
        details: {
          parentSummary: pSummary,
          childSummaries,
          childGroups: ticketGroups.map((group, i) => ({
            ticketGroupId: group.ticketGroupId,
            ticketGroupName: group.ticketGroupName,
            summary: childSummaries[i],
          })),
        },
      };
    }

    // 6. Create run record
    const runId = this.runQueries.create({
      onboarding_ref: onboardingRef,
      payload: JSON.stringify(payload),
      user_id: options?.userId,
    });

    let parentKey = '';
    const childKeys: string[] = [];
    let createdCount = 0;
    let linkedCount = 0;

    try {
      // 7. Search for existing parent
      const searchResult = await this.jira.searchJql(
        `project = ${this.config.projectKey} AND summary ~ "(${onboardingRef})" AND summary ~ "Quality Assurance"`,
        ['summary', 'issuelinks']
      );

      const existingParent = searchResult.issues.find(i =>
        (i.fields.summary as string)?.includes(`(${onboardingRef})`)
      );

      if (existingParent) {
        parentKey = existingParent.key;
        this.log(`${prefix} Found existing parent: ${parentKey}`);
      } else {
        // Create parent
        const parentDesc = buildAdfDescription([
          { heading: 'Onboarding QA Gate' },
          { text: `Customer: ${payload.customer.name}` },
          { text: `Sale Type: ${payload.saleType}` },
          { text: `Onboarding Ref: ${onboardingRef}` },
          { text: `Target Due Date: ${payload.targetDueDate}` },
          { heading: 'Configuration' },
          { codeBlock: JSON.stringify(payload.config, null, 2) },
        ]);

        const parentFields: Record<string, unknown> = {
          project: { key: this.config.projectKey },
          issuetype: { name: this.config.issueTypeName },
          summary: pSummary,
          description: parentDesc,
          priority: { name: this.config.defaultPriority },
          duedate: payload.targetDueDate,
        };

        // Set request type if configured
        if (this.config.requestTypeField && this.config.deliveryQaRequestTypeId) {
          parentFields[this.config.requestTypeField] = { id: this.config.deliveryQaRequestTypeId };
        }

        const created = await this.jira.createIssue({ fields: parentFields });
        parentKey = created.key;
        createdCount++;
        this.log(`${prefix} Created parent: ${parentKey}`);
      }

      // 8. Create children — one ticket per ticket group (sequential, search first)
      for (let i = 0; i < ticketGroups.length; i++) {
        const group = ticketGroups[i];
        const cSummary = childSummaries[i];

        try {
          // Search for existing child by group name + ref
          const childSearch = await this.jira.searchJql(
            `project = ${this.config.projectKey} AND summary ~ "(${onboardingRef})" AND summary ~ "${group.ticketGroupName}"`,
            ['summary']
          );

          const existingChild = childSearch.issues.find(issue =>
            (issue.fields.summary as string)?.includes(`(${onboardingRef})`)
          );

          if (existingChild) {
            childKeys.push(existingChild.key);
            this.log(`${prefix} Found existing child: ${existingChild.key} (${group.ticketGroupName})`);
            continue;
          }

          // Build child description — list capabilities and their items
          const descSections: any[] = [
            { heading: `${group.ticketGroupName} — Onboarding` },
            { text: `Customer: ${payload.customer.name}` },
            { text: `Onboarding Ref: ${onboardingRef}` },
          ];

          for (const cap of group.capabilities) {
            descSections.push({ heading: cap.capabilityName });
            if (cap.items.length > 0) {
              descSections.push({ bulletList: cap.items });
            } else {
              descSections.push({ text: 'Set up required' });
            }
          }

          if (Object.keys(payload.config).length > 0) {
            descSections.push({ heading: 'Configuration' });
            descSections.push({ codeBlock: JSON.stringify(payload.config, null, 2) });
          }

          const childFields: Record<string, unknown> = {
            project: { key: this.config.projectKey },
            issuetype: { name: this.config.issueTypeName },
            summary: cSummary,
            description: buildAdfDescription(descSections),
            priority: { name: this.config.defaultPriority },
            duedate: payload.targetDueDate,
          };

          if (this.config.requestTypeField && this.config.onboardingRequestTypeId) {
            childFields[this.config.requestTypeField] = { id: this.config.onboardingRequestTypeId };
          }

          const created = await this.jira.createIssue({ fields: childFields });
          childKeys.push(created.key);
          createdCount++;
          this.log(`${prefix} Created child: ${created.key} (${group.ticketGroupName})`);
        } catch (err) {
          this.log(`${prefix} ERROR creating child "${group.ticketGroupName}": ${err instanceof Error ? err.message : err}`);
          // Continue with remaining children
        }
      }

      // 9. Create issue links (child BLOCKS parent)
      // First, get existing links on parent
      const parentIssue = await this.jira.getIssue(parentKey, ['issuelinks']);
      const existingLinkedKeys = new Set<string>();
      if (parentIssue?.fields?.issuelinks) {
        for (const link of parentIssue.fields.issuelinks as JiraIssueLink[]) {
          if (link.outwardIssue?.key) existingLinkedKeys.add(link.outwardIssue.key);
          if (link.inwardIssue?.key) existingLinkedKeys.add(link.inwardIssue.key);
        }
      }

      for (const childKey of childKeys) {
        if (existingLinkedKeys.has(childKey)) {
          this.log(`${prefix} Link already exists: ${childKey} → ${parentKey}`);
          continue;
        }

        try {
          // "outwardIssue blocks inwardIssue" — child (outward) blocks parent (inward)
          await this.jira.createIssueLink({
            type: { name: this.config.linkTypeName },
            outwardIssue: { key: childKey },
            inwardIssue: { key: parentKey },
          });
          linkedCount++;
          this.log(`${prefix} Linked: ${childKey} blocks ${parentKey}`);
        } catch (err) {
          this.log(`${prefix} ERROR linking ${childKey} → ${parentKey}: ${err instanceof Error ? err.message : err}`);
        }
      }

      // 10. Update run record — success
      this.runQueries.update(runId, {
        status: childKeys.length === ticketGroups.length ? 'success' : 'partial',
        parent_key: parentKey,
        child_keys: JSON.stringify(childKeys),
        created_count: createdCount,
        linked_count: linkedCount,
      });

      this.log(`${prefix} Complete — parent: ${parentKey}, children: ${childKeys.length}/${ticketGroups.length}, created: ${createdCount}, linked: ${linkedCount}`);

      return {
        parentKey,
        childKeys,
        createdCount,
        linkedCount,
        existing: !!existingParent,
        dryRun: false,
      };
    } catch (err) {
      // Record error
      this.runQueries.update(runId, {
        status: 'error',
        parent_key: parentKey || null,
        child_keys: childKeys.length > 0 ? JSON.stringify(childKeys) : null,
        created_count: createdCount,
        linked_count: linkedCount,
        error_message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}

interface JiraIssueLink {
  id?: string;
  type: { name: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
}
