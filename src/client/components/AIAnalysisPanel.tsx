import { useState, useEffect } from 'react';

interface AIDecision {
  id: number;
  action: string;
  confidence: number;
  reasoning: string | null;
  output: string | null;
  inputs: string | null;
  provider?: string | null;
  model?: string | null;
  created_at: string;
}

interface AIAnalysisPanelProps {
  ticketKey: string;
  decision?: AIDecision | null;
  onUseDraft?: (draft: string) => void;
  hideDraft?: boolean;
}

function confidenceBar(c: number): string {
  if (c >= 0.8) return 'bg-green-500';
  if (c >= 0.5) return 'bg-amber-500';
  return 'bg-red-500';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const color: Record<string, string> = {
    positive: 'bg-green-950/40 text-green-400 border-green-800/40',
    neutral: 'bg-neutral-800/50 text-neutral-400 border-neutral-700/40',
    frustrated: 'bg-amber-950/40 text-amber-400 border-amber-800/40',
    angry: 'bg-red-950/40 text-red-400 border-red-800/40',
    urgent: 'bg-red-950/40 text-red-400 border-red-800/40',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border ${color[sentiment] ?? color.neutral}`}>{sentiment}</span>;
}

function parseJson(raw: string | null | undefined): any {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

export function AIAnalysisPanel({ ticketKey, decision: propDecision, onUseDraft, hideDraft }: AIAnalysisPanelProps) {
  const [fetched, setFetched] = useState<AIDecision | null>(null);
  const [loading, setLoading] = useState(!propDecision);

  useEffect(() => {
    if (propDecision !== undefined) return;
    let cancelled = false;
    setLoading(true);
    const token = localStorage.getItem('nova_auth_token') || '';
    fetch(`/api/agent/decisions/ticket/${encodeURIComponent(ticketKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (!cancelled && json.ok && json.data?.length) {
          setFetched(json.data[0]);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticketKey, propDecision]);

  const d = propDecision ?? fetched;

  if (loading) return null;
  if (!d) return null;

  const output = parseJson(d.output);
  const inputs = parseJson(d.inputs);
  const draftResponse = output?.draft_response as string | undefined;

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#272C33]">
      <div className="px-4 py-2 border-b border-[#3a424d] bg-[#2a3039]">
        <h4 className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold">AI Analysis</h4>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-neutral-200">
            {d.action === 'draft_response' ? 'Respond' : d.action}
          </span>
          <span className="text-[9px] text-neutral-600">{d.created_at ? timeAgo(d.created_at) : ''}</span>
        </div>

        {/* Confidence meter */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Confidence</span>
            <span className={`text-xs font-bold ${d.confidence >= 0.8 ? 'text-green-400' : d.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
              {(d.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${confidenceBar(d.confidence)}`}
              style={{ width: `${Math.round(d.confidence * 100)}%` }} />
          </div>
        </div>

        {/* Classification */}
        {output?.classification && (
          <div className="bg-[#2f353d] rounded p-2">
            <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">Classification</div>
            <div className="text-xs text-neutral-300">
              {output.classification.category}
              {output.classification.sub_category && <span className="text-neutral-500"> / {output.classification.sub_category}</span>}
            </div>
          </div>
        )}

        {/* Sentiment */}
        {(inputs?.sentiment || output?.sentiment) && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-neutral-500 uppercase tracking-wider">Sentiment</span>
            <SentimentBadge sentiment={inputs?.sentiment ?? output?.sentiment ?? ''} />
          </div>
        )}

        {/* SLA Risk */}
        {inputs?.sla_risk && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-neutral-500 uppercase tracking-wider">SLA Risk</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
              inputs.sla_risk === 'critical' || inputs.sla_risk === 'high' ? 'bg-red-950/40 text-red-400 border-red-800/40'
                : inputs.sla_risk === 'medium' ? 'bg-amber-950/40 text-amber-400 border-amber-800/40'
                : 'bg-neutral-800/50 text-neutral-400 border-neutral-700/40'
            }`}>{inputs.sla_risk}</span>
          </div>
        )}

        {/* Reasoning */}
        <div>
          <div className="text-[9px] text-neutral-500 uppercase tracking-wider mb-1">Reasoning</div>
          <div className="text-[10px] text-neutral-400 leading-relaxed bg-[#2f353d] rounded p-2 max-h-28 overflow-y-auto">
            {typeof d.reasoning === 'string' ? d.reasoning : ''}
          </div>
        </div>

        {/* AI Draft preview */}
        {draftResponse && !hideDraft && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-neutral-500 uppercase tracking-wider">AI Draft</span>
              {onUseDraft && (
                <button onClick={() => onUseDraft(draftResponse)} className="text-[9px] text-[#5ec1ca] hover:text-[#7dd3d8]">Use this draft →</button>
              )}
            </div>
            <div className="text-[10px] text-neutral-400 bg-[#2f353d] rounded p-2 max-h-20 overflow-y-auto leading-relaxed">
              {draftResponse.slice(0, 300)}{draftResponse.length > 300 ? '...' : ''}
            </div>
          </div>
        )}

        {/* Provider info */}
        {(d.provider || d.model) && (
          <div className="text-[9px] text-neutral-600">
            {d.provider}/{d.model}
          </div>
        )}
      </div>
    </div>
  );
}
