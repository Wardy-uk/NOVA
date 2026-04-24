import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import { execute, query, executeAndGetId } from './database.js';
import { z } from 'zod';

const CallReviewSchema = z.object({
  summary: z.string(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  keyTopics: z.array(z.string()),
  actionItems: z.array(z.string()),
  customerSatisfaction: z.number().min(1).max(10),
  agentPerformance: z.number().min(1).max(10),
  concerns: z.array(z.string()),
});
type CallReview = z.infer<typeof CallReviewSchema>;

export class CallReviewService {
  constructor(
    private settings: SettingsQueries,
    private llmService: LlmService,
  ) {}

  async reviewCall(input: {
    audioUrl?: string;
    transcript?: string;
    agentName: string;
    customerName?: string;
    ticketKey?: string;
  }): Promise<{ reviewId: number; review: CallReview | null }> {
    let transcript = input.transcript ?? '';

    if (!transcript && input.audioUrl) {
      transcript = await this.transcribeAudio(input.audioUrl);
    }

    if (!transcript) {
      throw new Error('No transcript or audio URL provided');
    }

    const result = await this.llmService.call<CallReview>(
      `You are a call quality reviewer for a tech support team. Analyse this support call transcript and score the interaction.\n\n## Call Details\n- Agent: ${input.agentName}\n- Customer: ${input.customerName ?? 'Unknown'}\n- Ticket: ${input.ticketKey ?? 'N/A'}\n\n## Transcript\n${transcript.slice(0, 8000)}\n\n## Your Task\nProvide a structured review with: summary, sentiment, key topics, action items, customer satisfaction score (1-10), agent performance score (1-10), and any concerns.`,
      'Review this support call transcript.',
      CallReviewSchema,
      { temperature: 0.2, callType: 'call_review' },
    );

    const review = result.data;
    const reviewId = await executeAndGetId(
      `INSERT INTO call_reviews
        (agent_name, customer_name, ticket_key, transcript, summary, sentiment, satisfaction_score, performance_score, concerns, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETUTCDATE())`,
      [
        input.agentName,
        input.customerName ?? null,
        input.ticketKey ?? null,
        transcript.slice(0, 10000),
        review?.summary ?? null,
        review?.sentiment ?? null,
        review?.customerSatisfaction ?? null,
        review?.agentPerformance ?? null,
        review?.concerns ? JSON.stringify(review.concerns) : null,
      ]
    );

    if (review) {
      const webhookUrl = this.settings.get('teams_webhook_url');
      if (webhookUrl) {
        await this.postToTeams(webhookUrl, input, review);
      }
    }

    console.log(`[call-reviews] Reviewed call #${reviewId} — agent: ${input.agentName}, score: ${review?.agentPerformance ?? 'N/A'}`);
    return { reviewId, review };
  }

  async getReviews(limit: number = 50, agentName?: string): Promise<any[]> {
    if (agentName) {
      return query(
        `SELECT TOP (?) * FROM call_reviews WHERE agent_name = ? ORDER BY created_at DESC`,
        [limit, agentName]
      );
    }
    return query(`SELECT TOP (?) * FROM call_reviews ORDER BY created_at DESC`, [limit]);
  }

  private async transcribeAudio(audioUrl: string): Promise<string> {
    const apiKey = this.settings.get('openai_api_key');
    if (!apiKey) throw new Error('OpenAI API key not configured for audio transcription');

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
    const audioBuffer = await audioResponse.arrayBuffer();

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), 'call.mp3');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.text ?? '';
  }

  private async postToTeams(webhookUrl: string, input: any, review: CallReview): Promise<void> {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          themeColor: review.agentPerformance >= 7 ? '00CC00' : review.agentPerformance >= 5 ? 'FFAA00' : 'FF0000',
          title: `Call Review: ${input.agentName}${input.ticketKey ? ` (${input.ticketKey})` : ''}`,
          text: `**Score:** ${review.agentPerformance}/10 | **Sentiment:** ${review.sentiment}\n\n${review.summary}`,
        }),
      });
    } catch { /* best-effort */ }
  }
}
