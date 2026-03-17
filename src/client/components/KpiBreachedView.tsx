import { useState, useEffect, useCallback } from 'react';

interface AgentRow {
  AgentName: string;
  AgentSurname?: string;
  TierCode: string;
  Team: string;
  OpenTickets_Total: number;
  OpenTickets_Over2Hours: number;
  OpenTickets_NoUpdateToday: number;
  OldestTicketDays: number;
  SolvedTickets_Today: number;
  TicketsSnapshotAt: string;
}

const RAG = {
  over2h: (v: number) => v === 0 ? 'green' : v <= 2 ? 'amber' : 'red',
  stale: (v: number) => v === 0 ? 'green' : v <= 1 ? 'amber' : 'red',
  oldest: (v: number) => v <= 3 ? 'green' : v <= 7 ? 'amber' : 'red',
};

const RAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  green: { bg: 'rgba(16,185,129,0.12)', text: '#10b981', border: 'rgba(16,185,129,0.25)' },
  amber: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
  red:   { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
};

function RagCell({ value, ragFn, suffix }: { value: number; ragFn: (v: number) => string; suffix?: string }) {
  const rag = ragFn(value);
  const c = RAG_COLORS[rag];
  return (
    <td className="px-4 py-3 text-center">
      <span
        className="inline-block px-3 py-1 rounded-lg text-[13px] font-bold min-w-[48px]"
        style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
      >
        {value}{suffix || ''}
      </span>
    </td>
  );
}

