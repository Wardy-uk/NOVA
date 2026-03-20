import { useState, useEffect, useCallback } from 'react';

interface DrillTicket {
  key: string;
  summary: string;
  status: string;
  priority: number;
  assignee: string;
  source_url: string | null;
  urgency_score: number;
  sla_remaining_ms: number | null;
  attention_reasons: string[];
  created: string | null;
}

function formatSla(ms: number | null): string {
  if (ms === null) return '—';
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const str = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return neg ? `-${str}` : str;
}

function ticketAge(created: string | null): string {
  if (!created) return '—';
  const days = Math.floor((Date.now() - new Date(created).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function prioLabel(p: number): string {
  return p >= 80 ? 'High' : p >= 50 ? 'Medium' : 'Low';
}

function prioColor(p: number): string {
  return p >= 80 ? '#ef4444' : p >= 50 ? '#f59e0b' : '#10b981';
}

const REASON_LABELS: Record<string, string> = {
  overdue_update: 'No Update',
  sla_breached: 'SLA Breached',
  sla_approaching: 'SLA Near',
};

interface Props {
  kpi?: string;
  agent?: string;
  label: string;
  onClose: () => void;
}

export function WallboardDrillPanel({ kpi, agent, label, onClose }: Props) {
  const [tickets, setTickets] = useState<DrillTicket[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams();
      if (kpi) params.set('kpi', kpi);
      if (agent) params.set('agent', agent);
      const res = await fetch(`/api/tasks/service-desk/wallboard/drill-down?${params}`);
      const json = await res.json();
      if (json.ok) {
        if (json.data === null) {
          setTickets([]);
          setMessage(json.message || 'No ticket drill-down available for this KPI');
        } else {
          setTickets(json.data);
        }
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [kpi, agent]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full w-[520px] max-w-[90vw] bg-[#1e2228] border-l border-[#2a2f38] shadow-2xl z-50 flex flex-col"
        style={{ animation: 'wbSlideIn .2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2f38]">
          <div>
            <h3 className="text-sm font-bold text-neutral-200">{label}</h3>
            <div className="text-[11px] text-neutral-500 mt-0.5">
              {loading ? 'Loading...' : message ? message : `${tickets?.length ?? 0} ticket${(tickets?.length ?? 0) !== 1 ? 's' : ''}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300 text-lg px-2"
          >
            ✕
          </button>
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {loading && (
            <div className="text-neutral-500 text-sm text-center py-8">Loading tickets...</div>
          )}
          {!loading && message && (
            <div className="text-neutral-500 text-sm text-center py-8">{message}</div>
          )}
          {!loading && !message && tickets?.length === 0 && (
            <div className="text-neutral-500 text-sm text-center py-8">No tickets found</div>
          )}
          {tickets?.map(t => (
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
              </div>

              {/* Row 2: Summary */}
              <div className="text-[12px] text-neutral-300 mb-2 leading-snug line-clamp-2">
                {t.summary}
              </div>

              {/* Row 3: Meta chips */}
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="text-neutral-500">{t.assignee}</span>
                <span
                  className="px-1.5 py-0.5 rounded font-bold"
                  style={{ color: prioColor(t.priority), background: `${prioColor(t.priority)}15` }}
                >
                  {prioLabel(t.priority)}
                </span>
                {t.sla_remaining_ms !== null && (
                  <span
                    className="px-1.5 py-0.5 rounded font-bold"
                    style={{
                      color: t.sla_remaining_ms < 0 ? '#ef4444' : t.sla_remaining_ms < 7200000 ? '#f59e0b' : '#10b981',
                      background: t.sla_remaining_ms < 0 ? 'rgba(239,68,68,0.12)' : t.sla_remaining_ms < 7200000 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                    }}
                  >
                    SLA: {formatSla(t.sla_remaining_ms)}
                  </span>
                )}
                <span className="text-neutral-600">{ticketAge(t.created)}</span>
                {t.attention_reasons.map(r => (
                  <span
                    key={r}
                    className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                  >
                    {REASON_LABELS[r] || r}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes wbSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
