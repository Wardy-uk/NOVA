import { getPool } from './database.js';

const CC_INCIDENTS = new Set(['Incident', 'Chat', 'AI Request', 'Emailed Request', 'GDPR']);
const CC_SERVICE_REQUESTS = new Set(['Service Request']);
const CC_TPJ = new Set(['TPJ Request']);

const KA_LABELS = ['Key_Account', 'Enterprise_Account'];

type QueueKey =
  | 'cc_incidents' | 'cc_service_requests' | 'cc_tpj'
  | 'production' | 'tier2' | 'development' | 'tier3';

interface QueueStats {
  active: number;
  noReply: number;
  slaBreached: number;
}

export interface CohortSnapshot {
  queues: Record<QueueKey, QueueStats>;
  updatedAt: Date;
}

const cache = new Map<string, CohortSnapshot>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function emptySnapshot(): CohortSnapshot {
  const empty = (): QueueStats => ({ active: 0, noReply: 0, slaBreached: 0 });
  return {
    queues: {
      cc_incidents: empty(), cc_service_requests: empty(), cc_tpj: empty(),
      production: empty(), tier2: empty(), development: empty(), tier3: empty(),
    },
    updatedAt: new Date(0),
  };
}

function classifyQueue(tier: string | null, requestType: string | null): QueueKey | null {
  if (tier === 'Customer Care') {
    if (requestType && CC_INCIDENTS.has(requestType)) return 'cc_incidents';
    if (requestType && CC_SERVICE_REQUESTS.has(requestType)) return 'cc_service_requests';
    if (requestType && CC_TPJ.has(requestType)) return 'cc_tpj';
    return 'cc_incidents';
  }
  if (tier === 'Production') return 'production';
  if (tier === 'Tier 2') return 'tier2';
  if (tier === 'Tier 3') return 'tier3';
  if (tier === 'Development') return 'development';
  if (tier === 'Escalations') return 'tier2';
  return null;
}

function isKeyAccount(labels: string | null): boolean {
  if (!labels) return false;
  return KA_LABELS.some(l => labels.includes(l));
}

function isWorkingHours(): boolean {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  return (h > 9 || (h === 9 && m >= 0)) && (h < 17 || (h === 17 && m <= 30));
}

async function refreshAll(): Promise<void> {
  if (!isWorkingHours()) return;
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT current_tier, request_type, sla_breached, no_reply, labels
      FROM jira_issue_cache
      WHERE status_category != 'Done'
        AND project_key = 'NT'
    `);

    const ka = emptySnapshot();
    const cs = emptySnapshot();

    for (const row of result.recordset) {
      const q = classifyQueue(row.current_tier, row.request_type);
      if (!q) continue;
      const snap = isKeyAccount(row.labels) ? ka : cs;
      snap.queues[q].active++;
      if (row.no_reply) snap.queues[q].noReply++;
      if (row.sla_breached) snap.queues[q].slaBreached++;
    }

    const now = new Date();
    ka.updatedAt = now;
    cs.updatedAt = now;
    cache.set('key_accounts', ka);
    cache.set('customer_success', cs);

    const kaTotal = Object.values(ka.queues).reduce((s, q) => s + q.active, 0);
    const csTotal = Object.values(cs.queues).reduce((s, q) => s + q.active, 0);
    console.log(`[wallboard-live-cache] refreshed — KA: ${kaTotal} tickets, CS: ${csTotal} tickets (${result.recordset.length} total rows)`);
  } catch (err) {
    console.error('[wallboard-live-cache] refresh failed:', err instanceof Error ? err.message : err);
  }
}

export function getCohortSnapshot(cohortName: string): CohortSnapshot {
  return cache.get(cohortName) ?? emptySnapshot();
}

export async function startWallboardLiveCache(intervalMs = 5 * 60 * 1000): Promise<void> {
  await refreshAll();
  intervalHandle = setInterval(refreshAll, intervalMs);
}

export function stopWallboardLiveCache(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
