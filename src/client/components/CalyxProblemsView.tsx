import { useState, useEffect, type CSSProperties } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnDanger, labelStyle, StatusBadge, ReferenceTag, AgentAvatar, EmptyState, SlidePanel, calyxApi, useCalyxData, formatDate } from './calyx-shared.js';

interface Problem {
  id: number;
  reference: string;
  title: string;
  status: string;
  description: string;
  root_cause: string;
  workaround: string;
  assigned_agent_id: number | null;
  created_by_agent_id: number | null;
  created_at: string;
  resolved_at: string | null;
}

interface LinkedTicket {
  id: number;
  reference: string;
  title: string;
  status: string;
  priority: string;
}

interface ProblemDetail extends Problem {
  linked_tickets: LinkedTicket[];
}

interface Agent {
  id: number;
  name: string;
}

const STATUSES = ['all', 'identified', 'in_analysis', 'known_error', 'resolved'] as const;

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

export function CalyxProblemsView() {
  const [filter, setFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { data: problems, loading, reload } = useCalyxData<Problem[]>('/problems');
  const { data: agents } = useCalyxData<Agent[]>('/agents');

  const filtered = (problems || []).filter(p => filter === 'all' || p.status === filter);

  const agentMap = new Map((agents || []).map(a => [a.id, a.name]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text1 }}>Problems</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {STATUSES.map(s => (
            <button key={s} style={pillStyle(filter === s)} onClick={() => setFilter(s)}>
              {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
            </button>
          ))}
          <button style={btnPrimary} onClick={() => setShowNew(true)}>New Problem</button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="inbox" title="No problems found" subtitle="Adjust filters or create a new problem" />
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Reference</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Assigned</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.glassHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={tdStyle}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: C.teal, fontWeight: 600 }}>{p.reference}</span>
                  </td>
                  <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</td>
                  <td style={tdStyle}><StatusBadge status={p.status} /></td>
                  <td style={tdStyle}>
                    {p.assigned_agent_id && agentMap.get(p.assigned_agent_id) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AgentAvatar name={agentMap.get(p.assigned_agent_id)!} size={24} />
                        <span style={{ fontSize: 12, color: C.text2 }}>{agentMap.get(p.assigned_agent_id)}</span>
                      </div>
                    ) : (
                      <span style={{ color: C.text3, fontSize: 12 }}>Unassigned</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail SlidePanel */}
      {selectedId !== null && (
        <ProblemDetailPanel
          problemId={selectedId}
          agents={agents || []}
          agentMap={agentMap}
          onClose={() => { setSelectedId(null); reload(); }}
        />
      )}

      {/* New Problem SlidePanel */}
      <SlidePanel open={showNew} onClose={() => setShowNew(false)} title="New Problem">
        <NewProblemForm agents={agents || []} onCreated={() => { setShowNew(false); reload(); }} />
      </SlidePanel>
    </div>
  );
}

