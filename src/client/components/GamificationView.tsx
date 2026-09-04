import { useCallback, useEffect, useState } from 'react';

// Rewards scheme — private preview.
//
// Visible only to the configured owner (see `gamification_owner`); the API returns
// 404 to everyone else, so this view being reachable is not what protects it.
//
// Standings are split CC vs Technical because the two cohorts are held to different
// targets — a single table would rank work that is not comparable.

interface Standing {
  agentName: string; cohort: 'cc' | 'technical';
  seasonPoints: number; lifetimePoints: number; awards: number; badges: string[];
}
interface Achievement {
  key: string; name: string; icon: string; description: string;
  points: number; cadence: 'once' | 'daily' | 'weekly';
  tier: 'small' | 'mid' | 'large'; target?: Record<string, number>;
}
interface Reward {
  id: number; name: string; description: string | null;
  tier: string; cost_points: number; stock: number | null;
}
interface Redemption {
  id: number; agent_name: string; reward_name: string; tier: string;
  cost_points: number; status: string; requested_at: string; decided_by: string | null;
}

const TIER_LABEL: Record<string, string> = {
  small: 'Small · voucher scale',
  mid: 'Mid · WFH day / early finish',
  large: 'Large · Perkbox scale',
};
const TIER_COLOR: Record<string, string> = { small: '#5ec1ca', mid: '#f59e0b', large: '#a78bfa' };

