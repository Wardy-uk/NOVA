import { z } from 'zod';

const flexEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.any().transform((val): T => {
    if (typeof val === 'string') {
      const lower = val.toLowerCase() as T;
      if ((values as readonly string[]).includes(lower)) return lower;
      if ((values as readonly string[]).includes(val)) return val as T;
    }
    if (val && typeof val === 'object') {
      const candidate = val.value ?? val.type ?? val.level ?? val.name ?? val.label;
      if (typeof candidate === 'string' && (values as readonly string[]).includes(candidate.toLowerCase())) return candidate.toLowerCase() as T;
    }
    return values[values.length - 1];
  });

const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const flexNullableString = z.any().transform((val): string | null => {
  if (val === null || val === undefined || val === 'null' || val === 'none' || val === 'N/A') return null;
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const flexConfidence = z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(0, Math.min(1, val));
  if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? 0.5 : Math.max(0, Math.min(1, n)); }
  if (val && typeof val === 'object') {
    const c = val.confidence ?? val.score ?? val.value;
    if (typeof c === 'number') return Math.max(0, Math.min(1, c));
  }
  return 0.5;
});

export const ClassificationResultSchema = z.object({
  ticket_type: flexEnum(['incident', 'service_request', 'change', 'problem'] as const).optional(),
  category: flexString,
  sub_category: flexString,
  software_area: flexNullableString,
  problem_type: flexEnum(['bug', 'config', 'user-error', 'data-issue', 'integration', 'performance', 'access', 'feature-gap', 'documentation', 'unknown'] as const),
  root_cause: flexNullableString,
  impact: flexEnum(['high', 'medium', 'low'] as const).optional(),
  urgency: flexEnum(['high', 'medium', 'low'] as const).optional(),
  priority_matrix: flexEnum(['P1', 'P2', 'P3', 'P4'] as const).optional(),
  confidence: flexConfidence,
  reasoning: flexString,
});

export type ClassificationResult = z.infer<typeof ClassificationResultSchema>;

export const TrendAnalysisResultSchema = z.object({
  period: flexString,
  categories: z.array(z.object({
    category: flexString,
    count: z.any().transform((v): number => typeof v === 'number' ? v : parseInt(String(v), 10) || 0),
    trend: flexEnum(['rising', 'stable', 'falling'] as const),
    change_pct: z.any().transform((v): number => typeof v === 'number' ? v : parseFloat(String(v)) || 0),
  })),
  notable_patterns: z.array(flexString),
  emerging_issues: z.array(flexString),
  recommendations: z.array(flexString),
  narrative: flexString,
});

export type TrendAnalysisResult = z.infer<typeof TrendAnalysisResultSchema>;
