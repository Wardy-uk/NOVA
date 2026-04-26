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

const flexScore = (max: number) => z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(0, Math.min(max, Math.round(val)));
  if (typeof val === 'string') { const n = parseInt(val, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(max, n)); }
  if (val && typeof val === 'object') {
    const c = val.score ?? val.value;
    if (typeof c === 'number') return Math.max(0, Math.min(max, Math.round(c)));
  }
  return 0;
});

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

export const GoldenRulesScoreSchema = z.object({
  ownership: flexScore(3),
  nextAction: flexScore(3),
  timeframe: flexScore(3),
  overall: flexScore(3),
  feedback: flexString,
  strengths: z.array(flexString),
  improvements: z.array(flexString),
});

export type GoldenRulesScore = z.infer<typeof GoldenRulesScoreSchema>;

export const CoachingAssessmentSchema = z.object({
  golden_rules: GoldenRulesScoreSchema,
  nudges: z.array(z.object({
    type: flexString,
    message: flexString,
    severity: flexEnum(['info', 'warning', 'critical'] as const),
  })),
  addresses_customer_issue: flexBool,
  includes_next_step: flexBool,
  tone_appropriate: flexBool,
});

export type CoachingAssessment = z.infer<typeof CoachingAssessmentSchema>;
