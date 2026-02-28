import { Router } from 'express';
import type { AuditQueries } from '../db/audit.js';

export function createAuditRoutes(auditQueries: AuditQueries): Router {
  const router = Router();

  // GET /api/audit?entity_type=delivery&entity_id=123&user_id=1&limit=20&offset=0
  router.get('/', (req, res) => {
    const entity_type = req.query.entity_type as string | undefined;
    const entity_id = req.query.entity_id as string | undefined;
    const user_id = req.query.user_id ? parseInt(req.query.user_id as string, 10) : undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const entries = auditQueries.query({ entity_type, entity_id, user_id, limit, offset });
    const total = auditQueries.count({ entity_type, entity_id });
    res.json({ ok: true, data: entries, total });
  });

  return router;
}
