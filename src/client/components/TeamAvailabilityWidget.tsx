import { useState, useEffect, useCallback } from 'react';

interface AgentEntry {
  roster_id: number;
  display_name: string;
  pool: string;
  status: string;
  reason: string | null;
  source?: string;
  set_by?: string | null;
}

const AWAY_OPTIONS = [
  { value: 'annual_leave', label: 'Annual Leave' },
  { value: 'sick', label: 'Sick' },
  { value: 'other_leave', label: 'Other Leave' },
] as const;

interface AvailabilityData {
  date: string;
  totalRoster: number;
  availableCount: number;
  available: AgentEntry[];
  unavailable: AgentEntry[];
}

function absenceLabel(type: string): string {
  switch (type) {
    case 'annual_leave': return 'Annual Leave';
    case 'sick': return 'Sick';
    case 'other_leave': return 'Other Leave';
    case 'wfh': return 'WFH';
    case 'training': return 'Training';
    default: return 'Other';
  }
}

function absenceColor(type: string): string {
  switch (type) {
    case 'annual_leave': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'sick': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'other_leave': return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'wfh': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'training': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    default: return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30';
  }
}

export function TeamAvailabilityWidget() {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/availability/snapshot?date=${date}`);
      const json = await res.json();
      if (json.ok) setData(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Close the status menu on any outside click.
  useEffect(() => {
    if (menuFor === null) return;
    const close = () => setMenuFor(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuFor]);

  const setStatus = useCallback(async (rosterId: number, status: string) => {
    setSaving(rosterId);
    setError(null);
    try {
      const token = localStorage.getItem('nova_auth_token') || '';
      const res = await fetch('/api/agent/availability', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rosterId, date, status, reason: 'Set manually in NOVA' }),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error || 'Failed to update');
      else await fetchData();
    } catch {
      setError('Failed to update');
    }
    setSaving(null);
    setMenuFor(null);
  }, [date, fetchData]);

  // Popover of status choices. `current` is omitted from the list.
  const StatusMenu = ({ agent, options }: { agent: AgentEntry; options: readonly { value: string; label: string }[] }) => (
    <div
      className="absolute z-20 mt-1 bg-neutral-900 border border-neutral-700 rounded shadow-lg py-1 min-w-[130px]"
      onClick={e => e.stopPropagation()}
    >
      {options.filter(o => o.value !== agent.status).map(o => (
        <button
          key={o.value}
          onClick={() => setStatus(agent.roster_id, o.value)}
          className="block w-full text-left px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
        >{o.label}</button>
      ))}
    </div>
  );

  if (loading) return <div className="text-neutral-500 text-sm p-4">Loading availability...</div>;
  if (!data) return <div className="text-neutral-500 text-sm p-4">Availability data unavailable</div>;

  const capacityPct = data.totalRoster > 0
    ? Math.round(data.availableCount / data.totalRoster * 100) : 0;
  const capacityColor = capacityPct >= 70 ? 'text-emerald-400' : capacityPct >= 50 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white">Team Availability</h3>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="bg-neutral-900 border border-neutral-700 text-neutral-300 text-xs rounded px-2 py-1"
        />
      </div>

      {error && (
        <div className="mb-3 px-2 py-1.5 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded">{error}</div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <div className="text-center">
          <div className={`text-2xl font-bold font-mono ${capacityColor}`}>{data.availableCount}</div>
          <div className="text-xs text-neutral-500">Available</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold font-mono text-neutral-400">{data.unavailable.length}</div>
          <div className="text-xs text-neutral-500">Away</div>
        </div>
        <div className="text-center">
          <div className={`text-2xl font-bold font-mono ${capacityColor}`}>{capacityPct}%</div>
          <div className="text-xs text-neutral-500">Capacity</div>
        </div>
      </div>

      {data.unavailable.length > 0 && (
        <div className="space-y-1.5 mb-3">
          <div className="text-xs text-neutral-500 font-medium">Away Today</div>
          {data.unavailable.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-neutral-300">
                {a.display_name}
                {a.source === 'manual' && (
                  <span className="ml-1.5 text-[10px] text-neutral-500" title={`Set manually${a.set_by ? ` by ${a.set_by}` : ''} — People HR won't overwrite this today`}>
                    (manual)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1">
                <div className="relative">
                  <button
                    onClick={e => { e.stopPropagation(); setMenuFor(menuFor === a.roster_id ? null : a.roster_id); }}
                    disabled={saving === a.roster_id}
                    className={`px-1.5 py-0.5 text-xs border rounded hover:brightness-125 disabled:opacity-50 ${absenceColor(a.status)}`}
                    title="Change status"
                  >
                    {saving === a.roster_id ? '…' : absenceLabel(a.status)}
                  </button>
                  {menuFor === a.roster_id && (
                    <div className="absolute right-0">
                      <StatusMenu agent={a} options={[{ value: 'available', label: 'Available' }, ...AWAY_OPTIONS]} />
                    </div>
                  )}
                </div>
                <button
                  onClick={async () => {
                    const token = localStorage.getItem('nova_auth_token') || '';
                    await fetch('/api/agent/availability', {
                      method: 'DELETE',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ rosterId: (a as any).roster_id ?? (a as any).id, date }),
                    });
                    fetchData();
                  }}
                  className="text-neutral-600 hover:text-neutral-400 text-[10px]"
                  title="Clear this absence"
                >&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.available.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-neutral-500 font-medium">Available ({data.availableCount})</div>
          <div className="flex flex-wrap gap-1">
            {data.available.map((a, i) => (
              <div key={i} className="relative">
                <button
                  onClick={e => { e.stopPropagation(); setMenuFor(menuFor === a.roster_id ? null : a.roster_id); }}
                  disabled={saving === a.roster_id}
                  className="px-1.5 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded hover:bg-emerald-500/20 disabled:opacity-50"
                  title="Mark as away"
                >
                  {saving === a.roster_id ? '…' : a.display_name}
                </button>
                {menuFor === a.roster_id && <StatusMenu agent={a} options={AWAY_OPTIONS} />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
