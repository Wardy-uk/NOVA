import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../../shared/types.js';
import { TicketBriefCard, briefPropsFromTask } from './TicketBriefCard.js';
import { AINextActionCard } from './AINextActionCard.js';
import {
  TicketDetailsGrid,
  CommentComposer,
  ActivityStream,
  TransitionBar,
} from './ticket-detail/index.js';

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  jira: { bg: 'bg-badge-info-muted', text: 'text-on-badge-info-muted', label: 'Jira' },
  milestone: { bg: 'bg-badge-emerald-muted', text: 'text-on-badge-emerald-muted', label: 'Onboarding' },
};

// ---- Jira transition types ----

interface JiraTransition {
  id?: number | string;
  name?: string;
  to?: { name?: string };
}

interface JiraComment {
  id: string;
  body: unknown;
  author: { displayName?: string; display_name?: string; name?: string; email?: string };
  created: string;
  updated?: string;
}

interface Props {
  task: Task;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onTaskUpdated?: () => void;
}

// ---- Jira field extraction helpers ----

/** Safely check if value is a non-null, non-array object */
function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function extractJiraField(issue: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!issue) return undefined;
  // Try top-level first
  for (const k of keys) {
    if (issue[k] !== undefined) return issue[k];
  }
  // Try nested in .fields (full Jira REST API structure)
  const fields = issue.fields;
  if (isObj(fields)) {
    for (const k of keys) {
      if (fields[k] !== undefined) return fields[k];
    }
  }
  return undefined;
}

function extractJiraString(issue: Record<string, unknown> | null, ...keys: string[]): string {
  const val = extractJiraField(issue, ...keys);
  if (typeof val === 'string') return val;
  if (isObj(val)) {
    // Jira objects: { name: "High" }, { displayName: "John" }, { value: "..." }
    if (typeof val.name === 'string') return val.name;
    if (typeof val.displayName === 'string') return val.displayName;
    if (typeof val.value === 'string') return val.value;
  }
  return '';
}

function extractJiraDate(issue: Record<string, unknown> | null, ...keys: string[]): string {
  const val = extractJiraField(issue, ...keys);
  if (typeof val === 'string') return val.split('T')[0];
  if (isObj(val)) {
    const dt = val.dateTime ?? val.date;
    if (typeof dt === 'string') return dt.split('T')[0];
  }
  return '';
}

// ---- Component ----

