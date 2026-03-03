import { useState, useEffect, useCallback, useRef } from 'react';

interface SetupStep {
  id: number;
  delivery_id: number;
  step_key: string;
  step_label: string;
  status: string;
  result_message: string | null;
  executed_at: string | null;
  executed_by: number | null;
}

interface ExecutionRun {
  id: number;
  delivery_id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  started_by: number | null;
  summary: string | null;
}

interface ExecutionLog {
  id: number;
  run_id: number;
  step_key: string;
  timestamp: string;
  level: string;
  message: string;
}

interface Props {
  deliveryId: number;
  product: string;
  azdoPrUrl?: string | null;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  pending:     { color: '#6b7280', bg: 'bg-neutral-800',    icon: '\u25CB', label: 'Pending' },
  in_progress: { color: '#f59e0b', bg: 'bg-amber-900/30',  icon: '\u25D4', label: 'In Progress' },
  complete:    { color: '#22c55e', bg: 'bg-green-900/30',   icon: '\u2714', label: 'Complete' },
  failed:      { color: '#ef4444', bg: 'bg-red-900/30',     icon: '\u2718', label: 'Failed' },
  skipped:     { color: '#8b5cf6', bg: 'bg-purple-900/30',  icon: '\u2212', label: 'Skipped' },
};

const NEXT_STATUS: Record<string, string> = {
  pending: 'in_progress',
  in_progress: 'complete',
  complete: 'pending',
  failed: 'pending',
  skipped: 'pending',
};

const LOG_COLORS: Record<string, string> = {
  info: 'text-neutral-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  success: 'text-green-400',
};

