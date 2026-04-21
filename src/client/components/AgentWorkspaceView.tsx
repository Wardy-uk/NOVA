import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ── Types ──

interface SlaInfo {
  status: 'ok' | 'at_risk' | 'breached';
  minutesRemaining: number | null;
  type: string | null;
}

interface AiInfo {
  action: string;
  confidence: number;
  approvalRequired: boolean;
  approvalStatus: string | null;
  shadowMode: boolean;
  summary: string | null;
  eventType: string;
  decidedAt: string;
}

interface QueueTicket {
  key: string;
  id: string;
  summary: string;
  status: string;
  statusCategory: string;
  priority: string;
  priorityOrder: number;
  issueType: string;
  assignee: string | null;
  assigneeAccountId: string | null;
  reporter: string | null;
  organisation: string | null;
  requestType: string | null;
  labels: string[];
  created: string;
  updated: string;
  ageMinutes: number;
  sla: SlaInfo;
  ai: AiInfo | null;
}

type SortField = 'urgency' | 'priority' | 'age' | 'updated' | 'key' | 'status';
type SortDir = 'asc' | 'desc';

interface GoldenRulesScore {
  clarity: number;
  empathy: number;
  action: number;
  ownership: number;
  overall: number;
  tips: string[];
}

// ── Helpers ──

function api(path: string) {
  return fetch(`/api/agent${path}`).then(r => r.json());
}

function apiJson(path: string, method: string, body?: unknown) {
  return fetch(`/api/agent${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }).then(r => r.json());
}

function priorityColor(p: string): string {
  switch (p) {
    case 'Highest': return 'text-red-400';
    case 'High': return 'text-orange-400';
    case 'Medium': return 'text-amber-400';
    case 'Low': return 'text-blue-400';
    case 'Lowest': return 'text-neutral-500';
    default: return 'text-neutral-400';
  }
}

function priorityIcon(p: string): string {
  switch (p) {
    case 'Highest': return '⬆⬆';
    case 'High': return '⬆';
    case 'Medium': return '—';
    case 'Low': return '⬇';
    case 'Lowest': return '⬇⬇';
    default: return '—';
  }
}

function slaLabel(sla: SlaInfo): string {
  if (sla.status === 'breached') return 'BREACHED';
  if (sla.minutesRemaining === null) return '—';
  if (sla.minutesRemaining < 60) return `${sla.minutesRemaining}m`;
  const hours = Math.floor(sla.minutesRemaining / 60);
  const mins = sla.minutesRemaining % 60;
  if (hours < 24) return `${hours}h ${mins}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function slaBadgeClass(sla: SlaInfo): string {
  if (sla.status === 'breached') return 'bg-red-950/60 text-red-400 border-red-800/40';
  if (sla.status === 'at_risk') return 'bg-amber-950/60 text-amber-400 border-amber-800/40';
  return 'bg-neutral-800/50 text-neutral-500 border-neutral-700/40';
}

function confidenceBar(c: number): string {
  if (c >= 0.8) return 'bg-green-500';
  if (c >= 0.5) return 'bg-amber-500';
  return 'bg-red-500';
}

function ageLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('closed') || s.includes('resolved') || s.includes('done')) return 'bg-green-900/40 text-green-400 border-green-800/40';
  if (s.includes('waiting') || s.includes('pending')) return 'bg-amber-900/40 text-amber-400 border-amber-800/40';
  if (s.includes('progress') || s.includes('wip')) return 'bg-blue-900/40 text-blue-400 border-blue-800/40';
  if (s.includes('escalat')) return 'bg-purple-900/40 text-purple-400 border-purple-800/40';
  if (s === 'open' || s === 'new' || s.includes('ai request')) return 'bg-cyan-900/40 text-cyan-400 border-cyan-800/40';
  return 'bg-neutral-800/40 text-neutral-400 border-neutral-700/40';
}

