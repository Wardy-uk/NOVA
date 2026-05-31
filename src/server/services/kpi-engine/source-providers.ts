/**
 * KPI Recovery — Escalation & QA source providers (KPX-WP3)
 *
 * Builds the non-ticket source data behind the escalation- and QA-family
 * computed metrics, which cannot be derived from jira_issue_cache alone:
 *
 *   - escalation_rate  ← escalation_log (NOVA main pool)
 *   - qa_score_avg     ← jira_qa_results        (KPI / techservicesjsm pool)
 *   - golden_rules_avg ← Jira_QA_GoldenRules     (KPI / techservicesjsm pool)
 *
 * These replace the deprecated JiraTickets-derived legacy KPIs WITHOUT touching
 * any forbidden table. escalation_log is the clean-sheet escalation store;
 * jira_qa_results / Jira_QA_GoldenRules are NOVA-populated QA stores (safe to
 * read). Every fetch is resilient: on a missing table, unconfigured KPI pool, or
 * any query error it returns `available: false` with an empty list, so a source
 * outage degrades a metric to "—" rather than throwing or fabricating a zero.
 *
 * Source rows are keyed by issueKey so a computer can intersect them with the
 * ticket subset it is handed (all tickets for space-level, one agent's tickets
 * for agent-level) using a single uniform code path.
 */
import sql from 'mssql';
import { query } from '../database.js';
import { getKpiPool } from '../kpi-pipeline.js';
import { tableSuffix, type PipelineTarget } from '../pipeline-monitor.js';
import type { SettingsQueries } from '../../db/settings-store.js';
import type {
  SpaceConfig,
  MetricSourceContext,
  EscalationEvent,
  QaScoreRow,
  GoldenRuleScoreRow,
} from './types.js';

// QA scores are only meaningful for recently-resolved tickets; bound the read so
// it stays cheap and aligns with the ticket cache (open + ~3-day recent).
const QA_LOOKBACK_DAYS = 7;

/**
 * escalation_log.escalation_type value that marks a bounce-back / rejection event
 * (a higher tier formally returning a ticket). Captured explicitly via the
 * escalation-log rejection capture path — never inferred from tier-move
 * heuristics. Rows with this type are partitioned out of the escalation list so
 * they never inflate escalation_rate, and instead source rejection_rate /
 * escalation_accuracy.
 */
const REJECTION_TYPE = 'rejection';

/**
 * Escalation + rejection events for a space, from escalation_log (NOVA main pool),
 * restricted to tickets currently in the cache for the space's Jira project. The
 * join on jira_issue_cache both maps events to a project (escalation_log has no
 * project column) and naturally bounds the window to the cache window. Rows are
 * partitioned into genuine escalations and rejection/bounce-back events.
 */
async function fetchEscalations(
  space: SpaceConfig,
): Promise<{ available: boolean; escalations: EscalationEvent[]; rejections: EscalationEvent[] }> {
  if (!space.jiraProject) return { available: false, escalations: [], rejections: [] };
  try {
    const rows = await query<{ issueKey: string; escalationType: string }>(
      `SELECT el.ticket_key AS issueKey, el.escalation_type AS escalationType
       FROM escalation_log el
       JOIN jira_issue_cache c ON c.issue_key = el.ticket_key
       WHERE c.project_key = ?`,
      [space.jiraProject],
    );
    const escalations = rows.filter((r) => r.escalationType !== REJECTION_TYPE);
    const rejections = rows.filter((r) => r.escalationType === REJECTION_TYPE);
    return { available: true, escalations, rejections };
  } catch {
    return { available: false, escalations: [], rejections: [] };
  }
}

