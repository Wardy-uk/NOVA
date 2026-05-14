import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { TicketBriefCard } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import { AdfCommentBody } from './AdfCommentBody.js';
import { useAuth } from '../hooks/useAuth.js';
import { BcAccountBadge } from './BcAccountBadge.js';
import { useDevReviewTheme } from '../utils/devReviewTheme.js';
import {
  UnifiedQueue,
  type UnifiedQueueConfig,
  type QueueActions,
  type FilterPill,
  type StatCard,
  StatusPill,
  GlassCard,
  timeAgo,
} from './queue/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface JiraUser { displayName: string; emailAddress?: string; accountId?: string }
interface JiraStatus { name: string; statusCategory?: { key: string; colorName?: string } }

interface JiraFields {
  summary?: string;
  description?: unknown;
  status?: JiraStatus;
  assignee?: JiraUser | null;
  reporter?: JiraUser | null;
  priority?: { name?: string; iconUrl?: string };
  created?: string;
  updated?: string;
  duedate?: string | null;
  issuetype?: { name?: string; iconUrl?: string };
  customfield_12981?: { value?: string; id?: string };
  customfield_13184?: string;
  customfield_13185?: string;
  customfield_13212?: string;
  customfield_13186?: { value?: string };
  customfield_13214?: string;
  customfield_13213?: string;
  customfield_13183?: { value?: string };
  customfield_13215?: unknown;
  [k: string]: unknown;
}

interface DevReviewState {
  jira_key: string;
  status: 'pending' | 'in_review' | 'waiting_on_assignee' | 'accepted' | 'returned' | 'archived';
  fast_track: number;
  nova_priority: 'low' | 'normal' | 'high';
  claimed_by_user_id: number | null;
  claimed_at: string | null;
  submitted_by_username: string | null;
  first_seen_at: string;
  last_action_at: string;
  accepted_at: string | null;
  returned_at: string | null;
  work_item_key: string | null;
}

interface QueueItem {
  key: string;
  fields: JiraFields;
  state: DevReviewState | null;
  team: string;
  claimed_by_display: string | null;
}

interface ThreadEntry {
  id: number;
  jira_key: string;
  user_id: number;
  user_display: string;
  kind: 'comment' | 'state_change' | 'accept' | 'return' | 'claim' | 'fasttrack';
  body: string | null;
  body_adf?: string | null;
  meta_json?: string | null;
  jira_sync_state: 'pending' | 'synced' | 'failed' | 'skip';
  jira_sync_error: string | null;
  created_at: string;
}

interface TicketDetail {
  key: string;
  fields: JiraFields;
  state: DevReviewState | null;
  thread: ThreadEntry[];
  jiraComments: Array<{ id: string; author?: { displayName?: string }; body?: unknown; created?: string }>;
  claimed_by_display: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/dev-review${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.data as T;
}

async function apiFull(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`/api/dev-review${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  return res.json();
}

function adfToText(adf: unknown): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  try {
    const walk = (node: any): string => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(walk).join('');
      return '';
    };
    return walk(adf);
  } catch { return ''; }
}

function productToTeamClient(product: string | null | undefined): string {
  if (!product) return 'Unassigned';
  if (product.startsWith('The Property Jungle')) return 'TPJ';
  return product;
}

// ── Visual Primitives ──────────────────────────────────────────────────────

function FastTrackFlame() {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1"
      style={{
        background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(245,158,11,0.2))',
        color: '#f97316',
        border: '1px solid rgba(249,115,22,0.4)',
        animation: 'qPulse 2s ease-in-out infinite',
      }}
    >
      🔥 FAST-TRACK
    </span>
  );
}

function Modal({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  const t = useDevReviewTheme();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={t.modal.backdrop}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl p-6 max-h-[90vh] overflow-y-auto`}
        style={t.modal.content}
      >
        {children}
      </div>
    </div>
  );
}

// ── Thread rendering ───────────────────────────────────────────────────────

function ThreadBody({ body, bodyAdf, issueKey }: { body: string | null; bodyAdf?: string | null; issueKey?: string }) {
  if (bodyAdf) {
    try {
      return <AdfCommentBody body={JSON.parse(bodyAdf)} className="text-[12px] text-neutral-100 leading-relaxed" issueKey={issueKey} />;
    } catch { /* fall through */ }
  }
  if (body) return <div className="text-[12px] text-neutral-100 whitespace-pre-wrap leading-relaxed">{body}</div>;
  return null;
}

