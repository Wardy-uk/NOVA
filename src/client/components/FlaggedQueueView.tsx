import { useState, useEffect, useCallback, useMemo } from 'react';
import { TicketBriefCard, type BriefFields } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { AIAnalysisPanel } from './AIAnalysisPanel.js';
import {
  UnifiedQueue,
  type UnifiedQueueConfig,
  type QueueActions,
  type FilterPill,
  type StatCard,
  type BulkAction,
  StatusPill,
  GlassCard,
  timeAgo,
  riskScoreColor,
} from './queue/index.js';

// ── Types ─────────────────────────────────────────────────────────────────

interface RiskFactor {
  id: string;
  label: string;
  score: number;
  detail?: string;
}

export interface FlaggedTicket {
  id: number;
  ticket_key: string;
  risk_score: number;
  risk_factors: RiskFactor[];
  summary: string | null;
  assignee: string | null;
  reporter: string | null;
  priority: string | null;
  flagged_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  last_notified_score: number;
  ticket_status: string | null;
  sla_breach_at: string | null;
  sla_breached: boolean;
  last_customer_comment: string | null;
  last_customer_comment_at: string | null;
  last_agent_comment: string | null;
  last_agent_comment_at: string | null;
  conversation_json: string | null;
  dismiss_reason: string | null;
}

interface ScoreDistribution {
  bucket: string;
  count: number;
}

interface FlaggedStats {
  count: number;
  highestRisk: FlaggedTicket | null;
  avgScore: number;
  distribution: ScoreDistribution[];
}

interface DiagnoseData {
  found: boolean;
  input: Record<string, unknown> | null;
  score: number;
  threshold: number;
  factors: RiskFactor[];
  enrichment: Record<string, unknown>;
}

const DISMISS_REASONS = [
  { value: 'false_positive', label: 'False positive' },
  { value: 'already_resolved', label: 'Already resolved' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'not_actionable', label: 'Not actionable' },
];

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  highest: 'bg-red-500/20 text-red-400 border-red-500/30',
  major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  minor: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  low: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  lowest: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

// ── API helper ────────────────────────────────────────────────────────────

async function api(path: string, opts?: RequestInit) {
  const token = localStorage.getItem('nova_auth_token') || '';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(opts?.headers as Record<string, string> ?? {}) };
  if (opts?.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`/api/agent${path}`, { ...opts, headers });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: `Non-JSON response (${r.status})` }; }
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
    return { text: `Breached ${Math.round(mins / 60)}h ago`, color: 'text-red-400' };
  }
  if (t.sla_breach_at) {
    const mins = Math.round((new Date(t.sla_breach_at).getTime() - Date.now()) / 60000);
    if (mins <= 0) return { text: 'SLA Breached', color: 'text-red-400' };
    if (mins < 60) return { text: `SLA in ${mins}m`, color: 'text-amber-400' };
    return { text: `SLA in ${Math.round(mins / 60)}h`, color: 'text-neutral-400' };
  }
  return null;
}

function parseConversation(json: string | null): Array<{ role: string; text: string; author?: string }> {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((msg: any) => ({
      role: msg.role || 'unknown',
      text: msg.body || msg.text || '',
      author: msg.author || undefined,
    }));
  } catch { return []; }
}

function riskBucketColor(bucket: string): string {
  if (bucket.startsWith('90') || bucket.startsWith('80')) return '#ef4444';
  if (bucket.startsWith('70') || bucket.startsWith('60')) return '#f59e0b';
  if (bucket.startsWith('50') || bucket.startsWith('40')) return '#eab308';
  return '#6b7280';
}

// ── Row component ─────────────────────────────────────────────────────────

