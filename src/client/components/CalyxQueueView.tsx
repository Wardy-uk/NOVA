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
  open: 'Open', in_progress: 'In Progress', waiting_customer: 'Waiting Customer',
  waiting_third_party: 'Waiting 3rd Party', resolved: 'Resolved', closed: 'Closed',
};

const STATUS_STYLE: Record<TicketStatus, { color: string; bg: string; border: string; shadow: string }> = {
  open:                { color: C.teal,   bg: `${C.teal}18`,   border: `1px solid ${C.teal}40`,   shadow: `0 0 8px ${C.teal}25` },
  in_progress:         { color: C.amber,  bg: `${C.amber}18`,  border: `1px solid ${C.amber}40`,  shadow: `0 0 8px ${C.amber}25` },
  waiting_customer:    { color: C.purple, bg: `${C.purple}18`, border: `1px solid ${C.purple}40`, shadow: `0 0 8px ${C.purple}20` },
  waiting_third_party: { color: C.purple, bg: `${C.purple}18`, border: `1px solid ${C.purple}40`, shadow: `0 0 8px ${C.purple}20` },
  resolved:            { color: C.green,  bg: `${C.green}18`,  border: `1px solid ${C.green}40`,  shadow: `0 0 8px ${C.green}20` },
  closed:              { color: C.text3,  bg: `${C.text3}15`,  border: `1px solid ${C.text3}20`,  shadow: 'none' },
};

const PRIORITY_STYLE: Record<TicketPriority, { color: string; bg: string; border: string; shadow: string }> = {
  P1: { color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  border: '1px solid rgba(239,68,68,0.4)',  shadow: '0 0 10px rgba(239,68,68,0.3)' },
  P2: { color: '#f97316', bg: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.4)', shadow: '0 0 10px rgba(249,115,22,0.2)' },
  P3: { color: '#eab308', bg: 'rgba(234,179,8,0.15)',  border: '1px solid rgba(234,179,8,0.3)',  shadow: 'none' },
  P4: { color: '#64748b', bg: 'rgba(100,116,139,0.15)', border: '1px solid rgba(100,116,139,0.2)', shadow: 'none' },
};

const PRIORITY_BORDER: Record<TicketPriority, string> = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P4: C.text3 };

const selectStyle: CSSProperties = {
  background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '6px 10px', fontSize: 12, color: C.text1, outline: 'none', cursor: 'pointer', appearance: 'auto' as const,
};
const inputStyle: CSSProperties = {
  width: '100%', background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8,
  padding: '8px 12px', fontSize: 13, color: C.text1, outline: 'none',
};
const labelStyle: CSSProperties = { display: 'block', fontSize: 11, color: C.text3, marginBottom: 4, fontWeight: 600 };

function formatTimeRemaining(dueAt: string | null, isPaused: boolean, resolvedAt: string | null, frtMetAt: string | null, isFrt: boolean): { text: string; breached: boolean; paused: boolean; pct: number } {
  if (isFrt && frtMetAt) return { text: 'Met', breached: false, paused: false, pct: 100 };
  if (!isFrt && resolvedAt) return { text: 'Met', breached: false, paused: false, pct: 100 };
  if (!dueAt) return { text: '-', breached: false, paused: false, pct: 100 };
  if (isPaused) return { text: 'Paused', breached: false, paused: true, pct: 50 };

  const now = Date.now();
  const due = new Date(dueAt.replace(' ', 'T') + 'Z').getTime();
  const diff = due - now;

  if (diff <= 0) {
    const elapsed = Math.abs(diff);
    const mins = Math.floor(elapsed / 60000);
    if (mins < 60) return { text: `-${mins}m`, breached: true, paused: false, pct: 0 };
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return { text: `-${hrs}h ${mins % 60}m`, breached: true, paused: false, pct: 0 };
    return { text: `-${Math.floor(hrs / 24)}d ${hrs % 24}h`, breached: true, paused: false, pct: 0 };
  }

  const mins = Math.floor(diff / 60000);
  const pct = Math.min(100, Math.max(0, (diff / (diff + 60000 * 60)) * 100));
  if (mins < 60) return { text: `${mins}m`, breached: false, paused: false, pct };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { text: `${hrs}h ${mins % 60}m`, breached: false, paused: false, pct };
  return { text: `${Math.floor(hrs / 24)}d ${hrs % 24}h`, breached: false, paused: false, pct };
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Pulse({ color }: { color: string }) {
  return <span style={{
    display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
    backgroundColor: color, boxShadow: `0 0 6px ${color}`,
    animation: 'calyxPulse 2s ease-in-out infinite', marginRight: 5, flexShrink: 0,
  }} />;
}

function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const s = PRIORITY_STYLE[priority];
  return <span style={{
    display: 'inline-block', padding: '3px 10px', borderRadius: 20,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.3px',
    color: s.color, background: s.bg, border: s.border, boxShadow: s.shadow,
  }}>{priority}</span>;
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const s = STATUS_STYLE[status];
  return <span style={{
    display: 'inline-block', padding: '3px 10px', borderRadius: 20,
    fontSize: 10, fontWeight: 600, letterSpacing: '0.2px',
    color: s.color, background: s.bg, border: s.border, boxShadow: s.shadow,
  }}>{STATUS_LABELS[status]}</span>;
}

function SlaBlock({ label, sla }: { label: string; sla: { text: string; breached: boolean; paused: boolean } }) {
  let color = C.text2;
  let icon = '';
  let anim = false;

  if (sla.text === '-') { color = C.text3; }
  else if (sla.text === 'Met') { color = C.green; icon = '\u2713 '; }
  else if (sla.paused) { color = C.purple; icon = '\u23F8 '; }
  else if (sla.breached) { color = C.red; anim = true; }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 56 }}>
      <span style={{ fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 2 }}>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: sla.breached ? 800 : 600, fontFamily: 'monospace', color,
        display: 'inline-flex', alignItems: 'center',
        ...(sla.paused ? { fontStyle: 'italic' } : {}),
      }}>
        {anim && <Pulse color={C.red} />}
        {icon}{sla.text}
      </span>
    </div>
  );
}

