import { useState, useEffect, type CSSProperties } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnDanger, labelStyle, StatusBadge, ReferenceTag, AgentAvatar, EmptyState, SlidePanel, calyxApi, useCalyxData, formatDateTime } from './calyx-shared.js';

interface MajorIncident {
  id: number;
  ticket_id: number | null;
  title: string;
  impact_statement: string;
  incident_commander: string;
  status: string;
  declared_at: string;
  resolved_at: string | null;
  ticket_ref: string | null;
}

interface Communication {
  id: number;
  message: string;
  sent_by: string;
  created_at: string;
}

interface MajorIncidentDetail extends MajorIncident {
  comms: Communication[];
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

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function parseDateToMs(d: string): number {
  return new Date(d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') ? '' : 'Z')).getTime();
}

function LiveDuration({ declaredAt }: { declaredAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = now - parseDateToMs(declaredAt);
  return (
    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: C.red }}>
      {formatDuration(Math.max(0, elapsed))}
    </span>
  );
}

export function CalyxMajorIncidentsView() {
  const { data: incidents, loading, reload } = useCalyxData<MajorIncident[]>('/major-incidents');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const active = (incidents || []).filter(i => i.status !== 'resolved');
  const resolved = (incidents || []).filter(i => i.status === 'resolved');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text1 }}>Major Incidents</h2>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      ) : (incidents || []).length === 0 ? (
        <EmptyState icon="check" title="No major incidents" subtitle="All clear - no active or recent major incidents" />
      ) : (
        <>
          {/* Active incidents */}
          {active.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {active.map(inc => (
                <div
                  key={inc.id}
                  style={{
                    ...cardStyle,
                    borderLeft: `4px solid ${C.red}`,
                    boxShadow: '0 0 20px rgba(239,68,68,0.15)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: C.text1 }}>{inc.title}</span>
                        <StatusBadge status={inc.status} />
                      </div>
                      {inc.impact_statement && (
                        <div style={{ fontSize: 13, color: C.text2, marginBottom: 10, lineHeight: 1.5 }}>
                          {inc.impact_statement}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>DECLARED</span>
                          <span style={{ fontSize: 12, color: C.text2 }}>{formatDateTime(inc.declared_at)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>DURATION</span>
                          <LiveDuration declaredAt={inc.declared_at} />
                        </div>
                        {inc.incident_commander && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>COMMANDER</span>
                            <AgentAvatar name={inc.incident_commander} size={22} />
                            <span style={{ fontSize: 12, color: C.text2 }}>{inc.incident_commander}</span>
                          </div>
                        )}
                        {inc.ticket_ref && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>TICKET</span>
                            <ReferenceTag ref={inc.ticket_ref} />
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      style={btnPrimary}
                      onClick={() => setSelectedId(inc.id)}
                    >
                      View &amp; Update
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Resolved incidents table */}
          {resolved.length > 0 && (
            <div style={{ marginTop: active.length > 0 ? 8 : 0 }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: 15, fontWeight: 600, color: C.text2 }}>Resolved</h3>
              <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>Title</th>
                      <th style={thStyle}>Declared</th>
                      <th style={thStyle}>Resolved</th>
                      <th style={thStyle}>Duration</th>
                      <th style={thStyle}>Commander</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolved.map(inc => {
                      const duration = inc.resolved_at
                        ? formatDuration(parseDateToMs(inc.resolved_at) - parseDateToMs(inc.declared_at))
                        : '--';
                      return (
                        <tr
                          key={inc.id}
                          onClick={() => setSelectedId(inc.id)}
                          style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.background = C.glassHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td style={{ ...tdStyle, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {inc.title}
                          </td>
                          <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{formatDateTime(inc.declared_at)}</td>
                          <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{inc.resolved_at ? formatDateTime(inc.resolved_at) : '--'}</td>
                          <td style={{ ...tdStyle, fontSize: 12, fontFamily: 'monospace', color: C.text2 }}>{duration}</td>
                          <td style={tdStyle}>
                            {inc.incident_commander ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AgentAvatar name={inc.incident_commander} size={22} />
                                <span style={{ fontSize: 12, color: C.text2 }}>{inc.incident_commander}</span>
                              </div>
                            ) : (
                              <span style={{ color: C.text3, fontSize: 12 }}>--</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail SlidePanel */}
      {selectedId !== null && (
        <IncidentDetailPanel
          incidentId={selectedId}
          onClose={() => { setSelectedId(null); reload(); }}
        />
      )}
    </div>
  );
}

function IncidentDetailPanel({ incidentId, onClose }: { incidentId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<MajorIncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [newComm, setNewComm] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingComm, setSendingComm] = useState(false);

  const load = () => {
    setLoading(true);
    calyxApi<MajorIncidentDetail>(`/major-incidents/${incidentId}`).then(r => {
      if (r.ok && r.data) {
        setDetail(r.data);
        setEdits({});
      }
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, [incidentId]);

  if (loading || !detail) {
    return (
      <SlidePanel open onClose={onClose} title="Major Incident" width={640}>
        <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
      </SlidePanel>
    );
  }

  const current = { ...detail, ...edits };
  const hasEdits = Object.keys(edits).length > 0;

  const setField = (key: string, value: string) => setEdits(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    await calyxApi(`/major-incidents/${incidentId}`, { method: 'PATCH', body: JSON.stringify(edits) });
    setSaving(false);
    load();
  };

  const handleSendComm = async () => {
    if (!newComm.trim()) return;
    setSendingComm(true);
    await calyxApi(`/major-incidents/${incidentId}/comms`, { method: 'POST', body: JSON.stringify({ message: newComm.trim() }) });
    setNewComm('');
    setSendingComm(false);
    load();
  };

  const handleResolve = async () => {
    setSaving(true);
    await calyxApi(`/major-incidents/${incidentId}/resolve`, { method: 'POST' });
    setSaving(false);
    load();
  };

  const isResolved = detail.status === 'resolved';

  return (
    <SlidePanel open onClose={onClose} title={detail.title} width={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status + declared time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StatusBadge status={detail.status} />
          <span style={{ fontSize: 12, color: C.text3 }}>Declared {formatDateTime(detail.declared_at)}</span>
          {detail.resolved_at && (
            <span style={{ fontSize: 12, color: C.text3 }}>Resolved {formatDateTime(detail.resolved_at)}</span>
          )}
        </div>

        {/* Impact statement */}
        <div>
          <label style={labelStyle}>Impact Statement</label>
          <textarea
            style={textareaStyle}
            value={current.impact_statement || ''}
            onChange={e => setField('impact_statement', e.target.value)}
            readOnly={isResolved}
          />
        </div>

        {/* Incident commander */}
        <div>
          <label style={labelStyle}>Incident Commander</label>
          <input
            style={inputStyle}
            value={current.incident_commander || ''}
            onChange={e => setField('incident_commander', e.target.value)}
            readOnly={isResolved}
          />
        </div>

        {/* Save button */}
        {hasEdits && !isResolved && (
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}

        {/* Communications timeline */}
        <div>
          <label style={{ ...labelStyle, fontSize: 13, marginBottom: 8 }}>Communications</label>
          {detail.comms.length === 0 ? (
            <div style={{ fontSize: 12, color: C.text3, padding: '8px 0' }}>No communications yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {detail.comms.map(comm => (
                <div key={comm.id} style={{
                  ...cardStyle,
                  padding: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <AgentAvatar name={comm.sent_by} size={22} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.text1 }}>{comm.sent_by}</span>
                    <span style={{ fontSize: 11, color: C.text3, marginLeft: 'auto' }}>{formatDateTime(comm.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: C.text2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                    {comm.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add communication */}
        {!isResolved && (
          <div>
            <label style={labelStyle}>Add Communication</label>
            <textarea
              style={{ ...textareaStyle, marginBottom: 8 }}
              value={newComm}
              onChange={e => setNewComm(e.target.value)}
              placeholder="Type an update..."
            />
            <button
              style={btnPrimary}
              onClick={handleSendComm}
              disabled={sendingComm || !newComm.trim()}
            >
              {sendingComm ? 'Sending...' : 'Send Update'}
            </button>
          </div>
        )}

        {/* Resolve button */}
        {!isResolved && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 4 }}>
            <button style={btnDanger} onClick={handleResolve} disabled={saving}>
              {saving ? 'Resolving...' : 'Resolve Incident'}
            </button>
          </div>
        )}

        {/* PIR placeholder for resolved */}
        {isResolved && (
          <div style={{
            ...cardStyle,
            borderLeft: `4px solid ${C.purple}`,
            marginTop: 4,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.purple, marginBottom: 4 }}>Post-Incident Review</div>
            <div style={{ fontSize: 12, color: C.text3 }}>Post-Incident Review will be available here</div>
          </div>
        )}
      </div>
    </SlidePanel>
  );
}
