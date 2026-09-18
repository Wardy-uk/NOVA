import type { SettingsQueries } from '../db/settings-store.js';
import type { KbEmbedder } from './kb-embedder.js';
import { query } from './database.js';

export interface KbMatch {
  id: string;
  title: string;
  excerpt: string;
  relevance: number;
  url: string;
  /** Which sync provider this came from ('confluence', 'tfs-docs', ...). */
  source: string;
  /** True only for sources that are safe to quote or link in a CUSTOMER-FACING
   *  reply. Everything else is internal engineering documentation: usable to
   *  help a human, never publishable. */
  publishable: boolean;
}

/** Sources whose articles may be shown to a customer. The public Confluence
 *  Service Hub is written for customers; tfs-docs is the internal nurtur-docs
 *  git repo and must never be quoted or linked in a public reply.
 *  Override with the `kb_public_sources` setting (comma-separated). */
const DEFAULT_PUBLIC_SOURCES = ['confluence'];

export function publicKbSources(settings: SettingsQueries): string[] {
  const raw = settings.get('kb_public_sources')?.trim();
  if (!raw) return DEFAULT_PUBLIC_SOURCES;
  return raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
}

interface ChunkRow {
  id: number;
  source: string;
  doc_title: string;
  doc_url: string;
  content: string;
  embedding: Buffer;
}

/**
 * Boilerplate that every inbound external email carries and that means nothing
 * for retrieval. On NT-31736 the Mimecast caution banner was 118 of the 200
 * characters the reasoner passes to the KB, so most of the query vector was
 * built from text identical on every externally-raised ticket.
 */
const EMAIL_BOILERPLATE: RegExp[] = [
  /caution:?\s*this message comes from an external organisation[^\n]*/gi,
  /caution:?\s*this (e-?mail|message) originated (from )?outside[^\n]*/gi,
  /this (e-?mail|message) (was sent from|comes from|originated) (a|an) external[^\n]*/gi,
  /do not click links or open attachments unless you recogni[sz]e the sender[^\n]*/gi,
  /please take care when clicking links or opening attachments\.?/gi,
];

/** Strips email boilerplate so the retrieval query is the customer's actual words. */
export function cleanForKbQuery(text: string): string {
  let out = text ?? '';
  for (const p of EMAIL_BOILERPLATE) out = out.replace(p, ' ');
  return out.replace(/\s+/g, ' ').trim();
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
        `SELECT id, source, doc_title, doc_url, content, embedding FROM kb_chunks`
      );

      if (chunks.length === 0) return [];

      // Only compare same-dimension vectors. During an embedding-model switch the
      // index can briefly hold vectors from two models (e.g. 1536-d OpenAI + 768-d
      // local); skip mismatches so triage keeps working on the correctly-embedded
      // subset instead of scoring garbage / NaN.
      const dim = queryEmbedding.length;
      const scored = chunks
        .map(chunk => {
          const chunkEmbedding = this.embedder!.deserializeEmbedding(chunk.embedding);
          if (chunkEmbedding.length !== dim) return null;
          return { chunk, similarity: cosineSimilarity(queryEmbedding, chunkEmbedding) };
        })
        .filter((x): x is { chunk: ChunkRow; similarity: number } => x !== null);

      scored.sort((a, b) => b.similarity - a.similarity);

      // One chunk per DOCUMENT. A long, wordy article otherwise fills every slot
      // with its own chunks and hides every other article: on NT-31736 all three
      // top-k results were three chunks of the same login-migration page, so the
      // password-reset article the ticket was actually asking about never had a
      // slot to appear in. Keep each document's best chunk.
      const bestPerDoc = new Map<string, { chunk: ChunkRow; similarity: number }>();
      for (const entry of scored) {
        const docKey = entry.chunk.doc_url || `${entry.chunk.source}:${entry.chunk.doc_title}`;
        if (!bestPerDoc.has(docKey)) bestPerDoc.set(docKey, entry);
      }
      const deduped = [...bestPerDoc.values()];

      const publicSources = publicKbSources(this.settings);
      return deduped.slice(0, topK).map(({ chunk, similarity }) => ({
        id: String(chunk.id),
        title: chunk.doc_title,
        excerpt: chunk.content.slice(0, 200),
        relevance: similarity,
        url: chunk.doc_url,
        source: chunk.source,
        publishable: publicSources.includes((chunk.source ?? '').toLowerCase()),
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
