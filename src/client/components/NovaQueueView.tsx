import { useState, useEffect } from 'react';

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
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
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
        // Drop it from the list — it's no longer NOVA's.
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
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-100 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
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
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-800 text-gray-400 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Summary</th>
                <th className="px-3 py-2 font-medium">Tier</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium text-right sticky right-0 bg-gray-800">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {tickets.map(t => (
                <tr key={t.issue_key} className="group hover:bg-gray-800/50">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-gray-200">{t.issue_key}</td>
                  <td className="px-3 py-2 text-gray-300 max-w-[240px] truncate" title={t.summary ?? ''}>{t.summary ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-300">{t.current_tier ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${priorityClass(t.priority_name)}`}>{t.priority_name ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-300">{t.status_name ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400 max-w-[140px] truncate" title={t.nurtur_product ?? ''}>{t.nurtur_product ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-400">{fmtDate(t.jira_created)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-right sticky right-0 bg-gray-900 group-hover:bg-gray-800">
                    <button
                      onClick={() => reassign(t.issue_key)}
                      disabled={busy === t.issue_key || !!busy}
                      className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
                    >
                      {busy === t.issue_key ? 'Assigning…' : 'Round-robin now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
