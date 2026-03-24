import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface KpiSnapshot {
  KPI: string;
  KPIGroup: string;
  Count: number;
  KPITarget: number | null;
  KPIDirection: string | null;
  RAG: number | null;
  CreatedAt: string;
}

interface SnapshotCompare {
  KPI: string;
  KPIGroup: string;
  liveCount: number | null;
  uatCount: number | null;
  diff: number | null;
  KPITarget: number | null;
  KPIDirection: string | null;
  liveRAG: number | null;
  uatRAG: number | null;
  liveUpdated: string | null;
  uatUpdated: string | null;
}

interface Agent {
  AgentName: string;
  AgentSurname: string;
  TierCode: string;
  Team: string;
  IsAvailable: boolean;
  OpenTickets_Total: number;
  OpenTickets_Over2Hours: number;
  OpenTickets_NoUpdateToday: number;
  SolvedTickets_Today: number;
  SolvedTickets_ThisWeek: number;
  TicketsSnapshotAt: string;
  QAAvgScore: number | null;
  QACount: number | null;
}

/* ------------------------------------------------------------------ */
/*  Colours & Tokens                                                   */
/* ------------------------------------------------------------------ */

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

const ragColor = (rag: number | null) => {
  if (rag === 1) return C.green;
  if (rag === 2) return C.amber;
  if (rag === 3) return C.red;
  return C.text3;
};

const ragBg = (rag: number | null) => {
  if (rag === 1) return 'rgba(5,150,105,0.08)';
  if (rag === 2) return 'rgba(217,119,6,0.08)';
  if (rag === 3) return 'rgba(239,68,68,0.08)';
  return 'transparent';
};

const ragLabel = (rag: number | null) => {
  if (rag === 1) return 'Green';
  if (rag === 2) return 'Amber';
  if (rag === 3) return 'Red';
  return '-';
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fmtNum(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined) return '-';
  return Number.isFinite(v) ? v.toFixed(dp) : String(v);
}

function fmtTime(v: string | null): string {
  if (!v) return '-';
  try {
    return new Date(v).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return v; }
}

/* ------------------------------------------------------------------ */
/*  KPI Sort Order                                                     */
/* ------------------------------------------------------------------ */

// Flat display order — position in this array is the sort key.
// KPIs not in this list sort to the end alphabetically.
// Names must match the DB KpiSnapshot.KPI column exactly (case-insensitive).
const KPI_ORDER: string[] = [
  // — Raised / Solved today —
  'New Tickets Today',
  'Tickets Solved Today',
  // — Open ticket counts —
  'Number of Tickets in Customer Care',
  'Number of Tickets in CC (Incidents)',
  'Number of Tickets in CC (Service Requests)',
  'Number of Tickets in CC (TPJ)',
  'Number of Tickets in Production',
  'Number of Tickets in Tier 2',
  'Number of Tickets in Tier 3',
  'Number of Tickets in Development',
  // — No reply —
  'Number of Tickets With No Reply in CC (Incidents)',
  'Number of Tickets With No Reply in CC (Service Requests)',
  'Number of Tickets With No Reply in CC (TPJ)',
  'Number of Tickets With No Reply in Production',
  'Number of Tickets With No Reply in Development',
  'Number of Tickets With No Reply in Tier 2',
  'Number of Tickets With No Reply in Tier 3',
  // — SLA actionable —
  'CC Incidents over SLA (actionable)',
  'CC Service Requests over SLA (actionable)',
  'CC (TPJ) over SLA (actionable)',
  'CC TPJ over SLA (actionable)',
  'Production over SLA (actionable)',
  'Tier 2 over SLA (actionable)',
  'Tier 3 over SLA (actionable)',
  'Development over SLA (actionable)',
  // — SLA not actionable —
  'CC Incidents over SLA (not actionable)',
  'CC Service Requests over SLA (not actionable)',
  'CC (TPJ) over SLA (not actionable)',
  'CC TPJ over SLA (not actionable)',
  'Production over SLA (not actionable)',
  'Tier 2 over SLA (not actionable)',
  'Tier 3 over SLA (not actionable)',
  'Development over SLA (not actionable)',
  // — Escalations —
  'Tickets escalated to Tier 2',
  'Tickets escalated to Tier 3',
  'Tickets escalated to Development',
  // — Rejections —
  'Tickets rejected by Tier 2',
  'Tickets rejected by Tier 3',
  'Tickets rejected by Development',
  // — Oldest actionable —
  'Oldest actionable ticket (days) in CC Incidents',
  'Oldest actionable ticket (days) in CC Service Requests',
  'Oldest actionable ticket (days) in CC (TPJ)',
  'Oldest actionable ticket (days) in CC TPJ',
  'Oldest actionable ticket (days) in Production',
  'Oldest actionable ticket (days) in Development',
  'Oldest actionable ticket (days) in Tier 2',
  'Oldest actionable ticket (days) in Tier 3',
];

// Build a case-insensitive lookup for resilient matching
const KPI_ORDER_MAP = new Map<string, number>();
KPI_ORDER.forEach((name, i) => KPI_ORDER_MAP.set(name.toLowerCase(), i));

function kpiSortKey(kpi: { KPI: string; KPIGroup: string }): number {
  const idx = KPI_ORDER_MAP.get(kpi.KPI.toLowerCase());
  return idx !== undefined ? idx : KPI_ORDER.length;
}

