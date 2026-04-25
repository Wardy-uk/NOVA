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

export const TriageResultSchema = z.object({
  classification: z.object({
    ticket_type: flexEnum(['incident', 'service_request', 'change', 'problem'] as const),
    category: z.string(),
    sub_category: z.string(),
    impact: flexEnum(['high', 'medium', 'low'] as const),
    urgency: flexEnum(['high', 'medium', 'low'] as const),
    priority_matrix: flexEnum(['P1', 'P2', 'P3', 'P4'] as const),
    confidence: z.number().min(0).max(1),
  }),
  priority_assessment: z.object({
    suggested_priority: z.number().int().min(1).max(4),
    reasoning: z.string(),
  }),
  sentiment: flexEnum(['positive', 'neutral', 'frustrated', 'angry', 'urgent'] as const),
  sla_risk: flexString,
  recommended_action: flexEnum(['respond', 'escalate', 'gather_context', 'assign'] as const),
  draft_response: z.string().nullable(),
  internal_note: z.string(),
  reasoning_trace: z.string(),
  kb_gap: z.object({
    should_have_article: z.boolean(),
    reason: z.string(),
    suggested_title: z.string().nullable(),
  }),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;
