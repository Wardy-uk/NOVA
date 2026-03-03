import { useState, useEffect, useCallback } from 'react';

/** Feature flag — panel renders nothing if disabled in settings */
function useFeatureFlag(flag: string): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(json => {
        if (json.ok) setEnabled(json.data?.[flag] === 'true');
        else setEnabled(false);
      })
      .catch(() => setEnabled(false));
  }, [flag]);
  return enabled;
}

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

interface Props {
  deliveryId: number;
  product: string;
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

export function InstanceSetupPanel({ deliveryId, product }: Props) {
  const featureEnabled = useFeatureFlag('feature_instance_setup');
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  const fetchSteps = useCallback(async () => {
    if (featureEnabled !== true) return;
    try {
      const res = await fetch(`/api/instance-setup/delivery/${deliveryId}/steps`);
      const json = await res.json();
      if (json.ok) setSteps(json.data);
    } catch { /* ignore */ }
  }, [deliveryId, featureEnabled]);

  useEffect(() => {
    fetchSteps();
  }, [fetchSteps]);

  // Feature flag: render nothing if disabled or still loading
  if (featureEnabled !== true) return null;

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
    // Right-click cycles: skip / fail
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
        <span className="text-[10px] text-neutral-500">
          {completed}/{total} complete{skipped > 0 ? ` (${skipped} skipped)` : ''} — {progress}%
        </span>
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

      {/* Step list */}
      <div className="space-y-0.5">
        {steps.map((step) => {
          const cfg = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
          return (
            <div
              key={step.step_key}
              className={`flex items-center gap-2 px-2 py-1.5 rounded ${cfg.bg} transition-colors group cursor-pointer`}
              onClick={() => !loading && handleToggleStatus(step.step_key, step.status)}
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

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-[#3a424d]">
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
      </div>
    </div>
  );
}
