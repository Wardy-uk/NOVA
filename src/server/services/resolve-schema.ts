import { z } from 'zod';

const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

export const ResolveSummarySchema = z.object({
  resolution_summary: flexString,
  customer_message: flexString,
  reasoning: flexString,
});

export type ResolveSummaryResult = z.infer<typeof ResolveSummarySchema>;
