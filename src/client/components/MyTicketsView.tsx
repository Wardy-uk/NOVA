import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Task } from '../../shared/types.js';
import { useMyTicketsQueue, type RankedTicket, type TicketBand } from '../hooks/useMyTicketsQueue.js';
import { type BriefFields } from './TicketBriefCard.js';
import { DeferReasonModal } from './DeferReasonModal.js';
import { UnifiedTicketDetail } from './ticket-detail/index.js';

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
          {ticket.pendingDecision && !ticket.pendingDecision.shadowMode && (
            <span
              className="px-1.5 py-0.5 rounded font-bold text-[10px]"
              style={{
                background: 'rgba(245,158,11,0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.3)',
              }}
            >
              AI Approval
            </span>
          )}
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

  const briefFields = useMemo((): BriefFields => {
    if (detail.issue) return detail.issue as BriefFields;
    const fields: BriefFields = {};
    fields.summary = ticket.fields.summary ?? undefined;
    fields.status = ticket.fields.status ? { name: ticket.fields.status } : undefined;
    if (ticket.fields.tldr) fields.customfield_13184 = ticket.fields.tldr;
    if (ticket.fields.agentSummary) fields.customfield_13185 = ticket.fields.agentSummary;
    if (ticket.fields.escalationReason) fields.customfield_13186 = { value: ticket.fields.escalationReason };
    if (ticket.fields.tier) fields.customfield_12981 = { value: ticket.fields.tier };
    return fields;
  }, [detail.issue, ticket.fields]);

  const briefTier = ticket.fields.tier
    || (typeof detail.issue?.customfield_12981 === 'string' ? detail.issue.customfield_12981 : (detail.issue?.customfield_12981 as any)?.value ?? null);

  if (detail.loading && !detail.issue) {
    return (
      <GlassCard accent className="flex-1 flex items-center justify-center">
        <div className="text-sm text-neutral-500">Loading ticket...</div>
      </GlassCard>
    );
  }

  return (
    <UnifiedTicketDetail
      ticketKey={ticketKey}
      issue={detail.issue}
      queueFields={{
        assignee: ticket.fields.assignee,
        reporter: ticket.fields.reporter,
        status: ticket.fields.status,
        priority: ticket.fields.priority,
        tier: ticket.fields.tier,
        product: ticket.fields.product,
        created: ticket.fields.created,
        updated: ticket.fields.updated,
        score: ticket.score,
        slaBreachTime: ticket.fields.slaBreachTime,
        slaBreached: ticket.fields.slaBreached,
        bcAccountNumber: ticket.fields.bcAccountNumber,
        summary: ticket.fields.summary,
      }}
      briefFields={briefFields}
      briefTier={briefTier}
      badges={<>
        <BandChip band={ticket.band} />
        {ticket.fields.tier && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgba(155,106,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(155,106,237,0.3)' }}>
            {ticket.fields.tier}
          </span>
        )}
      </>}
      headerActions={<>
        {ticket.band === 'NOW' && (
          <button onClick={onDefer} className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-white/10 text-neutral-300 hover:bg-white/5 transition-colors">Defer</button>
        )}
        <a href={`https://nurturtech.atlassian.net/browse/${ticketKey}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-white/10 text-neutral-300 hover:bg-white/5">Open in Jira ↗</a>
      </>}
      aiNextAction={{
        pendingDecision: ticket.pendingDecision,
        onDecisionActioned: onRefreshQueue,
      }}
      aiAnalysis={{
        pendingApproval: ticket.pendingDecision ? { id: ticket.pendingDecision.id, status: 'pending' } : null,
        onApprovalActioned: onRefreshQueue,
      }}
      comments={detail.comments}
      transitions={detail.transitions}
      commentConfig={{ aiDraftSupport: true }}
      onRefresh={() => { loadDetail(); onRefreshQueue(); }}
    />
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
    approvals: queue?.tickets.filter(t => t.pendingDecision && !t.pendingDecision.shadowMode).length ?? 0,
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
            {counts.approvals > 0 && (
              <HeaderStat label="AI Approvals" value={counts.approvals} accent="#f59e0b" />
            )}
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
