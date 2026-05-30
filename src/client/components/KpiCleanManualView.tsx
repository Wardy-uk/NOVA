/**
 * Clean-Sheet KPI — Manual Entry & Import (P4-WP1)
 *
 * Manual KPI entry for the non-Jira teams (CS / KAM / ONBOARD / COMMS) from the
 * NEW clean-sheet data source. Lets you pick any space + any date, pre-fills the
 * values already stored for that date, validates input by metric value_type, and
 * saves into kpi_manual_entries (which the server promotes into kpi_daily). Also
 * hosts the Daily KPI Tracker spreadsheet import (with a dry-run preview).
 * Parallel to the untouched legacy KPI system.
 *
 *   GET  /api/kpi/spaces
 *   GET  /api/kpi/manual/:spaceKey/:date
 *   POST /api/kpi/manual-entry   { spaceKey, date, entries:[{metricKey,value,notes?}] }
 *   POST /api/kpi/import         { fileBase64, spaceKey?, dryRun? }
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Rag = 'green' | 'amber' | 'red' | null;
interface FormMetric {
  metricKey: string; displayName: string; category: string; valueType: string; direction: string;
  targetValue: number | null; displayOrder: number;
  currentValue: number | null; enteredBy: string | null; enteredAt: string | null; source: string | null;
  notes: string | null; promotedValue: number | null; promotedRag: Rag;
}
interface ManualForm {
  spaceKey: string; displayName: string; ownerName: string | null; isJiraSpace: boolean;
  reportDate: string; note: string | null; metrics: FormMetric[];
}
interface SpaceListItem { spaceKey: string; displayName: string; isJiraSpace: boolean; }

interface ImportSummary {
  dryRun: boolean; sheetsProcessed: number; datesDetected: string[]; entriesParsed: number;
  entriesSaved: number; spacesTouched: string[];
  unmapped: Array<{ label: string; spaceKey: string | null }>;
  rejected: Array<{ spaceKey: string; metricKey: string; reportDate: string; reason: string }>;
  warnings: string[];
}

const ragColor = (rag: Rag) => rag === 'green' ? C.green : rag === 'amber' ? C.amber : rag === 'red' ? C.red : C.text3;

function typeHint(vt: string): string {
  switch (vt) {
    case 'percentage': return '% (0–100)';
    case 'currency': return '£';
    case 'integer': return 'whole number';
    case 'duration_minutes': return 'minutes';
    default: return 'number';
  }
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function KpiCleanManualView() {
  const [spaces, setSpaces] = useState<SpaceListItem[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>('');
  const [date, setDate] = useState<string>(todayIso());
  const [form, setForm] = useState<ManualForm | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Import state
  const [importSpace, setImportSpace] = useState<string>('');
  const [importBusy, setImportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  // Load spaces once; default to the first manual (non-Jira) space.
  useEffect(() => {
    fetch('/api/kpi/spaces')
      .then(r => r.json())
      .then(j => {
        if (j.ok && Array.isArray(j.data)) {
          const list: SpaceListItem[] = j.data.map((s: any) => ({ spaceKey: s.spaceKey, displayName: s.displayName, isJiraSpace: s.isJiraSpace }));
          setSpaces(list);
          const def = list.find(s => !s.isJiraSpace) ?? list[0];
          if (def) setSpaceKey(def.spaceKey);
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = useCallback(async (key: string, d: string) => {
    if (!key || !d) return;
    setLoading(true);
    setSaveMsg(null);
    try {
      const r = await fetch(`/api/kpi/manual/${encodeURIComponent(key)}/${encodeURIComponent(d)}`);
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Failed to load entry form');
      const f: ManualForm = j.data;
      setForm(f);
      // Seed the draft from stored values (blank if none — never a fabricated 0).
      const seed: Record<string, string> = {};
      for (const m of f.metrics) seed[m.metricKey] = m.currentValue === null ? '' : String(m.currentValue);
      setDraft(seed);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setForm(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (spaceKey && date) load(spaceKey, date); }, [spaceKey, date, load]);

  const save = useCallback(async () => {
    if (!form) return;
    // Only send fields that differ from the stored value AND are non-blank, OR
    // blanks left as blanks are simply skipped server-side (no fabricated 0).
    const entries = form.metrics
      .map(m => ({ metricKey: m.metricKey, value: draft[m.metricKey] ?? '' }))
      .filter(e => e.value.trim() !== '');
    if (entries.length === 0) { setSaveMsg('Nothing to save — enter at least one value.'); return; }
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch('/api/kpi/manual-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceKey: form.spaceKey, date: form.reportDate, entries }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Save failed');
      const saved = j.data.saved?.length ?? 0;
      const rejected = j.data.rejected ?? [];
      setSaveMsg(
        `Saved ${saved} value${saved === 1 ? '' : 's'} & promoted to daily.` +
        (rejected.length ? ` ${rejected.length} rejected: ${rejected.map((x: any) => `${x.metricKey} (${x.reason})`).join(', ')}` : ''),
      );
      await load(form.spaceKey, form.reportDate); // reflect promoted values
    } catch (e) {
      setSaveMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [form, draft, load]);

  const runImport = useCallback(async (file: File, dryRun: boolean) => {
    setImportBusy(true);
    setImportErr(null);
    setImportSummary(null);
    try {
      const buf = await file.arrayBuffer();
      // base64-encode the workbook for the server-side parser.
      let binary = '';
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const fileBase64 = btoa(binary);
      const r = await fetch('/api/kpi/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, spaceKey: importSpace || undefined, dryRun }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Import failed');
      setImportSummary(j.data);
      if (!dryRun && spaceKey && date) load(spaceKey, date);
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImportBusy(false);
    }
  }, [importSpace, spaceKey, date, load]);

  const inputStyle = { background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 12px', fontSize: 13 } as const;
  const btn = { background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 } as const;

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>Manual Entry &amp; Import</h2>
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · non-Jira teams (CS · KAM · Onboarding · Comms)</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey}){s.isJiraSpace ? ' — Jira' : ''}</option>)}
          </select>
          <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          <button onClick={() => load(spaceKey, date)} style={btn}>Reload</button>
        </div>
      </div>

      {error && <div style={{ color: C.red, padding: '12px 0', fontSize: 13 }}>{error}</div>}
      {loading && <div style={{ color: C.text2, padding: 24 }}>Loading…</div>}

      {!loading && form && (
        <>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 12 }}>
            {form.ownerName ? `Owner: ${form.ownerName} · ` : ''}{form.isJiraSpace ? 'Jira-computed space' : 'Manual / non-Jira team'} · entering for <strong style={{ color: C.text2 }}>{form.reportDate}</strong>
          </div>
          {form.note && (
            <div style={{ background: 'rgba(234,179,8,0.06)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', color: C.amber, fontSize: 12, marginBottom: 14 }}>
              {form.note}
            </div>
          )}

          <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: C.text3, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  <th style={{ padding: '10px 14px' }}>Metric</th>
                  <th style={{ padding: '10px 14px' }}>Type</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Target</th>
                  <th style={{ padding: '10px 14px', textAlign: 'right' }}>Value</th>
                  <th style={{ padding: '10px 14px' }}>Promoted (daily)</th>
                </tr>
              </thead>
              <tbody>
                {form.metrics.map((m) => (
                  <tr key={m.metricKey} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '8px 14px', color: C.text1 }}>{m.displayName}<div style={{ fontSize: 10, color: C.text3 }}>{m.metricKey}</div></td>
                    <td style={{ padding: '8px 14px', color: C.text3, fontSize: 11 }}>{typeHint(m.valueType)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: C.text2 }}>{m.targetValue !== null ? m.targetValue : '—'}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                      <input
                        type="number"
                        value={draft[m.metricKey] ?? ''}
                        placeholder="—"
                        onChange={(e) => setDraft(d => ({ ...d, [m.metricKey]: e.target.value }))}
                        style={{ ...inputStyle, width: 110, textAlign: 'right', padding: '4px 8px' }}
                      />
                    </td>
                    <td style={{ padding: '8px 14px', fontSize: 12 }}>
                      {m.promotedValue !== null
                        ? <span style={{ color: ragColor(m.promotedRag), fontWeight: 600 }}>{m.promotedValue}{m.promotedRag ? ` · ${m.promotedRag}` : ''}</span>
                        : <span style={{ color: C.text3 }}>not promoted</span>}
                    </td>
                  </tr>
                ))}
                {form.metrics.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 14, color: C.text3 }}>No metrics enabled for this space.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{ ...btn, background: C.teal, color: '#0b1220', fontWeight: 700, opacity: saving ? 0.6 : 1, padding: '8px 18px' }}
            >
              {saving ? 'Saving…' : 'Save & Promote'}
            </button>
            {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('Error') ? C.red : C.text2 }}>{saveMsg}</span>}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: C.text3 }}>
            Blank fields are skipped — no zero is invented. Saved values are validated by type and promoted into <code>kpi_daily</code> with RAG against the target.
          </div>
        </>
      )}

      {/* ── Spreadsheet import ── */}
      <div style={{ marginTop: 28, background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 4 }}>Daily KPI Tracker Import</div>
        <div style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>
          Upload a Daily KPI Tracker workbook. Rows are matched to metrics by label (per team section); dated columns become report dates. Use <em>Preview</em> first — it parses without writing and reports any unmapped labels.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: C.text2 }}>Force team (single-team sheet):</label>
          <select value={importSpace} onChange={(e) => setImportSpace(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="">Auto (detect sections)</option>
            {spaces.filter(s => !s.isJiraSpace).map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey})</option>)}
          </select>
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={importBusy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { (window as any)._kpiImportFile = f; } }}
            style={{ fontSize: 12, color: C.text2 }}
          />
          <button
            disabled={importBusy}
            onClick={() => { const f = (window as any)._kpiImportFile as File | undefined; if (f) runImport(f, true); else setImportErr('Choose a file first.'); }}
            style={btn}
          >{importBusy ? 'Working…' : 'Preview (dry-run)'}</button>
          <button
            disabled={importBusy}
            onClick={() => { const f = (window as any)._kpiImportFile as File | undefined; if (f) runImport(f, false); else setImportErr('Choose a file first.'); }}
            style={{ ...btn, background: 'rgba(94,193,202,0.12)', color: C.teal }}
          >Import (write)</button>
        </div>
        {importErr && <div style={{ color: C.red, fontSize: 12 }}>{importErr}</div>}
        {importSummary && (
          <div style={{ fontSize: 12, color: C.text2 }}>
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: importSummary.dryRun ? C.amber : C.green }}>{importSummary.dryRun ? 'Dry-run preview' : 'Imported'}</strong>
              {' · '}{importSummary.sheetsProcessed} sheet(s) · {importSummary.entriesParsed} parsed
              {!importSummary.dryRun && ` · ${importSummary.entriesSaved} saved`}
              {importSummary.spacesTouched.length > 0 && ` · spaces: ${importSummary.spacesTouched.join(', ')}`}
            </div>
            {importSummary.datesDetected.length > 0 && (
              <div style={{ color: C.text3, marginBottom: 6 }}>Dates: {importSummary.datesDetected[0]} → {importSummary.datesDetected[importSummary.datesDetected.length - 1]} ({importSummary.datesDetected.length})</div>
            )}
            {importSummary.unmapped.length > 0 && (
              <details style={{ marginBottom: 6 }}>
                <summary style={{ color: C.amber, cursor: 'pointer' }}>{importSummary.unmapped.length} unmapped label(s) — not imported</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: C.text3 }}>
                  {importSummary.unmapped.slice(0, 40).map((u, i) => <li key={i}>{u.label}{u.spaceKey ? ` (${u.spaceKey})` : ' (no team context)'}</li>)}
                </ul>
              </details>
            )}
            {importSummary.rejected.length > 0 && (
              <details style={{ marginBottom: 6 }}>
                <summary style={{ color: C.red, cursor: 'pointer' }}>{importSummary.rejected.length} rejected value(s)</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: C.text3 }}>
                  {importSummary.rejected.slice(0, 40).map((r, i) => <li key={i}>{r.spaceKey}/{r.metricKey} {r.reportDate}: {r.reason}</li>)}
                </ul>
              </details>
            )}
            {importSummary.warnings.length > 0 && (
              <div style={{ color: C.text3 }}>{importSummary.warnings.join(' · ')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