function extractPlainText(adf: unknown): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  if (typeof adf !== 'object') return '';
  try {
    const content = (adf as any).content;
    if (!Array.isArray(content)) return JSON.stringify(adf).slice(0, 1000);
    return content
      .flatMap((node: any) => {
        if ((node.type === 'paragraph' || node.type === 'heading') && Array.isArray(node.content)) {
          return node.content.map((c: any) => c.text ?? '').join('');
        }
        if (node.type === 'bulletList' || node.type === 'orderedList') {
          return (node.content ?? []).map((li: any) =>
            (li.content ?? []).flatMap((p: any) =>
              (p.content ?? []).map((c: any) => c.text ?? '')
            ).join('')
          ).map((t: string) => `  - ${t}`).join('\n');
        }
        if (node.type === 'codeBlock') {
          return (node.content ?? []).map((c: any) => c.text ?? '').join('');
        }
        return node.text ?? '';
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function scoreGoldenRules(text: string): GoldenRulesScore {
  const lower = text.toLowerCase();
  const tips: string[] = [];

  const hasSentences = (text.match(/[.!?]\s/g) ?? []).length >= 1;
  const hasLength = text.length > 30;
  const hasQuestion = lower.includes('?');
  let clarity = 1;
  if (hasLength) clarity++;
  if (hasSentences) clarity++;
  if (text.length > 80) clarity++;
  if (!hasQuestion || hasSentences) clarity = Math.min(clarity + 1, 5);
  if (clarity < 3) tips.push('Add more detail to help the customer understand the response');

  const empathyPhrases = ['understand', 'sorry', 'apologise', 'appreciate', 'thank you', 'thanks for',
    'i can see', 'we can see', 'frustrating', 'inconvenient', 'aware', 'acknowledge'];
  const empathyCount = empathyPhrases.filter(p => lower.includes(p)).length;
  let empathy = Math.min(1 + empathyCount * 2, 5);
  if (empathy < 3) tips.push('Acknowledge the customer\'s situation before the solution');

  const actionPhrases = ['next step', 'we will', 'we\'ll', 'please', 'you can', 'you\'ll need',
    'i\'ve', 'we\'ve', 'this has been', 'has been', 'will be', 'going to', 'let us know',
    'try', 'follow these', 'here\'s what'];
  const actionCount = actionPhrases.filter(p => lower.includes(p)).length;
  let action = Math.min(1 + actionCount * 1.5, 5);
  if (action < 3) tips.push('State a clear next step or action');

  const ownershipPhrases = ['we', 'our team', 'i\'ll', 'we\'ll', 'our', 'the team',
    'assigned', 'will follow up', 'will update', 'let us know', 'reach out', 'get back to you'];
  const ownerCount = ownershipPhrases.filter(p => lower.includes(p)).length;
  let ownership = Math.min(1 + ownerCount * 1.5, 5);
  if (ownership < 3) tips.push('Confirm who owns the next action');

  clarity = Math.round(Math.min(Math.max(clarity, 1), 5));
  empathy = Math.round(Math.min(Math.max(empathy, 1), 5));
  action = Math.round(Math.min(Math.max(action, 1), 5));
  ownership = Math.round(Math.min(Math.max(ownership, 1), 5));
  const overall = Math.round((clarity + empathy + action + ownership) / 4 * 10) / 10;

  return { clarity, empathy, action, ownership, overall, tips };
}

// ── Keyboard shortcut hook ──

function useKeyboardShortcuts(
  shortcuts: Record<string, (e: KeyboardEvent) => void>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;

      if (e.key === 'Escape' && shortcuts['Escape']) {
        shortcuts['Escape'](e);
        return;
      }

      if (e.ctrlKey && e.key === 'Enter' && shortcuts['Ctrl+Enter']) {
        shortcuts['Ctrl+Enter'](e);
        return;
      }

      if (inInput) return;

      const key = e.key.toLowerCase();
      if (shortcuts[key]) {
        e.preventDefault();
        shortcuts[key](e);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts, enabled]);
}

// ── Auto-refresh countdown hook ──

const FAST_REFRESH_INTERVAL = 15_000;
const FULL_REFRESH_INTERVAL = 120_000;

function useAutoRefresh(
  fastRefresh: () => Promise<void>,
  fullRefresh: () => Promise<void>,
) {
  const [nextFastIn, setNextFastIn] = useState(FAST_REFRESH_INTERVAL / 1000);
  const [nextFullIn, setNextFullIn] = useState(FULL_REFRESH_INTERVAL / 1000);
  const fastRef = useRef(fastRefresh);
  const fullRef = useRef(fullRefresh);
  fastRef.current = fastRefresh;
  fullRef.current = fullRefresh;

  useEffect(() => {
    let fastCounter = FAST_REFRESH_INTERVAL / 1000;
    let fullCounter = FULL_REFRESH_INTERVAL / 1000;

    const tick = setInterval(() => {
      fastCounter--;
      fullCounter--;
      setNextFastIn(fastCounter);
      setNextFullIn(fullCounter);

      if (fullCounter <= 0) {
        fullRef.current();
        fullCounter = FULL_REFRESH_INTERVAL / 1000;
        fastCounter = FAST_REFRESH_INTERVAL / 1000;
        setNextFullIn(fullCounter);
        setNextFastIn(fastCounter);
      } else if (fastCounter <= 0) {
        fastRef.current();
        fastCounter = FAST_REFRESH_INTERVAL / 1000;
        setNextFastIn(fastCounter);
      }
    }, 1000);

    return () => clearInterval(tick);
  }, []);

  return { nextFastIn, nextFullIn };
}

// ── Main Component ──

export function AgentWorkspaceView() {
  const [mode, setMode] = useState<'queue' | 'ticket'>('queue');
  const [openTicketKey, setOpenTicketKey] = useState<string | null>(null);

  const openTicket = useCallback((key: string) => {
    setOpenTicketKey(key);
    setMode('ticket');
  }, []);

  const backToQueue = useCallback(() => {
    setMode('queue');
    setOpenTicketKey(null);
  }, []);

  if (mode === 'ticket' && openTicketKey) {
    return <TicketDetailView ticketKey={openTicketKey} onBack={backToQueue} onNavigate={openTicket} />;
  }

  return <QueueView onOpenTicket={openTicket} />;
}

// ═══════════════════════════════════════════
// QUEUE VIEW
// ═══════════════════════════════════════════

function QueueView({ onOpenTicket }: { onOpenTicket: (key: string) => void }) {
  const [tickets, setTickets] = useState<QueueTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [dataSource, setDataSource] = useState<'jira' | 'perceiver' | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [slaFilter, setSlaFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('urgency');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const selectedRowRef = useRef<HTMLTableRowElement>(null);

  const refreshFull = useCallback(async () => {
    try {
      const res = await api('/workspace/queue');
      if (res.ok) {
        setTickets(res.data.tickets);
        setLastRefresh(new Date());
        setDataSource(res.data.source ?? 'jira');
        setError(null);
      } else {
        setError(res.error ?? 'Failed to load queue');
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshFast = useCallback(async () => {
    try {
      const res = await api('/workspace/queue-fast');
      if (res.ok && res.data.tickets.length > 0) {
        setTickets(res.data.tickets);
        setLastRefresh(new Date());
        setDataSource('perceiver');
      }
    } catch { /* silent — fast refresh is best-effort */ }
  }, []);

  useEffect(() => {
    refreshFull();
  }, [refreshFull]);

  const { nextFastIn, nextFullIn } = useAutoRefresh(refreshFast, refreshFull);

  const statuses = useMemo(() => [...new Set(tickets.map(t => t.status))].sort(), [tickets]);
  const priorities = useMemo(() => [...new Set(tickets.map(t => t.priority))], [tickets]);
  const assignees = useMemo(() => [...new Set(tickets.map(t => t.assignee).filter(Boolean))].sort() as string[], [tickets]);

  const filtered = useMemo(() => {
    let list = [...tickets];
    if (statusFilter !== 'all') list = list.filter(t => t.status === statusFilter);
    if (priorityFilter !== 'all') list = list.filter(t => t.priority === priorityFilter);
    if (assigneeFilter !== 'all') {
      list = assigneeFilter === 'unassigned' ? list.filter(t => !t.assignee) : list.filter(t => t.assignee === assigneeFilter);
    }
    if (slaFilter !== 'all') list = list.filter(t => t.sla.status === slaFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t =>
        t.key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q) ||
        (t.reporter ?? '').toLowerCase().includes(q) || (t.organisation ?? '').toLowerCase().includes(q)
      );
    }
    if (sortField !== 'urgency') {
      list.sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case 'priority': cmp = a.priorityOrder - b.priorityOrder; break;
          case 'age': cmp = b.ageMinutes - a.ageMinutes; break;
          case 'updated': cmp = new Date(b.updated).getTime() - new Date(a.updated).getTime(); break;
          case 'key': cmp = a.key.localeCompare(b.key); break;
          case 'status': cmp = a.status.localeCompare(b.status); break;
        }
        return sortDir === 'desc' ? -cmp : cmp;
      });
    }
    return list;
  }, [tickets, statusFilter, priorityFilter, assigneeFilter, slaFilter, searchQuery, sortField, sortDir]);

  useEffect(() => {
    if (selectedIdx >= filtered.length && filtered.length > 0) setSelectedIdx(filtered.length - 1);
  }, [filtered.length, selectedIdx]);

  const shortcuts = useMemo(() => ({
    j: () => setSelectedIdx(i => Math.min(i + 1, filtered.length - 1)),
    k: () => setSelectedIdx(i => Math.max(i - 1, 0)),
    Enter: () => { if (filtered[selectedIdx]) onOpenTicket(filtered[selectedIdx].key); },
    o: () => { if (filtered[selectedIdx]) onOpenTicket(filtered[selectedIdx].key); },
    r: () => refreshFull(),
    '/': (e: KeyboardEvent) => {
      e.preventDefault();
      const el = document.querySelector<HTMLInputElement>('[data-workspace-search]');
      if (el) el.focus();
    },
    Escape: () => {
      const el = document.activeElement as HTMLElement;
      if (el?.tagName === 'INPUT') el.blur();
    },
  }), [filtered, selectedIdx, onOpenTicket, refreshFull]);

  useKeyboardShortcuts(shortcuts);

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIdx]);

  const breachedCount = tickets.filter(t => t.sla.status === 'breached').length;
  const atRiskCount = tickets.filter(t => t.sla.status === 'at_risk').length;
  const unassignedCount = tickets.filter(t => !t.assignee).length;
  const aiCount = tickets.filter(t => t.ai !== null).length;

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  if (loading) return <div className="text-sm text-neutral-500 py-8 text-center">Loading ticket queue...</div>;
  if (error) return <div className="text-sm text-red-400 py-8 text-center">{error}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-neutral-100">Ticket Queue</h2>
          <span className="text-xs text-neutral-500">{tickets.length} open</span>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <div className="flex items-center gap-2 text-[10px] text-neutral-600">
              <span>{dataSource === 'perceiver' ? '⚡ cached' : '🔄 live'}</span>
              <span>·</span>
              <span>Updated {timeAgo(lastRefresh.toISOString())}</span>
              <span>·</span>
              <span title={`Fast: ${nextFastIn}s · Full: ${nextFullIn}s`}>
                next {nextFullIn <= nextFastIn ? `full ${nextFullIn}s` : `fast ${nextFastIn}s`}
              </span>
            </div>
          )}
          <button onClick={refreshFull} className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:text-neutral-200 hover:border-neutral-500 transition-colors">
            Refresh
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        <StatCard label="Total Open" value={tickets.length} />
        <StatCard label="SLA Breached" value={breachedCount} alert={breachedCount > 0} />
        <StatCard label="SLA At Risk" value={atRiskCount} warn={atRiskCount > 0} />
        <StatCard label="Unassigned" value={unassignedCount} warn={unassignedCount > 0} />
        <StatCard label="AI Enriched" value={aiCount} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search key, summary, reporter... ( / )"
          data-workspace-search
          className="bg-[#272C33] border border-[#3a424d] text-neutral-200 text-[11px] rounded px-3 py-1.5 w-56 focus:outline-none focus:border-[#5ec1ca]" />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All statuses' }, ...statuses.map(s => ({ value: s, label: s }))]} />
        <FilterSelect label="Priority" value={priorityFilter} onChange={setPriorityFilter} options={[{ value: 'all', label: 'All priorities' }, ...priorities.map(p => ({ value: p, label: p }))]} />
        <FilterSelect label="Assignee" value={assigneeFilter} onChange={setAssigneeFilter} options={[{ value: 'all', label: 'All assignees' }, { value: 'unassigned', label: 'Unassigned' }, ...assignees.map(a => ({ value: a, label: a }))]} />
        <FilterSelect label="SLA" value={slaFilter} onChange={setSlaFilter} options={[{ value: 'all', label: 'All SLA' }, { value: 'breached', label: 'Breached' }, { value: 'at_risk', label: 'At Risk' }, { value: 'ok', label: 'OK' }]} />
        {(statusFilter !== 'all' || priorityFilter !== 'all' || assigneeFilter !== 'all' || slaFilter !== 'all' || searchQuery) && (
          <button onClick={() => { setStatusFilter('all'); setPriorityFilter('all'); setAssigneeFilter('all'); setSlaFilter('all'); setSearchQuery(''); }}
            className="text-[10px] text-neutral-600 hover:text-red-400 transition-colors">Clear filters</button>
        )}
        <span className="text-[10px] text-neutral-600 ml-auto">{filtered.length} shown</span>
      </div>

      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-left">
              <SortHeader label="Key" field="key" current={sortField} dir={sortDir} onSort={toggleSort} width="w-24" />
              <th className="px-3 py-2 font-medium">Summary</th>
              <SortHeader label="Status" field="status" current={sortField} dir={sortDir} onSort={toggleSort} width="w-32" />
              <SortHeader label="Priority" field="priority" current={sortField} dir={sortDir} onSort={toggleSort} width="w-20" />
              <th className="px-3 py-2 font-medium w-28">SLA</th>
              <th className="px-3 py-2 font-medium w-28">Assignee</th>
              <th className="px-3 py-2 font-medium w-44">AI Recommendation</th>
              <SortHeader label="Age" field="age" current={sortField} dir={sortDir} onSort={toggleSort} width="w-16" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3a424d]">
            {filtered.map((ticket, idx) => (
              <tr key={ticket.key}
                ref={idx === selectedIdx ? selectedRowRef : undefined}
                onClick={() => { setSelectedIdx(idx); onOpenTicket(ticket.key); }}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={`cursor-pointer transition-colors ${
                  idx === selectedIdx
                    ? 'bg-[#5ec1ca]/10 ring-1 ring-inset ring-[#5ec1ca]/20'
                    : ticket.sla.status === 'breached' ? 'bg-red-950/10 hover:bg-red-950/20'
                    : ticket.sla.status === 'at_risk' ? 'bg-amber-950/10 hover:bg-amber-950/20'
                    : 'hover:bg-[#363d47]/50'
                }`}>
                <td className="px-3 py-2"><span className="font-mono text-[#5ec1ca] font-medium">{ticket.key}</span></td>
                <td className="px-3 py-2">
                  <div className="text-neutral-200 truncate max-w-md" title={ticket.summary}>{ticket.summary}</div>
                  <div className="text-[10px] text-neutral-600 mt-0.5">
                    {ticket.reporter ?? 'Unknown'}{ticket.organisation ? ` · ${ticket.organisation}` : ''}{ticket.requestType ? ` · ${ticket.requestType}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${statusColor(ticket.status)}`}>{ticket.status}</span></td>
                <td className="px-3 py-2"><span className={`text-[11px] font-medium ${priorityColor(ticket.priority)}`}>{priorityIcon(ticket.priority)} {ticket.priority}</span></td>
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${slaBadgeClass(ticket.sla)}`}>{slaLabel(ticket.sla)}</span>
                  {ticket.sla.type && <div className="text-[9px] text-neutral-600 mt-0.5">{ticket.sla.type}</div>}
                </td>
                <td className="px-3 py-2"><span className={`text-[11px] ${ticket.assignee ? 'text-neutral-300' : 'text-neutral-600 italic'}`}>{ticket.assignee ?? 'Unassigned'}</span></td>
                <td className="px-3 py-2">
                  {ticket.ai ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-neutral-300 truncate">{ticket.ai.summary}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="w-12 h-1 bg-neutral-800 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${confidenceBar(ticket.ai.confidence)}`} style={{ width: `${Math.round(ticket.ai.confidence * 100)}%` }} />
                          </div>
                          <span className="text-[9px] text-neutral-600">{(ticket.ai.confidence * 100).toFixed(0)}%</span>
                          {ticket.ai.shadowMode && <span className="text-[8px] text-neutral-600 bg-neutral-800 px-1 rounded">SHADOW</span>}
                          {ticket.ai.approvalRequired && ticket.ai.approvalStatus === null && <span className="text-[8px] text-amber-500 bg-amber-950/50 px-1 rounded">PENDING</span>}
                        </div>
                      </div>
                    </div>
                  ) : <span className="text-[10px] text-neutral-600 italic">No AI data</span>}
                </td>
                <td className="px-3 py-2 text-[10px] text-neutral-500 whitespace-nowrap">{ageLabel(ticket.ageMinutes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-neutral-500">
            {tickets.length === 0 ? 'No open tickets found.' : 'No tickets match your filters.'}
          </div>
        )}
      </div>

      {/* Keyboard shortcuts legend */}
      <div className="flex items-center gap-4 text-[9px] text-neutral-600 px-1">
        <span><kbd className="px-1 py-0.5 bg-neutral-800 rounded text-neutral-500 font-mono">j</kbd>/<kbd className="px-1 py-0.5 bg-neutral-800 rounded text-neutral-500 font-mono">k</kbd> navigate</span>
        <span><kbd className="px-1 py-0.5 bg-neutral-800 rounded text-neutral-500 font-mono">Enter</kbd> open</span>
        <span><kbd className="px-1 py-0.5 bg-neutral-800 rounded text-neutral-500 font-mono">r</kbd> refresh</span>
        <span><kbd className="px-1 py-0.5 bg-neutral-800 rounded text-neutral-500 font-mono">/</kbd> search</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// TICKET DETAIL VIEW
