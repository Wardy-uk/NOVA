import OpenAI from 'openai';
import type { Task } from '../../shared/types.js';
import type { Ritual } from '../db/queries.js';

interface CompactTask {
  id: string;
  title: string;
  source: string;
  status: string;
  priority: number;
  due?: string;
  overdue?: boolean;
  description?: string;
}

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
      if (!isNaN(due.getTime()) && due < today) compact.overdue = true;
    }
    if (t.description) compact.description = t.description.slice(0, 100);
    return compact;
  });
}

function parseJson<T>(text: string): T | null {
  try {
    const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

export async function generateMorningBriefing(
  tasks: Task[],
  apiKey: string,
  previousRitual?: Ritual | null,
): Promise<MorningBriefing> {
  const client = new OpenAI({ apiKey });
  const compact = compactify(tasks);

  let yesterdayContext = '';
  if (previousRitual?.planned_items) {
    yesterdayContext = `\n\nYesterday's planned items were:\n${previousRitual.planned_items}\n\nYesterday's completed items were:\n${previousRitual.completed_items ?? 'None recorded'}\n\nIdentify any tasks that were planned but not completed as "rolled over".`;
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 2000,
    messages: [
      {
        role: 'system',
        content: `You are N.O.V.A (Nurtur Operational Virtual Assistant), running a morning standup briefing. Analyse the task list and produce a structured morning briefing. Tasks with source "milestone" are customer onboarding milestones — highlight overdue ones prominently as they impact customer delivery timelines.

Return ONLY a JSON object with these fields:
- "summary": 2-3 sentence overview of the day ahead. Be direct, professional, slightly motivating.
- "overdue": array of {"task_id","reason"} for overdue tasks (max 10)
- "due_today": array of {"task_id","note"} for tasks due today
- "top_priorities": array of {"task_id","reason"} — your top 5 recommended focus items with short justification
- "rolled_over": array of {"task_id","reason"} — tasks from yesterday that weren't completed (only if yesterday's data provided)

Use actual task IDs from the data. Keep reasons to 1 sentence each. No markdown, just JSON.`,
      },
      {
        role: 'user',
        content: `Today's date: ${new Date().toISOString().split('T')[0]}\n\nMy ${tasks.length} current tasks:\n${JSON.stringify(compact)}${yesterdayContext}\n\nGenerate my morning briefing.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  const parsed = parseJson<MorningBriefing>(text);

  return parsed ?? {
    summary: 'N.O.V.A could not generate a briefing. Please check your tasks and try again.',
    overdue: [],
    due_today: [],
    top_priorities: [],
    rolled_over: [],
  };
}

export async function generateReplan(
  tasks: Task[],
  apiKey: string,
  morningRitual?: Ritual | null,
): Promise<ReplanBriefing> {
  const client = new OpenAI({ apiKey });
  const compact = compactify(tasks);

  let morningContext = '';
  if (morningRitual?.planned_items) {
    morningContext = `\n\nThis morning's planned priorities were:\n${morningRitual.planned_items}\n\nCompleted so far:\n${morningRitual.completed_items ?? 'None yet'}`;
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 1000,
    messages: [
      {
        role: 'system',
        content: `You are N.O.V.A running a quick mid-day re-plan. Look at the current task state and suggest adjusted priorities for the rest of the day. Pay attention to onboarding milestones (source: "milestone") that are overdue or due today.

Return ONLY a JSON object:
- "summary": 1-2 sentence re-assessment
- "adjusted_priorities": array of {"task_id","reason"} — top 5 things to focus on for the rest of the day

Use actual task IDs. Keep it brief. No markdown, just JSON.`,
      },
      {
        role: 'user',
        content: `Current time: ${new Date().toLocaleTimeString()}\n\nMy ${tasks.length} tasks:\n${JSON.stringify(compact)}${morningContext}\n\nRe-plan my afternoon.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  const parsed = parseJson<ReplanBriefing>(text);

  return parsed ?? {
    summary: 'N.O.V.A could not generate a re-plan.',
    adjusted_priorities: [],
  };
}

export async function generateEndOfDay(
  tasks: Task[],
  apiKey: string,
  morningRitual?: Ritual | null,
): Promise<EodReview> {
  const client = new OpenAI({ apiKey });
  const compact = compactify(tasks);

  let morningContext = '';
  if (morningRitual?.planned_items) {
    morningContext = `\n\nThis morning's planned priorities were:\n${morningRitual.planned_items}\n\nCompleted during the day:\n${morningRitual.completed_items ?? 'None recorded'}`;
  }

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 1500,
    messages: [
      {
        role: 'system',
        content: `You are N.O.V.A running an end-of-day review. Summarise what was accomplished and what's rolling over to tomorrow. Note progress on onboarding milestones (source: "milestone") in the accomplishments.

Return ONLY a JSON object:
- "summary": 2-3 sentence end-of-day wrap up. Be constructive, note achievements.
- "accomplished": array of strings describing what was achieved today (based on completed items and task state changes)
- "rolling_over": array of {"task_id","reason"} — tasks that need attention tomorrow
- "insights": 1-2 sentences of productivity insight or suggestion for tomorrow

Use actual task IDs where relevant. No markdown, just JSON.`,
      },
      {
        role: 'user',
        content: `End of day: ${new Date().toLocaleTimeString()}\n\nMy ${tasks.length} remaining tasks:\n${JSON.stringify(compact)}${morningContext}\n\nGenerate my end-of-day review.`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? '{}';
  const parsed = parseJson<EodReview>(text);

  return parsed ?? {
    summary: 'N.O.V.A could not generate an end-of-day review.',
    accomplished: [],
    rolling_over: [],
    insights: '',
  };
}
