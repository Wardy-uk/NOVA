import { useEffect, useState } from 'react';

/* Scan all of Plaud for 1-2-1 recordings, list them, and assign each to an agent.
   Each assignment creates a completed 1-2-1 session dated to the recording. */

const C = {
  bg0: 'rgba(0,0,0,0.6)', bg1: '#272C33', bg2: '#2f353d', border: 'rgba(255,255,255,0.1)',
  teal: '#5ec1ca', green: '#10b981', amber: '#f59e0b', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
};

interface Rec { id: string; filename: string; start_time: number; suggestedAgent: string | null; }
type RowState = { agent: string; status: 'idle' | 'saving' | 'done' | 'dismissed' | 'error'; msg?: string };

const RANGES: Array<{ label: string; days: number }> = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 6 months', days: 180 },
  { label: 'Last year', days: 365 },
  { label: 'Everything', days: 0 },
];

export function PlaudScanModal({ onClose, onAssigned }: { onClose: () => void; onAssigned?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [recs, setRecs] = useState<Rec[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [days, setDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/121/plaud/scan?days=${days}`);
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          setConfigured(json.data.configured);
          setRecs(json.data.recordings ?? []);
          setAgents(json.data.agents ?? []);
          const init: Record<string, RowState> = {};
          for (const r of json.data.recordings ?? []) init[r.id] = { agent: r.suggestedAgent ?? '', status: 'idle' };
          setRows(init);
        }
      } catch { /* ignore */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [days]);

  const setAgent = (id: string, agent: string) => setRows((s) => ({ ...s, [id]: { ...s[id], agent, status: 'idle', msg: undefined } }));

  const dismiss = async (id: string) => {
    setRows((s) => ({ ...s, [id]: { ...s[id], status: 'dismissed' } }));
    try {
      await fetch('/api/121/plaud/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordingId: id }) });
    } catch { /* ignore */ }
  };

  const assign = async (rec: Rec) => {
    const row = rows[rec.id];
    if (!row?.agent) { setRows((s) => ({ ...s, [rec.id]: { ...s[rec.id], status: 'error', msg: 'Pick an agent' } })); return; }
    setRows((s) => ({ ...s, [rec.id]: { ...s[rec.id], status: 'saving' } }));
    try {
      const res = await fetch('/api/121/plaud/assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId: rec.id, agentName: row.agent, recordedAt: rec.start_time }),
      });
      const json = await res.json();
      if (json.ok) { setRows((s) => ({ ...s, [rec.id]: { ...s[rec.id], status: 'done' } })); onAssigned?.(); }
      else setRows((s) => ({ ...s, [rec.id]: { ...s[rec.id], status: 'error', msg: json.error || 'Failed' } }));
    } catch { setRows((s) => ({ ...s, [rec.id]: { ...s[rec.id], status: 'error', msg: 'Network error' } })); }
  };

  const visible = recs.filter((r) => rows[r.id]?.status !== 'dismissed');
  const pending = visible.filter((r) => rows[r.id]?.status !== 'done');

  return (
    <div style={{ position: 'fixed', inset: 0, background: C.bg0, backdropFilter: 'blur(2px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: 'min(820px,100%)', maxHeight: '88vh', background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text1 }}>Scan Plaud recordings</div>
            <div style={{ fontSize: 11, color: C.text3 }}>{loading ? 'Scanning…' : `${pending.length} recording${pending.length !== 1 ? 's' : ''} to triage · assign the 1-2-1s, dismiss the rest`}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 8px', fontSize: 12 }}>
              {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
            </select>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text3, fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: C.text3, padding: 40 }}>Searching all of Plaud…</div>
          ) : !configured ? (
            <div style={{ textAlign: 'center', color: C.text3, padding: 40 }}>Plaud isn't connected.</div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.text3, padding: 40 }}>No recordings to triage in this range.</div>
          ) : visible.map((rec) => {
            const row = rows[rec.id];
            const done = row?.status === 'done';
            return (
              <div key={rec.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 8, background: C.bg2, border: `1px solid ${done ? `${C.green}40` : C.border}`, borderRadius: 10, opacity: done ? 0.6 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: C.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.filename || '(untitled)'}</div>
                  <div style={{ fontSize: 10, color: C.text3 }}>
                    {rec.start_time ? new Date(rec.start_time * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                    {rec.suggestedAgent && <span style={{ color: C.teal }}> · suggested: {rec.suggestedAgent}</span>}
                  </div>
                </div>
                {done ? (
                  <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>Assigned ✓</span>
                ) : (
                  <>
                    <select
                      value={row?.agent ?? ''}
                      onChange={(e) => setAgent(rec.id, e.target.value)}
                      style={{ width: 180, background: C.bg1, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 8px', fontSize: 12 }}
                    >
                      <option value="">Select agent…</option>
                      {agents.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <button
                      onClick={() => assign(rec)}
                      disabled={row?.status === 'saving'}
                      style={{ padding: '6px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: C.teal, color: C.bg1 }}
                    >{row?.status === 'saving' ? '…' : 'Assign'}</button>
                    <button
                      onClick={() => dismiss(rec.id)}
                      title="Not a 1-2-1 — hide from the scan"
                      style={{ padding: '6px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.text3 }}
                    >Dismiss</button>
                  </>
                )}
                {row?.status === 'error' && <span style={{ fontSize: 11, color: C.red }}>{row.msg}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
