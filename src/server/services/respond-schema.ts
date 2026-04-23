import { z } from 'zod';

export const RespondResultSchema = z.object({
  intent: z.any().transform((val) => {
    if (typeof val === 'string') return { type: val, confidence: 0.5 };
    if (val && typeof val === 'object') {
      return { type: val.type ?? val.intent ?? val.action ?? 'unknown', confidence: val.confidence ?? 0.5 };
    }
    return { type: 'unknown', confidence: 0.5 };
  }),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'angry', 'urgent']),
  recommended_action: z.enum(['respond', 'escalate', 'close', 'gather_context', 'assign', 'no_action']),
  draft_response: z.string().nullable(),
  internal_note: z.string(),
  reasoning_trace: z.string(),
});

export type RespondResult = z.infer<typeof RespondResultSchema>;
