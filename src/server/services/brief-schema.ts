import { z } from 'zod';

const flexEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.any().transform((val): T => {
    if (typeof val === 'string') {
      const lower = val.toLowerCase() as T;
      if ((values as readonly string[]).includes(lower)) return lower;
      if ((values as readonly string[]).includes(val)) return val as T;
    }
    if (val && typeof val === 'object') {
      const candidate = val.value ?? val.type ?? val.level ?? val.name ?? val.label;
      if (typeof candidate === 'string' && (values as readonly string[]).includes(candidate.toLowerCase())) return candidate.toLowerCase() as T;
    }
    return values[values.length - 1];
  });

const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

export const BriefResultSchema = z.object({
  customer_summary: flexString,
  ticket_analysis: flexString,
  recommended_approach: flexString,
  kb_references: z.array(flexString),
  similar_tickets: z.array(z.object({
    key: flexString,
    summary: flexString,
    resolution: flexString,
  })),
  estimated_complexity: flexEnum(['simple', 'moderate', 'complex'] as const),
  key_risks: z.array(flexString),
  suggested_skills: z.array(flexString),
});

export type BriefResult = z.infer<typeof BriefResultSchema>;
