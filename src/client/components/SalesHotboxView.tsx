import { useState, useEffect, useCallback } from 'react';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                    */
/* ══════════════════════════════════════════════════════════════════════════ */

interface PipelineDeal {
  id: number;
  salesperson: string;
  lead_gen: string | null;
  company: string;
  mrr: number;
  product: string | null;
  stage: string;
  demo_date: string | null;
  est_close_date: string | null;
  next_chase_date: string | null;
  contact: string | null;
  phone: string | null;
  notes: string | null;
}

interface MonthlySale {
  id: number;
  sale_date: string;
  lead_gen: string | null;
  salesperson: string;
  product: string | null;
  trading_name: string | null;
  limited_company: string | null;
  company_number: string | null;
  email: string | null;
  setup_fee: number;
  licence: number;
  upsell_mrr: number;
  postal: number;
  coms: number;
  trial_mrr: number;
  actual_mrr: number;
  branches: number;
  existing_vs_new: string | null;
  hotbox_ref: number | null;
}

interface SalesTarget {
  id: number;
  salesperson: string;
  month: string;
  target_mrr: number;
}

interface Booking {
  id: number;
  booked_date: string;
  salesperson: string;
  lead_gen: string | null;
  team: string | null;
  product: string | null;
  company: string;
  email: string | null;
  client_type: string | null;
  demo_date: string;
  dm: string | null;
  phone: string | null;
  lead_source: string | null;
  taken_place: number;
}

interface TakenPlace {
  id: number;
  demo_date: string;
  salesperson: string;
  lead_gen: string | null;
  product: string | null;
  company: string;
  email: string | null;
  branches: number;
  dm: string | null;
  est_mrr: number;
  hwc: string | null;
  in_hotbox: string | null;
  client_type: string | null;
  notes: string | null;
  booking_id: number | null;
}

interface RefData {
  salespeople: string[];
  products: string[];
  stages: string[];
  leadSources: string[];
  clientTypes: string[];
}

interface ApiLgKpi {
  person: string;
  month: string;
  days_worked: number;
  calls_kpi: number;
  calls_actual: number;
  booked_kpi: number;
  booked_actual: number;
  tp_kpi: number;
  tp_actual: number;
  sales_count: number;
  mrr_total: number;
}

interface ApiBdmKpi {
  person: string;
  month: string;
  booked_kpi: number;
  booked_actual: number;
  tp_kpi: number;
  tp_actual: number;
  sales_kpi: number;
  sales_actual: number;
  mrr_kpi: number;
  mrr_actual: number;
  target: number;
}

interface LgKpiRow {
  name: string;
  days: number;
  callsKpi: number;
  callsActual: number;
  bookedKpi: number;
  bookedActual: number;
  tpKpi: number;
  tpActual: number;
  sales: number;
  mrr: number;
  convRate: number;
}

interface BdmKpiRow {
  booked: number;
  bookedKpi: number;
  tp: number;
  tpKpi: number;
  tpRate: number;
  sales: number;
  salesKpi: number;
  convRate: number;
  mrr: number;
  mrrKpi: number;
  target: number;
}

type SubTab =
  | 'summary' | 'leadgen' | 'demos' | 'hotbox' | 'monthly' | 'targets'
  | 'rep-booking' | 'rep-sales' | 'rep-kpi' | 'board';

type DemoSubTab = 'bookings' | 'takenplace';
type ReportPeriod = 'month' | 'last' | 'custom';

type BoardSection =
  | 'bp-exec' | 'bp-tva' | 'bp-lg' | 'bp-bym' | 'bp-lp'
  | 'bp-tpj' | 'bp-sb' | 'bp-kym' | 'bp-ymd' | 'bp-snap' | 'bp-bridge';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Constants                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

const STAGE_COLOR: Record<string, string> = {
  'Demo Completed': '#3b82f6',
  'Proposal Submitted - Awaiting Feedback': '#f59e0b',
  'Proposal Submitted - In Discussion': '#8b5cf6',
  'Contract Sent': '#10b981',
};

const STAGE_SHORT: Record<string, string> = {
  'Demo Completed': 'Demo',
  'Proposal Submitted - Awaiting Feedback': 'Awaiting',
  'Proposal Submitted - In Discussion': 'In Disc.',
  'Contract Sent': 'Contract',
};

const STAGES = Object.keys(STAGE_COLOR);

const HWC_COLOR: Record<string, string> = {
  Hot: '#f43f5e',
  Warm: '#f59e0b',
  Cold: '#38bdf8',
};

const BOARD_SECTIONS: { id: BoardSection; label: string }[] = [
  { id: 'bp-exec', label: 'Executive Summary' },
  { id: 'bp-tva', label: 'Target vs Actual' },
  { id: 'bp-lg', label: 'Lead Gen Funnel' },
  { id: 'bp-bym', label: 'BYM / Nurtur' },
  { id: 'bp-lp', label: 'LeadPro' },
  { id: 'bp-tpj', label: 'TPJ Websites' },
  { id: 'bp-sb', label: 'Starberry' },
  { id: 'bp-kym', label: 'KYM' },
  { id: 'bp-ymd', label: 'Yomdel' },
  { id: 'bp-snap', label: 'Brand Snapshot' },
  { id: 'bp-bridge', label: 'Strategic Bridge' },
];

/* ── Convert API KPI data to frontend row format ── */

function apiToLgKpiRow(kpi: ApiLgKpi): LgKpiRow {
  const tpActual = kpi.tp_actual || 0;
  const sales = kpi.sales_count || 0;
  return {
    name: kpi.person,
    days: kpi.days_worked,
    callsKpi: kpi.calls_kpi,
    callsActual: kpi.calls_actual,
    bookedKpi: kpi.booked_kpi,
    bookedActual: kpi.booked_actual,
    tpKpi: kpi.tp_kpi,
    tpActual: tpActual,
    sales,
    mrr: kpi.mrr_total || 0,
    convRate: tpActual > 0 ? sales / tpActual : 0,
  };
}

function apiToBdmKpiData(kpis: ApiBdmKpi[]): Record<string, BdmKpiRow> {
  const result: Record<string, BdmKpiRow> = {};
  for (const k of kpis) {
    const tp = k.tp_actual || 0;
    const booked = k.booked_actual || 0;
    const sales = k.sales_actual || 0;
    result[k.person] = {
      booked,
      bookedKpi: k.booked_kpi,
      tp,
      tpKpi: k.tp_kpi,
      tpRate: booked > 0 ? tp / booked : 0,
      sales,
      salesKpi: k.sales_kpi,
      convRate: tp > 0 ? sales / tp : 0,
      mrr: k.mrr_actual || 0,
      mrrKpi: k.mrr_kpi,
      target: k.target || 0,
    };
  }
  return result;
}

