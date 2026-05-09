import { z } from 'zod';
import { query, queryOne, executeAndGetId, execute } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';

export interface EscalationFeatures {
  request_type: string | null;
  priority: string | null;
  reporter_is_key_account: boolean;
  reporter_ticket_count_90d: number;
  initial_sentiment: string | null;
  hour_of_day_created: number;
  day_of_week_created: number;
  word_count_description: number;
  has_attachment: boolean;
  component: string | null;
  initial_classification: string | null;
  current_risk_score: number;
}

export interface PredictionResult {
  ticketKey: string;
  probability: number;
  reasoning: string;
  features: EscalationFeatures;
}

const PredictionSchema = z.object({
  escalation_probability: z.number().min(0).max(1),
  reasoning: z.string(),
  key_factors: z.array(z.string()),
});

export class EscalationPredictor {
  constructor(
    private llmService: LlmService,
    private settings: SettingsQueries,
  ) {}

  async predict(ticketKey: string, features: EscalationFeatures): Promise<PredictionResult> {
    const examples = await this.getHistoricalExamples();

    const systemPrompt = `You are an escalation prediction model for an IT service desk.
Given a ticket's features and historical examples, predict the probability (0.0 to 1.0) that this ticket will need to be escalated beyond first-line support.

Historical examples of escalated and non-escalated tickets:
${examples}

Respond with a probability, your reasoning, and the key factors driving your prediction.`;

    const userMessage = `Predict escalation probability for ticket ${ticketKey}:
${JSON.stringify(features, null, 2)}`;

    const result = await this.llmService.call(
      systemPrompt,
      userMessage,
      PredictionSchema,
      { callType: 'predict_escalation', tier: 'cheap', ticketId: ticketKey, temperature: 0.1 },
    );

    const probability = result.data.escalation_probability;
    const reasoning = result.data.reasoning;

    await this.storePrediction(ticketKey, probability, features, reasoning);

    return { ticketKey, probability, reasoning, features };
  }

