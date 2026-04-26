import { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';

interface KbGap {
  category: string;
  suggested_title: string | null;
  frequency: number;
  first_seen: string;
  last_seen: string;
  ticket_ids: string;
}

interface KbArticleDraft {
  id: number;
  gap_id: number | null;
  title: string;
  body: string;
  category: string | null;
  labels: string | null;
  status: string;
  confluence_page_id: string | null;
  confluence_url: string | null;
  created_at: string;
  published_at: string | null;
}

type StatusFilter = 'open' | 'article_drafted' | 'article_published' | 'dismissed';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'Identified' },
  article_drafted: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Draft Generated' },
  in_review: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'In Review' },
  article_published: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Published' },
  dismissed: { bg: 'bg-neutral-500/10', text: 'text-neutral-400', label: 'Dismissed' },
  draft: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Draft' },
  published: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Published' },
};

export function KbGapsView({ token }: { token: string }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [gaps, setGaps] = useState<KbGap[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<KbArticleDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  const [editorDraft, setEditorDraft] = useState<KbArticleDraft | null>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorBody, setEditorBody] = useState('');
  const [editorLabels, setEditorLabels] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchGaps = useCallback(async () => {
    setLoading(true);
    try {
      const [gapsRes, countsRes, draftsRes] = await Promise.all([
        fetch(`/api/agent/kb-gaps?status=${statusFilter}&limit=50`, { headers }),
        fetch('/api/agent/kb-gaps/counts', { headers }),
        fetch('/api/kb-articles?limit=100', { headers }),
      ]);
      const [gapsJson, countsJson, draftsJson] = await Promise.all([gapsRes.json(), countsRes.json(), draftsRes.json()]);
      if (gapsJson.ok) setGaps(gapsJson.data);
      if (countsJson.ok) setCounts(countsJson.data);
      if (draftsJson.ok) setDrafts(draftsJson.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [statusFilter, token]);

  useEffect(() => { fetchGaps(); }, [fetchGaps]);

  const handleGenerate = async (gap: KbGap) => {
    const key = `${gap.category}||${gap.suggested_title}`;
    setGenerating(key);
    try {
      const ticketIds = gap.ticket_ids ? gap.ticket_ids.split(',').map(s => s.trim()).slice(0, 5) : [];
      const res = await fetch('/api/kb-articles/generate', {
        method: 'POST', headers,
        body: JSON.stringify({ category: gap.category, suggestedTitle: gap.suggested_title, reason: `${gap.frequency} tickets identified this gap`, ticketIds }),
      });
      const json = await res.json();
      if (json.ok) {
        openEditor(json.data);
        fetchGaps();
      }
    } catch { /* ignore */ }
    setGenerating(null);
  };

  const handleDismiss = async (gap: KbGap) => {
    await fetch('/api/agent/kb-gaps/dismiss', {
      method: 'POST', headers,
      body: JSON.stringify({ category: gap.category, suggestedTitle: gap.suggested_title }),
    });
    fetchGaps();
  };

  const openEditor = (draft: KbArticleDraft) => {
    setEditorDraft(draft);
    setEditorTitle(draft.title);
    setEditorBody(draft.body);
    setEditorLabels(draft.labels || '');
    setShowPreview(false);
  };

  const handleSave = async () => {
    if (!editorDraft) return;
    setSaving(true);
    try {
      await fetch(`/api/kb-articles/${editorDraft.id}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ title: editorTitle, body: editorBody, labels: editorLabels }),
      });
      fetchGaps();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handlePublish = async () => {
    if (!editorDraft) return;
    setPublishing(true);
    try {
      await handleSave();
      const res = await fetch(`/api/kb-articles/${editorDraft.id}/publish`, { method: 'POST', headers });
      const json = await res.json();
      if (json.ok) {
        setEditorDraft({ ...editorDraft, status: 'published', confluence_url: json.data.url });
        fetchGaps();
      }
    } catch { /* ignore */ }
    setPublishing(false);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/kb-articles/${id}`, { method: 'DELETE', headers });
    if (editorDraft?.id === id) setEditorDraft(null);
    fetchGaps();
  };

  const existingDraft = (gap: KbGap) =>
    drafts.find(d => d.category === gap.category && d.status !== 'published');

  const statusTabs: Array<{ key: StatusFilter; label: string }> = [
    { key: 'open', label: `Identified (${counts.open || 0})` },
    { key: 'article_drafted', label: `Drafted (${counts.article_drafted || 0})` },
    { key: 'article_published', label: `Published (${counts.article_published || 0})` },
    { key: 'dismissed', label: `Dismissed (${counts.dismissed || 0})` },
  ];

  return (
    <div className="flex gap-4 h-full">
      {/* Left panel: gap list */}
      <div className={`flex flex-col ${editorDraft ? 'w-1/2' : 'w-full'} transition-all`}>
        <div className="flex gap-2 mb-4">
          {statusTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                statusFilter === tab.key
                  ? 'bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30'
                  : 'text-neutral-400 hover:text-neutral-200 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && <div className="text-neutral-500 text-sm py-8 text-center">Loading...</div>}

        {!loading && gaps.length === 0 && (
          <div className="text-neutral-500 text-sm py-8 text-center">No gaps with this status.</div>
        )}

        <div className="space-y-2 overflow-y-auto">
          {gaps.map((gap, i) => {
            const key = `${gap.category}||${gap.suggested_title}`;
            const isGenerating = generating === key;
            const draft = existingDraft(gap);
            return (
              <div key={i} className="bg-[#1e2228] border border-[#3a424d] rounded-lg p-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-neutral-100 truncate">
                      {gap.suggested_title || gap.category}
                    </div>
                    {gap.suggested_title && (
                      <div className="text-xs text-neutral-500 mt-0.5">{gap.category}</div>
                    )}
                    <div className="flex gap-3 mt-1.5 text-xs text-neutral-500">
                      <span>{gap.frequency} ticket{gap.frequency !== 1 ? 's' : ''}</span>
                      <span>Last seen: {new Date(gap.last_seen).toLocaleDateString('en-GB')}</span>
                    </div>
                    {gap.ticket_ids && (
                      <div className="text-xs text-neutral-600 mt-1 truncate">
                        Tickets: {gap.ticket_ids}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {statusFilter === 'open' && (
                      <>
                        {draft ? (
                          <button
                            onClick={() => openEditor(draft)}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition"
                          >
                            Edit Draft
                          </button>
                        ) : (
                          <button
                            onClick={() => handleGenerate(gap)}
                            disabled={isGenerating}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-[#5ec1ca]/10 text-[#5ec1ca] hover:bg-[#5ec1ca]/20 transition disabled:opacity-50"
                          >
                            {isGenerating ? 'Generating...' : 'Generate Article'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDismiss(gap)}
                          className="px-2 py-1 text-xs rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/30 transition"
                        >
                          Dismiss
                        </button>
                      </>
                    )}
                    {statusFilter === 'article_drafted' && draft && (
                      <button
                        onClick={() => openEditor(draft)}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition"
                      >
                        Edit Draft
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drafts section */}
        {drafts.length > 0 && statusFilter !== 'open' && (
          <div className="mt-6">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">Article Drafts</h3>
            <div className="space-y-2">
              {drafts
                .filter(d => statusFilter === 'article_drafted' ? d.status === 'draft' : statusFilter === 'article_published' ? d.status === 'published' : false)
                .map(d => (
                  <div key={d.id} className="bg-[#1e2228] border border-[#3a424d] rounded-lg p-3 flex justify-between items-center">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-neutral-100 truncate">{d.title}</div>
                      <div className="flex gap-3 mt-1 text-xs text-neutral-500">
                        <span className={`${STATUS_COLORS[d.status]?.bg} ${STATUS_COLORS[d.status]?.text} px-1.5 py-0.5 rounded`}>
                          {STATUS_COLORS[d.status]?.label || d.status}
                        </span>
                        {d.confluence_url && (
                          <a href={d.confluence_url} target="_blank" rel="noopener" className="text-[#5ec1ca] hover:underline">
                            View in Confluence
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {d.status !== 'published' && (
                        <button onClick={() => openEditor(d)} className="px-2 py-1 text-xs font-semibold rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition">
                          Edit
                        </button>
                      )}
                      <button onClick={() => handleDelete(d.id)} className="px-2 py-1 text-xs rounded text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Right panel: editor */}
      {editorDraft && (
        <div className="w-1/2 flex flex-col bg-[#1e2228] border border-[#3a424d] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#3a424d] bg-[#1a1f26]">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-neutral-100">Article Editor</h3>
              <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[editorDraft.status]?.bg} ${STATUS_COLORS[editorDraft.status]?.text}`}>
                {STATUS_COLORS[editorDraft.status]?.label || editorDraft.status}
              </span>
            </div>
            <button
              onClick={() => setEditorDraft(null)}
              className="text-neutral-500 hover:text-neutral-300 text-lg leading-none"
            >
              &times;
            </button>
          </div>

          <div className="px-4 py-3 space-y-2 border-b border-[#3a424d]">
            <input
              value={editorTitle}
              onChange={e => setEditorTitle(e.target.value)}
              className="w-full bg-[#272C33] text-neutral-100 text-sm font-semibold px-3 py-2 rounded-lg border border-[#3a424d] focus:border-[#5ec1ca]/50 focus:outline-none"
              placeholder="Article title"
            />
            <input
              value={editorLabels}
              onChange={e => setEditorLabels(e.target.value)}
              className="w-full bg-[#272C33] text-neutral-400 text-xs px-3 py-1.5 rounded-lg border border-[#3a424d] focus:border-[#5ec1ca]/50 focus:outline-none"
              placeholder="Labels (comma-separated)"
            />
          </div>

          <div className="flex border-b border-[#3a424d]">
            <button
              onClick={() => setShowPreview(false)}
              className={`px-4 py-2 text-xs font-semibold ${!showPreview ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Edit
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className={`px-4 py-2 text-xs font-semibold ${showPreview ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              Preview
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {showPreview ? (
              <div
                className="prose prose-invert prose-sm max-w-none p-4"
                dangerouslySetInnerHTML={{ __html: marked.parse(editorBody) as string }}
              />
            ) : (
              <textarea
                value={editorBody}
                onChange={e => setEditorBody(e.target.value)}
                className="w-full h-full bg-transparent text-neutral-200 text-sm px-4 py-3 resize-none focus:outline-none font-mono leading-relaxed"
                placeholder="Article content (HTML or Markdown)"
              />
            )}
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-[#3a424d] bg-[#1a1f26]">
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#5ec1ca]/10 text-[#5ec1ca] hover:bg-[#5ec1ca]/20 transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Draft'}
              </button>
              {editorDraft.status !== 'published' && (
                <button
                  onClick={handlePublish}
                  disabled={publishing}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-50"
                >
                  {publishing ? 'Publishing...' : 'Publish to Confluence'}
                </button>
              )}
            </div>
            {editorDraft.confluence_url && (
              <a href={editorDraft.confluence_url} target="_blank" rel="noopener" className="text-xs text-[#5ec1ca] hover:underline">
                View in Confluence
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
