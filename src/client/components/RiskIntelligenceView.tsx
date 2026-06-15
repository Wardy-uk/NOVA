import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d', bg3: '#343a42',
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669', amber: '#d97706', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b', border: 'rgba(255,255,255,0.06)',
} as const;

const TIER_COLORS = [C.text3, C.teal, C.amber, '#f97316', C.red];
const TIER_NAMES = ['Normal', 'Watch', 'Medium', 'High', 'Critical'];
const ROUTE_COLORS: Record<string, string> = {
  bug_external: C.red, missing_feature: C.purple, ux_friction: C.amber, docs_gap: C.teal, uncertain: C.text3,
};

interface AtRiskCustomer {
  customer: string; issue_count: number; ticket_total: number; growing: number; routes: string[]; score: number; tier: number;
}
interface IssueCard {
  signature: string; route: string | null; confidence: number | null; title: string | null;
  problem_statement: string | null; customer_count: number | null; frequency_label: string | null;
  trend: string | null; customer_share: string | null; citing_tickets: string | null;
}
interface Summary { totalIssues: number; atRiskCustomers: number; growing: number; byRoute: { route: string; count: number }[]; }

function StatCard({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <div style={{ padding: '16px 20px', borderRadius: 12, flex: 1, minWidth: 130, background: `${color}08`, border: `1px solid ${color}20` }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.text3, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    </div>
  );
}
function Chip({ label, color }: { label: string; color: string }) {
  return <span style={{ padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 600, color, background: `${color}1a` }}>{label}</span>;
}

export function RiskIntelligenceView() {
  const [tab, setTab] = useState<'customers' | 'issues'>('customers');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [customers, setCustomers] = useState<AtRiskCustomer[]>([]);
  const [issues, setIssues] = useState<IssueCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, c, i] = await Promise.all([
        fetch('/api/risk/summary').then(r => r.json()),
        fetch('/api/risk/issue-customers').then(r => r.json()),
        fetch('/api/risk/issues').then(r => r.json()),
      ]);
      if (!s.ok || !c.ok || !i.ok) throw new Error(s.error || c.error || i.error || 'load failed');
      setSummary(s.data); setCustomers(c.data); setIssues(i.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tabBtn = (key: 'customers' | 'issues', label: string) => (
    <button onClick={() => setTab(key)} style={{
      background: tab === key ? C.bg3 : 'transparent', color: tab === key ? C.text1 : C.text2,
      border: `1px solid ${tab === key ? C.border : 'transparent'}`, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    }}>{label}</button>
  );

  return (
    <div style={{ padding: 24, color: C.text1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Risk Intelligence</h2>
        <button onClick={load} style={{ background: C.bg3, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Refresh</button>
      </div>
      <div style={{ fontSize: 12, color: C.text3, marginBottom: 16 }}>
        Fed by AgentBrain's cross-customer issue router (JSM + Zendesk).
      </div>

      {error && <div style={{ color: C.red, marginBottom: 12 }}>Error: {error}</div>}
      {loading && <div style={{ color: C.text2 }}>Loading…</div>}

      {!loading && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard value={summary?.atRiskCustomers ?? 0} label="At-risk customers" color={C.red} />
            <StatCard value={summary?.totalIssues ?? 0} label="Cross-customer issues" color={C.purple} />
            <StatCard value={summary?.growing ?? 0} label="Growing" color={C.amber} />
          </div>

          {summary && summary.totalIssues === 0 && (
            <div style={{ background: C.bg1, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 20, color: C.text3, marginBottom: 16 }}>
              No issue cards received yet — waiting on the first AgentBrain run.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {tabBtn('customers', `At-risk customers (${customers.length})`)}
            {tabBtn('issues', `Issues (${issues.length})`)}
          </div>

          {tab === 'customers' && (
            <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: C.bg2, color: C.text3, textAlign: 'left' }}>
                    <th style={{ padding: '10px 14px' }}>Customer</th>
                    <th style={{ padding: '10px 14px' }}>Tier</th>
                    <th style={{ padding: '10px 14px' }}>Score</th>
                    <th style={{ padding: '10px 14px' }}>Issues</th>
                    <th style={{ padding: '10px 14px' }}>Tickets</th>
                    <th style={{ padding: '10px 14px' }}>Growing</th>
                    <th style={{ padding: '10px 14px' }}>Types</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 && <tr><td colSpan={7} style={{ padding: 20, color: C.text3, textAlign: 'center' }}>No at-risk customers.</td></tr>}
                  {customers.map(c => (
                    <tr key={c.customer} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{c.customer}</td>
                      <td style={{ padding: '10px 14px' }}><Chip label={TIER_NAMES[c.tier] ?? '?'} color={TIER_COLORS[c.tier] ?? C.text3} /></td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: TIER_COLORS[c.tier] }}>{c.score}</td>
                      <td style={{ padding: '10px 14px', color: C.text2 }}>{c.issue_count}</td>
                      <td style={{ padding: '10px 14px', color: C.text2 }}>{c.ticket_total}</td>
                      <td style={{ padding: '10px 14px', color: c.growing ? C.amber : C.text3 }}>{c.growing || '—'}</td>
                      <td style={{ padding: '10px 14px' }}><span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>{c.routes.map(r => <Chip key={r} label={r.replace(/_/g, ' ')} color={ROUTE_COLORS[r] ?? C.text3} />)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'issues' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {issues.length === 0 && <div style={{ color: C.text3 }}>No issues yet.</div>}
              {issues.map(i => (
                <div key={i.signature} style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {i.route && <Chip label={i.route.replace(/_/g, ' ')} color={ROUTE_COLORS[i.route] ?? C.text3} />}
                    {i.trend && i.trend !== 'stable' && <Chip label={i.trend} color={i.trend === 'growing' ? C.red : C.teal} />}
                    <span style={{ fontWeight: 700 }}>{i.title ?? '(untitled)'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.text2 }}>{i.problem_statement}</div>
                  <div style={{ fontSize: 11, color: C.text3, marginTop: 6 }}>
                    {i.customer_count ?? 0} customers{i.frequency_label ? ` · ${i.frequency_label}` : ''}
                    {i.confidence != null ? ` · confidence ${Math.round(i.confidence * 100)}%` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
