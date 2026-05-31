/**
 * Clean-Sheet KPI — Config / Admin (P5-WP1)
 *
 * The configuration + health surface for the clean-sheet KPI platform (design
 * §10). Six tabs: Spaces · Metrics · Tiers · Holidays · Health · Import. All
 * writes go to the NEW /api/kpi/* surface; the legacy KPI system is untouched.
 *
 *   GET  /api/kpi/spaces
 *   PUT  /api/kpi/spaces/:key
 *   GET  /api/kpi/admin/space-metrics/:space   PUT /api/kpi/spaces/:key/metrics
 *   GET/PUT/DELETE /api/kpi/tiers/:space[/:tierName]
 *   GET/POST/DELETE /api/kpi/holidays
 *   GET  /api/kpi/admin-health
 *   POST /api/kpi/import
 */
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg1: '#272C33', bg2: '#2f353d',
  teal: '#5ec1ca', green: '#10b981', amber: '#eab308', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
  border: 'rgba(255,255,255,0.06)', glass: 'rgba(255,255,255,0.03)',
} as const;

type Tab = 'spaces' | 'metrics' | 'tiers' | 'holidays' | 'health' | 'import';

interface SpaceCfg {
  spaceKey: string; jiraProject: string | null; displayName: string; ownerName: string | null;
  timezone: string; bizHours: { startMinutes: number; endMinutes: number };
  weekendDays: number[]; pauseStatuses: string[]; hasTiers: boolean; isJiraSpace: boolean;
}

const inputStyle = { background: C.bg2, color: C.text1, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13 } as const;
const btn = { background: C.glass, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 } as const;
const primaryBtn = { ...btn, background: C.teal, color: '#0b1220', fontWeight: 700 } as const;
const th = { padding: '8px 12px', color: C.text3, fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.4px', textAlign: 'left' as const };
const td = { padding: '6px 12px', fontSize: 13, color: C.text1, borderTop: `1px solid ${C.border}` };

const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function getJson(url: string) { const r = await fetch(url); const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Request failed'); return j.data; }
async function sendJson(method: string, url: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Request failed'); return j.data;
}

export function KpiCleanAdminView() {
  const [tab, setTab] = useState<Tab>('spaces');
  const [spaces, setSpaces] = useState<SpaceCfg[]>([]);
  const [spaceKey, setSpaceKey] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadSpaces = useCallback(async () => {
    try { const data = await getJson('/api/kpi/spaces'); setSpaces(data); if (!spaceKey && data[0]) setSpaceKey(data[0].spaceKey); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [spaceKey]);
  useEffect(() => { loadSpaces(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const note = (m: string) => { setMsg(m); setErr(null); };
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : String(e)); };

  const TABS: Tab[] = ['spaces', 'metrics', 'tiers', 'holidays', 'health', 'import'];

  return (
    <div style={{ padding: '8px 4px 32px' }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.text1, letterSpacing: '-0.5px', margin: 0 }}>KPI Config &amp; Health</h2>
        <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>Clean-sheet KPI platform · spaces · metrics · tiers · holidays · health · import</div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => { setTab(t); setMsg(null); setErr(null); }}
            style={{ ...btn, background: tab === t ? 'rgba(94,193,202,0.14)' : C.glass, color: tab === t ? C.teal : C.text2, textTransform: 'capitalize' }}>
            {t}
          </button>
        ))}
      </div>

      {(tab === 'metrics' || tab === 'tiers' || tab === 'holidays') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: C.text2 }}>Space:</label>
          <select value={spaceKey} onChange={(e) => setSpaceKey(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
            {spaces.map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey})</option>)}
          </select>
        </div>
      )}

      {msg && <div style={{ fontSize: 12, color: C.green, marginBottom: 10 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{err}</div>}

      {tab === 'spaces' && <SpacesTab spaces={spaces} onSaved={() => { note('Space updated.'); loadSpaces(); }} onErr={fail} />}
      {tab === 'metrics' && spaceKey && <MetricsTab spaceKey={spaceKey} onSaved={note} onErr={fail} />}
      {tab === 'tiers' && spaceKey && <TiersTab spaceKey={spaceKey} onSaved={note} onErr={fail} />}
      {tab === 'holidays' && spaceKey && <HolidaysTab spaceKey={spaceKey} onSaved={note} onErr={fail} />}
      {tab === 'health' && <HealthTab onErr={fail} />}
      {tab === 'import' && <ImportTab spaces={spaces} onErr={fail} />}
    </div>
  );
}

