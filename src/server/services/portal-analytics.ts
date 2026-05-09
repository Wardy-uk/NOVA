import { execute, query, queryOne } from './database.js';
import type { PortalAnalyticsEventType, PortalMetrics } from '../../shared/portal-types.js';

export async function trackEvent(
  eventType: PortalAnalyticsEventType,
  portalUserId: number | null,
  orgId: number | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await execute(
    `INSERT INTO portal_analytics (event_type, portal_user_id, org_id, metadata)
     VALUES (?, ?, ?, ?)`,
    [eventType, portalUserId, orgId, metadata ? JSON.stringify(metadata) : null],
  );
}

export async function getMetrics(days: number = 30): Promise<PortalMetrics> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [deflection, chatResolution, formCompletion, kbSearch, helpfulness, timeToTicket, adoption] =
    await Promise.all([
      getDeflectionRate(since),
      getChatResolutionRate(since),
      getFormCompletionRate(since),
      getKbSearchSuccessRate(since),
      getArticleHelpfulness(),
      getMedianTimeToTicket(since),
      getPortalAdoption(since),
    ]);

  return {
    deflectionRate: deflection,
    chatResolutionRate: chatResolution,
    formCompletionRate: formCompletion,
    kbSearchSuccessRate: kbSearch,
    articleHelpfulness: helpfulness,
    medianTimeToTicket: timeToTicket,
    portalAdoption: adoption,
  };
}

async function getDeflectionRate(since: string): Promise<number> {
  const result = await queryOne<{ total: number; deflected: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN event_type = 'deflection' THEN 1 ELSE 0 END) AS deflected
     FROM portal_analytics
     WHERE event_type IN ('deflection', 'ticket_created', 'chat_started', 'form_started')
       AND created_at >= ?`,
    [since],
  );
  if (!result || result.total === 0) return 0;
  return Math.round((result.deflected / result.total) * 100);
}

async function getChatResolutionRate(since: string): Promise<number> {
  const result = await queryOne<{ total: number; resolved: number }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved
     FROM portal_chat_sessions
     WHERE started_at >= ?`,
    [since],
  );
  if (!result || result.total === 0) return 0;
  return Math.round((result.resolved / result.total) * 100);
}

async function getFormCompletionRate(since: string): Promise<number> {
  const starts = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'form_started' AND created_at >= ?`,
    [since],
  );
  const completions = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'form_completed' AND created_at >= ?`,
    [since],
  );
  if (!starts || starts.cnt === 0) return 0;
  return Math.round(((completions?.cnt || 0) / starts.cnt) * 100);
}

async function getKbSearchSuccessRate(since: string): Promise<number> {
  const searches = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'kb_search' AND created_at >= ?`,
    [since],
  );
  const views = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM portal_analytics WHERE event_type = 'kb_view' AND created_at >= ?`,
    [since],
  );
  if (!searches || searches.cnt === 0) return 0;
  return Math.round(((views?.cnt || 0) / searches.cnt) * 100);
}

async function getArticleHelpfulness(): Promise<number> {
  const result = await queryOne<{ yes_total: number; no_total: number }>(
    `SELECT ISNULL(SUM(helpful_yes), 0) AS yes_total, ISNULL(SUM(helpful_no), 0) AS no_total
     FROM portal_kb_articles`,
  );
  if (!result || (result.yes_total + result.no_total) === 0) return 0;
  return Math.round((result.yes_total / (result.yes_total + result.no_total)) * 100);
}

async function getMedianTimeToTicket(since: string): Promise<number> {
  const result = await queryOne<{ median_seconds: number }>(
    `SELECT AVG(DATEDIFF(SECOND, fs.created_at, fs2.created_at)) AS median_seconds
     FROM portal_analytics fs
     JOIN portal_analytics fs2 ON fs.portal_user_id = fs2.portal_user_id
       AND fs2.event_type = 'ticket_created'
       AND fs2.created_at > fs.created_at
       AND DATEDIFF(MINUTE, fs.created_at, fs2.created_at) < 30
     WHERE fs.event_type = 'form_started' AND fs.created_at >= ?`,
    [since],
  );
  return result?.median_seconds || 0;
}

async function getPortalAdoption(since: string): Promise<number> {
  const logins = await queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT portal_user_id) AS cnt FROM portal_analytics
     WHERE event_type = 'page_view' AND created_at >= ?`,
    [since],
  );
  const totalUsers = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM portal_users`,
  );
  if (!totalUsers || totalUsers.cnt === 0) return 0;
  return Math.round(((logins?.cnt || 0) / totalUsers.cnt) * 100);
}

export async function getTopSearches(limit: number = 20, since?: string): Promise<Array<{ query: string; count: number }>> {
  const sinceDate = since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await query<{ search_query: string; cnt: number }>(
    `SELECT JSON_VALUE(metadata, '$.search_query') AS search_query, COUNT(*) AS cnt
     FROM portal_analytics
     WHERE event_type = 'kb_search' AND created_at >= ?
       AND JSON_VALUE(metadata, '$.search_query') IS NOT NULL
     GROUP BY JSON_VALUE(metadata, '$.search_query')
     ORDER BY cnt DESC
     OFFSET 0 ROWS FETCH NEXT ? ROWS ONLY`,
    [sinceDate, limit],
  );
  return rows.map(r => ({ query: r.search_query, count: r.cnt }));
}

export async function getEventCounts(since: string): Promise<Record<string, number>> {
  const rows = await query<{ event_type: string; cnt: number }>(
    `SELECT event_type, COUNT(*) AS cnt FROM portal_analytics
     WHERE created_at >= ? GROUP BY event_type`,
    [since],
  );
  const result: Record<string, number> = {};
  for (const r of rows) result[r.event_type] = r.cnt;
  return result;
}
