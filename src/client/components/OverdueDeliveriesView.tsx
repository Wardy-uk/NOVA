import { useState, useEffect, useCallback } from 'react';

interface OverdueDelivery {
  delivery_id: number;
  onboarding_id: string | null;
  account: string;
  product: string;
  onboarder: string | null;
  status: string;
  go_live_date: string | null;
  overdue_count: number;
  total_count: number;
  complete_count: number;
  oldest_overdue_name: string;
  oldest_overdue_date: string;
}

function daysLate(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

export function OverdueDeliveriesView() {
  const [data, setData] = useState<OverdueDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    fetch('/api/milestones/overdue-deliveries')
      .then(r => r.json())
      .then(json => {
        if (json.ok) setData(json.data);
        else setError(json.error ?? 'Failed to load overdue deliveries');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener('nova-refresh', handler);
    return () => window.removeEventListener('nova-refresh', handler);
  }, [loadData]);

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading overdue deliveries...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-400 py-8 text-center">{error}</div>;
  }

  const totalOverdueMilestones = data.reduce((sum, d) => sum + d.overdue_count, 0);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Deliveries With Overdue</div>
          <div className="text-xl font-bold text-red-400">{data.length}</div>
        </div>
        <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Total Overdue Milestones</div>
          <div className="text-xl font-bold text-red-400">{totalOverdueMilestones}</div>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-neutral-500 py-8 text-center">No overdue milestones — all on track.</div>
      ) : (
        <div className="border border-[#3a424d] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-[10px]">
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-left px-3 py-2">Onboarder</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-center px-3 py-2">Overdue</th>
                <th className="text-center px-3 py-2">Progress</th>
                <th className="text-left px-3 py-2">Oldest Overdue Milestone</th>
                <th className="text-right px-3 py-2">Days Late</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {data.map((d) => {
                const late = d.oldest_overdue_date ? daysLate(d.oldest_overdue_date) : 0;
                return (
                  <tr key={d.delivery_id} className="bg-[#2f353d] hover:bg-[#363d47] transition-colors">
                    <td className="px-3 py-2 text-neutral-400 font-mono">{d.onboarding_id ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 font-medium">{d.account}</td>
                    <td className="px-3 py-2 text-neutral-400">{d.product}</td>
                    <td className="px-3 py-2 text-neutral-400">{d.onboarder ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#272C33] text-neutral-400">
                        {d.status || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-900/50 text-red-400">
                        {d.overdue_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-neutral-500">
                      {d.complete_count}/{d.total_count}
                    </td>
                    <td className="px-3 py-2 text-neutral-300">
                      <div>{d.oldest_overdue_name}</div>
                      <div className="text-[10px] text-neutral-600">
                        due {d.oldest_overdue_date}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-bold ${late >= 14 ? 'text-red-400' : late >= 7 ? 'text-amber-400' : 'text-yellow-500'}`}>
                        {late}d
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