// ── Spaces ──
function SpacesTab({ spaces, onSaved, onErr }: { spaces: SpaceCfg[]; onSaved: () => void; onErr: (e: unknown) => void }) {
  const [sel, setSel] = useState<string>('');
  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => { if (!sel && spaces[0]) setSel(spaces[0].spaceKey); }, [spaces, sel]);
  const s = spaces.find(x => x.spaceKey === sel);
  useEffect(() => {
    if (!s) return;
    setForm({
      displayName: s.displayName, ownerName: s.ownerName ?? '', timezone: s.timezone,
      bizHoursStart: minToHHMM(s.bizHours.startMinutes), bizHoursEnd: minToHHMM(s.bizHours.endMinutes),
      weekendDays: s.weekendDays.join(','), pauseStatuses: s.pauseStatuses.join(', '), hasTiers: s.hasTiers ? '1' : '0',
    });
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      await sendJson('PUT', `/api/kpi/spaces/${encodeURIComponent(sel)}`, {
        displayName: form.displayName, ownerName: form.ownerName || null, timezone: form.timezone,
        bizHoursStart: form.bizHoursStart, bizHoursEnd: form.bizHoursEnd, weekendDays: form.weekendDays,
        pauseStatuses: form.pauseStatuses.split(',').map(x => x.trim()).filter(Boolean), hasTiers: form.hasTiers === '1',
      });
      onSaved();
    } catch (e) { onErr(e); }
  };
  const field = (label: string, key: string, w = 200) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: C.text3, marginBottom: 3 }}>{label}</div>
      <input value={form[key] ?? ''} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} style={{ ...inputStyle, width: w }} />
    </div>
  );
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginBottom: 14 }}>
        {spaces.map(x => <option key={x.spaceKey} value={x.spaceKey}>{x.displayName} ({x.spaceKey})</option>)}
      </select>
      {s && (
        <>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>{field('Display name', 'displayName')}{field('Owner', 'ownerName')}{field('Timezone', 'timezone')}</div>
            <div>{field('Business hours start (HH:MM)', 'bizHoursStart', 120)}{field('Business hours end (HH:MM)', 'bizHoursEnd', 120)}{field('Weekend days (CSV 0=Sun..6=Sat)', 'weekendDays', 120)}</div>
            <div>{field('Pause statuses (comma separated)', 'pauseStatuses', 280)}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: C.text3, marginBottom: 3 }}>Has tiers</div>
                <select value={form.hasTiers ?? '0'} onChange={(e) => setForm(f => ({ ...f, hasTiers: e.target.value }))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="0">No</option><option value="1">Yes</option>
                </select>
              </div>
              <div style={{ fontSize: 11, color: C.text3 }}>{s.isJiraSpace ? `Jira project: ${s.jiraProject}` : 'Manual / non-Jira team'}</div>
            </div>
          </div>
          <button onClick={save} style={{ ...primaryBtn, marginTop: 8 }}>Save space</button>
        </>
      )}
    </div>
  );
}

