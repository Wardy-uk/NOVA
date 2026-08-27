import { useCallback, useEffect, useState } from 'react';

/* 1-2-1 click-through (Phase 3) — full-screen 5-stage wizard. Launched from
   AgentProfileView. Stages: outstanding actions → KPI review → prep answers →
   discussion/notes → new commitments → save + set next date. */

const C = {
  bg0: '#1e2228', bg1: '#272C33', bg2: '#2f353d',
  glass: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)',
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669', amber: '#d97706',
  red: '#ef4444', blue: '#60a5fa', text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
} as const;

const STAGES = ['Outstanding actions', 'KPI review', 'Their prep', 'Discussion', 'Next month'];

interface Action { id: number; description: string; owner: string | null; due_date: string | null; status: string; }
interface SessionDetail {
  session: { id: number; agent_name: string; scheduled_date: string; status: string; notes_text: string | null };
  prep: any; metrics: any;
  prepAnswers: Array<{ question: string; answer: string }>;
  outstandingActions: Action[]; newActions: Action[];
  kpis: { summary: Record<string, number | null>; trend: Array<Record<string, any>> } | null;
  lastDate: string | null; cadenceDays: number;
}

const fmt = (v: number | null | undefined, dp = 1) => (v == null || isNaN(v) ? '—' : v.toFixed(dp));
const fmtPct = (v: number | null | undefined) => (v == null || isNaN(v) ? '—' : `${v.toFixed(1)}%`);

