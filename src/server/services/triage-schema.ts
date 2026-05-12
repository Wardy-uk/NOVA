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
  if (val && typeof val === 'object') {
    return val.description ?? val.summary ?? val.value ?? val.text ?? val.level ?? val.detail ?? JSON.stringify(val);
  }
  return String(val ?? '');
});

const flexNullableString = z.any().transform((val): string | null => {
  if (val === null || val === undefined || val === 'null' || val === 'none' || val === 'N/A' || val === '') return null;
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
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

const flexInt = (min: number, max: number) => z.any().transform((val): number => {
  if (typeof val === 'number') return Math.max(min, Math.min(max, Math.round(val)));
  if (typeof val === 'string') { const n = parseInt(val, 10); return isNaN(n) ? min : Math.max(min, Math.min(max, n)); }
  if (val && typeof val === 'object') {
    const c = val.value ?? val.priority ?? val.score;
    if (typeof c === 'number') return Math.max(min, Math.min(max, Math.round(c)));
  }
  return min;
});

const flexBool = z.any().transform((val): boolean => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1' || val.toLowerCase() === 'yes';
  return false;
});

export const TriageResultSchema = z.object({
  classification: z.object({
    ticket_type: flexEnum(['incident', 'service_request', 'change', 'problem'] as const),
    category: flexString,
    sub_category: flexString,
    impact: flexEnum(['high', 'medium', 'low'] as const),
    urgency: flexEnum(['high', 'medium', 'low'] as const),
    priority_matrix: flexEnum(['P1', 'P2', 'P3', 'P4'] as const),
    confidence: flexConfidence,
  }),
  priority_assessment: z.object({
    suggested_priority: flexInt(1, 4),
    reasoning: flexString,
  }),
  sentiment: flexEnum(['positive', 'neutral', 'frustrated', 'angry', 'urgent'] as const),
  sla_risk: flexString,
  recommended_action: flexEnum(['respond', 'escalate', 'gather_context', 'assign'] as const),
  draft_response: flexNullableString,
  internal_note: flexString,
  reasoning_trace: flexString,
  kb_gap: z.object({
    should_have_article: flexBool,
    reason: flexString,
    suggested_title: flexNullableString,
  }),
  quick_win: z.object({
    type: flexEnum(['spam', 'vendor_email', 'thank_you', 'kba_match', 'stale_no_response', 'duplicate', 'auto_resolved', 'none'] as const),
    confidence: flexConfidence,
    reasoning: flexString,
    suggested_kba: flexNullableString,
  }).optional().default({ type: 'none', confidence: 0, reasoning: '', suggested_kba: null }),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;
