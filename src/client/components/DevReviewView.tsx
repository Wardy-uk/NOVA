import { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface JiraUser { displayName: string; emailAddress?: string; accountId?: string }
interface JiraStatus { name: string; statusCategory?: { key: string; colorName?: string } }
interface JiraField<T = unknown> { value?: T }

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
  customfield_12981?: { value?: string; id?: string };  // CurrentTier
  customfield_13184?: string;                             // TL;DR
  customfield_13185?: string;                             // Agent Summary
  customfield_13212?: string;                             // Troubleshooting Performed
  customfield_13186?: { value?: string };                 // Escalation Reason
  customfield_13214?: string;                             // Expected Outcome
  customfield_13213?: string;                             // Environment
  customfield_13183?: { value?: string };                 // Nurtur Product
  customfield_13215?: unknown;                            // Development Details (ADF)
  [k: string]: unknown;
}

interface DevReviewState {
  jira_key: string;
  status: 'pending' | 'in_review' | 'accepted' | 'returned' | 'archived';
  fast_track: number;
  nova_priority: 'low' | 'normal' | 'high';
  claimed_by_user_id: number | null;
  claimed_at: string | null;
  submitted_by_username: string | null;
  first_seen_at: string;
  last_action_at: string;
  accepted_at: string | null;
  returned_at: string | null;
}

interface QueueItem {
  key: string;
  fields: JiraFields;
  state: DevReviewState | null;
}

interface ThreadEntry {
  id: number;
  jira_key: string;
  user_id: number;
  user_display: string;
  kind: 'comment' | 'state_change' | 'accept' | 'return' | 'claim' | 'fasttrack';
  body: string | null;
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
}

// ── API helpers ────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/dev-review${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json.data as T;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
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
            background: 'linear-gradient(90deg, transparent, #9b6aed 30%, #5ec1ca 70%, transparent)',
            backgroundSize: '200% 100%',
            animation: 'drShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string | undefined }) {
  const s = (status || 'pending') as DevReviewState['status'];
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', label: 'Pending' },
    in_review: { bg: 'rgba(94,193,202,0.15)', fg: '#5ec1ca', label: 'In Review' },
    accepted: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'Accepted' },
    returned: { bg: 'rgba(155,106,237,0.15)', fg: '#9b6aed', label: 'Returned' },
    archived: { bg: 'rgba(100,116,139,0.15)', fg: '#64748b', label: 'Archived' },
  };
  const m = map[s] || map.pending;
  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: m.bg, color: m.fg, border: `1px solid ${m.fg}40` }}
    >
      {m.label}
    </span>
  );
}

function FastTrackFlame() {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-flex items-center gap-1"
      style={{
        background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(245,158,11,0.2))',
        color: '#f97316',
        border: '1px solid rgba(249,115,22,0.4)',
        animation: 'drPulse 2s ease-in-out infinite',
      }}
    >
      🔥 FAST-TRACK
    </span>
  );
}