function sortKpis<T extends { KPI: string; KPIGroup: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const ka = kpiSortKey(a);
    const kb = kpiSortKey(b);
    if (ka !== kb) return ka - kb;
    return a.KPI.localeCompare(b.KPI);
  });
}

function directionArrow(dir: string | null): string {
  if (!dir) return '';
  const d = dir.toLowerCase();
  if (d === 'lower is better' || d === 'lower' || d === 'down') return '\u2193';
  if (d === 'higher is better' || d === 'higher' || d === 'up') return '\u2191';
  return '';
}

function progressPct(count: number, target: number | null, dir: string | null): number {
  if (!target || target === 0) return 0;
  const d = (dir || '').toLowerCase();
  if (d.includes('lower')) {
    // For "lower is better", invert: 100% when count=0, 0% when count>=2*target
    return Math.max(0, Math.min(100, ((2 * target - count) / (2 * target)) * 100));
  }
  return Math.max(0, Math.min(100, (count / target) * 100));
}

function rankSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function rankColor(n: number): string {
  if (n === 1) return '#fbbf24';
  if (n === 2) return '#9ca3af';
  if (n === 3) return '#d97706';
  return C.text3;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{
        fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.8px', color: C.teal, margin: 0,
      }}>{title}</h2>
      {subtitle && (
        <p style={{ fontSize: 11, color: C.text3, margin: '4px 0 0' }}>{subtitle}</p>
      )}
    </div>
  );
}

function Pulse({ color }: { color: string }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      backgroundColor: color,
      boxShadow: `0 0 6px ${color}`,
      animation: 'kpiPulse 2s ease-in-out infinite',
    }} />
  );
}

