import type { MilestoneQueries, DeliveryQueries, TaskQueries, OnboardingConfigQueries, WorkflowReadyMilestone } from '../db/queries.js';
import type { OnboardingOrchestrator } from './onboarding-orchestrator.js';
import { syncMilestoneToTask } from '../routes/milestones.js';

export class MilestoneWorkflowEngine {
  constructor(
    private milestoneQueries: MilestoneQueries,
    private deliveryQueries: DeliveryQueries,
    private taskQueries: TaskQueries,
    private configQueries: OnboardingConfigQueries,
    private getOrchestrator: () => OnboardingOrchestrator | null,
    private log: (msg: string) => void = console.log,
  ) {}

  /** Main evaluation loop — called by scheduler and after completion triggers */
  async evaluateAll(): Promise<{ tasksCreated: number; ticketsCreated: number }> {
    const ready = this.milestoneQueries.getMilestonesReadyForWorkflow();
    if (ready.length === 0) return { tasksCreated: 0, ticketsCreated: 0 };

    let tasksCreated = 0;
    let ticketsCreated = 0;

    for (const milestone of ready) {
      try {
        const result = await this.processMilestone(milestone);
        tasksCreated += result.taskCreated ? 1 : 0;
        ticketsCreated += result.ticketCount;
      } catch (err) {
        this.log(`[Workflow] Error processing milestone ${milestone.id} (${milestone.template_name} for ${milestone.account}): ${err instanceof Error ? err.message : err}`);
      }
    }

    if (tasksCreated > 0 || ticketsCreated > 0) {
      this.log(`[Workflow] Evaluation complete — ${tasksCreated} tasks created, ${ticketsCreated} tickets created`);
    }

    return { tasksCreated, ticketsCreated };
  }

  /** Process a single milestone that's ready for workflow */
  private async processMilestone(milestone: WorkflowReadyMilestone): Promise<{ taskCreated: boolean; ticketCount: number }> {
    // 1. Create the task in the tasks table
    syncMilestoneToTask(
      {
        id: milestone.id,
        delivery_id: milestone.delivery_id,
        template_id: milestone.template_id,
        template_name: milestone.template_name,
        target_date: milestone.target_date,
        status: milestone.status,
      },
      milestone.account,
      this.taskQueries,
    );
    this.milestoneQueries.markWorkflowTaskCreated(milestone.id);
    this.log(`[Workflow] Task created: ${milestone.account} — ${milestone.template_name} (due ${milestone.target_date})`);

    // 2. Check for linked ticket groups and create Jira tickets if applicable
    let ticketCount = 0;
    if (milestone.workflow_tickets_created === 0) {
      const linkedGroups = this.milestoneQueries.getTemplateTicketGroups(milestone.template_id);
      if (linkedGroups.length > 0 && milestone.sale_type && milestone.onboarding_id) {
        ticketCount = await this.createTicketsForMilestone(milestone, linkedGroups);
      }
    }

    return { taskCreated: true, ticketCount };
  }

  /** Create Jira tickets for a milestone's linked ticket groups */
  private async createTicketsForMilestone(milestone: WorkflowReadyMilestone, ticketGroupIds: number[]): Promise<number> {
    const orchestrator = this.getOrchestrator();
    if (!orchestrator) {
      this.log(`[Workflow] Orchestrator not available — skipping ticket creation for ${milestone.account} — ${milestone.template_name}`);
      return 0;
    }

    try {
      const result = await orchestrator.execute(
        {
          schemaVersion: 1,
          onboardingRef: milestone.onboarding_id!,
          saleType: milestone.sale_type!,
          customer: { name: milestone.account },
          targetDueDate: milestone.target_date || new Date().toISOString().split('T')[0],
          config: {},
        },
        { filterGroupIds: ticketGroupIds },
      );

      const jiraKeys = [result.parentKey, ...result.childKeys].filter(Boolean);
      this.milestoneQueries.markWorkflowTicketsCreated(milestone.id, jiraKeys);
      this.log(`[Workflow] Tickets created for ${milestone.account} — ${milestone.template_name}: ${jiraKeys.join(', ')}`);
      return result.createdCount;
    } catch (err) {
      this.log(`[Workflow] Ticket creation failed for ${milestone.account} — ${milestone.template_name}: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }

  /** Called when a milestone is marked complete — immediately evaluate the next one */
  async onMilestoneCompleted(milestoneId: number): Promise<void> {
    const milestone = this.milestoneQueries.getMilestoneById(milestoneId);
    if (!milestone) return;

    const nextMilestone = this.milestoneQueries.getNextMilestoneForDelivery(
      milestone.delivery_id,
      milestone.template_id,
    );

    if (!nextMilestone) {
      this.log(`[Workflow] No next milestone for delivery ${milestone.delivery_id} after ${milestone.template_name}`);
      return;
    }

    // Check if within lead time (or if it's already past due)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leadDays = nextMilestone.lead_days ?? 3;

    if (nextMilestone.target_date) {
      const target = new Date(nextMilestone.target_date);
      const triggerDate = new Date(target);
      triggerDate.setDate(triggerDate.getDate() - leadDays);

      if (today >= triggerDate) {
        // Within lead time — create the task now
        const entry = this.deliveryQueries.getById(milestone.delivery_id);
        if (entry) {
          const ready: WorkflowReadyMilestone = {
            ...nextMilestone,
            account: entry.account,
            product: entry.product,
            sale_type: entry.sale_type,
            onboarding_id: entry.onboarding_id,
            onboarder: entry.onboarder,
          };
          await this.processMilestone(ready);
        }
      } else {
        this.log(`[Workflow] Next milestone "${nextMilestone.template_name}" not yet within lead time (triggers ${triggerDate.toISOString().split('T')[0]})`);
      }
    }
  }
}