interface TicketDetail extends CalyxTicket {
  events: CalyxTicketEvent[];
  comments: CalyxComment[];
}

// ── New Ticket Form ──

function NewTicketForm({ teams, agents, categories, onCreated, onCancel }: {
  teams: CalyxTeam[]; agents: CalyxAgent[]; categories: CalyxCategory[];
  onCreated: () => void; onCancel: () => void;
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
      await fetch('/api/calyx/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      onCreated();
    } finally { setSaving(false); }
  }

  const valid = form.title && form.team_id && form.requester_name && form.requester_email;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, backdropFilter: 'blur(4px)' }}>
      <form onSubmit={handleSubmit} style={{
        background: C.bg2, borderRadius: 16, border: `1px solid ${C.border}`,
        width: '100%', maxWidth: 520, padding: 28, animation: 'calyxFadeIn 0.25s ease',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 4, height: 24, borderRadius: 2, background: C.teal }} />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text1, margin: 0 }}>New Ticket</h2>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><label style={labelStyle}>Title *</label><input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
          <div><label style={labelStyle}>Description</label><textarea style={{ ...inputStyle, height: 72, resize: 'none' as const }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Team *</label><select style={{ ...selectStyle, width: '100%' }} value={form.team_id} onChange={e => setForm({ ...form, team_id: Number(e.target.value), category_id: null, assigned_agent_id: null })}><option value={0}>Select team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label style={labelStyle}>Priority *</label><select style={{ ...selectStyle, width: '100%' }} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TicketPriority })}><option value="P1">P1 - Critical</option><option value="P2">P2 - High</option><option value="P3">P3 - Medium</option><option value="P4">P4 - Low</option></select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Category</label><select style={{ ...selectStyle, width: '100%' }} value={form.category_id ?? ''} onChange={e => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}><option value="">None</option>{teamCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label style={labelStyle}>Assign To</label><select style={{ ...selectStyle, width: '100%' }} value={form.assigned_agent_id ?? ''} onChange={e => setForm({ ...form, assigned_agent_id: e.target.value ? Number(e.target.value) : null })}><option value="">Unassigned</option>{teamAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={labelStyle}>Requester Name *</label><input style={inputStyle} value={form.requester_name} onChange={e => setForm({ ...form, requester_name: e.target.value })} /></div>
            <div><label style={labelStyle}>Requester Email *</label><input type="email" style={inputStyle} value={form.requester_email} onChange={e => setForm({ ...form, requester_email: e.target.value })} /></div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button type="button" onClick={onCancel} style={{ padding: '8px 16px', fontSize: 13, color: C.text3, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
          <button type="submit" disabled={saving || !valid} style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700, color: C.bg1, background: C.teal, border: 'none', borderRadius: 8, cursor: valid && !saving ? 'pointer' : 'default', opacity: valid && !saving ? 1 : 0.5, boxShadow: `0 4px 12px ${C.teal}30` }}>{saving ? 'Creating...' : '+ Create Ticket'}</button>
        </div>
      </form>
    </div>
  );
}

// ── Ticket Detail Panel ──

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z')).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function InitialsAvatar({ name, size = 28, color = C.teal }: { name: string; size?: number; color?: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: `${color}25`, border: `1px solid ${color}40`,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color, flexShrink: 0,
    }}>{initials}</div>
  );
}