function ProblemDetailPanel({ problemId, agents, agentMap, onClose }: {
  problemId: number;
  agents: Agent[];
  agentMap: Map<number, string>;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ProblemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [linkTicketId, setLinkTicketId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    calyxApi<ProblemDetail>(`/problems/${problemId}`).then(r => {
      if (r.ok && r.data) {
        setDetail(r.data);
        setEdits({});
      }
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [problemId]);

  if (loading || !detail) {
    return (
      <SlidePanel open onClose={onClose} title="Problem" width={600}>
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      </SlidePanel>
    );
  }

  const current = { ...detail, ...edits };
  const hasEdits = Object.keys(edits).length > 0;

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    await calyxApi(`/problems/${problemId}`, { method: 'PATCH', body: JSON.stringify(edits) });
    setSaving(false);
    load();
  };

  const handleResolve = async () => {
    setSaving(true);
    await calyxApi(`/problems/${problemId}/resolve`, { method: 'POST' });
    setSaving(false);
    load();
  };

  const handleLinkTicket = async () => {
    const tid = parseInt(linkTicketId, 10);
    if (!tid) return;
    await calyxApi(`/problems/${problemId}/link-ticket`, { method: 'POST', body: JSON.stringify({ ticket_id: tid }) });
    setLinkTicketId('');
    load();
  };

  const handleUnlink = async (ticketId: number) => {
    await calyxApi(`/problems/${problemId}/tickets/${ticketId}`, { method: 'DELETE' });
    load();
  };

  const setField = (key: string, value: any) => setEdits(prev => ({ ...prev, [key]: value }));

  return (
    <SlidePanel open onClose={onClose} title={`${detail.reference} - ${detail.title}`} width={600}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status */}
        <div>
          <label style={labelStyle}>Status</label>
          <select
            style={selectStyle}
            value={current.status}
            onChange={e => setField('status', e.target.value)}
          >
            <option value="identified">Identified</option>
            <option value="in_analysis">In Analysis</option>
            <option value="known_error">Known Error</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        {/* Assigned agent */}
        <div>
          <label style={labelStyle}>Assigned Agent</label>
          <select
            style={selectStyle}
            value={current.assigned_agent_id ?? ''}
            onChange={e => setField('assigned_agent_id', e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Unassigned</option>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
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

        {/* Root cause - visible when status != identified */}
        {current.status !== 'identified' && (
          <div>
            <label style={labelStyle}>Root Cause</label>
            <textarea
              style={textareaStyle}
              value={current.root_cause || ''}
              onChange={e => setField('root_cause', e.target.value)}
            />
          </div>
        )}

        {/* Workaround */}
        <div>
          <label style={labelStyle}>Workaround</label>
          <textarea
            style={textareaStyle}
            value={current.workaround || ''}
            onChange={e => setField('workaround', e.target.value)}
          />
        </div>

        {/* Save button */}
        {hasEdits && (
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}

        {/* Linked tickets section */}
        <div>
          <label style={{ ...labelStyle, fontSize: 13, marginBottom: 8 }}>Linked Tickets</label>
          {detail.linked_tickets.length === 0 ? (
            <div style={{ fontSize: 12, color: C.text3, padding: '8px 0' }}>No linked tickets</div>
          ) : (
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, fontSize: 10 }}>Reference</th>
                    <th style={{ ...thStyle, fontSize: 10 }}>Title</th>
                    <th style={{ ...thStyle, fontSize: 10 }}>Status</th>
                    <th style={{ ...thStyle, fontSize: 10 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {detail.linked_tickets.map(t => (
                    <tr key={t.id}>
                      <td style={{ ...tdStyle, padding: '6px 12px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.teal, fontWeight: 600 }}>{t.reference}</span>
                      </td>
                      <td style={{ ...tdStyle, padding: '6px 12px', fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                      <td style={{ ...tdStyle, padding: '6px 12px' }}><StatusBadge status={t.status} /></td>
                      <td style={{ ...tdStyle, padding: '6px 12px' }}>
                        <button
                          style={{ ...btnDanger, padding: '4px 10px', fontSize: 11 }}
                          onClick={() => handleUnlink(t.id)}
                        >
                          Unlink
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Link ticket input */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <input
              type="number"
              placeholder="Ticket ID"
              style={{ ...inputStyle, width: 120 }}
              value={linkTicketId}
              onChange={e => setLinkTicketId(e.target.value)}
            />
            <button style={{ ...btnSecondary, padding: '8px 14px' }} onClick={handleLinkTicket}>Link</button>
          </div>
        </div>

        {/* Resolve button */}
        {current.status !== 'resolved' && (
          <button style={btnPrimary} onClick={handleResolve} disabled={saving}>
            Resolve Problem
          </button>
        )}
      </div>
    </SlidePanel>
  );
}

function NewProblemForm({ agents, onCreated }: { agents: Agent[]; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    await calyxApi('/problems', {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        assigned_agent_id: assignedAgentId ? Number(assignedAgentId) : null,
        created_by_agent_id: null,
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
          placeholder="Problem title"
        />
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea
          style={textareaStyle}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the problem..."
        />
      </div>
      <div>
        <label style={labelStyle}>Assigned Agent</label>
        <select
          style={selectStyle}
          value={assignedAgentId}
          onChange={e => setAssignedAgentId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <button style={btnPrimary} onClick={handleCreate} disabled={creating || !title.trim()}>
        {creating ? 'Creating...' : 'Create'}
      </button>
    </div>
  );
}
