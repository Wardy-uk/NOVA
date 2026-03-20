import { useState, useEffect, useCallback } from 'react';

interface TierSummary {
  name: string;
  total: number;
  noUpdate: number;
  overSla: number;
}

interface DrillDownTicket {
  key: string;
  summary: string;
  status: string;
  priority: number;
  assignee: string;
  issueType: string;
  source_url: string | null;
  urgency_score: number;
  sla_remaining_ms: number | null;
  attention_reasons: string[];
  created: string | null;
}

type Metric = 'total' | 'no_update' | 'over_sla';

const METRIC_LABELS: Record<Metric, string> = {
  total: 'Active Tickets',
  no_update: 'No Update',
  over_sla: 'Over SLA',
};

function ragColor(metric: Metric, count: number): string {
  if (metric === 'total') {
    // Yellow/amber for totals — just informational
    return '#eab308';
  }
  // Green if 0, red if >0
  return count === 0 ? '#10b981' : '#ef4444';
}

function formatSlaRemaining(ms: number | null): string {
  if (ms === null) return '—';
  const negative = ms < 0;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const str = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return negative ? `-${str}` : str;
}

function priorityLabel(p: number): string {
  if (p >= 80) return 'High';
  if (p >= 50) return 'Medium';
  return 'Low';
}

function priorityColor(p: number): string {
  if (p >= 80) return '#ef4444';
  if (p >= 50) return '#f59e0b';
  return '#10b981';
}

