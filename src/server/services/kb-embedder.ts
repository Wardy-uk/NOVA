import OpenAI from 'openai';
import path from 'path';
import type { SettingsQueries } from '../db/settings-store.js';

const OPENAI_BATCH_SIZE = 100;
const LOCAL_BATCH_SIZE = 16;
const DEFAULT_LOCAL_MODEL = 'Xenova/bge-base-en-v1.5';

// Generates embeddings for the KB index + queries. ONE provider must be used
// consistently across a given index (each model has its own vector space), so
// switching provider/model requires a full re-embed. Default 'openai' keeps
// existing behaviour; 'local' runs an in-process transformers.js model — no
// external API, no quota — at the cost of some CPU and a lower-but-fine accuracy.
export class KbEmbedder {
  private settings: SettingsQueries;
  private localPipe: unknown = null;
  private localModelLoaded: string | null = null;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  private provider(): 'openai' | 'local' {
    return this.settings.get('kb_embedding_provider')?.trim().toLowerCase() === 'local' ? 'local' : 'openai';
  }

  private getOpenAiModel(): string {
    return this.settings.get('kb_embedding_model')?.trim() || 'text-embedding-3-small';
  }

  private getLocalModel(): string {
    return this.settings.get('kb_embedding_local_model')?.trim() || DEFAULT_LOCAL_MODEL;
  }

  /** The active model id — useful for logging / detecting a model change that
   *  would require a re-embed. */
  activeModel(): string {
    return this.provider() === 'local' ? this.getLocalModel() : this.getOpenAiModel();
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    return this.provider() === 'local' ? this.embedLocal(texts) : this.embedOpenAi(texts);
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const [result] = await this.embed([text]);
    return result;
  }

  // ── OpenAI ──

  private getClient(): OpenAI {
    const apiKey = this.settings.get('openai_api_key')?.trim();
    if (!apiKey) throw new Error('OpenAI API key not configured');
    return new OpenAI({ apiKey });
  }

  private async embedOpenAi(texts: string[]): Promise<Float32Array[]> {
    const client = this.getClient();
    const model = this.getOpenAiModel();
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
