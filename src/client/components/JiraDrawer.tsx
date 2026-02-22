import { useEffect, useMemo, useState } from 'react';
import type { Task } from '../../shared/types.js';

interface Transition {
  id?: string;
  name?: string;
  to?: { name?: string };
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
    return { summary, description, priority, status, dueDate, assigneeLabel };
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
      if (refreshJson.ok) setIssue(refreshJson.data ?? null);
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

          <div>
            <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Transition</div>
            <select
              value={transition}
              onChange={(e) => setTransition(e.target.value)}
              disabled={!canTransition || transitions.length === 0}
              className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] disabled:opacity-50"
            >
              <option value="">Select transition</option>
              {transitions.map((t, idx) => (
                <option key={`${t.id ?? t.name ?? 'transition'}-${idx}`} value={t.id ?? t.name ?? ''}>
                  {t.name ?? t.to?.name ?? t.id ?? `Transition ${idx + 1}`}
                </option>
              ))}
            </select>
          </div>

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
    </div>
  );
}
