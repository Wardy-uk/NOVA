/**
 * Problem Ticket Scanner — AI + rule-based detection of Jira tickets at risk.
 *
 * Scans open Jira tickets every 15 minutes (or on demand), evaluates them
 * against configurable rules, optionally runs LLM sentiment on comments,
 * and upserts alerts with severity P1/P2/P3.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { JiraRestClient, type JiraIssue, type JiraComment } from './jira-client.js';
import {
  isResolutionSlaBreached,
  isSlaNearBreach,
  getSlaRemainingMs,
  isOverdueUpdate,
} from './jira-sla.js';
import type {
  ProblemTicketQueries,
  ProblemTicketConfigRow,
  ProblemTicketAlertReason,
} from '../db/queries.js';
import type { LlmService } from './llm-service.js';

// ── Types ──

export interface ScanResult {
  scannedTickets: number;
  alertsCreated: number;
  alertsUpdated: number;
  alertsResolved: number;
  ignoresLifted: number;
  bySeverity: { P1: number; P2: number; P3: number };
  durationMs: number;
  error?: string;
}

interface RuleResult {
  triggered: boolean;
  label: string;
  detail: string | null;
}

interface SettingsAccessor {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

interface UserSettingsAccessor {
  get(userId: number, key: string): string | null;
}

const AnalysisItem = z.object({
  issueKey: z.string(),
  sentimentScore: z.number().min(-1).max(1),
  sentimentSummary: z.string(),
  commitmentDate: z.string().nullable(),
  followedUp: z.boolean(),
  commitmentQuote: z.string().nullable().default(null),
});

const AnalysisBatchSchema = z.any().transform((val): { results: z.infer<typeof AnalysisItem>[] } => {
  if (Array.isArray(val)) return { results: val };
  if (val?.results && Array.isArray(val.results)) return { results: val.results };
  return { results: [] };
}).pipe(z.object({ results: z.array(AnalysisItem) }));
type AnalysisBatch = { results: z.infer<typeof AnalysisItem>[] };

// ── Helpers ──

/** Extract a usable English status name from Jira's status field.
 *  Jira may return localized names (e.g. "打开" for "Open") depending on
 *  the API user's locale. Fall back to statusCategory.name or key. */
function resolveStatusName(statusField: unknown): string | null {
  if (!statusField || typeof statusField !== 'object') return null;
  const s = statusField as Record<string, unknown>;
  const name = typeof s.name === 'string' ? s.name : null;

  // If the name is ASCII, it's likely English — use it as-is
  if (name && /^[\x20-\x7E]+$/.test(name)) return name;

  // Non-ASCII (localized) — prefer statusCategory
  const cat = s.statusCategory as Record<string, unknown> | undefined;
  if (cat) {
    const catName = typeof cat.name === 'string' ? cat.name : null;
    if (catName && /^[\x20-\x7E]+$/.test(catName)) return catName;
    // Last resort: category key (new, indeterminate, done)
    const catKey = typeof cat.key === 'string' ? cat.key : null;
    if (catKey) {
      const keyMap: Record<string, string> = { new: 'Open', indeterminate: 'In Progress', done: 'Done' };
      return keyMap[catKey] ?? catKey;
    }
  }

  return name; // Return whatever we have, even if localized
}

/** Extract plain text from ADF body (Atlassian Document Format) */
function adfToText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const doc = body as Record<string, unknown>;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return '';

  const parts: string[] = [];
  function walk(nodes: unknown[]) {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as Record<string, unknown>;
      if (n.type === 'text' && typeof n.text === 'string') {
        parts.push(n.text);
      }
      if (Array.isArray(n.content)) walk(n.content);
    }
  }
  walk(doc.content as unknown[]);
  return parts.join(' ');
}

