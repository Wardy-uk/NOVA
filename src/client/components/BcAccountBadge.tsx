import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface BcSearchResult {
  number: string;
  displayName: string;
  email: string;
  city: string;
  blocked: string;
}

interface Props {
  ticketKey: string;
  accountNumber: string | null | undefined;
  onLinked?: (accountNumber: string) => void;
  compact?: boolean;
}

function getToken(): string {
  return localStorage.getItem('nova_auth_token') || '';
}

export function BcAccountBadge({ ticketKey, accountNumber, onLinked, compact }: Props) {
  const [accountName, setAccountName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BcSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [ticketKey]);

  useEffect(() => {
    setAccountName(null);
    if (!accountNumber) return;
    setLoading(true);
    fetch(`/api/approvals/bc/lookup/${encodeURIComponent(accountNumber)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(json => { if (json.ok && json.data) setAccountName(json.data.displayName); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountNumber]);

  const handleSearch = useCallback(async () => {
    if (searchQuery.trim().length < 2) return;
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/approvals/bc/search?q=${encodeURIComponent(searchQuery.trim())}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const json = await res.json();
      if (json.ok) setSearchResults(json.data);
    } catch { /* ignore */ }
    setSearchLoading(false);
  }, [searchQuery]);

  const handleLink = useCallback(async (number: string) => {
    try {
      await fetch('/api/approvals/bc/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketKey, accountNumber: number }),
      });
      setSearchOpen(false);
      setSearchResults([]);
      setSearchQuery('');
      setLoading(true);
      const res = await fetch(`/api/approvals/bc/lookup/${encodeURIComponent(number)}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const json = await res.json();
      if (json.ok && json.data) setAccountName(json.data.displayName);
      setLoading(false);
      onLinked?.(number);
    } catch { /* ignore */ }
  }, [ticketKey, onLinked]);

  return (
    <>
      {accountNumber ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-amber-300 font-mono font-semibold">{accountNumber}</span>
          {loading && <span className="text-neutral-500 text-[11px]">Loading...</span>}
          {accountName && !compact && <span className="text-neutral-300 text-[12px]">({accountName})</span>}
          {accountName && compact && <span className="text-neutral-400 text-[11px]">{accountName}</span>}
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <span className="text-red-400 italic text-[11px]">Not set</span>
          <button
            onClick={() => setSearchOpen(true)}
            className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors"
          >
            Search BC
          </button>
        </span>
      )}

      {searchOpen && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={() => setSearchOpen(false)}>
          <div className="bg-[#272C33] border border-[#3a424d] rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#3a424d] flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-neutral-200">
                <i className="fas fa-search mr-2 text-amber-400" />
                Search Business Central
              </h3>
              <button onClick={() => setSearchOpen(false)} className="text-neutral-500 hover:text-neutral-300">
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-[#3a424d]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Account name, email, or account number..."
                  className="flex-1 bg-[#1f242b] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 placeholder-neutral-600 focus:border-amber-500/50 focus:outline-none"
                  autoComplete="off"
                  autoFocus
                />
                <button
                  onClick={handleSearch}
                  disabled={searchLoading || searchQuery.trim().length < 2}
                  className="bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-50"
                >
                  {searchLoading ? <i className="fas fa-spinner fa-spin" /> : 'Search'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
              {searchResults.length === 0 && !searchLoading && (
                <div className="text-neutral-500 text-[13px] text-center py-6">
                  {searchQuery.trim().length >= 2 ? 'No results found' : 'Enter a search term above'}
                </div>
              )}
              {searchResults.map(c => (
                <div
                  key={c.number}
                  onClick={() => handleLink(c.number)}
                  className="flex items-center justify-between bg-[#1f242b] border border-[#3a424d] rounded-lg px-4 py-3 cursor-pointer hover:border-amber-500/40 hover:bg-[#2a3038] transition-colors"
                >
                  <div>
                    <div className="text-[13px] text-neutral-200 font-medium">{c.displayName}</div>
                    <div className="text-[11px] text-neutral-500">
                      <span className="font-mono text-amber-400/70">{c.number}</span>
                      {c.email && <span className="ml-2">{c.email}</span>}
                      {c.city && <span className="ml-2">{c.city}</span>}
                    </div>
                  </div>
                  {c.blocked !== ' ' && c.blocked && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">Blocked</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
