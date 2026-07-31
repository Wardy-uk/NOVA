import { z } from 'zod';
import { flexEnum, flexScore, flexIntScore, flexString, flexBool, flexNullableString } from './shared/flex-schemas.js';

/** Fixed grade bands. Derived from the weighted score — never taken from the LLM. */
export const QA_GRADE_BANDS = { green: 7.5, amber: 4.5 } as const;

/** Weighted overall score from the four dimensions. Single definition for every consumer. */
export function qaOverallOf(r: { accuracyScore?: number; clarityScore?: number; toneScore?: number; closureScore?: number }): number {
  // Fallbacks are unreachable for schema-validated input; they exist because the
  // server tsconfig infers every zod field as optional.
  const acc = r.accuracyScore ?? 0, cla = r.clarityScore ?? 0;
  const ton = r.toneScore ?? 0, clo = r.closureScore ?? 0;
  return Math.round((acc * 0.35 + cla * 0.25 + ton * 0.20 + clo * 0.20) * 100) / 100;
}

export function qaGradeOf(overall: number): 'Green' | 'Amber' | 'Red' {
  if (overall >= QA_GRADE_BANDS.green) return 'Green';
  if (overall >= QA_GRADE_BANDS.amber) return 'Amber';
  return 'Red';
}

export const QaTicketResultSchema = z.object({
  // overallScore/grade are accepted but ignored — see qaOverallOf/qaGradeOf. Defaulted
  // rather than optional so the inferred type stays required.
  overallScore: flexScore(1, 10).default(1),
  accuracyScore: flexScore(1, 10),
  clarityScore: flexScore(1, 10),
  toneScore: flexScore(1, 10),
  closureScore: flexScore(1, 10),
  grade: flexEnum(['Green', 'Amber', 'Red'] as const).default('Amber'),
  isConcerning: flexBool,
  severity: flexEnum(['low', 'medium', 'high'] as const).optional(),
  category: flexEnum(['accuracy', 'clarity', 'tone', 'closure', 'completeness', 'other'] as const),
  summary: flexString,
  issues: flexString,
  customerSentiment: flexEnum(['positive', 'neutral', 'negative'] as const),
  firstReplyAssessment: flexString,
  closureAssessment: flexString,
  issuesFound: z.array(flexString),
  resolutionChecks: z.object({
    clarity: z.object({ passed: flexBool, detail: flexString }),
    customerCommunication: z.object({ passed: flexBool, detail: flexString }),
    completeness: z.object({ passed: flexBool, detail: flexString }),
    resolutionTypeMatch: z.object({
      passed: flexBool,
      detail: flexString,
      suggestedType: flexNullableString,
    }),
  }),
});
export type QaTicketResult = z.infer<typeof QaTicketResultSchema>;
