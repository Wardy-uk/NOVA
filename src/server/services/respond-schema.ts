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

const flexString = z.any().transform((val): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return val.description ?? val.summary ?? val.value ?? val.text ?? JSON.stringify(val);
  return String(val ?? '');
});

const NO_ACTION_REASONS = ['no_customer_action', 'waiting_customer', 'waiting_partner', 'human_should_act', 'defer_check_later'] as const;

export const RespondResultSchema = z.object({
  intent: z.any().transform((val) => {
    if (typeof val === 'string') return { type: val, confidence: 0.5 };
    if (val && typeof val === 'object') {
      const conf = typeof val.confidence === 'number' ? val.confidence : 0.5;
      return { type: val.type ?? val.intent ?? val.action ?? 'unknown', confidence: conf };
    }
    return { type: 'unknown', confidence: 0.5 };
  }),
  confidence: flexConfidence,
  sentiment: flexEnum(['positive', 'neutral', 'frustrated', 'angry', 'urgent'] as const),
  recommended_action: flexEnum(['respond', 'escalate', 'close', 'gather_context', 'assign', 'no_action'] as const),
  no_action_reason: flexEnum([...NO_ACTION_REASONS] as [typeof NO_ACTION_REASONS[0], ...typeof NO_ACTION_REASONS[number][]]).optional(),
  draft_response: flexNullableString,
  internal_note: flexString,
  reasoning_trace: flexString,
});

export type NoActionReason = typeof NO_ACTION_REASONS[number];

export type RespondResult = z.infer<typeof RespondResultSchema>;
