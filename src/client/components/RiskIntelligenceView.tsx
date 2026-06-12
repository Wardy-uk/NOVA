import { useState, useEffect, useCallback, Fragment } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d', bg3: '#343a42',
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669', amber: '#d97706', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b', border: 'rgba(255,255,255,0.06)',
} as const;

// Tier 0 Normal .. 4 Critical
const TIER_COLORS = [C.text3, C.teal, C.amber, '#f97316', C.red];

interface AccountRow {
  customer_ref: string; customer_name: string | null; bc_number: string | null; primary_domain: string | null;
  risk_score: number; risk_tier: number;
  has_formal_complaint: boolean; has_termination: boolean; has_active_refund: boolean; has_open_escalation: boolean;
  is_network_account: boolean; total_ticket_count: number; last_ticket_date: string | null; last_score_update: string | null;
}
interface Summary {
  distribution: { tier: number; label: string; count: number }[];
  lastRun: { generatedAt?: string; tickets?: number; resolved?: number; resolvedPct?: number; customersAtRisk?: number; bySource?: Record<string, number>; reconDaysComplete?: number; reconDaysPartial?: number } | null;
  recon: { status: string; cnt: number }[];
}

function StatCard({ value, label, color, sub }: { value: string | number; label: string; color: string; sub?: string }) {
  return (
    <div style={{ padding: '16px 20px', borderRadius: 12, flex: 1, minWidth: 130, background: `${color}08`, border: `1px solid ${color}20` }}>
      <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.text3, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.text2, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TierBadge({ tier, label }: { tier: number; label?: string }) {
  const col = TIER_COLORS[tier] ?? C.text3;
  const names = ['Normal', 'Watch', 'Medium', 'High', 'Critical'];
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, color: col, background: `${col}1a`, border: `1px solid ${col}33` }}>
      {label ?? names[tier] ?? '?'}
    </span>
  );
}

function FlagChips({ a }: { a: AccountRow }) {
  const chips: [boolean, string, string][] = [
    [a.has_formal_complaint, 'Complaint', C.red],
    [a.has_termination, 'Termination', C.red],
    [a.has_active_refund, 'Refund', C.amber],
    [a.has_open_escalation, 'Escalation', '#f97316'],
  ];
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {chips.filter(c => c[0]).map(([, label, col]) => (
        <span key={label} style={{ padding: '1px 6px', borderRadius: 6, fontSize: 10, fontWeight: 600, color: col, background: `${col}1a` }}>{label}</span>
      ))}
    </span>
  );
}