function BriefField({ label, value, mono }: { label: string; value: string | undefined | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5">{label}</div>
      <div
        className={`leading-relaxed whitespace-pre-wrap break-words ${mono ? 'font-mono text-[12px] text-emerald-200' : 'text-[13px] text-neutral-50'}`}
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px',
          padding: '12px 14px',
          maxHeight: mono ? '320px' : 'none',
          overflowY: mono ? 'auto' : 'visible',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────

export function DevReviewView() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'mine' | 'unclaimed' | 'fasttrack'>('all');
  const [search, setSearch] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [returnDraft, setReturnDraft] = useState('');
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [acceptNote, setAcceptNote] = useState('');
  const [acceptTldr, setAcceptTldr] = useState('');
  const [acceptDevDetails, setAcceptDevDetails] = useState('');
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const currentUserId = useMemo(() => {
    // Pulled from JWT — decode payload section
    try {
      const tok = localStorage.getItem('nova_auth_token') || '';
      const payload = JSON.parse(atob(tok.split('.')[1] || ''));
      return Number(payload?.id ?? 0);
    } catch { return 0; }
  }, []);

  const fireToast = (kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<QueueItem[]>('/queue');
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (key: string) => {
    setDetailLoading(true);
    try {
      const data = await api<TicketDetail>(`/ticket/${key}`);
      setDetail(data);
    } catch (e) {
      fireToast('err', e instanceof Error ? e.message : 'Failed to load ticket');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    if (selectedKey) loadDetail(selectedKey);
    else setDetail(null);
  }, [selectedKey, loadDetail]);

  // Auto-refresh queue every 60s
  useEffect(() => {
    const i = setInterval(() => loadQueue(), 60_000);
    return () => clearInterval(i);
  }, [loadQueue]);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (filter === 'mine' && i.state?.claimed_by_user_id !== currentUserId) return false;
      if (filter === 'unclaimed' && i.state?.claimed_by_user_id != null) return false;
      if (filter === 'fasttrack' && !i.state?.fast_track) return false;
      if (search) {
        const q = search.toLowerCase();
        const match = i.key.toLowerCase().includes(q) ||
                      (i.fields.summary || '').toLowerCase().includes(q) ||
                      adfToText(i.fields.customfield_13184).toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [items, filter, search, currentUserId]);

  const counts = useMemo(() => ({
    total: items.length,
    pending: items.filter((i) => i.state?.status === 'pending').length,
    inReview: items.filter((i) => i.state?.status === 'in_review').length,
    fastTrack: items.filter((i) => i.state?.fast_track).length,
    unclaimed: items.filter((i) => !i.state?.claimed_by_user_id).length,
    mine: items.filter((i) => i.state?.claimed_by_user_id === currentUserId).length,
  }), [items, currentUserId]);

  // ── Actions ──────────────────────────────────────────────────────────
  const doAction = async (path: string, init?: RequestInit, successMsg?: string) => {
    if (!selectedKey) return;
    setBusy(true);
    try {
      await api(path, init);
      if (successMsg) fireToast('ok', successMsg);
      await Promise.all([loadQueue(), loadDetail(selectedKey)]);
    } catch (e) {
      fireToast('err', e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const onClaim = () => doAction(`/ticket/${selectedKey}/claim`, { method: 'POST' }, 'Claimed');
  const onUnclaim = () => doAction(`/ticket/${selectedKey}/unclaim`, { method: 'POST' }, 'Unclaimed');
  const onFastTrack = (on: boolean) => doAction(`/ticket/${selectedKey}/fast-track`, {
    method: 'POST', body: JSON.stringify({ on }),
  }, on ? 'Fast-tracked' : 'Fast-track cleared');
  const onComment = async () => {
    if (!commentDraft.trim()) return;
    await doAction(`/ticket/${selectedKey}/comment`, {
      method: 'POST', body: JSON.stringify({ body: commentDraft }),
    }, 'Comment posted to Jira');
    setCommentDraft('');
  };
  const openAcceptModal = () => {
    if (!detail) return;
    // Prefill TL;DR from the existing Jira value if captured during T3 escalation
    setAcceptTldr(adfToText(detail.fields.customfield_13184));
    // Prefill Development Details from existing value (usually empty at T3 stage)
    setAcceptDevDetails(adfToText(detail.fields.customfield_13215));
    setAcceptNote('');
    setShowAcceptModal(true);
  };
  const onAccept = async () => {
    if (!acceptTldr.trim()) {
      fireToast('err', 'TL;DR is required by the Escalate to Development screen');
      return;
    }
    await doAction(`/ticket/${selectedKey}/accept`, {
      method: 'POST',
      body: JSON.stringify({
        note: acceptNote,
        tldr: acceptTldr,
        developmentDetails: acceptDevDetails,
      }),
    }, 'Accepted to development');
    setAcceptNote('');
    setAcceptTldr('');
    setAcceptDevDetails('');
    setShowAcceptModal(false);
  };
  const onReturn = async () => {
    if (returnDraft.trim().length < 10) {
      fireToast('err', 'Next steps must be at least 10 characters');
      return;
    }
    await doAction(`/ticket/${selectedKey}/return`, {
      method: 'POST', body: JSON.stringify({ nextSteps: returnDraft }),
    }, 'Returned to Customer Care');
    setReturnDraft('');
    setShowReturnModal(false);
  };

  // ── Render ────────────────────────────────────────────────────────────
  const selectedItem = items.find((i) => i.key === selectedKey);

  return (
    <div className="relative min-h-screen -mx-6 -my-4 px-8 py-6 overflow-hidden">
      <div
        className="fixed inset-0 pointer-events-none opacity-70"
        style={{
          background: `
            radial-gradient(ellipse at 12% 18%, rgba(155,106,237,0.13) 0%, transparent 50%),
            radial-gradient(ellipse at 88% 25%, rgba(94,193,202,0.10) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 95%, rgba(249,115,22,0.05) 0%, transparent 55%)
          `,
          animation: 'drMesh 25s ease-in-out infinite alternate',
          zIndex: 0,
        }}
      />
      <style>{`
        @keyframes drMesh {
          0% { transform: translate(0,0) scale(1); }
          50% { transform: translate(-1%,1%) scale(1.03); }
          100% { transform: translate(1%,-1%) scale(0.99); }
        }
        @keyframes drShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes drPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(249,115,22,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(249,115,22,0); }
        }
        @keyframes drFadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .dr-fade { animation: drFadeIn 0.45s cubic-bezier(0.16,1,0.3,1) both; }
        .dr-scroll::-webkit-scrollbar { width: 6px; }
        .dr-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 6px; }
        .dr-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>

      <div className="relative z-10 max-w-[1800px] mx-auto">
        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="dr-fade flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black"
              style={{
                background: 'linear-gradient(135deg, #9b6aed, #5ec1ca)',
                boxShadow: '0 8px 32px rgba(155,106,237,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
                color: '#0f172a',
              }}
            >
              {'</>'}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-semibold">Technical Support</div>
              <h1
                className="text-2xl font-black tracking-tight"
                style={{
                  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
                  background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Dev Review Queue
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <HeaderStat label="Queue" value={counts.total} />
            <HeaderStat label="Pending" value={counts.pending} accent="#f59e0b" />
            <HeaderStat label="In Review" value={counts.inReview} accent="#5ec1ca" />
            <HeaderStat label="Fast-track" value={counts.fastTrack} accent="#f97316" />
            <HeaderStat label="Mine" value={counts.mine} accent="#9b6aed" />
            <button
              onClick={loadQueue}
              className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-200 border border-white/10 hover:bg-white/5 transition-all"
              style={{ background: 'rgba(255,255,255,0.03)' }}
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* ── Master/detail grid ───────────────────────────────────── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '440px 1fr', minHeight: 'calc(100vh - 180px)' }}>
          {/* Left: Queue list */}
          <GlassCard accent className="p-4 flex flex-col" >
            <div className="flex items-center gap-2 mb-3">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search key, summary, TL;DR…"
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-white/10 text-neutral-200 placeholder-neutral-600"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              />
            </div>
            <div className="flex items-center gap-1 mb-3 text-[11px]">
              {(['all', 'mine', 'unclaimed', 'fasttrack'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="px-2.5 py-1 rounded-full font-semibold transition-all"
                  style={{
                    background: filter === f ? 'linear-gradient(135deg, rgba(155,106,237,0.2), rgba(94,193,202,0.2))' : 'transparent',
                    color: filter === f ? '#c4b5fd' : '#64748b',
                    border: `1px solid ${filter === f ? 'rgba(155,106,237,0.4)' : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  {f === 'fasttrack' ? '🔥 Fast' : f === 'mine' ? 'Mine' : f === 'unclaimed' ? 'Unclaimed' : 'All'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto dr-scroll space-y-2 pr-1" style={{ maxHeight: 'calc(100vh - 290px)' }}>
              {loading && items.length === 0 && (
                <div className="text-xs text-neutral-500 p-4 text-center">Loading queue…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="text-xs text-neutral-500 p-8 text-center">
                  {items.length === 0 ? 'Queue is empty — no NT tickets currently at Tier 3 🎉' : 'No tickets match the current filter'}
                </div>
              )}
              {filtered.map((item) => (
                <QueueRow
                  key={item.key}
                  item={item}
                  selected={item.key === selectedKey}
                  isMine={item.state?.claimed_by_user_id === currentUserId}
                  onClick={() => setSelectedKey(item.key)}
                />
              ))}
            </div>
          </GlassCard>

          {/* Right: Detail pane */}
          <div className="flex flex-col gap-4 min-w-0">
            {!selectedKey ? (
              <GlassCard accent className="flex-1 flex items-center justify-center">
                <div className="text-center py-16">
                  <div className="text-5xl mb-3 opacity-40">◎</div>
                  <div className="text-sm text-neutral-500">Select a ticket to review</div>
                </div>
              </GlassCard>
            ) : detailLoading && !detail ? (
              <GlassCard accent className="flex-1 flex items-center justify-center">
                <div className="text-sm text-neutral-500">Loading ticket…</div>
              </GlassCard>
            ) : detail ? (
              <TicketDetailPane
                detail={detail}
                selectedItem={selectedItem}
                busy={busy}
                currentUserId={currentUserId}
                commentDraft={commentDraft}
                setCommentDraft={setCommentDraft}
                onClaim={onClaim}
                onUnclaim={onUnclaim}
                onFastTrack={onFastTrack}
                onComment={onComment}
                onAcceptClick={openAcceptModal}
                onReturnClick={() => setShowReturnModal(true)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {showAcceptModal && (
        <Modal onClose={() => setShowAcceptModal(false)} wide>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
              ESCALATE TO DEVELOPMENT
            </span>
            <span className="text-[11px] font-mono text-[#5ec1ca]">{selectedKey}</span>
          </div>
          <h3 className="text-lg font-bold text-neutral-50 mb-1" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
            Accept to Development backlog
          </h3>
          <p className="text-[12px] text-neutral-300 mb-5">
            Sets <span className="text-neutral-100 font-semibold">CurrentTier = Development</span>, populates the
            Escalate-to-Development screen fields below, and posts an internal Jira comment.
          </p>

          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 flex items-center gap-2">
              <span>TL;DR</span>
              <span className="text-red-400">*</span>
              <span className="text-neutral-500 normal-case font-normal text-[10px]">High level short phrase to describe the issue / request</span>
            </label>
            <textarea
              value={acceptTldr}
              onChange={(e) => setAcceptTldr(e.target.value)}
              placeholder="e.g. Email sends are queueing more than once for some campaigns…"
              rows={2}
              className="w-full px-3 py-2 text-[13px] rounded-lg border text-neutral-50 placeholder-neutral-600"
              style={{
                background: 'rgba(255,255,255,0.06)',
                borderColor: acceptTldr.trim() ? 'rgba(255,255,255,0.12)' : 'rgba(239,68,68,0.4)',
              }}
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 flex items-center gap-2">
              <span>Development Details</span>
              <span className="text-neutral-500 normal-case font-normal text-[10px]">Anything Engineering needs — repro, suspected cause, links, queries</span>
            </label>
            <textarea
              value={acceptDevDetails}
              onChange={(e) => setAcceptDevDetails(e.target.value)}
              placeholder="Any technical context, suspected cause, queries to run, related tickets…"
              rows={6}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 font-mono"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            />
          </div>

          <div className="mb-5">
            <label className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5 block">
              Internal note (optional)
            </label>
            <textarea
              value={acceptNote}
              onChange={(e) => setAcceptNote(e.target.value)}
              placeholder="Optional context for the dev team…"
              rows={2}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/5">
            <div className="text-[10px] text-neutral-500">
              {acceptTldr.trim() ? (
                <span className="text-emerald-400">✓ TL;DR captured</span>
              ) : (
                <span className="text-red-400">TL;DR required</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAcceptModal(false)}
                className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={onAccept}
                disabled={busy || !acceptTldr.trim()}
                className="px-5 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}
              >
                {busy ? 'Accepting…' : '✓ Move to Development'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showReturnModal && (
        <Modal onClose={() => setShowReturnModal(false)}>
          <h3 className="text-lg font-bold text-neutral-100 mb-3">Return to Customer Care</h3>
          <p className="text-[12px] text-neutral-400 mb-4">
            Write clear next steps for the agent — this is mandatory. The ticket will drop back to Tier 2
            and reassign to the original submitter. The comment will be posted to Jira.
          </p>
          <textarea
            value={returnDraft}
            onChange={(e) => setReturnDraft(e.target.value)}
            placeholder="Clear next steps for the agent…"
            rows={6}
            className="w-full px-3 py-2 text-sm rounded-lg border border-white/10 text-neutral-200 placeholder-neutral-600 mb-2"
            style={{ background: 'rgba(255,255,255,0.03)' }}
            autoFocus
          />
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] text-neutral-600">{returnDraft.length} chars (min 10)</div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowReturnModal(false)}
              className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              onClick={onReturn}
              disabled={busy || returnDraft.trim().length < 10}
              className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #9b6aed, #c4b5fd)', boxShadow: '0 4px 16px rgba(155,106,237,0.35)' }}
            >
              {busy ? 'Returning…' : 'Return with next steps'}
            </button>
          </div>
        </Modal>
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
            animation: 'drFadeIn 0.3s ease',
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

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

function QueueRow({
  item, selected, isMine, onClick,
}: { item: QueueItem; selected: boolean; isMine: boolean; onClick: () => void }) {
  const tldr = adfToText(item.fields.customfield_13184);
  const summary = item.fields.summary || '(no summary)';
  const product = item.fields.customfield_13183?.value;
  const updated = item.fields.updated;
  const claimed = item.state?.claimed_by_user_id;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer p-3 rounded-xl transition-all duration-200"
      style={{
        background: selected ? 'rgba(155,106,237,0.1)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? 'rgba(155,106,237,0.4)' : 'rgba(255,255,255,0.06)'}`,
        boxShadow: selected ? '0 4px 20px rgba(155,106,237,0.15)' : 'none',
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-mono font-bold text-[#5ec1ca]">{item.key}</span>
          {isMine && (
            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(155,106,237,0.2)', color: '#c4b5fd' }}>
              MINE
            </span>
          )}
          {item.state?.fast_track ? <FastTrackFlame /> : null}
        </div>
        <StatusPill status={item.state?.status} />
      </div>
      <div className="text-[12px] text-neutral-50 font-semibold truncate mb-1">{summary}</div>
      {tldr && (
        <div className="text-[11px] text-neutral-300 line-clamp-2 mb-2 leading-snug">{tldr}</div>
      )}
      <div className="flex items-center justify-between text-[10px] text-neutral-400">
        <div className="flex items-center gap-2">
          {product && <span className="px-1.5 py-0.5 rounded bg-white/10 text-neutral-200">{product}</span>}
          {claimed ? (
            <span className="text-[#c4b5fd]">◉ claimed</span>
          ) : (
            <span className="text-amber-400">○ unclaimed</span>
          )}
        </div>
        <span>{timeAgo(updated)}</span>
      </div>
    </div>
  );
}

function TicketDetailPane({
  detail, selectedItem, busy, currentUserId,
  commentDraft, setCommentDraft, onClaim, onUnclaim, onFastTrack, onComment,
  onAcceptClick, onReturnClick,
}: {
  detail: TicketDetail;
  selectedItem: QueueItem | undefined;
  busy: boolean;
  currentUserId: number;
  commentDraft: string;
  setCommentDraft: (v: string) => void;
  onClaim: () => void;
  onUnclaim: () => void;
  onFastTrack: (on: boolean) => void;
  onComment: () => void;
  onAcceptClick: () => void;
  onReturnClick: () => void;
}) {
  const { fields, state, thread } = detail;
  const tldr = adfToText(fields.customfield_13184);
  const agentSummary = adfToText(fields.customfield_13185);
  const troubleshooting = adfToText(fields.customfield_13212);
  const expectedOutcome = adfToText(fields.customfield_13214);
  const environment = adfToText(fields.customfield_13213);
  const escalationReason = fields.customfield_13186?.value;
  const description = adfToText(fields.description);
  const product = fields.customfield_13183?.value;
  const isMine = state?.claimed_by_user_id === currentUserId;
  const terminal = state?.status === 'accepted' || state?.status === 'returned';

  return (
    <>
      {/* Action bar */}
      <GlassCard accent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[11px] font-mono font-bold text-[#5ec1ca]">{detail.key}</span>
              <StatusPill status={state?.status} />
              {state?.fast_track ? <FastTrackFlame /> : null}
              {product && (
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full" style={{ background: 'rgba(94,193,202,0.15)', color: '#5ec1ca', border: '1px solid rgba(94,193,202,0.3)' }}>
                  {product}
                </span>
              )}
              {fields.status?.name && (
                <span className="text-[10px] text-neutral-500">· Jira: {fields.status.name}</span>
              )}
            </div>
            <h2 className="text-xl font-bold text-neutral-100 leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
              {fields.summary}
            </h2>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-300">
              <span>Reporter: <span className="text-neutral-100 font-semibold">{fields.reporter?.displayName || '—'}</span></span>
              <span className="text-neutral-600">·</span>
              <span>Assignee: <span className="text-neutral-100 font-semibold">{fields.assignee?.displayName || 'Unassigned'}</span></span>
              <span className="text-neutral-600">·</span>
              <span>Updated <span className="text-neutral-100">{timeAgo(fields.updated)}</span> ago</span>
              {state?.claimed_by_user_id && (
                <>
                  <span className="text-neutral-600">·</span>
                  <span className="text-[#c4b5fd] font-semibold">Claimed {timeAgo(state.claimed_at)} ago</span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {!terminal && (
              <>
                {!state?.claimed_by_user_id || !isMine ? (
                  <button
                    onClick={onClaim}
                    disabled={busy}
                    className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-200 border border-white/10 hover:bg-white/5 disabled:opacity-40"
                  >
                    {state?.claimed_by_user_id ? 'Steal claim' : 'Claim'}
                  </button>
                ) : (
                  <button
                    onClick={onUnclaim}
                    disabled={busy}
                    className="px-3 py-2 text-xs rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5 disabled:opacity-40"
                  >
                    Unclaim
                  </button>
                )}
                <button
                  onClick={() => onFastTrack(!state?.fast_track)}
                  disabled={busy}
                  className="px-3 py-2 text-xs rounded-lg font-semibold disabled:opacity-40"
                  style={{
                    background: state?.fast_track ? 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(239,68,68,0.2))' : 'rgba(255,255,255,0.03)',
                    border: state?.fast_track ? '1px solid rgba(249,115,22,0.4)' : '1px solid rgba(255,255,255,0.1)',
                    color: state?.fast_track ? '#f97316' : '#d4d4d8',
                  }}
                >
                  🔥 Fast-track
                </button>
                <button
                  onClick={onReturnClick}
                  disabled={busy}
                  className="px-3 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #9b6aed, #c4b5fd)', boxShadow: '0 4px 16px rgba(155,106,237,0.35)' }}
                >
                  ↩ Return
                </button>
                <button
                  onClick={onAcceptClick}
                  disabled={busy}
                  className="px-3 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}
                >
                  ✓ Accept
                </button>
              </>
            )}
            {terminal && (
              <div className="text-[11px] text-neutral-500 italic px-3 py-2">
                {state?.status === 'accepted' ? 'Accepted to development — no further action' : 'Returned to CC — no further action'}
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Body grid: brief | thread */}
      <div className="grid gap-4 flex-1" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        {/* Brief */}
        <GlassCard className="p-5 overflow-y-auto dr-scroll" >
          <div className="text-[11px] uppercase tracking-wider text-[#c4b5fd] font-bold mb-4">
            ⌘ The Brief
          </div>
          <BriefField label="TL;DR" value={tldr} />
          <BriefField label="Escalation Reason" value={escalationReason || null} />
          <BriefField label="Agent Summary" value={agentSummary} />
          <BriefField label="Troubleshooting Performed" value={troubleshooting} mono />
          <BriefField label="Expected Outcome" value={expectedOutcome} />
          <BriefField label="Environment" value={environment} mono />
          {description && !agentSummary && <BriefField label="Description" value={description} />}
          {!tldr && !agentSummary && !troubleshooting && !expectedOutcome && (
            <div className="text-[11px] text-neutral-500 italic p-4 text-center">
              No escalation brief captured — this ticket may have been transitioned to T3 without using the escalation screen.
            </div>
          )}
        </GlassCard>

        {/* Thread + comment composer */}
        <GlassCard className="p-5 flex flex-col" >
          <div className="text-[11px] uppercase tracking-wider text-[#5ec1ca] font-bold mb-3">
            ◈ Activity
          </div>
          <div className="flex-1 overflow-y-auto dr-scroll space-y-2 mb-3 pr-1" style={{ maxHeight: '360px' }}>
            {thread.length === 0 && (
              <div className="text-[11px] text-neutral-600 italic p-4 text-center">No activity yet</div>
            )}
            {thread.map((t) => <ThreadEntryRow key={t.id} entry={t} />)}
          </div>
          {!terminal && (
            <div className="pt-3 border-t border-white/5">
              <textarea
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Add a comment (will post to Jira as internal, tagged with your name)"
                rows={3}
                className="w-full px-3 py-2 text-xs rounded-lg border border-white/10 text-neutral-200 placeholder-neutral-600 mb-2"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              />
              <div className="flex justify-end">
                <button
                  onClick={onComment}
                  disabled={busy || !commentDraft.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)', boxShadow: '0 4px 12px rgba(94,193,202,0.3)' }}
                >
                  Post Comment
                </button>
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </>
  );
}

function ThreadEntryRow({ entry }: { entry: ThreadEntry }) {
  const kindColour = {
    comment: '#5ec1ca',
    accept: '#10b981',
    return: '#9b6aed',
    claim: '#64748b',
    fasttrack: '#f97316',
    state_change: '#64748b',
  }[entry.kind];
  const icon = {
    comment: '💬',
    accept: '✓',
    return: '↩',
    claim: '◉',
    fasttrack: '🔥',
    state_change: '◈',
  }[entry.kind];

  return (
    <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-[10px] font-bold" style={{ color: kindColour }}>
          <span>{icon}</span>
          <span className="uppercase tracking-wider">{entry.kind}</span>
          <span className="text-neutral-300 font-normal">· {entry.user_display}</span>
        </div>
        <div className="flex items-center gap-2">
          {entry.jira_sync_state === 'pending' && (
            <span className="text-[9px] text-amber-400">syncing…</span>
          )}
          {entry.jira_sync_state === 'failed' && (
            <span className="text-[9px] text-red-400" title={entry.jira_sync_error || ''}>sync failed</span>
          )}
          {entry.jira_sync_state === 'synced' && (
            <span className="text-[9px] text-emerald-400">✓ jira</span>
          )}
          <span className="text-[10px] text-neutral-400">{timeAgo(entry.created_at)}</span>
        </div>
      </div>
      {entry.body && (
        <div className="text-[12px] text-neutral-100 whitespace-pre-wrap leading-relaxed">{entry.body}</div>
      )}
    </div>
  );
}

function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl p-6 max-h-[90vh] overflow-y-auto`}
        style={{
          background: 'rgba(30,36,48,0.97)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
