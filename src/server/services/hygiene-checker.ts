import type { WorkingDayClock } from '../../shared/utils/workingDayClock.js';
import type { CachedIssue, CachedComment } from './jira-cache-queries.js';
import { query } from './database.js';

export interface HygieneCheck {
  id: string;
  label: string;
  passed: boolean;
  detail?: string;
}

export interface HygieneCheckResult {
  ticketKey: string;
  checks: HygieneCheck[];
  failCount: number;
}

export interface HygienePassResult {
  agentId: string;
  hourBlock: string;
  startedAt: string;
  completedAt: string;
  ticketCount: number;
  failedTickets: HygieneCheckResult[];
  passedCount: number;
}

interface RunPassInput {
  agentId: string;
  agentAccountId: string;
  tickets: CachedIssue[];
  getComments: (ticketKey: string) => Promise<CachedComment[]>;
  getAgentNextUpdate: (ticketKey: string) => Promise<Date | null>;
}

const WORKING_HOURS_PER_DAY = 8;
const STALE_WIP_DAYS = 3;
const CUSTOMER_WAIT_DAYS = 2;
const CHASE_DAYS = 2;
const CHASE_WARNING_DAYS = 4;
const CHASE_CLOSE_DAYS = 5;

export class HygieneChecker {
  private clock: WorkingDayClock;

  constructor(clock: WorkingDayClock) {
    this.clock = clock;
  }

  async runPass(input: RunPassInput): Promise<HygienePassResult> {
    const startedAt = new Date().toISOString();
    const now = new Date();
    const hourBlock = now.toISOString().slice(0, 13) + ':00';

    const results: HygieneCheckResult[] = [];

    for (const ticket of input.tickets) {
      const comments = await input.getComments(ticket.issue_key);
      const agentNextUpdate = await input.getAgentNextUpdate(ticket.issue_key);

      const checks: HygieneCheck[] = [
        this.checkStatusAccurate(ticket, comments, agentNextUpdate, now),
        this.checkCustomerWaiting(ticket, comments, agentNextUpdate, now),
        this.checkNextUpdateOverdue(ticket, agentNextUpdate, now),
        this.checkSlaRisk(ticket, now),
        await this.checkChaseCadence(ticket, comments, input.agentId, now),
        this.checkAssignedCorrectly(ticket, input.agentAccountId),
      ];

      const failCount = checks.filter(c => !c.passed).length;
      results.push({ ticketKey: ticket.issue_key, checks, failCount });
    }

    const failedTickets = results.filter(r => r.failCount > 0);

    return {
      agentId: input.agentId,
      hourBlock,
      startedAt,
      completedAt: new Date().toISOString(),
      ticketCount: input.tickets.length,
      failedTickets,
      passedCount: results.length - failedTickets.length,
    };
  }

  private checkStatusAccurate(
    ticket: CachedIssue,
    comments: CachedComment[],
    agentNextUpdate: Date | null,
    now: Date,
  ): HygieneCheck {
    const status = (ticket.status_name ?? '').toLowerCase();
    const check: HygieneCheck = { id: 'status_accurate', label: 'Status accurate', passed: true };

    if (status.includes('work in progress') || status.includes('in progress')) {
      const lastPublicComment = comments.find(c => c.is_public);
      if (lastPublicComment && !agentNextUpdate) {
        const hoursSince = this.clock.workingHoursBetween(
          new Date(lastPublicComment.jira_created), now,
        );
        if (hoursSince >= STALE_WIP_DAYS * WORKING_HOURS_PER_DAY) {
          check.passed = false;
          check.detail = `WIP but no public comment in ${Math.round(hoursSince / WORKING_HOURS_PER_DAY)}d — status may be stale`;
        }
      }
    }

    if (status.includes('waiting for customer') || status.includes('waiting on requestor')) {
      const lastPublicComment = comments.find(c => c.is_public);
      if (lastPublicComment && this.isCustomerComment(lastPublicComment, ticket)) {
        check.passed = false;
        check.detail = 'Customer replied but status still "Waiting for Customer"';
      }
    }

    return check;
  }

