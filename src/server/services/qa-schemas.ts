import { z } from 'zod';

const flexEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.any().transform((val): T => {
    if (typeof val === 'string') {
      const lower = val.toLowerCase() as T;
      if ((values as readonly string[]).includes(lower)) return lower;
      if ((values as readonly string[]).includes(val)) return val as T;
      for (const v of values) { if (v.toLowerCase() === lower) return v; }
    }
    if (val && typeof val === 'object') {
      const candidate = val.value ?? val.type ?? val.level ?? val.name ?? val.label;
      if (typeof candidate === 'string') {
        for (const v of values) { if (v.toLowerCase() === candidate.toLowerCase()) return v; }
      }
    }
    return values[values.length - 1];
  });

const flexScore = (min: number, max: number) => z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(min, Math.min(max, val));
  if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? min : Math.max(min, Math.min(max, n)); }
  if (val && typeof val === 'object') {
    const c = val.score ?? val.value;
    if (typeof c === 'number') return Math.max(min, Math.min(max, c));
  }
  return min;
});

const flexIntScore = (min: number, max: number) => z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(min, Math.min(max, Math.round(val)));
  if (typeof val === 'string') { const n = parseInt(val, 10); return isNaN(n) ? min : Math.max(min, Math.min(max, n)); }
  if (val && typeof val === 'object') {
    const c = val.score ?? val.value;
    if (typeof c === 'number') return Math.max(min, Math.min(max, Math.round(c)));
  }
  return min;
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

export const QaTicketResultSchema = z.object({
  overallScore: flexScore(1, 10),
  accuracyScore: flexScore(1, 10),
  clarityScore: flexScore(1, 10),
  toneScore: flexScore(1, 10),
  closureScore: flexScore(1, 10),
  grade: flexEnum(['Green', 'Amber', 'Red'] as const),
  isConcerning: flexBool,
  severity: flexEnum(['low', 'medium', 'high'] as const).optional(),
  category: flexString,
  summary: flexString,
  issues: flexString,
  coachingPoints: flexString,
  suggestedReply: flexString,
  customerSentiment: flexEnum(['positive', 'neutral', 'negative'] as const),
  firstReplyAssessment: flexString,
  closureAssessment: flexString,
  issuesFound: z.array(flexString),
  goldenRules: z.object({
    ownership: flexIntScore(0, 3),
    nextAction: flexIntScore(0, 3),
    timeframe: flexIntScore(0, 3),
  }),
});
export type QaTicketResult = z.infer<typeof QaTicketResultSchema>;
