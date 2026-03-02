import { useState, useEffect, useCallback } from 'react';

interface OverdueDelivery {
  delivery_id: number;
  onboarding_id: string | null;
  account: string;
  product: string;
  onboarder: string | null;
  status: string;
  go_live_date: string | null;
  overdue_count: number;
  total_count: number;
  complete_count: number;
  oldest_overdue_name: string;
  oldest_overdue_date: string;
}

interface BackfillResult {
  created: number;
  skipped: number;
  total: number;
}

function daysLate(dateStr: string): number {
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
}

export function OverdueDeliveriesView() {
  const [data, setData] = useState<OverdueDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Backfill state
  const [products, setProducts] = useState<string[]>([]);
  const [saleTypes, setSaleTypes] = useState<Array<{ id: number; name: string }>>([]);
  const [bfProduct, setBfProduct] = useState('');
  const [bfSaleType, setBfSaleType] = useState('');
  const [bfRunning, setBfRunning] = useState(false);
  const [bfResult, setBfResult] = useState<BackfillResult | null>(null);
  const [bfError, setBfError] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    fetch('/api/milestones/overdue-deliveries')
      .then(r => r.json())
      .then(json => {
        if (json.ok) setData(json.data);
        else setError(json.error ?? 'Failed to load overdue deliveries');
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Load products and sale types for backfill dropdowns
  useEffect(() => {
    fetch('/api/delivery/entries')
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data) {
          const prods = [...new Set((json.data as Array<{ product: string }>).map(e => e.product))].sort();
          setProducts(prods);
        }
      })
      .catch(() => {});
    fetch('/api/onboarding/config/sale-types')
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data) setSaleTypes(json.data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => { loadData(); };
    window.addEventListener('nova-refresh', handler);
    return () => window.removeEventListener('nova-refresh', handler);
  }, [loadData]);

  const handleBackfill = async () => {
    setBfRunning(true);
    setBfResult(null);
    setBfError(null);
    try {
      const body: Record<string, string> = {};
      if (bfProduct) body.product = bfProduct;
      if (bfSaleType) body.saleType = bfSaleType;
      const res = await fetch('/api/milestones/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        setBfResult(json.data);
        loadData(); // refresh the table
      } else {
        setBfError(json.error ?? 'Backfill failed');
      }
    } catch (err) {
      setBfError(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setBfRunning(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading overdue deliveries...</div>;
  }
  if (error) {
    return <div className="text-sm text-red-400 py-8 text-center">{error}</div>;
  }

  const totalOverdueMilestones = data.reduce((sum, d) => sum + d.overdue_count, 0);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Deliveries With Overdue</div>
          <div className="text-xl font-bold text-red-400">{data.length}</div>
        </div>
        <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-3">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Total Overdue Milestones</div>
          <div className="text-xl font-bold text-red-400">{totalOverdueMilestones}</div>
        </div>
      </div>

      {/* Backfill milestones */}
      <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-4">
        <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-3">Apply Milestones</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] text-neutral-500 mb-1">Product</label>
            <select
              value={bfProduct}
              onChange={(e) => setBfProduct(e.target.value)}
              className="bg-[#272C33] border border-[#3a424d] rounded px-2 py-1.5 text-xs text-neutral-200"
            >
              <option value="">All products</option>
              {products.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 mb-1">Sale Type (for day offsets)</label>
            <select
              value={bfSaleType}
              onChange={(e) => setBfSaleType(e.target.value)}
              className="bg-[#272C33] border border-[#3a424d] rounded px-2 py-1.5 text-xs text-neutral-200"
            >
              <option value="">Default offsets</option>
              {saleTypes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <button
            onClick={handleBackfill}
            disabled={bfRunning}
            className="px-4 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
          >
            {bfRunning ? 'Running...' : 'Backfill Milestones'}
          </button>
          {bfResult && (
            <span className="text-xs text-green-400">
              Created for {bfResult.created} deliveries, skipped {bfResult.skipped} (already had milestones)
            </span>
          )}
          {bfError && <span className="text-xs text-red-400">{bfError}</span>}
        </div>
        <div className="text-[10px] text-neutral-600 mt-2">
          Only applies to deliveries with no existing milestones. Existing milestones are never modified or deleted.
        </div>
      </div>

      {data.length === 0 ? (
        <div className="text-sm text-neutral-500 py-8 text-center">No overdue milestones — all on track.</div>
      ) : (
        <div className="border border-[#3a424d] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#272C33] text-neutral-500 uppercase tracking-wider text-[10px]">
                <th className="text-left px-3 py-2">ID</th>
                <th className="text-left px-3 py-2">Account</th>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-left px-3 py-2">Onboarder</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-center px-3 py-2">Overdue</th>
                <th className="text-center px-3 py-2">Progress</th>
                <th className="text-left px-3 py-2">Oldest Overdue Milestone</th>
                <th className="text-right px-3 py-2">Days Late</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#3a424d]">
              {data.map((d) => {
                const late = d.oldest_overdue_date ? daysLate(d.oldest_overdue_date) : 0;
                return (
                  <tr key={d.delivery_id} className="bg-[#2f353d] hover:bg-[#363d47] transition-colors">
                    <td className="px-3 py-2 text-neutral-400 font-mono">{d.onboarding_id ?? '-'}</td>
                    <td className="px-3 py-2 text-neutral-200 font-medium">{d.account}</td>
                    <td className="px-3 py-2 text-neutral-400">{d.product}</td>
                    <td className="px-3 py-2 text-neutral-400">{d.onboarder ?? '-'}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#272C33] text-neutral-400">
                        {d.status || '-'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-900/50 text-red-400">
                        {d.overdue_count}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-neutral-500">
                      {d.complete_count}/{d.total_count}
                    </td>
                    <td className="px-3 py-2 text-neutral-300">
                      <div>{d.oldest_overdue_name}</div>
                      <div className="text-[10px] text-neutral-600">
                        due {d.oldest_overdue_date}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`font-bold ${late >= 14 ? 'text-red-400' : late >= 7 ? 'text-amber-400' : 'text-yellow-500'}`}>
                        {late}d
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
