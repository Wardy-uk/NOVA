import { useState, useEffect, useRef, useCallback } from 'react';
import { GlassCard, timeAgo, timeRemaining, URGENCY_COLORS, isObj, riskScoreColor } from '../queue/index.js';
import { BcAccountBadge } from '../BcAccountBadge.js';

export interface TicketDetailsGridProps {
  issue: Record<string, unknown> | null;
  queueFields?: Record<string, unknown>;
  editable?: boolean;
  onFieldChange?: (field: string, value: unknown) => void;
  ticketKey: string;
}

const JIRA_PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  highest: 'bg-red-500/20 text-red-400 border-red-500/30',
  major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  minor: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  low: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  lowest: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

function extractStr(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string') return v;
    if (isObj(v)) {
      if (typeof v.displayName === 'string') return v.displayName;
      if (typeof v.name === 'string') return v.name;
      if (typeof v.value === 'string') return v.value;
    }
  }
  return '';
}

function fieldVal(issue: Record<string, unknown> | null, queueFields: Record<string, unknown> | undefined, issueKey: string, queueKey: string): string {
  if (issue) {
    const v = extractStr(issue, issueKey);
    if (v) return v;
  }
  if (queueFields && queueFields[queueKey] !== undefined && queueFields[queueKey] !== null) {
    return String(queueFields[queueKey]);
  }
  return '';
}

function Cell({ label, children, colSpan2 }: { label: string; children: React.ReactNode; colSpan2?: boolean }) {
  return (
    <div className={colSpan2 ? 'col-span-2' : ''}>
      <span className="text-neutral-500 text-[11px]">{label}</span>
      <div className="text-neutral-300">{children}</div>
    </div>
  );
}

