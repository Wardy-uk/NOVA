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
  overallScore: z.number().min(1).max(3),
  rule1Score: z.number().min(1).max(3),
  rule2Score: z.number().min(1).max(3),
  rule3Score: z.number().min(1).max(3),
  summary: z.string(),
  suggestedRewrite: z.string(),
});

export type CommentReview = z.infer<typeof CommentReviewSchema>;

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

  const result = await llmService.call<CommentReview>(
    prompt,
    payload,
    CommentReviewSchema,
    { temperature: 0.1, ticketId: input.issueKey ?? null, callType: 'gr_comment_review' },
  );

  return result.data;
}
