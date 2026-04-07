/**
 * Weekly training matrix reminder — sends emails to users
 * who have more than 10% of their training items unanswered.
 *
 * Designed to run once per week (Monday morning).
 */

import type { TrainingQueries } from '../db/queries.js';
import type { FileUserQueries } from '../db/user-store.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { EmailService } from './email.js';
import { trainingReminderHtml } from './email-templates.js';

const INCOMPLETE_THRESHOLD = 0.10; // 10% unanswered triggers a reminder

export async function sendTrainingReminders(
  trainingQueries: TrainingQueries,
  userQueries: FileUserQueries,
  settingsQueries: SettingsQueries,
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const emailService = new EmailService(() => settingsQueries.getAll());
  if (!emailService.isConfigured()) {
    console.log('[TrainingReminder] Email not configured — skipping');
    return { sent: 0, skipped: 0, errors: ['Email service not configured'] };
  }

  const settings = settingsQueries.getAll();
  const baseUrl = settings.sso_base_url || settings.nova_base_url || 'https://nova.nurtur.tech';

  const categories = trainingQueries.getCategories();
  const items = trainingQueries.getItems();
  const scores = trainingQueries.getScores();
  const memberIds = trainingQueries.getMembers();
  const allUsers = userQueries.getAll();

  if (memberIds.length === 0 || items.length === 0) {
    console.log('[TrainingReminder] No members or items — skipping');
    return { sent: 0, skipped: 0, errors: [] };
  }

  let sent = 0, skipped = 0;
  const errors: string[] = [];

  for (const uid of memberIds) {
    const user = allUsers.find(u => u.id === uid);
    if (!user || !user.email) {
      skipped++;
      continue;
    }

    const userScores = scores.filter(s => s.user_id === uid);
    const scoredItemIds = new Set(userScores.filter(s => s.score > 0).map(s => s.item_id));
    const totalItems = items.length;
    const missingCount = totalItems - scoredItemIds.size;
    const completionPct = Math.round((scoredItemIds.size / totalItems) * 100);
    const incompletePct = missingCount / totalItems;

    if (incompletePct <= INCOMPLETE_THRESHOLD) {
      skipped++;
      continue;
    }

    // Build per-category stats
    const categoryStats = categories.map(cat => {
      const catItems = items.filter(i => i.category_id === cat.id);
      const scored = catItems.filter(i => scoredItemIds.has(i.id)).length;
      return {
        name: cat.name,
        scored,
        total: catItems.length,
        pct: catItems.length > 0 ? Math.round((scored / catItems.length) * 100) : 100,
      };
    });

    const html = trainingReminderHtml({
      displayName: user.display_name || user.username,
      completionPct,
      totalItems,
      missingCount,
      novaUrl: `${baseUrl}/#training-matrix`,
      categories: categoryStats,
    });

    try {
      await emailService.send({
        to: user.email,
        subject: `Training Matrix — ${completionPct}% complete (${missingCount} items remaining)`,
        text: `Hi ${user.display_name || user.username}, your training matrix is ${completionPct}% complete. ${missingCount} of ${totalItems} items still need a score. Visit ${baseUrl}/#training-matrix to update.`,
        html,
      });
      sent++;
      console.log(`[TrainingReminder] Sent to ${user.email} (${completionPct}% complete, ${missingCount} missing)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${user.email}: ${msg}`);
      console.error(`[TrainingReminder] Failed to send to ${user.email}:`, msg);
    }
  }

  console.log(`[TrainingReminder] Done: ${sent} sent, ${skipped} skipped, ${errors.length} errors`);
  return { sent, skipped, errors };
}
