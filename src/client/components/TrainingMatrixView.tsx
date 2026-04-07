import { useState, useEffect, useCallback, useRef } from 'react';

interface Category { id: number; name: string; sort_order: number }
interface TrainingItem { id: number; category_id: number; section: string; name: string; tech_lead: string | null; max_score: number; sort_order: number }
interface Score { id: number; item_id: number; user_id: number; score: number; updated_at: string }
interface User { id: number; username: string; display_name: string | null }

const API = '/api/training';

function scoreColor(score: number, max: number): string {
  if (score === 0) return 'bg-[#2f353d] text-neutral-600';
  const pct = score / max;
  if (pct <= 0.2) return 'bg-red-900/50 text-red-300';
  if (pct <= 0.4) return 'bg-orange-900/40 text-orange-300';
  if (pct <= 0.6) return 'bg-amber-900/40 text-amber-300';
  if (pct <= 0.8) return 'bg-green-900/30 text-green-400';
  return 'bg-emerald-900/40 text-emerald-300';
}

function scoreBg(score: number, max: number): string {
  if (score === 0) return '';
  const pct = score / max;
  if (pct <= 0.2) return 'rgba(239,68,68,0.15)';
  if (pct <= 0.4) return 'rgba(249,115,22,0.12)';
  if (pct <= 0.6) return 'rgba(245,158,11,0.12)';
  if (pct <= 0.8) return 'rgba(34,197,94,0.10)';
  return 'rgba(16,185,129,0.15)';
}

