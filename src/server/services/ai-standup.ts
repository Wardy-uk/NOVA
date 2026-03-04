import type { Task } from '../../shared/types.js';
import type { Ritual } from '../db/queries.js';

export interface MorningBriefing {
  summary: string;
  overdue: { task_id: string; reason: string }[];
  due_today: { task_id: string; note: string }[];
  top_priorities: { task_id: string; reason: string }[];
  rolled_over: { task_id: string; reason: string }[];
}

export interface ReplanBriefing {
  summary: string;
  adjusted_priorities: { task_id: string; reason: string }[];
}

export interface EodReview {
  summary: string;
  accomplished: string[];
  rolling_over: { task_id: string; reason: string }[];
  insights: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / MS_PER_DAY);
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    jira: 'Jira', planner: 'Planner', todo: 'To-Do',
    monday: 'Monday', email: 'Email', calendar: 'Calendar',
    milestone: 'Onboarding',
  };
  return labels[source] ?? source;
}

function priorityLabel(p: number): string {
  if (p <= 1) return 'urgent';
  if (p <= 2) return 'high priority';
  if (p <= 3) return 'medium priority';
  return '';
}

interface Categorised {
  overdue: Task[];
  dueToday: Task[];
  dueSoon: Task[];  // next 7 days
  highPriority: Task[];
  milestones: Task[];
  pinned: Task[];
  rest: Task[];
}

function categorise(tasks: Task[], todayStart: Date, weekOut: Date): Categorised {
  const result: Categorised = {
    overdue: [], dueToday: [], dueSoon: [],
    highPriority: [], milestones: [], pinned: [], rest: [],
  };

  for (const t of tasks) {
    const due = t.due_date ? new Date(t.due_date) : null;
    const validDue = due && !isNaN(due.getTime());

    if (validDue && due < todayStart) {
      result.overdue.push(t);
    } else if (validDue && daysBetween(due, todayStart) === 0) {
      result.dueToday.push(t);
    } else if (validDue && due <= weekOut) {
      result.dueSoon.push(t);
    } else if (t.priority <= 2) {
      result.highPriority.push(t);
    } else if (t.source === 'milestone') {
      result.milestones.push(t);
    } else if (t.is_pinned) {
      result.pinned.push(t);
    } else {
      result.rest.push(t);
    }
  }

  // Sort overdue by most overdue first
  result.overdue.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  // Sort due today/soon by priority
  result.dueToday.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
  result.dueSoon.sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  result.highPriority.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  return result;
}

function buildTopPriorities(cat: Categorised, todayStart: Date, max: number = 5): { task_id: string; reason: string }[] {
  const picks: { task_id: string; reason: string }[] = [];
  const seen = new Set<string>();

  const add = (t: Task, reason: string) => {
    if (seen.has(t.id) || picks.length >= max) return;
    seen.add(t.id);
    picks.push({ task_id: t.id, reason });
  };

  // 1. Overdue (most urgent)
  for (const t of cat.overdue.slice(0, 3)) {
    const days = Math.abs(daysBetween(todayStart, new Date(t.due_date!)));
    const pLabel = priorityLabel(t.priority);
    add(t, `Overdue by ${days} day${days === 1 ? '' : 's'}${pLabel ? ', ' + pLabel : ''} (${sourceLabel(t.source)}).`);
  }

  // 2. Due today
  for (const t of cat.dueToday.slice(0, 2)) {
    add(t, `Due today${priorityLabel(t.priority) ? ', ' + priorityLabel(t.priority) : ''} (${sourceLabel(t.source)}).`);
  }

  // 3. High priority
  for (const t of cat.highPriority.slice(0, 2)) {
    add(t, `${priorityLabel(t.priority).charAt(0).toUpperCase() + priorityLabel(t.priority).slice(1)} (${sourceLabel(t.source)}).`);
  }

  // 4. Due soon
  for (const t of cat.dueSoon.slice(0, 2)) {
    const days = daysBetween(new Date(t.due_date!), todayStart);
    add(t, `Due in ${days} day${days === 1 ? '' : 's'} (${sourceLabel(t.source)}).`);
  }

  // 5. Milestones
  for (const t of cat.milestones.slice(0, 2)) {
    add(t, `Onboarding milestone — impacts customer delivery.`);
  }

  // 6. Pinned
  for (const t of cat.pinned.slice(0, 2)) {
    add(t, `Pinned focus item (${sourceLabel(t.source)}).`);
  }

  return picks;
}

// ── Public API (same signatures as before, minus apiKey) ──