// ── Metrics ──
interface Binding { metricKey: string; displayName: string; category: string; valueType: string; isEnabled: boolean; targetValue: number | null; amberBand: number | null; displayOrder: number; showOnWallboard: boolean; showOnSlt: boolean; }
function MetricsTab({ spaceKey, onSaved, onErr }: { spaceKey: string; onSaved: (m: string) => void; onErr: (e: unknown) => void }) {
  const [rows, setRows] = useState<Binding[]>([]);
  const [dirty, setDirty] = useState<Record<string, Partial<Binding>>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await getJson(`/api/kpi/admin/space-metrics/${encodeURIComponent(spaceKey)}`)); setDirty({}); }
    catch (e) { onErr(e); }
  }, [spaceKey, onErr]);
  useEffect(() => { load(); }, [load]);

  const patch = (mk: string, p: Partial<Binding>) => setDirty(d => ({ ...d, [mk]: { ...d[mk], ...p } }));
  const val = (b: Binding, k: keyof Binding) => (dirty[b.metricKey]?.[k] ?? b[k]) as any;

  const save = async () => {
    const metrics = Object.entries(dirty).map(([metricKey, p]) => ({ metricKey, ...p }));
    if (metrics.length === 0) { onSaved('No changes.'); return; }
    setBusy(true);
    try { const r = await sendJson('PUT', `/api/kpi/spaces/${encodeURIComponent(spaceKey)}/metrics`, { metrics }); onSaved(`Applied ${r.applied} change(s).`); await load(); }
    catch (e) { onErr(e); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Metric</th><th style={th}>Cat</th><th style={th}>On</th><th style={th}>Target</th><th style={th}>Amber%</th><th style={th}>Order</th><th style={th}>SLT</th><th style={th}>Wallboard</th></tr></thead>
        <tbody>
          {rows.map(b => (
            <tr key={b.metricKey}>
              <td style={td}>{b.displayName}<div style={{ fontSize: 10, color: C.text3 }}>{b.metricKey}</div></td>
              <td style={{ ...td, color: C.text3, fontSize: 11 }}>{b.category}</td>
              <td style={td}><input type="checkbox" checked={!!val(b, 'isEnabled')} onChange={(e) => patch(b.metricKey, { isEnabled: e.target.checked })} /></td>
              <td style={td}><input type="number" value={val(b, 'targetValue') ?? ''} onChange={(e) => patch(b.metricKey, { targetValue: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...inputStyle, width: 80, padding: '3px 6px' }} /></td>
              <td style={td}><input type="number" value={val(b, 'amberBand') ?? ''} onChange={(e) => patch(b.metricKey, { amberBand: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...inputStyle, width: 64, padding: '3px 6px' }} /></td>
              <td style={td}><input type="number" value={val(b, 'displayOrder') ?? 0} onChange={(e) => patch(b.metricKey, { displayOrder: Number(e.target.value) })} style={{ ...inputStyle, width: 56, padding: '3px 6px' }} /></td>
              <td style={td}><input type="checkbox" checked={!!val(b, 'showOnSlt')} onChange={(e) => patch(b.metricKey, { showOnSlt: e.target.checked })} /></td>
              <td style={td}><input type="checkbox" checked={!!val(b, 'showOnWallboard')} onChange={(e) => patch(b.metricKey, { showOnWallboard: e.target.checked })} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td style={td} colSpan={8}>No metric bindings for this space.</td></tr>}
        </tbody>
      </table>
      <div style={{ padding: 12, borderTop: `1px solid ${C.border}` }}>
        <button onClick={save} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Save metric config'}</button>
        <span style={{ marginLeft: 12, fontSize: 11, color: C.text3 }}>{Object.keys(dirty).length} unsaved change(s)</span>
      </div>
    </div>
  );
}

// ── Tiers ──
interface Tier { tierName: string; tierOrder: number; jiraFieldValue: string | null; frtTargetMinutes: number | null; resolutionTargetMinutes: number | null; }
function TiersTab({ spaceKey, onSaved, onErr }: { spaceKey: string; onSaved: (m: string) => void; onErr: (e: unknown) => void }) {
  const [rows, setRows] = useState<Tier[]>([]);
  const [nw, setNw] = useState<Tier>({ tierName: '', tierOrder: 1, jiraFieldValue: '', frtTargetMinutes: 60, resolutionTargetMinutes: 480 });
  const load = useCallback(async () => { try { setRows(await getJson(`/api/kpi/tiers/${encodeURIComponent(spaceKey)}`)); } catch (e) { onErr(e); } }, [spaceKey, onErr]);
  useEffect(() => { load(); }, [load]);
  const upsert = async (t: Tier) => { try { await sendJson('PUT', `/api/kpi/tiers/${encodeURIComponent(spaceKey)}`, t); onSaved(`Tier "${t.tierName}" saved.`); await load(); } catch (e) { onErr(e); } };
  const del = async (name: string) => { try { await sendJson('DELETE', `/api/kpi/tiers/${encodeURIComponent(spaceKey)}/${encodeURIComponent(name)}`); onSaved(`Tier "${name}" removed.`); await load(); } catch (e) { onErr(e); } };
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Tier</th><th style={th}>Order</th><th style={th}>Jira value (current_tier)</th><th style={th}>FRT min</th><th style={th}>Resolution min</th><th style={th}></th></tr></thead>
        <tbody>
          {rows.map(t => <TierRow key={t.tierName} t={t} onSave={upsert} onDelete={del} />)}
          <tr style={{ borderTop: `2px solid ${C.border}` }}>
            <td style={td}><input value={nw.tierName} placeholder="new tier" onChange={(e) => setNw({ ...nw, tierName: e.target.value })} style={{ ...inputStyle, width: 110, padding: '3px 6px' }} /></td>
            <td style={td}><input type="number" value={nw.tierOrder} onChange={(e) => setNw({ ...nw, tierOrder: Number(e.target.value) })} style={{ ...inputStyle, width: 56, padding: '3px 6px' }} /></td>
            <td style={td}><input value={nw.jiraFieldValue ?? ''} onChange={(e) => setNw({ ...nw, jiraFieldValue: e.target.value || null })} style={{ ...inputStyle, width: 160, padding: '3px 6px' }} /></td>
            <td style={td}><input type="number" value={nw.frtTargetMinutes ?? ''} onChange={(e) => setNw({ ...nw, frtTargetMinutes: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...inputStyle, width: 80, padding: '3px 6px' }} /></td>
            <td style={td}><input type="number" value={nw.resolutionTargetMinutes ?? ''} onChange={(e) => setNw({ ...nw, resolutionTargetMinutes: e.target.value === '' ? null : Number(e.target.value) })} style={{ ...inputStyle, width: 90, padding: '3px 6px' }} /></td>
            <td style={td}><button onClick={() => nw.tierName && upsert(nw)} style={primaryBtn}>Add</button></td>
          </tr>
        </tbody>
      </table>
      <div style={{ padding: 10, fontSize: 10, color: C.text3 }}>The <code>Standard</code> row (order 0) holds the space-level SLA minute targets used when a ticket has no tier.</div>
    </div>
  );
}
function TierRow({ t, onSave, onDelete }: { t: Tier; onSave: (t: Tier) => void; onDelete: (name: string) => void }) {
  const [e, setE] = useState<Tier>(t);
  useEffect(() => setE(t), [t]);
  return (
    <tr>
      <td style={td}>{t.tierName}</td>
      <td style={td}><input type="number" value={e.tierOrder} onChange={(ev) => setE({ ...e, tierOrder: Number(ev.target.value) })} style={{ ...inputStyle, width: 56, padding: '3px 6px' }} /></td>
      <td style={td}><input value={e.jiraFieldValue ?? ''} onChange={(ev) => setE({ ...e, jiraFieldValue: ev.target.value || null })} style={{ ...inputStyle, width: 160, padding: '3px 6px' }} /></td>
      <td style={td}><input type="number" value={e.frtTargetMinutes ?? ''} onChange={(ev) => setE({ ...e, frtTargetMinutes: ev.target.value === '' ? null : Number(ev.target.value) })} style={{ ...inputStyle, width: 80, padding: '3px 6px' }} /></td>
      <td style={td}><input type="number" value={e.resolutionTargetMinutes ?? ''} onChange={(ev) => setE({ ...e, resolutionTargetMinutes: ev.target.value === '' ? null : Number(ev.target.value) })} style={{ ...inputStyle, width: 90, padding: '3px 6px' }} /></td>
      <td style={td}><button onClick={() => onSave(e)} style={btn}>Save</button> <button onClick={() => onDelete(t.tierName)} style={{ ...btn, color: C.red }}>Del</button></td>
    </tr>
  );
}

// ── Holidays ──
function HolidaysTab({ spaceKey, onSaved, onErr }: { spaceKey: string; onSaved: (m: string) => void; onErr: (e: unknown) => void }) {
  const [rows, setRows] = useState<Array<{ id: number; holidayDate: string; description: string | null }>>([]);
  const [date, setDate] = useState(todayIso());
  const [desc, setDesc] = useState('');
  const load = useCallback(async () => { try { setRows(await getJson(`/api/kpi/holidays?spaceKey=${encodeURIComponent(spaceKey)}`)); } catch (e) { onErr(e); } }, [spaceKey, onErr]);
  useEffect(() => { load(); }, [load]);
  const add = async () => { try { await sendJson('POST', '/api/kpi/holidays', { spaceKey, date, description: desc || null }); onSaved('Holiday added.'); setDesc(''); await load(); } catch (e) { onErr(e); } };
  const del = async (id: number) => { try { await sendJson('DELETE', `/api/kpi/holidays/${id}`); onSaved('Holiday removed.'); await load(); } catch (e) { onErr(e); } };
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        <input value={desc} placeholder="description (optional)" onChange={(e) => setDesc(e.target.value)} style={{ ...inputStyle, width: 240 }} />
        <button onClick={add} style={primaryBtn}>Add holiday</button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>Date</th><th style={th}>Description</th><th style={th}></th></tr></thead>
        <tbody>
          {rows.map(h => <tr key={h.id}><td style={td}>{h.holidayDate}</td><td style={td}>{h.description ?? '—'}</td><td style={td}><button onClick={() => del(h.id)} style={{ ...btn, color: C.red }}>Del</button></td></tr>)}
          {rows.length === 0 && <tr><td style={td} colSpan={3}>No holidays configured for this space.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Health ──
function HealthTab({ onErr }: { onErr: (e: unknown) => void }) {
  const [data, setData] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    getJson('/api/kpi/admin-health').then(setData).catch(onErr);
    fetch('/api/kpi/health').then(r => r.json()).then(j => { if (j.ok) setHealth(j.data); }).catch(() => {});
  }, [onErr]);
  if (!data) return <div style={{ color: C.text2, padding: 24 }}>Loading…</div>;
  const sched = (s: any, label: string) => s ? (
    <span style={{ marginRight: 14 }}>{label}: <strong style={{ color: s.registered ? C.green : C.red }}>{s.registered ? 'on' : 'off'}</strong>{s.lastRun ? ` (last ${new Date(s.lastRun).toLocaleTimeString()}, ${s.runCount} runs)` : ''}{s.lastError ? ` ⚠ ${s.lastError}` : ''}</span>
  ) : null;
  return (
    <div>
      <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, fontSize: 12, color: C.text2 }}>
        <div style={{ marginBottom: 6 }}>
          <strong style={{ color: health?.initialised ? C.green : C.red }}>Foundation {health?.initialised ? 'ACTIVE' : 'INERT'}</strong>
          {health?.initError ? ` — ${health.initError}` : ''} · {data.engine.spaces} spaces · {data.engine.metrics} metrics · {data.engine.spaceMetrics} bindings · {data.engine.snapshotRows} snapshots
        </div>
        {health && <div>{sched(health.scheduler, 'Snapshot')}{sched(health.eodScheduler, 'EOD')}{sched(health.digestScheduler, 'Digest')}</div>}
      </div>
      <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Space</th><th style={th}>Type</th><th style={th}>Last daily</th><th style={th}>Days/14</th><th style={th}>Missing biz days</th><th style={th}>Last snapshot</th><th style={th}>Snaps today</th><th style={th}>Last digest</th></tr></thead>
          <tbody>
            {data.spaces.map((s: any) => (
              <tr key={s.spaceKey}>
                <td style={td}>{s.displayName}<div style={{ fontSize: 10, color: C.text3 }}>{s.spaceKey}</div></td>
                <td style={{ ...td, color: C.text3, fontSize: 11 }}>{s.isJiraSpace ? 'Jira' : 'manual'}</td>
                <td style={td}>{s.lastDailyDate ?? '—'}</td>
                <td style={{ ...td, color: s.dailyDaysLast14 === 0 ? C.text3 : C.text1 }}>{s.dailyDaysLast14}</td>
                <td style={{ ...td, color: s.missingBusinessDaysLast14.length ? C.amber : C.text3, fontSize: 11 }}>{s.missingBusinessDaysLast14.length ? `${s.missingBusinessDaysLast14.length}: ${s.missingBusinessDaysLast14.slice(-5).join(', ')}` : '—'}</td>
                <td style={{ ...td, fontSize: 11 }}>{s.lastSnapshotAt ? new Date(s.lastSnapshotAt).toLocaleString() : '—'}</td>
                <td style={td}>{s.snapshotRowsToday}</td>
                <td style={td}>{s.lastDigestDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: C.text3 }}>Gaps are surfaced honestly — missing business days, snapshot sparsity, and manual-team staleness are shown, not hidden.</div>
    </div>
  );
}

// ── Import ──
function ImportTab({ spaces, onErr }: { spaces: SpaceCfg[]; onErr: (e: unknown) => void }) {
  const [importSpace, setImportSpace] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const run = async (file: File, dryRun: boolean) => {
    setBusy(true); setSummary(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = ''; const bytes = new Uint8Array(buf); const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const fileBase64 = btoa(binary);
      const data = await sendJson('POST', '/api/kpi/import', { fileBase64, spaceKey: importSpace || undefined, dryRun });
      setSummary(data);
    } catch (e) { onErr(e); } finally { setBusy(false); }
  };
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.text1, marginBottom: 4 }}>Daily KPI Tracker Import</div>
      <div style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>Upload a Daily KPI Tracker workbook. Use <em>Preview</em> first — it parses without writing and lists any unmapped labels.</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={importSpace} onChange={(e) => setImportSpace(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="">Auto (detect sections)</option>
          {spaces.filter(s => !s.isJiraSpace).map(s => <option key={s.spaceKey} value={s.spaceKey}>{s.displayName} ({s.spaceKey})</option>)}
        </select>
        <input type="file" accept=".xlsx,.xls" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) (window as any)._kpiAdminImportFile = f; }} style={{ fontSize: 12, color: C.text2 }} />
        <button disabled={busy} onClick={() => { const f = (window as any)._kpiAdminImportFile as File | undefined; if (f) run(f, true); else onErr(new Error('Choose a file first.')); }} style={btn}>{busy ? 'Working…' : 'Preview (dry-run)'}</button>
        <button disabled={busy} onClick={() => { const f = (window as any)._kpiAdminImportFile as File | undefined; if (f) run(f, false); else onErr(new Error('Choose a file first.')); }} style={{ ...btn, background: 'rgba(94,193,202,0.12)', color: C.teal }}>Import (write)</button>
      </div>
      {summary && (
        <div style={{ fontSize: 12, color: C.text2 }}>
          <strong style={{ color: summary.dryRun ? C.amber : C.green }}>{summary.dryRun ? 'Dry-run' : 'Imported'}</strong>
          {' · '}{summary.sheetsProcessed} sheet(s) · {summary.entriesParsed} parsed{!summary.dryRun && ` · ${summary.entriesSaved} saved`}
          {summary.spacesTouched?.length > 0 && ` · spaces: ${summary.spacesTouched.join(', ')}`}
          {summary.unmapped?.length > 0 && <div style={{ color: C.amber, marginTop: 6 }}>{summary.unmapped.length} unmapped label(s) — not imported</div>}
        </div>
      )}
    </div>
  );
}