// ═══════════════════════════════════════════

function TicketDetailView({ ticketKey, onBack, onNavigate }: {
  ticketKey: string;
  onBack: () => void;
  onNavigate: (key: string) => void;
}) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<'reply' | 'escalate' | 'resolve' | 'note' | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showInternalComments, setShowInternalComments] = useState(false);

  const loadTicket = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api(`/workspace/ticket/${ticketKey}`);
      if (res.ok) setData(res.data);
      else setError(res.error ?? 'Failed to load ticket');
    } catch (err: any) {
      setError(err.message ?? 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  }, [ticketKey]);

  useEffect(() => { loadTicket(); }, [loadTicket]);

  const shortcuts = useMemo(() => ({
    Escape: () => {
      if (activeAction) setActiveAction(null);
      else onBack();
    },
    r: () => { if (!activeAction) setActiveAction('reply'); },
    n: () => { if (!activeAction) setActiveAction('note'); },
    e: () => { if (!activeAction) setActiveAction('escalate'); },
    v: () => { if (!activeAction) setActiveAction('resolve'); },
  }), [activeAction, onBack]);

  useKeyboardShortcuts(shortcuts);

  if (loading) return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-neutral-500 hover:text-[#5ec1ca] transition-colors">← Back to Queue <kbd className="text-[9px] text-neutral-700 ml-1">Esc</kbd></button>
      <div className="text-sm text-neutral-500 py-8 text-center">Loading {ticketKey}...</div>
    </div>
  );

  if (error || !data) return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-neutral-500 hover:text-[#5ec1ca] transition-colors">← Back to Queue</button>
      <div className="text-sm text-red-400 py-8 text-center">{error ?? 'Ticket not found'}</div>
    </div>
  );

  const issue = data.issue;
  const decisions = (data.decisions ?? []) as any[];
  const f = issue?.fields ?? {};
  const description = extractPlainText(f.description);

  const allComments = (f.comment?.comments ?? []) as Array<{
    author?: { displayName?: string };
    body?: unknown;
    created?: string;
    jsdPublic?: boolean;
    properties?: Array<{ key: string; value?: { internal?: boolean } }>;
  }>;

  const classifyComment = (c: typeof allComments[0]) => {
    return c.properties?.some(p => p.key === 'sd.public.comment' && p.value?.internal) || c.jsdPublic === false;
  };

  const publicComments = allComments.filter(c => !classifyComment(c));
  const internalComments = allComments.filter(c => classifyComment(c));

  const latestDecision = decisions[0];
  let latestOutput: any = null;
  let latestInputs: any = null;
  if (latestDecision?.output) {
    try { latestOutput = typeof latestDecision.output === 'string' ? JSON.parse(latestDecision.output) : latestDecision.output; } catch {}
  }
  if (latestDecision?.inputs) {
    try { latestInputs = typeof latestDecision.inputs === 'string' ? JSON.parse(latestDecision.inputs) : latestDecision.inputs; } catch {}
  }

  const handleActionComplete = (msg: string, ok = true) => {
    setActionResult({ ok, message: msg });
    setActiveAction(null);
    loadTicket();
  };

  return (
    <div className="space-y-4">
      {/* Breadcrumb + Back */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-xs text-neutral-500 hover:text-[#5ec1ca] transition-colors">
          ← Back to Queue <kbd className="text-[9px] text-neutral-700 ml-1">Esc</kbd>
        </button>
        <button onClick={loadTicket} className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:text-neutral-200 transition-colors">Refresh</button>
      </div>

      {/* Ticket header */}
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[#5ec1ca] font-bold text-base">{ticketKey}</span>
              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium border ${statusColor(f.status?.name ?? '')}`}>{f.status?.name ?? ''}</span>
              <span className={`text-xs font-medium ${priorityColor(f.priority?.name ?? '')}`}>{priorityIcon(f.priority?.name ?? '')} {f.priority?.name ?? ''}</span>
              {f.issuetype?.name && <span className="text-[10px] text-neutral-500 bg-neutral-800/60 px-1.5 py-0.5 rounded">{f.issuetype.name}</span>}
            </div>
            <h2 className="text-sm text-neutral-100 font-semibold mt-1.5">{f.summary ?? ''}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-500 mt-2">
              <span>Reporter: <span className="text-neutral-400">{f.reporter?.displayName ?? 'Unknown'}</span></span>
              <span>Assignee: <span className="text-neutral-400">{f.assignee?.displayName ?? 'Unassigned'}</span></span>
              <span>Created: <span className="text-neutral-400">{f.created ? new Date(f.created).toLocaleDateString() : ''}</span></span>
              <span>Updated: <span className="text-neutral-400">{f.updated ? timeAgo(f.updated) : ''}</span></span>
              {f.customfield_10020?.requestType?.name && <span>Type: <span className="text-neutral-400">{f.customfield_10020.requestType.name}</span></span>}
            </div>
          </div>

          {/* Action buttons with shortcut hints */}
          <div className="flex gap-1.5 ml-4 shrink-0">
            <ActionButton label="Reply" hint="r" active={activeAction === 'reply'} onClick={() => setActiveAction(activeAction === 'reply' ? null : 'reply')} color="cyan" />
            <ActionButton label="Add Note" hint="n" active={activeAction === 'note'} onClick={() => setActiveAction(activeAction === 'note' ? null : 'note')} color="neutral" />
            <ActionButton label="Escalate" hint="e" active={activeAction === 'escalate'} onClick={() => setActiveAction(activeAction === 'escalate' ? null : 'escalate')} color="amber" />
            <ActionButton label="Resolve" hint="v" active={activeAction === 'resolve'} onClick={() => setActiveAction(activeAction === 'resolve' ? null : 'resolve')} color="green" />
          </div>
        </div>
      </div>

      {/* Action result banner */}
      {actionResult && (
        <div className={`px-3 py-2 rounded text-xs border ${actionResult.ok ? 'bg-green-950/30 border-green-800/40 text-green-400' : 'bg-red-950/30 border-red-800/40 text-red-400'}`}>
          {actionResult.message}
          <button onClick={() => setActionResult(null)} className="ml-2 text-neutral-600 hover:text-neutral-400">✕</button>
        </div>
      )}

      {/* Action panels */}
      {activeAction === 'reply' && (
        <ReplyComposer ticketKey={ticketKey} aiDraft={latestOutput?.draft_response ?? null} onComplete={handleActionComplete} />
      )}
      {activeAction === 'note' && (
        <NoteComposer ticketKey={ticketKey} onComplete={handleActionComplete} />
      )}
      {activeAction === 'escalate' && (
        <EscalatePanel ticketKey={ticketKey} onComplete={handleActionComplete} />
      )}
      {activeAction === 'resolve' && (
        <ResolvePanel ticketKey={ticketKey} onComplete={handleActionComplete} />
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-4">
        {/* Left column: Conversation thread (2/3 width) */}
        <div className="col-span-2 space-y-3">
          {/* Description */}
          <div className="border border-[#3a424d] rounded-lg bg-[#272C33]">
            <div className="px-4 py-2 border-b border-[#3a424d] bg-[#2a3039]">
              <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">Description</h4>
            </div>
            <div className="px-4 py-3 text-xs text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
              {description || '(no description)'}
            </div>
          </div>

          {/* Conversation */}
          <div className="border border-[#3a424d] rounded-lg bg-[#272C33]">
            <div className="px-4 py-2 border-b border-[#3a424d] bg-[#2a3039] flex items-center justify-between">
              <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">
                Conversation ({publicComments.length} public{internalComments.length > 0 ? `, ${internalComments.length} internal` : ''})
              </h4>
              {internalComments.length > 0 && (
                <button onClick={() => setShowInternalComments(!showInternalComments)}
                  className="text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors">
                  {showInternalComments ? 'Hide internal' : 'Show internal'}
                </button>
              )}
            </div>
            <div className="p-3 space-y-2 max-h-[32rem] overflow-y-auto">
              {(showInternalComments ? allComments : publicComments).slice().reverse().map((c, i) => {
                const isInternal = classifyComment(c);
                const bodyText = extractPlainText(c.body);
                return (
                  <div key={i} className={`rounded-lg p-3 text-xs ${isInternal ? 'bg-amber-950/10 border border-amber-900/20' : 'bg-[#2f353d]'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium text-neutral-300">
                        {c.author?.displayName ?? 'Unknown'}
                        {isInternal && <span className="text-[9px] text-amber-600 ml-1.5 bg-amber-950/40 px-1 py-0.5 rounded">(internal)</span>}
                      </span>
                      <span className="text-[9px] text-neutral-600">{c.created ? timeAgo(c.created) : ''}</span>
                    </div>
                    <div className="text-neutral-400 whitespace-pre-wrap leading-relaxed">{bodyText}</div>
                  </div>
                );
              })}
              {publicComments.length === 0 && !showInternalComments && (
                <div className="text-[10px] text-neutral-600 italic p-2 text-center">No public comments yet.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: AI Analysis + Context (1/3 width) */}
        <div className="space-y-3">
          {/* AI Analysis */}
          <div className="border border-[#3a424d] rounded-lg bg-[#272C33]">
            <div className="px-4 py-2 border-b border-[#3a424d] bg-[#2a3039]">
              <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">AI Analysis</h4>
            </div>
            <div className="p-3 space-y-3">
              {latestDecision ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-200">
                      {latestDecision.action === 'draft_response' ? 'Respond' : latestDecision.action}
                    </span>
                    <span className="text-[9px] text-neutral-600">{latestDecision.created_at ? timeAgo(latestDecision.created_at) : ''}</span>
                  </div>

                  {/* Confidence meter */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Confidence</span>
                      <span className={`text-xs font-bold ${latestDecision.confidence >= 0.8 ? 'text-green-400' : latestDecision.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
                        {(latestDecision.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${confidenceBar(latestDecision.confidence)}`}
                        style={{ width: `${Math.round(latestDecision.confidence * 100)}%` }} />
                    </div>
                  </div>

                  {/* Classification */}
                  {latestOutput?.classification && (
                    <div className="bg-[#2f353d] rounded p-2">
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">Classification</div>
                      <div className="text-xs text-neutral-300">
                        {latestOutput.classification.category}
                        {latestOutput.classification.sub_category && <span className="text-neutral-500"> / {latestOutput.classification.sub_category}</span>}
                      </div>
                    </div>
                  )}

                  {/* Sentiment */}
                  {(latestInputs?.sentiment || latestOutput?.sentiment) && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Sentiment</span>
                      <SentimentBadge sentiment={latestInputs?.sentiment ?? latestOutput?.sentiment ?? ''} />
                    </div>
                  )}

                  {/* SLA Risk */}
                  {latestInputs?.sla_risk && (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-neutral-500 uppercase tracking-wider">SLA Risk</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        latestInputs.sla_risk === 'critical' || latestInputs.sla_risk === 'high' ? 'bg-red-950/40 text-red-400 border-red-800/40'
                          : latestInputs.sla_risk === 'medium' ? 'bg-amber-950/40 text-amber-400 border-amber-800/40'
                          : 'bg-neutral-800/50 text-neutral-400 border-neutral-700/40'
                      }`}>{latestInputs.sla_risk}</span>
                    </div>
                  )}

                  {/* Reasoning */}
                  <div>
                    <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">Reasoning</div>
                    <div className="text-[10px] text-neutral-400 leading-relaxed bg-[#2f353d] rounded p-2 max-h-28 overflow-y-auto">
                      {typeof latestDecision.reasoning === 'string' ? latestDecision.reasoning : ''}
                    </div>
                  </div>

                  {/* AI Draft preview */}
                  {latestOutput?.draft_response && activeAction !== 'reply' && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-neutral-500 uppercase tracking-wider">AI Draft</span>
                        <button onClick={() => setActiveAction('reply')} className="text-[9px] text-[#5ec1ca] hover:text-[#7dd3d8]">Use this draft →</button>
                      </div>
                      <div className="text-[10px] text-neutral-400 bg-[#2f353d] rounded p-2 max-h-20 overflow-y-auto leading-relaxed">
                        {latestOutput.draft_response.slice(0, 300)}{latestOutput.draft_response.length > 300 ? '...' : ''}
                      </div>
                    </div>
                  )}

                  {/* Provider info */}
                  {(latestDecision.provider || latestDecision.model) && (
                    <div className="text-[9px] text-neutral-600">
                      {latestDecision.provider}/{latestDecision.model}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-[10px] text-neutral-600 italic py-2 text-center">No AI decisions for this ticket yet.</div>
              )}
            </div>
          </div>

          {/* Customer Context */}
          <div className="border border-[#3a424d] rounded-lg bg-[#272C33]">
            <div className="px-4 py-2 border-b border-[#3a424d] bg-[#2a3039]">
              <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">Customer Context</h4>
            </div>
            <div className="p-3 space-y-2 text-[10px]">
              <ContextRow label="Reporter" value={f.reporter?.displayName ?? 'Unknown'} />
              <ContextRow label="Email" value={f.reporter?.emailAddress ?? '—'} />
              <ContextRow label="Organisation" value={f.reporter?.emailAddress?.split('@')[1] ?? '—'} />
              <ContextRow label="Request Type" value={f.customfield_10020?.requestType?.name ?? '—'} />
              {f.labels?.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-neutral-500 w-20 shrink-0">Labels</span>
                  <div className="flex flex-wrap gap-1">
                    {f.labels.map((l: string) => <span key={l} className="bg-neutral-800/60 text-neutral-400 px-1.5 py-0.5 rounded text-[9px]">{l}</span>)}
                  </div>
                </div>
              )}
              <div className="border-t border-[#3a424d] pt-2 mt-2 text-[9px] text-neutral-600 italic">
                D365 enrichment coming in a future phase.
              </div>
            </div>
          </div>

          {/* Decision history */}
          {decisions.length > 1 && (
            <div className="border border-[#3a424d] rounded-lg bg-[#272C33]">
              <div className="px-4 py-2 border-b border-[#3a424d] bg-[#2a3039]">
                <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">Decision History ({decisions.length})</h4>
              </div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto">
                {decisions.map((d: any, i: number) => (
                  <div key={i} className={`flex items-center gap-2 text-[10px] rounded px-2 py-1 ${i === 0 ? 'bg-[#5ec1ca]/5 text-neutral-300' : 'text-neutral-500'}`}>
                    <span className="w-12 shrink-0 text-[9px] text-neutral-600">{d.created_at ? timeAgo(d.created_at) : ''}</span>
                    <span className="font-medium">{d.action}</span>
                    <span className="text-[9px]">{(d.confidence * 100).toFixed(0)}%</span>
                    <span className="truncate flex-1 text-[9px] text-neutral-600">{typeof d.reasoning === 'string' ? d.reasoning.slice(0, 60) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// REPLY COMPOSER (with Golden Rules)
// ═══════════════════════════════════════════

function ReplyComposer({ ticketKey, aiDraft, onComplete }: {
  ticketKey: string;
  aiDraft: string | null;
  onComplete: (msg: string, ok?: boolean) => void;
}) {
  const [text, setText] = useState(aiDraft ?? '');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [draftMeta, setDraftMeta] = useState<{ provider?: string; model?: string; sentiment?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const score = useMemo(() => scoreGoldenRules(text), [text]);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  const generateDraft = async () => {
    setDrafting(true);
    try {
      const res = await apiJson('/quick-actions/draft-reply', 'POST', { ticketKey });
      if (res.ok) {
        setText(res.data.draftResponse ?? '');
        setDraftMeta({ provider: res.data.provider, model: res.data.model, sentiment: res.data.sentiment });
      }
    } catch { /* ignore */ }
    finally { setDrafting(false); }
  };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await apiJson('/quick-actions/send-reply', 'POST', { ticketKey, message: text.trim(), internal: false });
      if (res.ok) onComplete(`Reply posted to ${ticketKey}`);
      else onComplete(res.error ?? 'Failed to send', false);
    } catch (err: any) {
      onComplete(err.message ?? 'Failed to send', false);
    } finally { setSending(false); }
  };

  const shortcuts = useMemo(() => ({
    'Ctrl+Enter': () => { if (text.trim() && !sending) send(); },
  }), [text, sending]);

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="border border-[#5ec1ca]/30 rounded-lg bg-[#272C33] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-200">Reply to Customer</h4>
        <div className="flex items-center gap-2">
          {draftMeta && <span className="text-[9px] text-neutral-600">{draftMeta.provider}/{draftMeta.model}</span>}
          <button onClick={generateDraft} disabled={drafting}
            className="px-2.5 py-1 text-[10px] font-medium rounded bg-[#5ec1ca]/10 text-[#5ec1ca] border border-[#5ec1ca]/20 hover:bg-[#5ec1ca]/20 disabled:opacity-40">
            {drafting ? 'Drafting...' : 'Generate AI Draft'}
          </button>
        </div>
      </div>

      <textarea ref={textareaRef} value={text} onChange={e => setText(e.target.value)} rows={8}
        placeholder="Type your reply or generate an AI draft..."
        className="w-full bg-[#2f353d] border border-[#3a424d] text-neutral-200 text-xs rounded-lg p-3 focus:outline-none focus:border-[#5ec1ca] resize-y leading-relaxed" />

      {/* Golden Rules indicator */}
      <GoldenRulesIndicator score={score} />

      <div className="flex items-center gap-2">
        <button onClick={send} disabled={!text.trim() || sending}
          className="px-4 py-1.5 text-[11px] font-medium rounded bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? 'Sending...' : 'Send Reply'}
        </button>
        <span className="text-[9px] text-neutral-600">Ctrl+Enter to send</span>
        {score.overall < 3 && text.trim().length > 0 && (
          <span className="text-[10px] text-amber-500 ml-2">Quality could be improved — check Golden Rules above</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// NOTE COMPOSER
// ═══════════════════════════════════════════

function NoteComposer({ ticketKey, onComplete }: {
  ticketKey: string;
  onComplete: (msg: string, ok?: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await apiJson('/quick-actions/send-reply', 'POST', { ticketKey, message: text.trim(), internal: true });
      if (res.ok) onComplete(`Internal note posted to ${ticketKey}`);
      else onComplete(res.error ?? 'Failed to post note', false);
    } catch (err: any) { onComplete(err.message ?? 'Failed to post note', false); }
    finally { setSending(false); }
  };

  const shortcuts = useMemo(() => ({
    'Ctrl+Enter': () => { if (text.trim() && !sending) send(); },
  }), [text, sending]);

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="border border-amber-800/30 rounded-lg bg-[#272C33] p-4 space-y-3">
      <h4 className="text-xs font-semibold text-neutral-200">Internal Note</h4>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
        placeholder="Type an internal note (not visible to the customer)..."
        className="w-full bg-[#2f353d] border border-[#3a424d] text-neutral-200 text-xs rounded-lg p-3 focus:outline-none focus:border-amber-600 resize-y leading-relaxed"
        autoFocus />
      <div className="flex items-center gap-2">
        <button onClick={send} disabled={!text.trim() || sending}
          className="px-4 py-1.5 text-[11px] font-medium rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 hover:bg-amber-900/50 disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? 'Posting...' : 'Post Internal Note'}
        </button>
        <span className="text-[9px] text-neutral-600">Ctrl+Enter to post</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// ESCALATION WIZARD (SOP-002)
// ═══════════════════════════════════════════

interface EscalationReason {
  id: number;
  reason_code: string;
  label: string;
  requires_troubleshooting: boolean;
  troubleshooting_checklist: string[] | null;
}

interface T2Agent {
  id: number;
  display_name: string;
  pool: string;
  skills: string[] | null;
  open_tickets?: number;
  available?: boolean;
}

function EscalatePanel({ ticketKey, onComplete }: {
  ticketKey: string;
  onComplete: (msg: string, ok?: boolean) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [reasons, setReasons] = useState<EscalationReason[]>([]);
  const [selectedReason, setSelectedReason] = useState<EscalationReason | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [t2Agents, setT2Agents] = useState<T2Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<T2Agent | null>(null);
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [briefPreview, setBriefPreview] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiJson('/escalation/reasons', 'GET'),
      apiJson('/escalation/t2-agents', 'GET'),
    ]).then(([reasonsRes, agentsRes]) => {
      if (reasonsRes.ok) setReasons(reasonsRes.data ?? []);
      if (agentsRes.ok) setT2Agents(agentsRes.data ?? []);
    }).finally(() => setLoading(false));
  }, []);

  const allChecklistComplete = selectedReason?.troubleshooting_checklist
    ? selectedReason.troubleshooting_checklist.every((_: string, i: number) => checklist[i])
    : true;

  const canProceedStep2 = !selectedReason?.requires_troubleshooting || allChecklistComplete;

  const generateBriefPreview = useCallback(async () => {
    const items = selectedReason?.troubleshooting_checklist?.filter((_: string, i: number) => checklist[i]) ?? [];
    const brief = [
      `Escalation Reason: ${selectedReason?.label}`,
      '',
      items.length > 0 ? `Troubleshooting Completed:\n${items.map((s: string) => `  [x] ${s}`).join('\n')}` : '',
      additionalNotes ? `\nAdditional Notes:\n${additionalNotes}` : '',
      selectedAgent ? `\nAssigned To: ${selectedAgent.display_name}` : '',
    ].filter(Boolean).join('\n');
    setBriefPreview(brief);
  }, [selectedReason, checklist, additionalNotes, selectedAgent]);

  useEffect(() => { if (step === 4) generateBriefPreview(); }, [step, generateBriefPreview]);

  const submit = async () => {
    setSending(true);
    try {
      const payload = {
        ticketKey,
        reasonCode: selectedReason?.reason_code,
        reasonLabel: selectedReason?.label,
        troubleshootingDone: selectedReason?.troubleshooting_checklist?.filter((_: string, i: number) => checklist[i]) ?? [],
        assignToAccountId: selectedAgent?.id ? undefined : undefined,
        assignToAgentId: selectedAgent?.id,
        additionalNotes: additionalNotes.trim() || undefined,
        briefText: briefPreview,
      };
      const res = await apiJson('/escalation/execute', 'POST', payload);
      if (res.ok) onComplete(`${ticketKey} escalated to ${selectedAgent?.display_name ?? 'T2'}`, true);
      else onComplete(res.error ?? 'Escalation failed', false);
    } catch (err: any) { onComplete(err.message ?? 'Escalation failed', false); }
    finally { setSending(false); }
  };

  const shortcuts = useMemo(() => ({
    'Ctrl+Enter': () => { if (step === 4 && !sending) submit(); },
  }), [step, sending]);

  useKeyboardShortcuts(shortcuts);

  if (loading) return <div className="p-4 text-xs text-neutral-500">Loading escalation config...</div>;

  const stepIndicator = (
    <div className="flex items-center gap-1 mb-4">
      {[1, 2, 3, 4].map(s => (
        <div key={s} className="flex items-center gap-1">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold
            ${step === s ? 'bg-amber-600 text-white' : step > s ? 'bg-green-900/50 text-green-400 border border-green-800/40' : 'bg-[#2f353d] text-neutral-500 border border-[#3a424d]'}`}>
            {step > s ? '✓' : s}
          </div>
          {s < 4 && <div className={`w-6 h-0.5 ${step > s ? 'bg-green-800/60' : 'bg-[#3a424d]'}`} />}
        </div>
      ))}
      <span className="ml-2 text-[10px] text-neutral-500">
        {step === 1 ? 'Reason' : step === 2 ? 'Troubleshooting' : step === 3 ? 'Assign' : 'Review'}
      </span>
    </div>
  );

  return (
    <div className="border border-amber-800/30 rounded-lg bg-[#272C33] p-4 space-y-3">
      <h4 className="text-xs font-semibold text-neutral-200">Escalate Ticket (SOP-002)</h4>
      {stepIndicator}

      {step === 1 && (
        <div className="space-y-2">
          <p className="text-[10px] text-neutral-400">Select the reason for escalation:</p>
          {reasons.map(r => (
            <label key={r.id} className={`flex items-start gap-2 p-2 rounded cursor-pointer border text-xs
              ${selectedReason?.id === r.id ? 'border-amber-600 bg-amber-900/20 text-amber-300' : 'border-[#3a424d] hover:border-[#4a525d] text-neutral-300'}`}
              onClick={() => {
                setSelectedReason(r);
                setChecklist({});
              }}>
              <input type="radio" name="reason" checked={selectedReason?.id === r.id} onChange={() => {}} className="mt-0.5" />
              <div>
                <div className="font-medium">{r.label}</div>
                {r.requires_troubleshooting && <div className="text-[9px] text-neutral-500 mt-0.5">Requires troubleshooting documentation</div>}
              </div>
            </label>
          ))}
          <div className="flex justify-end pt-2">
            <button onClick={() => setStep(2)} disabled={!selectedReason}
              className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-900/30 text-blue-400 border border-blue-800/40 hover:bg-blue-900/50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {selectedReason?.requires_troubleshooting && selectedReason.troubleshooting_checklist ? (
            <>
              <p className="text-[10px] text-neutral-400">Confirm troubleshooting steps taken:</p>
              {selectedReason.troubleshooting_checklist.map((item: string, i: number) => (
                <label key={i} className={`flex items-start gap-2 p-2 rounded border text-xs cursor-pointer
                  ${checklist[i] ? 'border-green-800/40 bg-green-900/10 text-green-300' : 'border-[#3a424d] text-neutral-300'}`}>
                  <input type="checkbox" checked={!!checklist[i]}
                    onChange={e => setChecklist(prev => ({ ...prev, [i]: e.target.checked }))} className="mt-0.5" />
                  {item}
                </label>
              ))}
              {!allChecklistComplete && (
                <p className="text-[9px] text-amber-500">All steps must be confirmed before escalation</p>
              )}
            </>
          ) : (
            <p className="text-[10px] text-neutral-400">No troubleshooting checklist required for this reason.</p>
          )}
          <textarea value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value)} rows={3}
            placeholder="Additional context for the T2 agent (optional)..."
            className="w-full bg-[#2f353d] border border-[#3a424d] text-neutral-200 text-xs rounded-lg p-3 focus:outline-none focus:border-amber-600 resize-y leading-relaxed" />
          <div className="flex justify-between pt-1">
            <button onClick={() => setStep(1)} className="px-3 py-1.5 text-[11px] font-medium rounded text-neutral-400 hover:text-neutral-200">Back</button>
            <button onClick={() => setStep(3)} disabled={!canProceedStep2}
              className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-900/30 text-blue-400 border border-blue-800/40 hover:bg-blue-900/50 disabled:opacity-40">
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2">
          <p className="text-[10px] text-neutral-400">Select T2 agent (or leave blank for auto-assignment):</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            <label className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer
              ${!selectedAgent ? 'border-amber-600 bg-amber-900/20 text-amber-300' : 'border-[#3a424d] text-neutral-300'}`}
              onClick={() => setSelectedAgent(null)}>
              <input type="radio" name="t2agent" checked={!selectedAgent} onChange={() => {}} />
              <div>
                <div className="font-medium">Auto-assign (Round Robin)</div>
                <div className="text-[9px] text-neutral-500">Assigns to available T2 agent with lowest workload</div>
              </div>
            </label>
            {t2Agents.map(a => (
              <label key={a.id} className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer
                ${selectedAgent?.id === a.id ? 'border-amber-600 bg-amber-900/20 text-amber-300' : 'border-[#3a424d] text-neutral-300'}
                ${a.available === false ? 'opacity-50' : ''}`}
                onClick={() => { if (a.available !== false) setSelectedAgent(a); }}>
                <input type="radio" name="t2agent" checked={selectedAgent?.id === a.id} onChange={() => {}} />
                <div className="flex-1">
                  <div className="font-medium">{a.display_name}</div>
                  <div className="text-[9px] text-neutral-500 flex gap-2">
                    {a.skills?.slice(0, 3).map(s => <span key={s} className="bg-[#2f353d] px-1 rounded">{s}</span>)}
                    {a.open_tickets !== undefined && <span>{a.open_tickets} open</span>}
                    {a.available === false && <span className="text-red-400">Unavailable</span>}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="flex justify-between pt-1">
            <button onClick={() => setStep(2)} className="px-3 py-1.5 text-[11px] font-medium rounded text-neutral-400 hover:text-neutral-200">Back</button>
            <button onClick={() => setStep(4)}
              className="px-3 py-1.5 text-[11px] font-medium rounded bg-blue-900/30 text-blue-400 border border-blue-800/40 hover:bg-blue-900/50">
              Review
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <p className="text-[10px] text-neutral-400">Review escalation brief before submitting:</p>
          <pre className="text-[10px] text-neutral-300 bg-[#1a1e24] border border-[#3a424d] rounded p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{briefPreview}</pre>
          <div className="flex justify-between pt-1">
            <button onClick={() => setStep(3)} className="px-3 py-1.5 text-[11px] font-medium rounded text-neutral-400 hover:text-neutral-200">Back</button>
            <div className="flex items-center gap-2">
              <button onClick={submit} disabled={sending}
                className="px-4 py-1.5 text-[11px] font-medium rounded bg-amber-900/30 text-amber-400 border border-amber-800/40 hover:bg-amber-900/50 disabled:opacity-40">
                {sending ? 'Escalating...' : 'Escalate'}
              </button>
              <span className="text-[9px] text-neutral-600">Ctrl+Enter to submit</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// RESOLVE PANEL
