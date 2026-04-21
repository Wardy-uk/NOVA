import { z } from 'zod';

export const BriefResultSchema = z.object({
  customer_summary: z.string(),
  ticket_analysis: z.string(),
  recommended_approach: z.string(),
  kb_references: z.array(z.string()),
  similar_tickets: z.array(z.object({
    key: z.string(),
    summary: z.string(),
    resolution: z.string(),
  })),
  estimated_complexity: z.enum(['simple', 'moderate', 'complex']),
  key_risks: z.array(z.string()),
  suggested_skills: z.array(z.string()),
});

export type BriefResult = z.infer<typeof BriefResultSchema>;
