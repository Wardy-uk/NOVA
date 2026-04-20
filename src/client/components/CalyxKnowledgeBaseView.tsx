import { useState, type CSSProperties } from 'react';
import { C, cardStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, labelStyle, StatusBadge, EmptyState, SlidePanel, calyxApi, useCalyxData, formatDate } from './calyx-shared.js';

interface Article {
  id: number;
  title: string;
  status: string;
  team: string;
  category: string;
  views: number;
  helpful_yes: number;
  helpful_no: number;
  created_at: string;
  updated_at: string;
}

interface ArticleDetail extends Article {
  body: string;
}

const STATUSES = ['all', 'draft', 'published', 'archived'] as const;

const thStyle: CSSProperties = {
  textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 600,
  color: C.text3, borderBottom: `1px solid ${C.border}`, textTransform: 'uppercase', letterSpacing: 0.5,
};

const tdStyle: CSSProperties = {
  padding: '10px 12px', fontSize: 13, color: C.text1, borderBottom: `1px solid ${C.border}`,
};

function helpfulRatio(yes: number, no: number): string {
  const total = yes + no;
  if (total === 0) return '--';
  return Math.round((yes / total) * 100) + '%';
}

function renderFormattedBody(body: string) {
  const lines = body.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = applyBold(headingMatch[2]);
      const sizes: Record<number, number> = { 1: 24, 2: 20, 3: 17, 4: 15, 5: 14, 6: 13 };
      elements.push(
        <div key={i} style={{ fontSize: sizes[level] || 13, fontWeight: 700, color: C.text1, margin: '12px 0 4px' }}
          dangerouslySetInnerHTML={{ __html: text }} />
      );
      continue;
    }

    // Regular line with bold support
    if (line.trim() === '') {
      elements.push(<br key={i} />);
    } else {
      elements.push(
        <span key={i}>
          <span dangerouslySetInnerHTML={{ __html: applyBold(escapeHtml(line)) }} />
          <br />
        </span>
      );
    }
  }

  return <>{elements}</>;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

