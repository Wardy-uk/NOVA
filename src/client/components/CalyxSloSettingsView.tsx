import { useState } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, labelStyle, EmptyState, calyxApi, useCalyxData, ragColor } from './calyx-shared.js';

interface SloDefinition {
  id: number;
  name: string;
  metric_type: string;
  target_minutes: number;
  warning_pct: number;
  team: string | null;
  priority: string | null;
  category: string | null;
  use_business_hours: boolean;
  active: boolean;
  compliance_pct?: number | null;
  met_count?: number | null;
  total_count?: number | null;
}

interface SloFormData {
  name: string;
  metric_type: string;
  target_value: number;
  target_unit: 'minutes' | 'hours' | 'days';
  warning_pct: number;
  team: string;
  priority: string;
  category: string;
  use_business_hours: boolean;
  active: boolean;
}

const METRIC_TYPES = [
  { value: 'first_response_time', label: 'First Response Time' },
  { value: 'resolution_time', label: 'Resolution Time' },
  { value: 'update_frequency', label: 'Update Frequency' },
];

function formatTarget(minutes: number): string {
  if (minutes < 60) return `${minutes} mins`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    return `${h} hour${h !== 1 ? 's' : ''}`;
  }
  const d = Math.floor(minutes / 1440);
  return `${d} day${d !== 1 ? 's' : ''}`;
}

