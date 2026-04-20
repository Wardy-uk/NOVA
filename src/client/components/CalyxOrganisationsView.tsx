import { useState, useEffect, type CSSProperties } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, labelStyle, EmptyState, SlidePanel, calyxApi, useCalyxData, formatDate } from './calyx-shared.js';

interface Organisation {
  id: number;
  name: string;
  contact_email: string;
  sla_policy_id: number | null;
  notes: string;
  ticket_count: number;
  created_at: string;
}

interface SlaPolicy {
  id: number;
  name: string;
}

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

export function CalyxOrganisationsView() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { data: organisations, loading, reload } = useCalyxData<Organisation[]>('/organisations');
  const { data: policies } = useCalyxData<SlaPolicy[]>('/sla-policies');

  const policyMap = new Map((policies || []).map(p => [p.id, p.name]));

  const filtered = (organisations || []).filter(o => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return o.name.toLowerCase().includes(q) || (o.contact_email || '').toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text1 }}>Organisations</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            style={{ ...inputStyle, width: 220 }}
            placeholder="Search organisations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button style={btnPrimary} onClick={() => setShowNew(true)}>New Organisation</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="inbox" title="No organisations found" subtitle="Adjust your search or create a new organisation" />
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Contact Email</th>
                <th style={thStyle}>Ticket Count</th>
                <th style={thStyle}>SLA Policy</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <tr
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.glassHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{o.name}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{o.contact_email || '-'}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{o.ticket_count}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>
                    {o.sla_policy_id ? (policyMap.get(o.sla_policy_id) || '-') : '-'}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail SlidePanel */}
      {selectedId !== null && (
        <OrganisationDetailPanel
          organisationId={selectedId}
          policies={policies || []}
          policyMap={policyMap}
          onClose={() => { setSelectedId(null); reload(); }}
        />
      )}

      {/* New Organisation SlidePanel */}
      <SlidePanel open={showNew} onClose={() => setShowNew(false)} title="New Organisation">
        <NewOrganisationForm policies={policies || []} onCreated={() => { setShowNew(false); reload(); }} />
      </SlidePanel>
    </div>
  );
}

function OrganisationDetailPanel({ organisationId, policies, policyMap, onClose }: {
  organisationId: number;
  policies: SlaPolicy[];
  policyMap: Map<number, string>;
  onClose: () => void;
}) {
  const [org, setOrg] = useState<Organisation | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    calyxApi<Organisation>(`/organisations/${organisationId}`).then(r => {
      if (r.ok && r.data) {
        setOrg(r.data);
        setEdits({});
      }
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [organisationId]);

  if (loading || !org) {
    return (
      <SlidePanel open onClose={onClose} title="Organisation">
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      </SlidePanel>
    );
  }

  const current = { ...org, ...edits };
  const hasEdits = Object.keys(edits).length > 0;

  const setField = (key: string, value: any) => setEdits(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    const res = await calyxApi(`/organisations/${organisationId}`, { method: 'PATCH', body: JSON.stringify(edits) });
    setSaving(false);
    if (res.ok) load();
  };

  const handleDelete = async () => {
    if (!confirm('Delete this organisation? This cannot be undone.')) return;
    await calyxApi(`/organisations/${organisationId}`, { method: 'DELETE' });
    onClose();
  };

  return (
    <SlidePanel open onClose={onClose} title={org.name} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Name */}
        <div>
          <label style={labelStyle}>Name</label>
          <input
            style={inputStyle}
            value={current.name}
            onChange={e => setField('name', e.target.value)}
          />
        </div>

        {/* Contact Email */}
        <div>
          <label style={labelStyle}>Contact Email</label>
          <input
            style={inputStyle}
            type="email"
            value={current.contact_email || ''}
            onChange={e => setField('contact_email', e.target.value)}
          />
        </div>

        {/* SLA Policy */}
        <div>
          <label style={labelStyle}>SLA Policy</label>
          <select
            style={selectStyle}
            value={current.sla_policy_id ?? ''}
            onChange={e => setField('sla_policy_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">None</option>
            {policies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={textareaStyle}
            value={current.notes || ''}
            onChange={e => setField('notes', e.target.value)}
            placeholder="Organisation notes..."
          />
        </div>

        {/* Recent tickets placeholder */}
        <div>
          <label style={{ ...labelStyle, fontSize: 13, marginBottom: 8 }}>Recent Tickets</label>
          <div style={{ fontSize: 12, color: C.text3, padding: '12px 0' }}>
            Ticket history will appear here
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnPrimary} onClick={handleSave} disabled={saving || !hasEdits}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button style={btnSecondary} onClick={handleDelete}>Delete</button>
        </div>
      </div>
    </SlidePanel>
  );
}

function NewOrganisationForm({ policies, onCreated }: { policies: SlaPolicy[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [slaPolicyId, setSlaPolicyId] = useState('');
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await calyxApi('/organisations', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        contact_email: contactEmail.trim() || null,
        sla_policy_id: slaPolicyId ? Number(slaPolicyId) : null,
        notes: notes.trim() || null,
      }),
    });
    setCreating(false);
    onCreated();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Name</label>
        <input
          style={inputStyle}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Organisation name"
        />
      </div>
      <div>
        <label style={labelStyle}>Contact Email</label>
        <input
          style={inputStyle}
          type="email"
          value={contactEmail}
          onChange={e => setContactEmail(e.target.value)}
          placeholder="contact@example.com"
        />
      </div>
      <div>
        <label style={labelStyle}>SLA Policy</label>
        <select
          style={selectStyle}
          value={slaPolicyId}
          onChange={e => setSlaPolicyId(e.target.value)}
        >
          <option value="">None</option>
          {policies.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Notes</label>
        <textarea
          style={textareaStyle}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any additional notes..."
        />
      </div>
      <button style={btnPrimary} onClick={handleCreate} disabled={creating || !name.trim()}>
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  );
}
