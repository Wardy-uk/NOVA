/**
 * Customer Setup Portal panel — for the DeliveryDrawer.
 * Allows NOVA users to generate magic links and manage tokens.
 */

import { useState, useEffect } from 'react';

interface PortalToken {
  id: number;
  token: string;
  full_token: string;
  delivery_id: number;
  customer_email: string;
  customer_name: string | null;
  expires_at: string;
  created_at: string;
  last_accessed: string | null;
  completed_at: string | null;
  progress_json: string;
}

export function SetupPortalPanel({ deliveryId, account }: { deliveryId: number; account: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const [tokens, setTokens] = useState<PortalToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);

  // Check feature flag
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.feature_instance_setup === 'true') setEnabled(true);
      })
      .catch(() => {});
  }, []);

  // Load tokens when expanded
  useEffect(() => {
    if (!collapsed && enabled) {
      setLoading(true);
      fetch(`/api/setup-portal/tokens/${deliveryId}`)
        .then(r => r.json())
        .then(json => { if (json.ok) setTokens(json.data || []); })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [collapsed, deliveryId, enabled]);

  if (!enabled) return null;

  const generateLink = async (sendEmail: boolean) => {
    if (!email.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/setup-portal/generate/${deliveryId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, sendEmail }),
      });
      const json = await res.json();
      if (json.ok) {
        if (!sendEmail && json.url) {
          navigator.clipboard.writeText(json.url).then(() => {
            setCopyMsg('Link copied!');
            setTimeout(() => setCopyMsg(null), 3000);
          });
        } else if (json.emailSent === false && json.url) {
          navigator.clipboard.writeText(json.url).then(() => {
            setCopyMsg(json.reason ? `${json.reason} — link copied` : 'Link copied (email not sent)');
            setTimeout(() => setCopyMsg(null), 4000);
          });
        } else {
          setCopyMsg('Email sent!');
          setTimeout(() => setCopyMsg(null), 3000);
        }
        setShowForm(false);
        setEmail('');
        setName('');
        // Refresh tokens
        const tokRes = await fetch(`/api/setup-portal/tokens/${deliveryId}`);
        const tokJson = await tokRes.json();
        if (tokJson.ok) setTokens(tokJson.data || []);
      }
    } catch { /* ignore */ }
    setSending(false);
  };

  const revokeToken = async (tokenId: number) => {
    if (!confirm('Revoke this link? The customer will no longer be able to access it.')) return;
    const res = await fetch(`/api/setup-portal/tokens/${tokenId}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) setTokens(tokens.filter(t => t.id !== tokenId));
  };

  const copyLink = (fullToken: string) => {
    const url = `${window.location.origin}/setup/${fullToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopyMsg('Link copied!');
      setTimeout(() => setCopyMsg(null), 3000);
    });
  };

  const getProgressPercent = (progressJson: string): number => {
    try {
      const p = JSON.parse(progressJson || '{}');
      const total = 6; // number of wizard steps
      const done = Object.values(p).filter(Boolean).length;
      return Math.round((done / total) * 100);
    } catch { return 0; }
  };

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-2">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full text-left"
      >
        <span className="text-xs font-semibold text-neutral-300">Customer Setup Portal</span>
        <span className="text-[10px] text-neutral-500">{collapsed ? '+' : '-'}</span>
      </button>

      {!collapsed && (
        <div className="space-y-3">
          {/* Send Link */}
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="w-full px-3 py-2 text-xs bg-[#1f242b] border border-[#3a424d] rounded text-neutral-300 hover:bg-[#2a2f38] transition-colors"
            >
              + Send Setup Link
            </button>
          ) : (
            <div className="bg-[#1f242b] border border-[#3a424d] rounded-lg p-3 space-y-2">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Customer email *"
                className="w-full px-2 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500 outline-none focus:border-[#5ec1ca]"
              />
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Customer name (optional)"
                className="w-full px-2 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500 outline-none focus:border-[#5ec1ca]"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => generateLink(true)}
                  disabled={sending || !email.trim()}
                  className="flex-1 px-2 py-1.5 text-xs bg-[#5ec1ca] text-[#1e2228] font-medium rounded hover:bg-[#4eb0b9] disabled:opacity-50 transition-colors"
                >
                  {sending ? '...' : 'Send Email'}
                </button>
                <button
                  onClick={() => generateLink(false)}
                  disabled={sending || !email.trim()}
                  className="flex-1 px-2 py-1.5 text-xs bg-[#2f353d] text-neutral-300 border border-[#3a424d] rounded hover:bg-[#3a424d] disabled:opacity-50 transition-colors"
                >
                  Copy Link
                </button>
                <button
                  onClick={() => { setShowForm(false); setEmail(''); setName(''); }}
                  className="px-2 py-1.5 text-xs text-neutral-500 hover:text-neutral-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {copyMsg && (
            <div className="text-[11px] text-green-400 text-center">{copyMsg}</div>
          )}

          {/* Tokens list */}
          {loading ? (
            <div className="text-[11px] text-neutral-500 text-center py-2">Loading...</div>
          ) : tokens.length > 0 ? (
            <div className="space-y-1.5">
              {tokens.map(t => {
                const pct = getProgressPercent(t.progress_json);
                const isExpired = new Date(t.expires_at) < new Date();
                return (
                  <div key={t.id} className="flex items-center justify-between bg-[#1f242b] border border-[#3a424d] rounded px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-neutral-200 truncate">{t.customer_email}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {t.completed_at ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400">Completed</span>
                        ) : isExpired ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400">Expired</span>
                        ) : (
                          <span className="text-[10px] text-neutral-500">{pct}% done</span>
                        )}
                        {t.last_accessed && (
                          <span className="text-[10px] text-neutral-600">Last: {new Date(t.last_accessed).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      {!isExpired && !t.completed_at && (
                        <button onClick={() => copyLink(t.full_token)} className="text-[10px] text-[#5ec1ca] hover:text-[#4eb0b9]" title="Copy link">
                          Copy
                        </button>
                      )}
                      <button onClick={() => revokeToken(t.id)} className="text-[10px] text-red-400 hover:text-red-300" title="Revoke">
                        Revoke
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-neutral-600 text-center py-2">No setup links sent yet</div>
          )}
        </div>
      )}
    </div>
  );
}
