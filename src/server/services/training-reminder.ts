/**
 * Weekly training matrix reminder — sends emails to users
 * who have more than 10% of their training items unanswered
 * AND whose corresponding Agent record is active in the KPI SQL Server.
 *
 * Designed to run once per week (Monday morning).
 */

import sql from 'mssql';
import type { TrainingQueries } from '../db/queries.js';
import type { FileUserQueries } from '../db/user-store.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { EmailService } from './email.js';
import { trainingReminderHtml } from './email-templates.js';

const INCOMPLETE_THRESHOLD = 0.10; // 10% unanswered triggers a reminder

/** Fetch active agent emails from the KPI SQL Server */
async function getActiveAgentEmails(settings: Record<string, string>): Promise<Set<string>> {
  const server = settings.kpi_sql_server;
  const database = settings.kpi_sql_database;
  const user = settings.kpi_sql_user;
  const password = settings.kpi_sql_password;

  if (!server || !database || !user || !password) {
    console.log('[TrainingReminder] KPI SQL not configured — will send to all members');
    return new Set(); // empty = no filtering
  }

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = await new sql.ConnectionPool({
      server, database, user, password,
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 15000,
    }).connect();

    const result = await pool.request().query(
      `SELECT LOWER(LTRIM(RTRIM(AgentKey))) AS email FROM dbo.Agent WHERE IsActive = 1`
    );
    const emails = new Set<string>();
    for (const row of result.recordset) {
      if (row.email) emails.add(row.email.toLowerCase());
    }
    console.log(`[TrainingReminder] ${emails.size} active agents found in KPI DB`);
    return emails;
  } catch (err) {
    console.error('[TrainingReminder] Failed to query KPI DB:', err instanceof Error ? err.message : err);
    return new Set(); // on error, don't filter — send to all
  } finally {
    try { await pool?.close(); } catch { /* ignore */ }
  }
}

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

  // Only send to users whose agent is active
  const activeEmails = await getActiveAgentEmails(settings);
  const filterByAgent = activeEmails.size > 0;

  let sent = 0, skipped = 0;
  const errors: string[] = [];

  for (const uid of memberIds) {
    const user = allUsers.find(u => u.id === uid);
    if (!user || !user.email) {
      skipped++;
      continue;
    }

    // Check agent is active (if KPI DB is available)
    if (filterByAgent && !activeEmails.has(user.email.toLowerCase())) {
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