  private checkCustomerWaiting(
    ticket: CachedIssue,
    comments: CachedComment[],
    agentNextUpdate: Date | null,
    now: Date,
  ): HygieneCheck {
    const check: HygieneCheck = { id: 'customer_waiting', label: 'Customer not waiting too long', passed: true };

    const lastPublicComment = comments.find(c => c.is_public);
    if (lastPublicComment && this.isCustomerComment(lastPublicComment, ticket) && !agentNextUpdate) {
      const hoursSince = this.clock.workingHoursBetween(
        new Date(lastPublicComment.jira_created), now,
      );
      if (hoursSince >= CUSTOMER_WAIT_DAYS * WORKING_HOURS_PER_DAY) {
        check.passed = false;
        check.detail = `Customer waiting ${Math.round(hoursSince / WORKING_HOURS_PER_DAY)}d with no commitment set`;
      }
    }

    return check;
  }

  private checkNextUpdateOverdue(
    _ticket: CachedIssue,
    agentNextUpdate: Date | null,
    now: Date,
  ): HygieneCheck {
    const check: HygieneCheck = { id: 'next_update_overdue', label: 'Agent Next Update on time', passed: true };

    if (agentNextUpdate && agentNextUpdate.getTime() <= now.getTime()) {
      const hoursOverdue = this.clock.workingHoursBetween(agentNextUpdate, now);
      check.passed = false;
      check.detail = `Overdue by ${Math.round(hoursOverdue * 10) / 10} working hours`;
    }

    return check;
  }

  private checkSlaRisk(ticket: CachedIssue, now: Date): HygieneCheck {
    const check: HygieneCheck = { id: 'sla_risk', label: 'SLA not at risk', passed: true };

    if (ticket.sla_breach_time) {
      const breachAt = new Date(ticket.sla_breach_time);
      const minutesRemaining = (breachAt.getTime() - now.getTime()) / 60_000;
      if (minutesRemaining <= 60) {
        check.passed = false;
        if (minutesRemaining <= 0) {
          check.detail = `SLA breached ${Math.abs(Math.round(minutesRemaining))} mins ago`;
        } else {
          check.detail = `SLA breach in ${Math.round(minutesRemaining)} mins`;
        }
      }
    } else if (ticket.sla_breached) {
      check.passed = false;
      check.detail = 'SLA already breached';
    }

    return check;
  }

  private async checkChaseCadence(
    ticket: CachedIssue,
    comments: CachedComment[],
    agentId: string,
    now: Date,
  ): Promise<HygieneCheck> {
    const check: HygieneCheck = { id: 'chase_cadence', label: 'Chase cadence met', passed: true };
    const status = (ticket.status_name ?? '').toLowerCase();

    if (!(status.includes('waiting for customer') || status.includes('waiting on requestor'))) {
      return check;
    }

    const lastAgentComment = comments.find(c => c.is_public && !this.isCustomerComment(c, ticket));
    if (!lastAgentComment) return check;

    const hoursSince = this.clock.workingHoursBetween(
      new Date(lastAgentComment.jira_created), now,
    );
    const daysSince = hoursSince / WORKING_HOURS_PER_DAY;

    if (daysSince < CHASE_DAYS) return check;

    const recentChases = await query<{ id: number }>(
      `SELECT TOP 1 id FROM agent_events
       WHERE agent_id = ? AND ticket_key = ? AND event_type = 'action_taken'
         AND JSON_VALUE(payload, '$.action_type') = 'chase'
         AND created_at >= DATEADD(HOUR, -${CHASE_DAYS * WORKING_HOURS_PER_DAY}, SYSUTCDATETIME())`,
      [agentId, ticket.issue_key],
    );

    if (recentChases.length === 0) {
      check.passed = false;
      if (daysSince >= CHASE_CLOSE_DAYS) {
        check.detail = 'Day 5 close due';
      } else if (daysSince >= CHASE_WARNING_DAYS) {
        check.detail = 'Day 4 warning due';
      } else {
        check.detail = `Chase due — ${Math.round(daysSince)}d since last agent comment`;
      }
    }

    return check;
  }

  private checkAssignedCorrectly(
    ticket: CachedIssue,
    agentAccountId: string,
  ): HygieneCheck {
    const check: HygieneCheck = { id: 'assigned_correctly', label: 'Assigned correctly', passed: true };

    if (!ticket.assignee_account_id) {
      check.passed = false;
      check.detail = 'Ticket is unassigned';
    } else if (ticket.assignee_account_id !== agentAccountId) {
      check.passed = false;
      check.detail = `Assigned to ${ticket.assignee_display ?? 'another agent'}, not you`;
    }

    return check;
  }

  private isCustomerComment(comment: CachedComment, issue: CachedIssue): boolean {
    if (!comment.author_email) return false;
    return comment.author_email !== issue.assignee_email && comment.is_public;
  }
}
