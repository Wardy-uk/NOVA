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
  rule1Score: z.number().min(1).max(3),
  rule2Score: z.number().min(1).max(3),
  rule3Score: z.number().min(1).max(3),
  summary: z.string(),
  suggestedRewrite: z.string(),
});

/** Exactly what the LLM returns (overallScore absent). */
export type CommentReviewRaw = z.infer<typeof CommentReviewSchema>;
/** What callers get back — overallScore always present, always derived. */
export interface CommentReview extends CommentReviewRaw { overallScore: number }

/** Overall = weakest of the three rules. Single definition for every consumer. */
export function overallOf(r: { rule1Score?: number; rule2Score?: number; rule3Score?: number }): number {
  // Fallbacks are unreachable for schema-validated input; they exist because the
  // server tsconfig infers every zod field as optional.
  return Math.min(r.rule1Score ?? 1, r.rule2Score ?? 1, r.rule3Score ?? 1);
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
