import { query, execute, executeAndGetId } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';

// ── Types ──

export interface N8nGroundTruth {
  recommendedTier: string | null;
  priority: string | null;
  postedPublicReply: boolean;
  roundRobinAssigned: boolean;
  roundRobinAssignee: string | null;
}

export interface ComparisonEntry {
  id: number;
  ticket_key: string;
  nova_action: string | null;
  n8n_action: string | null;
  nova_confidence: number | null;
  agreement: boolean;
  diff_summary: string | null;
  n8n_raw_excerpt: string | null;
  n8n_recommended_tier: string | null;
  n8n_posted_reply: boolean;
  n8n_assigned: boolean;
  parser_version: number;
  created_at: string;
}

export interface ImprovementSignal {
  id: number;
  ticket_key: string;
  signal_type: string;
  ai_output: string | null;
  human_output: string | null;
  diff_summary: string | null;
  created_at: string;
}

export interface ImprovementStats {
  totalComparisons: number;
  agreementRate: number;
  totalSignals: number;
  signalsByType: Record<string, number>;
  recentDisagreements: ComparisonEntry[];
  recentSignals: ImprovementSignal[];
  comparableTicketsCount7d: number;
}

// ── ADF text extraction ──

function extractTextFromAdf(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return typeof adf === 'string' ? adf : '';
  const node = adf as Record<string, unknown>;
  let text = '';
  if (typeof node.text === 'string') text += node.text;
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      text += extractTextFromAdf(child);
      const type = (child as Record<string, unknown>)?.type;
      if (['paragraph', 'heading', 'listItem', 'tableRow', 'bulletList', 'orderedList'].includes(type as string)) {
        text += '\n';
      }
    }
  }
  if (node.type === 'hardBreak') text += '\n';
  return text;
}

// ── Multi-signal n8n classification (replaces parseN8nAction) ──