function buildLgKpiRows(apiKpis: ApiLgKpi[], month: string | null): { current: LgKpiRow[]; history: LgKpiRow[] } {
  const currentMonth = month || new Date().toISOString().slice(0, 7);
  // Current month: filter to current month
  const currentKpis = apiKpis.filter(k => k.month === currentMonth);
  const current = currentKpis.map(apiToLgKpiRow);

  // History: aggregate all months per person
  const personAgg: Record<string, { days: number; callsKpi: number; callsActual: number; bookedKpi: number; bookedActual: number; tpKpi: number; tpActual: number; sales: number; mrr: number }> = {};
  for (const k of apiKpis) {
    if (!personAgg[k.person]) personAgg[k.person] = { days: 0, callsKpi: 0, callsActual: 0, bookedKpi: 0, bookedActual: 0, tpKpi: 0, tpActual: 0, sales: 0, mrr: 0 };
    const p = personAgg[k.person];
    p.days += k.days_worked;
    p.callsKpi += k.calls_kpi;
    p.callsActual += k.calls_actual;
    p.bookedKpi += k.booked_kpi;
    p.bookedActual += k.booked_actual;
    p.tpKpi += k.tp_kpi;
    p.tpActual += k.tp_actual || 0;
    p.sales += k.sales_count || 0;
    p.mrr += k.mrr_total || 0;
  }
  const history = Object.entries(personAgg).map(([name, p]) => ({
    name,
    days: Math.round(p.days),
    callsKpi: Math.round(p.callsKpi),
    callsActual: Math.round(p.callsActual),
    bookedKpi: Math.round(p.bookedKpi),
    bookedActual: Math.round(p.bookedActual),
    tpKpi: Math.round(p.tpKpi),
    tpActual: Math.round(p.tpActual),
    sales: p.sales,
    mrr: p.mrr,
    convRate: p.tpActual > 0 ? p.sales / p.tpActual : 0,
  }));

  return { current, history };
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Helpers                                                                  */
/* ══════════════════════════════════════════════════════════════════════════ */

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtS = (n: number) =>
  `£${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

const fmtN = (n: number) =>
  Number(n).toLocaleString('en-GB');

const pct = (a: number, b: number) =>
  b > 0 ? ((a / b) * 100).toFixed(1) + '%' : '—';

const pctColor = (ratio: number) =>
  ratio >= 1 ? '#10b981' : ratio >= 0.7 ? '#f59e0b' : '#f43f5e';

const today = new Date().toISOString().split('T')[0];

const TH = 'px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-neutral-500 font-bold bg-[#1e2228] border-b border-[#2f353d]';
const THR = `${TH} text-right`;
const THC = `${TH} text-center`;
const TD = 'px-3 py-2.5 text-[13px] text-neutral-300 border-b border-[#2f353d]';
const TDR = `${TD} text-right`;

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Shared Components                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

/* ── KPI Card ── */

function KpiCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-5 py-4 flex-1 min-w-[150px]">
      <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mb-2">{label}</div>
      <div className="text-2xl font-extrabold tracking-tight" style={{ color: color || '#e2e8f0' }}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-600 mt-1">{sub}</div>}
    </div>
  );
}

/* ── Stage Chip ── */

function StageChip({ stage }: { stage: string }) {
  const color = STAGE_COLOR[stage] || '#64748b';
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {STAGE_SHORT[stage] || stage}
    </span>
  );
}

/* ── HWC Chip (Hot / Warm / Cold) ── */

function HwcChip({ hwc }: { hwc: string | null }) {
  if (!hwc) return <span className="text-neutral-600">—</span>;
  const color = HWC_COLOR[hwc] || '#64748b';
  return (
    <span
      className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
      style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
    >
      {hwc}
    </span>
  );
}

/* ── Demo Data Badge ── */

function DemoBadge() {
  return (
    <span className="ml-2 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-[#38bdf815] text-[#38bdf8] border border-[#38bdf830]">
      Demo Data
    </span>
  );
}

/* ── Progress Bar ── */

function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pctVal = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barColor = color || (pctVal >= 100 ? '#10b981' : '#5ec1ca');
  return (
    <div className="bg-[#1e2228] rounded-md h-2 overflow-hidden">
      <div
        className="h-full rounded-md transition-all duration-500"
        style={{ width: `${pctVal}%`, background: barColor }}
      />
    </div>
  );
}

/* ── Type Badge (Net New / Nurtur Client) ── */

function TypeBadge({ value }: { value: string | null }) {
  const isNew = (value || '').includes('Net New');
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
      background: isNew ? '#10b98122' : '#f59e0b22',
      color: isNew ? '#10b981' : '#f59e0b',
    }}>{value || '—'}</span>
  );
}

/* ── Pill Button ── */

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
        active
          ? 'border-[#5ec1ca] bg-[#5ec1ca]/15 text-[#5ec1ca]'
          : 'border-[#3a424d] bg-[#272C33] text-neutral-500 hover:border-[#5ec1ca]/50 hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );
}

/* ── Period Selector (for reporting tabs) ── */

function PeriodSelector({
  period, onPeriod, customStart, customEnd, onCustomStart, onCustomEnd, onApply,
}: {
  period: ReportPeriod;
  onPeriod: (p: ReportPeriod) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (v: string) => void;
  onCustomEnd: (v: string) => void;
  onApply: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {(['month', 'last', 'custom'] as ReportPeriod[]).map(p => (
        <button
          key={p}
          onClick={() => onPeriod(p)}
          className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
            period === p
              ? 'border-[#5ec1ca] bg-[#5ec1ca]/15 text-[#5ec1ca]'
              : 'border-[#3a424d] bg-[#272C33] text-neutral-500 hover:border-[#5ec1ca]/50'
          }`}
        >
          {p === 'month' ? 'This Month' : p === 'last' ? 'Last Month' : 'Custom'}
        </button>
      ))}
      {period === 'custom' && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={customStart} onChange={e => onCustomStart(e.target.value)}
            className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-200 outline-none focus:border-[#5ec1ca]" />
          <span className="text-neutral-600 text-[11px]">to</span>
          <input type="date" value={customEnd} onChange={e => onCustomEnd(e.target.value)}
            className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-2.5 py-1.5 text-[11px] text-neutral-200 outline-none focus:border-[#5ec1ca]" />
          <button onClick={onApply}
            className="px-3 py-1.5 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[11px] hover:bg-[#4db0b9] transition-colors">
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Card wrapper ── */

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] overflow-hidden ${className}`}>
      {title && (
        <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider px-5 py-3 border-b border-[#2f353d]">
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

/* ── Section Title ── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-extrabold text-neutral-500 uppercase tracking-widest mb-3">
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Summary Tab                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

function SummaryTab({
  deals, bookings, takenPlaceList, sales, lgKpiCurrent,
}: {
  deals: PipelineDeal[];
  bookings: Booking[];
  takenPlaceList: TakenPlace[];
  sales: MonthlySale[];
  lgKpiCurrent: LgKpiRow[];
}) {
  const totalCalls = lgKpiCurrent.reduce((s, r) => s + r.callsActual, 0);
  const totalCallsKpi = lgKpiCurrent.reduce((s, r) => s + r.callsKpi, 0);
  const totalBooked = bookings.length || lgKpiCurrent.reduce((s, r) => s + r.bookedActual, 0);
  const totalTP = takenPlaceList.length || lgKpiCurrent.reduce((s, r) => s + r.tpActual, 0);
  const totalPipeline = deals.reduce((s, d) => s + d.mrr, 0);
  const contractsOut = deals.filter(d => d.stage === 'Contract Sent').reduce((s, d) => s + d.mrr, 0);
  const totalSales = sales.length;

  const bookRate = totalCalls > 0 ? ((totalBooked / totalCalls) * 100).toFixed(1) : '0';
  const tpRate = totalBooked > 0 ? ((totalTP / totalBooked) * 100).toFixed(1) : '0';
  const salesRate = totalTP > 0 ? ((totalSales / totalTP) * 100).toFixed(1) : '0';

  // By person
  const byPerson: Record<string, Record<string, number>> = {};
  for (const d of deals) {
    if (!byPerson[d.salesperson]) byPerson[d.salesperson] = {};
    byPerson[d.salesperson][d.stage] = (byPerson[d.salesperson][d.stage] || 0) + d.mrr;
  }
  const personRows = Object.entries(byPerson)
    .map(([name, stages]) => ({ name, stages, total: Object.values(stages).reduce((s, v) => s + v, 0) }))
    .sort((a, b) => b.total - a.total);

  // By product
  const byProduct: Record<string, number> = {};
  for (const d of deals) { byProduct[d.product || 'Other'] = (byProduct[d.product || 'Other'] || 0) + d.mrr; }
  const productRows = Object.entries(byProduct).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* Top KPI row */}
      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard label="Calls Made (MTD)" value={fmtN(totalCalls)} color="#94a3b8" sub={`vs ${fmtN(totalCallsKpi)} KPI`} />
        <KpiCard label="Demos Booked" value={String(totalBooked)} color="#38bdf8" sub={`${bookRate}% booking rate`} />
        <KpiCard label="Taken Place" value={String(totalTP)} color="#8b5cf6" sub={`${tpRate}% TP rate`} />
        <KpiCard label="Pipeline (Hotbox)" value={fmtS(totalPipeline)} color="#f59e0b" sub={`${deals.length} active deals`} />
        <KpiCard label="Contracts Out" value={fmtS(contractsOut)} color="#10b981" sub="Ready to close" />
      </div>

      {/* Conversion Funnel */}
      <Card title={`Conversion Funnel — ${new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })} (MTD)`} className="mb-6">
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            {[
              { label: 'Calls', val: fmtN(totalCalls), color: '#94a3b8', rate: null },
              { label: 'Booked', val: String(totalBooked), color: '#38bdf8', rate: `${bookRate}%` },
              { label: 'Taken Place', val: String(totalTP), color: '#8b5cf6', rate: `${tpRate}%` },
              { label: 'In Hotbox', val: String(deals.length), color: '#f59e0b', rate: totalTP > 0 ? `${((deals.length / totalTP) * 100).toFixed(1)}%` : '—' },
              { label: 'Sales (MTD)', val: String(totalSales), color: '#10b981', rate: `${salesRate}%` },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex items-center flex-1">
                <div className="text-center flex-1">
                  <div className="text-xl font-extrabold tracking-tight" style={{ color: step.color }}>{step.val}</div>
                  <div className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider mt-1">{step.label}</div>
                  {step.rate && <div className="text-[11px] font-bold mt-0.5" style={{ color: step.color }}>{step.rate}</div>}
                </div>
                {i < arr.length - 1 && <span className="text-neutral-700 text-lg px-1 flex-shrink-0">›</span>}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* By person + by product */}
      <div className="flex gap-5 flex-wrap">
        <Card title="Pipeline by Salesperson" className="flex-[2] min-w-[300px]">
          <table className="w-full border-collapse">
            <thead><tr>
              <th className={TH}>Person</th>
              {STAGES.map(s => <th key={s} className={THR}>{STAGE_SHORT[s]}</th>)}
              <th className={THR}>Total</th>
            </tr></thead>
            <tbody>
              {personRows.map(r => (
                <tr key={r.name} className="hover:bg-[#2f353d]/50">
                  <td className={`${TD} font-semibold text-neutral-100`}>{r.name}</td>
                  {STAGES.map(s => (
                    <td key={s} className={TDR} style={{ color: STAGE_COLOR[s] }}>
                      {r.stages[s] ? fmtS(r.stages[s]) : '—'}
                    </td>
                  ))}
                  <td className={`${TDR} font-bold text-[#5ec1ca]`}>{fmtS(r.total)}</td>
                </tr>
              ))}
              {personRows.length === 0 && (
                <tr><td colSpan={STAGES.length + 2} className="text-center py-8 text-neutral-600">No deals in pipeline</td></tr>
              )}
            </tbody>
          </table>
        </Card>

        <div className="flex-1 min-w-[240px] border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] p-5">
          <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-4">Pipeline by Product</div>
          {productRows.map(([prod, val]) => (
            <div key={prod} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-[12px] text-neutral-400">{prod}</span>
                <span className="text-[12px] font-bold text-neutral-200">{fmtS(val)}</span>
              </div>
              <div className="bg-[#1e2228] rounded h-1.5 overflow-hidden">
                <div className="h-full rounded bg-[#5ec1ca] transition-all duration-500"
                  style={{ width: `${totalPipeline > 0 ? Math.min(100, (val / totalPipeline) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
          {productRows.length === 0 && <div className="text-neutral-600 text-[12px]">No products in pipeline</div>}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Lead Gen KPIs Tab                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

function LeadGenTab({ lgKpiCurrent, lgKpiHistory, hasApiData }: {
  lgKpiCurrent: LgKpiRow[];
  lgKpiHistory: LgKpiRow[];
  hasApiData: boolean;
}) {
  const current = lgKpiCurrent;
  const history = lgKpiHistory;

  const totCalls = current.reduce((s, r) => s + r.callsActual, 0);
  const totCallsKpi = current.reduce((s, r) => s + r.callsKpi, 0);
  const totBooked = current.reduce((s, r) => s + r.bookedActual, 0);
  const totBookedKpi = current.reduce((s, r) => s + r.bookedKpi, 0);
  const totTP = current.reduce((s, r) => s + r.tpActual, 0);
  const totSales = current.reduce((s, r) => s + r.sales, 0);
  const totMrr = current.reduce((s, r) => s + r.mrr, 0);

  return (
    <div>
      {/* Top KPIs */}
      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard label="Total Calls (MTD)" value={fmtN(totCalls)} color="#94a3b8" sub={`vs ${fmtN(totCallsKpi)} KPI — ${pct(totCalls, totCallsKpi)}`} />
        <KpiCard label="Total Booked (MTD)" value={String(totBooked)} color="#38bdf8" sub={`vs ${totBookedKpi.toFixed(0)} KPI — ${pct(totBooked, totBookedKpi)}`} />
        <KpiCard label="Total Taken Place" value={String(totTP)} color="#8b5cf6" sub={`${pct(totTP, totBooked)} take-up rate`} />
        <KpiCard label="Sales from LG" value={String(totSales)} color="#10b981" sub={totTP > 0 ? `${((totSales / totTP) * 100).toFixed(1)}% conversion` : '—'} />
        <KpiCard label="MRR from LG" value={fmtS(totMrr)} color="#f59e0b" sub="Lead gen attributed" />
      </div>

      {/* Person cards */}
      <div className="flex items-center mb-3">
        <SectionTitle>Current Month — Lead Gen Performance</SectionTitle>
        {!hasApiData && <DemoBadge />}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4 mb-6">
        {current.map(p => {
          const callsPct = p.callsKpi > 0 ? p.callsActual / p.callsKpi : 0;
          const bookedPct = p.bookedKpi > 0 ? p.bookedActual / p.bookedKpi : 0;
          const tpPct = p.tpKpi > 0 ? p.tpActual / p.tpKpi : 0;
          return (
            <div key={p.name} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[14px] font-extrabold text-neutral-100">{p.name}</span>
                <span className="text-[11px] text-neutral-600">{p.days} days</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: 'Calls', val: fmtN(p.callsActual), kpi: `KPI: ${fmtN(p.callsKpi)}`, color: pctColor(callsPct) },
                  { label: 'Booked', val: String(p.bookedActual), kpi: `KPI: ${p.bookedKpi}`, color: pctColor(bookedPct) },
                  { label: 'Taken Place', val: String(p.tpActual), kpi: `KPI: ${p.tpKpi}`, color: pctColor(tpPct) },
                  { label: 'Sales / MRR', val: `${p.sales} / ${fmtS(p.mrr)}`, kpi: p.tpActual > 0 ? `${(p.convRate * 100).toFixed(1)}% conv` : '—', color: '#94a3b8' },
                ].map(m => (
                  <div key={m.label} className="bg-[#1e2228] rounded-lg px-3 py-2">
                    <div className="text-[9px] text-neutral-600 font-bold uppercase tracking-wider">{m.label}</div>
                    <div className="text-base font-extrabold tracking-tight mt-0.5" style={{ color: m.color }}>{m.val}</div>
                    <div className="text-[10px] text-neutral-600 mt-0.5">{m.kpi}</div>
                  </div>
                ))}
              </div>
              {/* Mini progress bars */}
              <div className="space-y-2">
                {[
                  { label: 'Calls', pct: callsPct },
                  { label: 'Booked', pct: bookedPct },
                  { label: 'TP', pct: tpPct },
                ].map(b => (
                  <div key={b.label}>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-[9px] text-neutral-600">{b.label}</span>
                      <span className="text-[10px] font-bold" style={{ color: pctColor(b.pct) }}>{(b.pct * 100).toFixed(0)}%</span>
                    </div>
                    <ProgressBar value={b.pct * 100} max={100} color={pctColor(b.pct)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* History table */}
      <Card title="All-Time Historical — Lead Gen KPIs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              {['Person', 'Days Worked', 'Calls Made', 'Calls KPI%', 'Demos Booked', 'Booking KPI%', 'Booking Rate',
                'Taken Place', 'TP KPI%', 'TP Rate', 'Sales', 'Conv. Rate', 'Total MRR', 'Avg MRR'].map(h => (
                <th key={h} className={h === 'Person' ? TH : THR}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {history.map(r => {
                const callsPctH = r.callsKpi > 0 ? (r.callsActual / r.callsKpi) : 0;
                const bookedPctH = r.bookedKpi > 0 ? (r.bookedActual / r.bookedKpi) : 0;
                const tpPctH = r.tpKpi > 0 ? (r.tpActual / r.tpKpi) : 0;
                const bookRate = r.callsActual > 0 ? ((r.bookedActual / r.callsActual) * 100).toFixed(1) + '%' : '—';
                const tpRateH = r.bookedActual > 0 ? ((r.tpActual / r.bookedActual) * 100).toFixed(1) + '%' : '—';
                const avgMrr = r.sales > 0 ? r.mrr / r.sales : 0;
                return (
                  <tr key={r.name} className="hover:bg-[#2f353d]/50">
                    <td className={`${TD} font-semibold text-neutral-100`}>{r.name}</td>
                    <td className={TDR}>{r.days}</td>
                    <td className={TDR}>{fmtN(r.callsActual)}</td>
                    <td className={TDR} style={{ color: pctColor(callsPctH) }}>{(callsPctH * 100).toFixed(1)}%</td>
                    <td className={TDR}>{r.bookedActual}</td>
                    <td className={TDR} style={{ color: pctColor(bookedPctH) }}>{(bookedPctH * 100).toFixed(1)}%</td>
                    <td className={TDR}>{bookRate}</td>
                    <td className={TDR}>{r.tpActual}</td>
                    <td className={TDR} style={{ color: pctColor(tpPctH) }}>{(tpPctH * 100).toFixed(1)}%</td>
                    <td className={TDR}>{tpRateH}</td>
                    <td className={TDR}>{r.sales}</td>
                    <td className={TDR}>{(r.convRate * 100).toFixed(1)}%</td>
                    <td className={`${TDR} text-[#5ec1ca] font-bold`}>{fmtS(r.mrr)}</td>
                    <td className={TDR}>{r.sales > 0 ? fmtS(avgMrr) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Demo Tracker Tab                                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

function DemoTrackerTab({
  bookings, takenPlaceList,
  onAddBooking, onMarkTP, onDeleteBooking,
  onAddTP, onDeleteTP,
}: {
  bookings: Booking[];
  takenPlaceList: TakenPlace[];
  onAddBooking: () => void;
  onMarkTP: (booking: Booking) => void;
  onDeleteBooking: (id: number) => void;
  onAddTP: () => void;
  onDeleteTP: (id: number) => void;
}) {
  const [demoSub, setDemoSub] = useState<DemoSubTab>('bookings');

  // Taken place summary KPIs
  const hotCount = takenPlaceList.filter(t => t.hwc === 'Hot').length;
  const warmCount = takenPlaceList.filter(t => t.hwc === 'Warm').length;
  const coldCount = takenPlaceList.filter(t => t.hwc === 'Cold').length;
  const hotboxCount = takenPlaceList.filter(t => t.in_hotbox === 'Yes').length;
  const estMrrTotal = takenPlaceList.reduce((s, t) => s + (t.est_mrr || 0), 0);
  const hotMrr = takenPlaceList.filter(t => t.hwc === 'Hot').reduce((s, t) => s + (t.est_mrr || 0), 0);
  const warmMrr = takenPlaceList.filter(t => t.hwc === 'Warm').reduce((s, t) => s + (t.est_mrr || 0), 0);
  const coldMrr = takenPlaceList.filter(t => t.hwc === 'Cold').reduce((s, t) => s + (t.est_mrr || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div className="text-base font-extrabold text-neutral-100">Demo Tracker</div>
          <div className="text-[11px] text-neutral-600 mt-0.5">Log bookings → mark as taken place → add to hotbox</div>
        </div>
        <button onClick={onAddBooking}
          className="px-4 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[12px] hover:bg-[#4db0b9] transition-colors">
          + Log Booking
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-[#3a424d] mb-5">
        {[
          { id: 'bookings' as DemoSubTab, label: 'Upcoming Bookings' },
          { id: 'takenplace' as DemoSubTab, label: 'Taken Place' },
        ].map(t => (
          <button key={t.id} onClick={() => setDemoSub(t.id)}
            className={`px-4 py-2 text-[11px] font-bold transition-colors border-b-2 -mb-[1px] ${
              demoSub === t.id
                ? 'border-[#5ec1ca] text-[#5ec1ca]'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Bookings sub-tab */}
      {demoSub === 'bookings' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>
                {['Booked', 'Salesperson', 'Lead Gen', 'Team', 'Product', 'Company', 'Email', 'Client Type', 'Demo Date', 'Days Away', 'DM?', 'Status', ''].map(h => (
                  <th key={h} className={TH}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {bookings.length === 0 && (
                  <tr><td colSpan={13} className="text-center py-10 text-neutral-600">No bookings recorded</td></tr>
                )}
                {bookings.map(b => {
                  const daysAway = b.demo_date ? Math.ceil((new Date(b.demo_date).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <tr key={b.id} className="hover:bg-[#2f353d]/50">
                      <td className={`${TD} text-neutral-500`}>{b.booked_date}</td>
                      <td className={`${TD} font-semibold text-neutral-100`}>{b.salesperson}</td>
                      <td className={`${TD} text-neutral-500`}>{b.lead_gen || '—'}</td>
                      <td className={`${TD} text-neutral-500`}>{b.team || '—'}</td>
                      <td className={TD}><span className="bg-[#5ec1ca22] text-[#5ec1ca] px-2 py-0.5 rounded text-[11px]">{b.product}</span></td>
                      <td className={`${TD} font-semibold text-neutral-200`}>{b.company}</td>
                      <td className={`${TD} text-neutral-600 text-[12px]`}>{b.email || '—'}</td>
                      <td className={TD}>{b.client_type ? <TypeBadge value={b.client_type} /> : '—'}</td>
                      <td className={`${TD} text-neutral-300`}>{b.demo_date}</td>
                      <td className={TD}>
                        {daysAway !== null && (
                          <span className={`text-[11px] font-bold ${daysAway < 0 ? 'text-red-400' : daysAway <= 2 ? 'text-amber-400' : 'text-neutral-500'}`}>
                            {daysAway < 0 ? `${Math.abs(daysAway)}d ago` : daysAway === 0 ? 'Today' : `${daysAway}d`}
                          </span>
                        )}
                      </td>
                      <td className={TD}>{b.dm === 'Yes' ? <span className="text-green-400 text-[11px] font-bold">✓</span> : <span className="text-neutral-600">—</span>}</td>
                      <td className={TD}>
                        {b.taken_place ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[#10b98122] text-[#10b981]">Done</span>
                        ) : (
                          <button onClick={() => onMarkTP(b)}
                            className="text-[10px] px-2.5 py-1 rounded font-bold bg-[#10b98122] text-[#10b981] border border-[#10b98130] hover:bg-[#10b98133]">
                            Mark TP
                          </button>
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <button onClick={() => onDeleteBooking(b.id)}
                          className="px-2 py-1 text-[11px] border border-red-900/30 rounded text-red-500 hover:text-red-400">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Taken Place sub-tab */}
      {demoSub === 'takenplace' && (
        <div>
          <div className="flex gap-4 flex-wrap mb-5">
            <KpiCard label="Hot 🔥" value={String(hotCount)} color="#f43f5e" sub={hotMrr > 0 ? fmtS(hotMrr) : '—'} />
            <KpiCard label="Warm 🌤" value={String(warmCount)} color="#f59e0b" sub={warmMrr > 0 ? fmtS(warmMrr) : '—'} />
            <KpiCard label="Cold 🧊" value={String(coldCount)} color="#38bdf8" sub={coldMrr > 0 ? fmtS(coldMrr) : '—'} />
            <KpiCard label="Added to Hotbox" value={String(hotboxCount)} color="#10b981" />
            <KpiCard label="Est. Pipeline MRR" value={fmtS(estMrrTotal)} color="#8b5cf6" />
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr>
                  {['Demo Date', 'Salesperson', 'Lead Gen', 'Product', 'Company', 'Branches', 'DM?', 'Est. MRR', 'Hot/Warm/Cold', 'In Hotbox?', 'Notes', ''].map(h => (
                    <th key={h} className={TH}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {takenPlaceList.length === 0 && (
                    <tr><td colSpan={12} className="text-center py-10 text-neutral-600">No taken place demos recorded</td></tr>
                  )}
                  {takenPlaceList.map(t => (
                    <tr key={t.id} className="hover:bg-[#2f353d]/50">
                      <td className={`${TD} text-neutral-500`}>{t.demo_date}</td>
                      <td className={`${TD} font-semibold text-neutral-100`}>{t.salesperson}</td>
                      <td className={`${TD} text-neutral-500`}>{t.lead_gen || '—'}</td>
                      <td className={TD}><span className="bg-[#5ec1ca22] text-[#5ec1ca] px-2 py-0.5 rounded text-[11px]">{t.product}</span></td>
                      <td className={`${TD} font-semibold text-neutral-200`}>{t.company}</td>
                      <td className={`${TD} text-center`}>{t.branches}</td>
                      <td className={TD}>{t.dm === 'Yes' ? <span className="text-green-400 text-[11px] font-bold">✓</span> : <span className="text-neutral-600">—</span>}</td>
                      <td className={`${TD} text-[#8b5cf6] font-bold`}>{fmt(t.est_mrr)}</td>
                      <td className={TD}><HwcChip hwc={t.hwc} /></td>
                      <td className={TD}>
                        {t.in_hotbox === 'Yes' ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-[#10b98122] text-[#10b981]">Yes</span>
                        ) : (
                          <span className="text-neutral-600">No</span>
                        )}
                      </td>
                      <td className={`${TD} text-neutral-500 text-[12px] max-w-[200px] truncate`}>{t.notes || '—'}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <button onClick={() => onDeleteTP(t.id)}
                          className="px-2 py-1 text-[11px] border border-red-900/30 rounded text-red-500 hover:text-red-400">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Hotbox Tab                                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

function HotboxTab({
  deals, refData, onAdd, onEdit, onDelete,
}: {
  deals: PipelineDeal[];
  refData: RefData;
  onAdd: () => void;
  onEdit: (deal: PipelineDeal) => void;
  onDelete: (id: number) => void;
}) {
  const [activePerson, setActivePerson] = useState('All');
  const salespeople = [...new Set(deals.map(d => d.salesperson))].sort();
  const filtered = activePerson === 'All' ? deals : deals.filter(d => d.salesperson === activePerson);

  return (
    <div>
      <div className="flex gap-2 flex-wrap mb-5 items-center">
        {['All', ...salespeople].map(p => (
          <Pill key={p} label={p} active={activePerson === p} onClick={() => setActivePerson(p)} />
        ))}
        <button onClick={onAdd}
          className="ml-auto px-4 py-1.5 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[12px] hover:bg-[#4db0b9] transition-colors">
          + Add Deal
        </button>
      </div>

      {/* Stage summary cards */}
      <div className="flex gap-3 mb-5 flex-wrap">
        {STAGES.map(s => {
          const stageDeals = filtered.filter(d => d.stage === s);
          const stageTotal = stageDeals.reduce((a, b) => a + b.mrr, 0);
          const color = STAGE_COLOR[s];
          return (
            <div key={s} className="flex-1 min-w-[140px] rounded-xl px-4 py-3 border" style={{ borderColor: `${color}33`, background: '#272C33' }}>
              <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color }}>{s}</div>
              <div className="text-xl font-extrabold text-neutral-100">{fmtS(stageTotal)}</div>
              <div className="text-[11px] text-neutral-600">{stageDeals.length} deal{stageDeals.length !== 1 ? 's' : ''}</div>
            </div>
          );
        })}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              {['Demo Date', 'Lead Gen', 'Company', 'MRR', 'Product', 'Stage', 'Est. Close', 'Next Chase', 'Contact', ''].map(h => (
                <th key={h} className={TH}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-neutral-600">No deals in pipeline</td></tr>
              )}
              {filtered.map(d => {
                const overdue = d.next_chase_date && d.next_chase_date < today;
                return (
                  <tr key={d.id} className="hover:bg-[#2f353d]/50">
                    <td className={`${TD} text-neutral-500`}>{d.demo_date || '—'}</td>
                    <td className={`${TD} text-neutral-600`}>{d.lead_gen || '—'}</td>
                    <td className={`${TD} font-semibold text-neutral-100`}>{d.company}</td>
                    <td className={`${TD} text-[#5ec1ca] font-bold`}>{fmt(d.mrr)}</td>
                    <td className={`${TD} text-neutral-500`}>{d.product || '—'}</td>
                    <td className={TD}><StageChip stage={d.stage} /></td>
                    <td className={`${TD} text-neutral-600`}>{d.est_close_date || '—'}</td>
                    <td className={TD}>
                      <span className={overdue ? 'text-red-400 font-bold' : 'text-neutral-600'}>
                        {d.next_chase_date || '—'}{overdue ? ' ⚠' : ''}
                      </span>
                    </td>
                    <td className={`${TD} text-neutral-500`}>{d.contact || '—'}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <button onClick={() => onEdit(d)} className="px-2 py-1 text-[11px] border border-[#3a424d] rounded text-neutral-500 hover:text-[#5ec1ca] hover:border-[#5ec1ca] mr-1">Edit</button>
                      <button onClick={() => onDelete(d.id)} className="px-2 py-1 text-[11px] border border-red-900/30 rounded text-red-500 hover:text-red-400">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Monthly Sales Tab                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

function MonthlyTab({ sales, onAdd, onDelete }: { sales: MonthlySale[]; onAdd: () => void; onDelete: (id: number) => void }) {
  const tMrr = sales.reduce((s, r) => s + (r.actual_mrr || 0), 0);
  const tSetup = sales.reduce((s, r) => s + (r.setup_fee || 0), 0);
  const tLicence = sales.reduce((s, r) => s + (r.licence || 0), 0);
  const tComs = sales.reduce((s, r) => s + (r.coms || 0), 0);
  const tPostal = sales.reduce((s, r) => s + (r.postal || 0), 0);

  return (
    <div>
      <div className="flex gap-4 flex-wrap mb-6 items-center">
        <KpiCard label="Total MRR" value={fmtS(tMrr)} color="#5ec1ca" sub={`${sales.length} contracts`} />
        <KpiCard label="Total Setup" value={fmtS(tSetup)} color="#f59e0b" />
        <KpiCard label="Total Licence" value={fmtS(tLicence)} color="#7c3aed" />
        <KpiCard label="Total Coms" value={fmtS(tComs)} color="#10b981" />
        <button onClick={onAdd}
          className="px-4 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[12px] hover:bg-[#4db0b9] transition-colors self-center">
          + Log Sale
        </button>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr>
              {['Date', 'Lead Gen', 'Salesperson', 'Product', 'Trading Name', 'Email', 'Setup', 'Licence', 'Postal', 'Coms', 'Trial', 'MRR', 'Type', ''].map(h => (
                <th key={h} className={TH}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sales.length === 0 && (
                <tr><td colSpan={14} className="text-center py-10 text-neutral-600">No sales recorded this month</td></tr>
              )}
              {sales.map(s => (
                <tr key={s.id} className="hover:bg-[#2f353d]/50">
                  <td className={`${TD} text-neutral-600`}>{s.sale_date}</td>
                  <td className={`${TD} text-neutral-600`}>{s.lead_gen || '—'}</td>
                  <td className={`${TD} font-semibold text-neutral-100`}>{s.salesperson}</td>
                  <td className={TD}><span className="bg-[#5ec1ca22] text-[#5ec1ca] px-2 py-0.5 rounded text-[11px]">{s.product}</span></td>
                  <td className={`${TD} text-neutral-400`}>{s.trading_name || '—'}</td>
                  <td className={`${TD} text-neutral-600 text-[12px]`}>{s.email || '—'}</td>
                  <td className={TDR} style={{ color: '#f59e0b' }}>{s.setup_fee > 0 ? fmt(s.setup_fee) : '—'}</td>
                  <td className={TDR} style={{ color: '#8b5cf6' }}>{fmt(s.licence)}</td>
                  <td className={`${TDR} text-neutral-600`}>{s.postal > 0 ? fmt(s.postal) : '—'}</td>
                  <td className={TDR} style={{ color: '#10b981' }}>{s.coms > 0 ? fmt(s.coms) : '—'}</td>
                  <td className={`${TDR} text-neutral-600`}>{s.trial_mrr > 0 ? fmt(s.trial_mrr) : '—'}</td>
                  <td className={`${TDR} text-[#5ec1ca] font-bold`}>{fmt(s.actual_mrr)}</td>
                  <td className={TD}><TypeBadge value={s.existing_vs_new} /></td>
                  <td className={TD}>
                    <button onClick={() => onDelete(s.id)} className="px-2 py-1 text-[11px] border border-red-900/30 rounded text-red-500 hover:text-red-400">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {sales.length > 0 && (
              <tfoot>
                <tr className="bg-[#1e2228] border-t-2 border-[#2f353d]">
                  <td colSpan={6} className={`${TD} font-bold text-neutral-600`}>TOTALS</td>
                  <td className={`${TDR} font-bold`} style={{ color: '#f59e0b' }}>{fmt(tSetup)}</td>
                  <td className={`${TDR} font-bold`} style={{ color: '#8b5cf6' }}>{fmt(tLicence)}</td>
                  <td className={`${TDR} font-bold text-neutral-600`}>{fmt(tPostal)}</td>
                  <td className={`${TDR} font-bold`} style={{ color: '#10b981' }}>{fmt(tComs)}</td>
                  <td className={TDR} />
                  <td className={`${TDR} font-bold text-[#5ec1ca] text-[14px]`}>{fmt(tMrr)}</td>
                  <td colSpan={2} className={TD} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  BDM Targets Tab                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

function TargetsTab({ targets, sales, bdmKpiData }: { targets: SalesTarget[]; sales: MonthlySale[]; bdmKpiData: Record<string, BdmKpiRow> }) {
  const closedByPerson: Record<string, { setup: number; licence: number; coms: number; total: number }> = {};
  for (const s of sales) {
    if (!closedByPerson[s.salesperson]) closedByPerson[s.salesperson] = { setup: 0, licence: 0, coms: 0, total: 0 };
    closedByPerson[s.salesperson].setup += s.setup_fee || 0;
    closedByPerson[s.salesperson].licence += s.licence || 0;
    closedByPerson[s.salesperson].coms += s.coms || 0;
    closedByPerson[s.salesperson].total += s.actual_mrr || 0;
  }

  const totalClosed = Object.values(closedByPerson).reduce((s, c) => s + c.total, 0);
  const totalTarget = targets.reduce((s, t) => s + t.target_mrr, 0);
  const teamRate = totalTarget > 0 ? Math.round((totalClosed / totalTarget) * 100) : 0;

  // BDM demo KPI data
  const bdmEntries = Object.entries(bdmKpiData);
  const avgConv = bdmEntries.length > 0
    ? bdmEntries.reduce((s, [, v]) => s + v.convRate, 0) / bdmEntries.length
    : 0;

  return (
    <div>
      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard label="Total MRR Closed" value={fmtS(totalClosed)} color="#5ec1ca"
          sub={new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })} />
        <KpiCard label="Combined Target" value={fmtS(totalTarget)} />
        <KpiCard label="Team Hit Rate" value={`${teamRate}%`} color={teamRate >= 100 ? '#10b981' : '#f59e0b'} />
        <KpiCard label="Avg Conv. Rate" value={`${(avgConv * 100).toFixed(1)}%`} color="#8b5cf6" sub="Demos → Sales" />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {targets.map(t => {
          const closed = closedByPerson[t.salesperson] || { setup: 0, licence: 0, coms: 0, total: 0 };
          const pctVal = t.target_mrr > 0 ? Math.min(100, (closed.total / t.target_mrr) * 100) : 0;
          const hit = pctVal >= 100;
          const bdm = bdmKpiData[t.salesperson];

          return (
            <div key={t.salesperson} className={`border rounded-xl p-5 bg-[#272C33] ${hit ? 'border-green-800/40' : 'border-[#3a424d]'}`}>
              <div className="flex justify-between items-center mb-3">
                <span className="text-[15px] font-bold text-neutral-100">{t.salesperson}</span>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${hit ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                  {hit ? '✓ HIT' : 'MISS'}
                </span>
              </div>

              <div className="flex gap-4 mb-3">
                <div>
                  <div className="text-[10px] text-neutral-600 uppercase tracking-wider">Closed MRR</div>
                  <div className="text-xl font-extrabold text-[#5ec1ca]">{fmtS(closed.total)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-600 uppercase tracking-wider">Target</div>
                  <div className="text-xl font-extrabold text-neutral-500">{fmtS(t.target_mrr)}</div>
                </div>
              </div>

              <div className="flex justify-between mb-1">
                <span className="text-[11px] text-neutral-600">Progress to target</span>
                <span className="text-[12px] font-bold" style={{ color: hit ? '#10b981' : '#f59e0b' }}>{pctVal.toFixed(1)}%</span>
              </div>
              <ProgressBar value={closed.total} max={t.target_mrr} color={hit ? '#10b981' : '#5ec1ca'} />

              <div className="grid grid-cols-3 gap-1.5 mt-3">
                {[
                  { label: 'Setup', val: fmt(closed.setup) },
                  { label: 'Licence', val: fmt(closed.licence) },
                  { label: 'Coms', val: fmt(closed.coms) },
                ].map(s => (
                  <div key={s.label} className="bg-[#1e2228] rounded px-2.5 py-1.5">
                    <div className="text-[9px] text-neutral-600">{s.label}</div>
                    <div className="text-[12px] font-semibold text-neutral-400">{s.val}</div>
                  </div>
                ))}
              </div>

              {/* BDM pipeline stats from demo data */}
              {bdm && (
                <div className="grid grid-cols-3 gap-1.5 mt-2">
                  {[
                    { label: 'Booked', val: String(bdm.booked), kpi: String(bdm.bookedKpi) },
                    { label: 'TP', val: String(bdm.tp), kpi: `${(bdm.tpRate * 100).toFixed(0)}%` },
                    { label: 'Conv', val: `${(bdm.convRate * 100).toFixed(1)}%`, kpi: '' },
                  ].map(s => (
                    <div key={s.label} className="bg-[#1e2228] rounded px-2.5 py-1.5">
                      <div className="text-[9px] text-neutral-600">{s.label}</div>
                      <div className="text-[12px] font-semibold text-neutral-300">{s.val}</div>
                      {s.kpi && <div className="text-[9px] text-neutral-600">KPI: {s.kpi}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {targets.length === 0 && (
          <div className="col-span-full text-center py-12 text-neutral-600">
            No targets set. Import from spreadsheet or add targets manually.
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Reporting: Booking Summary Tab                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

function getDateRange(period: ReportPeriod, customStart: string, customEnd: string): [string, string] {
  const now = new Date();
  if (period === 'last') {
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const end = `${y}-${String(m + 1).padStart(2, '0')}-${new Date(y, m + 1, 0).getDate()}`;
    return [start, end];
  }
  if (period === 'custom' && customStart && customEnd) return [customStart, customEnd];
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return [start, today];
}

function BookingSummaryTab({ bookings, takenPlaceList }: { bookings: Booking[]; takenPlaceList: TakenPlace[] }) {
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [cs, setCs] = useState('');
  const [ce, setCe] = useState('');
  const [range, setRange] = useState(getDateRange('month', '', ''));

  const applyPeriod = (p: ReportPeriod) => { setPeriod(p); if (p !== 'custom') setRange(getDateRange(p, cs, ce)); };
  const applyCustom = () => setRange(getDateRange('custom', cs, ce));

  const fb = bookings.filter(b => b.booked_date >= range[0] && b.booked_date <= range[1]);
  const ftp = takenPlaceList.filter(t => t.demo_date >= range[0] && t.demo_date <= range[1]);
  const totalBooked = fb.length;
  const totalTP = ftp.length;
  const tpRate = totalBooked > 0 ? ((totalTP / totalBooked) * 100).toFixed(1) : '0';

  // By salesperson
  const byPerson: Record<string, { booked: number; tp: number }> = {};
  for (const b of fb) { if (!byPerson[b.salesperson]) byPerson[b.salesperson] = { booked: 0, tp: 0 }; byPerson[b.salesperson].booked++; }
  for (const t of ftp) { if (!byPerson[t.salesperson]) byPerson[t.salesperson] = { booked: 0, tp: 0 }; byPerson[t.salesperson].tp++; }
  const personRows = Object.entries(byPerson).sort((a, b) => b[1].booked - a[1].booked);

  // By product
  const byProduct: Record<string, number> = {};
  for (const b of fb) { byProduct[b.product || 'Other'] = (byProduct[b.product || 'Other'] || 0) + 1; }
  const productRows = Object.entries(byProduct).sort((a, b) => b[1] - a[1]);

  // By lead gen
  const byLG: Record<string, { booked: number; tp: number }> = {};
  for (const b of fb) { const lg = b.lead_gen || '—'; if (!byLG[lg]) byLG[lg] = { booked: 0, tp: 0 }; byLG[lg].booked++; }
  for (const t of ftp) { const lg = t.lead_gen || '—'; if (!byLG[lg]) byLG[lg] = { booked: 0, tp: 0 }; byLG[lg].tp++; }
  const lgRows = Object.entries(byLG).sort((a, b) => b[1].booked - a[1].booked);

  return (
    <div>
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <div className="text-base font-extrabold text-neutral-100">Booking Summary</div>
          <div className="text-[11px] text-neutral-600 mt-0.5">Demo bookings and taken-place by salesperson, lead gen and product</div>
        </div>
        <PeriodSelector period={period} onPeriod={applyPeriod} customStart={cs} customEnd={ce} onCustomStart={setCs} onCustomEnd={setCe} onApply={applyCustom} />
      </div>

      <div className="flex gap-4 flex-wrap mb-5">
        <KpiCard label="Total Booked" value={String(totalBooked)} color="#38bdf8" />
        <KpiCard label="Taken Place" value={String(totalTP)} color="#8b5cf6" />
        <KpiCard label="TP Rate" value={`${tpRate}%`} color={Number(tpRate) >= 50 ? '#10b981' : '#f59e0b'} />
      </div>

      <div className="flex gap-5 flex-wrap mb-5">
        <Card title="Demos Booked & Taken Place — by Salesperson" className="flex-[2] min-w-[300px]">
          <table className="w-full border-collapse">
            <thead><tr>
              {['Salesperson', 'Booked', 'Taken Place', 'TP Rate', 'Remaining'].map(h => (
                <th key={h} className={h === 'Salesperson' ? TH : THR}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {personRows.map(([name, v]) => (
                <tr key={name} className="hover:bg-[#2f353d]/50">
                  <td className={`${TD} font-semibold text-neutral-100`}>{name}</td>
                  <td className={`${TDR} text-[#38bdf8]`}>{v.booked}</td>
                  <td className={`${TDR} text-[#8b5cf6]`}>{v.tp}</td>
                  <td className={TDR} style={{ color: pctColor(v.booked > 0 ? v.tp / v.booked : 0) }}>{v.booked > 0 ? ((v.tp / v.booked) * 100).toFixed(0) + '%' : '—'}</td>
                  <td className={TDR}>{Math.max(0, v.booked - v.tp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="flex-1 min-w-[220px] border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] p-5">
          <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-4">Booked by Product</div>
          {productRows.map(([prod, count]) => (
            <div key={prod} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-[12px] text-neutral-400">{prod}</span>
                <span className="text-[12px] font-bold text-neutral-200">{count}</span>
              </div>
              <ProgressBar value={count} max={totalBooked || 1} />
            </div>
          ))}
        </div>
      </div>

      <Card title="Demos Booked & Taken Place — by Lead Gen">
        <table className="w-full border-collapse">
          <thead><tr>
            {['Lead Gen', 'Booked', 'Taken Place', 'TP Rate'].map(h => (
              <th key={h} className={h === 'Lead Gen' ? TH : THR}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {lgRows.map(([name, v]) => (
              <tr key={name} className="hover:bg-[#2f353d]/50">
                <td className={`${TD} font-semibold text-neutral-100`}>{name}</td>
                <td className={`${TDR} text-[#38bdf8]`}>{v.booked}</td>
                <td className={`${TDR} text-[#8b5cf6]`}>{v.tp}</td>
                <td className={TDR} style={{ color: pctColor(v.booked > 0 ? v.tp / v.booked : 0) }}>{v.booked > 0 ? ((v.tp / v.booked) * 100).toFixed(0) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Reporting: Sales Summary Tab                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

function SalesSummaryTab({ sales, bookings, takenPlaceList }: { sales: MonthlySale[]; bookings: Booking[]; takenPlaceList: TakenPlace[] }) {
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [cs, setCs] = useState('');
  const [ce, setCe] = useState('');
  const [range, setRange] = useState(getDateRange('month', '', ''));

  const applyPeriod = (p: ReportPeriod) => { setPeriod(p); if (p !== 'custom') setRange(getDateRange(p, cs, ce)); };
  const applyCustom = () => setRange(getDateRange('custom', cs, ce));

  const fs = sales.filter(s => s.sale_date >= range[0] && s.sale_date <= range[1]);
  const totalMrr = fs.reduce((s, r) => s + (r.actual_mrr || 0), 0);
  const totalSales = fs.length;
  const avgMrr = totalSales > 0 ? totalMrr / totalSales : 0;

  // By lead gen
  const byLG: Record<string, { count: number; mrr: number }> = {};
  for (const s of fs) { const lg = s.lead_gen || '—'; if (!byLG[lg]) byLG[lg] = { count: 0, mrr: 0 }; byLG[lg].count++; byLG[lg].mrr += s.actual_mrr || 0; }
  const lgRows = Object.entries(byLG).sort((a, b) => b[1].mrr - a[1].mrr);

  // By product
  const byProd: Record<string, { count: number; mrr: number }> = {};
  for (const s of fs) { const p = s.product || 'Other'; if (!byProd[p]) byProd[p] = { count: 0, mrr: 0 }; byProd[p].count++; byProd[p].mrr += s.actual_mrr || 0; }
  const prodRows = Object.entries(byProd).sort((a, b) => b[1].mrr - a[1].mrr);

  return (
    <div>
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <div className="text-base font-extrabold text-neutral-100">Sales Summary</div>
          <div className="text-[11px] text-neutral-600 mt-0.5">Conversion funnel and MRR breakdown for the selected period</div>
        </div>
        <PeriodSelector period={period} onPeriod={applyPeriod} customStart={cs} customEnd={ce} onCustomStart={setCs} onCustomEnd={setCe} onApply={applyCustom} />
      </div>

      <div className="flex gap-4 flex-wrap mb-5">
        <KpiCard label="Total Sales" value={String(totalSales)} color="#10b981" />
        <KpiCard label="Total MRR" value={fmtS(totalMrr)} color="#5ec1ca" />
        <KpiCard label="Avg MRR / Sale" value={fmtS(avgMrr)} color="#8b5cf6" />
      </div>

      <div className="flex gap-5 flex-wrap mb-5">
        <Card title="Sales by Lead Gen Person" className="flex-[2] min-w-[300px]">
          <table className="w-full border-collapse">
            <thead><tr>
              {['Lead Gen', 'Sales', 'Total MRR', 'Avg MRR'].map(h => (
                <th key={h} className={h === 'Lead Gen' ? TH : THR}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {lgRows.map(([name, v]) => (
                <tr key={name} className="hover:bg-[#2f353d]/50">
                  <td className={`${TD} font-semibold text-neutral-100`}>{name}</td>
                  <td className={TDR}>{v.count}</td>
                  <td className={`${TDR} text-[#5ec1ca] font-bold`}>{fmtS(v.mrr)}</td>
                  <td className={TDR}>{v.count > 0 ? fmtS(v.mrr / v.count) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Sales by Product" className="flex-1 min-w-[220px]">
          <table className="w-full border-collapse">
            <thead><tr>
              {['Product', 'Sales', 'Total MRR', 'Avg MRR'].map(h => (
                <th key={h} className={h === 'Product' ? TH : THR}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {prodRows.map(([name, v]) => (
                <tr key={name} className="hover:bg-[#2f353d]/50">
                  <td className={`${TD} font-semibold text-neutral-100`}>{name}</td>
                  <td className={TDR}>{v.count}</td>
                  <td className={`${TDR} text-[#5ec1ca] font-bold`}>{fmtS(v.mrr)}</td>
                  <td className={TDR}>{v.count > 0 ? fmtS(v.mrr / v.count) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Reporting: KPI Tracker Tab                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

function KpiTrackerTab({ lgKpiCurrent, bdmKpiData, hasApiData }: {
  lgKpiCurrent: LgKpiRow[];
  bdmKpiData: Record<string, BdmKpiRow>;
  hasApiData: boolean;
}) {
  return (
    <div>
      <div className="flex justify-between items-start flex-wrap gap-4 mb-5">
        <div>
          <div className="text-base font-extrabold text-neutral-100">KPI Tracker</div>
          <div className="text-[11px] text-neutral-600 mt-0.5">Lead gen and BDM KPIs against targets for the selected period</div>
        </div>
        {!hasApiData && <DemoBadge />}
      </div>

      {/* Lead Gen KPIs */}
      <SectionTitle>Lead Gen KPIs</SectionTitle>
      <Card className="mb-5">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={TH}>Person</th>
                <th rowSpan={2} className={THR}>Days</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>Calls</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>Booked</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>Taken Place</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>Sales</th>
              </tr>
              <tr>
                <th className={THR}>KPI</th><th className={THR}>Actual</th><th className={THR}>%</th>
                <th className={THR}>KPI</th><th className={THR}>Actual</th><th className={THR}>Rate</th>
                <th className={THR}>KPI</th><th className={THR}>Actual</th><th className={THR}>Rate</th>
                <th className={THR}>Sales</th><th className={THR}>Conv%</th><th className={THR}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {lgKpiCurrent.map(r => {
                const callsR = r.callsKpi > 0 ? r.callsActual / r.callsKpi : 0;
                const bookedR = r.bookedKpi > 0 ? r.bookedActual / r.bookedKpi : 0;
                const tpR = r.tpKpi > 0 ? r.tpActual / r.tpKpi : 0;
                const bookRate = r.callsActual > 0 ? ((r.bookedActual / r.callsActual) * 100).toFixed(1) + '%' : '—';
                const tpRateV = r.bookedActual > 0 ? ((r.tpActual / r.bookedActual) * 100).toFixed(1) + '%' : '—';
                return (
                  <tr key={r.name} className="hover:bg-[#2f353d]/50">
                    <td className={`${TD} font-semibold text-neutral-100`}>{r.name}</td>
                    <td className={TDR}>{r.days}</td>
                    <td className={`${TDR} text-neutral-500`}>{fmtN(r.callsKpi)}</td>
                    <td className={TDR}>{fmtN(r.callsActual)}</td>
                    <td className={TDR} style={{ color: pctColor(callsR) }}>{(callsR * 100).toFixed(0)}%</td>
                    <td className={`${TDR} text-neutral-500`}>{r.bookedKpi}</td>
                    <td className={TDR}>{r.bookedActual}</td>
                    <td className={TDR} style={{ color: pctColor(bookedR) }}>{bookRate}</td>
                    <td className={`${TDR} text-neutral-500`}>{r.tpKpi}</td>
                    <td className={TDR}>{r.tpActual}</td>
                    <td className={TDR} style={{ color: pctColor(tpR) }}>{tpRateV}</td>
                    <td className={TDR}>{r.sales}</td>
                    <td className={TDR}>{(r.convRate * 100).toFixed(1)}%</td>
                    <td className={`${TDR} text-[#5ec1ca] font-bold`}>{r.mrr > 0 ? fmtS(r.mrr) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* BDM KPIs */}
      <SectionTitle>BDM KPIs</SectionTitle>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th rowSpan={2} className={TH}>Person</th>
                <th colSpan={2} className={`${THC} border-b border-[#2f353d]`}>Booked</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>Taken Place</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>Sales</th>
                <th colSpan={3} className={`${THC} border-b border-[#2f353d]`}>MRR</th>
              </tr>
              <tr>
                <th className={THR}>Actual</th><th className={THR}>KPI</th>
                <th className={THR}>Actual</th><th className={THR}>KPI</th><th className={THR}>Rate</th>
                <th className={THR}>Sales</th><th className={THR}>KPI</th><th className={THR}>Conv%</th>
                <th className={THR}>Total</th><th className={THR}>KPI</th><th className={THR}>% to KPI</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(bdmKpiData).map(([name, r]) => {
                const mrrRatio = r.mrrKpi > 0 ? r.mrr / r.mrrKpi : 0;
                return (
                  <tr key={name} className="hover:bg-[#2f353d]/50">
                    <td className={`${TD} font-semibold text-neutral-100`}>{name}</td>
                    <td className={TDR}>{r.booked}</td>
                    <td className={`${TDR} text-neutral-500`}>{r.bookedKpi}</td>
                    <td className={TDR}>{r.tp}</td>
                    <td className={`${TDR} text-neutral-500`}>{r.tpKpi}</td>
                    <td className={TDR} style={{ color: pctColor(r.tpRate) }}>{(r.tpRate * 100).toFixed(0)}%</td>
                    <td className={TDR}>{r.sales}</td>
                    <td className={`${TDR} text-neutral-500`}>{r.salesKpi}</td>
                    <td className={TDR}>{(r.convRate * 100).toFixed(1)}%</td>
                    <td className={`${TDR} text-[#5ec1ca] font-bold`}>{fmtS(r.mrr)}</td>
                    <td className={`${TDR} text-neutral-500`}>{fmtS(r.mrrKpi)}</td>
                    <td className={TDR} style={{ color: pctColor(mrrRatio) }}>{(mrrRatio * 100).toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Board Pack Tab                                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

const BP_PLACEHOLDER: Record<BoardSection, { title: string; kpis: { label: string; value: string; color: string }[] }> = {
  'bp-exec': {
    title: 'Executive Summary — Performance Overview',
    kpis: [
      { label: 'MRR Target (2024)', value: '£42,500', color: '#94a3b8' },
      { label: 'Best Month 2024', value: '£48,670', color: '#38bdf8' },
      { label: '2025 LG Calls', value: '79,866', color: '#8b5cf6' },
      { label: '2025 Demos Booked', value: '3,866', color: '#f59e0b' },
      { label: 'Exit MRR Target', value: '£1.65M', color: '#10b981' },
      { label: 'Valuation Bridge', value: '£279M', color: '#fbbf24' },
    ],
  },
  'bp-tva': {
    title: 'Target vs Actual — Monthly MRR by Product 2024',
    kpis: [
      { label: 'Total MRR', value: '—', color: '#38bdf8' },
      { label: 'BYM / Email', value: '—', color: '#8b5cf6' },
      { label: 'Sites / TPJ', value: '—', color: '#f59e0b' },
    ],
  },
  'bp-lg': {
    title: 'Lead Gen Funnel — Multi-Year Trends',
    kpis: [
      { label: '2025 Total Calls', value: '79,866', color: '#94a3b8' },
      { label: '2025 Demos Booked', value: '3,866', color: '#38bdf8' },
      { label: '2025 Taken Place', value: '2,449', color: '#8b5cf6' },
    ],
  },
  'bp-bym': {
    title: 'BYM / Nurtur — Long-Term Revenue Tracker',
    kpis: [
      { label: '2024 Licence MRR', value: '£109,516', color: '#38bdf8' },
      { label: '2025 Licence MRR', value: '£347,063', color: '#f59e0b' },
      { label: '2025 Total SUF', value: '£469,650', color: '#10b981' },
    ],
  },
  'bp-lp': {
    title: 'LeadPro / Yomdel — Sales Funnel',
    kpis: [
      { label: '2024 Total Booked', value: '910', color: '#38bdf8' },
      { label: '2024 TP Rate', value: '81%', color: '#f59e0b' },
      { label: 'Avg Conv (2024)', value: '22%', color: '#10b981' },
    ],
  },
  'bp-tpj': {
    title: 'TPJ Websites — Sales Funnel',
    kpis: [
      { label: '2025 Calls', value: '16,152', color: '#94a3b8' },
      { label: '2025 Total Booked', value: '538', color: '#f59e0b' },
      { label: '2025 Total TP', value: '502', color: '#10b981' },
    ],
  },
  'bp-sb': {
    title: 'Starberry — Marketing & Sales Funnel',
    kpis: [
      { label: 'Mktg Leads 2023', value: '989', color: '#38bdf8' },
      { label: 'Valid Leads 2023', value: '488', color: '#8b5cf6' },
      { label: 'LG Booked 2025', value: '161', color: '#10b981' },
    ],
  },
  'bp-kym': {
    title: 'KYM — Sales Funnel & Revenue',
    kpis: [
      { label: '2022 Booked', value: '61', color: '#38bdf8' },
      { label: '2022 Sales', value: '38', color: '#10b981' },
      { label: '2022 MRR', value: '£14,548', color: '#f59e0b' },
    ],
  },
  'bp-ymd': {
    title: 'Yomdel — Calls & Demo Funnel',
    kpis: [
      { label: '2022 Calls', value: '26,511', color: '#94a3b8' },
      { label: '2023 Calls', value: '14,010', color: '#94a3b8' },
      { label: '2024 Booked', value: '261', color: '#8b5cf6' },
    ],
  },
  'bp-snap': {
    title: 'Brand Snapshot — Contracted New Logos by Product',
    kpis: [
      { label: 'BYM/Nurtur', value: 'Top performer', color: '#38bdf8' },
      { label: 'Peak Month', value: '97 logos', color: '#f59e0b' },
      { label: 'Voice AI', value: 'Growing 2022+', color: '#10b981' },
    ],
  },
  'bp-bridge': {
    title: 'Strategic Bridge — MRR Exit Pathway & Gap Analysis',
    kpis: [
      { label: 'Current Exit MRR', value: '£1.38M', color: '#94a3b8' },
      { label: 'End 2026 Target', value: '£1.65M', color: '#38bdf8' },
      { label: '2029 Valuation', value: '£279M', color: '#fbbf24' },
    ],
  },
};

function BoardPackTab() {
  const [activeSection, setActiveSection] = useState<BoardSection>('bp-exec');
  const section = BP_PLACEHOLDER[activeSection];

  return (
    <div>
      {/* Sub-nav */}
      <div className="flex gap-1 border-b border-[#3a424d] mb-5 overflow-x-auto">
        {BOARD_SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`px-4 py-2 text-[11px] font-bold transition-colors border-b-2 -mb-[1px] whitespace-nowrap uppercase tracking-wider ${
              activeSection === s.id
                ? 'border-[#5ec1ca] text-[#5ec1ca]'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="mb-5 pb-3 border-b border-[#2f353d]">
        <h3 className="text-[15px] font-extrabold text-neutral-100">{section.title}</h3>
      </div>

      <div className="flex gap-4 flex-wrap mb-6">
        {section.kpis.map(k => (
          <KpiCard key={k.label} label={k.label} value={k.value} color={k.color} />
        ))}
      </div>

      {/* Chart placeholder */}
      <Card className="mb-5">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-4xl mb-3 opacity-20">📊</div>
            <div className="text-neutral-500 text-[13px] font-semibold">Chart.js integration coming soon</div>
            <div className="text-neutral-600 text-[11px] mt-1">Historical trend charts and comparisons will be rendered here</div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="text-neutral-600 text-[12px]">Data tables for this section will be populated from the Board Pack spreadsheet</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Modals                                                                   */
/* ══════════════════════════════════════════════════════════════════════════ */

const INPUT_CLS = 'bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca] w-full';
const LABEL_CLS = 'text-[10px] font-bold text-neutral-500 uppercase tracking-wider';

function ModalShell({ open, onClose, title, width, children }: {
  open: boolean; onClose: () => void; title: string; width?: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#272C33] border border-[#3a424d] rounded-2xl p-7 max-h-[88vh] overflow-y-auto"
        style={{ width: width || '640px' }} onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-base font-bold text-neutral-100">{title}</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Deal Modal ── */

function DealModal({
  open, onClose, onSave, deal, refData,
}: {
  open: boolean; onClose: () => void; onSave: (data: Partial<PipelineDeal>) => void;
  deal: Partial<PipelineDeal> | null; refData: RefData;
}) {
  const [form, setForm] = useState<Partial<PipelineDeal>>({});
  useEffect(() => { if (open) setForm(deal || {}); }, [open, deal]);

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!deal?.id;

  return (
    <ModalShell open={open} onClose={onClose} title={isEdit ? 'Edit Deal' : 'Add New Deal'}>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Salesperson *', key: 'salesperson', type: 'select', options: refData.salespeople },
          { label: 'Lead Gen', key: 'lead_gen', type: 'select', options: refData.salespeople },
          { label: 'Company *', key: 'company', type: 'text' },
          { label: 'MRR (£) *', key: 'mrr', type: 'number' },
          { label: 'Product', key: 'product', type: 'select', options: refData.products },
          { label: 'Deal Stage *', key: 'stage', type: 'select', options: refData.stages },
          { label: 'Demo Date', key: 'demo_date', type: 'date' },
          { label: 'Est. Close', key: 'est_close_date', type: 'date' },
          { label: 'Next Chase', key: 'next_chase_date', type: 'date' },
          { label: 'Contact', key: 'contact', type: 'text' },
          { label: 'Phone', key: 'phone', type: 'text' },
        ].map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={(form as any)[f.key] || ''} onChange={e => set(f.key, e.target.value)} className={INPUT_CLS}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type} value={(form as any)[f.key] ?? ''} onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)} className={INPUT_CLS} />
            )}
          </div>
        ))}
        <div className="col-span-2 flex flex-col gap-1">
          <label className={LABEL_CLS}>Notes</label>
          <input value={form.notes || ''} onChange={e => set('notes', e.target.value)} className={INPUT_CLS} />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 border border-[#3a424d] rounded-lg text-neutral-500 hover:border-[#5ec1ca] hover:text-[#5ec1ca] text-[13px] font-semibold transition-colors">Cancel</button>
        <button onClick={() => { if (form.company && form.mrr && form.stage && form.salesperson) onSave(form); }}
          className="px-5 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[13px] hover:bg-[#4db0b9] transition-colors">
          {isEdit ? 'Save Changes' : 'Add Deal'}
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Booking Modal ── */

function BookingModal({
  open, onClose, onSave, refData,
}: {
  open: boolean; onClose: () => void; onSave: (data: Partial<Booking>) => void; refData: RefData;
}) {
  const [form, setForm] = useState<Record<string, any>>({});
  useEffect(() => { if (open) setForm({ booked_date: today, demo_date: '', dm: '', taken_place: 0 }); }, [open]);

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <ModalShell open={open} onClose={onClose} title="Log Demo Booking">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Date of Booking *', key: 'booked_date', type: 'date' },
          { label: 'Salesperson *', key: 'salesperson', type: 'select', options: refData.salespeople },
          { label: 'Lead Gen', key: 'lead_gen', type: 'select', options: refData.salespeople },
          { label: 'Team', key: 'team', type: 'select', options: ['Lead Gen', 'Marketing', 'Customer Success', 'EOI'] },
          { label: 'Product *', key: 'product', type: 'select', options: refData.products },
          { label: 'Company Name *', key: 'company', type: 'text' },
          { label: 'Email', key: 'email', type: 'email' },
          { label: 'Client Type', key: 'client_type', type: 'select', options: refData.clientTypes },
          { label: 'Date to Take Place *', key: 'demo_date', type: 'date' },
          { label: 'Decision Maker?', key: 'dm', type: 'select', options: ['Yes', 'No'] },
          { label: 'Phone', key: 'phone', type: 'text' },
          { label: 'Lead Source', key: 'lead_source', type: 'select', options: refData.leadSources },
        ].map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} className={INPUT_CLS}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type} value={form[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} className={INPUT_CLS} />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 border border-[#3a424d] rounded-lg text-neutral-500 hover:border-[#5ec1ca] hover:text-[#5ec1ca] text-[13px] font-semibold transition-colors">Cancel</button>
        <button onClick={() => { if (form.company && form.salesperson && form.demo_date) onSave(form as Partial<Booking>); }}
          className="px-5 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[13px] hover:bg-[#4db0b9] transition-colors">
          Log Booking
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Taken Place Modal ── */

function TakenPlaceModal({
  open, onClose, onSave, booking, refData,
}: {
  open: boolean; onClose: () => void; onSave: (data: Partial<TakenPlace>) => void;
  booking: Booking | null; refData: RefData;
}) {
  const [form, setForm] = useState<Record<string, any>>({});
  useEffect(() => {
    if (open && booking) {
      setForm({
        demo_date: booking.demo_date, salesperson: booking.salesperson, lead_gen: booking.lead_gen,
        product: booking.product, company: booking.company, email: booking.email,
        branches: 1, dm: booking.dm, est_mrr: 0, hwc: '', in_hotbox: 'No',
        client_type: booking.client_type, notes: '', booking_id: booking.id,
      });
    } else if (open) {
      setForm({ demo_date: today, branches: 1, in_hotbox: 'No', booking_id: null });
    }
  }, [open, booking]);

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <ModalShell open={open} onClose={onClose} title="Log Demo — Taken Place">
      {booking && (
        <div className="bg-[#1e2228] rounded-lg px-4 py-2.5 mb-4 text-[11px] text-[#38bdf8] border border-[#38bdf820]">
          Pre-filled from booking. Complete the outcome details — Hot or Warm demos will be flagged for Hotbox entry.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Date of Demo *', key: 'demo_date', type: 'date' },
          { label: 'Salesperson *', key: 'salesperson', type: 'select', options: refData.salespeople },
          { label: 'Lead Gen', key: 'lead_gen', type: 'select', options: refData.salespeople },
          { label: 'Product *', key: 'product', type: 'select', options: refData.products },
          { label: 'Company *', key: 'company', type: 'text' },
          { label: 'Email', key: 'email', type: 'email' },
          { label: 'Branches', key: 'branches', type: 'number' },
          { label: 'Decision Maker?', key: 'dm', type: 'select', options: ['Yes', 'No'] },
          { label: 'Estimated MRR (£)', key: 'est_mrr', type: 'number' },
          { label: 'Hot / Warm / Cold', key: 'hwc', type: 'select', options: ['Hot', 'Warm', 'Cold'] },
          { label: 'Added to Hotbox?', key: 'in_hotbox', type: 'select', options: ['No', 'Yes'] },
          { label: 'Client Type', key: 'client_type', type: 'select', options: refData.clientTypes },
        ].map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={form[f.key] || ''} onChange={e => set(f.key, e.target.value)} className={INPUT_CLS}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type} value={form[f.key] ?? ''} onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)} className={INPUT_CLS} />
            )}
          </div>
        ))}
        <div className="col-span-2 flex flex-col gap-1">
          <label className={LABEL_CLS}>Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
            className={`${INPUT_CLS} resize-none`} placeholder="Demo notes, objections, next steps..." />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 border border-[#3a424d] rounded-lg text-neutral-500 hover:border-[#5ec1ca] hover:text-[#5ec1ca] text-[13px] font-semibold transition-colors">Cancel</button>
        <button onClick={() => { if (form.company && form.salesperson && form.demo_date) onSave(form as Partial<TakenPlace>); }}
          className="px-5 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[13px] hover:bg-[#4db0b9] transition-colors">
          Log Demo
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Sale Modal ── */

function SaleModal({
  open, onClose, onSave, refData,
}: {
  open: boolean; onClose: () => void; onSave: (data: Partial<MonthlySale>) => void; refData: RefData;
}) {
  const [form, setForm] = useState<Partial<MonthlySale>>({ sale_date: today, branches: 1 });
  useEffect(() => { if (open) setForm({ sale_date: today, branches: 1 }); }, [open]);

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <ModalShell open={open} onClose={onClose} title="Log Contracted Sale" width="660px">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Date *', key: 'sale_date', type: 'date' },
          { label: 'Salesperson *', key: 'salesperson', type: 'select', options: refData.salespeople },
          { label: 'Lead Gen', key: 'lead_gen', type: 'select', options: refData.salespeople },
          { label: 'Product', key: 'product', type: 'select', options: refData.products },
          { label: 'Trading Name *', key: 'trading_name', type: 'text' },
          { label: 'Email', key: 'email', type: 'email' },
          { label: 'Limited Company', key: 'limited_company', type: 'text' },
          { label: 'Company Number', key: 'company_number', type: 'text' },
          { label: 'Setup Fee (£)', key: 'setup_fee', type: 'number' },
          { label: 'Licence (£) *', key: 'licence', type: 'number' },
          { label: 'Postal/PPC (£)', key: 'postal', type: 'number' },
          { label: 'Coms (£)', key: 'coms', type: 'number' },
          { label: 'Trial MRR (£)', key: 'trial_mrr', type: 'number' },
          { label: 'Actual MRR (£) *', key: 'actual_mrr', type: 'number' },
          { label: 'Branches', key: 'branches', type: 'number' },
        ].map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={(form as any)[f.key] || ''} onChange={e => set(f.key, e.target.value)} className={INPUT_CLS}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type} value={(form as any)[f.key] ?? ''} onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)} className={INPUT_CLS} />
            )}
          </div>
        ))}
        <div className="col-span-2 flex flex-col gap-1">
          <label className={LABEL_CLS}>Net New vs Existing</label>
          <select value={form.existing_vs_new || ''} onChange={e => set('existing_vs_new', e.target.value)} className={INPUT_CLS}>
            <option value="">— Select —</option>
            <option>Net New</option>
            <option>Nurtur Client</option>
            <option>Nurtur Client - Up-Sell</option>
            <option>Nurtur Client - Save</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 border border-[#3a424d] rounded-lg text-neutral-500 hover:border-[#5ec1ca] hover:text-[#5ec1ca] text-[13px] font-semibold transition-colors">Cancel</button>
        <button onClick={() => { if (form.sale_date && form.salesperson && form.actual_mrr) onSave(form); }}
          className="px-5 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[13px] hover:bg-[#4db0b9] transition-colors">
          Log Sale
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Onboarding Modal ── */

interface SaleType { id: number; name: string; active: number }

function OnboardingModal({
  open, onClose, deal,
}: {
  open: boolean; onClose: () => void; deal: PipelineDeal | null;
}) {
  const [saleTypes, setSaleTypes] = useState<SaleType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [form, setForm] = useState<Record<string, string | number | null>>({});

  useEffect(() => {
    if (!open || !deal) return;
    setResult(null);
    setForm({
      product: deal.product || '', account: deal.company, mrr: deal.mrr, licence_fee: deal.mrr,
      branches: 1, order_date: today, go_live_date: '', predicted_delivery: '',
      onboarder: '', sale_type: '', status: 'active', notes: deal.notes || '',
    });
    fetch('/api/onboarding/config/sale-types')
      .then(r => r.json())
      .then(d => { if (d.ok) setSaleTypes(d.data.filter((s: SaleType) => s.active)); })
      .catch(() => {});
  }, [open, deal]);

  if (!open || !deal) return null;

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.product || !form.account) return;
    setSubmitting(true); setResult(null);
    try {
      const res = await fetch('/api/delivery/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const json = await res.json();
      if (json.ok) { setResult({ ok: true, message: `Created onboarding entry: ${json.data.onboarding_id || json.data.id}` }); setTimeout(onClose, 1500); }
      else { setResult({ ok: false, message: json.error || 'Failed to create entry' }); }
    } catch (err) { setResult({ ok: false, message: err instanceof Error ? err.message : 'Unknown error' }); }
    finally { setSubmitting(false); }
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Move to Onboarding" width="660px">
      <p className="text-[12px] text-neutral-500 mb-5">
        <span className="text-[#5ec1ca] font-semibold">{deal.company}</span> has reached Contract Sent. Create a delivery entry to begin onboarding.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Product *', key: 'product', type: 'text' },
          { label: 'Account (Company) *', key: 'account', type: 'text' },
          { label: 'Sale Type', key: 'sale_type', type: 'select', options: saleTypes.map(s => s.name) },
          { label: 'Onboarder', key: 'onboarder', type: 'text' },
          { label: 'MRR (£)', key: 'mrr', type: 'number' },
          { label: 'Licence Fee (£)', key: 'licence_fee', type: 'number' },
          { label: 'Branches', key: 'branches', type: 'number' },
          { label: 'Status', key: 'status', type: 'select', options: ['active', 'pending', 'on-hold'] },
          { label: 'Order Date', key: 'order_date', type: 'date' },
          { label: 'Go Live Date', key: 'go_live_date', type: 'date' },
          { label: 'Predicted Delivery', key: 'predicted_delivery', type: 'date' },
        ].map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className={LABEL_CLS}>{f.label}</label>
            {f.type === 'select' ? (
              <select value={String(form[f.key] || '')} onChange={e => set(f.key, e.target.value)} className={INPUT_CLS}>
                <option value="">— Select —</option>
                {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type} value={form[f.key] ?? ''} onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)} className={INPUT_CLS} />
            )}
          </div>
        ))}
        <div className="col-span-2 flex flex-col gap-1">
          <label className={LABEL_CLS}>Notes</label>
          <textarea value={String(form.notes || '')} onChange={e => set('notes', e.target.value)} rows={2} className={`${INPUT_CLS} resize-none`} />
        </div>
      </div>
      {result && (
        <div className={`mt-4 px-4 py-2.5 rounded-lg text-[12px] font-semibold ${result.ok ? 'bg-green-900/20 text-green-400 border border-green-800/30' : 'bg-red-900/20 text-red-400 border border-red-800/30'}`}>
          {result.message}
        </div>
      )}
      <div className="flex justify-between items-center mt-5">
        <button onClick={onClose} className="px-4 py-2 border border-[#3a424d] rounded-lg text-neutral-500 hover:border-[#5ec1ca] hover:text-[#5ec1ca] text-[13px] font-semibold transition-colors">Skip</button>
        <button onClick={submit} disabled={submitting || !form.product || !form.account}
          className="px-5 py-2 bg-[#10b981] text-white font-bold rounded-lg text-[13px] hover:bg-[#059669] transition-colors disabled:opacity-50">
          {submitting ? 'Creating...' : 'Create Onboarding Entry'}
        </button>
      </div>
    </ModalShell>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Main Component                                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

const TABS: { id: SubTab; label: string; icon: string; separator?: boolean }[] = [
  { id: 'summary', label: 'Summary', icon: '◈' },
  { id: 'leadgen', label: 'Lead Gen KPIs', icon: '⬛' },
  { id: 'demos', label: 'Demo Tracker', icon: '◎' },
  { id: 'hotbox', label: 'Hotbox', icon: '⬡' },
  { id: 'monthly', label: 'Monthly Sales', icon: '▤' },
  { id: 'targets', label: 'BDM Targets', icon: '◉' },
  { id: 'rep-booking', label: 'Booking Summary', icon: '', separator: true },
  { id: 'rep-sales', label: 'Sales Summary', icon: '' },
  { id: 'rep-kpi', label: 'KPI Tracker', icon: '' },
  { id: 'board', label: '📊 Board Pack', icon: '', separator: true },
];

export function SalesHotboxView({ canWrite = false }: { canWrite?: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>('summary');
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [sales, setSales] = useState<MonthlySale[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [takenPlaceList, setTakenPlaceList] = useState<TakenPlace[]>([]);
  const [refData, setRefData] = useState<RefData>({ salespeople: [], products: [], stages: [], leadSources: [], clientTypes: [] });
  const [lgKpisRaw, setLgKpisRaw] = useState<ApiLgKpi[]>([]);
  const [bdmKpisRaw, setBdmKpisRaw] = useState<ApiBdmKpi[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [dealModalOpen, setDealModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [saleModalOpen, setSaleModalOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [tpModalOpen, setTpModalOpen] = useState(false);
  const [tpBooking, setTpBooking] = useState<Booking | null>(null);
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);
  const [onboardingDeal, setOnboardingDeal] = useState<PipelineDeal | null>(null);

  // Import
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [pRes, mRes, tRes, rRes, bRes, tpRes, lgRes, bdmRes] = await Promise.all([
        fetch('/api/sales/pipeline'),
        fetch('/api/sales/monthly'),
        fetch('/api/sales/targets'),
        fetch('/api/sales/reference'),
        fetch('/api/sales/bookings'),
        fetch('/api/sales/taken-place'),
        fetch('/api/sales/lg-kpis'),
        fetch('/api/sales/bdm-kpis'),
      ]);
      const [pData, mData, tData, rData, bData, tpData, lgData, bdmData] = await Promise.all([
        pRes.json(), mRes.json(), tRes.json(), rRes.json(), bRes.json(), tpRes.json(), lgRes.json(), bdmRes.json(),
      ]);
      if (pData.ok) setDeals(pData.data);
      if (mData.ok) setSales(mData.data);
      if (tData.ok) setTargets(tData.data);
      if (rData.ok) setRefData(rData.data);
      if (bData.ok) setBookings(bData.data);
      if (tpData.ok) setTakenPlaceList(tpData.data);
      if (lgData.ok) setLgKpisRaw(lgData.data);
      if (bdmData.ok) setBdmKpisRaw(bdmData.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── CRUD handlers ──

  const saveDeal = async (data: Partial<PipelineDeal>) => {
    const isEdit = !!data.id;
    const previousStage = editingDeal?.stage;
    const res = await fetch(`/api/sales/pipeline${isEdit ? `/${data.id}` : ''}`, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.ok) {
      setDealModalOpen(false); setEditingDeal(null); fetchAll();
      if (data.stage === 'Contract Sent' && previousStage !== 'Contract Sent') {
        setOnboardingDeal(json.data as PipelineDeal);
        setOnboardingModalOpen(true);
      }
    }
  };

  const deleteDeal = async (id: number) => {
    if (!confirm('Remove this deal?')) return;
    await fetch(`/api/sales/pipeline/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const saveSale = async (data: Partial<MonthlySale>) => {
    const res = await fetch('/api/sales/monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if ((await res.json()).ok) { setSaleModalOpen(false); fetchAll(); }
  };

  const deleteSale = async (id: number) => {
    if (!confirm('Remove this sale?')) return;
    await fetch(`/api/sales/monthly/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const saveBooking = async (data: Partial<Booking>) => {
    const res = await fetch('/api/sales/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if ((await res.json()).ok) { setBookingModalOpen(false); fetchAll(); }
  };

  const deleteBooking = async (id: number) => {
    if (!confirm('Remove this booking?')) return;
    await fetch(`/api/sales/bookings/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const saveTakenPlace = async (data: Partial<TakenPlace>) => {
    const res = await fetch('/api/sales/taken-place', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if ((await res.json()).ok) {
      setTpModalOpen(false); setTpBooking(null);
      // Mark booking as taken place if linked
      if (data.booking_id) {
        await fetch(`/api/sales/bookings/${data.booking_id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taken_place: 1 }),
        });
      }
      fetchAll();
    }
  };

  const deleteTakenPlace = async (id: number) => {
    if (!confirm('Remove this taken place record?')) return;
    await fetch(`/api/sales/taken-place/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const runFileImport = (endpoint: string, onSuccess: (json: any) => string) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xls';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setImporting(true); setImportResult(null);
      try {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => { resolve((reader.result as string).split(',')[1]); };
          reader.readAsDataURL(file);
        });
        const res = await fetch(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: base64, clear: true }),
        });
        const json = await res.json();
        if (json.ok) { setImportResult(onSuccess(json)); fetchAll(); }
        else { setImportResult(`Error: ${json.error}`); }
      } catch (err) { setImportResult(`Error: ${err instanceof Error ? err.message : 'Unknown'}`); }
      finally { setImporting(false); }
    };
    input.click();
  };

  const runImport = () => runFileImport('/api/sales/import',
    (json) => `Imported: ${json.data.deals} deals, ${json.data.sales} sales, ${json.data.targets} targets`);

  const runDataPackImport = () => runFileImport('/api/sales/import-data-pack',
    (json) => `Data pack: ${json.data.lgKpis} LG KPI rows, ${json.data.lgHistory} history rows`);

  // Derive KPI row data from API
  const hasLgKpiData = lgKpisRaw.length > 0;
  const hasBdmKpiData = bdmKpisRaw.length > 0;
  const { current: lgKpiCurrent, history: lgKpiHistory } = buildLgKpiRows(lgKpisRaw, null);
  const bdmKpiData = apiToBdmKpiData(bdmKpisRaw);

  if (loading) {
    return <div className="py-20 text-center text-neutral-500">Loading sales data...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">Sales Dashboard</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">End-to-end pipeline: calls → bookings → demos → hotbox → sales</p>
        </div>
        <div className="flex items-center gap-2">
          {importResult && (
            <span className={`text-[11px] px-3 py-1 rounded-lg ${importResult.startsWith('Error') ? 'bg-red-900/20 text-red-400' : 'bg-green-900/20 text-green-400'}`}>
              {importResult}
            </span>
          )}
          <button onClick={runDataPackImport} disabled={importing}
            className="px-3 py-1.5 text-[11px] border border-[#3a424d] rounded-lg text-neutral-500 hover:text-[#8b5cf6] hover:border-[#8b5cf6] transition-colors disabled:opacity-50">
            {importing ? 'Importing...' : 'Import Data Pack'}
          </button>
          <button onClick={runImport} disabled={importing}
            className="px-3 py-1.5 text-[11px] border border-[#3a424d] rounded-lg text-neutral-500 hover:text-[#5ec1ca] hover:border-[#5ec1ca] transition-colors disabled:opacity-50">
            {importing ? 'Importing...' : 'Import Hotbox XLSX'}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[#3a424d] overflow-x-auto">
        {TABS.map((t, i) => (
          <div key={t.id} className="flex items-center">
            {t.separator && (
              <div className="flex items-center mr-1 ml-1">
                <div className="w-px h-4 bg-[#3a424d] mx-2" />
                {t.id === 'rep-booking' && (
                  <span className="text-[9px] font-extrabold text-neutral-600 uppercase tracking-widest mr-2 whitespace-nowrap">Reporting</span>
                )}
              </div>
            )}
            <button
              onClick={() => setSubTab(t.id)}
              className={`px-4 py-2.5 text-[12px] font-semibold transition-colors border-b-2 -mb-[1px] whitespace-nowrap ${
                subTab === t.id
                  ? 'border-[#5ec1ca] text-[#5ec1ca]'
                  : 'border-transparent text-neutral-500 hover:text-neutral-300'
              } ${t.id === 'board' ? 'text-amber-400/70 hover:text-amber-400' : ''}`}
            >
              {t.icon ? `${t.icon} ${t.label}` : t.label}
            </button>
          </div>
        ))}
      </div>

      {/* Views */}
      {subTab === 'summary' && <SummaryTab deals={deals} bookings={bookings} takenPlaceList={takenPlaceList} sales={sales} lgKpiCurrent={lgKpiCurrent} />}
      {subTab === 'leadgen' && <LeadGenTab lgKpiCurrent={lgKpiCurrent} lgKpiHistory={lgKpiHistory} hasApiData={hasLgKpiData} />}
      {subTab === 'demos' && (
        <DemoTrackerTab
          bookings={bookings} takenPlaceList={takenPlaceList}
          onAddBooking={() => setBookingModalOpen(true)}
          onMarkTP={(b) => { setTpBooking(b); setTpModalOpen(true); }}
          onDeleteBooking={deleteBooking}
          onAddTP={() => { setTpBooking(null); setTpModalOpen(true); }}
          onDeleteTP={deleteTakenPlace}
        />
      )}
      {subTab === 'hotbox' && (
        <HotboxTab deals={deals} refData={refData}
          onAdd={() => { setEditingDeal(null); setDealModalOpen(true); }}
          onEdit={(d) => { setEditingDeal(d); setDealModalOpen(true); }}
          onDelete={deleteDeal}
        />
      )}
      {subTab === 'monthly' && <MonthlyTab sales={sales} onAdd={() => setSaleModalOpen(true)} onDelete={deleteSale} />}
      {subTab === 'targets' && <TargetsTab targets={targets} sales={sales} bdmKpiData={bdmKpiData} />}
      {subTab === 'rep-booking' && <BookingSummaryTab bookings={bookings} takenPlaceList={takenPlaceList} />}
      {subTab === 'rep-sales' && <SalesSummaryTab sales={sales} bookings={bookings} takenPlaceList={takenPlaceList} />}
      {subTab === 'rep-kpi' && <KpiTrackerTab lgKpiCurrent={lgKpiCurrent} bdmKpiData={bdmKpiData} hasApiData={hasLgKpiData || hasBdmKpiData} />}
      {subTab === 'board' && <BoardPackTab />}

      {/* Modals */}
      <DealModal open={dealModalOpen} onClose={() => { setDealModalOpen(false); setEditingDeal(null); }} onSave={saveDeal} deal={editingDeal} refData={refData} />
      <SaleModal open={saleModalOpen} onClose={() => setSaleModalOpen(false)} onSave={saveSale} refData={refData} />
      <BookingModal open={bookingModalOpen} onClose={() => setBookingModalOpen(false)} onSave={saveBooking} refData={refData} />
      <TakenPlaceModal open={tpModalOpen} onClose={() => { setTpModalOpen(false); setTpBooking(null); }} onSave={saveTakenPlace} booking={tpBooking} refData={refData} />
      <OnboardingModal open={onboardingModalOpen} onClose={() => { setOnboardingModalOpen(false); setOnboardingDeal(null); }} deal={onboardingDeal} />
    </div>
  );
}
