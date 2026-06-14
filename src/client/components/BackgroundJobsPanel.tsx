import { useState, useEffect } from 'react';

interface Job {
  id: string;
  name: string;
  intervalMs: number;
  lastRun: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
  enabled: boolean;
  running: boolean;
}

export function BackgroundJobsPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningJob, setRunningJob] = useState<string | null>(null);

  const fetchJobs = async () => {
    try {
      const r = await fetch('/api/admin/jobs', {
        headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` },
      });
      const data = await r.json();
      if (data.ok) setJobs(data.data ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchJobs(); }, []);

  const toggleJob = async (id: string, enabled: boolean) => {
    const action = enabled ? 'stop' : 'start';
    await fetch(`/api/admin/jobs/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` },
    });
    fetchJobs();
  };

  const runNow = async (id: string) => {
    setRunningJob(id);
    await fetch(`/api/admin/jobs/${id}/run-now`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` },
    });
    setRunningJob(null);
    fetchJobs();
  };

  const formatInterval = (ms: number) => {
    if (ms >= 3600000) return `${(ms / 3600000).toFixed(0)}h`;
    if (ms >= 60000) return `${(ms / 60000).toFixed(0)}m`;
    return `${(ms / 1000).toFixed(0)}s`;
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) return <div className="text-neutral-400 text-sm p-4">Loading jobs...</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-neutral-400">{jobs.length} registered jobs</span>
        <button onClick={fetchJobs} className="px-2 py-1 bg-[#2f353d] text-neutral-400 text-xs rounded hover:bg-[#3a424d]">
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#3a424d]">
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Job</th>
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Interval</th>
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Last Run</th>
              <th className="text-left py-2 px-2 text-neutral-400 font-medium">Duration</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Runs</th>
              <th className="text-right py-2 px-2 text-neutral-400 font-medium">Errors</th>
              <th className="text-center py-2 px-2 text-neutral-400 font-medium">Status</th>
              <th className="text-center py-2 px-2 text-neutral-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(job => (
              <tr key={job.id} className="border-b border-[#3a424d]/50 hover:bg-[#2f353d]/50">
                <td className="py-2 px-2">
                  <div className="text-neutral-200">{job.name}</div>
                  <div className="text-neutral-500 font-mono">{job.id}</div>
                </td>
                <td className="py-2 px-2 text-neutral-300">{formatInterval(job.intervalMs)}</td>
                <td className="py-2 px-2 text-neutral-400">
                  {job.lastRun ? new Date(job.lastRun).toLocaleTimeString() : 'Never'}
                </td>
                <td className="py-2 px-2 text-neutral-400">{formatDuration(job.lastDurationMs)}</td>
                <td className="py-2 px-2 text-right text-neutral-300">{job.runCount}</td>
                <td className="py-2 px-2 text-right">
                  <span className={job.errorCount > 0 ? 'text-red-400' : 'text-neutral-500'}>
                    {job.errorCount}
                  </span>
                </td>
                <td className="py-2 px-2 text-center">
                  {job.running ? (
                    <span className="text-amber-400">Running</span>
                  ) : job.enabled ? (
                    <span className="text-green-400">Active</span>
                  ) : (
                    <span className="text-neutral-500">Paused</span>
                  )}
                </td>
                <td className="py-2 px-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => toggleJob(job.id, job.enabled)}
                      className={`px-2 py-0.5 rounded text-xs ${
                        job.enabled
                          ? 'bg-red-900/30 text-red-400 hover:bg-red-900/40'
                          : 'bg-green-900/30 text-green-400 hover:bg-green-900/40'
                      }`}
                    >
                      {job.enabled ? 'Pause' : 'Start'}
                    </button>
                    <button
                      onClick={() => runNow(job.id)}
                      disabled={runningJob === job.id || job.running}
                      className="px-2 py-0.5 rounded text-xs bg-[#5ec1ca]/20 text-[#5ec1ca] hover:bg-[#5ec1ca]/30 disabled:opacity-50"
                    >
                      {runningJob === job.id ? '...' : 'Run'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {jobs.some(j => j.lastError) && (
        <div className="mt-3 bg-red-900/20 rounded-lg p-3">
          <h4 className="text-xs font-medium text-red-400 mb-2">Recent Errors</h4>
          {jobs.filter(j => j.lastError).map(j => (
            <div key={j.id} className="text-xs text-neutral-400 mb-1">
              <span className="text-neutral-300">{j.name}:</span> {j.lastError}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
