import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskDrawer } from './TaskDrawer.js';
import {
  getDateGroup,
  getTier,
  DATE_GROUP_ORDER,
  DATE_GROUP_LABELS,
  DATE_GROUP_COLORS,
  type DateGroup,
} from '../utils/taskHelpers.js';

interface Props {
  tasks: Task[];
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
  onRefresh?: () => void;
}

type GroupBy = 'status' | 'date';

// ── Fixed Kanban columns with Jira status mapping ──

interface FixedColumn {
  key: string;
  label: string;
  jiraStatuses: string[];       // original Jira status names (case-insensitive match)
  normalizedStatuses: string[]; // fallback match against task.status
  color: string;
}

const FIXED_COLUMNS: FixedColumn[] = [
  {
    key: 'open',
    label: 'Open',
    jiraStatuses: ['open', 'to do', 'new', 'backlog', 'reopened'],
    normalizedStatuses: ['open'],
    color: '#3b82f6',
  },
  {
    key: 'wip',
    label: 'Work In Progress',
    jiraStatuses: ['in progress', 'in development', 'in review', 'code review'],
    normalizedStatuses: ['in_progress'],
    color: '#f59e0b',
  },
  {
    key: 'waiting-agent',
    label: 'Waiting on Agent',
    jiraStatuses: ['waiting for support', 'waiting on agent', 'pending'],
    normalizedStatuses: [],
    color: '#f97316',
  },
  {
    key: 'waiting-requestor',
    label: 'Waiting on Requestor',
    jiraStatuses: ['waiting for customer', 'waiting on requestor', 'awaiting customer'],
    normalizedStatuses: [],
    color: '#ef4444',
  },
  {
    key: 'waiting-partner',
    label: 'Waiting on Partner',
    jiraStatuses: ['waiting on partner', 'escalated', 'with third party'],
    normalizedStatuses: [],
    color: '#8b5cf6',
  },
];

const DONE_STATUSES = new Set(['done', 'closed', 'resolved', 'cancelled']);

// Build a lookup map for fast column assignment
const STATUS_TO_COLUMN = new Map<string, string>();
for (const col of FIXED_COLUMNS) {
  for (const s of col.jiraStatuses) STATUS_TO_COLUMN.set(s, col.key);
}
const NORMALIZED_TO_COLUMN = new Map<string, string>();
for (const col of FIXED_COLUMNS) {
  for (const s of col.normalizedStatuses) NORMALIZED_TO_COLUMN.set(s, col.key);
}

function getOriginalJiraStatus(task: Task): string {
  // Try raw_data.status.name (structured Jira response)
  if (task.raw_data && typeof task.raw_data === 'object') {
    const rd = task.raw_data as Record<string, unknown>;
    const statusObj = rd.status;
    if (typeof statusObj === 'string') return statusObj;
    if (statusObj && typeof statusObj === 'object') {
      const name = (statusObj as Record<string, unknown>).name;
      if (typeof name === 'string') return name;
    }
  }
  // Fallback: extract from description "Status: ..." line
  if (task.description) {
    const match = task.description.match(/^Status:\s*(.+)/m);
    if (match) return match[1].trim();
  }
  // Last resort: normalized status
  return task.status;
}

function getFixedColumnKey(task: Task): string | null {
  const originalStatus = getOriginalJiraStatus(task);
  const lower = originalStatus.toLowerCase();

  if (DONE_STATUSES.has(lower)) return null;

  // 1. Exact match by original Jira status
  const colKey = STATUS_TO_COLUMN.get(lower);
  if (colKey) return colKey;

  // 2. Fuzzy match — check if status contains key words from column statuses
  if (lower.includes('progress') || lower.includes('review') || lower.includes('development'))
    return 'wip';
  if ((lower.includes('waiting') || lower.includes('pending')) && (lower.includes('agent') || lower.includes('support')))
    return 'waiting-agent';
  if ((lower.includes('waiting') || lower.includes('pending')) && (lower.includes('customer') || lower.includes('requestor')))
    return 'waiting-requestor';
  if ((lower.includes('waiting') || lower.includes('escalat')) && (lower.includes('partner') || lower.includes('third')))
    return 'waiting-partner';

  // 3. Fallback: match by normalized status
  const normKey = NORMALIZED_TO_COLUMN.get(task.status);
  if (normKey) return normKey;

  // Default to 'open'
  return 'open';
}

