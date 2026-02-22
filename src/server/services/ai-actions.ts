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

const SYSTEM_PROMPT = `You are N.O.V.A (Nurtur Operational Virtual Assistant), an AI productivity assistant for a busy professional. You are given their current task list from multiple sources (Jira, Planner, To-Do, Calendar).

Analyse the tasks and suggest the most important ones they should focus on next. Consider:
- Overdue tasks (highest urgency)
- Tasks with approaching due dates
- High priority items (lower number = higher priority)
- SLA breaches
- A balanced mix across sources

For each suggestion, return the task ID and a short reason (1 sentence) explaining why it's urgent.

Return ONLY a JSON array of objects with "task_id" and "reason" fields. No markdown, no explanation — just the JSON array.

Example: [{"task_id":"jira:PROJ-123","reason":"Overdue by 3 days and high priority."}]`;

export async function getNextActions(
  tasks: Task[],
  count: number,
  apiKey: string,
): Promise<ActionSuggestion[]> {
  const client = new OpenAI({ apiKey });

  const compact = compactify(tasks);

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Here are my ${tasks.length} current tasks:\n\n${JSON.stringify(compact)}\n\nSuggest the top ${count} tasks I should focus on next.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '[]';

  try {
    const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item: unknown) => {
          const obj = item as Record<string, unknown>;
          return obj.task_id && obj.reason;
        })
        .slice(0, count) as ActionSuggestion[];
    }
  } catch {
    // Parse failed — return empty
  }

  return [];
}
