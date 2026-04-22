import { Router } from 'express';
import type { DeliveryQueries, MilestoneQueries, TaskQueries } from '../db/queries.js';
import type { UserQueries } from '../db/queries.js';

export function createTeamRoutes(
  deliveryQueries: DeliveryQueries,
  milestoneQueries: MilestoneQueries,
  taskQueries: TaskQueries,
  userQueries: UserQueries,
): Router {
  const router = Router();

  router.get('/workload', async (_req, res) => {
    const users = await userQueries.getAll();
    const deliveries = await deliveryQueries.getAll();
    const allMilestones = await milestoneQueries.getAllWithDelivery();
    const today = new Date().toISOString().split('T')[0];

    // Build per-user workload
    const workload = users.map(u => {
      const name = u.display_name || u.username;

      // Active deliveries (non-complete, assigned to this user)
      const activeDeliveries = deliveries.filter(d =>
        d.onboarder === name && d.status !== 'complete'
      ).length;

      // Milestones for this user's deliveries
      const userMilestones = allMilestones.filter(m => m.onboarder === name);
      const pendingMilestones = userMilestones.filter(m => m.status !== 'complete').length;
      const overdueMilestones = userMilestones.filter(m =>
        m.status !== 'complete' && m.target_date && m.target_date < today
      ).length;

      return {
        userId: u.id,
        name,
        activeDeliveries,
        pendingMilestones,
        overdueMilestones,
      };
    }).filter(u => u.activeDeliveries > 0 || u.pendingMilestones > 0);

    res.json({ ok: true, data: workload });
  });

  return router;
}