export function RiskIntelligenceView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ account: Record<string, unknown>; signals: Record<string, unknown>[]; history: Record<string, unknown>[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, a] = await Promise.all([
        fetch('/api/risk/summary').then(r => r.json()),
        fetch('/api/risk/accounts?minTier=1').then(r => r.json()),
      ]);
      if (!s.ok) throw new Error(s.error || 'summary failed');
      if (!a.ok) throw new Error(a.error || 'accounts failed');
      setSummary(s.data); setAccounts(a.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (ref: string) => {
    if (selected === ref) { setSelected(null); setDetail(null); return; }
    setSelected(ref); setDetail(null);
    try {
      const r = await fetch(`/api/risk/account/${encodeURIComponent(ref)}`).then(x => x.json());
      if (r.ok) setDetail(r.data);
    } catch { /* ignore */ }
  }, [selected]);

  const lr = summary?.lastRun;
  const dist = summary?.distribution ?? [];
  const tierCount = (t: number) => dist.find(d => d.tier === t)?.count ?? 0;
  const reconComplete = summary?.recon.find(r => r.status === 'complete')?.cnt ?? 0;
  const reconPartial = summary?.recon.find(r => r.status === 'partial')?.cnt ?? 0;

  return (
    <div style={{ padding: 24, color: C.text1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Risk Intelligence</h2>
        <button onClick={load} style={{ background: C.bg3, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Refresh</button>
      </div>

      {error && <div style={{ color: C.red, marginBottom: 12 }}>Error: {error}</div>}
      {loading && <div style={{ color: C.text2 }}>Loading…</div>}

      {!loading && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <StatCard value={tierCount(4)} label="Critical" color={TIER_COLORS[4]} />
            <StatCard value={tierCount(3)} label="High" color={TIER_COLORS[3]} />
            <StatCard value={tierCount(2)} label="Medium" color={TIER_COLORS[2]} />
            <StatCard value={tierCount(1)} label="Watch" color={TIER_COLORS[1]} />
            <StatCard value={accounts.length} label="At-risk accounts" color={C.purple} />
          </div>

          {lr && (
            <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: C.text2 }}>
              <span style={{ fontWeight: 700, color: C.text1 }}>Last backfill</span>
              {lr.generatedAt ? ` · ${new Date(lr.generatedAt).toLocaleString()}` : ''}
              {' · '}{lr.resolved ?? 0}/{lr.tickets ?? 0} tickets resolved to a customer (<b style={{ color: C.teal }}>{lr.resolvedPct ?? 0}%</b>)
              {' · '}{lr.customersAtRisk ?? 0} flagged
              {' · recon: '}<b style={{ color: C.green }}>{reconComplete}</b> days complete, {reconPartial} partial
            </div>
          )}

          <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: C.bg2, color: C.text3, textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Customer</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Tier</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Score</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Signals</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Tickets</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600 }}>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 20, color: C.text3, textAlign: 'center' }}>No at-risk accounts.</td></tr>
                )}
                {accounts.map(a => (
                  <Fragment key={a.customer_ref}>
                    <tr onClick={() => openDetail(a.customer_ref)}
                      style={{ borderTop: `1px solid ${C.border}`, cursor: 'pointer', background: selected === a.customer_ref ? C.bg2 : 'transparent' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 600 }}>{a.customer_name || a.customer_ref}{a.is_network_account ? <span style={{ color: C.text3, fontWeight: 400 }}> · network</span> : ''}</div>
                        <div style={{ fontSize: 11, color: C.text3 }}>{a.primary_domain || a.bc_number || ''}</div>
                      </td>
                      <td style={{ padding: '10px 14px' }}><TierBadge tier={a.risk_tier} /></td>
                      <td style={{ padding: '10px 14px', fontWeight: 700, color: TIER_COLORS[a.risk_tier] }}>{a.risk_score}</td>
                      <td style={{ padding: '10px 14px' }}><FlagChips a={a} /></td>
                      <td style={{ padding: '10px 14px', color: C.text2 }}>{a.total_ticket_count}</td>
                      <td style={{ padding: '10px 14px', color: C.text3, fontSize: 12 }}>{a.last_ticket_date ? new Date(a.last_ticket_date).toLocaleDateString() : '—'}</td>
                    </tr>
                    {selected === a.customer_ref && (
                      <tr>
                        <td colSpan={6} style={{ padding: '0 14px 14px', background: C.bg2 }}>
                          {!detail && <div style={{ color: C.text3, padding: 8 }}>Loading detail…</div>}
                          {detail && (
                            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', paddingTop: 8 }}>
                              <div style={{ flex: 1, minWidth: 280 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, marginBottom: 6 }}>ACTIVE SIGNALS</div>
                                {detail.signals.filter(s => (s as any).is_active).length === 0 && <div style={{ color: C.text3, fontSize: 12 }}>None active.</div>}
                                {detail.signals.filter(s => (s as any).is_active).map((s, i) => (
                                  <div key={i} style={{ fontSize: 12, color: C.text2, marginBottom: 4 }}>
                                    <span style={{ color: C.amber, fontWeight: 600 }}>{String((s as any).signal_type).replace(/_/g, ' ')}</span>
                                    {' '}({String((s as any).signal_weight)}) · {String((s as any).ticket_key)} · {String((s as any).ticket_status ?? '')}
                                  </div>
                                ))}
                              </div>
                              <div style={{ flex: 1, minWidth: 240 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, marginBottom: 6 }}>SCORE HISTORY</div>
                                {detail.history.length === 0 && <div style={{ color: C.text3, fontSize: 12 }}>No tier changes recorded.</div>}
                                {detail.history.map((h, i) => (
                                  <div key={i} style={{ fontSize: 12, color: C.text2, marginBottom: 4 }}>
                                    {new Date(String((h as any).changed_at)).toLocaleDateString()}: tier {String((h as any).previous_tier)}→{String((h as any).new_tier)} (score {String((h as any).previous_score)}→{String((h as any).new_score)})
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
