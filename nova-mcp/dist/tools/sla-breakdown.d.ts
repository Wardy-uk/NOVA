import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const slaBreakdownSchema: {
    tier: z.ZodDefault<z.ZodEnum<["customer_care", "production", "tier2", "tier3", "development", "all"]>>;
    days: z.ZodDefault<z.ZodNumber>;
};
export declare function slaBreakdown(args: {
    tier: string;
    days: number;
}): Promise<CallToolResult>;
