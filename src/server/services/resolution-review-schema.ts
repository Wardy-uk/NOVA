import { z } from 'zod';

export const ResolutionReviewSchema = z.object({
  clarity: z.object({
    passed: z.boolean(),
    detail: z.string(),
  }),
  customer_communication: z.object({
    passed: z.boolean(),
    detail: z.string(),
  }),
  completeness: z.object({
    passed: z.boolean(),
    detail: z.string(),
  }),
  resolution_type_match: z.object({
    passed: z.boolean(),
    detail: z.string(),
    suggested_type: z.string().nullable(),
  }),
  overall_pass: z.boolean(),
  internal_note: z.string().nullable(),
  reasoning_trace: z.string(),
});

export type ResolutionReview = z.infer<typeof ResolutionReviewSchema>;
