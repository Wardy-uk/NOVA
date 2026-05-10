import { query, execute, executeAndGetId } from './database.js';
import type { AgentDecision } from './agent-types.js';
import type { TriageResult } from './triage-schema.js';
import type { RespondResult } from './respond-schema.js';
import { detectTierFromStatus } from './escalation-log-service.js';

export interface EscalationPolicyResult {
  allowed: boolean;
  reason: string;
  suggestion?: 'respond_first' | 'gather_context_first' | 'assign_instead';
  evidence_score: number;
}

interface PolicyLogRow {
  id: number;
  ticket_key: string;
  original_action: string;
  final_action: string;
  evidence_score: number;
  policy_result: string;
  reason: string | null;
  suggestion: string | null;
  evaluated_at: string;
}

export class EscalationPolicy {

  async evaluate(
    decision: AgentDecision,
    triage: TriageResult | RespondResult,
  ): Promise<EscalationPolicyResult> {
    const ticketKey = decision.ticketKey;
    const confidence = (triage as RespondResult).confidence ?? (triage as TriageResult).classification?.confidence ?? decision.confidence;
    const sentiment = triage.sentiment;
    const reasoning = decision.reasoning ?? '';
    const priority = (triage as TriageResult).classification?.priority_matrix ?? (decision.inputs?.priority as string) ?? 'P4';

    // 1. Respond-first gate
    const responseCount = await this.getResponseCount(ticketKey);
    const isHighPriority = priority === 'P1';
    const isAngry = sentiment === 'angry';

    if (responseCount === 0 && !isHighPriority && !isAngry) {
      const result: EscalationPolicyResult = {
        allowed: false,
        reason: 'No prior responses on this ticket — at least one response attempt should precede escalation',
        suggestion: 'respond_first',
        evidence_score: 0,
      };
      await this.log(ticketKey, 'escalate', 'escalate', 0, 'blocked', result.reason, result.suggestion);
      return result;
    }

    // 2. Gather-context gate
    const hasExplicitEscalationLanguage = /formal complaint|escalation|speak to a manager|complaint reference/i.test(
      (decision.inputs?.description as string) ?? '',
    );
    if (confidence < 0.6 && !hasExplicitEscalationLanguage) {
      const result: EscalationPolicyResult = {
        allowed: false,
        reason: `Low confidence (${confidence.toFixed(2)}) — gather more context before escalating`,
        suggestion: 'gather_context_first',
        evidence_score: 0,
      };
      await this.log(ticketKey, 'escalate', 'escalate', 0, 'blocked', result.reason, result.suggestion);
      return result;
    }

    // 3. Tier-boundary check
    const currentStatus = (decision.inputs?.status as string) ?? '';
    const currentTier = detectTierFromStatus(currentStatus);
    if (currentTier) {
      const tierRank: Record<string, number> = { T1: 1, T2: 2, T3: 3, Dev: 4 };
      const rank = tierRank[currentTier] ?? 0;
      if (rank >= 2) {
        const hasRootCause = /root cause|code|bug|exception|stack trace|regression|deploy/i.test(reasoning);
        if (!hasRootCause && rank >= 3) {
          const result: EscalationPolicyResult = {
            allowed: false,
            reason: `Ticket already at ${currentTier} — converting to assign instead`,
            suggestion: 'assign_instead',
            evidence_score: 0.3,
          };
          await this.log(ticketKey, 'escalate', 'assign', 0.3, 'override', result.reason, result.suggestion);
          return result;
        }
      }
    }

    // 4. Evidence scoring
    const evidenceScore = await this.scoreEvidence(ticketKey, reasoning, sentiment, triage);

    // 5. Repeat-escalation dampener
    const recentDeclined = await this.hasRecentDeclinedEscalation(ticketKey);
    if (recentDeclined) {
      const result: EscalationPolicyResult = {
        allowed: false,
        reason: 'Escalation was declined or reversed within the last 7 days — re-escalation blocked',
        suggestion: 'respond_first',
        evidence_score: evidenceScore,
      };
      await this.log(ticketKey, 'escalate', 'escalate', evidenceScore, 'blocked', result.reason, result.suggestion);
      return result;
    }

    // Score thresholds
    if (evidenceScore < 0.4) {
      const result: EscalationPolicyResult = {
        allowed: false,
        reason: `Insufficient evidence for escalation (score: ${evidenceScore.toFixed(2)})`,
        suggestion: 'respond_first',
        evidence_score: evidenceScore,
      };
      await this.log(ticketKey, 'escalate', 'escalate', evidenceScore, 'blocked', result.reason, result.suggestion);
      return result;
    }

    if (evidenceScore <= 0.6) {
      const result: EscalationPolicyResult = {
        allowed: true,
        reason: `Escalation allowed but requires approval (evidence score: ${evidenceScore.toFixed(2)})`,
        evidence_score: evidenceScore,
      };
      await this.log(ticketKey, 'escalate', 'escalate', evidenceScore, 'allowed', result.reason, undefined);
      return result;
    }

    // Strong evidence — proceed
    const result: EscalationPolicyResult = {
      allowed: true,
      reason: `Strong evidence for escalation (score: ${evidenceScore.toFixed(2)})`,
      evidence_score: evidenceScore,
    };
    await this.log(ticketKey, 'escalate', 'escalate', evidenceScore, 'allowed', result.reason, undefined);
    return result;
  }

