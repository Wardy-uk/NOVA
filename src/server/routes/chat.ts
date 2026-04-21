import { Router } from 'express';
import type { TaskQueries, DeliveryQueries, MilestoneQueries, UserSettingsQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { chat, getConversation, resetConversation } from '../services/chat-service.js';

export function createChatRoutes(
  taskQueries: TaskQueries,
  deliveryQueries: DeliveryQueries,
  milestoneQueries: MilestoneQueries,
  settingsQueries: SettingsQueries,
  userSettingsQueries: UserSettingsQueries,
): Router {
  const router = Router();

  const resolveApiKey = async (userId?: number): Promise<string | null> => {
    if (userId) {
      const userKey = await userSettingsQueries.get(userId, 'openai_api_key');
      if (userKey?.trim()) return userKey.trim();
    }
    const fromDb = settingsQueries.get('openai_api_key');
    if (fromDb?.trim()) return fromDb.trim();
    const fromEnv = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? null;
    if (fromEnv?.trim()) return fromEnv.trim();
    return null;
  };

  const buildContext = async (userId: number): Promise<string> => {
    const lines: string[] = [];

    // Active deliveries summary
    try {
      const entries = await deliveryQueries.getAll();
      const active = entries.filter(e => e.status !== 'complete');
      lines.push(`Active deliveries: ${active.length}`);
      if (active.length > 0) {
        const top = active.slice(0, 5);
        for (const e of top) {
          lines.push(`  - ${e.account} (${e.product}) — status: ${e.status}, onboarder: ${e.onboarder ?? 'unassigned'}${e.go_live_date ? `, go-live: ${e.go_live_date}` : ''}`);
        }
        if (active.length > 5) lines.push(`  ... and ${active.length - 5} more`);
      }
    } catch { /* ignore */ }

    // Milestone summary
    try {
      const summary = await milestoneQueries.getSummary();
      lines.push(`Milestones: ${summary.total} total, ${summary.pending} pending, ${summary.in_progress} in-progress, ${summary.complete} complete, ${summary.overdue} overdue`);
    } catch { /* ignore */ }

    // Tasks summary
    try {
      const tasks = await taskQueries.getAll({ userId });
      const bySource: Record<string, number> = {};
      for (const t of tasks) bySource[t.source] = (bySource[t.source] ?? 0) + 1;
      lines.push(`Open tasks: ${tasks.length} (${Object.entries(bySource).map(([s, c]) => `${s}: ${c}`).join(', ')})`);
    } catch { /* ignore */ }

    return lines.join('\n');
  };

  // POST /api/chat — send a message
  router.post('/', async (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }

    const apiKey = await resolveApiKey(userId);
    if (!apiKey) {
      res.status(400).json({ ok: false, error: 'No OpenAI API key configured. Add one in Settings.' });
      return;
    }

    const { message, conversationId = 'default' } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ ok: false, error: 'Message is required' });
      return;
    }

    try {
      const context = await buildContext(userId);
      const reply = await chat(apiKey, userId, conversationId, message.trim(), context);
      const history = getConversation(userId, conversationId)
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));
      res.json({ ok: true, reply, history });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Chat failed' });
    }
  });

  // POST /api/chat/reset — clear conversation
  router.post('/reset', (req, res) => {
    const userId = (req as any).user?.id as number;
    if (!userId) { res.status(401).json({ ok: false, error: 'Not authenticated' }); return; }
    const { conversationId = 'default' } = req.body;
    resetConversation(userId, conversationId);
    res.json({ ok: true });
  });

  return router;
}
