import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Task } from '../../shared/types.js';
import { useMyTicketsQueue, type RankedTicket, type TicketBand } from '../hooks/useMyTicketsQueue.js';
import { TicketBriefCard, type BriefFields } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { AdfCommentBody } from './AdfCommentBody.js';
import { AIAnalysisPanel } from './AIAnalysisPanel.js';
import { DeferReasonModal } from './DeferReasonModal.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface Props {
  tasks: Task[];
  loading: boolean;
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  agentUsername: string;
  agentDisplayName: string;
  teamName?: string;
}

interface JiraTransition {
  id?: number | string;
  name?: string;
  to?: { name?: string };
}

interface JiraComment {
  id: string;
  body: unknown;
  author: { displayName?: string; display_name?: string; name?: string };
  created: string;
}

interface TicketDetail {
  issue: Record<string, unknown> | null;
  comments: JiraComment[];
  transitions: JiraTransition[];
  loading: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const CUSTOMER_FACING_STATUSES = ['waiting on requestor', 'waiting on partner'];

function getDefaultCommentType(transitionName: string): 'public' | 'internal' {
  return CUSTOMER_FACING_STATUSES.includes(transitionName.toLowerCase()) ? 'public' : 'internal';
}

function commentBodyToText(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  try {
    const walk = (node: any): string => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(walk).join('');
      return '';
    };
    return walk(body);
  } catch { return ''; }
}

// ── Visual primitives ──────────────────────────────────────────────────────

function GlassCard({ children, className = '', accent }: { children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {accent && (
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: 'linear-gradient(90deg, transparent, #10b981 30%, #5ec1ca 70%, transparent)',
            backgroundSize: '200% 100%',
            animation: 'mtShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string | null | undefined }) {
  const s = status?.toLowerCase() ?? '';
  let bg = 'rgba(100,116,139,0.15)';
  let fg = '#64748b';
  let label = status ?? 'Unknown';

  if (s.includes('progress')) { bg = 'rgba(94,193,202,0.15)'; fg = '#5ec1ca'; }
  else if (s.includes('waiting')) { bg = 'rgba(245,158,11,0.15)'; fg = '#f59e0b'; }
  else if (s.includes('resolved') || s.includes('closed') || s.includes('done')) { bg = 'rgba(16,185,129,0.15)'; fg = '#10b981'; }
  else if (s.includes('open') || s.includes('new')) { bg = 'rgba(155,106,237,0.15)'; fg = '#9b6aed'; }

  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color: fg, border: `1px solid ${fg}40` }}
    >
      {label}
    </span>
  );
}

function BandChip({ band }: { band: TicketBand }) {
  const map: Record<TicketBand, { bg: string; fg: string; label: string }> = {
    NOW: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'NOW' },
    NEXT: { bg: 'rgba(94,193,202,0.15)', fg: '#5ec1ca', label: 'NEXT' },
    DEFERRED: { bg: 'rgba(155,106,237,0.15)', fg: '#9b6aed', label: 'DEFERRED' },
    HYGIENE: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', label: 'HYGIENE' },
    WAITING: { bg: 'rgba(100,116,139,0.15)', fg: '#64748b', label: 'WAITING' },
  };
  const m = map[band];
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: m.bg, color: m.fg, border: `1px solid ${m.fg}40` }}
    >
      {m.label}
    </span>
  );
}

// ── Queue row ──────────────────────────────────────────────────────────────

