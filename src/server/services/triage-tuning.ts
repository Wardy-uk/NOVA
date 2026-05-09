import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';

interface TuningRow {
  id: number;
  bucket: string;
  pattern_description: string | null;
  ticket_count: number;
  example_ticket_keys: string | null;
  suggested_fix: string | null;
  applied: boolean;
  created_at: string;
}

type Bucket = 'over_escalation' | 'false_no_action' | 'under_escalation' | 'other';

interface DisagreementRow {
  ticket_key: string;
  nova_action: string;
  n8n_comment: string | null;
}

const BUCKET_DESCRIPTIONS: Record<Bucket, string> = {
  over_escalation: 'NOVA escalated but n8n responded — possible over-escalation',
  false_no_action: 'NOVA took no action but n8n responded — missed ticket',
  under_escalation: 'NOVA responded but n8n escalated — under-escalation risk',
  other: 'Other action mismatch between NOVA and n8n',
};

const BUCKET_FIXES: Record<Bucket, string> = {
  over_escalation: 'Review escalation criteria — lower confidence threshold or add exemptions for common patterns',
  false_no_action: 'Check perceiver filters — these tickets may be getting filtered out before triage',
  under_escalation: 'Add escalation signals for patterns n8n catches that NOVA misses',
  other: 'Manual review recommended — no clear pattern',
};

function parseN8nAction(comment: string | null): string | null {
  if (!comment) return null;
  const lower = comment.toLowerCase();
  if (lower.includes('closed') || lower.includes('resolved')) return 'close';
  if (lower.includes('escalat')) return 'escalate';
  if (lower.includes('responded') || lower.includes('comment added')) return 'respond';
  return null;
}

function classifyBucket(novaAction: string, n8nAction: string): Bucket {
  if (novaAction === 'escalate' && n8nAction === 'respond') return 'over_escalation';
  if (novaAction === 'no_action' && n8nAction === 'respond') return 'false_no_action';
  if (novaAction === 'respond' && n8nAction === 'escalate') return 'under_escalation';
  return 'other';
}

export class TriageTuningService {
  constructor(private settings: SettingsQueries) {}

  async analyse(days: number = 14): Promise<TuningRow[]> {
    const rows = await query<DisagreementRow>(
      `SELECT ad.ticket_key, ad.action AS nova_action, jic.last_n8n_comment AS n8n_comment
       FROM agent_decisions ad
       JOIN jira_issue_cache jic ON jic.issue_key = ad.ticket_key
       WHERE ad.created_at >= DATEADD(DAY, -?, GETUTCDATE())
         AND jic.last_n8n_comment IS NOT NULL`,
      [days]
    );

    const buckets = new Map<Bucket, string[]>();

    for (const row of rows) {
      const n8nAction = parseN8nAction(row.n8n_comment);
      if (!n8nAction) continue;

      const novaAction = row.nova_action?.toLowerCase() ?? 'no_action';
      if (novaAction === n8nAction) continue; // agreement — skip

      const bucket = classifyBucket(novaAction, n8nAction);
      const keys = buckets.get(bucket) ?? [];
      keys.push(row.ticket_key);
      buckets.set(bucket, keys);
    }

    const inserted: TuningRow[] = [];

    for (const [bucket, ticketKeys] of buckets) {
      const examples = ticketKeys.slice(0, 5).join(', ');
      const id = await executeAndGetId(
        `INSERT INTO agent_triage_tuning (bucket, pattern_description, ticket_count, example_ticket_keys, suggested_fix)
         VALUES (?, ?, ?, ?, ?)`,
        [bucket, BUCKET_DESCRIPTIONS[bucket], ticketKeys.length, examples, BUCKET_FIXES[bucket]]
      );
      inserted.push({
        id,
        bucket,
        pattern_description: BUCKET_DESCRIPTIONS[bucket],
        ticket_count: ticketKeys.length,
        example_ticket_keys: examples,
        suggested_fix: BUCKET_FIXES[bucket],
        applied: false,
        created_at: new Date().toISOString(),
      });
    }

    return inserted;
  }

  async getResults(limit: number = 20): Promise<TuningRow[]> {
    return query<TuningRow>(
      `SELECT TOP(?) id, bucket, pattern_description, ticket_count, example_ticket_keys, suggested_fix, applied, created_at
       FROM agent_triage_tuning
       ORDER BY created_at DESC`,
      [limit]
    );
  }
}
