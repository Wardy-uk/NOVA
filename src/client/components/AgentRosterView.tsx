import { useState, useEffect, useCallback, useMemo } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RosterEntry {
  id: number;
  agent_name: string;
  plan_period: string | null;
  role_title: string | null;
  function_name: string | null;
  status: string;
  manager_status: string | null;
  goal_count: number;
  training_done: number;
  training_total: number;
  training_overdue: number;
  training_due_soon: number;
}

interface CalendarEntry {
  subject: string;
  start: string;
}

type ManagerStatus = 'SOLID' | 'WATCH' | 'AT RISK' | 'NEW';
const MANAGER_STATUSES: ManagerStatus[] = ['SOLID', 'WATCH', 'AT RISK', 'NEW'];

interface AgentDailyRow {
  AgentName: string;
  TierCode: string | null;
  Team: string | null;
  TicketsPerHour: number | null;
  SolvedTickets_Today: number | null;
  QAOverallAvg: number | null;
  GoldenRulesAvg: number | null;
  SLACompliancePct: number | null;
  SLABreachedCount: number | null;
  SLAResolvedCount: number | null;
  ReportDate: string;
}

interface AgentCard {
  name: string;
  roleTitle: string;
  functionName: string;
  tierCode: string;
  planStatus: string;
  managerStatus: ManagerStatus | null;
  kpiHealth: Rag;
  qaHealth: Rag;
  goldenRules: Rag;
  trainingHealth: Rag;
  satisfactionHealth: Rag;
  next121Health: Rag;
  compositeRag: Rag;
  trainingLabel: string;
  slaCompliancePct: number | null;
  qaOverallAvg: number | null;
  goldenRulesAvg: number | null;
  ticketsPerHourAvg: number | null;
  satisfactionAvg: number | null;
  next121Date: string | null;
}

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */

const C = {
  bg0: '#1e2228',
  bg1: '#272C33',
  bg2: '#2f353d',
  glass: 'rgba(255,255,255,0.03)',
  glassHover: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.06)',
  teal: '#5ec1ca',
  purple: '#7c3aed',
  green: '#059669',
  amber: '#d97706',
  red: '#ef4444',
  text1: '#e2e8f0',
  text2: '#94a3b8',
  text3: '#64748b',
} as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type Rag = 'green' | 'amber' | 'red' | 'grey';

function ragDot(rag: Rag) {
  const colors: Record<Rag, string> = { green: C.green, amber: C.amber, red: C.red, grey: C.text3 };
  return (
    <span style={{
      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
      background: colors[rag], boxShadow: rag !== 'grey' ? `0 0 6px ${colors[rag]}40` : 'none',
    }} />
  );
}

function kpiRag(sla: number | null, tph: number | null): Rag {
  if (sla === null && tph === null) return 'grey';
  const slaOk = sla !== null && sla >= 95;
  const slaWarn = sla !== null && sla >= 85;
  const tphOk = tph !== null && tph >= 1.5;
  if (slaOk && tphOk) return 'green';
  if ((!slaWarn && sla !== null) || (!slaOk && !tphOk)) return 'red';
  return 'amber';
}

function qaRag(score: number | null): Rag {
  if (score === null) return 'grey';
  if (score >= 8.0) return 'green';
  if (score >= 6.5) return 'amber';
  return 'red';
}

function grRag(score: number | null): Rag {
  if (score === null) return 'grey';
  if (score >= 2.5) return 'green';
  if (score >= 2.0) return 'amber';
  return 'red';
}

function trainingRag(done: number, total: number, overdue: number, dueSoon: number): Rag {
  if (total === 0) return 'grey';
  if (done >= total) return 'green';
  if (overdue > 0) return 'red';
  if (dueSoon > 0) return 'amber';
  return done > 0 ? 'green' : 'amber';
}

function satisfactionRag(score: number | null): Rag {
  if (score === null) return 'grey';
  if (score >= 4.0) return 'green';
  if (score >= 3.0) return 'amber';
  return 'red';
}

function next121Rag(startDate: string | null): Rag {
  if (!startDate) return 'grey';
  const now = Date.now();
  const meetingTime = new Date(startDate).getTime();
  if (isNaN(meetingTime)) return 'grey';
  const daysUntil = (meetingTime - now) / 86400000;
  if (daysUntil < 0) return 'red';
  if (daysUntil <= 2) return 'amber';
  return 'green';
}

