import { useState } from 'react';

/* Attach the Plaud recording of a 1-2-1 to the agent's most recent session. Lists notes
   whose title contains the agent's name (no auto-bind — you pick). Used on the My Team
   card and the agent profile. The recording is the 1-2-1 itself, so this is a
   post-meeting action, not part of the live click-through. */

const C = {
  bg1: '#272C33', bg2: '#2f353d', border: 'rgba(255,255,255,0.12)',
  teal: '#5ec1ca', green: '#10b981', text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b', amber: '#f59e0b',
};

interface Candidate { id: string; filename: string; start_time: number; matchedByName: boolean; }

export function PlaudAttachButton({ agentName, compact, onAttached }: {
  agentName: string; compact?: boolean; onAttached?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ configured: boolean; matchedByName: boolean; candidates: Candidate[]; hasSession: boolean } | null>(null);
  const [attaching, setAttaching] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true); setMsg(null); setLoading(true);
    try {
      const res = await fetch(`/api/121/agent/${encodeURIComponent(agentName)}/plaud-candidates`);
      const json = await res.json();
      if (json.ok) setData(json.data);
      else setMsg(json.error || 'Could not load recordings.');
    } catch { setMsg('Network error.'); }
    setLoading(false);
  };

  const attach = async (e: React.MouseEvent, c: Candidate) => {
    e.stopPropagation();
    const id = c.id;
    setAttaching(id); setMsg(null);
    try {
      const res = await fetch(`/api/121/agent/${encodeURIComponent(agentName)}/plaud-attach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordingId: id, recordedAt: c.start_time }),
      });
      const json = await res.json();
      if (json.ok) { setMsg('Attached ✓'); onAttached?.(); setTimeout(() => setOpen(false), 1000); }
      else setMsg(json.error || 'Attach failed.');
    } catch { setMsg('Network error.'); }
    setAttaching(null);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={toggle}
        style={{
          padding: compact ? '6px 0' : '6px 14px', width: compact ? '100%' : undefined,
          borderRadius: compact ? 8 : 20, border: `1px solid ${C.border}`, background: 'transparent',
          color: C.text2, fontSize: compact ? 10 : 11, fontWeight: 600, cursor: 'pointer',
        }}
        title="Attach the Plaud recording of this 1-2-1"
      >🎙 {compact ? 'Attach Recording' : 'Attach 1-2-1 Recording'}</button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 50, width: 320,
            background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>Plaud recording — {agentName.split(' ')[0]}</div>
            <button onClick={(e) => { e.stopPropagation(); setOpen(false); }} style={{ background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>

          {loading ? (
            <div style={{ fontSize: 12, color: C.text3, padding: '8px 0' }}>Searching…</div>
          ) : !data?.configured ? (
            <div style={{ fontSize: 12, color: C.text3 }}>Plaud isn't connected.</div>
          ) : !data.hasSession ? (
            <div style={{ fontSize: 12, color: C.amber }}>No 1-2-1 yet — run one first, then attach the recording.</div>
          ) : data.candidates.length === 0 ? (
            <div style={{ fontSize: 12, color: C.text3 }}>No recordings found near the 1-2-1 date.</div>
          ) : (
            <>
              <div style={{ fontSize: 10, color: C.text3, marginBottom: 8 }}>
                {data.matchedByName ? 'Matched by name:' : 'No name match — all recordings near the date:'}
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {data.candidates.map((c) => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', marginBottom: 5, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 7 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.text1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {c.matchedByName && <span style={{ color: C.teal }}>● </span>}{c.filename || '(untitled)'}
                      </div>
                      <div style={{ fontSize: 9, color: C.text3 }}>
                        {c.start_time ? new Date(c.start_time * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </div>
                    </div>
                    <button
                      onClick={(e) => attach(e, c)}
                      disabled={attaching === c.id}
                      style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: `1px solid ${C.teal}`, background: `${C.teal}20`, color: C.teal }}
                    >{attaching === c.id ? '…' : 'Attach'}</button>
                  </div>
                ))}
              </div>
            </>
          )}
          {msg && <div style={{ fontSize: 11, color: msg.includes('✓') ? C.green : C.amber, marginTop: 8 }}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
