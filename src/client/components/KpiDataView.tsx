import { useState, useEffect, useCallback } from 'react';

type Env = 'live' | 'uat';
type Tab = 'team-snapshot' | 'agent-daily' | 'agents' | 'daily-history' | 'qa-scores' | 'digest';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'team-snapshot', label: 'Team KPIs' },
  { id: 'agent-daily', label: 'Agent KPIs' },
  { id: 'agents', label: 'Agents' },
  { id: 'daily-history', label: 'Daily History' },
  { id: 'qa-scores', label: 'QA Scores' },
  { id: 'digest', label: 'AI Digest' },
];

function ragBadge(rag: number | string | null) {
  if (rag === null || rag === undefined) return <span className="text-neutral-600">-</span>;
  const r = Number(rag);
  if (r === 1) return <span className="inline-block w-3 h-3 rounded-full bg-green-500" title="Green" />;
  if (r === 2) return <span className="inline-block w-3 h-3 rounded-full bg-amber-500" title="Amber" />;
  if (r === 3) return <span className="inline-block w-3 h-3 rounded-full bg-red-500" title="Red" />;
  // string grade
  const s = String(rag).toUpperCase();
  if (s === 'GREEN') return <span className="inline-block w-3 h-3 rounded-full bg-green-500" title="Green" />;
  if (s === 'AMBER') return <span className="inline-block w-3 h-3 rounded-full bg-amber-500" title="Amber" />;
  if (s === 'RED') return <span className="inline-block w-3 h-3 rounded-full bg-red-500" title="Red" />;
  return <span className="text-neutral-500">{rag}</span>;
}

function fmt(v: any, dp = 1): string {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(dp) : String(v);
}

function fmtDate(v: string | null): string {
  if (!v) return '-';
  try { return new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return v; }
}

const TH = 'px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-400 font-semibold bg-[#272C33] border-b border-[#3a424d]';
const TD = 'px-3 py-2 text-[13px] text-neutral-300 border-b border-[#3a424d]';
const TDR = 'px-3 py-2 text-[13px] text-neutral-300 border-b border-[#3a424d] text-right';

