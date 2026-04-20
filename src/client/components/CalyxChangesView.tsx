import { useState, useEffect, type CSSProperties } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnDanger, labelStyle, StatusBadge, ReferenceTag, EmptyState, SlidePanel, calyxApi, useCalyxData, formatDate } from './calyx-shared.js';

interface Change {
  id: number;
  reference: string;
  title: string;
  type: 'normal' | 'standard' | 'emergency';
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'implementing' | 'complete' | 'cancelled';
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  impact_assessment: string | null;
  rollback_plan: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  requested_by_agent_id: number | null;
  rejection_reason: string | null;
  created_at: string;
}

interface Agent {
  id: number;
  name: string;
}

type ChangeStatus = Change['status'];
type ChangeType = Change['type'];
type RiskLevel = Change['risk_level'];

const STATUS_OPTIONS: { value: ChangeStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'implementing', label: 'Implementing' },
  { value: 'complete', label: 'Complete' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TYPE_OPTIONS: { value: ChangeType | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'normal', label: 'Normal' },
  { value: 'standard', label: 'Standard' },
  { value: 'emergency', label: 'Emergency' },
];

const textareaStyle: CSSProperties = {
  ...inputStyle,
  height: 80,
  resize: 'vertical' as const,
  fontFamily: 'inherit',
};

const pillBase: CSSProperties = {
  padding: '6px 14px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  transition: 'all 0.2s',
};

function getUserRole(): string {
  try {
    const raw = localStorage.getItem('nova_user');
    if (raw) {
      const user = JSON.parse(raw);
      return user.role || '';
    }
  } catch { /* ignore */ }
  return '';
}

function getAgentName(agents: Agent[], id: number | null): string {
  if (!id) return '-';
  const a = agents.find(ag => ag.id === id);
  return a ? a.name : '-';
}

