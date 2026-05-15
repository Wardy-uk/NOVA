import { useState, useCallback } from 'react';
import { GlassCard, riskScoreColor } from '../queue/index.js';

interface RiskFactor {
  id: string;
  label: string;
  score: number;
  detail?: string;
}

interface DiagnoseData {
  found: boolean;
  score: number;
  threshold: number;
  factors: RiskFactor[];
}

export interface RiskFactorsCardProps {
  ticketKey: string;
  riskFactors?: RiskFactor[];
  riskScore?: number;
  onDiagnose?: () => void;
}

export function RiskFactorsCard({ ticketKey, riskFactors, riskScore, onDiagnose }: RiskFactorsCardProps) {
  const [diagnoseData, setDiagnoseData] = useState<DiagnoseData | null>(null);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);

  const loadDiagnose = useCallback(async () => {
    setDiagnoseLoading(true);
    try {
      const token = localStorage.getItem('nova_auth_token') || '';
      const r = await fetch(`/api/agent/flagged/diagnose/${ticketKey}`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await r.text();
      try { const json = JSON.parse(text); if (json.ok) setDiagnoseData(json.data); } catch { /* silent */ }
    } finally { setDiagnoseLoading(false); }
    onDiagnose?.();
  }, [ticketKey, onDiagnose]);

  if (!riskFactors || riskFactors.length === 0) return null;

  return (
    <GlassCard className="p-4" accentGradient="#ef4444 30%, #f59e0b 70%" accent>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-red-400">Risk Factors</div>
        <button
          onClick={loadDiagnose}
          disabled={diagnoseLoading}
          className="text-[10px] text-[#5ec1ca] hover:underline disabled:opacity-50"
        >{diagnoseLoading ? 'Loading...' : diagnoseData ? 'Refresh diagnosis' : 'Run diagnosis'}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {riskFactors.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-[#272C33] border border-[#3a424d] text-neutral-400" title={f.detail}>
            <span className="font-mono text-neutral-500">+{f.score}</span> {f.label}
          </span>
        ))}
      </div>
      {diagnoseData && diagnoseData.found && (
        <div className="mt-3 pt-3 border-t border-[#3a424d]">
          <div className="text-[10px] text-neutral-500 mb-1">
            Recalculated: <span className="font-bold" style={{ color: riskScoreColor(diagnoseData.score) }}>{diagnoseData.score}</span> / threshold {diagnoseData.threshold}
          </div>
          {diagnoseData.factors.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {diagnoseData.factors.map((f, i) => (
                <span key={i} className="px-1.5 py-0.5 text-[9px] rounded bg-[#1a1e24] border border-[#3a424d] text-neutral-500">
                  +{f.score} {f.label}{f.detail ? ` — ${f.detail}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
