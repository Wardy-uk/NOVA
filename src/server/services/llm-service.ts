import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import { createHash } from 'crypto';
import { executeAndGetId, query } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { AlertService } from './alert-service.js';
import { sanitise, type RedactionEntry } from './pii-sanitiser.js';

// ── Types ──

export type LlmTier = 'reasoning' | 'standard' | 'cheap';
export type LlmProvider = 'anthropic' | 'openai' | 'openrouter';

export interface LlmImageContent {
  base64: string;
  mimeType: string;
}

export interface LlmCallOptions {
  tier?: LlmTier;
  ticketId?: string | null;
  callType: string;
  maxTokens?: number;
  temperature?: number;
  images?: LlmImageContent[];
}

export interface LlmResult<T = unknown> {
  data: T;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  promptVersion: string;
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

const MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-6-20250627': 'claude-sonnet-4-6',
  'claude-sonnet-4-6-20250514': 'claude-sonnet-4-6',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
  'claude-3-haiku-20240307': 'claude-haiku-4-5-20251001',
};

function normalizeModelId(model: string): string {
  const normalized = MODEL_ALIASES[model];
  if (normalized) {
    console.warn(`[llm] Model alias applied: "${model}" → "${normalized}"`);
  }
  return normalized ?? model;
}

const DEFAULT_MODELS: Record<LlmProvider, Record<LlmTier, string>> = {
  anthropic: {
    reasoning: 'claude-sonnet-4-6',
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
    // Anthropic Haiku primary: cheap, vision-capable, reliable. OpenRouter was
    // pure liability here — deepseek-chat-v3 404'd on images and
    // gemini-2.0-flash-lite-001 returns "No endpoints found" — and every cheap
    // call already fell up to Haiku after the wasted OpenRouter attempt. This
    // just removes the doomed hop.
    primary: { provider: 'anthropic' },
    failover: { provider: 'openai' },
  },
};

const CALL_TYPE_TIER_MAP: Record<string, LlmTier> = {
  triage: 'standard',
  respond: 'reasoning',
  coaching: 'reasoning',
  qa_scoring: 'reasoning',
  gr_comment_scoring: 'standard',
  brief: 'reasoning',
  chase: 'standard',
  trend_analysis: 'standard',
  quick_reply: 'standard',
  quick_resolve: 'standard',
  call_review: 'standard',
  '121-prep': 'standard',
  ticket_analysis: 'standard',
  ticket_classification: 'cheap',
  classification: 'cheap',
  next_action: 'cheap',
  kpi_daily_digest: 'standard',
  kpi_weekly_digest: 'standard',
};

// Per-million-token pricing (USD).
export const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  'claude-sonnet-4-6':           { inputPerM: 3.00,  outputPerM: 15.00 },
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

// ── Token budget defaults (per call_type, daily) ──

const DEFAULT_TOKEN_BUDGETS: Record<string, number> = {
  triage: 2_000_000,
  respond: 5_000_000,
  chase: 50_000,
  classification: 50_000,
  coaching: 500_000,
  qa_scoring: 300_000,
  kpi_daily_digest: 25_000,
};

// ── Budget suppression (in-memory, resets at UTC midnight) ──

const budgetSuppressed = new Map<string, boolean>();
let lastBudgetResetDate = new Date().toISOString().slice(0, 10);

function checkBudgetReset(): void {
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (todayUtc !== lastBudgetResetDate) {
    budgetSuppressed.clear();
    lastBudgetResetDate = todayUtc;
  }
}

export class TokenBudgetExceededError extends Error {
  constructor(public callType: string, public used: number, public budget: number) {
    super(`Token budget exceeded for ${callType}: ${used}/${budget} tokens used today`);
    this.name = 'TokenBudgetExceededError';
  }
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
  images?: LlmImageContent[],
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const client = new Anthropic({ apiKey });

