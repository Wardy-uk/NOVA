import OpenAI from 'openai';
import type { SettingsQueries } from '../db/settings-store.js';

const MAX_BATCH_SIZE = 100;

export class KbEmbedder {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  private getClient(): OpenAI {
    const apiKey = this.settings.get('openai_api_key')?.trim();
    if (!apiKey) throw new Error('OpenAI API key not configured');
    return new OpenAI({ apiKey });
  }

  private getModel(): string {
    return this.settings.get('kb_embedding_model')?.trim() || 'text-embedding-3-small';
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const client = this.getClient();
    const model = this.getModel();
    const results: Float32Array[] = [];

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const response = await client.embeddings.create({ model, input: batch });
      for (const item of response.data) {
        results.push(new Float32Array(item.embedding));
      }
    }

    return results;
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const [result] = await this.embed([text]);
    return result;
  }

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
