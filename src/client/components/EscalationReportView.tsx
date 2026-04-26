import { useState, useEffect, useCallback } from 'react';

interface EscalationStats {
  total: number;
  by_type: Array<{ escalation_type: string; count: number }>;
  by_tier: Array<{ to_tier: string; count: number }>;
  by_reason: Array<{ reason_code: string; reason_label: string | null; count: number }>;
  daily: Array<{ date: string; count: number }>;
  escalation_rate: number | null;
}

interface EscalationEntry {
  id: number;
  ticket_key: string;
  escalation_type: string;
  from_tier: string | null;
  to_tier: string | null;
  reason_code: string | null;
  reason_label: string | null;
  escalated_by: string | null;
  assigned_to: string | null;
  notes: string | null;
  source: string;
  created_at: string;
}

const C = {
  bg0: '#1e2228', bg1: '#272C33', bg2: '#2f353d', bg3: '#343a42',
  teal: '#5ec1ca', purple: '#7c3aed', green: '#059669', amber: '#d97706', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b', border: 'rgba(255,255,255,0.06)',
  glass: 'rgba(255,255,255,0.03)',
} as const;

const TYPE_COLORS: Record<string, string> = {
  manual: C.amber, ai_agent: C.purple, jira_transition: C.teal, sla_risk: C.red,
};

const TIER_COLORS: Record<string, string> = {
  T1: C.text3, T2: C.amber, T3: C.red, Dev: C.purple,
};

function StatCard({ value, label, color, sub }: { value: string | number; label: string; color: string; sub?: string }) {
  return (
    <div style={{
      padding: '16px 20px', borderRadius: 12, flex: 1, minWidth: 140,
      background: `${color}08`, border: `1px solid ${color}20`,
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.text3, marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.text2, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function TierBadge({ tier }: { tier: string | null }) {
  const t = tier || '?';
  const col = TIER_COLORS[t] || C.text3;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 8,
      fontSize: 10, fontWeight: 700, color: col, background: `${col}15`,
    }}>{t}</span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const col = TYPE_COLORS[type] || C.text3;
  const label = type.replace(/_/g, ' ');
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 8,
      fontSize: 10, fontWeight: 600, color: col, background: `${col}15`,
    }}>{label}</span>
  );
}

function MiniBarChart({ data, maxBars = 30 }: { data: Array<{ date: string; count: number }>; maxBars?: number }) {
  const sliced = data.slice(-maxBars);
  const max = Math.max(...sliced.map(d => d.count), 1);
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, padding: '8px 0',
    }}>
      {sliced.map((d, i) => (
        <div key={i} title={`${d.date}: ${d.count}`} style={{
          flex: 1, minWidth: 4, borderRadius: '3px 3px 0 0',
          height: `${Math.max((d.count / max) * 100, 4)}%`,
          background: d.count > 0 ? C.teal : `${C.text3}30`,
          transition: 'height 0.3s ease',
        }} />
      ))}
    </div>
  );
}

