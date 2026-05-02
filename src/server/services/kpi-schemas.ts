import { z } from 'zod';

const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const flexStringArray = z.any().transform((val): string[] => {
  if (Array.isArray(val)) return val.map(v => typeof v === 'string' ? v : JSON.stringify(v));
  if (typeof val === 'string') return val.split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  return [];
});

export const DailyDigestSchema = z.object({
  headline: flexString,
  kpi_summary: flexStringArray,
  agent_highlights: z.any().transform((val): string => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.join('; ');
    if (val && typeof val === 'object') return JSON.stringify(val);
    return '';
  }),
  concerns: flexStringArray,
  actions: flexStringArray,
  narrative: flexString,
});
export type DailyDigest = z.infer<typeof DailyDigestSchema>;

const flexNumber = z.any().transform((val): number => {
  if (typeof val === 'number') return val;
  const n = Number(val);
  return isNaN(n) ? 0 : n;
});

const flexDirection = z.any().transform((val): 'up' | 'down' | 'flat' => {
  const s = String(val).toLowerCase().trim();
  if (s === 'up' || s === 'increase' || s === 'higher') return 'up';
  if (s === 'down' || s === 'decrease' || s === 'lower') return 'down';
  return 'flat';
});

export const WeeklyDigestSchema = z.object({
  headline: flexString,
  week_over_week: z.any().transform((val): Array<{ kpi: string; this_week: number; last_week: number; change_pct: number; direction: 'up' | 'down' | 'flat' }> => {
    if (!Array.isArray(val)) return [];
    return val.map(item => ({
      kpi: String(item?.kpi ?? ''),
      this_week: Number(item?.this_week ?? 0) || 0,
      last_week: Number(item?.last_week ?? 0) || 0,
      change_pct: Number(item?.change_pct ?? 0) || 0,
      direction: (['up', 'down', 'flat'].includes(String(item?.direction ?? '').toLowerCase()) ? String(item.direction).toLowerCase() : 'flat') as 'up' | 'down' | 'flat',
    }));
  }),
  wins: flexStringArray,
  risks: flexStringArray,
  agent_performance: z.any().transform((val): string => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.join('; ');
    if (val && typeof val === 'object') return JSON.stringify(val);
    return '';
  }),
  ticket_patterns: z.any().transform((val): string => {
    if (typeof val === 'string') return val;
    if (Array.isArray(val)) return val.join('; ');
    if (val && typeof val === 'object') return JSON.stringify(val);
    return '';
  }),
  recommendations: flexStringArray,
  narrative: flexString,
});
export type WeeklyDigest = z.infer<typeof WeeklyDigestSchema>;
