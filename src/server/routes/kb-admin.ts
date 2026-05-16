import { Router } from 'express';
import type { KbSyncWorker } from '../services/kb-sync-worker.js';
import type { KbSearchService } from '../services/kb-search.js';
import type { KbEmbedder } from '../services/kb-embedder.js';
import type { KbSyncProvider } from '../services/kb-sync-provider.js';
import { requireRole } from '../middleware/auth.js';
import { execute, query, queryOne } from '../services/database.js';

interface KbAdminDeps {
  syncWorker: KbSyncWorker;
  searchService: KbSearchService;
  embedder: KbEmbedder;
  providers: Map<string, KbSyncProvider>;
}

export function createKbAdminRoutes(deps: KbAdminDeps): Router {
  const router = Router();
  const { syncWorker, searchService, providers } = deps;

  router.get('/status', async (_req, res) => {
    try {
      const status = await syncWorker.getStatus();
      const embeddingModel = deps.embedder['settings'].get('kb_embedding_model')?.trim() || 'text-embedding-3-small';
      res.json({
        ok: true,
        data: {
          ...status,
          embedding_model: embeddingModel,
          vector_storage_mode: 'varbinary',
          registered_providers: Array.from(providers.keys()),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Status check failed' });
    }
  });

  router.post('/sync/:source', requireRole('admin', 'super_admin'), async (req, res) => {
    const source = String(req.params.source);
    const provider = providers.get(source);
    if (!provider) {
      res.status(404).json({ ok: false, error: `Unknown source: ${source}` });
      return;
    }
    if (syncWorker.isRunning(source)) {
      res.status(409).json({ ok: false, error: `Sync already running for ${source}` });
      return;
    }

    try {
      const chunksStored = await syncWorker.sync(provider);
      res.json({ ok: true, data: { chunksStored, message: `Sync complete: ${chunksStored} chunks` } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  router.get('/sync-runs', async (req, res) => {
    try {
      const source = typeof req.query.source === 'string' ? req.query.source : undefined;
      const limit = parseInt(typeof req.query.limit === 'string' ? req.query.limit : '20', 10);
      const runs = await syncWorker.getRecentRuns(source, limit);
      res.json({ ok: true, data: runs });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch sync runs' });
    }
  });

  router.delete('/chunks/:source', requireRole('admin', 'super_admin'), async (req, res) => {
    const source = String(req.params.source);
    try {
      const result = await execute(`DELETE FROM kb_chunks WHERE source = ?`, [source]);
      const deleted = result?.rowsAffected ?? 0;
      console.log(`[kb-admin] Purged ${deleted} chunks for source: ${source}`);
      res.json({ ok: true, data: { deleted, message: `Purged ${deleted} chunks from ${source}` } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Purge failed' });
    }
  });

  router.post('/search', requireRole('admin', 'super_admin'), async (req, res) => {
    const q = req.body?.q || (typeof req.query?.q === 'string' ? req.query.q : undefined);
    if (!q) {
      res.status(400).json({ ok: false, error: 'q parameter required' });
      return;
    }
    try {
      const results = await searchService.search(q as string, 10);
      res.json({ ok: true, data: results });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  router.get('/chunks', async (req, res) => {
    try {
      const source = typeof req.query.source === 'string' ? req.query.source : undefined;
      const search = typeof req.query.q === 'string' ? req.query.q : undefined;
      const page = parseInt(typeof req.query.page === 'string' ? req.query.page : '1', 10);
      const pageSize = 50;
      const offset = (page - 1) * pageSize;

      const conditions: string[] = [];
      const params: any[] = [];
      if (source) {
        conditions.push('source = ?');
        params.push(source);
      }
      if (search) {
        conditions.push('(doc_title LIKE ? OR doc_path LIKE ? OR content LIKE ?)');
        const pattern = `%${search}%`;
        params.push(pattern, pattern, pattern);
      }
      const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

      const countResult = await queryOne<{ cnt: number }>(
        `SELECT COUNT(DISTINCT CONCAT(source, '||', source_doc_id)) as cnt FROM kb_chunks${whereClause}`,
        params
      );
      const total = countResult?.cnt || 0;

      const docs = await query<{
        source: string;
        source_doc_id: string;
        doc_title: string;
        doc_path: string;
        doc_url: string;
        chunk_count: number;
        total_tokens: number;
        last_seen_at: Date;
      }>(
        `SELECT source, source_doc_id,
                MIN(doc_title) as doc_title, MIN(doc_path) as doc_path, MIN(doc_url) as doc_url,
                COUNT(*) as chunk_count, SUM(token_count) as total_tokens,
                MAX(last_seen_at) as last_seen_at
         FROM kb_chunks${whereClause}
         GROUP BY source, source_doc_id
         ORDER BY MAX(last_seen_at) DESC
         OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`,
        params
      );

      res.json({ ok: true, data: { docs, total, page, pageSize } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Browse failed' });
    }
  });

  router.get('/chunks/:source/:docId', async (req, res) => {
    try {
      const { source, docId } = req.params;
      const chunks = await query<{
        id: number;
        chunk_index: number;
        heading_path: string | null;
        content: string;
        token_count: number;
      }>(
        `SELECT id, chunk_index, heading_path, content, token_count
         FROM kb_chunks WHERE source = ? AND source_doc_id = ?
         ORDER BY chunk_index`,
        [source, decodeURIComponent(docId)]
      );
      res.json({ ok: true, data: chunks });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Chunk fetch failed' });
    }
  });

  return router;
}
