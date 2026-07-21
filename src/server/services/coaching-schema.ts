import { z } from 'zod';
import { flexString, flexEnum } from './shared/flex-schemas.js';

export const CoachingSynthesisSchema = z.object({
  nudges: z.array(z.object({
    type: flexString,
    message: flexString,
    severity: flexEnum(['info', 'warning', 'critical'] as const),
    evidenceTickets: z.array(flexString).default([]),
  })),
  strengths: z.array(flexString),
  improvements: z.array(flexString),
  coachingMessage: flexString,
});

export type CoachingSynthesis = z.infer<typeof CoachingSynthesisSchema>;
