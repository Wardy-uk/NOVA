import { z } from 'zod';

export const GoldenRulesScoreSchema = z.object({
  clarity: z.number().int().min(1).max(5),
  empathy: z.number().int().min(1).max(5),
  action: z.number().int().min(1).max(5),
  ownership: z.number().int().min(1).max(5),
  overall: z.number().min(1).max(5),
  feedback: z.string(),
  strengths: z.array(z.string()),
  improvements: z.array(z.string()),
});

export type GoldenRulesScore = z.infer<typeof GoldenRulesScoreSchema>;

export const CoachingAssessmentSchema = z.object({
  golden_rules: GoldenRulesScoreSchema,
  nudges: z.array(z.object({
    type: z.string(),
    message: z.string(),
    severity: z.enum(['info', 'warning', 'critical']),
  })),
  addresses_customer_issue: z.boolean(),
  includes_next_step: z.boolean(),
  tone_appropriate: z.boolean(),
});

export type CoachingAssessment = z.infer<typeof CoachingAssessmentSchema>;
