import { useState, useEffect, useCallback } from 'react';
import { marked } from 'marked';

// The KB Gaps register. Rows are TOPICS (clusters of tickets that hit the same missing
// article), not individual triage hits — grouping on the triage AI's free-text title
// used to split one topic across a dozen rows and bury the volume.

const JIRA_BROWSE = 'https://nurturtech.atlassian.net/browse/';

interface OutlineSection {
  heading: string;
  covers: string | null;
}

interface GapCluster {
  id: number;
  canonical_title: string;
  category: string | null;
  why_needed: string | null;
  outline_json: string | null;
  audience: string | null;
  brief_generated_at: string | null;
  member_count: number;
  status: string;
  assigned_to: string | null;
  jira_ticket_key: string | null;
  confluence_url: string | null;
  draft_id: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

interface ClusterMember {
  id: number;
  ticket_id: string;
  suggested_title: string | null;
  reason: string | null;
  created_at: string;
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
  article_published: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Published' },
  dismissed: { bg: 'bg-neutral-500/10', text: 'text-neutral-400', label: 'Dismissed' },
  draft: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Draft' },
  published: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Published' },
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

export function KbGapsView({ token, role }: { token: string; role?: string }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [clusters, setClusters] = useState<GapCluster[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [members, setMembers] = useState<Record<number, ClusterMember[]>>({});
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rosterNames, setRosterNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  const [editorDraft, setEditorDraft] = useState<KbArticleDraft | null>(null);
  const [editorCluster, setEditorCluster] = useState<number | null>(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorBody, setEditorBody] = useState('');
  const [editorLabels, setEditorLabels] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const isAdmin = role === 'admin' || role === 'super_admin';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { ok: false, error: `Non-JSON response (${res.status})` }; }
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [listJson, countsJson, rosterJson] = await Promise.all([
      api(`/api/agent/kb-gaps/clusters?status=${statusFilter}&limit=200`),
      api('/api/agent/kb-gaps/clusters/counts'),
      api('/api/agent/roster'),
    ]);
    if (listJson.ok) setClusters(listJson.data); else setError(listJson.error || 'Failed to load gaps');
    if (countsJson.ok) setCounts(countsJson.data);
    if (rosterJson.ok && Array.isArray(rosterJson.data)) {
      setRosterNames(rosterJson.data.filter((a: any) => a.active).map((a: any) => a.display_name));
    }
    setLoading(false);
  }, [statusFilter, api]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (id: number) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!members[id]) {
      const json = await api(`/api/agent/kb-gaps/clusters/${id}`);
      if (json.ok) setMembers(m => ({ ...m, [id]: json.data.members || [] }));
    }
  };

  const patchCluster = (id: number, changes: Partial<GapCluster>) =>
    setClusters(cs => cs.map(c => (c.id === id ? { ...c, ...changes } : c)));

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    setBusy(null);
  };

  const regenerateBrief = (c: GapCluster) => withBusy(`brief-${c.id}`, async () => {
    const json = await api(`/api/agent/kb-gaps/clusters/${c.id}/brief`, { method: 'POST' });
    if (json.ok) patchCluster(c.id, json.data); else setError(json.error || 'Brief generation failed');
  });

  const assign = (c: GapCluster, name: string) => withBusy(`assign-${c.id}`, async () => {
    const json = await api(`/api/agent/kb-gaps/clusters/${c.id}`, {
      method: 'PATCH', body: JSON.stringify({ assigned_to: name || null }),
    });
    if (json.ok) patchCluster(c.id, { assigned_to: name || null }); else setError(json.error || 'Assign failed');
  });

  const createTicket = (c: GapCluster) => withBusy(`ticket-${c.id}`, async () => {
    const json = await api(`/api/agent/kb-gaps/clusters/${c.id}/create-ticket`, { method: 'POST' });
    if (json.ok) patchCluster(c.id, { jira_ticket_key: json.data.ticket_key });
    else setError(json.error || 'Ticket creation failed');
  });

  const dismiss = (c: GapCluster) => withBusy(`dismiss-${c.id}`, async () => {
    const json = await api(`/api/agent/kb-gaps/clusters/${c.id}/dismiss`, { method: 'POST' });
    if (json.ok) load(); else setError(json.error || 'Dismiss failed');
  });

  const generateArticle = (c: GapCluster) => withBusy(`gen-${c.id}`, async () => {
    const json = await api(`/api/agent/kb-gaps/clusters/${c.id}/generate-article`, { method: 'POST' });
    if (json.ok) { openEditor(json.data, c.id); load(); }
    else setError(json.error || 'Article generation failed');
  });

  const openDraft = (c: GapCluster) => withBusy(`open-${c.id}`, async () => {
    if (!c.draft_id) return;
    const json = await api(`/api/kb-articles/${c.draft_id}`);
    if (json.ok) openEditor(json.data, c.id); else setError(json.error || 'Could not open draft');
  });

  const runRefresh = async () => {
    setRefreshing(true);
    setRefreshResult(null);
    setError(null);
    const json = await api('/api/agent/kb-gaps/refresh', {
      method: 'POST', body: JSON.stringify({ briefLimit: 25 }),
    });
    if (json.ok) {
      const d = json.data;
      setRefreshResult(`Embedded ${d.embedded} · ${d.created} new topics, ${d.joined} merged · ${d.briefed} briefed${d.failed ? `, ${d.failed} failed` : ''}`);
      load();
    } else {
      setError(json.error || 'Refresh failed');
    }
    setRefreshing(false);
  };

  const openEditor = (draft: KbArticleDraft, clusterId: number) => {
    setEditorDraft(draft);
    setEditorCluster(clusterId);
    setEditorTitle(draft.title);
    setEditorBody(draft.body);
    setEditorLabels(draft.labels || '');
    setShowPreview(false);
  };

  const handleSave = async () => {
    if (!editorDraft) return false;
    setSaving(true);
    const json = await api(`/api/kb-articles/${editorDraft.id}`, {
      method: 'PUT', body: JSON.stringify({ title: editorTitle, body: editorBody, labels: editorLabels }),
    });
    setSaving(false);
    if (!json.ok) setError(json.error || 'Save failed');
    return json.ok;
  };

  const handlePublish = async () => {
    if (!editorDraft || editorCluster === null) return;
    if (!(await handleSave())) return;
    setPublishing(true);
    // Publish via the cluster so the topic and every gap row behind it close together.
    const json = await api(`/api/agent/kb-gaps/clusters/${editorCluster}/publish`, { method: 'POST' });
    if (json.ok) {
      setEditorDraft({ ...editorDraft, status: 'published', confluence_url: json.data.url });
      load();
    } else {
      setError(json.error || 'Publish failed');
    }
    setPublishing(false);
  };

  const statusTabs: Array<{ key: StatusFilter; label: string }> = [
    { key: 'open', label: `Identified (${counts.open || 0})` },
    { key: 'article_drafted', label: `Drafted (${counts.article_drafted || 0})` },
    { key: 'article_published', label: `Published (${counts.article_published || 0})` },
    { key: 'dismissed', label: `Dismissed (${counts.dismissed || 0})` },
  ];

  return (
    <div className="flex gap-4 h-full">
      <div className={`flex flex-col min-w-0 ${editorDraft ? 'w-1/2' : 'w-full'} transition-all`}>
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex gap-2">
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
          {isAdmin && (
            <button
              onClick={runRefresh}
              disabled={refreshing}
              title="Embed new gaps, merge them into topics, and write briefs for the biggest"
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#2f353d] border border-[#3a424d] text-neutral-300 hover:bg-[#363d47] transition disabled:opacity-50 shrink-0"
            >
              {refreshing ? 'Refreshing…' : 'Refresh topics'}
            </button>
          )}
        </div>

        <p className="text-xs text-neutral-500 mb-3">
          Topics where triage found no KB article. Tickets describing the same missing article are merged into one topic and ranked by how many tickets hit it.
        </p>

        {error && <div className="mb-3 p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">{error}</div>}
        {refreshResult && <div className="mb-3 p-2 bg-emerald-950/30 border border-emerald-900/50 rounded text-emerald-400 text-xs">{refreshResult}</div>}

        {loading && <div className="text-neutral-500 text-sm py-8 text-center">Loading…</div>}

        {!loading && clusters.length === 0 && (
          <div className="text-neutral-500 text-sm py-8 text-center">
            No topics with this status.{isAdmin && statusFilter === 'open' ? ' Run "Refresh topics" to build the register from recent triage.' : ''}
          </div>
        )}

        <div className="space-y-2 overflow-y-auto">
          {clusters.map(c => {
            const outline: OutlineSection[] = c.outline_json ? safeParse(c.outline_json) : [];
            const isOpen = expanded === c.id;
            return (
              <div key={c.id} className="bg-[#1e2228] border border-[#3a424d] rounded-lg">
                <div className="flex items-start gap-3 p-3">
                  <span
                    title={`${c.member_count} tickets hit this gap`}
                    className={`shrink-0 inline-flex items-center justify-center min-w-[2rem] h-6 px-1.5 rounded text-xs font-bold ${
                      c.member_count >= 20 ? 'bg-red-950/60 text-red-400'
                        : c.member_count >= 5 ? 'bg-amber-950/60 text-amber-400'
                        : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {c.member_count}
                  </span>

                  <div className="min-w-0 flex-1">
                    <button onClick={() => toggleExpand(c.id)} className="text-left w-full group">
                      <div className="text-sm font-semibold text-neutral-100 group-hover:text-white">
                        {c.canonical_title}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-neutral-500">
                        {c.category && <span>{c.category}</span>}
                        {c.audience && <span className="text-neutral-400">for {c.audience}</span>}
                        <span>{fmt(c.first_seen)} → {fmt(c.last_seen)}</span>
                        {!c.brief_generated_at && <span className="text-amber-500/80">No brief yet</span>}
                      </div>
                    </button>

                    {c.why_needed && !isOpen && (
                      <p className="text-xs text-neutral-400 mt-1.5 line-clamp-2">{c.why_needed}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <select
                      value={c.assigned_to || ''}
                      onChange={e => assign(c, e.target.value)}
                      disabled={busy === `assign-${c.id}`}
                      className="bg-[#272C33] border border-[#3a424d] rounded px-1.5 py-1 text-[11px] text-neutral-300 max-w-[9rem]"
                    >
                      <option value="">Unassigned</option>
                      {rosterNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    {c.jira_ticket_key ? (
                      <a href={`${JIRA_BROWSE}${c.jira_ticket_key}`} target="_blank" rel="noreferrer"
                         className="px-2 py-1 text-[11px] font-mono text-blue-400 hover:text-blue-300">
                        {c.jira_ticket_key} →
                      </a>
                    ) : (
                      <button onClick={() => createTicket(c)} disabled={busy === `ticket-${c.id}`}
                              className="px-2 py-1 text-[11px] text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                        {busy === `ticket-${c.id}` ? 'Creating…' : 'Create Ticket'}
                      </button>
                    )}
                    <button onClick={() => toggleExpand(c.id)} className="px-1.5 text-neutral-500 hover:text-neutral-300 text-xs">
                      {isOpen ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-[#3a424d] px-3 py-3 space-y-3">
                    {c.why_needed && (
                      <div>
                        <h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Why this is needed</h4>
                        <p className="text-xs text-neutral-300 leading-relaxed">{c.why_needed}</p>
                      </div>
                    )}

                    {outline.length > 0 && (
                      <div>
                        <h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">What the article must cover</h4>
                        <ol className="space-y-1.5">
                          {outline.map((s, i) => (
                            <li key={i} className="text-xs text-neutral-300">
                              <span className="text-neutral-500 mr-1.5">{i + 1}.</span>
                              <span className="font-semibold">{s.heading}</span>
                              {s.covers && <span className="text-neutral-400"> — {s.covers}</span>}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    <div>
                      <h4 className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                        Tickets that hit this gap ({members[c.id]?.length ?? c.member_count})
                      </h4>
                      <div className="space-y-1 max-h-52 overflow-y-auto">
                        {(members[c.id] || []).map(m => (
                          <div key={m.id} className="text-xs flex gap-2">
                            {/^(NT|NTPJ)-\d+$/i.test(m.ticket_id) ? (
                              <a href={`${JIRA_BROWSE}${m.ticket_id}`} target="_blank" rel="noreferrer"
                                 className="font-mono text-blue-400 hover:text-blue-300 shrink-0 w-24">{m.ticket_id}</a>
                            ) : (
                              <span className="font-mono text-neutral-600 shrink-0 w-24">{m.ticket_id}</span>
                            )}
                            <span className="text-neutral-400 min-w-0">{m.reason || m.suggested_title || '—'}</span>
                          </div>
                        ))}
                        {!members[c.id] && <div className="text-xs text-neutral-600">Loading tickets…</div>}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button onClick={() => regenerateBrief(c)} disabled={busy === `brief-${c.id}`}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-[#2f353d] border border-[#3a424d] text-neutral-300 hover:bg-[#363d47] transition disabled:opacity-50">
                        {busy === `brief-${c.id}` ? 'Writing brief…' : c.brief_generated_at ? 'Regenerate brief' : 'Generate brief'}
                      </button>
                      {c.draft_id ? (
                        <button onClick={() => openDraft(c)} disabled={busy === `open-${c.id}`}
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition disabled:opacity-50">
                          {busy === `open-${c.id}` ? 'Opening…' : 'Edit Draft'}
                        </button>
                      ) : (
                        <button onClick={() => generateArticle(c)} disabled={busy === `gen-${c.id}`}
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-[#5ec1ca]/10 text-[#5ec1ca] hover:bg-[#5ec1ca]/20 transition disabled:opacity-50">
                          {busy === `gen-${c.id}` ? 'Generating…' : 'Generate Article'}
                        </button>
                      )}
                      {c.confluence_url && (
                        <a href={c.confluence_url} target="_blank" rel="noreferrer"
                           className="px-2.5 py-1 text-xs font-semibold rounded text-[#5ec1ca] hover:underline">
                          View in Confluence
                        </a>
                      )}
                      {c.status === 'open' && (
                        <button onClick={() => dismiss(c)} disabled={busy === `dismiss-${c.id}`}
                                className="px-2 py-1 text-xs rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700/30 transition disabled:opacity-50">
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editorDraft && (
        <div className="w-1/2 flex flex-col bg-[#1e2228] border border-[#3a424d] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#3a424d] bg-[#1a1f26]">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-bold text-neutral-100">Article Editor</h3>
              <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_COLORS[editorDraft.status]?.bg} ${STATUS_COLORS[editorDraft.status]?.text}`}>
                {STATUS_COLORS[editorDraft.status]?.label || editorDraft.status}
              </span>
            </div>
            <button onClick={() => { setEditorDraft(null); setEditorCluster(null); }}
                    className="text-neutral-500 hover:text-neutral-300 text-lg leading-none">
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
            <button onClick={() => setShowPreview(false)}
                    className={`px-4 py-2 text-xs font-semibold ${!showPreview ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}>
              Edit
            </button>
            <button onClick={() => setShowPreview(true)}
                    className={`px-4 py-2 text-xs font-semibold ${showPreview ? 'text-[#5ec1ca] border-b-2 border-[#5ec1ca]' : 'text-neutral-500 hover:text-neutral-300'}`}>
              Preview
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {showPreview ? (
              <div className="prose prose-invert prose-sm max-w-none p-4"
                   dangerouslySetInnerHTML={{ __html: marked.parse(editorBody) as string }} />
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
              <button onClick={handleSave} disabled={saving}
                      className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#5ec1ca]/10 text-[#5ec1ca] hover:bg-[#5ec1ca]/20 transition disabled:opacity-50">
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              {editorDraft.status !== 'published' && (
                <button onClick={handlePublish} disabled={publishing}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition disabled:opacity-50">
                  {publishing ? 'Publishing…' : 'Publish to Confluence'}
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

function safeParse(json: string): OutlineSection[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