export function TaskDrawer({ task, index, total, onClose, onPrev, onNext, onTaskUpdated }: Props) {
  const source = SOURCE_COLORS[task.source] ?? { bg: 'bg-neutral-800', text: 'text-neutral-300', label: task.source };
  const isJira = task.source === 'jira';

  // Live Jira issue data (fetched from MCP)
  const [jiraIssue, setJiraIssue] = useState<Record<string, unknown> | null>(null);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraTools, setJiraTools] = useState<string[]>([]);

  // Editable fields (non-Jira)
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [status, setStatus] = useState(task.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Jira transitions + comments
  const [jiraTransitions, setJiraTransitions] = useState<JiraTransition[]>([]);
  const [jiraComments, setJiraComments] = useState<JiraComment[]>([]);

  // Pending field changes (collected from TicketDetailsGrid via onFieldChange)
  const pendingFieldsRef = useRef<Record<string, unknown>>({});

  // Parse metadata from description lines (Jira-style "Key: Value") — memoised on description
  const metadata = useMemo(() => parseMetadata(task.description), [task.description]);

  // Jira-specific derived fields for header display
  const jiraFields = useMemo(() => {
    if (!isJira) return null;
    const rawData = isObj(task.raw_data) ? (task.raw_data as Record<string, unknown>) : null;
    const src = jiraIssue ?? rawData;

    const assigneeRaw = extractJiraField(src, 'assignee');
    const assignee = typeof assigneeRaw === 'string'
      ? assigneeRaw
      : (isObj(assigneeRaw) ? ((assigneeRaw.displayName as string) ?? (assigneeRaw.name as string) ?? '') : '');

    return {
      status: extractJiraString(src, 'status') || metadata.status || task.status || 'Unknown',
      assignee: assignee || metadata.assignee || 'Unassigned',
      summary: extractJiraString(src, 'summary') || task.title,
    };
  }, [isJira, jiraIssue, task.raw_data, task.title, task.status, metadata]);

  // Fetch live Jira data (issue, tools, transitions, comments)
  useEffect(() => {
    if (!isJira) return;
    const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');
    setJiraLoading(true);
    setError(null);

    Promise.all([
      fetch('/api/jira/tools').then(r => r.json()),
      fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`).then(r => r.json()),
      fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}/transitions`).then(r => r.json()).catch(() => null),
    ]).then(([toolsJson, issueJson, transitionsJson]) => {
      if (toolsJson?.ok && toolsJson.data?.tools) setJiraTools(toolsJson.data.tools);
      if (issueJson?.ok && isObj(issueJson.data)) {
        setJiraIssue(issueJson.data as Record<string, unknown>);
        const issueData = issueJson.data as Record<string, unknown>;
        const commentField = issueData.comment as { comments?: JiraComment[] } | JiraComment[] | undefined;
        const rawComments: JiraComment[] =
          Array.isArray(commentField) ? commentField :
          (commentField as { comments?: JiraComment[] })?.comments ??
          (issueData.comments as JiraComment[]) ??
          [];
        setJiraComments(rawComments);
      }
      if (transitionsJson?.ok) {
        const data = transitionsJson.data;
        const list = Array.isArray(data) ? data : data?.transitions ?? data?.value ?? [];
        setJiraTransitions(list as JiraTransition[]);
      }
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Failed to load Jira data');
    }).finally(() => setJiraLoading(false));
  }, [isJira, task.source_id, task.id]);

  // Sync non-Jira fields when task changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setStatus(task.status);
    setError(null);
    setSuccess(null);
    pendingFieldsRef.current = {};
  }, [task.id, task.title, task.description, task.status]);

  // Derive live Jira fields for TicketBriefCard
  const liveBriefProps = useMemo((): { ticketKey: string; fields: Record<string, unknown>; tier?: string | null } | null => {
    if (!isJira) return null;
    const ticketKey = task.source_id || task.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
    if (jiraIssue) {
      const tierRaw = jiraIssue.customfield_12981;
      const tier = typeof tierRaw === 'string' ? tierRaw : (tierRaw as any)?.value ?? (tierRaw as any)?.name ?? null;
      return { ticketKey, fields: jiraIssue, tier };
    }
    const bp = briefPropsFromTask(task);
    return bp;
  }, [isJira, jiraIssue, task]);

  const handleFieldChange = (field: string, value: unknown) => {
    pendingFieldsRef.current = { ...pendingFieldsRef.current, [field]: value };
  };

  // ---- Save handlers ----

  const handleSaveJira = async () => {
    const fields = pendingFieldsRef.current;
    if (Object.keys(fields).length === 0) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');

    try {
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Update failed');
      setSuccess('Saved to Jira');
      pendingFieldsRef.current = {};

      // Refresh issue data
      const refresh = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`);
      const refreshJson = await refresh.json();
      if (refreshJson.ok && isObj(refreshJson.data)) {
        setJiraIssue(refreshJson.data as Record<string, unknown>);
        const d = refreshJson.data as Record<string, unknown>;
        const cf = d.comment as { comments?: JiraComment[] } | JiraComment[] | undefined;
        setJiraComments(
          Array.isArray(cf) ? cf :
          (cf as { comments?: JiraComment[] })?.comments ??
          (d.comments as JiraComment[]) ??
          []
        );
      }

      onTaskUpdated?.();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');
    try {
      const refresh = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`);
      const refreshJson = await refresh.json();
      if (refreshJson.ok && isObj(refreshJson.data)) {
        setJiraIssue(refreshJson.data as Record<string, unknown>);
        const d = refreshJson.data as Record<string, unknown>;
        const cf = d.comment as { comments?: JiraComment[] } | JiraComment[] | undefined;
        setJiraComments(
          Array.isArray(cf) ? cf :
          (cf as { comments?: JiraComment[] })?.comments ??
          (d.comments as JiraComment[]) ??
          []
        );
      }
      // Re-fetch transitions
      const transRes = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}/transitions`).catch(() => null);
      if (transRes) {
        const transJson = await transRes.json();
        if (transJson?.ok) {
          const data = transJson.data;
          const list = Array.isArray(data) ? data : data?.transitions ?? data?.value ?? [];
          setJiraTransitions(list as JiraTransition[]);
        }
      }
    } catch { /* silent */ }
    onTaskUpdated?.();
  };

  const handleSave = handleSaveJira;

  const canSave = isJira;

  // Status update for local DB (pin/dismiss/snooze)
  const handleLocalAction = async (action: 'pin' | 'unpin' | 'dismiss' | 'done') => {
    try {
      const body: Record<string, unknown> = {};
      if (action === 'pin') body.is_pinned = true;
      if (action === 'unpin') body.is_pinned = false;
      if (action === 'dismiss') body.status = 'dismissed';
      if (action === 'done') body.status = 'done';

      await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onTaskUpdated?.();
    } catch {
      // silent
    }
  };

  // ---- Render ----

  const drawerWidth = isJira ? 'max-w-5xl' : 'max-w-xl';

  return (
    <div className="fixed inset-0 z-50">
      <style>{`
        @keyframes tdShift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes tdFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        .td-scroll::-webkit-scrollbar { width: 4px; }
        .td-scroll::-webkit-scrollbar-track { background: transparent; }
        .td-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        .td-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      `}</style>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`absolute right-0 top-0 h-full w-full ${drawerWidth} bg-[#0f1419] border-l shadow-2xl flex flex-col`} style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

        {/* ── Header (GlassCard accent) ── */}
        <TDGlassCard accent className="m-4 mb-0 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${source.bg} ${source.text}`}>
                  {source.label}
                </span>
                {task.source_id && (
                  <span className="text-[11px] font-mono font-bold text-[#5ec1ca]">{task.source_id}</span>
                )}
                {jiraFields?.status && (
                  <span className="text-[10px] text-neutral-500">· {jiraFields.status}</span>
                )}
              </div>
              <h2 className="text-xl font-bold text-neutral-100 leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
                {jiraFields?.summary || task.title}
              </h2>
              {isJira && (
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-300 flex-wrap">
                  <span>Reporter: <span className="text-neutral-100 font-semibold">{metadata.assignee ? '—' : '—'}</span></span>
                  <span className="text-neutral-600">·</span>
                  <span>Assignee: <span className="text-neutral-100 font-semibold">{jiraFields?.assignee || 'Unassigned'}</span></span>
                  <span className="text-neutral-600">·</span>
                  <span>Tier: <span className="text-neutral-100">{(() => {
                    const rd = (task.raw_data && typeof task.raw_data === 'object') ? task.raw_data as Record<string, unknown> : null;
                    const raw = rd?.customfield_12981;
                    return typeof raw === 'string' ? raw : (raw as any)?.value ?? (raw as any)?.name ?? 'None';
                  })()}</span></span>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => handleLocalAction(task.is_pinned ? 'unpin' : 'pin')}
                className="px-2.5 py-1.5 text-[10px] rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5"
              >
                {task.is_pinned ? 'Unfocus' : 'Focus'}
              </button>
              <button
                onClick={() => handleLocalAction('done')}
                className="px-2.5 py-1.5 text-[10px] rounded-lg font-semibold text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/10"
              >
                Done
              </button>
              <button
                onClick={() => handleLocalAction('dismiss')}
                className="px-2.5 py-1.5 text-[10px] rounded-lg font-semibold text-neutral-500 border border-white/10 hover:text-red-400 hover:border-red-500/30"
              >
                Dismiss
              </button>
              {task.source_url && (
                <a
                  href={task.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 text-[10px] rounded-lg font-semibold text-[#5ec1ca] border border-[#5ec1ca]/20 hover:bg-[#5ec1ca]/10"
                >
                  Open in {source.label}
                </a>
              )}
              <button
                onClick={onClose}
                className="px-2.5 py-1.5 text-[10px] rounded-lg font-semibold text-neutral-400 border border-white/10 hover:bg-white/5"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Navigation row */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5 text-xs text-neutral-400">
            <button onClick={onPrev} disabled={index === 0} className="px-2.5 py-1 rounded-lg border border-white/10 disabled:opacity-30 hover:bg-white/5">
              &larr; Prev
            </button>
            <button onClick={onNext} disabled={index >= total - 1} className="px-2.5 py-1 rounded-lg border border-white/10 disabled:opacity-30 hover:bg-white/5">
              Next &rarr;
            </button>
            <span className="ml-auto text-[11px] text-neutral-500">{index + 1} of {total}</span>
          </div>
        </TDGlassCard>

        {/* Status messages */}
        <div className="px-4 pt-2">
          {jiraLoading && <div className="text-[11px] text-neutral-500 py-1">Loading issue data...</div>}
          {error && <div className="p-2 rounded-lg text-xs text-red-400" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}
          {success && <div className="p-2 rounded-lg text-xs text-emerald-400" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>{success}</div>}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-hidden px-4 py-3">
          {/* ──── JIRA TWO-COLUMN LAYOUT ──── */}
          {isJira && (() => {
            const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');
            return (
              <div className="grid gap-4 h-full" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {/* Left column: Brief + AI + Details */}
                <div className="overflow-y-auto td-scroll space-y-4 pr-1">
                  {liveBriefProps && (
                    <TicketBriefCard ticketKey={liveBriefProps.ticketKey} fields={liveBriefProps.fields as any} tier={liveBriefProps.tier} compact />
                  )}
                  {task.source_id && (
                    <AINextActionCard ticketKey={task.source_id} compact />
                  )}
                  <TicketDetailsGrid
                    issue={jiraIssue}
                    editable
                    onFieldChange={handleFieldChange}
                    ticketKey={issueKey}
                  />
                  <RawDataSection rawData={task.raw_data} />
                </div>

                {/* Right column: Transitions + Comments + Activity */}
                <div className="overflow-y-auto td-scroll space-y-4 pr-1">
                  {jiraTransitions.length > 0 && (
                    <TransitionBar
                      ticketKey={issueKey}
                      transitions={jiraTransitions}
                      onTransitioned={handleRefresh}
                    />
                  )}
                  <CommentComposer
                    ticketKey={issueKey}
                    onCommentPosted={handleRefresh}
                  />
                  <ActivityStream
                    ticketKey={issueKey}
                    comments={jiraComments}
                  />
                </div>
              </div>
            );
          })()}

          {/* ──── NON-JIRA SINGLE-COLUMN LAYOUT ──── */}
          {!isJira && (
            <div className="overflow-y-auto td-scroll h-full space-y-4 pr-1">
              <TDGlassCard className="p-4">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Status</div>
                    <div className="text-[13px] text-neutral-50 rounded-lg px-3 py-2.5 capitalize" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {task.status?.replace('_', ' ') || 'Unknown'}
                      </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Priority</div>
                    <div className="text-[13px] text-neutral-50 rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                      {priorityLabel(task.priority)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Due Date</div>
                    <div className="text-[13px] text-neutral-50 rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {task.due_date ? formatDate(task.due_date) : 'None'}
                      </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Category</div>
                    <div className="text-[13px] text-neutral-50 rounded-lg px-3 py-2.5 capitalize" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                      {task.category ?? 'None'}
                    </div>
                  </div>
                  {metadata.assignee && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Assignee</div>
                      <div className="text-[13px] text-neutral-50 rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {metadata.assignee}
                      </div>
                    </div>
                  )}
                  {metadata.created && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Created</div>
                      <div className="text-[13px] text-neutral-50 rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                        {metadata.created}
                      </div>
                    </div>
                  )}
                </div>
              </TDGlassCard>

              {/* Title */}
              <TDGlassCard className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Title</div>
                <div className="text-sm text-neutral-200">{task.title}</div>
              </TDGlassCard>

              {/* Description */}
              <TDGlassCard className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1">Description</div>
                <div className="text-sm text-neutral-300 whitespace-pre-wrap max-h-48 overflow-auto rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}>
                    {task.description || 'No description'}
                  </div>
              </TDGlassCard>

              <RawDataSection rawData={task.raw_data} />
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {canSave && (
          <div className="px-5 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="flex items-center gap-3">
              <button
                id="jira-save-btn"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #5ec1ca, #9b6aed)', boxShadow: '0 4px 16px rgba(94,193,202,0.35)' }}
              >
                {saving ? 'Saving…' : 'Save & Sync'}
              </button>
              <span className="text-[11px] text-neutral-500">Changes sync back to {source.label}</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

function TDGlassCard({ children, className = '', accent }: { children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={`relative rounded-2xl overflow-hidden ${className}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {accent && (
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: 'linear-gradient(90deg, transparent, #9b6aed 30%, #5ec1ca 70%, transparent)',
            backgroundSize: '200% 100%',
            animation: 'tdShift 6s ease-in-out infinite',
          }}
        />
      )}
      {children}
    </div>
  );
}

function RawDataSection({ rawData }: { rawData: unknown }) {
  const [open, setOpen] = useState(false);
  if (!rawData) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-neutral-300 transition-colors"
      >
        {open ? 'Hide' : 'Show'} Raw Data
      </button>
      {open && (
        <pre className="mt-2 text-[10px] text-neutral-400 bg-[#272C33] rounded p-3 border border-[#3a424d] overflow-auto max-h-48">
          {JSON.stringify(rawData, null, 2)}
        </pre>
      )}
    </div>
  );
}

function priorityLabel(p: number): string {
  if (p >= 90) return 'Critical';
  if (p >= 70) return 'High';
  if (p >= 40) return 'Medium';
  if (p >= 20) return 'Low';
  return 'Lowest';
}

function formatDate(d: string): string {
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

function parseMetadata(desc: string | null): Record<string, string> {
  if (!desc) return {};
  const result: Record<string, string> = {};
  for (const line of desc.split('\n')) {
    const match = line.match(/^(Assignee|Status|Priority|Created):\s*(.+)/i);
    if (match) {
      result[match[1].toLowerCase()] = match[2].trim();
    }
  }
  return result;
}
