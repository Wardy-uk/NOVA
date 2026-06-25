import { useCallback, useEffect, useMemo, useState } from 'react';
import { agentInitials } from '../../shared/team-standup.js';

type CommitmentStatus = 'pending' | 'delivered' | 'missed' | 'excused';
type BriefCategory = 'cc' | 'tier2' | 'production' | 'design' | 'other';

interface Submission {
  id: number; agent_name: string; submitted_at: string;
  ticket_count: number | null; over_5_count: number | null;
  oldest_ticket: string | null; oldest_age: number | null;
  blockers: string | null; commitments_json: string | null; notes: string | null;
}
interface Commitment {
  id: number; agent_name: string; commitment_text: string; status: CommitmentStatus; review_note: string | null;
}
interface CarriedCommitment extends Commitment { session_date: string; }
interface BriefTicket {
  key: string; summary: string; assignee: string; tier: string; category: BriefCategory;
  status: string; ageDays: number | null; over5: boolean;
}
interface BriefAgent {
  agent_name: string; tickets: BriefTicket[]; total: number; over5_count: number;
  oldest: { key: string; ageDays: number } | null;
}
interface Brief { generated_at: string; total_tickets: number; agents: BriefAgent[]; }
interface SessionDetail {
  session: { id: number; date: string; status: string; plaud_recording_id: string | null; transcript_text: string | null; notes_text: string | null };
  brief: Brief | null;
  submissions: Submission[];
  commitments: Commitment[];
  carriedOver: CarriedCommitment[];
  report: { stats: { total: number; delivered: number; missed: number; excused: number; pending: number; deliveryRate: number } } | null;
  roster: string[];
}
interface SessionSummary { date: string; status: string; submission_count: number; }

const STATUS_BADGE: Record<CommitmentStatus, { bg: string; fg: string; label: string }> = {
  pending: { bg: 'rgba(245,158,11,0.15)', fg: '#f59e0b', label: 'Pending' },
  delivered: { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'Delivered' },
  missed: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: 'Missed' },
  excused: { bg: 'rgba(100,116,139,0.15)', fg: '#64748b', label: 'Excused' },
};

const FILTERS: Array<{ key: 'all' | BriefCategory | 'over5'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'over5', label: 'Over 5 days' },
  { key: 'cc', label: 'CC' },
  { key: 'tier2', label: '2nd line' },
  { key: 'design', label: 'Design' },
];

