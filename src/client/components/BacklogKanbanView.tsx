import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Types ──

interface BacklogColumn {
  id: number;
  title: string;
  sort_order: number;
  color: string | null;
  item_count?: number;
}

interface BacklogItem {
  id: number;
  column_id: number;
  title: string;
  description: string | null;
  wp_ref: string | null;
  effort: string | null;
  type: string | null;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  blocked_reason: string | null;
}

interface Props {
  canWrite: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  code: 'bg-blue-500/20 text-blue-300',
  manual: 'bg-amber-500/20 text-amber-300',
  workshop: 'bg-purple-500/20 text-purple-300',
  monitoring: 'bg-cyan-500/20 text-cyan-300',
  research: 'bg-pink-500/20 text-pink-300',
  infrastructure: 'bg-emerald-500/20 text-emerald-300',
  bugfix: 'bg-red-500/20 text-red-300',
};

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...opts, headers: { ...authHeaders(), ...opts?.headers } });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json.data;
}

// ── Sortable Card ──

function SortableCard({ item, isDone, canWrite, onEdit, onDelete }: {
  item: BacklogItem; isDone: boolean; canWrite: boolean;
  onEdit: (item: BacklogItem) => void; onDelete: (item: BacklogItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `item-${item.id}`,
    disabled: !canWrite,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : isDone ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onEdit(item)}
      className={`p-3 rounded-lg border cursor-pointer transition-colors
        ${item.blocked_reason ? 'border-orange-500/60 bg-orange-950/20' : 'border-white/10 bg-white/5'}
        hover:bg-white/10 group`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm font-medium ${isDone ? 'line-through text-gray-500' : 'text-gray-100'}`}>
          {item.title}
        </span>
        {canWrite && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(item); }}
            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs shrink-0"
            title="Delete"
          >✕</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {item.wp_ref && (
          <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-indigo-500/20 text-indigo-300">
            {item.wp_ref}
          </span>
        )}
        {item.effort && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-500/20 text-gray-400">
            {item.effort}
          </span>
        )}
        {item.type && (
          <span className={`px-1.5 py-0.5 text-[10px] rounded ${TYPE_COLORS[item.type] || 'bg-gray-500/20 text-gray-400'}`}>
            {item.type}
          </span>
        )}
        {item.blocked_reason && (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-500/20 text-orange-300" title={item.blocked_reason}>
            blocked
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sortable Column ──

function SortableColumn({ col, items, canWrite, onEditItem, onDeleteItem, onAddItem, onEditColumn, onDeleteColumn }: {
  col: BacklogColumn; items: BacklogItem[]; canWrite: boolean;
  onEditItem: (item: BacklogItem) => void; onDeleteItem: (item: BacklogItem) => void;
  onAddItem: (columnId: number) => void;
  onEditColumn: (col: BacklogColumn) => void; onDeleteColumn: (col: BacklogColumn) => void;
}) {
  const isDone = col.title.toLowerCase() === 'done';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `col-${col.id}`,
    disabled: !canWrite,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col min-w-[280px] max-w-[340px] w-[300px] shrink-0 rounded-xl border border-white/10 bg-white/[0.03]"
    >
      {/* Column header */}
      <div
        {...(canWrite ? { ...attributes, ...listeners } : {})}
        className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 cursor-grab"
      >
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color || '#6b7280' }} />
          <span className="text-sm font-semibold text-gray-200">{col.title}</span>
          <span className="text-xs text-gray-500">({items.length})</span>
        </div>
        {canWrite && (
          <div className="flex items-center gap-1">
            <button onClick={() => onEditColumn(col)} className="text-gray-500 hover:text-gray-300 text-xs p-1" title="Edit column">✎</button>
            <button onClick={() => onDeleteColumn(col)} className="text-gray-500 hover:text-red-400 text-xs p-1" title="Delete column">✕</button>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px]">
        <SortableContext items={items.map(i => `item-${i.id}`)} strategy={verticalListSortingStrategy}>
          {items.map(item => (
            <SortableCard
              key={item.id}
              item={item}
              isDone={isDone}
              canWrite={canWrite}
              onEdit={onEditItem}
              onDelete={onDeleteItem}
            />
          ))}
        </SortableContext>
      </div>

      {/* Add button */}
      {canWrite && (
        <button
          onClick={() => onAddItem(col.id)}
          className="m-2 mt-0 py-1.5 text-xs text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded-lg transition-colors"
        >
          + Add item
        </button>
      )}
    </div>
  );
}

// ── Detail / Edit Panel ──

function DetailPanel({ item, columns, canWrite, onSave, onClose }: {
  item: BacklogItem | null; columns: BacklogColumn[]; canWrite: boolean;
  onSave: (id: number, fields: Partial<BacklogItem>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<BacklogItem>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setForm({ title: item.title, description: item.description, wp_ref: item.wp_ref, effort: item.effort, type: item.type, blocked_reason: item.blocked_reason, column_id: item.column_id });
  }, [item]);

  if (!item) return null;

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(item.id, form); onClose(); }
    catch { /* toast */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-gray-900 border-l border-white/10 shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-gray-900 border-b border-white/10 px-5 py-3 flex items-center justify-between z-10">
          <h3 className="text-lg font-semibold text-gray-100">
            {item.wp_ref && <span className="text-indigo-400 mr-2">{item.wp_ref}</span>}
            Item Detail
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Title</label>
            <input
              value={form.title ?? ''}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              disabled={!canWrite}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Description (markdown)</label>
            <textarea
              value={form.description ?? ''}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              disabled={!canWrite}
              rows={8}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">WP Ref</label>
              <input
                value={form.wp_ref ?? ''}
                onChange={e => setForm(f => ({ ...f, wp_ref: e.target.value }))}
                disabled={!canWrite}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Effort</label>
              <input
                value={form.effort ?? ''}
                onChange={e => setForm(f => ({ ...f, effort: e.target.value }))}
                disabled={!canWrite}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                value={form.type ?? ''}
                onChange={e => setForm(f => ({ ...f, type: e.target.value || null }))}
                disabled={!canWrite}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="">None</option>
                <option value="code">Code</option>
                <option value="manual">Manual</option>
                <option value="workshop">Workshop</option>
                <option value="monitoring">Monitoring</option>
                <option value="research">Research</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="bugfix">Bugfix</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Column</label>
              <select
                value={form.column_id ?? item.column_id}
                onChange={e => setForm(f => ({ ...f, column_id: parseInt(e.target.value) }))}
                disabled={!canWrite}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Blocked Reason</label>
            <input
              value={form.blocked_reason ?? ''}
              onChange={e => setForm(f => ({ ...f, blocked_reason: e.target.value || null }))}
              disabled={!canWrite}
              placeholder="Leave empty if not blocked"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="text-xs text-gray-600">
            Created by {item.created_by || 'unknown'} · {new Date(item.created_at).toLocaleDateString()}
            {item.completed_at && <> · Completed {new Date(item.completed_at).toLocaleDateString()}</>}
          </div>
          {canWrite && (
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Quick Add Modal ──

function QuickAddModal({ columnId, columns, onAdd, onClose }: {
  columnId: number; columns: BacklogColumn[];
  onAdd: (data: { column_id: number; title: string; wp_ref?: string; type?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [wpRef, setWpRef] = useState('');
  const [type, setType] = useState('');
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const colTitle = columns.find(c => c.id === columnId)?.title || 'column';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    try {
      await onAdd({ column_id: columnId, title: title.trim(), wp_ref: wpRef.trim() || undefined, type: type || undefined });
      onClose();
    } catch { /* toast */ }
    finally { setAdding(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={e => e.stopPropagation()}
        className="bg-gray-900 border border-white/10 rounded-xl p-5 w-full max-w-md space-y-3 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-gray-200">Add to {colTitle}</h3>
        <input
          ref={inputRef}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Item title"
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            value={wpRef}
            onChange={e => setWpRef(e.target.value)}
            placeholder="WP ref (optional)"
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          />
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Type (optional)</option>
            <option value="code">Code</option>
            <option value="manual">Manual</option>
            <option value="workshop">Workshop</option>
            <option value="monitoring">Monitoring</option>
            <option value="research">Research</option>
            <option value="infrastructure">Infrastructure</option>
            <option value="bugfix">Bugfix</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          <button
            type="submit"
            disabled={adding || !title.trim()}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Column Edit Modal ──

function ColumnEditModal({ col, onSave, onClose }: {
  col: BacklogColumn | null;
  onSave: (id: number | null, fields: { title: string; color: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(col?.title ?? '');
  const [color, setColor] = useState(col?.color ?? '#6b7280');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try { await onSave(col?.id ?? null, { title: title.trim(), color }); onClose(); }
    catch { /* toast */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="bg-gray-900 border border-white/10 rounded-xl p-5 w-full max-w-sm space-y-3 shadow-2xl">
        <h3 className="text-sm font-semibold text-gray-200">{col ? 'Edit Column' : 'New Column'}</h3>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Column title"
          autoFocus
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">Color</label>
          <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded border-none bg-transparent cursor-pointer" />
          <span className="text-xs text-gray-500 font-mono">{color}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          <button type="submit" disabled={saving || !title.trim()} className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main View ──

export function BacklogKanbanView({ canWrite }: Props) {
  const [columns, setColumns] = useState<BacklogColumn[]>([]);
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<BacklogItem | null>(null);
  const [addColumnId, setAddColumnId] = useState<number | null>(null);
  const [editColumn, setEditColumn] = useState<BacklogColumn | null | 'new'>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const load = useCallback(async () => {
    try {
      const [cols, its] = await Promise.all([
        api<BacklogColumn[]>('/api/backlog/columns'),
        api<BacklogItem[]>('/api/backlog/items'),
      ]);
      setColumns(cols);
      setItems(its);
    } catch (e) {
      console.error('Failed to load backlog', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const itemsByColumn = (colId: number) => {
    let filtered = items.filter(i => i.column_id === colId);
    if (filterType) filtered = filtered.filter(i => i.type === filterType);
    return filtered.sort((a, b) => a.priority - b.priority);
  };

  // ── Drag handlers ──

  const findItemColumn = (itemId: number) => items.find(i => i.id === itemId)?.column_id;

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  };

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;

    const activeStr = active.id as string;
    const overStr = over.id as string;

    if (activeStr.startsWith('item-') && overStr.startsWith('col-')) {
      const itemId = parseInt(activeStr.replace('item-', ''));
      const colId = parseInt(overStr.replace('col-', ''));
      if (findItemColumn(itemId) !== colId) {
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, column_id: colId } : i));
      }
    } else if (activeStr.startsWith('item-') && overStr.startsWith('item-')) {
      const overId = parseInt(overStr.replace('item-', ''));
      const overCol = findItemColumn(overId);
      const activeItemId = parseInt(activeStr.replace('item-', ''));
      if (overCol && findItemColumn(activeItemId) !== overCol) {
        setItems(prev => prev.map(i => i.id === activeItemId ? { ...i, column_id: overCol } : i));
      }
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeStr = active.id as string;
    const overStr = over.id as string;

    if (activeStr.startsWith('col-') && overStr.startsWith('col-')) {
      const oldIdx = columns.findIndex(c => `col-${c.id}` === activeStr);
      const newIdx = columns.findIndex(c => `col-${c.id}` === overStr);
      if (oldIdx !== newIdx) {
        const reordered = arrayMove(columns, oldIdx, newIdx);
        setColumns(reordered);
        try { await api('/api/backlog/columns/reorder', { method: 'PUT', body: JSON.stringify({ columnIds: reordered.map(c => c.id) }) }); }
        catch { load(); }
      }
      return;
    }

    if (activeStr.startsWith('item-')) {
      const itemId = parseInt(activeStr.replace('item-', ''));
      const item = items.find(i => i.id === itemId);
      if (!item) return;

      let targetCol = item.column_id;
      if (overStr.startsWith('col-')) {
        targetCol = parseInt(overStr.replace('col-', ''));
      } else if (overStr.startsWith('item-')) {
        const overId = parseInt(overStr.replace('item-', ''));
        const overItem = items.find(i => i.id === overId);
        if (overItem) targetCol = overItem.column_id;
      }

      const colItems = items.filter(i => i.column_id === targetCol).sort((a, b) => a.priority - b.priority);
      const ids = colItems.map(i => i.id);
      if (!ids.includes(itemId)) ids.push(itemId);

      if (overStr.startsWith('item-')) {
        const overId = parseInt(overStr.replace('item-', ''));
        const fromIdx = ids.indexOf(itemId);
        const toIdx = ids.indexOf(overId);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          const reordered = arrayMove(ids, fromIdx, toIdx);
          setItems(prev => {
            const updated = [...prev];
            for (let i = 0; i < reordered.length; i++) {
              const idx = updated.findIndex(it => it.id === reordered[i]);
              if (idx !== -1) updated[idx] = { ...updated[idx], priority: i, column_id: targetCol };
            }
            return updated;
          });
          try {
            await api(`/api/backlog/items/${itemId}/move`, { method: 'PUT', body: JSON.stringify({ column_id: targetCol }) });
            await api('/api/backlog/items/reorder', { method: 'PUT', body: JSON.stringify({ column_id: targetCol, itemIds: reordered }) });
          } catch { load(); }
          return;
        }
      }

      try {
        await api(`/api/backlog/items/${itemId}/move`, { method: 'PUT', body: JSON.stringify({ column_id: targetCol }) });
        load();
      } catch { load(); }
    }
  };

  // ── CRUD handlers ──

  const handleAddItem = async (data: { column_id: number; title: string; wp_ref?: string; type?: string }) => {
    await api('/api/backlog/items', { method: 'POST', body: JSON.stringify(data) });
    load();
  };

  const handleSaveItem = async (id: number, fields: Partial<BacklogItem>) => {
    if (fields.column_id && fields.column_id !== items.find(i => i.id === id)?.column_id) {
      await api(`/api/backlog/items/${id}/move`, { method: 'PUT', body: JSON.stringify({ column_id: fields.column_id }) });
    }
    const { column_id: _col, ...rest } = fields;
    const updateFields = Object.fromEntries(Object.entries(rest).filter(([_, v]) => v !== undefined));
    if (Object.keys(updateFields).length > 0) {
      await api(`/api/backlog/items/${id}`, { method: 'PUT', body: JSON.stringify(updateFields) });
    }
    load();
  };

  const handleDeleteItem = async (item: BacklogItem) => {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await api(`/api/backlog/items/${item.id}`, { method: 'DELETE' });
    load();
  };

  const handleSaveColumn = async (id: number | null, fields: { title: string; color: string }) => {
    if (id) {
      await api(`/api/backlog/columns/${id}`, { method: 'PUT', body: JSON.stringify(fields) });
    } else {
      await api('/api/backlog/columns', { method: 'POST', body: JSON.stringify(fields) });
    }
    load();
  };

  const handleDeleteColumn = async (col: BacklogColumn) => {
    const count = items.filter(i => i.column_id === col.id).length;
    if (count > 0) { alert(`Column "${col.title}" has ${count} items — move or delete them first.`); return; }
    if (!confirm(`Delete column "${col.title}"?`)) return;
    await api(`/api/backlog/columns/${col.id}`, { method: 'DELETE' });
    load();
  };

  const activeItem = activeId?.startsWith('item-')
    ? items.find(i => i.id === parseInt(activeId.replace('item-', '')))
    : null;

  const types = [...new Set(items.map(i => i.type).filter(Boolean))];

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-100">Product Backlog</h2>
          <span className="text-xs text-gray-500">{items.length} items</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none"
          >
            <option value="">All types</option>
            {types.map(t => <option key={t} value={t!}>{t}</option>)}
          </select>
          {canWrite && (
            <button
              onClick={() => setEditColumn('new')}
              className="px-3 py-1 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 transition-colors"
            >
              + Column
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 h-full">
            <SortableContext items={columns.map(c => `col-${c.id}`)} strategy={horizontalListSortingStrategy}>
              {columns.map(col => (
                <SortableColumn
                  key={col.id}
                  col={col}
                  items={itemsByColumn(col.id)}
                  canWrite={canWrite}
                  onEditItem={setEditItem}
                  onDeleteItem={handleDeleteItem}
                  onAddItem={setAddColumnId}
                  onEditColumn={setEditColumn}
                  onDeleteColumn={handleDeleteColumn}
                />
              ))}
            </SortableContext>
          </div>

          <DragOverlay>
            {activeItem && (
              <div className="p-3 rounded-lg border border-indigo-500/50 bg-gray-800 shadow-xl max-w-[300px]">
                <span className="text-sm font-medium text-gray-100">{activeItem.title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Modals */}
      {editItem && (
        <DetailPanel item={editItem} columns={columns} canWrite={canWrite} onSave={handleSaveItem} onClose={() => setEditItem(null)} />
      )}
      {addColumnId !== null && (
        <QuickAddModal columnId={addColumnId} columns={columns} onAdd={handleAddItem} onClose={() => setAddColumnId(null)} />
      )}
      {editColumn !== null && (
        <ColumnEditModal
          col={editColumn === 'new' ? null : editColumn}
          onSave={handleSaveColumn}
          onClose={() => setEditColumn(null)}
        />
      )}
    </div>
  );
}
