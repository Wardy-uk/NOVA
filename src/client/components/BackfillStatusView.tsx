import { useState, useEffect, useCallback } from 'react';

interface BackfillStatus {
  totalWindows: number;
  completeCount: number;
  pendingCount: number;
  failedCount: number;
  runningCount: number;
  lastCompletedAt: string | null;
  ticketsProcessed: number;
  ticketsSkipped: number;
  lastError: {
    message: string;
    date: string;
    qaType: string;
  } | null;
}

export function BackfillStatusView() {
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/backfill/status');
      const json = await res.json();
      if (json.ok) {
        setStatus(json.data);
        setError(null);
      } else {
        setError(json.error ?? 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-neutral-400 text-sm">Loading backfill status...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-lg font-semibold text-neutral-100 mb-4">QA Backfill Status</h2>
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!status) return null;

  const pct = status.totalWindows > 0
    ? Math.round((status.completeCount / status.totalWindows) * 100)
    : 0;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-neutral-100">QA Backfill Status</h2>
        <span className="text-xs text-neutral-500">Auto-refreshes every 30s</span>
      </div>

      {/* Progress bar */}
      <div className="bg-[#1E2228] rounded-lg p-5 border border-neutral-700/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-neutral-300 font-medium">Overall Progress</span>
          <span className="text-sm text-neutral-400">
            {status.completeCount.toLocaleString()} / {status.totalWindows.toLocaleString()} windows ({pct}%)
          </span>
        </div>
        <div className="w-full h-3 bg-neutral-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: pct === 100
                ? '#22c55e'
                : 'linear-gradient(90deg, #3b82f6, #22c55e)',
            }}
          />
        </div>
      </div>

      {/* Status counts grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatusCard label="Complete" value={status.completeCount} color="#22c55e" />
        <StatusCard label="Pending" value={status.pendingCount} color="#3b82f6" />
        <StatusCard label="Running" value={status.runningCount} color="#f97316" />
        <StatusCard label="Failed" value={status.failedCount} color="#ef4444" />
      </div>

      {/* Ticket stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#1E2228] rounded-lg p-5 border border-neutral-700/50">
          <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Tickets Processed</div>
          <div className="text-2xl font-bold text-neutral-100">{status.ticketsProcessed.toLocaleString()}</div>
        </div>
        <div className="bg-[#1E2228] rounded-lg p-5 border border-neutral-700/50">
          <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Tickets Skipped</div>
          <div className="text-2xl font-bold text-neutral-100">{status.ticketsSkipped.toLocaleString()}</div>
        </div>
      </div>

      {/* Last completed */}
      {status.lastCompletedAt && (
        <div className="bg-[#1E2228] rounded-lg p-5 border border-neutral-700/50">
          <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Last Completed</div>
          <div className="text-sm text-neutral-200">
            {new Date(status.lastCompletedAt).toLocaleString()}
          </div>
        </div>
      )}

      {/* Last error */}
      {status.lastError && (
        <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-5">
          <div className="text-xs text-red-400 uppercase tracking-wider mb-1">
            Last Error ({status.lastError.qaType} &mdash; {new Date(status.lastError.date).toLocaleDateString()})
          </div>
          <div className="text-sm text-red-300 font-mono whitespace-pre-wrap break-words">
            {status.lastError.message}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#1E2228] rounded-lg p-5 border border-neutral-700/50">
      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
