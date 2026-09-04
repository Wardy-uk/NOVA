import { useState, useEffect, useCallback, useMemo } from 'react';
import { AgentConversationsPanel } from './AgentConversationsPanel.js';
import { OneToOneSessionView } from './OneToOneSessionView.js';
import { PlaudAttachButton } from './PlaudAttachButton.js';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentDailyRow {
  AgentName: string;
  TierCode: string | null;
  Team: string | null;
  OpenTickets_Total: number | null;
  OpenTickets_Over2Hours: number | null;
  OpenTickets_NoUpdateToday: number | null;
  SolvedTickets_Today: number | null;
  AvailableHours: number | null;
  TicketsPerHour: number | null;
  OldestTicketDays: number | null;
  QATicketsScored: number | null;
  QAOverallAvg: number | null;
  QAAccuracyAvg: number | null;
  QAClarityAvg: number | null;
  QAToneAvg: number | null;
  QARedCount: number | null;
  QAAmberCount: number | null;
  QAGreenCount: number | null;
  QAConcerningCount: number | null;
  GoldenRulesScored: number | null;
  GoldenRulesAvg: number | null;
  OwnershipAvg: number | null;
  NextActionAvg: number | null;
  TimeframeAvg: number | null;
  SLAResolvedCount: number | null;
  SLABreachedCount: number | null;
  SLACompliancePct: number | null;
  CSATCount: number | null;
  CSATAverage: number | null;
  FrtCompliancePercent: number | null;
  FrtAvgMinutes: number | null;
  ReportDate: string;
}

interface DevPlan {
  id: number;
  agent_name: string;
  plan_period: string | null;
  role_title: string | null;
  function_name: string | null;
  role_clarity: string | null;
  strengths: string | null; // JSON array
  important_context: string | null;
  status: string;
}

interface DevGoal {
  id: number;
  plan_id: number;
  title: string;
  description: string | null;
  measure_description: string | null;
  metric_key: string | null;
  metric_target: number | null;
  target_date: string | null;
  status: string;
  sort_order: number;
}

interface TrainingItem {
  id: number;
  plan_id: number;
  title: string;
  description: string | null;
  target_date: string | null;
  completed: boolean | number;
  completed_at: string | null;
  sort_order: number;
}

interface PlanData {
  plan: DevPlan;
  goals: DevGoal[];
  training: TrainingItem[];
}

interface Snapshot {
  id: number;
  agent_name: string;
  snapshot_date: string;
  metrics_json: string | null;
  goals_json: string | null;
  prep_json: string | null;
  transcript_md: string | null;
  notes: string | null;
  created_at: string;
}

interface Action121 {
  id: number;
  snapshot_id: number | null;
  agent_name: string;
  description: string;
  owner: string | null;
  due_date: string | null;
  status: string;
  completed_at: string | null;
  created_at: string;
}

interface PrepData {
  summary: string;
  whats_improved: string[];
  needs_attention: string[];
  goal_progress: { goal: string; status: string; notes: string }[];
  qa_highlights: string[];
  suggested_talking_points: string[];
  suggested_actions: string[];
}

interface CalendarEvent {
  subject: string;
  start: string;
  end: string;
}

/* ------------------------------------------------------------------ */
/*  Theme (matches AgentKpisView)                                      */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  glass: 'rgba(255,255,255,0.03)',
  glassHover: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.06)',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  blue: '#60a5fa',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

