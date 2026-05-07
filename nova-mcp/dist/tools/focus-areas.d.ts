import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const focusAreasSchema: {
    days: z.ZodDefault<z.ZodNumber>;
};
export declare function focusAreas(args: {
    days: number;
}): Promise<CallToolResult>;
