import { useState, useEffect, useCallback, Fragment } from 'react';

interface AlertReason {
  rule: string;
  label: string;
  weight: number;
  detail: string | null;
}

interface Alert {
  id: number;
  issue_key: string;
  project_key: string;
  summary: string;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  created_at: string | null;
  severity: string;
  score: number;
  fingerprint: string;
  first_seen: string;
  last_seen: string;
  sla_remaining_ms: number | null;
  sentiment_score: number | null;
  sentiment_summary: string | null;
  reasons: AlertReason[];
}

interface Stats {
  p1: number;
  p2: number;
  p3: number;
  total: number;
  ignored: number;
  lastScan: string | null;
}

interface ConfigRow {
  rule: string;
  enabled: boolean;
  weight: number;
  threshold_json: string;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  P1: { bg: 'bg-red-900/40', text: 'text-red-400', border: 'border-red-800' },
  P2: { bg: 'bg-amber-900/40', text: 'text-amber-400', border: 'border-amber-800' },
  P3: { bg: 'bg-yellow-900/30', text: 'text-yellow-400', border: 'border-yellow-800' },
};

const RULE_LABELS: Record<string, string> = {
  sla_breached: 'SLA Breached',
  sla_near: 'SLA Approaching',
  stale_comms: 'Stale Comms',
  ticket_age: 'Ticket Age',
  ping_pong: 'Assignee Ping-Pong',
  reopened: 'Reopened',
  high_priority: 'High Priority',
  sentiment: 'Negative Sentiment',
  stagnant_status: 'Status Stagnant',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '-';
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(ms / (1000 * 60));
  return `${mins}m ago`;
}

function daysOpen(dateStr: string | null): string {
  if (!dateStr) return '-';
  const ms = Date.now() - new Date(dateStr).getTime();
  return `${Math.floor(ms / (1000 * 60 * 60 * 24))}d`;
}

function slaDisplay(ms: number | null): { text: string; className: string } {
  if (ms === null) return { text: 'No SLA', className: 'text-neutral-600' };
  if (ms < 0) return { text: 'Breached', className: 'text-red-400 font-bold' };
  const hours = ms / (1000 * 60 * 60);
  if (hours < 2) return { text: `${hours.toFixed(1)}h`, className: 'text-amber-400 font-bold' };
  return { text: `${hours.toFixed(1)}h`, className: 'text-neutral-400' };
}

