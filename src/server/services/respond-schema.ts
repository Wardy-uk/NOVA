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

export const RespondResultSchema = z.object({
  intent: z.any().transform((val) => {
    if (typeof val === 'string') return { type: val, confidence: 0.5 };
    if (val && typeof val === 'object') {
      const conf = typeof val.confidence === 'number' ? val.confidence : 0.5;
      return { type: val.type ?? val.intent ?? val.action ?? 'unknown', confidence: conf };
    }
    return { type: 'unknown', confidence: 0.5 };
  }),
  confidence: z.number().min(0).max(1),
  sentiment: flexEnum(['positive', 'neutral', 'frustrated', 'angry', 'urgent'] as const),
  recommended_action: flexEnum(['respond', 'escalate', 'close', 'gather_context', 'assign', 'no_action'] as const),
  draft_response: z.string().nullable(),
  internal_note: z.string(),
  reasoning_trace: z.string(),
});

export type RespondResult = z.infer<typeof RespondResultSchema>;
