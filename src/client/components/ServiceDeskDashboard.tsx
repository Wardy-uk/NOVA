import { useState, useEffect } from 'react';

interface DashboardData {
  totalOpen: number;
  slaBreached: number;
  overdueUpdates: number;
  distinctCustomers: number;
  avgAgeDays: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byAssignee: Array<{ name: string; count: number }>;
}

export function ServiceDeskDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/tasks/service-desk/dashboard')
      .then(r => r.json())
      .then(json => {
        if (json.ok) setData(json.data);
        else setError(json.error ?? 'Failed to load dashboard');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading dashboard...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-400 py-8 text-center">{error}</div>;
  }
  if (!data) return null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <KpiCard value={data.totalOpen} label="Total Open" color="#5ec1ca" />
        <KpiCard value={data.slaBreached} label="SLA Breached" color={data.slaBreached > 0 ? '#ef4444' : '#22c55e'} />
        <KpiCard value={data.overdueUpdates} label="Overdue Updates" color={data.overdueUpdates > 0 ? '#f59e0b' : '#22c55e'} />
        <KpiCard value={data.distinctCustomers} label="Customers" color="#5ec1ca" />
        <KpiCard value={data.avgAgeDays} label="Avg Age (days)" color="#5ec1ca" suffix="d" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Priority Breakdown */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">By Priority</h3>
          <div className="space-y-2">
            {Object.entries(data.byPriority).map(([prio, count]) => (
              <div key={prio} className="flex items-center gap-3">
                <span className={`text-xs font-semibold w-16 ${
                  prio === 'High' ? 'text-red-400' : prio === 'Medium' ? 'text-amber-400' : 'text-green-400'
                }`}>{prio}</span>
                <div className="flex-1 bg-[#272C33] rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${data.totalOpen > 0 ? (count / data.totalOpen) * 100 : 0}%`,
                      backgroundColor: prio === 'High' ? '#ef4444' : prio === 'Medium' ? '#f59e0b' : '#22c55e',
                    }}
                  />
                </div>
                <span className="text-xs text-neutral-400 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">By Status</h3>
          <div className="space-y-2">
            {Object.entries(data.byStatus)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => (
                <div key={status} className="flex items-center justify-between text-xs">
                  <span className="text-neutral-300 capitalize">{status.replace(/_/g, ' ')}</span>
                  <span className="text-neutral-400 font-mono">{count}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Assignee Breakdown */}
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#3a424d]">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">By Assignee</h3>
        </div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-4 py-2 font-medium">Assignee</th>
              <th className="px-4 py-2 font-medium text-right">Tickets</th>
              <th className="px-4 py-2 font-medium w-1/3">Load</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {data.byAssignee.map(a => (
              <tr key={a.name} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2 text-neutral-200">{a.name}</td>
                <td className="px-4 py-2 text-neutral-400 text-right font-mono">{a.count}</td>
                <td className="px-4 py-2">
                  <div className="bg-[#272C33] rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${data.totalOpen > 0 ? (a.count / data.totalOpen) * 100 : 0}%`,
                        backgroundColor: a.count >= 6 ? '#ef4444' : a.count >= 3 ? '#f59e0b' : '#22c55e',
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.byAssignee.length === 0 && (
          <div className="text-center py-4 text-xs text-neutral-500">No assignee data</div>
        )}
      </div>
    </div>
  );
}

function KpiCard({ value, label, color, suffix }: { value: number; label: string; color: string; suffix?: string }) {
  return (
    <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#2f353d]">
      <div className="text-3xl font-bold font-[var(--font-heading)]" style={{ color }}>
        {value}{suffix ?? ''}
      </div>
      <div className="text-[11px] text-neutral-500 uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}