function TeamBadge({ team }: { team: string }) {
  const colors: Record<string, string> = {
    'CC': '#3b82f6',
    'Customer Care': '#3b82f6',
    'Production': '#8b5cf6',
    'Tier 2': '#f59e0b',
    'Tier 3': '#ef4444',
    'Development': '#10b981',
  };
  const color = colors[team] || '#64748b';
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}22`, color, border: `1px solid ${color}33` }}
    >
      {team || '—'}
    </span>
  );
}

type SortKey = 'name' | 'overSla' | 'notUpdated' | 'oldest';
type SortDir = 'asc' | 'desc';

export function KpiBreachedView({ isWallboard = false }: { isWallboard?: boolean }) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'breached'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const fetchData = useCallback(async () => {
    try {
      const url = isWallboard
        ? '/api/public/wallboard/breached'
        : '/api/kpi-data/agents?env=live';
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) {
        setAgents(json.data);
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [isWallboard]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, isWallboard ? 30000 : 60000);
    return () => clearInterval(interval);
  }, [fetchData, isWallboard]);

  const getName = (a: AgentRow) =>
    a.AgentSurname ? `${a.AgentName} ${a.AgentSurname}` : a.AgentName;

  const filtered = filter === 'breached'
    ? agents.filter(a => a.OpenTickets_Over2Hours > 0 || a.OpenTickets_NoUpdateToday > 0 || a.OldestTicketDays > 3)
    : agents;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const displayed = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'overSla': cmp = a.OpenTickets_Over2Hours - b.OpenTickets_Over2Hours; break;
      case 'notUpdated': cmp = a.OpenTickets_NoUpdateToday - b.OpenTickets_NoUpdateToday; break;
      case 'oldest': cmp = a.OldestTicketDays - b.OldestTicketDays; break;
      default: {
        const na = `${a.AgentName} ${a.AgentSurname ?? ''}`.trim().toLowerCase();
        const nb = `${b.AgentName} ${b.AgentSurname ?? ''}`.trim().toLowerCase();
        cmp = na.localeCompare(nb);
      }
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Summary stats
  const totalOver = agents.reduce((s, a) => s + a.OpenTickets_Over2Hours, 0);
  const totalStale = agents.reduce((s, a) => s + a.OpenTickets_NoUpdateToday, 0);
  const agentsBreached = agents.filter(a => a.OpenTickets_Over2Hours > 0).length;
  const worstOldest = agents.reduce((m, a) => Math.max(m, a.OldestTicketDays), 0);

  const TH = `px-4 py-3 text-left text-[10px] uppercase tracking-wider font-bold ${isWallboard ? 'text-neutral-400' : 'text-neutral-500'} bg-[#1e2228] border-b border-[#2f353d]`;
  const THC = `${TH} text-center`;
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
  const sortTh = (key: SortKey, label: string, center = false) => (
    <th
      className={`${center ? THC : TH} cursor-pointer hover:text-neutral-300 select-none`}
      onClick={() => toggleSort(key)}
    >
      {label}{sortArrow(key)}
    </th>
  );

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${isWallboard ? 'h-screen bg-[#1a1f26]' : 'py-20'}`}>
        <div className="text-neutral-500 text-lg">Loading breach data...</div>
      </div>
    );
  }

  return (
    <div className={isWallboard ? 'min-h-screen bg-[#1a1f26] p-6' : 'space-y-4'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className={`font-bold font-[var(--font-heading)] text-neutral-100 ${isWallboard ? 'text-2xl' : 'text-lg'}`}>
            SLA Breach Board
          </h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Live ticket health per agent {lastUpdate && <span className="text-neutral-600">· Updated {lastUpdate}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isWallboard && (
            <div className="flex border border-[#3a424d] rounded-lg overflow-hidden">
              {(['all', 'breached'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    filter === f
                      ? 'bg-[#5ec1ca]/15 text-[#5ec1ca]'
                      : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {f === 'all' ? 'All Agents' : 'Breached Only'}
                </button>
              ))}
            </div>
          )}
          {isWallboard && (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[11px] text-neutral-500">Auto-refresh 30s</span>
            </div>
          )}
        </div>
      </div>

      {/* Summary KPI cards */}
      <div className={`grid gap-3 mb-5 ${isWallboard ? 'grid-cols-4' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {[
          { label: 'Tickets Over SLA', value: totalOver, color: totalOver === 0 ? '#10b981' : '#ef4444', icon: '⚠' },
          { label: 'Agents Breached', value: `${agentsBreached} / ${agents.length}`, color: agentsBreached === 0 ? '#10b981' : '#f59e0b', icon: '◉' },
          { label: 'Tickets Not Updated', value: totalStale, color: totalStale === 0 ? '#10b981' : '#f59e0b', icon: '◎' },
          { label: 'Worst Oldest (days)', value: worstOldest, color: worstOldest <= 3 ? '#10b981' : worstOldest <= 7 ? '#f59e0b' : '#ef4444', icon: '◈' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-5 py-4">
            <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-2">{kpi.icon} {kpi.label}</div>
            <div className={`font-extrabold tracking-tight ${isWallboard ? 'text-3xl' : 'text-2xl'}`} style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Agent table */}
      <div className="border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {sortTh('name', 'Agent')}
              <th className={TH}>Team</th>
              <th className={THC}>Open</th>
              {sortTh('overSla', 'Over SLA', true)}
              {sortTh('notUpdated', 'Not Updated', true)}
              {sortTh('oldest', 'Oldest (days)', true)}
              <th className={THC}>Solved Today</th>
            </tr>
          </thead>
          <tbody>
            {displayed.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12 text-neutral-600">
                  {filter === 'breached' ? 'No agents currently breaching — all clear!' : 'No agent data available'}
                </td>
              </tr>
            )}
            {displayed.map((a, i) => {
              const name = getName(a);
              const hasIssues = a.OpenTickets_Over2Hours > 0 || a.OldestTicketDays > 7;
              return (
                <tr
                  key={name + i}
                  className={`border-b border-[#2f353d] transition-colors ${
                    hasIssues ? 'bg-red-900/5' : 'hover:bg-[#2f353d]/50'
                  }`}
                  style={isWallboard ? { fontSize: '15px' } : undefined}
                >
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${hasIssues ? 'text-red-300' : 'text-neutral-100'}`}>
                      {name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <TeamBadge team={a.TierCode || a.Team} />
                  </td>
                  <td className="px-4 py-3 text-center text-[13px] text-neutral-400 font-semibold">
                    {a.OpenTickets_Total}
                  </td>
                  <RagCell value={a.OpenTickets_Over2Hours} ragFn={RAG.over2h} />
                  <RagCell value={a.OpenTickets_NoUpdateToday} ragFn={RAG.stale} />
                  <RagCell value={a.OldestTicketDays} ragFn={RAG.oldest} suffix="d" />
                  <td className="px-4 py-3 text-center text-[13px] text-[#5ec1ca] font-bold">
                    {a.SolvedTickets_Today}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer for wallboard */}
      {isWallboard && (
        <div className="mt-4 text-center text-[11px] text-neutral-600">
          nurtur.tech · SLA Breach Board · {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </div>
      )}
    </div>
  );
}
