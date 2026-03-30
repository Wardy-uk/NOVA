import { useState, useEffect, useCallback } from 'react';
import type { AdobeSignAgreement } from '../../shared/types.js';

const STATUS_COLOURS: Record<string, string> = {
  SIGNED: 'bg-green-900/40 text-green-400 border border-green-800',
  APPROVED: 'bg-green-900/40 text-green-400 border border-green-800',
  OUT_FOR_SIGNATURE: 'bg-[#5ec1ca]/10 text-[#5ec1ca] border border-[#5ec1ca]/30',
  WAITING_FOR_MY_SIGNATURE: 'bg-amber-900/40 text-amber-400 border border-amber-800',
  DRAFT: 'bg-neutral-800 text-neutral-500 border border-neutral-700',
  CANCELLED: 'bg-red-900/40 text-red-400 border border-red-800',
  EXPIRED: 'bg-red-900/40 text-red-400 border border-red-800',
  OUT_FOR_APPROVAL: 'bg-amber-900/40 text-amber-400 border border-amber-800',
};

const STATUS_LABELS: Record<string, string> = {
  OUT_FOR_SIGNATURE: 'Out for Signature',
  WAITING_FOR_MY_SIGNATURE: 'Awaiting My Signature',
  OUT_FOR_APPROVAL: 'Out for Approval',
  SIGNED: 'Signed',
  APPROVED: 'Approved',
  DRAFT: 'Draft',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

const FILTER_OPTIONS = ['All', 'OUT_FOR_SIGNATURE', 'WAITING_FOR_MY_SIGNATURE', 'SIGNED', 'DRAFT', 'CANCELLED', 'EXPIRED'] as const;

function fmtDate(d: string | null) {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseSigners(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';

export function AdobeSignView() {
  const [agreements, setAgreements] = useState<AdobeSignAgreement[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('not_configured');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<AdobeSignAgreement | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/adobe-sign/status');
      const json = await res.json();
      if (json.ok) setConnectionStatus(json.data.status);
    } catch { /* ignore */ }
  }, []);

  const fetchAgreements = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const res = await fetch(`/api/adobe-sign/agreements?${params}`);
      const json = await res.json();
      if (json.ok) setAgreements(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter, search]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { fetchAgreements(); }, [fetchAgreements]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/adobe-sign/agreements/sync', { method: 'POST' });
      await fetchAgreements();
    } catch { /* ignore */ }
    setSyncing(false);
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/adobe-sign/auth-url');
      const json = await res.json();
      if (json.ok && json.data.url) {
        window.open(json.data.url, '_blank');
      }
    } catch { /* ignore */ }
  };

  const handleDisconnect = async () => {
    await fetch('/api/adobe-sign/disconnect', { method: 'POST' });
    setConnectionStatus('disconnected');
    setAgreements([]);
  };

  const handleDownload = async (agreement: AdobeSignAgreement) => {
    window.open(`/api/adobe-sign/agreements/${agreement.id}/download`, '_blank');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Connection Banner */}
      {connectionStatus !== 'connected' && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-lg bg-amber-900/20 border border-amber-800/40 flex items-center justify-between">
          <div>
            <span className="text-amber-400 text-[12px] font-medium">
              {connectionStatus === 'not_configured'
                ? 'Adobe Sign is not configured. Add credentials in Admin > Integrations first.'
                : 'Adobe Sign is not connected. Complete the OAuth flow to sync agreements.'}
            </span>
          </div>
          {connectionStatus === 'disconnected' && (
            <button onClick={handleConnect} className="text-[11px] px-3 py-1.5 rounded bg-[#5ec1ca] text-[#272C33] font-medium hover:bg-[#4db0b9] transition-colors">
              Connect
            </button>
          )}
        </div>
      )}

      {connectionStatus === 'connected' && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-green-900/15 border border-green-800/30 flex items-center justify-between">
          <span className="text-green-400 text-[11px]">Connected to Adobe Sign</span>
          <button onClick={handleDisconnect} className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors">
            Disconnect
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3">
        <input
          type="text"
          placeholder="Search agreements..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputCls} max-w-xs`}
        />

        <div className="flex gap-1">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => setStatusFilter(opt)}
              className={`text-[10px] px-2.5 py-1 rounded transition-colors ${
                statusFilter === opt
                  ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30'
                  : 'bg-[#2f353d] text-neutral-500 border border-transparent hover:text-neutral-300'
              }`}
            >
              {opt === 'All' ? 'All' : STATUS_LABELS[opt] ?? opt}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={handleSync}
          disabled={syncing || connectionStatus !== 'connected'}
          className="text-[11px] px-3 py-1.5 rounded bg-[#2f353d] text-neutral-300 hover:bg-[#3a424d] disabled:opacity-40 transition-colors"
        >
          {syncing ? 'Syncing...' : 'Sync'}
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden px-4 pb-4 gap-4">
        {/* Agreements Table */}
        <div className="flex-1 overflow-auto rounded-lg border border-[#3a424d] bg-[#1e2228]">
          {loading ? (
            <div className="p-8 text-center text-neutral-500 text-[12px]">Loading...</div>
          ) : agreements.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 text-[12px]">
              {connectionStatus === 'connected' ? 'No agreements found. Click Sync to fetch from Adobe Sign.' : 'Connect to Adobe Sign to view agreements.'}
            </div>
          ) : (
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-neutral-500 text-left border-b border-[#3a424d] bg-[#272C33]">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Signers</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Last Synced</th>
                </tr>
              </thead>
              <tbody>
                {agreements.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className={`border-b border-[#2f353d] cursor-pointer hover:bg-[#272C33] transition-colors ${
                      selected?.id === a.id ? 'bg-[#272C33]' : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-neutral-200">
                      <div className="flex items-center gap-2">
                        {a.created_via_nova ? (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#5ec1ca] flex-shrink-0" title="Created in NOVA" />
                        ) : null}
                        {a.name}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLOURS[a.status] ?? 'bg-neutral-800 text-neutral-400 border border-neutral-700'}`}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-400">
                      {parseSigners(a.signer_emails).join(', ') || '\u2014'}
                    </td>
                    <td className="px-3 py-2 text-neutral-500">{fmtDate(a.adobe_created_date ?? a.created_at)}</td>
                    <td className="px-3 py-2 text-neutral-600">{fmtDate(a.synced_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-80 flex-shrink-0 rounded-lg border border-[#3a424d] bg-[#1e2228] overflow-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[13px] font-semibold text-neutral-100 truncate pr-2">{selected.name}</h3>
              <button
                onClick={() => setSelected(null)}
                className="text-neutral-600 hover:text-neutral-300 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="space-y-3 text-[11px]">
              <div>
                <span className="text-neutral-500 block mb-1">Status</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_COLOURS[selected.status] ?? 'bg-neutral-800 text-neutral-400 border border-neutral-700'}`}>
                  {STATUS_LABELS[selected.status] ?? selected.status}
                </span>
              </div>

              <div>
                <span className="text-neutral-500 block mb-1">Agreement ID</span>
                <span className="text-neutral-300 font-mono text-[10px]">{selected.agreement_id}</span>
              </div>

              {selected.sender_email && (
                <div>
                  <span className="text-neutral-500 block mb-1">Sender</span>
                  <span className="text-neutral-300">{selected.sender_email}</span>
                </div>
              )}

              <div>
                <span className="text-neutral-500 block mb-1">Signers</span>
                <div className="space-y-1">
                  {parseSigners(selected.signer_emails).map((email, i) => (
                    <div key={i} className="text-neutral-300">{email}</div>
                  ))}
                  {parseSigners(selected.signer_emails).length === 0 && <span className="text-neutral-600">&mdash;</span>}
                </div>
              </div>

              <div>
                <span className="text-neutral-500 block mb-1">Created</span>
                <span className="text-neutral-300">{fmtDate(selected.adobe_created_date ?? selected.created_at)}</span>
              </div>

              {selected.adobe_expiration_date && (
                <div>
                  <span className="text-neutral-500 block mb-1">Expires</span>
                  <span className="text-neutral-300">{fmtDate(selected.adobe_expiration_date)}</span>
                </div>
              )}

              {selected.created_via_nova ? (
                <div>
                  <span className="text-neutral-500 block mb-1">Source</span>
                  <span className="text-[#5ec1ca]">Created in NOVA</span>
                </div>
              ) : null}

              {(selected.status === 'SIGNED' || selected.status === 'APPROVED') && (
                <button
                  onClick={() => handleDownload(selected)}
                  className="w-full mt-2 text-[11px] px-3 py-2 rounded bg-[#5ec1ca]/10 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/20 transition-colors"
                >
                  Download Signed Document
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
