import { useEffect, useState } from 'react';
import { PlaudScanModal } from './PlaudScanModal.js';

/* 1-2-1 Overview — manager dashboard of whole-team 1-2-1 health. Read-only summary;
   the My Team grid and click-through stay the place to act. People → 1-2-1 Overview. */

const C = {
  bg1: '#272C33', bg2: '#2f353d', glass: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)',
  teal: '#5ec1ca', green: '#10b981', amber: '#f59e0b', red: '#ef4444',
  text1: '#e2e8f0', text2: '#94a3b8', text3: '#64748b',
};

interface OverviewAgent {
  agent_name: string; nextDate: string | null; nextStatus: string | null;
  overdue: boolean; dueThisWeek: boolean; awaitingPrep: boolean; prepSubmitted: boolean;
  lastDate: string | null; outstandingActions: number; delivered: number; missed: number; deliveryRate: number | null;
}
interface Overview {
  agents: OverviewAgent[];
  summary: { total: number; scheduled: number; overdue: number; dueThisWeek: number; awaitingPrep: number; neverScheduled: number; deliveryRate: number | null };
}

const d = (s: string | null) => s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';

export function OneToOneOverviewView() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);

  const load = () => {
    setLoading(true);
    fetch('/api/121/overview').then((r) => r.json()).then((j) => { if (j.ok) setData(j.data); }).finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>Loading…</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: C.text3 }}>No data.</div>;

  const sorted = [...data.agents].sort((a, b) => {
    const rank = (x: OverviewAgent) => x.overdue ? 0 : x.awaitingPrep ? 1 : x.dueThisWeek ? 2 : x.nextDate ? 3 : 4;
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999');
  });

  return (
    <div style={{ padding: '4px 4px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text1, margin: 0 }}>1-2-1 Overview</h2>
          <p style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>{data.summary.total} agents · whole-team 1-2-1 health at a glance</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setScanOpen(true)} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.teal}`, background: `${C.teal}18`, color: C.teal, cursor: 'pointer', fontSize: 12, fontWeight: 600 }} title="Scan all of Plaud for 1-2-1 recordings">🎙 Scan Plaud</button>
          <button onClick={load} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: C.glass, color: C.text2, cursor: 'pointer', fontSize: 15 }} title="Refresh">↻</button>
        </div>
      </div>

      {scanOpen && <PlaudScanModal onClose={() => setScanOpen(false)} onAssigned={load} />}

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
        <Tile label="Overdue" value={data.summary.overdue} color={data.summary.overdue > 0 ? C.red : C.text2} />
        <Tile label="Awaiting prep" value={data.summary.awaitingPrep} color={data.summary.awaitingPrep > 0 ? C.amber : C.text2} />
        <Tile label="Due this week" value={data.summary.dueThisWeek} color={C.teal} />
        <Tile label="Scheduled" value={data.summary.scheduled} color={C.text2} />
        <Tile label="Never scheduled" value={data.summary.neverScheduled} color={data.summary.neverScheduled > 0 ? C.amber : C.text2} />
        <Tile label="Action delivery" value={data.summary.deliveryRate === null ? '—' : `${data.summary.deliveryRate}%`} color={ratePctColor(data.summary.deliveryRate)} />
      </div>

      {/* Per-agent table */}
      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1.2fr 0.8fr 1fr', gap: 8, padding: '10px 16px', borderBottom: `1px solid ${C.border}`, fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <div>Agent</div><div>Next 1-2-1</div><div>Last</div><div>Status</div><div>Open actions</div><div>Delivery</div>
        </div>
        {sorted.map((a) => (
          <div key={a.agent_name} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1.2fr 0.8fr 1fr', gap: 8, padding: '11px 16px', borderBottom: `1px solid ${C.border}`, alignItems: 'center', fontSize: 13 }}>
            <div style={{ color: C.text1, fontWeight: 600 }}>{a.agent_name}</div>
            <div style={{ color: a.overdue ? C.red : C.text2, fontWeight: a.overdue ? 700 : 400 }}>{d(a.nextDate)}</div>
            <div style={{ color: C.text3 }}>{d(a.lastDate)}</div>
            <div>{statusChip(a)}</div>
            <div style={{ color: a.outstandingActions > 0 ? C.text1 : C.text3 }}>{a.outstandingActions || '—'}</div>
            <div style={{ color: ratePctColor(a.deliveryRate), fontWeight: 600 }}>
              {a.deliveryRate === null ? '—' : `${a.deliveryRate}%`}
              {(a.delivered + a.missed) > 0 && <span style={{ color: C.text3, fontWeight: 400, fontSize: 11 }}> ({a.delivered}/{a.delivered + a.missed})</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ratePctColor(r: number | null): string {
  if (r === null) return C.text3;
  return r >= 80 ? C.green : r >= 50 ? C.amber : C.red;
}

function statusChip(a: OverviewAgent) {
  let label: string, color: string;
  if (a.overdue) { label = 'Overdue'; color = C.red; }
  else if (a.awaitingPrep) { label = 'Awaiting prep'; color = C.amber; }
  else if (a.prepSubmitted) { label = 'Prep in'; color = C.green; }
  else if (a.dueThisWeek) { label = 'Due this week'; color = C.teal; }
  else if (a.nextDate) { label = 'Scheduled'; color = C.text2; }
  else { label = 'Not scheduled'; color = C.text3; }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color, background: `${color}1f`, border: `1px solid ${color}40`, borderRadius: 6, padding: '2px 8px' }}>{label}</span>
  );
}

function Tile({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}
