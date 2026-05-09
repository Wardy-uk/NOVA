import { useState, useEffect } from 'react';

interface Signal {
  id: number; signal_type: string; component: string | null; title: string | null;
  detail: string | null; ticket_count: number | null; customer_count: number | null;
  trend: string | null; recommendation: string | null;
  period_start: string | null; period_end: string | null; generated_at: string;
}

interface Report {
  bug_impact: Signal[];
  feature_demand: Signal[];
  recurring_issues: Signal[];
  period: { start: string | null; end: string | null };
}

const api = async (path: string, method = 'GET') => {
  const r = await fetch(`/api/cross-functional${path}`, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
  });
  return r.json();
};

export function IntelligenceView() {
  const [report, setReport] = useState<Report | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    const r = await api('/report');
    if (r.ok) setReport(r.data);
  };

  useEffect(() => { load(); }, []);

  const generate = async () => {
    setGenerating(true);
    await api('/generate', 'POST');
    await load();
    setGenerating(false);
  };

  const exportMd = () => {
    window.open('/api/cross-functional/export', '_blank');
  };

  const trendIcon = (t: string | null) => {
    switch (t) {
      case 'increasing': return { symbol: '↑', color: 'text-red-400' };
      case 'decreasing': return { symbol: '↓', color: 'text-green-400' };
      default: return { symbol: '→', color: 'text-neutral-400' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {report?.period.start && (
            <span className="text-xs text-neutral-500">
              Period: {report.period.start} to {report.period.end}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={exportMd}
            className="px-3 py-1 bg-[#2f353d] text-neutral-400 text-xs rounded hover:bg-[#3a424d]">
            Export for Dev
          </button>
          <button onClick={generate} disabled={generating}
            className="px-3 py-1 bg-[#5ec1ca]/20 text-[#5ec1ca] text-xs rounded hover:bg-[#5ec1ca]/30 disabled:opacity-50">
            {generating ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {report && (
        <>
          {/* Bug Impact */}
          <div>
            <h3 className="text-sm font-medium text-neutral-200 mb-3">Bug Impact Analysis</h3>
            <div className="space-y-2">
              {report.bug_impact.map(s => {
                const trend = trendIcon(s.trend);
                return (
                  <div key={s.id} className="bg-[#2f353d] rounded-lg p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-sm text-neutral-200">{s.title ?? s.component}</span>
                        <span className={`ml-2 ${trend.color}`}>{trend.symbol}</span>
                      </div>
                      <div className="flex gap-3 text-xs">
                        <span className="text-neutral-400">{s.ticket_count} tickets</span>
                        <span className="text-neutral-500">{s.customer_count} customers</span>
                      </div>
                    </div>
                    {s.detail && <p className="text-xs text-neutral-400 mt-1">{s.detail}</p>}
                    {s.recommendation && (
                      <p className="text-xs text-[#5ec1ca] mt-1">{s.recommendation}</p>
                    )}
                  </div>
                );
              })}
              {report.bug_impact.length === 0 && (
                <p className="text-xs text-neutral-500 py-4 text-center">No bug impact data yet</p>
              )}
            </div>
          </div>

          {/* Feature Demand */}
          <div>
            <h3 className="text-sm font-medium text-neutral-200 mb-3">Feature Demand</h3>
            <div className="space-y-2">
              {report.feature_demand.map(s => (
                <div key={s.id} className="bg-[#2f353d] rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <span className="text-sm text-neutral-200">{s.title}</span>
                    <span className="text-xs text-neutral-400">{s.ticket_count} requests</span>
                  </div>
                  {s.detail && <p className="text-xs text-neutral-400 mt-1">{s.detail}</p>}
                </div>
              ))}
              {report.feature_demand.length === 0 && (
                <p className="text-xs text-neutral-500 py-4 text-center">No feature demand data yet</p>
              )}
            </div>
          </div>

          {/* Recurring Issues */}
          <div>
            <h3 className="text-sm font-medium text-neutral-200 mb-3">Recurring Issues</h3>
            <div className="space-y-2">
              {report.recurring_issues.map(s => (
                <div key={s.id} className="bg-[#2f353d] rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm text-neutral-200">{s.title}</span>
                    {s.detail && <p className="text-xs text-neutral-400 mt-0.5">{s.detail}</p>}
                  </div>
                  <span className="text-xs text-red-400 whitespace-nowrap ml-2">{s.ticket_count} tickets</span>
                </div>
              ))}
              {report.recurring_issues.length === 0 && (
                <p className="text-xs text-neutral-500 py-4 text-center">No recurring issue data yet</p>
              )}
            </div>
          </div>
        </>
      )}

      {!report && (
        <div className="text-center text-neutral-500 text-sm py-8">
          No intelligence report available. Click "Generate Report" to analyse this month's data.
        </div>
      )}
    </div>
  );
}