  const contentParts: Anthropic.MessageCreateParams['messages'][0]['content'] = [];
  if (images && images.length > 0) {
    for (const img of images) {
      contentParts.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: img.base64 },
      });
    }
  }
  contentParts.push({ type: 'text', text: userMessage });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: contentParts }],
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
  images?: LlmImageContent[],
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...(defaultHeaders ? { defaultHeaders } : {}) });

  let userContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }> = userMessage;
  if (images && images.length > 0) {
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];
    for (const img of images) {
      parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
    }
    parts.push({ type: 'text', text: userMessage });
    userContent = parts;
  }

  const response = await client.chat.completions.create({
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent as any },
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
  images?: LlmImageContent[],
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    if (provider === 'anthropic') {
      return await callAnthropic(systemPrompt, userMessage, model, apiKey, maxTokens, temperature, images);
    } else if (provider === 'openrouter') {
      return await callOpenAI(systemPrompt, userMessage, model, apiKey, maxTokens, temperature,
        'https://openrouter.ai/api/v1',
        { 'HTTP-Referer': 'https://nova.nurtur.tech', 'X-Title': 'N.O.V.A' },
        images,
      );
    } else {
      return await callOpenAI(systemPrompt, userMessage, model, apiKey, maxTokens, temperature, undefined, undefined, images);
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
  promptVersion: string,
  redactions: RedactionEntry[] | null,
): Promise<void> {
  try {
    const cost = estimateCost(model, inputTokens, outputTokens);
    const redactionsJson = redactions && redactions.length > 0 ? JSON.stringify(redactions) : null;
    await executeAndGetId(
      `INSERT INTO agent_llm_calls (ticket_id, call_type, provider, model, input_tokens, output_tokens, latency_ms, success, error, estimated_cost, prompt_version, redactions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ticketId, callType, provider, model, inputTokens, outputTokens, latencyMs, success ? 1 : 0, error, cost, promptVersion, redactionsJson],
    );
  } catch (e) {
    console.warn('[llm-service] Failed to log call:', e);
  }
}

// ── JSON extraction ──

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fenced ? fenced[1].trim() : raw;

  // Scan from the first opening bracket and return the first *balanced* object
  // or array. Brace-counting (ignoring braces inside strings) survives trailing
  // prose — even prose that itself contains braces — which the old
  // indexOf/lastIndexOf approach mangled into invalid JSON.
  const balanced = firstBalancedJson(source);
  if (balanced) return balanced;

  return source.trim();
}

function firstBalancedJson(s: string): string | null {
  const open = s.search(/[{[]/);
  if (open === -1) return null;
  const closeFor = s[open] === '{' ? '}' : ']';
  const openCh = s[open];

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeFor) {
      depth--;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  return null;
}

// ── Public API ──

export class LlmService {
  private settings: SettingsQueries;
  private alertService: AlertService | null = null;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
    this.logEffectiveBudgets();
  }

  setAlertService(alertService: AlertService): void {
    this.alertService = alertService;
  }

  private logEffectiveBudgets(): void {
    const budgetTypes = Object.keys(DEFAULT_TOKEN_BUDGETS);
    const lines = budgetTypes.map(ct => {
      const settingKey = `agent_token_budget_daily_${ct}`;
      const dbVal = this.settings.get(settingKey)?.trim();
      const effective = dbVal ? (parseInt(dbVal, 10) || 0) : (DEFAULT_TOKEN_BUDGETS[ct] ?? 0);
      const source = dbVal ? 'DB' : 'default';
      return `  ${ct}: ${effective.toLocaleString()} (${source}${dbVal ? `, raw="${dbVal}"` : ''})`;
    });
    console.log(`[llm-budget] Effective daily token budgets:\n${lines.join('\n')}`);
  }

  private async checkTokenBudget(callType: string): Promise<void> {
    checkBudgetReset();

    if (budgetSuppressed.get(callType)) {
      const budget = this.getTokenBudget(callType);
      console.warn(`[llm-budget] BLOCKED ${callType} — suppressed flag set (budget=${budget.toLocaleString()})`);
      throw new TokenBudgetExceededError(callType, budget, budget);
    }

    const budget = this.getTokenBudget(callType);
    if (budget <= 0) return;

    const rows = await query<{ total: number }>(
      `SELECT ISNULL(SUM(ISNULL(input_tokens, 0) + ISNULL(output_tokens, 0)), 0) as total
       FROM agent_llm_calls
       WHERE call_type = ? AND created_at >= CAST(GETUTCDATE() AS DATE)`,
      [callType],
    );
    const used = rows[0]?.total ?? 0;

    if (used >= budget) {
      budgetSuppressed.set(callType, true);
      console.warn(`[llm-budget] Token budget exceeded for ${callType}: ${used.toLocaleString()}/${budget.toLocaleString()} — suppressed until midnight UTC`);

      if (this.alertService) {
        await this.alertService.createAlert({
          alertType: 'token_budget_exceeded',
          severity: 'critical',
          title: `Token budget exceeded: ${callType} used ${used.toLocaleString()} of ${budget.toLocaleString()} daily tokens`,
          detail: `Call type "${callType}" has been suppressed until UTC midnight. Adjust agent_token_budget_daily_${callType} in Settings to change the limit.`,
        });
      }

      throw new TokenBudgetExceededError(callType, used, budget);
    }
  }

  private getTokenBudget(callType: string): number {
    const settingKey = `agent_token_budget_daily_${callType}`;
    const val = this.settings.get(settingKey)?.trim();
    if (val) {
      const parsed = parseInt(val, 10) || 0;
      console.log(`[llm-budget] ${callType} budget from DB settings: ${parsed.toLocaleString()}`);
      return parsed;
    }
    const fallback = DEFAULT_TOKEN_BUDGETS[callType] ?? 0;
    console.log(`[llm-budget] ${callType} budget from hardcoded default: ${fallback.toLocaleString()}`);
    return fallback;
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
    if (primaryKey && primaryKey.length < 10) {
      console.warn(`[llm] ${tierCfg.primary.provider} API key looks invalid (${primaryKey.length} chars)`);
    }
    if (primaryKey) {
      configs.push({
        provider: tierCfg.primary.provider,
        model: normalizeModelId(tierCfg.primary.model || DEFAULT_MODELS[tierCfg.primary.provider]?.[tier] || DEFAULT_MODELS.anthropic[tier]),
        apiKey: primaryKey,
      });
    }

    const failoverKey = this.getApiKey(tierCfg.failover.provider);
    if (failoverKey) {
      const failoverModel = normalizeModelId(tierCfg.failover.model || DEFAULT_MODELS[tierCfg.failover.provider]?.[tier] || DEFAULT_MODELS.openai[tier]);
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
    await this.checkTokenBudget(options.callType);

    const tier = options.tier ?? CALL_TYPE_TIER_MAP[options.callType] ?? 'standard';
    const maxTokens = options.maxTokens ?? parseInt(this.settings.get('llm_max_tokens')?.trim() || '4096', 10);
    const temperature = options.temperature ?? parseFloat(this.settings.get('llm_temperature')?.trim() || '0.3');
    const ticketId = options.ticketId ?? null;

    const hash8 = createHash('sha256').update(systemPrompt).digest('hex').slice(0, 8);
    const promptVersion = `${options.callType}:${hash8}`;

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

    const jsonInstruction = '\n\nRespond with valid JSON only. No markdown fencing, no commentary. Every string field must be a plain string value, never an object or array. For example: "summary": "text here" NOT "summary": {"description": "text here"}';
    const sysResult = sanitise(systemPrompt);
    const userResult = sanitise(userMessage);
    const allRedactions = [...sysResult.redactions, ...userResult.redactions];
    const redactionsForLog = allRedactions.length > 0 ? allRedactions : null;
    if (allRedactions.length > 0) {
      console.log(`[llm] PII redacted in ${options.callType}: ${allRedactions.map(r => `${r.count}× ${r.type}`).join(', ')}`);
    }
    const fullSystem = sysResult.sanitised + jsonInstruction;
    const sanitisedUser = userResult.sanitised;

    let lastError: Error | null = null;

    for (const config of orderedConfigs) {
      for (let attempt = 0; attempt <= RETRY_VALIDATION_ATTEMPTS; attempt++) {
        const start = Date.now();
        let rawContent = '';
        let inputTokens = 0;
        let outputTokens = 0;

        try {
          const result = await callProvider(
            config.provider, fullSystem, sanitisedUser, config.model, config.apiKey, maxTokens, temperature, options.images,
          );
          rawContent = result.content;
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
          const latencyMs = Date.now() - start;

          const jsonStr = extractJson(rawContent);
          const parsed = schema.safeParse(JSON.parse(jsonStr));

          if (parsed.success) {
            recordSuccess(config.provider);
            await logCall(ticketId, options.callType, config.provider, config.model, inputTokens, outputTokens, latencyMs, true, null, promptVersion, redactionsForLog);

            // E4: Shadow model comparison (fire-and-forget)
            this.maybeShadowCompare(fullSystem, sanitisedUser, options.callType, config.model, parsed.data as Record<string, unknown>, maxTokens, temperature).catch(() => {});

            return {
              data: parsed.data,
              provider: config.provider,
              model: config.model,
              inputTokens,
              outputTokens,
              latencyMs,
              promptVersion,
            };
          }

          const validationErr = `Validation failed: ${parsed.error.message}`;
          await logCall(ticketId, options.callType, config.provider, config.model, inputTokens, outputTokens, latencyMs, false, validationErr, promptVersion, redactionsForLog);
          recordFailure(config.provider);
          lastError = new Error(validationErr);

        } catch (err) {
          const latencyMs = Date.now() - start;
          const errMsg = err instanceof Error ? err.message : String(err);
          await logCall(ticketId, options.callType, config.provider, config.model, inputTokens, outputTokens, latencyMs, false, errMsg, promptVersion, redactionsForLog);
          lastError = err instanceof Error ? err : new Error(errMsg);

          if (isRetryableError(err)) {
            recordFailure(config.provider);
            break;
          }

          if (err instanceof SyntaxError) {
            recordFailure(config.provider);
            break;
          }

          if (attempt < RETRY_VALIDATION_ATTEMPTS) continue;
        }
      }
    }

    throw new Error(`All LLM providers failed. Last error: ${lastError?.message ?? 'unknown'}`);
  }

  private async maybeShadowCompare(
    systemPrompt: string,
    userMessage: string,
    callType: string,
    primaryModel: string,
    primaryResult: Record<string, unknown>,
    maxTokens: number,
    temperature: number,
  ): Promise<void> {
    const enabled = this.settings.get('agent_shadow_model_enabled') === 'true';
    if (!enabled) return;

    const shadowModelId = this.settings.get('agent_shadow_model_id');
    if (!shadowModelId) return;

    const sampleRate = parseInt(this.settings.get('agent_shadow_model_sample_rate') ?? '10', 10);
    if (Math.random() * 100 >= sampleRate) return;

    try {
      // Determine provider from model ID
      let shadowProvider: LlmProvider = 'openai';
      if (shadowModelId.startsWith('claude')) shadowProvider = 'anthropic';
      else if (shadowModelId.includes('/')) shadowProvider = 'openrouter';

      const apiKey = this.getApiKey(shadowProvider);
      if (!apiKey) return;

      const result = await callProvider(shadowProvider, systemPrompt, userMessage, shadowModelId, apiKey, maxTokens, temperature);
      const jsonStr = extractJson(result.content);
      const parsed = JSON.parse(jsonStr);

      const primaryAction = (primaryResult as any)?.recommended_action ?? 'unknown';
      const shadowAction = parsed?.recommended_action ?? 'unknown';
      const primaryConf = (primaryResult as any)?.classification?.confidence ?? null;
      const shadowConf = parsed?.classification?.confidence ?? null;

      await executeAndGetId(
        `INSERT INTO agent_model_comparisons (call_type, primary_model, shadow_model, primary_action, shadow_action, actions_match, primary_confidence, shadow_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [callType, primaryModel, shadowModelId, primaryAction, shadowAction, primaryAction === shadowAction ? 1 : 0, primaryConf, shadowConf],
      );
    } catch (err) {
      console.warn('[llm] Shadow model comparison failed:', err instanceof Error ? err.message : err);
    }
  }

  resetCircuitBreakers(): void {
    circuits.clear();
  }

  resetBudgetSuppression(): string[] {
    const cleared = [...budgetSuppressed.keys()].filter(k => budgetSuppressed.get(k));
    budgetSuppressed.clear();
    if (cleared.length > 0) {
      console.log(`[llm-budget] Cleared suppression for: ${cleared.join(', ')}`);
    }
    return cleared;
  }

  getBudgetStatus(): Record<string, { budget: number; suppressed: boolean; source: string }> {
    const result: Record<string, { budget: number; suppressed: boolean; source: string }> = {};
    for (const ct of Object.keys(DEFAULT_TOKEN_BUDGETS)) {
      const settingKey = `agent_token_budget_daily_${ct}`;
      const dbVal = this.settings.get(settingKey)?.trim();
      result[ct] = {
        budget: dbVal ? (parseInt(dbVal, 10) || 0) : (DEFAULT_TOKEN_BUDGETS[ct] ?? 0),
        suppressed: budgetSuppressed.get(ct) === true,
        source: dbVal ? 'db' : 'default',
      };
    }
    return result;
  }

  getDiagnostics(): {
    primaryProvider: string; primaryModel: string; primaryKeyPrefix: string; primaryAvailable: boolean;
    failoverProvider: string; failoverModel: string; failoverKeyPrefix: string; failoverAvailable: boolean;
    anthropicCircuit: string; openaiCircuit: string; openrouterCircuit: string;
    tierRouting: Record<LlmTier, TierConfig>;
    callTypeTiers: Record<string, LlmTier>;
    budgetStatus: Record<string, { budget: number; suppressed: boolean; source: string }>;
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
      budgetStatus: this.getBudgetStatus(),
    };
  }
}
