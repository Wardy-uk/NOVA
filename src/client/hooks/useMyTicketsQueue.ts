import { useState, useEffect, useCallback, useRef } from 'react';

export type TicketBand = 'NOW' | 'NEXT' | 'DEFERRED' | 'HYGIENE' | 'WAITING';

export interface TicketFields {
  summary: string | null;
  status: string | null;
  statusCategory: string | null;
  priority: string | null;
  tier: string | null;
  product: string | null;
  tldr: string | null;
  agentSummary: string | null;
  escalationReason: string | null;
  reporter: string | null;
  assignee: string | null;
  updated: string | null;
  created: string | null;
  slaBreachTime: string | null;
  slaBreached: boolean;
  agentNextUpdate: string | null;
}

export interface PendingDecision {
  id: number;
  action: string;
  confidence: number;
  shadowMode: boolean;
  draftPreview: string | null;
  category: string | null;
  createdAt: string;
}

export interface RankedTicket {
  ticketKey: string;
  score: number;
  band: TicketBand;
  rankReason: string;
  fields: TicketFields;
  nextAction?: {
    state: 'action_ready' | 'waiting' | 'stalled' | 'no_context';
    headline: string;
    body: string;
    primaryAction: { label: string; jiraTransition: string | null };
    generatedAt: string;
  };
  pendingDecision?: PendingDecision | null;
}

export interface QueueResult {
  agentId: string;
  computedAt: string;
  tickets: RankedTicket[];
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` };
}

function queueFingerprint(q: QueueResult): string {
  return q.tickets.map(t => `${t.ticketKey}:${t.band}:${t.score}:${t.fields.status}`).join('|');
}

export function useMyTicketsQueue(agentId: string | null) {
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [loading, setLoading] = useState(!!agentId);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fingerprintRef = useRef<string>('');

  const fetchQueue = useCallback(async () => {
    if (!agentId) return;
    try {
      const res = await fetch(`/api/my-tickets/queue/${encodeURIComponent(agentId)}`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (json.ok) {
        const newData = json.data as QueueResult;
        const newFp = queueFingerprint(newData);
        if (newFp !== fingerprintRef.current) {
          fingerprintRef.current = newFp;
          setQueue(newData);
        }
        setError(null);
      } else {
        setError(json.error ?? 'Failed to fetch queue');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchQueue();
    intervalRef.current = setInterval(fetchQueue, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchQueue]);

  return { queue, loading, error, refresh: fetchQueue };
}
