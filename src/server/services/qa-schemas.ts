import { z } from 'zod';

export const QaTicketResultSchema = z.object({
  overallScore: z.number().min(1).max(10),
  accuracyScore: z.number().min(1).max(10),
  clarityScore: z.number().min(1).max(10),
  toneScore: z.number().min(1).max(10),
  grade: z.enum(['Green', 'Amber', 'Red']),
  isConcerning: z.boolean(),
  severity: z.enum(['low', 'medium', 'high']).optional(),
  category: z.string(),
  summary: z.string(),
  firstReplyAssessment: z.string(),
  closureAssessment: z.string(),
  issuesFound: z.array(z.string()),
});
export type QaTicketResult = z.infer<typeof QaTicketResultSchema>;
