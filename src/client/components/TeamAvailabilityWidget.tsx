import { useState, useEffect, useCallback } from 'react';

interface AgentEntry {
  roster_id: number;
  display_name: string;
  pool: string;
  department?: string | null;
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

function nextDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

/**
 * The snapshot covers every department round-robin assigns to, which is two
 * separate desks under two managers. Shown as one list, Lucy's TPJ agents being
 * off reads as Nick's team being short — so split them into their own boxes.
 */
const TEAMS: { key: string; title: string; departments: string[] }[] = [
  { key: 'nt', title: 'Tech Support', departments: ['NT'] },
  { key: 'tpj', title: 'TPJ Maintenance', departments: ['TPJ', 'NTPJ'] },
];

function sliceTeam(data: AvailabilityData | null, departments: string[]): AvailabilityData | null {
  if (!data) return null;
  const mine = (a: AgentEntry) => departments.includes((a.department ?? 'NT').toUpperCase());
  const available = data.available.filter(mine);
  const unavailable = data.unavailable.filter(mine);
  return {
    date: data.date,
    available,
    unavailable,
    totalRoster: available.length + unavailable.length,
    availableCount: available.length,
  };
}

export function TeamAvailabilityWidget() {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [tomorrow, setTomorrow] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [res, resNext] = await Promise.all([
        fetch(`/api/agent/availability/snapshot?date=${date}`),
        fetch(`/api/agent/availability/snapshot?date=${nextDay(date)}`),
      ]);
      const json = await res.json();
      const jsonNext = await resNext.json();
      if (json.ok) setData(json.data);
      setTomorrow(jsonNext.ok ? jsonNext.data : null);
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

  const isToday = date === new Date().toISOString().slice(0, 10);
  const tomorrowLabel = isToday
    ? 'Away Tomorrow'
    : `Away ${new Date(`${nextDay(date)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;

  const renderTeam = (title: string, team: AvailabilityData, teamTomorrow: AvailabilityData | null) => {
    const capacityPct = team.totalRoster > 0
      ? Math.round(team.availableCount / team.totalRoster * 100) : 0;
    const capacityColor = capacityPct >= 70 ? 'text-emerald-400' : capacityPct >= 50 ? 'text-amber-400' : 'text-red-400';

    return (
      <div className="h-full bg-neutral-900/40 border border-neutral-700/50 rounded-lg p-3">
        <div className="text-xs font-medium text-neutral-300 mb-3">{title}</div>

        {team.totalRoster === 0 ? (
          <div className="text-xs text-neutral-600">No agents on this team</div>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-4">
              <div className="text-center">
                <div className={`text-2xl font-bold font-mono ${capacityColor}`}>{team.availableCount}</div>
                <div className="text-xs text-neutral-500">Available</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold font-mono text-neutral-400">{team.unavailable.length}</div>
                <div className="text-xs text-neutral-500">Away</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold font-mono ${capacityColor}`}>{capacityPct}%</div>
                <div className="text-xs text-neutral-500">Capacity</div>
              </div>
            </div>

            {team.unavailable.length > 0 && (
              <div className="space-y-1.5 mb-3">
                <div className="text-xs text-neutral-500 font-medium">Away Today</div>
                {team.unavailable.map((a, i) => (
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

            {teamTomorrow && (
              <div className="space-y-1.5 mb-3">
                <div className="text-xs text-neutral-500 font-medium">
                  {tomorrowLabel}
                  <span className="ml-1 text-neutral-600">({teamTomorrow.unavailable.length})</span>
                </div>
                {teamTomorrow.unavailable.length === 0 ? (
                  <div className="text-xs text-neutral-600">Nobody booked off</div>
                ) : teamTomorrow.unavailable.map(a => (
                  <div key={a.roster_id} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400">{a.display_name}</span>
                    <span className={`px-1.5 py-0.5 text-xs border rounded ${absenceColor(a.status)}`}>
                      {absenceLabel(a.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {team.available.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs text-neutral-500 font-medium">Available ({team.availableCount})</div>
                <div className="flex flex-wrap gap-1">
                  {team.available.map((a, i) => (
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
          </>
        )}
      </div>
    );
  };

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

      <div className="grid gap-3 md:grid-cols-2 items-stretch">
        {TEAMS.map(t => (
          <div key={t.key} className="h-full">
            {renderTeam(t.title, sliceTeam(data, t.departments)!, sliceTeam(tomorrow, t.departments))}
          </div>
        ))}
      </div>
    </div>
  );
}
