import { useState, useEffect } from 'react';

interface CategoryStat {
  category_id: number;
  category_name: string;
  items_count: number;
  scored_count: number;
  total_possible: number;
  total_scored: number;
  percentage: number;
}

interface UserSummary {
  user_id: number;
  username: string;
  display_name: string | null;
  categories: CategoryStat[];
  overall_percentage: number;
  overall_scored: number;
  overall_possible: number;
}

interface Category {
  id: number;
  name: string;
  sort_order: number;
}

function pctColor(pct: number): string {
  if (pct === 0) return 'text-neutral-600';
  if (pct < 20) return 'text-red-400';
  if (pct < 40) return 'text-orange-400';
  if (pct < 60) return 'text-amber-400';
  if (pct < 80) return 'text-green-400';
  return 'text-emerald-400';
}

function pctBg(pct: number): string {
  if (pct === 0) return 'bg-neutral-700/30';
  if (pct < 20) return 'bg-red-500';
  if (pct < 40) return 'bg-orange-500';
  if (pct < 60) return 'bg-amber-500';
  if (pct < 80) return 'bg-green-500';
  return 'bg-emerald-500';
}

function ProgressBar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-2 rounded-full bg-[#1e2228] overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${pctBg(pct)}`}
        style={{ width: `${Math.max(pct, 1)}%`, opacity: pct === 0 ? 0.3 : 0.7 }}
      />
    </div>
  );
}