export function CalyxKnowledgeBaseView() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<ArticleDetail | null>(null);

  const { data: articles, loading, reload } = useCalyxData<Article[]>('/kb');

  const allTeams = [...new Set((articles || []).map(a => a.team).filter(Boolean))].sort();

  const filtered = (articles || []).filter(a => {
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    if (teamFilter !== 'all' && a.team !== teamFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.title.toLowerCase().includes(q) && !a.category.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const selected = selectedId ? (articles || []).find(a => a.id === selectedId) || null : null;

  const openNew = () => {
    setEditingArticle(null);
    setEditorOpen(true);
  };

  const openEdit = (id: number) => {
    calyxApi<ArticleDetail>(`/kb/${id}`).then(r => {
      if (r.ok && r.data) {
        setEditingArticle(r.data);
        setEditorOpen(true);
      }
    });
  };

  const handleDelete = async (id: number) => {
    await calyxApi(`/kb/${id}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    reload();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.text1 }}>Knowledge Base</h2>
        <button style={btnPrimary} onClick={openNew}>New Article</button>
      </div>

      {/* Filter bar */}
      <div style={{ ...cardStyle, padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, width: 240 }}
          placeholder="Search articles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={selectStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUSES.filter(s => s !== 'all').map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <select style={selectStyle} value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="all">All teams</option>
          {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 16, minHeight: 400 }}>
        {/* Left: article list (60%) */}
        <div style={{ flex: '0 0 60%', minWidth: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.text3 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="search" title="No articles found" subtitle="Adjust filters or create a new article" />
          ) : (
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Title</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Team</th>
                    <th style={thStyle}>Category</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Views</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Helpful</th>
                    <th style={thStyle}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => (
                    <tr
                      key={a.id}
                      onClick={() => setSelectedId(a.id)}
                      style={{
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                        background: selectedId === a.id ? C.glassHover : 'transparent',
                      }}
                      onMouseEnter={e => { if (selectedId !== a.id) e.currentTarget.style.background = C.glassHover; }}
                      onMouseLeave={e => { if (selectedId !== a.id) e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={{ ...tdStyle, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
                        {a.title}
                      </td>
                      <td style={tdStyle}><StatusBadge status={a.status} /></td>
                      <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{a.team || '--'}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{a.category || '--'}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: C.text2, textAlign: 'right' }}>{a.views}</td>
                      <td style={{ ...tdStyle, fontSize: 12, color: C.text2, textAlign: 'right' }}>
                        {helpfulRatio(a.helpful_yes, a.helpful_no)}
                      </td>
                      <td style={{ ...tdStyle, fontSize: 12, color: C.text2 }}>{formatDate(a.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: article preview (40%) */}
        <div style={{ flex: '0 0 calc(40% - 16px)', minWidth: 0 }}>
          {selected ? (
            <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text1, lineHeight: 1.3 }}>{selected.title}</h3>
                <StatusBadge status={selected.status} />
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>Team</span>
                  <div style={{ fontSize: 13, color: C.text1 }}>{selected.team || '--'}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>Category</span>
                  <div style={{ fontSize: 13, color: C.text1 }}>{selected.category || '--'}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>Views</span>
                  <div style={{ fontSize: 13, color: C.text1 }}>{selected.views}</div>
                </div>
                <div>
                  <span style={{ fontSize: 11, color: C.text3, fontWeight: 600 }}>Helpful</span>
                  <div style={{ fontSize: 13, color: C.text1 }}>{helpfulRatio(selected.helpful_yes, selected.helpful_no)}</div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: C.text3 }}>
                Updated {formatDate(selected.updated_at)}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button style={btnPrimary} onClick={() => openEdit(selected.id)}>Edit</button>
                <button style={btnSecondary} onClick={() => handleDelete(selected.id)}>Delete</button>
              </div>
            </div>
          ) : (
            <div style={{ ...cardStyle, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <EmptyState icon="inbox" title="Select an article" subtitle="Click an article to preview it here" />
            </div>
          )}
        </div>
      </div>

      {/* Article editor SlidePanel */}
      <SlidePanel
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingArticle ? 'Edit Article' : 'New Article'}
        width={800}
      >
        <ArticleEditor
          article={editingArticle}
          onSaved={() => { setEditorOpen(false); reload(); }}
          onCancel={() => setEditorOpen(false)}
        />
      </SlidePanel>
    </div>
  );
}

function ArticleEditor({ article, onSaved, onCancel }: {
  article: ArticleDetail | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(article?.title || '');
  const [body, setBody] = useState(article?.body || '');
  const [team, setTeam] = useState(article?.team || '');
  const [category, setCategory] = useState(article?.category || '');
  const [status, setStatus] = useState(article?.status || 'draft');
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const payload = { title: title.trim(), body, team: team.trim(), category: category.trim(), status };
    if (article) {
      await calyxApi(`/kb/${article.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await calyxApi('/kb', { method: 'POST', body: JSON.stringify(payload) });
    }
    setSaving(false);
    onSaved();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title */}
      <div>
        <label style={labelStyle}>Title</label>
        <input
          style={inputStyle}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Article title"
        />
      </div>

      {/* Body with preview toggle */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Body</label>
          <button
            style={{
              ...btnSecondary,
              padding: '4px 12px',
              fontSize: 11,
              background: previewing ? `${C.teal}20` : 'transparent',
            }}
            onClick={() => setPreviewing(!previewing)}
          >
            {previewing ? 'Edit' : 'Preview'}
          </button>
        </div>
        {previewing ? (
          <div style={{
            ...inputStyle,
            minHeight: 300,
            padding: 16,
            fontSize: 14,
            lineHeight: 1.6,
            color: C.text1,
            overflow: 'auto',
          }}>
            {body ? renderFormattedBody(body) : <span style={{ color: C.text3 }}>Nothing to preview</span>}
          </div>
        ) : (
          <textarea
            style={{
              ...inputStyle,
              minHeight: 300,
              resize: 'vertical' as const,
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.5,
            }}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Article body... supports **bold** and # headings"
          />
        )}
      </div>

      {/* Metadata row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>Team</label>
          <input
            style={inputStyle}
            value={team}
            onChange={e => setTeam(e.target.value)}
            placeholder="e.g. Support"
          />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>Category</label>
          <input
            style={inputStyle}
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder="e.g. Troubleshooting"
          />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={labelStyle}>Status</label>
          <select style={{ ...selectStyle, width: '100%' }} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button style={btnPrimary} onClick={handleSave} disabled={saving || !title.trim()}>
          {saving ? 'Saving...' : article ? 'Save Changes' : 'Create Article'}
        </button>
        <button style={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
