/**
 * 1-2-1 closed loop — server-side config.
 *
 * The agent roster + emails come live from the KPI database (dbo.Agent) via the
 * standup roster, so there's no hard-coded agent list here. This file holds the
 * configurable prep questions (settings key `one21_prep_questions`) and the email
 * copy, all overridable in Settings. See agent_work/ba/one-to-one-loop-spec.md.
 */
import type { SettingsQueries } from '../db/settings-store.js';

/** Default day-before prep questions (B1, signed off with Nick). */
export const DEFAULT_PREP_QUESTIONS: string[] = [
  'What went well this month?',
  "What got in your way / what's blocking you?",
  'What do you want to focus on next month?',
  'Anything you want me to know, or any support you need from me?',
  'Looking at your KPIs this month, what are you most proud of?',
  'Looking at your KPIs this month, what do you most want to improve?',
  'How are you feeling about your role and workload right now?',
  'What progression are you working towards, and how can I support you in getting there?',
];

/** Prep questions, from settings (`one21_prep_questions` JSON array) or the default set. */
export function getPrepQuestions(settings: SettingsQueries): string[] {
  const raw = settings.getAll().one21_prep_questions;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.map((q) => String(q).trim()).filter(Boolean);
        if (cleaned.length > 0) return cleaned;
      }
    } catch { /* fall through to default */ }
  }
  return DEFAULT_PREP_QUESTIONS;
}

/** Intro line for the agent prep email (overridable via `one21_prep_email_intro`). */
export function prepEmailIntro(settings: SettingsQueries): string {
  return (settings.getAll().one21_prep_email_intro
    || 'Your 1-2-1 is coming up. Please take a few minutes to jot down your answers beforehand — it helps us make the most of our time together.').trim();
}

/** Intro line for the manager summary email (overridable via `one21_manager_summary_intro`). */
export function managerSummaryIntro(settings: SettingsQueries): string {
  return (settings.getAll().one21_manager_summary_intro
    || 'Here is your prep for the upcoming 1-2-1. The agent has been emailed their prep questions.').trim();
}
