import { useState, useEffect } from 'react';

interface WorkloadEntry {
  userId: number;
  name: string;
  activeDeliveries: number;
  pendingMilestones: number;
  overdueMilestones: number;
}

function loadCell(value: number): string {
  if (value >= 6) return 'text-red-400 bg-red-900/30';
  if (value >= 3) return 'text-amber-400 bg-amber-900/30';
  if (value > 0) return 'text-green-400 bg-green-900/30';
  return 'text-neutral-600 bg-transparent';
}

export function TeamWorkloadView() {
  const [data, setData] = useState<WorkloadEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/team/workload')
      .then(r => r.json())
      .then(json => { if (json.ok) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading team workload...</div>;
  }

  if (data.length === 0) {
    return <div className="text-sm text-neutral-500 py-8 text-center">No team members with active work found.</div>;
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="text-xs text-neutral-500">
        Team members with active deliveries or milestones
      </div>

      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-4 py-2.5 font-medium">Team Member</th>
              <th className="px-4 py-2.5 font-medium text-center">Active Deliveries</th>
              <th className="px-4 py-2.5 font-medium text-center">Pending Milestones</th>
              <th className="px-4 py-2.5 font-medium text-center">Overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {data.map(entry => (
              <tr key={entry.userId} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2.5 text-neutral-200 font-medium">{entry.name}</td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`inline-block min-w-[28px] px-2 py-0.5 rounded font-mono font-semibold ${loadCell(entry.activeDeliveries)}`}>
                    {entry.activeDeliveries}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`inline-block min-w-[28px] px-2 py-0.5 rounded font-mono font-semibold ${loadCell(entry.pendingMilestones)}`}>
                    {entry.pendingMilestones}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span className={`inline-block min-w-[28px] px-2 py-0.5 rounded font-mono font-semibold ${entry.overdueMilestones > 0 ? 'text-red-400 bg-red-900/30' : 'text-neutral-600'}`}>
                    {entry.overdueMilestones}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-900/30 border border-green-800" /> 1-2</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-900/30 border border-amber-800" /> 3-5</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-900/30 border border-red-800" /> 6+</span>
      </div>
    </div>
  );
}