export function OneToOneSessionView({ agentName, onClose, onCompleted }: {
  agentName: string; onClose: () => void; onCompleted?: () => void;
}) {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [stage, setStage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stage 4 notes + stage 5 new-action draft
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);
  const [draftDesc, setDraftDesc] = useState('');
  const [draftOwner, setDraftOwner] = useState('');
  const [draftDue, setDraftDue] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [completing, setCompleting] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [doneKind, setDoneKind] = useState<'complete' | 'abandoned'>('complete');
  // Whether this 1-2-1 has been marked underway. Opening the wizard deliberately does
  // NOT do that — see ensureBegun.
  const [begun, setBegun] = useState(false);

  const loadDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/121/session/${id}`);
    const json = await res.json();
    if (json.ok) {
      setDetail(json.data);
      setNotes(json.data.session.notes_text ?? '');
      // Pre-fill next date from cadence.
      const base = Date.now() + (json.data.cadenceDays ?? 28) * 86400000;
      setNextDate(new Date(base).toISOString().slice(0, 10));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        // Resolve only — this must not change the session's status. Opening the wizard
        // used to force it to 'in_progress', which stopped the day-before prep job from
        // ever picking it up again and left the loop dead until someone completed it.
        const res = await fetch('/api/121/session/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent: agentName }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) { setError(json.error || 'Could not open the session.'); setLoading(false); return; }
        setSessionId(json.data.sessionId);
        setBegun(json.data.status === 'in_progress');
        await loadDetail(json.data.sessionId);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [agentName, loadDetail]);

  /**
   * Mark the 1-2-1 underway, once, on the first thing that WRITES — reviewing an action,
   * saving notes, adding a commitment. Reading is never enough: paging through the stages
   * to look at someone's KPIs and closing again leaves the session exactly as it was.
   */
  const ensureBegun = useCallback(async () => {
    if (begun || !sessionId) return;
    setBegun(true);
    await fetch(`/api/121/session/${sessionId}/begin`, { method: 'POST' });
  }, [begun, sessionId]);

  const reviewAction = async (actionId: number, status: string) => {
    await ensureBegun();
    await fetch(`/api/121/action/${actionId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (sessionId) await loadDetail(sessionId);
  };

  const saveNotes = useCallback(async () => {
    if (!sessionId) return;
    await ensureBegun();
    await fetch(`/api/121/session/${sessionId}/notes`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes_text: notes }),
    });
    setNotesSaved(true);
  }, [sessionId, notes, ensureBegun]);

  const addAction = async () => {
    if (!sessionId || !draftDesc.trim()) return;
    await ensureBegun();
    await fetch(`/api/121/session/${sessionId}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentName, description: draftDesc.trim(), owner: draftOwner.trim() || null, due_date: draftDue || null }),
    });
    setDraftDesc(''); setDraftOwner(''); setDraftDue('');
    if (sessionId) await loadDetail(sessionId);
  };

  const abandon = async () => {
    if (!sessionId) return;
    if (!window.confirm(`Close this 1-2-1 without completing it?\n\nIt won't count as held, and ${agentName.split(' ')[0]}'s next 1-2-1 will be booked as normal.`)) return;
    const res = await fetch(`/api/121/session/${sessionId}/abandon`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next_date: nextDate || undefined }),
    });
    const json = await res.json();
    if (json.ok) {
      setDoneKind('abandoned');
      setDoneMsg(json.data.nextDate
        ? `It won't count as held. Next 1-2-1 set for ${new Date(json.data.nextDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.`
        : "It won't count as held.");
      onCompleted?.();
    } else {
      setError(json.error || 'Could not close the session.');
    }
  };

  const complete = async () => {
    if (!sessionId) return;
    setCompleting(true);
    await saveNotes();
    const res = await fetch(`/api/121/session/${sessionId}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next_date: nextDate || undefined }),
    });
    const json = await res.json();
    setCompleting(false);
    if (json.ok) {
      setDoneMsg(json.data.nextDate ? `Saved. Next 1-2-1 set for ${new Date(json.data.nextDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}.` : 'Saved.');
      onCompleted?.();
    } else {
      setError(json.error || 'Could not complete the session.');
    }
  };

  const btn = (label: string, onClick: () => void, kind: 'primary' | 'ghost' = 'ghost', extra: any = {}) => (
    <button onClick={onClick} style={{
      padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${kind === 'primary' ? C.teal : C.border}`,
      background: kind === 'primary' ? C.teal : 'transparent',
      color: kind === 'primary' ? C.bg1 : C.text2, ...extra,
    }}>{label}</button>
  );

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
  };
  const panel: React.CSSProperties = {
    width: 'min(820px, 100%)', maxHeight: '90vh', background: C.bg1,
    border: `1px solid ${C.border}`, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        {/* Header + stepper */}
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text1 }}>1-2-1 — {agentName}</div>
              {detail && <div style={{ fontSize: 11, color: C.text3 }}>
                {detail.lastDate ? `Last: ${new Date(detail.lastDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'First 1-2-1'} · cadence {detail.cadenceDays}d
                {begun && <span style={{ color: C.amber }}> · underway since {new Date(detail.session.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — complete it to book the next one</span>}
              </div>}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text3, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {STAGES.map((s, i) => (
              <div key={s} onClick={() => !doneMsg && setStage(i)} style={{
                flex: 1, cursor: 'pointer', textAlign: 'center', padding: '6px 4px', borderRadius: 7,
                fontSize: 10.5, fontWeight: 600,
                background: i === stage ? `${C.teal}20` : C.glass,
                color: i === stage ? C.teal : i < stage ? C.text2 : C.text3,
                border: `1px solid ${i === stage ? `${C.teal}50` : 'transparent'}`,
              }}>{i + 1}. {s}</div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: C.text3, padding: 40 }}>Starting session…</div>
          ) : error ? (
            <div style={{ color: C.red, fontSize: 13 }}>{error}</div>
          ) : doneMsg ? (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{doneKind === 'complete' ? '✅' : '↩️'}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: C.text1, marginBottom: 6 }}>
                {doneKind === 'complete' ? '1-2-1 complete' : '1-2-1 closed'}
              </div>
              <div style={{ fontSize: 13, color: C.text2 }}>{doneMsg}</div>
            </div>
          ) : detail && (
            <>
              {/* Stage 1 — Outstanding actions */}
              {stage === 0 && (
                <div>
                  <StageTitle n={1} title="Outstanding actions from last time" hint="Mark each as delivered, missed, or carried over to this month." />
                  {detail.outstandingActions.length === 0 ? (
                    <Empty text="No outstanding actions — clean slate." />
                  ) : detail.outstandingActions.map((a) => (
                    <div key={a.id} style={rowStyle}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: C.text1 }}>{a.description}</div>
                        <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
                          {a.owner && <span>Owner: {a.owner} </span>}
                          {a.due_date && <span>· Due {a.due_date} </span>}
                          <span style={{ color: statusColor(a.status) }}>· {a.status}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Pill label="Delivered" active={a.status === 'delivered'} color={C.green} onClick={() => reviewAction(a.id, 'delivered')} />
                        <Pill label="Missed" active={a.status === 'missed'} color={C.red} onClick={() => reviewAction(a.id, 'missed')} />
                        <Pill label="Carry over" active={a.status === 'carried_over'} color={C.amber} onClick={() => reviewAction(a.id, 'carried_over')} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Stage 2 — KPI review */}
              {stage === 1 && (
                <div>
                  <StageTitle n={2} title="KPI review" hint="Rolling 30-day averages from the KPI engine." />
                  {!detail.kpis ? <Empty text="KPI data unavailable." /> : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
                        <Metric label="SLA compliance" value={fmtPct(detail.kpis.summary.slaCompliancePct)} />
                        <Metric label="QA average" value={fmt(detail.kpis.summary.qaOverallAvg)} />
                        <Metric label="Golden rules" value={fmt(detail.kpis.summary.goldenRulesAvg)} />
                        <Metric label="Tickets/hour" value={fmt(detail.kpis.summary.ticketsPerHourAvg, 2)} />
                        <Metric label="CSAT" value={fmt(detail.kpis.summary.csatAvg)} />
                        <Metric label="Solved (period)" value={fmt(detail.kpis.summary.solvedTotal, 0)} />
                      </div>
                      {detail.prep?.signals && <Signals s={detail.prep.signals} />}
                      {detail.prep && (
                        <div style={{ marginTop: 10 }}>
                          <PrepList title="What's improved" items={detail.prep.whats_improved} color={C.green} />
                          <PrepList title="Needs attention" items={detail.prep.needs_attention} color={C.red} />
                          <PrepList title="QA highlights" items={detail.prep.qa_highlights} color={C.blue} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Stage 3 — Their prep */}
              {stage === 2 && (
                <div>
                  <StageTitle n={3} title="Their prep answers" hint="What they submitted ahead of the 1-2-1." />
                  {detail.prepAnswers.length === 0 ? (
                    <Empty text="No prep submitted yet." />
                  ) : detail.prepAnswers.map((qa, i) => (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.teal, marginBottom: 4 }}>{qa.question}</div>
                      <div style={{ fontSize: 13, color: qa.answer ? C.text1 : C.text3, whiteSpace: 'pre-wrap' }}>{qa.answer || '— no answer —'}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Stage 4 — Discussion */}
              {stage === 3 && (
                <div>
                  <StageTitle n={4} title="Discussion notes" hint="Capture the conversation. The Plaud recording is attached afterwards from the agent's card / profile." />

                  <textarea
                    value={notes}
                    onChange={(e) => { setNotes(e.target.value); setNotesSaved(false); }}
                    onBlur={saveNotes}
                    rows={12}
                    placeholder="Capture what you discussed…"
                    style={{
                      width: '100%', background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10,
                      padding: 14, fontSize: 13, color: C.text1, fontFamily: 'inherit', resize: 'vertical',
                    }}
                  />
                  <div style={{ fontSize: 11, color: notesSaved ? C.text3 : C.amber, marginTop: 6 }}>
                    {notesSaved ? 'Saved' : 'Unsaved — click out to save'}
                  </div>
                </div>
              )}

              {/* Stage 5 — Next month */}
              {stage === 4 && (
                <div>
                  <StageTitle n={5} title="Commitments for the coming month" hint="Agree the actions — outstanding 'carry over' items remain too." />
                  {detail.newActions.map((a) => (
                    <div key={a.id} style={rowStyle}>
                      <div style={{ fontSize: 13, color: C.text1 }}>{a.description}
                        <span style={{ fontSize: 11, color: C.text3 }}>{a.owner ? ` · ${a.owner}` : ''}{a.due_date ? ` · due ${a.due_date}` : ''}</span>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <input value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="New action / commitment"
                      style={{ flex: '1 1 220px', ...inputStyle }} onKeyDown={(e) => { if (e.key === 'Enter') addAction(); }} />
                    <input value={draftOwner} onChange={(e) => setDraftOwner(e.target.value)} placeholder="Owner" style={{ width: 110, ...inputStyle }} />
                    <input type="date" value={draftDue} onChange={(e) => setDraftDue(e.target.value)} style={{ width: 140, ...inputStyle, colorScheme: 'dark' }} />
                    {btn('Add', addAction, 'ghost')}
                  </div>

                  <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 8 }}>Next 1-2-1 date</div>
                    <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} style={{ ...inputStyle, colorScheme: 'dark', width: 170 }} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer nav */}
        {!doneMsg && !loading && !error && (
          <div style={{ padding: '14px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {stage > 0 && btn('Back', () => setStage(stage - 1))}
              {begun && (
                <button onClick={abandon} style={{
                  background: 'none', border: 'none', color: C.text3, fontSize: 12,
                  cursor: 'pointer', textDecoration: 'underline', padding: 0,
                }}>Close without completing</button>
              )}
            </div>
            {stage < STAGES.length - 1
              ? btn('Next', () => setStage(stage + 1), 'primary')
              : btn(completing ? 'Saving…' : 'Complete 1-2-1', complete, 'primary')}
          </div>
        )}
        {doneMsg && (
          <div style={{ padding: '14px 24px', borderTop: `1px solid ${C.border}`, textAlign: 'right' }}>
            {btn('Close', onClose, 'primary')}
          </div>
        )}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8,
  background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10,
};
const inputStyle: React.CSSProperties = {
  background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px',
  fontSize: 13, color: C.text1,
};

function statusColor(s: string) {
  return s === 'delivered' ? C.green : s === 'missed' ? C.red : s === 'carried_over' ? C.amber : C.text3;
}

function StageTitle({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text1 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{hint}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div style={{ padding: 24, textAlign: 'center', color: C.text3, fontSize: 13, background: C.glass, borderRadius: 10, border: `1px dashed ${C.border}` }}>{text}</div>;
}
function Pill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? color : C.border}`, background: active ? `${color}25` : 'transparent',
      color: active ? color : C.text3,
    }}>{label}</button>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text1, marginTop: 4 }}>{value}</div>
    </div>
  );
}
/**
 * The evidence block — escalations, AI-agent interaction, coaching signals, named QA
 * tickets, movement vs the previous period.
 *
 * These are the facts the prep summary was generated FROM, shown as themselves. Named
 * tickets are the point: "your QA average is 7.2" is not a conversation, "NT-28061
 * scored 4.5" is.
 */
