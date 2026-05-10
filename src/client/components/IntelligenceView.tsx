import { useState, useEffect, useCallback } from 'react';

interface Signal {
  id: number; signal_type: string; component: string | null; title: string | null;
  detail: string | null; ticket_count: number | null; customer_count: number | null;
  trend: string | null; recommendation: string | null;
  period_start: string | null; period_end: string | null; generated_at: string;
  owner?: string | null; status?: string | null; jira_ticket_key?: string | null;
  outcome?: string | null; volume_after?: number | null;
}

interface Report {
  bug_impact: Signal[];
  feature_demand: Signal[];
  recurring_issues: Signal[];
  period: { start: string | null; end: string | null };
}

interface NovaUser { id: number; username: string; display_name: string | null }

const api = async (path: string, method = 'GET', body?: unknown) => {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${localStorage.getItem('token')}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`/api/cross-functional${path}`, opts);
  return r.json();
};

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  acknowledged: 'bg-yellow-500/20 text-yellow-400',
  in_progress: 'bg-indigo-500/20 text-indigo-400',
  resolved: 'bg-green-500/20 text-green-400',
  dismissed: 'bg-zinc-500/20 text-zinc-400',
};

function SignalCard({ signal, users, onUpdate }: { signal: Signal; users: NovaUser[]; onUpdate: () => void }) {
  const [assigning, setAssigning] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  const [outcomeText, setOutcomeText] = useState('');
  const [showOutcome, setShowOutcome] = useState(false);

  const trendIcon = (t: string | null) => {
    switch (t) {
      case 'increasing': return { symbol: '↑', color: 'text-red-400' };
      case 'decreasing': return { symbol: '↓', color: 'text-green-400' };
      default: return { symbol: '→', color: 'text-neutral-400' };
    }
  };

  const trend = trendIcon(signal.trend);
  const status = signal.status ?? 'new';

  const assignOwner = async (owner: string) => {
    setAssigning(true);
    await api(`/${signal.id}/assign`, 'PUT', { owner });
    onUpdate();
    setAssigning(false);
  };

  const updateStatus = async (newStatus: string, outcome?: string) => {
    await api(`/${signal.id}/status`, 'PUT', { status: newStatus, outcome });
    onUpdate();
  };

  const dismiss = async () => {
    await api(`/${signal.id}/dismiss`, 'PUT', { reason: dismissReason || 'No reason' });
    setShowDismiss(false);
    onUpdate();
  };

  const impactReduction = signal.volume_after != null && signal.ticket_count != null
    ? signal.ticket_count - signal.volume_after
    : null;

  return (
    <div className="bg-[#2f353d] rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-200">{signal.title ?? signal.component}</span>
          <span className={`${trend.color}`}>{trend.symbol}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.new}`}>
            {status}
          </span>
          {signal.jira_ticket_key && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
              {signal.jira_ticket_key}
            </span>
          )}
        </div>
        <div className="flex gap-3 text-xs">
          <span className="text-neutral-400">{signal.ticket_count} tickets</span>
          <span className="text-neutral-500">{signal.customer_count} customers</span>
        </div>
      </div>
      {signal.detail && <p className="text-xs text-neutral-400 mt-1">{signal.detail}</p>}
      {signal.recommendation && <p className="text-xs text-[#5ec1ca] mt-1">{signal.recommendation}</p>}
      {signal.owner && <p className="text-[10px] text-neutral-500 mt-1">Owner: {signal.owner}</p>}
      {signal.outcome && <p className="text-[10px] text-green-400 mt-1">Outcome: {signal.outcome}</p>}
      {impactReduction != null && impactReduction > 0 && (
        <p className="text-[10px] text-green-400 mt-1">~{impactReduction} tickets prevented</p>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2 mt-3 pt-2 border-t border-zinc-700/50">
        <select
          className="bg-zinc-700 text-white text-[10px] rounded px-1.5 py-0.5 border border-zinc-600"
          value={signal.owner ?? ''}
          disabled={assigning}
          onChange={(e) => e.target.value && assignOwner(e.target.value)}
        >
          <option value="">Assign...</option>
          {users.map(u => (
            <option key={u.id} value={u.display_name ?? u.username}>
              {u.display_name ?? u.username}
            </option>
          ))}
        </select>

        {status !== 'resolved' && status !== 'dismissed' && (
          <>
            {status === 'new' && (
              <button onClick={() => updateStatus('acknowledged')}
                className="text-[10px] px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30">
                Acknowledge
              </button>
            )}
            {(status === 'acknowledged' || status === 'new') && (
              <button onClick={() => updateStatus('in_progress')}
                className="text-[10px] px-2 py-0.5 bg-indigo-500/20 text-indigo-400 rounded hover:bg-indigo-500/30">
                Start Work
              </button>
            )}
            <button onClick={() => setShowOutcome(!showOutcome)}
              className="text-[10px] px-2 py-0.5 bg-green-500/20 text-green-400 rounded hover:bg-green-500/30">
              Resolve
            </button>
            <button onClick={() => setShowDismiss(!showDismiss)}
              className="text-[10px] px-2 py-0.5 bg-zinc-600/50 text-neutral-400 rounded hover:bg-zinc-600">
              Dismiss
            </button>
          </>
        )}
      </div>

      {showOutcome && (
        <div className="mt-2 flex gap-2">
          <input
            value={outcomeText}
            onChange={(e) => setOutcomeText(e.target.value)}
            placeholder="Outcome / what was done..."
            className="flex-1 bg-zinc-700 text-white text-xs rounded px-2 py-1 border border-zinc-600"
          />
          <button onClick={() => { updateStatus('resolved', outcomeText); setShowOutcome(false); }}
            className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-500">
            Save
          </button>
        </div>
      )}

      {showDismiss && (
        <div className="mt-2 flex gap-2">
          <input
            value={dismissReason}
            onChange={(e) => setDismissReason(e.target.value)}
            placeholder="Reason for dismissing..."
            className="flex-1 bg-zinc-700 text-white text-xs rounded px-2 py-1 border border-zinc-600"
          />
          <button onClick={dismiss}
            className="text-xs px-2 py-1 bg-zinc-600 text-white rounded hover:bg-zinc-500">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export function IntelligenceView() {
  const [report, setReport] = useState<Report | null>(null);
  const [generating, setGenerating] = useState(false);
  const [users, setUsers] = useState<NovaUser[]>([]);

  const load = useCallback(async () => {
    const [r, u] = await Promise.all([
      api('/report'),
      fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.json()).catch(() => ({ ok: false })),
    ]);
    if (r.ok) setReport(r.data);
    if (u.ok && Array.isArray(u.data)) setUsers(u.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenerating(true);
    await api('/generate', 'POST');
    await load();
    setGenerating(false);
  };

  const exportMd = () => {
    window.open('/api/cross-functional/export', '_blank');
  };

  const renderSection = (title: string, signals: Signal[], emptyMsg: string) => (
    <div>
      <h3 className="text-sm font-medium text-neutral-200 mb-3">{title}</h3>
      <div className="space-y-2">
        {signals.map(s => (
          <SignalCard key={s.id} signal={s} users={users} onUpdate={load} />
        ))}
        {signals.length === 0 && (
          <p className="text-xs text-neutral-500 py-4 text-center">{emptyMsg}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {report?.period.start && (
            <span className="text-xs text-neutral-500">
              Period: {report.period.start} to {report.period.end}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={exportMd}
            className="px-3 py-1 bg-[#2f353d] text-neutral-400 text-xs rounded hover:bg-[#3a424d]">
            Export for Dev
          </button>
          <button onClick={generate} disabled={generating}
            className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
            {generating ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {report && (
        <>
          {renderSection('Bug Impact Analysis', report.bug_impact, 'No bug impact data yet')}
          {renderSection('Feature Demand', report.feature_demand, 'No feature demand data yet')}
          {renderSection('Recurring Issues', report.recurring_issues, 'No recurring issue data yet')}
        </>
      )}

      {!report && (
        <div className="text-center text-neutral-500 text-sm py-8">
          No intelligence report available. Click "Generate Report" to analyse this month's data.
        </div>
      )}
    </div>
  );
}
