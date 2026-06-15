import { Router, type Request, type Response } from 'express';
import type { SettingsQueries } from '../db/settings-store.js';
import { query, queryOne } from '../services/database.js';
import {
  getTicketCustomerRisk, getRiskTierDistribution, getAtRiskAccounts, RISK_TIER_LABELS,
} from '../services/account-risk-queries.js';
import { getAtRiskCustomersFromIssues, getIssueCards } from '../services/issue-router-store.js';

interface RiskRouteDeps {
  settings: SettingsQueries;
}

export function createRiskRoutes(deps: RiskRouteDeps): Router {
  const router = Router();
  const { settings } = deps;

  // Tier distribution + last backfill report (resolution rate, recon coverage).
  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      const distribution = await getRiskTierDistribution();
      let lastRun: unknown = null;
      try { lastRun = JSON.parse(settings.get('account_risk_rollup_report') ?? 'null'); } catch { /* ignore */ }
      const recon = await query<{ status: string; cnt: number }>(
        `SELECT status, COUNT(*) AS cnt FROM agent_risk_recon_days GROUP BY status`,
      );
      res.json({ ok: true, data: { distribution, lastRun, recon } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // At-risk accounts (Watch+ by default), ordered by score.
  router.get('/accounts', async (req: Request, res: Response) => {
    try {
      const minTier = parseInt(req.query.minTier as string);
      const data = await getAtRiskAccounts(Number.isFinite(minTier) ? minTier : 1);
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // One account's full profile: row + active signals + score history.
  router.get('/account/:ref', async (req: Request, res: Response) => {
    try {
      const ref = String(req.params.ref);
      const account = await queryOne<Record<string, unknown>>(
        `SELECT * FROM agent_account_risk WHERE customer_ref = ?`, [ref],
      );
      if (!account) { res.status(404).json({ ok: false, error: 'Not found' }); return; }
      const [signals, history] = await Promise.all([
        query(`SELECT ticket_key, project_key, signal_type, signal_weight, is_active, evidence_text, ticket_created_at, ticket_status
                FROM agent_account_risk_signals WHERE customer_ref = ? ORDER BY is_active DESC, signal_weight DESC`, [ref]),
        query(`SELECT previous_score, new_score, previous_tier, new_tier, trigger_ticket_key, change_reason, changed_at
                FROM agent_account_risk_history WHERE customer_ref = ? ORDER BY changed_at DESC`, [ref]),
      ]);
      res.json({ ok: true, data: { account, signals, history } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // Per-ticket customer risk (for the ticket sidebar / enrichment preview).
  router.get('/ticket/:key', async (req: Request, res: Response) => {
    try {
      const data = await getTicketCustomerRisk(String(req.params.key), settings);
      res.json({ ok: true, data });  // null when unresolved or Normal tier
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed' });
    }
  });

  // ── AgentBrain issue-router feed ──
  // At-risk customers derived from cross-customer issue cards (the new source of truth).
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

  // Tier label reference for the UI.
  router.get('/tiers', (_req: Request, res: Response) => {
    res.json({ ok: true, data: RISK_TIER_LABELS.map((label, tier) => ({ tier, label })) });
  });

  return router;
}