export function TicketDetailsGrid({ issue, queueFields, editable, onFieldChange, ticketKey }: TicketDetailsGridProps) {
  const assignee = fieldVal(issue, queueFields, 'assignee', 'assignee') || 'Unassigned';
  const reporter = fieldVal(issue, queueFields, 'reporter', 'reporter') || '—';
  const reporterEmail = (issue?.reporter && isObj(issue.reporter) ? (issue.reporter as any).emailAddress : null) ?? queueFields?.reporter_email ?? '';
  const priority = fieldVal(issue, queueFields, 'priority', 'priority') || 'Normal';
  const tier = (issue?.customfield_12981 && isObj(issue.customfield_12981) ? (issue.customfield_12981 as any).value : typeof issue?.customfield_12981 === 'string' ? issue.customfield_12981 : null) ?? queueFields?.tier ?? '';
  const product = (issue?.customfield_13183 && isObj(issue.customfield_13183) ? (issue.customfield_13183 as any).value : typeof issue?.customfield_13183 === 'string' ? issue.customfield_13183 : null) ?? queueFields?.product ?? '';
  const bcAccount = (issue?.customfield_14626 as string) ?? (queueFields?.bcAccountNumber as string) ?? (queueFields?.bc_account_number as string) ?? null;
  const status = fieldVal(issue, queueFields, 'status', 'status') || '—';
  const created = (issue?.created as string) ?? (queueFields?.created as string) ?? null;
  const updated = (issue?.updated as string) ?? (queueFields?.updated as string) ?? null;
  const dueDate = (issue?.duedate as string) ?? (queueFields?.due_date as string) ?? '';
  const agentNextUpdate = (queueFields?.agent_next_update as string) ?? '';
  const slaBreachTime = queueFields?.slaBreachTime as string | undefined;
  const slaBreached = queueFields?.slaBreached as boolean | undefined;
  const score = queueFields?.score as number | undefined;
  const riskScore = queueFields?.risk_score as number | undefined;
  const flaggedAt = queueFields?.flagged_at as string | undefined;
  const expiresAt = queueFields?.expires_at as string | undefined;
  const decidedBy = queueFields?.decided_by as string | undefined;
  const decidedAt = queueFields?.decided_at as string | undefined;
  const reviewedBy = queueFields?.reviewed_by as string | undefined;
  const reviewedAt = queueFields?.reviewed_at as string | undefined;
  const dismissReason = queueFields?.dismiss_reason as string | undefined;

  // Editable state
  const [editPriority, setEditPriority] = useState(priority);
  const [editDueDate, setEditDueDate] = useState(dueDate?.split('T')[0] ?? '');
  const [editAgentNext, setEditAgentNext] = useState(agentNextUpdate?.split('T')[0] ?? '');

  useEffect(() => { setEditPriority(priority); }, [priority]);
  useEffect(() => { setEditDueDate(dueDate?.split('T')[0] ?? ''); }, [dueDate]);
  useEffect(() => { setEditAgentNext(agentNextUpdate?.split('T')[0] ?? ''); }, [agentNextUpdate]);

  // Assignee search
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [assigneeResults, setAssigneeResults] = useState<Array<{ accountId: string; displayName: string; emailAddress?: string }>>([]);
  const [assigneeSearching, setAssigneeSearching] = useState(false);
  const [selectedAssignee, setSelectedAssignee] = useState<{ accountId: string; displayName: string } | null>(null);
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const assigneeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setSelectedAssignee(null);
    setAssigneeSearch('');
    setShowAssigneeDropdown(false);
  }, [ticketKey]);

  const handleAssigneeSearch = useCallback((query: string) => {
    setAssigneeSearch(query);
    setShowAssigneeDropdown(true);
    if (assigneeTimerRef.current) clearTimeout(assigneeTimerRef.current);
    if (!query.trim() || query.length < 2) { setAssigneeResults([]); return; }
    assigneeTimerRef.current = setTimeout(async () => {
      setAssigneeSearching(true);
      try {
        const res = await fetch(`/api/jira/users/search?query=${encodeURIComponent(query)}`);
        const json = await res.json();
        if (json.ok) {
          const data = json.data;
          const users = Array.isArray(data) ? data : data?.users ?? data?.values ?? [];
          setAssigneeResults(users.map((u: Record<string, unknown>) => ({
            accountId: (u.accountId ?? u.account_id ?? u.key ?? '') as string,
            displayName: (u.displayName ?? u.display_name ?? u.name ?? '') as string,
            emailAddress: (u.emailAddress ?? u.email ?? '') as string,
          })).filter((u: { accountId: string }) => u.accountId));
        }
      } catch { /* silent */ } finally { setAssigneeSearching(false); }
    }, 300);
  }, []);

  const handleAssigneeSelect = (user: { accountId: string; displayName: string }) => {
    setSelectedAssignee(user);
    setAssigneeSearch(user.displayName);
    setShowAssigneeDropdown(false);
    onFieldChange?.('assignee', { accountId: user.accountId });
  };

  const priStyle = PRIORITY_STYLES[priority.toLowerCase()] || PRIORITY_STYLES.normal;
  const expiry = expiresAt ? timeRemaining(expiresAt) : null;

  return (
    <GlassCard className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">Ticket Details</div>
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        {/* Assignee */}
        <Cell label="Assignee">
          {editable ? (
            <div className="relative">
              <input
                type="text"
                value={assigneeSearch || (selectedAssignee ? selectedAssignee.displayName : assignee)}
                onChange={(e) => handleAssigneeSearch(e.target.value)}
                onFocus={() => { if (assigneeResults.length > 0) setShowAssigneeDropdown(true); }}
                onBlur={() => setTimeout(() => setShowAssigneeDropdown(false), 200)}
                placeholder="Search users..."
                className="w-full text-[13px] text-neutral-50 rounded-lg px-3 py-1.5"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              />
              {assigneeSearching && <div className="absolute right-3 top-[6px] text-[10px] text-neutral-500">...</div>}
              {showAssigneeDropdown && assigneeResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg shadow-lg max-h-40 overflow-auto" style={{ background: 'rgba(30,35,43,0.98)', border: '1px solid rgba(255,255,255,0.12)' }}>
                  {assigneeResults.map((u) => (
                    <button key={u.accountId} onMouseDown={() => handleAssigneeSelect(u)} className="w-full text-left px-3 py-2 text-xs text-neutral-200 hover:bg-white/5 transition-colors">
                      <span className="font-medium">{u.displayName}</span>
                      {u.emailAddress && <span className="text-neutral-500 ml-1.5">{u.emailAddress}</span>}
                    </button>
                  ))}
                </div>
              )}
              {selectedAssignee && <div className="mt-1 text-[10px] text-[#5ec1ca]">Will reassign to: {selectedAssignee.displayName}</div>}
            </div>
          ) : (
            <>{assignee}</>
          )}
        </Cell>

        {/* Reporter */}
        <Cell label="Reporter">
          {reporter}
          {reporterEmail && <span className="text-neutral-500 text-[11px] ml-1">({reporterEmail})</span>}
        </Cell>

        {/* Priority */}
        <Cell label="Priority">
          {editable ? (
            <select
              value={editPriority}
              onChange={(e) => { setEditPriority(e.target.value); onFieldChange?.('priority', { name: e.target.value }); }}
              className="w-full text-[13px] text-neutral-50 rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              {JIRA_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              {editPriority && !JIRA_PRIORITIES.includes(editPriority) && <option value={editPriority}>{editPriority}</option>}
            </select>
          ) : (
            <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${priStyle}`}>{priority}</span>
          )}
        </Cell>

        {/* Tier */}
        <Cell label="Tier">{tier || '—'}</Cell>

        {/* Product */}
        <Cell label="Product">{product || '—'}</Cell>

        {/* BC Account */}
        <Cell label="BC Account">
          <BcAccountBadge ticketKey={ticketKey} accountNumber={bcAccount} compact />
        </Cell>

        {/* Status */}
        <Cell label="Status">{status}</Cell>

        {/* Created */}
        <Cell label="Created">{created ? `${timeAgo(created)} ago` : '—'}</Cell>

        {/* Updated */}
        <Cell label="Updated">{updated ? `${timeAgo(updated)} ago` : '—'}</Cell>

        {/* Due Date */}
        <Cell label="Due Date">
          {editable ? (
            <input
              type="date"
              value={editDueDate}
              onChange={(e) => { setEditDueDate(e.target.value); onFieldChange?.('duedate', e.target.value || null); }}
              className="w-full text-[13px] text-neutral-50 rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          ) : (
            <>{dueDate ? dueDate.split('T')[0] : '—'}</>
          )}
        </Cell>

        {/* Agent Next Update */}
        <Cell label="Agent Next Update">
          {editable ? (
            <input
              type="date"
              value={editAgentNext}
              onChange={(e) => { setEditAgentNext(e.target.value); onFieldChange?.('Agent Next Update', e.target.value || null); }}
              className="w-full text-[13px] text-neutral-50 rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
          ) : (
            <>{agentNextUpdate ? agentNextUpdate.split('T')[0] : '—'}</>
          )}
        </Cell>

        {/* SLA */}
        {slaBreachTime != null && (
          <Cell label="SLA" colSpan2>
            <span className={slaBreached ? 'text-red-400 font-semibold' : 'text-neutral-300'}>
              {slaBreached ? 'BREACHED' : `Breach at ${new Date(slaBreachTime).toLocaleString()}`}
            </span>
          </Cell>
        )}

        {/* Score */}
        {score != null && <Cell label="Score">{score}</Cell>}

        {/* Risk Score */}
        {riskScore != null && (
          <Cell label="Risk Score">
            <span className="font-bold tabular-nums" style={{ color: riskScoreColor(riskScore) }}>{riskScore}</span>
          </Cell>
        )}

        {/* Flagged */}
        {flaggedAt && <Cell label="Flagged">{timeAgo(flaggedAt)} ago</Cell>}

        {/* Expires */}
        {expiry && (
          <Cell label="Expires">
            <span className={URGENCY_COLORS[expiry.urgency]}>{expiry.text}</span>
          </Cell>
        )}

        {/* Decided By / At */}
        {decidedBy && <Cell label="Decided By">{decidedBy}</Cell>}
        {decidedAt && <Cell label="Decided At">{timeAgo(decidedAt)}</Cell>}

        {/* Reviewed By / At */}
        {reviewedBy && <Cell label="Reviewed By">{reviewedBy}</Cell>}
        {reviewedAt && <Cell label="Reviewed At">{timeAgo(reviewedAt)}</Cell>}

        {/* Dismiss Reason */}
        {dismissReason && <Cell label="Dismiss Reason" colSpan2>{dismissReason}</Cell>}
      </div>
    </GlassCard>
  );
}
