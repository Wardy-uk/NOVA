import { z } from 'zod';

export const TriageResultSchema = z.object({
  classification: z.object({
    category: z.enum(['bug', 'how-to', 'config-change', 'data-request', 'feature-request', 'access', 'incident', 'other']),
    sub_category: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  priority_assessment: z.object({
    suggested_priority: z.number().int().min(1).max(4),
    reasoning: z.string(),
  }),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'angry', 'urgent']),
  sla_risk: z.string(),
  recommended_action: z.enum(['respond', 'escalate', 'gather_context', 'assign']),
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
