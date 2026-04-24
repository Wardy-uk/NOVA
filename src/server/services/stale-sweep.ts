import type { JiraRestClient, JiraIssue } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { AgentDecision } from './agent-types.js';
import { ChaseResultSchema, type ChaseResult } from './chase-schema.js';
import { loadPrompt } from './prompt-loader.js';

const DEFAULT_AI_REQUEST_STALE_HOURS = 2;
const DEFAULT_WOR_CHASE_DAYS = 5;
const DEFAULT_WOR_CLOSE_DAYS = 10;

const DEFAULT_FIELDS = [
  'summary', 'description', 'status', 'priority', 'issuetype',
  'assignee', 'reporter', 'created', 'updated', 'customfield_10020',
  'customfield_10010', 'labels', 'resolution', 'comment',
];

export interface SweepResult {
  aiRequestStuck: AgentDecision[];
  worChase: AgentDecision[];
  worAutoClose: AgentDecision[];
}

export class StaleSweep {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;
  private llmService: LlmService | null;

  constructor(jiraClient: JiraRestClient, settings: SettingsQueries, llmService?: LlmService) {
    this.jiraClient = jiraClient;
    this.settings = settings;
    this.llmService = llmService ?? null;
  }

  async sweep(): Promise<SweepResult> {
    const project = this.settings.get('agent_jira_project') ?? 'NT';
    const now = new Date();

    const aiStaleHours = this.getNumber('agent_sweep_ai_request_hours', DEFAULT_AI_REQUEST_STALE_HOURS);
    const chaseDays = this.getNumber('agent_sweep_wor_chase_days', DEFAULT_WOR_CHASE_DAYS);
    const closeDays = this.getNumber('agent_sweep_wor_close_days', DEFAULT_WOR_CLOSE_DAYS);

    const aiCutoff = new Date(now.getTime() - aiStaleHours * 60 * 60 * 1000);
    const chaseCutoff = new Date(now.getTime() - chaseDays * 24 * 60 * 60 * 1000);
    const closeCutoff = new Date(now.getTime() - closeDays * 24 * 60 * 60 * 1000);

    const [aiRequestResult, worResult] = await Promise.all([
      this.jiraClient.searchJqlAll(
        `project = ${project} AND status = "AI Request" AND updated <= "${formatJqlDate(aiCutoff)}" ORDER BY updated ASC`,
        DEFAULT_FIELDS,
        50,
      ),
      this.jiraClient.searchJqlAll(
        `project = ${project} AND status = "Waiting On Requestor" AND updated <= "${formatJqlDate(chaseCutoff)}" ORDER BY updated ASC`,
        DEFAULT_FIELDS,
        100,
      ),
    ]);

    const aiRequestStuck = aiRequestResult.issues.map(issue =>
      this.buildSweepDecision(issue, 'assign', 'stale',
        `Ticket stuck as "AI Request" for ${this.hoursAgo(issue, now)}h with no activity. Auto-assigning via Round Robin.`,
        `🤖 Stale Ticket Sweep\n\nThis ticket has been in "AI Request" status for ${this.hoursAgo(issue, now)} hours with no activity. Assigning to next available agent via Round Robin.`,
      )
    );

    const worChase: AgentDecision[] = [];
    const worAutoClose: AgentDecision[] = [];

    for (const issue of worResult.issues) {
      const updatedAt = new Date((issue.fields.updated as string) ?? '');
      if (updatedAt.getTime() <= closeCutoff.getTime()) {
        worAutoClose.push(this.buildSweepDecision(issue, 'transition', 'stale',
          `No customer reply for ${this.daysAgo(issue, now)} days (threshold: ${closeDays}). Auto-closing per SOP-003.`,
          `🤖 Stale Ticket Sweep\n\nNo customer reply for ${this.daysAgo(issue, now)} days. Closing per SOP-003 (auto-close after ${closeDays} days waiting on requestor).\n\nIf you still need help with this issue, please raise a new ticket or reply to reopen.`,
        ));
      } else {
        const chaseDecision = await this.buildChaseDecision(issue, now, chaseDays);
        worChase.push(chaseDecision);
      }
    }

    console.log(`[sweep] Found: ${aiRequestStuck.length} AI Request stuck, ${worChase.length} WOR chase, ${worAutoClose.length} WOR auto-close`);
    return { aiRequestStuck, worChase, worAutoClose };
  }

