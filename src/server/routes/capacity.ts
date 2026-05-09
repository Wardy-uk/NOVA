import { Router } from 'express';
import type { CapacityPlanner } from '../services/capacity-planner.js';

export function createCapacityRoutes(capacityPlanner: CapacityPlanner): Router {
  const router = Router();

  router.get('/forecast', async (_req, res) => {
    try {
      const forecast = await capacityPlanner.getForecast();
      res.json({ ok: true, data: forecast });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get forecast' });
    }
  });

  router.get('/historical', async (req, res) => {
    try {
      const days = parseInt((req.query.days as string) ?? '28', 10);
      const data = await capacityPlanner.getHistorical(days);
      res.json({ ok: true, data });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get historical data' });
    }
  });

  router.get('/accuracy', async (req, res) => {
    try {
      const days = parseInt((req.query.days as string) ?? '30', 10);
      const accuracy = await capacityPlanner.getAccuracy(days);
      res.json({ ok: true, data: accuracy });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get accuracy' });
    }
  });

  router.post('/generate', async (_req, res) => {
    try {
      const result = await capacityPlanner.generateForecast();
      res.json({ ok: true, data: { forecasts: result.forecasts.length, recommendations: result.staffing_recommendations } });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Forecast generation failed' });
    }
  });

  return router;
}
