import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { executeAndGetId } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

// ── Types ──

export type LlmTier = 'reasoning' | 'standard' | 'cheap';
export type LlmProvider = 'anthropic' | 'openai' | 'openrouter';

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

interface TierConfig {
  primary: { provider: LlmProvider; model?: string };
  failover: { provider: LlmProvider; model?: string };
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
    reasoning: 'claude-sonnet-4-6-20250627',
    standard: 'claude-haiku-4-5-20251001',
    cheap: 'claude-haiku-4-5-20251001',
  },
  openai: {
    reasoning: 'gpt-4.1',
    standard: 'gpt-4.1-mini',
    cheap: 'gpt-4.1-mini',
  },
  openrouter: {
    reasoning: 'anthropic/claude-sonnet-4',
    standard: 'anthropic/claude-haiku-4',
    cheap: 'google/gemini-2.0-flash-lite-001',
  },
};

const DEFAULT_TIER_CONFIG: Record<LlmTier, TierConfig> = {
  reasoning: {
    primary: { provider: 'anthropic' },
    failover: { provider: 'openai' },
  },
  standard: {
    primary: { provider: 'anthropic' },
    failover: { provider: 'openai' },
  },
  cheap: {
    primary: { provider: 'openrouter' },
    failover: { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3-0324' },
  },
};

const CALL_TYPE_TIER_MAP: Record<string, LlmTier> = {
  triage: 'reasoning',
  respond: 'reasoning',
  coaching: 'reasoning',
  qa_scoring: 'reasoning',
  resolution_review: 'reasoning',
  brief: 'reasoning',
  chase: 'standard',
  trend_analysis: 'standard',
  quick_reply: 'standard',
  quick_resolve: 'standard',
  call_review: 'standard',
  '121-prep': 'standard',
  ticket_analysis: 'cheap',
  ticket_classification: 'cheap',
  classification: 'cheap',
  kpi_daily_digest: 'cheap',
  kpi_weekly_digest: 'cheap',
};

// Per-million-token pricing (USD).
export const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-6-20250627': { inputPerM: 3.00,  outputPerM: 15.00 },
  'claude-sonnet-4-20250514':   { inputPerM: 3.00,  outputPerM: 15.00 },
  'claude-haiku-4-5-20251001':  { inputPerM: 1.00,  outputPerM: 5.00  },
  'gpt-4.1':                    { inputPerM: 2.00,  outputPerM: 8.00  },
  'gpt-4.1-mini':               { inputPerM: 0.40,  outputPerM: 1.60  },
  // OpenRouter models
  'google/gemini-2.0-flash-lite-001':  { inputPerM: 0.075, outputPerM: 0.30  },
  'deepseek/deepseek-chat-v3-0324':    { inputPerM: 0.27,  outputPerM: 1.10  },
  'anthropic/claude-sonnet-4':         { inputPerM: 3.00,  outputPerM: 15.00 },
  'anthropic/claude-haiku-4':          { inputPerM: 1.00,  outputPerM: 5.00  },
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
    console.warn(`[llm] Circuit breaker TRIPPED for ${provider} — ${state.failures} failures, cooldown ${CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
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
  baseURL?: string,
  defaultHeaders?: Record<string, string>,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...(defaultHeaders ? { defaultHeaders } : {}) });
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
    } else if (provider === 'openrouter') {
      return await callOpenAI(systemPrompt, userMessage, model, apiKey, maxTokens, temperature,
        'https://openrouter.ai/api/v1',
        { 'HTTP-Referer': 'https://nova.nurtur.tech', 'X-Title': 'N.O.V.A' },
      );
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
  const bracketStart = raw.indexOf('[');
  const bracketEnd = raw.lastIndexOf(']');
  if (bracketStart !== -1 && bracketEnd > bracketStart) return raw.slice(bracketStart, bracketEnd + 1);
  return raw.trim();
}

// ── Public API ──

export class LlmService {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  private getApiKey(provider: LlmProvider): string {
    if (provider === 'anthropic') {
      return this.settings.get('anthropic_api_key')?.trim() || process.env.ANTHROPIC_API_KEY || '';
    }
    if (provider === 'openrouter') {
      return this.settings.get('openrouter_api_key')?.trim() || process.env.OPENROUTER_API_KEY || '';
    }
    return this.settings.get('openai_api_key')?.trim() || process.env.OPENAI_API_KEY || '';
  }

  private getTierConfig(tier: LlmTier): TierConfig {
    const routingJson = this.settings.get('agent_model_routing')?.trim();
    if (routingJson) {
      try {
        const routing = JSON.parse(routingJson);
        if (routing[tier]) return routing[tier] as TierConfig;
      } catch { /* fall through to defaults */ }
    }
    return DEFAULT_TIER_CONFIG[tier];
  }

  private getConfigsForTier(tier: LlmTier): ProviderConfig[] {
    const tierCfg = this.getTierConfig(tier);
    const configs: ProviderConfig[] = [];

    const primaryKey = this.getApiKey(tierCfg.primary.provider);
    if (primaryKey) {
      configs.push({
        provider: tierCfg.primary.provider,
        model: tierCfg.primary.model || DEFAULT_MODELS[tierCfg.primary.provider]?.[tier] || DEFAULT_MODELS.anthropic[tier],
        apiKey: primaryKey,
      });
    }

    const failoverKey = this.getApiKey(tierCfg.failover.provider);
    if (failoverKey) {
      const failoverModel = tierCfg.failover.model || DEFAULT_MODELS[tierCfg.failover.provider]?.[tier] || DEFAULT_MODELS.openai[tier];
      const failoverConfig: ProviderConfig = { provider: tierCfg.failover.provider, model: failoverModel, apiKey: failoverKey };
      if (failoverConfig.provider !== configs[0]?.provider || failoverConfig.model !== configs[0]?.model) {
        configs.push(failoverConfig);
      }
    }

    return configs;
  }

  async call<T>(
    systemPrompt: string,
    userMessage: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: LlmCallOptions,
  ): Promise<LlmResult<T>> {
    const tier = options.tier ?? CALL_TYPE_TIER_MAP[options.callType] ?? 'standard';
    const maxTokens = options.maxTokens ?? parseInt(this.settings.get('llm_max_tokens')?.trim() || '4096', 10);
    const temperature = options.temperature ?? parseFloat(this.settings.get('llm_temperature')?.trim() || '0.3');
    const ticketId = options.ticketId ?? null;

    // Build provider chain: tier configs, then fall-up chain (cheap → standard → reasoning)
    const tiers: LlmTier[] = tier === 'cheap' ? ['cheap', 'standard', 'reasoning']
      : tier === 'standard' ? ['standard', 'reasoning'] : ['reasoning'];

    const seen = new Set<string>();
    const configs: ProviderConfig[] = [];
    for (const t of tiers) {
      for (const cfg of this.getConfigsForTier(t)) {
        const key = `${cfg.provider}:${cfg.model}`;
        if (!seen.has(key)) {
          seen.add(key);
          configs.push(cfg);
        }
      }
    }

    // Filter by circuit breaker, but keep circuit-broken ones as last resort
    const available = configs.filter(c => !isCircuitOpen(c.provider));
    const tripped = configs.filter(c => isCircuitOpen(c.provider));
    const orderedConfigs = [...available, ...tripped];

    if (orderedConfigs.length === 0) {
      throw new Error('No LLM providers configured. Set anthropic_api_key, openai_api_key, or openrouter_api_key in Settings.');
    }

    // Log provider selection for diagnostics
    const selectedProvider = orderedConfigs[0];
    const circuitStates = (['anthropic', 'openai', 'openrouter'] as LlmProvider[])
      .map(p => `${p}:${isCircuitOpen(p) ? 'OPEN' : 'ok'}`)
      .join(' ');
    console.log(`[llm] ${options.callType} → tier=${tier} → ${selectedProvider.provider}/${selectedProvider.model} | circuits: ${circuitStates}${tripped.length > 0 ? ' (FAILOVER)' : ''}`);

    const jsonInstruction = '\n\nRespond with valid JSON only. No markdown fencing, no commentary.';
    const fullSystem = systemPrompt + jsonInstruction;

    let lastError: Error | null = null;

    for (const config of orderedConfigs) {
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
          recordFailure(config.provider);
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

  getDiagnostics(): {
    primaryProvider: string; primaryModel: string; primaryKeyPrefix: string; primaryAvailable: boolean;
    failoverProvider: string; failoverModel: string; failoverKeyPrefix: string; failoverAvailable: boolean;
    anthropicCircuit: string; openaiCircuit: string; openrouterCircuit: string;
    tierRouting: Record<LlmTier, TierConfig>;
    callTypeTiers: Record<string, LlmTier>;
  } {
    const reasoningCfgs = this.getConfigsForTier('reasoning');
    const primary = reasoningCfgs[0] ?? null;
    const failover = reasoningCfgs[1] ?? null;
    const maskKey = (k: string | undefined) => k ? k.slice(0, 8) + '...' : '(not set)';
    return {
      primaryProvider: primary?.provider ?? '(none)',
      primaryModel: primary?.model ?? '(no key)',
      primaryKeyPrefix: maskKey(primary?.apiKey),
      primaryAvailable: !!primary,
      failoverProvider: failover?.provider ?? '(none)',
      failoverModel: failover?.model ?? '(no key)',
      failoverKeyPrefix: maskKey(failover?.apiKey),
      failoverAvailable: !!failover,
      anthropicCircuit: isCircuitOpen('anthropic') ? 'OPEN' : 'closed',
      openaiCircuit: isCircuitOpen('openai') ? 'OPEN' : 'closed',
      openrouterCircuit: isCircuitOpen('openrouter') ? 'OPEN' : 'closed',
      tierRouting: {
        reasoning: this.getTierConfig('reasoning'),
        standard: this.getTierConfig('standard'),
        cheap: this.getTierConfig('cheap'),
      },
      callTypeTiers: { ...CALL_TYPE_TIER_MAP },
    };
  }
}
