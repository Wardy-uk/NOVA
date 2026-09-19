import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { McpClientManager } from '../services/mcp-client.js';
import type { HealthResponse } from '../../shared/types.js';
import { getPoolStats } from '../services/database.js';

const startTime = Date.now();

/**
 * Read once at boot. The client bakes its own version in at build time, so a tab left open
 * across a deploy keeps rendering the old UI with no indication anything has changed — on
 * 19 Sep 2026 that produced a nav missing a tab that had shipped, and an earlier status bar
 * reporting a version three deploys behind. Serving the server's version lets the client say
 * so instead of quietly lying.
 */
const SERVER_VERSION: string = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const rel of ['../../../package.json', '../../../../package.json', '../../package.json']) {
      const candidate = path.resolve(here, rel);
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf-8')).version ?? 'unknown';
      }
    }
  } catch { /* fall through */ }
  return 'unknown';
})();

export function createHealthRoutes(mcpManager: McpClientManager): Router {
  const router = Router();

  // GET /api/health — Overall health + MCP server statuses
  router.get('/', (_req, res) => {
    const servers = mcpManager.getStatus();
    const allConnected =
      servers.length > 0 && servers.every((s) => s.status === 'connected');
    const pool = getPoolStats();

    const response: HealthResponse & { pool?: typeof pool } = {
      status: allConnected ? 'ok' : 'degraded',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      servers,
      version: SERVER_VERSION,
      pool,
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
