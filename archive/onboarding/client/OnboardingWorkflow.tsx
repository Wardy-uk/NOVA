import { useState, useEffect, useMemo } from 'react';

interface TicketGroup {
  template_id: number;
  ticket_group_id: number;
}

interface WorkflowMilestone {
  id: number;
  delivery_id: number;
  template_id: number;
  template_name: string;
  target_date: string | null;
  actual_date: string | null;
  status: string;
  checklist_state_json: string;
  notes: string | null;
  workflow_task_created: number;
  workflow_tickets_created: number;
  jira_keys: string[];
  linked_ticket_groups: TicketGroup[];
}

interface Props {
  deliveryId: number;
  compact?: boolean;
  onMilestoneClick?: (milestone: WorkflowMilestone) => void;
}

function getDaysDiff(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getNodeColor(m: WorkflowMilestone): string {
  if (m.status === 'complete') return '#22c55e';
  if (m.status === 'in_progress') return '#f59e0b';
  if (m.target_date && getDaysDiff(m.target_date) < 0) return '#ef4444';
  return '#4b5563';
}

function getLineColor(prev: WorkflowMilestone, next: WorkflowMilestone): string {
  if (prev.status === 'complete' && next.status === 'complete') return '#22c55e';
  if (prev.status === 'complete') return '#5ec1ca';
  return '#3a424d';
}

function formatDate(d: string | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function OnboardingWorkflow({ deliveryId, compact, onMilestoneClick }: Props) {
  const [milestones, setMilestones] = useState<WorkflowMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setExpanded(null);
    fetch(`/api/milestones/delivery/${deliveryId}/workflow`)
      .then(r => r.json())
      .then(json => {
        if (json.ok && Array.isArray(json.data)) setMilestones(json.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [deliveryId]);

  const completedCount = useMemo(() => milestones.filter(m => m.status === 'complete').length, [milestones]);
  const progress = milestones.length > 0 ? Math.round((completedCount / milestones.length) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="w-3 h-3 border-2 border-[#5ec1ca] border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] text-neutral-500">Loading workflow...</span>
      </div>
    );
  }

  if (milestones.length === 0) return null;

  // ── Compact mode: inline progress dots ──
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {milestones.map((m, i) => {
          const color = getNodeColor(m);
          const isOverdue = m.status !== 'complete' && m.target_date && getDaysDiff(m.target_date) < 0;
          return (
            <div key={m.id} className="flex items-center">
              <div
                className={`w-2 h-2 rounded-full shrink-0 ${m.status === 'in_progress' ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: color }}
                title={`${m.template_name}${m.target_date ? ` — ${formatDate(m.target_date)}` : ''}${isOverdue ? ' (OVERDUE)' : ''}`}
              />
              {i < milestones.length - 1 && (
                <div
                  className="w-1.5 h-px shrink-0"
                  style={{ backgroundColor: getLineColor(milestones[i], milestones[i + 1]) }}
                />
              )}
            </div>
          );
        })}
        <span className="text-[9px] text-neutral-500 ml-1">{progress}%</span>
      </div>
    );
  }

  // ── Full horizontal stepper ──
  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-300">Onboarding Workflow</span>
        <span className="text-[10px] text-neutral-500">
          {completedCount}/{milestones.length} complete ({progress}%)
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-[#1f242b] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            backgroundColor: progress === 100 ? '#22c55e' : progress > 50 ? '#5ec1ca' : '#f59e0b',
          }}
        />
      </div>

      {/* Horizontal stepper */}
      <div className="overflow-x-auto">
        <div className="flex items-start min-w-0">
          {milestones.map((m, i) => {
            const color = getNodeColor(m);
            const isOverdue = m.status !== 'complete' && m.target_date && getDaysDiff(m.target_date) < 0;
            const isActive = m.status === 'in_progress';
            const isExpanded = expanded === m.id;

            return (
              <div key={m.id} className="flex items-start shrink-0" style={{ minWidth: 0 }}>
                {/* Step column */}
                <div className="flex flex-col items-center">
                  {/* Circle */}
                  <button
                    onClick={() => {
                      if (onMilestoneClick) onMilestoneClick(m);
                      setExpanded(isExpanded ? null : m.id);
                    }}
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all cursor-pointer hover:scale-110 ${
                      isActive ? 'animate-pulse' : ''
                    }`}
                    style={{
                      borderColor: color,
                      backgroundColor: m.status === 'complete' ? color : 'transparent',
                    }}
                    title={m.template_name}
                  >
                    {m.status === 'complete' && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {isOverdue && m.status !== 'complete' && (
                      <span className="text-[8px] text-red-400 font-bold">!</span>
                    )}
                  </button>

                  {/* Label */}
                  <div className="mt-1.5 text-center max-w-[72px]">
                    <div className={`text-[9px] leading-tight font-medium ${
                      m.status === 'complete' ? 'text-green-400' : isOverdue ? 'text-red-400' : isActive ? 'text-amber-400' : 'text-neutral-500'
                    }`}>
                      {m.template_name}
                    </div>
                    {m.target_date && (
                      <div className={`text-[8px] mt-0.5 ${isOverdue ? 'text-red-400/70' : 'text-neutral-600'}`}>
                        {formatDate(m.target_date)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Connector line */}
                {i < milestones.length - 1 && (
                  <div
                    className="h-px mt-3 mx-0.5 shrink-0"
                    style={{
                      width: '20px',
                      backgroundColor: getLineColor(milestones[i], milestones[i + 1]),
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (() => {
        const m = milestones.find(ms => ms.id === expanded);
        if (!m) return null;
        const isOverdue = m.status !== 'complete' && m.target_date && getDaysDiff(m.target_date) < 0;
        const daysDiff = m.target_date ? getDaysDiff(m.target_date) : null;

        let checklistItems: Array<{ text: string; checked: boolean }> = [];
        try {
          const parsed = JSON.parse(m.checklist_state_json || '[]');
          if (Array.isArray(parsed)) {
            checklistItems = parsed.map((item: any) =>
              typeof item === 'object' && item.text
                ? { text: item.text, checked: !!item.checked }
                : { text: String(item), checked: false }
            );
          }
        } catch { /* ignore */ }

        const checkDone = checklistItems.filter(c => c.checked).length;

        return (
          <div className="bg-[#1f242b] border border-[#3a424d] rounded-lg p-3 space-y-2 animate-in slide-in-from-top-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-200">{m.template_name}</span>
              <button
                onClick={() => setExpanded(null)}
                className="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                Close
              </button>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
              <div>
                <span className="text-neutral-500">Status: </span>
                <span className={
                  m.status === 'complete' ? 'text-green-400' :
                  m.status === 'in_progress' ? 'text-amber-400' :
                  isOverdue ? 'text-red-400' : 'text-neutral-300'
                }>
                  {m.status === 'in_progress' ? 'In Progress' : m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                </span>
              </div>
              {m.target_date && (
                <div>
                  <span className="text-neutral-500">Target: </span>
                  <span className={isOverdue ? 'text-red-400' : 'text-neutral-300'}>
                    {formatDate(m.target_date)}
                    {daysDiff !== null && m.status !== 'complete' && (
                      <span className="ml-1">
                        ({daysDiff < 0 ? `${Math.abs(daysDiff)}d overdue` : daysDiff === 0 ? 'today' : `${daysDiff}d`})
                      </span>
                    )}
                  </span>
                </div>
              )}
              {m.actual_date && (
                <div>
                  <span className="text-neutral-500">Completed: </span>
                  <span className="text-green-400">{formatDate(m.actual_date)}</span>
                </div>
              )}
            </div>

            {/* Checklist progress */}
            {checklistItems.length > 0 && (
              <div>
                <div className="text-[10px] text-neutral-500 mb-1">
                  Checklist: {checkDone}/{checklistItems.length}
                </div>
                <div className="h-1 bg-[#272C33] rounded-full overflow-hidden w-32">
                  <div
                    className="h-full rounded-full bg-[#5ec1ca] transition-all"
                    style={{ width: `${Math.round((checkDone / checklistItems.length) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Jira keys */}
            {m.jira_keys.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-neutral-500">Jira:</span>
                {m.jira_keys.map((key, i) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0052CC]/20 text-[#5ec1ca] font-mono">
                    {key}
                  </span>
                ))}
              </div>
            )}

            {/* Workflow status */}
            <div className="flex items-center gap-2 text-[9px] text-neutral-600">
              {m.workflow_task_created ? (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Task created
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                  Task pending
                </span>
              )}
              {m.linked_ticket_groups.length > 0 && (
                m.workflow_tickets_created ? (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Tickets created
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" />
                    Tickets pending
                  </span>
                )
              )}
            </div>

            {/* Notes */}
            {m.notes && (
              <div className="text-[10px] text-neutral-400 italic">{m.notes}</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
