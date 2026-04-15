import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ToolResponse {
  summary: string;
  data: unknown;
  generatedAt: string;
}

export function toolResult(summary: string, data: unknown): CallToolResult {
  const response: ToolResponse = {
    summary,
    data,
    generatedAt: new Date().toISOString(),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
  };
}

export function toolError(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(v => (v - avg) ** 2);
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function ragStatus(value: number, target: number, lowerIsBetter: boolean): 'green' | 'amber' | 'red' {
  if (lowerIsBetter) {
    if (value <= target) return 'green';
    if (value <= target * 1.1) return 'amber';
    return 'red';
  }
  if (value >= target) return 'green';
  if (value >= target * 0.9) return 'amber';
  return 'red';
}