function minutesToForm(minutes: number): { value: number; unit: 'minutes' | 'hours' | 'days' } {
  if (minutes >= 1440 && minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function formToMinutes(value: number, unit: string): number {
  if (unit === 'hours') return value * 60;
  if (unit === 'days') return value * 1440;
  return value;
}

function metricLabel(type: string): string {
  const m = METRIC_TYPES.find(t => t.value === type);
  return m ? m.label : type.replace(/_/g, ' ');
}

const defaultForm: SloFormData = {
  name: '',
  metric_type: 'first_response_time',
  target_value: 60,
  target_unit: 'minutes',
  warning_pct: 80,
  team: '',
  priority: '',
  category: '',
  use_business_hours: true,
  active: true,
};

export function CalyxSloSettingsView() {
  const { data: slos, loading, reload } = useCalyxData<SloDefinition[]>('/slo-definitions');
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SloFormData>({ ...defaultForm });
  const [saving, setSaving] = useState(false);

  function openNew() {
    setEditingId(null);
    setForm({ ...defaultForm });
    setPanelOpen(true);
  }

  function openEdit(slo: SloDefinition) {
    const t = minutesToForm(slo.target_minutes);
    setEditingId(slo.id);
    setForm({
      name: slo.name,
      metric_type: slo.metric_type,
      target_value: t.value,
      target_unit: t.unit,
      warning_pct: slo.warning_pct,
      team: slo.team || '',
      priority: slo.priority || '',
      category: slo.category || '',
      use_business_hours: slo.use_business_hours,
      active: slo.active,
    });
    setPanelOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    const body = {
      name: form.name,
      metric_type: form.metric_type,
      target_minutes: formToMinutes(form.target_value, form.target_unit),
      warning_pct: form.warning_pct,
      team: form.team || null,
      priority: form.priority || null,
      category: form.category || null,
      use_business_hours: form.use_business_hours,
      active: form.active,
    };
    if (editingId) {
      await calyxApi(`/slo-definitions/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await calyxApi('/slo-definitions', { method: 'POST', body: JSON.stringify(body) });
    }
    setSaving(false);
    setPanelOpen(false);
    reload();
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this SLO definition?')) return;
    await calyxApi(`/slo-definitions/${id}`, { method: 'DELETE' });
    reload();
  }

  async function toggleActive(slo: SloDefinition) {
    await calyxApi(`/slo-definitions/${slo.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !slo.active }),
    });
    reload();
  }

  const SlidePanel = ({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) => {
    if (!open) return null;
    return (
      <>
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 520, maxWidth: '90vw', background: C.bg0,
          borderLeft: `1px solid ${C.border}`, zIndex: 1000, display: 'flex', flexDirection: 'column',
          boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
            <h3 style={{ margin: 0, fontSize: 16, color: C.text1 }}>{title}</h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 18 }}>&times;</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>{children}</div>
        </div>
      </>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.text1 }}>SLO Definitions</h2>
        <button style={btnPrimary} onClick={openNew}>New SLO</button>
      </div>

      {/* Loading */}
      {loading && <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>}

      {/* Empty */}
      {!loading && (!slos || slos.length === 0) && (
        <EmptyState icon="chart" title="No SLO definitions" subtitle="Create your first service level objective to start tracking compliance." />
      )}

      {/* Card grid */}
      {!loading && slos && slos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {slos.map(slo => {
            const compliancePct = slo.compliance_pct ?? null;
            const complianceColor = compliancePct !== null ? ragColor(compliancePct, 90, true) : C.text3;
            return (
              <div key={slo.id} style={{ ...cardStyle, opacity: slo.active ? 1 : 0.6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Name + metric badge */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.text1, flex: 1 }}>{slo.name}</span>
                  <span style={{
                    fontSize: 10, color: C.text3, background: `${C.text3}15`, padding: '2px 8px',
                    borderRadius: 10, whiteSpace: 'nowrap',
                  }}>{metricLabel(slo.metric_type)}</span>
                </div>

                {/* Target + Warning */}
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.text2 }}>
                  <span>Target: <strong style={{ color: C.text1 }}>{formatTarget(slo.target_minutes)}</strong></span>
                  <span>Warn at <strong style={{ color: C.amber }}>{slo.warning_pct}%</strong></span>
                </div>

                {/* Applies to */}
                <div style={{ fontSize: 12, color: C.text3 }}>
                  Applies to: {slo.team || 'All'} / {slo.priority || 'All'} / {slo.category || 'All'}
                </div>

                {/* Business hours */}
                <div>
                  {slo.use_business_hours ? (
                    <span style={{ fontSize: 11, color: C.teal, background: `${C.teal}15`, padding: '2px 8px', borderRadius: 10 }}>Business hours</span>
                  ) : (
                    <span style={{ fontSize: 11, color: C.text3, background: `${C.text3}10`, padding: '2px 8px', borderRadius: 10 }}>24/7</span>
                  )}
                </div>

                {/* 30-day compliance */}
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: C.text3, marginBottom: 4 }}>30-day compliance</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: complianceColor, lineHeight: 1 }}>
                    {compliancePct !== null ? `${compliancePct.toFixed(1)}%` : '--'}
                  </div>
                  {/* Mini bar */}
                  <div style={{ height: 6, borderRadius: 3, background: `${C.text3}20`, marginTop: 6, overflow: 'hidden' }}>
                    {compliancePct !== null && (
                      <div style={{ height: 6, borderRadius: 3, background: complianceColor, width: `${Math.min(compliancePct, 100)}%`, transition: 'width 0.4s' }} />
                    )}
                  </div>
                  {slo.met_count !== null && slo.met_count !== undefined && slo.total_count !== null && slo.total_count !== undefined && (
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>
                      {slo.met_count} of {slo.total_count} tickets met
                    </div>
                  )}
                </div>

                {/* Actions row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  {/* Active/Inactive pill toggle */}
                  <button
                    onClick={() => toggleActive(slo)}
                    style={{
                      padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: slo.active ? `${C.teal}20` : `${C.text3}15`,
                      color: slo.active ? C.teal : C.text3,
                      transition: 'all 0.2s',
                    }}
                  >
                    {slo.active ? 'Active' : 'Inactive'}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => openEdit(slo)} style={{ ...btnSecondary, padding: '4px 12px', fontSize: 11 }}>Edit</button>
                  <button onClick={() => handleDelete(slo.id)} style={{ background: 'none', border: 'none', color: C.text3, cursor: 'pointer', fontSize: 11 }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Slide panel form */}
      <SlidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? 'Edit SLO' : 'New SLO'}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>Name</label>
            <input
              style={inputStyle}
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. P1 First Response"
            />
          </div>

          {/* Metric type */}
          <div>
            <label style={labelStyle}>Metric Type</label>
            <select
              style={{ ...selectStyle, width: '100%' }}
              value={form.metric_type}
              onChange={e => setForm({ ...form, metric_type: e.target.value })}
            >
              {METRIC_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          {/* Target */}
          <div>
            <label style={labelStyle}>Target</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                min={1}
                style={{ ...inputStyle, flex: 1 }}
                value={form.target_value}
                onChange={e => setForm({ ...form, target_value: Math.max(1, parseInt(e.target.value) || 1) })}
              />
              <select
                style={selectStyle}
                value={form.target_unit}
                onChange={e => setForm({ ...form, target_unit: e.target.value as 'minutes' | 'hours' | 'days' })}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
          </div>

          {/* Warning threshold */}
          <div>
            <label style={labelStyle}>Warning Threshold: {form.warning_pct}%</label>
            <input
              type="range"
              min={50}
              max={95}
              value={form.warning_pct}
              onChange={e => setForm({ ...form, warning_pct: parseInt(e.target.value) })}
              style={{ width: '100%', accentColor: C.teal }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.text3 }}>
              <span>50%</span><span>95%</span>
            </div>
          </div>

          {/* Applies to section */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text1, marginBottom: 12 }}>Applies to</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>Team (empty = all)</label>
                <input
                  style={inputStyle}
                  value={form.team}
                  onChange={e => setForm({ ...form, team: e.target.value })}
                  placeholder="All teams"
                />
              </div>

              <div>
                <label style={labelStyle}>Priority</label>
                <select
                  style={{ ...selectStyle, width: '100%' }}
                  value={form.priority}
                  onChange={e => setForm({ ...form, priority: e.target.value })}
                >
                  <option value="">All</option>
                  <option value="P1">P1</option>
                  <option value="P2">P2</option>
                  <option value="P3">P3</option>
                  <option value="P4">P4</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Category (empty = all)</label>
                <input
                  style={inputStyle}
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                  placeholder="All categories"
                />
              </div>
            </div>
          </div>

          {/* Toggles */}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.use_business_hours}
                onChange={e => setForm({ ...form, use_business_hours: e.target.checked })}
                style={{ accentColor: C.teal }}
              />
              <span style={{ fontSize: 13, color: C.text1 }}>Business hours only</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                style={{ accentColor: C.teal }}
              />
              <span style={{ fontSize: 13, color: C.text1 }}>Active</span>
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, paddingTop: 8 }}>
            <button style={btnPrimary} onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button style={btnSecondary} onClick={() => setPanelOpen(false)}>Cancel</button>
          </div>
        </div>
      </SlidePanel>
    </div>
  );
}
