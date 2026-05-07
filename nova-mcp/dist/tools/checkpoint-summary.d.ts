import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const checkpointSummarySchema: {
    env: z.ZodDefault<z.ZodEnum<["live", "uat"]>>;
};
export declare function checkpointSummary(args: {
    env: string;
}): Promise<CallToolResult>;
