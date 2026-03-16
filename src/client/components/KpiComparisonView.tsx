import { useState, useEffect, useCallback } from 'react';

interface TableStats {
  table: string;
  liveRows: number;
  uatRows: number;
  diff: number;
  liveLatest: string | null;
  uatLatest: string | null;
  liveExtra: number | null;
  uatExtra: number | null;
}

interface SnapshotRow {
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

/* ---- KPI Sort Order ---- */

const KPI_ORDER: string[] = [
  'New Tickets Today',
  'Tickets Solved Today',
  'Number of Tickets in Customer Care',
  'Number of Tickets in CC (Incidents)',
  'Number of Tickets in CC (Service Requests)',
  'Number of Tickets in CC (TPJ)',
  'Number of Tickets in Production',
  'Number of Tickets in Tier 2',
  'Number of Tickets in Tier 3',
  'Number of Tickets in Development',
  'Number of Tickets With No Reply in CC (Incidents)',
  'Number of Tickets With No Reply in CC (Service Requests)',
  'Number of Tickets With No Reply in CC (TPJ)',
  'Number of Tickets With No Reply in Production',
  'Number of Tickets With No Reply in Development',
  'Number of Tickets With No Reply in Tier 2',
  'Number of Tickets With No Reply in Tier 3',
  'CC Incidents over SLA (actionable)',
  'CC Service Requests over SLA (actionable)',
  'CC (TPJ) over SLA (actionable)',
  'CC TPJ over SLA (actionable)',
  'Production over SLA (actionable)',
  'Tier 2 over SLA (actionable)',
  'Tier 3 over SLA (actionable)',
  'Development over SLA (actionable)',
  'CC Incidents over SLA (not actionable)',
  'CC Service Requests over SLA (not actionable)',
  'CC (TPJ) over SLA (not actionable)',
  'CC TPJ over SLA (not actionable)',
  'Production over SLA (not actionable)',
  'Tier 2 over SLA (not actionable)',
  'Tier 3 over SLA (not actionable)',
  'Development over SLA (not actionable)',
  'Tickets escalated to Tier 2',
  'Tickets escalated to Tier 3',
  'Tickets escalated to Development',
  'Tickets rejected by Tier 2',
  'Tickets rejected by Tier 3',
  'Tickets rejected by Development',
  'Oldest actionable ticket (days) in CC Incidents',
  'Oldest actionable ticket (days) in CC Service Requests',
  'Oldest actionable ticket (days) in CC (TPJ)',
  'Oldest actionable ticket (days) in CC TPJ',
  'Oldest actionable ticket (days) in Production',
  'Oldest actionable ticket (days) in Development',
  'Oldest actionable ticket (days) in Tier 2',
  'Oldest actionable ticket (days) in Tier 3',
  'WTD percentage KPI\'s Green',
  'WTD percentage KPI\'s Red',
];

const KPI_ORDER_MAP = new Map<string, number>(
  KPI_ORDER.map((k, i) => [k.toLowerCase(), i])
);

function kpiSortKey(kpi: string): number {
  return KPI_ORDER_MAP.get(kpi.toLowerCase()) ?? KPI_ORDER.length;
}

function sortKpiRows<T extends { KPI?: string; KPIGroup?: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const oa = kpiSortKey(a.KPI ?? '');
    const ob = kpiSortKey(b.KPI ?? '');
    if (oa !== ob) return oa - ob;
    return (a.KPI ?? '').localeCompare(b.KPI ?? '');
  });
}

type SubTab = 'overview' | 'snapshots';