function ThreadEntryRow({ entry }: { entry: ThreadEntry }) {
  let isJiraOrigin = false;
  try {
    if (entry.meta_json) isJiraOrigin = (JSON.parse(entry.meta_json) as { source?: string }).source === 'jira';
  } catch { /* ignore */ }

  const kindColour = isJiraOrigin ? '#f59e0b' : ({
    comment: '#5ec1ca', accept: '#10b981', return: '#9b6aed',
    claim: '#64748b', fasttrack: '#f97316', state_change: '#64748b',
  } as Record<string, string>)[entry.kind];
  const icon = isJiraOrigin ? '📥' : ({
    comment: '💬', accept: '✓', return: '↩', claim: '◉', fasttrack: '🔥', state_change: '◈',
  } as Record<string, string>)[entry.kind];

  return (
    <div
      className="p-3 rounded-lg"
      style={{
        background: isJiraOrigin ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${isJiraOrigin ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.1)'}`,
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-[10px] font-bold" style={{ color: kindColour }}>
          <span>{icon}</span>
          <span className="uppercase tracking-wider">{isJiraOrigin ? 'AGENT REPLY' : entry.kind}</span>
          <span className="text-neutral-300 font-normal">· {entry.user_display}</span>
          {isJiraOrigin && <span className="text-[9px] text-neutral-500 font-normal">· from Jira</span>}
        </div>
        <div className="flex items-center gap-2">
          {!isJiraOrigin && entry.jira_sync_state === 'pending' && <span className="text-[9px] text-amber-400">syncing…</span>}
          {!isJiraOrigin && entry.jira_sync_state === 'failed' && <span className="text-[9px] text-red-400" title={entry.jira_sync_error || ''}>sync failed</span>}
          {!isJiraOrigin && entry.jira_sync_state === 'synced' && <span className="text-[9px] text-emerald-400">✓ jira</span>}
          <span className="text-[10px] text-neutral-400">{timeAgo(entry.created_at)}</span>
        </div>
      </div>
      <ThreadBody body={entry.body} bodyAdf={entry.body_adf} issueKey={entry.jira_key} />
    </div>
  );
}

function BackfillAdfButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState('');
  const run = async () => {
    setState('running');
    try {
      const r = await fetch('/api/dev-review/backfill-adf', { method: 'POST' });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error);
      setResult(`${data.data.entries_updated} comments updated across ${data.data.tickets_scanned} tickets`);
      setState('done');
    } catch (err: any) { setResult(err.message); setState('error'); }
  };
  if (state === 'done' || state === 'error') return <span className={`text-[10px] ${state === 'done' ? 'text-emerald-400' : 'text-red-400'}`}>{result}</span>;
  return (
    <button onClick={run} disabled={state === 'running'} className="px-2 py-1 text-[10px] rounded text-neutral-400 border border-white/10 hover:bg-white/5 transition-all disabled:opacity-60" title="Re-fetch ADF bodies for existing comments so images render">
      {state === 'running' ? 'Backfilling…' : 'Backfill Images'}
    </button>
  );
}

// ── Queue row ──────────────────────────────────────────────────────────────

