import { z } from 'zod';
import { flexEnum, flexScore, flexIntScore, flexString, flexBool, flexNullableString } from './shared/flex-schemas.js';

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