export function InstanceSetupPanel({ deliveryId, product, azdoPrUrl }: Props) {
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [executing, setExecuting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [runs, setRuns] = useState<ExecutionRun[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check feature flag
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const json = await res.json();
        if (json.ok) {
          setEnabled(json.data?.feature_instance_setup === 'true');
        } else {
          setEnabled(false);
        }
      } catch { setEnabled(false); }
    })();
  }, []);

  const fetchSteps = useCallback(async () => {
    try {
      const res = await fetch(`/api/instance-setup/delivery/${deliveryId}/steps`);
      const json = await res.json();
      if (json.ok) setSteps(json.data);
    } catch { /* ignore */ }
  }, [deliveryId]);

  useEffect(() => {
    if (enabled) fetchSteps();
  }, [fetchSteps, enabled]);

  // Poll logs while a run is active
  useEffect(() => {
    if (activeRunId && executing) {
      pollRef.current = setInterval(async () => {
        try {
          const [logsRes, latestRes] = await Promise.all([
            fetch(`/api/setup-execution/runs/${activeRunId}/logs`),
            fetch(`/api/setup-execution/delivery/${deliveryId}/latest-run`),
          ]);
          const logsJson = await logsRes.json();
          if (logsJson.ok) setLogs(logsJson.data);

          const latestJson = await latestRes.json();
          if (latestJson.ok && latestJson.data) {
            const run = latestJson.data as ExecutionRun;
            if (run.status !== 'running') {
              setExecuting(false);
              fetchSteps(); // Refresh step statuses
            }
          }
        } catch { /* ignore */ }
      }, 2000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeRunId, executing, deliveryId, fetchSteps]);

  // Auto-scroll console
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Don't render until flag is checked; hide if disabled
  if (enabled === null || enabled === false) return null;

  const handleInitialize = async () => {
    setInitializing(true);
    setError(null);
    try {
      const res = await fetch(`/api/instance-setup/delivery/${deliveryId}/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product }),
      });
      const json = await res.json();
      if (json.ok) {
        setSteps(json.data);
      } else {
        setError(json.error || 'Failed to initialize');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setInitializing(false);
    }
  };

  const handleToggleStatus = async (stepKey: string, currentStatus: string) => {
    const nextStatus = NEXT_STATUS[currentStatus] || 'pending';
    setLoading(true);
    try {
      const res = await fetch(`/api/instance-setup/delivery/${deliveryId}/steps/${stepKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      const json = await res.json();
      if (json.ok) {
        setSteps(json.data);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, stepKey: string) => {
    e.preventDefault();
    const step = steps.find(s => s.step_key === stepKey);
    if (!step) return;
    const nextStatus = step.status === 'skipped' ? 'pending' : 'skipped';
    handleSetStatus(stepKey, nextStatus);
  };

  const handleSetStatus = async (stepKey: string, status: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/instance-setup/delivery/${deliveryId}/steps/${stepKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (json.ok) setSteps(json.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      await fetch(`/api/instance-setup/delivery/${deliveryId}/steps`, { method: 'DELETE' });
      setSteps([]);
    } catch { /* ignore */ }
  };

  const handleExecute = async (dryRun = false) => {
    setExecuting(true);
    setShowConsole(true);
    setLogs([]);
    setError(null);
    try {
      const endpoint = dryRun
        ? `/api/setup-execution/delivery/${deliveryId}/execute/dry-run`
        : `/api/setup-execution/delivery/${deliveryId}/execute`;
      const res = await fetch(endpoint, { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setActiveRunId(json.data.runId);
        // If dry run completes immediately, fetch logs
        if (dryRun || json.data.status !== 'running') {
          const logsRes = await fetch(`/api/setup-execution/runs/${json.data.runId}/logs`);
          const logsJson = await logsRes.json();
          if (logsJson.ok) setLogs(logsJson.data);
          setExecuting(false);
          fetchSteps();
        }
      } else {
        setError(json.error || 'Execution failed');
        setExecuting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed');
      setExecuting(false);
    }
  };

  const fetchRuns = async () => {
    try {
      const res = await fetch(`/api/setup-execution/delivery/${deliveryId}/runs`);
      const json = await res.json();
      if (json.ok) setRuns(json.data);
    } catch { /* ignore */ }
  };

  const viewRunLogs = async (runId: number) => {
    setActiveRunId(runId);
    setShowConsole(true);
    try {
      const res = await fetch(`/api/setup-execution/runs/${runId}/logs`);
      const json = await res.json();
      if (json.ok) setLogs(json.data);
    } catch { /* ignore */ }
  };

  // Progress calculation
  const total = steps.length;
  const completed = steps.filter(s => s.status === 'complete').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const progress = total > 0 ? Math.round(((completed + skipped) / total) * 100) : 0;

  // If no steps exist, show initialize button
  if (steps.length === 0) {
    return (
      <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-2">
        <span className="text-xs font-semibold text-neutral-300">Instance Setup</span>
        {error && (
          <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-[11px]">{error}</div>
        )}
        <p className="text-[11px] text-neutral-500">
          No setup steps configured for this delivery. Initialize from <span className="text-neutral-300">{product}</span> templates?
        </p>
        <button
          onClick={handleInitialize}
          disabled={initializing}
          className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
        >
          {initializing ? 'Initializing...' : 'Initialize Setup Steps'}
        </button>
      </div>
    );
  }

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300">Instance Setup</span>
        <div className="flex items-center gap-2">
          {azdoPrUrl && (
            <a
              href={azdoPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-colors"
            >
              AzDO PR
            </a>
          )}
          <span className="text-[10px] text-neutral-500">
            {completed}/{total} complete{skipped > 0 ? ` (${skipped} skipped)` : ''} — {progress}%
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-[#1f242b] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progress}%`,
            backgroundColor: progress === 100 ? '#22c55e' : progress > 50 ? '#5ec1ca' : '#f59e0b',
          }}
        />
      </div>

      {error && (
        <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-[10px]">{error}</div>
      )}

      {/* Step list */}
      <div className="space-y-0.5">
        {steps.map((step) => {
          const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
          return (
            <div
              key={step.step_key}
              className={`flex items-center gap-2 px-2 py-1.5 rounded ${cfg.bg} transition-colors group cursor-pointer`}
              onClick={() => !loading && !executing && handleToggleStatus(step.step_key, step.status)}
              onContextMenu={(e) => handleContextMenu(e, step.step_key)}
              title={`Click to cycle status. Right-click to skip.\n${step.result_message || ''}`}
            >
              <span
                className="w-4 h-4 flex items-center justify-center text-xs shrink-0 font-bold"
                style={{ color: cfg.color }}
              >
                {cfg.icon}
              </span>
              <span className={`text-[11px] flex-1 ${step.status === 'complete' ? 'line-through text-neutral-500' : step.status === 'skipped' ? 'text-neutral-500 italic' : 'text-neutral-200'}`}>
                {step.step_label}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded shrink-0 opacity-60" style={{ color: cfg.color }}>
                {cfg.label}
              </span>
              {step.executed_at && (
                <span className="text-[9px] text-neutral-600 shrink-0">
                  {new Date(step.executed_at).toLocaleDateString('en-GB')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Execution Console */}
      {showConsole && (
        <div className="border border-[#3a424d] rounded bg-[#0d1117] p-2 space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-neutral-300">Console</span>
              {executing && (
                <span className="text-[9px] text-amber-400 animate-pulse">Running...</span>
              )}
            </div>
            <button
              onClick={() => { setShowConsole(false); setLogs([]); }}
              className="text-[9px] text-neutral-500 hover:text-neutral-300"
            >
              Close
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto font-mono text-[9px] space-y-px">
            {logs.length === 0 && !executing && (
              <div className="text-neutral-600">No logs yet.</div>
            )}
            {logs.map((log) => (
              <div key={log.id} className={`${LOG_COLORS[log.level] || 'text-neutral-400'}`}>
                <span className="text-neutral-600">{log.timestamp?.slice(11, 19) || ''}</span>
                {' '}
                <span className="text-neutral-500">[{log.step_key}]</span>
                {' '}
                {log.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-[#3a424d] flex-wrap">
        <button
          onClick={() => handleExecute(false)}
          disabled={executing}
          className="px-3 py-1 text-[10px] rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
        >
          {executing ? 'Executing...' : 'Execute Setup'}
        </button>
        <button
          onClick={() => handleExecute(true)}
          disabled={executing}
          className="px-3 py-1 text-[10px] rounded border border-[#5ec1ca] text-[#5ec1ca] hover:bg-[#5ec1ca]/10 disabled:opacity-50 transition-colors"
        >
          Dry Run
        </button>
        <button
          onClick={handleReset}
          className="text-[10px] text-neutral-500 hover:text-red-400 transition-colors"
        >
          Reset All
        </button>
        <button
          onClick={() => handleInitialize()}
          className="text-[10px] text-neutral-500 hover:text-[#5ec1ca] transition-colors"
        >
          Re-initialize
        </button>
        <button
          onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchRuns(); }}
          className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors ml-auto"
        >
          {showHistory ? 'Hide History' : 'History'}
        </button>
      </div>

      {/* Run History */}
      {showHistory && (
        <div className="space-y-1">
          {runs.length === 0 && (
            <div className="text-[10px] text-neutral-600">No previous runs.</div>
          )}
          {runs.map((run) => {
            const statusColor = run.status === 'complete' ? 'text-green-400'
              : run.status === 'failed' ? 'text-red-400'
              : run.status === 'running' ? 'text-amber-400'
              : 'text-neutral-400';
            return (
              <div
                key={run.id}
                className="flex items-center gap-2 px-2 py-1 rounded bg-[#1f242b] cursor-pointer hover:bg-[#272C33] transition-colors"
                onClick={() => viewRunLogs(run.id)}
              >
                <span className={`text-[9px] font-semibold ${statusColor}`}>{run.status}</span>
                <span className="text-[9px] text-neutral-500 flex-1">{run.summary || ''}</span>
                <span className="text-[9px] text-neutral-600">
                  {run.started_at ? new Date(run.started_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