/** Compute a SHA-256 fingerprint of material ticket fields */
function computeFingerprint(issue: JiraIssue, commentCount: number, reopened: boolean): string {
  const fields = issue.fields;
  const priority = (fields.priority as any)?.name ?? '';
  const status = resolveStatusName(fields.status) ?? '';
  const assignee = (fields.assignee as any)?.displayName ?? '';
  const slaRemaining = getSlaRemainingMs(issue as any) ?? 'none';

  const data = `${priority}|${status}|${assignee}|${slaRemaining}|${commentCount}|${reopened}`;
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// ── Scanner ──

export class ProblemTicketScanner {
  private scanning = false;
  public lastResult: ScanResult | null = null;

  /** Whether a scan is currently in progress */
  get isScanning(): boolean { return this.scanning; }

  constructor(
    private jira: JiraRestClient | null,
    private queries: ProblemTicketQueries,
    private settings: SettingsAccessor,
    private userSettings?: UserSettingsAccessor,
    private llmService?: LlmService,
  ) {}

  /** Update the Jira client (e.g. after OAuth token refresh) */
  setJiraClient(client: JiraRestClient | null) {
    this.jira = client;
  }

  async scan(): Promise<ScanResult> {
    const start = Date.now();
    if (this.scanning) {
      return { scannedTickets: 0, alertsCreated: 0, alertsUpdated: 0, alertsResolved: 0, ignoresLifted: 0, bySeverity: { P1: 0, P2: 0, P3: 0 }, durationMs: 0, error: 'Scan already in progress' };
    }
    if (!this.jira) {
      return { scannedTickets: 0, alertsCreated: 0, alertsUpdated: 0, alertsResolved: 0, ignoresLifted: 0, bySeverity: { P1: 0, P2: 0, P3: 0 }, durationMs: 0, error: 'No Jira client configured' };
    }

    this.scanning = true;
    const scanId = `scan_${Date.now()}`;

    try {
      // Load config
      const configRows = await this.queries.getConfig();
      const config = new Map<string, ProblemTicketConfigRow>();
      for (const row of configRows) config.set(row.rule, row);

      // Build JQL — same filters as the All Tickets SD view
      const parts: string[] = [];

      // Project filter (prefer SD project, fallback to problem_ticket_projects/onboarding)
      const sdProject = this.settings.get('jira_sd_project');
      if (sdProject) {
        parts.push(`project = ${sdProject}`);
      } else {
        const projectFilter = this.settings.get('problem_ticket_projects')
          ?? this.settings.get('jira_onboarding_project')
          ?? '';
        const projects = projectFilter.split(',').map(p => p.trim()).filter(Boolean);
        if (projects.length > 0) {
          parts.push(`project IN (${projects.map(p => `"${p}"`).join(',')})`);
        }
      }

      // Tier exclusion filter (same as SD view)
      const sdTiers = this.settings.get('jira_sd_tiers');
      if (sdTiers) {
        const tierValues = sdTiers.split(',').map(t => `"${t.trim()}"`).join(', ');
        parts.push(`"Current Tier" NOT IN (${tierValues})`);
      }

      parts.push('status NOT IN (Done, Closed, Resolved)');

      // Fetch all open tickets with pagination
      const jql = parts.join(' AND ') + ' ORDER BY created DESC';
      const fields = [
        'summary', 'status', 'priority', 'assignee', 'reporter', 'created', 'updated',
        'comment', 'issuelinks',
        'customfield_14048', 'customfield_14081', 'customfield_14185',
      ];

      const allIssues: JiraIssue[] = [];
      let nextPageToken: string | undefined;
      const pageSize = 100;

      while (true) {
        const result = await this.jira.searchJql(jql, fields, pageSize, {
          nextPageToken,
          expand: ['changelog'],
        });
        allIssues.push(...result.issues);
        if (result.isLast !== false || result.issues.length === 0 || !result.nextPageToken) break;
        nextPageToken = result.nextPageToken;
      }

      console.log(`[ProblemTicketScanner] Scanning ${allIssues.length} open tickets...`);

      const now = new Date();
      let alertsCreated = 0;
      let alertsUpdated = 0;
      let ignoresLifted = 0;
      const severity: Record<string, number> = { P1: 0, P2: 0, P3: 0 };
      const activeIssueKeys: string[] = [];

      // Collect tickets that need sentiment analysis
      const needsSentiment: Array<{ issue: JiraIssue; reasons: Omit<ProblemTicketAlertReason, 'alert_id'>[] }> = [];

      for (const issue of allIssues) {
        const reasons: Omit<ProblemTicketAlertReason, 'alert_id'>[] = [];
        let score = 0;

        // Extract changelog for ping-pong / reopened / stagnant detection
        const changelog = (issue as any).changelog as { histories?: Array<{ created: string; items: Array<{ field: string; fromString: string; toString: string }> }> } | undefined;
        const histories = changelog?.histories ?? [];

        // Compute comment count for fingerprint
        const commentField = issue.fields.comment as { total?: number; comments?: unknown[] } | undefined;
        const commentCount = commentField?.total ?? commentField?.comments?.length ?? 0;

        // Detect reopened (status changed back from Done/Resolved)
        let reopened = false;
        for (const h of histories) {
          for (const item of h.items) {
            if (item.field === 'status' && (item.fromString?.toLowerCase().includes('done') || item.fromString?.toLowerCase().includes('resolved') || item.fromString?.toLowerCase().includes('closed'))) {
              reopened = true;
            }
          }
        }

        // Rule: sla_breached
        const slaBreachedConfig = config.get('sla_breached');
        if (slaBreachedConfig?.enabled && isResolutionSlaBreached(issue as any)) {
          const w = slaBreachedConfig.weight;
          reasons.push({ rule: 'sla_breached', label: 'SLA Breached', weight: w, detail: null });
          score += w;
        }

        // Rule: sla_near
        const slaNearConfig = config.get('sla_near');
        if (slaNearConfig?.enabled && isSlaNearBreach(issue as any)) {
          const remaining = getSlaRemainingMs(issue as any);
          const hours = remaining ? (remaining / (1000 * 60 * 60)).toFixed(1) : '?';
          reasons.push({ rule: 'sla_near', label: 'SLA Approaching Breach', weight: slaNearConfig.weight, detail: `${hours}h remaining` });
          score += slaNearConfig.weight;
        }

        // Rule: stale_comms
        const staleConfig = config.get('stale_comms');
        if (staleConfig?.enabled && isOverdueUpdate(issue as any, now)) {
          reasons.push({ rule: 'stale_comms', label: 'Stale Communications', weight: staleConfig.weight, detail: 'Agent update overdue' });
          score += staleConfig.weight;
        }

        // Rule: ticket_age
        const ageConfig = config.get('ticket_age');
        if (ageConfig?.enabled) {
          const threshold = JSON.parse(ageConfig.threshold_json ?? '{}');
          const daysThr = threshold.daysThreshold ?? 7;
          const created = issue.fields.created ? new Date(issue.fields.created as string) : null;
          if (created) {
            const ageDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays >= daysThr) {
              reasons.push({ rule: 'ticket_age', label: 'Ticket Age', weight: ageConfig.weight, detail: `${Math.floor(ageDays)} days old` });
              score += ageConfig.weight;
            }
          }
        }

        // Rule: ping_pong
        const ppConfig = config.get('ping_pong');
        if (ppConfig?.enabled) {
          const threshold = JSON.parse(ppConfig.threshold_json ?? '{}');
          const reassignThr = threshold.reassignThreshold ?? 3;
          const windowHours = threshold.windowHours ?? 48;
          const windowMs = windowHours * 60 * 60 * 1000;
          const cutoff = now.getTime() - windowMs;

          let reassignCount = 0;
          for (const h of histories) {
            if (new Date(h.created).getTime() < cutoff) continue;
            for (const item of h.items) {
              if (item.field === 'assignee') reassignCount++;
            }
          }

          if (reassignCount >= reassignThr) {
            reasons.push({ rule: 'ping_pong', label: 'Assignee Ping-Pong', weight: ppConfig.weight, detail: `${reassignCount} reassignments in ${windowHours}h` });
            score += ppConfig.weight;
          }
        }

        // Rule: reopened
        const reopenConfig = config.get('reopened');
        if (reopenConfig?.enabled && reopened) {
          reasons.push({ rule: 'reopened', label: 'Ticket Reopened', weight: reopenConfig.weight, detail: null });
          score += reopenConfig.weight;
        }

        // Rule: high_priority
        const hpConfig = config.get('high_priority');
        if (hpConfig?.enabled) {
          const threshold = JSON.parse(hpConfig.threshold_json ?? '{}');
          const priorities: string[] = threshold.priorities ?? ['Highest', 'High'];
          const priorityName = (issue.fields.priority as any)?.name ?? '';
          if (priorities.includes(priorityName)) {
            reasons.push({ rule: 'high_priority', label: 'High Priority', weight: hpConfig.weight, detail: priorityName });
            score += hpConfig.weight;
          }
        }

        // Rule: stagnant_status
        const stagnantConfig = config.get('stagnant_status');
        if (stagnantConfig?.enabled) {
          const threshold = JSON.parse(stagnantConfig.threshold_json ?? '{}');
          const daysThr = threshold.daysThreshold ?? 5;

          // Find last status change
          let lastStatusChange: Date | null = null;
          for (const h of histories) {
            for (const item of h.items) {
              if (item.field === 'status') {
                const d = new Date(h.created);
                if (!lastStatusChange || d > lastStatusChange) lastStatusChange = d;
              }
            }
          }

          if (lastStatusChange) {
            const daysStagnant = (now.getTime() - lastStatusChange.getTime()) / (1000 * 60 * 60 * 24);
            if (daysStagnant >= daysThr) {
              reasons.push({ rule: 'stagnant_status', label: 'Status Stagnant', weight: stagnantConfig.weight, detail: `Status unchanged for ${Math.floor(daysStagnant)} days` });
              score += stagnantConfig.weight;
            }
          } else {
            // No status change in history — use created date
            const created = issue.fields.created ? new Date(issue.fields.created as string) : null;
            if (created) {
              const days = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
              if (days >= daysThr) {
                reasons.push({ rule: 'stagnant_status', label: 'Status Stagnant', weight: stagnantConfig.weight, detail: `Status unchanged since creation (${Math.floor(days)} days)` });
                score += stagnantConfig.weight;
              }
            }
          }
        }

        // Cap score at 100
        score = Math.min(100, score);

        // Determine severity (skip if below threshold)
        if (score < 15) continue;

        const sev = score >= 60 ? 'P1' : score >= 35 ? 'P2' : 'P3';

        // Queue for sentiment if at least one deterministic rule triggered
        const sentimentConfig = config.get('sentiment');
        if (sentimentConfig?.enabled && reasons.length > 0) {
          needsSentiment.push({ issue, reasons });
        }

        // Compute fingerprint
        const fingerprint = computeFingerprint(issue, commentCount, reopened);

        // Check if ignore should be lifted
        const activeIgnores = (await this.queries.getIgnoresForIssue(issue.key))
          .filter(i => !i.lifted_at);
        for (const ig of activeIgnores) {
          if (ig.fingerprint_at_ignore !== fingerprint) {
            // Material change detected — lift ignore
            const changes: string[] = [];
            const existingAlert = await this.queries.getAlertByIssueKey(issue.key);
            if (existingAlert) {
              if (existingAlert.priority !== ((issue.fields.priority as any)?.name ?? null)) changes.push('priority changed');
              if (existingAlert.status !== (resolveStatusName(issue.fields.status) ?? null)) changes.push('status changed');
              if (existingAlert.assignee !== ((issue.fields.assignee as any)?.displayName ?? null)) changes.push('reassigned');
            }
            if (reopened) changes.push('reopened');
            await this.queries.liftIgnore(issue.key, changes.length > 0 ? changes.join(', ') : 'material change detected');
            ignoresLifted++;
          }
        }

        // Check if currently ignored (after potential lift)
        const stillIgnored = (await this.queries.getIgnoresForIssue(issue.key))
          .some(i => !i.lifted_at && i.fingerprint_at_ignore === fingerprint);

        // Determine if this is create vs update
        const existing = await this.queries.getAlertByIssueKey(issue.key);

        // Upsert alert (even if ignored, so fingerprint stays current)
        await this.queries.upsertAlert({
          issue_key: issue.key,
          project_key: issue.key.split('-')[0],
          summary: (issue.fields.summary as string) ?? '',
          status: resolveStatusName(issue.fields.status) ?? null,
          priority: (issue.fields.priority as any)?.name ?? null,
          assignee: (issue.fields.assignee as any)?.displayName ?? null,
          reporter: (issue.fields.reporter as any)?.displayName ?? null,
          created_at: (issue.fields.created as string) ?? null,
          severity: sev,
          score,
          fingerprint,
          sla_remaining_ms: getSlaRemainingMs(issue as any),
          sentiment_score: null,
          sentiment_summary: null,
          scan_id: scanId,
        }, reasons);

        if (!stillIgnored) {
          activeIssueKeys.push(issue.key);
          severity[sev] = (severity[sev] ?? 0) + 1;
        }

        if (existing) alertsUpdated++;
        else alertsCreated++;
      }

      // Run combined sentiment + commitment analysis (single LLM call per batch)
      await this.runAnalysisBatch(needsSentiment, config.get('sentiment'), config.get('missed_commitment'));

      // Run "no next reply" analysis — customer waiting for agent response
      await this.runNoReplyAnalysis(allIssues, config.get('no_next_reply'), scanId, now);

      // Mark resolved — alerts not seen in this scan
      const allAlertedKeys = allIssues.filter(i => {
        // Only include issues that scored >= 15
        return activeIssueKeys.includes(i.key);
      }).map(i => i.key);
      const resolved = await this.queries.markResolved(allAlertedKeys);

      // Cleanup old resolved alerts (30 days)
      await this.queries.cleanupOld(30);

      const duration = Date.now() - start;
      console.log(`[ProblemTicketScanner] Scan complete: ${allIssues.length} tickets, ${alertsCreated} new, ${alertsUpdated} updated, ${resolved} resolved, ${ignoresLifted} ignores lifted (${duration}ms)`);

      // Record scan timestamp (independent of whether alerts were created)
      this.settings.set('problem_ticket_last_scan', new Date().toISOString());

      const result: ScanResult = {
        scannedTickets: allIssues.length,
        alertsCreated,
        alertsUpdated,
        alertsResolved: resolved,
        ignoresLifted,
        bySeverity: { P1: severity['P1'] ?? 0, P2: severity['P2'] ?? 0, P3: severity['P3'] ?? 0 },
        durationMs: duration,
      };
      this.lastResult = result;
      return result;
    } catch (err: any) {
      console.error('[ProblemTicketScanner] Scan failed:', err.message);
      const result: ScanResult = {
        scannedTickets: 0,
        alertsCreated: 0,
        alertsUpdated: 0,
        alertsResolved: 0,
        ignoresLifted: 0,
        bySeverity: { P1: 0, P2: 0, P3: 0 },
        durationMs: Date.now() - start,
        error: err.message,
      };
      this.lastResult = result;
      return result;
    } finally {
      this.scanning = false;
    }
  }

  /** Combined sentiment + commitment analysis in a single LLM call per batch, with dedup */
  private async runAnalysisBatch(
    tickets: Array<{ issue: JiraIssue; reasons: Omit<ProblemTicketAlertReason, 'alert_id'>[] }>,
    sentimentConfig: ProblemTicketConfigRow | undefined,
    commitmentConfig: ProblemTicketConfigRow | undefined,
  ): Promise<void> {
    const sentimentEnabled = sentimentConfig?.enabled ?? false;
    const commitmentEnabled = commitmentConfig?.enabled ?? false;
    if ((!sentimentEnabled && !commitmentEnabled) || !this.jira || !this.llmService || tickets.length === 0) return;

    const threshold = JSON.parse(sentimentConfig?.threshold_json ?? '{}');
    const negativeThreshold = threshold.negativeThreshold ?? -0.3;
    const today = new Date().toISOString().slice(0, 10);

    // Dedup: skip tickets that haven't been updated since last analysis
    const needsAnalysis: typeof tickets = [];
    for (const t of tickets) {
      const alert = await this.queries.getAlertByIssueKey(t.issue.key);
      const jiraUpdated = t.issue.fields.updated as string | undefined;
      if (alert?.last_analysed_at && jiraUpdated) {
        if (new Date(jiraUpdated) <= new Date(alert.last_analysed_at)) continue;
      }
      needsAnalysis.push(t);
    }

    const skipped = tickets.length - needsAnalysis.length;
    if (skipped > 0) {
      console.log(`[ProblemTicketScanner] Dedup: skipped ${skipped}/${tickets.length} tickets (unchanged since last analysis)`);
    }
    if (needsAnalysis.length === 0) return;

    const batchSize = 10;
    for (let i = 0; i < needsAnalysis.length; i += batchSize) {
      const batch = needsAnalysis.slice(i, i + batchSize);

      const ticketComments: Array<{ issueKey: string; comments: string }> = [];
      for (const { issue } of batch) {
        try {
          const comments = await this.jira.getComments(issue.key, 10);
          const text = comments
            .map((c: JiraComment) => `[${c.author.displayName} — ${c.created}]: ${adfToText(c.body)}`)
            .join('\n');
          if (text.trim()) {
            ticketComments.push({ issueKey: issue.key, comments: text });
          }
        } catch {
          // Skip if comments fail
        }
      }

      if (ticketComments.length === 0) continue;

      try {
        const prompt = ticketComments
          .map(tc => `--- ${tc.issueKey} ---\n${tc.comments}`)
          .join('\n\n');

        const result = await this.llmService.call<AnalysisBatch>(
          `You analyse Jira service desk ticket comments. For each ticket, provide BOTH:

1. **Sentiment**: Score the customer's tone from -1.0 (very angry) to 1.0 (very happy). Focus on customer comments, not agent comments. If no customer comments, score 0.

2. **Missed commitments**: Check if any agent/support staff promised an update by a specific date that has now passed without follow-up.
Today's date is ${today}.
- Look for agent promises like "will update by Friday", "get back to you by 15th March"
- Resolve relative dates using the comment timestamp
- followedUp = true if any agent commented AFTER the commitment date
- If no commitment found or it was followed up, set commitmentDate to null`,
          prompt,
          AnalysisBatchSchema,
          { temperature: 0.3, callType: 'ticket_analysis' },
        );

        const analysedKeys: string[] = [];

        for (const entry of result.data.results) {
          const alert = await this.queries.getAlertByIssueKey(entry.issueKey);
          if (!alert) continue;

          analysedKeys.push(entry.issueKey);
          let extraScore = 0;
          const reasons = alert.reasons ?? [];

          // Sentiment scoring
          if (sentimentEnabled) {
            const sentimentScore = Math.max(-1, Math.min(1, entry.sentimentScore));
            if (sentimentScore <= negativeThreshold) {
              extraScore += sentimentConfig!.weight;
              reasons.push({
                rule: 'sentiment',
                label: 'Negative Sentiment',
                weight: sentimentConfig!.weight,
                detail: entry.sentimentSummary,
              });
            }

            if (extraScore > 0 || sentimentScore !== 0) {
              alert.sentiment_score = sentimentScore;
              alert.sentiment_summary = entry.sentimentSummary;
            }
          }

          // Commitment scoring
          if (commitmentEnabled && entry.commitmentDate && !entry.followedUp && entry.commitmentDate <= today) {
            extraScore += commitmentConfig!.weight;
            reasons.push({
              rule: 'missed_commitment',
              label: 'Missed Commitment',
              weight: commitmentConfig!.weight,
              detail: `Promised update by ${entry.commitmentDate}${entry.commitmentQuote ? `: "${entry.commitmentQuote}"` : ''}`,
            });
          }

          if (extraScore > 0 || alert.sentiment_score !== null) {
            const newScore = Math.min(100, alert.score + extraScore);
            const newSeverity = newScore >= 60 ? 'P1' : newScore >= 35 ? 'P2' : 'P3';
            await this.queries.upsertAlert({ ...alert, score: newScore, severity: newSeverity }, reasons);
          }
        }

        if (analysedKeys.length > 0) {
          await this.queries.markAnalysed(analysedKeys);
        }
      } catch (err: any) {
        console.warn(`[ProblemTicketScanner] Analysis batch failed:`, err.message);
      }
    }
  }

  /** Check for tickets where the customer replied but the agent hasn't responded */
  private async runNoReplyAnalysis(
    allIssues: JiraIssue[],
    noReplyConfig: ProblemTicketConfigRow | undefined,
    scanId: string,
    now: Date,
  ): Promise<void> {
    if (!noReplyConfig?.enabled || !this.jira) return;

    const threshold = JSON.parse(noReplyConfig.threshold_json ?? '{}');
    const hoursThreshold = threshold.hoursThreshold ?? 4;
    const staffDomains: string[] = threshold.staffDomains ?? ['nurtur'];
    const thresholdMs = hoursThreshold * 60 * 60 * 1000;

    // Only check tickets that have comments
    const withComments = allIssues.filter(issue => {
      const cf = issue.fields.comment as { total?: number; comments?: unknown[] } | undefined;
      return (cf?.total ?? cf?.comments?.length ?? 0) > 0;
    });

    if (withComments.length === 0) return;

    console.log(`[ProblemTicketScanner] No-reply analysis: checking ${withComments.length} tickets with comments...`);

    let triggered = 0;

    // Process in batches to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < withComments.length; i += batchSize) {
      const batch = withComments.slice(i, i + batchSize);

      for (const issue of batch) {
        try {
          const comments = await this.jira.getComments(issue.key, 10);
          if (comments.length === 0) continue;

          const reporterEmail = ((issue.fields.reporter as any)?.emailAddress ?? '').toLowerCase();
          const assigneeEmail = ((issue.fields.assignee as any)?.emailAddress ?? '').toLowerCase();

          // Sort ascending by created
          const sorted = [...comments].sort((a, b) =>
            new Date(a.created).getTime() - new Date(b.created).getTime()
          );

          // Walk from most recent to find the last customer comment
          let lastCustomerComment: JiraComment | null = null;
          let agentRepliedAfter = false;

          for (let j = sorted.length - 1; j >= 0; j--) {
            const c = sorted[j];
            const authorEmail = (c.author.emailAddress ?? '').toLowerCase();
            const isStaff = authorEmail === assigneeEmail ||
              staffDomains.some(d => authorEmail.includes(`@${d}`));

            if (!isStaff) {
              // This is a customer/external comment
              if (!lastCustomerComment) {
                lastCustomerComment = c;
              }
            } else if (lastCustomerComment) {
              // Found a staff comment that's newer than the customer comment?
              // No — we're walking backwards, so if we already found a customer comment
              // and now hit a staff comment, the staff comment is OLDER. Keep looking.
            }
          }

          if (!lastCustomerComment) continue;

          // Check if any agent/staff replied AFTER the customer comment
          const customerTime = new Date(lastCustomerComment.created).getTime();
          for (const c of sorted) {
            const authorEmail = (c.author.emailAddress ?? '').toLowerCase();
            const isStaff = authorEmail === assigneeEmail ||
              staffDomains.some(d => authorEmail.includes(`@${d}`));

            if (isStaff && new Date(c.created).getTime() > customerTime) {
              agentRepliedAfter = true;
              break;
            }
          }

          if (agentRepliedAfter) continue;

          // Check elapsed time
          const elapsedMs = now.getTime() - customerTime;
          if (elapsedMs < thresholdMs) continue;

          const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
          const detail = elapsedHours >= 24
            ? `${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h since customer replied`
            : `${elapsedHours}h since customer replied`;

          // Get or create the alert for this issue
          const existing = await this.queries.getAlertByIssueKey(issue.key);

          if (existing) {
            // Add no_next_reply reason to existing alert
            const alreadyHasRule = existing.reasons?.some(r => r.rule === 'no_next_reply');
            if (!alreadyHasRule) {
              const newScore = Math.min(100, existing.score + noReplyConfig.weight);
              const newSeverity = newScore >= 60 ? 'P1' : newScore >= 35 ? 'P2' : 'P3';
              const reasons = [...(existing.reasons ?? []), {
                rule: 'no_next_reply',
                label: 'Customer Waiting',
                weight: noReplyConfig.weight,
                detail,
              }];
              await this.queries.upsertAlert({
                ...existing,
                score: newScore,
                severity: newSeverity,
                scan_id: scanId,
              }, reasons);
              triggered++;
            }
          } else {
            // Create new alert solely from this rule
            const score = noReplyConfig.weight;
            if (score >= 15) {
              const sev = score >= 60 ? 'P1' : score >= 35 ? 'P2' : 'P3';
              const commentCount = (issue.fields.comment as any)?.total ?? comments.length;
              const fingerprint = computeFingerprint(issue, commentCount, false);

              await this.queries.upsertAlert({
                issue_key: issue.key,
                project_key: issue.key.split('-')[0],
                summary: (issue.fields.summary as string) ?? '',
                status: resolveStatusName(issue.fields.status) ?? null,
                priority: (issue.fields.priority as any)?.name ?? null,
                assignee: (issue.fields.assignee as any)?.displayName ?? null,
                reporter: (issue.fields.reporter as any)?.displayName ?? null,
                created_at: (issue.fields.created as string) ?? null,
                severity: sev,
                score,
                fingerprint,
                sla_remaining_ms: getSlaRemainingMs(issue as any),
                sentiment_score: null,
                sentiment_summary: null,
                scan_id: scanId,
              }, [{
                rule: 'no_next_reply',
                label: 'Customer Waiting',
                weight: noReplyConfig.weight,
                detail,
              }]);
              triggered++;
            }
          }
        } catch (err: any) {
          // Skip individual ticket failures
          console.warn(`[ProblemTicketScanner] No-reply check failed for ${issue.key}:`, err.message);
        }
      }
    }

    if (triggered > 0) {
      console.log(`[ProblemTicketScanner] No-reply analysis: ${triggered} tickets flagged`);
    }
  }
}
