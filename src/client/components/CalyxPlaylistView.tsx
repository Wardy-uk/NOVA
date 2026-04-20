import { useState, useEffect, useCallback } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, StatusBadge, PriorityBadge, SlaCountdown, SloProgress, EmptyState, AgentAvatar, calyxApi, formatDateTime } from './calyx-shared.js';

interface Ticket {
  id: number;
  reference: string;
  title: string;
  status: string;
  priority: string;
  requester_name: string;
  requester_email: string;
  description: string;
  frt_due_at: string | null;
  frt_met_at: string | null;
  frt_paused: boolean;
  resolution_due_at: string | null;
  resolution_met_at: string | null;
  resolution_paused: boolean;
  comments: { id: number; body: string; agent_name: string; created_at: string }[];
}

interface QueueStats {
  total: number;
  actioned_today: number;
  skipped_today: number;
}

interface Slo {
  slo_name: string;
  metric_type: string;
  target_at: string;
  warning_at: string;
  completed_at: string | null;
  breached: boolean;
}

const SKIP_REASONS = [
  'Waiting for info',
  'Blocked by another ticket',
  'Needs escalation',
  'Out of scope',
];

const STATUS_OPTIONS = [
  'open', 'in_progress', 'waiting_customer', 'waiting_third_party', 'resolved', 'closed',
];

