import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface QASummary {
  fullQA: number;
  excluded: number;
  avgScore: number;
  green: number;
  amber: number;
  red: number;
  concerning: number;
}

interface QAResult {
  issueKey: string;
  assigneeName: string;
  grade: 'GREEN' | 'AMBER' | 'RED';
  overallScore: number;
  accuracyScore: number;
  clarityScore: number;
  toneScore: number;
  closureScore: number;
  category: string | null;
  issues: string | null;
  coachingPoints: string | null;
  suggestedReply: string | null;
  customerSentiment: string | null;
  isConcerning: number;
  ticketType: string | null;
  ticketPriority: string | null;
  processedAt: string;
}

interface QAAgent {
  assigneeName: string;
  total: number;
  green: number;
  amber: number;
  red: number;
  avgScore: number;
  concerning: number;
}

interface GRSummary {
  total: number;
  rule1Pass: number;
  rule2Pass: number;
  rule3Pass: number;
  avgScore: number;
  avgRule1: number;
  avgRule2: number;
  avgRule3: number;
}

interface GRResult {
  IssueKey: string;
  CommentId: string;
  OverallScore: number;
  Rule1Score: number;
  Rule2Score: number;
  Rule3Score: number;
  rule1Pass: number;
  rule2Pass: number;
  rule3Pass: number;
  Summary: string | null;
  SuggestedRewrite: string | null;
  Assignee: string | null;
  Updater: string | null;
  ticketPriority: string | null;
  ticketType: string | null;
  processedAt: string;
}

interface GRAgent {
  agentName: string;
  total: number;
  rule1Pass: number;
  rule2Pass: number;
  rule3Pass: number;
  avgScore: number;
}

/* ------------------------------------------------------------------ */
/*  Colours                                                            */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1a1f27',
  bg1: '#1e2228',
  bg2: '#272C33',
  bg3: '#2f353d',
  border: '#333b44',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
  teal: '#5ec1ca',
  green: '#22c55e',
  greenBg: '#052e16',
  amber: '#f59e0b',
  amberBg: '#1c1400',
  red: '#ef4444',
  redBg: '#1c0a0a',
  blue: '#60a5fa',
  blueDim: '#1d4ed8',
};

function gradeColour(grade?: string) {
  if (grade === 'GREEN') return C.green;
  if (grade === 'AMBER') return C.amber;
  if (grade === 'RED')   return C.red;
  return C.text3;
}

function gradeBg(grade?: string) {
  if (grade === 'GREEN') return C.greenBg;
  if (grade === 'AMBER') return C.amberBg;
  if (grade === 'RED')   return C.redBg;
  return C.bg3;
}

function scoreColour(score: number) {
  if (score >= 7) return C.green;
  if (score >= 5) return C.amber;
  return C.red;
}

/* ------------------------------------------------------------------ */
/*  Stat card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, colour }: { label: string; value: string | number | null; colour?: string }) {
  return (
    <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem', textAlign: 'center', minWidth: 110 }}>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: colour ?? C.blue, lineHeight: 1 }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: '0.72rem', color: C.text2, marginTop: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Grade bar                                                          */
/* ------------------------------------------------------------------ */

