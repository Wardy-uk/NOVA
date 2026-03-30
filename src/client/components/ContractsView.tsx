import { useState, useEffect, useCallback } from 'react';

interface BcCustomer {
  id: number;
  bc_id: string;
  number: string | null;
  display_name: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  currency_code: string | null;
  balance: number | null;
  blocked: string | null;
  last_synced: string;
}

interface Contract {
  id: number;
  bc_customer_id: string | null;
  customer_name: string;
  contract_number: string | null;
  title: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  value: number | null;
  currency: string;
  renewal_type: string | null;
  notes: string | null;
}

interface BcOrder {
  id: string;
  number: string;
  orderDate: string;
  customerNumber: string;
  customerName: string;
  status: string;
  totalAmountIncludingTax: number;
  currencyCode: string;
}

const STATUS_COLOURS: Record<string, string> = {
  active: 'bg-green-900/40 text-green-400 border border-green-800',
  expired: 'bg-red-900/40 text-red-400 border border-red-800',
  pending: 'bg-amber-900/40 text-amber-400 border border-amber-800',
  cancelled: 'bg-neutral-800 text-neutral-500 border border-neutral-700',
};

const ORDER_STATUS_COLOURS: Record<string, string> = {
  Open: 'bg-[#5ec1ca]/10 text-[#5ec1ca] border border-[#5ec1ca]/30',
  Released: 'bg-green-900/40 text-green-400 border border-green-800',
  'Pending Approval': 'bg-amber-900/40 text-amber-400 border border-amber-800',
};

function fmtCurrency(val: number | null, currency = 'GBP') {
  if (val == null) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(val);
}

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

const emptyForm = {
  title: '',
  contract_number: '',
  status: 'active',
  start_date: '',
  end_date: '',
  value: '',
  currency: 'GBP',
  renewal_type: '',
  notes: '',
};

