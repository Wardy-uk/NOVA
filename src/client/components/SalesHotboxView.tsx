import { useState, useEffect, useCallback } from 'react';

/* ── Types ── */

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

interface RefData {
  salespeople: string[];
  products: string[];
  stages: string[];
}

type SubTab = 'summary' | 'hotbox' | 'monthly' | 'targets';

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

/* ── Helpers ── */

const fmt = (n: number | null | undefined) =>
  n == null ? '—' : `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtS = (n: number) =>
  `£${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;
const today = new Date().toISOString().split('T')[0];

const TH = 'px-3 py-2.5 text-left text-[10px] uppercase tracking-wider text-neutral-500 font-bold bg-[#1e2228] border-b border-[#2f353d]';
const TD = 'px-3 py-2.5 text-[13px] text-neutral-300 border-b border-[#2f353d]';
const TDR = `${TD} text-right`;

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

/* ── Modal ── */

function DealModal({
  open, onClose, onSave, deal, refData,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<PipelineDeal>) => void;
  deal: Partial<PipelineDeal> | null;
  refData: RefData;
}) {
  const [form, setForm] = useState<Partial<PipelineDeal>>({});
  useEffect(() => { if (open) setForm(deal || {}); }, [open, deal]);
  if (!open) return null;

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const isEdit = !!deal?.id;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#272C33] border border-[#3a424d] rounded-2xl p-7 w-[640px] max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-base font-bold text-neutral-100">{isEdit ? 'Edit Deal' : 'Add New Deal'}</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-lg">✕</button>
        </div>
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
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  value={(form as any)[f.key] || ''}
                  onChange={e => set(f.key, e.target.value)}
                  className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca]"
                >
                  <option value="">— Select —</option>
                  {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type}
                  value={(form as any)[f.key] ?? ''}
                  onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                  className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca]"
                />
              )}
            </div>
          ))}
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Notes</label>
            <input
              value={form.notes || ''}
              onChange={e => set('notes', e.target.value)}
              className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca]"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 border border-[#3a424d] rounded-lg text-neutral-500 hover:border-[#5ec1ca] hover:text-[#5ec1ca] text-[13px] font-semibold transition-colors">Cancel</button>
          <button
            onClick={() => { if (form.company && form.mrr && form.stage && form.salesperson) onSave(form); }}
            className="px-5 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[13px] hover:bg-[#4db0b9] transition-colors"
          >
            {isEdit ? 'Save Changes' : 'Add Deal'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SaleModal({
  open, onClose, onSave, refData,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<MonthlySale>) => void;
  refData: RefData;
}) {
  const [form, setForm] = useState<Partial<MonthlySale>>({ sale_date: today, branches: 1 });
  useEffect(() => { if (open) setForm({ sale_date: today, branches: 1 }); }, [open]);
  if (!open) return null;

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#272C33] border border-[#3a424d] rounded-2xl p-7 w-[660px] max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-base font-bold text-neutral-100">Log Contracted Sale</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-200 text-lg">✕</button>
        </div>
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
              <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">{f.label}</label>
              {f.type === 'select' ? (
                <select
                  value={(form as any)[f.key] || ''}
                  onChange={e => set(f.key, e.target.value)}
                  className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca]"
                >
                  <option value="">— Select —</option>
                  {f.options!.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={f.type}
                  value={(form as any)[f.key] ?? ''}
                  onChange={e => set(f.key, f.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                  className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca]"
                />
              )}
            </div>
          ))}
          <div className="col-span-2 flex flex-col gap-1">
            <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">Net New vs Existing</label>
            <select
              value={form.existing_vs_new || ''}
              onChange={e => set('existing_vs_new', e.target.value)}
              className="bg-[#1e2228] border border-[#3a424d] rounded-lg px-3 py-2 text-[13px] text-neutral-200 outline-none focus:border-[#5ec1ca]"
            >
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
          <button
            onClick={() => { if (form.sale_date && form.salesperson && form.actual_mrr) onSave(form); }}
            className="px-5 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[13px] hover:bg-[#4db0b9] transition-colors"
          >
            Log Sale
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Pipeline Summary Tab                                                     */
/* ══════════════════════════════════════════════════════════════════════════ */

