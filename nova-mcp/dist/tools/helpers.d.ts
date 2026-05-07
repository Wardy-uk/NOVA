import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export interface ToolResponse {
    summary: string;
    data: unknown;
    generatedAt: string;
}
export declare function toolResult(summary: string, data: unknown): CallToolResult;
export declare function toolError(message: string): CallToolResult;
export declare function mean(values: number[]): number;
export declare function stddev(values: number[]): number;
export declare function pctChange(current: number, previous: number): number | null;
export declare function ragStatus(value: number, target: number, lowerIsBetter: boolean): 'green' | 'amber' | 'red';
