import { z } from 'zod';

export const ClassificationResultSchema = z.object({
  category: z.string(),
  sub_category: z.string(),
  software_area: z.string().nullable(),
  problem_type: z.enum(['bug', 'config', 'user-error', 'data-issue', 'integration', 'performance', 'access', 'feature-gap', 'documentation', 'unknown']),
  root_cause: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const TrendAnalysisResultSchema = z.object({
  period: z.string(),
  categories: z.array(z.object({
    category: z.string(),
    count: z.number(),
    trend: z.enum(['rising', 'stable', 'falling']),
    change_pct: z.number(),
  })),
  notable_patterns: z.array(z.string()),
  emerging_issues: z.array(z.string()),
  recommendations: z.array(z.string()),
  narrative: z.string(),
});

export type TrendAnalysisResult = z.infer<typeof TrendAnalysisResultSchema>;