function SummaryTab({ deals }: { deals: PipelineDeal[] }) {
  const total = deals.reduce((s, d) => s + d.mrr, 0);
  const contracts = deals.filter(d => d.stage === 'Contract Sent').reduce((s, d) => s + d.mrr, 0);
  const discussion = deals.filter(d => d.stage.includes('Discussion')).reduce((s, d) => s + d.mrr, 0);
  const reps = new Set(deals.map(d => d.salesperson)).size;

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
      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard label="Total Pipeline" value={fmtS(total)} color="#5ec1ca" sub={`${deals.length} active deals`} />
        <KpiCard label="Contracts Out" value={fmtS(contracts)} color="#10b981" sub="Ready to close" />
        <KpiCard label="In Discussion" value={fmtS(discussion)} color="#7c3aed" sub="Proposal stage" />
        <KpiCard label="Salespeople" value={String(reps)} sub="With active deals" />
      </div>

      <div className="flex gap-5 flex-wrap">
        {/* By person table */}
        <div className="flex-[2] min-w-[300px] border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] overflow-hidden">
          <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider px-5 py-3 border-b border-[#2f353d]">Pipeline by Salesperson</div>
          <table className="w-full border-collapse">
            <thead><tr>
              <th className={TH}>Person</th>
              {STAGES.map(s => <th key={s} className={`${TH} text-right`}>{STAGE_SHORT[s]}</th>)}
              <th className={`${TH} text-right`}>Total</th>
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
            </tbody>
          </table>
        </div>

        {/* By product bars */}
        <div className="flex-1 min-w-[240px] border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] p-5">
          <div className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider mb-4">Pipeline by Product</div>
          {productRows.map(([prod, val]) => (
            <div key={prod} className="mb-3">
              <div className="flex justify-between mb-1">
                <span className="text-[12px] text-neutral-400">{prod}</span>
                <span className="text-[12px] font-bold text-neutral-200">{fmtS(val)}</span>
              </div>
              <div className="bg-[#1e2228] rounded h-1.5 overflow-hidden">
                <div className="h-full rounded bg-[#5ec1ca] transition-all duration-500" style={{ width: `${total > 0 ? Math.min(100, (val / total) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
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
      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap mb-5 items-center">
        {['All', ...salespeople].map(p => (
          <button
            key={p}
            onClick={() => setActivePerson(p)}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
              activePerson === p
                ? 'border-[#5ec1ca] bg-[#5ec1ca]/15 text-[#5ec1ca]'
                : 'border-[#3a424d] bg-[#272C33] text-neutral-500 hover:border-[#5ec1ca]/50 hover:text-neutral-300'
            }`}
          >
            {p}
          </button>
        ))}
        <button
          onClick={onAdd}
          className="ml-auto px-4 py-1.5 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[12px] hover:bg-[#4db0b9] transition-colors"
        >
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

      {/* Deal table */}
      <div className="border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] overflow-x-auto">
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

  const typeBadge = (v: string | null) => {
    const isNew = (v || '').includes('Net New');
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
        background: isNew ? '#10b98122' : '#f59e0b22',
        color: isNew ? '#10b981' : '#f59e0b',
      }}>{v || '—'}</span>
    );
  };

  return (
    <div>
      <div className="flex gap-4 flex-wrap mb-6 items-center">
        <KpiCard label="Total MRR" value={fmtS(tMrr)} color="#5ec1ca" sub={`${sales.length} contracts`} />
        <KpiCard label="Total Setup" value={fmtS(tSetup)} color="#f59e0b" />
        <KpiCard label="Total Licence" value={fmtS(tLicence)} color="#7c3aed" />
        <KpiCard label="Total Coms" value={fmtS(tComs)} color="#10b981" />
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-[#5ec1ca] text-[#1e2228] font-bold rounded-lg text-[12px] hover:bg-[#4db0b9] transition-colors self-center"
        >
          + Log Sale
        </button>
      </div>

      <div className="border border-[#2f353d] rounded-xl bg-[rgba(255,255,255,0.03)] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead><tr>
            {['Date', 'Lead Gen', 'Salesperson', 'Product', 'Trading Name', 'Email', 'Setup', 'Licence', 'Postal', 'Coms', 'Trial', 'MRR', 'Type', ''].map(h => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
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
                <td className={TD}>{typeBadge(s.existing_vs_new)}</td>
                <td className={TD}>
                  <button onClick={() => onDelete(s.id)} className="px-2 py-1 text-[11px] border border-red-900/30 rounded text-red-500 hover:text-red-400">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
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
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  Targets Tab                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

function TargetsTab({ targets, sales }: { targets: SalesTarget[]; sales: MonthlySale[] }) {
  // Compute closed MRR per person from sales
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

  return (
    <div>
      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard label="Total MRR Closed" value={fmtS(totalClosed)} color="#5ec1ca" sub={new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })} />
        <KpiCard label="Combined Target" value={fmtS(totalTarget)} />
        <KpiCard label="Team Hit Rate" value={`${teamRate}%`} color={teamRate >= 100 ? '#10b981' : '#f59e0b'} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
        {targets.map(t => {
          const closed = closedByPerson[t.salesperson] || { setup: 0, licence: 0, coms: 0, total: 0 };
          const pct = t.target_mrr > 0 ? Math.min(100, (closed.total / t.target_mrr) * 100) : 0;
          const hit = pct >= 100;

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
                <span className="text-[12px] font-bold" style={{ color: hit ? '#10b981' : '#f59e0b' }}>{pct.toFixed(1)}%</span>
              </div>
              <div className="bg-[#1e2228] rounded-md h-2 overflow-hidden">
                <div className="h-full rounded-md transition-all duration-600" style={{ width: `${pct}%`, background: hit ? '#10b981' : '#5ec1ca' }} />
              </div>

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
/*  Main Component                                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

export function SalesHotboxView({ canWrite = false }: { canWrite?: boolean }) {
  const [subTab, setSubTab] = useState<SubTab>('summary');
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [sales, setSales] = useState<MonthlySale[]>([]);
  const [targets, setTargets] = useState<SalesTarget[]>([]);
  const [refData, setRefData] = useState<RefData>({ salespeople: [], products: [], stages: [] });
  const [loading, setLoading] = useState(true);

  // Modals
  const [dealModalOpen, setDealModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [saleModalOpen, setSaleModalOpen] = useState(false);

  // Import
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [pRes, mRes, tRes, rRes] = await Promise.all([
        fetch('/api/sales/pipeline'),
        fetch('/api/sales/monthly'),
        fetch('/api/sales/targets'),
        fetch('/api/sales/reference'),
      ]);
      const [pData, mData, tData, rData] = await Promise.all([pRes.json(), mRes.json(), tRes.json(), rRes.json()]);
      if (pData.ok) setDeals(pData.data);
      if (mData.ok) setSales(mData.data);
      if (tData.ok) setTargets(tData.data);
      if (rData.ok) setRefData(rData.data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── CRUD handlers ──

  const saveDeal = async (data: Partial<PipelineDeal>) => {
    const isEdit = !!data.id;
    const res = await fetch(`/api/sales/pipeline${isEdit ? `/${data.id}` : ''}`, {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if ((await res.json()).ok) {
      setDealModalOpen(false);
      setEditingDeal(null);
      fetchAll();
    }
  };

  const deleteDeal = async (id: number) => {
    if (!confirm('Remove this deal?')) return;
    await fetch(`/api/sales/pipeline/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const saveSale = async (data: Partial<MonthlySale>) => {
    const res = await fetch('/api/sales/monthly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if ((await res.json()).ok) {
      setSaleModalOpen(false);
      fetchAll();
    }
  };

  const deleteSale = async (id: number) => {
    if (!confirm('Remove this sale?')) return;
    await fetch(`/api/sales/monthly/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const runImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportResult(null);
      try {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // strip data:...;base64, prefix
          };
          reader.readAsDataURL(file);
        });
        const res = await fetch('/api/sales/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileData: base64, clear: true }),
        });
        const json = await res.json();
        if (json.ok) {
          setImportResult(`Imported: ${json.data.deals} deals, ${json.data.sales} sales, ${json.data.targets} targets`);
          fetchAll();
        } else {
          setImportResult(`Error: ${json.error}`);
        }
      } catch (err) {
        setImportResult(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  if (loading) {
    return <div className="py-20 text-center text-neutral-500">Loading sales data...</div>;
  }

  const TABS: { id: SubTab; label: string; icon: string }[] = [
    { id: 'summary', label: 'Pipeline Summary', icon: '◈' },
    { id: 'hotbox', label: 'Hotbox', icon: '⬡' },
    { id: 'monthly', label: 'Monthly Sales', icon: '◎' },
    { id: 'targets', label: 'Targets', icon: '◉' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">Sales Dashboard</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">Track pipeline, log sales, and manage targets</p>
        </div>
        <div className="flex items-center gap-2">
          {importResult && (
            <span className={`text-[11px] px-3 py-1 rounded-lg ${importResult.startsWith('Error') ? 'bg-red-900/20 text-red-400' : 'bg-green-900/20 text-green-400'}`}>
              {importResult}
            </span>
          )}
          <button
            onClick={runImport}
            disabled={importing}
            className="px-3 py-1.5 text-[11px] border border-[#3a424d] rounded-lg text-neutral-500 hover:text-[#5ec1ca] hover:border-[#5ec1ca] transition-colors disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Import from XLSX'}
          </button>
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex gap-1 border-b border-[#3a424d]">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-4 py-2.5 text-[12px] font-semibold transition-colors border-b-2 -mb-[1px] ${
              subTab === t.id
                ? 'border-[#5ec1ca] text-[#5ec1ca]'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Views */}
      {subTab === 'summary' && <SummaryTab deals={deals} />}
      {subTab === 'hotbox' && (
        <HotboxTab
          deals={deals}
          refData={refData}
          onAdd={() => { setEditingDeal(null); setDealModalOpen(true); }}
          onEdit={(d) => { setEditingDeal(d); setDealModalOpen(true); }}
          onDelete={deleteDeal}
        />
      )}
      {subTab === 'monthly' && (
        <MonthlyTab
          sales={sales}
          onAdd={() => setSaleModalOpen(true)}
          onDelete={deleteSale}
        />
      )}
      {subTab === 'targets' && <TargetsTab targets={targets} sales={sales} />}

      {/* Modals */}
      <DealModal
        open={dealModalOpen}
        onClose={() => { setDealModalOpen(false); setEditingDeal(null); }}
        onSave={saveDeal}
        deal={editingDeal}
        refData={refData}
      />
      <SaleModal
        open={saleModalOpen}
        onClose={() => setSaleModalOpen(false)}
        onSave={saveSale}
        refData={refData}
      />
    </div>
  );
}
