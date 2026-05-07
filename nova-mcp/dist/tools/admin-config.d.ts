import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export declare const getConfigSchema: {
    key_pattern: z.ZodOptional<z.ZodString>;
    unmask: z.ZodDefault<z.ZodBoolean>;
};
export declare function getConfig(args: {
    key_pattern?: string;
    unmask: boolean;
}): Promise<CallToolResult>;
export declare const setSettingSchema: {
    key: z.ZodString;
    value: z.ZodString;
    confirm: z.ZodDefault<z.ZodBoolean>;
};
export declare function setSetting(args: {
    key: string;
    value: string;
    confirm: boolean;
}): Promise<CallToolResult>;
