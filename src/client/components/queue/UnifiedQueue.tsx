import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { GlassCard } from './GlassCard.js';
import { ToastContainer, nextToastId, type ToastItem } from './Toast.js';
import { KeyboardHints, type KeyboardShortcut } from './KeyboardHints.js';
import { useTheme } from '../../hooks/useTheme.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface FilterPill {
  key: string;
  label: string;
  count?: number;
}

export interface StatCard {
  label: string;
  value: number | string;
  subtitle?: string;
  color?: string;
}

export interface BulkAction {
  key: string;
  label: string;
  icon?: ReactNode;
  variant: 'primary' | 'danger' | 'default';
  onExecute: (selectedKeys: string[]) => Promise<void>;
}

export interface UnifiedQueueConfig<T> {
  title: string;
  icon: ReactNode;
  accentGradient?: string;

  fetchItems: () => Promise<T[]>;
  pollIntervalMs?: number;

  getKey: (item: T) => string;
  renderRow: (item: T, opts: { selected: boolean; focused: boolean }) => ReactNode;
  groupBy?: (item: T) => string;
  groupOrder?: string[];
  groupCollapsed?: string[];

  filters?: FilterPill[];
  activeFilter?: string;
  onFilterChange?: (key: string) => void;
  searchPlaceholder?: string;
  searchFn?: (item: T, query: string) => boolean;

  stats?: StatCard[];

  renderDetail: (item: T, actions: QueueActions) => ReactNode;
  renderEmpty?: () => ReactNode;

  bulkActions?: BulkAction[];
  keyboardShortcuts?: KeyboardShortcut[];
  onKeyAction?: (key: string, item: T | null) => boolean;

  selectable?: boolean;
  extraToolbar?: ReactNode;
  onSelect?: (key: string | null) => void;
}

export interface QueueActions {
  toast: (message: string, kind?: 'ok' | 'err' | 'info') => void;
  refresh: () => void;
  close: () => void;
  selectNext: () => void;
  selectPrev: () => void;
  currentIndex: number;
  totalCount: number;
}

// ── Styles ───────────────────────────────────────────────────────────────

const MESH_BG_DARK = `radial-gradient(ellipse at 20% 50%, rgba(94,193,202,0.06) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(155,106,237,0.04) 0%, transparent 50%),
  radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.03) 0%, transparent 50%),
  linear-gradient(135deg, #1a1e24 0%, #14171c 100%)`;

const MESH_BG_LIGHT = `radial-gradient(ellipse at 20% 50%, rgba(94,193,202,0.04) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(155,106,237,0.03) 0%, transparent 50%),
  radial-gradient(ellipse at 50% 80%, rgba(16,185,129,0.02) 0%, transparent 50%),
  linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)`;

const KEYFRAME_CSS = `
@keyframes qShift {
  0%, 100% { background-position: 0% 0%; }
  50% { background-position: 100% 0%; }
}`;

// ── Component ────────────────────────────────────────────────────────────

