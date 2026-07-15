import { z } from 'zod';

// Tolerant enum — the LLM sometimes returns objects or odd casing; coerce to a
// known level and default to 'low' rather than rejecting the whole batch.
const flexSeverity = z.any().transform((val): 'critical' | 'high' | 'medium' | 'low' => {
  const levels = ['critical', 'high', 'medium', 'low'] as const;
  if (typeof val === 'string' && (levels as readonly string[]).includes(val.toLowerCase())) {
    return val.toLowerCase() as 'critical' | 'high' | 'medium' | 'low';
  }
  if (val && typeof val === 'object') {
    const c = (val.value ?? val.level ?? val.severity ?? val.label);
    if (typeof c === 'string' && (levels as readonly string[]).includes(c.toLowerCase())) {
      return c.toLowerCase() as 'critical' | 'high' | 'medium' | 'low';
    }
  }
  return 'low';
});

export const SeverityResultSchema = z.object({
  issueKey: z.string(),
  severity: flexSeverity,
  // Business-impact score 0–100 (fault criticality × blast radius). Clamped in the service.
  impactScore: z.coerce.number().catch(0),
  rationale: z.any().transform((v) => (typeof v === 'string' ? v : String(v ?? ''))).optional(),
});

export const SeverityBatchSchema = z.object({
  results: z.array(SeverityResultSchema),
});

export type SeverityResult = z.infer<typeof SeverityResultSchema>;
export type SeverityBatch = z.infer<typeof SeverityBatchSchema>;
