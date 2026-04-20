import { useState, useEffect, useCallback, useRef, type CSSProperties } from 'react';
import type {
  CalyxTicket, CalyxTeam, CalyxAgent, CalyxCategory,
  CalyxTicketEvent, CalyxComment,
  TicketStatus, TicketPriority,
} from '../../shared/calyx-types.js';

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  bg3: '#343a42',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
  border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
  glassHover: 'rgba(255,255,255,0.06)',
} as const;

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_customer: 'Waiting Customer',
  waiting_third_party: 'Waiting 3rd Party',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_STYLE: Record<TicketStatus, { color: string; bg: string; glow: string }> = {
  open:                { color: C.teal,   bg: `${C.teal}18`,   glow: `0 0 8px ${C.teal}40` },
  in_progress:         { color: C.amber,  bg: `${C.amber}18`,  glow: `0 0 8px ${C.amber}40` },
  waiting_customer:    { color: C.purple, bg: `${C.purple}18`, glow: `0 0 8px ${C.purple}40` },
  waiting_third_party: { color: C.purple, bg: `${C.purple}18`, glow: `0 0 8px ${C.purple}40` },
  resolved:            { color: C.green,  bg: `${C.green}18`,  glow: `0 0 8px ${C.green}40` },
  closed:              { color: C.text3,  bg: `${C.text3}18`,  glow: 'none' },
};

const PRIORITY_STYLE: Record<TicketPriority, { color: string; bg: string; glow: string }> = {
  P1: { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  glow: '0 0 8px rgba(239,68,68,0.4)' },
  P2: { color: '#f97316', bg: 'rgba(249,115,22,0.15)', glow: '0 0 8px rgba(249,115,22,0.3)' },
  P3: { color: '#eab308', bg: 'rgba(234,179,8,0.12)',  glow: '0 0 6px rgba(234,179,8,0.2)' },
  P4: { color: C.text3,   bg: `${C.text3}15`,           glow: 'none' },
};

const PRIORITY_BORDER: Record<TicketPriority, string> = {
  P1: C.red, P2: '#f97316', P3: '#eab308', P4: 'transparent',
};

const selectStyle: CSSProperties = {
  background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '6px 10px', fontSize: 12, color: C.text1, outline: 'none',
  cursor: 'pointer', appearance: 'auto' as const,
};

const inputStyle: CSSProperties = {
  width: '100%', background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '8px 12px', fontSize: 13, color: C.text1, outline: 'none',
};

const labelStyle: CSSProperties = { display: 'block', fontSize: 11, color: C.text3, marginBottom: 4, fontWeight: 600 };

function formatTimeRemaining(dueAt: string | null, isPaused: boolean, resolvedAt: string | null, frtMetAt: string | null, isFrt: boolean): { text: string; breached: boolean; paused: boolean } {
  if (isFrt && frtMetAt) return { text: 'Met', breached: false, paused: false };
  if (!isFrt && resolvedAt) return { text: 'Met', breached: false, paused: false };
  if (!dueAt) return { text: '-', breached: false, paused: false };
  if (isPaused) return { text: 'Paused', breached: false, paused: true };

  const now = Date.now();
  const due = new Date(dueAt.replace(' ', 'T') + 'Z').getTime();
  const diff = due - now;

  if (diff <= 0) {
    const elapsed = Math.abs(diff);
    const mins = Math.floor(elapsed / 60000);
    if (mins < 60) return { text: `-${mins}m`, breached: true, paused: false };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return { text: `-${hrs}h ${mins % 60}m`, breached: true, paused: false };
    return { text: `-${Math.floor(hrs / 24)}d ${hrs % 24}h`, breached: true, paused: false };
  }

  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { text: `${mins}m`, breached: false, paused: false };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { text: `${hrs}h ${mins % 60}m`, breached: false, paused: false };
  return { text: `${Math.floor(hrs / 24)}d ${hrs % 24}h`, breached: false, paused: false };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Pulse({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
      backgroundColor: color, boxShadow: `0 0 6px ${color}`,
      animation: 'calyxPulse 2s ease-in-out infinite', marginRight: 6, flexShrink: 0,
    }} />
  );
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const s = PRIORITY_STYLE[priority];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
      color: s.color, background: s.bg, boxShadow: s.glow,
    }}>{priority}</span>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 20,
      fontSize: 10, fontWeight: 600,
      color: s.color, background: s.bg, boxShadow: s.glow,
    }}>{STATUS_LABELS[status]}</span>
  );
}

