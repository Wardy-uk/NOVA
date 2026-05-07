import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const rawKpiQuerySchema: {
    kpi_pattern: z.ZodString;
    days: z.ZodDefault<z.ZodNumber>;
};
export declare function rawKpiQuery(args: {
    kpi_pattern: string;
    days: number;
}): Promise<CallToolResult>;
