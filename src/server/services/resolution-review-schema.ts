import { z } from 'zod';

const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const flexBool = z.any().transform((val): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
  return false;
});

const flexNullableString = z.any().transform((val): string | null => {
  if (val === null || val === undefined || val === 'null' || val === 'none' || val === 'N/A') return null;
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

export const ResolutionReviewSchema = z.object({
  clarity: z.object({
    passed: flexBool,
    detail: flexString,
  }),
  customer_communication: z.object({
    passed: flexBool,
    detail: flexString,
  }),
  completeness: z.object({
    passed: flexBool,
    detail: flexString,
  }),
  resolution_type_match: z.object({
    passed: flexBool,
    detail: flexString,
    suggested_type: flexNullableString,
  }),
  overall_pass: flexBool,
  internal_note: flexNullableString,
  reasoning_trace: flexString,
});

export type ResolutionReview = z.infer<typeof ResolutionReviewSchema>;
