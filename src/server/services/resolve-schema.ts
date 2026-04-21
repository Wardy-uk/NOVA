import { z } from 'zod';

export const ResolveSummarySchema = z.object({
  resolution_summary: z.string(),
  customer_message: z.string(),
  reasoning: z.string(),
});

export type ResolveSummaryResult = z.infer<typeof ResolveSummarySchema>;