function QueueRow({
  ticket, selected, isNow, onClick,
}: { ticket: RankedTicket; selected: boolean; isNow: boolean; onClick: () => void }) {
  const { fields } = ticket;
  const summary = fields.summary || '(no summary)';
  const tldr = fields.tldr;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer p-3 rounded-xl transition-all duration-200"
      style={{
        background: selected
          ? 'rgba(16,185,129,0.1)'
          : isNow
          ? 'rgba(16,185,129,0.04)'
          : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? 'rgba(16,185,129,0.4)' : isNow ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: selected ? '0 4px 20px rgba(16,185,129,0.15)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono font-bold text-[#5ec1ca]">{ticket.ticketKey}</span>
          <BandChip band={ticket.band} />
        </div>
        <StatusPill status={fields.status} />
      </div>
      <div className="text-[12px] text-neutral-50 font-semibold truncate mb-1">{summary}</div>
      {tldr && (
        <div className="text-[11px] text-neutral-300 line-clamp-2 mb-2 leading-snug">{tldr}</div>
      )}
      <div className="flex items-center justify-between text-[10px] text-neutral-400">
        <div className="flex items-center gap-2">
          {fields.tier && (
            <span
              className="px-1.5 py-0.5 rounded font-semibold"
              style={{
                background: 'linear-gradient(135deg, rgba(94,193,202,0.15), rgba(155,106,237,0.15))',
                color: '#c4b5fd',
                border: '1px solid rgba(155,106,237,0.25)',
              }}
            >
              {fields.tier}
            </span>
          )}
          {fields.product && fields.product !== 'Unassigned' && (
            <span className="text-neutral-500">{fields.product}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fields.slaBreached && (
            <span className="text-red-400 font-bold">SLA BREACHED</span>
          )}
          <span>{ticket.rankReason}</span>
        </div>
      </div>
    </div>
  );
}

// ── Band section header ────────────────────────────────────────────────────

function BandSection({ band, tickets, selectedKey, onSelect }: {
  band: TicketBand;
  tickets: RankedTicket[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(band === 'NOW' || band === 'NEXT');

  if (tickets.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-white/5 rounded-lg transition-colors"
      >
        <span className="text-[10px] text-neutral-500">{open ? '▼' : '▶'}</span>
        <BandChip band={band} />
        <span className="text-[10px] text-neutral-500">({tickets.length})</span>
      </button>
      {open && (
        <div className="space-y-1.5 mt-1">
          {tickets.map(ticket => (
            <QueueRow
              key={ticket.ticketKey}
              ticket={ticket}
              selected={ticket.ticketKey === selectedKey}
              isNow={ticket.band === 'NOW'}
              onClick={() => onSelect(ticket.ticketKey)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ticket detail pane ─────────────────────────────────────────────────────

function TicketDetailPanel({ ticketKey, ticket, onDefer, onRefreshQueue }: {
  ticketKey: string;
  ticket: RankedTicket;
  onDefer: () => void;
  onRefreshQueue: () => void;
}) {
  const [detail, setDetail] = useState<TicketDetail>({ issue: null, comments: [], transitions: [], loading: true });
  const [commentDraft, setCommentDraft] = useState('');
  const [commentType, setCommentType] = useState<'internal' | 'public'>('internal');
  const [transitionModal, setTransitionModal] = useState<{ transition: JiraTransition; comment: string; commentType: 'internal' | 'public' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [aiDraftUsed, setAiDraftUsed] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const fireToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const loadDetail = useCallback(async () => {
    setDetail(d => ({ ...d, loading: true }));
    try {
      const [issueRes, transRes] = await Promise.all([
        fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}`).then(r => r.json()),
        fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}/transitions`).then(r => r.json()).catch(() => null),
      ]);

      let issue: Record<string, unknown> | null = null;
      let comments: JiraComment[] = [];
      if (issueRes?.ok && isObj(issueRes.data)) {
        issue = issueRes.data as Record<string, unknown>;
        // Comments come as a top-level array from our enriched endpoint,
        // or nested under issue.comment.comments from raw Jira response
        const rawComments = issue.comments;
        const cf = issue.comment as { comments?: JiraComment[] } | JiraComment[] | undefined;
        comments = Array.isArray(rawComments) ? rawComments as JiraComment[]
          : Array.isArray(cf) ? cf
          : (cf as { comments?: JiraComment[] })?.comments
          ?? [];
      }

      let transitions: JiraTransition[] = [];
      if (transRes?.ok) {
        const data = transRes.data;
        transitions = Array.isArray(data) ? data : data?.transitions ?? data?.value ?? [];
      }

      setDetail({ issue, comments, transitions, loading: false });
    } catch {
      setDetail(d => ({ ...d, loading: false }));
    }
  }, [ticketKey]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // Auto-refresh detail every 60s (diff-aware to avoid flicker)
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const [issueRes, transRes] = await Promise.all([
          fetch(`/api/my-tickets/${encodeURIComponent(ticketKey)}`).then(r => r.json()),
          fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}/transitions`).then(r => r.json()),
        ]);
        if (!active) return;
        setDetail(prev => {
          const newIssue = issueRes?.ok ? issueRes.data as Record<string, unknown> : prev.issue;
          const rawComments = (newIssue as any)?.comments;
          const cf = (newIssue as any)?.comment as { comments?: unknown[] } | unknown[] | undefined;
          const newComments = Array.isArray(rawComments) ? rawComments
            : Array.isArray(cf) ? cf
            : (cf as { comments?: unknown[] })?.comments ?? prev.comments;
          const newTransitions = transRes?.ok
            ? (Array.isArray(transRes.data) ? transRes.data : transRes.data?.transitions ?? transRes.data?.value ?? prev.transitions)
            : prev.transitions;
          const next = { issue: newIssue, comments: newComments as any, transitions: newTransitions as any, loading: false };
          if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
          return next;
        });
      } catch { /* silent */ }
    };
    const i = setInterval(poll, 60_000);
    return () => { active = false; clearInterval(i); };
  }, [ticketKey]);

  // Build BriefFields for TicketBriefCard from live issue data or queue fields
  const briefProps = useMemo(() => {
    const fields: BriefFields = {};
    if (detail.issue) {
      Object.assign(fields, detail.issue);
    } else {
      fields.summary = ticket.fields.summary ?? undefined;
      fields.status = ticket.fields.status ? { name: ticket.fields.status } : undefined;
      if (ticket.fields.tldr) fields.customfield_13184 = ticket.fields.tldr;
      if (ticket.fields.agentSummary) fields.customfield_13185 = ticket.fields.agentSummary;
      if (ticket.fields.escalationReason) fields.customfield_13186 = { value: ticket.fields.escalationReason };
      if (ticket.fields.tier) fields.customfield_12981 = { value: ticket.fields.tier };
    }
    const tierRaw = detail.issue?.customfield_12981;
    const tier = ticket.fields.tier
      || (typeof tierRaw === 'string' ? tierRaw : (tierRaw as any)?.value ?? null);
    return { ticketKey, fields, tier };
  }, [ticketKey, detail.issue, ticket.fields]);

  // ── Actions ──────────────────────────────────────────────────────────

  const handlePostComment = async () => {
    if (!commentDraft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: commentDraft.trim(), commentVisibility: commentType }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Failed to post comment');
      fireToast('ok', `${commentType === 'public' ? 'Public' : 'Internal'} comment posted`);
      setCommentDraft('');
      await loadDetail();
    } catch (err) {
      fireToast('err', err instanceof Error ? err.message : 'Comment failed');
    } finally {
      setBusy(false);
    }
  };

  const handleTransition = async (t: JiraTransition, comment?: string, cType?: 'internal' | 'public') => {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { transition: String(t.id ?? t.name ?? '') };
      if (comment?.trim()) {
        body.comment = comment.trim();
        body.commentVisibility = cType ?? 'internal';
      }
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Transition failed');
      fireToast('ok', `Transitioned to ${t.to?.name ?? t.name ?? 'new status'}`);
      await loadDetail();
      onRefreshQueue();
    } catch (err) {
      fireToast('err', err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setBusy(false);
      setTransitionModal(null);
    }
  };

  const openTransitionModal = (t: JiraTransition) => {
    setTransitionModal({
      transition: t,
      comment: '',
      commentType: getDefaultCommentType(t.name ?? ''),
    });
  };

  // ── Render ──────────────────────────────────────────────────────────

  if (detail.loading && !detail.issue) {
    return (
      <GlassCard accent className="flex-1 flex items-center justify-center">
        <div className="text-sm text-neutral-500">Loading ticket…</div>
      </GlassCard>
    );
  }

  const statusName = detail.issue?.status
    ? (isObj(detail.issue.status) ? (detail.issue.status as any).name : String(detail.issue.status))
    : ticket.fields.status;

  return (
    <>
      {/* Action bar */}
      <GlassCard accent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <a
                href={`https://nurturtech.atlassian.net/browse/${ticketKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono font-bold text-[#5ec1ca] hover:underline"
              >
                {ticketKey}
              </a>
              <BandChip band={ticket.band} />
              <StatusPill status={statusName} />
              {ticket.fields.tier && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgba(155,106,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(155,106,237,0.3)' }}>
                  {ticket.fields.tier}
                </span>
              )}
            </div>
            <h2
              className="text-xl font-bold text-neutral-100 leading-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
            >
              {detail.issue?.summary as string ?? ticket.fields.summary ?? ticketKey}
            </h2>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-300">
              <span>Reporter: <span className="text-neutral-100 font-semibold">{(detail.issue?.reporter as any)?.displayName ?? ticket.fields.reporter ?? '—'}</span></span>
              <span className="text-neutral-600">·</span>
              <span>Updated <span className="text-neutral-100">{timeAgo(detail.issue?.updated as string ?? ticket.fields.updated)}</span> ago</span>
              <span className="text-neutral-600">·</span>
              <span className="text-[10px] text-neutral-500">Score: {ticket.score}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {ticket.band === 'NOW' && (
              <button
                onClick={onDefer}
                className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-white/10 text-neutral-300 hover:bg-white/5 transition-colors"
              >
                Defer
              </button>
            )}
            <a
              href={`https://nurturtech.atlassian.net/browse/${ticketKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-white/10 text-neutral-300 hover:bg-white/5"
            >
              Open in Jira ↗
            </a>
          </div>
        </div>
      </GlassCard>

      {/* Body: brief + activity */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Left: Brief + AI */}
        <div className="space-y-4">
          <TicketBriefCard {...briefProps} />
          <AINextActionCard ticketKey={ticketKey} pendingDecision={ticket.pendingDecision} onDecisionActioned={onRefreshQueue} />
          <AIAnalysisPanel
            ticketKey={ticketKey}
            pendingApproval={ticket.pendingDecision ? { id: ticket.pendingDecision.id, status: 'pending' } : null}
            onApprovalActioned={onRefreshQueue}
            onUseDraft={(draft) => {
              setCommentDraft(draft);
              setCommentType('public');
              setAiDraftUsed(true);
              setTimeout(() => {
                commentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                commentRef.current?.focus();
              }, 100);
            }}
          />

          {/* Ticket Details grid */}
          <GlassCard className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">Ticket Details</div>
            <div className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <span className="text-neutral-500 text-[11px]">Assignee</span>
                <div className="text-neutral-300">
                  {(detail.issue?.assignee && isObj(detail.issue.assignee) ? (detail.issue.assignee as any).displayName : null)
                    ?? ticket.fields.assignee ?? 'Unassigned'}
                </div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">Reporter</span>
                <div className="text-neutral-300">
                  {(detail.issue?.reporter && isObj(detail.issue.reporter) ? (detail.issue.reporter as any).displayName : null)
                    ?? ticket.fields.reporter ?? '—'}
                </div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">Priority</span>
                <div className="text-neutral-300">
                  {(detail.issue?.priority && isObj(detail.issue.priority) ? (detail.issue.priority as any).name : null)
                    ?? ticket.fields.priority ?? 'Normal'}
                </div>
              </div>
              <div>
                <span className="text-neutral-500 text-[11px]">Created</span>
                <div className="text-neutral-300">{timeAgo(ticket.fields.created ?? (detail.issue?.created as string))} ago</div>
              </div>
              {ticket.fields.slaBreachTime && (
                <div className="col-span-2">
                  <span className="text-neutral-500 text-[11px]">SLA</span>
                  <div className={ticket.fields.slaBreached ? 'text-red-400 font-semibold' : 'text-neutral-300'}>
                    {ticket.fields.slaBreached ? 'BREACHED' : `Breach at ${new Date(ticket.fields.slaBreachTime).toLocaleString()}`}
                  </div>
                </div>
              )}
              {ticket.fields.product && (
                <div>
                  <span className="text-neutral-500 text-[11px]">Product</span>
                  <div className="text-neutral-300">{ticket.fields.product}</div>
                </div>
              )}
              {ticket.fields.bcAccountNumber && (
                <div>
                  <span className="text-neutral-500 text-[11px]">BC Account</span>
                  <div className="text-neutral-300">{ticket.fields.bcAccountNumber}</div>
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        {/* Right: Activity + Comments + Actions */}
        <div className="space-y-4">
          {/* Transitions */}
          {detail.transitions.length > 0 && (
            <GlassCard className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">Status Transitions</div>
              <div className="flex flex-wrap gap-2">
                {detail.transitions.map((t) => (
                  <button
                    key={String(t.id ?? t.name)}
                    onClick={() => openTransitionModal(t)}
                    disabled={busy}
                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-white/10 text-neutral-200 hover:bg-white/8 transition-all disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.04)' }}
                  >
                    → {t.to?.name ?? t.name}
                  </button>
                ))}
              </div>
            </GlassCard>
          )}

          {/* Comment composer */}
          <GlassCard className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold">Add Comment</div>
              {aiDraftUsed && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30">AI draft</span>
              )}
            </div>
            <textarea
              ref={commentRef}
              value={commentDraft}
              onChange={(e) => { setCommentDraft(e.target.value); if (aiDraftUsed) setAiDraftUsed(false); }}
              placeholder="Write a comment…"
              rows={3}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 mb-2"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCommentType('internal')}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all"
                  style={{
                    background: commentType === 'internal' ? 'rgba(245,158,11,0.15)' : 'transparent',
                    color: commentType === 'internal' ? '#f59e0b' : '#64748b',
                    border: `1px solid ${commentType === 'internal' ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  Internal
                </button>
                <button
                  onClick={() => setCommentType('public')}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all"
                  style={{
                    background: commentType === 'public' ? 'rgba(16,185,129,0.15)' : 'transparent',
                    color: commentType === 'public' ? '#10b981' : '#64748b',
                    border: `1px solid ${commentType === 'public' ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  Public
                </button>
              </div>
              <button
                onClick={handlePostComment}
                disabled={busy || !commentDraft.trim()}
                className="px-4 py-1.5 text-[11px] font-bold rounded-lg text-[#0f172a] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)' }}
              >
                {busy ? 'Posting…' : 'Post Comment'}
              </button>
            </div>
          </GlassCard>

          {/* Activity stream */}
          <GlassCard className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">
              Activity ({detail.comments.length})
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto mt-scroll pr-1">
              {detail.comments.length === 0 && (
                <div className="text-[11px] text-neutral-500 py-4 text-center">No comments yet</div>
              )}
              {[...detail.comments].reverse().map((c) => {
                const author = c.author?.displayName ?? c.author?.display_name ?? c.author?.name ?? 'Unknown';
                const bodyText = commentBodyToText(c.body);
                const isAdf = c.body && typeof c.body === 'object';
                return (
                  <div
                    key={c.id}
                    className="p-3 rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-semibold text-neutral-200">{author}</span>
                      <span className="text-[10px] text-neutral-500">{timeAgo(c.created)}</span>
                    </div>
                    {isAdf ? (
                      <AdfCommentBody body={c.body} className="text-[12px] text-neutral-300" issueKey={ticketKey} />
                    ) : (
                      <div className="text-[12px] text-neutral-300 whitespace-pre-wrap break-words leading-relaxed">
                        {bodyText || '(empty comment)'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Transition modal */}
      {transitionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTransitionModal(null)} />
          <div
            className="relative rounded-2xl p-6 w-full max-w-lg mx-4"
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 25px 80px rgba(0,0,0,0.6)',
            }}
          >
            <h3 className="text-lg font-bold text-neutral-100 mb-1">
              Transition to: {transitionModal.transition.to?.name ?? transitionModal.transition.name}
            </h3>
            <p className="text-[12px] text-neutral-400 mb-4">
              {ticketKey} — optional comment will be posted with the transition.
            </p>
            <textarea
              value={transitionModal.comment}
              onChange={(e) => setTransitionModal(m => m ? { ...m, comment: e.target.value } : null)}
              placeholder="Optional comment…"
              rows={4}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 mb-3"
              style={{ background: 'rgba(255,255,255,0.04)' }}
              autoFocus
            />
            <div className="flex items-center gap-2 mb-4">
              {(['internal', 'public'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTransitionModal(m => m ? { ...m, commentType: t } : null)}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all"
                  style={{
                    background: transitionModal.commentType === t
                      ? (t === 'public' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)')
                      : 'transparent',
                    color: transitionModal.commentType === t
                      ? (t === 'public' ? '#10b981' : '#f59e0b')
                      : '#64748b',
                    border: `1px solid ${transitionModal.commentType === t
                      ? (t === 'public' ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)')
                      : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  {t === 'internal' ? 'Internal' : 'Public'}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setTransitionModal(null)}
                className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={() => handleTransition(
                  transitionModal.transition,
                  transitionModal.comment,
                  transitionModal.commentType,
                )}
                disabled={busy}
                className="px-5 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}
              >
                {busy ? 'Transitioning…' : 'Confirm Transition'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 px-4 py-3 rounded-xl text-sm font-semibold z-50"
          style={{
            background: toast.kind === 'ok' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${toast.kind === 'ok' ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}`,
            color: toast.kind === 'ok' ? '#10b981' : '#ef4444',
            backdropFilter: 'blur(12px)',
            animation: 'mtFadeIn 0.3s ease',
          }}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}

// ── Header stats ──────────────────────────────────────────────────────────

function HeaderStat({ label, value, accent = '#94a3b8' }: { label: string; value: number; accent?: string }) {
  return (
    <div className="flex flex-col items-end">
      <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-semibold">{label}</div>
      <div className="text-xl font-black tracking-tight" style={{ color: accent, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
        {value}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function MyTicketsView({ tasks, loading, onUpdateTask, agentUsername, agentDisplayName, teamName }: Props) {
  const { queue, loading: queueLoading, refresh } = useMyTicketsQueue(agentUsername);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [deferTicketKey, setDeferTicketKey] = useState<string | null>(null);

  const bands = useMemo(() => {
    if (!queue) return { now: [] as RankedTicket[], next: [] as RankedTicket[], deferred: [] as RankedTicket[], hygiene: [] as RankedTicket[], waiting: [] as RankedTicket[] };
    return {
      now: queue.tickets.filter(t => t.band === 'NOW'),
      next: queue.tickets.filter(t => t.band === 'NEXT'),
      deferred: queue.tickets.filter(t => t.band === 'DEFERRED'),
      hygiene: queue.tickets.filter(t => t.band === 'HYGIENE'),
      waiting: queue.tickets.filter(t => t.band === 'WAITING'),
    };
  }, [queue]);

  const counts = useMemo(() => ({
    total: queue?.tickets.length ?? 0,
    now: bands.now.length,
    next: bands.next.length,
    deferred: bands.deferred.length,
    waiting: bands.waiting.length,
  }), [queue, bands]);

  const selectedTicket = useMemo(() => {
    if (!selectedKey || !queue) return null;
    return queue.tickets.find(t => t.ticketKey === selectedKey) ?? null;
  }, [selectedKey, queue]);

  // Auto-select NOW ticket on first load
  useEffect(() => {
    if (!selectedKey && bands.now.length > 0) {
      setSelectedKey(bands.now[0].ticketKey);
    }
  }, [bands.now, selectedKey]);

  const isLoading = loading || queueLoading;

  return (
    <div className="relative min-h-screen -mx-6 -my-4 px-8 py-6 overflow-hidden">
      <div
        className="fixed inset-0 pointer-events-none opacity-70"
        style={{
          background: `
            radial-gradient(ellipse at 12% 18%, rgba(16,185,129,0.13) 0%, transparent 50%),
            radial-gradient(ellipse at 88% 25%, rgba(94,193,202,0.10) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 95%, rgba(249,115,22,0.05) 0%, transparent 55%)
          `,
          animation: 'mtMesh 25s ease-in-out infinite alternate',
          zIndex: 0,
        }}
      />
      <style>{`
        @keyframes mtMesh {
          0% { transform: translate(0,0) scale(1); }
          50% { transform: translate(-1%,1%) scale(1.03); }
          100% { transform: translate(1%,-1%) scale(0.99); }
        }
        @keyframes mtShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes mtFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes mtSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .mt-fade { animation: mtFadeIn 0.45s cubic-bezier(0.16,1,0.3,1) both; }
        .mt-scroll::-webkit-scrollbar { width: 6px; }
        .mt-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 6px; }
        .mt-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>

      <div className="relative z-10 max-w-[1800px] mx-auto">
        {/* Header */}
        <div className="mt-fade flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black"
              style={{
                background: 'linear-gradient(135deg, #10b981, #5ec1ca)',
                boxShadow: '0 8px 32px rgba(16,185,129,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
                color: '#0f172a',
              }}
            >
              ◎
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-semibold">
                {teamName ?? 'My Tickets'}
              </div>
              <h1
                className="text-2xl font-black tracking-tight"
                style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {agentDisplayName}'s Queue
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <HeaderStat label="Total" value={counts.total} />
            <HeaderStat label="Now" value={counts.now} accent="#10b981" />
            <HeaderStat label="Next" value={counts.next} accent="#5ec1ca" />
            <HeaderStat label="Deferred" value={counts.deferred} accent="#9b6aed" />
            <HeaderStat label="Waiting" value={counts.waiting} accent="#64748b" />
            <button
              onClick={() => refresh()}
              disabled={isLoading}
              className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-200 border border-white/10 hover:bg-white/5 transition-all disabled:opacity-60 flex items-center gap-1.5"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              <span style={{ display: 'inline-block', animation: isLoading ? 'mtSpin 0.9s linear infinite' : undefined }}>↻</span>
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Master/detail grid */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '440px 1fr', minHeight: 'calc(100vh - 180px)' }}>
          {/* Left: Queue list */}
          <GlassCard accent className="p-4 flex flex-col">
            <div className="flex-1 overflow-y-auto mt-scroll space-y-1 pr-1" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              {isLoading && !queue && (
                <div className="text-xs text-neutral-500 p-4 text-center">Loading queue…</div>
              )}
              {!isLoading && counts.total === 0 && (
                <div className="text-xs text-neutral-500 p-8 text-center">
                  Queue is empty — all caught up
                </div>
              )}
              <BandSection band="NOW" tickets={bands.now} selectedKey={selectedKey} onSelect={setSelectedKey} />
              <BandSection band="NEXT" tickets={bands.next} selectedKey={selectedKey} onSelect={setSelectedKey} />
              <BandSection band="DEFERRED" tickets={bands.deferred} selectedKey={selectedKey} onSelect={setSelectedKey} />
              <BandSection band="HYGIENE" tickets={bands.hygiene} selectedKey={selectedKey} onSelect={setSelectedKey} />
              <BandSection band="WAITING" tickets={bands.waiting} selectedKey={selectedKey} onSelect={setSelectedKey} />
            </div>
          </GlassCard>

          {/* Right: Detail pane */}
          <div className="flex flex-col gap-4 min-w-0">
            {!selectedKey || !selectedTicket ? (
              <GlassCard accent className="flex-1 flex items-center justify-center">
                <div className="text-center py-16">
                  <div className="text-5xl mb-3 opacity-40">◎</div>
                  <div className="text-sm text-neutral-500">Select a ticket from your queue</div>
                </div>
              </GlassCard>
            ) : (
              <TicketDetailPanel
                key={selectedKey}
                ticketKey={selectedKey}
                ticket={selectedTicket}
                onDefer={() => setDeferTicketKey(selectedKey)}
                onRefreshQueue={refresh}
              />
            )}
          </div>
        </div>
      </div>

      {/* Defer modal */}
      {deferTicketKey && (
        <DeferReasonModal
          ticketKey={deferTicketKey}
          onClose={() => setDeferTicketKey(null)}
          onDeferred={() => {
            setDeferTicketKey(null);
            setSelectedKey(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
