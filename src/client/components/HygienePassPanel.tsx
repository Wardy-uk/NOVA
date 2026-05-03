import { useState, useEffect, useCallback, useRef } from 'react';

interface FlaggedTicket {
  ticketKey: string;
  failedChecks: string[];
  detail: string;
  flaggedAt: string;
  resolved: boolean;
}

interface HygieneStatus {
  lastPassAt: string | null;
  lastPassHourBlock: string | null;
  flaggedTickets: FlaggedTicket[];
  passesTodayCount: number;
  compliancePercent: number;
  hygieneDue: boolean;
}

interface HygienePassResult {
  ticketCount: number;
  passedCount: number;
  failedTickets: Array<{
    ticketKey: string;
    checks: Array<{ id: string; label: string; passed: boolean; detail?: string }>;
    failCount: number;
  }>;
}

interface Props {
  onOpenTicket: (ticketKey: string) => void;
  onAction: (ticketKey: string, checkId: string) => void;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

const CHECK_SEVERITY: Record<string, 'red' | 'amber'> = {
  sla_risk: 'red',
  next_update_overdue: 'red',
  status_accurate: 'amber',
  customer_waiting: 'amber',
  chase_cadence: 'amber',
  assigned_correctly: 'amber',
};

const CHECK_LABELS: Record<string, string> = {
  status_accurate: 'Status',
  customer_waiting: 'Waiting',
  next_update_overdue: 'Overdue',
  sla_risk: 'SLA',
  chase_cadence: 'Chase',
  assigned_correctly: 'Assign',
};

function CheckTag({ checkId }: { checkId: string }) {
  const severity = CHECK_SEVERITY[checkId] ?? 'amber';
  const label = CHECK_LABELS[checkId] ?? checkId;
  const cls = severity === 'red'
    ? 'bg-red-900/40 text-red-400 border-red-800/40'
    : 'bg-amber-900/40 text-amber-400 border-amber-800/40';
  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${cls}`}>
      {label}
    </span>
  );
}

export function HygienePassPanel({ onOpenTicket, onAction }: Props) {
  const [status, setStatus] = useState<HygieneStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<HygienePassResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllPassed, setShowAllPassed] = useState(false);
  const passStartRef = useRef<number | null>(null);
  const [overrun, setOverrun] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/hygiene/status', { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) setStatus(json.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (!passStartRef.current) return;
    const timer = setTimeout(() => {
      if (passStartRef.current && Date.now() - passStartRef.current > 10 * 60_000) {
        setOverrun(true);
      }
    }, 10 * 60_000);
    return () => clearTimeout(timer);
  }, [running]);

  const runPass = async () => {
    setRunning(true);
    setError(null);
    setLastResult(null);
    setOverrun(false);
    passStartRef.current = Date.now();
    try {
      const res = await fetch('/api/agent/hygiene/run', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json();
      if (json.ok) {
        setLastResult(json.data);
        if (json.data.failedTickets.length === 0) {
          setShowAllPassed(true);
          setTimeout(() => setShowAllPassed(false), 5000);
        }
        fetchStatus();
      } else {
        setError(json.error ?? 'Failed to run hygiene pass');
      }
    } catch {
      setError('Network error');
    } finally {
      setRunning(false);
      passStartRef.current = null;
    }
  };

  const dismiss = async (ticketKey: string, resolution: 'actioned' | 'deferred' | 'false_positive') => {
    try {
      await fetch('/api/agent/hygiene/dismiss', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ticketKey, resolution }),
      });
      fetchStatus();
    } catch { /* silent */ }
  };

  if (!status) return null;

  const hasFlagged = status.flaggedTickets.length > 0;
  const showDueBanner = status.hygieneDue && !running && !hasFlagged && !showAllPassed;

  // All passed flash
  if (showAllPassed && lastResult) {
    return (
      <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-4 py-3 flex items-center gap-3">
        <span className="text-emerald-400 text-lg">&#10003;</span>
        <span className="text-sm text-emerald-300">
          All {lastResult.ticketCount} tickets passed hygiene checks
        </span>
        <span className="text-[10px] text-neutral-500 ml-auto">
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    );
  }

  // Running state
  if (running) {
    return (
      <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg px-4 py-3 flex items-center gap-3">
        <div className="w-4 h-4 border-2 border-[#5ec1ca] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-neutral-300">Running hygiene checks...</span>
      </div>
    );
  }

  // Due banner
  if (showDueBanner) {
    return (
      <div className="bg-[#2f353d] border border-amber-800/40 rounded-lg px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 text-sm">&#9888;</span>
          <span className="text-sm text-neutral-300">Hourly hygiene check due</span>
        </div>
        <button
          onClick={runPass}
          className="px-3 py-1.5 text-xs bg-[#5ec1ca] text-[#0f172a] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors"
        >
          Run Hygiene Pass
        </button>
      </div>
    );
  }

  // Flagged tickets
  if (hasFlagged) {
    return (
      <div className="space-y-2">
        {overrun && (
          <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg px-4 py-2 text-xs text-amber-400">
            Hygiene pass taking &gt;10 minutes. Your queue may be too large or statuses may be inaccurate.
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {status.flaggedTickets.map(ticket => (
          <div
            key={ticket.ticketKey}
            className="bg-[#2f353d] border border-[#3a424d] rounded-lg px-4 py-3"
          >
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => onOpenTicket(ticket.ticketKey)}
                className="text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors"
              >
                {ticket.ticketKey}
              </button>
              <div className="flex items-center gap-1.5">
                {ticket.failedChecks.map(checkId => (
                  <CheckTag key={checkId} checkId={checkId} />
                ))}
              </div>
            </div>
            <p className="text-[11px] text-neutral-400 mb-3">{ticket.detail}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const primaryCheck = ticket.failedChecks[0];
                  onAction(ticket.ticketKey, primaryCheck);
                }}
                className="px-2.5 py-1 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
              >
                Action
              </button>
              <button
                onClick={() => dismiss(ticket.ticketKey, 'actioned')}
                className="px-2.5 py-1 text-[11px] bg-[#272C33] hover:bg-[#2A2F38] text-neutral-400 rounded-lg transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={runPass}
          className="w-full px-3 py-1.5 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Re-run hygiene pass
        </button>
      </div>
    );
  }

  // No flags, not due — quiet state
  if (status.lastPassAt) {
    const passTime = new Date(status.lastPassAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return (
      <div className="text-xs text-neutral-600 px-3 py-2 flex items-center justify-between">
        <span>Last hygiene pass: {passTime} — all clear</span>
        <button
          onClick={runPass}
          className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Run again
        </button>
      </div>
    );
  }

  return null;
}
