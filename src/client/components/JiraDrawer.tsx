import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../../shared/types.js';

interface Transition {
  id?: number | string;
  name?: string;
  to?: { name?: string };
}

interface JiraComment {
  id: string;
  body: string;
  author: { display_name?: string; name?: string; email?: string };
  created: string;
  updated?: string;
}

// Allowed transitions and their comment requirements
const ALLOWED_TRANSITIONS: Record<string, { commentRequired: boolean; commentTypes?: ('internal' | 'public')[] }> = {
  'Waiting on Assignee': { commentRequired: true, commentTypes: ['internal'] },
  'Waiting On Partner': { commentRequired: true, commentTypes: ['public', 'internal'] },
  'Waiting On Requestor': { commentRequired: true, commentTypes: ['public', 'internal'] },
  'Work in progress': { commentRequired: false },
};

// Normalise transition name for lookup (case-insensitive match)
function findAllowedTransition(name: string): { commentRequired: boolean; commentTypes?: ('internal' | 'public')[] } | null {
  for (const [key, config] of Object.entries(ALLOWED_TRANSITIONS)) {
    if (key.toLowerCase() === name.toLowerCase()) return config;
  }
  return null;
}

interface Props {
  task: Task;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function JiraDrawer({ task, index, total, onClose, onPrev, onNext }: Props) {
  const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');
  const [tools, setTools] = useState<string[]>([]);
  const [issue, setIssue] = useState<Record<string, unknown> | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [transition, setTransition] = useState('');
  const [comments, setComments] = useState<JiraComment[]>([]);

  // Transition comment modal
  const [transitionModal, setTransitionModal] = useState<{
    transition: Transition;
    commentTypes: ('internal' | 'public')[];
  } | null>(null);
  const [transitionComment, setTransitionComment] = useState('');
  const [transitionCommentType, setTransitionCommentType] = useState<'internal' | 'public'>('internal');

  const fields = useMemo(() => {
    const fieldsObj = (issue?.fields as Record<string, unknown> | undefined) ?? {};
    const summary = (fieldsObj.summary as string) ?? task.title;
    const description = (fieldsObj.description as string) ?? task.description ?? '';
    const priority = (fieldsObj.priority as { name?: string } | undefined)?.name
      ?? (fieldsObj.priority as string | undefined)
      ?? '';
    const status = (fieldsObj.status as { name?: string } | undefined)?.name
      ?? (fieldsObj.status as string | undefined)
      ?? task.status;
    const dueDate = (fieldsObj.duedate as string | undefined) ?? task.due_date ?? '';
    const assignee = (fieldsObj.assignee as { displayName?: string; name?: string } | undefined);
    const assigneeLabel = assignee?.displayName ?? assignee?.name ?? '';
    const tierRaw = fieldsObj.customfield_12981;
    const tier = typeof tierRaw === 'string' ? tierRaw : (tierRaw as any)?.value ?? (tierRaw as any)?.name ?? null;
    return { summary, description, priority, status, dueDate, assigneeLabel, tier };
  }, [issue, task]);

  const [summary, setSummary] = useState(fields.summary);
  const [description, setDescription] = useState(fields.description);
  const [priority, setPriority] = useState(fields.priority);
  const [dueDate, setDueDate] = useState(fields.dueDate);

  useEffect(() => {
    setSummary(fields.summary);
    setDescription(fields.description);
    setPriority(fields.priority);
    setDueDate(fields.dueDate);
  }, [fields.summary, fields.description, fields.priority, fields.dueDate]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const toolsRes = await fetch('/api/jira/tools');
        const toolsJson = await toolsRes.json();
        if (toolsJson?.ok && toolsJson?.data?.tools) {
          setTools(toolsJson.data.tools);
        }

        const issueRes = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`);
        const issueJson = await issueRes.json();
        if (!issueJson.ok) {
          throw new Error(issueJson.error ?? 'Failed to load Jira issue');
        }
        setIssue(issueJson.data ?? null);

        // Extract comments from MCP response (flat: data.comments) or Jira API (nested: data.fields.comment.comments)
        const issueData = issueJson.data;
        const rawComments: JiraComment[] =
          issueData?.comments ??
          issueData?.fields?.comment?.comments ??
          [];
        setComments(rawComments);

        const transitionsRes = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}/transitions`);
        const transitionsJson = await transitionsRes.json();
        if (transitionsJson.ok) {
          const data = transitionsJson.data;
          const list = Array.isArray(data) ? data : data?.transitions ?? data?.value ?? [];
          setTransitions(list as Transition[]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load Jira data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [issueKey]);

  const canUpdate = tools.some((t) => t.includes('jira_update_issue'));
  const canComment = tools.some((t) => t.includes('jira_add_comment') || t.includes('jira_create_comment'));
  const canTransition = tools.some((t) => t.includes('jira_transition_issue') || t.includes('jira_do_transition'));

  // Filter to only allowed transitions
  const allowedTransitions = transitions.filter((t) => t.name && findAllowedTransition(t.name));

  const handleTransitionClick = (t: Transition) => {
    const config = t.name ? findAllowedTransition(t.name) : null;
    if (!config) return;

    if (config.commentRequired && config.commentTypes) {
      // Open modal
      setTransitionComment('');
      setTransitionCommentType(config.commentTypes[0]);
      setTransitionModal({ transition: t, commentTypes: config.commentTypes });
    } else {
      // Immediate transition (e.g. Work in Progress)
      setTransition(String(t.id ?? t.name ?? ''));
      // Auto-save
      setTimeout(() => {
        const btn = document.getElementById('jira-save-btn');
        btn?.click();
      }, 50);
    }
  };

  const handleTransitionConfirm = () => {
    if (!transitionModal) return;
    setTransition(String(transitionModal.transition.id ?? transitionModal.transition.name ?? ''));
    if (transitionComment.trim()) {
      const prefix = transitionCommentType === 'internal' ? '[Internal] ' : '';
      setComment(prefix + transitionComment.trim());
    }
    setTransitionModal(null);
    // Auto-save after state updates
    setTimeout(() => {
      const btn = document.getElementById('jira-save-btn');
      btn?.click();
    }, 50);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const fieldsPayload: Record<string, unknown> = {};
      if (summary !== fields.summary) fieldsPayload.summary = summary;
      if (description !== fields.description) fieldsPayload.description = description;
      if (priority !== fields.priority) fieldsPayload.priority = { name: priority };
      if (dueDate !== fields.dueDate) fieldsPayload.duedate = dueDate || null;

      const body: Record<string, unknown> = {};
      if (Object.keys(fieldsPayload).length > 0) body.fields = fieldsPayload;
      if (comment.trim()) body.comment = comment.trim();
      if (transition) body.transition = transition;

      if (Object.keys(body).length === 0) {
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.error ?? 'Failed to update Jira issue');
      }
      setComment('');
      setTransition('');
      const refresh = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`);
      const refreshJson = await refresh.json();
      if (refreshJson.ok) {
        setIssue(refreshJson.data ?? null);
        const refreshed = refreshJson.data;
        setComments(refreshed?.comments ?? refreshed?.fields?.comment?.comments ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Jira issue');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-[#1f242b] border-l border-[#3a424d] shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-[#3a424d] flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-neutral-500 uppercase tracking-widest">
              Jira Issue
            </div>
            <div className="text-sm text-neutral-100 font-semibold truncate">
              {issueKey} — {fields.summary}
            </div>
          </div>
          {task.source_url && (
            <a
              href={task.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-[#5ec1ca] transition-colors"
            >
              Open in Jira
            </a>
          )}
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-neutral-100 transition-colors"
          >
            Close
          </button>
        </div>

        <div className="px-5 py-3 border-b border-[#3a424d] flex items-center gap-2 text-xs text-neutral-400">
          <button
            onClick={onPrev}
            disabled={index === 0}
            className="px-2 py-1 rounded bg-[#2f353d] disabled:opacity-40"
          >
            Prev
          </button>
          <button
            onClick={onNext}
            disabled={index >= total - 1}
            className="px-2 py-1 rounded bg-[#2f353d] disabled:opacity-40"
          >
            Next
          </button>
          <span className="ml-auto">
            {index + 1} of {total}
          </span>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="text-sm text-neutral-400">Loading issue…</div>
          )}
          {error && (
            <div className="text-sm text-red-400">{error}</div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs text-neutral-400">
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1">Status</div>
              <div className="text-neutral-200">{fields.status || 'Unknown'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1">Assignee</div>
              <div className="text-neutral-200">{fields.assigneeLabel || 'Unassigned'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1">Priority</div>
              <input
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={!canUpdate}
                className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1 border border-[#3a424d] disabled:opacity-50"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1">Due Date</div>
              <input
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={!canUpdate}
                placeholder="YYYY-MM-DD"
                className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1 border border-[#3a424d] disabled:opacity-50"
              />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-1">Current Tier</div>
              <div className="text-neutral-200">{fields.tier || 'None'}</div>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Summary</div>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              disabled={!canUpdate}
              className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] disabled:opacity-50"
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canUpdate}
              rows={6}
              className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] disabled:opacity-50"
            />
          </div>

          {/* Transition buttons */}
          {canTransition && allowedTransitions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-2 text-neutral-400">Transition</div>
              <div className="flex flex-wrap gap-2">
                {allowedTransitions.map((t) => {
                  const isWIP = t.name?.toLowerCase() === 'work in progress';
                  return (
                    <button
                      key={String(t.id ?? t.name)}
                      onClick={() => handleTransitionClick(t)}
                      disabled={saving}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                        isWIP
                          ? 'bg-blue-900/40 border-blue-800 text-blue-300 hover:bg-blue-900/60'
                          : 'bg-[#2f353d] border-[#3a424d] text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100'
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Comment history */}
          {comments.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-2 text-neutral-400">
                Comments ({comments.length})
              </div>
              <div className="space-y-2 max-h-60 overflow-auto">
                {[...comments].reverse().map((c) => (
                  <div key={c.id} className="px-3 py-2 rounded bg-[#272C33] border border-[#3a424d]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-[#5ec1ca] font-medium">
                        {c.author?.display_name ?? c.author?.name ?? 'Unknown'}
                      </span>
                      <span className="text-[10px] text-neutral-600">
                        {new Date(c.created).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' '}
                        {new Date(c.created).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-300 whitespace-pre-wrap break-words">
                      {c.body}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Add Comment</div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={!canComment}
              rows={4}
              className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] disabled:opacity-50"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#3a424d] flex items-center gap-3">
          <button
            id="jira-save-btn"
            onClick={handleSave}
            disabled={saving || (!canUpdate && !canComment && !canTransition)}
            className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] rounded font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <span className="text-xs text-neutral-500">
            {(!canUpdate && !canComment && !canTransition) ? 'Jira edit tools unavailable' : 'Changes apply in Jira'}
          </span>
        </div>
      </div>

      {/* Transition comment modal */}
      {transitionModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setTransitionModal(null)} />
          <div className="relative bg-[#1f242b] border border-[#3a424d] rounded-lg shadow-2xl w-full max-w-md mx-4 p-5">
            <h3 className="text-sm font-semibold text-neutral-100 mb-1">
              {transitionModal.transition.name}
            </h3>
            <p className="text-xs text-neutral-500 mb-4">
              Add a comment before transitioning this ticket.
            </p>

            {transitionModal.commentTypes.length > 1 && (
              <div className="flex gap-2 mb-3">
                {transitionModal.commentTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => setTransitionCommentType(type)}
                    className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                      transitionCommentType === type
                        ? type === 'internal'
                          ? 'bg-amber-900/50 border-amber-700 text-amber-300 font-semibold'
                          : 'bg-blue-900/50 border-blue-700 text-blue-300 font-semibold'
                        : 'bg-[#2f353d] border-[#3a424d] text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {type === 'internal' ? 'Internal' : 'Public'}
                  </button>
                ))}
              </div>
            )}

            {transitionModal.commentTypes.length === 1 && (
              <div className="mb-3">
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                  transitionModal.commentTypes[0] === 'internal'
                    ? 'bg-amber-900/50 text-amber-400'
                    : 'bg-blue-900/50 text-blue-400'
                }`}>
                  {transitionModal.commentTypes[0] === 'internal' ? 'Internal comment' : 'Public comment'}
                </span>
              </div>
            )}

            <textarea
              value={transitionComment}
              onChange={(e) => setTransitionComment(e.target.value)}
              placeholder="Enter your comment..."
              autoFocus
              rows={4}
              className="w-full bg-[#272C33] border border-[#3a424d] rounded-lg px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none resize-none mb-4"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setTransitionModal(null)}
                className="px-4 py-2 text-xs bg-[#2f353d] text-neutral-400 hover:text-neutral-200 rounded-lg border border-[#3a424d] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleTransitionConfirm}
                disabled={!transitionComment.trim()}
                className="px-4 py-2 text-xs bg-[#5ec1ca] text-[#272C33] font-semibold rounded-lg hover:bg-[#4db0b9] transition-colors disabled:opacity-40"
              >
                Transition
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
