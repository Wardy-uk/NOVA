import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { TeamAvailabilityWidget } from './TeamAvailabilityWidget.js';
import { FlaggedQueueView, type FlaggedTicket } from './FlaggedQueueView.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

// ── Types ──

interface AgentStatus {
  state: 'stopped' | 'running' | 'paused';
  shadowMode: boolean;
  shadowModeEnum?: 'full_shadow' | 'hybrid' | 'live';
  lastTickAt: string | null;
  tickCount: number;
  ticketsProcessed: number;
  intervalMs: number;
  errors: number;
  mode: 'full' | 'reduced';
  modeChangedAt: string | null;
  weekendOverrideUntil: string | null;
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
  ticket_subject: string | null;
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
  approval_status: string | null;
  shadow_mode: boolean;
  created_at: string;
  resolved_at: string | null;
  quick_win_type: string | null;
  quick_win_confidence: number | null;
  quick_win_executed: boolean;
  quick_win_undone: boolean;
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
  builtin: boolean;
  pattern?: string;
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
  id: number;
  category: string;
  suggested_title: string | null;
  frequency: number;
  first_seen: string;
  last_seen: string;
  ticket_ids: string;
  assigned_to: string | null;
  jira_ticket_key: string | null;
}

interface RiskFactor {
  id: string;
  label: string;
  score: number;
  detail?: string;
}

// FlaggedTicket type imported from FlaggedQueueView

interface FlaggedSummary {
  count: number;
  highestRisk: FlaggedTicket | null;
  avgScore: number;
}

// ── Helpers ──

const ZH_TRANSLATIONS: Array<[RegExp, string]> = [
  // Full sentences first — must match before fragments break them up
  [/您可能不具有相应权限，或是此工作项缺少必要信息。如果此问题依然存在，请联系您的 Jira 管理员。/g,
    'You may lack permissions, or the issue is missing required fields. Contact your Jira admin if this persists.'],
  [/无法移动.*缺少必要信息/g, 'Cannot transition — required fields are missing'],
  [/无法移动/g, 'Cannot transition this issue'],
  [/您无权在此项目中创建事务/g, 'No permission to create issues in this project'],
  [/您无权/g, 'Permission denied'],
  [/不具有相应权限/g, 'Insufficient permissions'],
  [/此工作项缺少必要信息/g, 'Required fields are missing'],
  [/如果此问题依然存在，?/g, 'If this problem persists, '],
  [/请联系您的 Jira 管理员/g, 'Contact your Jira administrator'],
];

function translateZh(text: string): string {
  if (!text) return text;
  let result = text;
  for (const [pattern, english] of ZH_TRANSLATIONS) {
    result = result.replace(pattern, english);
  }
  result = result.replace(/[一-鿿　-〿＀-￯]+[，。、；：！？]*/g, '').replace(/\s{2,}/g, ' ').trim();
  return result;
}

async function api(path: string, opts?: RequestInit) {
  const r = await fetch(`/api/agent${path}`, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: `Non-JSON response (${r.status})` }; }
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

async function kbApi(path: string, opts?: RequestInit) {
  const r = await fetch(`/api/kb-articles${path}`, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: `Non-JSON response (${r.status})` }; }
}

function kbApiJson(path: string, method: string, body: unknown) {
  return kbApi(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

const NO_ACTION_REASON_STYLES: Record<string, string> = {
  no_customer_action: 'bg-zinc-700/50 text-zinc-400',
  waiting_customer: 'bg-amber-900/40 text-amber-400',
  waiting_partner: 'bg-amber-900/40 text-amber-400',
  human_should_act: 'bg-red-900/40 text-red-400',
  defer_check_later: 'bg-blue-900/40 text-blue-400',
};

function getNoActionReason(d: Decision): string | null {
  try {
    const o = typeof d.output === 'string' ? JSON.parse(d.output) : d.output;
    return o?.no_action_reason ?? null;
  } catch { return null; }
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

const QW_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  spam: { bg: 'bg-red-600/20', text: 'text-red-400', label: 'Spam' },
  thank_you: { bg: 'bg-green-600/20', text: 'text-green-400', label: 'Thank You' },
  kba_match: { bg: 'bg-blue-600/20', text: 'text-blue-400', label: 'KBA Match' },
  stale_no_response: { bg: 'bg-orange-600/20', text: 'text-orange-400', label: 'Stale' },
  duplicate: { bg: 'bg-neutral-600/20', text: 'text-neutral-400', label: 'Duplicate' },
  auto_resolved: { bg: 'bg-teal-600/20', text: 'text-teal-400', label: 'Auto Resolved' },
};

function QuickWinBadge({ type }: { type: string }) {
  const badge = QW_BADGE[type];
  if (!badge) return null;
  return (
    <span className={`ml-1 px-1 py-0.5 rounded text-[8px] font-bold border ${badge.bg} ${badge.text} border-current/20`}>
      {badge.label}
    </span>
  );
}

// ── Main Component ──

function checkSuperAdmin(role: string): boolean {
  return role.split(',').map(r => r.trim()).includes('super_admin');
}

interface LifecycleBreakdown {
  [key: string]: number;
}

interface ApprovalHealth {
  pendingCount: number;
  oldestPendingMins: number | null;
  avgWaitMins: number | null;
  autoApprovedToday: number;
  escalatedToday: number;
}

export function AgentDashboardView({ userRole = '', onNavigateToWorkspace }: { userRole?: string; onNavigateToWorkspace?: (filter: { aiAction?: string }) => void }) {
  const isSuperAdmin = checkSuperAdmin(userRole);
  const [tab, setTab] = useState<'overview' | 'decisions' | 'guardrails' | 'providers' | 'autonomy' | 'alerts' | 'kb-gaps' | 'kb-index' | 'kb-health' | 'training-signals' | 'learning' | 'quick-actions' | 'costs' | 'flagged' | 'ai-improvement' | 'pipelines' | 'assignment' | 'predictions' | 'incidents' | 'sla-management'>('overview');
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
  const [flaggedTickets, setFlaggedTickets] = useState<FlaggedTicket[]>([]);
  const [flaggedSummary, setFlaggedSummary] = useState<FlaggedSummary | null>(null);
  const [lifecycleBreakdown, setLifecycleBreakdown] = useState<LifecycleBreakdown | null>(null);
  const [approvalHealth, setApprovalHealth] = useState<ApprovalHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        api('/status'),
        api('/stats'),
        api('/decisions?limit=50'),
        api('/alerts?limit=20'),
        api('/lifecycle/breakdown'),
        api('/lifecycle/approval-health'),
        api('/flagged/summary'),
      ]);
      const val = (i: number) => results[i].status === 'fulfilled' ? results[i].value : null;
      const sRes = val(0), stRes = val(1), dRes = val(2), aRes = val(3), lcRes = val(4), ahRes = val(5), fsRes = val(6);
      if (sRes?.ok) setStatus(sRes.data);
      if (stRes?.ok) setStats(stRes.data);
      if (dRes?.ok) setDecisions(dRes.data);
      if (aRes?.ok) setAlerts(aRes.data);
      if (lcRes?.ok) setLifecycleBreakdown(lcRes.data);
      if (ahRes?.ok) setApprovalHealth(ahRes.data);
      if (fsRes?.ok) setFlaggedSummary(fsRes.data);
      const allFailed = results.every(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.ok));
      setError(allFailed ? 'All agent endpoints failed — check server connection' : null);
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

  // Auto-navigate to pending approval decision from AI Approval Queue
  useEffect(() => {
    const pendingTicket = sessionStorage.getItem('agent_pending_ticket');
    if (pendingTicket && decisions.length > 0) {
      sessionStorage.removeItem('agent_pending_ticket');
      const match = decisions.find(d => d.ticket_id === pendingTicket && d.approval_required);
      if (match) {
        setTab('decisions');
        setSelected(match);
      }
    }
  }, [decisions]);

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
    if (tab === 'flagged') {
      api('/flagged').then(r => { if (r.ok) setFlaggedTickets(r.data); });
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
          {status && <StatusPill state={status.state} shadow={status.shadowMode} shadowEnum={status.shadowModeEnum} mode={status.mode} weekendOverrideUntil={status.weekendOverrideUntil} />}
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && status?.state === 'running' && (
            <div className="relative">
              {status.weekendOverrideUntil ? (
                <button onClick={async () => { const r = await api('/weekend-override', { method: 'DELETE' }); if (r.ok) setStatus(r.data); }} className="px-3 py-1 text-xs font-medium rounded bg-orange-600 hover:bg-orange-500 text-white transition-colors">
                  Clear Override
                </button>
              ) : (
                <button onClick={() => setOverrideOpen(o => !o)} className="px-3 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors">
                  Override Hours
                </button>
              )}
              {overrideOpen && <OverrideDropdown onSelect={async (until) => {
                setOverrideOpen(false);
                const r = await apiJson('/weekend-override', 'POST', { until: until.toISOString() });
                if (r.ok) setStatus(r.data);
              }} onClose={() => setOverrideOpen(false)} />}
            </div>
          )}
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
          { key: 'flagged', label: `Flagged${(flaggedSummary?.count ?? 0) > 0 ? ` (${flaggedSummary!.count})` : ''}` },
          { key: 'kb-gaps', label: 'KB Gaps' },
          { key: 'kb-index', label: 'KB Index' },
          { key: 'kb-health' as const, label: 'KB Health' },
          { key: 'training-signals' as const, label: 'Training' },
          { key: 'learning' as const, label: 'Learning' },
          { key: 'ai-improvement', label: 'AI Learning' },
          { key: 'quick-actions', label: 'Quick Actions' },
          { key: 'providers', label: 'Providers' },
          { key: 'assignment' as const, label: 'Assignment' },
          { key: 'predictions' as const, label: 'Predictions' },
          { key: 'incidents' as const, label: 'Incidents' },
          { key: 'sla-management' as const, label: 'SLA Mgmt' },
          ...(isSuperAdmin ? [{ key: 'pipelines' as const, label: 'Pipelines' }] : []),
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
      {tab === 'overview' && <OverviewTab status={status} stats={stats} decisions={decisions} onSelect={setSelected} onNavigateToWorkspace={onNavigateToWorkspace} lifecycleBreakdown={lifecycleBreakdown} approvalHealth={approvalHealth} flaggedSummary={flaggedSummary} onFlaggedClick={() => setTab('flagged')} />}
      {tab === 'decisions' && <DecisionsTab decisions={decisions} selected={selected} onSelect={setSelected} onRefresh={refresh} />}
      {tab === 'autonomy' && <AutonomyTab rules={autonomyRules} onRefresh={() => api('/autonomy').then(r => { if (r.ok) setAutonomyRules(r.data); })} isSuperAdmin={isSuperAdmin} />}
      {tab === 'guardrails' && <GuardrailsTab rules={guardrails} onToggle={toggleGuardrail} onRefresh={() => api('/guardrails').then(r => { if (r.ok) setGuardrails(r.data); })} />}
      {tab === 'alerts' && <AlertsTab alerts={alerts} onRefresh={() => api('/alerts?limit=100&includeAcknowledged=true').then(r => { if (r.ok) setAlerts(r.data); })} />}
      {tab === 'kb-gaps' && <KbGapsTab gaps={kbGaps} onRefresh={() => api('/kb-gaps').then(r => { if (r.ok) setKbGaps(r.data); })} />}
      {tab === 'kb-index' && <KbIndexTab />}
      {tab === 'ai-improvement' && <AiImprovementTab />}
      {tab === 'quick-actions' && <QuickActionsTab />}
      {tab === 'providers' && <ProvidersTab providers={providers} confHistory={confHistory} />}
      {tab === 'flagged' && (
        <div className="h-[calc(100vh-180px)] -mx-4 rounded-lg overflow-hidden border border-[#2f353d]">
          <FlaggedQueueView tickets={flaggedTickets} onRefresh={() => { api('/flagged').then(r => { if (r.ok) setFlaggedTickets(r.data); }); api('/flagged/summary').then(r => { if (r.ok) setFlaggedSummary(r.data); }); }} />
        </div>
      )}
      {tab === 'assignment' && <AssignmentTab isSuperAdmin={isSuperAdmin} />}
      {tab === 'predictions' && <PredictionsTab />}
      {tab === 'incidents' && <IncidentsTab />}
      {tab === 'sla-management' && <SlaManagementTab />}
      {tab === 'kb-health' && <KbHealthTab />}
      {tab === 'training-signals' && <TrainingSignalsTab />}
      {tab === 'learning' && <LearningTab />}
      {tab === 'pipelines' && <PipelinesTab />}
      {tab === 'costs' && <CostsTab data={costData} onPeriodChange={(days) => api(`/costs?days=${days}`).then(r => { if (r.ok) setCostData(r.data); })} />}

      {/* Detail panel */}
      {selected && <DecisionDetail decision={selected} onClose={() => setSelected(null)} onRefresh={() => { refresh(); setSelected(null); }} />}
    </div>
  );
}

// ── Sub-components ──

function StatusPill({ state, shadow, shadowEnum, mode, weekendOverrideUntil }: { state: string; shadow: boolean; shadowEnum?: string; mode?: 'full' | 'reduced'; weekendOverrideUntil?: string | null }) {
  const stateColor = state === 'running' ? 'bg-green-500' : state === 'paused' ? 'bg-amber-500' : 'bg-neutral-600';
  const modeLabel = shadowEnum === 'hybrid' ? 'Hybrid' : shadowEnum === 'live' ? 'Live' : shadow ? 'Shadow' : null;
  const modeColor = shadowEnum === 'hybrid'
    ? 'bg-amber-900/60 text-amber-300 border-amber-700/40'
    : shadowEnum === 'live'
    ? 'bg-green-900/60 text-green-300 border-green-700/40'
    : 'bg-purple-900/60 text-purple-300 border-purple-700/40';

  const formatOverrideUntil = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${dayNames[d.getDay()]} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${stateColor} text-white`}>
        <span className={`w-1.5 h-1.5 rounded-full ${state === 'running' ? 'animate-pulse bg-white' : 'bg-white/60'}`} />
        {state}
      </span>
      {modeLabel && (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${modeColor}`}>
          {modeLabel}
        </span>
      )}
      {state === 'running' && weekendOverrideUntil ? (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-orange-900/60 text-orange-300 border border-orange-700/40">
          Weekend override (until {formatOverrideUntil(weekendOverrideUntil)})
        </span>
      ) : state === 'running' && mode === 'reduced' ? (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-blue-900/60 text-blue-300 border border-blue-700/40">
          Reduced (out of hours)
        </span>
      ) : null}
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