function SlaCell({ sla }: { sla: { text: string; breached: boolean; paused: boolean } }) {
  if (sla.text === '-') return <span style={{ color: C.text3, fontSize: 12, fontFamily: 'monospace' }}>-</span>;
  if (sla.text === 'Met') return (
    <span style={{ color: C.green, fontSize: 12, fontWeight: 600, fontFamily: 'monospace' }}>
      <span style={{ marginRight: 4 }}>&#10003;</span>Met
    </span>
  );
  if (sla.paused) return (
    <span style={{ color: C.purple, fontSize: 12, fontFamily: 'monospace', fontStyle: 'italic' }}>Paused</span>
  );
  if (sla.breached) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', color: C.red, fontSize: 12, fontWeight: 700, fontFamily: 'monospace', animation: 'calyxPulse 2s ease-in-out infinite' }}>
      <Pulse color={C.red} />{sla.text}
    </span>
  );
  return <span style={{ color: C.text1, fontSize: 12, fontFamily: 'monospace' }}>{sla.text}</span>;
}

interface TicketDetail extends CalyxTicket {
  events: CalyxTicketEvent[];
  comments: CalyxComment[];
}

// ── New Ticket Form ──

function NewTicketForm({ teams, agents, categories, onCreated, onCancel }: {
  teams: CalyxTeam[];
  agents: CalyxAgent[];
  categories: CalyxCategory[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: '', description: '', team_id: 0, category_id: null as number | null,
    priority: 'P3' as TicketPriority, assigned_agent_id: null as number | null,
    requester_name: '', requester_email: '',
  });
  const [saving, setSaving] = useState(false);

  const teamCategories = categories.filter(c => c.team_id === form.team_id && !c.parent_id);
  const teamAgents = agents.filter(a => a.team_id === form.team_id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.team_id || !form.requester_name || !form.requester_email) return;
    setSaving(true);
    try {
      await fetch('/api/calyx/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  const valid = form.title && form.team_id && form.requester_name && form.requester_email;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <form onSubmit={handleSubmit} style={{
        background: C.bg2, borderRadius: 16, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 520, padding: 28, animation: 'calyxFadeIn 0.2s ease',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 3, height: 24, borderRadius: 2, background: C.teal }} />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text1, margin: 0 }}>New Ticket</h2>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea style={{ ...inputStyle, height: 72, resize: 'none' as const }}
              value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Team *</label>
              <select style={{ ...selectStyle, width: '100%' }}
                value={form.team_id} onChange={e => setForm({ ...form, team_id: Number(e.target.value), category_id: null, assigned_agent_id: null })}>
                <option value={0}>Select team</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Priority *</label>
              <select style={{ ...selectStyle, width: '100%' }}
                value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TicketPriority })}>
                <option value="P1">P1 - Critical</option>
                <option value="P2">P2 - High</option>
                <option value="P3">P3 - Medium</option>
                <option value="P4">P4 - Low</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Category</label>
              <select style={{ ...selectStyle, width: '100%' }}
                value={form.category_id ?? ''} onChange={e => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">None</option>
                {teamCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Assign To</label>
              <select style={{ ...selectStyle, width: '100%' }}
                value={form.assigned_agent_id ?? ''} onChange={e => setForm({ ...form, assigned_agent_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Unassigned</option>
                {teamAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Requester Name *</label>
              <input style={inputStyle} value={form.requester_name} onChange={e => setForm({ ...form, requester_name: e.target.value })} />
            </div>
            <div>
              <label style={labelStyle}>Requester Email *</label>
              <input type="email" style={inputStyle} value={form.requester_email} onChange={e => setForm({ ...form, requester_email: e.target.value })} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button type="button" onClick={onCancel}
            style={{ padding: '8px 16px', fontSize: 13, color: C.text3, background: 'none', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !valid}
            style={{
              padding: '8px 20px', fontSize: 13, fontWeight: 700,
              color: C.bg1, background: C.teal, border: 'none', borderRadius: 8,
              cursor: valid && !saving ? 'pointer' : 'default', opacity: valid && !saving ? 1 : 0.5,
            }}>
            {saving ? 'Creating...' : '+ Create Ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Ticket Detail Panel ──

function TicketDetailPanel({ ticketId, agents, onClose, onUpdated }: {
  ticketId: number;
  agents: CalyxAgent[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'comments' | 'events'>('comments');
  const [commentBody, setCommentBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [posting, setPosting] = useState(false);

  const loadTicket = useCallback(async () => {
    const res = await fetch(`/api/calyx/tickets/${ticketId}`);
    if (res.ok) setTicket(await res.json());
  }, [ticketId]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  async function handleStatusChange(status: TicketStatus) {
    await fetch(`/api/calyx/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await loadTicket();
    onUpdated();
  }

  async function handleAssign(agentId: number | null) {
    await fetch(`/api/calyx/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_agent_id: agentId }),
    });
    await loadTicket();
    onUpdated();
  }

  async function handlePriorityChange(priority: TicketPriority) {
    await fetch(`/api/calyx/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority }),
    });
    await loadTicket();
    onUpdated();
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setPosting(true);
    await fetch(`/api/calyx/tickets/${ticketId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: commentBody, is_internal: isInternal }),
    });
    setCommentBody('');
    setPosting(false);
    await loadTicket();
    onUpdated();
  }

  if (!ticket) {
    return (
      <div style={{
        position: 'fixed', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: 640,
        background: C.bg2, borderLeft: `1px solid ${C.border}`, zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.teal,
          borderRadius: '50%', animation: 'calyxSpin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  const frt = formatTimeRemaining(ticket.frt_due_at, !!ticket.sla_paused_at, null, ticket.frt_met_at, true);
  const resolution = formatTimeRemaining(ticket.resolution_due_at, !!ticket.sla_paused_at, ticket.resolved_at, null, false);

  const slaCardColor = (sla: { breached: boolean; paused: boolean; text: string }) => {
    if (sla.breached) return C.red;
    if (sla.paused) return C.purple;
    if (sla.text === 'Met') return C.green;
    return C.teal;
  };

  const eventLabel = (e: CalyxTicketEvent) => {
    switch (e.event_type) {
      case 'status_change': return `Status changed from ${e.from_value} to ${e.to_value}`;
      case 'created': return 'Ticket created';
      case 'priority_change': return `Priority changed from ${e.from_value} to ${e.to_value}`;
      case 'assignment_change': return `Reassigned from ${e.from_value} to ${e.to_value}`;
      case 'comment_added': return `${e.to_value === 'internal' ? 'Internal note' : 'Comment'} added`;
      case 'sla_paused': return `SLA paused (${e.to_value})`;
      case 'sla_resumed': return 'SLA resumed';
      case 'frt_met': return 'First response time met';
      case 'resolved': return 'Ticket resolved';
      case 'reopened': return 'Ticket reopened';
      default: return e.event_type;
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: 640,
      background: C.bg2, borderLeft: `1px solid ${C.border}`, zIndex: 40,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      animation: 'calyxSlideIn 0.25s cubic-bezier(0.16,1,0.3,1)',
      boxShadow: '-16px 0 48px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '20px 24px', borderBottom: `1px solid ${C.border}`,
        background: C.glass,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.text3, fontFamily: 'monospace', fontWeight: 600 }}>{ticket.reference}</span>
            <PriorityBadge priority={ticket.priority} />
            <StatusBadge status={ticket.status as TicketStatus} />
          </div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text1, margin: 0, lineHeight: 1.3 }}>{ticket.title}</h2>
        </div>
        <button onClick={onClose} style={{
          background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8,
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: C.text3, fontSize: 18, cursor: 'pointer', flexShrink: 0,
        }}>&times;</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Meta grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Status</span>
            <select style={{ ...selectStyle, width: '100%', marginTop: 4 }}
              value={ticket.status} onChange={e => handleStatusChange(e.target.value as TicketStatus)}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Priority</span>
            <select style={{ ...selectStyle, width: '100%', marginTop: 4 }}
              value={ticket.priority} onChange={e => handlePriorityChange(e.target.value as TicketPriority)}>
              <option value="P1">P1 - Critical</option>
              <option value="P2">P2 - High</option>
              <option value="P3">P3 - Medium</option>
              <option value="P4">P4 - Low</option>
            </select>
          </div>
          <div>
            <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Assigned To</span>
            <select style={{ ...selectStyle, width: '100%', marginTop: 4 }}
              value={ticket.assigned_agent_id ?? ''} onChange={e => handleAssign(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Team</span>
            <div style={{ marginTop: 4, fontSize: 13, color: C.text1, padding: '6px 0' }}>{ticket.team_name}</div>
          </div>
          <div>
            <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Requester</span>
            <div style={{ marginTop: 4, fontSize: 13, color: C.text1 }}>{ticket.requester_name}</div>
            <div style={{ fontSize: 11, color: C.text3 }}>{ticket.requester_email}</div>
          </div>
          <div>
            <span style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>Category</span>
            <div style={{ marginTop: 4, fontSize: 13, color: C.text1, padding: '6px 0' }}>{ticket.category_name ?? '-'}</div>
          </div>
        </div>

        {/* SLA cards */}
        <div style={{ display: 'flex', gap: 12 }}>
          {[{ label: 'First Response', sla: frt }, { label: 'Resolution', sla: resolution }].map(({ label, sla }) => {
            const col = slaCardColor(sla);
            return (
              <div key={label} style={{
                flex: 1, background: C.glass, border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${col}`, borderRadius: 12, padding: '14px 16px',
                position: 'relative', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', top: 0, right: 0, width: 60, height: 60,
                  background: `radial-gradient(circle at 100% 0%, ${col}15, transparent 70%)`,
                  pointerEvents: 'none',
                }} />
                <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 6 }}>{label}</div>
                <div style={{
                  fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: col,
                  ...(sla.breached ? { animation: 'calyxPulse 2s ease-in-out infinite' } : {}),
                  ...(sla.paused ? { fontStyle: 'italic' } : {}),
                }}>
                  {sla.text === 'Met' ? <><span style={{ marginRight: 6 }}>&#10003;</span>Met</> : sla.text}
                </div>
              </div>
            );
          })}
        </div>

        {/* Description */}
        {ticket.description && (
          <div>
            <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 6 }}>Description</div>
            <div style={{
              fontSize: 13, color: C.text2, whiteSpace: 'pre-wrap', lineHeight: 1.6,
              background: C.glass, borderRadius: 10, padding: '12px 16px', border: `1px solid ${C.border}`,
            }}>{ticket.description}</div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}` }}>
          {(['comments', 'events'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '10px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none',
              color: activeTab === tab ? C.teal : C.text3,
              borderBottom: activeTab === tab ? `2px solid ${C.teal}` : '2px solid transparent',
              transition: 'all 0.2s',
            }}>
              {tab === 'comments' ? `Comments (${ticket.comments.length})` : `Activity (${ticket.events.length})`}
            </button>
          ))}
        </div>

        {activeTab === 'comments' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ticket.comments.map(c => (
              <div key={c.id} style={{
                borderRadius: 10, padding: '12px 16px',
                background: c.is_internal ? `${C.amber}08` : C.glass,
                border: `1px solid ${c.is_internal ? `${C.amber}20` : C.border}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>{c.agent_name ?? 'System'}</span>
                  {c.is_internal && (
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 10, fontWeight: 600,
                      color: C.amber, background: `${C.amber}18`, border: `1px solid ${C.amber}30`,
                    }}>Internal</span>
                  )}
                  <span style={{ fontSize: 10, color: C.text3, marginLeft: 'auto' }}>{formatDate(c.created_at)}</span>
                </div>
                <div style={{ fontSize: 13, color: C.text2, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.body}</div>
              </div>
            ))}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea style={{ ...inputStyle, height: 72, resize: 'none' as const }}
                placeholder="Write a comment..." value={commentBody} onChange={e => setCommentBody(e.target.value)} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.text3, cursor: 'pointer' }}>
                  <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                  Internal note
                </label>
                <button onClick={postComment} disabled={posting || !commentBody.trim()}
                  style={{
                    padding: '6px 14px', fontSize: 12, fontWeight: 700,
                    color: C.bg1, background: C.teal, border: 'none', borderRadius: 8,
                    cursor: commentBody.trim() && !posting ? 'pointer' : 'default',
                    opacity: commentBody.trim() && !posting ? 1 : 0.5,
                  }}>
                  {posting ? 'Posting...' : 'Add Comment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {ticket.events.map((e, i) => (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0',
                borderBottom: i < ticket.events.length - 1 ? `1px solid ${C.border}` : 'none',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 4, flexShrink: 0,
                  background: e.event_type === 'resolved' ? C.green : e.event_type === 'sla_paused' ? C.purple : C.text3,
                  boxShadow: e.event_type === 'resolved' ? `0 0 6px ${C.green}` : 'none',
                }} />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: C.text2 }}>{eventLabel(e)}</span>
                  {e.agent_name && <span style={{ fontSize: 12, color: C.text3 }}> by {e.agent_name}</span>}
                  {e.note && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{e.note}</div>}
                </div>
                <span style={{ fontSize: 10, color: C.text3, flexShrink: 0, whiteSpace: 'nowrap' }}>{formatDate(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Queue View ──

export function CalyxQueueView() {
  const [tickets, setTickets] = useState<CalyxTicket[]>([]);
  const [allTickets, setAllTickets] = useState<CalyxTicket[]>([]);
  const [teams, setTeams] = useState<CalyxTeam[]>([]);
  const [agents, setAgents] = useState<CalyxAgent[]>([]);
  const [categories, setCategories] = useState<CalyxCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTeam, setActiveTeam] = useState<number | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const [, setTick] = useState(0);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (activeTeam) params.set('team_id', String(activeTeam));
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);

    const res = await fetch(`/api/calyx/tickets?${params}`);
    if (res.ok) {
      const data = await res.json();
      setTickets(data);
    }
  }, [activeTeam, statusFilter, priorityFilter]);

  const loadAllTickets = useCallback(async () => {
    const res = await fetch('/api/calyx/tickets');
    if (res.ok) setAllTickets(await res.json());
  }, []);

  const loadMeta = useCallback(async () => {
    const [teamsRes, agentsRes, catsRes] = await Promise.all([
      fetch('/api/calyx/teams'),
      fetch('/api/calyx/agents'),
      fetch('/api/calyx/categories?flat=true'),
    ]);
    if (teamsRes.ok) setTeams(await teamsRes.json());
    if (agentsRes.ok) setAgents(await agentsRes.json());
    if (catsRes.ok) setCategories(await catsRes.json());
  }, []);

  useEffect(() => {
    Promise.all([loadMeta(), loadTickets(), loadAllTickets()]).then(() => setLoading(false));
  }, [loadMeta, loadTickets, loadAllTickets]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Inject keyframe animations
  useEffect(() => {
    const id = 'calyx-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes calyxPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.85); }
      }
      @keyframes calyxFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes calyxSlideIn {
        from { opacity: 0; transform: translateX(40px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes calyxShimmer {
        0% { opacity: 0.3; }
        100% { opacity: 0.6; }
      }
      @keyframes calyxSpin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  // Stats from all tickets (unfiltered)
  const openCount = allTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
  const breachedCount = allTickets.filter(t => {
    const frt = formatTimeRemaining(t.frt_due_at, !!t.sla_paused_at, null, t.frt_met_at, true);
    const res = formatTimeRemaining(t.resolution_due_at, !!t.sla_paused_at, t.resolved_at, null, false);
    return frt.breached || res.breached;
  }).length;
  const waitingCount = allTickets.filter(t => t.status === 'waiting_customer' || t.status === 'waiting_third_party').length;

  const teamTicketCounts = (teamId: number | null) => {
    if (teamId === null) return allTickets.length;
    return allTickets.filter(t => t.team_id === teamId).length;
  };

  const teamTabs = [
    { id: null, label: 'All', slug: 'all' },
    ...teams.map(t => ({ id: t.id, label: t.name, slug: t.slug })),
  ];

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
        <div style={{
          width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.teal,
          borderRadius: '50%', animation: 'calyxSpin 0.8s linear infinite',
        }} />
        <span style={{ fontSize: 13, color: C.text3 }}>Loading Calyx...</span>
      </div>
    );
  }

  return (
    <div style={{ animation: 'calyxFadeIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 3, height: 40, borderRadius: 2, background: C.teal }} />
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text1, margin: 0, letterSpacing: '-0.3px' }}>Calyx</h1>
            <p style={{ fontSize: 11, color: C.text3, margin: '2px 0 0' }}>Internal service desk</p>
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 20 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              color: C.teal, background: `${C.teal}15`, border: `1px solid ${C.teal}25`,
            }}>{openCount} Open</span>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              color: breachedCount > 0 ? C.red : C.text3,
              background: breachedCount > 0 ? `${C.red}15` : `${C.text3}15`,
              border: `1px solid ${breachedCount > 0 ? `${C.red}25` : `${C.text3}20`}`,
              ...(breachedCount > 0 ? { animation: 'calyxPulse 2s ease-in-out infinite' } : {}),
            }}>{breachedCount} Breached</span>
            <span style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              color: C.purple, background: `${C.purple}15`, border: `1px solid ${C.purple}25`,
            }}>{waitingCount} Waiting</span>
          </div>
        </div>
        <button onClick={() => setShowNewForm(true)} style={{
          padding: '9px 20px', fontSize: 13, fontWeight: 700,
          color: C.bg1, background: C.teal, border: 'none', borderRadius: 10,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: `0 4px 12px ${C.teal}30`,
          transition: 'all 0.2s',
        }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Ticket
        </button>
      </div>

      {/* Team tabs + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 16 }}>
        {teamTabs.map(t => {
          const isActive = activeTeam === t.id;
          const count = teamTicketCounts(t.id);
          return (
            <button key={t.slug} onClick={() => setActiveTeam(t.id)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: isActive ? 700 : 500,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              color: isActive ? C.bg1 : C.text3,
              background: isActive ? C.teal : C.glass,
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 6,
              ...(isActive ? { boxShadow: `0 2px 8px ${C.teal}30` } : {}),
            }}>
              {t.label}
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
                background: isActive ? 'rgba(0,0,0,0.2)' : C.border,
                color: isActive ? C.bg1 : C.text3,
              }}>{count}</span>
            </button>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select style={selectStyle}
            value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select style={selectStyle}
            value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as TicketPriority | '')}>
            <option value="">All Priorities</option>
            <option value="P1">P1 - Critical</option>
            <option value="P2">P2 - High</option>
            <option value="P3">P3 - Medium</option>
            <option value="P4">P4 - Low</option>
          </select>
          <span style={{ fontSize: 10, color: C.text3, whiteSpace: 'nowrap' }}>
            Showing {tickets.length} of {allTickets.length}
          </span>
        </div>
      </div>

      {/* Ticket table */}
      <div style={{
        background: C.glass, borderRadius: 14, border: `1px solid ${C.border}`,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Reference', 'Title', 'Requester', 'Priority', 'Status', 'Assigned', 'FRT', 'Resolution'].map(h => (
                <th key={h} style={{
                  textAlign: 'left', padding: '12px 16px', fontSize: 10, fontWeight: 700,
                  color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px',
                  borderBottom: `1px solid ${C.border}`, background: C.glass,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '60px 20px' }}>
                  <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.15 }}>&#9776;</div>
                  <div style={{ fontSize: 13, color: C.text3, fontWeight: 500 }}>No tickets found</div>
                  <div style={{ fontSize: 11, color: C.text3, marginTop: 4, opacity: 0.7 }}>Adjust your filters or create a new ticket</div>
                </td>
              </tr>
            ) : tickets.map(t => {
              const frt = formatTimeRemaining(t.frt_due_at, !!t.sla_paused_at, null, t.frt_met_at, true);
              const resolution = formatTimeRemaining(t.resolution_due_at, !!t.sla_paused_at, t.resolved_at, null, false);
              const isP1 = t.priority === 'P1';
              const isHovered = hoveredRow === t.id;
              return (
                <tr key={t.id}
                  onClick={() => setSelectedTicketId(t.id)}
                  onMouseEnter={() => setHoveredRow(t.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{
                    cursor: 'pointer', transition: 'all 0.15s',
                    background: isHovered ? C.glassHover : 'transparent',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                  <td style={{
                    padding: '12px 16px', fontFamily: 'monospace', fontSize: 11, color: C.text3, fontWeight: 600,
                    borderLeft: `3px solid ${isP1 ? C.red : isHovered ? C.teal : 'transparent'}`,
                    transition: 'border-color 0.15s',
                  }}>{t.reference}</td>
                  <td style={{ padding: '12px 16px', color: C.text1, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                  <td style={{ padding: '12px 16px', color: C.text2, fontSize: 12 }}>{t.requester_name}</td>
                  <td style={{ padding: '12px 16px' }}><PriorityBadge priority={t.priority} /></td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={t.status as TicketStatus} /></td>
                  <td style={{ padding: '12px 16px', color: C.text2, fontSize: 12 }}>{t.assigned_agent_name ?? <span style={{ color: C.text3 }}>-</span>}</td>
                  <td style={{ padding: '12px 16px' }}><SlaCell sla={frt} /></td>
                  <td style={{ padding: '12px 16px' }}><SlaCell sla={resolution} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, padding: '0 4px' }}>
        <span style={{ fontSize: 10, color: C.text3 }}>
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
        </span>
        <span style={{ fontSize: 10, color: C.text3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Pulse color={C.green} />SLA updates every minute
        </span>
      </div>

      {/* Detail panel */}
      {selectedTicketId !== null && (
        <TicketDetailPanel
          ticketId={selectedTicketId}
          agents={agents}
          onClose={() => setSelectedTicketId(null)}
          onUpdated={() => { loadTickets(); loadAllTickets(); }}
        />
      )}

      {/* New ticket form */}
      {showNewForm && (
        <NewTicketForm
          teams={teams}
          agents={agents}
          categories={categories}
          onCreated={() => { setShowNewForm(false); loadTickets(); loadAllTickets(); }}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </div>
  );
}
