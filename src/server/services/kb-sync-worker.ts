import crypto from 'crypto';
import type { KbSyncProvider } from './kb-sync-provider.js';
import type { KbEmbedder } from './kb-embedder.js';
import type { KbChunker } from './kb-chunker.js';
import { query, queryOne, execute, executeAndGetId } from './database.js';

interface SyncRunRow {
  id: number;
  source: string;
  started_at: Date;
  completed_at: Date | null;
  status: string;
  docs_seen: number;
  chunks_added: number;
  chunks_updated: number;
  chunks_deleted: number;
  error_message: string | null;
}

interface ChunkRow {
  id: number;
  source_doc_id: string;
  chunk_index: number;
  content_hash: string;
}

export class KbSyncWorker {
  private embedder: KbEmbedder;
  private chunker: KbChunker;
  private running = new Set<string>();

  constructor(embedder: KbEmbedder, chunker: KbChunker) {
    this.embedder = embedder;
    this.chunker = chunker;
  }

  isRunning(source: string): boolean {
    return this.running.has(source);
  }

  async sync(provider: KbSyncProvider): Promise<number> {
    const source = provider.source;
    if (this.running.has(source)) {
      console.log(`[kb-sync] ${source}: sync already running, skipping`);
      return 0;
    }

    this.running.add(source);
    const syncStarted = new Date();
    let runId = 0;
    let docsSeen = 0;
    let chunksAdded = 0;
    let chunksUpdated = 0;
    let chunksDeleted = 0;

    try {
      runId = await executeAndGetId(
        `INSERT INTO kb_sync_runs (source, started_at, status) VALUES (?, ?, 'running')`,
        [source, syncStarted]
      );
      console.log(`[kb-sync] ${source}: starting sync (run #${runId})`);

      const embeddingModel = this.embedder['settings'].get('kb_embedding_model')?.trim() || 'text-embedding-3-small';

      for await (const doc of provider.fetchDocuments()) {
        docsSeen++;
        const contentHash = crypto.createHash('sha256').update(doc.markdown).digest('hex');

        const existingChunks = await query<ChunkRow>(
          `SELECT id, source_doc_id, chunk_index, content_hash FROM kb_chunks WHERE source = ? AND source_doc_id = ?`,
          [source, doc.sourceDocId]
        );

        if (existingChunks.length > 0 && existingChunks.every(c => c.content_hash === contentHash)) {
          await execute(
            `UPDATE kb_chunks SET last_seen_at = ? WHERE source = ? AND source_doc_id = ?`,
            [syncStarted, source, doc.sourceDocId]
          );
          continue;
        }

        // Content changed or new doc — re-chunk and re-embed
        const chunks = this.chunker.chunk(doc.markdown);
        if (chunks.length === 0) continue;

        const embeddings = await this.embedder.embed(chunks.map(c => c.content));

        // Delete old chunks for this doc
        if (existingChunks.length > 0) {
          await execute(
            `DELETE FROM kb_chunks WHERE source = ? AND source_doc_id = ?`,
            [source, doc.sourceDocId]
          );
          chunksUpdated += existingChunks.length;
        }

        // Insert new chunks
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const embeddingBuf = this.embedder.serializeEmbedding(embeddings[i]);
          await execute(
            `INSERT INTO kb_chunks (source, source_doc_id, doc_path, doc_title, doc_url, chunk_index, heading_path, content, token_count, embedding, embedding_model, content_hash, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [source, doc.sourceDocId, doc.path, doc.title, doc.url, chunk.chunkIndex, chunk.headingPath, chunk.content, chunk.tokenCount, embeddingBuf, embeddingModel, contentHash, syncStarted]
          );
          chunksAdded++;
        }
      }

      // Delete stale chunks not seen in this sync
      const deleteResult = await execute(
        `DELETE FROM kb_chunks WHERE source = ? AND last_seen_at < ?`,
        [source, syncStarted]
      );
      chunksDeleted = deleteResult.rowsAffected;

      await execute(
        `UPDATE kb_sync_runs SET status = 'success', completed_at = ?, docs_seen = ?, chunks_added = ?, chunks_updated = ?, chunks_deleted = ? WHERE id = ?`,
        [new Date(), docsSeen, chunksAdded, chunksUpdated, chunksDeleted, runId]
      );

      console.log(`[kb-sync] ${source}: completed — ${docsSeen} docs, +${chunksAdded} chunks, ~${chunksUpdated} updated, -${chunksDeleted} deleted`);
      return runId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kb-sync] ${source}: failed —`, msg);
      if (runId > 0) {
        await execute(
          `UPDATE kb_sync_runs SET status = 'error', completed_at = ?, error_message = ? WHERE id = ?`,
          [new Date(), msg, runId]
        ).catch(() => {});
      }
      return 0;
    } finally {
      this.running.delete(source);
    }
  }

  async getStatus(): Promise<{ chunks_by_source: Record<string, number>; last_sync_by_source: Record<string, SyncRunRow | null> }> {
    const chunkRows = await query<{ source: string; cnt: number }>(
      `SELECT source, COUNT(*) as cnt FROM kb_chunks GROUP BY source`
    );
    const chunks_by_source: Record<string, number> = {};
    for (const r of chunkRows) chunks_by_source[r.source] = r.cnt;

    const sources = await query<{ source: string }>(`SELECT DISTINCT source FROM kb_sync_runs`);
    const last_sync_by_source: Record<string, SyncRunRow | null> = {};
    for (const s of sources) {
      const run = await queryOne<SyncRunRow>(
        `SELECT TOP 1 * FROM kb_sync_runs WHERE source = ? ORDER BY started_at DESC`,
        [s.source]
      );
      last_sync_by_source[s.source] = run ?? null;
    }

    return { chunks_by_source, last_sync_by_source };
  }

  async getRecentRuns(source?: string, limit = 20): Promise<SyncRunRow[]> {
    if (source) {
      return query<SyncRunRow>(
        `SELECT TOP (${limit}) * FROM kb_sync_runs WHERE source = ? ORDER BY started_at DESC`,
        [source]
      );
    }
    return query<SyncRunRow>(
      `SELECT TOP (${limit}) * FROM kb_sync_runs ORDER BY started_at DESC`
    );
  }
}
