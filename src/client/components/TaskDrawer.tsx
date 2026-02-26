import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '../../shared/types.js';

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  jira: { bg: 'bg-blue-900/50', text: 'text-blue-300', label: 'Jira' },
  planner: { bg: 'bg-green-900/50', text: 'text-green-300', label: 'Planner' },
  todo: { bg: 'bg-purple-900/50', text: 'text-purple-300', label: 'To-Do' },
  calendar: { bg: 'bg-amber-900/50', text: 'text-amber-300', label: 'Calendar' },
  email: { bg: 'bg-red-900/50', text: 'text-red-300', label: 'Email' },
  monday: { bg: 'bg-orange-900/50', text: 'text-orange-300', label: 'Monday' },
  milestone: { bg: 'bg-emerald-900/50', text: 'text-emerald-300', label: 'Onboarding' },
};

const JIRA_PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

// ---- Jira transition types ----

interface JiraTransition {
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

const ALLOWED_TRANSITIONS: Record<string, { commentRequired: boolean; commentTypes?: ('internal' | 'public')[] }> = {
  'Waiting on Assignee': { commentRequired: true, commentTypes: ['internal'] },
  'Waiting On Partner': { commentRequired: true, commentTypes: ['public', 'internal'] },
  'Waiting On Requestor': { commentRequired: true, commentTypes: ['public', 'internal'] },
  'Work in progress': { commentRequired: false },
};

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
  const isEmail = task.source === 'email';
  const isCalendar = task.source === 'calendar';
  const canEditO365 = task.source === 'planner' || task.source === 'todo';

