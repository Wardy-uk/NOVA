import { useState, useEffect, type CSSProperties } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, labelStyle, StatusBadge, ReferenceTag, EmptyState, SlidePanel, calyxApi, useCalyxData, formatDate } from './calyx-shared.js';

interface Improvement {
  id: number;
  reference: string;
  title: string;
  source: string;
  status: string;
  owner: string;
  due_date: string | null;
  description: string;
  created_at: string;
}

const STATUSES = ['all', 'proposed', 'approved', 'in_progress', 'complete', 'rejected'] as const;
const SOURCES = ['problem', 'pir', 'csat', 'manual', 'audit'] as const;

const pillStyle = (active: boolean): CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  border: active ? `1px solid ${C.teal}` : `1px solid ${C.border}`,
  background: active ? `${C.teal}20` : 'transparent',
  color: active ? C.teal : C.text3,
  transition: 'all 0.15s',
});

const thStyle: CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600,
  color: C.text3, borderBottom: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: 0.5,
};

const tdStyle: CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: C.text1, borderBottom: `1px solid ${C.border}`,
};

const textareaStyle: CSSProperties = {
  ...inputStyle, minHeight: 80, resize: 'vertical' as const, fontFamily: 'inherit',
};

export function CalyxImprovementsView() {
  const [filter, setFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { data: improvements, loading, reload } = useCalyxData<Improvement[]>('/improvements');

  const filtered = (improvements || []).filter(i => filter === 'all' || i.status === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text1 }}>Improvements</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {STATUSES.map(s => (
            <button key={s} style={pillStyle(filter === s)} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
          <button style={btnPrimary} onClick={() => setShowNew(true)}>New Improvement</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="inbox" title="No improvements found" subtitle="Adjust filters or propose a new improvement" />
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Owner</th>
                <th style={thStyle}>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => (
                <tr
                  key={i.id}
                  onClick={() => setSelectedId(i.id)}
                  style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.glassHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}><ReferenceTag ref={i.reference} /></td>
                  <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.title}</td>
                  <td style={tdStyle}><StatusBadge status={i.source} /></td>
                  <td style={tdStyle}><StatusBadge status={i.status} /></td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{i.owner || <span style={{ color: C.text3 }}>--</span>}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{i.due_date ? formatDate(i.due_date) : <span style={{ color: C.text3 }}>--</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail SlidePanel */}
      {selectedId !== null && (
        <ImprovementDetailPanel
          improvementId={selectedId}
          onClose={() => { setSelectedId(null); reload(); }}
        />
      )}

      {/* New Improvement SlidePanel */}
      <SlidePanel open={showNew} onClose={() => setShowNew(false)} title="New Improvement">
        <NewImprovementForm onCreated={() => { setShowNew(false); reload(); }} />
      </SlidePanel>
    </div>
  );
}

function ImprovementDetailPanel({ improvementId, onClose }: {
  improvementId: number;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Improvement | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    calyxApi<Improvement>(`/improvements/${improvementId}`).then(r => {
      if (r.ok && r.data) {
        setDetail(r.data);
        setEdits({});
      }
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [improvementId]);

  if (loading || !detail) {
    return (
      <SlidePanel open onClose={onClose} title="Improvement" width={560}>
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      </SlidePanel>
    );
  }

  const current = { ...detail, ...edits };
  const hasEdits = Object.keys(edits).length > 0;

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    await calyxApi(`/improvements/${improvementId}`, { method: 'PATCH', body: JSON.stringify(edits) });
    setSaving(false);
    load();
  };

  const setField = (key: string, value: any) => setEdits(prev => ({ ...prev, [key]: value }));

  return (
    <SlidePanel open onClose={onClose} title={`${detail.reference} - ${detail.title}`} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Title */}
        <div>
          <label style={labelStyle}>Title</label>
          <input
            style={inputStyle}
            value={current.title}
            onChange={e => setField('title', e.target.value)}
          />
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            style={textareaStyle}
            value={current.description || ''}
            onChange={e => setField('description', e.target.value)}
          />
        </div>

        {/* Source */}
        <div>
          <label style={labelStyle}>Source</label>
          <select
            style={selectStyle}
            value={current.source}
            onChange={e => setField('source', e.target.value)}
          >
            {SOURCES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
        </div>

        {/* Status */}
        <div>
          <label style={labelStyle}>Status</label>
          <select
            style={selectStyle}
            value={current.status}
            onChange={e => setField('status', e.target.value)}
          >
            <option value="proposed">Proposed</option>
            <option value="approved">Approved</option>
            <option value="in_progress">In Progress</option>
            <option value="complete">Complete</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>

        {/* Owner */}
        <div>
          <label style={labelStyle}>Owner</label>
          <input
            style={inputStyle}
            value={current.owner || ''}
            onChange={e => setField('owner', e.target.value)}
            placeholder="Owner name"
          />
        </div>

        {/* Due Date */}
        <div>
          <label style={labelStyle}>Due Date</label>
          <input
            type="date"
            style={inputStyle}
            value={current.due_date ? current.due_date.slice(0, 10) : ''}
            onChange={e => setField('due_date', e.target.value || null)}
          />
        </div>

        {/* Save button */}
        {hasEdits && (
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>
    </SlidePanel>
  );
}

function NewImprovementForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<string>('manual');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    await calyxApi('/improvements', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        source,
        owner: owner.trim() || null,
        due_date: dueDate || null,
      }),
    });
    setCreating(false);
    onCreated();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Title</label>
        <input
          style={inputStyle}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Improvement title"
        />
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea
          style={textareaStyle}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the improvement..."
        />
      </div>
      <div>
        <label style={labelStyle}>Source</label>
        <select style={selectStyle} value={source} onChange={e => setSource(e.target.value)}>
          {SOURCES.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Owner</label>
        <input
          style={inputStyle}
          value={owner}
          onChange={e => setOwner(e.target.value)}
          placeholder="Owner name"
        />
      </div>
      <div>
        <label style={labelStyle}>Due Date</label>
        <input
          type="date"
          style={inputStyle}
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
        />
      </div>
      <button style={btnPrimary} onClick={handleCreate} disabled={creating || !title.trim()}>
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  );
}
