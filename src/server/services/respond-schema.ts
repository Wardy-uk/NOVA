import { z } from 'zod';

export const RespondResultSchema = z.object({
  intent: z.object({ type: z.string(), confidence: z.number() }).or(
    z.string().transform(s => ({ type: s, confidence: 0.5 }))
  ).pipe(z.object({ type: z.string(), confidence: z.number() })),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'angry', 'urgent']),
  recommended_action: z.enum(['respond', 'escalate', 'close', 'gather_context', 'assign', 'no_action']),
  draft_response: z.string().nullable(),
  internal_note: z.string(),
  reasoning_trace: z.string(),
});

export type RespondResult = z.infer<typeof RespondResultSchema>;
