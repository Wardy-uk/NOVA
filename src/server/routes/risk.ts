import { Router, type Request, type Response } from 'express';
import {
  getAtRiskCustomersFromIssues, getIssueCards, getIssueSummary, getTicketIssueContext,
} from '../services/issue-router-store.js';

// Risk Intelligence read API — sourced entirely from AgentBrain's cross-customer issue feed
// (the home-grown attribution is retired). See issue-router-store.ts.
export function createRiskRoutes(): Router {
  const router = Router();

  // Headline: issue counts, at-risk customer count, by-route breakdown.
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, data: await getIssueSummary() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // At-risk customers, inverted from the issue cards.
  router.get('/issue-customers', async (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, data: await getAtRiskCustomersFromIssues() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Raw issue cards (most recently updated first).
  router.get('/issues', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 200;
      res.json({ ok: true, data: await getIssueCards(limit) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // The cross-customer issue context for a given ticket (used by the agent triage flag).
  router.get('/ticket/:key', async (req: Request, res: Response) => {
    try {
      res.json({ ok: true, data: await getTicketIssueContext(String(req.params.key)) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  return router;
}
