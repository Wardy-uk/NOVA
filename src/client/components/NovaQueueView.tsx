import { useState, useEffect } from 'react';

interface AiDecision {
  action: string;
  confidence: number | null;
  reasoning: string | null;
  approval_status: string | null;
  decided_at: string;
}

interface QueueTicket {
  issue_key: string;
  project_key: string;
  summary: string | null;
  status_name: string | null;
  priority_name: string | null;
  issuetype_name: string | null;
  nurtur_product: string | null;
  current_tier: string | null;
  jira_created: string | null;
  jira_updated: string | null;
  ai: AiDecision | null;
}

interface QueueData {
  accountId: string | null;
  projects: string[];
  tickets: QueueTicket[];
}

const api = async (path: string, method = 'GET', body?: unknown) => {
  const r = await fetch(`/api/agent${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const priorityClass = (p: string | null) => {
  switch ((p ?? '').toLowerCase()) {
    case 'highest': case 'critical': return 'bg-red-500/20 text-red-300';
    case 'high': return 'bg-orange-500/20 text-orange-300';
    case 'medium': return 'bg-yellow-500/20 text-yellow-300';
    case 'low': return 'bg-blue-500/20 text-blue-300';
    default: return 'bg-gray-500/20 text-gray-300';
  }
};

const actionLabel = (a: string) => {
  switch (a) {
    case 'draft_response': return 'Drafted a reply';
    case 'respond': return 'Responded';
    case 'public_reply': return 'Public reply';
    case 'gather_context': return 'Gathering context';
    case 'chase': return 'Chasing';
    case 'escalate': return 'Escalated';
    case 'assign': return 'Assigning';
    case 'handoff': return 'Handing off';
    case 'no_action': return 'No action taken';
    case 'comment': return 'Commented';
    case 'transition': return 'Transitioned';
    case 'update_fields': return 'Updated fields';
    default: return a.replace(/_/g, ' ');
  }
};

// Short human-readable reason for why NOVA is still holding the ticket.
const whyHeld = (ai: AiDecision | null): string => {
  if (!ai) return 'Claimed by NOVA — no AI decision recorded yet (likely awaiting first pass).';
  const label = actionLabel(ai.action);
  if (ai.approval_status === 'pending') return `${label} — holding for human approval.`;
  if (ai.action === 'gather_context') return `${label} — waiting on more information before acting.`;
  if (ai.action === 'chase') return `${label} — waiting on a reply from the customer.`;
  if (ai.action === 'no_action') return `${label} — nothing actionable yet.`;
  return label;
};

export function NovaQueueView() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api('/nova-queue');
      if (r.ok) setData(r.data);
      else setError(r.error ?? 'Failed to load NOVA queue');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const reassign = async (ticketKey: string) => {
    if (busy) return;
    setBusy(ticketKey);
    setToast(null);
    try {
      const r = await api('/nova-queue/reassign', 'POST', { ticketKey });
      if (r.ok) {
        setToast({ ok: true, text: `${ticketKey} → ${r.data?.agent?.display_name ?? 'agent'} (${r.data?.openTicketCount ?? '?'} open)` });
        setData(prev => prev ? { ...prev, tickets: prev.tickets.filter(t => t.issue_key !== ticketKey) } : prev);
      } else {
        setToast({ ok: false, text: `${ticketKey}: ${r.error ?? 'Reassignment failed'}` });
      }
    } catch (err) {
      setToast({ ok: false, text: err instanceof Error ? err.message : 'Network error' });
    }
    setBusy(null);
  };

  const tickets = data?.tickets ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-100">NOVA AI Queue</h2>
          <p className="text-sm text-gray-400">
            Open tickets currently assigned to NOVA AI
            {data?.projects?.length ? ` across ${data.projects.join(', ')}` : ''}.
            Use “Round-robin now” to hand a ticket to a human agent immediately.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data && <span className="text-sm text-gray-400">{tickets.length} open</span>}
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {toast && (
        <div className={`px-3 py-2 rounded-lg text-sm ${toast.ok ? 'bg-green-500/15 text-green-300' : 'bg-red-500/15 text-red-300'}`}>
          {toast.text}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded-lg text-sm bg-red-500/15 text-red-300">{error}</div>
      )}

      {loading && !data ? (
        <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />
      ) : tickets.length === 0 ? (
        <div className="px-4 py-10 text-center text-gray-400 bg-gray-800/50 rounded-lg">
          NOVA AI has no open tickets right now.
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map(t => (
            <div key={t.issue_key} className="w-full rounded-lg border border-gray-700 bg-gray-800/40 p-4 hover:border-gray-600 transition-colors">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  {/* Ticket key + meta chips */}
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono text-sm text-indigo-300">{t.issue_key}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs ${priorityClass(t.priority_name)}`}>{t.priority_name ?? 'Unset'}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-600/40 text-gray-300">{t.status_name ?? '—'}</span>
                    {t.current_tier && <span className="px-2 py-0.5 rounded-full text-xs bg-gray-600/40 text-gray-300">{t.current_tier}</span>}
                    {t.nurtur_product && <span className="px-2 py-0.5 rounded-full text-xs bg-gray-600/40 text-gray-400">{t.nurtur_product}</span>}
                  </div>
                  {/* Ticket summary */}
                  <div className="text-gray-100 font-medium">{t.summary ?? '(no summary)'}</div>
                  {/* Why NOVA is holding it */}
                  <div className="mt-2 text-sm">
                    <span className="text-gray-500">Why flagged: </span>
                    <span className="text-amber-300">{whyHeld(t.ai)}</span>
                    {t.ai?.confidence != null && (
                      <span className="text-gray-500"> · {Math.round(t.ai.confidence * 100)}% confidence</span>
                    )}
                  </div>
                  {t.ai?.reasoning && (
                    <div className="mt-1 text-sm text-gray-400 whitespace-pre-line">{t.ai.reasoning}</div>
                  )}
                  <div className="mt-2 text-xs text-gray-500">Created {fmtDate(t.jira_created)} · Updated {fmtDate(t.jira_updated)}</div>
                </div>
                {/* Action */}
                <div className="shrink-0">
                  <button
                    onClick={() => reassign(t.issue_key)}
                    disabled={busy === t.issue_key || !!busy}
                    className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 whitespace-nowrap"
                  >
                    {busy === t.issue_key ? 'Assigning…' : 'Round-robin now'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
