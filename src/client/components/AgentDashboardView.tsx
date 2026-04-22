import { useState, useEffect, useCallback } from 'react';
import { TeamAvailabilityWidget } from './TeamAvailabilityWidget.js';

// ── Types ──

interface AgentStatus {
  state: 'stopped' | 'running' | 'paused';
  shadowMode: boolean;
  lastTickAt: string | null;
  tickCount: number;
  ticketsProcessed: number;
  intervalMs: number;
  errors: number;
}

interface AgentStats {
  byAction: Record<string, number>;
  byConfidence: { high: number; medium: number; low: number };
  shadow: number;
  total: number;
}

interface Decision {
  id: number;
  ticket_id: string;
  event_type: string;
  action: string;
  confidence: number;
  reasoning: string;
  inputs: string;
  output: string;
  outcome: string | null;
  provider: string | null;
  model: string | null;
  approval_required: boolean;
  shadow_mode: boolean;
  created_at: string;
  resolved_at: string | null;
}

interface ProviderStat {
  provider: string;
  model: string;
  cnt: number;
  avg_latency: number;
}

interface CostSummary {
  totalCost: number;
  totalCalls: number;
  byProvider: Array<{ provider: string; cost: number; calls: number }>;
  byModel: Array<{ model: string; provider: string; cost: number; calls: number; input_tokens: number; output_tokens: number }>;
  byCallType: Array<{ call_type: string; cost: number; calls: number }>;
  dailyTrend: Array<{ day: string; cost: number; calls: number }>;
  avgCostPerDecision: number;
  topTickets: Array<{ ticket_id: string; cost: number; calls: number }>;
}

interface ConfidenceDay {
  day: string;
  avg_confidence: number;
  cnt: number;
}

interface GuardrailRule {
  id: string;
  description: string;
  severity: string;
  enabled: boolean;
}

interface AutonomyRule {
  id: number;
  category: string;
  subCategory: string | null;
  enabled: boolean;
  minConfidence: number;
  minAcceptRate: number;
  minQaScore: number;
  minDecisions: number;
  autonomousActions: string[];
  updatedBy: string | null;
  updatedAt: string;
}

interface AgentAlert {
  id: number;
  alertType: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string | null;
  ticketKey: string | null;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  createdAt: string;
}

interface KbGap {
  category: string;
  suggested_title: string | null;
  frequency: number;
  first_seen: string;
  last_seen: string;
  ticket_ids: string;
}

// ── Helpers ──

function api(path: string, opts?: RequestInit) {
  return fetch(`/api/agent${path}`, opts).then(r => r.json());
}

function apiPost(path: string) {
  return api(path, { method: 'POST' });
}

function apiJson(path: string, method: string, body: unknown) {
  return api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return '#22c55e';
  if (c >= 0.5) return '#f59e0b';
  return '#ef4444';
}

function confidenceBadge(c: number): string {
  if (c >= 0.8) return 'bg-green-950/50 text-green-400 border-green-800/40';
  if (c >= 0.5) return 'bg-amber-950/50 text-amber-400 border-amber-800/40';
  return 'bg-red-950/50 text-red-400 border-red-800/40';
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    draft_response: 'Draft Response',
    no_action: 'No Action',
    escalate: 'Escalate',
    assign: 'Assign',
    chase: 'Chase',
    transition: 'Transition',
    comment: 'Comment',
    respond: 'Respond',
    update_fields: 'Update Fields',
  };
  return map[action] ?? action;
}

