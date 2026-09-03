import { z } from 'zod';
import type { LlmService } from './llm-service.js';
import { loadPrompt } from './prompt-loader.js';

/**
 * Shared schema + reviewer for scoring a single agent comment against the
 * 3 Golden Rules (ownership / next action / timeframe). DB-free — reused by
 * both the on-demand review endpoint and the autonomous agent's self-review.
 *
 * Mirrors the OUTPUT contract of config/prompts/gr-comment.txt. The reactive
 * GrPipeline imports this schema so the rubric lives in one place.
 */
export const CommentReviewSchema = z.object({
  issueKey: z.string(),
  commentId: z.string(),
  // Derived, never trusted from the LLM — see overallOf(). Defaulted rather than
  // optional so the prompt may omit it while the inferred type stays required.
  overallScore: z.number().min(1).max(3).default(1),
  // Why rule 3 was not scored, when it was not. Free text, one short clause.
  rule3NotApplicableReason: z.string().nullable().default(null),
  rule1Score: z.number().min(1).max(3),
  rule2Score: z.number().min(1).max(3),
  // null = the rule does not apply to this comment. 66% of comments scored 1 on
  // timeframes, and the samples showed why: handing off to a team whose timeline the
  // agent does not control, or asking the customer a question. Neither owes a date, and
  // marking them down for it made the whole metric unusable.
  rule3Score: z.number().min(1).max(3).nullable(),
  summary: z.string(),
  suggestedRewrite: z.string(),
});

/** Exactly what the LLM returns (overallScore absent). */
export type CommentReviewRaw = z.infer<typeof CommentReviewSchema>;
/** What callers get back — overallScore always present, always derived. */
export interface CommentReview extends CommentReviewRaw { overallScore: number }

/**
 * Overall = MEAN of the rules that apply. Single definition for every consumer.
 *
 * It used to be the minimum, which threw away everything the other rules said: a
 * comment scoring 3/3/1 and one scoring 1/1/1 both came out as 1. Combined with
 * timeframes failing on two thirds of comments, every agent sat permanently Red and the
 * metric discriminated between nobody. A rule scored null does not apply and is left out
 * of the mean rather than counted as a failure.
 */
export function overallOf(r: { rule1Score?: number; rule2Score?: number; rule3Score?: number | null }): number {
  // Fallbacks are unreachable for schema-validated input; they exist because the
  // server tsconfig infers every zod field as optional.
  const applicable = [r.rule1Score ?? 1, r.rule2Score ?? 1, r.rule3Score].filter(
    (v): v is number => typeof v === 'number',
  );
  if (applicable.length === 0) return 1;
  const mean = applicable.reduce((a, b) => a + b, 0) / applicable.length;
  return Math.round(mean * 100) / 100;
}

export interface ReviewCommentInput {
  commentBody: string;
  issueKey?: string;
  commentId?: string;
  priority?: string;
  issueType?: string;
  /** PASS threshold passed to the prompt (default 2, matching GrPipeline). */
  passThreshold?: number;
}

/**
 * Score a draft/posted comment against the 3 Golden Rules. Returns the
 * validated review (3 rule scores + summary + suggested 3/3/3 rewrite).
 */
export async function reviewComment(
  llmService: LlmService,
  input: ReviewCommentInput,
): Promise<CommentReview> {
  const prompt = loadPrompt('gr-comment');
  const payload = JSON.stringify({
    issueKey: input.issueKey ?? '',
    commentId: input.commentId ?? '',
    commentBody: input.commentBody.slice(0, 3000),
    ticketPriority: input.priority ?? 'Unknown',
    ticketType: input.issueType ?? 'Unknown',
    passThreshold: input.passThreshold ?? 2,
  });

  const result = await llmService.call<CommentReviewRaw>(
    prompt,
    payload,
    CommentReviewSchema,
    { temperature: 0.1, ticketId: input.issueKey ?? null, callType: 'gr_comment_review' },
  );

  return { ...result.data, overallScore: overallOf(result.data) };
}