function TicketDetailPanel({ ticketId, agents, teams, onClose, onUpdated }: {
  ticketId: number; agents: CalyxAgent[]; teams: CalyxTeam[]; onClose: () => void; onUpdated: () => void;
}) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'comments' | 'events'>('comments');
  const [commentBody, setCommentBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [posting, setPosting] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedSearch, setCannedSearch] = useState('');
  const [slideIn, setSlideIn] = useState(false);

  // Extra data
  const [slos, setSlos] = useState<any[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  const [watchers, setWatchers] = useState<any[]>([]);
  const [kbSuggestions, setKbSuggestions] = useState<any[]>([]);
  const [requesterTickets, setRequesterTickets] = useState<any[]>([]);
  const [requesterInfo, setRequesterInfo] = useState<any>(null);
  const [ticketTags, setTicketTags] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<any[]>([]);
  const [cannedResponses, setCannedResponses] = useState<any[]>([]);

  const commentRef = useRef<HTMLTextAreaElement>(null);

  const loadTicket = useCallback(async () => {
    const res = await fetch(`/api/calyx/tickets/${ticketId}`);
    if (res.ok) {
      const data = await res.json();
      setTicket(data);
      // Parallel extra fetches
      const [sloRes, linkRes, watchRes, tagRes] = await Promise.all([
        fetch(`/api/calyx/tickets/${ticketId}/slos`),
        fetch(`/api/calyx/tickets/${ticketId}/links`),
        fetch(`/api/calyx/tickets/${ticketId}/watchers`),
        fetch(`/api/calyx/tickets/${ticketId}/tags`),
      ]);
      if (sloRes.ok) { const j = await sloRes.json(); setSlos(j.data ?? j); }
      if (linkRes.ok) { const j = await linkRes.json(); setLinks(j.data ?? j); }
      if (watchRes.ok) { const j = await watchRes.json(); setWatchers(j.data ?? j); }
      if (tagRes.ok) { const j = await tagRes.json(); setTicketTags(j.data ?? j); }

      // KB suggestions
      if (data.title) {
        const kbRes = await fetch(`/api/calyx/kb/suggest?q=${encodeURIComponent(data.title.split(' ').slice(0, 4).join(' '))}`);
        if (kbRes.ok) { const j = await kbRes.json(); setKbSuggestions(j.data ?? []); }
      }
      // Requester info
      if (data.requester_id) {
        const reqRes = await fetch(`/api/calyx/requesters/${data.requester_id}`);
        if (reqRes.ok) { const j = await reqRes.json(); setRequesterInfo(j.data ?? j); }
        const rtRes = await fetch(`/api/calyx/requesters/${data.requester_id}/tickets?limit=3`);
        if (rtRes.ok) { const j = await rtRes.json(); setRequesterTickets(j.data ?? j); }
      }
    }
  }, [ticketId]);

  useEffect(() => { loadTicket(); }, [loadTicket]);
  useEffect(() => { requestAnimationFrame(() => setSlideIn(true)); return () => setSlideIn(false); }, []);

  // Load canned responses + all tags once
  useEffect(() => {
    fetch('/api/calyx/canned-responses').then(r => r.ok ? r.json() : { data: [] }).then(j => setCannedResponses(j.data ?? j));
    fetch('/api/calyx/tags').then(r => r.ok ? r.json() : { data: [] }).then(j => setAllTags(j.data ?? j));
  }, []);

  async function handleStatusChange(status: TicketStatus) {
    await fetch(`/api/calyx/tickets/${ticketId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    await loadTicket(); onUpdated();
  }
  async function handleAssign(agentId: number | null) {
    await fetch(`/api/calyx/tickets/${ticketId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assigned_agent_id: agentId }) });
    await loadTicket(); onUpdated();
  }
  async function handlePriorityChange(priority: TicketPriority) {
    await fetch(`/api/calyx/tickets/${ticketId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority }) });
    await loadTicket(); onUpdated();
  }
  async function postComment() {
    if (!commentBody.trim()) return;
    setPosting(true);
    await fetch(`/api/calyx/tickets/${ticketId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: commentBody, is_internal: isInternal }) });
    setCommentBody(''); setPosting(false);
    await loadTicket(); onUpdated();
  }
  async function handleEscalate(teamId: number) {
    await fetch(`/api/calyx/tickets/${ticketId}/escalate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team_id: teamId }) });
    await loadTicket(); onUpdated();
  }
  async function handleDeclareMajor() {
    if (!ticket) return;
    await fetch(`/api/calyx/tickets/${ticketId}/declare-major`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ impact_statement: ticket.title }) });
    await loadTicket(); onUpdated();
  }
  async function handleSendCsat() {
    await fetch(`/api/calyx/tickets/${ticketId}/send-csat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    await loadTicket(); onUpdated();
  }
  async function addWatcher(agentId: number) {
    await fetch(`/api/calyx/tickets/${ticketId}/watchers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: agentId }) });
    await loadTicket();
  }
  async function removeWatcher(agentId: number) {
    await fetch(`/api/calyx/tickets/${ticketId}/watchers/${agentId}`, { method: 'DELETE' });
    await loadTicket();
  }
  async function addTag(tagId: number) {
    await fetch(`/api/calyx/tickets/${ticketId}/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_id: tagId }) });
    await loadTicket();
  }
  async function removeTag(tagId: number) {
    await fetch(`/api/calyx/tickets/${ticketId}/tags/${tagId}`, { method: 'DELETE' });
    await loadTicket();
  }

  if (!ticket) {
    return (
      <>
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 39 }} />
        <div style={{ position: 'fixed', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: 760, background: C.bg0, borderLeft: `1px solid ${C.border}`, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.teal, borderRadius: '50%', animation: 'calyxSpin 0.8s linear infinite' }} />
        </div>
      </>
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

  const topSlos = slos.filter(s => !s.completed_at).sort((a: any, b: any) => {
    const aRemain = new Date(a.target_at).getTime() - Date.now();
    const bRemain = new Date(b.target_at).getTime() - Date.now();
    return aRemain - bRemain;
  }).slice(0, 2);

  const sloCardColor = (s: any) => {
    if (s.breached) return C.red;
    const remain = new Date(s.target_at).getTime() - Date.now();
    if (remain < 0) return C.red;
    const warnAt = s.warning_at ? new Date(s.warning_at).getTime() : 0;
    if (warnAt && Date.now() >= warnAt) return C.amber;
    return C.teal;
  };

  const sloTimeRemaining = (s: any) => {
    if (s.breached) { return `-${Math.abs(s.breach_minutes || 0)}m`; }
    const diff = new Date(s.target_at).getTime() - Date.now();
    if (diff <= 0) { const m = Math.floor(Math.abs(diff) / 60000); return m < 60 ? `-${m}m` : `-${Math.floor(m / 60)}h ${m % 60}m`; }
    const m = Math.floor(diff / 60000);
    return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const eventLabel = (e: CalyxTicketEvent) => {
    const pretty = (v: string | null) => v ? v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
    switch (e.event_type) {
      case 'status_change': return `Status changed from ${pretty(e.from_value)} to ${pretty(e.to_value)}`;
      case 'created': return 'Ticket created';
      case 'priority_change': return `Priority changed from ${e.from_value} to ${e.to_value}`;
      case 'assignment_change': return `Assigned to ${pretty(e.to_value)}${e.from_value ? ` (was ${pretty(e.from_value)})` : ''}`;
      case 'comment_added': return e.to_value === 'internal' ? 'Internal note added' : 'Public comment added';
      case 'sla_paused': return `SLA paused \u2014 ${pretty(e.to_value)}`;
      case 'sla_resumed': return 'SLA resumed';
      case 'frt_met': return 'First response SLA met';
      case 'resolved': return 'Ticket resolved';
      case 'reopened': return 'Ticket reopened';
      case 'escalated': return `Escalated to ${pretty(e.to_value)}`;
      case 'slo_breached': return `SLO breached: ${e.to_value}`;
      case 'major_incident_declared': return 'Declared as major incident';
      case 'merged': return `Merged into ${e.to_value}`;
      default: return e.event_type.replace(/_/g, ' ');
    }
  };

  const EVENT_STYLES: Record<string, { color: string; icon: string }> = {
    created: { color: C.teal, icon: '\u25CF' },
    status_change: { color: '#3b82f6', icon: '\u2192' },
    escalated: { color: C.amber, icon: '\u2191' },
    slo_breached: { color: C.red, icon: '\u2715' },
    major_incident_declared: { color: C.red, icon: '\u26A0' },
    comment_added: { color: C.text3, icon: '\u25CB' },
    assignment_change: { color: C.purple, icon: '\u2299' },
    merged: { color: C.text3, icon: '\u2295' },
    frt_met: { color: C.green, icon: '\u2713' },
    resolved: { color: C.green, icon: '\u2713\u2713' },
    sla_paused: { color: C.purple, icon: '\u23F8' },
    sla_resumed: { color: C.teal, icon: '\u25B6' },
    reopened: { color: C.amber, icon: '\u21BA' },
    priority_change: { color: C.amber, icon: '\u25B2' },
    sla_breached: { color: C.red, icon: '\u2715\u2715' },
  };

  const getEventStyle = (type: string) => {
    if (type === 'comment_added') return EVENT_STYLES.comment_added;
    return EVENT_STYLES[type] || { color: C.text3, icon: '\u25CB' };
  };

  const isResolved = ticket.status === 'resolved' || ticket.status === 'closed';
  const sourcePill = (ticket as any).source || 'manual';
  const sourceColors: Record<string, { color: string; bg: string }> = {
    portal: { color: C.teal, bg: `${C.teal}18` },
    email: { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    api: { color: C.purple, bg: `${C.purple}18` },
    manual: { color: C.text3, bg: `${C.text3}15` },
  };
  const sc = sourceColors[sourcePill] || sourceColors.manual;

  const filteredCanned = cannedResponses.filter((cr: any) =>
    !cannedSearch || cr.title.toLowerCase().includes(cannedSearch.toLowerCase()) || cr.body.toLowerCase().includes(cannedSearch.toLowerCase())
  );

  const untagged = allTags.filter((t: any) => !ticketTags.find((tt: any) => tt.id === t.id));
  const unwatched = agents.filter(a => !watchers.find((w: any) => w.agent_id === a.id));

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 39 }} />
      <div style={{
        position: 'fixed', top: 0, bottom: 0, right: 0, width: '100%', maxWidth: 760,
        background: C.bg0, borderLeft: `1px solid ${C.border}`, zIndex: 40,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transform: slideIn ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 200ms ease',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.5)',
      }}>
        {/* ── HEADER ── */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, background: C.bg1, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: C.teal, fontFamily: 'monospace', fontWeight: 700 }}>{ticket.reference}</span>
              <PriorityBadge priority={ticket.priority} />
              <StatusBadge status={ticket.status as TicketStatus} />
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text3, fontSize: 20, cursor: 'pointer', padding: '4px 8px' }}>&times;</button>
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: C.text1, margin: 0, lineHeight: 1.3 }}>{ticket.title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600, color: sc.color, background: sc.bg, border: `1px solid ${sc.color}40`, textTransform: 'capitalize' }}>{sourcePill}</span>
            <span style={{ fontSize: 11, color: C.text3 }}>{ticket.team_name}</span>
            {ticket.category_name && <><span style={{ fontSize: 11, color: C.text3 }}>&middot;</span><span style={{ fontSize: 11, color: C.text3 }}>{ticket.category_name}</span></>}
            <span style={{ fontSize: 11, color: C.text3 }}>&middot;</span>
            <span style={{ fontSize: 11, color: C.text3 }}>{timeAgo(ticket.created_at)}</span>
            <span style={{ fontSize: 11, color: C.text3 }}>&middot;</span>
            <span style={{ fontSize: 11, color: C.text3 }}>{STATUS_LABELS[ticket.status as TicketStatus]} for {timeAgo(ticket.updated_at).replace(' ago', '')}</span>
          </div>
        </div>

        {/* ── TWO COLUMN BODY ── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* LEFT COLUMN */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>

            {/* SLA + SLO 2x2 grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[{ label: 'First Response', sla: frt }, { label: 'Resolution', sla: resolution }].map(({ label, sla }) => {
                const col = slaCardColor(sla);
                return (
                  <div key={label} style={{ background: C.bg1, borderLeft: `3px solid ${col}`, borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: col, display: 'flex', alignItems: 'center', gap: 4, ...(sla.breached ? { animation: 'calyxPulse 2s ease-in-out infinite' } : {}) }}>
                      {sla.breached && <Pulse color={C.red} />}
                      {sla.text === 'Met' ? '\u2713 Met' : sla.paused ? '\u23F8 Paused' : sla.text}
                    </div>
                  </div>
                );
              })}
              {topSlos.map((s: any) => {
                const col = sloCardColor(s);
                const pct = s.target_at ? Math.max(0, Math.min(100, ((new Date(s.target_at).getTime() - Date.now()) / (new Date(s.target_at).getTime() - new Date(s.started_at).getTime())) * 100)) : 0;
                return (
                  <div key={s.id} style={{ background: C.bg1, borderLeft: `3px solid ${col}`, borderRadius: 8, padding: '12px 16px' }}>
                    <div style={{ fontSize: 9, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.slo_name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: `${C.text3}20`, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100 - pct, 100)}%`, borderRadius: 2, background: col, transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: col, flexShrink: 0 }}>{sloTimeRemaining(s)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick actions */}
            {!isResolved && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {teams.filter(t => t.id !== ticket.team_id).slice(0, 2).map(t => (
                  <button key={t.id} onClick={() => handleEscalate(t.id)} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', color: C.amber, background: `${C.amber}12`, border: `1px solid ${C.amber}30` }}>Escalate to {t.name}</button>
                ))}
                <button onClick={handleDeclareMajor} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', color: C.red, background: `${C.red}12`, border: `1px solid ${C.red}30` }}>Declare Major</button>
                <button onClick={handleSendCsat} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', color: C.teal, background: `${C.teal}12`, border: `1px solid ${C.teal}30` }}>Send CSAT</button>
              </div>
            )}

            {/* Description */}
            {ticket.description && (
              <div style={{ background: C.glass, borderRadius: 8, padding: '12px 16px', border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, color: C.text2, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {ticket.description.length > 200 && !descExpanded ? ticket.description.slice(0, 200) + '...' : ticket.description}
                </div>
                {ticket.description.length > 200 && (
                  <button onClick={() => setDescExpanded(!descExpanded)} style={{ background: 'none', border: 'none', color: C.teal, fontSize: 11, cursor: 'pointer', marginTop: 4, padding: 0 }}>{descExpanded ? 'Show less' : 'Show more'}</button>
                )}
              </div>
            )}

            {/* Linked context strip */}
            {links.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {links.map((l: any) => (
                  <span key={l.id || l.reference} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: C.glass, border: `1px solid ${C.border}`, color: C.text2 }}>
                    {'\u2192'} {l.reference}: {(l.title || '').slice(0, 40)}{(l.title || '').length > 40 ? '...' : ''} <StatusBadge status={l.status as TicketStatus} />
                  </span>
                ))}
              </div>
            )}

            {/* KB suggestions strip */}
            {kbSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {kbSuggestions.slice(0, 3).map((kb: any) => (
                  <button key={kb.id} onClick={() => { setCommentBody(prev => prev + (prev ? '\n\n' : '') + `KB: ${kb.title}`); setActiveTab('comments'); }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: `${C.teal}08`, border: `1px solid ${C.teal}20`, color: C.teal, cursor: 'pointer', fontWeight: 500 }}>
                    {'\uD83D\uDCC4'} {kb.title}
                  </button>
                ))}
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}` }}>
              {(['comments', 'events'] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: 'none', border: 'none',
                  color: activeTab === tab ? C.teal : C.text3,
                  borderBottom: activeTab === tab ? `2px solid ${C.teal}` : '2px solid transparent',
                }}>{tab === 'comments' ? `Comments (${ticket.comments.length})` : `Activity (${ticket.events.length})`}</button>
              ))}
            </div>

            {/* Comments */}
            {activeTab === 'comments' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ticket.comments.map(c => {
                  const isAgent = !!c.agent_id;
                  const isRequester = !c.agent_id && !c.is_internal;
                  const borderCol = c.is_internal ? C.amber : isAgent ? C.teal : C.text3;
                  return (
                    <div key={c.id} style={{
                      display: 'flex', gap: 10,
                      ...(isRequester ? { flexDirection: 'row-reverse' } : {}),
                    }}>
                      <InitialsAvatar name={c.agent_name || ticket.requester_name || 'User'} size={26} color={isAgent ? C.teal : C.text3} />
                      <div style={{
                        flex: 1, maxWidth: '85%', borderRadius: 8, padding: '10px 14px',
                        borderLeft: isRequester ? 'none' : `3px solid ${borderCol}`,
                        borderRight: isRequester ? `3px solid ${C.bg3}` : 'none',
                        background: c.is_internal ? `rgba(217,119,6,0.08)` : isAgent ? C.glass : C.bg3,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: isAgent ? C.teal : C.text2 }}>{c.agent_name ?? ticket.requester_name ?? 'Requester'}</span>
                          {c.is_internal && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, fontWeight: 600, color: C.amber, background: `${C.amber}18`, border: `1px solid ${C.amber}30` }}>Internal</span>}
                          <span style={{ fontSize: 9, color: C.text3, marginLeft: 'auto' }}>{timeAgo(c.created_at)}</span>
                        </div>
                        <div style={{ fontSize: 13, color: C.text2, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{c.body}</div>
                      </div>
                    </div>
                  );
                })}

                {/* Reply box */}
                <div style={{ position: 'relative', marginTop: 4 }}>
                  <textarea ref={commentRef} style={{ ...inputStyle, height: 72, resize: 'none' as const, borderColor: C.border, paddingRight: 40 }} placeholder="Write a reply..." value={commentBody} onChange={e => setCommentBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); }} />
                  <button onClick={() => setShowCanned(!showCanned)} title="Canned responses" style={{ position: 'absolute', right: 10, top: 10, background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 16 }}>{'\uD83D\uDCCB'}</button>
                  {showCanned && (
                    <div style={{ position: 'absolute', bottom: '100%', right: 0, width: 300, maxHeight: 250, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 10, marginBottom: 4 }}>
                      <input style={{ ...inputStyle, borderRadius: 0, border: 'none', borderBottom: `1px solid ${C.border}` }} placeholder="Search canned..." value={cannedSearch} onChange={e => setCannedSearch(e.target.value)} autoFocus />
                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {filteredCanned.map((cr: any) => (
                          <button key={cr.id} onClick={() => { setCommentBody(prev => prev + (prev ? '\n' : '') + cr.body); setShowCanned(false); setCannedSearch(''); fetch(`/api/calyx/canned-responses/${cr.id}/use`, { method: 'POST' }); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', color: C.text1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{cr.title}</div>
                            <div style={{ fontSize: 10, color: C.text3, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cr.body.slice(0, 80)}</div>
                          </button>
                        ))}
                        {filteredCanned.length === 0 && <div style={{ padding: 12, fontSize: 11, color: C.text3, textAlign: 'center' }}>No canned responses found</div>}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <button onClick={() => setIsInternal(!isInternal)} style={{
                    padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
                    color: isInternal ? C.amber : C.text3,
                    background: isInternal ? `${C.amber}15` : 'transparent',
                    border: `1px solid ${isInternal ? `${C.amber}40` : C.border}`,
                  }}>{isInternal ? '\uD83D\uDD12 Internal' : '\uD83C\uDF10 Public'}</button>
                  <button onClick={postComment} disabled={posting || !commentBody.trim()} style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: 700, color: '#fff', background: C.teal, border: 'none', borderRadius: 8,
                    cursor: commentBody.trim() && !posting ? 'pointer' : 'default', opacity: commentBody.trim() && !posting ? 1 : 0.5,
                  }}>{posting ? 'Posting...' : 'Post'}</button>
                </div>
              </div>
            )}

            {/* Events — timeline */}
            {activeTab === 'events' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingLeft: 8 }}>
                {ticket.events.map((e, i) => {
                  const es = getEventStyle(e.event_type);
                  const isInternalComment = e.event_type === 'comment_added' && e.to_value === 'internal';
                  const borderCol = isInternalComment ? C.amber : es.color;
                  const icon = isInternalComment ? '\u25D0' : es.icon;
                  return (
                    <div key={e.id} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: i < ticket.events.length - 1 ? 14 : 0 }}>
                      {i < ticket.events.length - 1 && <div style={{ position: 'absolute', left: 7, top: 16, bottom: 0, width: 1, background: C.border }} />}
                      <div style={{
                        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, color: borderCol, background: `${borderCol}18`, border: `1px solid ${borderCol}30`,
                      }}>{icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 12, color: C.text2 }}>{eventLabel(e)}</span>
                        {e.agent_name && <span style={{ fontSize: 11, color: C.text3 }}> \u2014 {e.agent_name}</span>}
                        {e.note && <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>{e.note}</div>}
                      </div>
                      <span style={{ fontSize: 10, color: C.text3, flexShrink: 0, whiteSpace: 'nowrap' }}>{timeAgo(e.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* RIGHT SIDEBAR */}
          <div style={{ width: 240, flexShrink: 0, borderLeft: `1px solid ${C.border}`, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, background: C.bg1 }}>

            {/* Requester card */}
            <div style={{ paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <InitialsAvatar name={ticket.requester_name} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.requester_name}</div>
                  <div style={{ fontSize: 10, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ticket.requester_email}</div>
                </div>
              </div>
              {requesterInfo?.organisation_name && (
                <div style={{ fontSize: 11, color: C.text2, marginBottom: 4 }}>{requesterInfo.organisation_name}</div>
              )}
              {requesterInfo?.avg_csat != null && (
                <div style={{ fontSize: 10, color: C.text3 }}>Avg {requesterInfo.avg_csat.toFixed(1)} {'\u2605'} across {requesterInfo.recent_tickets?.length ?? 0} tickets</div>
              )}
              {/* Recent tickets */}
              {requesterTickets.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {requesterTickets.filter((rt: any) => rt.id !== ticketId).slice(0, 3).map((rt: any) => (
                    <div key={rt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                      <span style={{ fontSize: 10, fontFamily: 'monospace', color: C.teal, fontWeight: 600 }}>{rt.reference}</span>
                      <span style={{ fontSize: 10, color: C.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{rt.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Metadata grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 4px', paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
              <div><div style={{ fontSize: 9, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Priority</div>
                <select style={{ ...selectStyle, width: '100%', padding: '3px 6px', fontSize: 11 }} value={ticket.priority} onChange={e => handlePriorityChange(e.target.value as TicketPriority)}>
                  <option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option><option value="P4">P4</option>
                </select>
              </div>
              <div><div style={{ fontSize: 9, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Status</div>
                <select style={{ ...selectStyle, width: '100%', padding: '3px 6px', fontSize: 11 }} value={ticket.status} onChange={e => handleStatusChange(e.target.value as TicketStatus)}>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 9, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Assignee</div>
                <select style={{ ...selectStyle, width: '100%', padding: '3px 6px', fontSize: 11 }} value={ticket.assigned_agent_id ?? ''} onChange={e => handleAssign(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Unassigned</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {[
                ['Team', ticket.team_name],
                ['Category', ticket.category_name ?? '-'],
                ['Source', sourcePill],
                ['Created', formatDate(ticket.created_at)],
                ['Age', timeAgo(ticket.created_at).replace(' ago', '')],
                ['Updated', formatDate(ticket.updated_at)],
              ].map(([label, value]) => (
                <div key={label as string}><div style={{ fontSize: 9, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{label}</div><div style={{ fontSize: 11, color: C.text2 }}>{value}</div></div>
              ))}
            </div>

            {/* Watchers */}
            <div style={{ paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Watchers</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {watchers.map((w: any) => (
                  <div key={w.agent_id} style={{ position: 'relative', display: 'inline-flex' }} title={w.agent_name}>
                    <InitialsAvatar name={w.agent_name} size={24} />
                    <button onClick={() => removeWatcher(w.agent_id)} style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: C.bg3, border: `1px solid ${C.border}`, color: C.text3, fontSize: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1 }}>&times;</button>
                  </div>
                ))}
                {unwatched.length > 0 && (
                  <select style={{ ...selectStyle, width: 'auto', padding: '2px 6px', fontSize: 10 }} value="" onChange={e => { if (e.target.value) addWatcher(Number(e.target.value)); }}>
                    <option value="">+ Add</option>
                    {unwatched.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* Tags */}
            <div style={{ paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>Tags</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                {ticketTags.map((t: any) => (
                  <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${t.colour || C.teal}20`, color: t.colour || C.teal, border: `1px solid ${t.colour || C.teal}30` }}>
                    {t.name}
                    <button onClick={() => removeTag(t.id)} style={{ background: 'none', border: 'none', color: 'inherit', fontSize: 10, cursor: 'pointer', padding: 0, lineHeight: 1 }}>&times;</button>
                  </span>
                ))}
                {untagged.length > 0 && (
                  <select style={{ ...selectStyle, width: 'auto', padding: '2px 6px', fontSize: 10 }} value="" onChange={e => { if (e.target.value) addTag(Number(e.target.value)); }}>
                    <option value="">+</option>
                    {untagged.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* SLO detail (collapsible) */}
            {slos.length > 0 && (
              <div style={{ paddingBottom: 16, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.text3, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6 }}>SLO Tracking</div>
                {slos.map((s: any) => {
                  const col = s.completed_at ? C.green : sloCardColor(s);
                  return (
                    <div key={s.id} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: 10, color: C.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.slo_name}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: col, flexShrink: 0, marginLeft: 4 }}>
                          {s.completed_at ? '\u2713' : sloTimeRemaining(s)}
                        </span>
                      </div>
                      <div style={{ height: 3, borderRadius: 2, background: `${C.text3}20` }}>
                        <div style={{ height: '100%', borderRadius: 2, background: col, width: s.completed_at ? '100%' : `${Math.min(100, Math.max(0, ((Date.now() - new Date(s.started_at).getTime()) / (new Date(s.target_at).getTime() - new Date(s.started_at).getTime())) * 100))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Supplier / third party */}
            {(ticket.status === 'waiting_third_party' || (ticket as any).supplier_id) && (
              <div style={{ padding: '8px 12px', borderRadius: 6, background: `${C.amber}12`, border: `1px solid ${C.amber}30` }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.amber }}>Waiting on third party</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Ticket Card ──

function TicketCard({ ticket, index, onClick }: { ticket: CalyxTicket; index: number; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const isP1 = ticket.priority === 'P1';
  const borderCol = PRIORITY_BORDER[ticket.priority];
  const frt = formatTimeRemaining(ticket.frt_due_at, !!ticket.sla_paused_at, null, ticket.frt_met_at, true);
  const resolution = formatTimeRemaining(ticket.resolution_due_at, !!ticket.sla_paused_at, ticket.resolved_at, null, false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? C.glassHover : C.glass,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${borderCol}`,
        borderRadius: 10,
        padding: '14px 20px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered
          ? `0 4px 20px rgba(0,0,0,0.3)${isP1 ? ', -2px 0 12px rgba(239,68,68,0.3)' : ''}`
          : isP1 ? '-2px 0 12px rgba(239,68,68,0.15)' : 'none',
        animation: `calyxFadeIn 0.4s cubic-bezier(0.16,1,0.3,1) ${index * 40}ms both`,
      }}
    >
      {/* Row 1: reference + title */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.text3, fontWeight: 700, flexShrink: 0 }}>{ticket.reference}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{ticket.title}</span>
      </div>

      {/* Row 2: metadata */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        {/* Left cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.text2 }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.5 }}><circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            {ticket.requester_name}
          </span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: C.glass, border: `1px solid ${C.border}`, color: C.text3, fontWeight: 500 }}>{ticket.team_name}</span>
          {ticket.category_name && <span style={{ fontSize: 10, color: C.text3 }}>{ticket.category_name}</span>}
        </div>

        {/* Right cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status as TicketStatus} />
          <span style={{ fontSize: 11, color: C.text2, minWidth: 70, textAlign: 'right' }}>{ticket.assigned_agent_name ?? <span style={{ color: C.text3 }}>Unassigned</span>}</span>
          <SlaBlock label="FRT" sla={frt} />
          <SlaBlock label="RES" sla={resolution} />
        </div>
      </div>
    </div>
  );
}

// ── Empty State ──

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0' }}>
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 16, opacity: 0.15 }}>
        <rect x="6" y="10" width="36" height="28" rx="4" stroke={C.text1} strokeWidth="2" />
        <path d="M6 18h36" stroke={C.text1} strokeWidth="2" />
        <path d="M14 26h10M14 32h6" stroke={C.text1} strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div style={{ fontSize: 16, fontWeight: 500, color: C.text1, marginBottom: 4 }}>No tickets here</div>
      <div style={{ fontSize: 13, color: C.text3 }}>Try adjusting your filters</div>
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
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [, setTick] = useState(0);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (activeTeam) params.set('team_id', String(activeTeam));
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    const res = await fetch(`/api/calyx/tickets?${params}`);
    if (res.ok) setTickets(await res.json());
  }, [activeTeam, statusFilter, priorityFilter]);

  const loadAllTickets = useCallback(async () => {
    const res = await fetch('/api/calyx/tickets');
    if (res.ok) setAllTickets(await res.json());
  }, []);

  const loadMeta = useCallback(async () => {
    const [teamsRes, agentsRes, catsRes] = await Promise.all([
      fetch('/api/calyx/teams'), fetch('/api/calyx/agents'), fetch('/api/calyx/categories?flat=true'),
    ]);
    if (teamsRes.ok) setTeams(await teamsRes.json());
    if (agentsRes.ok) setAgents(await agentsRes.json());
    if (catsRes.ok) setCategories(await catsRes.json());
  }, []);

  useEffect(() => { Promise.all([loadMeta(), loadTickets(), loadAllTickets()]).then(() => setLoading(false)); }, [loadMeta, loadTickets, loadAllTickets]);
  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Inject keyframes
  useEffect(() => {
    const id = 'calyx-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes calyxPulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      @keyframes calyxFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
      @keyframes calyxSlideIn { from { transform:translateX(100%); } to { transform:translateX(0); } }
      @keyframes calyxSpin { to { transform:rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }, []);

  const openCount = allTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;
  const breachedCount = allTickets.filter(t => {
    const f = formatTimeRemaining(t.frt_due_at, !!t.sla_paused_at, null, t.frt_met_at, true);
    const r = formatTimeRemaining(t.resolution_due_at, !!t.sla_paused_at, t.resolved_at, null, false);
    return f.breached || r.breached;
  }).length;
  const waitingCount = allTickets.filter(t => t.status === 'waiting_customer' || t.status === 'waiting_third_party').length;

  const teamCount = (id: number | null) => id === null ? allTickets.length : allTickets.filter(t => t.team_id === id).length;

  const teamTabs = [{ id: null, label: 'All', slug: 'all' }, ...teams.map(t => ({ id: t.id, label: t.name, slug: t.slug }))];

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.teal, borderRadius: '50%', animation: 'calyxSpin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: C.text3 }}>Loading Calyx...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Header with gradient */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28,
        padding: '20px 24px', borderRadius: 14,
        background: `linear-gradient(135deg, ${C.teal}09 0%, transparent 60%)`,
        border: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 4, height: 48, borderRadius: 2, background: `linear-gradient(180deg, ${C.teal}, ${C.teal}60)` }} />
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.text1, margin: 0, letterSpacing: '-0.5px' }}>Calyx</h1>
            <p style={{ fontSize: 11, color: C.text3, margin: '2px 0 0' }}>Internal service desk</p>
          </div>
          <div style={{ display: 'flex', gap: 8, marginLeft: 24 }}>
            <span style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              color: C.teal, background: `${C.teal}12`, border: `1px solid ${C.teal}25`,
            }}><strong>{openCount}</strong> Open</span>
            <span style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              color: breachedCount > 0 ? C.red : C.text3,
              background: breachedCount > 0 ? `${C.red}12` : `${C.text3}12`,
              border: `1px solid ${breachedCount > 0 ? `${C.red}30` : `${C.text3}20`}`,
              ...(breachedCount > 0 ? { animation: 'calyxPulse 2s ease-in-out infinite' } : {}),
            }}><strong>{breachedCount}</strong> Breached</span>
            <span style={{
              padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              color: C.purple, background: `${C.purple}12`, border: `1px solid ${C.purple}25`,
            }}><strong>{waitingCount}</strong> Waiting</span>
          </div>
        </div>
        <button onClick={() => setShowNewForm(true)} style={{
          padding: '10px 22px', fontSize: 13, fontWeight: 700,
          color: C.bg1, background: `linear-gradient(135deg, ${C.teal}, #4db0b9)`,
          border: 'none', borderRadius: 10, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: `0 4px 16px ${C.teal}35`,
          transition: 'all 0.2s',
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> New Ticket
        </button>
      </div>

      {/* Team tabs + filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 20 }}>
        {teamTabs.map(t => {
          const isActive = activeTeam === t.id;
          const count = teamCount(t.id);
          return (
            <button key={t.slug} onClick={() => setActiveTeam(t.id)} style={{
              padding: '8px 14px', fontSize: 12, fontWeight: isActive ? 700 : 500,
              borderRadius: 8, border: 'none', cursor: 'pointer',
              color: isActive ? C.bg1 : C.text3,
              background: isActive ? C.teal : 'transparent',
              borderBottom: isActive ? 'none' : '2px solid transparent',
              transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6,
              ...(isActive ? { boxShadow: `0 2px 8px ${C.teal}30` } : {}),
            }}>
              {t.label}
              <span style={{
                fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: 'center',
                padding: '1px 6px', borderRadius: 10,
                background: isActive ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.08)',
                color: isActive ? C.bg1 : C.text3,
              }}>{count}</span>
            </button>
          );
        })}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select style={selectStyle} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as TicketPriority | '')}>
            <option value="">All Priorities</option>
            <option value="P1">P1 - Critical</option>
            <option value="P2">P2 - High</option>
            <option value="P3">P3 - Medium</option>
            <option value="P4">P4 - Low</option>
          </select>
          <span style={{ fontSize: 10, color: C.text3, whiteSpace: 'nowrap' }}>Showing {tickets.length} of {allTickets.length}</span>
        </div>
      </div>

      {/* Ticket cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tickets.length === 0 ? <EmptyState /> : tickets.map((t, i) => (
          <TicketCard key={t.id} ticket={t} index={i} onClick={() => setSelectedTicketId(t.id)} />
        ))}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, padding: '0 4px' }}>
        <span style={{ fontSize: 10, color: C.text3 }}>{tickets.length} ticket{tickets.length !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: 10, color: C.text3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Pulse color={C.green} />SLA updates every minute
        </span>
      </div>

      {selectedTicketId !== null && (
        <TicketDetailPanel ticketId={selectedTicketId} agents={agents} teams={teams} onClose={() => setSelectedTicketId(null)} onUpdated={() => { loadTickets(); loadAllTickets(); }} />
      )}

      {showNewForm && (
        <NewTicketForm teams={teams} agents={agents} categories={categories}
          onCreated={() => { setShowNewForm(false); loadTickets(); loadAllTickets(); }}
          onCancel={() => setShowNewForm(false)} />
      )}
    </div>
  );
}
