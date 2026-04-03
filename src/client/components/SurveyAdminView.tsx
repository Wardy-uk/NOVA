import { useState, useEffect, useCallback, useRef } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

// ── Types ──────────────────────────────────────────────────────────────

interface Survey {
  id: number; title: string; description: string | null; team_name: string;
  status: string; start_date: string | null; end_date: string | null;
  invite_send_date: string | null; reminder_interval_days: number;
  created_at: string; closed_at: string | null; created_by: string;
  recipients_total: number; recipients_completed: number;
}

interface Question {
  id: number; survey_id: number; order_index: number;
  question_text: string; question_type: string; required: number;
}

interface Recipient {
  id: number; display_name: string; email: string;
  invite_sent: number; completed: number; completed_at: string | null;
}

interface ScaleResult {
  question_id: number; question_text: string; question_type: 'scale_5';
  average: number; distribution: number[]; response_count: number;
}

interface TextResult {
  question_id: number; question_text: string; question_type: 'open_text';
  responses: string[]; response_count: number;
}

type AggResult = ScaleResult | TextResult;

interface SurveyDetail extends Survey {
  questions: Question[];
  recipients: Recipient[];
  results: AggResult[];
  is_admin: boolean;
  my_token?: string | null;
  my_completed?: boolean;
  my_answers?: Array<{ question_id: number; value: string | number }> | null;
}

interface DraftQuestion {
  question_text: string; question_type: 'scale_5' | 'open_text'; required: boolean;
}

interface DraftRecipient {
  display_name: string; email: string;
}

interface TeamMember {
  display_name: string; email: string;
}

interface Team {
  id: number; name: string; members: TeamMember[];
}

interface CategoryDef { id: string; label: string }
interface TemplateDef { id: string; label: string; category: string; description: string; questions: DraftQuestion[] }

