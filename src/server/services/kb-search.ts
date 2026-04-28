import type { SettingsQueries } from '../db/settings-store.js';
import type { KbEmbedder } from './kb-embedder.js';
import { query } from './database.js';

export interface KbMatch {
  id: string;
  title: string;
  excerpt: string;
  relevance: number;
  url: string;
}

interface ChunkRow {
  id: number;
  doc_title: string;
  doc_url: string;
  content: string;
  embedding: Buffer;
}

export class KbSearchService {
  private settings: SettingsQueries;
  private embedder: KbEmbedder | null = null;

  constructor(settings: SettingsQueries, embedder?: KbEmbedder) {
    this.settings = settings;
    this.embedder = embedder ?? null;
  }

  setEmbedder(embedder: KbEmbedder): void {
    this.embedder = embedder;
  }

  async search(queryText: string, maxResults?: number): Promise<KbMatch[]> {
    if (!this.embedder) {
      console.log(`[kb-search] No embedder configured, returning empty results`);
      return [];
    }

    const topK = maxResults ?? parseInt(this.settings.get('kb_top_k') || '3', 10);

    try {
      const queryEmbedding = await this.embedder.embedSingle(queryText);

      const chunks = await query<ChunkRow>(
        `SELECT id, doc_title, doc_url, content, embedding FROM kb_chunks`
      );

      if (chunks.length === 0) return [];

      const scored = chunks.map(chunk => {
        const chunkEmbedding = this.embedder!.deserializeEmbedding(chunk.embedding);
        const similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
        return { chunk, similarity };
      });

      scored.sort((a, b) => b.similarity - a.similarity);

      return scored.slice(0, topK).map(({ chunk, similarity }) => ({
        id: String(chunk.id),
        title: chunk.doc_title,
        excerpt: chunk.content.slice(0, 200),
        relevance: similarity,
        url: chunk.doc_url,
      }));
    } catch (err) {
      console.error(`[kb-search] Search failed:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  formatForPrompt(matches: KbMatch[]): string {
    if (matches.length === 0) return 'No knowledge base articles found.';
    return matches
      .map((m, i) => `${i + 1}. [${m.id}] ${m.title} (relevance: ${m.relevance.toFixed(2)})\n   ${m.excerpt}\n   URL: ${m.url}`)
      .join('\n');
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
