import { useEffect, useState } from 'react';
import { PlaudScanModal } from './PlaudScanModal.js';

/* 1-2-1 Overview — manager dashboard of whole-team 1-2-1 health. Read-only summary;
   the My Team grid and click-through stay the place to act. People → 1-2-1 Overview. */

const C = {
  bg1: '#272C33', bg2: '#2f353d', glass: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)',
  teal: '#5ec1ca', green: '#10b981', amber: '#f59e0b', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
};

interface OverviewAgent {
  agent_name: string; nextDate: string | null; nextStatus: string | null;
  overdue: boolean; dueThisWeek: boolean; stalled: boolean; awaitingPrep: boolean; prepSubmitted: boolean;
  lastDate: string | null; lastSessionId: number | null; lastLoggedInPeopleHr: boolean;
  outstandingActions: number; awaitingConfirmation: number;
  delivered: number; missed: number; deliveryRate: number | null;
}
interface Overview {
  agents: OverviewAgent[];
  summary: { total: number; scheduled: number; overdue: number; dueThisWeek: number; stalled: number; awaitingPrep: number; awaitingConfirmation: number; neverScheduled: number; deliveryRate: number | null;
    peoplehrPending: number };
}

interface Candidate {
  id: number; plaud_id: string; agent_name: string | null; meeting_date: string | null;
  title: string | null; note_path: string | null; attribution: string | null;
  conversation_type: string | null;
  participants: string | null; started_at: string | null;
  duration_minutes: number | null; summary_excerpt: string | null;
  preview?: string; transcript_chars?: number;
}

interface Drift {
  checked: boolean; error?: string;
  notOnRoster: Array<{ agentName: string; nearMatch: string | null }>;
  noPlan: string[];
}

/** "14:02" from a PLAUD `start_at`, in London time.
 *
 * Plaud's API returns UTC with no marker on it — `2026-08-19T13:02:21` for a 1-2-1 that
 * started at 14:02, which Plaud's own web UI shows as 14:02. This used to read the digits
 * straight off the string on the assumption they were local wall-clock, so every recording
 * made in BST displayed an hour early, and every one made in winter looked fine, which is
 * why it took a while to notice.
 *
 * Parse as UTC and format for London: correct in BST, correct in GMT, and correct on the
 * two days a year the offset moves. A timestamp that already carries a zone is trusted as
 * it stands, so this stays right if the payload ever starts sending one. */
const LONDON_HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
});
const startTime = (s: string | null): string | null => {
  const raw = String(s ?? '').trim();
  if (!raw) return null;
  const t = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(t.getTime()) ? null : LONDON_HHMM.format(t);
};

/* Kept in step with CONVERSATION_TYPES in one21-candidates.ts. Only `one_to_one` reaches
   agent_121_sessions and so only it moves the cadence clock — the rest go on the person's
   record without marking them as seen this month. */
const CONVERSATION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'one_to_one', label: '1-2-1' },
  { value: 'return_to_work', label: 'Return to work' },
  { value: 'performance', label: 'Performance' },
  { value: 'welfare', label: 'Welfare' },
  { value: 'ad_hoc', label: 'Ad-hoc' },
];

const d = (s: string | null) => s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