export function EscalationReportView() {
  const [stats, setStats] = useState<EscalationStats | null>(null);
  const [entries, setEntries] = useState<EscalationEntry[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, entriesRes] = await Promise.all([
        fetch(`/api/escalations/stats?days=${days}`),
        fetch(`/api/escalations?days=${days}${tierFilter ? `&tier=${tierFilter}` : ''}${typeFilter ? `&type=${typeFilter}` : ''}`),
      ]);
      const [statsJson, entriesJson] = await Promise.all([statsRes.json(), entriesRes.json()]);
      if (statsJson.ok) setStats(statsJson.data);
      if (entriesJson.ok) setEntries(entriesJson.data);
    } catch {}
    setLoading(false);
  }, [days, tierFilter, typeFilter]);

  useEffect(() => { setLoading(true); fetchData(); }, [fetchData]);

  const runBackfill = async () => {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await fetch('/api/escalations/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: '2025-11-01' }),
      });
      const json = await res.json();
      if (json.ok) {
        setBackfillResult(`Scanned ${json.data.issuesScanned} issues, recorded ${json.data.escalationsRecorded} escalations`);
        fetchData();
      } else {
        setBackfillResult(`Error: ${json.error}`);
      }
    } catch (e) {
      setBackfillResult(`Failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    setBackfilling(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 32, background: C.bg0, minHeight: '100vh' }}>
        <div style={{ height: 200, background: C.glass, borderRadius: 12, animation: 'pulse 1.5s infinite' }} />
      </div>
    );
  }

  return (
    <div style={{
      padding: 32, background: C.bg0, minHeight: '100vh',
      fontFamily: "'Figtree', system-ui, sans-serif", color: C.text1,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 24px', marginBottom: 24,
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>Escalation Analytics</h1>
          <p style={{ fontSize: 11, color: C.text3, margin: 0 }}>Tracking escalations across manual, AI, and Jira transitions</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {([7, 14, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              background: days === d ? `${C.teal}20` : 'transparent',
              color: days === d ? C.teal : C.text3,
            }}>{d}d</button>
          ))}
          <button onClick={runBackfill} disabled={backfilling} style={{
            padding: '5px 14px', borderRadius: 16, border: `1px solid ${C.purple}40`,
            background: `${C.purple}10`, color: C.purple, cursor: 'pointer',
            fontSize: 11, fontWeight: 600, opacity: backfilling ? 0.5 : 1,
          }}>{backfilling ? 'Backfilling...' : 'Jira Backfill'}</button>
        </div>
      </div>

      {backfillResult && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 8,
          background: backfillResult.startsWith('Error') ? `${C.red}15` : `${C.green}15`,
          color: backfillResult.startsWith('Error') ? C.red : C.green,
          fontSize: 12,
        }}>{backfillResult}</div>
      )}

      {/* Summary Stats */}
      {stats && (
        <>
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            <StatCard value={stats.total} label="Total Escalations" color={C.teal} />
            <StatCard
              value={stats.escalation_rate != null ? `${stats.escalation_rate}%` : '-'}
              label="Escalation Rate"
              color={C.amber}
              sub="% of tickets escalated"
            />
            {stats.by_tier.slice(0, 3).map(t => (
              <StatCard key={t.to_tier} value={t.count} label={`To ${t.to_tier}`} color={TIER_COLORS[t.to_tier] || C.text3} />
            ))}
          </div>

          {/* Trend Chart */}
          {stats.daily.length > 0 && (
            <div style={{
              padding: 20, marginBottom: 24, borderRadius: 12,
              background: C.glass, border: `1px solid ${C.border}`,
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: C.text2 }}>Daily Escalation Trend</h3>
              <MiniBarChart data={stats.daily} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.text3 }}>
                <span>{stats.daily[0]?.date}</span>
                <span>{stats.daily[stats.daily.length - 1]?.date}</span>
              </div>
            </div>
          )}

          {/* Breakdown Panels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div style={{ padding: 16, borderRadius: 12, background: C.glass, border: `1px solid ${C.border}` }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: C.text2, margin: '0 0 10px' }}>By Source</h3>
              {stats.by_type.map(t => (
                <div key={t.escalation_type} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <TypeBadge type={t.escalation_type} />
                  <span style={{ fontWeight: 700, color: C.text1 }}>{t.count}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: 16, borderRadius: 12, background: C.glass, border: `1px solid ${C.border}` }}>
              <h3 style={{ fontSize: 12, fontWeight: 600, color: C.text2, margin: '0 0 10px' }}>Top Reasons</h3>
              {stats.by_reason.slice(0, 8).map(r => (
                <div key={r.reason_code} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                  <span style={{ color: C.text2 }}>{r.reason_label || r.reason_code}</span>
                  <span style={{ fontWeight: 700, color: C.text1 }}>{r.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)} style={{
          padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
          background: C.bg2, color: C.text1, fontSize: 12, cursor: 'pointer',
        }}>
          <option value="">All Tiers</option>
          <option value="T2">T2</option>
          <option value="T3">T3</option>
          <option value="Dev">Dev</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{
          padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
          background: C.bg2, color: C.text1, fontSize: 12, cursor: 'pointer',
        }}>
          <option value="">All Sources</option>
          <option value="manual">Manual</option>
          <option value="ai_agent">AI Agent</option>
          <option value="jira_transition">Jira Transition</option>
        </select>
      </div>

      {/* Escalation Log Table */}
      <div style={{
        background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Ticket', 'Type', 'From', 'To', 'Reason', 'Escalated By', 'Date'].map(h => (
                <th key={h} style={{
                  padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.5px', color: C.text3,
                  background: C.bg1, borderBottom: `1px solid ${C.border}`,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: C.text3, fontSize: 13 }}>
                  No escalations in this period. Run Jira Backfill to import historical data.
                </td>
              </tr>
            )}
            {entries.slice(0, 100).map(e => (
              <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '8px 14px' }}>
                  <a
                    href={`https://nurtur.atlassian.net/browse/${e.ticket_key}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: C.teal, textDecoration: 'none', fontSize: 12, fontWeight: 600 }}
                  >{e.ticket_key}</a>
                </td>
                <td style={{ padding: '8px 14px' }}><TypeBadge type={e.escalation_type} /></td>
                <td style={{ padding: '8px 14px' }}><TierBadge tier={e.from_tier} /></td>
                <td style={{ padding: '8px 14px' }}><TierBadge tier={e.to_tier} /></td>
                <td style={{ padding: '8px 14px', fontSize: 12, color: C.text2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.reason_label || e.reason_code || e.notes || '-'}
                </td>
                <td style={{ padding: '8px 14px', fontSize: 12, color: C.text2 }}>{e.escalated_by || '-'}</td>
                <td style={{ padding: '8px 14px', fontSize: 11, color: C.text3 }}>
                  {new Date(e.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}{' '}
                  {new Date(e.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > 100 && (
        <div style={{ textAlign: 'center', padding: 12, fontSize: 11, color: C.text3 }}>
          Showing 100 of {entries.length} entries
        </div>
      )}
    </div>
  );
}