  // Live Jira issue data (fetched from MCP)
  const [jiraIssue, setJiraIssue] = useState<Record<string, unknown> | null>(null);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraTools, setJiraTools] = useState<string[]>([]);

  // Editable fields
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [dueDate, setDueDate] = useState(task.due_date?.split('T')[0] ?? '');
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState('');
  const [agentNextUpdate, setAgentNextUpdate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Jira assignee search
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [assigneeResults, setAssigneeResults] = useState<Array<{ accountId: string; displayName: string; emailAddress?: string }>>([]);
  const [assigneeSearching, setAssigneeSearching] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<{ accountId: string; displayName: string } | null>(null);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const assigneeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Jira transitions + comments
  const [jiraTransitions, setJiraTransitions] = useState<JiraTransition[]>([]);
  const [jiraComments, setJiraComments] = useState<JiraComment[]>([]);
  const [comment, setComment] = useState('');
  const [transition, setTransition] = useState('');
  const [transitionModal, setTransitionModal] = useState<{
    transition: JiraTransition;
    commentTypes: ('internal' | 'public')[];
  } | null>(null);
  const [transitionComment, setTransitionComment] = useState('');
  const [transitionCommentType, setTransitionCommentType] = useState<'internal' | 'public'>('internal');

  // Email compose state
  const [emailMode, setEmailMode] = useState<'reply' | 'forward' | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);

  // Calendar edit state
  const [calSubject, setCalSubject] = useState('');
  const [calStart, setCalStart] = useState('');
  const [calEnd, setCalEnd] = useState('');
  const [calLocation, setCalLocation] = useState('');
  const [calEditing, setCalEditing] = useState(false);
  const [calSaving, setCalSaving] = useState(false);

  // Parse metadata from description lines (Jira-style "Key: Value") — memoised on description
  const metadata = useMemo(() => parseMetadata(task.description), [task.description]);

  // Jira-specific derived fields — prefer live jiraIssue (if valid object), fall back to stored raw_data, then description metadata
  const jiraFields = useMemo(() => {
    if (!isJira) return null;
    const rawData = isObj(task.raw_data) ? (task.raw_data as Record<string, unknown>) : null;
    const src = jiraIssue ?? rawData;

    // Extract assignee (can be string, or object with displayName/name)
    const assigneeRaw = extractJiraField(src, 'assignee');
    const assignee = typeof assigneeRaw === 'string'
      ? assigneeRaw
      : (isObj(assigneeRaw) ? ((assigneeRaw.displayName as string) ?? (assigneeRaw.name as string) ?? '') : '');

    return {
      status: extractJiraString(src, 'status') || metadata.status || task.status || 'Unknown',
      priority: extractJiraString(src, 'priority') || metadata.priority || priorityLabel(task.priority),
      assignee: assignee || metadata.assignee || 'Unassigned',
      dueDate: extractJiraDate(src, 'duedate', 'due_date') || (task.due_date?.split('T')[0] ?? ''),
      agentNextUpdate: extractJiraDate(src, 'Agent Next Update', 'agent_next_update', 'customfield_10060', 'customfield_10061', 'customfield_10062', 'customfield_10063', 'customfield_10064', 'customfield_10065'),
      agentLastUpdated: extractJiraString(src, 'Last Agent Public Comment', 'agent_last_updated', 'customfield_10058', 'customfield_10059', 'customfield_10060', 'customfield_10061') ||
        extractJiraDate(src, 'Last Agent Public Comment', 'agent_last_updated', 'customfield_10058', 'customfield_10059'),
      summary: extractJiraString(src, 'summary') || task.title,
      description: extractJiraString(src, 'description') || '',
    };
  }, [isJira, jiraIssue, task.raw_data, task.title, task.due_date, task.status, task.priority, metadata]);

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
      // Only set jiraIssue if the response is actually a JSON object (not markdown text)
      if (issueJson?.ok && isObj(issueJson.data)) {
        setJiraIssue(issueJson.data as Record<string, unknown>);
        // Extract comments from issue data
        const issueData = issueJson.data as Record<string, unknown>;
        const rawComments: JiraComment[] =
          (issueData.comments as JiraComment[]) ??
          ((issueData.fields as Record<string, unknown>)?.comment as { comments?: JiraComment[] })?.comments ??
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

  // Sync editable fields when task or jira data changes
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? '');
    setDueDate(task.due_date?.split('T')[0] ?? '');
    setStatus(task.status);
    setError(null);
    setSuccess(null);
  }, [task.id, task.title, task.description, task.due_date, task.status]);

  // Sync Jira-specific editable fields
  useEffect(() => {
    if (!jiraFields) return;
    setPriority(jiraFields.priority);
    setDueDate(jiraFields.dueDate || task.due_date?.split('T')[0] || '');
    setAgentNextUpdate(jiraFields.agentNextUpdate);
  }, [jiraFields, task.due_date]);

  const canUpdateJira = jiraTools.some(t => t.includes('update_issue') || t.includes('update'));
  const canCommentJira = jiraTools.some(t => t.includes('add_comment') || t.includes('create_comment'));
  const canTransitionJira = jiraTools.some(t => t.includes('transition_issue') || t.includes('do_transition'));
  const allowedTransitions = jiraTransitions.filter(t => t.name && findAllowedTransition(t.name));

  const handleTransitionClick = (t: JiraTransition) => {
    const config = t.name ? findAllowedTransition(t.name) : null;
    if (!config) return;
    if (config.commentRequired && config.commentTypes) {
      setTransitionComment('');
      setTransitionCommentType(config.commentTypes[0]);
      setTransitionModal({ transition: t, commentTypes: config.commentTypes });
    } else {
      // Immediate transition (e.g. Work in Progress) — set and auto-save
      setTransition(String(t.id ?? t.name ?? ''));
      setTimeout(() => {
        document.getElementById('jira-save-btn')?.click();
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
    setTimeout(() => {
      document.getElementById('jira-save-btn')?.click();
    }, 50);
  };

  // ---- Assignee search ----

  const handleAssigneeSearch = (query: string) => {
    setAssigneeSearch(query);
    setShowAssigneeDropdown(true);
    if (assigneeTimerRef.current) clearTimeout(assigneeTimerRef.current);
    if (!query.trim() || query.length < 2) {
      setAssigneeResults([]);
      return;
    }
    assigneeTimerRef.current = setTimeout(async () => {
      setAssigneeSearching(true);
      try {
        const res = await fetch(`/api/jira/users/search?query=${encodeURIComponent(query)}`);
        const json = await res.json();
        if (json.ok) {
          const data = json.data;
          // Jira user search can return different formats
          const users = Array.isArray(data) ? data : data?.users ?? data?.values ?? [];
          setAssigneeResults(users.map((u: Record<string, unknown>) => ({
            accountId: (u.accountId ?? u.account_id ?? u.key ?? '') as string,
            displayName: (u.displayName ?? u.display_name ?? u.name ?? '') as string,
            emailAddress: (u.emailAddress ?? u.email ?? '') as string,
          })).filter((u: { accountId: string }) => u.accountId));
        }
      } catch {
        // silent
      } finally {
        setAssigneeSearching(false);
      }
    }, 300);
  };

  const handleAssigneeSelect = (user: { accountId: string; displayName: string }) => {
    setSelectedAssignee(user);
    setAssigneeSearch(user.displayName);
    setShowAssigneeDropdown(false);
  };

  // Reset assignee state on task change
  useEffect(() => {
    setSelectedAssignee(null);
    setAssigneeSearch('');
    setShowAssigneeDropdown(false);
  }, [task.id]);

  // ---- Save handlers ----

  const handleSaveJira = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');

    try {
      const fieldsPayload: Record<string, unknown> = {};
      if (jiraFields && priority !== jiraFields.priority) fieldsPayload.priority = { name: priority };
      if (jiraFields && dueDate !== jiraFields.dueDate) fieldsPayload.duedate = dueDate || null;
      if (jiraFields && agentNextUpdate !== jiraFields.agentNextUpdate) {
        fieldsPayload['Agent Next Update'] = agentNextUpdate || null;
      }
      if (selectedAssignee) {
        fieldsPayload.assignee = { accountId: selectedAssignee.accountId };
      }

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
      if (!json.ok) throw new Error(json.error ?? 'Update failed');
      setSuccess('Saved to Jira');
      setComment('');
      setTransition('');

      // Refresh issue data + comments
      const refresh = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`);
      const refreshJson = await refresh.json();
      if (refreshJson.ok && isObj(refreshJson.data)) {
        setJiraIssue(refreshJson.data as Record<string, unknown>);
        const d = refreshJson.data as Record<string, unknown>;
        setJiraComments(
          (d.comments as JiraComment[]) ??
          ((d.fields as Record<string, unknown>)?.comment as { comments?: JiraComment[] })?.comments ??
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

  const handleSaveO365 = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (task.source === 'planner') {
        const body: Record<string, unknown> = {};
        if (title !== task.title) body.title = title;
        if (dueDate !== (task.due_date?.split('T')[0] ?? '')) {
          body.dueDateTime = dueDate ? `${dueDate}T00:00:00Z` : null;
        }
        if (status !== task.status) {
          if (status === 'done') body.percentComplete = 100;
          else if (status === 'in_progress') body.percentComplete = 50;
          else body.percentComplete = 0;
        }
        if (Object.keys(body).length === 0) { setSaving(false); return; }

        const res = await fetch(`/api/o365/planner/tasks/${encodeURIComponent(task.source_id ?? '')}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'Update failed');
        setSuccess('Saved to Planner');
      } else if (task.source === 'todo') {
        const body: Record<string, unknown> = {};
        if (title !== task.title) body.title = title;
        if (dueDate !== (task.due_date?.split('T')[0] ?? '')) {
          body.dueDateTime = dueDate ? { dateTime: `${dueDate}T00:00:00`, timeZone: 'UTC' } : null;
        }
        if (status !== task.status) {
          if (status === 'done') body.status = 'completed';
          else if (status === 'in_progress') body.status = 'inProgress';
          else body.status = 'notStarted';
        }
        if (Object.keys(body).length === 0) { setSaving(false); return; }

        const res = await fetch(`/api/o365/todo/tasks/${encodeURIComponent(task.source_id ?? '')}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? 'Update failed');
        setSuccess('Saved to To-Do');
      }

      onTaskUpdated?.();
      setTimeout(() => setSuccess(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = isJira ? handleSaveJira : handleSaveO365;
  // Init calendar fields from task data
  useEffect(() => {
    if (!isCalendar) return;
    const raw = task.raw_data as Record<string, unknown> | null;
    setCalSubject(task.title || '');
    // Extract start/end from raw_data (ISO datetime strings)
    const startDt = raw?.start as { dateTime?: string } | string | undefined;
    const endDt = raw?.end as { dateTime?: string } | string | undefined;
    const startStr = typeof startDt === 'string' ? startDt : startDt?.dateTime ?? '';
    const endStr = typeof endDt === 'string' ? endDt : endDt?.dateTime ?? '';
    setCalStart(startStr ? startStr.slice(0, 16) : ''); // datetime-local format
    setCalEnd(endStr ? endStr.slice(0, 16) : '');
    const loc = raw?.location as { displayName?: string } | string | undefined;
    setCalLocation(typeof loc === 'string' ? loc : loc?.displayName ?? '');
  }, [isCalendar, task.title, task.raw_data]);

  // Calendar event save
  const handleCalendarSave = async () => {
    if (!calSubject.trim() || !calStart || !calEnd) return;
    setCalSaving(true);
    setError(null);
    try {
      const eventId = task.source_id;
      const args = {
        subject: calSubject,
        start: calStart,
        end: calEnd,
        location: calLocation || undefined,
      };

      if (eventId) {
        await fetch(`/api/o365/calendar/events/${encodeURIComponent(eventId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        setSuccess('Calendar event updated');
      } else {
        await fetch('/api/o365/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        setSuccess('Calendar event created');
      }
      setCalEditing(false);
      onTaskUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save event');
    } finally {
      setCalSaving(false);
    }
  };

  // Email reply/forward handler
  const handleEmailAction = async () => {
    if (!emailMode || !emailBody.trim()) return;
    setEmailSending(true);
    setError(null);

    const rawData = task.raw_data as Record<string, unknown> | null;
    const from = rawData?.from as { emailAddress?: { address?: string; name?: string } } | undefined;
    const originalFrom = from?.emailAddress?.address ?? from?.emailAddress?.name ?? '';

    try {
      if (emailMode === 'reply') {
        await fetch(`/api/o365/mail/${encodeURIComponent(task.source_id ?? '')}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: emailBody,
            replyTo: originalFrom,
            originalSubject: task.title,
            originalBody: task.description,
          }),
        });
        setSuccess('Reply sent');
      } else {
        if (!emailTo.trim()) { setError('Recipient is required'); setEmailSending(false); return; }
        await fetch(`/api/o365/mail/${encodeURIComponent(task.source_id ?? '')}/forward`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: emailTo,
            body: emailBody,
            originalSubject: task.title,
            originalBody: task.description,
            originalFrom,
          }),
        });
        setSuccess('Email forwarded');
      }
      setEmailMode(null);
      setEmailBody('');
      setEmailTo('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setEmailSending(false);
    }
  };

  const canSave = isJira || canEditO365;

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

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-[#1f242b] border-l border-[#3a424d] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#3a424d] flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${source.bg} ${source.text}`}>
                {source.label}
              </span>
              {task.source_id && (
                <span className="text-[10px] text-neutral-500 font-mono">{task.source_id}</span>
              )}
            </div>
            <div className="text-sm text-neutral-100 font-semibold truncate">
              {task.title}
            </div>
          </div>
          {task.source_url && (
            <a
              href={task.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-[#5ec1ca] transition-colors shrink-0"
            >
              Open
            </a>
          )}
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-[#2f353d] text-neutral-300 hover:text-neutral-100 transition-colors shrink-0"
          >
            Close
          </button>
        </div>

        {/* Navigation */}
        <div className="px-5 py-3 border-b border-[#3a424d] flex items-center gap-2 text-xs text-neutral-400">
          <button onClick={onPrev} disabled={index === 0} className="px-2 py-1 rounded bg-[#2f353d] disabled:opacity-40">
            Prev
          </button>
          <button onClick={onNext} disabled={index >= total - 1} className="px-2 py-1 rounded bg-[#2f353d] disabled:opacity-40">
            Next
          </button>
          <span className="ml-auto">{index + 1} of {total}</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {jiraLoading && <div className="text-sm text-neutral-400">Loading issue data...</div>}
          {error && (
            <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">{error}</div>
          )}
          {success && (
            <div className="p-2 bg-green-950/50 border border-green-900 rounded text-green-400 text-xs">{success}</div>
          )}

          {/* ---- JIRA LAYOUT ---- */}
          {isJira && (
            <>
              <div className="grid grid-cols-2 gap-3 text-xs text-neutral-400">
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Status</div>
                  <div className="text-neutral-200">{jiraFields?.status || metadata.status || task.status || 'Unknown'}</div>
                </div>
                <div className="relative">
                  <div className="text-[10px] uppercase tracking-widest mb-1">Assignee</div>
                  <input
                    type="text"
                    value={assigneeSearch || (selectedAssignee ? selectedAssignee.displayName : (jiraFields?.assignee || metadata.assignee || 'Unassigned'))}
                    onChange={(e) => handleAssigneeSearch(e.target.value)}
                    onFocus={() => { if (assigneeResults.length > 0) setShowAssigneeDropdown(true); }}
                    onBlur={() => setTimeout(() => setShowAssigneeDropdown(false), 200)}
                    placeholder="Search users..."
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs focus:border-[#5ec1ca] focus:outline-none"
                  />
                  {assigneeSearching && (
                    <div className="absolute right-2 top-[22px] text-[10px] text-neutral-500">...</div>
                  )}
                  {showAssigneeDropdown && assigneeResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-[#2f353d] border border-[#3a424d] rounded shadow-lg max-h-40 overflow-auto">
                      {assigneeResults.map((u) => (
                        <button
                          key={u.accountId}
                          onMouseDown={() => handleAssigneeSelect(u)}
                          className="w-full text-left px-3 py-1.5 text-xs text-neutral-200 hover:bg-[#363d47] transition-colors"
                        >
                          <span className="font-medium">{u.displayName}</span>
                          {u.emailAddress && (
                            <span className="text-neutral-500 ml-1.5">{u.emailAddress}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedAssignee && (
                    <div className="mt-1 text-[10px] text-[#5ec1ca]">
                      Will reassign to: {selectedAssignee.displayName}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Priority</div>
                  <select
                    value={priority || jiraFields?.priority || metadata.priority || priorityLabel(task.priority)}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs"
                  >
                    {JIRA_PRIORITIES.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                    {priority && !JIRA_PRIORITIES.includes(priority) && (
                      <option value={priority}>{priority}</option>
                    )}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Due Date</div>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs"
                  />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Agent Last Updated</div>
                  <div className="text-neutral-200">
                    {jiraFields?.agentLastUpdated ? formatDate(jiraFields.agentLastUpdated) : 'None'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Agent Next Update</div>
                  <input
                    type="date"
                    value={agentNextUpdate}
                    onChange={(e) => setAgentNextUpdate(e.target.value)}
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs"
                  />
                </div>
              </div>

              {/* Title (read-only for Jira — edit in Jira) */}
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Summary</div>
                <div className="text-sm text-neutral-200">{jiraFields?.summary || task.title}</div>
              </div>

              {/* Description */}
              {(jiraFields?.description || task.description) && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Description</div>
                  <div className="text-sm text-neutral-300 whitespace-pre-wrap bg-[#2f353d] rounded px-3 py-2 border border-[#3a424d] max-h-48 overflow-auto">
                    {jiraFields?.description || task.description}
                  </div>
                </div>
              )}

              {/* Transition buttons */}
              {canTransitionJira && allowedTransitions.length > 0 && (
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
              {jiraComments.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-2 text-neutral-400">
                    Comments ({jiraComments.length})
                  </div>
                  <div className="space-y-2 max-h-60 overflow-auto">
                    {[...jiraComments].reverse().map((c) => (
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

              {/* Add comment */}
              {canCommentJira && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Add Comment</div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                    placeholder="Add a comment..."
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-3 py-2 border border-[#3a424d] text-sm resize-none placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none"
                  />
                </div>
              )}
            </>
          )}

          {/* ---- NON-JIRA LAYOUT ---- */}
          {!isJira && (
            <>
              <div className="grid grid-cols-2 gap-3 text-xs text-neutral-400">
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Status</div>
                  {canEditO365 ? (
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Done</option>
                    </select>
                  ) : (
                    <div className="text-neutral-200 capitalize">{task.status?.replace('_', ' ') || 'Unknown'}</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Priority</div>
                  <div className="text-neutral-200">{priorityLabel(task.priority)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Due Date</div>
                  {canEditO365 ? (
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs"
                    />
                  ) : (
                    <div className="text-neutral-200">{task.due_date ? formatDate(task.due_date) : 'None'}</div>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1">Category</div>
                  <div className="text-neutral-200 capitalize">{task.category ?? 'None'}</div>
                </div>
                {metadata.assignee && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest mb-1">Assignee</div>
                    <div className="text-neutral-200">{metadata.assignee}</div>
                  </div>
                )}
                {metadata.created && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest mb-1">Created</div>
                    <div className="text-neutral-200">{metadata.created}</div>
                  </div>
                )}
              </div>

              {/* Title */}
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Title</div>
                {canEditO365 ? (
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] text-sm"
                  />
                ) : (
                  <div className="text-sm text-neutral-200">{task.title}</div>
                )}
              </div>

              {/* Description */}
              <div>
                <div className="text-[10px] uppercase tracking-widest mb-1 text-neutral-400">Description</div>
                {canEditO365 ? (
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={5}
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] text-sm resize-none"
                  />
                ) : (
                  <div className="text-sm text-neutral-300 whitespace-pre-wrap bg-[#2f353d] rounded px-3 py-2 border border-[#3a424d] max-h-48 overflow-auto">
                    {task.description || 'No description'}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Calendar edit */}
          {isCalendar && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-neutral-400">Calendar Event</div>
                <button
                  onClick={() => setCalEditing(!calEditing)}
                  className="text-[10px] text-[#5ec1ca] hover:text-[#4db0b9]"
                >
                  {calEditing ? 'Cancel' : 'Edit'}
                </button>
              </div>
              {calEditing ? (
                <div className="border border-[#3a424d] rounded bg-[#272C33] p-3 space-y-2">
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Subject</label>
                    <input
                      value={calSubject} onChange={(e) => setCalSubject(e.target.value)}
                      className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs focus:border-[#5ec1ca] focus:outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Start</label>
                      <input type="datetime-local" value={calStart} onChange={(e) => setCalStart(e.target.value)}
                        className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs focus:border-[#5ec1ca] focus:outline-none" />
                    </div>
                    <div>
                      <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">End</label>
                      <input type="datetime-local" value={calEnd} onChange={(e) => setCalEnd(e.target.value)}
                        className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs focus:border-[#5ec1ca] focus:outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1 block">Location</label>
                    <input value={calLocation} onChange={(e) => setCalLocation(e.target.value)} placeholder="Meeting room or link"
                      className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs focus:border-[#5ec1ca] focus:outline-none" />
                  </div>
                  <button
                    onClick={handleCalendarSave}
                    disabled={calSaving || !calSubject.trim() || !calStart || !calEnd}
                    className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
                  >
                    {calSaving ? 'Saving...' : 'Save Event'}
                  </button>
                </div>
              ) : (
                <div className="text-xs text-neutral-400 space-y-1">
                  {calStart && <div>Start: <span className="text-neutral-200">{new Date(calStart).toLocaleString('en-GB')}</span></div>}
                  {calEnd && <div>End: <span className="text-neutral-200">{new Date(calEnd).toLocaleString('en-GB')}</span></div>}
                  {calLocation && <div>Location: <span className="text-neutral-200">{calLocation}</span></div>}
                </div>
              )}
            </div>
          )}

          {/* Email actions */}
          {isEmail && (
            <div>
              <div className="text-[10px] uppercase tracking-widest mb-2 text-neutral-400">Email Actions</div>
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  onClick={() => { setEmailMode('reply'); setEmailTo(''); setEmailBody(''); }}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    emailMode === 'reply'
                      ? 'bg-[#5ec1ca]/20 border-[#5ec1ca]/40 text-[#5ec1ca]'
                      : 'bg-[#2f353d] border-[#3a424d] text-neutral-300 hover:bg-[#363d47]'
                  }`}
                >
                  Reply
                </button>
                <button
                  onClick={() => { setEmailMode('forward'); setEmailTo(''); setEmailBody(''); }}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    emailMode === 'forward'
                      ? 'bg-[#5ec1ca]/20 border-[#5ec1ca]/40 text-[#5ec1ca]'
                      : 'bg-[#2f353d] border-[#3a424d] text-neutral-300 hover:bg-[#363d47]'
                  }`}
                >
                  Forward
                </button>
              </div>

              {emailMode && (
                <div className="border border-[#3a424d] rounded bg-[#272C33] p-3 space-y-2">
                  {emailMode === 'forward' && (
                    <input
                      type="email"
                      value={emailTo}
                      onChange={(e) => setEmailTo(e.target.value)}
                      placeholder="Recipient email address"
                      className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-1.5 border border-[#3a424d] text-xs focus:border-[#5ec1ca] focus:outline-none"
                    />
                  )}
                  <textarea
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    rows={4}
                    placeholder={emailMode === 'reply' ? 'Type your reply...' : 'Add a message (optional)...'}
                    className="w-full bg-[#2f353d] text-neutral-200 rounded px-2 py-2 border border-[#3a424d] text-xs resize-none focus:border-[#5ec1ca] focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleEmailAction}
                      disabled={emailSending || !emailBody.trim()}
                      className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
                    >
                      {emailSending ? 'Sending...' : emailMode === 'reply' ? 'Send Reply' : 'Forward'}
                    </button>
                    <button
                      onClick={() => setEmailMode(null)}
                      className="px-3 py-1.5 text-xs rounded bg-[#363d47] text-neutral-400 hover:bg-[#3a424d] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div>
            <div className="text-[10px] uppercase tracking-widest mb-2 text-neutral-400">Quick Actions</div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => handleLocalAction(task.is_pinned ? 'unpin' : 'pin')}
                className="px-3 py-1.5 text-xs rounded bg-[#2f353d] border border-[#3a424d] text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
              >
                {task.is_pinned ? 'Unfocus' : 'Focus'}
              </button>
              <button
                onClick={() => handleLocalAction('done')}
                className="px-3 py-1.5 text-xs rounded bg-green-900/30 border border-green-800/50 text-green-400 hover:bg-green-900/50 transition-colors"
              >
                Mark Done
              </button>
              <button
                onClick={() => handleLocalAction('dismiss')}
                className="px-3 py-1.5 text-xs rounded bg-[#2f353d] border border-[#3a424d] text-neutral-400 hover:text-red-400 hover:border-red-900 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>

          {/* Raw data (collapsed) */}
          <RawDataSection rawData={task.raw_data} />
        </div>

        {/* Footer — save button */}
        {canSave && (
          <div className="px-5 py-4 border-t border-[#3a424d] flex items-center gap-3">
            <button
              id="jira-save-btn"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-[#5ec1ca] text-[#272C33] rounded font-semibold disabled:opacity-50 hover:bg-[#4db0b9] transition-colors"
            >
              {saving ? 'Saving...' : 'Save & Sync'}
            </button>
            <span className="text-xs text-neutral-500">
              Changes sync back to {source.label}
            </span>
          </div>
        )}
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