// ═══════════════════════════════════════════

function ResolvePanel({ ticketKey, onComplete }: {
  ticketKey: string;
  onComplete: (msg: string, ok?: boolean) => void;
}) {
  const [customerMsg, setCustomerMsg] = useState('');
  const [summary, setSummary] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const generateDraft = async () => {
    setDrafting(true);
    try {
      const res = await apiJson('/quick-actions/draft-resolve', 'POST', { ticketKey });
      if (res.ok) {
        setCustomerMsg(res.data.customerMessage ?? '');
        setSummary(res.data.resolutionSummary ?? '');
      }
    } catch { /* ignore */ }
    finally { setDrafting(false); }
  };

  const resolve = async () => {
    setSending(true);
    try {
      const res = await apiJson('/quick-actions/resolve', 'POST', {
        ticketKey,
        customerMessage: customerMsg.trim() || undefined,
        resolutionSummary: summary.trim() || undefined,
      });
      if (res.ok) onComplete(`${ticketKey} resolved`);
      else onComplete(res.error ?? 'Resolve failed', false);
    } catch (err: any) { onComplete(err.message ?? 'Resolve failed', false); }
    finally { setSending(false); }
  };

  const score = useMemo(() => scoreGoldenRules(customerMsg), [customerMsg]);

  const shortcuts = useMemo(() => ({
    'Ctrl+Enter': () => { if (!sending) resolve(); },
  }), [sending]);

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="border border-green-800/30 rounded-lg bg-[#272C33] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-200">Resolve Ticket</h4>
        <button onClick={generateDraft} disabled={drafting}
          className="px-2.5 py-1 text-[10px] font-medium rounded bg-green-900/20 text-green-400 border border-green-800/30 hover:bg-green-900/40 disabled:opacity-40">
          {drafting ? 'Drafting...' : 'Generate AI Summary'}
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-neutral-500 font-medium">Resolution Summary (internal)</label>
        <input type="text" value={summary} onChange={e => setSummary(e.target.value)} placeholder="One-line summary of what was done"
          className="w-full bg-[#2f353d] border border-[#3a424d] text-neutral-200 text-xs rounded px-3 py-1.5 focus:outline-none focus:border-green-600" />
      </div>

      <div className="space-y-2">
        <label className="text-[10px] text-neutral-500 font-medium">Customer Closing Message (optional)</label>
        <textarea value={customerMsg} onChange={e => setCustomerMsg(e.target.value)} rows={4}
          placeholder="Closing message to the customer confirming resolution..."
          className="w-full bg-[#2f353d] border border-[#3a424d] text-neutral-200 text-xs rounded-lg p-3 focus:outline-none focus:border-green-600 resize-y leading-relaxed" />
      </div>

      {customerMsg.trim() && <GoldenRulesIndicator score={score} />}

      <div className="flex items-center gap-2">
        <button onClick={resolve} disabled={sending}
          className="px-4 py-1.5 text-[11px] font-medium rounded bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-green-900/50 disabled:opacity-40 disabled:cursor-not-allowed">
          {sending ? 'Resolving...' : 'Resolve & Post'}
        </button>
        <span className="text-[9px] text-neutral-600">Ctrl+Enter to resolve</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// GOLDEN RULES QUALITY INDICATOR
// ═══════════════════════════════════════════

function GoldenRulesIndicator({ score }: { score: GoldenRulesScore }) {
  const rules: { key: keyof Pick<GoldenRulesScore, 'clarity' | 'empathy' | 'action' | 'ownership'>; label: string }[] = [
    { key: 'clarity', label: 'Clarity' },
    { key: 'empathy', label: 'Empathy' },
    { key: 'action', label: 'Action' },
    { key: 'ownership', label: 'Ownership' },
  ];

  const overallColor = score.overall >= 4 ? 'text-green-400' : score.overall >= 3 ? 'text-amber-400' : 'text-red-400';
  const overallBg = score.overall >= 4 ? 'bg-green-950/30 border-green-800/30' : score.overall >= 3 ? 'bg-amber-950/30 border-amber-800/30' : 'bg-red-950/30 border-red-800/30';

  return (
    <div className={`rounded-lg border p-3 ${overallBg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Golden Rules Quality</span>
        <span className={`text-sm font-bold ${overallColor}`}>{score.overall.toFixed(1)}/5</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {rules.map(r => {
          const val = score[r.key];
          const color = val >= 4 ? 'bg-green-500' : val >= 3 ? 'bg-amber-500' : 'bg-red-500';
          return (
            <div key={r.key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-neutral-500">{r.label}</span>
                <span className="text-[9px] text-neutral-400">{val}/5</span>
              </div>
              <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${val * 20}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {score.tips.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {score.tips.map((tip, i) => (
            <div key={i} className="text-[9px] text-neutral-500">→ {tip}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════

function StatCard({ label, value, alert, warn }: { label: string; value: number; alert?: boolean; warn?: boolean }) {
  const bg = alert ? 'bg-red-950/30 border-red-800/40' : warn ? 'bg-amber-950/20 border-amber-800/30' : 'bg-[#272C33] border-[#3a424d]';
  const valColor = alert ? 'text-red-400' : warn ? 'text-amber-400' : 'text-neutral-100';
  return (
    <div className={`flex-1 px-3 py-2 rounded-lg border ${bg}`}>
      <div className={`text-lg font-bold ${valColor}`}>{value}</div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} title={label}
      className="bg-[#272C33] border border-[#3a424d] text-neutral-300 text-[11px] rounded px-2 py-1.5 focus:outline-none focus:border-[#5ec1ca] appearance-none cursor-pointer">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function SortHeader({ label, field, current, dir, onSort, width }: {
  label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void; width?: string;
}) {
  const active = current === field;
  return (
    <th onClick={() => onSort(field)} className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-neutral-300 transition-colors ${width ?? ''}`}>
      {label} {active ? (dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

function ActionButton({ label, hint, active, onClick, color }: { label: string; hint?: string; active: boolean; onClick: () => void; color: 'cyan' | 'amber' | 'green' | 'neutral' }) {
  const colors = {
    cyan: active ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border-[#5ec1ca]/40' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-[#5ec1ca] hover:border-[#5ec1ca]/30',
    amber: active ? 'bg-amber-900/30 text-amber-400 border-amber-800/40' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-amber-400 hover:border-amber-800/30',
    green: active ? 'bg-green-900/30 text-green-400 border-green-800/40' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-green-400 hover:border-green-800/30',
    neutral: active ? 'bg-neutral-700/50 text-neutral-200 border-neutral-600' : 'bg-transparent text-neutral-400 border-[#3a424d] hover:text-neutral-200 hover:border-neutral-600',
  };
  return (
    <button onClick={onClick} className={`px-3 py-1 text-[11px] font-medium rounded border transition-colors ${colors[color]}`}>
      {label}
      {hint && <kbd className="ml-1.5 text-[8px] text-neutral-600 font-mono">{hint}</kbd>}
    </button>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const color: Record<string, string> = {
    positive: 'bg-green-950/40 text-green-400 border-green-800/40',
    neutral: 'bg-neutral-800/50 text-neutral-400 border-neutral-700/40',
    frustrated: 'bg-amber-950/40 text-amber-400 border-amber-800/40',
    angry: 'bg-red-950/40 text-red-400 border-red-800/40',
    urgent: 'bg-red-950/40 text-red-400 border-red-800/40',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${color[sentiment] ?? color.neutral}`}>{sentiment}</span>;
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-neutral-500 w-20 shrink-0">{label}</span>
      <span className="text-neutral-300 truncate">{value}</span>
    </div>
  );
}
