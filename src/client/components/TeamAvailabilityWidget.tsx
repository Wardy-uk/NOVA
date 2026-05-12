import { useState, useEffect, useCallback } from 'react';

interface AgentEntry {
  display_name: string;
  pool: string;
  status: string;
  reason: string | null;
}

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
    case 'wfh': return 'WFH';
    case 'training': return 'Training';
    default: return 'Other';
  }
}

function absenceColor(type: string): string {
  switch (type) {
    case 'annual_leave': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'sick': return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'wfh': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    case 'training': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    default: return 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30';
  }
}

export function TeamAvailabilityWidget() {
  const [data, setData] = useState<AvailabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/agent/availability/snapshot?date=${date}`);
      const json = await res.json();
      if (json.ok) setData(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [date]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
              <span className="text-neutral-300">{a.display_name}</span>
              <span className={`px-1.5 py-0.5 text-xs border rounded ${absenceColor(a.status)}`}>
                {absenceLabel(a.status)}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.available.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-neutral-500 font-medium">Available ({data.availableCount})</div>
          <div className="flex flex-wrap gap-1">
            {data.available.map((a, i) => (
              <span key={i} className="px-1.5 py-0.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                {a.display_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