export function ContractsView() {
  const [customers, setCustomers] = useState<BcCustomer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<BcCustomer | null>(null);

  const [contracts, setContracts] = useState<Contract[]>([]);
  const [orders, setOrders] = useState<BcOrder[]>([]);
  const [contractsLoading, setContractsLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [activeTab, setActiveTab] = useState<'contracts' | 'orders'>('contracts');
  const [agreementsByContract, setAgreementsByContract] = useState<Record<number, Array<{ id: number; agreement_id: string; status: string; name: string }>>>({});

  const inputCls = 'bg-[#272C33] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
  const labelCls = 'text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block';

  // Load customers
  const loadCustomers = useCallback(() => {
    const params = new URLSearchParams();
    if (customerSearch.trim()) params.set('search', customerSearch.trim());
    fetch(`/api/contracts/customers?${params}`)
      .then(r => r.json())
      .then(j => { if (j.ok) setCustomers(j.data); });
  }, [customerSearch]);

  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  // Load contracts + orders when customer selected
  useEffect(() => {
    if (!selectedCustomer) { setContracts([]); setOrders([]); return; }

    setContractsLoading(true);
    fetch(`/api/contracts?bc_customer_id=${encodeURIComponent(selectedCustomer.bc_id)}`)
      .then(r => r.json())
      .then(j => {
        if (j.ok) {
          setContracts(j.data);
          // Fetch Adobe Sign agreements linked to these contracts
          for (const c of j.data as Contract[]) {
            fetch(`/api/adobe-sign/agreements?contract_id=${c.id}`)
              .then(r2 => r2.json())
              .then(j2 => {
                if (j2.ok && j2.data.length > 0) {
                  setAgreementsByContract(prev => ({ ...prev, [c.id]: j2.data }));
                }
              })
              .catch(() => {});
          }
        }
      })
      .finally(() => setContractsLoading(false));

    setOrdersLoading(true);
    fetch(`/api/contracts/customers/${encodeURIComponent(selectedCustomer.bc_id)}/orders`)
      .then(r => r.json())
      .then(j => { if (j.ok) setOrders(j.data); })
      .finally(() => setOrdersLoading(false));
  }, [selectedCustomer]);

  const syncFromBc = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch('/api/contracts/bc/sync', { method: 'POST' });
      const j = await res.json();
      if (j.ok) {
        setSyncMsg(`Synced ${j.synced} customers from Business Central`);
        loadCustomers();
      } else {
        setSyncMsg(`Error: ${j.error}`);
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  };

  const openForm = (contract?: Contract) => {
    if (contract) {
      setEditingId(contract.id);
      setForm({
        title: contract.title,
        contract_number: contract.contract_number ?? '',
        status: contract.status,
        start_date: contract.start_date ?? '',
        end_date: contract.end_date ?? '',
        value: contract.value?.toString() ?? '',
        currency: contract.currency,
        renewal_type: contract.renewal_type ?? '',
        notes: contract.notes ?? '',
      });
    } else {
      setEditingId(null);
      setForm(emptyForm);
    }
    setShowForm(true);
  };

  const saveContract = async () => {
    if (!form.title.trim() || !selectedCustomer) return;
    setSaving(true);
    const body = {
      ...form,
      value: form.value ? parseFloat(form.value) : null,
      bc_customer_id: selectedCustomer.bc_id,
      customer_name: selectedCustomer.display_name,
    };
    const url = editingId ? `/api/contracts/${editingId}` : '/api/contracts';
    const method = editingId ? 'PUT' : 'POST';
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setSaving(false);
    setShowForm(false);
    // Reload contracts
    fetch(`/api/contracts?bc_customer_id=${encodeURIComponent(selectedCustomer.bc_id)}`)
      .then(r => r.json())
      .then(j => { if (j.ok) setContracts(j.data); });
  };

  const deleteContract = async (id: number) => {
    if (!confirm('Delete this contract?')) return;
    await fetch(`/api/contracts/${id}`, { method: 'DELETE' });
    setContracts(prev => prev.filter(c => c.id !== id));
  };

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 overflow-hidden rounded-xl border border-[#3a424d]">

      {/* ── Left panel: Customer list ── */}
      <div className="w-72 flex-shrink-0 flex flex-col border-r border-[#3a424d] bg-[#272C33]">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[#3a424d]">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold text-neutral-100">Customers</h2>
            <button
              onClick={syncFromBc}
              disabled={syncing}
              title="Sync customers from Business Central"
              className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-[#2f353d] border border-[#3a424d] text-[#5ec1ca] hover:bg-[#363d47] transition-colors disabled:opacity-50"
            >
              <span className={syncing ? 'animate-spin inline-block' : 'inline-block'}>↻</span>
              {syncing ? 'Syncing…' : 'BC Sync'}
            </button>
          </div>
          {syncMsg && (
            <p className={`text-[10px] mb-2 ${syncMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{syncMsg}</p>
          )}
          <input
            type="text"
            placeholder="Search customers…"
            value={customerSearch}
            onChange={e => setCustomerSearch(e.target.value)}
            className={inputCls}
          />
          <p className="text-[10px] text-neutral-600 mt-1.5">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        </div>

        {/* Customer list */}
        <div className="flex-1 overflow-y-auto">
          {customers.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-neutral-500">No customers.</p>
              <p className="text-[10px] text-neutral-600 mt-1">Use BC Sync to pull from Business Central.</p>
            </div>
          ) : (
            customers.map(c => (
              <button
                key={c.bc_id}
                onClick={() => { setSelectedCustomer(c); setActiveTab('contracts'); }}
                className={`w-full text-left px-4 py-3 border-b border-[#3a424d]/50 transition-colors hover:bg-[#2f353d] ${selectedCustomer?.bc_id === c.bc_id ? 'bg-[#2f353d] border-l-2 border-l-[#5ec1ca]' : ''}`}
              >
                <p className="text-[12px] font-medium text-neutral-100 truncate">{c.display_name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {c.number && <span className="text-[10px] text-neutral-500">{c.number}</span>}
                  {c.city && <span className="text-[10px] text-neutral-600">{c.city}</span>}
                </div>
                {c.blocked && c.blocked !== '' && (
                  <span className="mt-1 inline-block text-[9px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-800">Blocked</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: Contracts / Orders ── */}
      <div className="flex-1 flex flex-col bg-[#2a2f38] overflow-hidden">
        {!selectedCustomer ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-3 opacity-20">📄</div>
              <p className="text-[13px] text-neutral-500">Select a customer to view contracts</p>
            </div>
          </div>
        ) : (
          <>
            {/* Customer header */}
            <div className="px-6 py-4 border-b border-[#3a424d] bg-[#272C33]">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-[16px] font-semibold text-neutral-100">{selectedCustomer.display_name}</h2>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {selectedCustomer.number && <span className="text-[11px] text-neutral-500">#{selectedCustomer.number}</span>}
                    {selectedCustomer.email && <span className="text-[11px] text-neutral-500">{selectedCustomer.email}</span>}
                    {selectedCustomer.phone_number && <span className="text-[11px] text-neutral-500">{selectedCustomer.phone_number}</span>}
                    {selectedCustomer.city && <span className="text-[11px] text-neutral-500">{selectedCustomer.city}{selectedCustomer.country ? `, ${selectedCustomer.country}` : ''}</span>}
                    {selectedCustomer.balance != null && (
                      <span className="text-[11px] text-neutral-400">Balance: <span className="text-neutral-200">{fmtCurrency(selectedCustomer.balance, selectedCustomer.currency_code ?? 'GBP')}</span></span>
                    )}
                  </div>
                </div>
                {activeTab === 'contracts' && (
                  <button
                    onClick={() => openForm()}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded bg-[#5ec1ca]/10 border border-[#5ec1ca]/30 text-[#5ec1ca] hover:bg-[#5ec1ca]/20 transition-colors"
                  >
                    + Add Contract
                  </button>
                )}
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mt-3">
                {(['contracts', 'orders'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 text-[11px] rounded transition-colors capitalize ${activeTab === tab ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30' : 'text-neutral-500 hover:text-neutral-300'}`}
                  >
                    {tab === 'contracts' ? `Contracts (${contracts.length})` : `BC Orders (${orders.length})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">

              {/* ── Contracts tab ── */}
              {activeTab === 'contracts' && (
                <>
                  {contractsLoading ? (
                    <div className="text-center py-12 text-[12px] text-neutral-500">Loading…</div>
                  ) : contracts.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-[12px] text-neutral-500">No contracts for this customer.</p>
                      <button onClick={() => openForm()} className="mt-3 text-[11px] text-[#5ec1ca] hover:underline">+ Add first contract</button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {contracts.map(contract => {
                        const days = daysUntil(contract.end_date);
                        const expiringSoon = days != null && days >= 0 && days <= 60;
                        const expired = days != null && days < 0;
                        return (
                          <div key={contract.id} className="rounded-lg border border-[#3a424d] bg-[#2f353d] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className="text-[13px] font-medium text-neutral-100">{contract.title}</h3>
                                  {contract.contract_number && (
                                    <span className="text-[10px] text-neutral-500">#{contract.contract_number}</span>
                                  )}
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLOURS[contract.status] ?? STATUS_COLOURS.active}`}>
                                    {contract.status}
                                  </span>
                                </div>

                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                                  {contract.value != null && (
                                    <span className="text-[11px] text-neutral-300">{fmtCurrency(contract.value, contract.currency)}</span>
                                  )}
                                  {contract.start_date && (
                                    <span className="text-[11px] text-neutral-500">Start: {fmtDate(contract.start_date)}</span>
                                  )}
                                  {contract.end_date && (
                                    <span className={`text-[11px] ${expired ? 'text-red-400' : expiringSoon ? 'text-amber-400' : 'text-neutral-500'}`}>
                                      End: {fmtDate(contract.end_date)}
                                      {days != null && (
                                        <span className="ml-1">
                                          {expired ? `(expired ${Math.abs(days)}d ago)` : `(${days}d remaining)`}
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  {contract.renewal_type && (
                                    <span className="text-[11px] text-neutral-500">Renewal: {contract.renewal_type}</span>
                                  )}
                                </div>

                                {contract.notes && (
                                  <p className="mt-2 text-[11px] text-neutral-500 leading-relaxed">{contract.notes}</p>
                                )}

                                {/* Adobe Sign agreement status */}
                                {agreementsByContract[contract.id]?.length > 0 && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <span className="text-[10px] text-neutral-500">Adobe Sign:</span>
                                    {agreementsByContract[contract.id].map((ag) => (
                                      <span
                                        key={ag.id}
                                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                                          ag.status === 'SIGNED' || ag.status === 'APPROVED'
                                            ? 'bg-green-900/40 text-green-400 border border-green-800'
                                            : ag.status === 'OUT_FOR_SIGNATURE'
                                            ? 'bg-[#5ec1ca]/10 text-[#5ec1ca] border border-[#5ec1ca]/30'
                                            : ag.status === 'CANCELLED' || ag.status === 'EXPIRED'
                                            ? 'bg-red-900/40 text-red-400 border border-red-800'
                                            : 'bg-amber-900/40 text-amber-400 border border-amber-800'
                                        }`}
                                        title={ag.name}
                                      >
                                        {ag.status.replace(/_/g, ' ')}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="flex gap-1 flex-shrink-0">
                                <button
                                  onClick={() => openForm(contract)}
                                  className="px-2 py-1 text-[10px] rounded bg-[#272C33] border border-[#3a424d] text-neutral-400 hover:text-neutral-200 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteContract(contract.id)}
                                  className="px-2 py-1 text-[10px] rounded bg-[#272C33] border border-[#3a424d] text-neutral-600 hover:text-red-400 transition-colors"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* ── BC Orders tab ── */}
              {activeTab === 'orders' && (
                <>
                  {ordersLoading ? (
                    <div className="text-center py-12 text-[12px] text-neutral-500">Loading…</div>
                  ) : orders.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-[12px] text-neutral-500">No sales orders found in Business Central.</p>
                      <p className="text-[10px] text-neutral-600 mt-1">Ensure BC credentials are configured in Admin &gt; Integrations.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {orders.map(order => (
                        <div key={order.id} className="rounded-lg border border-[#3a424d] bg-[#2f353d] px-4 py-3 flex items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-medium text-neutral-200">Order #{order.number}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${ORDER_STATUS_COLOURS[order.status] ?? 'bg-neutral-800 text-neutral-400 border border-neutral-700'}`}>
                                {order.status}
                              </span>
                            </div>
                            <span className="text-[11px] text-neutral-500 mt-0.5 block">{fmtDate(order.orderDate)}</span>
                          </div>
                          <span className="text-[13px] font-medium text-neutral-200">{fmtCurrency(order.totalAmountIncludingTax, order.currencyCode)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Add/Edit contract modal ── */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-[#272C33] border border-[#3a424d] rounded-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-[14px] font-semibold text-neutral-100 mb-4">{editingId ? 'Edit Contract' : 'Add Contract'}</h3>

            <div className="space-y-3">
              <div>
                <label className={labelCls}>Title *</label>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Contract title" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Contract Number</label>
                  <input value={form.contract_number} onChange={e => setForm(p => ({ ...p, contract_number: e.target.value }))} placeholder="e.g. C-2024-001" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={inputCls}>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="expired">Expired</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End Date</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Value</label>
                  <input type="number" value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Currency</label>
                  <select value={form.currency} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} className={inputCls}>
                    <option value="GBP">GBP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>Renewal Type</label>
                <input value={form.renewal_type} onChange={e => setForm(p => ({ ...p, renewal_type: e.target.value }))} placeholder="e.g. Annual, Monthly, One-off" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes…" rows={3} className={`${inputCls} resize-none`} />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-[11px] rounded bg-[#2f353d] border border-[#3a424d] text-neutral-400 hover:text-neutral-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={saveContract}
                disabled={saving || !form.title.trim()}
                className="px-4 py-1.5 text-[11px] rounded bg-[#5ec1ca]/15 border border-[#5ec1ca]/40 text-[#5ec1ca] hover:bg-[#5ec1ca]/25 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Contract'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