export function TrainingMatrixView({ userId, isAdmin }: { userId: number; isAdmin: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<TrainingItem[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', section: '', tech_lead: '' });
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const pendingScores = useRef<Map<string, { item_id: number; user_id: number; score: number }>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [catRes, itemRes, scoreRes, userRes] = await Promise.all([
        fetch(`${API}/categories`).then(r => r.json()),
        fetch(`${API}/items${selectedCategory ? `?category=${selectedCategory}` : ''}`).then(r => r.json()),
        fetch(`${API}/scores${selectedCategory ? `?category=${selectedCategory}` : ''}`).then(r => r.json()),
        fetch(`${API}/users`).then(r => r.json()),
      ]);
      if (catRes.ok) setCategories(catRes.data);
      if (itemRes.ok) setItems(itemRes.data);
      if (scoreRes.ok) setScores(scoreRes.data);
      if (userRes.ok) setUsers(userRes.data);
    } catch (err) {
      console.error('Failed to fetch training data:', err);
    }
    setLoading(false);
  }, [selectedCategory]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const getScore = (itemId: number, uid: number): number => {
    const key = `${itemId}-${uid}`;
    const pending = pendingScores.current.get(key);
    if (pending) return pending.score;
    return scores.find(s => s.item_id === itemId && s.user_id === uid)?.score ?? 0;
  };

  const flushScores = useCallback(async () => {
    const pending = Array.from(pendingScores.current.values());
    if (pending.length === 0) return;
    pendingScores.current.clear();
    setSaving(true);
    try {
      await fetch(`${API}/scores`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scores: pending }),
      });
      // Refresh scores from server
      const scoreRes = await fetch(`${API}/scores${selectedCategory ? `?category=${selectedCategory}` : ''}`).then(r => r.json());
      if (scoreRes.ok) setScores(scoreRes.data);
    } catch (err) {
      console.error('Failed to save scores:', err);
    }
    setSaving(false);
  }, [selectedCategory]);

  const setScore = (itemId: number, uid: number, score: number) => {
    // Permission check: non-admins can only edit their own
    if (!isAdmin && uid !== userId) return;
    const key = `${itemId}-${uid}`;
    pendingScores.current.set(key, { item_id: itemId, user_id: uid, score });
    // Force re-render
    setScores(prev => [...prev]);
    // Debounce save
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushScores, 1500);
  };

  const cycleScore = (itemId: number, uid: number, max: number) => {
    const current = getScore(itemId, uid);
    const next = current >= max ? 0 : current + 1;
    setScore(itemId, uid, next);
  };

  // Filter items
  const filteredItems = items.filter(item => {
    if (selectedCategory && item.category_id !== selectedCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.section.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by section
  const sections = new Map<string, TrainingItem[]>();
  for (const item of filteredItems) {
    const sec = item.section || '(Ungrouped)';
    if (!sections.has(sec)) sections.set(sec, []);
    sections.get(sec)!.push(item);
  }

  const toggleSection = (sec: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec); else next.add(sec);
      return next;
    });
  };

  const itemTotal = (itemId: number): number => {
    let total = 0;
    for (const u of users) total += getScore(itemId, u.id);
    return total;
  };

  const userTotal = (uid: number): number => {
    let total = 0;
    for (const item of filteredItems) total += getScore(item.id, uid);
    return total;
  };

  const userMaxTotal = (): number => {
    return filteredItems.reduce((sum, i) => sum + i.max_score, 0);
  };

  const addItem = async () => {
    if (!newItem.name || !selectedCategory) return;
    const maxSort = filteredItems.length > 0 ? Math.max(...filteredItems.map(i => i.sort_order)) + 1 : 0;
    await fetch(`${API}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: selectedCategory,
        section: newItem.section,
        name: newItem.name,
        tech_lead: newItem.tech_lead || null,
        sort_order: maxSort,
      }),
    });
    setNewItem({ name: '', section: '', tech_lead: '' });
    setShowAddItem(false);
    fetchAll();
  };

  const deleteItem = async (id: number) => {
    if (!confirm('Delete this item and all its scores?')) return;
    await fetch(`${API}/items/${id}`, { method: 'DELETE' });
    fetchAll();
  };

  const addCategory = async () => {
    if (!newCategoryName.trim()) return;
    await fetch(`${API}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newCategoryName.trim(), sort_order: categories.length }),
    });
    setNewCategoryName('');
    setShowAddCategory(false);
    fetchAll();
  };

  const displayName = (u: User) => u.display_name || u.username;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-neutral-400">
        <i className="fa-solid fa-spinner fa-spin mr-2" />Loading training matrix...
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      {/* Sidebar — Categories */}
      <div className="w-56 shrink-0 bg-[#272C33] rounded-xl border border-[#3a424d] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-[#3a424d]">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Categories</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              !selectedCategory ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] font-semibold' : 'text-neutral-300 hover:bg-[#363d47]'
            }`}
          >
            <i className="fa-solid fa-layer-group mr-2 text-xs" />All Categories
            <span className="float-right text-xs text-neutral-500">{items.length}</span>
          </button>
          {categories.map(cat => {
            const count = items.filter(i => i.category_id === cat.id).length;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === cat.id ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] font-semibold' : 'text-neutral-300 hover:bg-[#363d47]'
                }`}
              >
                {cat.name}
                <span className="float-right text-xs text-neutral-500">{count}</span>
              </button>
            );
          })}
        </div>
        {isAdmin && (
          <div className="p-2 border-t border-[#3a424d]">
            {showAddCategory ? (
              <div className="flex gap-1">
                <input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCategory()}
                  placeholder="Category name..."
                  className="flex-1 bg-[#1e2228] text-neutral-200 text-xs rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca]"
                  autoFocus
                />
                <button onClick={addCategory} className="text-[#5ec1ca] text-xs px-2 hover:bg-[#5ec1ca]/10 rounded">
                  <i className="fa-solid fa-check" />
                </button>
                <button onClick={() => { setShowAddCategory(false); setNewCategoryName(''); }} className="text-neutral-500 text-xs px-1 hover:text-neutral-300">
                  <i className="fa-solid fa-xmark" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAddCategory(true)}
                className="w-full text-left px-3 py-1.5 text-xs text-neutral-500 hover:text-[#5ec1ca] transition-colors"
              >
                <i className="fa-solid fa-plus mr-1" />Add Category
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1 max-w-sm">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search items..."
              className="w-full bg-[#272C33] text-neutral-200 text-sm rounded-full px-9 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300">
                <i className="fa-solid fa-xmark text-xs" />
              </button>
            )}
          </div>

          <span className="text-xs text-neutral-500">
            {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
          </span>

          {saving && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <i className="fa-solid fa-spinner fa-spin" />Saving...
            </span>
          )}

          {isAdmin && selectedCategory && (
            <button
              onClick={() => setShowAddItem(true)}
              className="px-3 py-1.5 bg-[#5ec1ca] text-[#272C33] text-xs font-semibold rounded-full hover:bg-[#4db0b9] transition-colors"
            >
              <i className="fa-solid fa-plus mr-1" />Add Item
            </button>
          )}
        </div>

        {/* Add item form */}
        {showAddItem && (
          <div className="bg-[#272C33] rounded-lg border border-[#3a424d] p-3 mb-3 flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Item Name</label>
              <input
                value={newItem.name}
                onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))}
                className="w-full bg-[#1e2228] text-neutral-200 text-sm rounded px-3 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca]"
                autoFocus
              />
            </div>
            <div className="w-48">
              <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Section</label>
              <input
                value={newItem.section}
                onChange={e => setNewItem(p => ({ ...p, section: e.target.value }))}
                placeholder="e.g. Email Editor"
                className="w-full bg-[#1e2228] text-neutral-200 text-sm rounded px-3 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600"
              />
            </div>
            <div className="w-36">
              <label className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1 block">Tech Lead</label>
              <input
                value={newItem.tech_lead}
                onChange={e => setNewItem(p => ({ ...p, tech_lead: e.target.value }))}
                className="w-full bg-[#1e2228] text-neutral-200 text-sm rounded px-3 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca]"
              />
            </div>
            <button onClick={addItem} className="px-4 py-1.5 bg-[#5ec1ca] text-[#272C33] text-xs font-semibold rounded hover:bg-[#4db0b9]">
              Add
            </button>
            <button onClick={() => { setShowAddItem(false); setNewItem({ name: '', section: '', tech_lead: '' }); }} className="px-3 py-1.5 text-neutral-500 hover:text-neutral-300 text-xs">
              Cancel
            </button>
          </div>
        )}

        {/* Matrix table */}
        <div className="flex-1 overflow-auto rounded-xl border border-[#3a424d] bg-[#272C33]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="bg-[#1e2228]">
                <th className="text-left px-3 py-2.5 text-[10px] uppercase tracking-wider text-neutral-400 font-bold sticky left-0 bg-[#1e2228] z-30 min-w-[280px]">
                  Knowledge Item
                </th>
                <th className="px-2 py-2.5 text-[10px] uppercase tracking-wider text-neutral-400 font-bold w-20 text-center">
                  Lead
                </th>
                <th className="px-2 py-2.5 text-[10px] uppercase tracking-wider text-neutral-400 font-bold w-14 text-center">
                  Total
                </th>
                {users.map(u => (
                  <th key={u.id} className="px-1 py-2.5 text-center min-w-[52px] max-w-[70px]">
                    <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-bold leading-tight truncate" title={displayName(u)}>
                      {(displayName(u)).split(' ')[0]}
                    </div>
                  </th>
                ))}
                {isAdmin && (
                  <th className="w-8" />
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from(sections.entries()).map(([sectionName, sectionItems]) => (
                <>
                  {/* Section header */}
                  <tr key={`sec-${sectionName}`} className="bg-[#1e2228]/60">
                    <td
                      colSpan={3 + users.length + (isAdmin ? 1 : 0)}
                      className="px-3 py-2 cursor-pointer select-none sticky left-0"
                      onClick={() => toggleSection(sectionName)}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[#5ec1ca]">
                        <i className={`fa-solid fa-chevron-${collapsedSections.has(sectionName) ? 'right' : 'down'} mr-2 text-[9px]`} />
                        {sectionName}
                      </span>
                      <span className="ml-2 text-[10px] text-neutral-500 font-normal normal-case">
                        ({sectionItems.length} items)
                      </span>
                    </td>
                  </tr>
                  {/* Items */}
                  {!collapsedSections.has(sectionName) && sectionItems.map(item => (
                    <tr
                      key={item.id}
                      className="border-t border-[#3a424d]/50 hover:bg-[#363d47]/30 transition-colors"
                    >
                      <td className="px-3 py-1.5 text-neutral-200 text-[13px] sticky left-0 bg-[#272C33] z-10">
                        <span className="truncate block max-w-[260px]" title={item.name}>{item.name}</span>
                      </td>
                      <td className="px-2 py-1.5 text-center text-[11px] text-neutral-500">
                        {item.tech_lead || '-'}
                      </td>
                      <td className="px-2 py-1.5 text-center text-[12px] font-semibold text-neutral-300">
                        {itemTotal(item.id)}
                      </td>
                      {users.map(u => {
                        const score = getScore(item.id, u.id);
                        const canEdit = isAdmin || u.id === userId;
                        const cellKey = `${item.id}-${u.id}`;
                        const isEditing = editingCell === cellKey;

                        return (
                          <td key={u.id} className="px-0.5 py-0.5 text-center">
                            {isEditing ? (
                              <input
                                type="number"
                                min={0}
                                max={item.max_score}
                                value={score}
                                onChange={e => {
                                  const v = Math.max(0, Math.min(item.max_score, Number(e.target.value) || 0));
                                  setScore(item.id, u.id, v);
                                }}
                                onBlur={() => setEditingCell(null)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingCell(null); }}
                                className="w-10 bg-[#1e2228] text-center text-sm rounded border border-[#5ec1ca] outline-none text-neutral-200 py-0.5"
                                autoFocus
                              />
                            ) : (
                              <button
                                onClick={() => canEdit && cycleScore(item.id, u.id, item.max_score)}
                                onContextMenu={e => {
                                  e.preventDefault();
                                  if (canEdit) setEditingCell(cellKey);
                                }}
                                disabled={!canEdit}
                                className={`w-9 h-7 rounded text-xs font-semibold transition-all ${scoreColor(score, item.max_score)} ${
                                  canEdit ? 'cursor-pointer hover:ring-1 hover:ring-[#5ec1ca]/40' : 'cursor-default opacity-60'
                                }`}
                                title={canEdit ? `Click to cycle (0-${item.max_score}), right-click to type` : `${displayName(u)}: ${score}/${item.max_score}`}
                              >
                                {score > 0 ? score : ''}
                              </button>
                            )}
                          </td>
                        );
                      })}
                      {isAdmin && (
                        <td className="px-1 py-1.5 text-center">
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="text-neutral-600 hover:text-red-400 transition-colors text-xs"
                            title="Delete item"
                          >
                            <i className="fa-solid fa-trash-can" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </>
              ))}

              {/* Totals row */}
              {filteredItems.length > 0 && (
                <tr className="bg-[#1e2228] border-t-2 border-[#5ec1ca]/30 sticky bottom-0">
                  <td className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-neutral-300 sticky left-0 bg-[#1e2228] z-10">
                    Total
                  </td>
                  <td />
                  <td className="px-2 py-2 text-center text-[12px] font-bold text-[#5ec1ca]">
                    {filteredItems.reduce((s, i) => s + itemTotal(i.id), 0)}
                  </td>
                  {users.map(u => {
                    const total = userTotal(u.id);
                    const max = userMaxTotal();
                    const pct = max > 0 ? Math.round((total / max) * 100) : 0;
                    return (
                      <td key={u.id} className="px-1 py-2 text-center">
                        <div className="text-[11px] font-bold text-neutral-200">{total}</div>
                        <div className="text-[9px] text-neutral-500">{pct}%</div>
                      </td>
                    );
                  })}
                  {isAdmin && <td />}
                </tr>
              )}
            </tbody>
          </table>

          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
              <i className="fa-solid fa-graduation-cap text-3xl mb-3 text-neutral-600" />
              <p className="text-sm">No training items found</p>
              {!selectedCategory && <p className="text-xs mt-1">Select a category or import data to get started</p>}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-neutral-500">
          <span>Score guide:</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-900/50" /> 1 (Awareness)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-orange-900/40" /> 2 (Basic)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-900/40" /> 3 (Competent)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-900/30" /> 4 (Proficient)</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-900/40" /> 5 (Expert)</span>
          <span className="ml-auto">Click cell to cycle score &middot; Right-click to type</span>
        </div>
      </div>
    </div>
  );
}