function OverrideDropdown({ onSelect, onClose }: { onSelect: (until: Date) => void; onClose: () => void }) {
  const now = new Date();
  const presets: { label: string; getDate: () => Date }[] = [
    { label: '2 hours', getDate: () => new Date(now.getTime() + 2 * 3600_000) },
    { label: '4 hours', getDate: () => new Date(now.getTime() + 4 * 3600_000) },
    { label: 'End of today', getDate: () => { const d = new Date(now); d.setHours(23, 59, 0, 0); return d; } },
    { label: 'Monday 08:00', getDate: () => {
      const d = new Date(now);
      const daysUntilMon = ((8 - d.getDay()) % 7) || 7;
      d.setDate(d.getDate() + daysUntilMon);
      d.setHours(8, 0, 0, 0);
      return d;
    }},
  ];
  const [custom, setCustom] = useState('');
  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-[#2a2f36] border border-[#3a424d] rounded-lg shadow-xl p-2 min-w-[200px]" onClick={e => e.stopPropagation()}>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider px-2 py-1">Run full mode until</div>
      {presets.map(p => (
        <button key={p.label} onClick={() => onSelect(p.getDate())} className="block w-full text-left px-3 py-1.5 text-xs text-neutral-200 hover:bg-[#3a424d] rounded transition-colors">
          {p.label}
        </button>
      ))}
      <div className="border-t border-[#3a424d] mt-1 pt-1 px-2">
        <input type="datetime-local" value={custom} onChange={e => setCustom(e.target.value)} className="w-full text-xs bg-[#1e2228] border border-[#3a424d] rounded px-2 py-1 text-neutral-200" />
        {custom && (
          <button onClick={() => { const d = new Date(custom); if (!isNaN(d.getTime())) onSelect(d); }} className="mt-1 w-full text-xs bg-blue-600 hover:bg-blue-500 text-white rounded px-2 py-1 transition-colors">
            Set custom
          </button>
        )}
      </div>
      <button onClick={onClose} className="block w-full text-center text-[10px] text-neutral-500 hover:text-neutral-300 mt-1 py-1">Cancel</button>
    </div>
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

function OverviewTab({ status, stats, decisions, onSelect, onNavigateToWorkspace, lifecycleBreakdown, approvalHealth, flaggedSummary, onFlaggedClick }: {
  status: AgentStatus | null;
  stats: AgentStats | null;
  decisions: Decision[];
  onSelect: (d: Decision) => void;
  onNavigateToWorkspace?: (filter: { aiAction?: string }) => void;
  lifecycleBreakdown?: LifecycleBreakdown | null;
  approvalHealth?: ApprovalHealth | null;
  flaggedSummary?: FlaggedSummary | null;
  onFlaggedClick?: () => void;
}) {
  const lifecycleLabels: Record<string, string> = {
    new: 'New', triaged: 'Triaged', awaiting_approval: 'Awaiting Approval',
    response_sent: 'Response Sent', awaiting_customer: 'Awaiting Customer',
    customer_replied: 'Customer Replied', re_evaluating: 'Re-evaluating',
    resolved: 'Resolved', stale: 'Stale', chase_sent: 'Chase Sent',
    auto_close_candidate: 'Auto-close Candidate', closed: 'Closed',
  };
  const lifecycleColors: Record<string, string> = {
    new: '#60a5fa', triaged: '#5ec1ca', awaiting_approval: '#f59e0b',
    response_sent: '#22c55e', awaiting_customer: '#a78bfa',
    customer_replied: '#38bdf8', re_evaluating: '#f59e0b',
    resolved: '#22c55e', stale: '#ef4444', chase_sent: '#f97316',
    auto_close_candidate: '#ef4444', closed: '#6b7280',
  };

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
                  <div key={action}
                    onClick={() => onNavigateToWorkspace?.({ aiAction: action })}
                    className={`flex items-center justify-between text-xs ${onNavigateToWorkspace ? 'cursor-pointer hover:bg-[#363d47]/50 -mx-2 px-2 py-0.5 rounded transition-colors' : ''}`}>
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

      {/* Lifecycle Breakdown + Approval Health (WP-23b) */}
      {(lifecycleBreakdown || approvalHealth) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {lifecycleBreakdown && (
            <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
              <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Ticket Lifecycle</h3>
              <div className="space-y-1.5">
                {Object.entries(lifecycleBreakdown)
                  .filter(([, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([state, count]) => (
                    <div key={state} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: lifecycleColors[state] ?? '#6b7280' }} />
                        <span className="text-neutral-300">{lifecycleLabels[state] ?? state}</span>
                      </div>
                      <span className="text-neutral-400 font-mono">{count}</span>
                    </div>
                  ))}
                {Object.values(lifecycleBreakdown).every(v => v === 0) && (
                  <div className="text-xs text-neutral-500">No tickets tracked yet</div>
                )}
              </div>
            </div>
          )}

          {approvalHealth && (
            <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
              <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Approval Queue Health</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-neutral-500 mb-0.5">Pending</div>
                  <div className={`text-lg font-bold ${approvalHealth.pendingCount > 5 ? 'text-red-400' : approvalHealth.pendingCount > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                    {approvalHealth.pendingCount}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-0.5">Oldest Pending</div>
                  <div className="text-lg font-bold text-neutral-200">
                    {approvalHealth.oldestPendingMins != null ? `${approvalHealth.oldestPendingMins}m` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-0.5">Avg Wait</div>
                  <div className="text-neutral-200 font-semibold">
                    {approvalHealth.avgWaitMins != null ? `${approvalHealth.avgWaitMins}m` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500 mb-0.5">Today</div>
                  <div className="text-neutral-200 font-semibold">
                    <span className="text-green-400">{approvalHealth.autoApprovedToday}</span>
                    <span className="text-neutral-500 mx-1">auto</span>
                    <span className="text-amber-400">{approvalHealth.escalatedToday}</span>
                    <span className="text-neutral-500 ml-1">esc</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Flagged for Review summary */}
      {flaggedSummary && flaggedSummary.count > 0 && (
        <div onClick={onFlaggedClick} className="border border-red-800/40 rounded-lg bg-red-950/20 p-4 cursor-pointer hover:bg-red-950/30 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider">Flagged for Review</h3>
            <span className="text-[10px] text-neutral-500">Click to view</span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <div className="text-neutral-500 mb-0.5">Flagged</div>
              <div className="text-lg font-bold text-red-400">{flaggedSummary.count}</div>
            </div>
            <div>
              <div className="text-neutral-500 mb-0.5">Highest Risk</div>
              <div className="text-lg font-bold text-neutral-200">
                {flaggedSummary.highestRisk ? `${flaggedSummary.highestRisk.risk_score}/100` : '—'}
              </div>
              {flaggedSummary.highestRisk && (
                <div className="text-[10px] text-neutral-500 truncate">{flaggedSummary.highestRisk.ticket_key}</div>
              )}
            </div>
            <div>
              <div className="text-neutral-500 mb-0.5">Avg Score</div>
              <div className="text-lg font-bold text-neutral-200">{Math.round(flaggedSummary.avgScore)}</div>
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
              <span className="text-xs text-neutral-300 truncate flex-1" title={d.ticket_subject ?? ''}>{d.ticket_subject || actionLabel(d.action)}</span>
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

function DecisionsTab({ decisions: initialDecisions, selected, onSelect, onRefresh }: {
  decisions: Decision[];
  selected: Decision | null;
  onSelect: (d: Decision) => void;
  onRefresh: () => void;
}) {
  const PAGE_SIZE = 50;
  const [allDecisions, setAllDecisions] = useState<Decision[]>(initialDecisions);
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [declining, setDeclining] = useState(false);

  useEffect(() => { setAllDecisions(initialDecisions); }, [initialDecisions]);

  useEffect(() => {
    api(`/decisions?limit=1&offset=0`).then(r => { if (r.total != null) setTotal(r.total); });
  }, [initialDecisions]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await api(`/decisions?limit=${PAGE_SIZE}&offset=${allDecisions.length}`);
      if (res.ok && Array.isArray(res.data)) {
        setAllDecisions(prev => [...prev, ...res.data]);
        if (res.total != null) setTotal(res.total);
      }
    } finally { setLoadingMore(false); }
  };

  const isPendingApproval = (d: Decision) => d.approval_required && !d.shadow_mode && (!d.approval_status || d.approval_status === 'pending');

  useEffect(() => {
    if (!filter.startsWith('qw:')) return;
    const qwType = filter.slice(3);
    const param = qwType === 'all' ? 'all' : qwType;
    api(`/decisions?quick_win_type=${param}&limit=${PAGE_SIZE}&offset=0`).then(r => {
      if (r.ok && Array.isArray(r.data)) setAllDecisions(r.data);
    });
  }, [filter]);

  const filtered = filter === 'pending_approval'
    ? allDecisions.filter(isPendingApproval)
    : filter === 'all' ? allDecisions
    : filter.startsWith('qw:') ? allDecisions
    : allDecisions.filter(d => d.event_type === filter);
  const eventTypes = [...new Set(allDecisions.map(d => d.event_type))];
  const pendingCount = allDecisions.filter(isPendingApproval).length;

  const handleDeclineAll = async () => {
    if (!confirm(`Decline all ${pendingCount} pending approvals? This cannot be undone.`)) return;
    setDeclining(true);
    try {
      const r = await fetch('/api/approvals/bulk-decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Bulk declined from Decisions tab' }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      onRefresh();
    } catch (err: any) {
      alert(`Decline failed: ${err.message}`);
    } finally {
      setDeclining(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-[#272C33] border border-[#3a424d] text-neutral-300 text-xs rounded px-2 py-1"
        >
          <option value="all">All Events</option>
          <option value="pending_approval">Pending Approval{pendingCount > 0 ? ` (${pendingCount})` : ''}</option>
          {eventTypes.map(et => <option key={et} value={et}>{eventLabel(et)}</option>)}
          <optgroup label="Quick Wins">
            <option value="qw:all">All Quick Wins</option>
            <option value="qw:spam">Spam</option>
            <option value="qw:thank_you">Thank You</option>
            <option value="qw:kba_match">KBA Match</option>
            <option value="qw:stale_no_response">Stale / No Response</option>
            <option value="qw:duplicate">Duplicate</option>
            <option value="qw:auto_resolved">Auto Resolved</option>
          </optgroup>
        </select>
        {filter === 'pending_approval' && pendingCount > 0 && (
          <button
            onClick={handleDeclineAll}
            disabled={declining}
            className="text-xs px-2.5 py-1 rounded bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors disabled:opacity-50"
          >
            {declining ? 'Declining…' : `Decline All (${pendingCount})`}
          </button>
        )}
        <button onClick={onRefresh} className="text-xs text-[#5ec1ca] hover:text-[#7dd3d8] transition-colors">Refresh</button>
        <span className="text-[10px] text-neutral-600 ml-auto">{filtered.length} decisions</span>
      </div>

      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-3 py-2 font-medium w-14">Conf</th>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 font-medium">Subject</th>
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
                  <td className="px-3 py-2 text-neutral-300 max-w-[250px] truncate" title={d.ticket_subject ?? ''}>{d.ticket_subject ?? ''}</td>
                  <td className="px-3 py-2 text-neutral-400">
                    {eventLabel(d.event_type)}
                    {d.quick_win_type && d.quick_win_type !== 'none' && <QuickWinBadge type={d.quick_win_type} />}
                    {d.quick_win_executed && !d.quick_win_undone && <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold bg-emerald-600/30 text-emerald-300 border border-emerald-600/40">AUTO-CLOSED</span>}
                  </td>
                  <td className="px-3 py-2 text-neutral-200">
                    {actionLabel(d.action)}
                    {d.action === 'no_action' && getNoActionReason(d) && (
                      <span className={`ml-1.5 text-[9px] px-1 py-0.5 rounded ${NO_ACTION_REASON_STYLES[getNoActionReason(d)!] ?? 'bg-zinc-700/50 text-zinc-400'}`}>
                        {getNoActionReason(d)!.replace(/_/g, ' ')}
                      </span>
                    )}
                    {d.shadow_mode ? <span className="ml-1.5 text-[9px] text-purple-400 font-semibold">SHADOW</span> : null}
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{d.provider ?? '—'}/{d.model?.split('-').slice(-1)[0] ?? ''}</td>
                  <td className="px-3 py-2">
                    {outcome ? (
                      <span className={`text-[10px] ${outcome.success ? 'text-green-400' : 'text-red-400'}`}>
                        {outcome.success ? '✓' : '✗'} {translateZh((outcome.detail as string) ?? '').slice(0, 40)}
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
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-neutral-500">
          Showing {filtered.length} of {total ?? '?'} decisions
        </span>
        {total != null && allDecisions.length < total && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="text-xs px-3 py-1 rounded bg-[#272C33] border border-[#3a424d] text-[#5ec1ca] hover:bg-[#363d47] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading…' : `Load More (${allDecisions.length}/${total})`}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Decision Detail Panel ──

function DecisionDetail({ decision: d, onClose, onRefresh }: { decision: Decision; onClose: () => void; onRefresh: () => void }) {
  const inputs = safeJson(d.inputs);
  const output = safeJson(d.output);
  const outcome = d.outcome ? safeJson(d.outcome) : null;

  const isPendingApproval = d.approval_required && !d.shadow_mode && (!d.approval_status || d.approval_status === 'pending');
  const isShadowPending = d.shadow_mode && (!d.approval_status || d.approval_status === 'pending');
  const isResolved = d.approval_required && d.approval_status && d.approval_status !== 'pending';
  const isAnyPending = isPendingApproval || isShadowPending;

  const [approvalId, setApprovalId] = useState<number | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedResponse, setEditedResponse] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [comments, setComments] = useState<Array<{ jira_comment_id: string; author_display: string | null; body_text: string | null; is_public: boolean; jira_created: string }>>([]);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const loadComments = async () => {
    if (comments.length > 0) return;
    setCommentsLoading(true);
    try {
      const r = await fetch(`/api/agent/decisions/ticket-comments/${encodeURIComponent(d.ticket_id)}`);
      const data = await r.json();
      if (data.ok) setComments(data.data ?? []);
    } catch { /* ignore */ }
    setCommentsLoading(false);
  };

  useEffect(() => {
    if (!isAnyPending) return;
    setApprovalLoading(true);
    fetch(`/api/approvals/by-ticket/${encodeURIComponent(d.ticket_id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.data?.item) {
          setApprovalId(data.data.item.id);
          setEditedResponse(data.data.item.ai_response_adf || String(output?.draft_response ?? ''));
        }
      })
      .catch(() => {})
      .finally(() => setApprovalLoading(false));
  }, [d.ticket_id, isPendingApproval]);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const handleDecide = async (action: 'approve' | 'confirm' | 'execute' | 'decline', edited?: string) => {
    if (action === 'decline' && !declineReason.trim()) {
      showToast('A reason is required when declining');
      return;
    }
    setActing(true);
    try {
      let r: Response;
      if (approvalId && (action === 'approve' || action === 'decline')) {
        r = await fetch(`/api/approvals/${approvalId}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(edited ? { editedResponse: edited } : {}),
            ...(action === 'decline' ? { declineReason: declineReason.trim() } : {}),
          }),
        });
      } else {
        r = await fetch(`/api/agent/decisions/${d.id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(edited ? { editedResponse: edited } : {}),
            ...(action === 'decline' ? { declineReason: declineReason.trim() } : {}),
          }),
        });
      }
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      const msgs: Record<string, string> = {
        approve: 'Approved — action will execute',
        confirm: 'Confirmed correct — learning recorded',
        execute: 'Executed — action posted to Jira',
        decline: 'Declined — no action taken',
      };
      showToast(msgs[action] || 'Done');
      setTimeout(onRefresh, 800);
    } catch (err: any) {
      showToast(`Error: ${err.message}`);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-[#2f353d] border border-[#3a424d] rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto">
        {toast && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-60 px-4 py-2 rounded bg-[#272C33] border border-[#3a424d] text-xs text-neutral-200 shadow-lg">
            {toast}
          </div>
        )}
        <div className="sticky top-0 bg-[#2f353d] border-b border-[#3a424d] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[#5ec1ca] font-mono font-semibold">{d.ticket_id}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${confidenceBadge(d.confidence)}`}>
              {(d.confidence * 100).toFixed(0)}%
            </span>
            <span className="text-xs text-neutral-400">{eventLabel(d.event_type)} → {actionLabel(d.action)}</span>
            {d.shadow_mode && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-900/60 text-purple-300 border border-purple-700/40">SHADOW</span>}
            {isPendingApproval && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-900/60 text-amber-300 border border-amber-700/40">PENDING APPROVAL</span>}
            {isShadowPending && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-900/60 text-purple-300 border border-purple-700/40">SHADOW — REVIEW</span>}
            {isResolved && <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
              d.approval_status === 'approved' ? 'bg-green-900/60 text-green-300 border-green-700/40' :
              d.approval_status === 'confirmed' ? 'bg-blue-900/60 text-blue-300 border-blue-700/40' :
              d.approval_status === 'executed' ? 'bg-green-900/60 text-green-300 border-green-700/40' :
              d.approval_status === 'declined' ? 'bg-red-900/60 text-red-300 border-red-700/40' :
              'bg-neutral-800 text-neutral-400 border-neutral-600'
            }`}>{d.approval_status === 'executed' ? 'EXECUTED [OVERRIDE]' : d.approval_status!.toUpperCase()}</span>}
            {d.quick_win_type && d.quick_win_type !== 'none' && <QuickWinBadge type={d.quick_win_type} />}
            {d.quick_win_executed && !d.quick_win_undone && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-900/60 text-emerald-300 border border-emerald-700/40">AUTO-CLOSED</span>}
            {d.quick_win_undone && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-neutral-800 text-neutral-400 border border-neutral-600">UNDONE</span>}
            {(d as any).critic_approved === true && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-green-900/40 text-green-400 border border-green-700/30">Critic: approved</span>}
            {(d as any).critic_approved === false && <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-900/40 text-red-400 border border-red-700/30" title={(d as any).critic_reason}>Critic: blocked</span>}
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-lg">✕</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Quick-win undo */}
          {d.quick_win_executed && !d.quick_win_undone && (
            <div className="border border-emerald-700/40 bg-emerald-900/20 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-emerald-300">Auto-Closed — {QW_BADGE[d.quick_win_type!]?.label ?? d.quick_win_type}</div>
                <div className="text-[10px] text-neutral-400 mt-1">Confidence: {((d.quick_win_confidence ?? 0) * 100).toFixed(0)}%</div>
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Undo this auto-close? The ticket will be reopened in Jira.')) return;
                  setActing(true);
                  try {
                    const r = await fetch(`/api/agent/decisions/${d.id}/undo-close`, { method: 'POST' });
                    const data = await r.json();
                    showToast(data.ok ? 'Auto-close undone — ticket reopened' : `Undo failed: ${data.error}`);
                    if (data.ok) setTimeout(onRefresh, 800);
                  } catch (err: any) {
                    showToast(`Error: ${err.message}`);
                  } finally { setActing(false); }
                }}
                disabled={acting}
                className="px-3 py-1.5 text-xs rounded font-medium bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/30 transition-colors disabled:opacity-50"
              >
                {acting ? 'Undoing…' : 'Undo Close'}
              </button>
            </div>
          )}

          {/* Approval Actions — non-shadow */}
          {isPendingApproval && !approvalLoading && (
            <div className="border border-amber-700/40 bg-amber-900/20 rounded-lg p-4 space-y-3">
              <div className="text-xs font-semibold text-amber-300">Approval Required</div>

              {!editMode && !showDeclineInput && (
                <div className="flex items-center gap-2">
                  <button onClick={() => handleDecide('approve')} disabled={acting}
                    className="px-3 py-1.5 text-xs rounded font-medium bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors disabled:opacity-50">
                    {acting ? 'Processing…' : 'Approve'}
                  </button>
                  <button onClick={() => setShowDeclineInput(true)} disabled={acting}
                    className="px-3 py-1.5 text-xs rounded font-medium bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors disabled:opacity-50">
                    Decline
                  </button>
                  {output?.draft_response ? (
                    <button onClick={() => { setEditMode(true); if (!editedResponse) setEditedResponse(String(output.draft_response)); }} disabled={acting}
                      className="px-3 py-1.5 text-xs rounded font-medium bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/30 transition-colors disabled:opacity-50">
                      Approve with Edits
                    </button>
                  ) : null}
                </div>
              )}

              {showDeclineInput && (
                <div className="space-y-2">
                  <textarea
                    value={declineReason}
                    onChange={e => setDeclineReason(e.target.value)}
                    placeholder="Reason for declining (required)…"
                    className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-2 resize-y min-h-[60px] focus:outline-none focus:border-red-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDecide('decline')} disabled={acting || !declineReason.trim()}
                      className="px-3 py-1.5 text-xs rounded font-medium bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors disabled:opacity-50">
                      {acting ? 'Processing…' : 'Confirm Decline'}
                    </button>
                    <button onClick={() => { setShowDeclineInput(false); setDeclineReason(''); }}
                      className="px-3 py-1.5 text-xs rounded font-medium text-neutral-400 hover:text-neutral-200 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {editMode && (
                <div className="space-y-2">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Edit Draft Response</div>
                  <textarea
                    value={editedResponse}
                    onChange={e => setEditedResponse(e.target.value)}
                    className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-3 resize-y min-h-[120px] font-mono focus:outline-none focus:border-amber-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDecide('approve', editedResponse)} disabled={acting || !editedResponse.trim()}
                      className="px-3 py-1.5 text-xs rounded font-medium bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/30 transition-colors disabled:opacity-50">
                      {acting ? 'Processing…' : 'Approve with Edits'}
                    </button>
                    <button onClick={() => setEditMode(false)}
                      className="px-3 py-1.5 text-xs rounded font-medium text-neutral-400 hover:text-neutral-200 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Shadow Decision Actions — confirm/execute/decline */}
          {isShadowPending && !approvalLoading && (
            <div className="border border-purple-700/40 bg-purple-900/20 rounded-lg p-4 space-y-3">
              <div className="text-xs font-semibold text-purple-300">Shadow Decision — Was this correct?</div>

              {!editMode && !showDeclineInput && (
                <div className="flex items-center gap-2">
                  <button onClick={() => handleDecide('confirm')} disabled={acting}
                    className="px-3 py-1.5 text-xs rounded font-medium bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors disabled:opacity-50"
                    title="AI was correct — record as learning, no Jira action">
                    {acting ? 'Processing…' : 'Confirm Correct'}
                  </button>
                  <button onClick={() => { if (!editedResponse && output?.draft_response) setEditedResponse(String(output.draft_response)); handleDecide('execute'); }} disabled={acting}
                    className="px-3 py-1.5 text-xs rounded font-medium bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 transition-colors disabled:opacity-50"
                    title="AI was correct — execute the action on Jira now">
                    {acting ? 'Processing…' : 'Execute Action'}
                  </button>
                  {output?.draft_response ? (
                    <button onClick={() => { setEditMode(true); if (!editedResponse) setEditedResponse(String(output.draft_response)); }} disabled={acting}
                      className="px-3 py-1.5 text-xs rounded font-medium bg-amber-600/20 text-amber-400 border border-amber-600/30 hover:bg-amber-600/30 transition-colors disabled:opacity-50"
                      title="Edit the draft before executing on Jira">
                      Edit & Execute
                    </button>
                  ) : null}
                  <button onClick={() => setShowDeclineInput(true)} disabled={acting}
                    className="px-3 py-1.5 text-xs rounded font-medium bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors disabled:opacity-50">
                    Decline
                  </button>
                </div>
              )}

              {showDeclineInput && (
                <div className="space-y-2">
                  <textarea
                    value={declineReason}
                    onChange={e => setDeclineReason(e.target.value)}
                    placeholder="Reason for declining (required)…"
                    className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-2 resize-y min-h-[60px] focus:outline-none focus:border-red-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDecide('decline')} disabled={acting || !declineReason.trim()}
                      className="px-3 py-1.5 text-xs rounded font-medium bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/30 transition-colors disabled:opacity-50">
                      {acting ? 'Processing…' : 'Confirm Decline'}
                    </button>
                    <button onClick={() => { setShowDeclineInput(false); setDeclineReason(''); }}
                      className="px-3 py-1.5 text-xs rounded font-medium text-neutral-400 hover:text-neutral-200 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {editMode && (
                <div className="space-y-2">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Edit Draft Response Before Executing</div>
                  <textarea
                    value={editedResponse}
                    onChange={e => setEditedResponse(e.target.value)}
                    className="w-full bg-[#272C33] border border-[#3a424d] text-neutral-200 text-xs rounded p-3 resize-y min-h-[120px] font-mono focus:outline-none focus:border-amber-500/50"
                  />
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDecide('execute', editedResponse)} disabled={acting || !editedResponse.trim()}
                      className="px-3 py-1.5 text-xs rounded font-medium bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 transition-colors disabled:opacity-50">
                      {acting ? 'Processing…' : 'Execute with Edits'}
                    </button>
                    <button onClick={() => setEditMode(false)}
                      className="px-3 py-1.5 text-xs rounded font-medium text-neutral-400 hover:text-neutral-200 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {isAnyPending && approvalLoading && (
            <div className="text-xs text-neutral-500">Loading approval details…</div>
          )}

          {/* Reasoning */}
          <Section title="Reasoning Trace">
            <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed">{d.reasoning}</pre>
          </Section>

          {/* Comment History */}
          <div className="px-6 py-3 border-t border-[#3a424d]">
            <button
              onClick={() => { setCommentsExpanded(!commentsExpanded); if (!commentsExpanded) loadComments(); }}
              className="text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1"
            >
              <span className="text-[10px]">{commentsExpanded ? '▼' : '▶'}</span>
              Ticket Comments {comments.length > 0 ? `(${comments.length})` : ''}
            </button>
            {commentsExpanded && (
              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
                {commentsLoading && <div className="text-xs text-neutral-500 animate-pulse">Loading comments...</div>}
                {!commentsLoading && comments.length === 0 && (
                  <div className="text-xs text-neutral-500">No comments found in cache</div>
                )}
                {comments.map(c => (
                  <div key={c.jira_comment_id} className="p-2 bg-[#272C33] rounded text-xs border border-[#3a424d]/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-neutral-200">{c.author_display ?? 'Unknown'}</span>
                      <div className="flex items-center gap-2">
                        {!c.is_public && <span className="text-[9px] px-1.5 py-0.5 bg-amber-900/40 text-amber-400 rounded">Internal</span>}
                        <span className="text-neutral-500">{new Date(c.jira_created).toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-neutral-300 whitespace-pre-wrap break-words">{c.body_text ?? '(empty)'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outcome */}
          {outcome && (
            <Section title="Outcome">
              <div className={`text-xs ${outcome.success ? 'text-green-400' : 'text-red-400'}`}>
                {outcome.success ? '✓ Success' : '✗ Failed'}: {translateZh(String(outcome.detail ?? ''))}
                {outcome.error ? <div className="mt-1 text-red-500">{translateZh(String(outcome.error))}</div> : null}
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
                  <div className="text-xs text-neutral-300 bg-[#272C33] rounded p-3 whitespace-pre-wrap">{typeof output.internal_note === 'string' ? output.internal_note : (output.internal_note as any)?.summary ?? JSON.stringify(output.internal_note, null, 2)}</div>
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
              <div><span className="text-neutral-500">Approval Status:</span> <span className="text-neutral-300 ml-1">{d.approval_status ?? 'N/A'}</span></div>
              <div><span className="text-neutral-500">Shadow Mode:</span> <span className="text-neutral-300 ml-1">{d.shadow_mode ? 'Yes' : 'No'}</span></div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Suggestion types + component ──

interface SuggestionItem {
  id: number;
  type: 'guardrail' | 'autonomy';
  suggestionKey: string;
  suggestion: { action: string; title: string; description: string; [k: string]: unknown };
  evidence: Record<string, unknown>;
  status: string;
  createdAt: string;
  verdict?: { verdict: 'apply' | 'wait' | 'skip'; headline: string; reason: string };
  bodyText?: string;
}

const VERDICT_CONFIG = {
  apply: { label: 'Apply', border: 'border-green-700/50', bg: 'bg-green-950/30', text: 'text-green-400', badgeBg: 'bg-green-700/60', badgeBorder: 'border-green-600/40' },
  wait:  { label: 'Wait',  border: 'border-amber-700/50', bg: 'bg-amber-950/30', text: 'text-amber-400', badgeBg: 'bg-amber-700/50', badgeBorder: 'border-amber-600/40' },
  skip:  { label: 'Skip',  border: 'border-red-700/50',   bg: 'bg-red-950/30',   text: 'text-red-400',   badgeBg: 'bg-red-800/50',   badgeBorder: 'border-red-700/40' },
} as const;

function RiskPill({ riskFlag }: { riskFlag: unknown }) {
  if (!riskFlag || typeof riskFlag !== 'string') return null;
  const lower = riskFlag.toLowerCase();
  if (lower.includes('declined')) {
    return <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full bg-red-900/50 text-red-300 border border-red-800/40">{riskFlag}</span>;
  }
  return <span className="px-2 py-0.5 text-[9px] font-semibold rounded-full bg-amber-900/50 text-amber-300 border border-amber-800/40">{riskFlag}</span>;
}

function VerdictCard({ s, onApply, onDismiss, onSnooze, onCustomize }: {
  s: SuggestionItem;
  onApply: (id: number) => void;
  onDismiss: (id: number) => void;
  onSnooze: (id: number) => void;
  onCustomize?: (s: SuggestionItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const v = s.verdict;
  const ev = s.evidence || {};
  const cfg = v ? VERDICT_CONFIG[v.verdict] : null;
  const category = String(s.suggestion.category ?? s.evidence.category ?? 'Unknown');
  const riskFlag = ev.riskFlag;

  const actionBreakdown = ev.actionBreakdown as Record<string, number> | undefined;
  const exampleTickets = [...new Set(ev.exampleTickets as string[] | undefined ?? [])];
  const statKeys = Object.entries(ev).filter(([k]) => !['sampleTickets', 'actionBreakdown', 'exampleTickets', 'riskFlag', 'proposedRule', 'category',
    'approvalRate', 'avgConfidence', 'approvedCount', 'declinedCount', 'estimatedWeeklySavings'].includes(k));
  const hasDetail = exampleTickets.length > 0 || statKeys.length > 0;

  return (
    <div className={`rounded-lg bg-[#272C33] overflow-hidden border ${cfg ? cfg.border : 'border-[#3a424d]'}`}>
      <div className={`px-4 py-3 ${cfg ? cfg.bg : 'bg-[#2a3040]'} flex items-start gap-3`}>
        {cfg && v ? (
          <>
            <span className={`shrink-0 mt-0.5 px-3 py-1 text-xs font-bold rounded ${cfg.badgeBg} ${cfg.text} border ${cfg.badgeBorder}`}>
              {cfg.label}
            </span>
            <div className="min-w-0 flex-1">
              <span className={`text-sm font-semibold ${cfg.text}`}>{v.headline}</span>
              <div className="text-xs text-neutral-400 mt-0.5">{category}</div>
              <div className="text-[11px] text-neutral-300 leading-relaxed mt-1">
                {v.reason}
              </div>
            </div>
          </>
        ) : (
          <span className="text-xs text-neutral-300 font-medium">{s.suggestion.title}</span>
        )}
      </div>

      {ev.proposedRule && (
        <div className="mx-4 mt-1 mb-2 px-3 py-2 rounded bg-[#1e2530] border border-[#3a424d]/60 text-xs text-neutral-200 font-mono">
          {ev.proposedRule as string}
        </div>
      )}

      {(ev.approvalRate !== undefined || ev.avgConfidence !== undefined || ev.approvedCount !== undefined || (ev.estimatedWeeklySavings !== undefined && Number(ev.estimatedWeeklySavings) > 0)) && (
        <div className="px-4 flex flex-wrap gap-2 text-[10px]">
          {ev.approvalRate !== undefined && (
            <span className={`px-2 py-0.5 rounded-full border ${
              Number(ev.approvalRate) >= 95 ? 'bg-green-950/40 text-green-400 border-green-800/30' :
              Number(ev.approvalRate) >= 80 ? 'bg-amber-950/40 text-amber-400 border-amber-800/30' :
              'bg-red-950/40 text-red-400 border-red-800/30'
            }`}>
              {ev.approvalRate}% approved
            </span>
          )}
          {ev.avgConfidence !== undefined && (
            <span className={`px-2 py-0.5 rounded-full border ${
              Number(ev.avgConfidence) >= 85 ? 'bg-green-950/40 text-green-400 border-green-800/30' :
              Number(ev.avgConfidence) >= 75 ? 'bg-amber-950/40 text-amber-400 border-amber-800/30' :
              'bg-red-950/40 text-red-400 border-red-800/30'
            }`}>
              {ev.avgConfidence}% avg confidence
            </span>
          )}
          {ev.approvedCount !== undefined && (
            <span className="px-2 py-0.5 rounded-full bg-[#363d47] text-neutral-400 border border-[#3a424d]/50">
              {ev.approvedCount} approved / {ev.declinedCount ?? 0} declined
            </span>
          )}
          {ev.estimatedWeeklySavings !== undefined && Number(ev.estimatedWeeklySavings) > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-blue-950/40 text-blue-400 border border-blue-900/30">
              ~{ev.estimatedWeeklySavings}/week saved
            </span>
          )}
        </div>
      )}

      {actionBreakdown && Object.keys(actionBreakdown).length > 0 && (
        <div className="px-4 flex flex-wrap gap-1.5 items-center">
          <span className="text-[9px] text-neutral-500 mr-1">Actions:</span>
          {Object.entries(actionBreakdown).sort((a, b) => b[1] - a[1]).map(([action, cnt]) => (
            <span key={action} className="text-[9px] px-1.5 py-0.5 rounded bg-blue-950/40 text-blue-400 border border-blue-900/30">
              {action} ({cnt})
            </span>
          ))}
        </div>
      )}

      <div className="px-4 py-3 space-y-3">
        <RiskPill riskFlag={riskFlag} />

        {s.bodyText && (
          <div className="text-[11px] text-neutral-400 leading-relaxed whitespace-pre-line">{s.bodyText}</div>
        )}

        <div className="flex items-center gap-2">
          {v?.verdict === 'apply' && (
            <>
              {onCustomize && typeof s.suggestion.category === 'string' ? (
                <button onClick={() => onCustomize(s)}
                  className="px-3 py-1.5 text-[10px] font-semibold rounded bg-green-700/60 text-green-300 hover:bg-green-600/60 border border-green-600/40 transition-colors">
                  Apply suggestion…
                </button>
              ) : (
                <button onClick={() => onApply(s.id)}
                  className="px-3 py-1.5 text-[10px] font-semibold rounded bg-green-700/60 text-green-300 hover:bg-green-600/60 border border-green-600/40 transition-colors">
                  Apply
                </button>
              )}
              <button onClick={() => onDismiss(s.id)}
                className="px-3 py-1.5 text-[10px] font-medium rounded text-neutral-500 hover:text-neutral-400 transition-colors">
                Dismiss
              </button>
            </>
          )}
          {v?.verdict === 'wait' && (
            <>
              <button onClick={() => onSnooze(s.id)}
                className="px-3 py-1.5 text-[10px] font-semibold rounded bg-amber-700/40 text-amber-300 hover:bg-amber-600/40 border border-amber-600/30 transition-colors">
                Re-check in 2 weeks
              </button>
              <button onClick={() => onApply(s.id)}
                className="px-3 py-1.5 text-[10px] font-medium rounded bg-neutral-800/50 text-neutral-400 hover:bg-neutral-700/50 border border-neutral-700/40 transition-colors">
                Apply anyway
              </button>
              <button onClick={() => onDismiss(s.id)}
                className="px-3 py-1.5 text-[10px] font-medium rounded text-neutral-500 hover:text-neutral-400 transition-colors">
                Dismiss
              </button>
            </>
          )}
          {v?.verdict === 'skip' && (
            <>
              <button onClick={() => onDismiss(s.id)}
                className="px-3 py-1.5 text-[10px] font-semibold rounded bg-red-800/40 text-red-300 hover:bg-red-700/40 border border-red-700/30 transition-colors">
                Dismiss
              </button>
              <button onClick={() => onApply(s.id)}
                className="px-3 py-1.5 text-[10px] font-medium rounded bg-neutral-800/50 text-neutral-400 hover:bg-neutral-700/50 border border-neutral-700/40 transition-colors">
                Apply anyway
              </button>
              <button onClick={() => onSnooze(s.id)}
                className="px-3 py-1.5 text-[10px] font-medium rounded text-neutral-500 hover:text-neutral-400 transition-colors">
                Re-check later
              </button>
            </>
          )}
          {!v && (
            <>
              <button onClick={() => onApply(s.id)}
                className="px-3 py-1.5 text-[10px] font-semibold rounded bg-green-700/60 text-green-300 hover:bg-green-600/60 border border-green-600/40 transition-colors">
                Apply
              </button>
              <button onClick={() => onDismiss(s.id)}
                className="px-3 py-1.5 text-[10px] font-medium rounded bg-neutral-800/50 text-neutral-400 hover:bg-neutral-700/50 border border-neutral-700/40 transition-colors">
                Dismiss
              </button>
            </>
          )}
        </div>

        {hasDetail && (
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] text-neutral-500 hover:text-neutral-400 transition-colors">
            <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''}`}>{'▸'}</span>
            <span>Stats &amp; evidence</span>
          </button>
        )}

        {expanded && hasDetail && (
          <div className="pt-2.5 border-t border-[#3a424d] space-y-2">
            {statKeys.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                {statKeys.map(([k, val]) => (
                  <div key={k} className="flex justify-between text-[9px]">
                    <span className="text-neutral-500">{k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}</span>
                    <span className="text-neutral-400 font-mono">{String(val)}</span>
                  </div>
                ))}
              </div>
            )}
            {exampleTickets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-[9px] text-neutral-500">Recent:</span>
                {exampleTickets.map(t => (
                  <a key={t} href={`https://nurturtech.atlassian.net/browse/${t}`} target="_blank" rel="noopener noreferrer"
                    className="text-[9px] px-1.5 py-0.5 rounded bg-[#363d47] text-blue-400 hover:text-blue-300 font-mono transition-colors">
                    {t}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionSkeleton() {
  return (
    <div className="rounded-lg bg-[#272C33] border border-[#3a424d] overflow-hidden animate-pulse">
      <div className="px-4 py-3 bg-[#2a3040] flex items-start gap-3">
        <div className="w-14 h-6 rounded bg-[#363d47]" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-2/5 rounded bg-[#363d47]" />
          <div className="h-2.5 w-4/5 rounded bg-[#363d47]" />
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="h-2.5 w-3/4 rounded bg-[#363d47]" />
        <div className="h-6 w-28 rounded bg-[#363d47]" />
      </div>
    </div>
  );
}

function SuggestionCards({ type, onRulesChanged, onCustomize, emptyMessage }: {
  type: 'guardrail' | 'autonomy';
  onRulesChanged: () => void;
  onCustomize?: (suggestion: SuggestionItem) => void;
  emptyMessage?: string;
}) {
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api(`/suggestions?type=${type}`);
    if (res.ok) setItems(res.data);
    setLoading(false);
  }, [type]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await api('/suggestions/refresh', { method: 'POST' });
    await load();
    setRefreshing(false);
  };

  const apply = async (id: number) => {
    const res = await api(`/suggestions/${id}/apply`, { method: 'POST' });
    if (res.ok) { await load(); onRulesChanged(); }
  };

  const dismiss = async (id: number) => {
    await api(`/suggestions/${id}/dismiss`, { method: 'POST' });
    setItems(prev => prev.filter(s => s.id !== id));
  };

  const snooze = async (id: number) => {
    await api(`/suggestions/${id}/snooze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 14 }) });
    setItems(prev => prev.filter(s => s.id !== id));
  };

  return (
    <div className="space-y-2 mt-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">AI Suggestions</div>
        <button onClick={refresh} disabled={refreshing}
          className="text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-50">
          {refreshing ? 'Analysing…' : 'Refresh'}
        </button>
      </div>
      {loading ? (
        <div className="space-y-2">
          <SuggestionSkeleton />
          <SuggestionSkeleton />
        </div>
      ) : items.length === 0 ? (
        <div className="text-[11px] text-neutral-500 py-4 text-center">
          {emptyMessage ?? 'No suggestions yet.'}
        </div>
      ) : (() => {
        const actionable = items.filter(s => s.verdict?.verdict !== 'wait');
        const waitCount = items.length - actionable.length;
        return <>
          {actionable.length === 0 && waitCount > 0 ? (
            <div className="text-[11px] text-neutral-500 py-3 text-center">{waitCount} {waitCount === 1 ? 'category' : 'categories'} gathering data — nothing to action yet.</div>
          ) : (
            <>
              {actionable.map(s => (
                <VerdictCard key={s.id} s={s} onApply={apply} onDismiss={dismiss} onSnooze={snooze} onCustomize={onCustomize} />
              ))}
              {waitCount > 0 && (
                <div className="text-[10px] text-neutral-500 py-1">{waitCount} more {waitCount === 1 ? 'category' : 'categories'} gathering data</div>
              )}
            </>
          )}
        </>;
      })()}
    </div>
  );
}

// ── Guardrails Tab ──

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
}

function validateRegex(pattern: string): string | null {
  if (!pattern.trim()) return null;
  try { new RegExp(pattern, 'i'); return null; } catch (e) { return e instanceof Error ? e.message : 'Invalid regex'; }
}

function GuardrailsTab({ rules, onToggle, onRefresh }: { rules: GuardrailRule[]; onToggle: (id: string, enabled: boolean) => void; onRefresh: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formId, setFormId] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formSeverity, setFormSeverity] = useState<'block' | 'warn'>('block');
  const [formPattern, setFormPattern] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const regexError = validateRegex(formPattern);

  const resetForm = () => { setShowForm(false); setEditingId(null); setFormId(''); setFormDesc(''); setFormSeverity('block'); setFormPattern(''); setFormError(null); };

  const onDescChange = (val: string) => {
    setFormDesc(val);
    if (!editingId) setFormId(slugify(val));
  };

  const startEdit = (r: GuardrailRule) => {
    setEditingId(r.id); setFormId(r.id); setFormDesc(r.description); setFormSeverity(r.severity as 'block' | 'warn'); setFormPattern(r.pattern ?? ''); setShowForm(true); setFormError(null);
  };

  const handleSave = async () => {
    if (!formId.trim() || !formDesc.trim() || !formPattern.trim()) { setFormError('All fields are required'); return; }
    if (regexError) { setFormError(`Invalid regex: ${regexError}`); return; }
    setSaving(true); setFormError(null);
    const body = { id: formId.trim(), description: formDesc.trim(), severity: formSeverity, pattern: formPattern.trim(), enabled: true };
    const res = editingId
      ? await api(`/guardrails/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await api('/guardrails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setSaving(false);
    if (res.ok) { onRefresh(); resetForm(); } else { setFormError(res.error ?? 'Failed to save rule'); }
  };

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) { setConfirmDelete(id); return; }
    setConfirmDelete(null);
    const res = await api(`/guardrails/${id}`, { method: 'DELETE' });
    if (res.ok) onRefresh();
  };

  const builtinRules = rules.filter(r => r.builtin);
  const customRules = rules.filter(r => !r.builtin);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Guardrails are validated on every agent decision before execution. Blocked rules prevent the action entirely.
        </p>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0">
          + Add Rule
        </button>
      </div>

      {showForm && (
        <div className="border border-blue-800/50 rounded-lg bg-[#1e2530] p-4 space-y-3">
          <div className="text-xs font-medium text-neutral-300">{editingId ? 'Edit Rule' : 'New Custom Rule'}</div>
          <div>
            <label className="text-[10px] text-neutral-500 block mb-1">Description</label>
            <input value={formDesc} onChange={e => onDescChange(e.target.value)} placeholder="Human-readable description of what this rule catches"
              className="w-full px-2 py-1.5 text-[11px] rounded bg-[#2a303a] border border-[#3a424d] text-neutral-200 focus:border-blue-600 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-neutral-500 block mb-1">Rule ID (auto-generated)</label>
              <input value={formId} onChange={e => setFormId(e.target.value)} disabled={!!editingId} placeholder="auto_from_description"
                className="w-full px-2 py-1.5 text-[11px] rounded bg-[#2a303a] border border-[#3a424d] text-neutral-200 font-mono focus:border-blue-600 outline-none disabled:opacity-50" />
            </div>
            <div>
              <label className="text-[10px] text-neutral-500 block mb-1">Severity</label>
              <select value={formSeverity} onChange={e => setFormSeverity(e.target.value as 'block' | 'warn')}
                className="w-full px-2 py-1.5 text-[11px] rounded bg-[#2a303a] border border-[#3a424d] text-neutral-200 focus:border-blue-600 outline-none">
                <option value="block">BLOCK</option>
                <option value="warn">WARN</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-neutral-500 block mb-1">Pattern (regex, matched against draft response)</label>
            <input value={formPattern} onChange={e => setFormPattern(e.target.value)} placeholder="e.g. \b(password|secret|credential)\b"
              className={`w-full px-2 py-1.5 text-[11px] rounded bg-[#2a303a] border text-neutral-200 font-mono outline-none ${regexError ? 'border-red-600' : 'border-[#3a424d] focus:border-blue-600'}`} />
            {regexError && <div className="text-[9px] text-red-400 mt-0.5">{regexError}</div>}
            {formPattern && !regexError && <div className="text-[9px] text-green-400 mt-0.5">Valid regex</div>}
          </div>
          {formError && <div className="text-[10px] text-red-400">{formError}</div>}
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving || !!regexError} className="px-3 py-1.5 text-[11px] font-medium rounded bg-green-700 hover:bg-green-600 text-white transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
            </button>
            <button onClick={resetForm} className="px-3 py-1.5 text-[11px] font-medium rounded bg-neutral-700 hover:bg-neutral-600 text-neutral-300 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <th className="px-4 py-2 font-medium w-10">On</th>
              <th className="px-4 py-2 font-medium">Rule</th>
              <th className="px-4 py-2 font-medium w-20">Type</th>
              <th className="px-4 py-2 font-medium w-20">Severity</th>
              <th className="px-4 py-2 font-medium w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {builtinRules.map(r => (
              <tr key={r.id} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2">
                  <button onClick={() => onToggle(r.id, !r.enabled)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${r.enabled ? 'bg-green-600' : 'bg-neutral-700'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${r.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-neutral-200 text-xs">{r.description}</div>
                  <div className="text-[10px] text-neutral-600 font-mono mt-0.5">{r.id}</div>
                </td>
                <td className="px-4 py-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-500 border border-neutral-700/50 font-medium">BUILT-IN</span>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-[10px] font-semibold uppercase ${r.severity === 'block' ? 'text-red-400' : 'text-amber-400'}`}>{r.severity}</span>
                </td>
                <td className="px-4 py-2" />
              </tr>
            ))}
            {customRules.length > 0 && builtinRules.length > 0 && (
              <tr><td colSpan={5} className="px-4 py-1.5 bg-[#272C33] text-[10px] text-neutral-500 font-medium uppercase tracking-wider">Custom Rules</td></tr>
            )}
            {customRules.map(r => (
              <tr key={r.id} className="hover:bg-[#363d47]/50 transition-colors">
                <td className="px-4 py-2">
                  <button onClick={() => onToggle(r.id, !r.enabled)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${r.enabled ? 'bg-green-600' : 'bg-neutral-700'}`}>
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${r.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-neutral-200 text-xs">{r.description}</div>
                  <div className="text-[10px] text-neutral-600 font-mono mt-0.5">{r.id}</div>
                  {r.pattern && <div className="text-[10px] text-blue-400/60 font-mono mt-0.5">/{r.pattern}/i</div>}
                </td>
                <td className="px-4 py-2">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 border border-blue-800/40 font-medium">CUSTOM</span>
                </td>
                <td className="px-4 py-2">
                  <span className={`text-[10px] font-semibold uppercase ${r.severity === 'block' ? 'text-red-400' : 'text-amber-400'}`}>{r.severity}</span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    <button onClick={() => startEdit(r)} className="text-[10px] text-blue-400 hover:text-blue-300">edit</button>
                    <button onClick={() => handleDelete(r.id)} className={`text-[10px] ${confirmDelete === r.id ? 'text-red-300 font-semibold' : 'text-red-400 hover:text-red-300'}`}>
                      {confirmDelete === r.id ? 'confirm?' : 'delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rules.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-neutral-500">No guardrail rules loaded</div>
        )}
      </div>

      <SuggestionCards type="guardrail" onRulesChanged={onRefresh} emptyMessage="No guardrail suggestions yet — the engine analyses decision patterns over time." />
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

// ── Auto-Rules Panel (read-only, deterministic rules) ──

interface AutoRuleStatus {
  id: string;
  match: object;
  matchMode: 'all' | 'any';
  action: { type: string; resolution?: string; tier?: string };
  conditional?: { type: string };
  dailyCap: number;
  requiresApproval: boolean;
  todayCount: number;
  lastFired: string | null;
  enabled: boolean;
  matchSummary: string;
}

function AutoRulesPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [rules, setRules] = useState<AutoRuleStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadRules = () => {
    api('/auto-rules').then(r => {
      if (r.ok) setRules(r.data.rules);
      setLoading(false);
    });
  };

  useEffect(() => { loadRules(); }, []);

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    setToggling(ruleId);
    await apiJson(`/auto-rules/${ruleId}/enabled`, 'PUT', { enabled });
    loadRules();
    setToggling(null);
  };

  const actionBadge = (type: string) => {
    const colors: Record<string, string> = {
      close: 'bg-red-900/40 text-red-400 border-red-800/40',
      set_tier: 'bg-blue-900/40 text-blue-400 border-blue-800/40',
      plugin_to_tpj: 'bg-purple-900/40 text-purple-400 border-purple-800/40',
      abuse_report: 'bg-amber-900/40 text-amber-400 border-amber-800/40',
    };
    return colors[type] || 'bg-neutral-800 text-neutral-400 border-neutral-700';
  };

  const timeAgo = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  };

  if (loading) return null;

  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium text-neutral-200">Deterministic Rules</h3>
        <p className="text-[10px] text-neutral-500 mt-0.5">Pattern-match rules that run before AI triage. Config-driven — edit auto-rules.ts to modify.</p>
      </div>
      <div className="grid gap-2">
        {rules.map(rule => (
          <div key={rule.id} className={`border border-[#3a424d] rounded-lg bg-[#2f353d] px-4 py-3 transition-opacity ${rule.enabled ? '' : 'opacity-50'}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-medium text-neutral-200 shrink-0">{rule.id}</span>
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${actionBadge(rule.action.type)}`}>
                  {rule.action.type.replace(/_/g, ' ')}
                </span>
                {rule.requiresApproval && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border bg-amber-900/30 text-amber-400 border-amber-800/40">
                    Requires Approval
                  </span>
                )}
                {!rule.enabled && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded border bg-red-900/30 text-red-400 border-red-800/40">
                    Disabled
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[10px]">
                <span className="text-neutral-400">{rule.todayCount} today</span>
                {rule.dailyCap && (
                  <span className={`font-mono ${rule.todayCount >= rule.dailyCap ? 'text-red-400' : 'text-neutral-500'}`}>
                    {rule.todayCount}/{rule.dailyCap} cap
                  </span>
                )}
                {rule.lastFired ? (
                  <span className="text-neutral-500">{timeAgo(rule.lastFired)}</span>
                ) : (
                  <span className="text-neutral-600">never fired</span>
                )}
                {isAdmin && (
                  <button
                    onClick={() => toggleRule(rule.id, !rule.enabled)}
                    disabled={toggling === rule.id}
                    className={`relative w-9 h-5 rounded-full transition-colors ${rule.enabled ? 'bg-green-600' : 'bg-neutral-600'} ${toggling === rule.id ? 'opacity-50' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${rule.enabled ? 'translate-x-4' : ''}`} />
                  </button>
                )}
              </div>
            </div>
            <p className="text-[10px] text-neutral-500 mt-1.5 truncate" title={rule.matchSummary}>{rule.matchSummary}</p>
          </div>
        ))}
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
      <AutoRulesPanel isAdmin={isSuperAdmin} />

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

      <SuggestionCards type="autonomy" onRulesChanged={onRefresh} emptyMessage="No suggestions yet — the engine needs at least 50 decisions per category before suggesting rules." onCustomize={(s) => {
        const sug = s.suggestion;
        setForm({
          category: String(sug.category ?? ''),
          subCategory: '',
          minConfidence: typeof sug.suggestedConfidence === 'number' ? sug.suggestedConfidence : 0.9,
          minAcceptRate: typeof sug.suggestedAcceptRate === 'number' ? sug.suggestedAcceptRate : 90,
          minQaScore: 4.0,
          minDecisions: typeof sug.suggestedMinDecisions === 'number' ? sug.suggestedMinDecisions : 50,
        });
        setAdding(true);
      }} />

      {isSuperAdmin && <QuickWinSettingsPanel />}
    </div>
  );
}

function QuickWinSettingsPanel() {
  const QW_LABELS: Record<string, string> = {
    spam: 'Spam', thank_you: 'Thank You', kba_match: 'KBA Match',
    stale_no_response: 'Stale / No Response', duplicate: 'Duplicate', auto_resolved: 'Auto Resolved',
  };
  const QW_TYPES = Object.keys(QW_LABELS);

  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [stats, setStats] = useState<{ byType: Record<string, number>; totalToday: number; executedToday: number; undoRate30d: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/quick-win/settings').then(r => { if (r.ok) setSettings(r.data); });
    api('/quick-win/stats').then(r => { if (r.ok) setStats(r.data); });
  }, []);

  const toggle = async (type: string, enabled: boolean) => {
    setSaving(true);
    await apiJson('/quick-win/settings', 'PUT', { [type]: enabled });
    setSettings(prev => prev ? { ...prev, [type]: enabled } : prev);
    setSaving(false);
  };

  const updateConfidence = async (val: number) => {
    setSaving(true);
    await apiJson('/quick-win/settings', 'PUT', { min_confidence: val });
    setSettings(prev => prev ? { ...prev, min_confidence: val } : prev);
    setSaving(false);
  };

  if (!settings) return null;

  return (
    <div className="mt-4 border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
      <div className="px-4 py-3 bg-[#272C33] border-b border-[#3a424d] flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-neutral-200">Quick Win Auto-Close</span>
          <span className="ml-2 text-[10px] text-neutral-500">Auto-close low-risk tickets when the AI is confident</span>
        </div>
        {stats && (
          <div className="flex gap-4 text-[10px] text-neutral-400">
            <span>Detected today: <span className="text-neutral-200 font-mono">{stats.totalToday}</span></span>
            <span>Auto-closed: <span className="text-emerald-400 font-mono">{stats.executedToday}</span></span>
            <span>Undo rate (30d): <span className={`font-mono ${stats.undoRate30d > 0.05 ? 'text-amber-400' : 'text-green-400'}`}>{(stats.undoRate30d * 100).toFixed(1)}%</span></span>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-b border-[#3a424d] flex items-center gap-3">
        <span className="text-[10px] text-neutral-500">Minimum confidence:</span>
        <input
          type="range" min="0.85" max="1" step="0.01"
          value={Number(settings.min_confidence) || 0.90}
          onChange={e => updateConfidence(parseFloat(e.target.value))}
          disabled={saving}
          className="w-32 accent-[#5ec1ca]"
        />
        <span className="text-xs text-neutral-200 font-mono w-10">{(Number(settings.min_confidence) || 0.90).toFixed(2)}</span>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
            <th className="px-4 py-2 font-medium w-10">On</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium w-24 text-right">Detected Today</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#3a424d]">
          {QW_TYPES.map(t => (
            <tr key={t} className="hover:bg-[#363d47]/50 transition-colors">
              <td className="px-4 py-2">
                <button
                  onClick={() => toggle(t, !settings[t])}
                  disabled={saving || t === 'duplicate'}
                  className={`w-8 h-4 rounded-full transition-colors relative ${settings[t] ? 'bg-green-600' : 'bg-neutral-700'} ${t === 'duplicate' ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${settings[t] ? 'left-4' : 'left-0.5'}`} />
                </button>
              </td>
              <td className="px-4 py-2">
                <span className="text-neutral-200 text-xs">{QW_LABELS[t]}</span>
                {t === 'duplicate' && <span className="ml-2 text-[9px] text-neutral-600">(detection only)</span>}
              </td>
              <td className="px-4 py-2 text-right text-neutral-300 font-mono">{stats?.byType[t] ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

interface KbDraft {
  id: number;
  title: string;
  body: string;
  category: string | null;
  labels: string | null;
  status: string;
  confluence_url: string | null;
  created_at: string;
  published_at: string | null;
}

function KbGapsTab({ gaps, onRefresh }: { gaps: KbGap[]; onRefresh: () => void }) {
  const [counts, setCounts] = useState<{ open: number; article_drafted: number; article_published: number; dismissed: number } | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<KbDraft | null>(null);
  const [drafts, setDrafts] = useState<KbDraft[]>([]);
  const [showDrafts, setShowDrafts] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [rosterNames, setRosterNames] = useState<string[]>([]);
  const [creatingTicket, setCreatingTicket] = useState<number | null>(null);

  useEffect(() => {
    api('/kb-gaps/counts').then(r => { if (r.ok) setCounts(r.data); });
    api('/roster').then(r => { if (r.ok && Array.isArray(r.data)) setRosterNames(r.data.filter((a: any) => a.active).map((a: any) => a.display_name)); });
  }, [gaps]);

  const loadDrafts = async () => {
    const r = await kbApi('');
    if (r.ok) setDrafts(r.data);
  };

  const dismiss = async (category: string, suggestedTitle: string | null) => {
    await apiJson('/kb-gaps/dismiss', 'POST', { category, suggestedTitle });
    onRefresh();
  };

  const generateArticle = async (gap: KbGap) => {
    setGenerating(gap.category + '||' + (gap.suggested_title || ''));
    setDraftError(null);
    try {
      const ticketIds = gap.ticket_ids ? gap.ticket_ids.split(',').map(t => t.trim()) : [];
      const r = await kbApiJson('/generate', 'POST', {
        category: gap.category,
        suggestedTitle: gap.suggested_title,
        reason: null,
        ticketIds,
      });
      if (r.ok) {
        setEditDraft(r.data);
        onRefresh();
      } else {
        setDraftError(r.error || 'Generation failed');
      }
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(null);
    }
  };

  const assignGap = async (id: number, assignedTo: string) => {
    await apiJson(`/kb-gaps/${id}`, 'PATCH', { assigned_to: assignedTo || null });
    onRefresh();
  };

  const createGapTicket = async (gap: KbGap) => {
    setCreatingTicket(gap.id);
    try {
      const r = await apiJson(`/kb-gaps/${gap.id}/create-ticket`, 'POST', {});
      if (r.ok) onRefresh();
    } finally {
      setCreatingTicket(null);
    }
  };

  const saveDraft = async () => {
    if (!editDraft) return;
    setSaving(true);
    try {
      await kbApiJson(`/${editDraft.id}`, 'PUT', { title: editDraft.title, body: editDraft.body, labels: editDraft.labels });
      setSaving(false);
    } catch { setSaving(false); }
  };

  const publishDraft = async () => {
    if (!editDraft) return;
    setPublishing(true);
    setDraftError(null);
    try {
      const r = await kbApiJson(`/${editDraft.id}/publish`, 'POST', {});
      if (r.ok) {
        setEditDraft({ ...editDraft, status: 'published', confluence_url: r.data?.url || null });
        onRefresh();
        loadDrafts();
      } else {
        setDraftError(r.error || 'Publish failed');
      }
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const deleteDraft = async (id: number) => {
    await kbApiJson(`/${id}`, 'DELETE', {});
    if (editDraft?.id === id) setEditDraft(null);
    loadDrafts();
  };

  // Article editor modal
  if (editDraft) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => setEditDraft(null)} className="text-xs text-blue-400 hover:text-blue-300">← Back to gaps</button>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded ${editDraft.status === 'published' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {editDraft.status}
            </span>
            {editDraft.status !== 'published' && (
              <>
                <button onClick={saveDraft} disabled={saving} className="px-3 py-1 text-[11px] rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={publishDraft} disabled={publishing} className="px-3 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
                  {publishing ? 'Publishing…' : 'Publish to Confluence'}
                </button>
              </>
            )}
            {editDraft.confluence_url && (
              <a href={editDraft.confluence_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 hover:text-blue-300">
                View in Confluence →
              </a>
            )}
          </div>
        </div>
        {draftError && <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">{draftError}</div>}
        <input
          value={editDraft.title}
          onChange={e => setEditDraft({ ...editDraft, title: e.target.value })}
          className="w-full px-3 py-2 bg-[#272C33] border border-[#3a424d] rounded text-sm text-white"
          placeholder="Article title"
        />
        <textarea
          value={editDraft.body}
          onChange={e => setEditDraft({ ...editDraft, body: e.target.value })}
          className="w-full px-3 py-2 bg-[#272C33] border border-[#3a424d] rounded text-xs text-neutral-200 font-mono min-h-[400px] resize-y"
          placeholder="Article body (HTML)"
        />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-500">Labels:</span>
          <input
            value={editDraft.labels || ''}
            onChange={e => setEditDraft({ ...editDraft, labels: e.target.value })}
            className="flex-1 px-2 py-1 bg-[#272C33] border border-[#3a424d] rounded text-[11px] text-neutral-300"
            placeholder="comma-separated labels"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">
          Ticket types where the AI identified a missing KB article. Grouped by category and suggested title, sorted by frequency.
        </p>
        <button
          onClick={() => { setShowDrafts(!showDrafts); if (!showDrafts) loadDrafts(); }}
          className="px-3 py-1 text-[11px] rounded bg-[#2f353d] border border-[#3a424d] text-neutral-300 hover:bg-[#363d47]"
        >
          {showDrafts ? 'Show Gaps' : `View Drafts${counts?.article_drafted ? ` (${counts.article_drafted})` : ''}`}
        </button>
      </div>
      {draftError && <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">{draftError}</div>}
      {counts && (
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2f353d] border border-[#3a424d]">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="text-[11px] text-neutral-400">Open</span>
            <span className="text-sm font-semibold text-neutral-200 ml-1">{counts.open}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2f353d] border border-[#3a424d]">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-[11px] text-neutral-400">Drafted</span>
            <span className="text-sm font-semibold text-neutral-200 ml-1">{counts.article_drafted}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2f353d] border border-[#3a424d]">
            <span className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-[11px] text-neutral-400">Published</span>
            <span className="text-sm font-semibold text-neutral-200 ml-1">{counts.article_published}</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#2f353d] border border-[#3a424d]">
            <span className="w-2 h-2 rounded-full bg-neutral-500" />
            <span className="text-[11px] text-neutral-400">Dismissed</span>
            <span className="text-sm font-semibold text-neutral-200 ml-1">{counts.dismissed}</span>
          </div>
        </div>
      )}

      {/* Drafts list */}
      {showDrafts ? (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium w-24">Category</th>
                <th className="px-4 py-2 font-medium w-20">Status</th>
                <th className="px-4 py-2 font-medium w-24">Created</th>
                <th className="px-4 py-2 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {drafts.map(d => (
                <tr key={d.id} className="hover:bg-[#363d47]/50 transition-colors">
                  <td className="px-4 py-2 text-neutral-200 text-xs">{d.title}</td>
                  <td className="px-4 py-2 text-neutral-400">{d.category}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${d.status === 'published' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-[10px] text-neutral-500">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 flex gap-2">
                    <button onClick={() => setEditDraft(d)} className="text-[10px] text-blue-400 hover:text-blue-300">Edit</button>
                    {d.status !== 'published' && (
                      <button onClick={() => deleteDraft(d.id)} className="text-[10px] text-neutral-600 hover:text-red-400">Delete</button>
                    )}
                    {d.confluence_url && (
                      <a href={d.confluence_url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300">View</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {drafts.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-neutral-500">No article drafts yet. Generate one from a KB gap.</div>
          )}
        </div>
      ) : (
        /* Gaps table */
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
                <th className="px-4 py-2 font-medium w-32">Assign</th>
                <th className="px-4 py-2 font-medium w-28">Jira</th>
                <th className="px-4 py-2 font-medium w-36"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {gaps.map((g, i) => {
                const key = g.category + '||' + (g.suggested_title || '');
                const isGenerating = generating === key;
                return (
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
                      <select
                        value={g.assigned_to || ''}
                        onChange={e => assignGap(g.id, e.target.value)}
                        className="bg-[#272C33] border border-[#3a424d] rounded px-1.5 py-0.5 text-[10px] text-neutral-300 w-full"
                      >
                        <option value="">Unassigned</option>
                        {rosterNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      {g.jira_ticket_key ? (
                        <a href={`https://nurturtech.atlassian.net/browse/${g.jira_ticket_key}`} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 font-mono">{g.jira_ticket_key} &rarr;</a>
                      ) : (
                        <button
                          onClick={() => createGapTicket(g)}
                          disabled={creatingTicket === g.id}
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                        >
                          {creatingTicket === g.id ? 'Creating…' : 'Create Ticket'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-2 flex gap-2">
                      <button
                        onClick={() => generateArticle(g)}
                        disabled={isGenerating}
                        className="text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-50"
                      >
                        {isGenerating ? 'Generating…' : 'Generate Article'}
                      </button>
                      <button onClick={() => dismiss(g.category, g.suggested_title)} className="text-[10px] text-neutral-600 hover:text-red-400">
                        Dismiss
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {gaps.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-neutral-500">No KB gaps identified yet. Gaps are recorded during ticket triage when the AI detects a missing article.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AI Improvement Tab ──

interface AiImprovementStats {
  totalComparisons: number;
  agreementRate: number;
  totalSignals: number;
  signalsByType: Record<string, number>;
  recentDisagreements: Array<{ id: number; ticket_key: string; nova_action: string; n8n_action: string; nova_confidence: number; diff_summary: string; n8n_raw_excerpt: string | null; created_at: string }>;
  recentSignals: Array<{ id: number; ticket_key: string; signal_type: string; diff_summary: string; created_at: string }>;
  comparableTicketsCount7d: number;
}

async function aiApi(path: string, opts?: RequestInit) {
  const r = await fetch(`/api/ai-improvement${path}`, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: `Non-JSON (${r.status})` }; }
}

function AiImprovementTab() {
  const [stats, setStats] = useState<AiImprovementStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ compared: number; signals: number } | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => { loadStats(); }, []);

  async function loadStats() {
    setLoading(true);
    const r = await aiApi('/stats?days=30');
    if (r.ok) setStats(r.data);
    setLoading(false);
  }

  async function runScan() {
    setScanning(true);
    setScanResult(null);
    setScanError(null);
    const r = await aiApi('/scan', { method: 'POST' });
    if (r.ok) {
      setScanResult(r.data);
      loadStats();
    } else {
      setScanError(r.error || 'Scan failed');
    }
    setScanning(false);
  }

  if (loading) return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-500">Compares NOVA AI decisions with n8n execution outcomes and detects human edits to AI drafts.</p>
        <button onClick={runScan} disabled={scanning} className="px-3 py-1 text-[11px] rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50">
          {scanning ? 'Scanning…' : 'Run Scan'}
        </button>
      </div>

      {scanResult && (
        <div className="p-2 bg-green-950/30 border border-green-900/50 rounded text-green-400 text-xs">
          Scan complete: {scanResult.compared} comparisons, {scanResult.signals} improvement signals found.
        </div>
      )}

      {scanError && (
        <div className="p-2 bg-red-950/30 border border-red-900/50 rounded text-red-400 text-xs">
          Scan failed: {scanError}
        </div>
      )}

      {stats && (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-neutral-100">{stats.totalComparisons}</div>
              <div className="text-[10px] text-neutral-500 mt-1">Comparisons</div>
            </div>
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-3 text-center">
              <div className={`text-2xl font-bold ${stats.agreementRate >= 0.8 ? 'text-green-400' : stats.agreementRate >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
                {(stats.agreementRate * 100).toFixed(0)}%
              </div>
              <div className="text-[10px] text-neutral-500 mt-1">Agreement Rate</div>
            </div>
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-neutral-100">{stats.totalSignals}</div>
              <div className="text-[10px] text-neutral-500 mt-1">Human Edits</div>
            </div>
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-400">
                {stats.recentDisagreements.length}
              </div>
              <div className="text-[10px] text-neutral-500 mt-1">Recent Disagreements</div>
            </div>
          </div>

          {/* Signal types breakdown */}
          {Object.keys(stats.signalsByType).length > 0 && (
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-3">
              <h4 className="text-xs font-medium text-neutral-300 mb-2">Edit Signal Types</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.signalsByType).map(([type, count]) => (
                  <span key={type} className="px-2 py-1 rounded bg-[#272C33] text-[11px] text-neutral-300">
                    {type.replace(/_/g, ' ')} <span className="text-neutral-500 ml-1">{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent disagreements */}
          {stats.recentDisagreements.length > 0 && (
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-[#272C33] text-xs font-medium text-neutral-400">Recent Disagreements</div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-neutral-500 text-left">
                    <th className="px-4 py-1.5 font-medium">Ticket</th>
                    <th className="px-4 py-1.5 font-medium">NOVA</th>
                    <th className="px-4 py-1.5 font-medium">n8n</th>
                    <th className="px-4 py-1.5 font-medium">Confidence</th>
                    <th className="px-4 py-1.5 font-medium">n8n Excerpt</th>
                    <th className="px-4 py-1.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3a424d]">
                  {stats.recentDisagreements.map(d => (
                    <tr key={d.id} className="hover:bg-[#363d47]/50">
                      <td className="px-4 py-1.5 font-mono text-blue-400">{d.ticket_key}</td>
                      <td className="px-4 py-1.5 text-neutral-300">{d.nova_action}</td>
                      <td className="px-4 py-1.5 text-neutral-300">{d.n8n_action}</td>
                      <td className="px-4 py-1.5 text-neutral-400">{d.nova_confidence != null ? `${(d.nova_confidence * 100).toFixed(0)}%` : '—'}</td>
                      <td className="px-4 py-1.5 text-neutral-400 max-w-[200px] truncate" title={d.n8n_raw_excerpt ?? ''}>{d.n8n_raw_excerpt ? d.n8n_raw_excerpt.slice(0, 80) + (d.n8n_raw_excerpt.length > 80 ? '…' : '') : '—'}</td>
                      <td className="px-4 py-1.5 text-[10px] text-neutral-500">{new Date(d.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent human edit signals */}
          {stats.recentSignals.length > 0 && (
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-[#272C33] text-xs font-medium text-neutral-400">Recent Human Edits</div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-neutral-500 text-left">
                    <th className="px-4 py-1.5 font-medium">Ticket</th>
                    <th className="px-4 py-1.5 font-medium">Signal Type</th>
                    <th className="px-4 py-1.5 font-medium">Summary</th>
                    <th className="px-4 py-1.5 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#3a424d]">
                  {stats.recentSignals.map(s => (
                    <tr key={s.id} className="hover:bg-[#363d47]/50">
                      <td className="px-4 py-1.5 font-mono text-blue-400">{s.ticket_key}</td>
                      <td className="px-4 py-1.5 text-neutral-300">{s.signal_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-1.5 text-neutral-400 text-[10px]">{s.diff_summary || '—'}</td>
                      <td className="px-4 py-1.5 text-[10px] text-neutral-500">{new Date(s.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {stats.totalComparisons === 0 && stats.totalSignals === 0 && (
            <div className="text-center py-8 text-xs text-neutral-500 space-y-1">
              {stats.comparableTicketsCount7d === 0 ? (
                <>
                  <p>No comparable n8n comments found in the last 7 days.</p>
                  <p>Confirm the n8n service account is posting AI Summary comments on tickets that NOVA has also assessed.</p>
                </>
              ) : (
                <p>No comparisons yet. The scan runs automatically every 30 minutes, or click "Run Scan" above.</p>
              )}
            </div>
          )}
        </>
      )}
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
  if (n >= 1) return `£${n.toFixed(2)}`;
  if (n >= 0.01) return `£${n.toFixed(3)}`;
  return `£${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type TrendRange = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function getDateRange(range: TrendRange, customStart?: string, customEnd?: string): { start: string; end: string; label: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (range) {
    case 'today': return { start: fmt(now), end: fmt(now), label: 'Today' };
    case 'yesterday': { const y = new Date(now.getTime() - 86_400_000); return { start: fmt(y), end: fmt(y), label: 'Yesterday' }; }
    case 'week': { const w = new Date(now.getTime() - 6 * 86_400_000); return { start: fmt(w), end: fmt(now), label: 'This Week' }; }
    case 'month': { const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; return { start: m, end: fmt(now), label: 'This Month' }; }
    case 'custom': return { start: customStart || fmt(now), end: customEnd || fmt(now), label: 'Custom' };
  }
}

function SpendChart() {
  const [range, setRange] = useState<TrendRange>('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [trendData, setTrendData] = useState<Array<{ period: string; cost: number; calls: number; decisions?: number }>>([]);
  const [loading, setLoading] = useState(false);

  const loadTrend = useCallback(async (r: TrendRange, cs?: string, ce?: string) => {
    const { start, end } = getDateRange(r, cs, ce);
    setLoading(true);
    try {
      const res = await api(`/costs/trend?start=${start}&end=${end}`);
      if (res.ok) setTrendData(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrend('today'); }, [loadTrend]);

  const handleRange = (r: TrendRange) => {
    setRange(r);
    if (r !== 'custom') loadTrend(r);
  };

  const handleCustomApply = () => {
    if (customStart && customEnd) loadTrend('custom', customStart, customEnd);
  };

  const { label } = getDateRange(range, customStart, customEnd);
  const isHourly = range === 'today' || range === 'yesterday';

  const allHours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const periodMap = new Map(trendData.map(d => [d.period, d]));

  const labels = isHourly
    ? allHours.map(h => `${h}:00`)
    : trendData.map(d => d.period.slice(5));

  const costValues = isHourly
    ? allHours.map(h => periodMap.get(h)?.cost ?? 0)
    : trendData.map(d => d.cost);

  const callValues = isHourly
    ? allHours.map(h => periodMap.get(h)?.calls ?? 0)
    : trendData.map(d => d.calls);

  const decisionValues = isHourly
    ? allHours.map(h => periodMap.get(h)?.decisions ?? 0)
    : trendData.map(d => d.decisions ?? 0);

  const chartData = {
    labels,
    datasets: [
      {
        type: 'bar' as const,
        label: 'Decisions',
        data: decisionValues,
        backgroundColor: 'rgba(139, 92, 246, 0.15)',
        borderColor: 'rgba(139, 92, 246, 0.3)',
        borderWidth: 1,
        yAxisID: 'y1',
        order: 2,
      },
      {
        type: 'line' as const,
        label: 'Spend (£)',
        data: costValues,
        borderColor: '#5ec1ca',
        backgroundColor: 'rgba(94, 193, 202, 0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: isHourly ? 3 : 2,
        pointHoverRadius: 5,
        yAxisID: 'y',
        order: 1,
      },
      {
        type: 'line' as const,
        label: 'Calls',
        data: callValues,
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderDash: [4, 2],
        tension: 0.3,
        pointRadius: isHourly ? 2 : 1,
        pointHoverRadius: 4,
        yAxisID: 'y1',
        order: 0,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { display: true, position: 'top' as const, labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            ctx.dataset.label === 'Spend (£)' ? `${ctx.dataset.label}: ${fmtCost(ctx.parsed.y ?? 0)}` : `${ctx.dataset.label}: ${ctx.parsed.y ?? 0}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: '#6b7280', font: { size: 9 }, maxRotation: 0 }, grid: { color: '#2f353d' } },
      y: {
        type: 'linear' as const, position: 'left' as const,
        ticks: { color: '#5ec1ca', font: { size: 9 }, callback: (v: number | string) => `£${Number(v).toFixed(2)}` },
        grid: { color: '#2f353d' },
        title: { display: false },
      },
      y1: {
        type: 'linear' as const, position: 'right' as const,
        ticks: { color: '#f59e0b', font: { size: 9 } },
        grid: { drawOnChartArea: false },
        title: { display: false },
      },
    },
  };

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Spend Trend — {label}
        </h3>
        <div className="flex items-center gap-1">
          {(['today', 'yesterday', 'week', 'month'] as TrendRange[]).map(r => (
            <button key={r} onClick={() => handleRange(r)}
              className={`px-2 py-0.5 text-[10px] rounded ${range === r ? 'bg-[#5ec1ca] text-[#1a1f25]' : 'bg-[#272C33] text-neutral-400 hover:text-neutral-200'}`}
            >{r === 'today' ? 'Today' : r === 'yesterday' ? 'Yest' : r === 'week' ? '7d' : '30d'}</button>
          ))}
          <button onClick={() => handleRange('custom')}
            className={`px-2 py-0.5 text-[10px] rounded ${range === 'custom' ? 'bg-[#5ec1ca] text-[#1a1f25]' : 'bg-[#272C33] text-neutral-400 hover:text-neutral-200'}`}
          >Custom</button>
        </div>
      </div>
      {range === 'custom' && (
        <div className="flex items-center gap-2 mb-3">
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            className="bg-[#272C33] text-neutral-200 text-xs px-2 py-1 rounded border border-[#3a424d]" />
          <span className="text-neutral-500 text-xs">to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            className="bg-[#272C33] text-neutral-200 text-xs px-2 py-1 rounded border border-[#3a424d]" />
          <button onClick={handleCustomApply}
            className="px-2 py-1 text-[10px] rounded bg-[#5ec1ca] text-[#1a1f25]">Apply</button>
        </div>
      )}
      <div style={{ height: 220 }}>
        {loading ? (
          <div className="flex items-center justify-center h-full text-xs text-neutral-500">Loading...</div>
        ) : trendData.length === 0 && !isHourly ? (
          <div className="flex items-center justify-center h-full text-xs text-neutral-500">No data for this period</div>
        ) : (
          <Chart type="bar" data={chartData} options={chartOptions} />
        )}
      </div>
    </div>
  );
}

// ── Flagged Tab ──

function riskScoreColor(score: number): string {
  if (score >= 80) return 'text-red-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-yellow-400';
}

function riskScoreBg(score: number): string {
  if (score >= 80) return 'bg-red-950/30 border-red-800/40';
  if (score >= 60) return 'bg-amber-950/20 border-amber-800/30';
  return 'bg-yellow-950/20 border-yellow-800/30';
}

function slaDisplay(t: FlaggedTicket): { text: string; color: string } | null {
  if (t.sla_breached) {
    if (!t.sla_breach_at) return { text: 'SLA Breached', color: 'text-red-400' };
    const mins = Math.round((Date.now() - new Date(t.sla_breach_at).getTime()) / 60000);
    if (mins < 60) return { text: `Breached ${mins}m ago`, color: 'text-red-400' };
    const hrs = Math.round(mins / 60);
    return { text: `Breached ${hrs}h ago`, color: 'text-red-400' };
  }
  if (t.sla_breach_at) {
    const mins = Math.round((new Date(t.sla_breach_at).getTime() - Date.now()) / 60000);
    if (mins <= 0) return { text: 'SLA Breached', color: 'text-red-400' };
    if (mins < 60) return { text: `SLA in ${mins}m`, color: 'text-amber-400' };
    const hrs = Math.round(mins / 60);
    return { text: `SLA in ${hrs}h`, color: 'text-neutral-400' };
  }
  return null;
}

function FlaggedTab({ tickets, onRefresh }: { tickets: FlaggedTicket[]; onRefresh: () => void }) {
  const [reviewing, setReviewing] = useState<string | null>(null);

  const handleReview = async (key: string, dismiss: boolean) => {
    setReviewing(key);
    try {
      await api(`/flagged/${key}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss }),
      });
      onRefresh();
    } finally {
      setReviewing(null);
    }
  };

  const pending = tickets.filter(t => t.status === 'pending');
  const reviewed = tickets.filter(t => t.status === 'reviewed');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-neutral-200">Flagged for Review</h3>
          <span className="text-xs text-neutral-500">{pending.length} pending</span>
        </div>
        <button onClick={onRefresh} className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:text-neutral-200 transition-colors">Refresh</button>
      </div>

      {pending.length === 0 && reviewed.length === 0 && (
        <div className="text-sm text-neutral-500 py-8 text-center">No flagged tickets — the risk sweep hasn't found anything above threshold yet.</div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          {pending.map(t => {
            const sla = slaDisplay(t);
            return (
              <div key={t.ticket_key} className={`border rounded-lg p-4 ${riskScoreBg(t.risk_score)}`}>
                {/* Header: score, ticket key (linked), priority, status, SLA */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`text-xl font-bold ${riskScoreColor(t.risk_score)}`}>{t.risk_score}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`https://nurturtech.atlassian.net/browse/${t.ticket_key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-[#5ec1ca] hover:underline"
                      >{t.ticket_key}</a>
                      <span className="text-xs text-neutral-500">{t.priority}</span>
                      {t.ticket_status && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#272C33] border border-[#3a424d] text-neutral-400">{t.ticket_status}</span>
                      )}
                      {sla && (
                        <span className={`text-[10px] font-semibold ${sla.color}`}>{sla.text}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={`https://nurturtech.atlassian.net/browse/${t.ticket_key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#2f353d] text-[#5ec1ca] border border-[#3a424d] hover:bg-[#363d47] transition-colors"
                    >View in Jira</a>
                    <button
                      disabled={reviewing === t.ticket_key}
                      onClick={() => handleReview(t.ticket_key, false)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 transition-colors disabled:opacity-50"
                    >Reviewed</button>
                    <button
                      disabled={reviewing === t.ticket_key}
                      onClick={() => handleReview(t.ticket_key, true)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:text-neutral-200 transition-colors disabled:opacity-50"
                    >Dismiss</button>
                  </div>
                </div>

                {/* Summary */}
                <div className="text-xs text-neutral-300 mb-2">{t.summary ?? 'No summary'}</div>

                {/* Risk factor badges */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {t.risk_factors.map((f, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-[#272C33] border border-[#3a424d] text-neutral-400">
                      <span className="font-mono text-neutral-500">+{f.score}</span> {f.label}
                    </span>
                  ))}
                </div>

                {/* Comment previews */}
                {(t.last_customer_comment || t.last_agent_comment) && (
                  <div className="space-y-1.5 mb-3 text-[11px]">
                    {t.last_customer_comment && (
                      <div className="flex gap-2">
                        <span className="shrink-0 text-violet-400">Customer{t.last_customer_comment_at ? ` (${timeAgo(t.last_customer_comment_at)})` : ''}:</span>
                        <span className="text-neutral-400 line-clamp-2">{t.last_customer_comment}</span>
                      </div>
                    )}
                    {t.last_agent_comment && (
                      <div className="flex gap-2">
                        <span className="shrink-0 text-blue-400">Agent{t.last_agent_comment_at ? ` (${timeAgo(t.last_agent_comment_at)})` : ''}:</span>
                        <span className="text-neutral-400 line-clamp-2">{t.last_agent_comment}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Footer: assignee, reporter, flagged time */}
                <div className="flex items-center gap-4 text-[10px] text-neutral-500">
                  <span>Assignee: {t.assignee ?? 'Unassigned'}</span>
                  <span>Reporter: {t.reporter ?? '—'}</span>
                  <span>Flagged {timeAgo(t.flagged_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="mt-6">
          <h4 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Recently Reviewed</h4>
          <div className="space-y-1">
            {reviewed.slice(0, 10).map(t => (
              <div key={t.ticket_key} className="flex items-center justify-between px-3 py-2 rounded bg-[#2f353d] border border-[#3a424d] text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-neutral-500 font-mono w-6">{t.risk_score}</span>
                  <a
                    href={`https://nurturtech.atlassian.net/browse/${t.ticket_key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#5ec1ca] font-mono hover:underline"
                  >{t.ticket_key}</a>
                  <span className="text-neutral-400 truncate max-w-md">{t.summary}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-neutral-600">
                  <span>by {t.reviewed_by}</span>
                  <span>{t.reviewed_at ? timeAgo(t.reviewed_at) : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CostsTab({ data, onPeriodChange }: { data: CostSummary | null; onPeriodChange: (days: number) => void }) {
  const [days, setDays] = useState(30);
  const [modeCosts, setModeCosts] = useState<{ working: { cost: number; calls: number }; outOfHours: { cost: number; calls: number } } | null>(null);

  useEffect(() => {
    api(`/costs/by-mode?days=${days}`).then(r => r.ok && setModeCosts(r.data)).catch(() => {});
  }, [days]);

  if (!data) return <div className="text-sm text-neutral-500 py-8 text-center">Loading cost data...</div>;

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
      {/* Spend line chart — full width */}
      <SpendChart />

      {/* Period selector for cards below */}
      <div className="flex items-center gap-2">
        {[1, 7, 30, 90].map(d => (
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

      {/* Working hours vs out-of-hours split */}
      {modeCosts && (modeCosts.working.calls > 0 || modeCosts.outOfHours.calls > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <CostCard label="Working Hours" value={fmtCost(modeCosts.working.cost)} sub={`${modeCosts.working.calls} calls`} />
          <CostCard label="Out of Hours" value={fmtCost(modeCosts.outOfHours.cost)} sub={`${modeCosts.outOfHours.calls} calls`} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

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

        {/* Daily spend (last 10 days) */}
        <DailySpendCard />
      </div>
    </div>
  );
}

function DailySpendCard() {
  const [rows, setRows] = useState<Array<{ period: string; cost: number; calls: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const end = new Date().toISOString().slice(0, 10);
    const start = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
    api(`/costs/trend?start=${start}&end=${end}`).then(r => {
      if (r.ok) setRows(r.data);
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const dailyAvg = rows.length > 0 ? rows.reduce((s, r) => s + r.cost, 0) / rows.length : 0;
  const sorted = [...rows].sort((a, b) => b.period.localeCompare(a.period));

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
      <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-3">Daily Spend (Last 10 Days)</h3>
      {loading ? (
        <div className="text-xs text-neutral-500 py-4 text-center">Loading...</div>
      ) : (
        <>
          <div className="space-y-1">
            {sorted.map(r => {
              const isToday = r.period === today;
              return (
                <div key={r.period} className={`flex items-center gap-2 text-xs rounded px-1.5 py-0.5 ${isToday ? 'bg-[#5ec1ca]/10 border border-[#5ec1ca]/20' : ''}`}>
                  <span className={`font-mono w-20 ${isToday ? 'text-[#5ec1ca] font-medium' : 'text-neutral-400'}`}>
                    {isToday ? 'Today' : new Date(r.period + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </span>
                  <span className={`font-mono flex-1 text-right ${isToday ? 'text-neutral-100 font-medium' : 'text-neutral-300'}`}>{fmtCost(r.cost)}</span>
                  <span className="text-neutral-600 w-16 text-right">{r.calls} calls</span>
                </div>
              );
            })}
            {sorted.length === 0 && <div className="text-xs text-neutral-500">No data</div>}
          </div>
          {rows.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[#3a424d] flex items-center justify-between text-xs text-neutral-400">
              <span>Daily average</span>
              <span className="font-mono text-neutral-200">{fmtCost(dailyAvg)}</span>
            </div>
          )}
        </>
      )}
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

// ── KB Index Tab ──

interface KbStatus {
  chunks_by_source: Record<string, number>;
  last_sync_by_source: Record<string, { status: string; started_at: string; completed_at: string | null; docs_seen: number; chunks_added: number; chunks_updated: number; chunks_deleted: number } | null>;
  embedding_model: string;
  vector_storage_mode: string;
  registered_providers: string[];
}

function KbIndexTab() {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const token = localStorage.getItem('nova_token');
      const res = await fetch('/api/kb-admin/status', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.ok) setStatus(data.data);
      else setError(data.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch KB status');
    }
  };

  const triggerSync = async (source: string) => {
    setSyncing(source);
    try {
      const token = localStorage.getItem('nova_token');
      await fetch(`/api/kb-admin/sync/${source}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setTimeout(fetchStatus, 5000);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setSyncing(null), 3000);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  if (error) return <div className="p-4 text-red-400 text-sm">{error}</div>;
  if (!status) return <div className="p-4 text-neutral-500 text-sm">Loading...</div>;

  const totalChunks = Object.values(status.chunks_by_source).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-neutral-300">Knowledge Base Index</span>
          <span className="ml-2 text-xs text-neutral-500">({totalChunks} chunks, {status.embedding_model})</span>
        </div>
        <button onClick={fetchStatus} className="text-xs text-[#5ec1ca] hover:text-[#7dd3d8]">Refresh</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {status.registered_providers.map(source => {
          const chunks = status.chunks_by_source[source] ?? 0;
          const lastSync = status.last_sync_by_source[source];
          const syncTime = lastSync?.completed_at ? new Date(lastSync.completed_at).toLocaleString() : 'Never';
          const syncStatus = lastSync?.status ?? 'never';

          return (
            <div key={source} className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-neutral-200">{source}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  syncStatus === 'success' ? 'bg-green-900/30 text-green-400' :
                  syncStatus === 'error' ? 'bg-red-900/30 text-red-400' :
                  syncStatus === 'running' ? 'bg-blue-900/30 text-blue-400' :
                  'bg-neutral-700 text-neutral-400'
                }`}>{syncStatus}</span>
              </div>
              <div className="text-xs text-neutral-400 space-y-1">
                <div>Chunks: <span className="text-neutral-200 font-mono">{chunks}</span></div>
                <div>Last sync: <span className="text-neutral-200">{syncTime}</span></div>
                {lastSync && (
                  <div>Docs: {lastSync.docs_seen} | +{lastSync.chunks_added} ~{lastSync.chunks_updated} -{lastSync.chunks_deleted}</div>
                )}
              </div>
              <button
                onClick={() => triggerSync(source)}
                disabled={syncing === source}
                className="mt-2 text-xs px-2 py-1 rounded bg-[#363d47] text-[#5ec1ca] hover:bg-[#3a424d] disabled:opacity-50"
              >
                {syncing === source ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Pipelines Tab: Eval Suite, A/B Tests, Pipeline Health, Patterns, Model Comparisons ──

function PipelinesTab() {
  const [section, setSection] = useState<'eval' | 'ab-tests' | 'health' | 'patterns' | 'model-compare'>('eval');
  const [evalRuns, setEvalRuns] = useState<any[]>([]);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalSampleSize, setEvalSampleSize] = useState(50);
  const [abTests, setAbTests] = useState<any[]>([]);
  const [pipelineHealth, setPipelineHealth] = useState<any[]>([]);
  const [patterns, setPatterns] = useState<any[]>([]);
  const [modelComparisons, setModelComparisons] = useState<{ comparisons: any[]; summary: any[] }>({ comparisons: [], summary: [] });

  useEffect(() => {
    api('/eval/runs').then(r => { if (r.ok) setEvalRuns(r.data); });
    api('/ab-tests').then(r => { if (r.ok) setAbTests(r.data); });
    api('/pipeline-health').then(r => { if (r.ok) setPipelineHealth(r.data); });
    api('/patterns').then(r => { if (r.ok) setPatterns(r.data); });
    api('/model-comparisons').then(r => { if (r.ok) setModelComparisons(r.data); });
  }, []);

  const runEval = async (type: 'eval' | 'replay') => {
    setEvalLoading(true);
    const endpoint = type === 'eval' ? '/eval/run' : '/eval/replay';
    const r = await api(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sampleSize: evalSampleSize }) });
    if (r.ok) {
      api('/eval/runs').then(r2 => { if (r2.ok) setEvalRuns(r2.data); });
    }
    setEvalLoading(false);
  };

  const sectionButtons = [
    { key: 'eval' as const, label: 'Eval & Replay' },
    { key: 'ab-tests' as const, label: 'A/B Tests' },
    { key: 'health' as const, label: 'Pipeline Health' },
    { key: 'patterns' as const, label: 'Patterns' },
    { key: 'model-compare' as const, label: 'Model Comparison' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {sectionButtons.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)} className={`px-3 py-1 text-xs rounded ${section === s.key ? 'bg-[#5ec1ca] text-black' : 'bg-[#2f353d] text-neutral-400 hover:text-neutral-200'}`}>{s.label}</button>
        ))}
      </div>

      {section === 'eval' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-neutral-400">Sample size:</label>
            <input type="number" value={evalSampleSize} onChange={e => setEvalSampleSize(Number(e.target.value))} className="w-20 bg-[#1e2228] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" />
            <button onClick={() => runEval('eval')} disabled={evalLoading} className="px-3 py-1 text-xs rounded bg-[#5ec1ca] text-black hover:bg-[#7dd3d8] disabled:opacity-50">{evalLoading ? 'Running...' : 'Run Eval'}</button>
            <button onClick={() => runEval('replay')} disabled={evalLoading} className="px-3 py-1 text-xs rounded bg-[#363d47] text-[#5ec1ca] hover:bg-[#3a424d] disabled:opacity-50">{evalLoading ? 'Running...' : 'Run Replay'}</button>
          </div>
          {evalRuns.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-[#3a424d] text-neutral-500"><th className="py-1 text-left">Date</th><th className="text-left">Type</th><th className="text-right">Sample</th><th className="text-right">Matched</th><th className="text-right">Accept Rate</th><th className="text-right">Delta</th><th className="text-left">Status</th></tr></thead>
              <tbody>
                {evalRuns.map((run: any) => {
                  const passThreshold = -5;
                  const passed = (run.delta ?? 0) >= passThreshold;
                  return (
                    <tr key={run.id} className="border-b border-[#2f353d] text-neutral-300">
                      <td className="py-1">{new Date(run.run_at).toLocaleString()}</td>
                      <td>{run.run_type}</td>
                      <td className="text-right">{run.sample_size}</td>
                      <td className="text-right">{run.matched}</td>
                      <td className="text-right">{run.accept_rate?.toFixed(1)}%</td>
                      <td className={`text-right ${(run.delta ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{run.delta >= 0 ? '+' : ''}{run.delta?.toFixed(1)}%</td>
                      <td><span className={`px-1.5 py-0.5 rounded text-[10px] ${passed ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{passed ? 'PASS' : 'FAIL'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-neutral-500">No eval runs yet. Run one to establish a baseline.</p>
          )}
        </div>
      )}

      {section === 'ab-tests' && (
        <div className="space-y-3">
          {abTests.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-[#3a424d] text-neutral-500"><th className="py-1 text-left">Name</th><th className="text-left">Type</th><th className="text-right">Split</th><th className="text-left">Status</th><th className="text-left">Started</th></tr></thead>
              <tbody>
                {abTests.map((t: any) => (
                  <tr key={t.id} className="border-b border-[#2f353d] text-neutral-300">
                    <td className="py-1">{t.name}</td>
                    <td>{t.test_type}</td>
                    <td className="text-right">{t.split_percentage}%</td>
                    <td><span className={`px-1.5 py-0.5 rounded text-[10px] ${t.status === 'active' ? 'bg-green-900/30 text-green-400' : 'bg-neutral-700 text-neutral-400'}`}>{t.status}</span></td>
                    <td>{new Date(t.started_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-neutral-500">No A/B tests configured. Create one via the API.</p>
          )}
        </div>
      )}

      {section === 'health' && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {pipelineHealth.map((p: any) => (
            <div key={p.name} className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-neutral-200">{p.name}</span>
                <span className={`w-2 h-2 rounded-full ${p.status === 'ok' ? 'bg-green-500' : p.status === 'warning' ? 'bg-amber-500' : p.status === 'error' ? 'bg-red-500' : 'bg-neutral-600'}`} />
              </div>
              <div className="text-lg font-mono text-neutral-200">{p.count}</div>
              <div className="text-[10px] text-neutral-500">threshold: {p.threshold}/day</div>
            </div>
          ))}
          {pipelineHealth.length === 0 && <p className="text-xs text-neutral-500 col-span-3">No pipeline health data.</p>}
        </div>
      )}

      {section === 'patterns' && (
        <div className="space-y-3">
          {patterns.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-[#3a424d] text-neutral-500"><th className="py-1 text-left">Category</th><th className="text-left">Symptom</th><th className="text-left">Resolution</th><th className="text-right">Count</th><th className="text-left">Last Seen</th></tr></thead>
              <tbody>
                {patterns.slice(0, 50).map((p: any) => (
                  <tr key={p.id} className="border-b border-[#2f353d] text-neutral-300">
                    <td className="py-1">{p.category}</td>
                    <td className="max-w-[200px] truncate">{p.symptom}</td>
                    <td className="max-w-[200px] truncate">{p.resolution}</td>
                    <td className="text-right font-mono">{p.observed_count}</td>
                    <td>{p.last_observed ? new Date(p.last_observed).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-neutral-500">No patterns extracted yet. Patterns build automatically from resolved tickets.</p>
          )}
        </div>
      )}

      {section === 'model-compare' && (
        <div className="space-y-3">
          {modelComparisons.summary.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              {modelComparisons.summary.map((s: any) => (
                <div key={s.shadow_model} className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-3">
                  <div className="text-xs text-neutral-400 mb-1">vs {s.shadow_model}</div>
                  <div className="text-lg font-mono text-neutral-200">{s.agreement_rate}%</div>
                  <div className="text-[10px] text-neutral-500">agreement ({s.matches}/{s.total} calls)</div>
                </div>
              ))}
            </div>
          )}
          {modelComparisons.comparisons.length > 0 ? (
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-[#3a424d] text-neutral-500"><th className="py-1 text-left">Date</th><th className="text-left">Type</th><th className="text-left">Primary</th><th className="text-left">Shadow</th><th className="text-left">Match</th></tr></thead>
              <tbody>
                {modelComparisons.comparisons.slice(0, 50).map((c: any) => (
                  <tr key={c.id} className="border-b border-[#2f353d] text-neutral-300">
                    <td className="py-1">{new Date(c.created_at).toLocaleString()}</td>
                    <td>{c.call_type}</td>
                    <td>{c.primary_action}</td>
                    <td>{c.shadow_action}</td>
                    <td>{c.actions_match ? <span className="text-green-400">Yes</span> : <span className="text-red-400">No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-neutral-500">No model comparisons yet. Enable shadow model in settings.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Assignment Tab ──
function AssignmentTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [log, setLog] = useState<any[]>([]);
  const [poolStats, setPoolStats] = useState<Record<string, { total: number; available: number; avgLoad: number }> | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [bankHolidays, setBankHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState('');
  const [projectPools, setProjectPools] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(() => {
    const q = projectFilter ? `?project=${projectFilter}` : '';
    api(`/roster/assignment-log${q}`).then(r => { if (r.ok) setLog(r.data ?? []); });
    api('/roster/pool-stats').then(r => { if (r.ok) setPoolStats(r.data); });
  }, [projectFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(r => {
      if (r.ok && r.data) {
        const holidays = r.data.agent_bank_holidays;
        if (holidays) { try { setBankHolidays(JSON.parse(holidays)); } catch { /* ignore */ } }
        const pools = r.data.agent_assignment_project_pools;
        if (pools) setProjectPools(pools);
      }
    });
  }, []);

  const saveBankHolidays = async () => {
    setSaving(true);
    await fetch('/api/settings/agent_bank_holidays', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: JSON.stringify(bankHolidays) }),
    });
    setSaving(false);
  };

  const saveProjectPools = async () => {
    setSaving(true);
    await fetch('/api/settings/agent_assignment_project_pools', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: projectPools }),
    });
    setSaving(false);
  };

  const addHoliday = () => {
    if (newHoliday && !bankHolidays.includes(newHoliday)) {
      const updated = [...bankHolidays, newHoliday].sort();
      setBankHolidays(updated);
      setNewHoliday('');
    }
  };

  const removeHoliday = (date: string) => {
    setBankHolidays(prev => prev.filter(d => d !== date));
  };

  return (
    <div className="space-y-4 py-4">
      {/* Pool Stats */}
      {poolStats && (
        <div className="bg-[#2f353d] rounded-lg p-4">
          <h3 className="text-sm font-medium text-neutral-200 mb-3">Pool Stats</h3>
          <div className="grid grid-cols-4 gap-3">
            {Object.entries(poolStats).map(([pool, stats]) => (
              <div key={pool} className="bg-[#252a31] rounded p-3">
                <div className="text-xs font-medium text-[#5ec1ca] uppercase mb-1">{pool}</div>
                <div className="text-xs text-neutral-400">
                  {stats.available}/{stats.total} available
                </div>
                <div className="text-xs text-neutral-400">
                  Avg load: {Math.round(stats.avgLoad * 100)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignment Log */}
      <div className="bg-[#2f353d] rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-neutral-200">Assignment Log</h3>
          <div className="flex items-center gap-2">
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="bg-[#252a31] text-xs text-neutral-300 rounded px-2 py-1 border border-[#3a424d]"
            >
              <option value="">All Projects</option>
              <option value="NT">NT</option>
              <option value="NTPJ">NTPJ</option>
            </select>
            <button onClick={loadData} className="text-xs text-[#5ec1ca] hover:underline">Refresh</button>
          </div>
        </div>
        {log.length === 0 ? (
          <p className="text-xs text-neutral-500">No assignment records yet.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-[#3a424d] text-neutral-500">
                <th className="py-1 text-left">Time</th>
                <th className="text-left">Ticket</th>
                <th className="text-left">Pool</th>
                <th className="text-left">Project</th>
                <th className="text-left">Assigned To</th>
                <th className="text-left">Reason</th>
              </tr></thead>
              <tbody>
                {log.map((entry: any, i: number) => (
                  <tr key={i} className="border-b border-[#2f353d] text-neutral-300">
                    <td className="py-1">{new Date(entry.created_at).toLocaleString()}</td>
                    <td className="font-mono">{entry.ticket_key}</td>
                    <td><span className="px-1.5 py-0.5 bg-[#363d47] rounded text-[10px] uppercase">{entry.pool}</span></td>
                    <td>{entry.project_key || 'NT'}</td>
                    <td>{entry.assigned_to}</td>
                    <td className="text-neutral-400 max-w-[200px] truncate">{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bank Holidays (admin only) */}
      {isSuperAdmin && (
        <div className="bg-[#2f353d] rounded-lg p-4">
          <h3 className="text-sm font-medium text-neutral-200 mb-3">Bank Holidays</h3>
          <p className="text-xs text-neutral-400 mb-2">Assignment engine skips these dates. Format: YYYY-MM-DD</p>
          <div className="flex gap-2 mb-3">
            <input
              type="date"
              value={newHoliday}
              onChange={e => setNewHoliday(e.target.value)}
              className="bg-[#252a31] text-xs text-neutral-300 rounded px-2 py-1 border border-[#3a424d]"
            />
            <button onClick={addHoliday} className="px-2 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30">Add</button>
            <button onClick={saveBankHolidays} disabled={saving} className="px-2 py-1 bg-green-900/40 text-green-400 text-xs rounded hover:bg-green-900/60 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {bankHolidays.map(d => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#252a31] text-xs text-neutral-300 rounded border border-[#3a424d]">
                {d}
                <button onClick={() => removeHoliday(d)} className="text-red-400 hover:text-red-300 ml-1">&times;</button>
              </span>
            ))}
            {bankHolidays.length === 0 && <span className="text-xs text-neutral-500">No bank holidays configured.</span>}
          </div>
        </div>
      )}

      {/* Project Pool Config (admin only) */}
      {isSuperAdmin && (
        <div className="bg-[#2f353d] rounded-lg p-4">
          <h3 className="text-sm font-medium text-neutral-200 mb-3">Project Pool Configuration</h3>
          <p className="text-xs text-neutral-400 mb-2">JSON mapping of projects to allowed pools. Example: {`{"NT": {"defaultPool": "cc", "allowedPools": ["cc", "t2"]}, "NTPJ": {"defaultPool": "tpj", "allowedPools": ["tpj", "t2"]}}`}</p>
          <textarea
            value={projectPools}
            onChange={e => setProjectPools(e.target.value)}
            rows={4}
            className="w-full bg-[#252a31] text-xs text-neutral-300 rounded p-2 border border-[#3a424d] font-mono"
          />
          <button onClick={saveProjectPools} disabled={saving} className="mt-2 px-3 py-1 bg-green-900/40 text-green-400 text-xs rounded hover:bg-green-900/60 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Predictions Tab ──
function PredictionsTab() {
  const [predictions, setPredictions] = useState<any[]>([]);
  const [accuracy, setAccuracy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [testKey, setTestKey] = useState('');
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      api('/predictions/active').then(r => { if (r.ok) setPredictions(r.data ?? []); }),
      api('/predictions/accuracy').then(r => { if (r.ok) setAccuracy(r.data); }),
    ]).finally(() => setLoading(false));
  }, []);

  const runTest = async () => {
    if (!testKey.trim()) return;
    const r = await api('/predictions/test', { method: 'POST', body: JSON.stringify({ ticketKey: testKey.trim() }) });
    if (r.ok) setTestResult(r.data);
  };

  if (loading) return <div className="text-neutral-400 text-sm p-4">Loading predictions...</div>;

  return (
    <div className="space-y-4 p-4">
      {accuracy && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Predictions', value: accuracy.total },
            { label: 'Correct', value: accuracy.correct, color: 'text-green-400' },
            { label: 'Incorrect', value: accuracy.incorrect, color: 'text-red-400' },
            { label: 'Accuracy Rate', value: `${(accuracy.accuracy * 100).toFixed(1)}%`, color: accuracy.accuracy >= 0.7 ? 'text-green-400' : 'text-amber-400' },
          ].map(s => (
            <div key={s.label} className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className={`text-lg font-bold ${s.color || 'text-neutral-200'}`}>{s.value}</div>
              <div className="text-xs text-neutral-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-[#2f353d] rounded-lg p-4">
        <h3 className="text-sm font-medium text-neutral-200 mb-2">Test Prediction</h3>
        <div className="flex gap-2">
          <input
            value={testKey}
            onChange={e => setTestKey(e.target.value)}
            placeholder="Enter ticket key (e.g. NT-1234)"
            className="flex-1 bg-[#252a31] text-xs text-neutral-300 rounded px-3 py-2 border border-[#3a424d]"
          />
          <button onClick={runTest} className="px-3 py-1.5 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30">
            Predict
          </button>
        </div>
        {testResult && (
          <div className="mt-3 bg-[#252a31] rounded p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-sm font-bold ${testResult.probability >= 0.75 ? 'text-red-400' : testResult.probability >= 0.5 ? 'text-amber-400' : 'text-green-400'}`}>
                {(testResult.probability * 100).toFixed(0)}% escalation risk
              </span>
            </div>
            <p className="text-xs text-neutral-400">{testResult.reasoning}</p>
          </div>
        )}
      </div>

      <div className="bg-[#2f353d] rounded-lg p-4">
        <h3 className="text-sm font-medium text-neutral-200 mb-3">Active High-Risk Predictions</h3>
        {predictions.length === 0 ? (
          <p className="text-xs text-neutral-500">No active predictions</p>
        ) : (
          <div className="space-y-2">
            {predictions.map((p: any) => (
              <div key={p.ticket_key} className="flex items-center justify-between bg-[#252a31] rounded p-2">
                <div>
                  <span className="text-xs font-mono text-[#5ec1ca]">{p.ticket_key}</span>
                  <span className="text-xs text-neutral-400 ml-2">{new Date(p.predicted_at).toLocaleDateString()}</span>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  p.probability >= 0.75 ? 'bg-red-900/40 text-red-400' : 'bg-amber-900/40 text-amber-400'
                }`}>
                  {(p.probability * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Incidents Tab ──
function IncidentsTab() {
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    api('/incidents/active').then(r => {
      if (r.ok) setIncidents(r.data ?? []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const resolveIncident = async (id: number) => {
    const r = await api(`/incidents/${id}/resolve`, { method: 'POST' });
    if (r.ok) refresh();
  };

  const runScan = async () => {
    const r = await api('/incidents/scan', { method: 'POST' });
    if (r.ok) refresh();
  };

  if (loading) return <div className="text-neutral-400 text-sm p-4">Loading incidents...</div>;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-neutral-200">Active Incidents</h3>
        <div className="flex gap-2">
          <button onClick={runScan} className="px-3 py-1.5 bg-amber-900/30 text-amber-400 text-xs rounded hover:bg-amber-900/40">
            Run Scan Now
          </button>
          <button onClick={refresh} className="px-3 py-1.5 bg-[#2f353d] text-neutral-400 text-xs rounded hover:bg-[#3a424d]">
            Refresh
          </button>
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="bg-[#2f353d] rounded-lg p-8 text-center">
          <p className="text-neutral-500 text-sm">No active incidents detected</p>
          <p className="text-neutral-600 text-xs mt-1">Scans run every 15 minutes automatically</p>
        </div>
      ) : (
        <div className="space-y-3">
          {incidents.map((inc: any) => (
            <div key={inc.id} className="bg-[#2f353d] rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {inc.incident_key && (
                      <span className="text-xs font-mono text-red-400">{inc.incident_key}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      inc.status === 'open' ? 'bg-red-900/40 text-red-400' : 'bg-amber-900/40 text-amber-400'
                    }`}>{inc.status}</span>
                  </div>
                  <p className="text-sm text-neutral-200">{inc.summary}</p>
                  {inc.root_cause && (
                    <p className="text-xs text-neutral-400 mt-1">Root cause: {inc.root_cause}</p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
                    <span>{inc.ticket_count} tickets</span>
                    <span>{new Date(inc.detected_at).toLocaleString()}</span>
                  </div>
                  {Array.isArray(inc.ticket_keys) && inc.ticket_keys.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {inc.ticket_keys.map((k: string) => (
                        <span key={k} className="text-xs font-mono bg-[#252a31] text-[#5ec1ca] px-1.5 py-0.5 rounded">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => resolveIncident(inc.id)}
                  className="px-3 py-1.5 bg-green-900/30 text-green-400 text-xs rounded hover:bg-green-900/40"
                >
                  Resolve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SLA Management Tab ──
function SlaManagementTab() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/sla-management/stats').then(r => {
      if (r.ok) setStats(r.data);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-neutral-400 text-sm p-4">Loading SLA management data...</div>;

  return (
    <div className="space-y-4 p-4">
      {stats && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-neutral-200">{stats.total}</div>
              <div className="text-xs text-neutral-500 mt-1">Total Interventions (30d)</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-green-400">{stats.breaches_prevented}</div>
              <div className="text-xs text-neutral-500 mt-1">Breaches Prevented</div>
            </div>
            <div className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-[#5ec1ca]">
                {stats.total > 0 ? ((stats.breaches_prevented / stats.total) * 100).toFixed(0) : 0}%
              </div>
              <div className="text-xs text-neutral-500 mt-1">Prevention Rate</div>
            </div>
          </div>

          <div className="bg-[#2f353d] rounded-lg p-4">
            <h3 className="text-sm font-medium text-neutral-200 mb-3">Intervention Breakdown</h3>
            <div className="space-y-2">
              {Object.entries(stats.by_type ?? {}).map(([type, count]: [string, any]) => (
                <div key={type} className="flex items-center justify-between bg-[#252a31] rounded p-2">
                  <span className="text-xs text-neutral-300">
                    {type === 'log_warning' ? 'Warning (120min)' :
                     type === 'auto_assign' ? 'Auto-Assign (60min)' :
                     type === 'nudge_agent' ? 'Agent Nudge (30min)' :
                     type === 'escalate_lead' ? 'Lead Escalation (15min)' : type}
                  </span>
                  <span className="text-xs font-mono text-neutral-400">{String(count)}</span>
                </div>
              ))}
              {Object.keys(stats.by_type ?? {}).length === 0 && (
                <p className="text-xs text-neutral-500">No interventions recorded yet</p>
              )}
            </div>
          </div>
        </>
      )}

      {!stats && (
        <div className="bg-[#2f353d] rounded-lg p-8 text-center">
          <p className="text-neutral-500 text-sm">SLA management data unavailable</p>
        </div>
      )}
    </div>
  );
}

function KbHealthTab() {
  const [stats, setStats] = useState<{ total: number; current: number; stale: number; unused: number; drifted: number; gap_closure_rate: number } | null>(null);
  const [articles, setArticles] = useState<Array<{ id: number; article_id: string; article_title: string | null; status: string; usage_count_30d: number | null; drift_score: number | null }>>([]);
  const [scanning, setScanning] = useState(false);

  const load = async () => {
    const [s, a] = await Promise.all([
      api('/kb-health/stats'), api('/kb-health/articles'),
    ]);
    if (s.ok) setStats(s.data);
    if (a.ok) setArticles(a.data ?? []);
  };
  useEffect(() => { load(); }, []);

  const scan = async () => { setScanning(true); await api('/kb-health/scan', { method: 'POST' }); await load(); setScanning(false); };
  const statusColor = (s: string) => s === 'current' ? 'text-green-400' : s === 'stale' ? 'text-amber-400' : s === 'drifted' ? 'text-red-400' : 'text-neutral-500';

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { l: 'Total', v: stats.total, c: 'text-neutral-200' },
            { l: 'Current', v: stats.current, c: 'text-green-400' },
            { l: 'Stale', v: stats.stale, c: 'text-amber-400' },
            { l: 'Unused', v: stats.unused, c: 'text-neutral-500' },
            { l: 'Drifted', v: stats.drifted, c: 'text-red-400' },
          ].map(s => (
            <div key={s.l} className="bg-[#2f353d] rounded-lg p-3 text-center">
              <div className={`text-xl font-bold ${s.c}`}>{s.v}</div>
              <div className="text-xs text-neutral-400">{s.l}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">Gap closure rate: <span className="text-[#5ec1ca]">{stats ? (stats.gap_closure_rate * 100).toFixed(0) + '%' : '-'}</span></span>
        <button onClick={scan} disabled={scanning} className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
          {scanning ? 'Scanning...' : 'Run Scan'}
        </button>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-[#3a424d]">
          <th className="text-left py-2 px-2 text-neutral-400">Article</th>
          <th className="text-center py-2 px-2 text-neutral-400">Status</th>
          <th className="text-right py-2 px-2 text-neutral-400">30d Uses</th>
          <th className="text-right py-2 px-2 text-neutral-400">Drift</th>
        </tr></thead>
        <tbody>
          {articles.map(a => (
            <tr key={a.id} className="border-b border-[#3a424d]/50">
              <td className="py-2 px-2 text-neutral-200">{a.article_title ?? a.article_id}</td>
              <td className={`py-2 px-2 text-center ${statusColor(a.status)}`}>{a.status}</td>
              <td className="py-2 px-2 text-right text-neutral-300">{a.usage_count_30d ?? 0}</td>
              <td className="py-2 px-2 text-right text-neutral-300">{a.drift_score != null ? (a.drift_score * 100).toFixed(0) + '%' : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrainingSignalsTab() {
  const [signals, setSignals] = useState<Array<{ id: number; agent_name: string | null; signal_type: string; request_type: string | null; metric_value: number | null; team_average: number | null; recommendation: string | null; actioned: boolean; generated_at: string }>>([]);
  const [generating, setGenerating] = useState(false);

  const load = async () => { const r = await api('/training-signals?actioned=false'); if (r.ok) setSignals(r.data ?? []); };
  useEffect(() => { load(); }, []);

  const generate = async () => { setGenerating(true); await api('/training-signals/generate', { method: 'POST' }); await load(); setGenerating(false); };
  const markActioned = async (id: number) => { await api(`/training-signals/${id}/action`, { method: 'POST' }); setSignals(prev => prev.filter(s => s.id !== id)); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400">{signals.length} unactioned signals</span>
        <button onClick={generate} disabled={generating} className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
          {generating ? 'Generating...' : 'Generate Signals'}
        </button>
      </div>
      {signals.map(s => (
        <div key={s.id} className="bg-[#2f353d] rounded-lg p-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <span className="text-sm text-neutral-200">{s.agent_name}</span>
              <span className="ml-2 px-2 py-0.5 rounded text-xs bg-amber-900/20 text-amber-400">{s.signal_type.replace(/_/g, ' ')}</span>
            </div>
            <button onClick={() => markActioned(s.id)} className="px-2 py-0.5 bg-green-900/30 text-green-400 text-xs rounded">Actioned</button>
          </div>
          {s.request_type && <div className="text-xs text-neutral-400">{s.request_type} — Agent: {s.metric_value?.toFixed(2)} vs Team: {s.team_average?.toFixed(2)}</div>}
          {s.recommendation && <p className="text-xs text-neutral-300 mt-1">{s.recommendation}</p>}
        </div>
      ))}
      {signals.length === 0 && <div className="text-center text-neutral-500 text-sm py-8">No training signals. Run generation to analyse agent performance.</div>}
    </div>
  );
}

function LearningTab() {
  const [velocity, setVelocity] = useState<{ novel_encountered: number; learning_acquired: number; avg_days_to_learn: number | null; autonomy_suggestions: number } | null>(null);
  const [tickets, setTickets] = useState<Array<{ ticket_id: string; created_at: string; learning_acquired_at: string | null; action: string; outcome: string }>>([]);

  const load = async () => {
    const [v, t] = await Promise.all([api('/learning/velocity'), api('/learning/novel-tickets')]);
    if (v.ok) setVelocity(v.data);
    if (t.ok) setTickets(t.data ?? []);
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      {velocity && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#2f353d] rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-neutral-200">{velocity.novel_encountered}</div>
            <div className="text-xs text-neutral-400">Novel Types</div>
          </div>
          <div className="bg-[#2f353d] rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-green-400">{velocity.learning_acquired}</div>
            <div className="text-xs text-neutral-400">Learned</div>
          </div>
          <div className="bg-[#2f353d] rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-[#5ec1ca]">{velocity.avg_days_to_learn?.toFixed(1) ?? '-'}</div>
            <div className="text-xs text-neutral-400">Avg Days to Learn</div>
          </div>
          <div className="bg-[#2f353d] rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-amber-400">{velocity.autonomy_suggestions}</div>
            <div className="text-xs text-neutral-400">Autonomy Suggestions</div>
          </div>
        </div>
      )}
      <table className="w-full text-xs">
        <thead><tr className="border-b border-[#3a424d]">
          <th className="text-left py-2 px-2 text-neutral-400">Ticket</th>
          <th className="text-left py-2 px-2 text-neutral-400">Action</th>
          <th className="text-left py-2 px-2 text-neutral-400">Outcome</th>
          <th className="text-center py-2 px-2 text-neutral-400">Learning</th>
          <th className="text-right py-2 px-2 text-neutral-400">Date</th>
        </tr></thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t.ticket_id + t.created_at} className="border-b border-[#3a424d]/50">
              <td className="py-2 px-2 text-neutral-200">{t.ticket_id}</td>
              <td className="py-2 px-2 text-neutral-300">{t.action}</td>
              <td className="py-2 px-2 text-neutral-300">{t.outcome}</td>
              <td className="py-2 px-2 text-center">{t.learning_acquired_at ? <span className="text-green-400">Acquired</span> : <span className="text-amber-400">Pending</span>}</td>
              <td className="py-2 px-2 text-right text-neutral-500">{new Date(t.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
