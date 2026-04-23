import { z } from 'zod';

export const GoldenRulesScoreSchema = z.object({
  ownership: z.number().int().min(0).max(3),
  nextAction: z.number().int().min(0).max(3),
  timeframe: z.number().int().min(0).max(3),
  overall: z.number().min(0).max(3),
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