export function ProblemTicketsView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set(['P1', 'P2', 'P3']));
  const [showIgnoreModal, setShowIgnoreModal] = useState<string | null>(null);
  const [ignoreReason, setIgnoreReason] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  const jsonHeaders = { 'Content-Type': 'application/json' };

  const loadData = useCallback(async () => {
    try {
      const [alertsRes, statsRes] = await Promise.all([
        fetch('/api/problem-tickets'),
        fetch('/api/problem-tickets/stats'),
      ]);
      const alertsJson = await alertsRes.json();
      const statsJson = await statsRes.json();
      if (alertsJson.ok) setAlerts(alertsJson.data);
      if (statsJson.ok) setStats(statsJson.data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/problem-tickets/config');
      const json = await res.json();
      if (json.ok) setConfig(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadData(); loadConfig(); }, [loadData, loadConfig]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('nova-refresh', handler);
    return () => window.removeEventListener('nova-refresh', handler);
  }, [loadData]);

  const triggerScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/problem-tickets/scan', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) setError(json.error ?? 'Scan failed');
      else setError(null);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const ignoreAlert = async (issueKey: string) => {
    try {
      await fetch(`/api/problem-tickets/${issueKey}/ignore`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ reason: ignoreReason || null }),
      });
      setShowIgnoreModal(null);
      setIgnoreReason('');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const updateConfigRule = async (rule: string, updates: Partial<ConfigRow>) => {
    try {
      await fetch(`/api/problem-tickets/config/${rule}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(updates),
      });
      await loadConfig();
    } catch { /* ignore */ }
  };

  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSeverity = (sev: string) => {
    setSeverityFilter(prev => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  };

  const filtered = alerts.filter(a => severityFilter.has(a.severity));

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading problem tickets...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {(['P1', 'P2', 'P3'] as const).map(sev => {
            const style = SEVERITY_STYLES[sev];
            const count = sev === 'P1' ? stats?.p1 : sev === 'P2' ? stats?.p2 : stats?.p3;
            return (
              <button
                key={sev}
                onClick={() => toggleSeverity(sev)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                  severityFilter.has(sev)
                    ? `${style.bg} ${style.text} ${style.border}`
                    : 'bg-[#272C33] text-neutral-600 border-[#3a424d] opacity-50'
                }`}
              >
                {sev}: {count ?? 0}
              </button>
            );
          })}
        </div>

        <div className="text-[10px] text-neutral-600 ml-auto flex items-center gap-3">
          {stats?.ignored ? (
            <span>{stats.ignored} ignored</span>
          ) : null}
          <span>Last scan: {stats?.lastScan ? timeAgo(stats.lastScan) : 'never'}</span>
          <button
            onClick={triggerScan}
            disabled={scanning}
            className="px-3 py-1 text-xs bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4ba8b0] transition-colors disabled:opacity-50"
          >
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-2 py-1 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Configure rules"
          >
            ⚙
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Config panel (admin only) */}
      {showConfig && (
        <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-4">
          <div className="text-xs font-semibold text-neutral-300 mb-3">Rule Configuration</div>
          <div className="space-y-2">
            {config.map(c => (
              <div key={c.rule} className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-2 w-40">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={e => updateConfigRule(c.rule, { enabled: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-neutral-300">{RULE_LABELS[c.rule] ?? c.rule}</span>
                </label>
                <label className="flex items-center gap-1 text-neutral-500">
                  Weight:
                  <input
                    type="number"
                    value={c.weight}
                    onChange={e => updateConfigRule(c.rule, { weight: parseInt(e.target.value) || 0 })}
                    className="w-12 bg-[#272C33] border border-[#3a424d] rounded px-1 py-0.5 text-neutral-300 text-center"
                    min={0}
                    max={50}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alert table */}
      {filtered.length === 0 ? (
        <div className="text-sm text-neutral-500 py-8 text-center">
          {alerts.length === 0 ? 'No problem tickets detected. Click "Scan Now" to check.' : 'No alerts match the current filter.'}
        </div>
      ) : (
        <div className="border border-[#3a424d] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-[10px]">
                <th className="text-center px-2 py-2 w-10">Sev</th>
                <th className="text-left px-3 py-2">Issue</th>
                <th className="text-left px-3 py-2 hidden sm:table-cell">Status</th>
                <th className="text-left px-3 py-2 hidden md:table-cell">Assignee</th>
                <th className="text-center px-3 py-2">Score</th>
                <th className="text-left px-3 py-2">Top Signal</th>
                <th className="text-center px-3 py-2 hidden sm:table-cell">Age</th>
                <th className="text-center px-3 py-2 hidden md:table-cell">SLA</th>
                <th className="text-center px-2 py-2 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {filtered.map(alert => {
                const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.P3;
                const isExpanded = expanded.has(alert.issue_key);
                const topReason = alert.reasons?.[0];
                const sla = slaDisplay(alert.sla_remaining_ms);

                return (
                  <Fragment key={alert.issue_key}>
                    <tr
                      className="bg-[#2f353d] hover:bg-[#363d47] transition-colors cursor-pointer"
                      onClick={() => toggleExpanded(alert.issue_key)}
                    >
                      <td className="px-2 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${style.bg} ${style.text}`}>
                          {alert.severity}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-neutral-200 font-medium">{alert.issue_key}</div>
                        <div className="text-neutral-500 truncate max-w-[300px]">{alert.summary}</div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#272C33] text-neutral-400">
                          {alert.status ?? '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400 hidden md:table-cell">{alert.assignee ?? '-'}</td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <div className="w-12 h-1.5 bg-[#272C33] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${alert.score >= 60 ? 'bg-red-500' : alert.score >= 35 ? 'bg-amber-500' : 'bg-yellow-500'}`}
                              style={{ width: `${alert.score}%` }}
                            />
                          </div>
                          <span className="text-neutral-400 text-[10px] w-6">{alert.score}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{topReason?.label ?? '-'}</td>
                      <td className="px-3 py-2 text-center text-neutral-500 hidden sm:table-cell">{daysOpen(alert.created_at)}</td>
                      <td className="px-3 py-2 text-center hidden md:table-cell">
                        <span className={sla.className}>{sla.text}</span>
                      </td>
                      <td className="px-2 py-2 text-center text-neutral-600">
                        {isExpanded ? '▾' : '▸'}
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#272C33]">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="space-y-3">
                            {/* Triggered rules */}
                            <div>
                              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1.5">Triggered Rules</div>
                              <div className="flex flex-wrap gap-2">
                                {alert.reasons?.map((r, i) => (
                                  <div key={i} className="flex items-center gap-1.5 bg-[#2f353d] rounded px-2 py-1 text-xs">
                                    <span className="text-neutral-300 font-medium">{r.label}</span>
                                    <span className="text-neutral-600">+{r.weight}</span>
                                    {r.detail && <span className="text-neutral-500 text-[10px]">({r.detail})</span>}
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Sentiment */}
                            {alert.sentiment_score !== null && (
                              <div>
                                <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Sentiment</div>
                                <div className="flex items-center gap-2 text-xs">
                                  <span className={alert.sentiment_score < -0.3 ? 'text-red-400' : alert.sentiment_score < 0 ? 'text-amber-400' : 'text-green-400'}>
                                    {alert.sentiment_score.toFixed(2)}
                                  </span>
                                  {alert.sentiment_summary && (
                                    <span className="text-neutral-400">{alert.sentiment_summary}</span>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Meta */}
                            <div className="flex items-center gap-4 text-[10px] text-neutral-600">
                              <span>Reporter: {alert.reporter ?? '-'}</span>
                              <span>Priority: {alert.priority ?? '-'}</span>
                              <span>First seen: {timeAgo(alert.first_seen)}</span>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => { e.stopPropagation(); setShowIgnoreModal(alert.issue_key); }}
                                className="px-3 py-1 text-xs bg-[#363d47] text-neutral-300 rounded hover:bg-[#3a424d] transition-colors"
                              >
                                Ignore
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Ignore modal */}
      {showIgnoreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowIgnoreModal(null)}>
          <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-neutral-200 mb-3">
              Ignore {showIgnoreModal}
            </div>
            <p className="text-xs text-neutral-400 mb-3">
              This alert will be suppressed until a material change occurs (priority, status, assignee, SLA, or reopened).
            </p>
            <textarea
              value={ignoreReason}
              onChange={e => setIgnoreReason(e.target.value)}
              placeholder="Optional reason..."
              className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-xs text-neutral-200 placeholder:text-neutral-600 resize-none h-20 mb-3 focus:border-[#5ec1ca] focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowIgnoreModal(null)}
                className="px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => ignoreAlert(showIgnoreModal)}
                className="px-4 py-1.5 text-xs bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4ba8b0] transition-colors"
              >
                Ignore Alert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

