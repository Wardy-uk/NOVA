import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { executeAndGetId } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

// ── Types ──

export type LlmTier = 'reasoning' | 'fast';
export type LlmProvider = 'anthropic' | 'openai';

export interface LlmCallOptions {
  tier?: LlmTier;
  ticketId?: string | null;
  callType: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResult<T = unknown> {
  data: T;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

interface ProviderConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

// ── Constants ──

const CIRCUIT_BREAKER_THRESHOLD = 2;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_VALIDATION_ATTEMPTS = 1;

const DEFAULT_MODELS: Record<LlmProvider, Record<LlmTier, string>> = {
  anthropic: {
    reasoning: 'claude-sonnet-4-20250514',
    fast: 'claude-haiku-4-5-20251001',
  },
  openai: {
    reasoning: 'gpt-4.1',
    fast: 'gpt-4.1-mini',
  },
};

// Per-million-token pricing (USD). Updated April 2025.
export const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-20250514':   { inputPerM: 3.00,  outputPerM: 15.00 },
  'claude-haiku-4-5-20251001':  { inputPerM: 1.00,  outputPerM: 5.00  },
  'gpt-4.1':                    { inputPerM: 2.00,  outputPerM: 8.00  },
  'gpt-4.1-mini':               { inputPerM: 0.40,  outputPerM: 1.60  },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens * pricing.inputPerM + outputTokens * pricing.outputPerM) / 1_000_000;
}

// ── Circuit breakers (per-provider) ──

const circuits = new Map<LlmProvider, CircuitState>();

function isCircuitOpen(provider: LlmProvider): boolean {
  const state = circuits.get(provider);
  if (!state) return false;
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (Date.now() < state.openUntil) return true;
    circuits.delete(provider);
  }
  return false;
}

function recordFailure(provider: LlmProvider): void {
  const state = circuits.get(provider) ?? { failures: 0, openUntil: 0 };
  state.failures++;
  if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    state.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
  circuits.set(provider, state);
}

function recordSuccess(provider: LlmProvider): void {
  circuits.delete(provider);
}

// ── Provider calls ──