function SkeletonCard() {
  return (
    <div style={{
      background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 20, height: 100,
      animation: 'kpiShimmer 1.5s ease-in-out infinite alternate',
    }} />
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Summary Card                                                   */
/* ------------------------------------------------------------------ */

function KpiCard({ kpi }: { kpi: KpiSnapshot }) {
  const [hovered, setHovered] = useState(false);
  const pct = progressPct(kpi.Count, kpi.KPITarget, kpi.KPIDirection);
  const rc = ragColor(kpi.RAG);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? C.glassHover : C.glass,
        border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${rc}`,
        borderRadius: 12,
        padding: '16px 20px',
        transition: 'all 0.2s ease',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? `0 8px 24px rgba(0,0,0,0.3), 0 0 0 1px ${rc}33` : 'none',
        position: 'relative' as const,
        overflow: 'hidden' as const,
      }}
    >
      {/* Subtle RAG background glow */}
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 80, height: 80,
        background: `radial-gradient(circle at 100% 0%, ${rc}15, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: C.text2,
          lineHeight: 1.3, maxWidth: '75%',
        }}>{kpi.KPI}</span>
        <span style={{ fontSize: 12, color: rc, fontWeight: 600 }}>
          {directionArrow(kpi.KPIDirection)}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: C.text1, lineHeight: 1 }}>
          {fmtNum(kpi.Count)}
        </span>
        {kpi.KPITarget !== null && (
          <span style={{ fontSize: 12, color: C.text3, fontWeight: 500 }}>
            / {fmtNum(kpi.KPITarget)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {kpi.KPITarget !== null && (
        <div style={{
          height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2, width: `${pct}%`,
            background: `linear-gradient(90deg, ${rc}, ${rc}cc)`,
            transition: 'width 0.6s cubic-bezier(0.16,1,0.3,1)',
          }} />
        </div>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 600, color: rc,
          padding: '2px 8px', borderRadius: 10,
          background: ragBg(kpi.RAG),
        }}>
          {ragLabel(kpi.RAG)}
        </span>
        <span style={{ fontSize: 10, color: C.text3 }}>{fmtTime(kpi.CreatedAt)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 1: KPI Summary Cards                                       */
/* ------------------------------------------------------------------ */

const GLOSSARY: { term: string; meaning: string }[] = [
  { term: 'FRT', meaning: 'First Reply Time — time from ticket creation to first public agent reply' },
  { term: 'FRT %', meaning: '% of tickets where the first reply was sent within the SLA target' },
  { term: 'Resolution %', meaning: '% of tickets resolved within the resolution SLA target' },
  { term: 'FCR', meaning: 'First Contact Resolution — ticket resolved without reopening or re-escalation' },
  { term: 'CSAT', meaning: 'Customer Satisfaction — score collected from post-ticket survey' },
  { term: 'RAG', meaning: 'Red / Amber / Green — traffic light status vs target' },
  { term: 'Actionable', meaning: 'Tickets the team can act on now (not waiting on customer or third party)' },
  { term: 'Not actionable', meaning: 'Tickets waiting on customer reply or third party — SLA paused' },
];

function KpiSummarySection({ data }: { data: KpiSnapshot[] }) {
  const [sortBy, setSortBy] = useState<'type' | 'breached'>('type');
  const [showGlossary, setShowGlossary] = useState(false);

  // Summary counts
  const greenCount = data.filter(d => d.RAG === 1).length;
  const amberCount = data.filter(d => d.RAG === 2).length;
  const redCount = data.filter(d => d.RAG === 3).length;

  // Sort data using defined KPI order
  const sorted = sortKpis(data);
  console.log('[KPI DEBUG] Raw data KPI names:', data.map(d => d.KPI));
  console.log('[KPI DEBUG] Sorted order:', sorted.map(d => `${d.KPI} (pos=${KPI_ORDER_MAP.get(d.KPI.toLowerCase()) ?? 'MISS'})`));

  // Group data based on sort mode
  let groups: [string, KpiSnapshot[]][];
  if (sortBy === 'type') {
    // Build groups preserving the sorted order
    const groupOrder: string[] = [];
    const grouped: Record<string, KpiSnapshot[]> = {};
    for (const row of sorted) {
      const g = row.KPIGroup || 'Other';
      if (!grouped[g]) { grouped[g] = []; groupOrder.push(g); }
      grouped[g].push(row);
    }
    groups = groupOrder.map(g => [g, grouped[g]]);
  } else {
    // Sort by RAG: Red (3) first, then Amber (2), then Green (1), then unset
    const ragOrder = (rag: number | null) => rag === 3 ? 0 : rag === 2 ? 1 : rag === 1 ? 2 : 3;
    const ragLabels: Record<number, string> = { 0: 'Red - Breached', 1: 'Amber - At Risk', 2: 'Green - On Target', 3: 'No Target' };
    const sorted = [...data].sort((a, b) => ragOrder(a.RAG) - ragOrder(b.RAG));
    const grouped = sorted.reduce<Record<string, KpiSnapshot[]>>((acc, row) => {
      const key = ragLabels[ragOrder(row.RAG)];
      (acc[key] = acc[key] || []).push(row);
      return acc;
    }, {});
    groups = Object.entries(grouped);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <SectionHeader title="KPI Overview" subtitle={`${data.length} metrics tracked`} />
          <button
            onClick={() => setShowGlossary(!showGlossary)}
            title="Glossary"
            style={{
              width: 22, height: 22, borderRadius: '50%', border: `1px solid ${C.border}`,
              background: showGlossary ? `${C.teal}20` : C.glass, cursor: 'pointer',
              fontSize: 12, fontWeight: 700, color: showGlossary ? C.teal : C.text3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s', marginTop: -8,
            }}
          >?</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Sort toggle */}
          <div style={{
            display: 'flex', borderRadius: 20, overflow: 'hidden',
            border: `1px solid ${C.border}`,
          }}>
            {([
              { id: 'type' as const, label: 'By Type' },
              { id: 'breached' as const, label: 'By RAG' },
            ]).map(s => (
              <button
                key={s.id}
                onClick={() => setSortBy(s.id)}
                style={{
                  padding: '4px 12px', border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600, transition: 'all 0.2s',
                  background: sortBy === s.id ? `${C.teal}20` : 'transparent',
                  color: sortBy === s.id ? C.teal : C.text3,
                }}
              >{s.label}</button>
            ))}
          </div>
          {/* RAG summary pills */}
          <div style={{ display: 'flex', gap: 12 }}>
            {[
              { label: 'Green', count: greenCount, color: C.green },
              { label: 'Amber', count: amberCount, color: C.amber },
              { label: 'Red', count: redCount, color: C.red },
            ].map(s => (
              <div key={s.label} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 12px', borderRadius: 20,
                background: `${s.color}15`, border: `1px solid ${s.color}30`,
              }}>
                <Pulse color={s.color} />
                <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.count}</span>
                <span style={{ fontSize: 10, color: C.text3 }}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showGlossary && (
        <div style={{
          marginBottom: 20, padding: '14px 20px', borderRadius: 10,
          background: `${C.teal}08`, border: `1px solid ${C.teal}25`,
          animation: 'kpiFadeIn 0.2s ease',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Glossary
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '6px 24px' }}>
            {GLOSSARY.map(g => (
              <div key={g.term} style={{ display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 700, color: C.text1, minWidth: 90, flexShrink: 0 }}>{g.term}</span>
                <span style={{ color: C.text2 }}>{g.meaning}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.map(([group, kpis]) => (
        <div key={group} style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '1px', color: C.text3, marginBottom: 10,
            paddingBottom: 6, borderBottom: `1px solid ${C.border}`,
          }}>{group}</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 12,
          }}>
            {kpis.map(kpi => <KpiCard key={kpi.KPI} kpi={kpi} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 2: Live vs UAT Comparison                                  */
/* ------------------------------------------------------------------ */

function ComparisonSection({ data }: { data: SnapshotCompare[] }) {
  const matching = data.filter(d => d.liveRAG === d.uatRAG).length;
  const mismatched = data.length - matching;

  function deltaColor(diff: number | null): string {
    if (diff === null || diff === undefined) return C.text3;
    const abs = Math.abs(diff);
    if (abs === 0) return C.green;
    if (abs <= 5) return C.amber;
    return C.red;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionHeader title="Live vs UAT Comparison" subtitle="Environment snapshot parity check" />
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{
            padding: '4px 14px', borderRadius: 20,
            background: `${C.green}15`, border: `1px solid ${C.green}30`,
            fontSize: 12, fontWeight: 600, color: C.green,
          }}>
            {matching} matching
          </div>
          <div style={{
            padding: '4px 14px', borderRadius: 20,
            background: mismatched > 0 ? `${C.red}15` : `${C.green}15`,
            border: `1px solid ${mismatched > 0 ? C.red : C.green}30`,
            fontSize: 12, fontWeight: 600, color: mismatched > 0 ? C.red : C.green,
          }}>
            {mismatched} mismatched
          </div>
        </div>
      </div>

      <div style={{
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['KPI', 'Group', 'Live', 'UAT', 'Delta', 'Live RAG', 'UAT RAG', 'Match'].map(h => (
                <th key={h} style={{
                  padding: '12px 16px', textAlign: h === 'KPI' || h === 'Group' ? 'left' : 'center',
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.5px', color: C.text3,
                  background: C.bg1, borderBottom: `1px solid ${C.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const match = row.liveRAG === row.uatRAG;
              return (
                <tr key={i} style={{
                  background: !match ? 'rgba(239,68,68,0.04)' : 'transparent',
                  transition: 'background 0.15s',
                }}>
                  <td style={{
                    padding: '10px 16px', fontSize: 13, color: C.text1, fontWeight: 500,
                    borderBottom: `1px solid ${C.border}`,
                  }}>{row.KPI}</td>
                  <td style={{
                    padding: '10px 16px', fontSize: 11, color: C.text3,
                    borderBottom: `1px solid ${C.border}`,
                  }}>{row.KPIGroup}</td>
                  <td style={{
                    padding: '10px 16px', fontSize: 14, fontWeight: 700, color: C.text1,
                    textAlign: 'center', borderBottom: `1px solid ${C.border}`,
                  }}>{fmtNum(row.liveCount)}</td>
                  <td style={{
                    padding: '10px 16px', fontSize: 14, fontWeight: 700, color: C.text2,
                    textAlign: 'center', borderBottom: `1px solid ${C.border}`,
                  }}>{fmtNum(row.uatCount)}</td>
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: deltaColor(row.diff),
                      padding: '2px 10px', borderRadius: 10,
                      background: `${deltaColor(row.diff)}15`,
                    }}>
                      {row.diff !== null ? (row.diff > 0 ? `+${row.diff}` : row.diff) : '-'}
                    </span>
                  </td>
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: ragColor(row.liveRAG),
                      padding: '2px 8px', borderRadius: 10, background: ragBg(row.liveRAG),
                    }}>{ragLabel(row.liveRAG)}</span>
                  </td>
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, color: ragColor(row.uatRAG),
                      padding: '2px 8px', borderRadius: 10, background: ragBg(row.uatRAG),
                    }}>{ragLabel(row.uatRAG)}</span>
                  </td>
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {match ? (
                      <span style={{ fontSize: 16, color: C.green }}>&#10003;</span>
                    ) : (
                      <span style={{ fontSize: 16, color: C.red }}>&#10007;</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section 3: Agent Leaderboard                                       */
/* ------------------------------------------------------------------ */

function AgentLeaderboard({ data }: { data: Agent[] }) {
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');

  const sorted = [...data].sort((a, b) => {
    if (period === 'daily') {
      const diff = b.SolvedTickets_Today - a.SolvedTickets_Today;
      if (diff !== 0) return diff;
      return b.SolvedTickets_ThisWeek - a.SolvedTickets_ThisWeek;
    } else {
      const diff = b.SolvedTickets_ThisWeek - a.SolvedTickets_ThisWeek;
      if (diff !== 0) return diff;
      return b.SolvedTickets_Today - a.SolvedTickets_Today;
    }
  });

  const totalSolvedToday = data.reduce((s, a) => s + a.SolvedTickets_Today, 0);
  const totalSolvedWeek = data.reduce((s, a) => s + a.SolvedTickets_ThisWeek, 0);
  const availableCount = data.filter(a => a.IsAvailable).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionHeader title="Agent Leaderboard" subtitle={`${data.length} agents tracked`} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Daily / Weekly toggle */}
          <div style={{
            display: 'flex', borderRadius: 20, overflow: 'hidden',
            border: `1px solid ${C.border}`,
          }}>
            {([
              { id: 'daily' as const, label: 'Daily' },
              { id: 'weekly' as const, label: 'Weekly' },
            ]).map(p => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                style={{
                  padding: '4px 12px', border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 600, transition: 'all 0.2s',
                  background: period === p.id ? `${C.teal}20` : 'transparent',
                  color: period === p.id ? C.teal : C.text3,
                }}
              >{p.label}</button>
            ))}
          </div>
          <div style={{
            padding: '4px 14px', borderRadius: 20,
            background: `${C.teal}15`, border: `1px solid ${C.teal}30`,
            fontSize: 12, fontWeight: 600, color: C.teal,
          }}>
            {period === 'daily' ? `${totalSolvedToday} solved today` : `${totalSolvedWeek} solved this week`}
          </div>
          <div style={{
            padding: '4px 14px', borderRadius: 20,
            background: `${C.green}15`, border: `1px solid ${C.green}30`,
            fontSize: 12, fontWeight: 600, color: C.green,
          }}>
            {availableCount} available
          </div>
        </div>
      </div>

      <div style={{
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Rank', 'Agent', 'Team', 'Tier', 'Solved Today', 'Solved Week', 'Open', '>2h Overdue', 'Stale', 'QA'].map(h => (
                <th key={h} style={{
                  padding: '12px 16px',
                  textAlign: h === 'Agent' || h === 'Team' || h === 'Tier' ? 'left' : 'center',
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.5px', color: C.text3,
                  background: C.bg1, borderBottom: `1px solid ${C.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((agent, i) => {
              const rank = i + 1;
              const isTop3 = rank <= 3;
              const isZero = period === 'daily'
                ? agent.SolvedTickets_Today === 0
                : agent.SolvedTickets_ThisWeek === 0;

              return (
                <tr key={i} style={{
                  background: isTop3 ? `${rankColor(rank)}08` : 'transparent',
                  opacity: isZero ? 0.5 : 1,
                  transition: 'background 0.15s',
                }}>
                  {/* Rank */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: '50%',
                      background: isTop3 ? `${rankColor(rank)}20` : 'transparent',
                      border: isTop3 ? `1px solid ${rankColor(rank)}40` : 'none',
                      fontSize: 12, fontWeight: 800,
                      color: isTop3 ? rankColor(rank) : C.text3,
                    }}>
                      {rank}{rankSuffix(rank)}
                    </span>
                  </td>

                  {/* Agent Name + Availability */}
                  <td style={{
                    padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        background: agent.IsAvailable ? C.green : '#4b5563',
                        boxShadow: agent.IsAvailable ? `0 0 6px ${C.green}` : 'none',
                        flexShrink: 0,
                      }} />
                      <span style={{
                        fontSize: 13, fontWeight: isTop3 ? 700 : 500,
                        color: isTop3 ? C.text1 : (isZero ? C.text3 : C.text1),
                      }}>
                        {agent.AgentName} {agent.AgentSurname}
                      </span>
                    </div>
                  </td>

                  {/* Team */}
                  <td style={{
                    padding: '10px 16px', fontSize: 12, color: C.text2,
                    borderBottom: `1px solid ${C.border}`,
                  }}>{agent.Team}</td>

                  {/* Tier */}
                  <td style={{
                    padding: '10px 16px', borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: C.purple,
                      padding: '2px 8px', borderRadius: 8,
                      background: `${C.purple}15`,
                    }}>{agent.TierCode}</span>
                  </td>

                  {/* Solved Today */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: period === 'daily' ? 18 : 14,
                      fontWeight: period === 'daily' ? 800 : 600,
                      color: period === 'daily'
                        ? (agent.SolvedTickets_Today > 0 ? C.teal : C.text3)
                        : C.text2,
                    }}>
                      {agent.SolvedTickets_Today}
                    </span>
                  </td>

                  {/* Solved Week */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: period === 'weekly' ? 18 : 14,
                      fontWeight: period === 'weekly' ? 800 : 600,
                      color: period === 'weekly'
                        ? (agent.SolvedTickets_ThisWeek > 0 ? C.teal : C.text3)
                        : C.text2,
                    }}>
                      {agent.SolvedTickets_ThisWeek}
                    </span>
                  </td>

                  {/* Open */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center', fontSize: 13, fontWeight: 500,
                    color: C.text2, borderBottom: `1px solid ${C.border}`,
                  }}>{agent.OpenTickets_Total}</td>

                  {/* >2h Overdue */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 600,
                      color: agent.OpenTickets_Over2Hours > 0 ? C.red : C.text3,
                    }}>
                      {agent.OpenTickets_Over2Hours}
                    </span>
                  </td>

                  {/* Stale */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    <span style={{
                      fontSize: 13, fontWeight: 600,
                      color: agent.OpenTickets_NoUpdateToday > 0 ? C.amber : C.text3,
                    }}>
                      {agent.OpenTickets_NoUpdateToday}
                    </span>
                  </td>

                  {/* QA Score */}
                  <td style={{
                    padding: '10px 16px', textAlign: 'center',
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {agent.QAAvgScore != null ? (
                      <span style={{
                        fontSize: 13, fontWeight: 700,
                        color: agent.QAAvgScore >= 2.5 ? C.green : agent.QAAvgScore >= 1.5 ? C.amber : C.red,
                      }}>
                        {Number(agent.QAAvgScore).toFixed(1)}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: C.text3 }}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function KpiDashboardView() {
  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [qaSummary, setQaSummary] = useState<{ avgScore: number; green: number; amber: number; red: number; fullQA: number } | null>(null);
  const [weeklyDigests, setWeeklyDigests] = useState<{ period: string; summary: string; html: string | null; CreatedAt: string }[]>([]);
  const [dailyDigests, setDailyDigests] = useState<{ period: string; summary: string; html: string | null; CreatedAt: string }[]>([]);
  const [digestMode, setDigestMode] = useState<'weekly' | 'daily'>('weekly');
  const [expandedDigest, setExpandedDigest] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const env = 'live' as const;

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const [snapRes, agentRes, qaRes, digestRes] = await Promise.all([
        fetch(`/api/kpi-data/team-snapshot?env=${env}`),
        fetch(`/api/kpi-data/agents?env=${env}`),
        fetch(`/api/kpi-data/qa-summary?env=${env}&days=7`).catch(() => null),
        fetch(`/api/kpi-data/digest?env=${env}&days=30`).catch(() => null),
      ]);
      const snapData = await snapRes.json();
      const agentData = await agentRes.json();
      if (!snapData.ok) throw new Error(snapData.error || 'Failed to load team snapshot');
      if (!agentData.ok) throw new Error(agentData.error || 'Failed to load agents');
      setSnapshots(snapData.data || []);
      setAgents(agentData.data || []);
      // QA summary (non-critical)
      if (qaRes) {
        try { const d = await qaRes.json(); if (d.ok) setQaSummary(d.data); } catch { /* ignore */ }
      }
      // Digest (non-critical) — keep both Weekly (4) and Daily (28)
      if (digestRes) {
        try {
          const d = await digestRes.json();
          if (d.ok && d.data?.length > 0) {
            type DigestEntry = { period: string; summary: string; html: string | null; CreatedAt: string };
            const all = d.data as DigestEntry[];
            setWeeklyDigests(all.filter((e: DigestEntry) => e.period?.toLowerCase() === 'weekly').slice(0, 4));
            setDailyDigests(all.filter((e: DigestEntry) => e.period?.toLowerCase() === 'daily').slice(0, 28));
          }
        } catch { /* ignore */ }
      }
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [env]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchAll, 60_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchAll]);

  /* ---- Keyframe injection (once) ---- */
  useEffect(() => {
    const id = 'kpi-dashboard-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes kpiPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(0.85); }
      }
      @keyframes kpiShimmer {
        0% { opacity: 0.3; }
        100% { opacity: 0.6; }
      }
      @keyframes kpiFadeIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes kpiGradient {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById(id)?.remove(); };
  }, []);

  /* ---- Loading state ---- */
  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        {/* Top bar skeleton */}
        <div style={{
          height: 56, background: C.glass, border: `1px solid ${C.border}`,
          borderRadius: 12, marginBottom: 32,
          animation: 'kpiShimmer 1.5s ease-in-out infinite alternate',
        }} />
        {/* Card skeletons */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12,
        }}>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
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
      {/* ---- Top Bar ---- */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 32,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
        position: 'relative' as const, overflow: 'hidden' as const,
      }}>
        {/* Animated gradient top border */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, ${C.teal}, ${C.purple}, ${C.teal})`,
          backgroundSize: '200% 100%',
          animation: 'kpiGradient 4s ease-in-out infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Logo */}
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${C.teal}, ${C.purple})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800, color: '#fff',
            boxShadow: `0 0 20px ${C.teal}40`,
          }}>K</div>
          <div>
            <h1 style={{
              fontSize: 20, fontWeight: 800, margin: 0, color: C.text1,
              letterSpacing: '-0.3px',
            }}>KPI Dashboard</h1>
            <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>
              Live operational metrics
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* Last refreshed */}
          {lastRefresh && (
            <span style={{ fontSize: 11, color: C.text3 }}>
              Updated {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: autoRefresh ? `${C.teal}20` : `rgba(255,255,255,0.05)`,
              color: autoRefresh ? C.teal : C.text3,
              transition: 'all 0.2s',
            }}
          >
            <Pulse color={autoRefresh ? C.teal : C.text3} />
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>

          {/* Manual refresh */}
          <button
            onClick={fetchAll}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`,
              background: C.glass, cursor: 'pointer', color: C.text2,
              fontSize: 16, transition: 'all 0.2s',
            }}
            title="Refresh now"
          >
            &#x21bb;
          </button>
        </div>
      </div>

      {/* ---- Error Banner ---- */}
      {error && (
        <div style={{
          padding: '12px 20px', marginBottom: 24, borderRadius: 10,
          background: `${C.red}15`, border: `1px solid ${C.red}30`,
          color: C.red, fontSize: 13, fontWeight: 500,
        }}>
          {error}
        </div>
      )}

      {/* ---- Section 1: KPI Summary Cards ---- */}
      <div style={{
        marginBottom: 40,
        animation: 'kpiFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) forwards',
      }}>
        <KpiSummarySection data={snapshots} />
      </div>

      {/* ---- Section 2: SLA Compliance by Tier (Gap 3) ---- */}
      {(() => {
        // Extract FRT/Resolution compliance KPIs per tier from snapshot data
        const tiers: { tier: string; frt: KpiSnapshot | null; resolution: KpiSnapshot | null }[] = [];
        const tierPatterns = [
          { tier: 'CC Incidents', frtMatch: 'frt compliance % (cc incidents)', resMatch: 'resolution compliance % (cc incidents)' },
          { tier: 'CC Service Requests', frtMatch: 'frt compliance % (cc service requests)', resMatch: 'resolution compliance % (cc service requests)' },
          { tier: 'CC (TPJ)', frtMatch: 'frt compliance % (cc (tpj))', resMatch: 'resolution compliance % (cc (tpj))' },
          { tier: 'CC TPJ', frtMatch: 'frt compliance % (cc tpj)', resMatch: 'resolution compliance % (cc tpj)' },
          { tier: 'Production', frtMatch: 'frt compliance % (production)', resMatch: 'resolution compliance % (production)' },
          { tier: 'Tier 2', frtMatch: 'frt compliance % (tier 2)', resMatch: 'resolution compliance % (tier 2)' },
          { tier: 'Tier 3', frtMatch: 'frt compliance % (tier 3)', resMatch: 'resolution compliance % (tier 3)' },
          { tier: 'Development', frtMatch: 'frt compliance % (development)', resMatch: 'resolution compliance % (development)' },
        ];
        // Also try generic patterns (Open Queue / Resolved Today)
        const genericPatterns = [
          { tier: 'Open Queue', frtMatch: 'frt compliance % (open queue)', resMatch: 'resolution compliance % (open queue)' },
          { tier: 'Resolved Today', frtMatch: 'frt compliance % (resolved today)', resMatch: 'resolution compliance % (resolved today)' },
        ];
        const allPatterns = [...tierPatterns, ...genericPatterns];
        for (const p of allPatterns) {
          const frt = snapshots.find(s => s.KPI.toLowerCase() === p.frtMatch) || null;
          const resolution = snapshots.find(s => s.KPI.toLowerCase() === p.resMatch) || null;
          if (frt || resolution) tiers.push({ tier: p.tier, frt, resolution });
        }

        if (tiers.length === 0) return null;

        return (
          <div style={{
            marginBottom: 40,
            animation: 'kpiFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.05s both',
          }}>
            <SectionHeader title="SLA Compliance by Tier" subtitle="FRT & Resolution compliance across tiers" />
            <div style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
              overflow: 'hidden',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Tier', 'FRT %', 'FRT RAG', 'Resolution %', 'Resolution RAG'].map(h => (
                      <th key={h} style={{
                        padding: '12px 16px',
                        textAlign: h === 'Tier' ? 'left' : 'center',
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.5px', color: C.text3,
                        background: C.bg1, borderBottom: `1px solid ${C.border}`,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tiers.map(({ tier, frt, resolution }) => (
                    <tr key={tier}>
                      <td style={{
                        padding: '10px 16px', fontSize: 13, fontWeight: 600, color: C.text1,
                        borderBottom: `1px solid ${C.border}`,
                      }}>{tier}</td>
                      <td style={{
                        padding: '10px 16px', textAlign: 'center', fontSize: 14, fontWeight: 700,
                        color: frt ? C.text1 : C.text3, borderBottom: `1px solid ${C.border}`,
                      }}>{frt ? `${fmtNum(frt.Count)}%` : '—'}</td>
                      <td style={{
                        padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${C.border}`,
                      }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: ragColor(frt?.RAG ?? null),
                          padding: '2px 8px', borderRadius: 10, background: ragBg(frt?.RAG ?? null),
                        }}>{frt ? ragLabel(frt.RAG) : '—'}</span>
                      </td>
                      <td style={{
                        padding: '10px 16px', textAlign: 'center', fontSize: 14, fontWeight: 700,
                        color: resolution ? C.text1 : C.text3, borderBottom: `1px solid ${C.border}`,
                      }}>{resolution ? `${fmtNum(resolution.Count)}%` : '—'}</td>
                      <td style={{
                        padding: '10px 16px', textAlign: 'center', borderBottom: `1px solid ${C.border}`,
                      }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: ragColor(resolution?.RAG ?? null),
                          padding: '2px 8px', borderRadius: 10, background: ragBg(resolution?.RAG ?? null),
                        }}>{resolution ? ragLabel(resolution.RAG) : '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ---- Section 3: QA Summary (Gap 4) ---- */}
      {qaSummary && (
        <div style={{
          marginBottom: 40,
          animation: 'kpiFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.1s both',
        }}>
          <SectionHeader title="QA Summary" subtitle="Last 7 days ticket quality" />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12,
          }}>
            {/* Average Score */}
            <div style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '16px 20px', borderLeft: `3px solid ${
                qaSummary.avgScore >= 2.4 ? C.green : qaSummary.avgScore >= 1.8 ? C.amber : C.red
              }`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>Avg Score</div>
              <div style={{
                fontSize: 28, fontWeight: 800,
                color: qaSummary.avgScore >= 2.4 ? C.green : qaSummary.avgScore >= 1.8 ? C.amber : C.red,
              }}>{qaSummary.avgScore.toFixed(2)}</div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>/ 3.00</div>
            </div>
            {/* Green % */}
            {(() => {
              const total = qaSummary.green + qaSummary.amber + qaSummary.red;
              const greenPct = total > 0 ? ((qaSummary.green / total) * 100).toFixed(0) : '0';
              const amberPct = total > 0 ? ((qaSummary.amber / total) * 100).toFixed(0) : '0';
              const redPct = total > 0 ? ((qaSummary.red / total) * 100).toFixed(0) : '0';
              return (
                <>
                  <div style={{
                    background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                    padding: '16px 20px', borderLeft: `3px solid ${C.green}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>Green</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.green }}>{greenPct}%</div>
                    <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{qaSummary.green} tickets</div>
                  </div>
                  <div style={{
                    background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                    padding: '16px 20px', borderLeft: `3px solid ${C.amber}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>Amber</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.amber }}>{amberPct}%</div>
                    <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{qaSummary.amber} tickets</div>
                  </div>
                  <div style={{
                    background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
                    padding: '16px 20px', borderLeft: `3px solid ${C.red}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>Red</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: C.red }}>{redPct}%</div>
                    <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>{qaSummary.red} tickets</div>
                  </div>
                </>
              );
            })()}
            {/* Total Scored */}
            <div style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
              padding: '16px 20px', borderLeft: `3px solid ${C.teal}`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginBottom: 8 }}>Total Scored</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: C.teal }}>{qaSummary.fullQA}</div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>last 7 days</div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Section 4: CSAT & FCR Placeholders (Gaps 6 & 7) ---- */}
      {(() => {
        const csatKpi = snapshots.find(s => s.KPI.toLowerCase().includes('csat'));
        const fcrKpi = snapshots.find(s => s.KPI.toLowerCase().includes('fcr'));
        const showPlaceholders = !csatKpi || !fcrKpi;
        if (!showPlaceholders) return null;
        return (
          <div style={{
            marginBottom: 40,
            animation: 'kpiFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.12s both',
          }}>
            <SectionHeader title="Coming Soon" subtitle="Metrics in pipeline" />
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12,
            }}>
              {csatKpi ? (
                <KpiCard kpi={csatKpi} />
              ) : (
                <div style={{
                  background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
                  padding: '20px 24px', opacity: 0.6,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 8 }}>CSAT</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text2, marginBottom: 4 }}>Not yet configured</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>
                    Customer satisfaction scores will appear here once the data pipeline is active.
                  </div>
                </div>
              )}
              {fcrKpi ? (
                <KpiCard kpi={fcrKpi} />
              ) : (
                <div style={{
                  background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
                  padding: '20px 24px', opacity: 0.6,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text3, marginBottom: 8 }}>FCR Rate</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text2, marginBottom: 4 }}>Pipeline not yet configured</div>
                  <div style={{ fontSize: 11, color: C.text3 }}>
                    First Contact Resolution rate will appear here once the n8n workflow is active.
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ---- Section 5: Agent Leaderboard ---- */}
      {agents.length > 0 && (
        <div style={{
          marginBottom: 40,
          animation: 'kpiFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.15s both',
        }}>
          <AgentLeaderboard data={agents} />
        </div>
      )}

      {/* ---- Section 6: Weekly Performance Digest (Gap 5 / Snag 14) ---- */}
      <div style={{
        marginBottom: 40,
        animation: 'kpiFadeIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.2s both',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <SectionHeader title="Weekly Performance Digest" subtitle="AI-generated narrative summaries" />
          <button
            onClick={() => { setDigestMode(digestMode === 'weekly' ? 'daily' : 'weekly'); setExpandedDigest(null); }}
            style={{
              background: C.glass, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: '6px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              color: digestMode === 'daily' ? C.teal : C.text2, transition: 'all 0.2s',
            }}
          >
            {digestMode === 'weekly' ? 'Show Daily' : 'Show Weekly'}
          </button>
        </div>
        {(() => {
          const entries = digestMode === 'weekly' ? weeklyDigests : dailyDigests;
          if (entries.length === 0) return (
            <div style={{
              background: C.glass, border: `1px dashed ${C.border}`, borderRadius: 12,
              padding: '20px 24px', opacity: 0.6, textAlign: 'center',
            }}>
              <div style={{ fontSize: 13, color: C.text3 }}>
                {digestMode === 'weekly' ? 'Weekly digest runs Friday at 17:30' : 'No daily digests available'}
              </div>
              {digestMode === 'weekly' && (
                <div style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>
                  First one will appear after this Friday.
                </div>
              )}
            </div>
          );
          // First entry = prominent / current
          const [current, ...previous] = entries;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Current / most recent — always expanded */}
              <div style={{
                background: C.glass, border: `1px solid ${C.teal}44`, borderRadius: 12,
                padding: '20px 24px',
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
                }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>
                    {digestMode === 'weekly' ? 'This Week' : 'Latest Daily'} Summary
                  </span>
                  <span style={{ fontSize: 10, color: C.text3 }}>{fmtTime(current.CreatedAt)}</span>
                </div>
                {current.html ? (
                  <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: current.html }} />
                ) : (
                  <p style={{ fontSize: 13, color: C.text2, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{current.summary}</p>
                )}
              </div>
              {/* Previous entries — horizontal scrollable carousel */}
              {previous.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Previous {digestMode === 'weekly' ? 'Weeks' : 'Days'}
                  </span>
                  <div style={{
                    display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8,
                    scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
                  }}>
                    {previous.map((entry, i) => {
                      const isOpen = expandedDigest === i;
                      return (
                        <div key={i} style={{
                          flex: '0 0 260px', scrollSnapAlign: 'start',
                          background: C.glass,
                          border: `1px solid ${isOpen ? `${C.teal}66` : C.border}`,
                          borderRadius: 10, cursor: 'pointer', transition: 'border-color 0.2s',
                          display: 'flex', flexDirection: 'column',
                          maxHeight: isOpen ? 400 : 80, overflow: 'hidden',
                        }} onClick={() => setExpandedDigest(isOpen ? null : i)}>
                          <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '12px 16px', flexShrink: 0,
                          }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: C.text2 }}>
                              {fmtTime(entry.CreatedAt)}
                            </span>
                            <span style={{ fontSize: 10, color: C.text3, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</span>
                          </div>
                          {!isOpen && (
                            <div style={{ padding: '0 16px 10px', overflow: 'hidden' }}>
                              <p style={{ fontSize: 11, color: C.text3, lineHeight: 1.4, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>
                                {entry.summary?.slice(0, 120) || 'No summary'}
                              </p>
                            </div>
                          )}
                          {isOpen && (
                            <div style={{ padding: '0 16px 14px', overflowY: 'auto', flex: 1 }}>
                              {entry.html ? (
                                <div style={{ fontSize: 12, color: C.text2, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: entry.html }} />
                              ) : (
                                <p style={{ fontSize: 12, color: C.text2, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap' }}>{entry.summary}</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