function worstRag(rags: Rag[]): Rag {
  const nonGrey = rags.filter(r => r !== 'grey');
  if (nonGrey.length === 0) return 'grey';
  if (nonGrey.includes('red')) return 'red';
  if (nonGrey.includes('amber')) return 'amber';
  return 'green';
}

function managerStatusColor(status: ManagerStatus | null): string {
  switch (status) {
    case 'SOLID': return C.green;
    case 'WATCH': return C.amber;
    case 'AT RISK': return C.red;
    case 'NEW': return C.teal;
    default: return C.text3;
  }
}

function avg(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && !isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmt(v: number | null, dp = 1): string {
  if (v === null) return '—';
  return Number.isFinite(v) ? v.toFixed(dp) : '—';
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function AgentRosterView({ onSelectAgent }: {
  onSelectAgent: (agentName: string) => void;
}) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [kpiRows, setKpiRows] = useState<AgentDailyRow[]>([]);
  const [surveyScores, setSurveyScores] = useState<Record<string, number>>({});
  const [calendarData, setCalendarData] = useState<Record<string, CalendarEntry | null>>({});
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState<string | null>(null);
  const [generatingPrepFor, setGeneratingPrepFor] = useState<string | null>(null);
  const [prepResult, setPrepResult] = useState<{ agent: string; ok: boolean; error?: string } | null>(null);
  const [filterTeam, setFilterTeam] = useState<string>('all');
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rosterRes, kpiRes, surveyRes, calRes] = await Promise.all([
        fetch('/api/people/roster'),
        fetch('/api/kpi-data/agent-kpis?env=live&days=30'),
        fetch('/api/people/roster/survey-scores'),
        fetch('/api/people/roster/calendar'),
      ]);
      const rosterJson = await rosterRes.json();
      const kpiJson = await kpiRes.json();
      const surveyJson = await surveyRes.json();
      const calJson = await calRes.json();
      if (rosterJson.ok) setRoster(rosterJson.data || []);
      if (kpiJson.ok) setKpiRows(kpiJson.data || []);
      if (surveyJson.ok) setSurveyScores(surveyJson.data || {});
      if (calJson.ok) setCalendarData(calJson.data || {});
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Aggregate KPIs per agent (30-day averages)
  const kpiByAgent = useMemo(() => {
    const map = new Map<string, AgentDailyRow[]>();
    for (const row of kpiRows) {
      const name = row.AgentName;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(row);
    }
    const result = new Map<string, { sla: number | null; qa: number | null; gr: number | null; tph: number | null; tier: string; team: string }>();
    for (const [name, rows] of map) {
      const solvedTotal = rows.reduce((s, r) => s + (r.SolvedTickets_Today ?? 0), 0);
      const slaBreached = rows.reduce((s, r) => s + (r.SLABreachedCount ?? 0), 0);
      result.set(name, {
        sla: solvedTotal === 0 ? null : ((solvedTotal - slaBreached) / solvedTotal) * 100,
        qa: avg(rows.map(r => r.QAOverallAvg)),
        gr: avg(rows.map(r => r.GoldenRulesAvg)),
        tph: avg(rows.map(r => r.TicketsPerHour).filter((v): v is number => v !== null && v > 0)),
        tier: rows[rows.length - 1].TierCode ?? '',
        team: rows[rows.length - 1].Team ?? '',
      });
    }
    return result;
  }, [kpiRows]);

  // Build unified cards
  const cards: AgentCard[] = useMemo(() => {
    return roster.map(r => {
      const kpi = kpiByAgent.get(r.agent_name);
      const satScore = surveyScores[r.agent_name] ?? null;
      const cal = calendarData[r.agent_name];
      const calStart = cal?.start ?? null;
      const kH = kpi ? kpiRag(kpi.sla, kpi.tph) : 'grey' as Rag;
      const qaH = kpi ? qaRag(kpi.qa) : 'grey' as Rag;
      const grH = kpi ? grRag(kpi.gr) : 'grey' as Rag;
      const trH = trainingRag(r.training_done, r.training_total, r.training_overdue ?? 0, r.training_due_soon ?? 0);
      const saH = satisfactionRag(satScore);
      const n1H = next121Rag(calStart);
      return {
        name: r.agent_name,
        roleTitle: r.role_title || '',
        functionName: r.function_name || '',
        tierCode: kpi?.tier || '',
        planStatus: r.status,
        managerStatus: (r.manager_status as ManagerStatus) ?? null,
        kpiHealth: kH,
        qaHealth: qaH,
        goldenRules: grH,
        trainingHealth: trH,
        satisfactionHealth: saH,
        next121Health: n1H,
        compositeRag: worstRag([kH, qaH, grH, trH, saH, n1H]),
        trainingLabel: `${r.training_done}/${r.training_total}`,
        slaCompliancePct: kpi?.sla ?? null,
        qaOverallAvg: kpi?.qa ?? null,
        goldenRulesAvg: kpi?.gr ?? null,
        ticketsPerHourAvg: kpi?.tph ?? null,
        satisfactionAvg: satScore,
        next121Date: calStart,
      };
    });
  }, [roster, kpiByAgent, surveyScores, calendarData]);

  const teams = useMemo(() => [...new Set(cards.map(c => c.functionName).filter(Boolean))].sort(), [cards]);

  const filtered = filterTeam === 'all' ? cards : cards.filter(c => c.functionName === filterTeam);

  const createSnapshot = useCallback(async (agentName: string) => {
    setSnapshotting(agentName);
    try {
      await fetch(`/api/people/agent/${encodeURIComponent(agentName)}/snapshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot_date: new Date().toISOString().slice(0, 10),
          notes: 'Quick snapshot from roster',
        }),
      });
    } catch { /* ignore */ }
    setSnapshotting(null);
  }, []);

  const updateManagerStatus = useCallback(async (agentName: string, newStatus: ManagerStatus) => {
    setUpdatingStatus(agentName);
    try {
      await fetch(`/api/people/agent/${encodeURIComponent(agentName)}/plan`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manager_status: newStatus }),
      });
      setRoster(prev => prev.map(r =>
        r.agent_name === agentName ? { ...r, manager_status: newStatus } : r
      ));
    } catch { /* ignore */ }
    setUpdatingStatus(null);
  }, []);

  const generatePrep = useCallback(async (agentName: string) => {
    setGeneratingPrepFor(agentName);
    setPrepResult(null);
    try {
      const res = await fetch(`/api/people/agent/${encodeURIComponent(agentName)}/generate-prep`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.ok) {
        setPrepResult({ agent: agentName, ok: true });
      } else {
        setPrepResult({ agent: agentName, ok: false, error: json.error || 'Unknown error' });
      }
    } catch (err: any) {
      setPrepResult({ agent: agentName, ok: false, error: err.message || 'Network error' });
    }
    setGeneratingPrepFor(null);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        <div style={{
          height: 56, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 32,
        }} />
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16,
        }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: 20, height: 180, opacity: 0.3 + (i * 0.1),
            }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', 'Plus Jakarta Sans', system-ui, sans-serif",
      color: C.text1,
    }}>
      <style>{`
        @keyframes akFadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes akGradient {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {/* Top Bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%', animation: 'akGradient 3s ease infinite',
        }} />
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: C.text1 }}>My Team</h1>
          <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
            {filtered.length} agent{filtered.length !== 1 ? 's' : ''} • 30-day KPI averages
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {teams.length > 1 && (
            <select
              value={filterTeam}
              onChange={e => setFilterTeam(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: C.bg2, color: C.text1, fontSize: 11,
              }}
            >
              <option value="all">All teams</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button
            onClick={fetchData}
            style={{
              width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`,
              background: C.glass, cursor: 'pointer', color: C.text2,
              fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="Refresh"
          >&#x21bb;</button>
        </div>
      </div>

      {/* RAG Legend */}
      <div style={{
        display: 'flex', gap: 20, padding: '8px 24px', marginBottom: 16,
        fontSize: 10, color: C.text3,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{ragDot('green')} On target</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{ragDot('amber')} Needs attention</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{ragDot('red')} Off target</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{ragDot('grey')} No data</span>
      </div>

      {/* Agent Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16,
        animation: 'akFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
        {filtered.map(card => (
          <div
            key={card.name}
            onClick={() => onSelectAgent(card.name)}
            style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '20px 24px', cursor: 'pointer', transition: 'all 0.2s',
              position: 'relative', overflow: 'hidden',
              borderLeft: `3px solid ${
                card.managerStatus ? managerStatusColor(card.managerStatus) :
                ({ green: C.green, amber: C.amber, red: C.red, grey: C.text3 })[card.compositeRag]
              }`,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = C.glassHover;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = C.glass;
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text1 }}>{card.name}</div>
                <div style={{ fontSize: 11, color: C.text3 }}>
                  {card.roleTitle}{card.tierCode ? ` • ${card.tierCode}` : ''}
                </div>
                {card.planStatus === 'deferred' && (
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 6,
                    background: `${C.amber}20`, color: C.amber, marginTop: 4, display: 'inline-block',
                  }}>DEFERRED</span>
                )}
              </div>
              <select
                value={card.managerStatus ?? ''}
                onClick={e => e.stopPropagation()}
                onChange={e => {
                  e.stopPropagation();
                  updateManagerStatus(card.name, e.target.value as ManagerStatus);
                }}
                disabled={updatingStatus === card.name}
                style={{
                  padding: '3px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700,
                  border: `1px solid ${managerStatusColor(card.managerStatus)}40`,
                  background: `${managerStatusColor(card.managerStatus)}15`,
                  color: managerStatusColor(card.managerStatus),
                  cursor: 'pointer', appearance: 'auto',
                }}
              >
                <option value="">—</option>
                {MANAGER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* RAG Row */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 16,
            }}>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.kpiHealth)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>KPI</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.slaCompliancePct !== null ? `${fmt(card.slaCompliancePct)}%` : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.qaHealth)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>QA</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.qaOverallAvg !== null ? fmt(card.qaOverallAvg) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.goldenRules)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>GR</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.goldenRulesAvg !== null ? fmt(card.goldenRulesAvg) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.trainingHealth)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>Training</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.trainingLabel}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.satisfactionHealth)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>Satisf.</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.satisfactionAvg !== null ? fmt(card.satisfactionAvg) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.next121Health)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>1-2-1</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.next121Date ? new Date(card.next121Date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                {ragDot(card.compositeRag)}
                <div style={{ fontSize: 8, color: C.text3, marginTop: 3 }}>Overall</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.text2 }}>
                  {card.compositeRag === 'grey' ? '—' : card.compositeRag.charAt(0).toUpperCase() + card.compositeRag.slice(1)}
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={e => { e.stopPropagation(); generatePrep(card.name); }}
                disabled={generatingPrepFor === card.name}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 8,
                  border: `1px solid ${prepResult?.agent === card.name && !prepResult.ok ? '#ef4444' : C.border}`,
                  background: prepResult?.agent === card.name && prepResult.ok ? `${C.green}15` : C.glass,
                  color: generatingPrepFor === card.name ? C.text3 : prepResult?.agent === card.name && prepResult.ok ? C.green : C.text2,
                  fontSize: 10, fontWeight: 600, cursor: generatingPrepFor === card.name ? 'wait' : 'pointer',
                  transition: 'all 0.2s',
                }}
                title={prepResult?.agent === card.name && !prepResult.ok ? prepResult.error : undefined}
              >{generatingPrepFor === card.name ? 'Generating...' : prepResult?.agent === card.name && prepResult.ok ? '✓ Prep Ready' : prepResult?.agent === card.name && !prepResult.ok ? 'Failed' : 'Generate 1-2-1 Prep'}</button>
              <button
                onClick={e => { e.stopPropagation(); createSnapshot(card.name); }}
                disabled={snapshotting === card.name}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 8,
                  border: `1px solid ${C.border}`, background: C.glass,
                  color: snapshotting === card.name ? C.text3 : C.text2,
                  fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >{snapshotting === card.name ? 'Saving...' : '1-2-1 Snapshot'}</button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{
          padding: '40px 20px', textAlign: 'center',
          background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text2, marginBottom: 8 }}>No agents found</div>
          <div style={{ fontSize: 12, color: C.text3 }}>
            Import development plans using the import script.
          </div>
        </div>
      )}
    </div>
  );
}
