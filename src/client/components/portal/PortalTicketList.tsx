import React, { useEffect, useState, useCallback } from 'react';
import type { PortalOrgTicket, PortalMyTicketsResponse } from '../../../shared/portal-types.js';
import { showPortalToast } from './PortalToast.js';

interface Props {
  onViewTicket: (key: string) => void;
}

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

export default function PortalTicketList({ onViewTicket }: Props) {
  const [tickets, setTickets] = useState<PortalOrgTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'all' | 'open' | 'resolved'>('open');
  const [scope, setScope] = useState<'mine' | 'org'>('mine');
  const [canViewOrg, setCanViewOrg] = useState(false);
  const [canEscalate, setCanEscalate] = useState(false);
  const [search, setSearch] = useState('');
  const [escalating, setEscalating] = useState<PortalOrgTicket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope, status, ...(search ? { search } : {}) });
      const res = await pf(`/api/portal/my-tickets?${params}`);
      const body = await res.json();
      if (body.ok) {
        const data = body.data as PortalMyTicketsResponse;
        setTickets(data.tickets || []);
        setCanViewOrg(data.canViewOrg);
        setCanEscalate(data.canEscalate);
        // If the server downgraded scope (e.g. requester asked for org), reflect it.
        if (data.scope !== scope) setScope(data.scope);
      }
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  }, [scope, status, search]);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string) => {
    const l = s.toLowerCase();
    if (l.includes('closed') || l.includes('done') || l.includes('resolved')) return 'bg-slate-100 text-slate-700';
    if (l.includes('progress') || l.includes('development')) return 'bg-amber-100 text-amber-700';
    if (l.includes('wait')) return 'bg-purple-100 text-purple-700';
    if (l.includes('open') || l.includes('new')) return 'bg-blue-100 text-blue-700';
    return 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {canViewOrg && (
          <div className="flex bg-gray-100 rounded-lg p-0.5" role="group" aria-label="Scope">
            {(['mine', 'org'] as const).map(sc => (
              <button
                key={sc}
                onClick={() => setScope(sc)}
                aria-pressed={scope === sc}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${scope === sc ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
              >
                {sc === 'mine' ? 'My tickets' : 'All org tickets'}
              </button>
            ))}
          </div>
        )}

        <div className="flex bg-gray-100 rounded-lg p-0.5" role="group" aria-label="Filter by status">
          {(['all', 'open', 'resolved'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${status === s ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <input
          type="text"
          placeholder="Search tickets..."
          aria-label="Search tickets"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" aria-live="polite">
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 animate-pulse flex items-center gap-4">
                <div className="h-4 w-16 bg-gray-200 rounded" /><div className="h-4 flex-1 bg-gray-100 rounded" /><div className="h-5 w-20 bg-gray-200 rounded-full" />
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-600">
            <p className="text-lg mb-2">No tickets found</p>
            <p className="text-sm">{scope === 'mine' ? 'You have no tickets matching these filters.' : 'No org tickets match these filters.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Tickets">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <th scope="col" className="text-left px-5 py-3 font-medium">Ticket</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="text-left px-4 py-3 font-medium">Priority</th>
                  {scope === 'org' && <th scope="col" className="text-left px-4 py-3 font-medium">Reporter</th>}
                  <th scope="col" className="text-left px-4 py-3 font-medium">Updated</th>
                  {canEscalate && <th scope="col" className="text-right px-5 py-3 font-medium">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tickets.map(t => (
                  <tr key={t.key} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 cursor-pointer" onClick={() => onViewTicket(t.key)}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-gray-500 text-xs">{t.key}</span>
                        {t.isEscalation && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 font-semibold uppercase tracking-wide">Escalation</span>}
                      </div>
                      <div className="text-gray-900 max-w-md truncate">{t.summary}</div>
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(t.status)}`}>{t.status}</span></td>
                    <td className="px-4 py-3 text-gray-600">{t.priority}</td>
                    {scope === 'org' && <td className="px-4 py-3 text-gray-600">{t.reporter || '-'}</td>}
                    <td className="px-4 py-3 text-gray-500">{t.updated ? new Date(t.updated).toLocaleDateString() : '-'}</td>
                    {canEscalate && (
                      <td className="px-5 py-3 text-right">
                        {!t.isEscalation && (
                          <button
                            onClick={() => setEscalating(t)}
                            className="px-2.5 py-1 text-xs rounded-lg border border-pink-300 text-pink-700 hover:bg-pink-50 font-medium"
                          >
                            Escalate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {escalating && (
        <EscalateModal
          ticket={escalating}
          onClose={() => setEscalating(null)}
          onDone={(newKey) => {
            setEscalating(null);
            showPortalToast(`Escalation ${newKey} created for ${escalating.key}`, newKey);
            load();
          }}
        />
      )}
    </div>
  );
}

function EscalateModal({ ticket, onClose, onDone }: { ticket: PortalOrgTicket; onClose: () => void; onDone: (newKey: string) => void }) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) { setError('Please give a reason for the escalation.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const res = await pf(`/api/portal/tickets/${ticket.key}/escalate`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json();
      if (body.ok) onDone(body.data.key);
      else setError(body.error || 'Escalation failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Escalation failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Escalate ticket</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            <span className="font-mono">{ticket.key}</span> — {ticket.summary}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason for escalation</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Why does this need escalating?"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <p className="text-xs text-gray-400 mt-1">Creates a new Escalation ticket linked to this one.</p>
        </div>
        {error && <div className="text-sm text-rose-600">{error}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={submitting} className="px-4 py-2 text-sm rounded-lg bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50 font-medium">
            {submitting ? 'Escalating…' : 'Escalate'}
          </button>
        </div>
      </div>
    </div>
  );
}