function ticketAge(created: string | null): string {
  if (!created) return '—';
  const diff = Date.now() - new Date(created).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

interface ActiveDrill {
  tier: string;
  metric: Metric;
}

export function QueueWallboard({ title }: { title: string }) {
  const [tiers, setTiers] = useState<TierSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [activeDrill, setActiveDrill] = useState<ActiveDrill | null>(null);
  const [drillTickets, setDrillTickets] = useState<DrillDownTicket[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const fetchTiers = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/service-desk/wallboard');
      const json = await res.json();
      if (json.ok) {
        setTiers(json.data.tiers);
        setLastUpdate(new Date().toLocaleTimeString('en-GB'));
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTiers();
    const interval = setInterval(fetchTiers, 30000);
    return () => clearInterval(interval);
  }, [fetchTiers]);

  const openDrill = useCallback(async (tier: string, metric: Metric) => {
    setActiveDrill({ tier, metric });
    setDrillLoading(true);
    setDrillTickets([]);
    try {
      const res = await fetch(`/api/tasks/service-desk/wallboard?tier=${encodeURIComponent(tier)}&metric=${metric}`);
      const json = await res.json();
      if (json.ok && json.data.drillDown) {
        setDrillTickets(json.data.drillDown);
      }
    } catch { /* ignore */ } finally {
      setDrillLoading(false);
    }
  }, []);

  const closeDrill = useCallback(() => {
    setActiveDrill(null);
    setDrillTickets([]);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-500">
        Loading queue data...
      </div>
    );
  }

  if (tiers.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-500">
        No queue data available. Ensure global Jira is configured.
      </div>
    );
  }

  // Build the grid: 3 rows (total, no_update, over_sla) × N tier columns
  const metrics: Metric[] = ['total', 'no_update', 'over_sla'];
  const cols = tiers.length;

  return (
    <div className="relative h-full">
      {/* Main wallboard */}
      <div className="p-5 h-full flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center mb-5">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">{title}</h2>
            <div className="text-[10px] text-neutral-500">Live queue metrics</div>
          </div>
          <div className="text-[10px] text-neutral-500">
            Auto-refresh 30s · Updated {lastUpdate}
          </div>
        </div>

        {/* Tile grid */}
        <div
          className="grid gap-3 flex-1"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${metrics.length}, 1fr)`,
          }}
        >
          {metrics.map(metric =>
            tiers.map(tier => {
              const count = metric === 'total' ? tier.total
                : metric === 'no_update' ? tier.noUpdate
                : tier.overSla;
              const color = ragColor(metric, count);
              const isActive = activeDrill?.tier === tier.name && activeDrill?.metric === metric;
              const flashClass = metric !== 'total' && count > 0 ? 'animate-pulse-subtle' : '';

              return (
                <button
                  key={`${tier.name}-${metric}`}
                  onClick={() => openDrill(tier.name, metric)}
                  className={`
                    relative rounded-xl border transition-all duration-200 cursor-pointer
                    flex flex-col items-center justify-center text-center
                    hover:scale-[1.02] hover:brightness-110 active:scale-[0.98]
                    ${flashClass}
                    ${isActive ? 'ring-2 ring-[#5ec1ca]' : ''}
                  `}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    borderColor: count > 0 && metric !== 'total'
                      ? 'rgba(239,68,68,0.3)'
                      : 'rgba(255,255,255,0.06)',
                  }}
                >
                  <div className="text-[13px] text-neutral-400 font-semibold mb-2 px-2">
                    {tier.name}{metric !== 'total' ? ` — ${METRIC_LABELS[metric]}` : ''}
                  </div>
                  <div
                    className="text-5xl font-extrabold tracking-tighter leading-none"
                    style={{ color }}
                  >
                    {count}
                  </div>
                  {metric === 'total' && (
                    <div className="text-[10px] text-neutral-500 mt-1">
                      {METRIC_LABELS[metric]}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Slide-out drill-down panel */}
      {activeDrill && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={closeDrill}
          />
          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-[520px] max-w-[90vw] bg-[#1e2228] border-l border-[#2a2f38] shadow-2xl z-50 flex flex-col animate-slide-in">
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2f38]">
              <div>
                <h3 className="text-sm font-bold text-neutral-200">
                  {activeDrill.tier} — {METRIC_LABELS[activeDrill.metric]}
                </h3>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  {drillLoading ? 'Loading...' : `${drillTickets.length} ticket${drillTickets.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              <button
                onClick={closeDrill}
                className="text-neutral-500 hover:text-neutral-300 text-lg px-2"
              >
                ✕
              </button>
            </div>

            {/* Ticket list */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
              {drillLoading && (
                <div className="text-neutral-500 text-sm text-center py-8">Loading tickets...</div>
              )}
              {!drillLoading && drillTickets.length === 0 && (
                <div className="text-neutral-500 text-sm text-center py-8">No tickets found</div>
              )}
              {drillTickets.map(t => (
                <div
                  key={t.key}
                  className="bg-[#272c33] rounded-lg border border-[#333a44] p-3 hover:border-[#5ec1ca]/40 transition-colors"
                >
                  {/* Row 1: Key + Status */}
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      {t.source_url ? (
                        <a
                          href={t.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-mono font-bold text-[#5ec1ca] hover:underline"
                        >
                          {t.key}
                        </a>
                      ) : (
                        <span className="text-[12px] font-mono font-bold text-[#5ec1ca]">{t.key}</span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1f26] text-neutral-400 border border-[#333a44]">
                        {t.status}
                      </span>
                    </div>
                    <span className="text-[10px] text-neutral-500">{t.issueType}</span>
                  </div>

                  {/* Row 2: Summary */}
                  <div className="text-[12px] text-neutral-300 mb-2 leading-snug line-clamp-2">
                    {t.summary}
                  </div>

                  {/* Row 3: Meta chips */}
                  <div className="flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="text-neutral-500">
                      {t.assignee}
                    </span>
                    <span
                      className="px-1.5 py-0.5 rounded font-bold"
                      style={{
                        color: priorityColor(t.priority),
                        background: `${priorityColor(t.priority)}15`,
                      }}
                    >
                      {priorityLabel(t.priority)}
                    </span>
                    {t.sla_remaining_ms !== null && (
                      <span
                        className="px-1.5 py-0.5 rounded font-bold"
                        style={{
                          color: t.sla_remaining_ms < 0 ? '#ef4444' : t.sla_remaining_ms < 7200000 ? '#f59e0b' : '#10b981',
                          background: t.sla_remaining_ms < 0 ? 'rgba(239,68,68,0.12)' : t.sla_remaining_ms < 7200000 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                        }}
                      >
                        SLA: {formatSlaRemaining(t.sla_remaining_ms)}
                      </span>
                    )}
                    <span className="text-neutral-600">
                      {ticketAge(t.created)}
                    </span>
                    {/* Reason tags */}
                    {t.attention_reasons.map(r => (
                      <span
                        key={r}
                        className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                      >
                        {r === 'overdue_update' ? 'No Update' : r === 'sla_breached' ? 'SLA Breached' : r === 'sla_approaching' ? 'SLA Near' : r}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Inline keyframes for the slide-in and subtle pulse */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.2s ease-out;
        }
        @keyframes pulseSubtle {
          0%, 100% { background: rgba(255,255,255,0.03); }
          50% { background: rgba(239,68,68,0.08); }
        }
        .animate-pulse-subtle {
          animation: pulseSubtle 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
