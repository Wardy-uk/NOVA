import { Router } from 'express';
import type { KbSyncWorker } from '../services/kb-sync-worker.js';
import type { KbSearchService } from '../services/kb-search.js';
import type { KbEmbedder } from '../services/kb-embedder.js';
import type { KbSyncProvider } from '../services/kb-sync-provider.js';
import { requireRole } from '../middleware/auth.js';

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

    // Fire and don't await — return the run ID asynchronously
    syncWorker.sync(provider).catch(() => {});
    res.json({ ok: true, data: { message: `Sync triggered for ${source}` } });
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

  return router;
}
