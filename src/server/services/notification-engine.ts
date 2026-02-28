import type { NotificationQueries } from '../db/notifications.js';
import type { MilestoneQueries, DeliveryQueries } from '../db/queries.js';

export class NotificationEngine {
  constructor(
    private notificationQueries: NotificationQueries,
    private milestoneQueries: MilestoneQueries,
    private deliveryQueries: DeliveryQueries,
  ) {}

  checkAndCreate(userId: number): number {
    let created = 0;
    const today = new Date().toISOString().split('T')[0];

    // 1. Overdue milestones
    try {
      const allMilestones = this.milestoneQueries.getAllWithDelivery();
      const overdue = allMilestones.filter(m =>
        m.status !== 'complete' && m.target_date && m.target_date < today
      );
      for (const m of overdue) {
        const ok = this.notificationQueries.create({
          user_id: userId,
          type: 'milestone_overdue',
          title: `Milestone overdue: ${m.template_name}`,
          message: `${m.account} — due ${m.target_date}`,
          entity_type: 'milestone',
          entity_id: String(m.id),
        });
        if (ok) created++;
      }
    } catch { /* ignore */ }

    // 2. Deliveries due within 7 days
    try {
      const entries = this.deliveryQueries.getAll();
      const sevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const upcoming = entries.filter(e =>
        e.status !== 'complete' &&
        e.go_live_date &&
        e.go_live_date >= today &&
        e.go_live_date <= sevenDays
      );
      for (const e of upcoming) {
        const ok = this.notificationQueries.create({
          user_id: userId,
          type: 'delivery_due_soon',
          title: `Delivery due soon: ${e.account}`,
          message: `${e.product} — go-live ${e.go_live_date}`,
          entity_type: 'delivery',
          entity_id: String(e.id),
        });
        if (ok) created++;
      }
    } catch { /* ignore */ }

    return created;
  }
}
