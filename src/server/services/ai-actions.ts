import OpenAI from 'openai';
import type { Task } from '../../shared/types.js';

export interface ActionSuggestion {
  task_id: string;
  reason: string;
}

interface CompactTask {
  id: string;
  title: string;
  source: string;
  status: string;
  priority: number;
  due?: string;
  overdue?: boolean;
}

function compactify(tasks: Task[]): CompactTask[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return tasks.map((t) => {
    const compact: CompactTask = {
      id: t.id,
      title: t.title,
      source: t.source,
      status: t.status,
      priority: t.priority,
    };
    if (t.due_date) {
      compact.due = t.due_date;
      const due = new Date(t.due_date);
      if (!isNaN(due.getTime()) && due < today) {
        compact.overdue = true;
      }
    }
    return compact;
  });
}

const SYSTEM_PROMPT = `You are N.O.V.A (Nurtur Operational Virtual Assistant), an AI productivity assistant for a busy professional. You are given their current task list from multiple sources (Jira, Planner, To-Do, Calendar, Onboarding Milestones).

Analyse the tasks and suggest the most important ones they should focus on next. Consider:
- Overdue tasks (highest urgency)
- Tasks with approaching due dates
- High priority items (lower number = higher priority)
- SLA breaches
- Onboarding milestones (source: "milestone") — these represent customer delivery milestones. Overdue milestones are especially urgent as they impact customer go-live dates.
- A balanced mix across sources

For each suggestion, return the task ID and a short reason (1 sentence) explaining why it's urgent.

Return ONLY a JSON array of objects with "task_id" and "reason" fields. No markdown, no explanation — just the JSON array.

Example: [{"task_id":"jira:PROJ-123","reason":"Overdue by 3 days and high priority."}]`;

interface DebugEntry {
  ts: string;
  text: string;
}

const debugLog: DebugEntry[] = [];

export function recordAiActionsDebug(text: string): void {
  debugLog.push({ ts: new Date().toISOString(), text });
  if (debugLog.length > 50) {
    debugLog.splice(0, debugLog.length - 50);
  }
}

export function getAiActionsDebugLog(): DebugEntry[] {
  return [...debugLog];
}

/** Pre-filter to the most relevant tasks to stay within LLM token limits */
function selectRelevant(tasks: Task[], max: number = 75): Task[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekOut = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Score: lower = more relevant
  const scored = tasks.map(t => {
    const due = t.due_date ? new Date(t.due_date) : null;
    const validDue = due && !isNaN(due.getTime());
    const isOverdue = validDue && due < today;
    const isDueSoon = validDue && due >= today && due <= weekOut;
    let score = 50;
    if (isOverdue) score = 0;
    else if (isDueSoon) score = 10;
    else if (t.priority <= 2) score = 20;
    else if (t.source === 'milestone') score = 25;
    return { task: t, score };
  });

  scored.sort((a, b) => a.score - b.score || (a.task.priority ?? 50) - (b.task.priority ?? 50));
  return scored.slice(0, max).map(s => s.task);
}

export async function getNextActions(
  tasks: Task[],
  count: number,
  apiKey: string,
): Promise<ActionSuggestion[]> {
  const relevant = selectRelevant(tasks, 75);

  if (process.env.AI_ACTIONS_DEBUG === 'true') {
    const sources = Array.from(new Set(relevant.map((t) => t.source)));
    const sample = relevant.slice(0, 5).map((t) => t.id).join(', ');
    recordAiActionsDebug(`[meta] total=${tasks.length} sent=${relevant.length} sources=${sources.join(',') || 'none'} sample=${sample}`);
  }

  const client = new OpenAI({ apiKey });

  const compact = compactify(relevant);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Here are my ${relevant.length} most relevant current tasks (from ${tasks.length} total):\n\n${JSON.stringify(compact)}\n\nSuggest the top ${count} tasks I should focus on next.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '[]';
  recordAiActionsDebug(text);
  if (process.env.AI_ACTIONS_DEBUG === 'true') {
    console.log('[AI Actions] Raw response:', text);
  }

  try {
    const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const start = cleaned.indexOf('[');
      const end = cleaned.lastIndexOf(']');
      if (start >= 0 && end > start) {
        parsed = JSON.parse(cleaned.slice(start, end + 1));
      } else {
        throw new Error('No JSON array found');
      }
    }
    if (Array.isArray(parsed)) {
      const filtered = parsed
        .filter((item: unknown) => {
          const obj = item as Record<string, unknown>;
          return obj.task_id && obj.reason;
        })
        .slice(0, count) as ActionSuggestion[];
      if (filtered.length > 0) return filtered;
    }
  } catch {
    // Parse failed — return empty
  }

  // Fallback: deterministic heuristic ranking
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const scored = tasks.map((t) => {
    const due = t.due_date ? new Date(t.due_date) : null;
    const isOverdue = !!due && !isNaN(due.getTime()) && due < dayStart;
    const dueTime = due && !isNaN(due.getTime()) ? due.getTime() : Number.POSITIVE_INFINITY;
    return {
      task_id: t.id,
      reason: isOverdue
        ? 'Overdue task based on due date.'
        : t.due_date
          ? 'Upcoming due date.'
          : 'High priority task.',
      score: [
        isOverdue ? 0 : 1,
        dueTime,
        t.priority ?? 50,
        -new Date(t.updated_at).getTime(),
      ],
    };
  });

  scored.sort((a, b) => {
    for (let i = 0; i < a.score.length; i += 1) {
      if (a.score[i] < b.score[i]) return -1;
      if (a.score[i] > b.score[i]) return 1;
    }
    return 0;
  });

  return scored.slice(0, count).map((s) => ({
    task_id: s.task_id,
    reason: s.reason,
  }));
}
