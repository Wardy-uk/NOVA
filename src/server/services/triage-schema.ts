import { z } from 'zod';

export const TriageResultSchema = z.object({
  classification: z.object({
    ticket_type: z.enum(['incident', 'service_request', 'change', 'problem']),
    category: z.string(),
    sub_category: z.string(),
    impact: z.enum(['high', 'medium', 'low']),
    urgency: z.enum(['high', 'medium', 'low']),
    priority_matrix: z.enum(['P1', 'P2', 'P3', 'P4']),
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
