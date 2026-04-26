import { query, execute, executeAndGetId } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';

// ── Types ──

export interface ComparisonEntry {
  id: number;
  ticket_key: string;
  nova_action: string | null;
  n8n_action: string | null;
  nova_confidence: number | null;
  agreement: boolean;
  diff_summary: string | null;
  n8n_raw_excerpt: string | null;
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

// ── Helpers ──

interface ParsedN8nAction {
  action: string;
  priority: string | null;
  recommendedTier: string | null;
}

export function parseN8nAction(body: string): ParsedN8nAction | null {
  if (!body) return null;
  const lower = body.toLowerCase();

  let action: string | null = null;
  if (/no escalation is needed|no fault|auto[- ]?resolve|\bclose\b/.test(lower)) {
    action = 'close';
  } else if (/escalate to|escalation required|recommend escalation/.test(lower)) {
    action = 'escalate';
  } else if (/respond to customer|reply to|\*\*reply:\*\*|\*\*suggested reply:\*\*/i.test(body)) {
    action = 'respond';
  }

  if (!action) return null;

  const priorityMatch = body.match(/\*\*Priority:\*\*\s*(Low|Medium|High|Critical)/i);
  const tierMatch = body.match(/\*\*Recommended Tier:\*\*\s*([^\n*]+)/i);

  return {
    action,
    priority: priorityMatch ? priorityMatch[1].trim() : null,
    recommendedTier: tierMatch ? tierMatch[1].trim() : null,
  };
}

// ── Service ──

export class AiImprovementService {
  constructor(
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  async compareDecision(
    ticketKey: string,
    novaAction: string,
    novaConfidence: number,
    n8nAction: string,
    n8nRawBody?: string,
  ): Promise<ComparisonEntry> {
    const agreement = novaAction.toLowerCase() === n8nAction.toLowerCase();
    let diffSummary: string | null = null;

    if (!agreement) {
      diffSummary = `NOVA chose "${novaAction}" (${(novaConfidence * 100).toFixed(0)}% confidence) but n8n chose "${n8nAction}"`;
    }

    const rawExcerpt = n8nRawBody ? n8nRawBody.slice(0, 500) : null;

    const id = await executeAndGetId(
      `INSERT INTO ai_comparison_log (ticket_key, nova_action, n8n_action, nova_confidence, agreement, diff_summary, n8n_raw_excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticketKey, novaAction, n8nAction, novaConfidence, agreement ? 1 : 0, diffSummary, rawExcerpt],
    );

    return {
      id,
      ticket_key: ticketKey,
      nova_action: novaAction,
      n8n_action: n8nAction,
      nova_confidence: novaConfidence,
      agreement,
      diff_summary: diffSummary,
      n8n_raw_excerpt: rawExcerpt,
      created_at: new Date().toISOString(),
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
      output: string | null;
      created_at: string;
    }>(
      `SELECT d.ticket_id, d.action, d.confidence, d.output, d.created_at
       FROM agent_decisions d
       WHERE d.created_at >= DATEADD(day, -1, GETUTCDATE())
         AND d.action IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM ai_comparison_log c
           WHERE c.ticket_key = d.ticket_id AND c.created_at >= d.created_at
         )
       ORDER BY d.created_at DESC`,
    );

    let compared = 0;
    for (const d of decisions) {
      const rows = await query<{ body: string; created_at: string }>(
        `SELECT TOP 1 last_n8n_comment AS body, last_n8n_comment_at AS created_at
         FROM jira_issue_cache
         WHERE issue_key = ?
           AND last_n8n_comment IS NOT NULL
           AND last_n8n_comment_at >= ?`,
        [d.ticket_id, d.created_at],
      );

      if (rows.length === 0) continue;

      const parsed = parseN8nAction(rows[0].body);
      if (!parsed) continue;

      const diffParts: string[] = [];
      if (parsed.priority) diffParts.push(`n8n priority: ${parsed.priority}`);
      if (parsed.recommendedTier) diffParts.push(`n8n tier: ${parsed.recommendedTier}`);

      const entry = await this.compareDecision(
        d.ticket_id, d.action, d.confidence, parsed.action, rows[0].body,
      );

      if (!entry.agreement && diffParts.length > 0) {
        const extraSummary = `${entry.diff_summary}. ${diffParts.join(', ')}`;
        await execute(
          `UPDATE ai_comparison_log SET diff_summary = ? WHERE id = ?`,
          [extraSummary, entry.id],
        );
      }

      compared++;
    }

    return compared;
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
         FROM ai_comparison_log WHERE created_at >= DATEADD(day, -?, GETUTCDATE())`,
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
       WHERE agreement = 0 AND created_at >= DATEADD(day, -?, GETUTCDATE())
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
         AND j.last_n8n_comment IS NOT NULL
         AND j.last_n8n_comment_at >= d.created_at`,
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
