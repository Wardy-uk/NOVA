import { useState, useCallback, useMemo } from 'react';
import {
  UnifiedQueue,
  type UnifiedQueueConfig,
  type QueueActions,
  StatusPill,
  GlassCard,
  timeAgo,
  riskScoreColor,
} from './queue/index.js';

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
}

async function api(path: string, opts?: RequestInit) {
  const r = await fetch(`/api/agent${path}`, opts);
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: `Non-JSON response (${r.status})` }; }
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

// ── Row component ────────────────────────────────────────────────────────

function FlaggedRow({ ticket, selected, focused }: { ticket: FlaggedTicket; selected: boolean; focused: boolean }) {
  const sla = slaDisplay(ticket);
  return (
    <div
      className={`p-3 transition-all duration-150 border-b border-[#2f353d]/50 ${
        selected ? 'bg-[#5ec1ca]/10' : focused ? 'bg-[#363d47]' : 'hover:bg-[#272c33]'
      }`}
    >
      <div className="flex items-center gap-3 mb-1">
        <span className="text-lg font-bold tabular-nums w-8 text-center" style={{ color: riskScoreColor(ticket.risk_score) }}>
          {ticket.risk_score}
        </span>
        <span className="text-[11px] font-mono text-[#5ec1ca]">{ticket.ticket_key}</span>
        {ticket.priority && <span className="text-[9px] text-neutral-500">{ticket.priority}</span>}
        {ticket.ticket_status && <StatusPill status={ticket.ticket_status} />}
        {sla && <span className={`text-[9px] font-semibold ${sla.color}`}>{sla.text}</span>}
      </div>
      <div className="text-[11px] text-neutral-400 truncate pl-11">
        {ticket.summary ?? 'No summary'}
      </div>
      <div className="flex items-center gap-3 mt-1 pl-11 text-[9px] text-neutral-600">
        <span>{ticket.assignee ?? 'Unassigned'}</span>
        <span>Flagged {timeAgo(ticket.flagged_at)}</span>
        {ticket.risk_factors.length > 0 && (
          <span className="text-neutral-500">{ticket.risk_factors.length} factors</span>
        )}
      </div>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────

function FlaggedDetail({ ticket, actions }: { ticket: FlaggedTicket; actions: QueueActions }) {
  const [reviewing, setReviewing] = useState(false);
  const sla = slaDisplay(ticket);

  const handleReview = async (dismiss: boolean) => {
    setReviewing(true);
    try {
      await api(`/flagged/${ticket.ticket_key}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss }),
      });
      actions.toast(dismiss ? 'Dismissed' : 'Marked as reviewed', 'ok');
      actions.refresh();
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold tabular-nums" style={{ color: riskScoreColor(ticket.risk_score) }}>
            {ticket.risk_score}
          </span>
          <div>
            <a
              href={`https://nurturtech.atlassian.net/browse/${ticket.ticket_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-[#5ec1ca] hover:underline"
            >{ticket.ticket_key}</a>
            <div className="flex items-center gap-2 mt-1">
              {ticket.priority && <span className="text-[10px] text-neutral-500">{ticket.priority}</span>}
              {ticket.ticket_status && <StatusPill status={ticket.ticket_status} />}
              {sla && <span className={`text-[10px] font-semibold ${sla.color}`}>{sla.text}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`https://nurturtech.atlassian.net/browse/${ticket.ticket_key}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#2f353d] text-[#5ec1ca] border border-[#3a424d] hover:bg-[#363d47] transition-colors"
          >Open in Jira</a>
          <button
            disabled={reviewing}
            onClick={() => handleReview(false)}
            className="px-3 py-1.5 text-[11px] font-medium rounded bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 transition-colors disabled:opacity-50"
          >Reviewed</button>
          <button
            disabled={reviewing}
            onClick={() => handleReview(true)}
            className="px-3 py-1.5 text-[11px] font-medium rounded bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:text-neutral-200 transition-colors disabled:opacity-50"
          >Dismiss</button>
        </div>
      </div>

      {/* Summary */}
      <GlassCard className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Summary</div>
        <div className="text-xs text-neutral-300">{ticket.summary ?? 'No summary'}</div>
      </GlassCard>

      {/* Risk Factors */}
      <GlassCard className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Risk Factors</div>
        <div className="flex flex-wrap gap-1.5">
          {ticket.risk_factors.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-[#272C33] border border-[#3a424d] text-neutral-400">
              <span className="font-mono text-neutral-500">+{f.score}</span> {f.label}
            </span>
          ))}
        </div>
      </GlassCard>

      {/* Comment Previews */}
      {(ticket.last_customer_comment || ticket.last_agent_comment) && (
        <GlassCard className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2">Recent Comments</div>
          <div className="space-y-2 text-[11px]">
            {ticket.last_customer_comment && (
              <div>
                <span className="text-violet-400 text-[10px]">
                  Customer{ticket.last_customer_comment_at ? ` (${timeAgo(ticket.last_customer_comment_at)})` : ''}
                </span>
                <div className="text-neutral-400 mt-0.5">{ticket.last_customer_comment}</div>
              </div>
            )}
            {ticket.last_agent_comment && (
              <div>
                <span className="text-blue-400 text-[10px]">
                  Agent{ticket.last_agent_comment_at ? ` (${timeAgo(ticket.last_agent_comment_at)})` : ''}
                </span>
                <div className="text-neutral-400 mt-0.5">{ticket.last_agent_comment}</div>
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-4 text-[10px] text-neutral-500 px-1">
        <span>Assignee: {ticket.assignee ?? 'Unassigned'}</span>
        <span>Reporter: {ticket.reporter ?? '—'}</span>
        <span>Flagged {timeAgo(ticket.flagged_at)}</span>
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────

export function FlaggedQueueView({ tickets, onRefresh }: { tickets: FlaggedTicket[]; onRefresh: () => void }) {
  const [statusFilter, setStatusFilter] = useState<string>('pending');

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return tickets;
    return tickets.filter(t => t.status === statusFilter);
  }, [tickets, statusFilter]);

  const pendingCount = useMemo(() => tickets.filter(t => t.status === 'pending').length, [tickets]);
  const reviewedCount = useMemo(() => tickets.filter(t => t.status === 'reviewed').length, [tickets]);

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

    filters: [
      { key: 'all', label: 'All', count: tickets.length },
      { key: 'pending', label: 'Pending', count: pendingCount },
      { key: 'reviewed', label: 'Reviewed', count: reviewedCount },
    ],
    activeFilter: statusFilter,
    onFilterChange: setStatusFilter,
    searchPlaceholder: 'Search tickets...',
    searchFn: (t, q) =>
      t.ticket_key.toLowerCase().includes(q) ||
      (t.summary?.toLowerCase().includes(q) ?? false) ||
      (t.assignee?.toLowerCase().includes(q) ?? false),

    stats: [
      { label: 'Pending', value: pendingCount, color: '#f59e0b' },
      { label: 'Reviewed', value: reviewedCount, color: '#10b981' },
    ],

    renderDetail: (t, actions) => <FlaggedDetail ticket={t} actions={actions} />,
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
      if (!item) return false;
      if (key === 'r') {
        api(`/flagged/${item.ticket_key}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dismiss: false }),
        }).then(() => onRefresh());
        return true;
      }
      if (key === 'x') {
        api(`/flagged/${item.ticket_key}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dismiss: true }),
        }).then(() => onRefresh());
        return true;
      }
      return false;
    },
  }), [statusFilter, tickets, pendingCount, reviewedCount, onRefresh]);

  return <UnifiedQueue config={config} items={filtered} loading={false} />;
}
