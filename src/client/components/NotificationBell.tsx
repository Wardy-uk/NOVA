import { useState, useEffect, useRef, useCallback } from 'react';

interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  sla_breach: '\u26A0',
  sla_breach_warning: '\u26A0\uFE0F',
  overdue_update: '\u23F0',
  milestone_overdue: '\u{1F6A9}',
  delivery_due_soon: '\u{1F4C5}',
  feedback_reply: '\u{1F4AC}',
};

// Types that trigger a toast popup
const TOAST_TYPES = new Set(['sla_breach_warning', 'feedback_reply', 'milestone_overdue']);

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ── Toast component ──

interface Toast {
  id: number;
  type: string;
  title: string;
  message: string | null;
  fadingOut?: boolean;
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg border transition-all duration-300 ${
            t.fadingOut ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
          } ${
            t.type === 'sla_breach_warning'
              ? 'bg-red-900/90 border-red-700/60 text-red-100'
              : t.type === 'milestone_overdue'
              ? 'bg-amber-900/90 border-amber-700/60 text-amber-100'
              : 'bg-[#2f353d]/95 border-[#5ec1ca]/40 text-neutral-200'
          }`}
        >
          <span className="text-lg mt-0.5 shrink-0">{TYPE_ICONS[t.type] ?? '\u{1F514}'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold">{t.title}</div>
            {t.message && <div className="text-[11px] opacity-80 mt-0.5 truncate">{t.message}</div>}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-xs opacity-60 hover:opacity-100 shrink-0 mt-0.5"
          >
            \u2715
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ──

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());

  const fetchNotifications = useCallback(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(json => {
        if (json.ok) {
          setItems(json.data);
          setUnreadCount(json.unreadCount);

          // Show toasts for new unread items of toast-worthy types
          const newToastWorthy = (json.data as NotificationItem[]).filter(n =>
            !n.read_at &&
            TOAST_TYPES.has(n.type) &&
            !seenIdsRef.current.has(n.id) &&
            // Only toast if created in the last 2 minutes (avoid toasting old items on page load)
            (Date.now() - new Date(n.created_at + 'Z').getTime()) < 120_000
          );

          if (newToastWorthy.length > 0) {
            setToasts(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const fresh = newToastWorthy
                .filter(n => !existingIds.has(n.id))
                .map(n => ({ id: n.id, type: n.type, title: n.title, message: n.message }));
              return [...prev, ...fresh].slice(-5); // max 5 toasts
            });
          }

          // Track all seen IDs to avoid re-toasting
          for (const n of json.data as NotificationItem[]) {
            seenIdsRef.current.add(n.id);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Auto-dismiss toasts after 8 seconds
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts
      .filter(t => !t.fadingOut)
      .map(t => {
        return setTimeout(() => {
          // Start fade-out
          setToasts(prev => prev.map(p => p.id === t.id ? { ...p, fadingOut: true } : p));
          // Remove after fade animation
          setTimeout(() => {
            setToasts(prev => prev.filter(p => p.id !== t.id));
          }, 300);
        }, 8000);
      });
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, fadingOut: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
  }, []);

  // Poll count every 60s — also trigger check + full fetch periodically
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(() => {
      // Trigger notification generation, then fetch
      fetch('/api/notifications/check', { method: 'POST' })
        .then(r => r.json())
        .then(json => {
          if (json.ok && json.created > 0) {
            fetchNotifications();
          } else {
            // Even if no new ones created, refresh count
            fetch('/api/notifications/count')
              .then(r => r.json())
              .then(j => { if (j.ok) setUnreadCount(j.count); })
              .catch(() => {});
          }
        })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Also trigger check on mount
  useEffect(() => {
    fetch('/api/notifications/check', { method: 'POST' })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.created > 0) fetchNotifications();
      })
      .catch(() => {});
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen(!open);
    if (!open) fetchNotifications();
  };

  const markRead = (id: number) => {
    fetch(`/api/notifications/${id}/read`, { method: 'PUT' })
      .then(() => {
        setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      })
      .catch(() => {});
  };

  const markAllRead = () => {
    fetch('/api/notifications/read-all', { method: 'PUT' })
      .then(() => {
        setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
        setUnreadCount(0);
      })
      .catch(() => {});
  };

  return (
    <>
      {/* Toast popups */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="relative" ref={panelRef}>
        <button
          onClick={handleOpen}
          className="relative p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Notifications"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-[#272C33] border border-[#3a424d] rounded-lg shadow-xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#3a424d]">
              <span className="text-xs font-semibold text-neutral-300">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9] transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-auto">
              {items.length === 0 ? (
                <div className="py-6 text-center text-xs text-neutral-500">No notifications</div>
              ) : (
                items.map(n => (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 border-b border-[#3a424d] hover:bg-[#363d47]/50 transition-colors cursor-pointer ${
                      !n.read_at ? 'bg-[#2f353d]' : ''
                    }`}
                    onClick={() => { if (!n.read_at) markRead(n.id); }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm mt-0.5">{TYPE_ICONS[n.type] ?? '\u{1F514}'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-medium truncate ${!n.read_at ? 'text-neutral-200' : 'text-neutral-400'}`}>
                            {n.title}
                          </span>
                          {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[#5ec1ca] shrink-0" />}
                        </div>
                        {n.message && (
                          <div className="text-[10px] text-neutral-500 truncate mt-0.5">{n.message}</div>
                        )}
                        <div className="text-[9px] text-neutral-600 mt-0.5">{timeAgo(n.created_at)}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
