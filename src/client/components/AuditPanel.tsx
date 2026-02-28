import { useState, useEffect } from 'react';

interface AuditEntry {
  id: number;
  user_id: number;
  username: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  changes_json: string | null;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  create: '#22c55e',
  update: '#f59e0b',
  delete: '#ef4444',
};

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr + 'Z').getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Inline mini-panel for DeliveryDrawer
export function AuditHistory({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!entityId) return;
    fetch(`/api/audit?entity_type=${entityType}&entity_id=${entityId}&limit=10`)
      .then(r => r.json())
      .then(json => { if (json.ok) setEntries(json.data); })
      .catch(() => {});
  }, [entityType, entityId]);

  if (entries.length === 0) return null;

  return (
    <div className="border-t border-[#3a424d] pt-2 mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors flex items-center gap-1"
      >
        <span>{expanded ? '\u25BC' : '\u25B6'}</span>
        History ({entries.length})
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-2 text-[10px]">
              <span
                className="px-1 py-0.5 rounded text-[9px] font-semibold uppercase"
                style={{ color: ACTION_COLORS[e.action] ?? '#6b7280', backgroundColor: (ACTION_COLORS[e.action] ?? '#6b7280') + '20' }}
              >
                {e.action}
              </span>
              <span className="text-neutral-400">{e.username ?? `User #${e.user_id}`}</span>
              <span className="text-neutral-600 ml-auto">{formatRelative(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Full admin audit log view
export function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(0);
  const limit = 30;

  const loadData = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
    if (filterType) params.set('entity_type', filterType);
    fetch(`/api/audit?${params}`)
      .then(r => r.json())
      .then(json => {
        if (json.ok) { setEntries(json.data); setTotal(json.total); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [filterType, page]);

  const entityTypes = ['delivery', 'milestone', 'ticket_run', 'user', 'settings'];
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-400">Filter:</span>
        <button
          onClick={() => { setFilterType(''); setPage(0); }}
          className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${!filterType ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'}`}
        >
          All
        </button>
        {entityTypes.map(t => (
          <button
            key={t}
            onClick={() => { setFilterType(t); setPage(0); }}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${filterType === t ? 'bg-[#5ec1ca] text-[#272C33] font-semibold' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'}`}
          >
            {t}
          </button>
        ))}
        <span className="text-[10px] text-neutral-600 ml-auto">{total} entries</span>
      </div>

      {loading ? (
        <div className="text-xs text-neutral-500 py-4 text-center">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-neutral-600 py-8 text-center">No audit entries found</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#3a424d]">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#2f353d] text-neutral-500 uppercase tracking-wider text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {entries.map(e => {
                let changes: Record<string, unknown> = {};
                try { if (e.changes_json) changes = JSON.parse(e.changes_json); } catch { /* ignore */ }
                const changeKeys = Object.keys(changes).filter(k => k !== 'is_starred' && k !== 'star_scope' && k !== 'starred_by');

                return (
                  <tr key={e.id} className="hover:bg-[#363d47]/50 transition-colors">
                    <td className="px-3 py-2 text-neutral-400 whitespace-nowrap">
                      {new Date(e.created_at + 'Z').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{' '}
                      {new Date(e.created_at + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-neutral-200">{e.username ?? `#${e.user_id}`}</td>
                    <td className="px-3 py-2">
                      <span
                        className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase"
                        style={{ color: ACTION_COLORS[e.action] ?? '#6b7280', backgroundColor: (ACTION_COLORS[e.action] ?? '#6b7280') + '20' }}
                      >
                        {e.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-400">{e.entity_type}</td>
                    <td className="px-3 py-2 text-[#5ec1ca] font-mono">{e.entity_id}</td>
                    <td className="px-3 py-2 text-neutral-500 max-w-[300px] truncate" title={e.changes_json ?? ''}>
                      {changeKeys.length > 0 ? changeKeys.join(', ') : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
          >
            Prev
          </button>
          <span className="text-[10px] text-neutral-500">{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-200 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
