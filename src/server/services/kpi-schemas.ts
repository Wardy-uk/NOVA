import { z } from 'zod';

const flexStringArray = z.any().transform((val): string[] => {
  if (Array.isArray(val)) return val.map(v => typeof v === 'string' ? v : JSON.stringify(v));
  if (typeof val === 'string') return val.split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  return [];
});

export const DailyDigestSchema = z.object({
  headline: z.string(),
  kpi_summary: flexStringArray,
  agent_highlights: z.any().transform((val): string => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.join('; ');
    if (val && typeof val === 'object') return JSON.stringify(val);
    return '';
  }),
  concerns: flexStringArray,
  actions: flexStringArray,
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
