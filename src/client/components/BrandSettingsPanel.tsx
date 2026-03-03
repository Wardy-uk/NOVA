import { useState, useEffect, useCallback, useRef } from 'react';
import { BRAND_SETTING_DEFS, BRAND_SETTING_GROUPS } from '../../shared/brand-settings-defs.js';
import type { BrandSettingDef } from '../../shared/brand-settings-defs.js';

interface Props {
  deliveryId: number;
}

const inputCls = 'w-full bg-[#1f242b] text-neutral-300 text-[11px] rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600';

export function BrandSettingsPanel({ deliveryId }: Props) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const pendingSaves = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const json = await res.json();
        setEnabled(json.ok && json.data?.feature_instance_setup === 'true');
      } catch { setEnabled(false); }
    })();
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`/api/brand-settings/delivery/${deliveryId}`);
      const json = await res.json();
      if (json.ok) setSettings(json.data);
    } catch { /* ignore */ }
  }, [deliveryId]);

  useEffect(() => {
    if (enabled) fetchSettings();
  }, [fetchSettings, enabled]);

  if (enabled === null || enabled === false) return null;

  const filledCount = BRAND_SETTING_DEFS.filter(d => settings[d.key]?.trim()).length;

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);

    // Debounced auto-save per field
    if (pendingSaves.current[key]) clearTimeout(pendingSaves.current[key]);
    pendingSaves.current[key] = setTimeout(async () => {
      try {
        await fetch(`/api/brand-settings/delivery/${deliveryId}/${encodeURIComponent(key)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: value || null }),
        });
      } catch { /* ignore */ }
    }, 800);
  };

  const handleSaveAll = async () => {
    // Cancel pending debounced saves
    for (const t of Object.values(pendingSaves.current)) clearTimeout(t);
    pendingSaves.current = {};

    setSaving(true);
    try {
      const res = await fetch(`/api/brand-settings/delivery/${deliveryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json();
      if (json.ok) { setSettings(json.data); setDirty(false); }
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const renderField = (def: BrandSettingDef) => {
    const value = settings[def.key] || '';
    if (def.type === 'color') {
      return (
        <div key={def.key} className="flex items-center gap-2">
          <label className="text-[10px] text-neutral-400 w-32 shrink-0">{def.label}{def.required && <span className="text-red-400">*</span>}</label>
          <input
            type="color"
            value={value || '#000000'}
            onChange={e => handleChange(def.key, e.target.value)}
            className="w-7 h-7 rounded border border-[#3a424d] bg-transparent cursor-pointer shrink-0"
          />
          <input
            type="text"
            value={value}
            onChange={e => handleChange(def.key, e.target.value)}
            placeholder="#000000"
            className={`${inputCls} flex-1`}
          />
        </div>
      );
    }
    return (
      <div key={def.key} className="flex items-center gap-2">
        <label className="text-[10px] text-neutral-400 w-32 shrink-0">{def.label}{def.required && <span className="text-red-400">*</span>}</label>
        <input
          type={def.type === 'url' ? 'url' : def.type === 'email' ? 'email' : 'text'}
          value={value}
          onChange={e => handleChange(def.key, e.target.value)}
          placeholder={def.placeholder || ''}
          className={`${inputCls} flex-1`}
        />
      </div>
    );
  };

  // Colour swatches preview
  const colorDefs = BRAND_SETTING_DEFS.filter(d => d.type === 'color');
  const hasAnyColor = colorDefs.some(d => settings[d.key]?.trim());

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#272C33] p-3 space-y-2">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
        <span className="text-xs font-semibold text-neutral-300">Brand Settings</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-500">{filledCount}/{BRAND_SETTING_DEFS.length} configured</span>
          <span className="text-[10px] text-neutral-500">{collapsed ? '\u25B6' : '\u25BC'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Colour swatches preview */}
          {hasAnyColor && (
            <div className="flex items-center gap-1 flex-wrap">
              {colorDefs.map(d => {
                const c = settings[d.key];
                if (!c) return null;
                return (
                  <div key={d.key} className="flex items-center gap-1" title={`${d.label}: ${c}`}>
                    <div className="w-4 h-4 rounded border border-[#3a424d]" style={{ backgroundColor: c }} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Group accordions */}
          <div className="space-y-1">
            {BRAND_SETTING_GROUPS.map(group => {
              const groupDefs = BRAND_SETTING_DEFS.filter(d => d.group === group.id);
              const groupFilled = groupDefs.filter(d => settings[d.key]?.trim()).length;
              const isOpen = openGroups.has(group.id);

              return (
                <div key={group.id} className="border border-[#3a424d] rounded bg-[#1f242b]">
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] hover:bg-[#272C33] transition-colors rounded"
                  >
                    <span className="text-neutral-300 font-medium">{group.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-neutral-500">{groupFilled}/{groupDefs.length}</span>
                      <span className="text-[10px] text-neutral-500">{isOpen ? '\u25BC' : '\u25B6'}</span>
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-2 pb-2 space-y-1.5">
                      {groupDefs.map(renderField)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1 border-t border-[#3a424d]">
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="px-3 py-1 text-[10px] rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save All'}
            </button>
            {dirty && <span className="text-[9px] text-amber-400">Unsaved changes</span>}
          </div>
        </>
      )}
    </div>
  );
}