function eventLabel(et: string): string {
  const map: Record<string, string> = {
    ticket_created: 'New Ticket',
    comment_added: 'Comment',
    sla_warning: 'SLA Risk',
    stale: 'Sweep',
    resolution_review: 'Resolution Review',
    status_changed: 'Status Change',
  };
  return map[et] ?? et;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ── Main Component ──

function checkSuperAdmin(role: string): boolean {
  return role.split(',').map(r => r.trim()).includes('super_admin');
}

export function AgentDashboardView({ userRole = '' }: { userRole?: string }) {
  const isSuperAdmin = checkSuperAdmin(userRole);
  const [tab, setTab] = useState<'overview' | 'decisions' | 'guardrails' | 'providers' | 'autonomy' | 'alerts' | 'kb-gaps' | 'quick-actions' | 'costs'>('overview');
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selected, setSelected] = useState<Decision | null>(null);
  const [providers, setProviders] = useState<ProviderStat[]>([]);
  const [confHistory, setConfHistory] = useState<ConfidenceDay[]>([]);
  const [guardrails, setGuardrails] = useState<GuardrailRule[]>([]);
  const [autonomyRules, setAutonomyRules] = useState<AutonomyRule[]>([]);
  const [alerts, setAlerts] = useState<AgentAlert[]>([]);
  const [kbGaps, setKbGaps] = useState<KbGap[]>([]);
  const [costData, setCostData] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [sRes, stRes, dRes, aRes] = await Promise.all([
        api('/status'),
        api('/stats'),
        api('/decisions?limit=50'),
        api('/alerts?limit=20'),
      ]);
      if (sRes.ok) setStatus(sRes.data);
      if (stRes.ok) setStats(stRes.data);
      if (dRes.ok) setDecisions(dRes.data);
      if (aRes.ok) setAlerts(aRes.data);
      setError(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load agent data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  useEffect(() => {
    if (tab === 'providers') {
      Promise.all([
        api('/providers?days=7'),
        api('/confidence-history?days=30'),
      ]).then(([pRes, cRes]) => {
        if (pRes.ok) setProviders(pRes.data);
        if (cRes.ok) setConfHistory(cRes.data);
      });
    }
    if (tab === 'guardrails') {
      api('/guardrails').then(r => { if (r.ok) setGuardrails(r.data); });
    }
    if (tab === 'autonomy') {
      api('/autonomy').then(r => { if (r.ok) setAutonomyRules(r.data); });
    }
    if (tab === 'alerts') {
      api('/alerts?limit=100&includeAcknowledged=true').then(r => { if (r.ok) setAlerts(r.data); });
    }
    if (tab === 'kb-gaps') {
      api('/kb-gaps').then(r => { if (r.ok) setKbGaps(r.data); });
    }
    if (tab === 'costs') {
      api('/costs?days=30').then(r => { if (r.ok) setCostData(r.data); });
    }
  }, [tab]);

  const doAction = async (action: string) => {
    const res = await apiPost(`/${action}`);
    if (res.ok) setStatus(res.data);
  };

  const toggleGuardrail = async (ruleId: string, enabled: boolean) => {
    const res = await fetch(`/api/agent/guardrails/${ruleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then(r => r.json());
    if (res.ok) setGuardrails(res.data);
  };

  if (loading) return <div className="text-sm text-neutral-500 py-8 text-center">Loading agent dashboard...</div>;
  if (error) return <div className="text-sm text-red-400 py-8 text-center">{error}</div>;

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      {/* Header + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-neutral-100">AI Agent</h2>
          {status && <StatusPill state={status.state} shadow={status.shadowMode} />}
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && status?.state === 'stopped' && (
            <ControlBtn label="Start" onClick={() => doAction('start')} color="green" />
          )}
          {isSuperAdmin && status?.state === 'running' && (
            <>
              <ControlBtn label="Pause" onClick={() => doAction('pause')} color="amber" />
              <ControlBtn label="Stop" onClick={() => doAction('stop')} color="red" />
            </>
          )}
          {isSuperAdmin && status?.state === 'paused' && (
            <>
              <ControlBtn label="Resume" onClick={() => doAction('resume')} color="green" />
              <ControlBtn label="Stop" onClick={() => doAction('stop')} color="red" />
            </>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#3a424d] pb-px">
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'decisions', label: 'Decisions' },
          { key: 'autonomy', label: 'Autonomy' },
          { key: 'guardrails', label: 'Guardrails' },
          { key: 'alerts', label: `Alerts${alerts.filter(a => !a.acknowledged).length > 0 ? ` (${alerts.filter(a => !a.acknowledged).length})` : ''}` },
          { key: 'kb-gaps', label: 'KB Gaps' },
          { key: 'quick-actions', label: 'Quick Actions' },
          { key: 'providers', label: 'Providers' },
          ...(isSuperAdmin ? [{ key: 'costs' as const, label: 'Costs' }] : []),
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              tab === t.key
                ? 'bg-[#2f353d] text-[#5ec1ca] border border-[#3a424d] border-b-transparent -mb-px'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab status={status} stats={stats} decisions={decisions} onSelect={setSelected} />}
      {tab === 'decisions' && <DecisionsTab decisions={decisions} selected={selected} onSelect={setSelected} onRefresh={refresh} />}
      {tab === 'autonomy' && <AutonomyTab rules={autonomyRules} onRefresh={() => api('/autonomy').then(r => { if (r.ok) setAutonomyRules(r.data); })} isSuperAdmin={isSuperAdmin} />}
      {tab === 'guardrails' && <GuardrailsTab rules={guardrails} onToggle={toggleGuardrail} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} onRefresh={() => api('/alerts?limit=100&includeAcknowledged=true').then(r => { if (r.ok) setAlerts(r.data); })} />}
      {tab === 'kb-gaps' && <KbGapsTab gaps={kbGaps} onRefresh={() => api('/kb-gaps').then(r => { if (r.ok) setKbGaps(r.data); })} />}
      {tab === 'quick-actions' && <QuickActionsTab />}
      {tab === 'providers' && <ProvidersTab providers={providers} confHistory={confHistory} />}
      {tab === 'costs' && <CostsTab data={costData} onPeriodChange={(days) => api(`/costs?days=${days}`).then(r => { if (r.ok) setCostData(r.data); })} />}

      {/* Detail panel */}
      {selected && <DecisionDetail decision={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Sub-components ──

function StatusPill({ state, shadow }: { state: string; shadow: boolean }) {
  const stateColor = state === 'running' ? 'bg-green-500' : state === 'paused' ? 'bg-amber-500' : 'bg-neutral-600';
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${stateColor} text-white`}>
        <span className={`w-1.5 h-1.5 rounded-full ${state === 'running' ? 'animate-pulse bg-white' : 'bg-white/60'}`} />
        {state}
      </span>
      {shadow && (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-purple-900/60 text-purple-300 border border-purple-700/40">
          Shadow
        </span>
      )}
    </div>
  );
}

function ControlBtn({ label, onClick, color }: { label: string; onClick: () => void; color: 'green' | 'amber' | 'red' }) {
  const colors = {
    green: 'bg-green-600 hover:bg-green-500 text-white',
    amber: 'bg-amber-600 hover:bg-amber-500 text-white',
    red: 'bg-red-600 hover:bg-red-500 text-white',
  };
  return (
    <button onClick={onClick} className={`px-3 py-1 text-xs font-medium rounded ${colors[color]} transition-colors`}>
      {label}
    </button>
  );
}

function KpiCard({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div className="border border-[#3a424d] rounded-lg px-4 py-4 bg-[#2f353d]">
      <div className="text-3xl font-bold font-[var(--font-heading)]" style={{ color }}>{value}</div>
      <div className="text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ── Overview Tab ──

function OverviewTab({ status, stats, decisions, onSelect }: {
  status: AgentStatus | null;
  stats: AgentStats | null;
  decisions: Decision[];
  onSelect: (d: Decision) => void;
}) {
  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        <KpiCard value={stats?.total ?? 0} label="Decisions Today" color="#5ec1ca" />
        <KpiCard value={stats?.byAction?.draft_response ?? 0} label="Responses" color="#5ec1ca" />
        <KpiCard value={stats?.byAction?.escalate ?? 0} label="Escalated" color="#f59e0b" />
        <KpiCard value={stats?.byAction?.chase ?? 0} label="Chased" color="#f59e0b" />
        <KpiCard value={stats?.byConfidence?.high ?? 0} label="High Conf" color="#22c55e" />
        <KpiCard value={status?.errors ?? 0} label="Errors" color={(status?.errors ?? 0) > 0 ? '#ef4444' : '#22c55e'} />
      </div>

      {/* Status detail */}
      {status && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Agent Status</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div><span className="text-neutral-500">Last Tick:</span> <span className="text-neutral-200 ml-1">{status.lastTickAt ? timeAgo(status.lastTickAt) : 'Never'}</span></div>
            <div><span className="text-neutral-500">Tick Count:</span> <span className="text-neutral-200 ml-1">{status.tickCount}</span></div>
            <div><span className="text-neutral-500">Processed:</span> <span className="text-neutral-200 ml-1">{status.ticketsProcessed}</span></div>
            <div><span className="text-neutral-500">Interval:</span> <span className="text-neutral-200 ml-1">{(status.intervalMs / 1000).toFixed(0)}s</span></div>
          </div>
        </div>
      )}

      {/* Confidence breakdown */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Confidence Distribution</h3>
            <div className="space-y-2">
              {(['high', 'medium', 'low'] as const).map(band => {
                const count = stats.byConfidence[band];
                const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                const colors = { high: '#22c55e', medium: '#f59e0b', low: '#ef4444' };
                return (
                  <div key={band} className="flex items-center gap-3">
                    <span className="text-xs font-semibold w-16 capitalize" style={{ color: colors[band] }}>{band}</span>
                    <div className="flex-1 bg-[#272C33] rounded-full h-4 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: colors[band] }} />
                    </div>
                    <span className="text-xs text-neutral-400 w-8 text-right font-mono">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
            <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Actions Today</h3>
            <div className="space-y-1.5">
              {Object.entries(stats.byAction)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => (
                  <div key={action} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-300">{actionLabel(action)}</span>
                    <span className="text-neutral-400 font-mono">{count}</span>
                  </div>
                ))}
              {Object.keys(stats.byAction).length === 0 && (
                <div className="text-xs text-neutral-500">No decisions yet today</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Team availability (WP-12) */}
      <TeamAvailabilityWidget />

      {/* Recent decisions (mini feed) */}
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#3a424d] flex items-center justify-between">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Recent Decisions</h3>
          <span className="text-[10px] text-neutral-500">Last 10</span>
        </div>
        <div className="divide-y divide-[#3a424d]">
          {decisions.slice(0, 10).map(d => (
            <button key={d.id} onClick={() => onSelect(d)} className="w-full text-left px-4 py-2.5 hover:bg-[#363d47]/50 transition-colors flex items-center gap-3">
              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${confidenceBadge(d.confidence)}`}>
                {(d.confidence * 100).toFixed(0)}%
              </span>
              <span className="text-xs text-[#5ec1ca] font-mono w-24 shrink-0">{d.ticket_id}</span>
              <span className="text-[10px] text-neutral-500 w-20 shrink-0">{eventLabel(d.event_type)}</span>
              <span className="text-xs text-neutral-300 truncate flex-1">{actionLabel(d.action)}</span>
              {d.shadow_mode && <span className="text-[9px] text-purple-400 font-semibold">SHADOW</span>}
              <span className="text-[10px] text-neutral-600 shrink-0">{timeAgo(d.created_at)}</span>
            </button>
          ))}
          {decisions.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-neutral-500">No decisions recorded yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Decisions Tab (full list) ──

function DecisionsTab({ decisions, selected, onSelect, onRefresh }: {
  decisions: Decision[];
  selected: Decision | null;
  onSelect: (d: Decision) => void;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<string>('all');
  const filtered = filter === 'all' ? decisions : decisions.filter(d => d.event_type === filter);
  const eventTypes = [...new Set(decisions.map(d => d.event_type))];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-[#272C33] border border-[#3a424d] text-neutral-300 text-xs rounded px-2 py-1"
        >
          <option value="all">All Events</option>
          {eventTypes.map(et => <option key={et} value={et}>{eventLabel(et)}</option>)}
        </select>
        <button onClick={onRefresh} className="text-xs text-[#5ec1ca] hover:text-[#7dd3d8] transition-colors">Refresh</button>
        <span className="text-[10px] text-neutral-600 ml-auto">{filtered.length} decisions</span>
      </div>

      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-3 py-2 font-medium w-14">Conf</th>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {filtered.map(d => {
              const outcome = d.outcome ? safeJson(d.outcome) : null;
              return (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d)}
                  className={`cursor-pointer transition-colors ${selected?.id === d.id ? 'bg-[#363d47]' : 'hover:bg-[#363d47]/50'}`}
                >
                  <td className="px-3 py-2">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border ${confidenceBadge(d.confidence)}`}>
                      {(d.confidence * 100).toFixed(0)}%
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[#5ec1ca] font-mono">{d.ticket_id}</td>
                  <td className="px-3 py-2 text-neutral-400">{eventLabel(d.event_type)}</td>
                  <td className="px-3 py-2 text-neutral-200">
                    {actionLabel(d.action)}
                    {d.shadow_mode ? <span className="ml-1.5 text-[9px] text-purple-400 font-semibold">SHADOW</span> : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{d.provider ?? '—'}/{d.model?.split('-').slice(-1)[0] ?? ''}</td>
                  <td className="px-3 py-2">
                    {outcome ? (
                      <span className={`text-[10px] ${outcome.success ? 'text-green-400' : 'text-red-400'}`}>
                        {outcome.success ? '✓' : '✗'} {(outcome.detail as string)?.slice(0, 40) ?? ''}
                      </span>
                    ) : (
                      <span className="text-neutral-600">pending</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-neutral-600 text-right">{timeAgo(d.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No decisions match this filter</div>
        )}
      </div>
    </div>
  );
}

// ── Decision Detail Panel ──

function DecisionDetail({ decision: d, onClose }: { decision: Decision; onClose: () => void }) {
  const inputs = safeJson(d.inputs);
  const output = safeJson(d.output);
  const outcome = d.outcome ? safeJson(d.outcome) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#2f353d] border border-[#3a424d] rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#2f353d] border-b border-[#3a424d] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[#5ec1ca] font-mono font-semibold">{d.ticket_id}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${confidenceBadge(d.confidence)}`}>
              {(d.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-neutral-400">{eventLabel(d.event_type)} → {actionLabel(d.action)}</span>
            {d.shadow_mode && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-900/60 text-purple-300 border border-purple-700/40">SHADOW</span>}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Reasoning */}
          <Section title="Reasoning Trace">
            <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">{d.reasoning}</pre>
          </Section>

          {/* Outcome */}
          {outcome && (
            <Section title="Outcome">
              <div className={`text-xs ${outcome.success ? 'text-green-400' : 'text-red-400'}`}>
                {outcome.success ? '✓ Success' : '✗ Failed'}: {String(outcome.detail ?? '')}
                {outcome.error ? <div className="mt-1 text-red-500">{String(outcome.error)}</div> : null}
              </div>
            </Section>
          )}

          {/* Output */}
          {output && (
            <Section title="Output">
              {output.draft_response ? (
                <div className="mb-3">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Draft Response</div>
                  <div className="text-xs text-neutral-300 bg-[#272C33] rounded p-3 whitespace-pre-wrap">{String(output.draft_response)}</div>
                </div>
              ) : null}
              {output.internal_note ? (
                <div className="mb-3">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Internal Note</div>
                  <div className="text-xs text-neutral-300 bg-[#272C33] rounded p-3 whitespace-pre-wrap">{String(output.internal_note)}</div>
                </div>
              ) : null}
              <JsonBlock data={output} />
            </Section>
          )}

          {/* Inputs */}
          {inputs && (
            <Section title="Inputs">
              <JsonBlock data={inputs} />
            </Section>
          )}

          {/* Meta */}
          <Section title="Metadata">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-neutral-500">Decision ID:</span> <span className="text-neutral-300 ml-1">#{d.id}</span></div>
              <div><span className="text-neutral-500">Provider:</span> <span className="text-neutral-300 ml-1">{d.provider ?? 'N/A'} / {d.model ?? 'N/A'}</span></div>
              <div><span className="text-neutral-500">Created:</span> <span className="text-neutral-300 ml-1">{new Date(d.created_at).toLocaleString()}</span></div>
              <div><span className="text-neutral-500">Resolved:</span> <span className="text-neutral-300 ml-1">{d.resolved_at ? new Date(d.resolved_at).toLocaleString() : 'Pending'}</span></div>
              <div><span className="text-neutral-500">Approval Required:</span> <span className="text-neutral-300 ml-1">{d.approval_required ? 'Yes' : 'No'}</span></div>
              <div><span className="text-neutral-500">Shadow Mode:</span> <span className="text-neutral-300 ml-1">{d.shadow_mode ? 'Yes' : 'No'}</span></div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Guardrails Tab ──

function GuardrailsTab({ rules, onToggle }: { rules: GuardrailRule[]; onToggle: (id: string, enabled: boolean) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Guardrails are validated on every agent decision before execution. Blocked rules prevent the action entirely.
      </p>
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-4 py-2 font-medium w-10">On</th>
              <th className="px-4 py-2 font-medium">Rule</th>
              <th className="px-4 py-2 font-medium w-20">Severity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {rules.map(r => (
              <tr key={r.id} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2">
                  <button
                    onClick={() => onToggle(r.id, !r.enabled)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${r.enabled ? 'bg-green-600' : 'bg-neutral-700'}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${r.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-neutral-200 text-xs">{r.description}</div>
                  <div className="text-[10px] text-neutral-600 font-mono mt-0.5">{r.id}</div>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-[10px] font-semibold uppercase ${r.severity === 'block' ? 'text-red-400' : 'text-amber-400'}`}>
                    {r.severity}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No guardrail rules loaded</div>
        )}
      </div>
    </div>
  );
}

// ── Providers Tab ──

function ProvidersTab({ providers, confHistory }: { providers: ProviderStat[]; confHistory: ConfidenceDay[] }) {
  const totalCalls = providers.reduce((s, p) => s + p.cnt, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Provider split */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Provider Split (7 days)</h3>
          <div className="space-y-3">
            {providers.map(p => {
              const pct = totalCalls > 0 ? (p.cnt / totalCalls) * 100 : 0;
              return (
                <div key={`${p.provider}-${p.model}`} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-200">{p.provider} / <span className="text-neutral-400">{p.model}</span></span>
                    <span className="text-neutral-400 font-mono">{p.cnt} calls ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-[#272C33] rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: p.provider === 'anthropic' ? '#d4a574' : '#74b9ff',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-neutral-600 w-16 text-right">{p.avg_latency?.toFixed(0) ?? '?'}ms avg</span>
                  </div>
                </div>
              );
            })}
            {providers.length === 0 && (
              <div className="text-xs text-neutral-500">No LLM calls recorded yet</div>
            )}
          </div>
        </div>

        {/* Confidence trend */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Confidence Trend (30 days)</h3>
          {confHistory.length > 0 ? (
            <div className="space-y-1">
              {confHistory.slice(-14).map(day => {
                const pct = day.avg_confidence * 100;
                return (
                  <div key={day.day} className="flex items-center gap-2">
                    <span className="text-[10px] text-neutral-500 w-16 shrink-0">{day.day.slice(5)}</span>
                    <div className="flex-1 bg-[#272C33] rounded-full h-3 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: confidenceColor(day.avg_confidence) }}
                      />
                    </div>
                    <span className="text-[10px] text-neutral-400 w-12 text-right font-mono">{pct.toFixed(0)}%</span>
                    <span className="text-[10px] text-neutral-600 w-8 text-right">{day.cnt}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-neutral-500">No confidence data yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Autonomy Tab ──

function AutonomyTab({ rules, onRefresh, isSuperAdmin = false }: { rules: AutonomyRule[]; onRefresh: () => void; isSuperAdmin?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ category: '', subCategory: '', minConfidence: 0.9, minAcceptRate: 90, minQaScore: 4.0, minDecisions: 50 });

  const handleCreate = async () => {
    if (!form.category) return;
    const res = await apiJson('/autonomy', 'POST', {
      category: form.category,
      subCategory: form.subCategory || null,
      enabled: false,
      minConfidence: form.minConfidence,
      minAcceptRate: form.minAcceptRate,
      minQaScore: form.minQaScore,
      minDecisions: form.minDecisions,
      autonomousActions: ['draft_response'],
    });
    if (res.ok) {
      setAdding(false);
      setForm({ category: '', subCategory: '', minConfidence: 0.9, minAcceptRate: 90, minQaScore: 4.0, minDecisions: 50 });
      onRefresh();
    }
  };

  const toggleRule = async (id: number, enabled: boolean) => {
    await apiJson(`/autonomy/${id}`, 'PUT', { enabled });
    onRefresh();
  };

  const deleteRule = async (id: number) => {
    await api(`/autonomy/${id}`, { method: 'DELETE' });
    onRefresh();
  };

  const killSwitch = async () => {
    await apiPost('/autonomy/kill-switch');
    onRefresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Categories where the agent can resolve tickets autonomously (no approval step). Each rule requires minimum confidence, accept rate, and decision history.
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setAdding(!adding)} className="px-3 py-1.5 text-[11px] font-medium rounded bg-[#5ec1ca]/20 text-[#5ec1ca] hover:bg-[#5ec1ca]/30 border border-[#5ec1ca]/30">
            + Add Rule
          </button>
          {isSuperAdmin && (
            <button onClick={killSwitch} className="px-3 py-1.5 text-[11px] font-medium rounded bg-red-900/40 text-red-400 hover:bg-red-900/60 border border-red-800/40">
              Kill Switch
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="border border-[#5ec1ca]/30 rounded-lg bg-[#2f353d] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
              placeholder="Category (e.g. Password Reset)" className="bg-[#272C33] border border-[#3a424d] rounded px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-600"
            />
            <input
              value={form.subCategory} onChange={e => setForm({ ...form, subCategory: e.target.value })}
              placeholder="Sub-category (optional)" className="bg-[#272C33] border border-[#3a424d] rounded px-3 py-1.5 text-xs text-neutral-200 placeholder-neutral-600"
            />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <label className="text-[10px] text-neutral-500">
              Min Confidence
              <input type="number" step="0.05" min="0" max="1" value={form.minConfidence}
                onChange={e => setForm({ ...form, minConfidence: parseFloat(e.target.value) })}
                className="mt-0.5 w-full bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" />
            </label>
            <label className="text-[10px] text-neutral-500">
              Min Accept Rate %
              <input type="number" step="1" min="0" max="100" value={form.minAcceptRate}
                onChange={e => setForm({ ...form, minAcceptRate: parseFloat(e.target.value) })}
                className="mt-0.5 w-full bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" />
            </label>
            <label className="text-[10px] text-neutral-500">
              Min QA Score
              <input type="number" step="0.5" min="0" max="5" value={form.minQaScore}
                onChange={e => setForm({ ...form, minQaScore: parseFloat(e.target.value) })}
                className="mt-0.5 w-full bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" />
            </label>
            <label className="text-[10px] text-neutral-500">
              Min Decisions
              <input type="number" step="1" min="1" value={form.minDecisions}
                onChange={e => setForm({ ...form, minDecisions: parseInt(e.target.value) })}
                className="mt-0.5 w-full bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" />
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-[11px] font-medium rounded bg-green-900/40 text-green-400 hover:bg-green-900/60 border border-green-800/40">Create</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-[11px] font-medium rounded text-neutral-400 hover:text-neutral-200">Cancel</button>
          </div>
        </div>
      )}

      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-4 py-2 font-medium w-10">On</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium w-20">Confidence</th>
              <th className="px-4 py-2 font-medium w-24">Accept Rate</th>
              <th className="px-4 py-2 font-medium w-20">QA Score</th>
              <th className="px-4 py-2 font-medium w-20">Min Decisions</th>
              <th className="px-4 py-2 font-medium w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {rules.map(r => (
              <tr key={r.id} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2">
                  <button
                    onClick={() => toggleRule(r.id, !r.enabled)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${r.enabled ? 'bg-green-600' : 'bg-neutral-700'}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${r.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-neutral-200 text-xs">{r.category}</div>
                  {r.subCategory && <div className="text-[10px] text-neutral-500">{r.subCategory}</div>}
                </td>
                <td className="px-4 py-2 text-neutral-300 font-mono">{r.minConfidence.toFixed(2)}</td>
                <td className="px-4 py-2 text-neutral-300 font-mono">{r.minAcceptRate.toFixed(0)}%</td>
                <td className="px-4 py-2 text-neutral-300 font-mono">{r.minQaScore.toFixed(1)}</td>
                <td className="px-4 py-2 text-neutral-300 font-mono">{r.minDecisions}</td>
                <td className="px-4 py-2">
                  <button onClick={() => deleteRule(r.id)} className="text-neutral-600 hover:text-red-400 text-xs">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No autonomy rules configured. All decisions require approval.</div>
        )}
      </div>
    </div>
  );
}

// ── Alerts Tab ──

function AlertsTab({ alerts, onRefresh }: { alerts: AgentAlert[]; onRefresh: () => void }) {
  const acknowledge = async (id: number) => {
    await apiPost(`/alerts/${id}/acknowledge`);
    onRefresh();
  };

  const acknowledgeAll = async () => {
    await apiPost('/alerts/acknowledge-all');
    onRefresh();
  };

  const unacked = alerts.filter(a => !a.acknowledged);

  const severityColor = (s: string) => {
    if (s === 'critical') return 'text-red-400 bg-red-950/50 border-red-800/40';
    if (s === 'warning') return 'text-amber-400 bg-amber-950/50 border-amber-800/40';
    return 'text-blue-400 bg-blue-950/50 border-blue-800/40';
  };

  const typeLabel = (t: string) => {
    const map: Record<string, string> = {
      sla_breach_imminent: 'SLA Breach',
      volume_spike: 'Volume Spike',
      capacity_low: 'Capacity',
      agent_loop_unhealthy: 'Loop Health',
      autonomy_execution: 'Autonomous',
      error: 'Error',
    };
    return map[t] ?? t;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          {unacked.length > 0 ? `${unacked.length} unacknowledged alert(s)` : 'All alerts acknowledged'}
        </p>
        {unacked.length > 0 && (
          <button onClick={acknowledgeAll} className="px-3 py-1.5 text-[11px] font-medium rounded bg-[#5ec1ca]/20 text-[#5ec1ca] hover:bg-[#5ec1ca]/30 border border-[#5ec1ca]/30">
            Acknowledge All
          </button>
        )}
      </div>

      <div className="space-y-2">
        {alerts.map(a => (
          <div key={a.id} className={`border rounded-lg p-3 flex items-start gap-3 transition-opacity ${a.acknowledged ? 'opacity-50 border-[#3a424d] bg-[#2f353d]/50' : 'border-[#3a424d] bg-[#2f353d]'}`}>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase border shrink-0 mt-0.5 ${severityColor(a.severity)}`}>
              {a.severity}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] text-neutral-500 font-mono">{typeLabel(a.alertType)}</span>
                {a.ticketKey && <span className="text-[10px] text-[#5ec1ca] font-mono">{a.ticketKey}</span>}
                <span className="text-[10px] text-neutral-600">{a.createdAt ? timeAgo(a.createdAt) : ''}</span>
              </div>
              <div className="text-xs text-neutral-200">{a.title}</div>
              {a.detail && <div className="text-[10px] text-neutral-500 mt-0.5">{a.detail}</div>}
              {a.acknowledged && a.acknowledgedBy && (
                <div className="text-[10px] text-neutral-600 mt-1">Ack by {a.acknowledgedBy}</div>
              )}
            </div>
            {!a.acknowledged && (
              <button onClick={() => acknowledge(a.id)} className="text-[10px] text-neutral-500 hover:text-[#5ec1ca] shrink-0 mt-0.5">
                Ack
              </button>
            )}
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="text-xs text-neutral-500 text-center py-6">No alerts</div>
        )}
      </div>
    </div>
  );
}

// ── KB Gaps Tab ──

function KbGapsTab({ gaps, onRefresh }: { gaps: KbGap[]; onRefresh: () => void }) {
  const dismiss = async (category: string, suggestedTitle: string | null) => {
    await apiJson('/kb-gaps/dismiss', 'POST', { category, suggestedTitle });
    onRefresh();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Ticket types where the AI identified a missing KB article. Grouped by category and suggested title, sorted by frequency.
      </p>
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-4 py-2 font-medium w-16">Count</th>
              <th className="px-4 py-2 font-medium">Category</th>
              <th className="px-4 py-2 font-medium">Suggested Article</th>
              <th className="px-4 py-2 font-medium w-24">First Seen</th>
              <th className="px-4 py-2 font-medium w-24">Last Seen</th>
              <th className="px-4 py-2 font-medium w-28">Tickets</th>
              <th className="px-4 py-2 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {gaps.map((g, i) => (
              <tr key={i} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold ${
                    g.frequency >= 5 ? 'bg-red-950/60 text-red-400' :
                    g.frequency >= 3 ? 'bg-amber-950/60 text-amber-400' :
                    'bg-neutral-800 text-neutral-400'
                  }`}>
                    {g.frequency}
                  </span>
                </td>
                <td className="px-4 py-2 text-neutral-300">{g.category}</td>
                <td className="px-4 py-2.5">
                  <div className="text-neutral-200 text-xs">{g.suggested_title ?? '—'}</div>
                </td>
                <td className="px-4 py-2 text-[10px] text-neutral-500">{g.first_seen ? new Date(g.first_seen).toLocaleDateString() : ''}</td>
                <td className="px-4 py-2 text-[10px] text-neutral-500">{g.last_seen ? new Date(g.last_seen).toLocaleDateString() : ''}</td>
                <td className="px-4 py-2 text-[10px] text-neutral-500 font-mono truncate max-w-[7rem]" title={g.ticket_ids}>{g.ticket_ids}</td>
                <td className="px-4 py-2">
                  <button onClick={() => dismiss(g.category, g.suggested_title)} className="text-[10px] text-neutral-600 hover:text-red-400">
                    Dismiss
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {gaps.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No KB gaps identified yet. Gaps are recorded during ticket triage when the AI detects a missing article.</div>
        )}
      </div>
    </div>
  );
}

// ── Quick Actions Tab ──

function QuickActionsTab() {
  const [ticketKey, setTicketKey] = useState('');
  const [activeAction, setActiveAction] = useState<'reply' | 'escalate' | 'resolve' | null>(null);
  const [draftReply, setDraftReply] = useState('');
  const [draftResolveMsg, setDraftResolveMsg] = useState('');
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ provider?: string; model?: string; sentiment?: string; intent?: string } | null>(null);

  const resetState = () => {
    setDraftReply('');
    setDraftResolveMsg('');
    setResolutionSummary('');
    setEscalateReason('');
    setDrafting(false);
    setSending(false);
    setResult(null);
    setDraftMeta(null);
  };

  const selectAction = (action: 'reply' | 'escalate' | 'resolve') => {
    resetState();
    setActiveAction(action);
  };

  const draftReplyAction = async () => {
    if (!ticketKey.trim()) return;
    setDrafting(true);
    setResult(null);
    try {
      const res = await apiJson('/quick-actions/draft-reply', 'POST', { ticketKey: ticketKey.trim() });
      if (res.ok) {
        setDraftReply(res.data.draftResponse ?? '');
        setDraftMeta({
          provider: res.data.provider,
          model: res.data.model,
          sentiment: res.data.sentiment,
          intent: res.data.intent?.type,
        });
      } else {
        setResult({ ok: false, message: res.error ?? 'Draft failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Draft failed' });
    } finally {
      setDrafting(false);
    }
  };

  const sendReply = async (internal: boolean) => {
    if (!ticketKey.trim() || !draftReply.trim()) return;
    setSending(true);
    try {
      const res = await apiJson('/quick-actions/send-reply', 'POST', {
        ticketKey: ticketKey.trim(),
        message: draftReply.trim(),
        internal,
      });
      if (res.ok) {
        setResult({ ok: true, message: `${internal ? 'Internal note' : 'Reply'} posted to ${ticketKey}` });
        setDraftReply('');
      } else {
        setResult({ ok: false, message: res.error ?? 'Send failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Send failed' });
    } finally {
      setSending(false);
    }
  };

  const escalateAction = async () => {
    if (!ticketKey.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await apiJson('/quick-actions/escalate', 'POST', {
        ticketKey: ticketKey.trim(),
        reason: escalateReason.trim() || undefined,
      });
      if (res.ok) {
        setResult({ ok: true, message: `${ticketKey} escalated with internal note` });
        setEscalateReason('');
      } else {
        setResult({ ok: false, message: res.error ?? 'Escalate failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Escalate failed' });
    } finally {
      setSending(false);
    }
  };

  const draftResolveAction = async () => {
    if (!ticketKey.trim()) return;
    setDrafting(true);
    setResult(null);
    try {
      const res = await apiJson('/quick-actions/draft-resolve', 'POST', { ticketKey: ticketKey.trim() });
      if (res.ok) {
        setDraftResolveMsg(res.data.customerMessage ?? '');
        setResolutionSummary(res.data.resolutionSummary ?? '');
        setDraftMeta({ provider: res.data.provider, model: res.data.model });
      } else {
        setResult({ ok: false, message: res.error ?? 'Draft resolve failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Draft resolve failed' });
    } finally {
      setDrafting(false);
    }
  };

  const resolveAction = async () => {
    if (!ticketKey.trim()) return;
    setSending(true);
    try {
      const res = await apiJson('/quick-actions/resolve', 'POST', {
        ticketKey: ticketKey.trim(),
        customerMessage: draftResolveMsg.trim() || undefined,
        resolutionSummary: resolutionSummary.trim() || undefined,
      });
      if (res.ok) {
        setResult({ ok: true, message: `${ticketKey} resolved${res.data.transitioned ? ' and transitioned' : ''}` });
        setDraftResolveMsg('');
        setResolutionSummary('');
      } else {
        setResult({ ok: false, message: res.error ?? 'Resolve failed' });
      }
    } catch (err: any) {
      setResult({ ok: false, message: err.message ?? 'Resolve failed' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Execute actions on Jira tickets directly from NOVA. AI drafts responses using the LLM, then you review and send.
      </p>

      {/* Ticket key input */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-neutral-400 font-medium">Ticket:</label>
        <input
          type="text"
          value={ticketKey}
          onChange={e => setTicketKey(e.target.value.toUpperCase())}
          placeholder="NT-1234"
          className="bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded px-3 py-1.5 w-32 focus:outline-none focus:border-[#5ec1ca]"
        />
        <div className="flex gap-1">
          <ActionBtn label="Reply" active={activeAction === 'reply'} onClick={() => selectAction('reply')} color="cyan" />
          <ActionBtn label="Escalate" active={activeAction === 'escalate'} onClick={() => selectAction('escalate')} color="amber" />
          <ActionBtn label="Resolve" active={activeAction === 'resolve'} onClick={() => selectAction('resolve')} color="green" />
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div className={`px-3 py-2 rounded text-xs border ${result.ok ? 'bg-green-950/30 border-green-800/40 text-green-400' : 'bg-red-950/30 border-red-800/40 text-red-400'}`}>
          {result.message}
        </div>
      )}

      {/* Reply action */}
      {activeAction === 'reply' && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-neutral-200">Draft Reply</h4>
            <button
              onClick={draftReplyAction}
              disabled={!ticketKey.trim() || drafting}
              className="px-3 py-1 text-[11px] font-medium rounded bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {drafting ? 'Drafting...' : 'Generate AI Draft'}
            </button>
          </div>
          {draftMeta && (
            <div className="flex gap-3 text-[10px] text-neutral-500">
              {draftMeta.provider && <span>Provider: {draftMeta.provider}/{draftMeta.model}</span>}
              {draftMeta.sentiment && <span>Sentiment: {draftMeta.sentiment}</span>}
              {draftMeta.intent && <span>Intent: {draftMeta.intent}</span>}
            </div>
          )}
          <textarea
            value={draftReply}
            onChange={e => setDraftReply(e.target.value)}
            rows={6}
            placeholder="AI-drafted response will appear here. You can also type a response manually."
            className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-3 focus:outline-none focus:border-[#5ec1ca] resize-y"
          />
          <div className="flex gap-2">
            <button
              onClick={() => sendReply(false)}
              disabled={!draftReply.trim() || sending}
              className="px-3 py-1.5 text-[11px] font-medium rounded bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending...' : 'Send as Public Reply'}
            </button>
            <button
              onClick={() => sendReply(true)}
              disabled={!draftReply.trim() || sending}
              className="px-3 py-1.5 text-[11px] font-medium rounded bg-neutral-700/50 text-neutral-300 border border-[#3a424d] hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send as Internal Note
            </button>
          </div>
        </div>
      )}

      {/* Escalate action */}
      {activeAction === 'escalate' && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4 space-y-3">
          <h4 className="text-xs font-semibold text-neutral-200">Escalate Ticket</h4>
          <p className="text-[10px] text-neutral-500">Posts an internal escalation note on the ticket. Phase 3 will add guided escalation with team routing.</p>
          <textarea
            value={escalateReason}
            onChange={e => setEscalateReason(e.target.value)}
            rows={3}
            placeholder="Reason for escalation (optional)"
            className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-3 focus:outline-none focus:border-[#5ec1ca] resize-y"
          />
          <button
            onClick={escalateAction}
            disabled={!ticketKey.trim() || sending}
            className="px-3 py-1.5 text-[11px] font-medium rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 hover:bg-amber-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Escalating...' : 'Escalate'}
          </button>
        </div>
      )}

      {/* Resolve action */}
      {activeAction === 'resolve' && (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-neutral-200">Resolve Ticket</h4>
            <button
              onClick={draftResolveAction}
              disabled={!ticketKey.trim() || drafting}
              className="px-3 py-1 text-[11px] font-medium rounded bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {drafting ? 'Drafting...' : 'Generate AI Summary'}
            </button>
          </div>
          {draftMeta && (
            <div className="flex gap-3 text-[10px] text-neutral-500">
              {draftMeta.provider && <span>Provider: {draftMeta.provider}/{draftMeta.model}</span>}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-[10px] text-neutral-500 font-medium">Resolution Summary (internal)</label>
            <input
              type="text"
              value={resolutionSummary}
              onChange={e => setResolutionSummary(e.target.value)}
              placeholder="One-line resolution summary"
              className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded px-3 py-1.5 focus:outline-none focus:border-[#5ec1ca]"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] text-neutral-500 font-medium">Customer Message (optional)</label>
            <textarea
              value={draftResolveMsg}
              onChange={e => setDraftResolveMsg(e.target.value)}
              rows={4}
              placeholder="Closing message to the customer"
              className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-3 focus:outline-none focus:border-[#5ec1ca] resize-y"
            />
          </div>
          <button
            onClick={resolveAction}
            disabled={!ticketKey.trim() || sending}
            className="px-3 py-1.5 text-[11px] font-medium rounded bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Resolving...' : 'Resolve & Post'}
          </button>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color: 'cyan' | 'amber' | 'green' }) {
  const colors = {
    cyan: active ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border-[#5ec1ca]/40' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-[#5ec1ca]',
    amber: active ? 'bg-amber-900/30 text-amber-400 border-amber-800/40' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-amber-400',
    green: active ? 'bg-green-900/30 text-green-400 border-green-800/40' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-green-400',
  };
  return (
    <button onClick={onClick} className={`px-3 py-1 text-[11px] font-medium rounded border transition-colors ${colors[color]}`}>
      {label}
    </button>
  );
}

// ── Shared ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold mb-2">{title}</h4>
      {children}
    </div>
  );
}

function JsonBlock({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="text-[10px] text-[#5ec1ca] hover:text-[#7dd3d8]">
        {open ? '▼ Hide raw JSON' : '▶ Show raw JSON'}
      </button>
      {open && (
        <pre className="mt-1 text-[10px] text-neutral-400 bg-[#272C33] rounded p-2 overflow-x-auto max-h-60 font-mono">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

function safeJson(s: string | object): Record<string, unknown> | null {
  if (typeof s === 'object') return s as Record<string, unknown>;
  try { return JSON.parse(s); } catch { return null; }
}

// ── Costs Tab ──

const MODEL_COLORS: Record<string, string> = {
  'claude-sonnet-4-20250514': '#d4a574',
  'claude-haiku-4-5-20251001': '#e8c9a0',
  'gpt-4.1': '#74b9ff',
  'gpt-4.1-mini': '#a8d8f0',
};

function fmtCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function CostsTab({ data, onPeriodChange }: { data: CostSummary | null; onPeriodChange: (days: number) => void }) {
  const [days, setDays] = useState(30);

  if (!data) return <div className="text-sm text-neutral-500 py-8 text-center">Loading cost data...</div>;

  const maxDailyCost = Math.max(...data.dailyTrend.map(d => d.cost), 0.001);
  const totalModelCost = data.byModel.reduce((s, m) => s + m.cost, 0) || 1;

  // Projected monthly: cost per day × 30
  const daysWithData = data.dailyTrend.length || 1;
  const dailyRate = data.totalCost / daysWithData;
  const projectedMonthly = dailyRate * 30;

  // Period buckets from daily trend
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const thisWeekCost = data.dailyTrend.filter(d => d.day >= weekAgo).reduce((s, d) => s + d.cost, 0);
  const thisMonthCost = data.dailyTrend.filter(d => d.day >= monthStart).reduce((s, d) => s + d.cost, 0);

  const handlePeriod = (d: number) => { setDays(d); onPeriodChange(d); };

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => handlePeriod(d)}
            className={`px-3 py-1 text-xs rounded ${days === d ? 'bg-[#5ec1ca] text-[#1a1f25]' : 'bg-[#2f353d] text-neutral-400 hover:text-neutral-200'}`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* Spend summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CostCard label="This Week" value={fmtCost(thisWeekCost)} />
        <CostCard label="This Month" value={fmtCost(thisMonthCost)} />
        <CostCard label={`All ${days}d`} value={fmtCost(data.totalCost)} sub={`${data.totalCalls} calls`} />
        <CostCard label="Projected /mo" value={fmtCost(projectedMonthly)} sub={`${fmtCost(dailyRate)}/day`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Daily trend */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Daily Cost Trend</h3>
          <div className="space-y-1">
            {data.dailyTrend.slice(-21).map(day => (
              <div key={day.day} className="flex items-center gap-2">
                <span className="text-[10px] text-neutral-500 w-14 shrink-0">{day.day.slice(5)}</span>
                <div className="flex-1 bg-[#272C33] rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#5ec1ca] transition-all"
                    style={{ width: `${(day.cost / maxDailyCost) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-neutral-400 w-14 text-right font-mono">{fmtCost(day.cost)}</span>
                <span className="text-[10px] text-neutral-600 w-8 text-right">{day.calls}</span>
              </div>
            ))}
            {data.dailyTrend.length === 0 && <div className="text-xs text-neutral-500">No cost data yet</div>}
          </div>
        </div>

        {/* Cost by model (donut-style bar breakdown) */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Cost by Model</h3>
          <div className="space-y-3">
            {data.byModel.map(m => {
              const pct = (m.cost / totalModelCost) * 100;
              const color = MODEL_COLORS[m.model] ?? '#888';
              return (
                <div key={m.model} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-200 truncate">{m.model.replace('claude-', '').replace('gpt-', '')}</span>
                    <span className="text-neutral-400 font-mono">{fmtCost(m.cost)} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-[#272C33] rounded-full h-3 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <span className="text-[10px] text-neutral-600 w-20 text-right">{fmtTokens(m.input_tokens + m.output_tokens)} tok</span>
                  </div>
                </div>
              );
            })}
            {data.byModel.length === 0 && <div className="text-xs text-neutral-500">No model data</div>}
          </div>
        </div>

        {/* Cost by call type */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Cost by Call Type</h3>
          <div className="space-y-2">
            {data.byCallType.map(ct => {
              const pct = data.totalCost > 0 ? (ct.cost / data.totalCost) * 100 : 0;
              return (
                <div key={ct.call_type} className="flex items-center gap-2">
                  <span className="text-xs text-neutral-300 w-28 truncate">{ct.call_type}</span>
                  <div className="flex-1 bg-[#272C33] rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/70 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-neutral-400 font-mono w-16 text-right">{fmtCost(ct.cost)}</span>
                  <span className="text-[10px] text-neutral-600 w-10 text-right">{ct.calls}</span>
                </div>
              );
            })}
            {data.byCallType.length === 0 && <div className="text-xs text-neutral-500">No call data</div>}
          </div>
          {data.avgCostPerDecision > 0 && (
            <div className="mt-3 pt-2 border-t border-[#3a424d] text-xs text-neutral-400">
              Avg cost per decision: <span className="font-mono text-neutral-200">{fmtCost(data.avgCostPerDecision)}</span>
            </div>
          )}
        </div>

        {/* Most expensive tickets */}
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
          <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Top 10 Expensive Tickets</h3>
          <div className="space-y-1">
            {data.topTickets.map((t, i) => (
              <div key={t.ticket_id} className="flex items-center gap-2 text-xs">
                <span className="text-neutral-600 w-4">{i + 1}.</span>
                <span className="text-[#5ec1ca] font-mono flex-1 truncate">{t.ticket_id}</span>
                <span className="text-neutral-400 font-mono w-16 text-right">{fmtCost(t.cost)}</span>
                <span className="text-neutral-600 w-12 text-right">{t.calls} calls</span>
              </div>
            ))}
            {data.topTickets.length === 0 && <div className="text-xs text-neutral-500">No ticket data</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CostCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-3">
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-semibold text-neutral-100 font-mono">{value}</div>
      {sub && <div className="text-[10px] text-neutral-500">{sub}</div>}
    </div>
  );
}