const RECURRENCE_OPTIONS = [
  { value: '', label: 'No recurrence (one-off)' },
  { value: '30', label: 'Monthly (every 30 days)' },
  { value: '42', label: 'Every 6 weeks (42 days)' },
  { value: '90', label: 'Quarterly (every 90 days)' },
  { value: '180', label: 'Every 6 months' },
  { value: '365', label: 'Annually' },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function statusBadge(status: string): string {
  switch (status) {
    case 'draft': return 'bg-neutral-700 text-neutral-400 border border-neutral-600';
    case 'scheduled': return 'bg-blue-900/40 text-blue-400 border border-blue-800/50';
    case 'active': return 'bg-green-900/40 text-green-400 border border-green-800/50';
    case 'closed': return 'bg-neutral-800 text-neutral-500 border border-neutral-700';
    default: return 'bg-neutral-700 text-neutral-400 border border-neutral-600';
  }
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── Shared styles ──────────────────────────────────────────────────────

const inputCls = 'w-full bg-[#272C33] text-neutral-200 text-[12px] rounded-lg px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors placeholder:text-neutral-600';
const labelCls = 'block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1';

// ── Component ──────────────────────────────────────────────────────────

export function SurveyAdminView({ userRole }: { userRole?: string }) {
  const [tab, setTab] = useState<'list' | 'create'>('list');
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [serverIsAdmin, setServerIsAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SurveyDetail | null>(null);
  const [detailTab, setDetailTab] = useState<'recipients' | 'results' | 'questions'>('recipients');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [followUpFromId, setFollowUpFromId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editRecurrence, setEditRecurrence] = useState('');
  const [addingRecipients, setAddingRecipients] = useState(false);
  const [newRecipName, setNewRecipName] = useState('');
  const [newRecipEmail, setNewRecipEmail] = useState('');

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/surveys');
      const json = await res.json();
      if (json.ok) {
        setSurveys(json.data);
        setServerIsAdmin(json.is_admin === true);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSurveys(); }, [fetchSurveys]);

  const fetchDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/surveys/${id}`);
      const json = await res.json();
      if (json.ok) setDetail(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (selectedId) fetchDetail(selectedId);
    else setDetail(null);
  }, [selectedId, fetchDetail]);

  const doAction = async (url: string, method = 'POST') => {
    setActionLoading(true);
    setError('');
    try {
      const res = await fetch(url, { method });
      const json = await res.json();
      if (!json.ok) setError(json.error || 'Action failed');
      fetchSurveys();
      if (selectedId) fetchDetail(selectedId);
    } catch { setError('Network error'); }
    setActionLoading(false);
  };

  const handleExport = (id: number) => {
    window.open(`/api/surveys/${id}/export`, '_blank');
  };

  // ── Survey List ──
  const renderList = () => (
    <div>
      {loading && <p className="text-xs text-neutral-500 py-4">Loading...</p>}
      {!loading && surveys.length === 0 && (
        <div className="text-center py-16 text-neutral-500">
          <i className="fa-solid fa-clipboard-question text-4xl mb-3 opacity-40"></i>
          <p className="text-xs">{serverIsAdmin ? 'No surveys yet. Create your first survey to get started.' : 'No surveys have been sent to you yet.'}</p>
        </div>
      )}
      {surveys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500 border-b border-[#3a424d]">
                <th className="py-2.5 px-4">Title</th>
                <th className="py-2.5 px-4">Team</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Start</th>
                <th className="py-2.5 px-4">End</th>
                <th className="py-2.5 px-4">Completion</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map(s => {
                const pct = s.recipients_total > 0 ? Math.round((s.recipients_completed / s.recipients_total) * 100) : 0;
                return (
                  <tr
                    key={s.id}
                    onClick={() => { setSelectedId(s.id); setDetailTab(serverIsAdmin ? 'recipients' : 'results'); }}
                    className={`border-b border-[#3a424d]/50 cursor-pointer transition-colors hover:bg-[#363d47] ${selectedId === s.id ? 'bg-[#363d47]' : ''}`}
                  >
                    <td className="py-2.5 px-4 font-medium text-neutral-100">{s.title}</td>
                    <td className="py-2.5 px-4 text-neutral-400">{s.team_name}</td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold capitalize ${statusBadge(s.status)}`}>{s.status}</span>
                    </td>
                    <td className="py-2.5 px-4 text-neutral-500">{fmtDate(s.start_date)}</td>
                    <td className="py-2.5 px-4 text-neutral-500">{fmtDate(s.end_date)}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-[#272C33] rounded-full overflow-hidden max-w-[80px]">
                          <div className="h-full bg-[#5ec1ca] rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-neutral-500">{s.recipients_completed}/{s.recipients_total} ({pct}%)</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  // ── Detail Panel ──
  const renderDetail = () => {
    if (!detail) return null;
    const pct = detail.recipients_total > 0 ? Math.round((detail.recipients_completed / detail.recipients_total) * 100) : 0;
    const isDetailAdmin = detail.is_admin;

    return (
      <div className="border-t border-[#3a424d] mt-4 pt-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-[15px] font-bold text-neutral-100">{detail.title}</h3>
              <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold capitalize ${statusBadge(detail.status)}`}>{detail.status}</span>
            </div>
            <p className="text-[11px] text-neutral-400">{detail.team_name} &middot; Created {fmtDate(detail.created_at)} by {detail.created_by}</p>
            {detail.description && <p className="text-[11px] text-neutral-500 mt-1">{detail.description}</p>}
            <div className="flex items-center gap-4 mt-2 text-[10px] text-neutral-600">
              <span>Start: {fmtDateTime(detail.start_date)}</span>
              <span>End: {fmtDateTime(detail.end_date)}</span>
              <span>Completion: {pct}% ({detail.recipients_completed}/{detail.recipients_total})</span>
            </div>
          </div>
          <button onClick={() => setSelectedId(null)} className="text-neutral-500 hover:text-neutral-300 text-sm"><i className="fa-solid fa-xmark" /></button>
        </div>

        {/* Admin Actions */}
        {isDetailAdmin && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {(detail.status === 'draft' || detail.status === 'scheduled') && (
              <button disabled={actionLoading} onClick={() => doAction(`/api/surveys/${detail.id}/activate`)}
                className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors">
                <i className="fa-solid fa-rocket mr-1.5" />Activate & Send Invites
              </button>
            )}
            {detail.status === 'active' && (
              <>
                <button disabled={actionLoading} onClick={() => doAction(`/api/surveys/${detail.id}/send-reminders`)}
                  className="px-3 py-1.5 rounded text-[10px] font-semibold bg-amber-900/40 text-amber-400 border border-amber-800/50 hover:bg-amber-900/60 disabled:opacity-50 transition-colors">
                  <i className="fa-solid fa-bell mr-1.5" />Send Reminders
                </button>
                <button disabled={actionLoading} onClick={() => doAction(`/api/surveys/${detail.id}/close`)}
                  className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47] disabled:opacity-50 transition-colors">
                  <i className="fa-solid fa-lock mr-1.5" />Close Survey
                </button>
              </>
            )}
            {detail.recipients_completed > 0 && (
              <button onClick={() => handleExport(detail.id)}
                className="px-3 py-1.5 rounded text-[10px] font-semibold bg-purple-900/40 text-purple-400 border border-purple-800/50 hover:bg-purple-900/60 transition-colors">
                <i className="fa-solid fa-file-csv mr-1.5" />Export CSV
              </button>
            )}
            {detail.status === 'closed' && (
              <button disabled={actionLoading} onClick={async () => {
                setActionLoading(true);
                try {
                  const res = await fetch(`/api/surveys/${detail.id}/follow-up`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                  });
                  const json = await res.json();
                  if (json.ok) {
                    setSelectedId(null);
                    fetchSurveys();
                    setFollowUpFromId(json.data.id);
                    setTab('list');
                    // Select the new follow-up draft
                    setTimeout(() => { setSelectedId(json.data.id); setDetailTab('recipients'); }, 300);
                  } else { setError(json.error || 'Failed to create follow-up'); }
                } catch { setError('Network error'); }
                setActionLoading(false);
              }}
                className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 disabled:opacity-50 transition-colors">
                <i className="fa-solid fa-rotate-right mr-1.5" />Create Follow-up Now
              </button>
            )}
            <button onClick={() => {
              setEditing(!editing); setAddingRecipients(false);
              setEditTitle(detail.title); setEditDesc(detail.description || '');
              setEditCategory((detail as any).category || ''); setEditRecurrence(String((detail as any).recurrence_interval_days || ''));
            }}
              className={`px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${editing ? 'bg-[#5ec1ca] text-[#272C33]' : 'bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47]'}`}>
              <i className="fa-solid fa-pen mr-1.5" />Edit
            </button>
            <button onClick={() => { setAddingRecipients(!addingRecipients); setEditing(false); setNewRecipName(''); setNewRecipEmail(''); }}
              className={`px-3 py-1.5 rounded text-[10px] font-semibold transition-colors ${addingRecipients ? 'bg-[#5ec1ca] text-[#272C33]' : 'bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47]'}`}>
              <i className="fa-solid fa-user-plus mr-1.5" />Add Recipients
            </button>
            <button disabled={actionLoading} onClick={async () => {
              if (!confirm(`Delete this survey "${detail.title}"? This cannot be undone.`)) return;
              await doAction(`/api/surveys/${detail.id}`, 'DELETE');
              setSelectedId(null);
            }}
              className="px-3 py-1.5 rounded text-[10px] font-semibold bg-red-900/30 text-red-400 border border-red-800/50 hover:bg-red-900/50 disabled:opacity-50 transition-colors">
              <i className="fa-solid fa-trash mr-1.5" />Delete
            </button>
          </div>
        )}

        {/* Inline edit panel */}
        {editing && isDetailAdmin && (
          <div className="bg-[#272C33] rounded-lg border border-[#3a424d] p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Title</label>
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Category</label>
                <select value={editCategory} onChange={e => setEditCategory(e.target.value)} className={inputCls}>
                  <option value="">No category</option>
                  <option value="team_satisfaction">Team Satisfaction</option>
                  <option value="kam_satisfaction">KAM Satisfaction</option>
                  <option value="csm_satisfaction">CSM Satisfaction</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Description</label>
                <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} rows={3} className={inputCls + ' resize-none'} />
              </div>
              <div>
                <label className={labelCls}>Recurrence</label>
                <select value={editRecurrence} onChange={e => setEditRecurrence(e.target.value)} className={inputCls}>
                  {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button disabled={actionLoading} onClick={async () => {
                setActionLoading(true);
                try {
                  const res = await fetch(`/api/surveys/${detail.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: editTitle, description: editDesc, category: editCategory || null, recurrence_interval_days: editRecurrence ? Number(editRecurrence) : null }),
                  });
                  const json = await res.json();
                  if (json.ok) { setEditing(false); fetchSurveys(); fetchDetail(detail.id); }
                  else setError(json.error || 'Save failed');
                } catch { setError('Network error'); }
                setActionLoading(false);
              }}
                className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors">
                <i className="fa-solid fa-check mr-1" />Save Changes
              </button>
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47] transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Add recipients panel */}
        {addingRecipients && isDetailAdmin && (
          <div className="bg-[#272C33] rounded-lg border border-[#3a424d] p-4 mb-4 space-y-3">
            <p className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">Add new recipients</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className={labelCls}>Name</label>
                <input value={newRecipName} onChange={e => setNewRecipName(e.target.value)} className={inputCls} placeholder="Display name" />
              </div>
              <div className="flex-1">
                <label className={labelCls}>Email</label>
                <input value={newRecipEmail} onChange={e => setNewRecipEmail(e.target.value)} className={inputCls} placeholder="email@example.com"
                  onKeyDown={e => { if (e.key === 'Enter') document.getElementById('btn-add-recip')?.click(); }} />
              </div>
              <button id="btn-add-recip" disabled={actionLoading || !newRecipName.trim() || !newRecipEmail.includes('@')} onClick={async () => {
                setActionLoading(true);
                try {
                  const res = await fetch(`/api/surveys/${detail.id}/add-recipients`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recipients: [{ display_name: newRecipName.trim(), email: newRecipEmail.trim() }] }),
                  });
                  const json = await res.json();
                  if (json.ok) { setNewRecipName(''); setNewRecipEmail(''); fetchDetail(detail.id); fetchSurveys(); }
                  else setError(json.error || 'Failed to add');
                } catch { setError('Network error'); }
                setActionLoading(false);
              }}
                className="px-3 py-2 rounded text-[10px] font-semibold bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors whitespace-nowrap">
                <i className="fa-solid fa-plus mr-1" />Add & Send Invite
              </button>
            </div>
            <p className="text-[9px] text-neutral-600">New recipients on active surveys are sent an invite immediately.</p>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {/* Sub-tabs */}
        <div className="flex gap-1 border-b border-[#3a424d] mb-4">
          {isDetailAdmin && (
            <button onClick={() => setDetailTab('recipients')}
              className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider rounded-t transition-colors ${detailTab === 'recipients' ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}>
              Recipients
            </button>
          )}
          {isDetailAdmin && (
            <button onClick={() => setDetailTab('results')}
              className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider rounded-t transition-colors ${detailTab === 'results' ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}>
              Results
            </button>
          )}
          {!isDetailAdmin && (
            <button onClick={() => setDetailTab('results')}
              className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider rounded-t transition-colors ${detailTab === 'results' ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}>
              {detail.my_completed ? 'My Response' : 'Respond'}
            </button>
          )}
          <button onClick={() => setDetailTab('questions')}
            className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider rounded-t transition-colors ${detailTab === 'questions' ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}>
            Questions
          </button>
        </div>

        {/* Recipients tab (admin only) */}
        {detailTab === 'recipients' && isDetailAdmin && (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500 border-b border-[#3a424d]">
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Email</th>
                <th className="py-2 px-3">Invited</th>
                <th className="py-2 px-3">Completed</th>
                <th className="py-2 px-3">Completed At</th>
                <th className="py-2 px-3 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {detail.recipients.map((r, i) => (
                <tr key={i} className="border-b border-[#3a424d]/50 group">
                  <td className="py-2 px-3 font-medium text-neutral-200">{r.display_name}</td>
                  <td className="py-2 px-3 text-neutral-400">{r.email}</td>
                  <td className="py-2 px-3">
                    {r.invite_sent ? <i className="fa-solid fa-check text-green-400" /> : <i className="fa-solid fa-clock text-amber-400" />}
                  </td>
                  <td className="py-2 px-3">
                    {r.completed ? <i className="fa-solid fa-circle-check text-green-400" /> : <i className="fa-solid fa-circle-xmark text-neutral-600" />}
                  </td>
                  <td className="py-2 px-3 text-neutral-600 text-[10px]">{fmtDateTime(r.completed_at)}</td>
                  <td className="py-2 px-3">
                    <button
                      disabled={actionLoading}
                      onClick={async () => {
                        if (!confirm(`Remove ${r.display_name} from this survey?`)) return;
                        setActionLoading(true);
                        try {
                          const res = await fetch(`/api/surveys/${detail.id}/recipients/${r.id}`, { method: 'DELETE' });
                          const json = await res.json();
                          if (json.ok) { fetchDetail(detail.id); fetchSurveys(); }
                          else setError(json.error || 'Failed to remove');
                        } catch { setError('Network error'); }
                        setActionLoading(false);
                      }}
                      className="text-neutral-600 hover:text-red-400 transition-colors text-xs disabled:opacity-50"
                      title="Remove recipient"
                    >
                      <i className="fa-solid fa-xmark" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Results tab — admin: aggregated results, non-admin: respond/view own */}
        {detailTab === 'results' && isDetailAdmin && (
          <div className="space-y-4">
            {detail.results.length === 0 || detail.recipients_completed === 0 ? (
              <p className="text-xs text-neutral-500 py-8 text-center">No responses yet.</p>
            ) : (
              detail.results.map((r, i) => (
                <div key={i} className="bg-[#272C33] rounded-lg border border-[#3a424d] p-4">
                  <h4 className="text-[12px] font-semibold text-neutral-200 mb-3">{r.question_text}</h4>
                  {r.question_type === 'scale_5' ? (
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-2xl font-extrabold text-[#5ec1ca]">{(r as ScaleResult).average.toFixed(1)}</div>
                        <div className="text-[9px] text-neutral-500 uppercase tracking-wider mt-1">Average</div>
                        <div className="text-[9px] text-neutral-600">{r.response_count} responses</div>
                      </div>
                      <div className="flex-1 max-w-sm">
                        <Bar
                          data={{
                            labels: ['1', '2', '3', '4', '5'],
                            datasets: [{
                              data: (r as ScaleResult).distribution,
                              backgroundColor: ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399'],
                              borderRadius: 3,
                              barThickness: 22,
                            }],
                          }}
                          options={{
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false }, tooltip: { enabled: true } },
                            scales: {
                              x: { display: false, beginAtZero: true },
                              y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10, weight: 'bold' as const } } },
                            },
                          }}
                          height={110}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {(r as TextResult).responses.length === 0 ? (
                        <p className="text-[10px] text-neutral-600">No responses.</p>
                      ) : (
                        (r as TextResult).responses.map((text, j) => (
                          <div key={j} className="bg-[#2f353d] rounded px-3 py-2 text-[11px] text-neutral-300 border border-[#3a424d]/50">
                            {text}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Non-admin: inline respond / view own response */}
        {detailTab === 'results' && !isDetailAdmin && (
          <InlineSurveyResponse detail={detail} onSubmitted={() => fetchDetail(detail.id)} />
        )}

        {/* Questions tab */}
        {detailTab === 'questions' && (
          <div className="space-y-1.5">
            {detail.questions.map((q, i) => (
              <div key={q.id} className="flex items-center gap-3 py-2 px-3 bg-[#272C33] rounded-lg border border-[#3a424d]/50">
                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[#5ec1ca]/20 text-[#5ec1ca] text-[10px] font-bold">{i + 1}</span>
                <span className="flex-1 text-[11px] text-neutral-200">{q.question_text}</span>
                <span className="text-[9px] text-neutral-500 uppercase tracking-wider">{q.question_type === 'scale_5' ? '1-5 Scale' : 'Open Text'}</span>
                {!q.required && <span className="text-[9px] text-neutral-600">(optional)</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[18px] font-bold text-neutral-100 tracking-tight">
            {serverIsAdmin ? 'Team Surveys' : 'My Surveys'}
          </h1>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            {serverIsAdmin ? 'Create, manage and analyse anonymous team surveys' : 'Surveys you have been invited to participate in'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5">
        <button onClick={() => setTab('list')}
          className={`px-4 py-1.5 rounded text-[11px] font-semibold transition-colors ${tab === 'list' ? 'bg-[#5ec1ca] text-[#272C33]' : 'bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47]'}`}>
          <i className={`fa-solid ${serverIsAdmin ? 'fa-list' : 'fa-inbox'} mr-1.5`} />{serverIsAdmin ? 'Surveys' : 'My Surveys'}
        </button>
        {serverIsAdmin && (
          <button onClick={() => setTab('create')}
            className={`px-4 py-1.5 rounded text-[11px] font-semibold transition-colors ${tab === 'create' ? 'bg-[#5ec1ca] text-[#272C33]' : 'bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47]'}`}>
            <i className="fa-solid fa-plus mr-1.5" />Create Survey
          </button>
        )}
      </div>

      <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] p-5">
        {tab === 'list' && (
          <>
            {renderList()}
            {selectedId && renderDetail()}
          </>
        )}
        {tab === 'create' && serverIsAdmin && <CreateSurveyForm surveys={surveys} onCreated={() => { setTab('list'); fetchSurveys(); }} />}
      </div>
    </div>
  );
}

// ── Create Survey Form ─────────────────────────────────────────────────

function CreateSurveyForm({ surveys, onCreated }: { surveys: Survey[]; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [customTeamInput, setCustomTeamInput] = useState('');
  const [description, setDescription] = useState('');
  const [inviteSendDate, setInviteSendDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reminderDays, setReminderDays] = useState(2);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [recipients, setRecipients] = useState<DraftRecipient[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadingFollowUp, setLoadingFollowUp] = useState(false);
  const [category, setCategory] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [templates, setTemplates] = useState<TemplateDef[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const [teamsRes, catsRes] = await Promise.all([
          fetch('/api/surveys/teams'),
          fetch('/api/surveys/categories'),
        ]);
        const teamsJson = await teamsRes.json();
        if (teamsJson.ok) setTeams(teamsJson.data);
        const catsJson = await catsRes.json();
        if (catsJson.ok) {
          setCategories(catsJson.data.categories);
          setTemplates(catsJson.data.templates);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const loadTemplate = (templateId: string) => {
    const tmpl = templates.find(t => t.id === templateId);
    if (!tmpl) return;
    setTitle(tmpl.label);
    setDescription(tmpl.description);
    setCategory(tmpl.category);
    setQuestions(tmpl.questions.map(q => ({ ...q, question_type: q.question_type as 'scale_5' | 'open_text' })));
  };

  const loadFromSurvey = async (surveyId: number) => {
    setLoadingFollowUp(true);
    try {
      const res = await fetch(`/api/surveys/${surveyId}`);
      const json = await res.json();
      if (json.ok) {
        const s = json.data as SurveyDetail;
        setTitle(`${s.title} (Follow-up)`);
        setDescription(s.description || '');
        setSelectedTeams(s.team_name.split(',').map((t: string) => t.trim()).filter(Boolean));
        setReminderDays(s.reminder_interval_days);
        if ((s as any).category) setCategory((s as any).category);
        if ((s as any).recurrence_interval_days) setRecurrence(String((s as any).recurrence_interval_days));
        setQuestions(s.questions.map((q: Question) => ({
          question_text: q.question_text,
          question_type: q.question_type as 'scale_5' | 'open_text',
          required: !!q.required,
        })));
        setRecipients(s.recipients.map((r: Recipient) => ({
          display_name: r.display_name,
          email: r.email,
        })));
      }
    } catch { /* ignore */ }
    setLoadingFollowUp(false);
  };

  const addQuestion = () => setQuestions([...questions, { question_text: '', question_type: 'scale_5', required: true }]);
  const removeQuestion = (idx: number) => setQuestions(questions.filter((_, i) => i !== idx));
  const updateQuestion = (idx: number, patch: Partial<DraftQuestion>) => {
    setQuestions(questions.map((q, i) => i === idx ? { ...q, ...patch } : q));
  };
  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= questions.length) return;
    const copy = [...questions];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setQuestions(copy);
  };

  const addRecipient = () => setRecipients([...recipients, { display_name: '', email: '' }]);
  const removeRecipient = (idx: number) => setRecipients(recipients.filter((_, i) => i !== idx));
  const updateRecipient = (idx: number, patch: Partial<DraftRecipient>) => {
    setRecipients(recipients.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const imported: DraftRecipient[] = [];
      for (let i = 0; i < lines.length; i++) {
        const parts = lines[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
        if (i === 0 && parts[0].toLowerCase() === 'name') continue;
        if (parts.length >= 2 && parts[1].includes('@')) {
          imported.push({ display_name: parts[0], email: parts[1] });
        }
      }
      if (imported.length) setRecipients(prev => [...prev, ...imported]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const submit = async (activate: boolean) => {
    setError('');
    if (!title.trim()) { setError('Title is required'); return; }
    if (selectedTeams.length === 0) { setError('Select at least one team'); return; }
    if (questions.length === 0) { setError('Add at least one question'); return; }
    if (questions.some(q => !q.question_text.trim())) { setError('All questions need text'); return; }
    if (recipients.length === 0) { setError('Add at least one recipient'); return; }
    if (recipients.some(r => !r.email.includes('@'))) { setError('All recipients need a valid email'); return; }

    setSaving(true);
    try {
      const body = {
        title: title.trim(), description: description.trim() || null, team_name: selectedTeams.join(', '),
        start_date: startDate || null, end_date: endDate || null,
        invite_send_date: inviteSendDate || null, reminder_interval_days: reminderDays,
        questions, recipients,
        category: category || null,
        recurrence_interval_days: recurrence ? Number(recurrence) : null,
      };
      const res = await fetch('/api/surveys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) { setError(json.error || 'Failed to create'); setSaving(false); return; }

      if (activate) {
        await fetch(`/api/surveys/${json.data.id}/activate`, { method: 'POST' });
      }
      onCreated();
    } catch { setError('Network error'); }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      {/* Follow-up from existing survey */}
      {surveys.filter(s => s.status === 'closed' || s.status === 'active').length > 0 && (
        <div className="bg-[#272C33] rounded-lg border border-[#3a424d]/50 p-3">
          <div className="flex items-center gap-3">
            <i className="fa-solid fa-rotate-right text-[#5ec1ca] text-xs" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Follow up from existing survey</span>
            <select
              defaultValue=""
              onChange={e => { if (e.target.value) loadFromSurvey(Number(e.target.value)); }}
              disabled={loadingFollowUp}
              className={inputCls + ' flex-1 max-w-xs'}
            >
              <option value="">Select a survey...</option>
              {surveys.filter(s => s.status === 'closed' || s.status === 'active').map(s => (
                <option key={s.id} value={s.id}>{s.title} ({s.team_name})</option>
              ))}
            </select>
            {loadingFollowUp && <i className="fa-solid fa-spinner fa-spin text-neutral-500 text-xs" />}
          </div>
          <p className="text-[9px] text-neutral-600 mt-1.5 ml-6">Copies questions, recipients and team from the selected survey</p>
        </div>
      )}

      {/* Basic info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Q2 Team Satisfaction" />
        </div>
        <div>
          <label className={labelCls}>Team(s) *</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {teams.map(t => {
              const selected = selectedTeams.includes(t.name);
              return (
                <button key={t.id} type="button" onClick={() => {
                  if (selected) {
                    setSelectedTeams(prev => prev.filter(n => n !== t.name));
                    // Remove members of this team from recipients
                    const teamEmails = new Set(t.members.map(m => m.email));
                    setRecipients(prev => prev.filter(r => !teamEmails.has(r.email)));
                  } else {
                    setSelectedTeams(prev => [...prev, t.name]);
                    // Add members of this team to recipients (avoid duplicates)
                    setRecipients(prev => {
                      const existing = new Set(prev.map(r => r.email));
                      const newMembers = t.members.filter(m => !existing.has(m.email));
                      return [...prev, ...newMembers];
                    });
                  }
                }}
                  className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors border ${selected
                    ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border-[#5ec1ca]/40'
                    : 'bg-[#272C33] text-neutral-400 border-[#3a424d] hover:border-neutral-500'}`}>
                  {selected && <i className="fa-solid fa-check mr-1 text-[8px]" />}{t.name}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input value={customTeamInput} onChange={e => setCustomTeamInput(e.target.value)}
              className={inputCls + ' flex-1'} placeholder="Add custom team name..."
              onKeyDown={e => {
                if (e.key === 'Enter' && customTeamInput.trim()) {
                  e.preventDefault();
                  if (!selectedTeams.includes(customTeamInput.trim())) {
                    setSelectedTeams(prev => [...prev, customTeamInput.trim()]);
                  }
                  setCustomTeamInput('');
                }
              }} />
            <button type="button" onClick={() => {
              if (customTeamInput.trim() && !selectedTeams.includes(customTeamInput.trim())) {
                setSelectedTeams(prev => [...prev, customTeamInput.trim()]);
                setCustomTeamInput('');
              }
            }} className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47] transition-colors">
              Add
            </button>
          </div>
          {selectedTeams.filter(t => !teams.find(tt => tt.name === t)).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {selectedTeams.filter(t => !teams.find(tt => tt.name === t)).map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/40">
                  {t}
                  <button type="button" onClick={() => setSelectedTeams(prev => prev.filter(n => n !== t))} className="text-[#5ec1ca]/60 hover:text-[#5ec1ca] text-[8px]"><i className="fa-solid fa-xmark" /></button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Brief description shown to respondents..." />
        </div>
      </div>

      {/* Category + Recurrence */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
            <option value="">No category</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Recurrence</label>
          <select value={recurrence} onChange={e => setRecurrence(e.target.value)} className={inputCls}>
            {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {recurrence && <p className="text-[9px] text-neutral-600 mt-1">A new survey will be auto-created {recurrence} days after this one closes</p>}
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className={labelCls}>Invite Send Date</label>
          <input type="datetime-local" value={inviteSendDate} onChange={e => setInviteSendDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Start Date</label>
          <input type="datetime-local" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>End Date</label>
          <input type="datetime-local" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Reminder Interval (days)</label>
          <input type="number" min={1} max={30} value={reminderDays} onChange={e => setReminderDays(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelCls + ' mb-0'}>Questions</label>
          <div className="flex gap-2">
            {templates.length > 0 && (
              <select defaultValue="" onChange={e => { if (e.target.value) loadTemplate(e.target.value); }}
                className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#272C33] text-neutral-300 border border-[#3a424d] outline-none cursor-pointer">
                <option value="" disabled>Load template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
            <button onClick={addQuestion} className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 transition-colors">
              <i className="fa-solid fa-plus mr-1" />Add Question
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2 bg-[#272C33] rounded-lg border border-[#3a424d]/50 px-3 py-2">
              <div className="flex flex-col gap-0.5 mt-2">
                <button onClick={() => moveQuestion(i, -1)} disabled={i === 0} className="text-neutral-600 hover:text-neutral-400 disabled:opacity-30 text-[10px]"><i className="fa-solid fa-chevron-up" /></button>
                <button onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} className="text-neutral-600 hover:text-neutral-400 disabled:opacity-30 text-[10px]"><i className="fa-solid fa-chevron-down" /></button>
              </div>
              <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[#5ec1ca]/20 text-[#5ec1ca] text-[10px] font-bold mt-1.5">{i + 1}</span>
              <div className="flex-1 space-y-1">
                <input value={q.question_text} onChange={e => updateQuestion(i, { question_text: e.target.value })}
                  className="w-full bg-[#2f353d] text-neutral-200 text-[11px] rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca]" placeholder="Question text..." />
                <div className="flex gap-3 items-center">
                  <select value={q.question_type} onChange={e => updateQuestion(i, { question_type: e.target.value as 'scale_5' | 'open_text' })}
                    className="text-[10px] bg-[#2f353d] text-neutral-300 px-2 py-1 rounded border border-[#3a424d] outline-none">
                    <option value="scale_5">1-5 Scale</option>
                    <option value="open_text">Open Text</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-[10px] text-neutral-500 cursor-pointer">
                    <input type="checkbox" checked={q.required} onChange={e => updateQuestion(i, { required: e.target.checked })} className="rounded" />
                    Required
                  </label>
                </div>
              </div>
              <button onClick={() => removeQuestion(i)} className="text-neutral-600 hover:text-red-400 mt-2 text-xs"><i className="fa-solid fa-xmark" /></button>
            </div>
          ))}
          {questions.length === 0 && <p className="text-[10px] text-neutral-600 text-center py-4">No questions added yet. Use the template button above to get started quickly.</p>}
        </div>
      </div>

      {/* Recipients */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelCls + ' mb-0'}>Recipients</label>
          <div className="flex gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#2f353d] text-neutral-400 border border-[#3a424d] hover:bg-[#363d47] transition-colors">
              <i className="fa-solid fa-file-csv mr-1" />Import CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
            <button onClick={addRecipient} className="px-3 py-1.5 rounded text-[10px] font-semibold bg-[#5ec1ca]/20 text-[#5ec1ca] border border-[#5ec1ca]/30 hover:bg-[#5ec1ca]/30 transition-colors">
              <i className="fa-solid fa-plus mr-1" />Add Recipient
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {recipients.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.display_name} onChange={e => updateRecipient(i, { display_name: e.target.value })}
                className="flex-1 bg-[#272C33] text-neutral-200 text-[11px] rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca]" placeholder="Name" />
              <input value={r.email} onChange={e => updateRecipient(i, { email: e.target.value })}
                className="flex-1 bg-[#272C33] text-neutral-200 text-[11px] rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca]" placeholder="email@example.com" />
              <button onClick={() => removeRecipient(i)} className="text-neutral-600 hover:text-red-400 text-xs"><i className="fa-solid fa-xmark" /></button>
            </div>
          ))}
          {recipients.length === 0 && <p className="text-[10px] text-neutral-600 text-center py-4">No recipients added yet.</p>}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Submit */}
      <div className="flex gap-2 pt-2">
        <button disabled={saving} onClick={() => submit(false)}
          className="px-4 py-2 rounded text-[11px] font-semibold bg-[#2f353d] text-neutral-300 border border-[#3a424d] hover:bg-[#363d47] disabled:opacity-50 transition-colors">
          <i className="fa-solid fa-floppy-disk mr-1.5" />Save as Draft
        </button>
        <button disabled={saving} onClick={() => submit(true)}
          className="px-4 py-2 rounded text-[11px] font-semibold bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors">
          <i className="fa-solid fa-rocket mr-1.5" />Save & Activate Now
        </button>
      </div>
    </div>
  );
}

// ── Inline Survey Response (non-admin, within NOVA) ────────────────────

const SCALE_LABELS = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];

function InlineSurveyResponse({ detail, onSubmitted }: { detail: SurveyDetail; onSubmitted: () => void }) {
  const [answers, setAnswers] = useState<Record<number, string | number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Pre-fill if already completed
  useEffect(() => {
    if (detail.my_completed && detail.my_answers) {
      const filled: Record<number, string | number> = {};
      for (const a of detail.my_answers) filled[a.question_id] = a.value;
      setAnswers(filled);
    }
  }, [detail.my_completed, detail.my_answers]);

  const readOnly = detail.my_completed || submitted;
  const isActive = detail.status === 'active';

  const allRequiredAnswered = detail.questions
    .filter(q => q.required)
    .every(q => {
      const a = answers[q.id];
      if (q.question_type === 'scale_5') return typeof a === 'number';
      return typeof a === 'string' && a.trim().length > 0;
    });

  const handleSubmit = async () => {
    if (!detail.my_token || !allRequiredAnswered) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const payload = detail.questions
        .filter(q => answers[q.id] !== undefined && answers[q.id] !== '')
        .map(q => ({ question_id: q.id, value: answers[q.id] }));

      const res = await fetch(`/api/survey/${detail.my_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload }),
      });
      const json = await res.json();
      if (json.ok) {
        setSubmitted(true);
        onSubmitted();
      } else {
        setSubmitError(json.error || 'Failed to submit');
      }
    } catch { setSubmitError('Network error'); }
    setSubmitting(false);
  };

  if (readOnly) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <i className="fa-solid fa-circle-check text-green-400" />
          <span className="text-[11px] text-green-400 font-semibold">
            {submitted ? 'Response submitted successfully' : 'You have already completed this survey'}
          </span>
        </div>
        {detail.questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <div key={q.id} className="bg-[#272C33] rounded-lg border border-[#3a424d]/50 p-3">
              <div className="flex items-start gap-2 mb-2">
                <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full bg-[#5ec1ca]/20 text-[#5ec1ca] text-[9px] font-bold">{i + 1}</span>
                <p className="text-[11px] text-neutral-200">{q.question_text}</p>
              </div>
              {q.question_type === 'scale_5' ? (
                <div className="flex gap-1.5 ml-7">
                  {[1, 2, 3, 4, 5].map(n => (
                    <div key={n} className={`px-2.5 py-1 rounded text-[10px] font-semibold border ${a === n ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border-[#5ec1ca]/40' : 'bg-[#2f353d] text-neutral-600 border-[#3a424d]/30'}`}>
                      {n}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="ml-7 text-[11px] text-neutral-400 bg-[#2f353d] rounded px-2.5 py-1.5 border border-[#3a424d]/30">{a || '—'}</p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="text-center py-8">
        <i className="fa-solid fa-lock text-neutral-600 text-2xl mb-2" />
        <p className="text-xs text-neutral-500">This survey is no longer accepting responses.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-2">
        <i className="fa-solid fa-shield-halved text-green-400 text-xs" />
        <span className="text-[10px] text-neutral-500">Your response is completely anonymous</span>
      </div>

      {detail.questions.map((q, i) => (
        <div key={q.id} className="bg-[#272C33] rounded-lg border border-[#3a424d]/50 p-3">
          <div className="flex items-start gap-2 mb-2.5">
            <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full bg-[#5ec1ca]/20 text-[#5ec1ca] text-[9px] font-bold">{i + 1}</span>
            <div>
              <p className="text-[11px] font-medium text-neutral-200">{q.question_text}</p>
              {!q.required && <span className="text-[9px] text-neutral-600 uppercase">Optional</span>}
            </div>
          </div>

          {q.question_type === 'scale_5' ? (
            <div className="flex gap-1.5 ml-7">
              {[1, 2, 3, 4, 5].map(n => {
                const selected = answers[q.id] === n;
                return (
                  <button key={n} onClick={() => setAnswers(prev => ({ ...prev, [q.id]: n }))}
                    className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-[#5ec1ca]/20 text-[#5ec1ca] border-[#5ec1ca]/40'
                        : 'bg-[#2f353d] text-neutral-400 border-[#3a424d] hover:border-neutral-500'
                    }`}>
                    <span className="text-sm font-bold">{n}</span>
                    <span className="text-[8px] leading-tight">{SCALE_LABELS[n - 1]}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="ml-7">
              <textarea
                value={(answers[q.id] as string) || ''}
                onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
                rows={2}
                maxLength={2000}
                className="w-full bg-[#2f353d] text-neutral-200 text-[11px] rounded px-2.5 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors resize-none placeholder:text-neutral-600"
                placeholder="Type your answer here..."
              />
              <div className="text-right text-[9px] text-neutral-600 mt-0.5">
                {((answers[q.id] as string) || '').length}/2000
              </div>
            </div>
          )}
        </div>
      ))}

      {submitError && <p className="text-xs text-red-400">{submitError}</p>}

      <div className="pt-2">
        <button
          disabled={!allRequiredAnswered || submitting}
          onClick={handleSubmit}
          className={`px-4 py-2 rounded text-[11px] font-semibold transition-colors ${
            allRequiredAnswered
              ? 'bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9]'
              : 'bg-[#2f353d] text-neutral-600 cursor-not-allowed'
          } disabled:opacity-50`}
        >
          {submitting ? <><i className="fa-solid fa-spinner fa-spin mr-1.5" />Submitting...</> : <><i className="fa-solid fa-paper-plane mr-1.5" />Submit Response</>}
        </button>
        {!allRequiredAnswered && <p className="text-[9px] text-neutral-600 mt-1">Answer all required questions to submit</p>}
      </div>
    </div>
  );
}