function getColumnColor(key: string): string {
  return FIXED_COLUMNS.find((c) => c.key === key)?.color ?? '#6b7280';
}

// ── Transition modal state ──

interface PendingTransition {
  task: Task;
  targetColumn: FixedColumn;
  issueKey: string;
}

interface JiraTransition {
  id: string;
  name: string;
  to?: { name?: string; statusCategory?: { name?: string } };
}

export function ServiceDeskKanban({ tasks, onUpdateTask, onRefresh }: Props) {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);

  // Optimistic moves: taskId → target column key (survives until Jira index catches up)
  const [optimisticMoves, setOptimisticMoves] = useState<Map<string, string>>(new Map());

  // Tasks are pre-filtered to Jira by parent component
  const jiraTasks = tasks;

  // Status-based columns (fixed 5 columns, always shown)
  const statusColumns = useMemo(() => {
    const columnMap = new Map<string, Task[]>();
    for (const col of FIXED_COLUMNS) columnMap.set(col.key, []);

    for (const task of jiraTasks) {
      // Use optimistic column if set, otherwise derive from Jira status
      const colKey = optimisticMoves.get(task.id) ?? getFixedColumnKey(task);
      if (colKey && columnMap.has(colKey)) {
        columnMap.get(colKey)!.push(task);
      }
    }

    // Sort tasks within each column by priority DESC, then due_date ASC
    for (const [, colTasks] of columnMap) {
      colTasks.sort((a, b) => {
        const pa = a.priority ?? 50;
        const pb = b.priority ?? 50;
        if (pa !== pb) return pb - pa;
        if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return 0;
      });
    }

    return FIXED_COLUMNS.map((col) => [col.key, columnMap.get(col.key)!] as [string, Task[]]);
  }, [jiraTasks, optimisticMoves]);

  // Date-based columns
  const dateColumns = useMemo(() => {
    const groups = new Map<DateGroup, Task[]>();
    for (const g of DATE_GROUP_ORDER) groups.set(g, []);
    for (const task of jiraTasks) {
      const group = getDateGroup(task);
      groups.get(group)!.push(task);
    }
    for (const [, groupTasks] of groups) {
      groupTasks.sort((a, b) => {
        if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return (b.priority ?? 50) - (a.priority ?? 50);
      });
    }
    return [...groups.entries()].filter(([, t]) => t.length > 0);
  }, [jiraTasks]);

  // ── Drag & drop handlers ──

  const handleDragStart = useCallback((e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverKey(key);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverKey(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetColumnKey: string) => {
    e.preventDefault();
    setDragOverKey(null);

    // Only support DnD in status mode
    if (groupBy !== 'status') return;

    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    const task = jiraTasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentColumn = getFixedColumnKey(task);
    if (currentColumn === targetColumnKey) return; // same column

    const targetCol = FIXED_COLUMNS.find((c) => c.key === targetColumnKey);
    if (!targetCol) return;

    const issueKey = task.source_id ?? task.id.replace(/^jira:/, '');

    setPendingTransition({ task, targetColumn: targetCol, issueKey });
  }, [jiraTasks, groupBy]);

  if (jiraTasks.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-neutral-500">
        No Jira tickets found. Sync Jira from Settings to populate the board.
      </div>
    );
  }

  const columns = groupBy === 'status' ? statusColumns : dateColumns;
  const isStatusMode = groupBy === 'status';

  return (
    <div className="space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
          Service Desk — Kanban
        </h2>
        <div className="flex items-center gap-3">
          {/* Group-by toggle */}
          <div className="flex items-center bg-[#2f353d] rounded border border-[#3a424d]">
            <button
              onClick={() => setGroupBy('status')}
              className={`px-3 py-1.5 text-[11px] transition-colors rounded-l ${
                groupBy === 'status'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              By Status
            </button>
            <button
              onClick={() => setGroupBy('date')}
              className={`px-3 py-1.5 text-[11px] transition-colors rounded-r ${
                groupBy === 'date'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              By Date
            </button>
          </div>
          <span className="text-xs text-neutral-500">{jiraTasks.length} ticket{jiraTasks.length !== 1 ? 's' : ''}</span>
          {isStatusMode && (
            <span className="text-[10px] text-neutral-600">Drag to transition</span>
          )}
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 200px)' }}>
        {columns.map(([key, columnTasks]) => {
          const isDateMode = groupBy === 'date';
          const fixedCol = FIXED_COLUMNS.find((c) => c.key === key);
          const label = isDateMode ? DATE_GROUP_LABELS[key as DateGroup] : (fixedCol?.label ?? key);
          const color = isDateMode ? DATE_GROUP_COLORS[key as DateGroup] : (fixedCol?.color ?? '#6b7280');
          const isDragTarget = dragOverKey === key;

          return (
            <div
              key={key}
              className={`flex-shrink-0 w-72 bg-[#2f353d] border rounded-lg flex flex-col transition-colors ${
                isDragTarget && isStatusMode
                  ? 'border-[#5ec1ca] bg-[#5ec1ca]/5'
                  : 'border-[#3a424d]'
              }`}
              onDragOver={isStatusMode ? (e) => handleDragOver(e, key) : undefined}
              onDragLeave={isStatusMode ? handleDragLeave : undefined}
              onDrop={isStatusMode ? (e) => handleDrop(e, key) : undefined}
            >
              {/* Column header */}
              <div className="px-3 py-2.5 border-b border-[#3a424d] flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-xs font-semibold text-neutral-200 uppercase tracking-wider truncate">
                  {label}
                </span>
                <span className="ml-auto text-[10px] text-neutral-500 bg-[#272C33] px-1.5 py-0.5 rounded">
                  {columnTasks.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {columnTasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    onClick={() => setSelectedTask(task)}
                    showStatus={isDateMode}
                    draggable={isStatusMode}
                    onDragStart={isStatusMode ? (e) => handleDragStart(e, task.id) : undefined}
                  />
                ))}
                {columnTasks.length === 0 && (
                  <div className="text-[10px] text-neutral-600 italic text-center py-4">
                    No tickets
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask && (
        <TaskDrawer
          task={selectedTask}
          index={0}
          total={1}
          onClose={() => setSelectedTask(null)}
          onPrev={() => {}}
          onNext={() => {}}
          onTaskUpdated={() => onUpdateTask(selectedTask.id, {})}
        />
      )}

      {pendingTransition && (
        <TransitionModal
          pending={pendingTransition}
          onConfirm={() => {
            const { task, targetColumn } = pendingTransition;
            setPendingTransition(null);

            // Optimistic: move card to target column immediately
            setOptimisticMoves(prev => {
              const next = new Map(prev);
              next.set(task.id, targetColumn.key);
              return next;
            });

            // Delay refresh to let Jira's search index catch up (5s)
            setTimeout(() => {
              onRefresh?.();
              // Clear optimistic override 3s after refresh arrives
              setTimeout(() => {
                setOptimisticMoves(prev => {
                  const next = new Map(prev);
                  next.delete(task.id);
                  return next;
                });
              }, 3000);
            }, 5000);
          }}
          onCancel={() => setPendingTransition(null)}
        />
      )}
    </div>
  );
}

// ── Kanban Card ──

function KanbanCard({
  task, onClick, showStatus, draggable, onDragStart,
}: {
  task: Task;
  onClick: () => void;
  showStatus?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const priority = task.priority ?? 50;
  const isOverdue = task.due_date && new Date(task.due_date) < new Date();
  const isSlaBreached = task.sla_breach_at && new Date(task.sla_breach_at) < new Date();
  const originalStatus = getOriginalJiraStatus(task);

  // Extract assignee and tier from raw_data
  const rd = (task.raw_data && typeof task.raw_data === 'object') ? task.raw_data as Record<string, unknown> : null;
  const assigneeRaw = rd?.assignee;
  const assignee = typeof assigneeRaw === 'string' ? assigneeRaw
    : (assigneeRaw as any)?.displayName ?? (assigneeRaw as any)?.name ?? null;
  const tier = getTier(task);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      className={`w-full text-left bg-[#272C33] border border-[#3a424d] rounded-md p-3 hover:border-[#5ec1ca]/50 transition-colors ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      }`}
    >
      {/* Source ID */}
      {task.source_id && (
        <div className="text-[10px] text-[#5ec1ca] font-mono mb-1">{task.source_id}</div>
      )}

      {/* Title */}
      <div className="text-xs text-neutral-200 font-medium line-clamp-2 mb-2">
        {task.title}
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Priority indicator */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
          priority >= 80 ? 'bg-red-900/40 text-red-400' :
          priority >= 60 ? 'bg-amber-900/40 text-amber-400' :
          'bg-[#363d47] text-neutral-500'
        }`}>
          P{priority >= 80 ? '1' : priority >= 60 ? '2' : priority >= 40 ? '3' : '4'}
        </span>

        {/* Original Jira status badge */}
        {originalStatus && originalStatus !== task.status && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-[#363d47] text-neutral-400 truncate max-w-[120px]"
            title={originalStatus}
          >
            {originalStatus}
          </span>
        )}

        {/* Status badge (shown in date mode) */}
        {showStatus && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: getColumnColor(getFixedColumnKey(task) ?? 'open') + '30', color: getColumnColor(getFixedColumnKey(task) ?? 'open') }}
          >
            {originalStatus || task.status}
          </span>
        )}

        {/* Tier badge */}
        {tier && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 truncate max-w-[100px]" title={tier}>
            {tier}
          </span>
        )}

        {/* Due date */}
        {task.due_date && (
          <span className={`text-[10px] ${isOverdue ? 'text-red-400' : 'text-neutral-500'}`}>
            Due: {new Date(task.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </span>
        )}

        {/* SLA breach indicator */}
        {isSlaBreached && (
          <span className="text-[10px] text-red-400 font-semibold">SLA</span>
        )}
      </div>

      {/* Assignee */}
      {assignee && (
        <div className="text-[10px] text-neutral-500 mt-1.5 truncate" title={assignee}>
          {assignee}
        </div>
      )}
    </div>
  );
}

// ── Transition field helpers ──

/** Read a field from raw Jira issue data, checking both flat and nested (fields.*) shapes. */
function getJiraField(raw: unknown, key: string): unknown {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  let val = obj[key];
  if (val === undefined) {
    const fields = obj.fields as Record<string, unknown> | undefined;
    val = fields?.[key];
  }
  return val ?? undefined;
}

/** Extract displayable string from a Jira field.
 *  Recursively unwraps {value: X} wrappers (MCP Jira wraps custom fields this way)
 *  and option objects ({value: "...", id: "..."}). Never returns "[object Object]". */
function getJiraFieldDisplay(raw: unknown, key: string): string | null {
  let val: unknown = getJiraField(raw, key);
  if (!val) return null;

  // Recursively unwrap object wrappers
  while (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if (typeof obj.value === 'string') return obj.value;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.displayName === 'string') return obj.displayName;
    // Unwrap one level of {value: {...}} wrapper
    if (obj.value && typeof obj.value === 'object') { val = obj.value; continue; }
    return null; // unrecognised object shape — don't return "[object Object]"
  }

  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return null;
}

/** Required fields shown in the transition modal. */
const TRANSITION_FIELDS: Array<{
  key: string;
  label: string;
  inputType: 'text' | 'date' | 'textarea' | 'select';
}> = [
  { key: 'customfield_13183', label: 'Nurtur Product',        inputType: 'select' },
  { key: 'customfield_14527', label: 'Product Sub Category',  inputType: 'text' },
  { key: 'customfield_13184', label: 'TL;DR',                 inputType: 'textarea' },
  { key: 'duedate',           label: 'Due Date',              inputType: 'date' },
  { key: 'customfield_14185', label: 'Agent Next Update',     inputType: 'date' },
];

/** Build initial field values from raw issue data. */
function initFieldValues(raw: unknown): Record<string, string> {
  const vals: Record<string, string> = {};
  for (const f of TRANSITION_FIELDS) {
    vals[f.key] = getJiraFieldDisplay(raw, f.key) ?? '';
  }
  return vals;
}

/** Compute Jira-compatible field update payload (only changed fields). */
function buildFieldUpdates(
  raw: unknown,
  edited: Record<string, string>,
): Record<string, unknown> | null {
  const updates: Record<string, unknown> = {};
  let hasChanges = false;

  for (const f of TRANSITION_FIELDS) {
    const original = getJiraFieldDisplay(raw, f.key) ?? '';
    const current = edited[f.key]?.trim() ?? '';
    if (current === original) continue;
    hasChanges = true;
    // MCP update_issue expects all field values as plain strings
    updates[f.key] = current || null;
  }

  return hasChanges ? updates : null;
}

// ── Transition Modal ──

function TransitionModal({
  pending,
  onConfirm,
  onCancel,
}: {
  pending: PendingTransition;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [commentType, setCommentType] = useState<'internal' | 'public'>('internal');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    initFieldValues(pending.task.raw_data),
  );
  const [fieldOptions, setFieldOptions] = useState<Record<string, string[]>>({});

  const { issueKey, targetColumn, task } = pending;
  const currentStatus = getOriginalJiraStatus(task);

  // Count empty required fields
  const emptyFieldCount = TRANSITION_FIELDS.filter((f) => !fieldValues[f.key]?.trim()).length;
  const hasComment = !!comment.trim();
  const missingCount = emptyFieldCount + (hasComment ? 0 : 1);

  const updateField = useCallback((key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Fetch field options (for dropdowns) on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}/editmeta`);
        const json = await res.json();
        if (!active || !json.ok) return;
        const fields = json.data?.fields ?? json.data ?? {};
        const opts: Record<string, string[]> = {};
        for (const f of TRANSITION_FIELDS) {
          if (f.inputType !== 'select') continue;
          const meta = (fields as Record<string, unknown>)[f.key] as Record<string, unknown> | undefined;
          const allowed = meta?.allowedValues as Array<Record<string, unknown>> | undefined;
          if (allowed) {
            opts[f.key] = allowed.map((v) => (v.value as string) ?? (v.name as string) ?? String(v.id)).filter(Boolean);
          }
        }
        if (active) setFieldOptions(opts);
      } catch { /* non-critical — text input fallback */ }
    })();
    return () => { active = false; };
  }, [issueKey]);

  // Fetch available transitions on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}/transitions`);
        const json = await res.json();
        if (!active) return;
        if (!json.ok) { setError(json.error ?? 'Failed to fetch transitions'); setLoading(false); return; }

        // Parse transitions — could be in data.transitions or data directly
        let txns: JiraTransition[] = [];
        const data = json.data;
        if (Array.isArray(data)) {
          txns = data;
        } else if (data?.transitions && Array.isArray(data.transitions)) {
          txns = data.transitions;
        } else if (typeof data === 'string') {
          // MCP sometimes returns markdown — try to parse
          try { txns = JSON.parse(data).transitions ?? []; } catch { /* empty */ }
        }

        setTransitions(txns);

        // Auto-select the best matching transition for the target column.
        // Try multiple matching strategies: exact status match, column label match, word overlap.
        const targetStatuses = new Set(targetColumn.jiraStatuses);
        const targetLabel = targetColumn.label.toLowerCase();

        const scoreMatch = (txn: JiraTransition): number => {
          const toName = (txn.to?.name ?? '').toLowerCase();
          const txnName = (txn.name ?? '').toLowerCase();

          // Exact match on target status name → best
          if (toName && targetStatuses.has(toName)) return 100;
          if (txnName && targetStatuses.has(txnName)) return 90;

          // Match against column label (e.g. "Waiting on Agent")
          if (toName === targetLabel) return 85;
          if (txnName === targetLabel) return 80;

          // Partial/contains match (e.g. "waiting" in both)
          if (toName && targetLabel.includes(toName)) return 60;
          if (toName && toName.includes(targetLabel)) return 60;
          if (txnName && targetLabel.includes(txnName)) return 50;
          if (txnName && txnName.includes(targetLabel)) return 50;

          // Word overlap (e.g. "waiting" + "agent" overlap)
          const targetWords = new Set(targetLabel.split(/\s+/));
          const toWords = toName.split(/\s+/).filter(Boolean);
          const nameWords = txnName.split(/\s+/).filter(Boolean);
          const toOverlap = toWords.filter((w) => targetWords.has(w)).length;
          const nameOverlap = nameWords.filter((w) => targetWords.has(w)).length;
          const maxOverlap = Math.max(toOverlap, nameOverlap);
          if (maxOverlap >= 2) return 30 + maxOverlap * 5;

          return 0;
        };

        let bestScore = 0;
        let best: JiraTransition | null = null;
        for (const txn of txns) {
          const score = scoreMatch(txn);
          if (score > bestScore) { bestScore = score; best = txn; }
        }
        if (best) setSelectedTransition(best.id);

        setLoading(false);
      } catch (err) {
        if (active) { setError(err instanceof Error ? err.message : 'Failed to fetch transitions'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [issueKey, targetColumn]);

  useEffect(() => {
    if (!loading) textareaRef.current?.focus();
  }, [loading]);

  const handleConfirm = async () => {
    if (!selectedTransition) return;
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = { transition: selectedTransition };

      // Include changed field values
      const fieldUpdates = buildFieldUpdates(task.raw_data, fieldValues);
      if (fieldUpdates) body.fields = fieldUpdates;

      if (comment.trim()) {
        body.comment = comment.trim();
        body.commentVisibility = commentType;
      }

      const res = await fetch(`/api/jira/issues/${encodeURIComponent(issueKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Transition failed');

      onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transition issue');
      setSaving(false);
    }
  };

  const selectedTxn = transitions.find((t) => t.id === selectedTransition);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div
        className="bg-[#2f353d] border border-[#3a424d] rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#3a424d]">
          <h3 className="text-sm font-semibold text-neutral-100">Transition Ticket</h3>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Ticket info */}
          <div>
            <div className="text-xs text-[#5ec1ca] font-mono">{issueKey}</div>
            <div className="text-sm text-neutral-200 truncate">{task.title}</div>
          </div>

          {/* Status change indicator */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-neutral-400">{currentStatus}</span>
            <span className="text-neutral-600">&rarr;</span>
            <span className="font-semibold" style={{ color: targetColumn.color }}>{targetColumn.label}</span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-4">
              <span className="inline-block w-3 h-3 border-2 border-neutral-600 border-t-[#5ec1ca] rounded-full animate-spin" />
              <span className="text-xs text-neutral-400">Loading available transitions...</span>
            </div>
          ) : transitions.length === 0 ? (
            <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900/30 rounded px-3 py-2">
              No transitions available for this ticket. The workflow may not allow moving to this status.
            </div>
          ) : (
            <>
              {/* Transition selector */}
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1.5">Select transition</label>
                <div className="space-y-1">
                  {transitions.map((txn) => {
                    const toName = txn.to?.name ?? txn.name;
                    const isSelected = selectedTransition === txn.id;
                    return (
                      <button
                        key={txn.id}
                        onClick={() => setSelectedTransition(txn.id)}
                        className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                          isSelected
                            ? 'bg-[#5ec1ca]/20 border border-[#5ec1ca]/50 text-neutral-100'
                            : 'bg-[#272C33] border border-[#3a424d] text-neutral-300 hover:border-[#5ec1ca]/30'
                        }`}
                      >
                        <span className="font-medium">{txn.name}</span>
                        {toName && toName !== txn.name && (
                          <span className="text-neutral-500 ml-2">&rarr; {toName}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Required fields */}
              <div>
                <label className="block text-[11px] text-neutral-400 mb-1.5">
                  Required fields
                  {missingCount > 0 && (
                    <span className="ml-1.5 text-amber-400">({missingCount} missing)</span>
                  )}
                </label>
                <div className="space-y-2">
                  {TRANSITION_FIELDS.map((f) => {
                    const val = fieldValues[f.key] ?? '';
                    const isEmpty = !val.trim();
                    const inputCls = `w-full bg-[#272C33] border rounded px-2.5 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-[#5ec1ca]/50 ${
                      isEmpty ? 'border-amber-900/50' : 'border-[#3a424d]'
                    }`;
                    return (
                      <div key={f.key}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-[10px] ${isEmpty ? 'text-amber-400' : 'text-green-400'}`}>
                            {isEmpty ? '\u25CB' : '\u2713'}
                          </span>
                          <label className="text-[11px] text-neutral-400">{f.label}</label>
                        </div>
                        {f.inputType === 'select' && fieldOptions[f.key]?.length ? (
                          <select
                            value={val}
                            onChange={(e) => updateField(f.key, e.target.value)}
                            className={inputCls}
                          >
                            <option value="">Select {f.label.toLowerCase()}...</option>
                            {fieldOptions[f.key].map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : f.inputType === 'textarea' ? (
                          <textarea
                            value={val}
                            onChange={(e) => updateField(f.key, e.target.value)}
                            placeholder={`Enter ${f.label.toLowerCase()}...`}
                            rows={2}
                            className={`${inputCls} resize-none`}
                          />
                        ) : f.inputType === 'date' ? (
                          <input
                            type="date"
                            value={val ? val.slice(0, 10) : ''}
                            onChange={(e) => updateField(f.key, e.target.value)}
                            className={inputCls}
                          />
                        ) : (
                          <input
                            type="text"
                            value={val}
                            onChange={(e) => updateField(f.key, e.target.value)}
                            placeholder={`Enter ${f.label.toLowerCase()}...`}
                            className={inputCls}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Comment */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-neutral-400 flex items-center gap-1.5">
                    <span className={`text-[10px] ${hasComment ? 'text-green-400' : 'text-amber-400'}`}>
                      {hasComment ? '\u2713' : '\u25CB'}
                    </span>
                    Comment <span className="text-neutral-600">(required)</span>
                  </label>
                  <div className="flex gap-1">
                    {(['internal', 'public'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => setCommentType(type)}
                        className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                          commentType === type
                            ? type === 'internal'
                              ? 'bg-amber-500/20 text-amber-400 font-medium'
                              : 'bg-green-500/20 text-green-400 font-medium'
                            : 'text-neutral-600 hover:text-neutral-400'
                        }`}
                      >
                        {type === 'internal' ? 'Internal' : 'Public'}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  ref={textareaRef}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Add a comment to the transition..."
                  rows={2}
                  className={`w-full bg-[#272C33] border rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-[#5ec1ca]/50 resize-none ${
                    hasComment ? 'border-[#3a424d]' : 'border-amber-900/50'
                  }`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleConfirm();
                    }
                  }}
                />
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#3a424d] space-y-2">
          {missingCount > 0 && !loading && transitions.length > 0 && (
            <div className="text-[10px] text-amber-400 bg-amber-900/15 border border-amber-900/25 rounded px-2.5 py-1.5">
              {missingCount} required field{missingCount > 1 ? 's' : ''} not set — fill in above or update in Jira
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-neutral-600">
              {selectedTxn ? `Transition: ${selectedTxn.name}` : 'Select a transition'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded bg-[#272C33] text-neutral-400 hover:text-neutral-200 border border-[#3a424d] hover:border-[#5ec1ca]/50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving || !selectedTransition || loading || !hasComment}
                className={`px-4 py-1.5 text-xs rounded font-semibold transition-colors disabled:opacity-50 flex items-center gap-1.5 ${
                  emptyFieldCount > 0
                    ? 'bg-amber-500 text-[#272C33] hover:bg-amber-400'
                    : 'bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9]'
                }`}
              >
                {saving ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-[#272C33]/30 border-t-[#272C33] rounded-full animate-spin" />
                    Transitioning...
                  </>
                ) : emptyFieldCount > 0 ? (
                  'Transition Anyway'
                ) : (
                  'Transition in Jira'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
