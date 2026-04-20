import { C, cardStyle, StatusBadge, PriorityBadge, AgentAvatar, EmptyState, ragColor, calyxApi, useCalyxData } from './calyx-shared.js';

/* ---------- Types ---------- */

interface SloCompliance {
  total: number;
  met: number;
  compliance_pct: number;
  avg_breach_mins?: number;
}

interface Slo {
  id: number;
  name: string;
  metric_type: string;
  target_minutes: number;
  compliance_30d: SloCompliance;
}

interface CsatAgent {
  id: number;
  name: string;
  avg_csat: number;
  responses: number;
}

interface CsatData {
  avg_csat: number;
  avg_xla: number;
  response_rate: number;
  total_sent: number;
  total_responded: number;
  per_agent: CsatAgent[];
}

/* ---------- Component ---------- */

export function CalyxDashboardView() {
  const { data: slos, loading: slosLoading } = useCalyxData<Slo[]>('/slos');
  const { data: csat, loading: csatLoading } = useCalyxData<CsatData>('/reports/csat');
  const { data: openTickets, loading: ticketsLoading } = useCalyxData<any[]>('/tickets?status=open');

  const loading = slosLoading || csatLoading || ticketsLoading;

  /* Derived metrics */
  const overallCompliance = slos && slos.length > 0
    ? Math.round(slos.reduce((s, slo) => s + (slo.compliance_30d?.compliance_pct ?? 0), 0) / slos.length)
    : null;

  const isWatermelon = overallCompliance !== null && csat?.avg_csat != null
    ? overallCompliance >= 90 && csat.avg_csat < 3.5
    : false;

  if (loading) {
    return (
      <div style={{ padding: 32, color: C.text2, textAlign: 'center', fontSize: 14 }}>
        Loading dashboard...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── Row 1: Watermelon Panel ── */}
      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={{ display: 'flex', gap: 0 }}>
          {/* SLA Compliance */}
          <div style={{ flex: 1, padding: 24, borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
              SLA Compliance
            </div>
            <div style={{
              fontSize: 48, fontWeight: 700, lineHeight: 1,
              color: overallCompliance !== null ? ragColor(overallCompliance, 90, true) : C.text3,
            }}>
              {overallCompliance !== null ? `${overallCompliance}%` : '—'}
            </div>
            <div style={{ fontSize: 12, color: C.text3, marginTop: 8 }}>Target: 90%</div>
          </div>

          {/* CSAT */}
          <div style={{ flex: 1, padding: 24 }}>
            <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
              CSAT
            </div>
            <div style={{
              fontSize: 48, fontWeight: 700, lineHeight: 1,
              color: csat?.avg_csat != null ? ragColor(csat.avg_csat, 4, true) : C.text3,
            }}>
              {csat?.avg_csat != null ? csat.avg_csat.toFixed(1) : '—'}
              <span style={{ fontSize: 20, fontWeight: 400, color: C.text3 }}> / 5</span>
            </div>
            <div style={{ fontSize: 12, color: C.text3, marginTop: 8 }}>
              XLA: {csat?.avg_xla != null ? csat.avg_xla.toFixed(1) : '—'}
            </div>
          </div>
        </div>

        {/* Watermelon Warning */}
        {isWatermelon && (
          <div style={{
            padding: '12px 24px',
            background: `${C.amber}15`,
            borderTop: `1px solid ${C.amber}30`,
            color: C.amber,
            fontSize: 13,
            lineHeight: 1.5,
          }}>
            SLA targets are being met but customer satisfaction is below target — potential watermelon situation.
          </div>
        )}
      </div>

      {/* ── Row 2: SLO Compliance Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 16,
      }}>
        {slos && slos.length > 0 ? slos.map(slo => {
          const pct = slo.compliance_30d?.compliance_pct ?? 0;
          const met = slo.compliance_30d?.met ?? 0;
          const total = slo.compliance_30d?.total ?? 0;
          const breach = slo.compliance_30d?.avg_breach_mins;

          return (
            <div key={slo.id} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text1 }}>{slo.name}</div>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: C.text3, background: C.bg2,
                  padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase' as const,
                }}>
                  {slo.metric_type}
                </div>
              </div>

              <div style={{ fontSize: 36, fontWeight: 700, color: ragColor(pct, 90, true), marginBottom: 12 }}>
                {pct.toFixed(1)}%
              </div>

              {/* Compliance bar */}
              <div style={{ height: 6, borderRadius: 3, background: C.bg3, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(pct, 100)}%`,
                  borderRadius: 3,
                  background: ragColor(pct, 90, true),
                  transition: 'width 0.4s ease',
                }} />
              </div>

              <div style={{ fontSize: 12, color: C.text2 }}>
                {met} of {total} tickets met this SLO
              </div>

              {breach != null && breach > 0 && (
                <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>
                  Avg breach: {breach.toFixed(0)} min
                </div>
              )}
            </div>
          );
        }) : (
          <EmptyState title="No SLOs configured" subtitle="Add SLOs in Admin to see compliance data" />
        )}
      </div>

      {/* ── Row 3: Volume ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 16,
      }}>
        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
            Open Tickets
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: C.teal }}>
            {openTickets ? openTickets.length : '—'}
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: 12, color: C.text3, fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>
            Resolved (30d)
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, color: C.text3 }}>
            Coming soon
          </div>
        </div>
      </div>

      {/* ── Row 4: Agent Performance Table ── */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text1, marginBottom: 16 }}>
          Agent Performance
        </div>

        {csat && csat.per_agent && csat.per_agent.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Agent', 'Avg CSAT', 'Responses'].map(h => (
                  <th key={h} style={{
                    textAlign: h === 'Agent' ? 'left' : 'right',
                    padding: '8px 12px',
                    fontSize: 11,
                    fontWeight: 600,
                    color: C.text3,
                    textTransform: 'uppercase' as const,
                    letterSpacing: 0.5,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csat.per_agent.map(agent => (
                <tr key={agent.id}>
                  <td style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <AgentAvatar name={agent.name} size={28} />
                      <span style={{ fontSize: 13, color: C.text1 }}>{agent.name}</span>
                    </div>
                  </td>
                  <td style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    fontSize: 14,
                    fontWeight: 600,
                    color: agent.avg_csat != null ? ragColor(agent.avg_csat, 4, true) : C.text3,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {agent.avg_csat != null ? agent.avg_csat.toFixed(1) : '—'}
                  </td>
                  <td style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    fontSize: 13,
                    color: C.text2,
                    borderBottom: `1px solid ${C.border}`,
                  }}>
                    {agent.responses}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No CSAT data" subtitle="Agent performance will appear once surveys are collected" />
        )}
      </div>
    </div>
  );
}