  private async buildChaseDecision(issue: JiraIssue, now: Date, chaseDays: number): Promise<AgentDecision> {
    const daysWaiting = this.daysAgo(issue, now);
    const f = issue.fields;
    const ticketKey = issue.key;

    // Try LLM-drafted chase message
    if (this.llmService) {
      try {
        const conversationThread = this.extractConversation(issue);

        const systemPrompt = loadPrompt('chase', {
          ticket_key: ticketKey,
          summary: (f.summary as string) ?? ticketKey,
          description: ((f.description as string) ?? '').slice(0, 500),
          priority: (f.priority as any)?.name ?? 'Medium',
          reporter: (f.reporter as any)?.displayName ?? 'Unknown',
          organisation: (f.reporter as any)?.emailAddress?.split('@')[1] ?? 'Unknown',
          status: (f.status as any)?.name ?? 'Unknown',
          days_waiting: String(daysWaiting),
          conversation_thread: conversationThread || '(no comments)',
        });

        const result = await this.llmService.call<ChaseResult>(
          systemPrompt,
          'Draft a contextual follow-up message for this stale ticket.',
          ChaseResultSchema,
          { ticketId: ticketKey, callType: 'chase', temperature: 0.3 },
        );

        const decision = this.buildSweepDecision(issue, 'chase', 'stale',
          `No customer reply for ${daysWaiting} days (threshold: ${chaseDays}). LLM-drafted chase (${result.data.tone_check}).`,
          `🤖 Stale Ticket Sweep\n\nNo customer reply for ${daysWaiting} days. Sending LLM-drafted follow-up to requestor.`,
        );
        decision.output.draft_response = result.data.draft_response;
        decision.provider = result.provider;
        decision.model = result.model;
        return decision;
      } catch (err) {
        console.warn(`[sweep] LLM chase draft failed for ${ticketKey}, using template:`, err instanceof Error ? err.message : err);
      }
    }

    // Fallback: template-based chase
    return this.buildSweepDecision(issue, 'chase', 'stale',
      `No customer reply for ${daysWaiting} days (threshold: ${chaseDays}). Sending chase message.`,
      `🤖 Stale Ticket Sweep\n\nNo customer reply for ${daysWaiting} days. Sending follow-up chase to requestor.`,
    );
  }

  private extractConversation(issue: JiraIssue): string {
    const comments = (issue.fields.comment as any)?.comments as Array<{
      author?: { displayName?: string };
      body?: string;
      created?: string;
    }> | undefined;
    if (!comments || comments.length === 0) return '';
    return comments
      .slice(-5) // last 5 comments
      .map(c => `[${c.created ?? ''}] ${c.author?.displayName ?? 'Unknown'}:\n${typeof c.body === 'string' ? c.body.slice(0, 300) : '(complex body)'}`)
      .join('\n\n---\n\n');
  }

  private buildSweepDecision(
    issue: JiraIssue,
    action: AgentDecision['action'],
    eventType: string,
    reasoning: string,
    internalNote: string,
  ): AgentDecision {
    const f = issue.fields;
    return {
      ticketId: issue.id,
      ticketKey: issue.key,
      eventType,
      action,
      confidence: 1.0,
      reasoning,
      approvalRequired: false,
      shadowMode: false,
      inputs: {
        summary: (f.summary as string) ?? '',
        status: (f.status as any)?.name ?? 'Unknown',
        priority: (f.priority as any)?.name ?? 'Medium',
        assignee: (f.assignee as any)?.displayName ?? null,
        reporter: (f.reporter as any)?.displayName ?? null,
        updated: (f.updated as string) ?? '',
        sweep_type: action === 'assign' ? 'ai_request_stuck' : action === 'chase' ? 'wor_chase' : 'wor_auto_close',
      },
      output: {
        internal_note: internalNote,
        sweep_action: action,
      },
    };
  }

  private hoursAgo(issue: JiraIssue, now: Date): number {
    const updated = new Date((issue.fields.updated as string) ?? '');
    return Math.round((now.getTime() - updated.getTime()) / (60 * 60 * 1000));
  }

  private daysAgo(issue: JiraIssue, now: Date): number {
    const updated = new Date((issue.fields.updated as string) ?? '');
    return Math.round((now.getTime() - updated.getTime()) / (24 * 60 * 60 * 1000));
  }

  private getNumber(key: string, fallback: number): number {
    const val = this.settings.get(key);
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? fallback : parsed;
  }
}

function formatJqlDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}
