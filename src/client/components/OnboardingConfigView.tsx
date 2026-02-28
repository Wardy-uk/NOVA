import { useState, useEffect, useCallback } from 'react';

type Tab = 'sale-types' | 'capabilities' | 'matrix' | 'items' | 'ticket-groups' | 'milestone-links' | 'create-tickets';

interface TicketGroup { id: number; name: string; sort_order: number; active: number; }
interface SaleType { id: number; name: string; sort_order: number; active: number; jira_tickets_required?: number; }
interface Capability { id: number; name: string; code: string | null; ticket_group_id: number | null; ticket_group_name?: string; sort_order: number; active: number; item_count?: number; }
interface MatrixCell { sale_type_id: number; capability_id: number; enabled: number; notes: string | null; }
interface CapItem { id: number; capability_id: number; name: string; is_bolt_on: number; sort_order: number; active: number; }

interface MilestoneTemplate { id: number; name: string; day_offset: number; sort_order: number; lead_days: number; active: number; }
interface TemplateTgMapping { template_id: number; ticket_group_id: number; }

const BASE = '/api/onboarding/config';

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data as T;
}

export function OnboardingConfigView({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('matrix');
  const [ticketGroups, setTicketGroups] = useState<TicketGroup[]>([]);
  const [saleTypes, setSaleTypes] = useState<SaleType[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [cells, setCells] = useState<MatrixCell[]>([]);
  const [items, setItems] = useState<CapItem[]>([]);
  const [selectedCapId, setSelectedCapId] = useState<number | null>(null);
  const [matrixSaleTypeFilter, setMatrixSaleTypeFilter] = useState<number | null>(null);
  const [milestoneTemplates, setMilestoneTemplates] = useState<MilestoneTemplate[]>([]);
  const [templateTgMappings, setTemplateTgMappings] = useState<TemplateTgMapping[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const loadMatrix = useCallback(async () => {
    const data = await api<{ saleTypes: SaleType[]; capabilities: Capability[]; cells: MatrixCell[]; ticketGroups: TicketGroup[] }>('/matrix');
    setSaleTypes(data.saleTypes);
    setCapabilities(data.capabilities);
    setCells(data.cells);
    setTicketGroups(data.ticketGroups);
  }, []);

  const loadSaleTypes = useCallback(async () => {
    setSaleTypes(await api<SaleType[]>('/sale-types'));
  }, []);

  const loadCapabilities = useCallback(async () => {
    setCapabilities(await api<Capability[]>('/capabilities'));
  }, []);

  const loadTicketGroups = useCallback(async () => {
    setTicketGroups(await api<TicketGroup[]>('/ticket-groups'));
  }, []);

  const loadItems = useCallback(async (capId: number) => {
    setItems(await api<CapItem[]>(`/capabilities/${capId}/items`));
  }, []);

  const loadMilestoneTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/milestones/templates');
      const json = await res.json();
      if (json.ok) setMilestoneTemplates(json.data);
    } catch { /* ignore */ }
  }, []);

  const loadTemplateTgMappings = useCallback(async () => {
    try {
      const res = await fetch('/api/milestones/template-groups');
      const json = await res.json();
      if (json.ok) setTemplateTgMappings(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  useEffect(() => {
    if (tab === 'items' && selectedCapId) loadItems(selectedCapId);
  }, [tab, selectedCapId, loadItems]);

  useEffect(() => {
    if (tab === 'milestone-links') {
      loadMilestoneTemplates();
      loadTemplateTgMappings();
      loadTicketGroups();
    }
  }, [tab, loadMilestoneTemplates, loadTemplateTgMappings, loadTicketGroups]);

  // ── Import xlsx ──
  const handleImport = async () => {
    if (!confirm('This will replace all onboarding configuration with data from the xlsx file. Continue?')) return;
    setImporting(true);
    setImportResult(null);
    try {
      const data = await api<{ ticketGroups: number; saleTypes: number; capabilities: number; matrixCells: number; items: number }>(
        '/import-xlsx', { method: 'POST' }
      );
      setImportResult(`Imported: ${data.ticketGroups} ticket groups, ${data.saleTypes} sale types, ${data.capabilities} capabilities, ${data.matrixCells} matrix cells, ${data.items} items`);
      loadMatrix();
      loadCapabilities();
      loadTicketGroups();
    } catch (err) {
      setImportResult(`Error: ${err instanceof Error ? err.message : 'Import failed'}`);
    }
    setImporting(false);
  };

  // ── Matrix cell toggle ──
  const toggleCell = async (stId: number, capId: number) => {
    const existing = cells.find(c => c.sale_type_id === stId && c.capability_id === capId);
    const newEnabled = existing ? !existing.enabled : true;

    // Optimistic update
    setCells(prev => {
      const idx = prev.findIndex(c => c.sale_type_id === stId && c.capability_id === capId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], enabled: newEnabled ? 1 : 0 };
        return updated;
      }
      return [...prev, { sale_type_id: stId, capability_id: capId, enabled: newEnabled ? 1 : 0, notes: null }];
    });

    await api('/matrix', {
      method: 'PUT',
      body: JSON.stringify({ updates: [{ sale_type_id: stId, capability_id: capId, enabled: newEnabled }] }),
    });
  };

  const isCellEnabled = (stId: number, capId: number) => {
    const cell = cells.find(c => c.sale_type_id === stId && c.capability_id === capId);
    return cell?.enabled === 1;
  };

  const getCellNotes = (stId: number, capId: number) => {
    const cell = cells.find(c => c.sale_type_id === stId && c.capability_id === capId);
    return cell?.notes ?? null;
  };

  // ── CRUD helpers ──
  const addSaleType = async () => {
    if (!newName.trim()) return;
    await api('/sale-types', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
    setNewName('');
    loadSaleTypes();
    loadMatrix();
  };

  const deleteSaleType = async (id: number) => {
    if (!confirm('Delete this sale type and all its matrix entries?')) return;
    await api(`/sale-types/${id}`, { method: 'DELETE' });
    loadSaleTypes();
    loadMatrix();
  };

  const toggleSaleTypeActive = async (st: SaleType) => {
    await api(`/sale-types/${st.id}`, { method: 'PUT', body: JSON.stringify({ active: st.active ? 0 : 1 }) });
    loadSaleTypes();
    loadMatrix();
  };

  const addCapability = async () => {
    if (!newName.trim()) return;
    await api('/capabilities', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
    setNewName('');
    loadCapabilities();
    loadMatrix();
  };

  const deleteCapability = async (id: number) => {
    if (!confirm('Delete this capability, its items, and all matrix entries?')) return;
    await api(`/capabilities/${id}`, { method: 'DELETE' });
    loadCapabilities();
    loadMatrix();
  };

  const toggleCapActive = async (cap: Capability) => {
    await api(`/capabilities/${cap.id}`, { method: 'PUT', body: JSON.stringify({ active: cap.active ? 0 : 1 }) });
    loadCapabilities();
    loadMatrix();
  };

  const addItem = async () => {
    if (!newName.trim() || !selectedCapId) return;
    await api(`/capabilities/${selectedCapId}/items`, { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
    setNewName('');
    loadItems(selectedCapId);
  };

  const deleteItem = async (id: number) => {
    await api(`/items/${id}`, { method: 'DELETE' });
    if (selectedCapId) loadItems(selectedCapId);
  };

  const toggleItemBoltOn = async (item: CapItem) => {
    await api(`/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ is_bolt_on: item.is_bolt_on ? 0 : 1 }) });
    if (selectedCapId) loadItems(selectedCapId);
  };

  const toggleItemActive = async (item: CapItem) => {
    await api(`/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ active: item.active ? 0 : 1 }) });
    if (selectedCapId) loadItems(selectedCapId);
  };

  const addTicketGroup = async () => {
    if (!newName.trim()) return;
    await api('/ticket-groups', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) });
    setNewName('');
    loadTicketGroups();
    loadMatrix();
  };

  const deleteTicketGroup = async (id: number) => {
    if (!confirm('Delete this ticket group? Capabilities will be unlinked.')) return;
    await api(`/ticket-groups/${id}`, { method: 'DELETE' });
    loadTicketGroups();
    loadCapabilities();
    loadMatrix();
  };

  const toggleTicketGroupActive = async (tg: TicketGroup) => {
    await api(`/ticket-groups/${tg.id}`, { method: 'PUT', body: JSON.stringify({ active: tg.active ? 0 : 1 }) });
    loadTicketGroups();
    loadMatrix();
  };

  // ── Create Tickets state ──
  const [ctSaleType, setCtSaleType] = useState('');
  const [ctCustomerName, setCtCustomerName] = useState('');
  const [ctOnboardingRef, setCtOnboardingRef] = useState('');
  const [ctDueDate, setCtDueDate] = useState('');
  const [ctDryRun, setCtDryRun] = useState(true);
  const [ctSubmitting, setCtSubmitting] = useState(false);
  const [ctResult, setCtResult] = useState<null | {
    parentKey: string;
    childKeys: string[];
    createdCount: number;
    linkedCount: number;
    existing: boolean;
    dryRun: boolean;
    details?: { parentSummary: string; childSummaries: string[] };
  }>(null);
  const [ctError, setCtError] = useState<string | null>(null);
  const [ctRuns, setCtRuns] = useState<Array<{
    id: number; onboarding_ref: string; status: string; parent_key: string | null;
    child_keys: string | null; created_count: number; dry_run: number; created_at: string;
  }>>([]);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/runs?limit=10');
      const json = await res.json();
      if (json.ok) setCtRuns(json.data);
    } catch { /* ignore */ }
  }, []);

  const loadNextRef = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/next-ref?prefix=BYM');
      const json = await res.json();
      if (json.ok && json.data?.suggestedRef) {
        setCtOnboardingRef(json.data.suggestedRef);
      }
    } catch { /* ignore */ }
  }, []);

  const handleCreateTickets = async () => {
    if (!ctSaleType || !ctCustomerName.trim() || !ctOnboardingRef.trim() || !ctDueDate) return;
    setCtSubmitting(true);
    setCtResult(null);
    setCtError(null);
    try {
      const url = `/api/onboarding/create-tickets${ctDryRun ? '?dryRun=true' : ''}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          saleType: ctSaleType,
          customer: { name: ctCustomerName.trim() },
          onboardingRef: ctOnboardingRef.trim(),
          targetDueDate: ctDueDate,
          config: {},
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setCtResult(json.data);
        loadRuns();
      } else {
        setCtError(json.error || 'Request failed');
      }
    } catch (err) {
      setCtError(err instanceof Error ? err.message : 'Network error');
    }
    setCtSubmitting(false);
  };

  useEffect(() => {
    if (tab === 'create-tickets') {
      loadRuns();
      if (!ctOnboardingRef) loadNextRef();
    }
  }, [tab, loadRuns, loadNextRef, ctOnboardingRef]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'matrix', label: 'Matrix' },
    { key: 'sale-types', label: 'Sale Types' },
    { key: 'ticket-groups', label: 'Ticket Groups' },
    { key: 'capabilities', label: 'Capabilities' },
    { key: 'items', label: 'Items' },
    { key: 'milestone-links', label: 'Milestone Links' },
    ...(!readOnly ? [{ key: 'create-tickets' as Tab, label: 'Create Tickets' }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-neutral-100">Onboarding Configuration</h2>
        {!readOnly && (
          <button
            onClick={handleImport}
            disabled={importing}
            className="px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
          >
            {importing ? 'Importing...' : 'Import from xlsx'}
          </button>
        )}
      </div>
      {readOnly && (
        <div className="px-3 py-2 text-xs rounded bg-[#272C33] border border-[#3a424d] text-neutral-400">
          Read-only view. Edit in <span className="text-[#5ec1ca] font-medium">Admin &rarr; Onboarding</span>.
        </div>
      )}

      {importResult && (
        <div className={`p-2 text-xs rounded ${importResult.startsWith('Error') ? 'bg-red-950/50 text-red-400 border border-red-900' : 'bg-green-950/50 text-green-400 border border-green-900'}`}>
          {importResult}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#3a424d] pb-px">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setNewName(''); }}
            className={`px-4 py-2 text-xs rounded-t transition-colors ${
              tab === t.key
                ? 'bg-[#2f353d] text-[#5ec1ca] border-b-2 border-[#5ec1ca] font-semibold'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
        {tab === 'matrix' && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <label className="text-[10px] text-neutral-500 uppercase tracking-wider">Filter Sale Type</label>
              <select
                value={matrixSaleTypeFilter ?? ''}
                onChange={(e) => setMatrixSaleTypeFilter(e.target.value ? Number(e.target.value) : null)}
                className="px-2.5 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
              >
                <option value="">All Sale Types</option>
                {saleTypes.filter(st => st.active).map(st => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>
            <MatrixGrid
              saleTypes={matrixSaleTypeFilter ? saleTypes.filter(st => st.id === matrixSaleTypeFilter) : saleTypes}
              capabilities={capabilities}
              ticketGroups={ticketGroups}
              isCellEnabled={isCellEnabled}
              getCellNotes={getCellNotes}
              onToggle={readOnly ? undefined : toggleCell}
              readOnly={readOnly}
            />
          </div>
        )}

        {tab === 'sale-types' && (
          <div className="space-y-3">
            {!readOnly && (
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addSaleType()}
                  placeholder="New sale type name..."
                  className="flex-1 px-3 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500"
                />
                <button onClick={addSaleType} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9]">
                  Add
                </button>
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 border-b border-[#3a424d]">
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2 w-20">Order</th>
                  <th className="text-center py-2 px-2 w-20">Active</th>
                  {!readOnly && <th className="text-center py-2 px-2 w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {saleTypes.map(st => (
                  <tr key={st.id} className={`border-b border-[#3a424d]/50 ${!st.active ? 'opacity-40' : ''}`}>
                    <td className="py-1.5 px-2 text-neutral-200">{st.name}</td>
                    <td className="py-1.5 px-2 text-neutral-400">{st.sort_order}</td>
                    <td className="py-1.5 px-2 text-center">
                      {readOnly ? (
                        <span className={`text-[10px] ${st.active ? 'text-green-400' : 'text-neutral-500'}`}>
                          {st.active ? '\u2713' : '\u2717'}
                        </span>
                      ) : (
                        <button onClick={() => toggleSaleTypeActive(st)} className={`w-5 h-5 rounded text-[10px] ${st.active ? 'bg-green-900/50 text-green-400' : 'bg-neutral-700 text-neutral-500'}`}>
                          {st.active ? '\u2713' : '\u2717'}
                        </button>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="py-1.5 px-2 text-center">
                        <button onClick={() => deleteSaleType(st.id)} className="text-red-500 hover:text-red-400 text-[10px]">{'\u2715'}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {saleTypes.length === 0 && <div className="text-center text-neutral-500 text-xs py-4">No sale types. Import from xlsx or add manually.</div>}
          </div>
        )}

        {tab === 'ticket-groups' && (
          <div className="space-y-3">
            {!readOnly && (
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addTicketGroup()}
                  placeholder="New ticket group name..."
                  className="flex-1 px-3 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500"
                />
                <button onClick={addTicketGroup} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9]">
                  Add
                </button>
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 border-b border-[#3a424d]">
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2 w-20">Order</th>
                  <th className="text-center py-2 px-2 w-28">Capabilities</th>
                  <th className="text-center py-2 px-2 w-20">Active</th>
                  {!readOnly && <th className="text-center py-2 px-2 w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {ticketGroups.map(tg => {
                  const capCount = capabilities.filter(c => c.ticket_group_id === tg.id).length;
                  return (
                    <tr key={tg.id} className={`border-b border-[#3a424d]/50 ${!tg.active ? 'opacity-40' : ''}`}>
                      <td className="py-1.5 px-2 text-neutral-200">{tg.name}</td>
                      <td className="py-1.5 px-2 text-neutral-400">{tg.sort_order}</td>
                      <td className="py-1.5 px-2 text-center text-neutral-400">{capCount}</td>
                      <td className="py-1.5 px-2 text-center">
                        {readOnly ? (
                          <span className={`text-[10px] ${tg.active ? 'text-green-400' : 'text-neutral-500'}`}>
                            {tg.active ? '\u2713' : '\u2717'}
                          </span>
                        ) : (
                          <button onClick={() => toggleTicketGroupActive(tg)} className={`w-5 h-5 rounded text-[10px] ${tg.active ? 'bg-green-900/50 text-green-400' : 'bg-neutral-700 text-neutral-500'}`}>
                            {tg.active ? '\u2713' : '\u2717'}
                          </button>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="py-1.5 px-2 text-center">
                          <button onClick={() => deleteTicketGroup(tg.id)} className="text-red-500 hover:text-red-400 text-[10px]">{'\u2715'}</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {ticketGroups.length === 0 && <div className="text-center text-neutral-500 text-xs py-4">No ticket groups. Import from xlsx or add manually.</div>}
          </div>
        )}

        {tab === 'capabilities' && (
          <div className="space-y-3">
            {!readOnly && (
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCapability()}
                  placeholder="New capability name..."
                  className="flex-1 px-3 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500"
                />
                <button onClick={addCapability} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9]">
                  Add
                </button>
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-500 border-b border-[#3a424d]">
                  <th className="text-left py-2 px-2">Name</th>
                  <th className="text-left py-2 px-2 w-32">Ticket Group</th>
                  <th className="text-center py-2 px-2 w-20">Items</th>
                  <th className="text-center py-2 px-2 w-20">Active</th>
                  {!readOnly && <th className="text-center py-2 px-2 w-16"></th>}
                </tr>
              </thead>
              <tbody>
                {capabilities.map(cap => (
                  <tr key={cap.id} className={`border-b border-[#3a424d]/50 ${!cap.active ? 'opacity-40' : ''}`}>
                    <td className="py-1.5 px-2 text-neutral-200">{cap.name}</td>
                    <td className="py-1.5 px-2">
                      {cap.ticket_group_name ? (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-900/40 text-purple-300 border border-purple-800/50">
                          {cap.ticket_group_name}
                        </span>
                      ) : (
                        <span className="text-neutral-600">-</span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center text-neutral-400">{cap.item_count ?? 0}</td>
                    <td className="py-1.5 px-2 text-center">
                      {readOnly ? (
                        <span className={`text-[10px] ${cap.active ? 'text-green-400' : 'text-neutral-500'}`}>
                          {cap.active ? '\u2713' : '\u2717'}
                        </span>
                      ) : (
                        <button onClick={() => toggleCapActive(cap)} className={`w-5 h-5 rounded text-[10px] ${cap.active ? 'bg-green-900/50 text-green-400' : 'bg-neutral-700 text-neutral-500'}`}>
                          {cap.active ? '\u2713' : '\u2717'}
                        </button>
                      )}
                    </td>
                    {!readOnly && (
                      <td className="py-1.5 px-2 text-center">
                        <button onClick={() => deleteCapability(cap.id)} className="text-red-500 hover:text-red-400 text-[10px]">{'\u2715'}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {capabilities.length === 0 && <div className="text-center text-neutral-500 text-xs py-4">No capabilities. Import from xlsx or add manually.</div>}
          </div>
        )}

        {tab === 'items' && (
          <div className="space-y-3">
            <div className="flex gap-2 items-center">
              <select
                value={selectedCapId ?? ''}
                onChange={e => { const v = parseInt(e.target.value, 10); setSelectedCapId(v || null); if (v) loadItems(v); }}
                className="px-3 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200"
              >
                <option value="">Select capability...</option>
                {capabilities.filter(c => c.active).map(cap => (
                  <option key={cap.id} value={cap.id}>{cap.name}</option>
                ))}
              </select>
            </div>

            {selectedCapId && (
              <>
                {!readOnly && (
                  <div className="flex gap-2">
                    <input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addItem()}
                      placeholder="New item name..."
                      className="flex-1 px-3 py-1.5 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500"
                    />
                    <button onClick={addItem} className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9]">
                      Add
                    </button>
                  </div>
                )}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-neutral-500 border-b border-[#3a424d]">
                      <th className="text-left py-2 px-2">Item Name</th>
                      <th className="text-center py-2 px-2 w-24">Bolt-On</th>
                      <th className="text-center py-2 px-2 w-20">Active</th>
                      {!readOnly && <th className="text-center py-2 px-2 w-16"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className={`border-b border-[#3a424d]/50 ${!item.active ? 'opacity-40' : ''}`}>
                        <td className="py-1.5 px-2 text-neutral-200">{item.name}</td>
                        <td className="py-1.5 px-2 text-center">
                          {readOnly ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] ${item.is_bolt_on ? 'bg-amber-900/50 text-amber-400' : 'bg-neutral-700 text-neutral-500'}`}>
                              {item.is_bolt_on ? 'Bolt-On' : 'Standard'}
                            </span>
                          ) : (
                            <button
                              onClick={() => toggleItemBoltOn(item)}
                              className={`px-2 py-0.5 rounded text-[10px] ${item.is_bolt_on ? 'bg-amber-900/50 text-amber-400' : 'bg-neutral-700 text-neutral-500'}`}
                            >
                              {item.is_bolt_on ? 'Bolt-On' : 'Standard'}
                            </button>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {readOnly ? (
                            <span className={`text-[10px] ${item.active ? 'text-green-400' : 'text-neutral-500'}`}>
                              {item.active ? '\u2713' : '\u2717'}
                            </span>
                          ) : (
                            <button onClick={() => toggleItemActive(item)} className={`w-5 h-5 rounded text-[10px] ${item.active ? 'bg-green-900/50 text-green-400' : 'bg-neutral-700 text-neutral-500'}`}>
                              {item.active ? '\u2713' : '\u2717'}
                            </button>
                          )}
                        </td>
                        {!readOnly && (
                          <td className="py-1.5 px-2 text-center">
                            <button onClick={() => deleteItem(item.id)} className="text-red-500 hover:text-red-400 text-[10px]">{'\u2715'}</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {items.length === 0 && <div className="text-center text-neutral-500 text-xs py-4">No items for this capability.</div>}
              </>
            )}
            {!selectedCapId && <div className="text-center text-neutral-500 text-xs py-4">Select a capability to {readOnly ? 'view' : 'manage'} its items.</div>}
          </div>
        )}

        {tab === 'milestone-links' && (
          <MilestoneLinkGrid
            templates={milestoneTemplates}
            ticketGroups={ticketGroups}
            mappings={templateTgMappings}
            readOnly={readOnly}
            onToggleLink={async (templateId, tgId, linked) => {
              const current = templateTgMappings
                .filter(m => m.template_id === templateId)
                .map(m => m.ticket_group_id);
              const updated = linked
                ? [...current, tgId]
                : current.filter(id => id !== tgId);
              await fetch(`/api/milestones/templates/${templateId}/ticket-groups`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticketGroupIds: updated }),
              });
              loadTemplateTgMappings();
            }}
            onUpdateLeadDays={async (templateId, days) => {
              await fetch(`/api/milestones/templates/${templateId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lead_days: days }),
              });
              loadMilestoneTemplates();
            }}
          />
        )}

        {tab === 'create-tickets' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Sale Type</label>
                <select
                  value={ctSaleType}
                  onChange={e => setCtSaleType(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
                >
                  <option value="">Select sale type...</option>
                  {saleTypes.filter(st => st.active).map(st => (
                    <option key={st.id} value={st.name}>{st.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Customer Name</label>
                <input
                  value={ctCustomerName}
                  onChange={e => setCtCustomerName(e.target.value)}
                  placeholder="e.g. Acme Properties"
                  className="w-full px-3 py-2 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500 focus:border-[#5ec1ca] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Onboarding Ref</label>
                <input
                  value={ctOnboardingRef}
                  onChange={e => setCtOnboardingRef(e.target.value)}
                  placeholder="e.g. BYM0042"
                  className="w-full px-3 py-2 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 placeholder-neutral-500 focus:border-[#5ec1ca] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase tracking-wider block mb-1">Target Due Date</label>
                <input
                  type="date"
                  value={ctDueDate}
                  onChange={e => setCtDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                <input type="checkbox" checked={ctDryRun} onChange={e => setCtDryRun(e.target.checked)}
                  className="accent-[#5ec1ca]" />
                Dry Run (preview only, no tickets created)
              </label>
              <button
                onClick={handleCreateTickets}
                disabled={ctSubmitting || !ctSaleType || !ctCustomerName.trim() || !ctOnboardingRef.trim() || !ctDueDate}
                className={`px-4 py-2 text-xs rounded font-semibold transition-colors disabled:opacity-50 ${
                  ctDryRun
                    ? 'bg-amber-600 text-white hover:bg-amber-500'
                    : 'bg-green-600 text-white hover:bg-green-500'
                }`}
              >
                {ctSubmitting ? 'Working...' : ctDryRun ? 'Preview Tickets' : 'Create Tickets in Jira'}
              </button>
            </div>

            {ctError && (
              <div className="p-3 text-xs rounded bg-red-950/50 text-red-400 border border-red-900">
                {ctError}
              </div>
            )}

            {ctResult && (
              <div className={`p-4 rounded border ${ctResult.dryRun ? 'bg-amber-950/30 border-amber-800' : 'bg-green-950/30 border-green-800'}`}>
                <h4 className="text-xs font-semibold mb-2 text-neutral-200">
                  {ctResult.dryRun ? 'Dry Run Preview' : 'Tickets Created Successfully'}
                </h4>
                <div className="text-xs text-neutral-300 space-y-1">
                  <p>Parent: <span className="text-[#5ec1ca] font-mono">{ctResult.parentKey}</span>
                    {ctResult.details?.parentSummary && <span className="text-neutral-500 ml-2">{ctResult.details.parentSummary}</span>}
                  </p>
                  <p>Children: {ctResult.childKeys.length} ticket(s)</p>
                  {ctResult.details?.childSummaries?.map((s, i) => (
                    <p key={i} className="ml-4 text-neutral-400">
                      <span className="text-[#5ec1ca] font-mono">{ctResult.childKeys[i] || '(preview)'}</span>: {s}
                    </p>
                  ))}
                  {!ctResult.dryRun && (
                    <p className="mt-2 text-neutral-400">
                      Created: {ctResult.createdCount} | Linked: {ctResult.linkedCount}
                      {ctResult.existing && <span className="text-amber-400 ml-2">(parent already existed)</span>}
                    </p>
                  )}
                </div>
              </div>
            )}

            {ctRuns.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-neutral-400 mb-2">Recent Runs</h4>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-neutral-500 border-b border-[#3a424d]">
                      <th className="text-left py-1.5 px-2">Ref</th>
                      <th className="text-left py-1.5 px-2">Status</th>
                      <th className="text-left py-1.5 px-2">Parent</th>
                      <th className="text-center py-1.5 px-2">Children</th>
                      <th className="text-center py-1.5 px-2">Dry Run</th>
                      <th className="text-left py-1.5 px-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ctRuns.map(run => (
                      <tr key={run.id} className="border-b border-[#3a424d]/50">
                        <td className="py-1 px-2 text-neutral-200 font-mono">{run.onboarding_ref}</td>
                        <td className="py-1 px-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            run.status === 'success' ? 'bg-green-900/50 text-green-400' :
                            run.status === 'error' ? 'bg-red-900/50 text-red-400' :
                            run.status === 'partial' ? 'bg-amber-900/50 text-amber-400' :
                            'bg-neutral-700 text-neutral-400'
                          }`}>{run.status}</span>
                        </td>
                        <td className="py-1 px-2 text-[#5ec1ca] font-mono">{run.parent_key || '-'}</td>
                        <td className="py-1 px-2 text-center text-neutral-400">
                          {run.child_keys ? (() => { try { return JSON.parse(run.child_keys).length; } catch { return 0; } })() : 0}
                        </td>
                        <td className="py-1 px-2 text-center">
                          {run.dry_run ? <span className="text-amber-400 text-[10px]">yes</span> : <span className="text-neutral-500 text-[10px]">no</span>}
                        </td>
                        <td className="py-1 px-2 text-neutral-500">{new Date(run.created_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Matrix Grid sub-component ──

function MatrixGrid({
  saleTypes,
  capabilities,
  ticketGroups,
  isCellEnabled,
  getCellNotes,
  onToggle,
  readOnly = false,
}: {
  saleTypes: SaleType[];
  capabilities: Capability[];
  ticketGroups: TicketGroup[];
  isCellEnabled: (stId: number, capId: number) => boolean;
  getCellNotes: (stId: number, capId: number) => string | null;
  onToggle?: (stId: number, capId: number) => void;
  readOnly?: boolean;
}) {
  const activeSaleTypes = saleTypes.filter(st => st.active);
  const activeCaps = capabilities.filter(c => c.active);

  if (activeSaleTypes.length === 0 || activeCaps.length === 0) {
    return <div className="text-center text-neutral-500 text-xs py-8">No data. Import from xlsx or add sale types and capabilities first.</div>;
  }

  // Build grouped columns: group ticket groups and their capabilities
  const activeGroups = ticketGroups.filter(tg => tg.active);
  const groupedCaps: Array<{ group: TicketGroup | null; caps: Capability[] }> = [];

  // Capabilities with a ticket group (in group order)
  for (const group of activeGroups) {
    const groupCaps = activeCaps.filter(c => c.ticket_group_id === group.id);
    if (groupCaps.length > 0) {
      groupedCaps.push({ group, caps: groupCaps });
    }
  }

  // Ungrouped capabilities (no ticket_group_id)
  const ungroupedCaps = activeCaps.filter(c => !c.ticket_group_id || !activeGroups.some(g => g.id === c.ticket_group_id));
  if (ungroupedCaps.length > 0) {
    groupedCaps.push({ group: null, caps: ungroupedCaps });
  }

  // Flatten for rendering
  const flatCaps = groupedCaps.flatMap(g => g.caps);

  // Alternating group colors for visual distinction
  const groupColors = [
    'bg-purple-900/20 border-purple-800/30',
    'bg-blue-900/20 border-blue-800/30',
    'bg-teal-900/20 border-teal-800/30',
    'bg-indigo-900/20 border-indigo-800/30',
    'bg-cyan-900/20 border-cyan-800/30',
    'bg-violet-900/20 border-violet-800/30',
  ];

  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="text-[11px] border-collapse">
        <thead className="sticky top-0 z-10">
          {/* Row 1: Ticket group headers */}
          {activeGroups.length > 0 && (
            <tr className="bg-[#2f353d]">
              <th className="sticky left-0 z-20 bg-[#2f353d] border-b border-r border-[#3a424d]" />
              {groupedCaps.map((gc, idx) => (
                <th
                  key={gc.group?.id ?? 'ungrouped'}
                  colSpan={gc.caps.length}
                  className={`px-2 py-1.5 text-center font-semibold border-b border-x border-[#3a424d] ${
                    gc.group ? `text-purple-300 ${groupColors[idx % groupColors.length]}` : 'text-neutral-500'
                  }`}
                >
                  {gc.group?.name ?? 'Other'}
                </th>
              ))}
            </tr>
          )}
          {/* Row 2: Individual capability names */}
          <tr className="bg-[#2f353d]">
            <th className="sticky left-0 z-20 bg-[#2f353d] text-left px-2 py-1.5 text-neutral-500 min-w-[160px] border-b border-r border-[#3a424d]">
              Sale Type
            </th>
            {flatCaps.map(cap => (
              <th
                key={cap.id}
                className="px-1 py-1.5 text-neutral-400 font-normal border-b border-[#3a424d] min-w-[32px]"
                title={cap.name}
              >
                <div className="writing-mode-vertical max-h-[100px] overflow-hidden whitespace-nowrap text-ellipsis"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: '100px' }}
                >
                  {cap.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeSaleTypes.map(st => (
            <tr key={st.id} className="hover:bg-[#363d47]/50">
              <td className="sticky left-0 bg-[#2f353d] px-2 py-1 text-neutral-200 border-r border-[#3a424d] whitespace-nowrap">
                {st.name}
              </td>
              {flatCaps.map(cap => {
                const enabled = isCellEnabled(st.id, cap.id);
                const notes = getCellNotes(st.id, cap.id);
                return (
                  <td
                    key={cap.id}
                    onClick={readOnly ? undefined : () => onToggle?.(st.id, cap.id)}
                    title={notes ? `${cap.name}: ${notes}` : cap.name}
                    className={`text-center border border-[#3a424d]/30 transition-colors ${
                      readOnly ? '' : 'cursor-pointer'
                    } ${
                      enabled
                        ? notes
                          ? `bg-amber-900/40 text-amber-300${readOnly ? '' : ' hover:bg-amber-800/50'}`
                          : `bg-[#5ec1ca]/20 text-[#5ec1ca]${readOnly ? '' : ' hover:bg-[#5ec1ca]/30'}`
                        : readOnly ? '' : 'hover:bg-[#363d47]/50'
                    }`}
                  >
                    {enabled ? '\u2713' : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Milestone Link Grid sub-component ──

function MilestoneLinkGrid({
  templates,
  ticketGroups,
  mappings,
  readOnly,
  onToggleLink,
  onUpdateLeadDays,
}: {
  templates: MilestoneTemplate[];
  ticketGroups: TicketGroup[];
  mappings: TemplateTgMapping[];
  readOnly: boolean;
  onToggleLink: (templateId: number, tgId: number, linked: boolean) => void;
  onUpdateLeadDays: (templateId: number, days: number) => void;
}) {
  const activeTemplates = templates.filter(t => t.active).sort((a, b) => a.sort_order - b.sort_order);
  const activeGroups = ticketGroups.filter(tg => tg.active).sort((a, b) => a.sort_order - b.sort_order);

  const isLinked = (templateId: number, tgId: number) =>
    mappings.some(m => m.template_id === templateId && m.ticket_group_id === tgId);

  if (activeTemplates.length === 0) {
    return <div className="text-center text-neutral-500 text-xs py-8">No milestone templates found. Create templates in Admin &rarr; Milestones.</div>;
  }

  if (activeGroups.length === 0) {
    return <div className="text-center text-neutral-500 text-xs py-8">No ticket groups found. Add ticket groups first.</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-neutral-400">
        Link milestone templates to ticket groups. When a milestone approaches its target date (minus lead days), the workflow engine will create tasks and Jira tickets for the linked groups.
      </p>
      <div className="overflow-auto">
        <table className="text-[11px] border-collapse w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#2f353d]">
              <th className="sticky left-0 z-20 bg-[#2f353d] text-left px-2 py-2 text-neutral-500 min-w-[180px] border-b border-r border-[#3a424d]">
                Milestone Template
              </th>
              <th className="px-2 py-2 text-neutral-500 text-center border-b border-[#3a424d] w-20">
                Day
              </th>
              <th className="px-2 py-2 text-neutral-500 text-center border-b border-[#3a424d] w-24">
                Lead Days
              </th>
              {activeGroups.map(tg => (
                <th
                  key={tg.id}
                  className="px-1 py-2 text-center text-purple-300 font-normal border-b border-[#3a424d] min-w-[80px]"
                >
                  {tg.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeTemplates.map(tmpl => (
              <tr key={tmpl.id} className="hover:bg-[#363d47]/50 border-b border-[#3a424d]/50">
                <td className="sticky left-0 bg-[#2f353d] px-2 py-1.5 text-neutral-200 border-r border-[#3a424d] whitespace-nowrap">
                  {tmpl.name}
                </td>
                <td className="px-2 py-1.5 text-center text-neutral-400">
                  {tmpl.day_offset >= 0 ? `+${tmpl.day_offset}` : tmpl.day_offset}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {readOnly ? (
                    <span className="text-neutral-300">{tmpl.lead_days}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      max={30}
                      value={tmpl.lead_days}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 0) onUpdateLeadDays(tmpl.id, v);
                      }}
                      className="w-14 px-1.5 py-0.5 text-xs text-center bg-[#272C33] border border-[#3a424d] rounded text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
                    />
                  )}
                </td>
                {activeGroups.map(tg => {
                  const linked = isLinked(tmpl.id, tg.id);
                  return (
                    <td
                      key={tg.id}
                      onClick={readOnly ? undefined : () => onToggleLink(tmpl.id, tg.id, !linked)}
                      className={`text-center border border-[#3a424d]/30 transition-colors ${
                        readOnly ? '' : 'cursor-pointer'
                      } ${
                        linked
                          ? `bg-[#5ec1ca]/20 text-[#5ec1ca]${readOnly ? '' : ' hover:bg-[#5ec1ca]/30'}`
                          : readOnly ? '' : 'hover:bg-[#363d47]/50'
                      }`}
                    >
                      {linked ? '\u2713' : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
