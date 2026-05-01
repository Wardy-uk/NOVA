import { useState, useEffect, useCallback } from 'react';

interface AiLearning {
  id: number;
  ticket_key: string;
  category: string | null;
  organisation: string | null;
  ai_draft: string | null;
  learning: string;
  tags: string | null;
  submitted_by: string;
  active: boolean;
  created_at: string;
}

interface CategoryCount {
  category: string;
  cnt: number;
}

export function AgentLearningsView({ token }: { token: string }) {
  const [learnings, setLearnings] = useState<AiLearning[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CategoryCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');

  // Submit form state
  const [showForm, setShowForm] = useState(false);
  const [formTicket, setFormTicket] = useState('');
  const [formDraft, setFormDraft] = useState('');
  const [formLearning, setFormLearning] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formOrg, setFormOrg] = useState('');
  const [formTags, setFormTags] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLearning, setEditLearning] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editOrg, setEditOrg] = useState('');
  const [editTags, setEditTags] = useState('');

  // Expanded AI draft
  const [expandedDraft, setExpandedDraft] = useState<number | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchLearnings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100', active: String(!showInactive) });
      if (categoryFilter) params.set('category', categoryFilter);

      const [learningsRes, catsRes] = await Promise.all([
        fetch(`/api/ai-learnings?${params}`, { headers }),
        fetch('/api/ai-learnings/categories', { headers }),
      ]);
      const [learningsJson, catsJson] = await Promise.all([learningsRes.json(), catsRes.json()]);
      if (learningsJson.ok) {
        setLearnings(learningsJson.data.learnings);
        setTotal(learningsJson.data.total);
      }
      if (catsJson.ok) setCategories(catsJson.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [showInactive, categoryFilter, token]);

  useEffect(() => { fetchLearnings(); }, [fetchLearnings]);

  const handleSubmit = async () => {
    if (!formTicket.trim() || !formLearning.trim()) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        ticket_key: formTicket.trim().toUpperCase(),
        learning: formLearning.trim(),
      };
      if (formDraft.trim()) body.ai_draft = formDraft.trim();
      if (formCategory.trim()) body.category = formCategory.trim();
      if (formOrg.trim()) body.organisation = formOrg.trim();
      if (formTags.trim()) body.tags = formTags.split(',').map(t => t.trim()).filter(Boolean);

      const res = await fetch('/api/ai-learnings', { method: 'POST', headers, body: JSON.stringify(body) });
      const json = await res.json();
      if (json.ok) {
        setShowForm(false);
        setFormTicket(''); setFormDraft(''); setFormLearning('');
        setFormCategory(''); setFormOrg(''); setFormTags('');
        fetchLearnings();
      }
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleToggle = async (id: number) => {
    try {
      await fetch(`/api/ai-learnings/${id}/toggle`, { method: 'PUT', headers });
      fetchLearnings();
    } catch { /* ignore */ }
  };

  const handleSaveEdit = async (id: number) => {
    try {
      const body: Record<string, unknown> = { learning: editLearning };
      if (editCategory) body.category = editCategory;
      if (editOrg) body.organisation = editOrg;
      if (editTags) body.tags = editTags.split(',').map(t => t.trim()).filter(Boolean);

      await fetch(`/api/ai-learnings/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
      setEditingId(null);
      fetchLearnings();
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Permanently delete this learning?')) return;
    try {
      await fetch(`/api/ai-learnings/${id}`, { method: 'DELETE', headers });
      fetchLearnings();
    } catch { /* ignore */ }
  };

  const startEdit = (l: AiLearning) => {
    setEditingId(l.id);
    setEditLearning(l.learning);
    setEditCategory(l.category ?? '');
    setEditOrg(l.organisation ?? '');
    setEditTags(l.tags ?? '');
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">AI Agent Learnings</h2>
          <p className="text-sm text-neutral-400">
            Human-directed corrections that improve AI responses. {total} learning{total !== 1 ? 's' : ''} total.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showForm ? 'Cancel' : '+ Submit Learning'}
        </button>
      </div>

      {/* Submit Form */}
      {showForm && (
        <div className="bg-neutral-800/50 border border-neutral-700 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Submit New Learning</h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Ticket Key *</label>
              <input
                type="text"
                value={formTicket}
                onChange={e => setFormTicket(e.target.value)}
                placeholder="NT-17647"
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Category</label>
              <input
                type="text"
                value={formCategory}
                onChange={e => setFormCategory(e.target.value)}
                placeholder="e.g. Data Feed, Portal, CRM"
                list="category-suggestions"
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
              />
              <datalist id="category-suggestions">
                {categories.map(c => <option key={c.category} value={c.category} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Organisation</label>
              <input
                type="text"
                value={formOrg}
                onChange={e => setFormOrg(e.target.value)}
                placeholder="Customer organisation name"
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={formTags}
                onChange={e => setFormTags(e.target.value)}
                placeholder="tone, product-knowledge, brand-awareness"
                className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">AI Draft Response (what the AI said)</label>
            <textarea
              value={formDraft}
              onChange={e => setFormDraft(e.target.value)}
              placeholder="Paste the AI's draft response here..."
              rows={4}
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-indigo-500 focus:outline-none resize-y"
            />
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Learning / Correction *</label>
            <textarea
              value={formLearning}
              onChange={e => setFormLearning(e.target.value)}
              placeholder="What should the AI learn from this? e.g. 'The Property Jungle is part of the Nurtur Group — don't refer to them as a separate entity'"
              rows={3}
              className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white placeholder-neutral-500 focus:border-indigo-500 focus:outline-none resize-y"
            />
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting || !formTicket.trim() || !formLearning.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-neutral-700 disabled:text-neutral-500 text-white rounded text-sm font-medium transition-colors"
            >
              {submitting ? 'Submitting...' : 'Submit Learning'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-400">Category:</label>
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            <option value="">All</option>
            {categories.map(c => (
              <option key={c.category} value={c.category}>{c.category} ({c.cnt})</option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-neutral-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
            className="rounded border-neutral-600 bg-neutral-800 text-indigo-500"
          />
          Show inactive
        </label>

        {loading && <span className="text-xs text-neutral-500 animate-pulse">Loading...</span>}
      </div>

      {/* Learnings List */}
      <div className="space-y-2">
        {learnings.length === 0 && !loading && (
          <div className="text-center py-12 text-neutral-500">
            No learnings yet. Submit one to start teaching the AI agent.
          </div>
        )}

        {learnings.map(l => (
          <div
            key={l.id}
            className={`border rounded-lg p-4 transition-colors ${
              l.active
                ? 'bg-neutral-800/50 border-neutral-700 hover:border-neutral-600'
                : 'bg-neutral-900/50 border-neutral-800 opacity-60'
            }`}
          >
            {editingId === l.id ? (
              /* Edit Mode */
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <input
                    type="text"
                    value={editCategory}
                    onChange={e => setEditCategory(e.target.value)}
                    placeholder="Category"
                    className="px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={editOrg}
                    onChange={e => setEditOrg(e.target.value)}
                    placeholder="Organisation"
                    className="px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    placeholder="Tags (comma-separated)"
                    className="px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-sm text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <textarea
                  value={editLearning}
                  onChange={e => setEditLearning(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-white focus:border-indigo-500 focus:outline-none resize-y"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(l.id)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1 bg-neutral-700 hover:bg-neutral-600 text-white rounded text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Display Mode */
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-mono text-indigo-400">{l.ticket_key}</span>
                      {l.category && (
                        <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 rounded-full">{l.category}</span>
                      )}
                      {l.organisation && (
                        <span className="text-xs px-2 py-0.5 bg-purple-500/10 text-purple-400 rounded-full">{l.organisation}</span>
                      )}
                      {!l.active && (
                        <span className="text-xs px-2 py-0.5 bg-neutral-500/10 text-neutral-400 rounded-full">Inactive</span>
                      )}
                      {l.tags && l.tags.split(',').map(tag => (
                        <span key={tag} className="text-xs px-1.5 py-0.5 bg-neutral-700 text-neutral-300 rounded">{tag.trim()}</span>
                      ))}
                    </div>

                    <p className="text-sm text-white leading-relaxed">{l.learning}</p>

                    {l.ai_draft && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedDraft(expandedDraft === l.id ? null : l.id)}
                          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                        >
                          {expandedDraft === l.id ? 'Hide' : 'Show'} AI draft
                        </button>
                        {expandedDraft === l.id && (
                          <div className="mt-1 p-3 bg-neutral-900 border border-neutral-700 rounded text-xs text-neutral-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {l.ai_draft}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-2 text-xs text-neutral-500">
                      Submitted by {l.submitted_by} on {formatDate(l.created_at)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(l)}
                      className="p-1.5 text-neutral-500 hover:text-white hover:bg-neutral-700 rounded transition-colors"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleToggle(l.id)}
                      className={`p-1.5 rounded transition-colors ${
                        l.active
                          ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                          : 'text-neutral-500 hover:text-amber-400 hover:bg-amber-500/10'
                      }`}
                      title={l.active ? 'Deactivate' : 'Reactivate'}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {l.active ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        )}
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(l.id)}
                      className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