  private async getResponseCount(ticketKey: string): Promise<number> {
    try {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM jira_comment_cache WHERE issue_key = ? AND is_internal = 0`,
        [ticketKey],
      );
      return rows[0]?.cnt ?? 0;
    } catch {
      return 1; // fail open — don't block on query failure
    }
  }

  private async scoreEvidence(
    ticketKey: string,
    reasoning: string,
    sentiment: string,
    triage: TriageResult | RespondResult,
  ): Promise<number> {
    let score = 0;

    // +0.3 if reasoning mentions specific technical cause
    if (/root cause|bug|exception|stack trace|error code|regression|null pointer|timeout|deadlock|memory leak/i.test(reasoning)) {
      score += 0.3;
    }

    // +0.2 if KB was searched and no match found
    const kbMatches = (triage as any).kb_gap?.should_have_article;
    if (kbMatches === true) {
      score += 0.2;
    }

    // +0.2 if previous AI decision also recommended escalation
    try {
      const priorEsc = await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_decisions
         WHERE ticket_key = ? AND action = 'escalate'
         AND created_at >= DATEADD(DAY, -7, GETUTCDATE())`,
        [ticketKey],
      );
      if ((priorEsc[0]?.cnt ?? 0) > 0) score += 0.2;
    } catch { /* ignore */ }

    // +0.2 if sentiment is frustrated or angry
    if (sentiment === 'frustrated' || sentiment === 'angry') {
      score += 0.2;
    }

    // +0.1 if ticket age > 5 days
    try {
      const created = (triage as any).classification?.created ?? (triage as any).created;
      if (!created) {
        const ageRows = await query<{ age_days: number }>(
          `SELECT DATEDIFF(DAY, created, GETUTCDATE()) AS age_days FROM jira_issue_cache WHERE issue_key = ?`,
          [ticketKey],
        );
        if ((ageRows[0]?.age_days ?? 0) > 5) score += 0.1;
      }
    } catch { /* ignore */ }

    return Math.min(score, 1);
  }

  private async hasRecentDeclinedEscalation(ticketKey: string): Promise<boolean> {
    try {
      const rows = await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_escalation_policy_log
         WHERE ticket_key = ? AND policy_result = 'blocked'
         AND evaluated_at >= DATEADD(DAY, -7, GETUTCDATE())`,
        [ticketKey],
      );
      // Also check for overridden approvals
      const overridden = await query<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM agent_approvals
         WHERE decision_id IN (SELECT id FROM agent_decisions WHERE ticket_key = ? AND action = 'escalate')
         AND status = 'overridden'
         AND created_at >= DATEADD(DAY, -7, GETUTCDATE())`,
        [ticketKey],
      );
      return ((rows[0]?.cnt ?? 0) > 0) || ((overridden[0]?.cnt ?? 0) > 0);
    } catch {
      return false;
    }
  }

  private async log(
    ticketKey: string,
    originalAction: string,
    finalAction: string,
    evidenceScore: number,
    policyResult: string,
    reason: string | undefined,
    suggestion: string | undefined,
  ): Promise<void> {
    try {
      await executeAndGetId(
        `INSERT INTO agent_escalation_policy_log
         (ticket_key, original_action, final_action, evidence_score, policy_result, reason, suggestion)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [ticketKey, originalAction, finalAction, evidenceScore, policyResult, reason ?? null, suggestion ?? null],
      );
    } catch (err) {
      console.warn('[escalation-policy] Failed to log:', err instanceof Error ? err.message : err);
    }
  }

  async getRecentEvaluations(limit: number = 50): Promise<PolicyLogRow[]> {
    return query<PolicyLogRow>(
      `SELECT TOP (?) * FROM agent_escalation_policy_log ORDER BY evaluated_at DESC`,
      [limit],
    );
  }

  async getStats(days: number = 7): Promise<{
    total: number;
    blocked: number;
    allowed: number;
    override: number;
    avg_evidence_score: number;
  }> {
    const rows = await query<{
      total: number;
      blocked: number;
      allowed: number;
      override_count: number;
      avg_score: number;
    }>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN policy_result = 'blocked' THEN 1 ELSE 0 END) AS blocked,
         SUM(CASE WHEN policy_result = 'allowed' THEN 1 ELSE 0 END) AS allowed,
         SUM(CASE WHEN policy_result = 'override' THEN 1 ELSE 0 END) AS override_count,
         AVG(evidence_score) AS avg_score
       FROM agent_escalation_policy_log
       WHERE evaluated_at >= DATEADD(DAY, -?, GETUTCDATE())`,
      [days],
    );
    const r = rows[0];
    return {
      total: r?.total ?? 0,
      blocked: r?.blocked ?? 0,
      allowed: r?.allowed ?? 0,
      override: r?.override_count ?? 0,
      avg_evidence_score: r?.avg_score ?? 0,
    };
  }
}