function FlaggedRow({ ticket, selected, focused }: { ticket: FlaggedTicket; selected: boolean; focused: boolean }) {
  const sla = slaDisplay(ticket);
  const priStyle = PRIORITY_STYLES[(ticket.priority || 'normal').toLowerCase()] || PRIORITY_STYLES.normal;
  return (
    <div
      className={`px-3 py-3 transition-all duration-150 border-b border-[#2f353d]/50 ${
        selected ? 'bg-[#5ec1ca]/10' : focused ? 'bg-[#363d47]' : 'hover:bg-[#272c33]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg font-bold tabular-nums w-8 text-center" style={{ color: riskScoreColor(ticket.risk_score) }}>
          {ticket.risk_score}
        </span>
        <span className="text-[11px] font-mono font-semibold text-[#5ec1ca]">{ticket.ticket_key}</span>
        {ticket.priority && (
          <span className={`inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded border ${priStyle}`}>{ticket.priority}</span>
        )}
        {ticket.ticket_status && <StatusPill status={ticket.ticket_status} />}
        {sla && <span className={`text-[9px] font-semibold ${sla.color}`}>{sla.text}</span>}
      </div>
      <div className="text-[11px] text-neutral-300 truncate pl-11">
        {ticket.summary ?? 'No summary'}
      </div>
      <div className="flex items-center gap-3 mt-1 pl-11 text-[9px] text-neutral-500">
        <span>{ticket.assignee ?? 'Unassigned'}</span>
        <span>Flagged {timeAgo(ticket.flagged_at)}</span>
        {ticket.risk_factors.length > 0 && (
          <span className="text-neutral-500">{ticket.risk_factors.length} factors</span>
        )}
      </div>
    </div>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────

function FlaggedDetail({ ticket, actions, onRefresh }: { ticket: FlaggedTicket; actions: QueueActions; onRefresh: () => void }) {
  const [reviewing, setReviewing] = useState(false);
  const [showDismissForm, setShowDismissForm] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [briefFields, setBriefFields] = useState<BriefFields | null>(null);
  const [diagnoseData, setDiagnoseData] = useState<DiagnoseData | null>(null);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);
  const sla = slaDisplay(ticket);
  const isPending = ticket.status === 'pending';
  const conversation = parseConversation(ticket.conversation_json);

  useEffect(() => {
    setShowDismissForm(false);
    setDismissReason('');
    setCustomReason('');
    setDiagnoseData(null);

    if (!ticket.ticket_key) return;
    const token = localStorage.getItem('nova_auth_token') || '';
    fetch(`/api/jira/issues/${ticket.ticket_key}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(json => { if (json.ok && json.data) setBriefFields((json.data.fields ?? json.data) as BriefFields); })
      .catch(() => {});
  }, [ticket.ticket_key]);

  const loadDiagnose = useCallback(async () => {
    setDiagnoseLoading(true);
    try {
      const r = await api(`/flagged/diagnose/${ticket.ticket_key}`);
      if (r.ok) setDiagnoseData(r.data);
    } finally { setDiagnoseLoading(false); }
  }, [ticket.ticket_key]);

  const handleReview = async () => {
    setReviewing(true);
    try {
      await api(`/flagged/${ticket.ticket_key}/review`, {
        method: 'POST',
        body: JSON.stringify({ dismiss: false }),
      });
      actions.toast('Marked as reviewed', 'ok');
      onRefresh();
    } finally { setReviewing(false); }
  };

  const handleDismiss = async () => {
    if (!showDismissForm) { setShowDismissForm(true); return; }
    const reason = dismissReason === 'custom' ? customReason.trim() : dismissReason;
    if (!reason) return;
    setReviewing(true);
    try {
      await api(`/flagged/${ticket.ticket_key}/review`, {
        method: 'POST',
        body: JSON.stringify({ dismiss: true, dismiss_reason: reason }),
      });
      actions.toast('Dismissed', 'ok');
      onRefresh();
    } finally { setReviewing(false); }
  };

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-3xl font-bold tabular-nums" style={{ color: riskScoreColor(ticket.risk_score) }}>
              {ticket.risk_score}
            </span>
            <a
              href={`https://nurturtech.atlassian.net/browse/${ticket.ticket_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono font-semibold text-[#5ec1ca] hover:underline"
            >{ticket.ticket_key}</a>
            {ticket.ticket_status && <StatusPill status={ticket.ticket_status} />}
            {sla && <span className={`text-[10px] font-semibold ${sla.color}`}>{sla.text}</span>}
          </div>
          <div className="text-sm text-neutral-100 font-semibold">{ticket.summary ?? 'No summary'}</div>
        </div>
        <a
          href={`https://nurturtech.atlassian.net/browse/${ticket.ticket_key}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 text-[11px] rounded-lg bg-[#2f353d] text-[#5ec1ca] border border-[#3a424d] hover:bg-[#363d47] font-medium shrink-0"
        >Open in Jira</a>
      </div>

      {/* Live Jira context via TicketBriefCard */}
      {briefFields && <TicketBriefCard ticketKey={ticket.ticket_key} fields={briefFields} tier={(briefFields.customfield_12981 as any)?.value ?? null} compact />}

      {/* AI Suggested Next Action */}
      <AINextActionCard ticketKey={ticket.ticket_key} compact />

      {/* AI Analysis */}
      <AIAnalysisPanel ticketKey={ticket.ticket_key} />

      {/* Risk Factors */}
      <GlassCard className="p-4" accentGradient="#ef4444 30%, #f59e0b 70%" accent>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] font-bold uppercase tracking-wider text-red-400">Risk Factors</div>
          <button
            onClick={loadDiagnose}
            disabled={diagnoseLoading}
            className="text-[10px] text-[#5ec1ca] hover:underline disabled:opacity-50"
          >{diagnoseLoading ? 'Loading…' : diagnoseData ? 'Refresh diagnosis' : 'Run diagnosis'}</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ticket.risk_factors.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-[#272C33] border border-[#3a424d] text-neutral-400" title={f.detail}>
              <span className="font-mono text-neutral-500">+{f.score}</span> {f.label}
            </span>
          ))}
        </div>
        {diagnoseData && diagnoseData.found && (
          <div className="mt-3 pt-3 border-t border-[#3a424d]">
            <div className="text-[10px] text-neutral-500 mb-1">
              Recalculated: <span className="font-bold" style={{ color: riskScoreColor(diagnoseData.score) }}>{diagnoseData.score}</span> / threshold {diagnoseData.threshold}
            </div>
            {diagnoseData.factors.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {diagnoseData.factors.map((f, i) => (
                  <span key={i} className="px-1.5 py-0.5 text-[9px] rounded bg-[#1a1e24] border border-[#3a424d] text-neutral-500">
                    +{f.score} {f.label}{f.detail ? ` — ${f.detail}` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Ticket Details grid */}
      <GlassCard className="p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-3">Ticket Details</div>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <div><span className="text-neutral-500 text-[11px]">Assignee</span><div className="text-neutral-300">{ticket.assignee ?? 'Unassigned'}</div></div>
          <div><span className="text-neutral-500 text-[11px]">Reporter</span><div className="text-neutral-300">{ticket.reporter ?? '—'}</div></div>
          <div><span className="text-neutral-500 text-[11px]">Priority</span><div><span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${PRIORITY_STYLES[(ticket.priority || 'normal').toLowerCase()] || PRIORITY_STYLES.normal}`}>{ticket.priority || 'Normal'}</span></div></div>
          {(() => {
            const bc = (briefFields?.customfield_14626 as string) ?? (briefFields as any)?.bc_account_number ?? null;
            return bc ? <div><span className="text-neutral-500 text-[11px]">BC Account</span><div className="text-amber-300 font-mono font-semibold">{bc}</div></div> : null;
          })()}
          <div><span className="text-neutral-500 text-[11px]">Flagged</span><div className="text-neutral-300">{timeAgo(ticket.flagged_at)}</div></div>
          {ticket.reviewed_by && (
            <>
              <div><span className="text-neutral-500 text-[11px]">Reviewed By</span><div className="text-neutral-300">{ticket.reviewed_by}</div></div>
              <div><span className="text-neutral-500 text-[11px]">Reviewed At</span><div className="text-neutral-300">{ticket.reviewed_at ? timeAgo(ticket.reviewed_at) : '—'}</div></div>
            </>
          )}
          {ticket.dismiss_reason && (
            <div className="col-span-2"><span className="text-neutral-500 text-[11px]">Dismiss Reason</span><div className="text-neutral-300">{ticket.dismiss_reason}</div></div>
          )}
        </div>
      </GlassCard>

      {/* Full Conversation Thread */}
      {conversation.length > 0 && (
        <GlassCard className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-3">Conversation History</div>
          <div className="space-y-3 max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3a424d transparent' }}>
            {conversation.map((msg, i) => {
              const isAgent = msg.role === 'agent';
              return (
                <div key={i} className="flex gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: isAgent ? 'rgba(94,193,202,0.15)' : 'rgba(124,58,237,0.15)' }}>
                    {isAgent ? '🤖' : '💬'}
                  </div>
                  <div className="flex-1 min-w-0">
                    {msg.author && <div className="text-[11px] text-neutral-500 mb-0.5">{msg.author}</div>}
                    <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{msg.text}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* Fallback: last comments if no conversation_json */}
      {conversation.length === 0 && (ticket.last_customer_comment || ticket.last_agent_comment) && (
        <GlassCard className="p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Recent Comments</div>
          <div className="space-y-3">
            {ticket.last_customer_comment && (
              <div className="flex gap-3">
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(124,58,237,0.15)' }}>💬</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-neutral-500 mb-0.5">Customer{ticket.last_customer_comment_at ? ` · ${timeAgo(ticket.last_customer_comment_at)}` : ''}</div>
                  <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{ticket.last_customer_comment}</div>
                </div>
              </div>
            )}
            {ticket.last_agent_comment && (
              <div className="flex gap-3">
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(94,193,202,0.15)' }}>🤖</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-neutral-500 mb-0.5">Agent{ticket.last_agent_comment_at ? ` · ${timeAgo(ticket.last_agent_comment_at)}` : ''}</div>
                  <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{ticket.last_agent_comment}</div>
                </div>
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Action bar */}
      {isPending && (
        <div className="sticky bottom-0 bg-[#14171c]/95 backdrop-blur-sm border-t border-[#2f353d] -mx-5 px-5 py-3 flex items-center gap-2">
          <button
            disabled={reviewing}
            onClick={handleReview}
            className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)' }}
          >Reviewed</button>
          <button
            disabled={reviewing}
            onClick={handleDismiss}
            className="px-4 py-2 text-xs rounded-lg font-bold bg-red-900/30 text-red-400 border border-red-800/40 hover:bg-red-900/50 disabled:opacity-50"
          >Dismiss</button>
          {showDismissForm && (
            <div className="flex items-center gap-2 flex-1">
              <select
                value={dismissReason}
                onChange={e => setDismissReason(e.target.value)}
                className="px-2 py-1.5 text-[11px] rounded-lg bg-[#1a1e24] border border-[#2f353d] text-neutral-200"
              >
                <option value="">Select reason…</option>
                {DISMISS_REASONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
                <option value="custom">Other…</option>
              </select>
              {dismissReason === 'custom' && (
                <input
                  value={customReason}
                  onChange={e => setCustomReason(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleDismiss()}
                  placeholder="Custom reason…"
                  className="flex-1 px-3 py-1.5 text-[11px] rounded-lg bg-[#1a1e24] border border-[#2f353d] text-neutral-200 placeholder-neutral-600"
                  autoFocus
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────

export function FlaggedQueueView({ tickets, onRefresh }: { tickets: FlaggedTicket[]; onRefresh: () => void }) {
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [stats, setStats] = useState<FlaggedStats | null>(null);

  const fetchStats = useCallback(async () => {
    const [summaryRes, distRes] = await Promise.all([
      api('/flagged/summary'),
      api('/flagged/score-distribution'),
    ]);
    const summary = summaryRes.ok ? summaryRes.data : { count: 0, highestRisk: null, avgScore: 0 };
    const distribution = distRes.ok ? distRes.data : [];
    setStats({ ...summary, distribution });
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleRefresh = useCallback(() => {
    onRefresh();
    fetchStats();
  }, [onRefresh, fetchStats]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return tickets;
    return tickets.filter(t => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const pendingCount = useMemo(() => tickets.filter(t => t.status === 'pending').length, [tickets]);
  const reviewedCount = useMemo(() => tickets.filter(t => t.status === 'reviewed').length, [tickets]);

  const handleBulkAction = async (action: 'review' | 'dismiss', keys: string[]) => {
    await api('/flagged/bulk-review', {
      method: 'POST',
      body: JSON.stringify({ keys, dismiss: action === 'dismiss' }),
    });
    handleRefresh();
  };

  const filterPills: FilterPill[] = [
    { key: 'all', label: 'All', count: tickets.length },
    { key: 'pending', label: 'Pending', count: pendingCount },
    { key: 'reviewed', label: 'Reviewed', count: reviewedCount },
  ];

  const statCards: StatCard[] = stats ? [
    { label: 'Pending', value: stats.count, color: '#f59e0b' },
    { label: 'Avg Risk', value: Math.round(stats.avgScore), color: riskScoreColor(Math.round(stats.avgScore)) },
    ...(stats.distribution
      .filter(d => d.count > 0)
      .slice(0, 2)
      .map(d => ({ label: d.bucket, value: d.count, color: riskBucketColor(d.bucket) }))
    ),
  ] : [
    { label: 'Pending', value: pendingCount, color: '#f59e0b' },
    { label: 'Reviewed', value: reviewedCount, color: '#10b981' },
  ];

  const bulkActions: BulkAction[] = statusFilter === 'pending' ? [
    { key: 'review', label: 'Mark Reviewed', variant: 'primary', onExecute: (keys) => handleBulkAction('review', keys) },
    { key: 'dismiss', label: 'Dismiss', variant: 'danger', onExecute: (keys) => handleBulkAction('dismiss', keys) },
  ] : [];

  const config: UnifiedQueueConfig<FlaggedTicket> = useMemo(() => ({
    title: 'Flagged for Review',
    icon: <span>⚠️</span>,
    accentGradient: '#ef4444 30%, #f59e0b 70%',

    fetchItems: async () => {
      const r = await api('/flagged');
      return r.ok ? r.data : [];
    },
    pollIntervalMs: 60000,

    getKey: t => t.ticket_key,
    renderRow: (t, { selected, focused }) => (
      <FlaggedRow ticket={t} selected={selected} focused={focused} />
    ),

    filters: filterPills,
    activeFilter: statusFilter,
    onFilterChange: setStatusFilter,
    searchPlaceholder: 'Search by ticket, assignee, or summary…',
    searchFn: (t, q) =>
      t.ticket_key.toLowerCase().includes(q) ||
      (t.summary?.toLowerCase().includes(q) ?? false) ||
      (t.assignee?.toLowerCase().includes(q) ?? false) ||
      (t.reporter?.toLowerCase().includes(q) ?? false),

    stats: statCards,

    selectable: statusFilter === 'pending',
    bulkActions,

    renderDetail: (t, queueActions) => <FlaggedDetail ticket={t} actions={queueActions} onRefresh={handleRefresh} />,
    renderEmpty: () => (
      <div className="flex items-center justify-center h-full text-neutral-600 text-[11px]">
        No flagged tickets — the risk sweep hasn't found anything above threshold yet.
      </div>
    ),

    keyboardShortcuts: [
      { key: 'r', label: 'reviewed' },
      { key: 'x', label: 'dismiss' },
    ],
    onKeyAction: (key, item) => {
      if (!item || item.status !== 'pending') return false;
      if (key === 'r') {
        api(`/flagged/${item.ticket_key}/review`, {
          method: 'POST',
          body: JSON.stringify({ dismiss: false }),
        }).then(() => handleRefresh());
        return true;
      }
      if (key === 'x') {
        api(`/flagged/${item.ticket_key}/review`, {
          method: 'POST',
          body: JSON.stringify({ dismiss: true, dismiss_reason: 'keyboard_dismiss' }),
        }).then(() => handleRefresh());
        return true;
      }
      return false;
    },
  }), [statusFilter, tickets, pendingCount, reviewedCount, handleRefresh, stats]);

  return <UnifiedQueue config={config} items={filtered} loading={false} />;
}