export function CalyxPlaylistView() {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [slos, setSlos] = useState<Slo[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [comment, setComment] = useState('');
  const [descExpanded, setDescExpanded] = useState(false);
  const [commentsExpanded, setCommentsExpanded] = useState(false);
  const [skipModalOpen, setSkipModalOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setDescExpanded(false);
    setCommentsExpanded(false);
    setComment('');
    const [queueRes, statsRes] = await Promise.all([
      calyxApi<Ticket | null>('/my-queue'),
      calyxApi<QueueStats>('/my-queue/stats'),
    ]);
    if (queueRes.ok) {
      setTicket(queueRes.data ?? null);
      setStatus(queueRes.data?.status ?? '');
    }
    if (statsRes.ok && statsRes.data) setStats(statsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  useEffect(() => {
    if (!ticket) { setSlos([]); return; }
    calyxApi<Slo[]>(`/tickets/${ticket.id}/slos`).then(r => {
      if (r.ok && r.data) setSlos(r.data);
      else setSlos([]);
    });
  }, [ticket?.id]);

  const handleSendAndNext = async () => {
    if (!ticket) return;
    setSending(true);
    try {
      if (comment.trim()) {
        await calyxApi(`/tickets/${ticket.id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: comment.trim(), agent_id: 'me', is_internal: false }),
        });
      }
      if (status !== ticket.status) {
        await calyxApi(`/tickets/${ticket.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
      }
      await fetchQueue();
    } finally {
      setSending(false);
    }
  };

  const handleSkip = async (reason: string) => {
    if (!ticket) return;
    setSkipModalOpen(false);
    setSending(true);
    try {
      await calyxApi(`/tickets/${ticket.id}/skip`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await fetchQueue();
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <span style={{ color: C.text3, fontSize: 14 }}>Loading queue...</span>
      </div>
    );
  }

  const activeSlos = slos.filter(s => !s.completed_at);
  const lastComments = (ticket?.comments ?? []).slice(-3);
  const descShort = ticket?.description && ticket.description.length > 200
    ? ticket.description.slice(0, 200) + '...'
    : ticket?.description ?? '';

  return (
    <div style={{ padding: 24 }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text1 }}>My Queue</h2>
        {stats && (
          <>
            <span style={{
              display: 'inline-block', padding: '4px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              color: '#fff', background: C.teal,
            }}>
              {stats.actioned_today} of {stats.total} actioned today
            </span>
            <span style={{ fontSize: 13, color: C.text3 }}>
              {stats.skipped_today} skipped
            </span>
          </>
        )}
      </div>

      {/* Main card */}
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {!ticket ? (
          <div style={cardStyle}>
            <EmptyState icon="check" title="You're all caught up" subtitle="No more tickets in your queue." />
          </div>
        ) : (
          <div style={cardStyle}>
            {/* Top row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <PriorityBadge priority={ticket.priority} glow />
              <span style={{ fontFamily: 'monospace', fontSize: 13, color: C.teal, fontWeight: 600 }}>{ticket.reference}</span>
              <StatusBadge status={ticket.status} />
            </div>

            {/* Title */}
            <h3 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: C.text1, lineHeight: 1.3 }}>{ticket.title}</h3>

            {/* Requester info */}
            <div style={{ fontSize: 13, color: C.text3, marginBottom: 20 }}>
              {ticket.requester_name} &middot; {ticket.requester_email}
            </div>

            {/* SLA blocks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div style={{ ...cardStyle, padding: 14 }}>
                <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, marginBottom: 6 }}>First Response</div>
                <SlaCountdown dueAt={ticket.frt_due_at} isPaused={ticket.frt_paused} metAt={ticket.frt_met_at} isFrt />
              </div>
              <div style={{ ...cardStyle, padding: 14 }}>
                <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, marginBottom: 6 }}>Resolution</div>
                <SlaCountdown dueAt={ticket.resolution_due_at} isPaused={ticket.resolution_paused} metAt={ticket.resolution_met_at} />
              </div>
            </div>

            {/* SLO progress bars */}
            {activeSlos.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                {activeSlos.map(slo => (
                  <div key={slo.slo_name} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: C.text2, marginBottom: 4 }}>{slo.slo_name}</div>
                    <SloProgress targetAt={slo.target_at} warningAt={slo.warning_at} completedAt={slo.completed_at} breached={slo.breached} />
                  </div>
                ))}
              </div>
            )}

            {/* Description */}
            {ticket.description && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: C.text3, fontWeight: 600, marginBottom: 6 }}>Description</div>
                <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {descExpanded ? ticket.description : descShort}
                </div>
                {ticket.description.length > 200 && (
                  <button
                    onClick={() => setDescExpanded(!descExpanded)}
                    style={{ background: 'none', border: 'none', color: C.teal, fontSize: 12, cursor: 'pointer', padding: '4px 0', marginTop: 4 }}
                  >
                    {descExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}

            {/* Last 3 comments */}
            {lastComments.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <button
                  onClick={() => setCommentsExpanded(!commentsExpanded)}
                  style={{ background: 'none', border: 'none', color: C.text3, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: 0, marginBottom: 8 }}
                >
                  Comments ({lastComments.length}) {commentsExpanded ? '▾' : '▸'}
                </button>
                {commentsExpanded && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {lastComments.map(c => (
                      <div key={c.id} style={{ ...cardStyle, padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <AgentAvatar name={c.agent_name} size={22} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>{c.agent_name}</span>
                          <span style={{ fontSize: 11, color: C.text3 }}>{formatDateTime(c.created_at)}</span>
                        </div>
                        <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.5 }}>{c.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action bar */}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                style={selectStyle}
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Add a comment..."
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendAndNext(); } }}
                style={{ ...inputStyle, flex: 1, minWidth: 180, width: 'auto' }}
              />
              <button
                onClick={handleSendAndNext}
                disabled={sending}
                style={{ ...btnPrimary, opacity: sending ? 0.6 : 1 }}
              >
                {sending ? 'Sending...' : 'Send & Next'}
              </button>
              <button
                onClick={() => setSkipModalOpen(true)}
                disabled={sending}
                style={btnSecondary}
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Skip modal overlay */}
      {skipModalOpen && (
        <>
          <div
            onClick={() => setSkipModalOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24,
            zIndex: 1000, minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 16, color: C.text1 }}>Skip Reason</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {SKIP_REASONS.map(reason => (
                <button
                  key={reason}
                  onClick={() => handleSkip(reason)}
                  style={{
                    ...btnSecondary,
                    textAlign: 'left' as const,
                    padding: '10px 16px',
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <button
              onClick={() => setSkipModalOpen(false)}
              style={{ background: 'none', border: 'none', color: C.text3, fontSize: 12, cursor: 'pointer', marginTop: 12, padding: 0 }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