export function classifyN8nComments(
  comments: Array<{ body: string; jsdPublic: boolean | null; created: string }>,
): N8nGroundTruth {
  let recommendedTier: string | null = null;
  let priority: string | null = null;
  let postedPublicReply = false;
  let roundRobinAssigned = false;
  let roundRobinAssignee: string | null = null;

  for (const c of comments) {
    const body = c.body || '';

    if (body.includes('AI Summary') || body.includes('AI summary')) {
      const tierMatch = body.match(/\*\*Recommended Tier:\*\*\s*([^\n*]+)/i);
      const prioMatch = body.match(/\*\*Priority:\*\*\s*(Low|Medium|High|Critical)/i);
      if (tierMatch) recommendedTier = tierMatch[1].trim();
      if (prioMatch) priority = prioMatch[1].trim();
      continue;
    }

    if (/auto-assigned by|round robin/i.test(body)) {
      roundRobinAssigned = true;
      const assigneeMatch = body.match(/assigned (?:to|by[^.]*?to)\s+([^.(\n]+)/i)
        || body.match(/Auto-assigned[^:]*:\s*(.+)/i);
      if (assigneeMatch) roundRobinAssignee = assigneeMatch[1].trim();
      continue;
    }

    if (c.jsdPublic === true) {
      postedPublicReply = true;
      continue;
    }
  }

  return { recommendedTier, priority, postedPublicReply, roundRobinAssigned, roundRobinAssignee };
}

/** Map NOVA action + n8n ground truth → agreement boolean + explanation. */
export function compareActions(novaAction: string, gt: N8nGroundTruth): { agreement: boolean; reason: string } {
  const a = novaAction.toLowerCase();

  if (a === 'escalate' || a === 'escalate_to_t2' || a === 'escalate_to_t3') {
    const tier = (gt.recommendedTier ?? '').toLowerCase();
    const isHighTier = tier.includes('3') || tier.includes('development');
    if (isHighTier) return { agreement: true, reason: 'Both escalated (T3/Dev)' };
    return { agreement: false, reason: `NOVA escalated but n8n recommended "${gt.recommendedTier || 'unknown'}"` };
  }

  if (a === 'draft_response' || a === 'respond') {
    if (gt.postedPublicReply) return { agreement: true, reason: 'Both responded publicly' };
    if (gt.roundRobinAssigned) return { agreement: true, reason: 'NOVA drafted response; n8n assigned (complementary)' };
    return { agreement: true, reason: 'NOVA drafted; n8n took no public action (proactive)' };
  }

  if (a === 'assign' || a === 'round_robin') {
    if (gt.roundRobinAssigned) return { agreement: true, reason: 'Both assigned' };
    return { agreement: false, reason: 'NOVA assigned but n8n did not' };
  }

  if (a === 'close' || a === 'auto_resolve') {
    if (!gt.postedPublicReply && !gt.roundRobinAssigned) return { agreement: true, reason: 'Both took no action / closed' };
    return { agreement: false, reason: `NOVA closed but n8n ${gt.postedPublicReply ? 'responded' : 'assigned'}` };
  }

  if (a === 'no_action' || a === 'observe' || a === 'monitor') {
    if (!gt.postedPublicReply && !gt.roundRobinAssigned) return { agreement: true, reason: 'Both observed' };
    return { agreement: false, reason: `NOVA took no action but n8n ${gt.postedPublicReply ? 'responded' : 'assigned'}` };
  }

  // plugin_to_tpj, abuse_report, transition, comment — no n8n equivalent yet
  return { agreement: true, reason: `Action "${novaAction}" has no n8n equivalent — skipped` };
}

// ── Service ──

const PARSER_VERSION = 2;
const N8N_ACCOUNT_ID = '712020:ac84e46b-ecff-4878-974c-2825b0497d54';

export class AiImprovementService {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
    private jiraClient?: JiraRestClient,
  ) {}

  /** Fetch n8n (Nurtur) comments for a ticket from Jira and build ground truth tuple. */
  async buildGroundTruth(ticketKey: string): Promise<{ gt: N8nGroundTruth; rawExcerpt: string | null } | null> {
    if (!this.jiraClient) return null;
    try {
      const allComments = await this.jiraClient.getComments(ticketKey, 50);
      const n8nComments = allComments.filter(c => c.author?.accountId === N8N_ACCOUNT_ID);
      if (n8nComments.length === 0) return null;

      const normalised = n8nComments.map(c => ({
        body: typeof c.body === 'object' ? extractTextFromAdf(c.body) : String(c.body ?? ''),
        jsdPublic: c.jsdPublic ?? null,
        created: c.created,
      }));

      const gt = classifyN8nComments(normalised);
      const firstBody = normalised[0]?.body ?? '';
      return { gt, rawExcerpt: firstBody.slice(0, 500) };
    } catch (err) {
      console.warn(`[ai-improvement] Failed to fetch comments for ${ticketKey}:`, (err as Error).message);
      return null;
    }
  }

  async compareDecision(
    ticketKey: string,
    novaAction: string,
    novaConfidence: number,
    gt: N8nGroundTruth,
    rawExcerpt?: string | null,
  ): Promise<ComparisonEntry> {
    const { agreement, reason } = compareActions(novaAction, gt);
    const n8nActionSummary = [
      gt.postedPublicReply ? 'respond' : null,
      gt.roundRobinAssigned ? `assign(${gt.roundRobinAssignee ?? '?'})` : null,
      gt.recommendedTier ? `tier=${gt.recommendedTier}` : null,
    ].filter(Boolean).join('+') || 'none';

    const diffSummary = agreement ? null : reason;

    const id = await executeAndGetId(
      `INSERT INTO ai_comparison_log
       (ticket_key, nova_action, n8n_action, nova_confidence, agreement, diff_summary, n8n_raw_excerpt,
        n8n_recommended_tier, n8n_posted_reply, n8n_assigned, parser_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketKey, novaAction, n8nActionSummary, novaConfidence, agreement ? 1 : 0, diffSummary,
       rawExcerpt ?? null, gt.recommendedTier, gt.postedPublicReply ? 1 : 0,
       gt.roundRobinAssigned ? 1 : 0, PARSER_VERSION],
    );

    return {
      id, ticket_key: ticketKey, nova_action: novaAction, n8n_action: n8nActionSummary,
      nova_confidence: novaConfidence, agreement, diff_summary: diffSummary,
      n8n_raw_excerpt: rawExcerpt ?? null, n8n_recommended_tier: gt.recommendedTier,
      n8n_posted_reply: gt.postedPublicReply, n8n_assigned: gt.roundRobinAssigned,
      parser_version: PARSER_VERSION, created_at: new Date().toISOString(),
    };
  }

  async recordHumanEdit(
    ticketKey: string,
    signalType: 'reply_edited' | 'action_overridden' | 'escalation_added' | 'priority_changed',
    aiOutput: string | null,
    humanOutput: string | null,
  ): Promise<number> {
    let diffSummary: string | null = null;
    if (aiOutput && humanOutput && aiOutput !== humanOutput) {
      const aiLen = aiOutput.length;
      const humanLen = humanOutput.length;
      const lenDiff = humanLen - aiLen;
      diffSummary = `Human ${lenDiff > 0 ? 'expanded' : 'shortened'} AI output (${aiLen} → ${humanLen} chars)`;
    }

    return executeAndGetId(
      `INSERT INTO ai_improvement_signals (ticket_key, signal_type, ai_output, human_output, diff_summary)
       VALUES (?, ?, ?, ?, ?)`,
      [ticketKey, signalType, aiOutput, humanOutput, diffSummary],
    );
  }

  async runComparisonScan(): Promise<number> {
    const decisions = await query<{
      ticket_id: string;
      action: string;
      confidence: number;
    }>(
      `SELECT d.ticket_id, d.action, d.confidence
       FROM agent_decisions d
       INNER JOIN (
         SELECT ticket_id, MAX(id) as max_id
         FROM agent_decisions
         WHERE created_at >= DATEADD(day, -7, GETUTCDATE())
           AND action IS NOT NULL
         GROUP BY ticket_id
       ) latest ON d.id = latest.max_id
       WHERE NOT EXISTS (
         SELECT 1 FROM ai_comparison_log c
         WHERE c.ticket_key = d.ticket_id AND c.parser_version = ${PARSER_VERSION}
       )
       ORDER BY d.created_at DESC`,
    );

    console.log(`[ai-improvement] Scan: ${decisions.length} tickets to compare (7-day window, parser v${PARSER_VERSION})`);
    if (!this.jiraClient) {
      console.warn('[ai-improvement] No Jira client — cannot fetch comments for comparison');
      return 0;
    }

    let compared = 0;
    let withN8n = 0;

    for (const d of decisions) {
      const result = await this.buildGroundTruth(d.ticket_id);
      if (!result) continue;
      withN8n++;

      await this.compareDecision(d.ticket_id, d.action, d.confidence, result.gt, result.rawExcerpt);
      compared++;
    }

    console.log(`[ai-improvement] Scan results: ${decisions.length} decisions, ${withN8n} with n8n comments, ${compared} compared`);
    return compared;
  }

  /** Backfill all agent_decisions since go-live with v2 ground truth.
   *  Deletes existing v1 rows first. Returns { compared, agreed }. */
  async runBackfill(): Promise<{ compared: number; agreed: number; skipped: number }> {
    if (!this.jiraClient) throw new Error('No Jira client available for backfill');

    // Delete old v1 rows
    await execute(`DELETE FROM ai_comparison_log WHERE parser_version < ${PARSER_VERSION}`);
    console.log('[ai-improvement] Deleted old parser v1 rows');

    // Get all decisions since go-live (latest per ticket)
    const goLiveDate = this.settings.get('agent_go_live_date') || '2026-04-23';
    const decisions = await query<{
      ticket_id: string;
      action: string;
      confidence: number;
    }>(
      `SELECT d.ticket_id, d.action, d.confidence
       FROM agent_decisions d
       INNER JOIN (
         SELECT ticket_id, MAX(id) as max_id
         FROM agent_decisions
         WHERE action IS NOT NULL
         GROUP BY ticket_id
       ) latest ON d.id = latest.max_id
       WHERE d.created_at >= ?
       ORDER BY d.created_at ASC`,
      [goLiveDate],
    );

    console.log(`[ai-improvement] Backfill: ${decisions.length} tickets with decisions since ${goLiveDate}`);

    let compared = 0;
    let agreed = 0;
    let skipped = 0;

    for (let i = 0; i < decisions.length; i++) {
      const d = decisions[i];
      try {
        const result = await this.buildGroundTruth(d.ticket_id);
        if (!result) { skipped++; continue; }

        const entry = await this.compareDecision(d.ticket_id, d.action, d.confidence, result.gt, result.rawExcerpt);
        compared++;
        if (entry.agreement) agreed++;
      } catch {
        skipped++;
      }

      if ((i + 1) % 50 === 0) {
        console.log(`[ai-improvement] Backfill progress: ${i + 1}/${decisions.length} (${compared} compared, ${agreed} agreed)`);
      }
    }

    const rate = compared > 0 ? ((agreed / compared) * 100).toFixed(1) : 'N/A';
    console.log(`[ai-improvement] Backfill complete: ${compared} compared, ${agreed} agreed (${rate}%), ${skipped} skipped`);
    return { compared, agreed, skipped };
  }

  async detectHumanEdits(): Promise<number> {
    const rows = await query<{
      ticket_id: string;
      ai_draft: string;
      actual_response: string;
    }>(
      `SELECT d.ticket_id,
         JSON_VALUE(d.output, '$.draft_response') as ai_draft,
         j.last_public_comment as actual_response
       FROM agent_decisions d
       JOIN jira_issue_cache j ON j.issue_key = d.ticket_id
       WHERE d.created_at >= DATEADD(day, -1, GETUTCDATE())
         AND d.action = 'respond'
         AND JSON_VALUE(d.output, '$.draft_response') IS NOT NULL
         AND j.last_public_comment IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ai_improvement_signals s WHERE s.ticket_key = d.ticket_id AND s.created_at >= DATEADD(day, -1, GETUTCDATE())
         )`,
    );

    let signals = 0;
    for (const r of rows) {
      if (r.ai_draft && r.actual_response && r.ai_draft.trim() !== r.actual_response.trim()) {
        await this.recordHumanEdit(r.ticket_id, 'reply_edited', r.ai_draft, r.actual_response);
        signals++;
      }
    }

    return signals;
  }

  async getStats(days = 30): Promise<ImprovementStats> {
    const [compRows] = await Promise.all([
      query<{ total: number; agreed: number }>(
        `SELECT COUNT(*) as total, SUM(CAST(agreement AS INT)) as agreed
         FROM ai_comparison_log WHERE created_at >= DATEADD(day, -?, GETUTCDATE()) AND parser_version = ${PARSER_VERSION}`,
        [days],
      ),
    ]);

    const signalRows = await query<{ signal_type: string; cnt: number }>(
      `SELECT signal_type, COUNT(*) as cnt
       FROM ai_improvement_signals
       WHERE created_at >= DATEADD(day, -?, GETUTCDATE())
       GROUP BY signal_type`,
      [days],
    );

    const recentDisagreements = await query<ComparisonEntry>(
      `SELECT TOP 10 * FROM ai_comparison_log
       WHERE agreement = 0 AND created_at >= DATEADD(day, -?, GETUTCDATE()) AND parser_version = ${PARSER_VERSION}
       ORDER BY created_at DESC`,
      [days],
    );

    const recentSignals = await query<ImprovementSignal>(
      `SELECT TOP 10 * FROM ai_improvement_signals
       WHERE created_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY created_at DESC`,
      [days],
    );

    const comparableRows = await query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT d.ticket_id) as cnt
       FROM agent_decisions d
       JOIN jira_issue_cache j ON j.issue_key = d.ticket_id
       WHERE d.created_at >= DATEADD(day, -7, GETUTCDATE())
         AND d.action IS NOT NULL
         AND j.last_n8n_comment IS NOT NULL`,
    );

    const total = compRows[0]?.total ?? 0;
    const agreed = compRows[0]?.agreed ?? 0;
    const signalsByType: Record<string, number> = {};
    let totalSignals = 0;
    for (const r of signalRows) {
      signalsByType[r.signal_type] = r.cnt;
      totalSignals += r.cnt;
    }

    return {
      totalComparisons: total,
      agreementRate: total > 0 ? agreed / total : 0,
      totalSignals,
      signalsByType,
      recentDisagreements,
      recentSignals,
      comparableTicketsCount7d: comparableRows[0]?.cnt ?? 0,
    };
  }

  async getComparisons(limit = 50, offset = 0): Promise<ComparisonEntry[]> {
    return query<ComparisonEntry>(
      `SELECT * FROM ai_comparison_log
       ORDER BY created_at DESC
       OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      [offset, limit],
    );
  }

  async getSignals(limit = 50, offset = 0): Promise<ImprovementSignal[]> {
    return query<ImprovementSignal>(
      `SELECT * FROM ai_improvement_signals
       ORDER BY created_at DESC
       OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`,
      [offset, limit],
    );
  }
}
