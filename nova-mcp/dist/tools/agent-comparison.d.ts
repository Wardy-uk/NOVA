import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const agentComparisonSchema: {
    metric: z.ZodEnum<["qa_score", "open_tickets", "solved_today", "over_2h", "no_update"]>;
    days: z.ZodDefault<z.ZodNumber>;
};
export declare function agentComparison(args: {
    metric: string;
    days: number;
}): Promise<CallToolResult>;
