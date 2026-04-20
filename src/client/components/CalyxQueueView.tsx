import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  CalyxTicket, CalyxTeam, CalyxAgent, CalyxCategory,
  CalyxTicketEvent, CalyxComment,
  TicketStatus, TicketPriority,
} from '../../shared/calyx-types.js';

const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_customer: 'Waiting Customer',
  waiting_third_party: 'Waiting 3rd Party',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_COLORS: Record<TicketStatus, string> = {
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  waiting_customer: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  waiting_third_party: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  resolved: 'bg-green-500/20 text-green-400 border-green-500/30',
  closed: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

const PRIORITY_COLORS: Record<TicketPriority, string> = {
  P1: 'bg-red-500/20 text-red-400 border-red-500/30',
  P2: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  P3: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  P4: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

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

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-[#2f353d] rounded-lg border border-neutral-700 w-full max-w-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-neutral-100">New Ticket</h2>

        <div>
          <label className="block text-xs text-neutral-400 mb-1">Title *</label>
          <input className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
            value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
        </div>

        <div>
          <label className="block text-xs text-neutral-400 mb-1">Description</label>
          <textarea className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca] h-20 resize-none"
            value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Team *</label>
            <select className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
              value={form.team_id} onChange={e => setForm({ ...form, team_id: Number(e.target.value), category_id: null, assigned_agent_id: null })}>
              <option value={0}>Select team</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Priority *</label>
            <select className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
              value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as TicketPriority })}>
              <option value="P1">P1 - Critical</option>
              <option value="P2">P2 - High</option>
              <option value="P3">P3 - Medium</option>
              <option value="P4">P4 - Low</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Category</label>
            <select className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
              value={form.category_id ?? ''} onChange={e => setForm({ ...form, category_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">None</option>
              {teamCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Assign To</label>
            <select className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
              value={form.assigned_agent_id ?? ''} onChange={e => setForm({ ...form, assigned_agent_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Unassigned</option>
              {teamAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Requester Name *</label>
            <input className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
              value={form.requester_name} onChange={e => setForm({ ...form, requester_name: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Requester Email *</label>
            <input type="email" className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca]"
              value={form.requester_email} onChange={e => setForm({ ...form, requester_email: e.target.value })} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200">Cancel</button>
          <button type="submit" disabled={saving || !form.title || !form.team_id || !form.requester_name || !form.requester_email}
            className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4db0b9] disabled:opacity-50">
            {saving ? 'Creating...' : 'Create Ticket'}
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
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-[#2f353d] border-l border-neutral-700 z-40 flex items-center justify-center">
        <div className="text-neutral-400 text-sm">Loading...</div>
      </div>
    );
  }

  const frt = formatTimeRemaining(ticket.frt_due_at, !!ticket.sla_paused_at, null, ticket.frt_met_at, true);
  const resolution = formatTimeRemaining(ticket.resolution_due_at, !!ticket.sla_paused_at, ticket.resolved_at, null, false);

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-[#2f353d] border-l border-neutral-700 z-40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700">
        <div>
          <span className="text-xs text-neutral-400 font-mono">{ticket.reference}</span>
          <h2 className="text-base font-semibold text-neutral-100 mt-0.5">{ticket.title}</h2>
        </div>
        <button onClick={onClose} className="text-neutral-400 hover:text-neutral-200 text-xl leading-none">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-xs text-neutral-500">Status</span>
            <select className="block w-full mt-1 bg-[#272C33] border border-neutral-600 rounded px-2 py-1.5 text-sm text-neutral-100"
              value={ticket.status} onChange={e => handleStatusChange(e.target.value as TicketStatus)}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <span className="text-xs text-neutral-500">Priority</span>
            <select className="block w-full mt-1 bg-[#272C33] border border-neutral-600 rounded px-2 py-1.5 text-sm text-neutral-100"
              value={ticket.priority} onChange={e => handlePriorityChange(e.target.value as TicketPriority)}>
              <option value="P1">P1 - Critical</option>
              <option value="P2">P2 - High</option>
              <option value="P3">P3 - Medium</option>
              <option value="P4">P4 - Low</option>
            </select>
          </div>
          <div>
            <span className="text-xs text-neutral-500">Assigned To</span>
            <select className="block w-full mt-1 bg-[#272C33] border border-neutral-600 rounded px-2 py-1.5 text-sm text-neutral-100"
              value={ticket.assigned_agent_id ?? ''} onChange={e => handleAssign(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Unassigned</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <span className="text-xs text-neutral-500">Team</span>
            <div className="mt-1 text-neutral-200">{ticket.team_name}</div>
          </div>
          <div>
            <span className="text-xs text-neutral-500">Requester</span>
            <div className="mt-1 text-neutral-200">{ticket.requester_name}</div>
            <div className="text-xs text-neutral-400">{ticket.requester_email}</div>
          </div>
          <div>
            <span className="text-xs text-neutral-500">Category</span>
            <div className="mt-1 text-neutral-200">{ticket.category_name ?? '-'}</div>
          </div>
        </div>

        {/* SLA */}
        <div className="flex gap-4">
          <div className="flex-1 bg-[#272C33] rounded-lg p-3 border border-neutral-700">
            <div className="text-xs text-neutral-500 mb-1">First Response</div>
            <div className={`text-lg font-mono font-semibold ${frt.breached ? 'text-red-400' : frt.paused ? 'text-purple-400' : frt.text === 'Met' ? 'text-green-400' : 'text-neutral-100'}`}>
              {frt.text}
            </div>
          </div>
          <div className="flex-1 bg-[#272C33] rounded-lg p-3 border border-neutral-700">
            <div className="text-xs text-neutral-500 mb-1">Resolution</div>
            <div className={`text-lg font-mono font-semibold ${resolution.breached ? 'text-red-400' : resolution.paused ? 'text-purple-400' : resolution.text === 'Met' ? 'text-green-400' : 'text-neutral-100'}`}>
              {resolution.text}
            </div>
          </div>
        </div>

        {/* Description */}
        {ticket.description && (
          <div>
            <div className="text-xs text-neutral-500 mb-1">Description</div>
            <div className="text-sm text-neutral-300 whitespace-pre-wrap bg-[#272C33] rounded-lg p-3 border border-neutral-700">
              {ticket.description}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-neutral-700">
          <button className={`px-3 py-2 text-xs font-medium ${activeTab === 'comments' ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setActiveTab('comments')}>
            Comments ({ticket.comments.length})
          </button>
          <button className={`px-3 py-2 text-xs font-medium ${activeTab === 'events' ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-400 hover:text-neutral-200'}`}
            onClick={() => setActiveTab('events')}>
            Activity ({ticket.events.length})
          </button>
        </div>

        {activeTab === 'comments' && (
          <div className="space-y-3">
            {ticket.comments.map(c => (
              <div key={c.id} className={`rounded-lg p-3 border ${c.is_internal ? 'bg-amber-900/10 border-amber-700/30' : 'bg-[#272C33] border-neutral-700'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-neutral-200">{c.agent_name ?? 'System'}</span>
                  {c.is_internal && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">Internal</span>}
                  <span className="text-[10px] text-neutral-500 ml-auto">{formatDate(c.created_at)}</span>
                </div>
                <div className="text-sm text-neutral-300 whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}

            {/* Comment input */}
            <div className="space-y-2">
              <textarea className="w-full bg-[#272C33] border border-neutral-600 rounded px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:border-[#5ec1ca] h-20 resize-none"
                placeholder="Write a comment..." value={commentBody} onChange={e => setCommentBody(e.target.value)} />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-neutral-400 cursor-pointer">
                  <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)}
                    className="rounded border-neutral-600" />
                  Internal note
                </label>
                <button onClick={postComment} disabled={posting || !commentBody.trim()}
                  className="px-3 py-1.5 text-xs bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4db0b9] disabled:opacity-50">
                  {posting ? 'Posting...' : 'Add Comment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="space-y-2">
            {ticket.events.map(e => (
              <div key={e.id} className="flex items-start gap-3 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 mt-1.5 flex-shrink-0" />
                <div className="flex-1">
                  <span className="text-neutral-300">
                    {e.event_type === 'status_change' && `Status changed from ${e.from_value} to ${e.to_value}`}
                    {e.event_type === 'created' && 'Ticket created'}
                    {e.event_type === 'priority_change' && `Priority changed from ${e.from_value} to ${e.to_value}`}
                    {e.event_type === 'assignment_change' && `Reassigned from ${e.from_value} to ${e.to_value}`}
                    {e.event_type === 'comment_added' && `${e.to_value === 'internal' ? 'Internal note' : 'Comment'} added`}
                    {e.event_type === 'sla_paused' && `SLA paused (${e.to_value})`}
                    {e.event_type === 'sla_resumed' && 'SLA resumed'}
                    {e.event_type === 'frt_met' && 'First response time met'}
                    {e.event_type === 'resolved' && 'Ticket resolved'}
                    {e.event_type === 'reopened' && 'Ticket reopened'}
                  </span>
                  {e.agent_name && <span className="text-neutral-500"> by {e.agent_name}</span>}
                  {e.note && <div className="text-neutral-500 mt-0.5">{e.note}</div>}
                </div>
                <span className="text-neutral-600 flex-shrink-0">{formatDate(e.created_at)}</span>
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
  const [teams, setTeams] = useState<CalyxTeam[]>([]);
  const [agents, setAgents] = useState<CalyxAgent[]>([]);
  const [categories, setCategories] = useState<CalyxCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTeam, setActiveTeam] = useState<number | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const [, setTick] = useState(0);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (activeTeam) params.set('team_id', String(activeTeam));
    if (statusFilter) params.set('status', statusFilter);
    if (priorityFilter) params.set('priority', priorityFilter);

    const res = await fetch(`/api/calyx/tickets?${params}`);
    if (res.ok) setTickets(await res.json());
  }, [activeTeam, statusFilter, priorityFilter]);

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
    Promise.all([loadMeta(), loadTickets()]).then(() => setLoading(false));
  }, [loadMeta, loadTickets]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Live SLA countdown - re-render every 60s
  useEffect(() => {
    timerRef.current = setInterval(() => setTick(t => t + 1), 60000);
    return () => clearInterval(timerRef.current);
  }, []);

  const teamTabs = [
    { id: null, label: 'All', slug: 'all' },
    ...teams.map(t => ({ id: t.id, label: t.name, slug: t.slug })),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-neutral-400 text-sm">Loading Calyx...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-100">Calyx</h1>
          <p className="text-xs text-neutral-500 mt-0.5">Internal service desk</p>
        </div>
        <button onClick={() => setShowNewForm(true)}
          className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4db0b9]">
          New Ticket
        </button>
      </div>

      {/* Team tabs */}
      <div className="flex items-center gap-1">
        {teamTabs.map(t => (
          <button key={t.slug} onClick={() => setActiveTeam(t.id)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              activeTeam === t.id
                ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
            }`}>
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select className="bg-[#2f353d] border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
            value={statusFilter} onChange={e => setStatusFilter(e.target.value as TicketStatus | '')}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="bg-[#2f353d] border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-300"
            value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as TicketPriority | '')}>
            <option value="">All Priorities</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
            <option value="P4">P4</option>
          </select>
        </div>
      </div>

      {/* Ticket table */}
      <div className="bg-[#2f353d] rounded-lg border border-neutral-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-neutral-500 border-b border-neutral-700">
              <th className="text-left px-4 py-3 font-medium">Reference</th>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Requester</th>
              <th className="text-left px-4 py-3 font-medium">Priority</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Assigned</th>
              <th className="text-left px-4 py-3 font-medium">FRT</th>
              <th className="text-left px-4 py-3 font-medium">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-neutral-500 text-sm">No tickets found</td>
              </tr>
            ) : tickets.map(t => {
              const frt = formatTimeRemaining(t.frt_due_at, !!t.sla_paused_at, null, t.frt_met_at, true);
              const resolution = formatTimeRemaining(t.resolution_due_at, !!t.sla_paused_at, t.resolved_at, null, false);
              return (
                <tr key={t.id} onClick={() => setSelectedTicketId(t.id)}
                  className="border-b border-neutral-700/50 hover:bg-[#363d47] cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-400">{t.reference}</td>
                  <td className="px-4 py-3 text-neutral-200 max-w-xs truncate">{t.title}</td>
                  <td className="px-4 py-3 text-neutral-300 text-xs">{t.requester_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-[10px] font-semibold rounded border ${PRIORITY_COLORS[t.priority]}`}>
                      {t.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 text-[10px] rounded border ${STATUS_COLORS[t.status as TicketStatus]}`}>
                      {STATUS_LABELS[t.status as TicketStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-300 text-xs">{t.assigned_agent_name ?? '-'}</td>
                  <td className={`px-4 py-3 text-xs font-mono ${frt.breached ? 'text-red-400 font-semibold' : frt.paused ? 'text-purple-400' : frt.text === 'Met' ? 'text-green-400' : 'text-neutral-300'}`}>
                    {frt.text}
                  </td>
                  <td className={`px-4 py-3 text-xs font-mono ${resolution.breached ? 'text-red-400 font-semibold' : resolution.paused ? 'text-purple-400' : resolution.text === 'Met' ? 'text-green-400' : 'text-neutral-300'}`}>
                    {resolution.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-600">
        {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} &middot; SLA updates every minute
      </div>

      {/* Detail panel */}
      {selectedTicketId !== null && (
        <TicketDetailPanel
          ticketId={selectedTicketId}
          agents={agents}
          onClose={() => setSelectedTicketId(null)}
          onUpdated={loadTickets}
        />
      )}

      {/* New ticket form */}
      {showNewForm && (
        <NewTicketForm
          teams={teams}
          agents={agents}
          categories={categories}
          onCreated={() => { setShowNewForm(false); loadTickets(); }}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </div>
  );
}