export function KpiComparisonView() {
  const [subTab, setSubTab] = useState<SubTab>('overview');
  const [tableStats, setTableStats] = useState<TableStats[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [compRes, snapRes] = await Promise.all([
        fetch('/api/kpi-data/comparison'),
        fetch('/api/kpi-data/snapshot-compare'),
      ]);

      const compData = await compRes.json();
      const snapData = await snapRes.json();

      if (!compData.ok) throw new Error(compData.error || 'Failed to load comparison');
      if (!snapData.ok) throw new Error(snapData.error || 'Failed to load snapshots');

      setTableStats(compData.data);
      setSnapshots(snapData.data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(fetchData, 60_000);
    return () => clearInterval(id);
  }, [fetchData]);

  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  };

  const ragBadge = (rag: number | null) => {
    if (rag === null || rag === undefined) return <span style={{ color: '#94a3b8' }}>—</span>;
    const colors: Record<number, [string, string, string]> = {
      1: ['#dcfce7', '#059669', 'Green'],
      2: ['#fef9c3', '#d97706', 'Amber'],
      3: ['#fee2e2', '#ef4444', 'Red'],
    };
    const [bg, fg, label] = colors[rag] || ['#f1f5f9', '#64748b', `${rag}`];
    return (
      <span style={{
        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
        fontSize: 11, fontWeight: 600, background: bg, color: fg,
      }}>{label}</span>
    );
  };

  const diffBadge = (diff: number | null) => {
    if (diff === null || diff === undefined) return <span style={{ color: '#94a3b8' }}>—</span>;
    const color = diff === 0 ? '#059669' : Math.abs(diff) > 10 ? '#ef4444' : '#d97706';
    return <span style={{ color, fontWeight: 600 }}>{diff > 0 ? '+' : ''}{diff}</span>;
  };

  const statusBadge = (row: TableStats) => {
    if (row.uatRows === 0 && row.liveRows > 0)
      return <span style={{ color: '#d97706', fontWeight: 600 }}>UAT Empty</span>;
    if (Math.abs(row.diff) > row.liveRows * 0.5 && row.liveRows > 0)
      return <span style={{ color: '#ef4444', fontWeight: 600 }}>Large Diff</span>;
    if (row.diff !== 0)
      return <span style={{ color: '#d97706', fontWeight: 600 }}>Differs</span>;
    return <span style={{ color: '#059669', fontWeight: 600 }}>OK</span>;
  };

  const tableLabels: Record<string, string> = {
    KpiSnapshot: 'KPI Snapshot (latest per KPI)',
    jira_kpi_daily: 'KPI Daily History',
    jira_kpi_digest: 'AI Digest',
    Agent: 'Agent Stats',
    JiraEodTicketStatusSnapshot: 'EOD Ticket Snapshot',
  };

  const extraLabel: Record<string, string> = {
    KpiSnapshot: 'Distinct KPIs',
    jira_kpi_daily: 'Distinct KPIs',
    Agent: 'Active Agents',
    JiraEodTicketStatusSnapshot: 'Distinct Days',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['overview', 'snapshots'] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)} style={{
              padding: '6px 14px', borderRadius: 8, border: '1px solid',
              borderColor: subTab === t ? 'rgba(62,170,180,0.3)' : '#e2e8f0',
              background: subTab === t ? 'rgba(62,170,180,0.08)' : 'transparent',
              color: subTab === t ? '#3eaab4' : '#64748b',
              fontWeight: subTab === t ? 600 : 400, fontSize: 13, cursor: 'pointer',
            }}>
              {t === 'overview' ? 'Table Overview' : 'KPI Snapshots'}
            </button>
          ))}
        </div>
        <button onClick={fetchData} disabled={loading} style={{
          padding: '6px 14px', borderRadius: 8, border: '1px solid #e2e8f0',
          background: 'transparent', color: '#64748b', fontSize: 13, cursor: 'pointer',
        }}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
        {lastRefresh && (
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Last: {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', borderRadius: 8, background: '#fef2f2',
          color: '#ef4444', fontSize: 13, marginBottom: 16,
        }}>{error}</div>
      )}

      {subTab === 'overview' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['Table', 'Live Rows', 'UAT Rows', 'Diff', 'Extra (Live)', 'Extra (UAT)', 'Live Latest', 'UAT Latest', 'Status'].map(h => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: h === 'Table' || h === 'Status' ? 'left' : 'right',
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.5px', color: '#64748b',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableStats.map(row => (
                <tr key={row.table} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>{tableLabels[row.table] || row.table}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{row.liveRows.toLocaleString()}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{row.uatRows.toLocaleString()}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>{diffBadge(row.diff)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>
                    {row.liveExtra != null ? `${row.liveExtra} ${extraLabel[row.table] || ''}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: '#64748b' }}>
                    {row.uatExtra != null ? `${row.uatExtra} ${extraLabel[row.table] || ''}` : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12 }}>{fmtDate(row.liveLatest)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12 }}>{fmtDate(row.uatLatest)}</td>
                  <td style={{ padding: '10px 12px' }}>{statusBadge(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tableStats.length === 0 && !loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No data</div>
          )}
        </div>
      )}

      {subTab === 'snapshots' && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {['KPI', 'Group', 'Live Value', 'UAT Value', 'Diff', 'Target', 'Dir', 'Live RAG', 'UAT RAG', 'Live Updated', 'UAT Updated'].map(h => (
                  <th key={h} style={{
                    padding: '10px 12px',
                    textAlign: ['KPI', 'Group', 'Dir'].includes(h) ? 'left' : 'right',
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.5px', color: '#64748b',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortKpiRows(snapshots).map((row, i) => {
                const valDiff = row.liveCount != null && row.uatCount != null
                  ? Math.round((row.uatCount - row.liveCount) * 100) / 100
                  : null;
                const ragMatch = row.liveRAG === row.uatRAG;
                return (
                  <tr key={i} style={{
                    borderBottom: '1px solid #f1f5f9',
                    background: !ragMatch ? 'rgba(239,68,68,0.04)' : undefined,
                  }}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{row.KPI}</td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>{row.KPIGroup}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{row.liveCount ?? '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{row.uatCount ?? '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{diffBadge(valDiff)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>{row.KPITarget ?? '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{row.KPIDirection || '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{ragBadge(row.liveRAG)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{ragBadge(row.uatRAG)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12 }}>{fmtDate(row.liveUpdated)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12 }}>{fmtDate(row.uatUpdated)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {snapshots.length === 0 && !loading && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>No snapshot data</div>
          )}
        </div>
      )}
    </div>
  );
}
