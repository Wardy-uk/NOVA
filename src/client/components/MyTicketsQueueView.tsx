import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Task } from '../../shared/types.js';
import { useMyTicketsQueue, type RankedTicket, type TicketBand } from '../hooks/useMyTicketsQueue.js';
import { TicketBriefCard, type BriefFields } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { AdfCommentBody } from './AdfCommentBody.js';
import { AIAnalysisPanel } from './AIAnalysisPanel.js';
import { DeferReasonModal } from './DeferReasonModal.js';
import {
  UnifiedQueue,
  type UnifiedQueueConfig,
  type QueueActions,
  StatusPill,
  GlassCard,
  BandChip,
  timeAgo,
  isObj,
  commentBodyToText,
  getDefaultCommentType,
} from './queue/index.js';

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

// ── Row component ──────────────────────────────────────────────────────────

function MyTicketRow({ ticket, selected, focused }: { ticket: RankedTicket; selected: boolean; focused: boolean }) {
  const { fields } = ticket;
  const summary = fields.summary || '(no summary)';

  return (
    <div
      className={`p-3 transition-all duration-150 border-b border-[#2f353d]/50 ${
        selected ? 'bg-[#10b981]/10' : focused ? 'bg-[#363d47]' : 'hover:bg-[#272c33]'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-mono font-bold text-[#5ec1ca]">{ticket.ticketKey}</span>
        <BandChip band={ticket.band} />
        <StatusPill status={fields.status} />
      </div>
      <div className="text-[12px] text-neutral-50 font-semibold truncate mb-1 pl-0">{summary}</div>
      {fields.tldr && (
        <div className="text-[11px] text-neutral-300 line-clamp-2 mb-1 leading-snug">{fields.tldr}</div>
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

// ── Detail panel ───────────────────────────────────────────────────────────

function MyTicketDetail({ ticket, actions, onDefer }: {
  ticket: RankedTicket;
  actions: QueueActions;
  onDefer: () => void;
}) {
  const ticketKey = ticket.ticketKey;
  const [detail, setDetail] = useState<TicketDetail>({ issue: null, comments: [], transitions: [], loading: true });
  const [commentDraft, setCommentDraft] = useState('');
  const [commentType, setCommentType] = useState<'internal' | 'public'>('internal');
  const [transitionModal, setTransitionModal] = useState<{ transition: JiraTransition; comment: string; commentType: 'internal' | 'public' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiDraftUsed, setAiDraftUsed] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

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

  // Auto-refresh detail every 60s
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
      actions.toast(`${commentType === 'public' ? 'Public' : 'Internal'} comment posted`, 'ok');
      setCommentDraft('');
      await loadDetail();
    } catch (err) {
      actions.toast(err instanceof Error ? err.message : 'Comment failed', 'err');
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
      actions.toast(`Transitioned to ${t.to?.name ?? t.name ?? 'new status'}`, 'ok');
      await loadDetail();
      actions.refresh();
    } catch (err) {
      actions.toast(err instanceof Error ? err.message : 'Transition failed', 'err');
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

  if (detail.loading && !detail.issue) {
    return (
      <div className="p-5 flex items-center justify-center h-full">
        <div className="text-sm text-neutral-500">Loading ticket...</div>
      </div>
    );
  }

  const statusName = detail.issue?.status
    ? (isObj(detail.issue.status) ? (detail.issue.status as any).name : String(detail.issue.status))
    : ticket.fields.status;

  return (
    <div className="p-5 space-y-4">
      {/* Action bar header */}
      <GlassCard className="p-4" accentGradient="#10b981 30%, #5ec1ca 70%">
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
              Open in Jira
            </a>
          </div>
        </div>
      </GlassCard>

      {/* Body: brief + activity */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Left: Brief + AI */}
        <div className="space-y-4">
          <TicketBriefCard {...briefProps} />
          <AINextActionCard ticketKey={ticketKey} pendingDecision={ticket.pendingDecision} onDecisionActioned={() => actions.refresh()} />
          <AIAnalysisPanel
            ticketKey={ticketKey}
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
              placeholder="Write a comment..."
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
                {busy ? 'Posting...' : 'Post Comment'}
              </button>
            </div>
          </GlassCard>

          {/* Activity stream */}
          <GlassCard className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">
              Activity ({detail.comments.length})
            </div>
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3a424d transparent' }}>
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
              placeholder="Optional comment..."
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
                {busy ? 'Transitioning...' : 'Confirm Transition'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

const BAND_ORDER: TicketBand[] = ['NOW', 'NEXT', 'DEFERRED', 'HYGIENE', 'WAITING'];
const BAND_COLLAPSED: TicketBand[] = ['DEFERRED', 'HYGIENE', 'WAITING'];

export function MyTicketsQueueView({ tasks, loading, onUpdateTask, agentUsername, agentDisplayName, teamName }: Props) {
  const { queue, loading: queueLoading, refresh } = useMyTicketsQueue(agentUsername);
  const [deferTicketKey, setDeferTicketKey] = useState<string | null>(null);

  const tickets = queue?.tickets ?? [];
  const isLoading = loading || queueLoading;

  const counts = useMemo(() => ({
    total: tickets.length,
    now: tickets.filter(t => t.band === 'NOW').length,
    next: tickets.filter(t => t.band === 'NEXT').length,
    deferred: tickets.filter(t => t.band === 'DEFERRED').length,
    waiting: tickets.filter(t => t.band === 'WAITING').length,
  }), [tickets]);

  const config: UnifiedQueueConfig<RankedTicket> = useMemo(() => ({
    title: `${agentDisplayName}'s Queue`,
    icon: <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: 8, fontWeight: 900, fontSize: 12,
      background: 'linear-gradient(135deg, #10b981, #5ec1ca)',
      color: '#0f172a',
    }}>◎</span>,
    accentGradient: '#10b981 30%, #5ec1ca 70%',

    fetchItems: async () => {
      // Data comes from useMyTicketsQueue hook, not fetchItems
      return [];
    },
    pollIntervalMs: 60000,

    getKey: t => t.ticketKey,
    renderRow: (t, { selected, focused }) => (
      <MyTicketRow ticket={t} selected={selected} focused={focused} />
    ),

    groupBy: t => t.band,
    groupOrder: BAND_ORDER as string[],
    groupCollapsed: BAND_COLLAPSED as string[],

    searchPlaceholder: 'Search tickets...',
    searchFn: (t, q) =>
      t.ticketKey.toLowerCase().includes(q) ||
      (t.fields.summary?.toLowerCase().includes(q) ?? false) ||
      (t.fields.tldr?.toLowerCase().includes(q) ?? false) ||
      (t.fields.tier?.toLowerCase().includes(q) ?? false),

    stats: [
      { label: 'Total', value: counts.total, color: '#e2e8f0' },
      { label: 'Now', value: counts.now, color: '#10b981' },
      { label: 'Next', value: counts.next, color: '#5ec1ca' },
      { label: 'Deferred', value: counts.deferred, color: '#9b6aed' },
      { label: 'Waiting', value: counts.waiting, color: '#64748b' },
    ],

    renderDetail: (t, actions) => (
      <MyTicketDetail
        ticket={t}
        actions={actions}
        onDefer={() => setDeferTicketKey(t.ticketKey)}
      />
    ),
    renderEmpty: () => (
      <div className="flex items-center justify-center h-full text-neutral-600 text-[11px]">
        Queue is empty — all caught up
      </div>
    ),

    keyboardShortcuts: [
      { key: 'd', label: 'defer' },
    ],
    onKeyAction: (key, item) => {
      if (!item) return false;
      if (key === 'd' && item.band === 'NOW') {
        setDeferTicketKey(item.ticketKey);
        return true;
      }
      return false;
    },
  }), [agentDisplayName, counts, setDeferTicketKey]);

  return (
    <>
      <UnifiedQueue config={config} items={tickets} loading={isLoading} />
      {deferTicketKey && (
        <DeferReasonModal
          ticketKey={deferTicketKey}
          onClose={() => setDeferTicketKey(null)}
          onDeferred={() => {
            setDeferTicketKey(null);
            refresh();
          }}
        />
      )}
    </>
  );
}