export function GamificationView() {
  const [standings, setStandings] = useState<Standing[]>([]);
  const [season, setSeason] = useState<{ name: string; starts_on: string } | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [newReward, setNewReward] = useState({ name: '', description: '', tier: 'small', cost_points: '' });

  const load = useCallback(async () => {
    try {
      const [s, a, r, d] = await Promise.all([
        fetch('/api/gamification/standings').then(x => x.json()),
        fetch('/api/gamification/achievements').then(x => x.json()),
        fetch('/api/gamification/rewards').then(x => x.json()),
        fetch('/api/gamification/redemptions').then(x => x.json()),
      ]);
      if (!s.ok) { setDenied(true); return; }
      setStandings(s.data?.rows ?? []);
      setSeason(s.data?.season ?? null);
      setAchievements(a.data ?? []);
      setRewards(r.data ?? []);
      setRedemptions(d.data ?? []);
    } catch { /* leave as-is */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addReward = async () => {
    if (!newReward.name.trim()) return;
    await fetch('/api/gamification/rewards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newReward, cost_points: Number(newReward.cost_points) || 0 }),
    });
    setNewReward({ name: '', description: '', tier: 'small', cost_points: '' });
    load();
  };

  const decide = async (id: number, decision: string) => {
    await fetch(`/api/gamification/redemptions/${id}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    load();
  };

  const resetSeason = async () => {
    if (!confirm('Wipe every award and redemption and start a fresh season? This cannot be undone.')) return;
    const r = await fetch('/api/gamification/season/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' }),
    }).then(x => x.json());
    setMsg(r.ok ? `Cleared ${r.data.cleared} awards · new season "${r.data.season}"` : (r.error ?? 'Reset failed'));
    load();
  };

  if (loading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (denied) return <div className="p-6 text-slate-400">Not available.</div>;

  const cohort = (c: 'cc' | 'technical') => standings.filter(s => s.cohort === c);
  const byKey = new Map(achievements.map(a => [a.key, a]));

  const Table = ({ title, rows }: { title: string; rows: Standing[] }) => (
    <div className="flex-1 min-w-[320px]">
      <h3 className="text-xs uppercase tracking-wide text-teal-400 mb-2">{title}</h3>
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-white/[0.03]">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">#</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Agent</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase text-slate-400">Season</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase text-slate-400">Lifetime</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Badges</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.agentName} className="border-t border-white/5">
                <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                <td className="px-3 py-2">{s.agentName}</td>
                <td className="px-3 py-2 text-right font-bold text-teal-300">{s.seasonPoints}</td>
                <td className="px-3 py-2 text-right text-slate-400">{s.lifetimePoints}</td>
                <td className="px-3 py-2">
                  {s.badges.map(b => (
                    <span key={b} title={byKey.get(b)?.name ?? b} className="mr-1">{byKey.get(b)?.icon ?? '•'}</span>
                  ))}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">Nothing earned yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold">Rewards <span className="text-sm font-normal text-amber-400">· private preview</span></h1>
          <p className="text-xs text-slate-500 mt-1">
            {season ? `${season.name} · running since ${season.starts_on}` : 'No season yet'} ·
            {' '}visible only to you; the API returns 404 to everyone else
          </p>
        </div>
        <button onClick={resetSeason} className="px-3 py-1.5 text-sm rounded-lg bg-red-900/40 border border-red-700/50 hover:bg-red-900/60">
          Reset to zero
        </button>
      </div>
      {msg && <div className="my-3 p-3 rounded-lg bg-white/[0.06] border border-white/10 text-sm">{msg}</div>}

      <p className="text-xs text-slate-500 my-4">
        Points accrue automatically each morning over completed days — today is never scored, because awarding off a
        partial day means taking it back. Badges are permanent; season points reset. Nothing is issued automatically:
        redemptions below are requests for you to approve.
      </p>

      <div className="flex flex-wrap gap-6 mb-8">
        <Table title="Customer Care" rows={cohort('cc')} />
        <Table title="Technical (T2 / Digital Design)" rows={cohort('technical')} />
      </div>

      <h3 className="text-xs uppercase tracking-wide text-teal-400 mb-2">How points are earned</h3>
      <div className="rounded-xl border border-white/10 overflow-hidden mb-8">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-white/[0.03]">
            <tr>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">Achievement</th>
              <th className="px-3 py-2 text-left text-[11px] uppercase text-slate-400">How often</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase text-slate-400">Points</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase text-slate-400">CC target</th>
              <th className="px-3 py-2 text-right text-[11px] uppercase text-slate-400">Tech target</th>
            </tr>
          </thead>
          <tbody>
            {achievements.map(a => (
              <tr key={a.key} className="border-t border-white/5">
                <td className="px-3 py-2">
                  <span className="mr-2">{a.icon}</span>{a.name}
                  <span className="text-slate-500 text-xs ml-2">{a.description}</span>
                </td>
                <td className="px-3 py-2 text-slate-400 capitalize">{a.cadence === 'once' ? 'Once' : a.cadence}</td>
                <td className="px-3 py-2 text-right font-semibold" style={{ color: TIER_COLOR[a.tier] }}>{a.points}</td>
                <td className="px-3 py-2 text-right text-slate-400">{a.target?.cc ?? '—'}</td>
                <td className="px-3 py-2 text-right text-slate-400">{a.target?.technical ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="text-xs uppercase tracking-wide text-teal-400 mb-2">Reward catalogue</h3>
      <p className="text-xs text-slate-500 mb-3">
        Prizes are data, not code — set them here once leadership has agreed them. A reward priced at 0 points is
        listed but cannot be claimed, so it can be drafted before it is signed off.
      </p>
      <div className="rounded-xl border border-white/10 overflow-hidden mb-3">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {rewards.map(r => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-3 py-2">{r.name}<span className="text-slate-500 text-xs ml-2">{r.description}</span></td>
                <td className="px-3 py-2 text-xs" style={{ color: TIER_COLOR[r.tier] }}>{TIER_LABEL[r.tier] ?? r.tier}</td>
                <td className="px-3 py-2 text-right">{r.cost_points > 0 ? `${r.cost_points} pts` : <span className="text-slate-500">unpriced</span>}</td>
              </tr>
            ))}
            {!rewards.length && <tr><td className="px-3 py-6 text-center text-slate-500">No rewards defined yet</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 mb-8">
        <input value={newReward.name} onChange={e => setNewReward({ ...newReward, name: e.target.value })}
          placeholder="Reward name (e.g. £5 Starbucks)" className="px-2 py-1.5 text-sm rounded-lg bg-white/[0.06] border border-white/10 flex-1 min-w-[200px]" />
        <select value={newReward.tier} onChange={e => setNewReward({ ...newReward, tier: e.target.value })}
          className="px-2 py-1.5 text-sm rounded-lg bg-white/[0.06] border border-white/10">
          <option value="small">Small</option><option value="mid">Mid</option><option value="large">Large</option>
        </select>
        <input value={newReward.cost_points} onChange={e => setNewReward({ ...newReward, cost_points: e.target.value })}
          placeholder="Points (0 = unpriced)" className="px-2 py-1.5 text-sm rounded-lg bg-white/[0.06] border border-white/10 w-40" />
        <button onClick={addReward} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-500">Add</button>
      </div>

      <h3 className="text-xs uppercase tracking-wide text-teal-400 mb-2">Redemption requests</h3>
      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {redemptions.map(r => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="px-3 py-2">{r.agent_name}</td>
                <td className="px-3 py-2 text-slate-400">{r.reward_name}</td>
                <td className="px-3 py-2 text-right text-slate-400">{r.cost_points} pts</td>
                <td className="px-3 py-2 text-xs capitalize text-slate-400">{r.status}</td>
                <td className="px-3 py-2 text-right">
                  {r.status === 'requested' && (
                    <>
                      <button onClick={() => decide(r.id, 'approved')} className="px-2 py-1 text-xs rounded bg-emerald-700/50 hover:bg-emerald-700 mr-1">Approve</button>
                      <button onClick={() => decide(r.id, 'rejected')} className="px-2 py-1 text-xs rounded bg-red-900/40 hover:bg-red-900/70">Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!redemptions.length && <tr><td className="px-3 py-6 text-center text-slate-500">No requests</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