export function UnifiedQueue<T>({ config, items: externalItems, loading: externalLoading }: {
  config: UnifiedQueueConfig<T>;
  items?: T[];
  loading?: boolean;
}) {
  const [internalItems, setInternalItems] = useState<T[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(config.groupCollapsed ?? []),
  );
  const [listWidthPct, setListWidthPct] = useState(() => {
    try {
      const saved = sessionStorage.getItem('uq-list-width');
      return saved ? Number(saved) : 40;
    } catch { return 40; }
  });
  const [listCollapsed, setListCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const listWidthRef = useRef(listWidthPct);
  listWidthRef.current = listWidthPct;
  const { theme } = useTheme();
  const isLight = theme === 'light' || (theme === 'system' && typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches);
  const borderColor = isLight ? '#e2e8f0' : '#2f353d';
  const meshBg = isLight ? MESH_BG_LIGHT : MESH_BG_DARK;
  const btnBg = isLight ? '#e2e8f0' : '#2f353d';
  const btnHoverBg = isLight ? '#cbd5e1' : '#363d47';
  const groupHeaderBg = isLight ? 'rgba(248,250,252,0.95)' : 'rgba(26,30,36,0.95)';
  const scrollbarColor = isLight ? '#cbd5e1 transparent' : '#3a424d transparent';

  const items = externalItems ?? internalItems;
  const loading = externalLoading ?? internalLoading;

  // ── Fetch ────────────────────────────────────────────────────────────
  const fetchRef = useRef(config.fetchItems);
  fetchRef.current = config.fetchItems;

  const refresh = useCallback(async () => {
    if (externalItems) return;
    try {
      const data = await fetchRef.current();
      setInternalItems(data);
    } catch {
      /* silent */
    } finally {
      setInternalLoading(false);
    }
  }, [externalItems]);

  useEffect(() => {
    if (externalItems) return;
    refresh();
    const interval = setInterval(refresh, config.pollIntervalMs ?? 30000);
    return () => clearInterval(interval);
  }, [refresh, config.pollIntervalMs, externalItems]);

  useEffect(() => { config.onSelect?.(selectedKey); }, [selectedKey]);

  // ── Filter + Search ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items;
    if (search && config.searchFn) {
      const q = search.toLowerCase();
      list = list.filter(item => config.searchFn!(item, q));
    }
    return list;
  }, [items, search, config]);

  // ── Flat list (respecting group order) ───────────────────────────────
  const groups = useMemo(() => {
    if (!config.groupBy) return null;
    const map = new Map<string, T[]>();
    for (const item of filtered) {
      const group = config.groupBy(item);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(item);
    }
    if (config.groupOrder) {
      const ordered = new Map<string, T[]>();
      for (const g of config.groupOrder) {
        if (map.has(g)) ordered.set(g, map.get(g)!);
      }
      for (const [g, v] of map) {
        if (!ordered.has(g)) ordered.set(g, v);
      }
      return ordered;
    }
    return map;
  }, [filtered, config]);

  const flatList = useMemo(() => {
    if (groups) {
      const flat: T[] = [];
      for (const [group, groupItems] of groups) {
        if (!collapsedGroups.has(group)) flat.push(...groupItems);
      }
      return flat;
    }
    return filtered;
  }, [groups, filtered, collapsedGroups]);

  // ── Actions ──────────────────────────────────────────────────────────
  const toast = useCallback((message: string, kind?: 'ok' | 'err' | 'info') => {
    setToasts(prev => [...prev, { id: nextToastId(), message, kind }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const close = useCallback(() => setSelectedKey(null), []);

  const selectByIndex = useCallback((idx: number) => {
    if (idx >= 0 && idx < flatList.length) {
      setFocusIndex(idx);
      setSelectedKey(config.getKey(flatList[idx]));
    }
  }, [flatList, config]);

  const selectNext = useCallback(() => selectByIndex(focusIndex + 1), [selectByIndex, focusIndex]);
  const selectPrev = useCallback(() => selectByIndex(focusIndex - 1), [selectByIndex, focusIndex]);

  const queueActions: QueueActions = useMemo(() => ({
    toast, refresh, close, selectNext, selectPrev,
    currentIndex: focusIndex,
    totalCount: flatList.length,
  }), [toast, refresh, close, selectNext, selectPrev, focusIndex, flatList.length]);

  // ── Keyboard ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const currentItem = flatList[focusIndex] ?? null;
      if (config.onKeyAction?.(e.key, currentItem)) { e.preventDefault(); return; }

      switch (e.key) {
        case 'j':
          e.preventDefault();
          selectByIndex(Math.min(focusIndex + 1, flatList.length - 1));
          break;
        case 'k':
          e.preventDefault();
          selectByIndex(Math.max(focusIndex - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (currentItem) setSelectedKey(config.getKey(currentItem));
          break;
        case 'Escape':
          e.preventDefault();
          setSelectedKey(null);
          break;
        case '[':
          e.preventDefault();
          setListCollapsed(prev => !prev);
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flatList, focusIndex, config, selectByIndex]);

  // ── Scroll focused row into view ─────────────────────────────────────
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-queue-idx="${focusIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  // ── Selection helpers ────────────────────────────────────────────────
  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(new Set(flatList.map(config.getKey)));
  }, [flatList, config]);

  const deselectAll = useCallback(() => setSelectedKeys(new Set()), []);

  // ── Selected item ────────────────────────────────────────────────────
  const selectedItem = useMemo(
    () => (selectedKey ? items.find(i => config.getKey(i) === selectedKey) ?? null : null),
    [selectedKey, items, config],
  );

  // ── Render ───────────────────────────────────────────────────────────
  const allShortcuts: KeyboardShortcut[] = [
    { key: 'j/k', label: 'navigate' },
    { key: 'Enter', label: 'open' },
    { key: 'Esc', label: 'close' },
    { key: '[', label: 'toggle list' },
    ...(config.keyboardShortcuts ?? []),
  ];

  return (
    <div className="h-full flex flex-col" style={{ background: meshBg, '--uq-border': borderColor } as React.CSSProperties}>
      <style>{KEYFRAME_CSS}</style>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--uq-border)]">
        <span className="text-lg">{config.icon}</span>
        <h2
          className="text-sm font-bold uppercase tracking-wider"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {config.title}
        </h2>
        <div className="flex-1" />

        {/* Stats */}
        {config.stats && config.stats.length > 0 && (
          <div className="flex items-center gap-4">
            {config.stats.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-sm font-bold" style={{ color: s.color ?? '#e2e8f0' }}>
                  {s.value}
                </div>
                <div className="text-[9px] uppercase tracking-wider text-neutral-500">{s.label}</div>
                {s.subtitle && <div className="text-[8px] text-neutral-600">{s.subtitle}</div>}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => refresh()}
          className="p-1.5 rounded-lg text-neutral-400 transition-colors"
          style={{ background: btnBg }}
          onMouseEnter={e => (e.currentTarget.style.background = btnHoverBg)}
          onMouseLeave={e => (e.currentTarget.style.background = btnBg)}
          title="Refresh"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M20.49 9A9 9 0 005.64 5.64L4 4m16 16l-1.64-1.64A9 9 0 014.51 15" />
          </svg>
        </button>
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--uq-border)] flex-wrap">
        {/* Search */}
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={config.searchPlaceholder ?? 'Search...'}
            className="pl-8 pr-3 py-1.5 rounded-lg bg-[#1a1e24] border border-[var(--uq-border)] text-[11px] text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-[#5ec1ca]/40 w-48"
          />
        </div>

        <button
          onClick={() => setListCollapsed(prev => !prev)}
          className="p-1.5 rounded-lg text-neutral-400 transition-colors"
          style={{ background: btnBg }}
          onMouseEnter={e => (e.currentTarget.style.background = btnHoverBg)}
          onMouseLeave={e => (e.currentTarget.style.background = btnBg)}
          title={listCollapsed ? 'Show ticket list' : 'Hide ticket list'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {listCollapsed
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            }
          </svg>
        </button>

        {/* Filter pills */}
        {config.filters && (
          <div className="flex items-center gap-1">
            {config.filters.map(f => (
              <button
                key={f.key}
                onClick={() => config.onFilterChange?.(f.key)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors ${
                  config.activeFilter === f.key
                    ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30'
                    : 'bg-[#2f353d] text-neutral-400 border border-transparent hover:bg-[#363d47]'
                }`}
              >
                {f.label}{f.count != null ? ` (${f.count})` : ''}
              </button>
            ))}
          </div>
        )}

        {config.extraToolbar}

        <div className="flex-1" />

        {/* Bulk actions */}
        {config.selectable && selectedKeys.size > 0 && config.bulkActions && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-neutral-500">{selectedKeys.size} selected</span>
            {config.bulkActions.map(ba => (
              <button
                key={ba.key}
                onClick={() => ba.onExecute(Array.from(selectedKeys))}
                className={`px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${
                  ba.variant === 'danger' ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50' :
                  ba.variant === 'primary' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] hover:bg-[#5ec1ca]/25' :
                  'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                }`}
              >
                {ba.icon}{ba.label}
              </button>
            ))}
          </div>
        )}

        {/* Select all / deselect */}
        {config.selectable && (
          <button
            onClick={selectedKeys.size > 0 ? deselectAll : selectAll}
            className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            {selectedKeys.size > 0 ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </div>

      {/* ── Split pane ──────────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 flex min-h-0">
        {/* Queue list (left) */}
        <div
          ref={listRef}
          className="overflow-y-auto border-r border-[var(--uq-border)]"
          style={{
            width: listCollapsed ? 0 : listWidthPct + '%',
            display: listCollapsed ? 'none' : undefined,
            scrollbarWidth: 'thin',
            scrollbarColor: scrollbarColor,
          }}
        >
          {loading && !items.length ? (
            <div className="flex items-center justify-center h-full text-neutral-600 text-[11px]">Loading…</div>
          ) : flatList.length === 0 ? (
            config.renderEmpty ? config.renderEmpty() : (
              <div className="flex items-center justify-center h-full text-neutral-600 text-[11px]">
                No items
              </div>
            )
          ) : groups ? (
            /* Grouped rendering */
            Array.from(groups.entries()).map(([group, groupItems]) => (
              <div key={group}>
                <button
                  onClick={() => setCollapsedGroups(prev => {
                    const next = new Set(prev);
                    if (next.has(group)) next.delete(group); else next.add(group);
                    return next;
                  })}
                  className="w-full flex items-center gap-2 px-4 py-2 text-[9px] font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-300 transition-colors sticky top-0 z-10"
                  style={{ background: groupHeaderBg, backdropFilter: 'blur(8px)' }}
                >
                  <span className="transition-transform" style={{ transform: collapsedGroups.has(group) ? 'rotate(-90deg)' : 'rotate(0)' }}>▾</span>
                  {group}
                  <span className="text-neutral-600 font-normal">({groupItems.length})</span>
                </button>
                {!collapsedGroups.has(group) && groupItems.map(item => {
                  const key = config.getKey(item);
                  const idx = flatList.indexOf(item);
                  return (
                    <div
                      key={key}
                      data-queue-idx={idx}
                      onClick={() => { setSelectedKey(key); setFocusIndex(idx); }}
                      className="cursor-pointer"
                    >
                      {config.selectable && (
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          onChange={() => toggleSelect(key)}
                          onClick={e => e.stopPropagation()}
                          className="absolute left-2 top-1/2 -translate-y-1/2 accent-[#5ec1ca]"
                        />
                      )}
                      {config.renderRow(item, { selected: selectedKey === key, focused: focusIndex === idx })}
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            /* Flat rendering */
            flatList.map((item, idx) => {
              const key = config.getKey(item);
              return (
                <div
                  key={key}
                  data-queue-idx={idx}
                  onClick={() => { setSelectedKey(key); setFocusIndex(idx); }}
                  className="cursor-pointer relative"
                >
                  {config.selectable && (
                    <input
                      type="checkbox"
                      checked={selectedKeys.has(key)}
                      onChange={() => toggleSelect(key)}
                      onClick={e => e.stopPropagation()}
                      className="absolute left-2 top-1/2 -translate-y-1/2 accent-[#5ec1ca] z-10"
                    />
                  )}
                  {config.renderRow(item, { selected: selectedKey === key, focused: focusIndex === idx })}
                </div>
              );
            })
          )}
        </div>

        {/* ── Drag handle ──────────────────────────────────────────── */}
        {!listCollapsed && (
          <div
            className="w-1 cursor-col-resize flex-shrink-0 relative group"
            style={{ background: borderColor }}
            onMouseDown={(e) => {
              e.preventDefault();
              dragging.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';

              const onMove = (ev: MouseEvent) => {
                if (!dragging.current || !containerRef.current) return;
                const rect = containerRef.current.getBoundingClientRect();
                const pct = ((ev.clientX - rect.left) / rect.width) * 100;
                setListWidthPct(Math.max(15, Math.min(85, pct)));
              };

              const onUp = () => {
                dragging.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                try { sessionStorage.setItem('uq-list-width', String(listWidthRef.current)); } catch {}
              };

              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          >
            <div className="absolute inset-y-0 -left-0.5 -right-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: '#5ec1ca', borderRadius: 2 }} />
          </div>
        )}

        {/* Detail panel (right) */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: listCollapsed ? '100%' : (100 - listWidthPct) + '%' }}
        >
          <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: scrollbarColor }}>
            {selectedItem ? (
              config.renderDetail(selectedItem, queueActions)
            ) : (
              <div className="flex items-center justify-center h-full text-neutral-600 text-[11px]">
                <div className="text-center">
                  <div className="text-2xl mb-2">📋</div>
                  <div>Select an item to view details</div>
                  <div className="text-[9px] mt-1 text-neutral-700">Use j/k to navigate, Enter to open</div>
                </div>
              </div>
            )}
          </div>
          {selectedItem && (
            <DetailNavBar actions={queueActions} currentIndex={focusIndex} totalCount={flatList.length} />
          )}
        </div>
      </div>

      {/* ── Keyboard hints ──────────────────────────────────────────── */}
      <KeyboardHints shortcuts={allShortcuts} />

      {/* ── Toasts ──────────────────────────────────────────────────── */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

// ── Detail navigation bar ─────────────────────────────────────────────────

export function DetailNavBar({ actions, currentIndex, totalCount }: {
  actions: QueueActions;
  currentIndex: number;
  totalCount: number;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t"
      style={{ borderColor: 'var(--uq-border, #2f353d)' }}>
      <button
        onClick={actions.selectPrev}
        disabled={currentIndex <= 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-[#2f353d] text-neutral-300 hover:bg-[#363d47]"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Prev
      </button>
      <span className="text-[10px] text-neutral-500">
        {currentIndex + 1} of {totalCount}
      </span>
      <button
        onClick={actions.selectNext}
        disabled={currentIndex >= totalCount - 1}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-[#2f353d] text-neutral-300 hover:bg-[#363d47]"
      >
        Next
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