  async extractFeatures(ticketKey: string): Promise<EscalationFeatures> {
    const issue = await queryOne<{
      summary: string; description_text: string; status_name: string;
      priority_name: string; reporter_email: string; reporter_name: string;
      created_at: string; labels: string; component: string;
      request_type: string; has_attachments: number;
    }>(
      `SELECT summary, description_text, status_name, priority_name,
              reporter_email, reporter_name, created_at, labels, component,
              request_type, has_attachments
       FROM jira_issue_cache WHERE issue_key = ?`,
      [ticketKey],
    );

    if (!issue) {
      return {
        request_type: null, priority: null, reporter_is_key_account: false,
        reporter_ticket_count_90d: 0, initial_sentiment: null,
        hour_of_day_created: 12, day_of_week_created: 1,
        word_count_description: 0, has_attachment: false,
        component: null, initial_classification: null, current_risk_score: 0,
      };
    }

    const isKeyAccount = (issue.labels ?? '').toLowerCase().includes('key_account');

    const reporterCount = await queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM jira_issue_cache
       WHERE reporter_email = ? AND created_at >= DATEADD(day, -90, GETUTCDATE())`,
      [issue.reporter_email],
    );

    const sentiment = await queryOne<{ inputs: string }>(
      `SELECT TOP 1 inputs FROM agent_decisions
       WHERE ticket_id = ? AND action = 'triage' ORDER BY created_at ASC`,
      [ticketKey],
    );
    let initialSentiment: string | null = null;
    if (sentiment?.inputs) {
      try {
        const parsed = JSON.parse(sentiment.inputs);
        initialSentiment = parsed.sentiment ?? null;
      } catch {}
    }

    const classification = await queryOne<{ inputs: string }>(
      `SELECT TOP 1 inputs FROM agent_decisions
       WHERE ticket_id = ? ORDER BY created_at ASC`,
      [ticketKey],
    );
    let initialClassification: string | null = null;
    if (classification?.inputs) {
      try {
        const parsed = JSON.parse(classification.inputs);
        initialClassification = parsed.classification ?? parsed.category ?? null;
      } catch {}
    }

    const flagged = await queryOne<{ risk_score: number }>(
      `SELECT risk_score FROM agent_flagged_tickets WHERE ticket_key = ?`,
      [ticketKey],
    );

    const created = new Date(issue.created_at);
    const wordCount = (issue.description_text ?? '').split(/\s+/).filter(Boolean).length;

    return {
      request_type: issue.request_type ?? null,
      priority: issue.priority_name ?? null,
      reporter_is_key_account: isKeyAccount,
      reporter_ticket_count_90d: reporterCount?.cnt ?? 0,
      initial_sentiment: initialSentiment,
      hour_of_day_created: created.getHours(),
      day_of_week_created: created.getDay(),
      word_count_description: wordCount,
      has_attachment: !!issue.has_attachments,
      component: issue.component ?? null,
      initial_classification: initialClassification,
      current_risk_score: flagged?.risk_score ?? 0,
    };
  }

  async predictForTicket(ticketKey: string): Promise<PredictionResult> {
    const features = await this.extractFeatures(ticketKey);
    return this.predict(ticketKey, features);
  }

  isAboveThreshold(probability: number): boolean {
    const threshold = parseFloat(this.settings.get('agent_escalation_predict_threshold') ?? '0.75');
    return probability >= threshold;
  }

  async getActivePredictions(): Promise<Array<{
    ticket_key: string; probability: number; features_json: string;
    reasoning: string; predicted_at: string; actual_outcome: string | null;
  }>> {
    return query(
      `SELECT ep.ticket_key, ep.probability, ep.features_json, ep.reasoning,
              ep.predicted_at, ep.actual_outcome
       FROM agent_escalation_predictions ep
       INNER JOIN jira_issue_cache jic ON ep.ticket_key = jic.issue_key
       WHERE ep.actual_outcome IS NULL OR ep.actual_outcome = 'pending'
       ORDER BY ep.probability DESC`,
    );
  }

  async getAccuracyStats(days: number = 30): Promise<{
    total: number; correct: number; incorrect: number; pending: number; accuracy: number;
  }> {
    const rows = await query<{ actual_outcome: string | null; correct: number | null; cnt: number }>(
      `SELECT actual_outcome, correct, COUNT(*) as cnt
       FROM agent_escalation_predictions
       WHERE predicted_at >= DATEADD(day, -?, GETUTCDATE())
       GROUP BY actual_outcome, correct`,
      [days],
    );

    let total = 0, correct = 0, incorrect = 0, pending = 0;
    for (const row of rows) {
      total += row.cnt;
      if (row.actual_outcome === null || row.actual_outcome === 'pending') pending += row.cnt;
      else if (row.correct === 1) correct += row.cnt;
      else incorrect += row.cnt;
    }

    return {
      total,
      correct,
      incorrect,
      pending,
      accuracy: total - pending > 0 ? correct / (total - pending) : 0,
    };
  }

  async resolveOutcome(ticketKey: string, didEscalate: boolean): Promise<void> {
    const prediction = await queryOne<{ id: number; probability: number }>(
      `SELECT TOP 1 id, probability FROM agent_escalation_predictions
       WHERE ticket_key = ? AND actual_outcome IS NULL
       ORDER BY predicted_at DESC`,
      [ticketKey],
    );
    if (!prediction) return;

    const outcome = didEscalate ? 'escalated' : 'resolved_at_cc';
    const wasCorrect = (didEscalate && prediction.probability >= 0.5) ||
                       (!didEscalate && prediction.probability < 0.5);

    await execute(
      `UPDATE agent_escalation_predictions
       SET actual_outcome = ?, correct = ?, resolved_at = GETUTCDATE()
       WHERE id = ?`,
      [outcome, wasCorrect ? 1 : 0, prediction.id],
    );
  }

  private async storePrediction(
    ticketKey: string, probability: number,
    features: EscalationFeatures, reasoning: string,
  ): Promise<number> {
    return executeAndGetId(
      `INSERT INTO agent_escalation_predictions (ticket_key, probability, features_json, reasoning)
       VALUES (?, ?, ?, ?)`,
      [ticketKey, probability, JSON.stringify(features), reasoning],
    );
  }

  private async getHistoricalExamples(): Promise<string> {
    const escalated = await query<{ ticket_id: string; inputs: string }>(
      `SELECT TOP 5 ticket_id, inputs FROM agent_decisions
       WHERE action LIKE 'escalate%' AND inputs IS NOT NULL
       ORDER BY created_at DESC`,
    );

    const resolved = await query<{ ticket_id: string; inputs: string }>(
      `SELECT TOP 5 ticket_id, inputs FROM agent_decisions
       WHERE action IN ('quick_win', 'draft_response', 'close') AND inputs IS NOT NULL
       ORDER BY created_at DESC`,
    );

    const lines: string[] = [];
    for (const row of escalated) {
      lines.push(`ESCALATED: ${row.ticket_id} — ${this.summariseInputs(row.inputs)}`);
    }
    for (const row of resolved) {
      lines.push(`RESOLVED_AT_CC: ${row.ticket_id} — ${this.summariseInputs(row.inputs)}`);
    }

    return lines.join('\n') || 'No historical data available yet.';
  }

  private summariseInputs(inputsJson: string): string {
    try {
      const parsed = JSON.parse(inputsJson);
      const parts: string[] = [];
      if (parsed.classification) parts.push(`type: ${parsed.classification}`);
      if (parsed.priority) parts.push(`priority: ${parsed.priority}`);
      if (parsed.sentiment) parts.push(`sentiment: ${parsed.sentiment}`);
      if (parsed.request_type) parts.push(`request: ${parsed.request_type}`);
      return parts.join(', ') || 'no details';
    } catch {
      return 'parse error';
    }
  }
}
