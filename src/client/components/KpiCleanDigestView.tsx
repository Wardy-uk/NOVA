/**
 * Clean-Sheet KPI — AI Digests (P5-WP1)
 *
 * Views the AI-generated daily digests for the clean-sheet KPI platform: one
 * cross-space SLT digest plus a per-space digest, stored in kpi_digests. Lets you
 * pick any date and (re)generate on demand. Parallel to the untouched legacy KPI
 * system.
 *
 *   GET  /api/kpi/spaces
 *   GET  /api/kpi/digest-latest          -> { date }
 *   GET  /api/kpi/digest/:date           -> { date, slt, spaces[] }
 *   POST /api/kpi/digest/generate {date} -> generation summary
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

interface DigestRecord { spaceKey: string | null; reportDate: string; summary: string; generatedAt: string; }
interface DigestForDate { date: string; slt: DigestRecord | null; spaces: DigestRecord[]; }
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }
interface GenResult { date: string; spacesGenerated: number; sltGenerated: boolean; aiCount: number; fallbackCount: number; skipped: string[]; }

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function KpiCleanDigestView() {
  const [spaces, setSpaces] = useState<Record<string, string>>({});
  const [date, setDate] = useState<string>(todayIso());
  const [data, setData] = useState<DigestForDate | null>(null);
  const [loading, setLoading] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  // Load space display names + default to the latest date that has a digest.
  useEffect(() => {
    fetch('/api/kpi/spaces')
      .then(r => r.json())
      .then(j => {
        if (j.ok && Array.isArray(j.data)) {
          const map: Record<string, string> = {};
          for (const s of j.data as SpaceListItem[]) map[s.spaceKey] = s.displayName;
          setSpaces(map);
        }
      })
      .catch(() => {});
    fetch('/api/kpi/digest-latest')
      .then(r => r.json())
      .then(j => { if (j.ok && j.data?.date) setDate(j.data.date); })
      .catch(() => {});
  }, []);

  const load = useCallback(async (d: string) => {
    if (!d) return;
    setLoading(true);
    setGenMsg(null);
    try {
      const r = await fetch(`/api/kpi/digest/${encodeURIComponent(d)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load digests');
      setData(j.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (date) load(date); }, [date, load]);

  const generate = useCallback(async () => {
    setGenBusy(true);
    setGenMsg(null);
    try {
      const r = await fetch('/api/kpi/digest/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Generation failed');
      const g: GenResult = j.data;
      setGenMsg(
        `Generated ${g.spacesGenerated} space digest(s)${g.sltGenerated ? ' + SLT' : ''} ` +
        `(${g.aiCount} AI, ${g.fallbackCount} deterministic)` +
        (g.skipped.length ? ` · skipped: ${g.skipped.join(', ')}` : ''),
      );
      await load(date);
    } catch (e) {
      setGenMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenBusy(false);
    }
  }, [date, load]);

  const inputStyle = { background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13 } as const;
  const btn = { background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 } as const;

  const card = (title: string, sub: string, rec: DigestRecord | null, accent: string) => (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: accent }}>{title}</div>
        <div style={{ fontSize: 11, color: C.text3 }}>{sub}{rec ? ` · generated ${new Date(rec.generatedAt).toLocaleString()}` : ''}</div>
      </div>
      {rec
        ? <div style={{ fontSize: 13, color: C.text1, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{rec.summary}</div>
        : <div style={{ fontSize: 12, color: C.text3 }}>No digest for this date. Use <em>Generate</em> after the EOD freeze.</div>}
    </div>
  );

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>AI Digests</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · per-space + cross-space SLT daily summaries</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          <button onClick={() => load(date)} style={btn}>Reload</button>
          <button onClick={generate} disabled={genBusy} style={{ ...btn, background: C.teal, color: '#0b1220', fontWeight: 700, opacity: genBusy ? 0.6 : 1 }}>
            {genBusy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {genMsg && <div style={{ fontSize: 12, color: genMsg.startsWith('Error') ? C.red : C.text2, marginBottom: 12 }}>{genMsg}</div>}
      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && (
        <>
          {card('SLT Cross-Space Digest', `Senior leadership summary · ${date}`, data?.slt ?? null, C.teal)}
          {(data?.spaces ?? []).length === 0 && (
            <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>
              No per-space digests for {date}. They are generated after the daily EOD freeze (per-space + SLT).
            </div>
          )}
          {(data?.spaces ?? []).map((rec) => card(
            spaces[rec.spaceKey ?? ''] ? `${spaces[rec.spaceKey ?? '']} (${rec.spaceKey})` : (rec.spaceKey ?? 'Space'),
            'Team digest',
            rec,
            C.text1,
          ))}
        </>
      )}

      <div style={{ marginTop: 16, fontSize: 10, color: C.text3 }}>
        Digests are written to <code>kpi_digests</code>. When an AI provider is configured they are model-authored; otherwise a
        deterministic structured summary is stored (the generate result reports how many of each). Reads never recompute.
      </div>
    </div>
  );
}