function DevReviewRow({ item, selected, focused, isMine }: { item: QueueItem; selected: boolean; focused: boolean; isMine: boolean }) {
  const tldr = adfToText(item.fields.customfield_13184);
  const summary = item.fields.summary || '(no summary)';

  return (
    <div
      className={`p-3 transition-all duration-150 border-b border-[#2f353d]/50 ${
        selected ? 'bg-[#9b6aed]/10' : focused ? 'bg-[#363d47]' : 'hover:bg-[#272c33]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono font-bold text-[#5ec1ca]">{item.key}</span>
          {isMine && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(155,106,237,0.2)', color: '#c4b5fd' }}>MINE</span>
          )}
          {item.state?.fast_track ? <FastTrackFlame /> : null}
        </div>
        <StatusPill status={item.state?.status} />
      </div>
      <div className="text-[12px] text-neutral-50 font-semibold truncate mb-1">{summary}</div>
      {tldr && <div className="text-[11px] text-neutral-300 line-clamp-2 mb-1.5 leading-snug">{tldr}</div>}
      <div className="flex items-center justify-between text-[10px] text-neutral-400">
        <div className="flex items-center gap-2">
          {item.team && item.team !== 'Unassigned' && (
            <span className="px-1.5 py-0.5 rounded font-semibold" style={{
              background: 'linear-gradient(135deg, rgba(94,193,202,0.15), rgba(155,106,237,0.15))',
              color: '#c4b5fd', border: '1px solid rgba(155,106,237,0.25)',
            }}>{item.team}</span>
          )}
          {item.state?.claimed_by_user_id ? (
            <span className="text-[#c4b5fd]">◉ {isMine ? 'mine' : item.claimed_by_display || 'claimed'}</span>
          ) : (
            <span className="text-amber-400">○ unclaimed</span>
          )}
        </div>
        <span>{timeAgo(item.fields.updated)}</span>
      </div>
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────

function DevReviewDetail({
  detail, item, busy, currentUserId, isAdmin, queueActions,
  onClaim, onUnclaim, onFastTrack, onComment, onAcceptClick, onReturnClick, onLinkExistingClick,
}: {
  detail: TicketDetail;
  item: QueueItem | undefined;
  busy: boolean;
  currentUserId: number;
  isAdmin: boolean;
  queueActions: QueueActions;
  onClaim: () => void;
  onUnclaim: () => void;
  onFastTrack: (on: boolean) => void;
  onComment: (text: string) => void;
  onAcceptClick: () => void;
  onReturnClick: () => void;
  onLinkExistingClick: () => void;
}) {
  const drTheme = useDevReviewTheme();
  const { fields, state, thread } = detail;
  const product = fields.customfield_13183?.value;
  const isMine = state?.claimed_by_user_id === currentUserId;
  const terminal = state?.status === 'accepted' || state?.status === 'returned';
  const claimedByDisplay = detail.claimed_by_display || item?.claimed_by_display || null;
  const [commentDraft, setCommentDraft] = useState('');

  return (
    <div className="p-5 space-y-4">
      {/* Action bar */}
      <GlassCard accent accentGradient="#9b6aed 30%, #5ec1ca 70%" className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <a href={`https://nurturtech.atlassian.net/browse/${detail.key}`} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono font-bold text-[#5ec1ca] hover:underline">{detail.key}</a>
              <StatusPill status={state?.status} />
              {state?.fast_track ? <FastTrackFlame /> : null}
              {product && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgba(94,193,202,0.15)', color: '#5ec1ca', border: '1px solid rgba(94,193,202,0.3)' }}>{product}</span>
              )}
              {fields.status?.name && <span className="text-[10px] text-neutral-500">· Jira: {fields.status.name}</span>}
            </div>
            <h2 className="text-lg font-bold text-neutral-100 leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>{fields.summary}</h2>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-300 flex-wrap">
              <span>Reporter: <span className="text-neutral-100 font-semibold">{fields.reporter?.displayName || '—'}</span></span>
              <span className="text-neutral-600">·</span>
              <span>Assignee: <span className="text-neutral-100 font-semibold">{fields.assignee?.displayName || 'Unassigned'}</span></span>
              <span className="text-neutral-600">·</span>
              <span>BC Account: <BcAccountBadge ticketKey={detail.key} accountNumber={(fields as any).customfield_14626 ?? (fields as any).bc_account_number ?? null} compact /></span>
              <span className="text-neutral-600">·</span>
              <span>Updated <span className="text-neutral-100">{timeAgo(fields.updated)}</span></span>
              {state?.claimed_by_user_id && (
                <>
                  <span className="text-neutral-600">·</span>
                  <span className="text-[#c4b5fd] font-semibold">
                    {isMine ? 'Claimed by you' : `Claimed by ${claimedByDisplay || 'reviewer'}`} {timeAgo(state.claimed_at)}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {terminal ? (
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-[11px] text-neutral-500 italic">
                  {state?.status === 'accepted' ? 'Accepted to development' : 'Returned to CC — no further action'}
                </span>
                {state?.status === 'returned' && state.claimed_by_user_id && (
                  <button onClick={onUnclaim} disabled={busy} className="px-3 py-1.5 text-[10px] rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5 disabled:opacity-40">Release</button>
                )}
                {state?.status === 'accepted' && state.work_item_key && (
                  <>
                    <span className="text-[11px] text-neutral-600">·</span>
                    <a href={`https://nurturtech.atlassian.net/browse/${state.work_item_key}`} target="_blank" rel="noreferrer" className="text-[11px] font-mono font-semibold hover:underline" style={{ color: '#5ec1ca' }}>{state.work_item_key} ↗</a>
                  </>
                )}
              </div>
            ) : !state?.claimed_by_user_id ? (
              <button onClick={onClaim} disabled={busy} className="px-5 py-2.5 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)', boxShadow: '0 4px 16px rgba(245,158,11,0.4)' }}>◉ Claim to review</button>
            ) : !isMine ? (
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-semibold px-3 py-2 rounded-lg" style={{ background: 'rgba(155,106,237,0.1)', border: '1px solid rgba(155,106,237,0.3)', color: '#c4b5fd' }}>Claimed by {claimedByDisplay || 'another reviewer'}</div>
                {isAdmin && <button onClick={onUnclaim} disabled={busy} className="px-3 py-1.5 text-[10px] rounded-lg font-semibold text-red-400 border border-red-500/30 hover:bg-red-500/10 disabled:opacity-40">Admin Release</button>}
              </div>
            ) : (
              <>
                <button onClick={onUnclaim} disabled={busy} className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5 disabled:opacity-40">Release</button>
                <button onClick={() => onFastTrack(!state?.fast_track)} disabled={busy} className="px-3 py-2 text-xs rounded-lg font-semibold disabled:opacity-40" style={{ background: state?.fast_track ? 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(239,68,68,0.2))' : 'rgba(255,255,255,0.03)', border: state?.fast_track ? '1px solid rgba(249,115,22,0.4)' : '1px solid rgba(255,255,255,0.1)', color: state?.fast_track ? '#f97316' : '#d4d4d8' }}>🔥 Fast-track</button>
                <button onClick={onReturnClick} disabled={busy} className="px-3 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #9b6aed, #c4b5fd)', boxShadow: '0 4px 16px rgba(155,106,237,0.35)' }}>↩ Return</button>
                <button onClick={onLinkExistingClick} disabled={busy} className="px-3 py-2 text-xs rounded-lg font-semibold text-blue-400 border border-blue-500/30 hover:bg-blue-500/10 disabled:opacity-40">🔗 Link Existing</button>
                <button onClick={onAcceptClick} disabled={busy} className="px-3 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}>✓ Accept</button>
              </>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Body grid: brief | thread */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div className="overflow-y-auto space-y-4" style={{ maxHeight: 'calc(100vh - 320px)', scrollbarWidth: 'thin', scrollbarColor: '#3a424d transparent' }}>
          <TicketBriefCard ticketKey={detail.key} fields={fields} tier={fields.customfield_12981?.value} />
          <AINextActionCard ticketKey={detail.key} />
        </div>

        <GlassCard className="p-5 flex flex-col">
          <div className="text-[11px] uppercase tracking-wider text-[#5ec1ca] font-bold mb-3">◈ Activity</div>
          <div className="flex-1 overflow-y-auto space-y-2 mb-3 pr-1" style={{ maxHeight: '360px', scrollbarWidth: 'thin', scrollbarColor: '#3a424d transparent' }}>
            {thread.length === 0 && <div className="text-[11px] text-neutral-600 italic p-4 text-center">No activity yet</div>}
            {thread.map(t => <ThreadEntryRow key={t.id} entry={t} />)}
          </div>
          {!terminal && isMine && (
            <div className="pt-3 border-t border-white/5">
              <textarea
                value={commentDraft}
                onChange={e => setCommentDraft(e.target.value)}
                placeholder="Add a comment (will post to Jira as internal, tagged with your name)"
                rows={3}
                className="w-full px-3 py-2 text-xs rounded-lg border border-white/10 text-neutral-200 placeholder-neutral-600 mb-2"
                style={drTheme.input}
              />
              <div className="flex justify-end">
                <button
                  onClick={() => { onComment(commentDraft); setCommentDraft(''); }}
                  disabled={busy || !commentDraft.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)', boxShadow: '0 4px 12px rgba(94,193,202,0.3)' }}
                >Post Comment</button>
              </div>
            </div>
          )}
          {!terminal && !isMine && (
            <div className="pt-3 border-t border-white/5 text-center">
              <div className="text-[11px] text-neutral-500 py-2">
                {state?.claimed_by_user_id ? 'Claimed by another reviewer' : 'Claim this ticket to comment'}
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function DevReviewQueueView() {
  const { user } = useAuth();
  const drTheme = useDevReviewTheme();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [showAll, setShowAll] = useState<boolean>(() => {
    try { return localStorage.getItem('dev_review_show_all') === '1'; } catch { return false; }
  });
  const [queueMeta, setQueueMeta] = useState<{ userTeamFilterActive: boolean; userTeamName: string | null; showingAll: boolean } | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnDraft, setReturnDraft] = useState('');
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [showLinkExistingModal, setShowLinkExistingModal] = useState(false);
  const [linkExistingKey, setLinkExistingKey] = useState('');
  const [acceptNote, setAcceptNote] = useState('');
  const [acceptTldr, setAcceptTldr] = useState('');
  const [acceptDevDetails, setAcceptDevDetails] = useState('');
  const [acceptWorkItemComment, setAcceptWorkItemComment] = useState('');
  const [acceptedWorkItem, setAcceptedWorkItem] = useState<{ key: string; sourceKey: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [jumpKey, setJumpKey] = useState('');

  const currentUserId = user?.id ?? 0;
  const isAdminUser = !!user?.role?.includes('admin');

  // ── Data fetching ──────────────────────────────────────────────────────
  const loadQueue = useCallback(async () => {
    try {
      const qs = showAll ? '?showAll=1' : '';
      const res = await fetch(`/api/dev-review/queue${qs}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to load queue');
      setItems(json.data as QueueItem[]);
      setQueueMeta(json.meta || null);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [showAll]);

  const loadDetail = useCallback(async (key: string) => {
    setDetailLoading(true);
    try {
      setDetail(await api<TicketDetail>(`/ticket/${key}`));
    } catch { /* silent */ } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    const i = setInterval(loadQueue, 60_000);
    return () => clearInterval(i);
  }, [loadQueue]);

  useEffect(() => {
    if (selectedKey) loadDetail(selectedKey);
    else setDetail(null);
  }, [selectedKey, loadDetail]);

  useEffect(() => {
    if (!selectedKey) return;
    const i = setInterval(() => loadDetail(selectedKey), 15_000);
    return () => clearInterval(i);
  }, [selectedKey, loadDetail]);

  const toggleShowAll = () => {
    setShowAll(prev => {
      const next = !prev;
      try { localStorage.setItem('dev_review_show_all', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  // ── Filtering ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return items.filter(i => {
      if (filter === 'mine' && i.state?.claimed_by_user_id !== currentUserId) return false;
      if (filter === 'unclaimed' && i.state?.claimed_by_user_id != null) return false;
      if (filter === 'fasttrack' && !i.state?.fast_track) return false;
      if (teamFilter !== 'all' && i.team !== teamFilter) return false;
      return true;
    });
  }, [items, filter, teamFilter, currentUserId]);

  const teamOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.team, (counts.get(i.team) || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([team, count]) => ({ team, count }));
  }, [items]);

  const counts = useMemo(() => ({
    total: items.length,
    pending: items.filter(i => i.state?.status === 'pending').length,
    inReview: items.filter(i => i.state?.status === 'in_review').length,
    fastTrack: items.filter(i => i.state?.fast_track).length,
    mine: items.filter(i => i.state?.claimed_by_user_id === currentUserId).length,
  }), [items, currentUserId]);

  // ── Actions ────────────────────────────────────────────────────────────
  const doAction = async (path: string, init?: RequestInit) => {
    if (!selectedKey) return;
    setBusy(true);
    try {
      await api(path, init);
      await Promise.all([loadQueue(), loadDetail(selectedKey)]);
    } catch { /* toast handled in detail */ } finally {
      setBusy(false);
    }
  };

  const onClaim = () => doAction(`/ticket/${selectedKey}/claim`, { method: 'POST' });
  const onUnclaim = () => doAction(`/ticket/${selectedKey}/unclaim`, { method: 'POST' });
  const onFastTrack = (on: boolean) => doAction(`/ticket/${selectedKey}/fast-track`, { method: 'POST', body: JSON.stringify({ on }) });

  const onComment = async (text: string) => {
    if (!text.trim() || !selectedKey) return;
    setBusy(true);
    try {
      await fetch(`/api/dev-review/ticket/${selectedKey}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      await Promise.all([loadQueue(), loadDetail(selectedKey)]);
    } catch { /* silent */ } finally {
      setBusy(false);
    }
  };

  const openAcceptModal = () => {
    if (!detail) return;
    setAcceptTldr(adfToText(detail.fields.customfield_13184));
    setAcceptDevDetails(adfToText(detail.fields.customfield_13215));
    setAcceptNote('');
    setAcceptWorkItemComment('');
    setShowAcceptModal(true);
  };

  const onAccept = async () => {
    if (!acceptTldr.trim() || !selectedKey) return;
    setBusy(true);
    try {
      const json = await apiFull(`/ticket/${selectedKey}/accept`, {
        method: 'POST',
        body: JSON.stringify({ note: acceptNote, tldr: acceptTldr, developmentDetails: acceptDevDetails, workItemComment: acceptWorkItemComment }),
      });
      if (json.ok) {
        setItems(prev => prev.map(i => i.key === selectedKey
          ? { ...i, state: { ...i.state!, status: 'accepted' as const, accepted_at: new Date().toISOString(), work_item_key: json.workItemKey ?? null } }
          : i));
        setShowAcceptModal(false);
        if (json.workItemKey) setAcceptedWorkItem({ key: json.workItemKey, sourceKey: selectedKey });
      }
    } catch { /* silent */ } finally {
      setBusy(false);
      setAcceptNote(''); setAcceptTldr(''); setAcceptDevDetails(''); setAcceptWorkItemComment('');
    }
  };

  const openLinkExistingModal = () => {
    if (!detail) return;
    setAcceptTldr(adfToText(detail.fields.customfield_13184));
    setAcceptDevDetails(adfToText(detail.fields.customfield_13215));
    setAcceptNote('');
    setLinkExistingKey('');
    setShowLinkExistingModal(true);
  };

  const onLinkExisting = async () => {
    if (!linkExistingKey.trim() || !/^[A-Z]+-\d+$/.test(linkExistingKey.trim())) return;
    if (!acceptTldr.trim() || !selectedKey) return;
    setBusy(true);
    try {
      const json = await apiFull(`/ticket/${selectedKey}/link-existing`, {
        method: 'POST',
        body: JSON.stringify({ workItemKey: linkExistingKey.trim(), note: acceptNote, tldr: acceptTldr, developmentDetails: acceptDevDetails }),
      });
      if (json.ok) {
        setItems(prev => prev.map(i => i.key === selectedKey
          ? { ...i, state: { ...i.state!, status: 'accepted' as const, accepted_at: new Date().toISOString(), work_item_key: json.workItemKey ?? null } }
          : i));
        setShowLinkExistingModal(false);
        if (json.workItemKey) setAcceptedWorkItem({ key: json.workItemKey, sourceKey: selectedKey });
      }
    } catch { /* silent */ } finally {
      setBusy(false);
      setAcceptNote(''); setAcceptTldr(''); setAcceptDevDetails(''); setLinkExistingKey('');
    }
  };

  const onReturn = async () => {
    if (returnDraft.trim().length < 10 || !selectedKey) return;
    setBusy(true);
    try {
      await api(`/ticket/${selectedKey}/return`, { method: 'POST', body: JSON.stringify({ nextSteps: returnDraft }) });
      setItems(prev => prev.filter(i => i.key !== selectedKey));
      setSelectedKey(null);
      setDetail(null);
    } catch { /* silent */ } finally {
      setBusy(false);
      setReturnDraft('');
      setShowReturnModal(false);
    }
  };

  const onJumpToTicket = async () => {
    const key = jumpKey.trim().toUpperCase();
    if (!key) return;
    setJumpKey('');
    setSelectedKey(key);
    try { setDetail(await api<TicketDetail>(`/ticket/${key}`)); } catch { /* silent */ }
  };

  // ── Filters config ─────────────────────────────────────────────────────
  const filterPills: FilterPill[] = [
    { key: 'all', label: 'All', count: counts.total },
    { key: 'mine', label: 'Mine', count: counts.mine },
    { key: 'unclaimed', label: 'Unclaimed' },
    { key: 'fasttrack', label: '🔥 Fast' },
  ];

  const stats: StatCard[] = [
    { label: 'Queue', value: counts.total },
    { label: 'Pending', value: counts.pending, color: '#f59e0b' },
    { label: 'In Review', value: counts.inReview, color: '#5ec1ca' },
    { label: 'Fast-track', value: counts.fastTrack, color: '#f97316' },
    { label: 'Mine', value: counts.mine, color: '#9b6aed' },
  ];

  // ── Extra toolbar: team filter + show all + jump ─────────────────────
  const extraToolbar = (
    <div className="flex items-center gap-2">
      <select
        value={teamFilter}
        onChange={e => setTeamFilter(e.target.value)}
        className="px-2 py-1 text-[10px] rounded-lg border border-[#2f353d] text-neutral-300 bg-[#1a1e24]"
      >
        <option value="all">All teams ({items.length})</option>
        {teamOptions.map(t => <option key={t.team} value={t.team}>{t.team} ({t.count})</option>)}
      </select>
      {queueMeta?.userTeamFilterActive && (
        <button
          onClick={toggleShowAll}
          className="px-2 py-1 text-[10px] rounded-lg font-semibold transition-colors"
          style={{
            background: showAll ? 'rgba(249,115,22,0.12)' : 'rgba(94,193,202,0.08)',
            border: `1px solid ${showAll ? 'rgba(249,115,22,0.4)' : 'rgba(94,193,202,0.3)'}`,
            color: showAll ? '#fb923c' : '#5ec1ca',
          }}
        >
          {showAll ? '👁 All teams' : '◉ My team'}
        </button>
      )}
      {isAdminUser && (
        <div className="flex items-center gap-1">
          <input
            value={jumpKey}
            onChange={e => setJumpKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onJumpToTicket()}
            placeholder="NT-xxxxx"
            className="w-24 px-2 py-1 text-[10px] rounded-lg border border-[#2f353d] text-neutral-200 placeholder-neutral-600 font-mono bg-[#1a1e24]"
          />
          <button onClick={onJumpToTicket} className="px-2 py-1 text-[10px] rounded-lg font-semibold border border-amber-500/30 text-amber-400 hover:bg-amber-500/10">Jump</button>
        </div>
      )}
      {isAdminUser && <BackfillAdfButton />}
    </div>
  );

  // ── Queue config ───────────────────────────────────────────────────────
  const config: UnifiedQueueConfig<QueueItem> = useMemo(() => ({
    title: 'Dev Review Queue',
    icon: <span style={{ fontSize: 14, fontWeight: 900, fontFamily: 'monospace' }}>{'</>'}</span>,
    accentGradient: '#9b6aed 30%, #5ec1ca 70%',

    fetchItems: async () => {
      const qs = showAll ? '?showAll=1' : '';
      const res = await fetch(`/api/dev-review/queue${qs}`);
      const json = await res.json();
      return json.ok ? json.data : [];
    },
    pollIntervalMs: 60000,

    getKey: i => i.key,
    renderRow: (i, { selected, focused }) => (
      <DevReviewRow item={i} selected={selected} focused={focused} isMine={i.state?.claimed_by_user_id === currentUserId} />
    ),

    filters: filterPills,
    activeFilter: filter,
    onFilterChange: setFilter,
    searchPlaceholder: 'Search key, summary, TL;DR…',
    searchFn: (i, q) =>
      i.key.toLowerCase().includes(q) ||
      (i.fields.summary || '').toLowerCase().includes(q) ||
      adfToText(i.fields.customfield_13184).toLowerCase().includes(q),

    stats,
    extraToolbar,

    renderDetail: (item, actions) => {
      if (detailLoading && !detail) return <div className="flex items-center justify-center h-full text-neutral-500 text-[11px]">Loading ticket…</div>;
      if (!detail || detail.key !== item.key) return <div className="flex items-center justify-center h-full text-neutral-500 text-[11px]">Loading…</div>;
      return (
        <DevReviewDetail
          detail={detail}
          item={item}
          busy={busy}
          currentUserId={currentUserId}
          isAdmin={isAdminUser}
          queueActions={actions}
          onClaim={onClaim}
          onUnclaim={onUnclaim}
          onFastTrack={onFastTrack}
          onComment={onComment}
          onAcceptClick={openAcceptModal}
          onReturnClick={() => setShowReturnModal(true)}
          onLinkExistingClick={openLinkExistingModal}
        />
      );
    },
    renderEmpty: () => (
      <div className="flex items-center justify-center h-32 text-neutral-600 text-[11px]">
        {items.length === 0 ? 'Queue is empty — no NT tickets currently at Tier 3' : 'No tickets match the current filter'}
      </div>
    ),

    keyboardShortcuts: [
      { key: 'c', label: 'claim' },
    ],
    onSelect: (key) => setSelectedKey(key),
  }), [filter, items, filtered, counts, detail, detailLoading, busy, currentUserId, isAdminUser, showAll, teamFilter, teamOptions, queueMeta, jumpKey, selectedKey]);

  return (
    <>
      <style>{`
        @keyframes qPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(249,115,22,0); }
        }
      `}</style>
      <UnifiedQueue config={config} items={filtered} loading={loading} />

      {/* ── Modals ───────────────────────────────────────────────── */}
      {showAcceptModal && (
        <Modal onClose={() => setShowAcceptModal(false)} wide>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>ESCALATE TO DEVELOPMENT</span>
            <span className="text-[11px] font-mono text-[#5ec1ca]">{selectedKey}</span>
          </div>
          <h3 className="text-lg font-bold text-neutral-50 mb-1" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>Accept to Development backlog</h3>
          <p className="text-[12px] text-neutral-300 mb-5">Sets <span className="text-neutral-100 font-semibold">CurrentTier = Development</span>, populates the Escalate-to-Development screen fields below, and posts an internal Jira comment.</p>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 flex items-center gap-2"><span>TL;DR</span><span className="text-red-400">*</span></label>
            <textarea value={acceptTldr} onChange={e => setAcceptTldr(e.target.value)} placeholder="e.g. Email sends are queueing more than once…" rows={2} className="w-full px-3 py-2 text-[13px] rounded-lg border text-neutral-50 placeholder-neutral-600" style={{ ...drTheme.input, borderColor: acceptTldr.trim() ? 'rgba(255,255,255,0.12)' : 'rgba(239,68,68,0.4)' }} autoFocus />
          </div>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 block">Development Details</label>
            <textarea value={acceptDevDetails} onChange={e => setAcceptDevDetails(e.target.value)} placeholder="Technical context, suspected cause, queries…" rows={6} className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 font-mono" style={drTheme.input} />
          </div>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 block">Work item comment (optional)</label>
            <textarea value={acceptWorkItemComment} onChange={e => setAcceptWorkItemComment(e.target.value)} placeholder="Anything to add to the dev work item?" rows={3} className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600" style={drTheme.input} />
          </div>
          <div className="mb-5">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 block">Internal note (optional)</label>
            <textarea value={acceptNote} onChange={e => setAcceptNote(e.target.value)} placeholder="Optional context for the dev team…" rows={2} className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600" style={drTheme.input} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/5">
            <div className="text-[10px] text-neutral-500">{acceptTldr.trim() ? <span className="text-emerald-400">✓ TL;DR captured</span> : <span className="text-red-400">TL;DR required</span>}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowAcceptModal(false)} className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5">Cancel</button>
              <button onClick={onAccept} disabled={busy || !acceptTldr.trim()} className="px-5 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}>{busy ? 'Accepting…' : '✓ Move to Development'}</button>
            </div>
          </div>
        </Modal>
      )}

      {showLinkExistingModal && (
        <Modal onClose={() => setShowLinkExistingModal(false)} wide>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>LINK EXISTING WORK ITEM</span>
            <span className="text-[11px] font-mono text-[#5ec1ca]">{selectedKey}</span>
          </div>
          <h3 className="text-lg font-bold text-neutral-50 mb-1" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>Link to existing work item</h3>
          <p className="text-[12px] text-neutral-300 mb-5">Links an existing Jira work item instead of creating a new Bug. The ticket will still be transitioned to <span className="text-neutral-100 font-semibold">Development</span>.</p>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 flex items-center gap-2"><span>Work Item Key</span><span className="text-red-400">*</span></label>
            <input type="text" value={linkExistingKey} onChange={e => setLinkExistingKey(e.target.value.toUpperCase())} placeholder="e.g. BYM-1234" className="w-full px-3 py-2 text-[13px] rounded-lg border text-neutral-50 placeholder-neutral-600 font-mono" style={{ background: 'rgba(255,255,255,0.06)', borderColor: linkExistingKey.trim() && /^[A-Z]+-\d+$/.test(linkExistingKey.trim()) ? 'rgba(255,255,255,0.12)' : 'rgba(239,68,68,0.4)' }} autoFocus />
          </div>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 flex items-center gap-2"><span>TL;DR</span><span className="text-red-400">*</span></label>
            <textarea value={acceptTldr} onChange={e => setAcceptTldr(e.target.value)} placeholder="e.g. Email sends are queueing more than once…" rows={2} className="w-full px-3 py-2 text-[13px] rounded-lg border text-neutral-50 placeholder-neutral-600" style={{ background: 'rgba(255,255,255,0.06)', borderColor: acceptTldr.trim() ? 'rgba(255,255,255,0.12)' : 'rgba(239,68,68,0.4)' }} />
          </div>
          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 block">Development Details</label>
            <textarea value={acceptDevDetails} onChange={e => setAcceptDevDetails(e.target.value)} placeholder="Technical context, suspected cause, queries…" rows={6} className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 font-mono" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>
          <div className="mb-5">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 block">Internal note (optional)</label>
            <textarea value={acceptNote} onChange={e => setAcceptNote(e.target.value)} placeholder="Optional context for the dev team…" rows={2} className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/5">
            <div className="text-[10px] text-neutral-500">{linkExistingKey.trim() && /^[A-Z]+-\d+$/.test(linkExistingKey.trim()) && acceptTldr.trim() ? <span className="text-blue-400">✓ Ready to link</span> : <span className="text-red-400">{!linkExistingKey.trim() || !/^[A-Z]+-\d+$/.test(linkExistingKey.trim()) ? 'Valid work item key required' : 'TL;DR required'}</span>}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowLinkExistingModal(false)} className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5">Cancel</button>
              <button onClick={onLinkExisting} disabled={busy || !acceptTldr.trim() || !linkExistingKey.trim() || !/^[A-Z]+-\d+$/.test(linkExistingKey.trim())} className="px-5 py-2 text-xs rounded-lg font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #3b82f6, #60a5fa)', boxShadow: '0 4px 16px rgba(59,130,246,0.35)' }}>{busy ? 'Linking…' : '🔗 Link & Accept'}</button>
            </div>
          </div>
        </Modal>
      )}

      {acceptedWorkItem && (
        <Modal onClose={() => { setAcceptedWorkItem(null); setCopied(false); }}>
          <div className="text-center">
            <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.15)' }}><span className="text-3xl">✓</span></div>
            <h3 className="text-lg font-bold text-neutral-50 mb-1" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>Work item created</h3>
            <p className="text-[12px] text-neutral-400 mb-5">{acceptedWorkItem.sourceKey} has been escalated to development</p>
            <div className="flex items-center justify-center gap-3 mx-auto px-5 py-3 rounded-xl mb-5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span className="text-xl font-bold font-mono text-[#5ec1ca]">{acceptedWorkItem.key}</span>
              <button onClick={() => { navigator.clipboard.writeText(acceptedWorkItem.key); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="px-3 py-1.5 text-[11px] rounded-lg font-semibold border transition-all" style={{ background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)', borderColor: copied ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)', color: copied ? '#10b981' : '#94a3b8' }}>{copied ? '✓ Copied' : 'Copy'}</button>
            </div>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => { setAcceptedWorkItem(null); setCopied(false); }} className="px-5 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5">Close</button>
              <button onClick={() => window.open(`https://nurturtech.atlassian.net/browse/${acceptedWorkItem.key}`, '_blank')} className="px-5 py-2 text-xs rounded-lg font-bold text-[#0f172a]" style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}>Open in Jira ↗</button>
            </div>
          </div>
        </Modal>
      )}

      {showReturnModal && (
        <Modal onClose={() => setShowReturnModal(false)}>
          <h3 className="text-lg font-bold text-neutral-100 mb-3">Return to Customer Care</h3>
          <p className="text-[12px] text-neutral-400 mb-4">Write clear next steps for the agent — this is mandatory. The ticket will drop back to Tier 2 and reassign to the original submitter.</p>
          <textarea value={returnDraft} onChange={e => setReturnDraft(e.target.value)} placeholder="Clear next steps for the agent…" rows={6} className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 text-neutral-200 placeholder-neutral-600 mb-2" style={drTheme.input} autoFocus />
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] text-neutral-600">{returnDraft.length} chars (min 10)</div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowReturnModal(false)} className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5">Cancel</button>
            <button onClick={onReturn} disabled={busy || returnDraft.trim().length < 10} className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #9b6aed, #c4b5fd)', boxShadow: '0 4px 16px rgba(155,106,237,0.35)' }}>{busy ? 'Returning…' : 'Return with next steps'}</button>
          </div>
        </Modal>
      )}
    </>
  );
}