function isRetryableError(err: unknown): boolean {
  if (err instanceof Anthropic.APIError) {
    return err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503 || err.status === 529;
  }
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503;
  }
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  return {
    content: textBlock?.text ?? '',
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  return {
    content: response.choices[0]?.message?.content ?? '',
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
}

async function callProvider(
  provider: LlmProvider,
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
  maxTokens: number,
  temperature: number,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(systemPrompt, userMessage, model, apiKey, maxTokens, temperature);
    } else {
      return await callOpenAI(systemPrompt, userMessage, model, apiKey, maxTokens, temperature);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// ── Logging ──

async function logCall(
  ticketId: string | null,
  callType: string,
  provider: LlmProvider,
  model: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  success: boolean,
  error: string | null,
): Promise<void> {
  try {
    const cost = estimateCost(model, inputTokens, outputTokens);
    await executeAndGetId(
      `INSERT INTO agent_llm_calls (ticket_id, call_type, provider, model, input_tokens, output_tokens, latency_ms, success, error, estimated_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, callType, provider, model, inputTokens, outputTokens, latencyMs, success ? 1 : 0, error, cost],
    );
  } catch (e) {
    console.warn('[llm-service] Failed to log call:', e);
  }
}

// ── JSON extraction ──

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) return raw.slice(braceStart, braceEnd + 1);
  return raw.trim();
}

// ── Public API ──

export class LlmService {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  private getPrimaryConfig(tier: LlmTier): ProviderConfig | null {
    const provider = (this.settings.get('llm_primary_provider') ?? 'anthropic') as LlmProvider;
    const model = this.settings.get('llm_primary_model') ?? DEFAULT_MODELS[provider]?.[tier] ?? DEFAULT_MODELS.anthropic[tier];
    const apiKey = provider === 'anthropic'
      ? (this.settings.get('anthropic_api_key') ?? process.env.ANTHROPIC_API_KEY ?? '')
      : (this.settings.get('openai_api_key') ?? process.env.OPENAI_API_KEY ?? '');
    if (!apiKey) return null;
    return { provider, model, apiKey };
  }

  private getFailoverConfig(tier: LlmTier): ProviderConfig | null {
    const provider = (this.settings.get('llm_failover_provider') ?? 'openai') as LlmProvider;
    const model = this.settings.get('llm_failover_model') ?? DEFAULT_MODELS[provider]?.[tier] ?? DEFAULT_MODELS.openai[tier];
    const apiKey = provider === 'anthropic'
      ? (this.settings.get('anthropic_api_key') ?? process.env.ANTHROPIC_API_KEY ?? '')
      : (this.settings.get('openai_api_key') ?? process.env.OPENAI_API_KEY ?? '');
    if (!apiKey) return null;
    return { provider, model, apiKey };
  }

  async call<T>(
    systemPrompt: string,
    userMessage: string,
    schema: z.ZodType<T>,
    options: LlmCallOptions,
  ): Promise<LlmResult<T>> {
    const tier = options.tier ?? 'reasoning';
    const maxTokens = options.maxTokens ?? parseInt(this.settings.get('llm_max_tokens') ?? '4096', 10);
    const temperature = options.temperature ?? parseFloat(this.settings.get('llm_temperature') ?? '0.3');
    const ticketId = options.ticketId ?? null;

    const configs: ProviderConfig[] = [];
    const primary = this.getPrimaryConfig(tier);
    const failover = this.getFailoverConfig(tier);
    if (primary && !isCircuitOpen(primary.provider)) configs.push(primary);
    if (failover && !isCircuitOpen(failover.provider)) configs.push(failover);
    if (primary && !configs.includes(primary)) configs.push(primary);
    if (failover && !configs.includes(failover)) configs.push(failover);

    if (configs.length === 0) {
      throw new Error('No LLM providers configured. Set anthropic_api_key or openai_api_key in Settings.');
    }

    const jsonInstruction = '\n\nRespond with valid JSON only. No markdown fencing, no commentary.';
    const fullSystem = systemPrompt + jsonInstruction;

    let lastError: Error | null = null;

    for (const config of configs) {
      for (let attempt = 0; attempt <= RETRY_VALIDATION_ATTEMPTS; attempt++) {
        const start = Date.now();
        let rawContent = '';
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          const result = await callProvider(
            config.provider, fullSystem, userMessage, config.model, config.apiKey, maxTokens, temperature,
          );
          rawContent = result.content;
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
          const latencyMs = Date.now() - start;

          const jsonStr = extractJson(rawContent);
          const parsed = schema.safeParse(JSON.parse(jsonStr));

          if (parsed.success) {
            recordSuccess(config.provider);
            await logCall(ticketId, options.callType, config.provider, config.model, inputTokens, outputTokens, latencyMs, true, null);
            return {
              data: parsed.data,
              provider: config.provider,
              model: config.model,
              inputTokens,
              outputTokens,
              latencyMs,
            };
          }

          const validationErr = `Validation failed: ${parsed.error.message}`;
          await logCall(ticketId, options.callType, config.provider, config.model, inputTokens, outputTokens, latencyMs, false, validationErr);
          lastError = new Error(validationErr);

        } catch (err) {
          const latencyMs = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : String(err);
          await logCall(ticketId, options.callType, config.provider, config.model, inputTokens, outputTokens, latencyMs, false, errMsg);

          if (isRetryableError(err)) {
            recordFailure(config.provider);
            lastError = err instanceof Error ? err : new Error(errMsg);
            break;
          }

          lastError = err instanceof Error ? err : new Error(errMsg);
          if (attempt < RETRY_VALIDATION_ATTEMPTS) continue;
        }
      }
    }

    throw new Error(`All LLM providers failed. Last error: ${lastError?.message ?? 'unknown'}`);
  }

  resetCircuitBreakers(): void {
    circuits.clear();
  }
}