function Signals({ s }: { s: any }) {
  const rows: Array<{ label: string; value: string; color?: string }> = [];

  for (const t of s.trends ?? []) {
    rows.push({
      label: t.metric,
      value: `${t.direction === 'improving' ? '▲' : t.direction === 'declining' ? '▼' : '–'} ${t.detail}`,
      color: t.direction === 'improving' ? C.green : t.direction === 'declining' ? C.red : C.text2,
    });
  }
  if (s.escalations) {
    rows.push({
      label: 'Escalations',
      value: `${s.escalations.count}` + (s.escalations.appropriateRate !== null
        ? ` · ${(s.escalations.appropriateRate * 100).toFixed(0)}% judged appropriate`
        : ' · appropriateness not scored'),
    });
  }
  if (s.autonomy) {
    rows.push({ label: 'AI suggestions', value: `${s.autonomy.approvals} approved · ${s.autonomy.rejections} rejected` });
  }
  if (s.qaWorst?.length) {
    rows.push({ label: 'Weakest QA', value: s.qaWorst.map((t: any) => `${t.ticketKey} (${t.score})`).join(', '), color: C.red });
  }
  if (s.qaBest?.length) {
    rows.push({ label: 'Strongest QA', value: s.qaBest.map((t: any) => `${t.ticketKey} (${t.score})`).join(', '), color: C.green });
  }

  const hasAnything = rows.length > 0 || (s.coaching ?? []).length > 0 || (s.unavailable ?? []).length > 0;
  if (!hasAnything) return null;

  return (
    <div style={{ marginTop: 4, marginBottom: 14, padding: '12px 14px', background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <div style={{ fontSize: 10, color: C.purple, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 8 }}>Evidence</div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5, marginBottom: 4 }}>
          <div style={{ color: C.text3, width: 120, flexShrink: 0 }}>{r.label}</div>
          <div style={{ color: r.color ?? C.text1 }}>{r.value}</div>
        </div>
      ))}
      {(s.coaching ?? []).map((c: any, i: number) => (
        <div key={`c${i}`} style={{ display: 'flex', gap: 10, fontSize: 12.5, marginBottom: 4 }}>
          <div style={{ color: C.text3, width: 120, flexShrink: 0 }}>Coaching</div>
          <div style={{ color: C.amber }}>{c.signalType}{c.requestType ? ` (${c.requestType})` : ''} — {c.detail}</div>
        </div>
      ))}
      {(s.unavailable ?? []).length > 0 && (
        // Said out loud. Five sections silently reading zero is what made the old
        // briefing tab look like it was working.
        <div style={{ fontSize: 11, color: C.text3, marginTop: 8, fontStyle: 'italic' }}>
          Not available: {s.unavailable.join('; ')}.
        </div>
      )}
    </div>
  );
}

function PrepList({ title, items, color }: { title: string; items: string[] | undefined; color: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((i, k) => <li key={k} style={{ fontSize: 13, color: C.text2, marginBottom: 3 }}>{i}</li>)}
      </ul>
    </div>
  );
}
