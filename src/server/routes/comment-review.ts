import { Router } from 'express';
import type { LlmService } from '../services/llm-service.js';
import { reviewComment } from '../services/comment-review.js';

/**
 * On-demand Golden-Rules review for a draft comment.
 * POST /api/comments/review  { commentBody, ticketKey?, priority?, issueType? }
 */
export function createCommentReviewRoutes(deps: { llmService: LlmService }): Router {
  const router = Router();

  router.post('/review', async (req, res) => {
    const { commentBody, ticketKey, priority, issueType } = req.body as {
      commentBody?: string;
      ticketKey?: string;
      priority?: string;
      issueType?: string;
    };

    if (!commentBody || !commentBody.trim()) {
      res.status(400).json({ ok: false, error: 'commentBody is required' });
      return;
    }

    try {
      const data = await reviewComment(deps.llmService, {
        commentBody,
        issueKey: ticketKey,
        priority,
        issueType,
      });
      res.json({ ok: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[comment-review] review failed:', message);
      res.status(500).json({ ok: false, error: 'Comment review failed' });
    }
  });

  return router;
}
