import { useState, useEffect, useRef } from 'react';

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
  overdue_update: '\u23F0',
  milestone_overdue: '\u{1F6A9}',
  delivery_due_soon: '\u{1F4C5}',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch notifications + unread count
  const fetchNotifications = () => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(json => {
        if (json.ok) {
          setItems(json.data);
          setUnreadCount(json.unreadCount);
        }
      })
      .catch(() => {});
  };

  // Poll count every 60s, full fetch on open
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(() => {
      fetch('/api/notifications/count')
        .then(r => r.json())
        .then(json => { if (json.ok) setUnreadCount(json.count); })
        .catch(() => {});
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Also trigger check on mount (generates new notifications)
  useEffect(() => {
    fetch('/api/notifications/check', { method: 'POST' })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.created > 0) fetchNotifications();
      })
      .catch(() => {});
  }, []);

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
  );
}
