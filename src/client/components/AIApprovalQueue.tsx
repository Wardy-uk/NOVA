import { useState, useEffect, useCallback, useRef } from 'react';
import { AIApprovalDrawer } from './AIApprovalDrawer.js';

interface ApprovalItem {
  id: number;
  ticket_id: string;
  ticket_summary: string;
  reporter_name: string | null;
  reporter_email: string | null;
  ai_response_adf: string | null;
  conversation_json: string | null;
  kb_sources: string | null;
  resume_url: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  edited_response_adf: string | null;
  priority: string | null;
  created_at: string;
  expires_at: string;
}

interface ApprovalStats {
  pending: number;
  approved: number;
  declined: number;
  timed_out: number;
  today_decided: number;
}

interface AIApprovalQueueProps {
  canInteract: boolean;
}

const API_BASE = '/api/approvals';

const STATUS_FILTERS = [
  { key: '', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'timed_out', label: 'Timed Out' },
];

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  highest: 'bg-red-500/20 text-red-400 border-red-500/30',
  major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  minor: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  low: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  lowest: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function timeRemaining(expiresAt: string): { text: string; urgency: 'normal' | 'warning' | 'critical' | 'expired' } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { text: 'Expired', urgency: 'expired' };
  const mins = Math.floor(diff / 60000);
  if (mins < 10) return { text: `${mins}m`, urgency: 'critical' };
  if (mins < 30) return { text: `${mins}m`, urgency: 'warning' };
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return { text: `${hrs}h ${remMins}m`, urgency: 'normal' };
}

const URGENCY_COLORS: Record<string, string> = {
  normal: 'text-neutral-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
  expired: 'text-neutral-600',
};

let toastIdCounter = 0;

