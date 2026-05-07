import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const qaDeepDiveSchema: {
    agent: z.ZodOptional<z.ZodString>;
    days: z.ZodDefault<z.ZodNumber>;
};
export declare function qaDeepDive(args: {
    agent?: string;
    days: number;
}): Promise<CallToolResult>;