export function TrainingSummaryView() {
  const [data, setData] = useState<{ categories: Category[]; summary: UserSummary[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'name' | 'overall'>('overall');
  const [selectedUser, setSelectedUser] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/training/summary')
      .then(r => r.json())
      .then(res => {
        if (res.ok) setData(res.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <i className="fa-solid fa-spinner fa-spin mr-2" />Loading summary...
      </div>
    );
  }

  // Only show users who have at least one score
  const activeUsers = data.summary.filter(u => u.overall_scored > 0);
  const sortedUsers = [...activeUsers].sort((a, b) => {
    if (sortBy === 'overall') return b.overall_percentage - a.overall_percentage;
    return (a.display_name || a.username).localeCompare(b.display_name || b.username);
  });

  const selectedSummary = selectedUser ? data.summary.find(u => u.user_id === selectedUser) : null;

  // Team averages per category
  const teamAverages = data.categories.map(cat => {
    const catStats = activeUsers.map(u => u.categories.find(c => c.category_id === cat.id)).filter(Boolean) as CategoryStat[];
    const avg = catStats.length > 0 ? Math.round(catStats.reduce((s, c) => s + c.percentage, 0) / catStats.length) : 0;
    return { ...cat, avg, count: catStats.length };
  });

  return (
    <div className="space-y-6">
      {/* Top row — Team overview cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-[#272C33] rounded-xl border border-[#3a424d] p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Team Members</div>
          <div className="text-2xl font-bold text-neutral-200">{activeUsers.length}</div>
          <div className="text-xs text-neutral-500 mt-1">with scores recorded</div>
        </div>
        <div className="bg-[#272C33] rounded-xl border border-[#3a424d] p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Categories</div>
          <div className="text-2xl font-bold text-neutral-200">{data.categories.length}</div>
          <div className="text-xs text-neutral-500 mt-1">knowledge areas</div>
        </div>
        <div className="bg-[#272C33] rounded-xl border border-[#3a424d] p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Total Items</div>
          <div className="text-2xl font-bold text-neutral-200">
            {data.categories.reduce((s, _c, i) => s + (activeUsers[0]?.categories[i]?.items_count ?? 0), 0) || '-'}
          </div>
          <div className="text-xs text-neutral-500 mt-1">knowledge items tracked</div>
        </div>
        <div className="bg-[#272C33] rounded-xl border border-[#3a424d] p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Team Average</div>
          <div className={`text-2xl font-bold ${pctColor(activeUsers.length > 0 ? Math.round(activeUsers.reduce((s, u) => s + u.overall_percentage, 0) / activeUsers.length) : 0)}`}>
            {activeUsers.length > 0 ? Math.round(activeUsers.reduce((s, u) => s + u.overall_percentage, 0) / activeUsers.length) : 0}%
          </div>
          <div className="text-xs text-neutral-500 mt-1">overall completion</div>
        </div>
      </div>

      {/* Category averages */}
      <div className="bg-[#272C33] rounded-xl border border-[#3a424d] p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-4">Category Averages (Team)</h3>
        <div className="grid grid-cols-2 gap-3">
          {teamAverages.map(cat => (
            <div key={cat.id} className="flex items-center gap-3">
              <span className="text-[13px] text-neutral-300 w-44 truncate" title={cat.name}>{cat.name}</span>
              <div className="flex-1">
                <ProgressBar pct={cat.avg} />
              </div>
              <span className={`text-xs font-semibold w-10 text-right ${pctColor(cat.avg)}`}>{cat.avg}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-4">
        {/* Team leaderboard */}
        <div className="flex-1 bg-[#272C33] rounded-xl border border-[#3a424d] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#3a424d] flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Team Members</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setSortBy('overall')}
                className={`px-2 py-0.5 text-[10px] rounded ${sortBy === 'overall' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                By Score
              </button>
              <button
                onClick={() => setSortBy('name')}
                className={`px-2 py-0.5 text-[10px] rounded ${sortBy === 'name' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] font-semibold' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                By Name
              </button>
            </div>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {sortedUsers.map((u, i) => (
              <button
                key={u.user_id}
                onClick={() => setSelectedUser(selectedUser === u.user_id ? null : u.user_id)}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 border-b border-[#3a424d]/50 transition-colors ${
                  selectedUser === u.user_id ? 'bg-[#5ec1ca]/10' : 'hover:bg-[#363d47]/30'
                }`}
              >
                <span className="text-[10px] font-bold text-neutral-600 w-5 text-right">{i + 1}</span>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#5ec1ca] to-[#7c3aed] flex items-center justify-center text-white text-xs font-bold">
                  {(u.display_name || u.username).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-neutral-200 truncate">{u.display_name || u.username}</div>
                  <ProgressBar pct={u.overall_percentage} className="mt-1" />
                </div>
                <span className={`text-sm font-bold ${pctColor(u.overall_percentage)}`}>
                  {u.overall_percentage}%
                </span>
              </button>
            ))}
            {sortedUsers.length === 0 && (
              <div className="p-8 text-center text-neutral-500 text-sm">No scores recorded yet</div>
            )}
          </div>
        </div>

        {/* Selected user breakdown */}
        <div className="w-96 bg-[#272C33] rounded-xl border border-[#3a424d] overflow-hidden">
          {selectedSummary ? (
            <>
              <div className="px-4 py-3 border-b border-[#3a424d]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#5ec1ca] to-[#7c3aed] flex items-center justify-center text-white font-bold">
                    {(selectedSummary.display_name || selectedSummary.username).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-neutral-200">{selectedSummary.display_name || selectedSummary.username}</div>
                    <div className="text-xs text-neutral-500">Overall: {selectedSummary.overall_scored} / {selectedSummary.overall_possible}</div>
                  </div>
                  <span className={`ml-auto text-lg font-bold ${pctColor(selectedSummary.overall_percentage)}`}>
                    {selectedSummary.overall_percentage}%
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-3 max-h-[450px] overflow-y-auto">
                {selectedSummary.categories.map(cat => (
                  <div key={cat.category_id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] text-neutral-300">{cat.category_name}</span>
                      <span className={`text-[11px] font-semibold ${pctColor(cat.percentage)}`}>
                        {cat.total_scored}/{cat.total_possible} ({cat.percentage}%)
                      </span>
                    </div>
                    <ProgressBar pct={cat.percentage} />
                    <div className="text-[10px] text-neutral-600 mt-0.5">
                      {cat.scored_count} of {cat.items_count} items scored
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-16 text-neutral-500">
              <i className="fa-solid fa-user-check text-2xl mb-3 text-neutral-600" />
              <p className="text-sm">Select a team member</p>
              <p className="text-xs mt-1">to see their category breakdown</p>
            </div>
          )}
        </div>
      </div>

      {/* Heatmap — users × categories */}
      <div className="bg-[#272C33] rounded-xl border border-[#3a424d] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#3a424d]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Skills Heatmap</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#1e2228]">
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-400 font-bold sticky left-0 bg-[#1e2228] z-10 min-w-[160px]">
                  Team Member
                </th>
                {data.categories.map(cat => (
                  <th key={cat.id} className="px-2 py-2 text-center">
                    <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold leading-tight max-w-[80px] mx-auto" title={cat.name}>
                      {cat.name.length > 12 ? cat.name.slice(0, 11) + '...' : cat.name}
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 text-[10px] uppercase tracking-wider text-neutral-400 font-bold text-center">
                  Overall
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map(u => (
                <tr key={u.user_id} className="border-t border-[#3a424d]/50 hover:bg-[#363d47]/20">
                  <td className="px-3 py-2 text-[13px] text-neutral-200 sticky left-0 bg-[#272C33] z-10">
                    {u.display_name || u.username}
                  </td>
                  {u.categories.map(cat => (
                    <td key={cat.category_id} className="px-1 py-1 text-center">
                      <div
                        className={`inline-block w-12 py-1 rounded text-[11px] font-semibold ${pctColor(cat.percentage)}`}
                        style={{ background: cat.percentage > 0 ? `${pctBg(cat.percentage).replace('bg-', '')}` : undefined }}
                        title={`${cat.category_name}: ${cat.total_scored}/${cat.total_possible}`}
                      >
                        <span className={pctColor(cat.percentage)}>{cat.percentage}%</span>
                      </div>
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center">
                    <span className={`text-[12px] font-bold ${pctColor(u.overall_percentage)}`}>
                      {u.overall_percentage}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
