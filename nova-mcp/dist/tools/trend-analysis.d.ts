import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const trendAnalysisSchema: {
    metric: z.ZodString;
    days: z.ZodDefault<z.ZodNumber>;
    granularity: z.ZodDefault<z.ZodEnum<["daily", "weekly"]>>;
};
export declare function trendAnalysis(args: {
    metric: string;
    days: number;
    granularity: 'daily' | 'weekly';
}): Promise<CallToolResult>;
