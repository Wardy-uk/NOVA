import { z } from 'zod';

export const DailyDigestSchema = z.object({
  headline: z.string(),
  kpi_summary: z.array(z.string()),
  agent_highlights: z.string(),
  concerns: z.array(z.string()),
  actions: z.array(z.string()),
  narrative: z.string(),
});
export type DailyDigest = z.infer<typeof DailyDigestSchema>;

export const WeeklyDigestSchema = z.object({
  headline: z.string(),
  week_over_week: z.array(z.object({
    kpi: z.string(),
    this_week: z.number(),
    last_week: z.number(),
    change_pct: z.number(),
    direction: z.enum(['up', 'down', 'flat']),
  })),
  wins: z.array(z.string()),
  risks: z.array(z.string()),
  agent_performance: z.string(),
  ticket_patterns: z.string(),
  recommendations: z.array(z.string()),
  narrative: z.string(),
});
export type WeeklyDigest = z.infer<typeof WeeklyDigestSchema>;
