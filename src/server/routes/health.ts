import { Router } from 'express';
import type { McpClientManager } from '../services/mcp-client.js';
import type { HealthResponse } from '../../shared/types.js';

const startTime = Date.now();

export function createHealthRoutes(mcpManager: McpClientManager): Router {
  const router = Router();

  // GET /api/health — Overall health + MCP server statuses
  router.get('/', (_req, res) => {
    const servers = mcpManager.getStatus();
    const allConnected =
      servers.length > 0 && servers.every((s) => s.status === 'connected');

    const response: HealthResponse = {
      status: allConnected ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      servers,
    };

    res.json(response);
  });

  // POST /api/health/reconnect/:name — Retry connection to a specific server
  router.post('/reconnect/:name', async (req, res) => {
    try {
      const success = await mcpManager.connect(req.params.name);
      res.json({ ok: success, servers: mcpManager.getStatus() });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Reconnect failed',
      });
    }
  });

  return router;
}