export function AIApprovalQueue({ canInteract }: AIApprovalQueueProps) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [stats, setStats] = useState<ApprovalStats>({ pending: 0, approved: 0, declined: 0, timed_out: 0, today_decided: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawerItem, setDrawerItem] = useState<ApprovalItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string }>>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [tick, setTick] = useState(0); // for re-rendering countdown timers

  const prevItemIdsRef = useRef<Set<number>>(new Set());

  // ---- Data fetching ----

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${API_BASE}?${params}`);
      const json = await res.json();
      if (json.ok) {
        const newItems: ApprovalItem[] = json.data.items || json.data || [];
        // Detect new items for toast notifications
        const newIds = new Set(newItems.map(it => it.id));
        if (prevItemIdsRef.current.size > 0) {
          for (const item of newItems) {
            if (!prevItemIdsRef.current.has(item.id) && item.status === 'pending') {
              const summary = item.ticket_summary.length > 60
                ? item.ticket_summary.slice(0, 57) + '...'
                : item.ticket_summary;
              addToast(`New approval: ${item.ticket_id} \u2014 ${summary}`);
            }
          }
        }
        prevItemIdsRef.current = newIds;
        setItems(newItems);
      }
    } catch {
      // Silently fail on poll errors
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const json = await res.json();
      if (json.ok) setStats(json.data);
    } catch {
      // Silently fail
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    setLoading(true);
    fetchItems();
    fetchStats();
    const itemInterval = setInterval(fetchItems, 15000);
    const statsInterval = setInterval(fetchStats, 15000);
    return () => {
      clearInterval(itemInterval);
      clearInterval(statsInterval);
    };
  }, [fetchItems, fetchStats]);

  // Tick countdown every second
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset selection when filter changes
  useEffect(() => {
    setSelected(new Set());
    setFocusIndex(0);
    prevItemIdsRef.current = new Set();
  }, [statusFilter]);

  // ---- Toast notifications ----

  function addToast(message: string) {
    const id = ++toastIdCounter;
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }

  // ---- Actions ----

  async function handleDecide(id: number, action: 'approve' | 'decline', editedResponse?: string) {
    try {
      const res = await fetch(`${API_BASE}/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, editedResponse }),
      });
      const json = await res.json();
      if (json.ok) {
        fetchItems();
        fetchStats();
        if (drawerItem?.id === id) setDrawerItem(null);
        setSelected(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch {
      // Handle error silently
    }
  }

  async function handleBulkDecide(action: 'approve' | 'decline') {
    const promises = Array.from(selected).map(id => handleDecide(id, action));
    await Promise.all(promises);
    setSelected(new Set());
  }

  // ---- Filtering ----

  const filteredItems = items.filter(item => {
    if (!search) return true;
    const q = search.toLowerCase();
    return item.ticket_id.toLowerCase().includes(q) || item.ticket_summary.toLowerCase().includes(q);
  });

  // ---- Selection helpers ----

  const pendingItems = filteredItems.filter(it => it.status === 'pending');
  const allPendingSelected = pendingItems.length > 0 && pendingItems.every(it => selected.has(it.id));

  function toggleSelectAll() {
    if (allPendingSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingItems.map(it => it.id)));
    }
  }

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- Drawer navigation ----

  function openDrawer(item: ApprovalItem) {
    setDrawerItem(item);
    const idx = filteredItems.findIndex(i => i.id === item.id);
    if (idx >= 0) setFocusIndex(idx);
  }

  function navigateDrawer(direction: -1 | 1) {
    const newIdx = focusIndex + direction;
    if (newIdx >= 0 && newIdx < filteredItems.length) {
      setFocusIndex(newIdx);
      setDrawerItem(filteredItems[newIdx]);
    }
  }

  // ---- Keyboard shortcuts ----

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          if (drawerItem) {
            navigateDrawer(1);
          } else {
            setFocusIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
          }
          break;
        case 'k':
          e.preventDefault();
          if (drawerItem) {
            navigateDrawer(-1);
          } else {
            setFocusIndex(prev => Math.max(prev - 1, 0));
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (!drawerItem && filteredItems[focusIndex]) {
            openDrawer(filteredItems[focusIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (drawerItem) setDrawerItem(null);
          break;
        case 'a':
          if (drawerItem && canInteract && drawerItem.status === 'pending') {
            e.preventDefault();
            handleDecide(drawerItem.id, 'approve');
          }
          break;
        case 'd':
          if (drawerItem && canInteract && drawerItem.status === 'pending') {
            e.preventDefault();
            handleDecide(drawerItem.id, 'decline');
          }
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawerItem, focusIndex, filteredItems, canInteract]);

  // ---- Render ----

  return (
    <div className="space-y-4">
      {/* Read-only banner */}
      {!canInteract && !loading && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 text-[13px] text-amber-400 flex items-center gap-2">
          <i className="fas fa-lock text-[12px]" />
          Read-only — you need AI Approver permissions to approve or decline tickets
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard value={stats.pending} label="Pending" color="#f59e0b" />
        <KpiCard value={stats.approved} label="Approved Today" color="#22c55e" />
        <KpiCard value={stats.declined} label="Declined Today" color="#ef4444" />
        <KpiCard value={stats.timed_out} label="Timed Out" color="#6b7280" />
      </div>

      {/* Toolbar */}
      <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-[12px]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by ticket ID or summary..."
              className="w-full bg-[#1f242b] border border-[#3a424d] rounded-lg pl-9 pr-3 py-2 text-[13px] text-neutral-300 placeholder-neutral-600 focus:outline-none focus:border-[#5ec1ca]/40 focus:ring-1 focus:ring-[#5ec1ca]/20"
            />
          </div>

          {/* Status filter pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
                  statusFilter === f.key
                    ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30'
                    : 'bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:text-neutral-300 hover:border-neutral-500'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk actions bar */}
        {canInteract && selected.size > 0 && (
          <div className="mt-3 pt-3 border-t border-[#3a424d] flex items-center gap-3">
            <span className="text-[12px] text-neutral-400">
              {selected.size} selected
            </span>
            <button
              onClick={() => handleBulkDecide('approve')}
              className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
            >
              Approve Selected ({selected.size})
            </button>
            <button
              onClick={() => handleBulkDecide('decline')}
              className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
            >
              Decline Selected ({selected.size})
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-neutral-500 hover:text-neutral-300 text-[12px] transition-colors"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="border border-[#3a424d] rounded-lg bg-[#272C33] overflow-hidden">
        {loading ? (
          <div className="text-sm text-neutral-500 py-12 text-center">Loading approvals...</div>
        ) : filteredItems.length === 0 ? (
          <div className="text-sm text-neutral-500 py-12 text-center">
            {search ? 'No matching approvals found' : 'No approvals in this view'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#3a424d] bg-[#2a3039]">
                  {canInteract && statusFilter === 'pending' && (
                    <th className="px-3 py-2.5 w-10">
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-[#3a424d] bg-[#1f242b] text-[#5ec1ca] focus:ring-[#5ec1ca]/30 focus:ring-offset-0"
                      />
                    </th>
                  )}
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Ticket</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Summary</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Reporter</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Priority</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Age</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">Expires</th>
                  <th className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => {
                  const expiry = timeRemaining(item.expires_at);
                  const isFocused = idx === focusIndex;
                  const isSelected = selected.has(item.id);
                  const priStyle = PRIORITY_STYLES[(item.priority || 'normal').toLowerCase()] || PRIORITY_STYLES.normal;

                  return (
                    <tr
                      key={item.id}
                      onClick={() => openDrawer(item)}
                      className={`border-b border-[#3a424d] cursor-pointer transition-colors ${
                        isFocused
                          ? 'bg-[#363d47] ring-1 ring-inset ring-[#5ec1ca]/20'
                          : isSelected
                          ? 'bg-[#2f353d]/80'
                          : 'bg-[#2f353d] hover:bg-[#363d47]'
                      }`}
                    >
                      {canInteract && statusFilter === 'pending' && (
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          {item.status === 'pending' && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(item.id)}
                              className="rounded border-[#3a424d] bg-[#1f242b] text-[#5ec1ca] focus:ring-[#5ec1ca]/30 focus:ring-offset-0"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-3">
                        <span className="text-[#5ec1ca] text-[13px] font-mono font-semibold hover:underline">
                          {item.ticket_id}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-neutral-300 max-w-xs truncate">
                        {item.ticket_summary}
                      </td>
                      <td className="px-3 py-3 text-[13px] text-neutral-400">
                        {item.reporter_name || item.reporter_email || 'Unknown'}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${priStyle}`}>
                          {item.priority || 'Normal'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-neutral-400">
                        {timeAgo(item.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        {item.status === 'timed_out' ? (
                          <span className="text-[13px] text-neutral-600">Expired</span>
                        ) : (
                          <span className={`text-[13px] font-medium ${URGENCY_COLORS[expiry.urgency]}`}>
                            {expiry.text}
                            {expiry.urgency === 'critical' && (
                              <i className="fas fa-exclamation-triangle ml-1 text-[10px]" />
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => openDrawer(item)}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-[#3a424d] text-neutral-300 hover:bg-[#444d59] hover:text-neutral-100 transition-colors font-medium"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center justify-center gap-4 text-[11px] text-neutral-600">
        <span><kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] border border-[#3a424d] text-neutral-500 font-mono">j</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] border border-[#3a424d] text-neutral-500 font-mono">k</kbd> navigate</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] border border-[#3a424d] text-neutral-500 font-mono">Enter</kbd> open</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] border border-[#3a424d] text-neutral-500 font-mono">a</kbd> approve</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] border border-[#3a424d] text-neutral-500 font-mono">d</kbd> decline</span>
        <span><kbd className="px-1.5 py-0.5 rounded bg-[#2f353d] border border-[#3a424d] text-neutral-500 font-mono">Esc</kbd> close</span>
      </div>

      {/* Drawer */}
      {drawerItem && (
        <AIApprovalDrawer
          item={drawerItem}
          canInteract={canInteract}
          onClose={() => setDrawerItem(null)}
          onDecide={handleDecide}
          onPrev={() => navigateDrawer(-1)}
          onNext={() => navigateDrawer(1)}
          hasPrev={focusIndex > 0}
          hasNext={focusIndex < filteredItems.length - 1}
        />
      )}

      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-[#272C33] border border-[#3a424d] rounded-lg px-4 py-3 shadow-xl text-[13px] text-neutral-300 max-w-sm animate-slide-in-right flex items-center gap-2"
          >
            <i className="fas fa-bell text-[#5ec1ca] text-[12px]" />
            {toast.message}
          </div>
        ))}
      </div>

      {/* Toast animation style */}
      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </div>
  );
}

// ---- KPI Card ----

function KpiCard({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#272C33]">
      <div className="text-3xl font-bold" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}
