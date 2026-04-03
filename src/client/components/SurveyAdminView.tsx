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
}

interface DraftQuestion {
  question_text: string; question_type: 'scale_5' | 'open_text'; required: boolean;
}

interface DraftRecipient {
  display_name: string; email: string;
}

// ── Baseline template ──────────────────────────────────────────────────

const BASELINE_QUESTIONS: DraftQuestion[] = [
  { question_text: 'Overall, how satisfied are you in your role right now?', question_type: 'scale_5', required: true },
  { question_text: 'Do you feel your workload is manageable?', question_type: 'scale_5', required: true },
  { question_text: 'Do you have the tools and information you need to do your job well?', question_type: 'scale_5', required: true },
  { question_text: 'Do you know what is expected of you in your role?', question_type: 'scale_5', required: true },
  { question_text: 'Do you feel supported when you are stuck or struggling?', question_type: 'scale_5', required: true },
  { question_text: 'Do you feel like you are learning and growing in this role?', question_type: 'scale_5', required: true },
  { question_text: 'Do you feel like part of a team that works well together?', question_type: 'scale_5', required: true },
  { question_text: 'What one thing would make the biggest difference to how you feel at work?', question_type: 'open_text', required: true },
  { question_text: 'Is there anything else you want to share?', question_type: 'open_text', required: false },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-600';
    case 'scheduled': return 'bg-blue-100 text-blue-700';
    case 'active': return 'bg-emerald-100 text-emerald-700';
    case 'closed': return 'bg-slate-200 text-slate-600';
    default: return 'bg-gray-100 text-gray-600';
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

// ── Component ──────────────────────────────────────────────────────────

export function SurveyAdminView() {
  const [tab, setTab] = useState<'list' | 'create'>('list');
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SurveyDetail | null>(null);
  const [detailTab, setDetailTab] = useState<'recipients' | 'results' | 'questions'>('recipients');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Fetch list ──
  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/surveys');
      const json = await res.json();
      if (json.ok) setSurveys(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSurveys(); }, [fetchSurveys]);

  // ── Fetch detail ──
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

  // ── Actions ──
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

  // ── Survey List Tab ──
  const renderList = () => (
    <div>
      {loading && <p className="text-sm text-slate-400 py-4">Loading...</p>}
      {!loading && surveys.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <i className="fa-solid fa-clipboard-question text-4xl mb-3 opacity-40"></i>
          <p className="text-sm">No surveys yet. Create your first survey to get started.</p>
        </div>
      )}
      {surveys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Start</th>
                <th className="py-3 px-4">End</th>
                <th className="py-3 px-4">Completion</th>
              </tr>
            </thead>
            <tbody>
              {surveys.map(s => {
                const pct = s.recipients_total > 0 ? Math.round((s.recipients_completed / s.recipients_total) * 100) : 0;
                return (
                  <tr
                    key={s.id}
                    onClick={() => { setSelectedId(s.id); setDetailTab('recipients'); }}
                    className={`border-b border-slate-50 cursor-pointer transition-colors hover:bg-slate-50 ${selectedId === s.id ? 'bg-teal-50/50' : ''}`}
                  >
                    <td className="py-3 px-4 font-medium text-slate-800">{s.title}</td>
                    <td className="py-3 px-4 text-slate-500">{s.team_name}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${statusColor(s.status)}`}>{s.status}</span>
                    </td>
                    <td className="py-3 px-4 text-slate-500">{fmtDate(s.start_date)}</td>
                    <td className="py-3 px-4 text-slate-500">{fmtDate(s.end_date)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[100px]">
                          <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{s.recipients_completed}/{s.recipients_total} ({pct}%)</span>
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

    return (
      <div className="border-t border-slate-100 mt-4 pt-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-bold text-slate-800">{detail.title}</h3>
              <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${statusColor(detail.status)}`}>{detail.status}</span>
            </div>
            <p className="text-sm text-slate-500">{detail.team_name} &middot; Created {fmtDate(detail.created_at)} by {detail.created_by}</p>
            {detail.description && <p className="text-sm text-slate-400 mt-1">{detail.description}</p>}
            <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
              <span>Start: {fmtDateTime(detail.start_date)}</span>
              <span>End: {fmtDateTime(detail.end_date)}</span>
              <span>Completion: {pct}% ({detail.recipients_completed}/{detail.recipients_total})</span>
            </div>
          </div>
          <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600 text-lg"><i className="fa-solid fa-xmark" /></button>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(detail.status === 'draft' || detail.status === 'scheduled') && (
            <button disabled={actionLoading} onClick={() => doAction(`/api/surveys/${detail.id}/activate`)}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-gradient-to-r from-teal-500 to-teal-400 text-white hover:shadow-lg disabled:opacity-50 transition">
              <i className="fa-solid fa-rocket mr-1.5" />Activate & Send Invites
            </button>
          )}
          {detail.status === 'active' && (
            <>
              <button disabled={actionLoading} onClick={() => doAction(`/api/surveys/${detail.id}/send-reminders`)}
                className="px-4 py-2 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50 transition">
                <i className="fa-solid fa-bell mr-1.5" />Send Reminders
              </button>
              <button disabled={actionLoading} onClick={() => doAction(`/api/surveys/${detail.id}/close`)}
                className="px-4 py-2 rounded-full text-xs font-semibold bg-slate-200 text-slate-600 hover:bg-slate-300 disabled:opacity-50 transition">
                <i className="fa-solid fa-lock mr-1.5" />Close Survey
              </button>
            </>
          )}
          {detail.recipients_completed > 0 && (
            <button onClick={() => handleExport(detail.id)}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition">
              <i className="fa-solid fa-file-csv mr-1.5" />Export CSV
            </button>
          )}
          {detail.status === 'draft' && (
            <button disabled={actionLoading} onClick={async () => {
              if (!confirm('Delete this draft survey?')) return;
              await doAction(`/api/surveys/${detail.id}`, 'DELETE');
              setSelectedId(null);
            }}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-50 transition">
              <i className="fa-solid fa-trash mr-1.5" />Delete
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        {/* Sub-tabs */}
        <div className="flex gap-1 border-b border-slate-100 mb-4">
          {(['recipients', 'results', 'questions'] as const).map(t => (
            <button key={t} onClick={() => setDetailTab(t)}
              className={`px-4 py-2 text-xs font-semibold capitalize rounded-t transition ${detailTab === t ? 'text-teal-600 border-b-2 border-teal-500' : 'text-slate-400 hover:text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* Recipients tab */}
        {detailTab === 'recipients' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2 px-3">Name</th>
                <th className="py-2 px-3">Email</th>
                <th className="py-2 px-3">Invited</th>
                <th className="py-2 px-3">Completed</th>
                <th className="py-2 px-3">Completed At</th>
              </tr>
            </thead>
            <tbody>
              {detail.recipients.map((r, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-2 px-3 font-medium text-slate-700">{r.display_name}</td>
                  <td className="py-2 px-3 text-slate-500">{r.email}</td>
                  <td className="py-2 px-3">
                    {r.invite_sent ? <i className="fa-solid fa-check text-emerald-500" /> : <i className="fa-solid fa-clock text-amber-400" />}
                  </td>
                  <td className="py-2 px-3">
                    {r.completed ? <i className="fa-solid fa-circle-check text-emerald-500" /> : <i className="fa-solid fa-circle-xmark text-slate-300" />}
                  </td>
                  <td className="py-2 px-3 text-slate-400 text-xs">{fmtDateTime(r.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Results tab */}
        {detailTab === 'results' && (
          <div className="space-y-6">
            {detail.results.length === 0 || detail.recipients_completed === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">No responses yet.</p>
            ) : (
              detail.results.map((r, i) => (
                <div key={i} className="bg-slate-50 rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-3">{r.question_text}</h4>
                  {r.question_type === 'scale_5' ? (
                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-3xl font-extrabold text-teal-600">{(r as ScaleResult).average.toFixed(1)}</div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide mt-1">Average</div>
                        <div className="text-[10px] text-slate-400">{r.response_count} responses</div>
                      </div>
                      <div className="flex-1 max-w-sm">
                        <Bar
                          data={{
                            labels: ['1', '2', '3', '4', '5'],
                            datasets: [{
                              data: (r as ScaleResult).distribution,
                              backgroundColor: ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399'],
                              borderRadius: 4,
                              barThickness: 28,
                            }],
                          }}
                          options={{
                            indexAxis: 'y',
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: { legend: { display: false }, tooltip: { enabled: true } },
                            scales: {
                              x: { display: false, beginAtZero: true },
                              y: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' as const } } },
                            },
                          }}
                          height={120}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {(r as TextResult).responses.length === 0 ? (
                        <p className="text-xs text-slate-400">No responses.</p>
                      ) : (
                        (r as TextResult).responses.map((text, j) => (
                          <div key={j} className="bg-white rounded-lg px-3 py-2 text-sm text-slate-600 border border-slate-100">
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

        {/* Questions tab */}
        {detailTab === 'questions' && (
          <div className="space-y-2">
            {detail.questions.map((q, i) => (
              <div key={q.id} className="flex items-center gap-3 py-2 px-3 bg-slate-50 rounded-lg">
                <span className="w-6 h-6 flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold">{i + 1}</span>
                <span className="flex-1 text-sm text-slate-700">{q.question_text}</span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wide">{q.question_type === 'scale_5' ? '1-5 Scale' : 'Open Text'}</span>
                {!q.required && <span className="text-[10px] text-slate-300">(optional)</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Create Tab ──
  const renderCreate = () => <CreateSurveyForm onCreated={() => { setTab('list'); fetchSurveys(); }} />;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight">Team Surveys</h1>
          <p className="text-xs text-slate-400 mt-0.5">Create, manage and analyse anonymous team surveys</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        <button onClick={() => setTab('list')}
          className={`px-5 py-2 rounded-full text-xs font-semibold transition ${tab === 'list' ? 'bg-teal-500 text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          <i className="fa-solid fa-list mr-1.5" />Surveys
        </button>
        <button onClick={() => setTab('create')}
          className={`px-5 py-2 rounded-full text-xs font-semibold transition ${tab === 'create' ? 'bg-teal-500 text-white shadow' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
          <i className="fa-solid fa-plus mr-1.5" />Create Survey
        </button>
      </div>

      <div className="bg-white/65 backdrop-blur-xl border border-black/[0.07] rounded-2xl p-6 shadow-sm">
        {tab === 'list' && (
          <>
            {renderList()}
            {selectedId && renderDetail()}
          </>
        )}
        {tab === 'create' && renderCreate()}
      </div>
    </div>
  );
}

// ── Create Survey Form ─────────────────────────────────────────────────

function CreateSurveyForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [teamName, setTeamName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteSendDate, setInviteSendDate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reminderDays, setReminderDays] = useState(2);
  const [questions, setQuestions] = useState<DraftQuestion[]>([]);
  const [recipients, setRecipients] = useState<DraftRecipient[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const loadTemplate = () => {
    setQuestions([...BASELINE_QUESTIONS]);
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
        if (i === 0 && parts[0].toLowerCase() === 'name') continue; // skip header
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
    if (!teamName.trim()) { setError('Team name is required'); return; }
    if (questions.length === 0) { setError('Add at least one question'); return; }
    if (questions.some(q => !q.question_text.trim())) { setError('All questions need text'); return; }
    if (recipients.length === 0) { setError('Add at least one recipient'); return; }
    if (recipients.some(r => !r.email.includes('@'))) { setError('All recipients need a valid email'); return; }

    setSaving(true);
    try {
      const body = {
        title: title.trim(), description: description.trim() || null, team_name: teamName.trim(),
        start_date: startDate || null, end_date: endDate || null,
        invite_send_date: inviteSendDate || null, reminder_interval_days: reminderDays,
        questions, recipients,
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

  const inputCls = 'w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition';
  const labelCls = 'block text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1';

  return (
    <div className="space-y-6">
      {/* Basic info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="e.g. Q2 Team Satisfaction" />
        </div>
        <div>
          <label className={labelCls}>Team Name *</label>
          <input value={teamName} onChange={e => setTeamName(e.target.value)} className={inputCls} placeholder="e.g. Engineering" />
        </div>
        <div className="md:col-span-2">
          <label className={labelCls}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={inputCls} placeholder="Brief description shown to respondents..." />
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
            <button onClick={loadTemplate} className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition">
              <i className="fa-solid fa-wand-magic-sparkles mr-1" />Load Team Satisfaction Baseline
            </button>
            <button onClick={addQuestion} className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-teal-100 text-teal-700 hover:bg-teal-200 transition">
              <i className="fa-solid fa-plus mr-1" />Add Question
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2 bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex flex-col gap-0.5 mt-2">
                <button onClick={() => moveQuestion(i, -1)} disabled={i === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs"><i className="fa-solid fa-chevron-up" /></button>
                <button onClick={() => moveQuestion(i, 1)} disabled={i === questions.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-30 text-xs"><i className="fa-solid fa-chevron-down" /></button>
              </div>
              <span className="w-6 h-6 flex items-center justify-center rounded-full bg-teal-100 text-teal-700 text-xs font-bold mt-2">{i + 1}</span>
              <div className="flex-1 space-y-1">
                <input value={q.question_text} onChange={e => updateQuestion(i, { question_text: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-teal-400" placeholder="Question text..." />
                <div className="flex gap-3 items-center">
                  <select value={q.question_type} onChange={e => updateQuestion(i, { question_type: e.target.value as 'scale_5' | 'open_text' })}
                    className="text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600">
                    <option value="scale_5">1-5 Scale</option>
                    <option value="open_text">Open Text</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                    <input type="checkbox" checked={q.required} onChange={e => updateQuestion(i, { required: e.target.checked })} className="rounded" />
                    Required
                  </label>
                </div>
              </div>
              <button onClick={() => removeQuestion(i)} className="text-slate-300 hover:text-red-400 mt-2"><i className="fa-solid fa-xmark" /></button>
            </div>
          ))}
          {questions.length === 0 && <p className="text-xs text-slate-300 text-center py-4">No questions added yet.</p>}
        </div>
      </div>

      {/* Recipients */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className={labelCls + ' mb-0'}>Recipients</label>
          <div className="flex gap-2">
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
              <i className="fa-solid fa-file-csv mr-1" />Import CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvImport} className="hidden" />
            <button onClick={addRecipient} className="px-3 py-1.5 rounded-full text-[11px] font-semibold bg-teal-100 text-teal-700 hover:bg-teal-200 transition">
              <i className="fa-solid fa-plus mr-1" />Add Recipient
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          {recipients.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={r.display_name} onChange={e => updateRecipient(i, { display_name: e.target.value })}
                className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-teal-400" placeholder="Name" />
              <input value={r.email} onChange={e => updateRecipient(i, { email: e.target.value })}
                className="flex-1 px-2 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-teal-400" placeholder="email@example.com" />
              <button onClick={() => removeRecipient(i)} className="text-slate-300 hover:text-red-400"><i className="fa-solid fa-xmark" /></button>
            </div>
          ))}
          {recipients.length === 0 && <p className="text-xs text-slate-300 text-center py-4">No recipients added yet.</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        <button disabled={saving} onClick={() => submit(false)}
          className="px-5 py-2.5 rounded-full text-xs font-semibold bg-slate-200 text-slate-600 hover:bg-slate-300 disabled:opacity-50 transition">
          <i className="fa-solid fa-floppy-disk mr-1.5" />Save as Draft
        </button>
        <button disabled={saving} onClick={() => submit(true)}
          className="px-5 py-2.5 rounded-full text-xs font-semibold bg-gradient-to-r from-teal-500 to-teal-400 text-white hover:shadow-lg disabled:opacity-50 transition">
          <i className="fa-solid fa-rocket mr-1.5" />Save & Activate Now
        </button>
      </div>
    </div>
  );
}
