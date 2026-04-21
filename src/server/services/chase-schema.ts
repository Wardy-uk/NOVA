import { z } from 'zod';

export const ChaseResultSchema = z.object({
  draft_response: z.string(),
  tone_check: z.enum(['friendly', 'concerned', 'neutral']),
  reasoning: z.string(),
});

export type ChaseResult = z.infer<typeof ChaseResultSchema>;
