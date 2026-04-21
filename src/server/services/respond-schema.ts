import { z } from 'zod';

export const RespondResultSchema = z.object({
  intent: z.object({
    type: z.enum([
      'providing_info', 'asking_question', 'confirming_resolution',
      'reporting_new_issue', 'expressing_frustration', 'follow_up', 'thanking',
    ]),
    confidence: z.number().min(0).max(1),
  }),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'angry', 'urgent']),
  recommended_action: z.enum(['respond', 'escalate', 'close', 'gather_context', 'assign', 'no_action']),
  draft_response: z.string().nullable(),
  internal_note: z.string(),
  reasoning_trace: z.string(),
});

export type RespondResult = z.infer<typeof RespondResultSchema>;