function GradeBar({ green = 0, amber = 0, red = 0 }: { green?: number; amber?: number; red?: number }) {
  const total = green + amber + red;
  if (!total) return <div style={{ color: C.text3, fontSize: '0.85rem' }}>No data</div>;
  const pct = (n: number) => Math.round((n / total) * 100);
  return (
    <div>
      <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', background: C.bg0 }}>
        {green > 0 && <div style={{ width: `${pct(green)}%`, background: C.green }} title={`Green: ${green}`} />}
        {amber > 0 && <div style={{ width: `${pct(amber)}%`, background: C.amber }} title={`Amber: ${amber}`} />}
        {red   > 0 && <div style={{ width: `${pct(red)}%`,   background: C.red   }} title={`Red: ${red}`}     />}
      </div>
      <div style={{ display: 'flex', gap: '1.25rem', marginTop: '0.5rem', fontSize: '0.8rem' }}>
        <span style={{ color: C.green }}>● Green {pct(green)}%</span>
        <span style={{ color: C.amber }}>● Amber {pct(amber)}%</span>
        <span style={{ color: C.red   }}>● Red {pct(red)}%</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Result row (expandable)                                            */
/* ------------------------------------------------------------------ */

function ResultRow({ r }: { r: QAResult }) {
  const [open, setOpen] = useState(false);
  const colour = gradeColour(r.grade);
  const bg = gradeBg(r.grade);

  return (
    <>
      <tr
        onClick={() => setOpen(o => !o)}
        style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}
      >
        <td style={{ padding: '0.55rem 0.75rem' }}>
          <span style={{
            display: 'inline-block', padding: '0.2rem 0.55rem',
            background: bg, color: colour,
            border: `1px solid ${colour}`, borderRadius: 4,
            fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
          }}>
            {r.grade}
          </span>
        </td>
        <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', color: C.blue, fontSize: '0.85rem' }}>{r.issueKey}</td>
        <td style={{ padding: '0.55rem 0.75rem', color: C.text1, fontSize: '0.875rem' }}>{r.assigneeName}</td>
        <td style={{ padding: '0.55rem 0.75rem', fontWeight: 700, color: scoreColour(r.overallScore) }}>{Number(r.overallScore).toFixed(1)}</td>
        <td style={{ padding: '0.55rem 0.75rem', color: C.text2, fontSize: '0.85rem' }}>{r.category ?? '—'}</td>
        <td style={{ padding: '0.55rem 0.75rem', color: C.amber }}>{r.isConcerning ? '⚑' : ''}</td>
        <td style={{ padding: '0.55rem 0.75rem', color: C.text3, fontSize: '0.8rem' }}>
          {r.processedAt ? new Date(r.processedAt).toLocaleDateString() : '—'}
        </td>
        <td style={{ padding: '0.55rem 0.75rem', color: C.text3, fontSize: '0.7rem', textAlign: 'right' }}>{open ? '▲' : '▼'}</td>
      </tr>
      {open && (
        <tr style={{ background: C.bg0, borderBottom: `1px solid ${C.border}` }}>
          <td colSpan={8} style={{ padding: 0 }}>
            <div style={{ padding: '0.875rem 1.25rem', borderLeft: `3px solid ${colour}`, marginLeft: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem' }}>
                {([['Accuracy', r.accuracyScore], ['Clarity', r.clarityScore], ['Tone', r.toneScore], ['Closure', r.closureScore]] as [string, number][]).map(([label, val]) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: scoreColour(val) }}>{val}/10</div>
                    <div style={{ fontSize: '0.7rem', color: C.text3, textTransform: 'uppercase' }}>{label}</div>
                  </div>
                ))}
              </div>
              {r.issues         && <div style={{ fontSize: '0.85rem', color: C.text2, marginTop: '0.4rem', lineHeight: 1.5 }}><strong style={{ color: C.text1 }}>Issues:</strong> {r.issues}</div>}
              {r.coachingPoints && <div style={{ fontSize: '0.85rem', color: C.text2, marginTop: '0.4rem', lineHeight: 1.5 }}><strong style={{ color: C.text1 }}>Coaching:</strong> {r.coachingPoints}</div>}
              {r.customerSentiment && <div style={{ fontSize: '0.85rem', color: C.text2, marginTop: '0.4rem' }}><strong style={{ color: C.text1 }}>Sentiment:</strong> {r.customerSentiment}</div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main view                                                          */
/* ------------------------------------------------------------------ */

type Section = 'overview' | 'results' | 'agents' | 'goldenRules';
type Env = 'uat' | 'live';

export function QAView() {
  const [env, setEnv]     = useState<Env>('uat');
  const [days, setDays]   = useState(7);
  const [section, setSection] = useState<Section>('overview');

  const [summary, setSummary]   = useState<QASummary | null>(null);
  const [results, setResults]   = useState<QAResult[]>([]);
  const [agents, setAgents]     = useState<QAAgent[]>([]);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(false);

  const [grade, setGrade]         = useState('');
  const [agent, setAgent]         = useState('');
  const [concerning, setConcerning] = useState(false);
  const [pendingFilters, setPendingFilters] = useState({ grade: '', agent: '', concerning: false });

  const [grSummary, setGrSummary]   = useState<GRSummary | null>(null);
  const [grResults, setGrResults]   = useState<GRResult[]>([]);
  const [grAgents, setGrAgents]     = useState<GRAgent[]>([]);
  const [grPage, setGrPage]         = useState(1);
  const [grLoading, setGrLoading]   = useState(false);
  const [grAgent, setGrAgent]       = useState('');
  const [grPass, setGrPass]         = useState('');
  const [grExpanded, setGrExpanded] = useState<string | null>(null);
  const [grPendingFilters, setGrPendingFilters] = useState({ agent: '', pass: '' });

  const fetchSummary = useCallback(async () => {
    try {
      const r = await fetch(`/api/kpi-data/qa-summary?env=${env}&days=${days}`);
      const d = await r.json();
      if (d.ok) setSummary(d.data);
    } catch { /* ignore */ }
  }, [env, days]);

  const fetchAgents = useCallback(async () => {
    try {
      const r = await fetch(`/api/kpi-data/qa-agents?env=${env}&days=${days}`);
      const d = await r.json();
      if (d.ok) setAgents(d.data);
    } catch { /* ignore */ }
  }, [env, days]);

  const fetchGrSummary = useCallback(async () => {
    try {
      const r = await fetch(`/api/kpi-data/qa-golden-summary?env=${env}&days=${days}`);
      const d = await r.json();
      if (d.ok) setGrSummary(d.data);
    } catch { /* ignore */ }
  }, [env, days]);

  const fetchGrAgents = useCallback(async () => {
    try {
      const r = await fetch(`/api/kpi-data/qa-golden-agents?env=${env}&days=${days}`);
      const d = await r.json();
      if (d.ok) setGrAgents(d.data);
    } catch { /* ignore */ }
  }, [env, days]);

  const fetchGrResults = useCallback(async (p: number, filters: typeof grPendingFilters) => {
    setGrLoading(true);
    try {
      const params = new URLSearchParams({ env, days: String(days), page: String(p), limit: '25' });
      if (filters.agent) params.set('agent', filters.agent);
      if (filters.pass)  params.set('pass', filters.pass);
      const r = await fetch(`/api/kpi-data/qa-golden-results?${params}`);
      const d = await r.json();
      if (d.ok) { setGrResults(d.data); setGrPage(p); }
    } catch { /* ignore */ }
    setGrLoading(false);
  }, [env, days]);

  const fetchResults = useCallback(async (p: number, filters: typeof pendingFilters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ env, days: String(days), page: String(p), limit: '25' });
      if (filters.grade)      params.set('grade', filters.grade);
      if (filters.agent)      params.set('agent', filters.agent);
      if (filters.concerning) params.set('concerning', '1');
      const r = await fetch(`/api/kpi-data/qa-results?${params}`);
      const d = await r.json();
      if (d.ok) { setResults(d.data); setPage(p); }
    } catch { /* ignore */ }
    setLoading(false);
  }, [env, days]);

  useEffect(() => {
    fetchSummary();
    fetchAgents();
    fetchResults(1, pendingFilters);
    fetchGrSummary();
    fetchGrAgents();
    fetchGrResults(1, grPendingFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, days]);

  const applyFilters = () => {
    const f = { grade, agent, concerning };
    setPendingFilters(f);
    fetchResults(1, f);
  };

  const greenRate = summary ? Math.round((summary.green / (summary.fullQA || 1)) * 100) : 0;

  /* --- tab button style --- */
  const tabBtn = (active: boolean): React.CSSProperties => ({
    background: 'none', border: 'none', borderBottom: `2px solid ${active ? C.teal : 'transparent'}`,
    padding: '0.5rem 1.25rem', color: active ? C.teal : C.text2,
    fontSize: '0.875rem', cursor: 'pointer', marginBottom: -1,
  });

  const th: React.CSSProperties = {
    textAlign: 'left', padding: '0.45rem 0.75rem',
    color: C.text3, fontSize: '0.72rem', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: `1px solid ${C.border}`,
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1300 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: C.text1 }}>QA Dashboard</h2>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.85rem', color: C.text2 }}>
            Env:&nbsp;
            <select value={env} onChange={e => setEnv(e.target.value as Env)} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
              <option value="uat">UAT</option>
              <option value="live">Live</option>
            </select>
          </label>
          <label style={{ fontSize: '0.85rem', color: C.text2 }}>
            Period:&nbsp;
            <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
        </div>
      </div>

      {/* Section tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, marginBottom: '1.25rem' }}>
        {([['overview', 'Overview'], ['results', 'Results'], ['agents', 'Agents'], ['goldenRules', 'Golden Rules']] as [Section, string][]).map(([s, label]) => (
          <button key={s} style={tabBtn(section === s)} onClick={() => setSection(s)}>{label}</button>
        ))}
      </div>

      {/* Overview */}
      {section === 'overview' && (
        <>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Full QA</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <StatCard label="Full QA'd"  value={summary?.fullQA ?? null} />
            <StatCard label="Avg Score"  value={summary ? Number(summary.avgScore).toFixed(1) : null} colour={summary ? scoreColour(Number(summary.avgScore)) : undefined} />
            <StatCard label="Green Rate" value={summary ? `${greenRate}%` : null} colour={C.green} />
            <StatCard label="Flagged"    value={summary?.concerning ?? null} colour={C.amber} />
            <StatCard label="Excluded"   value={summary?.excluded ?? null} colour={C.text3} />
          </div>
          {summary && (
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text2, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>Grade Distribution</div>
              <GradeBar green={summary.green} amber={summary.amber} red={summary.red} />
            </div>
          )}
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Golden Rules</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <StatCard label="Comments QA'd" value={grSummary?.total ?? null} colour={C.teal} />
            <StatCard label="Avg Score" value={grSummary?.avgScore != null ? Number(grSummary.avgScore).toFixed(1) : null} colour={grSummary?.avgScore != null ? (Number(grSummary.avgScore) >= 2.5 ? C.green : Number(grSummary.avgScore) >= 1.5 ? C.amber : C.red) : undefined} />
            <StatCard label="R1 Pass %" value={grSummary?.total ? `${Math.round((grSummary.rule1Pass / grSummary.total) * 100)}%` : '—'} colour={C.teal} />
            <StatCard label="R2 Pass %" value={grSummary?.total ? `${Math.round((grSummary.rule2Pass / grSummary.total) * 100)}%` : '—'} colour={C.teal} />
            <StatCard label="R3 Pass %" value={grSummary?.total ? `${Math.round((grSummary.rule3Pass / grSummary.total) * 100)}%` : '—'} colour={C.teal} />
          </div>
          {grSummary && grSummary.total > 0 && (
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text2, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>Golden Rule Pass Rates</div>
              {(['Rule 1 — Ownership', "Rule 2 — What's Happening", 'Rule 3 — Timeframes'] as const).map((label, i) => {
                const passes = [grSummary.rule1Pass, grSummary.rule2Pass, grSummary.rule3Pass][i];
                const pct = grSummary.total ? Math.round((passes / grSummary.total) * 100) : 0;
                const colour = pct >= 70 ? C.green : pct >= 50 ? C.amber : C.red;
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{ width: 200, fontSize: '0.8rem', color: C.text2 }}>{label}</div>
                    <div style={{ flex: 1, height: 12, borderRadius: 3, overflow: 'hidden', background: C.bg0 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: colour }} />
                    </div>
                    <div style={{ width: 48, fontSize: '0.8rem', fontWeight: 700, color: colour, textAlign: 'right' }}>{pct}%</div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Results */}
      {section === 'results' && (
        <>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <select value={grade} onChange={e => setGrade(e.target.value)} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
              <option value="">All grades</option>
              <option value="GREEN">Green</option>
              <option value="AMBER">Amber</option>
              <option value="RED">Red</option>
            </select>
            <input
              type="text" placeholder="Agent name…" value={agent}
              onChange={e => setAgent(e.target.value)}
              style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.85rem', width: 180 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: C.text2, cursor: 'pointer' }}>
              <input type="checkbox" checked={concerning} onChange={e => setConcerning(e.target.checked)} />
              Flagged only
            </label>
            <button onClick={applyFilters} style={{ background: C.blueDim, color: '#fff', border: 'none', borderRadius: 6, padding: '0.3rem 0.9rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              Apply
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: C.text3 }}>Loading…</div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    {['Grade', 'Ticket', 'Agent', 'Score', 'Category', 'Flag', 'Date', ''].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.length
                    ? results.map(r => <ResultRow key={r.issueKey} r={r} />)
                    : <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: C.text3, fontSize: '0.875rem' }}>No results</td></tr>
                  }
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'center', marginTop: '1rem', fontSize: '0.875rem', color: C.text2 }}>
                <button
                  disabled={page <= 1}
                  onClick={() => fetchResults(page - 1, pendingFilters)}
                  style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.75rem', cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1 }}
                >← Prev</button>
                <span>Page {page}</span>
                <button
                  disabled={results.length < 25}
                  onClick={() => fetchResults(page + 1, pendingFilters)}
                  style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.75rem', cursor: results.length < 25 ? 'default' : 'pointer', opacity: results.length < 25 ? 0.4 : 1 }}
                >Next →</button>
              </div>
            </>
          )}
        </>
      )}

      {/* Agents */}
      {section === 'agents' && (
        agents.length === 0
          ? <div style={{ textAlign: 'center', padding: '2rem', color: C.text3 }}>No agent data</div>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr>
                  {['Agent', 'Total', 'Avg Score', 'Green', 'Amber', 'Red', 'Flagged'].map(h => (
                    <th key={h} style={{ ...th, color: h === 'Green' ? C.green : h === 'Amber' ? C.amber : h === 'Red' ? C.red : C.text3 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map(a => (
                  <tr key={a.assigneeName} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '0.6rem 0.75rem', color: C.text1, fontWeight: 500 }}>{a.assigneeName}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: C.text2 }}>{a.total}</td>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: scoreColour(Number(a.avgScore)) }}>{Number(a.avgScore).toFixed(1)}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: C.green }}>{a.green}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: C.amber }}>{a.amber}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: C.red   }}>{a.red}</td>
                    <td style={{ padding: '0.6rem 0.75rem', color: C.amber }}>{a.concerning > 0 ? `⚑ ${a.concerning}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}

      {/* Golden Rules */}
      {section === 'goldenRules' && (
        <>
          {/* Summary stats */}
          {grSummary && (
            <>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                <StatCard label="Comments QA'd" value={grSummary.total ?? null} />
                <StatCard label="Avg Score" value={grSummary.avgScore != null ? Number(grSummary.avgScore).toFixed(1) : null} colour={grSummary.avgScore != null ? (Number(grSummary.avgScore) >= 2.5 ? C.green : Number(grSummary.avgScore) >= 1.5 ? C.amber : C.red) : undefined} />
                <StatCard label="R1 Pass %" value={grSummary.total ? `${Math.round((grSummary.rule1Pass / grSummary.total) * 100)}%` : '—'} colour={C.teal} />
                <StatCard label="R2 Pass %" value={grSummary.total ? `${Math.round((grSummary.rule2Pass / grSummary.total) * 100)}%` : '—'} colour={C.teal} />
                <StatCard label="R3 Pass %" value={grSummary.total ? `${Math.round((grSummary.rule3Pass / grSummary.total) * 100)}%` : '—'} colour={C.teal} />
              </div>
              <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text2, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>Rule Pass Rates</div>
                {(['Rule 1 — Ownership', 'Rule 2 — What\'s Happening', 'Rule 3 — Timeframes'] as const).map((label, i) => {
                  const passes = [grSummary.rule1Pass, grSummary.rule2Pass, grSummary.rule3Pass][i];
                  const pct = grSummary.total ? Math.round((passes / grSummary.total) * 100) : 0;
                  const colour = pct >= 70 ? C.green : pct >= 50 ? C.amber : C.red;
                  return (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <div style={{ width: 200, fontSize: '0.8rem', color: C.text2 }}>{label}</div>
                      <div style={{ flex: 1, height: 12, borderRadius: 3, overflow: 'hidden', background: C.bg0 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: colour }} />
                      </div>
                      <div style={{ width: 48, fontSize: '0.8rem', fontWeight: 700, color: colour, textAlign: 'right' }}>{pct}%</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Agent breakdown */}
          {grAgents.length > 0 && (
            <div style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 600, color: C.text2, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>Agent Breakdown</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr>
                    {['Agent', 'Comments', 'Avg', 'R1 Pass', 'R2 Pass', 'R3 Pass'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grAgents.map(a => (
                    <tr key={a.agentName} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '0.5rem 0.75rem', color: C.text1, fontWeight: 500 }}>{a.agentName}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: C.text2 }}>{a.total}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontWeight: 700, color: Number(a.avgScore) >= 2.5 ? C.green : Number(a.avgScore) >= 1.5 ? C.amber : C.red }}>{Number(a.avgScore).toFixed(1)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: a.total ? (a.rule1Pass / a.total >= 0.7 ? C.green : C.amber) : C.text3 }}>{a.total ? `${Math.round((a.rule1Pass / a.total) * 100)}%` : '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: a.total ? (a.rule2Pass / a.total >= 0.7 ? C.green : C.amber) : C.text3 }}>{a.total ? `${Math.round((a.rule2Pass / a.total) * 100)}%` : '—'}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: a.total ? (a.rule3Pass / a.total >= 0.7 ? C.green : C.amber) : C.text3 }}>{a.total ? `${Math.round((a.rule3Pass / a.total) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Filters */}
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <input
              type="text" placeholder="Agent name…" value={grAgent}
              onChange={e => setGrAgent(e.target.value)}
              style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.85rem', width: 180 }}
            />
            <select value={grPass} onChange={e => setGrPass(e.target.value)} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}>
              <option value="">All results</option>
              <option value="1">All rules passed</option>
              <option value="0">Any rule failed</option>
            </select>
            <button onClick={() => { const f = { agent: grAgent, pass: grPass }; setGrPendingFilters(f); fetchGrResults(1, f); }} style={{ background: C.blueDim, color: '#fff', border: 'none', borderRadius: 6, padding: '0.3rem 0.9rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              Apply
            </button>
          </div>

          {/* Results table */}
          {grLoading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: C.text3 }}>Loading…</div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr>
                    {['Ticket', 'Agent', 'Score', 'R1', 'R2', 'R3', 'Priority', 'Date', ''].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grResults.length === 0
                    ? <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: C.text3, fontSize: '0.875rem' }}>No results</td></tr>
                    : grResults.map(r => {
                        const key = `${r.IssueKey}-${r.CommentId}`;
                        const expanded = grExpanded === key;
                        const ruleColour = (pass: number) => pass ? C.green : C.red;
                        return (
                          <>
                            <tr key={key} onClick={() => setGrExpanded(expanded ? null : key)} style={{ cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}>
                              <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', color: C.blue, fontSize: '0.85rem' }}>{r.IssueKey}</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: C.text1 }}>{r.Updater ?? r.Assignee ?? '—'}</td>
                              <td style={{ padding: '0.55rem 0.75rem', fontWeight: 700, color: Number(r.OverallScore) >= 2.5 ? C.green : Number(r.OverallScore) >= 1.5 ? C.amber : C.red }}>{r.OverallScore}/3</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: ruleColour(r.rule1Pass) }}>{r.rule1Pass ? '✓' : '✗'} {r.Rule1Score}</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: ruleColour(r.rule2Pass) }}>{r.rule2Pass ? '✓' : '✗'} {r.Rule2Score}</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: ruleColour(r.rule3Pass) }}>{r.rule3Pass ? '✓' : '✗'} {r.Rule3Score}</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: C.text2, fontSize: '0.8rem' }}>{r.ticketPriority ?? '—'}</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: C.text3, fontSize: '0.8rem' }}>{r.processedAt ? new Date(r.processedAt).toLocaleDateString() : '—'}</td>
                              <td style={{ padding: '0.55rem 0.75rem', color: C.text3, fontSize: '0.7rem', textAlign: 'right' }}>{expanded ? '▲' : '▼'}</td>
                            </tr>
                            {expanded && (
                              <tr key={`${key}-detail`} style={{ background: C.bg0, borderBottom: `1px solid ${C.border}` }}>
                                <td colSpan={9} style={{ padding: 0 }}>
                                  <div style={{ padding: '0.875rem 1.25rem', borderLeft: `3px solid ${C.teal}`, marginLeft: '0.75rem' }}>
                                    {r.Summary && <div style={{ fontSize: '0.85rem', color: C.text2, marginBottom: '0.5rem', lineHeight: 1.5 }}><strong style={{ color: C.text1 }}>Summary:</strong> {r.Summary}</div>}
                                    {r.SuggestedRewrite && <div style={{ fontSize: '0.85rem', color: C.text2, lineHeight: 1.5 }}><strong style={{ color: C.text1 }}>Suggested Rewrite:</strong> {r.SuggestedRewrite}</div>}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })
                  }
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'center', marginTop: '1rem', fontSize: '0.875rem', color: C.text2 }}>
                <button disabled={grPage <= 1} onClick={() => fetchGrResults(grPage - 1, grPendingFilters)} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.75rem', cursor: grPage <= 1 ? 'default' : 'pointer', opacity: grPage <= 1 ? 0.4 : 1 }}>← Prev</button>
                <span>Page {grPage}</span>
                <button disabled={grResults.length < 25} onClick={() => fetchGrResults(grPage + 1, grPendingFilters)} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0.3rem 0.75rem', cursor: grResults.length < 25 ? 'default' : 'pointer', opacity: grResults.length < 25 ? 0.4 : 1 }}>Next →</button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