function TeamSnapshotTable({ data }: { data: any[] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <th className={TH}>KPI</th><th className={TH}>Group</th>
        <th className={`${TH} text-right`}>Count</th><th className={`${TH} text-right`}>Target</th>
        <th className={TH}>Direction</th><th className={TH}>RAG</th><th className={TH}>Updated</th>
      </tr></thead>
      <tbody>{data.map((r, i) => (
        <tr key={i} className="hover:bg-[#343a42]">
          <td className={TD}>{r.KPI}</td><td className={TD}>{r.KPIGroup}</td>
          <td className={TDR}>{fmt(r.Count, 0)}</td><td className={TDR}>{fmt(r.KPITarget, 0)}</td>
          <td className={TD}>{r.KPIDirection}</td><td className={TD}>{ragBadge(r.RAG)}</td>
          <td className={`${TD} text-neutral-500 text-[11px]`}>{fmtDate(r.CreatedAt)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function AgentDailyTable({ data }: { data: any[] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <th className={TH}>Date</th><th className={TH}>Agent</th><th className={TH}>Tier</th>
        <th className={`${TH} text-right`}>Open</th><th className={`${TH} text-right`}>&gt;2h</th>
        <th className={`${TH} text-right`}>Stale</th><th className={`${TH} text-right`}>Solved</th>
        <th className={`${TH} text-right`}>Tix/Hr</th><th className={`${TH} text-right`}>CSAT</th>
        <th className={`${TH} text-right`}>QA</th><th className={`${TH} text-right`}>Rules</th>
      </tr></thead>
      <tbody>{data.map((r, i) => (
        <tr key={i} className="hover:bg-[#343a42]">
          <td className={`${TD} text-neutral-500 text-[11px]`}>{r.ReportDate?.slice(0, 10) || '-'}</td>
          <td className={TD}>{r.AgentName}</td><td className={TD}>{r.TierCode}</td>
          <td className={TDR}>{r.OpenTickets_Total ?? 0}</td>
          <td className={TDR}>{r.OpenTickets_Over2Hours ?? 0}</td>
          <td className={TDR}>{r.OpenTickets_NoUpdateToday ?? 0}</td>
          <td className={TDR}>{r.SolvedTickets_Today ?? 0}</td>
          <td className={TDR}>{fmt(r.TicketsPerHour)}</td>
          <td className={TDR}>{fmt(r.CSATAverage)}</td>
          <td className={TDR}>{fmt(r.QAOverallAvg)}</td>
          <td className={TDR}>{fmt(r.GoldenRulesAvg)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function AgentsTable({ data }: { data: any[] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <th className={TH}>Agent</th><th className={TH}>Tier</th><th className={TH}>Team</th>
        <th className={TH}>Available</th>
        <th className={`${TH} text-right`}>Open</th><th className={`${TH} text-right`}>&gt;2h</th>
        <th className={`${TH} text-right`}>Stale</th><th className={`${TH} text-right`}>Solved Today</th>
        <th className={`${TH} text-right`}>Solved Week</th>
        <th className={`${TD} text-neutral-500 text-[11px]`}>Snapshot At</th>
      </tr></thead>
      <tbody>{data.map((r, i) => (
        <tr key={i} className="hover:bg-[#343a42]">
          <td className={TD}>{r.AgentName} {r.AgentSurname}</td><td className={TD}>{r.TierCode}</td>
          <td className={TD}>{r.Team}</td>
          <td className={TD}>{r.IsAvailable ? <span className="text-green-400">Yes</span> : <span className="text-neutral-500">No</span>}</td>
          <td className={TDR}>{r.OpenTickets_Total ?? 0}</td>
          <td className={TDR}>{r.OpenTickets_Over2Hours ?? 0}</td>
          <td className={TDR}>{r.OpenTickets_NoUpdateToday ?? 0}</td>
          <td className={TDR}>{r.SolvedTickets_Today ?? 0}</td>
          <td className={TDR}>{r.SolvedTickets_ThisWeek ?? 0}</td>
          <td className={`${TD} text-neutral-500 text-[11px]`}>{fmtDate(r.TicketsSnapshotAt)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function DailyHistoryTable({ data }: { data: any[] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <th className={TH}>KPI</th><th className={TH}>Group</th>
        <th className={`${TH} text-right`}>Count</th><th className={`${TH} text-right`}>Target</th>
        <th className={TH}>Direction</th><th className={TH}>RAG</th><th className={TH}>Date</th>
      </tr></thead>
      <tbody>{data.map((r, i) => (
        <tr key={i} className="hover:bg-[#343a42]">
          <td className={TD}>{r.kpi}</td><td className={TD}>{r.kpiGroup}</td>
          <td className={TDR}>{fmt(r.count, 0)}</td><td className={TDR}>{fmt(r.target, 0)}</td>
          <td className={TD}>{r.direction}</td><td className={TD}>{ragBadge(r.rag)}</td>
          <td className={`${TD} text-neutral-500 text-[11px]`}>{fmtDate(r.CreatedAt)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function QaScoresTable({ data }: { data: any[] }) {
  return (
    <table className="w-full border-collapse">
      <thead><tr>
        <th className={TH}>Ticket</th><th className={TH}>Agent</th><th className={TH}>Type</th>
        <th className={`${TH} text-right`}>Overall</th><th className={`${TH} text-right`}>Accuracy</th>
        <th className={`${TH} text-right`}>Clarity</th><th className={`${TH} text-right`}>Tone</th>
        <th className={TH}>Grade</th><th className={TH}>Concerning</th>
        <th className={TH}>Date</th>
      </tr></thead>
      <tbody>{data.map((r, i) => (
        <tr key={i} className="hover:bg-[#343a42]">
          <td className={`${TD} font-mono text-[12px]`}>{r.issueKey}</td>
          <td className={TD}>{r.assigneeName}</td><td className={TD}>{r.qaType}</td>
          <td className={TDR}>{r.overallScore}</td><td className={TDR}>{r.accuracyScore}</td>
          <td className={TDR}>{r.clarityScore}</td><td className={TDR}>{r.toneScore}</td>
          <td className={TD}>{ragBadge(r.grade)}</td>
          <td className={TD}>{r.isConcerning ? <span className="text-red-400">Yes</span> : '-'}</td>
          <td className={`${TD} text-neutral-500 text-[11px]`}>{fmtDate(r.CreatedAt)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function DigestTable({ data }: { data: any[] }) {
  return (
    <div className="space-y-4">
      {data.map((r, i) => (
        <div key={i} className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#272C33]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[#5ec1ca] uppercase tracking-wider font-semibold">{r.period}</span>
            <span className="text-[11px] text-neutral-500">{fmtDate(r.CreatedAt)}</span>
          </div>
          <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{r.summary}</div>
          {r.html && (
            <details className="mt-3">
              <summary className="text-[11px] text-neutral-500 cursor-pointer hover:text-neutral-300">Show HTML</summary>
              <div className="mt-2 p-3 bg-[#1e2228] rounded text-[12px]" dangerouslySetInnerHTML={{ __html: r.html }} />
            </details>
          )}
        </div>
      ))}
      {data.length === 0 && <div className="text-neutral-500 text-center py-8">No digest entries found</div>}
    </div>
  );
}

export function KpiDataView() {
  const [env, setEnv] = useState<Env>('uat');
  const [tab, setTab] = useState<Tab>('team-snapshot');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ env });
      if (['daily-history', 'agent-daily', 'qa-scores', 'digest'].includes(tab)) {
        params.set('days', String(days));
      }
      const res = await fetch(`/api/kpi-data/${tab}?${params}`);
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
      } else {
        setError(json.error || 'Unknown error');
        setData([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [env, tab, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const needsDays = ['daily-history', 'agent-daily', 'qa-scores', 'digest'].includes(tab);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">KPI Data Explorer</h2>
        <div className="flex items-center gap-3">
          {/* Days selector */}
          {needsDays && (
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-[12px] text-neutral-300"
            >
              {[1, 3, 7, 14, 30, 60, 90].map(d => (
                <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
              ))}
            </select>
          )}
          {/* Env toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[#3a424d]">
            {(['uat', 'live'] as Env[]).map(e => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={`px-4 py-1.5 text-[12px] font-semibold uppercase tracking-wider transition-colors ${
                  env === e
                    ? e === 'live'
                      ? 'bg-red-600/30 text-red-300 border-red-500/40'
                      : 'bg-[#5ec1ca]/20 text-[#5ec1ca]'
                    : 'bg-[#272C33] text-neutral-500 hover:text-neutral-300'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button onClick={fetchData} className="text-neutral-400 hover:text-[#5ec1ca] transition-colors" title="Refresh">
            <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-1 border-b border-[#3a424d] pb-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-[1px] ${
              tab === t.id
                ? 'border-[#5ec1ca] text-[#5ec1ca]'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status bar */}
      {env === 'live' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-900/20 border border-red-800/30 text-[12px] text-red-300">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
          Viewing LIVE data. Changes here affect production tables.
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded bg-red-900/20 border border-red-800/30 text-[12px] text-red-300">{error}</div>
      )}

      {/* Row count */}
      {!loading && !error && (
        <div className="text-[11px] text-neutral-500">{data.length} row{data.length !== 1 ? 's' : ''}</div>
      )}

      {/* Table */}
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-x-auto max-h-[70vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-neutral-500">Loading...</div>
        ) : (
          <>
            {tab === 'team-snapshot' && <TeamSnapshotTable data={data} />}
            {tab === 'agent-daily' && <AgentDailyTable data={data} />}
            {tab === 'agents' && <AgentsTable data={data} />}
            {tab === 'daily-history' && <DailyHistoryTable data={data} />}
            {tab === 'qa-scores' && <QaScoresTable data={data} />}
            {tab === 'digest' && <DigestTable data={data} />}
          </>
        )}
      </div>
    </div>
  );
}