export function CalyxChangesView() {
  const [changes, setChanges] = useState<Change[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ChangeStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<ChangeType | ''>('');
  const [selectedChange, setSelectedChange] = useState<Change | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  // Editable fields for detail panel
  const [editDesc, setEditDesc] = useState('');
  const [editRisk, setEditRisk] = useState<RiskLevel>('low');
  const [editImpact, setEditImpact] = useState('');
  const [editRollback, setEditRollback] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [saving, setSaving] = useState(false);

  // Reject reason
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // New form state
  const [newForm, setNewForm] = useState({
    title: '',
    description: '',
    type: 'normal' as ChangeType,
    risk_level: 'low' as RiskLevel,
    impact_assessment: '',
    rollback_plan: '',
    scheduled_start_at: '',
    scheduled_end_at: '',
  });
  const [creating, setCreating] = useState(false);

  const isAdmin = getUserRole() === 'admin';

  async function loadChanges() {
    const res = await calyxApi<Change[]>('/changes');
    if (res.ok && res.data) setChanges(res.data);
  }

  async function loadAgents() {
    const res = await calyxApi<Agent[]>('/agents');
    if (res.ok && res.data) setAgents(res.data);
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadChanges(), loadAgents()]);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  // Sync edit fields when selectedChange changes
  useEffect(() => {
    if (selectedChange) {
      setEditDesc(selectedChange.impact_assessment || '');
      setEditRisk(selectedChange.risk_level);
      setEditImpact(selectedChange.impact_assessment || '');
      setEditRollback(selectedChange.rollback_plan || '');
      setEditStart(selectedChange.scheduled_start_at ? toDatetimeLocal(selectedChange.scheduled_start_at) : '');
      setEditEnd(selectedChange.scheduled_end_at ? toDatetimeLocal(selectedChange.scheduled_end_at) : '');
      setShowRejectInput(false);
      setRejectReason('');
    }
  }, [selectedChange]);

  function toDatetimeLocal(d: string): string {
    try {
      const dt = new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') ? '' : 'Z'));
      return dt.toISOString().slice(0, 16);
    } catch { return ''; }
  }

  // Filtering
  const filtered = changes.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (typeFilter && c.type !== typeFilter) return false;
    return true;
  });

  // Transition helpers
  async function doTransition(id: number, action: string, body?: object) {
    setSaving(true);
    await calyxApi(`/changes/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
    await loadChanges();
    // Refresh selectedChange
    const res = await calyxApi<Change[]>('/changes');
    if (res.ok && res.data) {
      setChanges(res.data);
      const updated = res.data.find(c => c.id === id);
      if (updated) setSelectedChange(updated);
    }
    setSaving(false);
  }

  async function handleSave() {
    if (!selectedChange) return;
    setSaving(true);
    await calyxApi(`/changes/${selectedChange.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        risk_level: editRisk,
        impact_assessment: editImpact,
        rollback_plan: editRollback,
        scheduled_start_at: editStart || null,
        scheduled_end_at: editEnd || null,
      }),
    });
    await loadChanges();
    const res = await calyxApi<Change[]>('/changes');
    if (res.ok && res.data) {
      setChanges(res.data);
      const updated = res.data.find(c => c.id === selectedChange.id);
      if (updated) setSelectedChange(updated);
    }
    setSaving(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newForm.title) return;
    setCreating(true);
    await calyxApi('/changes', { method: 'POST', body: JSON.stringify(newForm) });
    await loadChanges();
    setShowNewForm(false);
    setNewForm({ title: '', description: '', type: 'normal', risk_level: 'low', impact_assessment: '', rollback_plan: '', scheduled_start_at: '', scheduled_end_at: '' });
    setCreating(false);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 16 }}>
        <div style={{ width: 40, height: 40, border: `3px solid ${C.border}`, borderTopColor: C.teal, borderRadius: '50%', animation: 'calyxSpin 0.8s linear infinite' }} />
        <span style={{ fontSize: 13, color: C.text3 }}>Loading changes...</span>
      </div>
    );
  }

  return (
    <div>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24,
        flexWrap: 'wrap', gap: 12,
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text1, margin: 0 }}>Changes</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Status pills */}
          {STATUS_OPTIONS.map(opt => {
            const active = statusFilter === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value as ChangeStatus | '')}
                style={{
                  ...pillBase,
                  color: active ? C.bg0 : C.text3,
                  background: active ? C.teal : C.glass,
                  border: `1px solid ${active ? C.teal : C.border}`,
                }}
              >
                {opt.label}
              </button>
            );
          })}

          {/* Type filter */}
          <select
            style={{ ...selectStyle, marginLeft: 8 }}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as ChangeType | '')}
          >
            {TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.value ? o.label : 'All Types'}</option>
            ))}
          </select>

          <button
            onClick={() => setShowNewForm(true)}
            style={{
              ...btnPrimary,
              marginLeft: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Change Request
          </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState icon="inbox" title="No changes found" subtitle="Try adjusting your filters or create a new change request" />
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Reference', 'Title', 'Type', 'Status', 'Risk', 'Scheduled Start', 'Requested By'].map(h => (
                  <th key={h} style={{
                    padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    color: C.text3, textTransform: 'uppercase', letterSpacing: '0.5px',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(ch => (
                <tr
                  key={ch.id}
                  onClick={() => setSelectedChange(ch)}
                  style={{
                    borderBottom: `1px solid ${C.border}`,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.glassHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 16px' }}>
                    <ReferenceTag ref={ch.reference} />
                  </td>
                  <td style={{ padding: '10px 16px', color: C.text1, fontWeight: 500, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.title}
                  </td>
                  <td style={{ padding: '10px 16px' }}><StatusBadge status={ch.type} /></td>
                  <td style={{ padding: '10px 16px' }}><StatusBadge status={ch.status} /></td>
                  <td style={{ padding: '10px 16px' }}><StatusBadge status={ch.risk_level} /></td>
                  <td style={{ padding: '10px 16px', color: C.text2, fontSize: 12 }}>
                    {ch.scheduled_start_at ? formatDate(ch.scheduled_start_at) : '-'}
                  </td>
                  <td style={{ padding: '10px 16px', color: C.text2, fontSize: 12 }}>
                    {getAgentName(agents, ch.requested_by_agent_id)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Slide panel detail */}
      <SlidePanel
        open={!!selectedChange}
        onClose={() => setSelectedChange(null)}
        title="Change Detail"
        width={580}
      >
        {selectedChange && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header: reference + title + badges */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <ReferenceTag ref={selectedChange.reference} />
                <StatusBadge status={selectedChange.type} />
                <StatusBadge status={selectedChange.status} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text1, margin: 0 }}>{selectedChange.title}</h2>
            </div>

            {/* Admin approve/reject for submitted changes */}
            {selectedChange.status === 'submitted' && isAdmin && (
              <div style={{
                background: C.glass, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16,
                display: 'flex', flexDirection: 'column', gap: 10,
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 4 }}>Approval Decision</div>
                {!showRejectInput ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => doTransition(selectedChange.id, 'approve')}
                      disabled={saving}
                      style={{ ...btnPrimary, background: C.green, opacity: saving ? 0.5 : 1 }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => setShowRejectInput(true)}
                      style={{ ...btnDanger, opacity: saving ? 0.5 : 1 }}
                      disabled={saving}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <input
                      style={inputStyle}
                      placeholder="Reason for rejection..."
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => doTransition(selectedChange.id, 'reject', { rejection_reason: rejectReason })}
                        disabled={saving || !rejectReason.trim()}
                        style={{ ...btnDanger, opacity: saving || !rejectReason.trim() ? 0.5 : 1 }}
                      >
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => { setShowRejectInput(false); setRejectReason(''); }}
                        style={btnSecondary}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Rejection reason display */}
            {selectedChange.status === 'rejected' && selectedChange.rejection_reason && (
              <div style={{
                background: `${C.red}10`, border: `1px solid ${C.red}30`, borderRadius: 10, padding: 14,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.red, marginBottom: 4 }}>Rejection Reason</div>
                <div style={{ fontSize: 13, color: C.red, lineHeight: 1.5 }}>{selectedChange.rejection_reason}</div>
              </div>
            )}

            {/* Editable fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Risk Level</label>
                <select
                  style={{ ...selectStyle, width: '100%' }}
                  value={editRisk}
                  onChange={e => setEditRisk(e.target.value as RiskLevel)}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Impact Assessment</label>
                <textarea
                  style={textareaStyle}
                  value={editImpact}
                  onChange={e => setEditImpact(e.target.value)}
                  placeholder="Describe the impact of this change..."
                />
              </div>

              <div>
                <label style={labelStyle}>Rollback Plan</label>
                <textarea
                  style={textareaStyle}
                  value={editRollback}
                  onChange={e => setEditRollback(e.target.value)}
                  placeholder="Describe the rollback plan..."
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Scheduled Start</label>
                  <input
                    type="datetime-local"
                    style={inputStyle}
                    value={editStart}
                    onChange={e => setEditStart(e.target.value)}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Scheduled End</label>
                  <input
                    type="datetime-local"
                    style={inputStyle}
                    value={editEnd}
                    onChange={e => setEditEnd(e.target.value)}
                  />
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={saving}
                style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving ? 0.5 : 1 }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

            {/* Status transition buttons */}
            <div style={{
              borderTop: `1px solid ${C.border}`, paddingTop: 16,
              display: 'flex', gap: 10, flexWrap: 'wrap',
            }}>
              {selectedChange.status === 'draft' && (
                <button
                  onClick={() => doTransition(selectedChange.id, 'submit')}
                  disabled={saving}
                  style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}
                >
                  Submit for Approval
                </button>
              )}
              {selectedChange.status === 'approved' && (
                <button
                  onClick={() => doTransition(selectedChange.id, 'start')}
                  disabled={saving}
                  style={{ ...btnPrimary, background: C.amber, opacity: saving ? 0.5 : 1 }}
                >
                  Start Implementation
                </button>
              )}
              {selectedChange.status === 'implementing' && (
                <button
                  onClick={() => doTransition(selectedChange.id, 'complete')}
                  disabled={saving}
                  style={{ ...btnPrimary, background: C.green, opacity: saving ? 0.5 : 1 }}
                >
                  Mark Complete
                </button>
              )}
              {selectedChange.status !== 'complete' && selectedChange.status !== 'cancelled' && (
                <button
                  onClick={() => doTransition(selectedChange.id, 'cancel')}
                  disabled={saving}
                  style={{ ...btnDanger, background: 'transparent', color: C.red, border: `1px solid ${C.red}40`, opacity: saving ? 0.5 : 1 }}
                >
                  Cancel Change
                </button>
              )}
            </div>
          </div>
        )}
      </SlidePanel>

      {/* New Change form modal */}
      {showNewForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          backdropFilter: 'blur(4px)',
        }}>
          <form onSubmit={handleCreate} style={{
            background: C.bg2, borderRadius: 16, border: `1px solid ${C.border}`,
            width: '100%', maxWidth: 560, padding: 28, animation: 'calyxFadeIn 0.25s ease',
            boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ width: 4, height: 24, borderRadius: 2, background: C.teal }} />
              <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text1, margin: 0 }}>New Change Request</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Title *</label>
                <input style={inputStyle} value={newForm.title} onChange={e => setNewForm({ ...newForm, title: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea style={textareaStyle} value={newForm.description} onChange={e => setNewForm({ ...newForm, description: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Type</label>
                  <select style={{ ...selectStyle, width: '100%' }} value={newForm.type} onChange={e => setNewForm({ ...newForm, type: e.target.value as ChangeType })}>
                    <option value="normal">Normal</option>
                    <option value="standard">Standard</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Risk Level</label>
                  <select style={{ ...selectStyle, width: '100%' }} value={newForm.risk_level} onChange={e => setNewForm({ ...newForm, risk_level: e.target.value as RiskLevel })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>Impact Assessment</label>
                <textarea style={textareaStyle} value={newForm.impact_assessment} onChange={e => setNewForm({ ...newForm, impact_assessment: e.target.value })} placeholder="Describe the impact..." />
              </div>
              <div>
                <label style={labelStyle}>Rollback Plan</label>
                <textarea style={textareaStyle} value={newForm.rollback_plan} onChange={e => setNewForm({ ...newForm, rollback_plan: e.target.value })} placeholder="Describe the rollback plan..." />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Scheduled Start</label>
                  <input type="datetime-local" style={inputStyle} value={newForm.scheduled_start_at} onChange={e => setNewForm({ ...newForm, scheduled_start_at: e.target.value })} />
                </div>
                <div>
                  <label style={labelStyle}>Scheduled End</label>
                  <input type="datetime-local" style={inputStyle} value={newForm.scheduled_end_at} onChange={e => setNewForm({ ...newForm, scheduled_end_at: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button type="button" onClick={() => setShowNewForm(false)} style={{ padding: '8px 16px', fontSize: 13, color: C.text3, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
              <button
                type="submit"
                disabled={creating || !newForm.title}
                style={{
                  ...btnPrimary,
                  opacity: creating || !newForm.title ? 0.5 : 1,
                  cursor: creating || !newForm.title ? 'default' : 'pointer',
                }}
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
