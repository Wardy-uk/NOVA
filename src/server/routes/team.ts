import { Router } from 'express';
import type { DeliveryQueries, TaskQueries } from '../db/queries.js';
import type { UserQueries } from '../db/queries.js';

export function createTeamRoutes(
  deliveryQueries: DeliveryQueries,
  taskQueries: TaskQueries,
  userQueries: UserQueries,
): Router {
  const router = Router();

  router.get('/workload', async (_req, res) => {
    const users = await userQueries.getAll();
    const deliveries = await deliveryQueries.getAll();

    // Build per-user workload
    const workload = users.map(u => {
      const name = u.display_name || u.username;

      // Active deliveries (non-complete, assigned to this user)
      const activeDeliveries = deliveries.filter(d =>
        d.onboarder === name && d.status !== 'complete'
      ).length;

      return {
        userId: u.id,
        name,
        activeDeliveries,
      };
    }).filter(u => u.activeDeliveries > 0);

    res.json({ ok: true, data: workload });
  });

  return router;
}