export function generateMorningBriefing(
  tasks: Task[],
  previousRitual?: Ritual | null,
): MorningBriefing {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekOut = new Date(todayStart.getTime() + 7 * MS_PER_DAY);
  const cat = categorise(tasks, todayStart, weekOut);

  // Overdue list
  const overdue = cat.overdue.slice(0, 10).map(t => {
    const days = Math.abs(daysBetween(todayStart, new Date(t.due_date!)));
    return { task_id: t.id, reason: `Overdue by ${days} day${days === 1 ? '' : 's'} (${sourceLabel(t.source)}).` };
  });

  // Due today
  const due_today = cat.dueToday.map(t => ({
    task_id: t.id,
    note: `${priorityLabel(t.priority) || 'Standard priority'} — ${sourceLabel(t.source)}.`,
  }));

  // Top priorities
  const top_priorities = buildTopPriorities(cat, todayStart, 5);

  // Rolled over from yesterday
  const rolled_over: { task_id: string; reason: string }[] = [];
  if (previousRitual?.planned_items) {
    try {
      const planned = JSON.parse(previousRitual.planned_items) as string[];
      const completed = previousRitual.completed_items
        ? new Set(JSON.parse(previousRitual.completed_items) as string[])
        : new Set<string>();
      for (const tid of planned) {
        if (!completed.has(tid)) {
          const task = tasks.find(t => t.id === tid);
          if (task) {
            rolled_over.push({ task_id: tid, reason: `Planned yesterday but not completed (${sourceLabel(task.source)}).` });
          }
        }
      }
    } catch { /* ignore corrupt data */ }
  }

  // Summary
  const parts: string[] = [`${greeting()}!`];
  if (cat.overdue.length > 0) {
    parts.push(`You have ${cat.overdue.length} overdue task${cat.overdue.length === 1 ? '' : 's'} needing attention.`);
  }
  if (cat.dueToday.length > 0) {
    parts.push(`${cat.dueToday.length} task${cat.dueToday.length === 1 ? ' is' : 's are'} due today.`);
  }
  if (parts.length === 1) {
    parts.push(`You have ${tasks.length} open tasks across your integrations. Here's your prioritised focus list.`);
  }

  const overdueMilestones = cat.overdue.filter(t => t.source === 'milestone');
  if (overdueMilestones.length > 0) {
    parts.push(`${overdueMilestones.length} overdue onboarding milestone${overdueMilestones.length === 1 ? '' : 's'} — customer delivery impact.`);
  }

  return { summary: parts.join(' '), overdue, due_today, top_priorities, rolled_over };
}

export function generateReplan(
  tasks: Task[],
  morningRitual?: Ritual | null,
): ReplanBriefing {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekOut = new Date(todayStart.getTime() + 7 * MS_PER_DAY);
  const cat = categorise(tasks, todayStart, weekOut);

  const adjusted_priorities = buildTopPriorities(cat, todayStart, 5);

  // Summary
  const parts: string[] = [];
  if (cat.overdue.length > 0) {
    parts.push(`${cat.overdue.length} overdue task${cat.overdue.length === 1 ? '' : 's'} still need${cat.overdue.length === 1 ? 's' : ''} attention.`);
  }
  if (cat.dueToday.length > 0) {
    parts.push(`${cat.dueToday.length} task${cat.dueToday.length === 1 ? '' : 's'} still due today.`);
  }

  // Check progress against morning plan
  if (morningRitual?.planned_items) {
    try {
      const planned = JSON.parse(morningRitual.planned_items) as string[];
      const completed = morningRitual.completed_items
        ? (JSON.parse(morningRitual.completed_items) as string[]).length
        : 0;
      parts.push(`${completed} of ${planned.length} morning priorities completed so far.`);
    } catch { /* ignore */ }
  }

  if (parts.length === 0) {
    parts.push(`Here are your adjusted priorities for the rest of the day.`);
  }

  return { summary: parts.join(' '), adjusted_priorities };
}

export function generateEndOfDay(
  tasks: Task[],
  morningRitual?: Ritual | null,
): EodReview {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekOut = new Date(todayStart.getTime() + 7 * MS_PER_DAY);
  const cat = categorise(tasks, todayStart, weekOut);

  // Accomplished — from completed items in morning ritual
  const accomplished: string[] = [];
  let completedCount = 0;
  let plannedCount = 0;
  if (morningRitual?.completed_items) {
    try {
      const items = JSON.parse(morningRitual.completed_items) as string[];
      completedCount = items.length;
      for (const tid of items) {
        const task = tasks.find(t => t.id === tid);
        accomplished.push(task ? `Completed: ${task.title} (${sourceLabel(task.source)})` : `Completed task ${tid}`);
      }
    } catch { /* ignore */ }
  }
  if (morningRitual?.planned_items) {
    try { plannedCount = (JSON.parse(morningRitual.planned_items) as string[]).length; } catch { /* ignore */ }
  }
  if (accomplished.length === 0) {
    accomplished.push('No completed items were recorded for today.');
  }

  // Rolling over — overdue + due today that are still open
  const rolling_over = [...cat.overdue, ...cat.dueToday].slice(0, 10).map(t => ({
    task_id: t.id,
    reason: `Still open — ${t.due_date ? 'due ' + t.due_date : 'needs attention'} (${sourceLabel(t.source)}).`,
  }));

  // Summary
  const parts: string[] = [];
  if (completedCount > 0) {
    parts.push(`You completed ${completedCount} task${completedCount === 1 ? '' : 's'} today${plannedCount ? ` out of ${plannedCount} planned` : ''}.`);
  } else {
    parts.push(`End of day wrap-up.`);
  }
  if (rolling_over.length > 0) {
    parts.push(`${rolling_over.length} task${rolling_over.length === 1 ? '' : 's'} rolling over to tomorrow.`);
  }

  // Insights
  const insightParts: string[] = [];
  if (cat.overdue.length > 3) {
    insightParts.push(`Consider clearing overdue items first thing tomorrow — you have ${cat.overdue.length} stacking up.`);
  }
  if (cat.milestones.length > 0) {
    insightParts.push(`Keep an eye on ${cat.milestones.length} onboarding milestone${cat.milestones.length === 1 ? '' : 's'} — customer timelines depend on them.`);
  }
  if (insightParts.length === 0) {
    insightParts.push('Try to tackle overdue items early tomorrow to keep momentum.');
  }

  return {
    summary: parts.join(' '),
    accomplished,
    rolling_over,
    insights: insightParts.join(' '),
  };
}