export function OneToOneOverviewView() {
  const [data, setData] = useState<Overview | null>(null);
  const [drift, setDrift] = useState<Drift | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [busyCandidate, setBusyCandidate] = useState<number | null>(null);
  const [candidateAgent, setCandidateAgent] = useState<Record<number, string>>({});
  const [candidateType, setCandidateType] = useState<Record<number, string>>({});
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'urgency' | 'next' | 'last'>('urgency');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [editing, setEditing] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [savingHr, setSavingHr] = useState<number | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);

  const load = (keepLoading = false) => {
    if (!keepLoading) setLoading(true);
    fetch('/api/121/overview').then((r) => r.json()).then((j) => { if (j.ok) setData(j.data); }).finally(() => setLoading(false));
    // Separate and non-blocking: drift reads the KPI pool, which is slower and flakier
    // than NOVA's own DB, and the overview must still render when it is down.
    fetch('/api/121/roster-drift').then((r) => r.json()).then((j) => { if (j.ok) setDrift(j.data); }).catch(() => {});
    fetch('/api/121/transcript-candidates').then((r) => r.json()).then((j) => { if (j.ok) setCandidates(j.data); }).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const toggleSort = (key: 'next' | 'last') => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('asc'); }
  };

  /**
   * Close someone's development plan. Their sessions, actions and history stay exactly
   * where they are — every 1-2-1 query filters on `status IN ('active','deferred')`, so
   * archiving simply stops them counting. Nothing is deleted.
   */
  const archivePlan = async (agentName: string) => {
    if (!window.confirm(`Archive ${agentName}'s development plan?\n\nThey stop counting towards 1-2-1 health. All their history is kept, and you can reinstate them by setting the plan active again.`)) return;
    setArchiving(agentName);
    try {
      await fetch(`/api/people/agent/${encodeURIComponent(agentName)}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      load(true);
    } catch { /* the panel re-renders from the reload either way */ }
    setArchiving(null);
  };

  /**
   * Approve a detected transcript — binds it to that person's 1-2-1 and lets the
   * extractor read it. `agentName` is whatever the dropdown says, so NEURO's guess can be
   * corrected here; that correction is the reason this step is manual at all.
   */
  const resolveCandidate = async (c: Candidate, approve: boolean) => {
    const agent = candidateAgent[c.id] ?? c.agent_name ?? '';
    if (approve && !agent) { setCandidateError('Pick who this 1-2-1 was with first.'); return; }
    setBusyCandidate(c.id);
    setCandidateError(null);
    try {
      const res = await fetch(`/api/121/transcript-candidate/${c.id}/${approve ? 'approve' : 'reject'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approve
          ? { agentName: agent, conversationType: candidateType[c.id] ?? c.conversation_type ?? 'one_to_one' }
          : {}),
      });
      const json = await res.json();
      if (!json.ok) setCandidateError(json.error || 'Could not save that.');
      else setCandidates((prev) => prev.filter((x) => x.id !== c.id));
      if (json.ok) load(true);
    } catch { setCandidateError('Network error.'); }
    setBusyCandidate(null);
  };

  const saveNext = async (agentName: string, date: string) => {
    setSavingDate(agentName);
    try {
      if (date) {
        await fetch(`/api/people/agent/${encodeURIComponent(agentName)}/next-121`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date }),
        });
      } else {
        await fetch(`/api/people/agent/${encodeURIComponent(agentName)}/next-121/cancel`, { method: 'POST' });
      }
      load(true);
    } catch { /* ignore */ }
    setSavingDate(null);
    setEditing(null);
  };

  /**
   * Tick a 1-2-1 off as written up in PeopleHR.
   *
   * Optimistic, because the whole point is ticking several in a row and a reload between
   * each would make that feel broken. Reverted on failure rather than left showing a tick
   * NOVA did not save — this is a record of what Nick has actually done, so a lie here is
   * worse than a spinner.
   */
  const toggleHr = async (sessionId: number, logged: boolean) => {
    setSavingHr(sessionId);
    setData((prev) => prev && {
      ...prev,
      agents: prev.agents.map((a) => (a.lastSessionId === sessionId ? { ...a, lastLoggedInPeopleHr: logged } : a)),
      summary: { ...prev.summary, peoplehrPending: prev.summary.peoplehrPending + (logged ? -1 : 1) },
    });
    try {
      const r = await fetch(`/api/121/session/${sessionId}/peoplehr`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logged }),
      });
      if (!r.ok) throw new Error('save failed');
    } catch {
      load(true);
    }
    setSavingHr(null);
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>Loading…</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>No data.</div>;

  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = [...data.agents].sort((a, b) => {
    if (sortBy === 'next' || sortBy === 'last') {
      const key = sortBy === 'next' ? 'nextDate' : 'lastDate';
      const av = a[key], bv = b[key];
      if (!av && !bv) return a.agent_name.localeCompare(b.agent_name);
      if (!av) return 1;   // nulls always last regardless of direction
      if (!bv) return -1;
      return av.localeCompare(bv) * dir;
    }
    const rank = (x: OverviewAgent) => x.stalled ? 0 : x.overdue ? 1 : x.awaitingPrep ? 2 : x.dueThisWeek ? 3 : x.nextDate ? 4 : 5;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999');
  });
  const sortArrow = (key: 'next' | 'last') => (sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div style={{ padding: '4px 4px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text1, margin: 0 }}>1-2-1 Overview</h2>
          <p style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>{data.summary.total} agents · whole-team 1-2-1 health at a glance</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setScanOpen(true)} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.teal}`, background: `${C.teal}18`, color: C.teal, cursor: 'pointer', fontSize: 12, fontWeight: 600 }} title="Scan all of Plaud for 1-2-1 recordings">🎙 Scan Plaud</button>
          {/* `onClick={load}` handed React's click event straight to `keepLoading`, which
              is truthy — so the refresh button never actually showed a loading state. */}
          <button onClick={() => load()} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.glass, color: C.text2, cursor: 'pointer', fontSize: 15 }} title="Refresh">↻</button>
        </div>
      </div>

      {scanOpen && <PlaudScanModal onClose={() => setScanOpen(false)} onAssigned={load} />}

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Tile label="Overdue" value={data.summary.overdue} color={data.summary.overdue > 0 ? C.red : C.text2} />
        <Tile label="Stalled" value={data.summary.stalled} color={data.summary.stalled > 0 ? C.red : C.text2}
          hint="Opened but never completed — blocks prep and the next booking" />
        <Tile label="Awaiting prep" value={data.summary.awaitingPrep} color={data.summary.awaitingPrep > 0 ? C.amber : C.text2} />
        <Tile label="To confirm" value={data.summary.awaitingConfirmation} color={data.summary.awaitingConfirmation > 0 ? C.teal : C.text2}
          hint="Closed per a 1-2-1 recording — confirmed at the next 1-2-1. Not counted as delivered until then." />
        <Tile label="To log in PeopleHR" value={data.summary.peoplehrPending} color={data.summary.peoplehrPending > 0 ? C.amber : C.text2}
          hint="Held 1-2-1s you have not yet ticked as written up. NOVA cannot see PeopleHR — this counts your own ticks." />
        <Tile label="Due this week" value={data.summary.dueThisWeek} color={C.teal} />
        <Tile label="Scheduled" value={data.summary.scheduled} color={C.text2} />
        <Tile label="Never scheduled" value={data.summary.neverScheduled} color={data.summary.neverScheduled > 0 ? C.amber : C.text2} />
        <Tile label="Action delivery" value={data.summary.deliveryRate === null ? '—' : `${data.summary.deliveryRate}%`} color={ratePctColor(data.summary.deliveryRate)} />
      </div>

      {/* Detected Plaud transcripts — proposed, never applied. Attribution is a guess,
          and a wrong bind writes one person's conversation onto another's record. */}
      {candidates.length > 0 && (
        <div style={{ background: `${C.teal}0e`, border: `1px solid ${C.teal}45`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.teal, marginBottom: 2 }}>
            🎙 {candidates.length} Plaud transcript{candidates.length === 1 ? '' : 's'} detected
          </div>
          <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>
            Nothing is attached until you approve it. Check who it was with AND what kind of conversation it was —
            both are NEURO's best guess, not facts, and only a 1-2-1 counts towards the cadence.
          </div>
          {candidateError && <div style={{ fontSize: 12, color: C.red, marginBottom: 8 }}>{candidateError}</div>}
          {candidates.map((c) => (
            <div key={c.id} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: C.text1, fontWeight: 600 }}>{c.title || '(untitled recording)'}</div>
              <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>
                {c.meeting_date ? d(c.meeting_date) : 'no date'}
                {/* The TIME matters: several 1-2-1s happen on one day, and the date alone
                    does not say which conversation this is. */}
                {startTime(c.started_at) ? ` at ${startTime(c.started_at)}` : ''}
                {c.duration_minutes ? ` · ${c.duration_minutes} min` : ''}
                {c.transcript_chars
                  ? ` · transcript ${Math.round(c.transcript_chars / 1000)}k chars`
                  : ' · ⚠ no transcript — nothing to extract from'}
              </div>
              {/* Who Plaud actually heard. This is the single most useful line for
                  deciding, and the reason attribution stopped being a title guess. */}
              {c.participants && (
                <div style={{ fontSize: 12, color: C.text2, marginTop: 5 }}>
                  <span style={{ color: C.text3 }}>In the room: </span>{c.participants}
                </div>
              )}
              <div style={{ fontSize: 11, color: C.text3, marginTop: 3, fontStyle: 'italic' }}>
                {c.attribution ? `NEURO: ${c.attribution}` : 'no attribution'}
                {c.note_path ? ` · ${c.note_path}` : ''}
              </div>
              {c.summary_excerpt && (
                <details style={{ marginTop: 7 }}>
                  <summary style={{ fontSize: 11.5, color: C.teal, cursor: 'pointer' }}>What was discussed</summary>
                  <div style={{
                    fontSize: 12, color: C.text2, marginTop: 6, whiteSpace: 'pre-wrap',
                    maxHeight: 260, overflowY: 'auto', paddingRight: 6, lineHeight: 1.5,
                  }}>{c.summary_excerpt}</div>
                </details>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 9, flexWrap: 'wrap' }}>
                <select
                  value={candidateAgent[c.id] ?? c.agent_name ?? ''}
                  onChange={(e) => setCandidateAgent((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
                >
                  <option value="">— who was this with? —</option>
                  {data.agents.map((a) => <option key={a.agent_name} value={a.agent_name}>{a.agent_name}</option>)}
                </select>
                {/* The type is the more consequential of the two dropdowns. Only a 1-2-1
                    moves the cadence clock, so filing a welfare check as one would mark
                    the person as seen this month and stop their real 1-2-1 being booked. */}
                <select
                  value={candidateType[c.id] ?? c.conversation_type ?? 'one_to_one'}
                  onChange={(e) => setCandidateType((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  title="What kind of conversation was this? Only a 1-2-1 counts towards the cadence."
                  style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
                >
                  {CONVERSATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button
                  onClick={() => resolveCandidate(c, true)}
                  disabled={busyCandidate === c.id}
                  style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: `1px solid ${C.green}`, background: `${C.green}20`, color: C.green, cursor: 'pointer' }}
                >{busyCandidate === c.id ? 'Working…' : 'Add to record'}</button>
                <button
                  onClick={() => resolveCandidate(c, false)}
                  disabled={busyCandidate === c.id}
                  style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.text3, cursor: 'pointer' }}
                >Not a conversation</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Roster drift — only when there is something to say */}
      {drift && (drift.notOnRoster.length > 0 || drift.noPlan.length > 0) && (
        <div style={{ background: C.glass, border: `1px solid ${C.amber}40`, borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.amber, marginBottom: 8 }}>Roster drift</div>
          {drift.notOnRoster.length > 0 && (
            <div style={{ fontSize: 12.5, color: C.text2, marginBottom: 6 }}>
              <strong style={{ color: C.text1 }}>Has a 1-2-1 plan but is not an active agent:</strong>
              <div style={{ marginTop: 6 }}>
                {drift.notOnRoster.map((x) => (
                  <div key={x.agentName} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ color: C.text1 }}>{x.agentName}</span>
                    {x.nearMatch && <span style={{ color: C.text3, fontSize: 11.5 }}>did you mean “{x.nearMatch}”?</span>}
                    <button
                      onClick={() => archivePlan(x.agentName)}
                      disabled={archiving === x.agentName}
                      title="Close their development plan — keeps all history, stops them counting towards 1-2-1 health"
                      style={{
                        padding: '2px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                        border: `1px solid ${C.border}`, background: 'transparent',
                        color: archiving === x.agentName ? C.text3 : C.amber, cursor: 'pointer',
                      }}
                    >{archiving === x.agentName ? 'Archiving…' : 'Archive plan'}</button>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>
                They still appear in every count above. Archiving keeps their history and past 1-2-1s —
                it only takes them off the roster. Don't archive a near-match: fix the name instead.
              </div>
            </div>
          )}
          {drift.noPlan.length > 0 && (
            <div style={{ fontSize: 12.5, color: C.text2 }}>
              <strong style={{ color: C.text1 }}>On the team but has no 1-2-1 plan:</strong> {drift.noPlan.join(', ')}
              <div style={{ fontSize: 11, color: C.text3, marginTop: 3 }}>
                Invisible to the 1-2-1 loop entirely — they will never be scheduled or prepped.
              </div>
            </div>
          )}
        </div>
      )}
      {drift && !drift.checked && (
        <div style={{ fontSize: 11.5, color: C.text3, marginBottom: 16 }}>
          {/* Absence of evidence, said out loud — a silent panel here would read as "no drift". */}
          Roster drift not checked: {drift.error || 'the KPI roster could not be read'}.
        </div>
      )}

      {/* Per-agent table */}
      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1.2fr 0.8fr 1fr 0.8fr', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <div>Agent</div>
          <div onClick={() => toggleSort('next')} style={{ cursor: 'pointer', color: sortBy === 'next' ? C.teal : C.text3, userSelect: 'none' }}>Next 1-2-1{sortArrow('next')}</div>
          <div onClick={() => toggleSort('last')} style={{ cursor: 'pointer', color: sortBy === 'last' ? C.teal : C.text3, userSelect: 'none' }}>Last{sortArrow('last')}</div>
          <div>Status</div><div>Open actions</div><div>Delivery</div>
          <div title="Ticked by hand once the 1-2-1 is written up in PeopleHR — NOVA cannot check this itself">PeopleHR</div>
        </div>
        {sorted.map((a) => (
          <div key={a.agent_name} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1.2fr 0.8fr 1fr 0.8fr', gap: 8, padding: '11px 16px', borderBottom: `1px solid ${C.border}`, alignItems: 'center', fontSize: 13 }}>
            <div style={{ color: C.text1, fontWeight: 600 }}>{a.agent_name}</div>
            {editing === a.agent_name ? (
              <input
                type="date"
                autoFocus
                defaultValue={a.nextDate ?? ''}
                disabled={savingDate === a.agent_name}
                onBlur={() => setEditing(null)}
                onChange={(e) => saveNext(a.agent_name, e.target.value)}
                style={{ width: 130, padding: '3px 6px', fontSize: 12, background: C.bg2, color: C.text1, border: `1px solid ${C.teal}`, borderRadius: 5, colorScheme: 'dark' }}
              />
            ) : (
              <div
                onClick={() => setEditing(a.agent_name)}
                title="Click to set / reschedule the next 1-2-1"
                style={{ cursor: 'pointer', color: a.overdue ? C.red : (a.nextDate ? C.text2 : C.teal), fontWeight: a.overdue ? 700 : 400, textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
              >{savingDate === a.agent_name ? '…' : (a.nextDate ? d(a.nextDate) : '+ set')}</div>
            )}
            <div style={{ color: C.text3 }}>{d(a.lastDate)}</div>
            <div>{statusChip(a)}</div>
            <div style={{ color: a.outstandingActions > 0 ? C.text1 : C.text3 }}>{a.outstandingActions || '—'}</div>
            <div style={{ color: ratePctColor(a.deliveryRate), fontWeight: 600 }}>
              {a.deliveryRate === null ? '—' : `${a.deliveryRate}%`}
              {(a.delivered + a.missed) > 0 && <span style={{ color: C.text3, fontWeight: 400, fontSize: 11 }}> ({a.delivered}/{a.delivered + a.missed})</span>}
            </div>
            {/* Only a 1-2-1 that has actually HAPPENED can be written up, so somebody with
                no held session gets a dash rather than an un-tickable box. */}
            <div>
              {a.lastSessionId === null ? (
                <span style={{ color: C.text3 }}>—</span>
              ) : (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}
                  title={a.lastLoggedInPeopleHr
                    ? `${d(a.lastDate)} 1-2-1 is logged in PeopleHR — click to undo`
                    : `Tick once the ${d(a.lastDate)} 1-2-1 is written up in PeopleHR`}>
                  <input
                    type="checkbox"
                    checked={a.lastLoggedInPeopleHr}
                    disabled={savingHr === a.lastSessionId}
                    onChange={(e) => toggleHr(a.lastSessionId as number, e.target.checked)}
                    style={{ accentColor: C.teal, cursor: 'pointer', width: 15, height: 15 }}
                  />
                  <span style={{ fontSize: 11, color: a.lastLoggedInPeopleHr ? C.text3 : C.amber }}>
                    {a.lastLoggedInPeopleHr ? 'Logged' : 'To log'}
                  </span>
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ratePctColor(r: number | null): string {
  if (r === null) return C.text3;
  return r >= 80 ? C.green : r >= 50 ? C.amber : C.red;
}

function statusChip(a: OverviewAgent) {
  let label: string, color: string;
  // Stalled first — a stalled session is also technically overdue, but "you opened it and
  // never finished it" is the actionable half and it blocks everything downstream.
  if (a.stalled) { label = 'Stalled'; color = C.red; }
  else if (a.overdue) { label = 'Overdue'; color = C.red; }
  else if (a.awaitingPrep) { label = 'Awaiting prep'; color = C.amber; }
  else if (a.prepSubmitted) { label = 'Prep in'; color = C.green; }
  else if (a.dueThisWeek) { label = 'Due this week'; color = C.teal; }
  else if (a.nextDate) { label = 'Scheduled'; color = C.text2; }
  else { label = 'Not scheduled'; color = C.text3; }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}1f`, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 8px' }}>{label}</span>
  );
}

function Tile({ label, value, color, hint }: { label: string; value: number | string; color: string; hint?: string }) {
  return (
    <div title={hint} style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}