function fmt(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined) return '—';
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${Number.isFinite(v) ? v.toFixed(1) : '—'}%`;
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return Math.round(v).toString();
}

function slaColor(pct: number | null): string {
  if (pct === null) return C.text3;
  if (pct >= 95) return C.green;
  if (pct >= 90) return C.amber;
  return C.red;
}

function qaColor(score: number | null): string {
  if (score === null) return C.text3;
  if (score >= 8) return C.green;
  if (score >= 6) return C.amber;
  return C.red;
}

function grColor(score: number | null): string {
  if (score === null) return C.text3;
  if (score >= 2.5) return C.green;
  if (score >= 2.0) return C.amber;
  return C.red;
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function statusColor(s: string): string {
  switch (s) {
    case 'complete': return C.green;
    case 'on_track': return C.green;
    case 'in_progress': return C.blue;
    case 'at_risk': return C.red;
    case 'not_started': return C.text3;
    default: return C.text3;
  }
}

const GOAL_STATUSES = ['not_started', 'in_progress', 'on_track', 'at_risk', 'complete'] as const;

// Map metric_key to a field on the aggregated summary
function resolveMetricValue(key: string | null, s: AgentSummary): number | null {
  if (!key) return null;
  const map: Record<string, number | null> = {
    TimeframeAvg: s.timeframeAvg,
    OwnershipAvg: s.ownershipAvg,
    NextActionAvg: s.nextActionAvg,
    GoldenRulesAvg: s.goldenRulesAvg,
    QAOverallAvg: s.qaOverallAvg,
    QAAccuracyAvg: s.qaAccuracyAvg,
    QAClarityAvg: s.qaClarityAvg,
    QAToneAvg: s.qaToneAvg,
    ResolutionSlaPercent: s.slaCompliancePct,
    SLACompliancePct: s.slaCompliancePct,
    FrtCompliancePercent: s.frtCompliancePct,
    AgedTicketPercent: null,
    TicketsPerDay: s.solvedAvgPerDay,
    TicketsPerHour: s.ticketsPerHourAvg,
    CSATAverage: s.csatAvg,
  };
  return map[key] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Aggregation (same as AgentKpisView)                                */
/* ------------------------------------------------------------------ */

interface AgentSummary {
  agentName: string;
  tierCode: string;
  team: string;
  daysInRange: number;
  solvedTotal: number;
  solvedAvgPerDay: number;
  ticketsPerHourAvg: number | null;
  openTicketsAvg: number;
  openOver2hAvg: number;
  openNoUpdateAvg: number;
  oldestTicketMax: number;
  qaScored: number;
  qaOverallAvg: number | null;
  qaAccuracyAvg: number | null;
  qaClarityAvg: number | null;
  qaToneAvg: number | null;
  qaGreen: number;
  qaAmber: number;
  qaRed: number;
  qaConcerning: number;
  goldenRulesScored: number;
  goldenRulesAvg: number | null;
  ownershipAvg: number | null;
  nextActionAvg: number | null;
  timeframeAvg: number | null;
  slaResolved: number;
  slaBreached: number;
  slaCompliancePct: number | null;
  csatCount: number;
  csatAvg: number | null;
  resolvedTrendPct: number | null;
  frtCompliancePct: number | null;
}

function aggregateAgent(rows: AgentDailyRow[]): AgentSummary | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.ReportDate.localeCompare(b.ReportDate));
  const latest = sorted[sorted.length - 1];
  const solvedTotal = sum(sorted.map(r => r.SolvedTickets_Today));
  const tphValues = sorted.map(r => r.TicketsPerHour).filter((v): v is number => v !== null && v > 0);
  const slaBreached = sum(sorted.map(r => r.SLABreachedCount));

  return {
    agentName: latest.AgentName,
    tierCode: latest.TierCode ?? '',
    team: latest.Team ?? '',
    daysInRange: new Set(sorted.map(r => r.ReportDate.slice(0, 10))).size,
    solvedTotal,
    solvedAvgPerDay: sorted.length > 0 ? solvedTotal / sorted.length : 0,
    ticketsPerHourAvg: tphValues.length > 0 ? tphValues.reduce((a, b) => a + b, 0) / tphValues.length : null,
    openTicketsAvg: avg(sorted.map(r => r.OpenTickets_Total)) ?? 0,
    openOver2hAvg: avg(sorted.map(r => r.OpenTickets_Over2Hours)) ?? 0,
    openNoUpdateAvg: avg(sorted.map(r => r.OpenTickets_NoUpdateToday)) ?? 0,
    // The LATEST day's value, not the max across the range. A max can only ever go up:
    // it kept reporting the worst single day the range had ever seen (253 days from a
    // long-gone Development ticket) as if it were today's oldest ticket.
    oldestTicketMax: latest.OldestTicketDays ?? 0,
    qaScored: sum(sorted.map(r => r.QATicketsScored)),
    qaOverallAvg: avg(sorted.map(r => r.QAOverallAvg)),
    qaAccuracyAvg: avg(sorted.map(r => r.QAAccuracyAvg)),
    qaClarityAvg: avg(sorted.map(r => r.QAClarityAvg)),
    qaToneAvg: avg(sorted.map(r => r.QAToneAvg)),
    qaGreen: sum(sorted.map(r => r.QAGreenCount)),
    qaAmber: sum(sorted.map(r => r.QAAmberCount)),
    qaRed: sum(sorted.map(r => r.QARedCount)),
    qaConcerning: sum(sorted.map(r => r.QAConcerningCount)),
    goldenRulesScored: sum(sorted.map(r => r.GoldenRulesScored)),
    goldenRulesAvg: avg(sorted.map(r => r.GoldenRulesAvg)),
    ownershipAvg: avg(sorted.map(r => r.OwnershipAvg)),
    nextActionAvg: avg(sorted.map(r => r.NextActionAvg)),
    timeframeAvg: avg(sorted.map(r => r.TimeframeAvg)),
    slaResolved: solvedTotal,
    slaBreached,
    slaCompliancePct: solvedTotal === 0 ? null : ((solvedTotal - slaBreached) / solvedTotal) * 100,
    csatCount: sum(sorted.map(r => r.CSATCount)),
    csatAvg: avg(sorted.map(r => r.CSATAverage)),
    resolvedTrendPct: (() => {
      if (sorted.length < 4) return null;
      const mid = Math.floor(sorted.length / 2);
      const olderAvg = sum(sorted.slice(0, mid).map(r => r.SolvedTickets_Today)) / mid;
      const recentAvg = sum(sorted.slice(mid).map(r => r.SolvedTickets_Today)) / (sorted.length - mid);
      if (olderAvg === 0) return recentAvg > 0 ? 100 : null;
      return ((recentAvg - olderAvg) / olderAvg) * 100;
    })(),
    frtCompliancePct: avg(sorted.map(r => r.FrtCompliancePercent)),
  };
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h3 style={{
        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.8px', color: C.teal, margin: 0,
      }}>{title}</h3>
      {subtitle && <p style={{ fontSize: 10, color: C.text3, margin: '2px 0 0' }}>{subtitle}</p>}
    </div>
  );
}

function MetricCard({ label, value, subtitle, color, target, trend, onClick }: {
  label: string; value: string; subtitle?: string; color?: string;
  target?: { label: string; met: boolean } | null;
  trend?: { pct: number; label: string } | null;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: '16px 20px', borderLeft: `3px solid ${color || C.teal}`,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'background 0.2s',
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLElement).style.background = C.glassHover; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.background = C.glass; } : undefined}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: color || C.text1 }}>{value}</span>
        {trend && trend.pct !== 0 && (
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: trend.pct > 0 ? C.green : C.red,
          }}>
            {trend.pct > 0 ? '▲' : '▼'}{Math.abs(trend.pct).toFixed(0)}%
          </span>
        )}
      </div>
      {subtitle && <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{subtitle}</div>}
      {trend && <div style={{ fontSize: 9, color: C.text3, marginTop: 2 }}>{trend.label}</div>}
      {target && (
        <div style={{
          marginTop: 6, fontSize: 10, fontWeight: 600,
          color: target.met ? C.green : C.amber,
        }}>
          {target.met ? '✓' : '○'} {target.label}
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal, currentValue, editing, onSave }: {
  goal: DevGoal;
  currentValue: number | null;
  editing: boolean;
  onSave: (updates: Partial<DevGoal>) => void;
}) {
  const [editStatus, setEditStatus] = useState(goal.status);
  const [editTarget, setEditTarget] = useState(goal.metric_target?.toString() ?? '');
  const hasMetric = goal.metric_key && goal.metric_target !== null;
  const progress = hasMetric && currentValue !== null && goal.metric_target
    ? Math.min(100, Math.max(0, (currentValue / goal.metric_target) * 100))
    : null;

  return (
    <div style={{
      background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: '16px 20px', borderLeft: `3px solid ${statusColor(goal.status)}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, flex: 1 }}>{goal.title}</div>
        {editing ? (
          <select
            value={editStatus}
            onChange={e => setEditStatus(e.target.value)}
            onBlur={() => { if (editStatus !== goal.status) onSave({ status: editStatus }); }}
            style={{
              padding: '2px 6px', fontSize: 10, borderRadius: 6,
              background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
            }}
          >
            {GOAL_STATUSES.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        ) : (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: `${statusColor(goal.status)}20`, color: statusColor(goal.status),
          }}>
            {statusLabel(goal.status)}
          </span>
        )}
      </div>

      {goal.description && (
        <div style={{ fontSize: 11, color: C.text2, marginBottom: 8, lineHeight: 1.5 }}>
          {goal.description.split('\n\n')[0]}
        </div>
      )}

      {hasMetric && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: C.text3 }}>
              Current: {currentValue !== null ? fmt(currentValue) : '—'}
            </span>
            {editing ? (
              <span style={{ fontSize: 10, color: C.text3 }}>
                Target: <input
                  type="number"
                  step="0.1"
                  value={editTarget}
                  onChange={e => setEditTarget(e.target.value)}
                  onBlur={() => {
                    const v = parseFloat(editTarget);
                    if (!isNaN(v) && v !== goal.metric_target) onSave({ metric_target: v });
                  }}
                  style={{
                    width: 48, padding: '1px 4px', fontSize: 10, borderRadius: 4,
                    background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
                  }}
                />
              </span>
            ) : (
              <span style={{ fontSize: 10, color: C.text3 }}>
                Target: {fmt(goal.metric_target)}
              </span>
            )}
          </div>
          {progress !== null && (
            <div style={{ height: 6, borderRadius: 3, background: C.bg2, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, transition: 'width 0.5s',
                width: `${progress}%`,
                background: progress >= 100 ? C.green : progress >= 70 ? C.amber : C.teal,
              }} />
            </div>
          )}
        </div>
      )}

      {goal.target_date && (
        <div style={{ fontSize: 10, color: C.text3, marginTop: 6 }}>
          Target: {goal.target_date}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

interface AgedBucket {
  count: number;
  tickets: { issue_key: string; summary: string; age_days: number; priority_name: string }[];
}

export function AgentProfileView({ agentName, userRole, onNavigate }: {
  agentName?: string | null;
  userRole?: string;
  onNavigate?: (view: string) => void;
}) {
  const [kpiRows, setKpiRows] = useState<AgentDailyRow[]>([]);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedAgent, setResolvedAgent] = useState<string | null>(agentName ?? null);
  const [editing, setEditing] = useState(false);
  const [dateRange, setDateRange] = useState<'7' | '30' | '90'>('30');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [actions, setActions] = useState<Action121[]>([]);
  const [running121, setRunning121] = useState(false);
  const [nextMeeting, setNextMeeting] = useState<CalendarEvent | null>(null);
  const [expandedSnapshot, setExpandedSnapshot] = useState<number | null>(null);
  const [generatingPrep, setGeneratingPrep] = useState(false);
  const [takingSnapshot, setTakingSnapshot] = useState(false);
  const [newActionText, setNewActionText] = useState('');
  const [newActionOwner, setNewActionOwner] = useState('');
  const [transcriptText, setTranscriptText] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [agedTickets, setAgedTickets] = useState<{
    incidents: AgedBucket;
    serviceRequests: AgedBucket;
    onboarding: AgedBucket;
    other: AgedBucket;
    development: AgedBucket;
    oldest: { days: number; issue_key: string; summary: string } | null;
  } | null>(null);

  // Roles are a comma-separated string (e.g. "super_admin,admin") — parse, don't exact-match.
  const isAdmin = (userRole ?? '').split(',').map(r => r.trim()).some(r => r === 'admin' || r === 'super_admin');

  // Fetch KPI data for this agent
  const fetchKpis = useCallback(async (name: string) => {
    try {
      const url = agentName
        ? `/api/kpi-data/agent-kpis?env=live&days=${dateRange}&agent=${encodeURIComponent(name)}`
        : `/api/kpi-data/agent-kpis?env=live&days=${dateRange}&scope=self`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) {
        setKpiRows(json.data || []);
        if (!agentName && json.scopedAgent) setResolvedAgent(json.scopedAgent);
      }
    } catch { /* ignore */ }
  }, [agentName, dateRange]);

  // Fetch dev plan
  const fetchPlan = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(name)}/plan`);
      const json = await res.json();
      if (json.ok && json.data) setPlanData(json.data);
    } catch { /* ignore */ }
  }, []);

  // Fetch snapshots & actions
  const fetchSnapshots = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(name)}/snapshots`);
      const json = await res.json();
      if (json.ok) setSnapshots(json.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchActions = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(name)}/actions`);
      const json = await res.json();
      if (json.ok) setActions(json.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchCalendar = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(name)}/calendar`);
      const json = await res.json();
      if (json.ok && json.data) setNextMeeting(json.data);
    } catch { /* ignore */ }
  }, []);

  const fetchAgedTickets = useCallback(async (name: string) => {
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(name)}/aged-tickets`);
      const json = await res.json();
      if (json.ok) setAgedTickets(json.data);
      else console.warn('[aged-tickets] API error:', json.error);
    } catch (err) { console.warn('[aged-tickets] fetch failed:', err); }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (agentName) {
          setResolvedAgent(agentName);
          await Promise.all([fetchKpis(agentName), fetchPlan(agentName), fetchSnapshots(agentName), fetchActions(agentName), fetchCalendar(agentName), fetchAgedTickets(agentName)]);
        } else {
          // Self-scoped: first fetch KPIs to discover the agent name
          const url = `/api/kpi-data/agent-kpis?env=live&days=${dateRange}&scope=self`;
          const res = await fetch(url);
          const json = await res.json();
          if (json.ok) {
            setKpiRows(json.data || []);
            const name = json.scopedAgent;
            if (name) {
              setResolvedAgent(name);
              await Promise.all([fetchPlan(name), fetchSnapshots(name), fetchActions(name), fetchCalendar(name), fetchAgedTickets(name)]);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [agentName, dateRange, fetchKpis, fetchPlan, fetchSnapshots, fetchActions, fetchCalendar, fetchAgedTickets]);

  const summary = useMemo(() => aggregateAgent(kpiRows), [kpiRows]);

  // Inline edit helpers
  const updateGoal = useCallback(async (goalId: number, updates: Partial<DevGoal>) => {
    try {
      await fetch(`/api/people/goals/${goalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (resolvedAgent) fetchPlan(resolvedAgent);
    } catch { /* ignore */ }
  }, [resolvedAgent, fetchPlan]);

  const toggleTraining = useCallback(async (itemId: number, completed: boolean) => {
    try {
      await fetch(`/api/people/training/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      });
      if (resolvedAgent) fetchPlan(resolvedAgent);
    } catch { /* ignore */ }
  }, [resolvedAgent, fetchPlan]);

  const updatePlan = useCallback(async (updates: Record<string, unknown>) => {
    if (!resolvedAgent) return;
    try {
      await fetch(`/api/people/agent/${encodeURIComponent(resolvedAgent)}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      fetchPlan(resolvedAgent);
    } catch { /* ignore */ }
  }, [resolvedAgent, fetchPlan]);

  // Generate AI prep
  const [prepError, setPrepError] = useState<string | null>(null);
  const generatePrep = useCallback(async () => {
    if (!resolvedAgent) {
      setPrepError('No agent resolved — cannot generate prep');
      return;
    }
    setGeneratingPrep(true);
    setPrepError(null);
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(resolvedAgent)}/generate-prep`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const json = await res.json();
      if (json.ok) {
        await fetchSnapshots(resolvedAgent);
        setShowHistory(true);
        if (json.data?.snapshotId) setExpandedSnapshot(json.data.snapshotId);
      } else {
        setPrepError(json.error || 'Unknown error');
      }
    } catch (err: any) {
      setPrepError(err.message || 'Network error');
    }
    setGeneratingPrep(false);
  }, [resolvedAgent, fetchSnapshots]);

  // Take manual snapshot (freeze)
  const takeSnapshot = useCallback(async () => {
    if (!resolvedAgent) return;
    setTakingSnapshot(true);
    try {
      const body: Record<string, string> = {};
      if (transcriptText.trim()) body.transcript_md = transcriptText.trim();
      const res = await fetch(`/api/people/agent/${encodeURIComponent(resolvedAgent)}/snapshot/freeze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setTranscriptText('');
        await fetchSnapshots(resolvedAgent);
        setShowHistory(true);
      }
    } catch { /* ignore */ }
    setTakingSnapshot(false);
  }, [resolvedAgent, transcriptText, fetchSnapshots]);

  // Add action
  const addAction = useCallback(async (snapshotId?: number) => {
    if (!resolvedAgent || !newActionText.trim()) return;
    try {
      await fetch(`/api/people/agent/${encodeURIComponent(resolvedAgent)}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_id: snapshotId ?? null,
          description: newActionText.trim(),
          owner: newActionOwner.trim() || null,
        }),
      });
      setNewActionText('');
      setNewActionOwner('');
      await Promise.all([fetchSnapshots(resolvedAgent), fetchActions(resolvedAgent)]);
    } catch { /* ignore */ }
  }, [resolvedAgent, newActionText, newActionOwner, fetchSnapshots, fetchActions]);

  // Update action status
  const updateAction = useCallback(async (actionId: number, status: string) => {
    try {
      await fetch(`/api/people/actions/${actionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (resolvedAgent) await Promise.all([fetchSnapshots(resolvedAgent), fetchActions(resolvedAgent)]);
    } catch { /* ignore */ }
  }, [resolvedAgent, fetchSnapshots, fetchActions]);

  // Parse strengths JSON
  const strengths: string[] = useMemo(() => {
    if (!planData?.plan.strengths) return [];
    try { return JSON.parse(planData.plan.strengths); } catch { return []; }
  }, [planData]);

  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        <div style={{
          height: 56, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 32,
          animation: 'akFadeIn 1.5s ease-in-out infinite alternate',
        }} />
        <div style={{ display: 'flex', gap: 24 }}>
          <div style={{ flex: '0 0 65%', height: 400, background: C.glass, borderRadius: 12 }} />
          <div style={{ flex: 1, height: 400, background: C.glass, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  const s = summary;
  const qaTotal = s ? s.qaGreen + s.qaAmber + s.qaRed : 0;
  const qaGreenPct = qaTotal > 0 ? ((s?.qaGreen ?? 0) / qaTotal) * 100 : 0;
  const qaAmberPct = qaTotal > 0 ? ((s?.qaAmber ?? 0) / qaTotal) * 100 : 0;
  const qaRedPct = qaTotal > 0 ? ((s?.qaRed ?? 0) / qaTotal) * 100 : 0;

  // Find dev plan target for a metric key
  const goalTarget = (metricKey: string): { label: string; met: boolean } | null => {
    if (!planData) return null;
    const goal = planData.goals.find(g => g.metric_key === metricKey && g.metric_target !== null);
    if (!goal) return null;
    const current = s ? resolveMetricValue(metricKey, s) : null;
    const met = current !== null && goal.metric_target !== null && current >= goal.metric_target;
    return { label: `Dev plan target: ${fmt(goal.metric_target)}`, met };
  };

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', 'Plus Jakarta Sans', system-ui, sans-serif",
      color: C.text1,
    }}>
      {/* Inject keyframes */}
      <style>{`
        @keyframes akFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Top Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%', animation: 'akGradient 3s ease infinite',
        }} />
        <style>{`@keyframes akGradient { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }`}</style>

        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: C.text1 }}>
            {resolvedAgent || 'My Performance'}
            {planData?.plan.role_title && (
              <span style={{ fontSize: 13, fontWeight: 500, color: C.text3, marginLeft: 10 }}>
                {planData.plan.role_title}
              </span>
            )}
          </h1>
          <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
            {`Last ${dateRange} days`}{planData?.plan.plan_period ? ` · Plan: ${planData.plan.plan_period}` : ''}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(['7', '30', '90'] as const).map(d => (
            <button key={d} onClick={() => setDateRange(d)} style={{
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600, transition: 'all 0.2s',
              background: dateRange === d ? `${C.teal}20` : 'transparent',
              color: dateRange === d ? C.teal : C.text3,
            }}>{d}d</button>
          ))}

          {nextMeeting && (
            <div style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 600,
              background: `${C.purple}15`, color: C.purple, border: `1px solid ${C.purple}30`,
            }}>
              Next 1-2-1: {new Date(nextMeeting.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </div>
          )}

          {isAdmin && (
            <>
              <button
                onClick={() => resolvedAgent && setRunning121(true)}
                disabled={!resolvedAgent}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: `1px solid ${C.teal}`,
                  cursor: resolvedAgent ? 'pointer' : 'not-allowed', fontSize: 11, fontWeight: 700,
                  background: C.teal, color: C.bg1, opacity: resolvedAgent ? 1 : 0.5,
                }}
              >Run 1-2-1</button>
              {resolvedAgent && <PlaudAttachButton agentName={resolvedAgent} onAttached={() => { fetchSnapshots(resolvedAgent); }} />}
              <button
                onClick={generatePrep}
                disabled={generatingPrep}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: `1px solid ${C.purple}60`,
                  cursor: generatingPrep ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600,
                  background: `${C.purple}15`, color: C.purple, opacity: generatingPrep ? 0.6 : 1,
                }}
              >{generatingPrep ? 'Generating...' : 'Generate Prep'}</button>
              {prepError && <span style={{ fontSize: 11, color: C.red, marginLeft: 8 }}>{prepError}</span>}
              <button
                onClick={takeSnapshot}
                disabled={takingSnapshot}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: `1px solid ${C.teal}60`,
                  cursor: takingSnapshot ? 'wait' : 'pointer', fontSize: 11, fontWeight: 600,
                  background: `${C.teal}15`, color: C.teal, opacity: takingSnapshot ? 0.6 : 1,
                }}
              >{takingSnapshot ? 'Saving...' : 'Snapshot'}</button>
              <button
                onClick={() => setEditing(!editing)}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: `1px solid ${editing ? C.teal : C.border}`,
                  cursor: 'pointer', fontSize: 11, fontWeight: 600,
                  background: editing ? `${C.teal}20` : 'transparent',
                  color: editing ? C.teal : C.text3,
                }}
              >{editing ? 'Done Editing' : 'Edit Plan'}</button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 20px', marginBottom: 20, borderRadius: 10,
          background: `${C.red}15`, border: `1px solid ${C.red}30`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>{error}</div>
      )}

      {running121 && resolvedAgent && (
        <OneToOneSessionView
          agentName={resolvedAgent}
          onClose={() => setRunning121(false)}
          onCompleted={() => { fetchSnapshots(resolvedAgent); fetchActions(resolvedAgent); }}
        />
      )}

      {/* Two-panel layout */}
      <div style={{ display: 'flex', gap: 24, animation: 'akFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards' }}>
        {/* LEFT: Performance (≈65%) */}
        <div style={{ flex: '0 0 64%', display: 'flex', flexDirection: 'column', gap: 24 }}>
          {s ? (
            <>
              {/* Performance */}
              <div>
                <SectionTitle title="Performance" subtitle={`${s.daysInRange} days in range`} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                  <MetricCard label="Tickets Resolved" value={fmtInt(s.solvedTotal)} subtitle={`${fmt(s.solvedAvgPerDay)} avg/day`} target={goalTarget('TicketsPerDay')}
                    trend={s.resolvedTrendPct !== null ? { pct: s.resolvedTrendPct, label: 'vs prior half of period' } : null} />
                  <MetricCard label="Tickets Per Hour" value={fmt(s.ticketsPerHourAvg, 2)} subtitle="Target: ≥1.5 TPH"
                    color={s.ticketsPerHourAvg !== null && s.ticketsPerHourAvg >= 1.5 ? C.green : s.ticketsPerHourAvg !== null && s.ticketsPerHourAvg >= 1.0 ? C.amber : C.teal}
                    target={goalTarget('TicketsPerHour')} />
                  <MetricCard label="Avg Open Tickets" value={fmt(s.openTicketsAvg)}
                    subtitle={agedTickets ? `Excludes ${agedTickets.development.count} now with Development` : 'Lower is better'} />
                  <MetricCard label="Avg >2h Overdue" value={fmt(s.openOver2hAvg)} subtitle="Target: 0" color={s.openOver2hAvg > 0 ? C.red : C.green} />
                  <MetricCard label="Avg No Update" value={fmt(s.openNoUpdateAvg)} subtitle="Same-day; 7d for T3 · excl. Development" color={s.openNoUpdateAvg > 1 ? C.amber : s.openNoUpdateAvg === 0 ? C.green : C.text3} />
                  {(() => {
                    // Live figure from jira_issue_cache when we have it — the stored daily
                    // column is unreliable (it lands as 0 for every agent some days).
                    const oldestDays = agedTickets?.oldest ? agedTickets.oldest.days : s.oldestTicketMax;
                    return (
                      <MetricCard label="Oldest Ticket (days)" value={fmtInt(oldestDays)}
                        subtitle={agedTickets?.oldest ? `${agedTickets.oldest.issue_key} · excl. Development` : 'Target: ≤3 days · excl. Development'}
                        color={oldestDays <= 3 ? C.green : oldestDays <= 7 ? C.amber : C.red} />
                    );
                  })()}
                </div>
              </div>

              {/* Quality */}
              <div>
                <SectionTitle title="Quality" subtitle={`${s.qaScored} tickets scored`} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                  <MetricCard label="QA Score Overall" value={fmt(s.qaOverallAvg)} subtitle="Target: ≥8.0"
                    color={qaColor(s.qaOverallAvg)} target={goalTarget('QAOverallAvg')}
                    onClick={onNavigate ? () => onNavigate('qa') : undefined} />
                  <MetricCard label="Accuracy" value={fmt(s.qaAccuracyAvg)} color={qaColor(s.qaAccuracyAvg)}
                    target={goalTarget('QAAccuracyAvg')} onClick={onNavigate ? () => onNavigate('qa') : undefined} />
                  <MetricCard label="Clarity" value={fmt(s.qaClarityAvg)} color={qaColor(s.qaClarityAvg)}
                    target={goalTarget('QAClarityAvg')} onClick={onNavigate ? () => onNavigate('qa') : undefined} />
                  <MetricCard label="Tone" value={fmt(s.qaToneAvg)} color={qaColor(s.qaToneAvg)}
                    target={goalTarget('QAToneAvg')} onClick={onNavigate ? () => onNavigate('qa') : undefined} />
                  {/* QA Traffic Light */}
                  <div style={{
                    background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                    padding: '16px 20px', borderLeft: `3px solid ${C.purple}`,
                    cursor: onNavigate ? 'pointer' : undefined,
                  }}
                    onClick={onNavigate ? () => onNavigate('qa') : undefined}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>QA Traffic Light</div>
                    {qaTotal > 0 ? (
                      <>
                        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                          {qaGreenPct > 0 && <div style={{ width: `${qaGreenPct}%`, background: C.green }} />}
                          {qaAmberPct > 0 && <div style={{ width: `${qaAmberPct}%`, background: C.amber }} />}
                          {qaRedPct > 0 && <div style={{ width: `${qaRedPct}%`, background: C.red }} />}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>{s.qaGreen}G</span>
                          <span style={{ fontSize: 11, color: C.amber, fontWeight: 600 }}>{s.qaAmber}A</span>
                          <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>{s.qaRed}R</span>
                        </div>
                      </>
                    ) : <span style={{ fontSize: 13, color: C.text3 }}>No scored tickets</span>}
                  </div>
                  <MetricCard label="Concerning" value={fmtInt(s.qaConcerning)} subtitle="Target: 0" color={s.qaConcerning > 0 ? C.red : C.green} />
                </div>
              </div>

              {/* Golden Rules */}
              <div>
                <SectionTitle title="Golden Rules" subtitle={`${s.goldenRulesScored} tickets scored`} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                  <MetricCard label="Overall Score" value={fmt(s.goldenRulesAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.goldenRulesAvg)} target={goalTarget('GoldenRulesAvg')} />
                  <MetricCard label="Ownership" value={fmt(s.ownershipAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.ownershipAvg)} target={goalTarget('OwnershipAvg')} />
                  <MetricCard label="Next Action" value={fmt(s.nextActionAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.nextActionAvg)} target={goalTarget('NextActionAvg')} />
                  <MetricCard label="Timeframe" value={fmt(s.timeframeAvg)} subtitle="Target: ≥2.5 / 3" color={grColor(s.timeframeAvg)} target={goalTarget('TimeframeAvg')} />
                </div>
              </div>

              {/* SLA */}
              <div>
                <SectionTitle title="SLA Compliance" subtitle="Target: ≥95%" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                  <MetricCard label="SLA Compliance" value={fmtPct(s.slaCompliancePct)} subtitle="Target: ≥95%" color={slaColor(s.slaCompliancePct)} target={goalTarget('ResolutionSlaPercent')} />
                  <MetricCard label="Resolved" value={fmtInt(s.slaResolved)} subtitle={`${fmtInt(s.slaResolved - s.slaBreached)} within SLA`} color={C.green} />
                  <MetricCard label="Breached" value={fmtInt(s.slaBreached)} subtitle="Target: 0" color={s.slaBreached > 0 ? C.red : C.green} />
                  <MetricCard label="Avg First Response" value={s.frtCompliancePct !== null ? fmtPct(s.frtCompliancePct) : '—'}
                    subtitle={s.frtCompliancePct !== null ? 'Target: ≥95%' : 'Data not yet available'}
                    color={s.frtCompliancePct !== null ? slaColor(s.frtCompliancePct) : C.text3}
                    target={goalTarget('FrtCompliancePercent')} />
                </div>
              </div>

              {/* Aged Tickets */}
              {agedTickets && (
                <div>
                  <SectionTitle title="Aged Tickets" subtitle={`Open tickets exceeding age thresholds · excludes ${agedTickets.development.count} with Development`} />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
                    <MetricCard label="Incidents" value={String(agedTickets.incidents.count)} subtitle="> 5 days old"
                      color={agedTickets.incidents.count > 0 ? C.red : C.green} />
                    <MetricCard label="Service Requests" value={String(agedTickets.serviceRequests.count)} subtitle="> 10 days old"
                      color={agedTickets.serviceRequests.count > 0 ? C.amber : C.green} />
                    <MetricCard label="Onboarding" value={String(agedTickets.onboarding.count)} subtitle="> 15 days old"
                      color={agedTickets.onboarding.count > 0 ? C.amber : C.green} />
                    <MetricCard label="Other" value={String(agedTickets.other.count)} subtitle="No request type · > 10 days"
                      color={agedTickets.other.count > 0 ? C.amber : C.green} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
              background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
            }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text2, marginBottom: 8 }}>No KPI data found</div>
              <div style={{ fontSize: 12, color: C.text3 }}>Try expanding the date range or check that the KPI workflow is running.</div>
            </div>
          )}
        </div>

        {/* RIGHT: Development Context (≈35%) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {planData ? (
            <>
              {/* Role Clarity */}
              {planData.plan.role_clarity && (
                <div style={{
                  background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px',
                }}>
                  <SectionTitle title="Role Clarity" />
                  {editing ? (
                    <textarea
                      defaultValue={planData.plan.role_clarity}
                      onBlur={e => updatePlan({ role_clarity: e.target.value })}
                      style={{
                        width: '100%', minHeight: 120, padding: 10, borderRadius: 8,
                        background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
                        fontSize: 12, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6 }}>
                      {planData.plan.role_clarity}
                    </div>
                  )}
                </div>
              )}

              {/* Strengths */}
              {strengths.length > 0 && (
                <div style={{
                  background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px',
                }}>
                  <SectionTitle title="Current Strengths" />
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {strengths.map((s, i) => (
                      <li key={i} style={{ fontSize: 12, color: C.text2, lineHeight: 1.7, marginBottom: 2 }}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Development Goals */}
              {planData.goals.length > 0 && (
                <div>
                  <SectionTitle title="Development Goals" subtitle={`${planData.goals.filter(g => g.status === 'complete').length}/${planData.goals.length} complete`} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {planData.goals.map(goal => (
                      <GoalCard
                        key={goal.id}
                        goal={goal}
                        currentValue={s ? resolveMetricValue(goal.metric_key, s) : null}
                        editing={editing}
                        onSave={updates => updateGoal(goal.id, updates)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Team-wide Training */}
              {planData.training.length > 0 && (
                <div style={{
                  background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px',
                }}>
                  <SectionTitle title="Team-wide Training" subtitle={`${planData.training.filter(t => t.completed).length}/${planData.training.length} complete`} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {planData.training.map(item => (
                      <label key={item.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 12, color: item.completed ? C.text3 : C.text2,
                        textDecoration: item.completed ? 'line-through' : 'none',
                        cursor: editing ? 'pointer' : 'default',
                      }}>
                        <input
                          type="checkbox"
                          checked={!!item.completed}
                          disabled={!editing}
                          onChange={() => toggleTraining(item.id, !item.completed)}
                          style={{ accentColor: C.teal }}
                        />
                        {item.title}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Important Context */}
              {planData.plan.important_context && (
                <div style={{
                  background: `${C.amber}08`, border: `1px solid ${C.amber}20`, borderRadius: 12, padding: '16px 20px',
                }}>
                  <SectionTitle title="Important Context" />
                  {editing ? (
                    <textarea
                      defaultValue={planData.plan.important_context}
                      onBlur={e => updatePlan({ important_context: e.target.value })}
                      style={{
                        width: '100%', minHeight: 80, padding: 10, borderRadius: 8,
                        background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
                        fontSize: 12, lineHeight: 1.6, resize: 'vertical', fontFamily: 'inherit',
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6 }}>
                      {planData.plan.important_context}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{
              padding: '40px 20px', textAlign: 'center',
              background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
            }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text2, marginBottom: 8 }}>No development plan</div>
              <div style={{ fontSize: 12, color: C.text3 }}>
                {isAdmin ? 'Use the import script or create a plan via the API.' : 'Your manager has not created a development plan yet.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Open Actions */}
      {actions.filter(a => a.status !== 'complete' && a.status !== 'cancelled').length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionTitle title="Open Actions" subtitle="From previous 1-2-1s" />
          <div style={{
            background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {actions.filter(a => a.status !== 'complete' && a.status !== 'cancelled').map(action => (
              <div key={action.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 8, background: C.bg1,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.text1, fontWeight: 500 }}>{action.description}</div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>
                    {action.owner && <span>Owner: {action.owner}</span>}
                    {action.due_date && <span style={{ marginLeft: 8 }}>Due: {action.due_date}</span>}
                  </div>
                </div>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => updateAction(action.id, 'in_progress')} style={{
                      padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: action.status === 'in_progress' ? `${C.blue}30` : C.bg2, color: action.status === 'in_progress' ? C.blue : C.text3,
                    }}>In Progress</button>
                    <button onClick={() => updateAction(action.id, 'complete')} style={{
                      padding: '3px 8px', borderRadius: 6, border: 'none', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: C.bg2, color: C.green,
                    }}>Complete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Every individual conversation on this person's record — 1-2-1s, return-to-work,
          performance, welfare, ad-hoc. Above the snapshot history because it answers the
          first question a manager opening this page has: when did I last sit down with
          them, and about what. */}
      {resolvedAgent && <AgentConversationsPanel agentName={resolvedAgent} />}

      {/* 1-2-1 History Section */}
      {snapshots.length > 0 && (
        <div style={{ marginTop: 32, animation: 'akFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards' }}>
          <div
            onClick={() => setShowHistory(!showHistory)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '14px 24px', cursor: 'pointer',
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: showHistory ? '12px 12px 0 0' : 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SectionTitle title="1-2-1 History" subtitle={`${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}`} />
            </div>
            <span style={{ fontSize: 14, color: C.text3, transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
              ▼
            </span>
          </div>

          {showHistory && (
            <div style={{
              border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 12px 12px',
              padding: 20, background: C.glass,
            }}>
              {/* Import Transcript (admin only) */}
              {isAdmin && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 6 }}>Import Transcript</div>
                  <textarea
                    value={transcriptText}
                    onChange={e => setTranscriptText(e.target.value)}
                    placeholder="Paste transcription or meeting summary here..."
                    style={{
                      width: '100%', minHeight: 60, padding: 10, borderRadius: 8,
                      background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
                      fontSize: 12, lineHeight: 1.5, resize: 'vertical', fontFamily: 'inherit',
                    }}
                  />
                  {transcriptText.trim() && (
                    <button onClick={takeSnapshot} style={{
                      marginTop: 6, padding: '4px 12px', borderRadius: 8, border: 'none',
                      background: `${C.teal}20`, color: C.teal, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>Save with Snapshot</button>
                  )}
                </div>
              )}

              {/* Snapshot list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {snapshots.map(snap => {
                  const isExpanded = expandedSnapshot === snap.id;
                  let prep: PrepData | null = null;
                  if (snap.prep_json) {
                    try { prep = JSON.parse(snap.prep_json); } catch { /* ignore */ }
                  }
                  let metrics: Record<string, any> | null = null;
                  if (snap.metrics_json) {
                    try { metrics = JSON.parse(snap.metrics_json); } catch { /* ignore */ }
                  }
                  let goalSnaps: any[] | null = null;
                  if (snap.goals_json) {
                    try { goalSnaps = JSON.parse(snap.goals_json); } catch { /* ignore */ }
                  }

                  return (
                    <div key={snap.id} style={{
                      background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10,
                      overflow: 'hidden',
                    }}>
                      {/* Snapshot header */}
                      <div
                        onClick={() => setExpandedSnapshot(isExpanded ? null : snap.id)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '12px 16px', cursor: 'pointer',
                          borderLeft: `3px solid ${prep ? C.purple : C.teal}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: C.text1 }}>
                            {new Date(snap.snapshot_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                          {prep && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                              background: `${C.purple}20`, color: C.purple, textTransform: 'uppercase',
                            }}>AI Prep</span>
                          )}
                          {snap.transcript_md && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                              background: `${C.blue}20`, color: C.blue, textTransform: 'uppercase',
                            }}>Transcript</span>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: C.text3, transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                      </div>

                      {/* Expanded content */}
                      {isExpanded && (
                        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${C.border}` }}>
                          {/* AI Prep Document */}
                          {prep && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: C.purple, marginBottom: 8 }}>AI-Generated Prep</div>
                              <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.6, marginBottom: 12 }}>{prep.summary}</div>

                              {prep.whats_improved.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: C.green, marginBottom: 4 }}>What's Improved</div>
                                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {prep.whats_improved.map((item, i) => (
                                      <li key={i} style={{ fontSize: 11, color: C.text2, lineHeight: 1.5 }}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {prep.needs_attention.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: C.amber, marginBottom: 4 }}>Needs Attention</div>
                                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {prep.needs_attention.map((item, i) => (
                                      <li key={i} style={{ fontSize: 11, color: C.text2, lineHeight: 1.5 }}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {prep.goal_progress.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: C.teal, marginBottom: 4 }}>Goal Progress</div>
                                  {prep.goal_progress.map((gp, i) => (
                                    <div key={i} style={{ fontSize: 11, color: C.text2, lineHeight: 1.5, marginBottom: 4 }}>
                                      <span style={{ fontWeight: 600 }}>{gp.goal}</span>
                                      <span style={{ color: C.text3 }}> — {gp.status}</span>
                                      {gp.notes && <span style={{ color: C.text3 }}> — {gp.notes}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {prep.suggested_talking_points.length > 0 && (
                                <div style={{ marginBottom: 10 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text1, marginBottom: 4 }}>Suggested Talking Points</div>
                                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {prep.suggested_talking_points.map((item, i) => (
                                      <li key={i} style={{ fontSize: 11, color: C.text2, lineHeight: 1.5 }}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {prep.suggested_actions.length > 0 && (
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text1, marginBottom: 4 }}>Suggested Actions</div>
                                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                                    {prep.suggested_actions.map((item, i) => (
                                      <li key={i} style={{ fontSize: 11, color: C.text2, lineHeight: 1.5 }}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Frozen Metrics */}
                          {metrics && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 8 }}>Frozen Metrics</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                                {Object.entries(metrics).filter(([k]) => k !== 'latestDate' && k !== 'periodDays').map(([key, val]) => (
                                  <div key={key} style={{
                                    padding: '6px 10px', borderRadius: 8, background: C.bg2,
                                    fontSize: 10, color: C.text2,
                                  }}>
                                    <div style={{ color: C.text3, marginBottom: 2 }}>{key}</div>
                                    <div style={{ fontWeight: 700, color: C.text1 }}>{typeof val === 'number' ? fmt(val) : String(val ?? '—')}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Goal Statuses at Snapshot */}
                          {goalSnaps && goalSnaps.length > 0 && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 8 }}>Goal Status at Snapshot</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {goalSnaps.map((g: any, i: number) => (
                                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 0' }}>
                                    <span style={{ color: C.text2 }}>{g.title}</span>
                                    <span style={{
                                      fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 8,
                                      background: `${statusColor(g.status)}20`, color: statusColor(g.status),
                                    }}>{statusLabel(g.status)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Transcript */}
                          {snap.transcript_md && (
                            <div style={{ marginTop: 16 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8 }}>Transcript / Summary</div>
                              <div style={{
                                fontSize: 11, color: C.text2, lineHeight: 1.6, padding: 12,
                                background: C.bg2, borderRadius: 8, whiteSpace: 'pre-wrap',
                              }}>{snap.transcript_md}</div>
                            </div>
                          )}

                          {/* Notes */}
                          {snap.notes && (
                            <div style={{ marginTop: 12, fontSize: 11, color: C.text3, fontStyle: 'italic' }}>
                              {snap.notes}
                            </div>
                          )}

                          {/* Add Action (admin) */}
                          {isAdmin && (
                            <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 10, color: C.text3, marginBottom: 4 }}>Add Action</div>
                                <input
                                  type="text"
                                  value={newActionText}
                                  onChange={e => setNewActionText(e.target.value)}
                                  placeholder="Action description..."
                                  style={{
                                    width: '100%', padding: '6px 10px', borderRadius: 8,
                                    background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
                                    fontSize: 11, fontFamily: 'inherit',
                                  }}
                                />
                              </div>
                              <div style={{ width: 100 }}>
                                <div style={{ fontSize: 10, color: C.text3, marginBottom: 4 }}>Owner</div>
                                <input
                                  type="text"
                                  value={newActionOwner}
                                  onChange={e => setNewActionOwner(e.target.value)}
                                  placeholder="Owner"
                                  style={{
                                    width: '100%', padding: '6px 10px', borderRadius: 8,
                                    background: C.bg2, color: C.text1, border: `1px solid ${C.border}`,
                                    fontSize: 11, fontFamily: 'inherit',
                                  }}
                                />
                              </div>
                              <button
                                onClick={() => addAction(snap.id)}
                                disabled={!newActionText.trim()}
                                style={{
                                  padding: '6px 14px', borderRadius: 8, border: 'none',
                                  background: newActionText.trim() ? `${C.teal}20` : C.bg2,
                                  color: newActionText.trim() ? C.teal : C.text3,
                                  fontSize: 11, fontWeight: 600, cursor: newActionText.trim() ? 'pointer' : 'default',
                                  whiteSpace: 'nowrap',
                                }}
                              >Add</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
