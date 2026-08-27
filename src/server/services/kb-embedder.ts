import OpenAI from 'openai';
import path from 'path';
import type { SettingsQueries } from '../db/settings-store.js';

const OPENAI_BATCH_SIZE = 100;
const LOCAL_BATCH_SIZE = 16;
const DEFAULT_LOCAL_MODEL = 'Xenova/bge-base-en-v1.5';

// Generates embeddings for the KB index + queries.
//
// Anthropic has no embeddings endpoint — its API is messages/batches/files/models —
// so the rest of NOVA's move to Anthropic never applied here. OpenRouter DOES have one
// (POST /api/v1/embeddings, OpenAI-shaped), so embeddings route through OpenRouter like
// every other NOVA LLM call, with the same key and gateway.
//
// The default model is 'openai/text-embedding-3-small': the SAME model behind the
// existing kb_chunks vectors, just reached through a different gateway. The vector space
// is unchanged, so this needed no re-embed. That matters — ONE model must be used
// consistently across an index, and changing model means re-embedding it entirely.
// 'local' runs an in-process transformers.js model (no API, no quota) at some CPU cost.

/** Setting keys an embedder reads. An index with no compatibility requirement to the
 *  main KB index (the gap register, for one) passes its own keys so it can run on a
 *  different provider without forcing a re-embed of kb_chunks. Each key falls back to
 *  the kb_embedding_* default when unset. */
export interface EmbedderSettingKeys {
  provider?: string;
  model?: string;
  localModel?: string;
  /** Provider when neither this embedder's key nor the shared one is set. */
  defaultProvider?: EmbedProvider;
}

export type EmbedProvider = 'openrouter' | 'openai' | 'local';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_REMOTE_MODEL = 'text-embedding-3-small';

export class KbEmbedder {
  private settings: SettingsQueries;
  private keys: Required<Omit<EmbedderSettingKeys, 'defaultProvider'>>;
  private defaultProvider: EmbedProvider;
  private localPipe: unknown = null;
  private localModelLoaded: string | null = null;

  constructor(settings: SettingsQueries, keys: EmbedderSettingKeys = {}) {
    this.settings = settings;
    this.defaultProvider = keys.defaultProvider ?? 'openrouter';
    this.keys = {
      provider: keys.provider ?? 'kb_embedding_provider',
      model: keys.model ?? 'kb_embedding_model',
      localModel: keys.localModel ?? 'kb_embedding_local_model',
    };
  }

  /** Own key first, then the shared kb_embedding_* default. */
  private setting(key: string, fallbackKey: string): string | undefined {
    return this.settings.get(key)?.trim() || this.settings.get(fallbackKey)?.trim() || undefined;
  }

  private provider(): EmbedProvider {
    const configured = this.setting(this.keys.provider, 'kb_embedding_provider')?.toLowerCase();
    if (configured === 'local') return 'local';
    if (configured === 'openai') return 'openai';
    if (configured === 'openrouter') return 'openrouter';
    return this.defaultProvider;
  }

  /** The bare model name — the vector space's identity. */
  private getRemoteModel(): string {
    const configured = this.setting(this.keys.model, 'kb_embedding_model') || DEFAULT_REMOTE_MODEL;
    return configured.includes('/') ? configured.split('/').pop()! : configured;
  }

  /** The model id as the chosen gateway wants it. OpenRouter namespaces by vendor
   *  ("openai/text-embedding-3-small"); the direct OpenAI API does not. */
  private getRemoteModelId(): string {
    const bare = this.getRemoteModel();
    if (this.provider() !== 'openrouter') return bare;
    const configured = this.setting(this.keys.model, 'kb_embedding_model');
    return configured?.includes('/') ? configured : `openai/${bare}`;
  }

  private getLocalModel(): string {
    return this.setting(this.keys.localModel, 'kb_embedding_local_model') || DEFAULT_LOCAL_MODEL;
  }

  /** The active model id, used to detect a change that requires a re-embed. Reports the
   *  BARE model name for remote providers: the vector space is defined by the model, not
   *  by the gateway it was reached through, so moving OpenAI → OpenRouter on the same
   *  model must not invalidate an existing index. */
  activeModel(): string {
    return this.provider() === 'local' ? this.getLocalModel() : this.getRemoteModel();
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.provider() === 'local' ? this.embedLocal(texts) : this.embedRemote(texts);
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const [result] = await this.embed([text]);
    return result;
  }

  // ── Remote (OpenRouter by default, or OpenAI direct) ──

  /** OpenRouter's embeddings endpoint is OpenAI-shaped, so the same client serves both —
   *  matching how llm-service already reaches OpenRouter. */
  private getClient(): OpenAI {
    if (this.provider() === 'openrouter') {
      const apiKey = this.settings.get('openrouter_api_key')?.trim() || process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OpenRouter API key not configured (openrouter_api_key)');
      return new OpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
        defaultHeaders: { 'HTTP-Referer': 'https://nova.nurtur.tech', 'X-Title': 'N.O.V.A' },
      });
    }
    const apiKey = this.settings.get('openai_api_key')?.trim();
    if (!apiKey) throw new Error('OpenAI API key not configured');
    return new OpenAI({ apiKey });
  }

  private async embedRemote(texts: string[]): Promise<Float32Array[]> {
    const client = this.getClient();
    const model = this.getRemoteModelId();
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
      const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);
      const response = await this.withRetry(() => client.embeddings.create({ model, input: batch }));
      for (const item of response.data) {
        results.push(new Float32Array(item.embedding));
      }
    }
    return results;
  }

  /** Retry transient failures (429 rate/quota, 5xx) with exponential backoff so a
   *  blip doesn't abort a whole sync. Non-retryable client errors throw at once. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number; statusCode?: number })?.status
          ?? (err as { statusCode?: number })?.statusCode;
        if (status && status !== 429 && status < 500) throw err;
        if (attempt < 3) {
          const delay = Math.min(1000 * 2 ** attempt, 8000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastErr;
  }

  // ── Local (in-process, transformers.js) ──

  private async embedLocal(texts: string[]): Promise<Float32Array[]> {
    const model = this.getLocalModel();
    if (!this.localPipe || this.localModelLoaded !== model) {
      const tf = await import('@huggingface/transformers');
      // Cache downloaded models under the data dir so they survive restarts and
      // don't re-download; falls back to the library default if DATA_DIR unset.
      const dataDir = process.env.DATA_DIR;
      if (dataDir) tf.env.cacheDir = path.join(dataDir, 'kb-embed-models');
      this.localPipe = await tf.pipeline('feature-extraction', model);
      this.localModelLoaded = model;
      console.log(`[kb-embedder] Local embedding model loaded: ${model}`);
    }

    const pipe = this.localPipe as (input: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += LOCAL_BATCH_SIZE) {
      const batch = texts.slice(i, i + LOCAL_BATCH_SIZE);
      const output = await pipe(batch, { pooling: 'mean', normalize: true });
      for (const row of output.tolist()) {
        results.push(Float32Array.from(row));
      }
    }
    return results;
  }

  // ── Serialization (unchanged; storage is model-agnostic) ──

  serializeEmbedding(embedding: Float32Array): Buffer {
    return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  }

  deserializeEmbedding(buf: Buffer): Float32Array {
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buf.length; i++) view[i] = buf[i];
    return new Float32Array(ab);
  }
}