/** Recent QA score rows from jira_qa_results (KPI pool) for resolved/full QA. */
async function fetchQaResults(
  settings: SettingsQueries,
  target: PipelineTarget,
): Promise<{ available: boolean; rows: QaScoreRow[] }> {
  try {
    const p = await getKpiPool(settings);
    const s = tableSuffix(target);
    const r = await p
      .request()
      .input('days', sql.Int, -QA_LOOKBACK_DAYS)
      .query(
        `SELECT issueKey, overallScore
         FROM dbo.jira_qa_results${s}
         WHERE qaType IN ('resolved', 'ticket_full')
           AND CreatedAt >= DATEADD(day, @days, GETUTCDATE())`,
      );
    return {
      available: true,
      rows: r.recordset.map((x: { issueKey: string; overallScore: number | null }) => ({
        issueKey: x.issueKey,
        overallScore: x.overallScore,
      })),
    };
  } catch {
    return { available: false, rows: [] };
  }
}

/** Recent Golden-Rules score rows from Jira_QA_GoldenRules (KPI pool). */
async function fetchGoldenRules(
  settings: SettingsQueries,
  target: PipelineTarget,
): Promise<{ available: boolean; rows: GoldenRuleScoreRow[] }> {
  try {
    const p = await getKpiPool(settings);
    const s = tableSuffix(target);
    const r = await p
      .request()
      .input('days', sql.Int, -QA_LOOKBACK_DAYS)
      .query(
        `SELECT IssueKey AS issueKey, OverallScore AS overallScore
         FROM dbo.Jira_QA_GoldenRules${s}
         WHERE CreatedAt >= DATEADD(day, @days, GETUTCDATE())`,
      );
    return {
      available: true,
      rows: r.recordset.map((x: { issueKey: string; overallScore: number | null }) => ({
        issueKey: x.issueKey,
        overallScore: x.overallScore,
      })),
    };
  } catch {
    return { available: false, rows: [] };
  }
}

/**
 * Build the source context for a space, fetching ONLY the families an enabled
 * metric actually needs. `needEscalation` / `needQa` are decided by the caller
 * from the space's enabled metric set so spaces without these metrics pay no
 * extra query cost.
 */
export async function buildSourceContext(
  space: SpaceConfig,
  opts: { needEscalation: boolean; needQa: boolean; needGoldenRules: boolean; settings: SettingsQueries | null },
): Promise<MetricSourceContext> {
  const ctx: MetricSourceContext = {
    escalationAvailable: false,
    escalations: [],
    rejectionAvailable: false,
    rejections: [],
    qaAvailable: false,
    qaResults: [],
    goldenRulesAvailable: false,
    goldenRules: [],
  };

  if (opts.needEscalation) {
    const esc = await fetchEscalations(space);
    ctx.escalationAvailable = esc.available;
    ctx.escalations = esc.escalations;
    ctx.rejections = esc.rejections;
    // Rejection capture is "available" only when the explicit rejection store has
    // produced at least one bounce-back event in window. With no rejection rows
    // we cannot honestly assert "0% rejected" / "100% accurate", so the dependent
    // metrics stay "—" (wired, awaiting capture) instead of fabricating a value.
    ctx.rejectionAvailable = esc.available && esc.rejections.length > 0;
  }

  // QA families require the configured KPI pool; without settings we cannot reach
  // techservicesjsm, so they stay unavailable (→ "—") rather than throwing.
  if (opts.settings) {
    const target: PipelineTarget = opts.settings.get('qa_pipeline_target') === 'live' ? 'live' : 'uat';
    if (opts.needQa) {
      const qa = await fetchQaResults(opts.settings, target);
      ctx.qaAvailable = qa.available;
      ctx.qaResults = qa.rows;
    }
    if (opts.needGoldenRules) {
      const gr = await fetchGoldenRules(opts.settings, target);
      ctx.goldenRulesAvailable = gr.available;
      ctx.goldenRules = gr.rows;
    }
  }

  return ctx;
}

/** computation_key → which source family it needs. Used to gate fetches. */
export const ESCALATION_METRIC_KEYS = new Set(['escalation_rate', 'rejection_rate', 'escalation_accuracy']);
export const QA_METRIC_KEYS = new Set(['qa_score_avg']);
export const GOLDEN_RULES_METRIC_KEYS = new Set(['golden_rules_avg']);