function todayUk(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}
function niceDate(d: string): string {
  try { return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch { return d; }
}
function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function StandupView({ token }: { token: string }) {
  const dateFromHash = (() => {
    const q = window.location.hash.split('?')[1];
    const d = q ? new URLSearchParams(q).get('date') : null;
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayUk();
  })();

  const [date, setDate] = useState(dateFromHash);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [displayOrder, setDisplayOrder] = useState<string[] | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | BriefCategory | 'over5'>('all');
  const [search, setSearch] = useState('');

  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }), [token]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([
        fetch(`/api/standup/sessions/${date}`, { headers: authHeaders }).then((r) => r.json()),
        fetch('/api/standup/sessions', { headers: authHeaders }).then((r) => r.json()),
      ]);
      if (d.ok) setDetail(d.data);
      if (s.ok) setSessions(s.data);
    } finally {
      setLoading(false);
    }
  }, [date, authHeaders]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  const isToday = date === todayUk();

  async function refreshBrief() {
    setBusy('brief');
    try {
      const r = await fetch(`/api/standup/brief/${date}`, { headers: authHeaders }).then((x) => x.json());
      setToast(r.ok ? `Brief refreshed — ${r.data.total_tickets} tickets` : `Brief failed: ${r.error}`);
      if (r.ok) await load();
    } finally { setBusy(null); }
  }
  async function pollPlaud() {
    setBusy('plaud');
    try {
      const r = await fetch(`/api/standup/poll-plaud/${date}`, { method: 'POST', headers: authHeaders }).then((x) => x.json());
      setToast(r.ok ? (r.data.found ? (r.data.alreadyImported ? 'Already imported' : 'Recording imported') : 'No standup recording found yet') : `Plaud error: ${r.error}`);
      if (r.ok) await load();
    } finally { setBusy(null); }
  }
  async function sendPrompts() {
    setBusy('prompts');
    try {
      const r = await fetch(`/api/standup/send-prompts/${date}`, { method: 'POST', headers: authHeaders }).then((x) => x.json());
      setToast(r.ok ? `Prompts: sent ${r.data.sent}, skipped ${r.data.skipped}, failed ${r.data.failed}` : `Failed: ${r.error}`);
    } finally { setBusy(null); }
  }
  async function setStatus(status: string) {
    setBusy('status');
    try {
      await fetch(`/api/standup/sessions/${date}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ status }) });
      await load();
    } finally { setBusy(null); }
  }
  async function startStandup() {
    const names = detail?.roster ?? [];
    if (names.length > 1) {
      setShuffling(true);
      await new Promise<void>((resolve) => {
        let ticks = 0;
        const maxTicks = 12;
        const iv = setInterval(() => {
          ticks += 1;
          setDisplayOrder(shuffleArr(names));
          if (ticks >= maxTicks) { clearInterval(iv); resolve(); }
        }, 110);
      });
      setShuffling(false);
    }
    await setStatus('active');
  }
  async function updateCommitment(id: number, status: CommitmentStatus, review_note?: string) {
    const r = await fetch(`/api/standup/commitments/${id}`, { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ status, review_note: review_note ?? null }) }).then((x) => x.json());
    if (r.ok) {
      setDetail((prev) => prev ? {
        ...prev,
        commitments: prev.commitments.map((c) => c.id === id ? { ...c, status, review_note: review_note ?? c.review_note } : c),
        carriedOver: prev.carriedOver.map((c) => c.id === id ? { ...c, status, review_note: review_note ?? c.review_note } : c),
      } : prev);
    }
  }
  async function markAllDelivered(agent: string) {
    const ids = (detail?.commitments ?? []).filter((c) => c.agent_name === agent && c.status === 'pending').map((c) => c.id);
    await Promise.all(ids.map((id) => updateCommitment(id, 'delivered')));
  }

  const roster = detail?.roster ?? [];
  const submittedNames = new Set((detail?.submissions ?? []).map((s) => s.agent_name));
  const submissionByName = new Map((detail?.submissions ?? []).map((s) => [s.agent_name, s]));

  // Brief filtering
  const filteredBriefAgents = useMemo(() => {
    const agents = detail?.brief?.agents ?? [];
    const q = search.trim().toLowerCase();
    return agents
      .map((a) => {
        const tickets = a.tickets.filter((t) => {
          if (filter === 'over5' && !t.over5) return false;
          if (filter !== 'all' && filter !== 'over5' && t.category !== filter) return false;
          if (q && !(t.key.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q))) return false;
          return true;
        });
        return { ...a, tickets };
      })
      .filter((a) => a.tickets.length > 0);
  }, [detail, filter, search]);

  const commitmentsByAgent = useMemo(() => {
    const map = new Map<string, Commitment[]>();
    for (const c of detail?.commitments ?? []) {
      const list = map.get(c.agent_name) ?? [];
      list.push(c);
      map.set(c.agent_name, list);
    }
    return map;
  }, [detail]);

  // Still-open commitments carried over from earlier sessions, grouped by agent.
  const carriedByAgent = useMemo(() => {
    const map = new Map<string, CarriedCommitment[]>();
    for (const c of detail?.carriedOver ?? []) {
      if (c.status !== 'pending') continue; // drop as they're reviewed
      const list = map.get(c.agent_name) ?? [];
      list.push(c);
      map.set(c.agent_name, list);
    }
    return map;
  }, [detail]);
  const carriedCount = useMemo(() => [...carriedByAgent.values()].reduce((n, l) => n + l.length, 0), [carriedByAgent]);

  // Filtered brief agents keyed by name for the per-agent merged cards.
  const briefByName = useMemo(() => new Map(filteredBriefAgents.map((a) => [a.agent_name, a])), [filteredBriefAgents]);

  // Card order — shuffled on Start standup, otherwise roster order.
  const displayRoster = useMemo(() => {
    if (displayOrder && displayOrder.length === roster.length && displayOrder.every((n) => roster.includes(n))) return displayOrder;
    return roster;
  }, [displayOrder, roster]);

  const stats = detail?.report?.stats;

  return (
    <div className="max-w-[94rem] mx-auto px-4 py-5 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-neutral-100">Standup</h1>
          <span className="text-sm text-neutral-400">{niceDate(date)}{isToday && ' · Today'}</span>
          {detail?.session && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#2f353d] border border-[#3a424d] text-neutral-300">{detail.session.status}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select value={date} onChange={(e) => setDate(e.target.value)} className="bg-[#2f353d] border border-[#3a424d] rounded px-2 py-1.5 text-xs text-neutral-200">
            {!sessions.some((s) => s.date === todayUk()) && <option value={todayUk()}>{niceDate(todayUk())} · Today</option>}
            {sessions.map((s) => <option key={s.date} value={s.date}>{niceDate(s.date)} · {s.submission_count} subs</option>)}
          </select>
          {!isToday && <button onClick={() => setDate(todayUk())} className="px-3 py-1.5 text-xs rounded bg-[#2f353d] text-neutral-300 hover:bg-[#363d47]">Today</button>}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <button onClick={sendPrompts} disabled={!!busy} className="px-3 py-1.5 text-xs rounded bg-[#2f353d] text-neutral-200 hover:bg-[#363d47] disabled:opacity-50">{busy === 'prompts' ? 'Sending…' : 'Send prompts'}</button>
        {detail?.session?.status === 'pending' && <button onClick={startStandup} disabled={!!busy || shuffling} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50">{shuffling ? '🎲 Shuffling…' : 'Start standup'}</button>}
        {detail?.session?.status === 'active' && <button onClick={() => setStatus('complete')} disabled={!!busy} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50">Complete</button>}
        {detail?.session?.status === 'complete' && <button onClick={() => setStatus('pending')} disabled={!!busy} className="px-3 py-1.5 text-xs rounded bg-[#2f353d] text-neutral-300 hover:bg-[#363d47] disabled:opacity-50">Reopen</button>}
      </div>

      {toast && <div className="text-xs text-[#5ec1ca] bg-[#5ec1ca]/10 border border-[#5ec1ca]/30 rounded-lg px-3 py-2">{toast}</div>}
      {loading && <div className="text-sm text-neutral-500">Loading…</div>}

      {/* Controls — submission tally, brief filters/search, accountability stats */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mr-1">
          Agents — {submittedNames.size}/{roster.length} submitted
        </span>
        {detail?.brief && FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`px-2.5 py-1 text-[11px] rounded-full border ${filter === f.key ? 'bg-[#5ec1ca] text-[#272C33] border-[#5ec1ca] font-semibold' : 'bg-[#272C33] text-neutral-400 border-[#3a424d] hover:text-neutral-200'}`}>{f.label}</button>
        ))}
        {detail?.brief && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search key or summary…" className="bg-[#272C33] border border-[#3a424d] rounded px-2.5 py-1 text-xs text-neutral-200 placeholder-neutral-500 w-44" />
        )}
        <button onClick={refreshBrief} disabled={!!busy} className="px-2.5 py-1 text-[11px] rounded bg-[#2f353d] text-neutral-300 hover:bg-[#363d47] disabled:opacity-50">{busy === 'brief' ? 'Loading…' : detail?.brief ? 'Refresh brief' : 'Load brief'}</button>
        {stats && (
          <div className="ml-auto flex items-center gap-3 text-xs">
            <span className="text-neutral-400">{stats.total} total</span>
            <span className="text-emerald-400">{stats.delivered} delivered</span>
            <span className="text-red-400">{stats.missed} missed</span>
            <span className="text-amber-400">{stats.pending} pending</span>
            <span className="text-neutral-300 font-semibold">{stats.deliveryRate}%</span>
          </div>
        )}
      </div>

      {/* Merged per-agent cards: submission · Jira brief · accountability */}
      <div className="space-y-3">
        {displayRoster.map((name) => {
          const sub = submissionByName.get(name);
          const submitted = !!sub;
          let commitmentCount = 0;
          let commitmentList: string[] = [];
          try { commitmentList = sub?.commitments_json ? JSON.parse(sub.commitments_json) as string[] : []; commitmentCount = commitmentList.length; } catch { /* */ }
          const briefAgent = briefByName.get(name);
          const commits = commitmentsByAgent.get(name) ?? [];
          const carried = carriedByAgent.get(name) ?? [];
          const open = expandedAgent === name;
          return (
            <div key={name} className={`rounded-lg border overflow-hidden transition-all duration-200 ease-out ${shuffling ? 'animate-pulse scale-[0.98] ring-1 ring-[#5ec1ca]/40' : ''} ${submitted ? 'border-[#3a424d] bg-[#2f353d]' : 'border-[#3a424d]/50 bg-[#2f353d]/40'}`}>
              {/* Header — retains submission summary detail; toggles the card */}
              <button onClick={() => setExpandedAgent(open ? null : name)} className={`w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-[#363d47] ${open ? 'border-b border-[#3a424d]' : ''}`}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${submitted ? 'bg-[#5ec1ca]/20 text-[#5ec1ca]' : 'bg-neutral-700/40 text-neutral-500'}`}>{agentInitials(name)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-neutral-100 truncate">{name}</span>
                  {submitted
                    ? <span className="block text-[11px] text-neutral-400">{sub!.ticket_count ?? '–'} tickets · {sub!.over_5_count ?? '–'} over 5 · {commitmentCount} commit.</span>
                    : <span className="block text-[11px] text-neutral-500">Not submitted</span>}
                </span>
                <span className={submitted ? 'text-emerald-400' : 'text-amber-400'}>{submitted ? '✓' : '◷'}</span>
                <span className={`text-neutral-500 transition-transform text-xs ${open ? 'rotate-90' : ''}`}>▸</span>
              </button>

              {open && (
              <div className="grid grid-cols-1 lg:grid-cols-3 lg:divide-x divide-[#3a424d]/70">
                {/* Submission */}
                <div className="p-4 space-y-2">
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Submission</h4>
                  {submitted ? (
                    <div className="text-xs space-y-2">
                      <div><span className="text-neutral-500">Oldest:</span> <span className="text-neutral-200">{sub!.oldest_ticket ?? '–'} {sub!.oldest_age != null ? `(${sub!.oldest_age}d)` : ''}</span></div>
                      {sub!.blockers && <div><span className="text-neutral-500">Blockers:</span> <span className="text-neutral-200">{sub!.blockers}</span></div>}
                      {commitmentCount > 0 && (
                        <div>
                          <span className="text-neutral-500">Commitments:</span>
                          <ul className="mt-1 space-y-1 list-disc list-inside text-neutral-200">
                            {commitmentList.map((c, i) => <li key={i}>{c}</li>)}
                          </ul>
                        </div>
                      )}
                      {sub!.notes && <div><span className="text-neutral-500">Notes:</span> <span className="text-neutral-200">{sub!.notes}</span></div>}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">Not submitted yet.</p>
                  )}
                </div>

                {/* Jira brief */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Jira brief</h4>
                    {briefAgent && briefAgent.over5_count > 0 && <span className="w-2 h-2 rounded-full bg-red-500" title={`${briefAgent.over5_count} over 5 days`} />}
                    {briefAgent && <span className="text-[11px] text-neutral-500 ml-auto">{briefAgent.tickets.length} ticket{briefAgent.tickets.length !== 1 ? 's' : ''}</span>}
                  </div>
                  {!detail?.brief ? (
                    <p className="text-xs text-neutral-500">No brief loaded. Use "Load brief".</p>
                  ) : briefAgent ? (
                    <div className="space-y-1">
                      {briefAgent.tickets.map((t) => (
                        <div key={t.key} className="flex items-center gap-2 text-xs py-1 border-t border-[#3a424d]/40 first:border-t-0">
                          {t.over5 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />}
                          <a href={`https://nurtur.atlassian.net/browse/${t.key}`} target="_blank" rel="noreferrer" className="text-[#5ec1ca] hover:underline shrink-0">{t.key}</a>
                          <span className="text-neutral-300 flex-1 truncate">{t.summary}</span>
                          <span className="text-neutral-500 shrink-0">{t.ageDays != null ? `${t.ageDays}d` : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-500">No tickets match.</p>
                  )}
                </div>

                {/* Accountability */}
                <div className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Accountability</h4>
                    {commits.some((c) => c.status === 'pending') && (
                      <button onClick={() => markAllDelivered(name)} className="ml-auto text-[11px] text-[#5ec1ca] hover:underline">Mark all delivered</button>
                    )}
                  </div>
                  {carried.length > 0 && (
                    <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 space-y-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Carried over — to review</span>
                      {carried.map((c) => <CommitmentRow key={c.id} c={c} onUpdate={updateCommitment} fromDate={c.session_date} />)}
                    </div>
                  )}
                  {commits.length > 0 ? (
                    <div className="space-y-1.5">
                      {commits.map((c) => <CommitmentRow key={c.id} c={c} onUpdate={updateCommitment} />)}
                    </div>
                  ) : (
                    carried.length === 0 && <p className="text-xs text-neutral-500">No commitments captured.</p>
                  )}
                </div>
              </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Plaud import — stays underneath */}
      <section className="rounded-lg border border-[#3a424d] bg-[#2f353d] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Plaud recording</h2>
          <button onClick={pollPlaud} disabled={!!busy} className="px-2.5 py-1 text-[11px] rounded bg-[#272C33] text-neutral-300 hover:bg-[#363d47] disabled:opacity-50">{busy === 'plaud' ? 'Polling…' : 'Poll Plaud'}</button>
        </div>
        <p className="text-sm mt-2">
          {detail?.session?.transcript_text
            ? <span className="text-emerald-400">✓ Transcript imported{detail.session.plaud_recording_id ? ` (${detail.session.plaud_recording_id.slice(0, 8)}…)` : ''}</span>
            : <span className="text-neutral-500">No recording imported yet.</span>}
        </p>
        {detail?.session?.notes_text && (
          <details className="mt-3">
            <summary className="text-xs text-[#5ec1ca] cursor-pointer">Notes</summary>
            <pre className="mt-2 text-xs text-neutral-300 whitespace-pre-wrap font-sans bg-[#272C33] rounded p-3 max-h-72 overflow-auto">{detail.session.notes_text}</pre>
          </details>
        )}
        {detail?.session?.transcript_text && (
          <details className="mt-2">
            <summary className="text-xs text-[#5ec1ca] cursor-pointer">Transcript</summary>
            <pre className="mt-2 text-xs text-neutral-400 whitespace-pre-wrap font-sans bg-[#272C33] rounded p-3 max-h-72 overflow-auto">{detail.session.transcript_text}</pre>
          </details>
        )}
      </section>
    </div>
  );
}

function CommitmentRow({ c, onUpdate, fromDate }: { c: Commitment; onUpdate: (id: number, s: CommitmentStatus, note?: string) => void; fromDate?: string }) {
  const [noteFor, setNoteFor] = useState<CommitmentStatus | null>(null);
  const [note, setNote] = useState('');
  const badge = STATUS_BADGE[c.status];

  function act(status: CommitmentStatus) {
    if (status === 'missed' || status === 'excused') { setNoteFor(status); return; }
    onUpdate(c.id, status);
  }
  function saveNote() {
    if (noteFor) onUpdate(c.id, noteFor, note.trim() || undefined);
    setNoteFor(null); setNote('');
  }

  return (
    <div className="rounded border border-[#3a424d]/60 bg-[#272C33] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm text-neutral-200">
          {c.commitment_text}
          {fromDate && <span className="ml-2 text-[10px] text-amber-400/80">· {niceDate(fromDate)}</span>}
        </span>
        <span style={{ background: badge.bg, color: badge.fg, border: `1px solid ${badge.fg}40` }} className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0">{badge.label}</span>
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <button onClick={() => act('delivered')} className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25">Delivered</button>
        <button onClick={() => act('missed')} className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25">Missed</button>
        <button onClick={() => act('excused')} className="text-[11px] px-2 py-0.5 rounded bg-slate-500/15 text-slate-400 hover:bg-slate-500/25">Excused</button>
        {c.review_note && <span className="text-[11px] text-neutral-500 ml-1 truncate">— {c.review_note}</span>}
      </div>
      {noteFor && (
        <div className="flex gap-2 mt-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder={`Optional note for ${noteFor}…`} className="flex-1 bg-[#2f353d] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" onKeyDown={(e) => { if (e.key === 'Enter') saveNote(); }} />
          <button onClick={saveNote} className="text-[11px] px-2.5 py-1 rounded bg-[#5ec1ca] text-[#272C33] font-semibold">Save</button>
        </div>
      )}
    </div>
  );
}
