import { z } from 'zod';

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
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'angry', 'urgent']),
  recommended_action: z.enum(['respond', 'escalate', 'close', 'gather_context', 'assign', 'no_action']),
  draft_response: z.string().nullable(),
  internal_note: z.string(),
  reasoning_trace: z.string(),
});

export type RespondResult = z.infer<typeof RespondResultSchema>;
