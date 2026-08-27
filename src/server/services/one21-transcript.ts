import { z } from 'zod';

import { query, queryOne, execute, executeAndGetId } from './database.js';
import { LlmService } from './llm-service.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { PlaudService } from './plaud-service.js';

/**
 * The 1-2-1 transcript is the record of what was agreed.
 *
 * Nick doesn't type anything into the session wizard — the conversation is recorded on
 * Plaud, and everything that needs to change afterwards (new commitments, which of last
 * month's actions got done, movement on development goals) is *in* that transcript. This
 * reads it and turns it into rows.
 *
 * ⚠ THE ONE RULE THAT MATTERS. A completion is never written as `delivered`.
 *
 * "Yeah, I got that done" is a claim made in a conversation, sometimes about the wrong
 * thing, sometimes optimistically, and a model resolving it to `delivered` puts a number
 * into the delivery rate that nobody checked. Worse, it does so silently: the action
 * leaves the outstanding list, so it never comes up again and the miss is invisible
 * forever. So the transcript writes `claimed`, which is deliberately OUTSIDE the
 * delivered/missed pair the rate is computed from, and stage 1 of the next 1-2-1 asks
 * Nick to confirm it — with the person sitting there, which is the best verification
 * available and costs one click in a place he is already looking.
 *
 * New actions are the opposite: cheap to over-generate, obvious when wrong, and deleting
 * one is trivial. Those are applied directly.
 */

const OUTSTANDING = ['pending', 'open', 'in_progress', 'carried_over'];

/** What the model is allowed to say about the conversation. */
const ExtractionSchema = z.object({
  completed: z.array(z.object({
    // The id of an action we gave it. A description it invented is not a completion.
    action_id: z.number(),
    // The words that justify it, so a wrong claim is refutable at a glance rather than
    // taken on trust.
    evidence: z.string(),
  })).default([]),
  new_actions: z.array(z.object({
    description: z.string(),
    owner: z.string().nullable().default(null),
    due_date: z.string().nullable().default(null),
  })).default([]),
  goal_notes: z.array(z.object({
    goal: z.string(),
    note: z.string(),
  })).default([]),
  discussion_summary: z.string().default(''),
});

export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractionResult {
  ok: boolean;
  error?: string;
  sessionId: number;
  claimed: number;
  created: number;
  goalNotes: number;
  extraction?: Extraction;
}

const SYSTEM_PROMPT = `You are reading the transcript of a 1-2-1 between a support team manager (Nick) and a team member.

Extract only what the conversation actually establishes. This is a record, not a summary you are asked to improve.

COMPLETED ACTIONS — you are given the team member's currently open actions with their ids.
Return an action_id ONLY when the conversation clearly establishes that specific action is
finished. Quote the words that show it in "evidence". Rules:
- Discussing an action, or agreeing to do it, is NOT completing it.
- "I'll get that done this week" is a commitment, not a completion.
- Ambiguity means LEAVE IT OUT. A missed completion costs one click next month; a wrong
  one silently closes a commitment nobody delivered.
- Never invent an action_id. Only ids from the list.

NEW ACTIONS — commitments made in this conversation, by either person. Use the words they
used. owner is the person who took it on ("Nick" or the team member's name), or null.
due_date only if an actual date or clear deadline was given (YYYY-MM-DD), else null.

GOAL NOTES — movement on a development goal that was discussed. goal = which goal, note =
what changed. Omit if goals were not discussed.

DISCUSSION SUMMARY — a short paragraph of what was covered.

Return a single flat JSON object with keys: completed, new_actions, goal_notes, discussion_summary.`;

/**
 * Read a session's Plaud transcript and apply what it establishes.
 *
 * Idempotent per session: actions already claimed by THIS session are not re-claimed, and
 * a new action whose description already exists on the session is not duplicated. The job
 * can therefore be re-run after a failure without doubling anything.
 */
export async function extractSessionOutcomes(
  deps: { settingsQueries: FileSettingsQueries; plaudService: PlaudService },
  sessionId: number,
): Promise<ExtractionResult> {
  const base: ExtractionResult = { ok: false, sessionId, claimed: 0, created: 0, goalNotes: 0 };

  const session = await queryOne<{
    agent_name: string; scheduled_date: string; plaud_recording_id: string | null;
    notes_text: string | null; transcript_text: string | null;
  }>(`
    SELECT agent_name, scheduled_date, plaud_recording_id, notes_text, transcript_text
    FROM agent_121_sessions WHERE id = ?
  `, [sessionId]);
  if (!session) return { ...base, error: 'Session not found' };

  // The transcript that arrived over the NEURO bridge wins. It is the one Nick actually
  // approved, and NOVA's own Plaud MCP connection has never been authorised in prod — so
  // the direct fetch is the fallback, not the primary path.
  let transcript = (session.transcript_text ?? '').trim();
  if (!transcript) {
    if (!session.plaud_recording_id) {
      // Not an error. Most sessions simply have no recording attached yet, and the job
      // sweeps every completed one.
      return { ...base, ok: true, error: 'No transcript attached' };
    }
    try {
      transcript = await deps.plaudService.getTranscript(session.plaud_recording_id);
    } catch (err) {
      return { ...base, error: `Could not read the transcript: ${err instanceof Error ? err.message : err}` };
    }
  }
  if (!transcript.trim()) return { ...base, ok: true, error: 'Transcript not ready yet' };

  // The actions the model is allowed to close. Anything outside this list is not a
  // completion it can express.
  const openActions = await query<{ id: number; description: string; owner: string | null; due_date: string | null; status: string }>(`
    SELECT id, description, owner, due_date, status FROM agent_121_actions
    WHERE agent_name = ? AND status IN (${OUTSTANDING.map(() => '?').join(',')})
    ORDER BY id ASC
  `, [session.agent_name, ...OUTSTANDING]);

  const userMessage = `Team member: ${session.agent_name}
1-2-1 date: ${String(session.scheduled_date).slice(0, 10)}

## Their currently open actions
${openActions.length
    ? openActions.map((a) => `- id ${a.id}: ${a.description}${a.owner ? ` (owner: ${a.owner})` : ''}${a.due_date ? `, due ${a.due_date}` : ''}`).join('\n')
    : '(none)'}

## Transcript
${transcript}`;

  const llm = new LlmService(deps.settingsQueries);
  let extraction: Extraction;
  try {
    const r = await llm.call(SYSTEM_PROMPT, userMessage, ExtractionSchema, {
      callType: '121-transcript',
      maxTokens: 3000,
      temperature: 0.1,
    });
    extraction = r.data;
  } catch (err) {
    return { ...base, error: `Extraction failed: ${err instanceof Error ? err.message : err}` };
  }

  // ── Completions → 'claimed', never 'delivered' ──
  const openById = new Map(openActions.map((a) => [a.id, a]));
  let claimed = 0;
  for (const c of extraction.completed) {
    // A hallucinated id, or one belonging to another agent, closes nothing.
    if (!openById.has(c.action_id)) continue;
    await execute(`
      UPDATE agent_121_actions
      SET status = 'claimed', claim_evidence = ?, claim_session_id = ?, claimed_at = GETUTCDATE()
      WHERE id = ? AND status IN (${OUTSTANDING.map(() => '?').join(',')})
    `, [c.evidence.slice(0, 1000), sessionId, c.action_id, ...OUTSTANDING]);
    claimed++;
  }

  // ── New actions → applied directly ──
  const existing = await query<{ description: string }>(
    `SELECT description FROM agent_121_actions WHERE session_id = ?`, [sessionId]);
  const seen = new Set(existing.map((e) => e.description.trim().toLowerCase()));
  let created = 0;
  for (const a of extraction.new_actions) {
    const description = a.description.trim();
    if (!description || seen.has(description.toLowerCase())) continue;
    seen.add(description.toLowerCase());
    await executeAndGetId(`
      INSERT INTO agent_121_actions (session_id, agent_name, description, owner, due_date, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `, [sessionId, session.agent_name, description, a.owner, /^\d{4}-\d{2}-\d{2}$/.test(a.due_date ?? '') ? a.due_date : null]);
    created++;
  }

  // ── Goal notes → appended to the session notes ──
  //
  // Kept as text against the session rather than written into the vault development plan
  // from here: NOVA cannot see the vault, and NEURO's nightly write-back is the one
  // writer to those files. This is what it will read.
  if (extraction.goal_notes.length) {
    const block = ['## Goal progress (from the transcript)',
      ...extraction.goal_notes.map((g) => `- **${g.goal}** — ${g.note}`)].join('\n');
    const current = session.notes_text ?? '';
    const merged = current.includes('## Goal progress (from the transcript)')
      ? current.replace(/## Goal progress \(from the transcript\)[\s\S]*?(?=\n## |$)/, `${block}\n`)
      : (current ? `${current.trim()}\n\n${block}` : block);
    await execute(`UPDATE agent_121_sessions SET notes_text = ? WHERE id = ?`, [merged, sessionId]);
  }

  await execute(`UPDATE agent_121_sessions SET extracted_at = GETUTCDATE() WHERE id = ?`, [sessionId]);

  return {
    ok: true, sessionId, claimed, created,
    goalNotes: extraction.goal_notes.length,
    extraction,
  };
}

/**
 * Read every attached-but-unread transcript.
 *
 * Hourly rather than on attach: Plaud transcribes asynchronously, so a recording attached
 * moments after the meeting often has no transcript yet. Sessions are only marked read on
 * success, so "not ready yet" is retried on the next pass rather than lost — and an
 * `extracted_at` stamp is what stops it paying for an LLM call over the same 1-2-1 again.
 */
export async function runTranscriptExtraction(
  deps: { settingsQueries: FileSettingsQueries; plaudService: PlaudService },
  limit = 10,
): Promise<{ processed: number; claimed: number; created: number; skipped: string[] }> {
  const out = { processed: 0, claimed: 0, created: 0, skipped: [] as string[] };
  // Deliberately NOT gated on Plaud MCP being configured. Transcripts approved over the
  // NEURO bridge are already stored on the session, and in prod the MCP connection has
  // never been authorised — gating here would make the whole feature a no-op forever.

  const pending = await query<{ id: number; agent_name: string }>(`
    SELECT TOP (?) id, agent_name FROM agent_121_sessions
    WHERE (transcript_text IS NOT NULL OR plaud_recording_id IS NOT NULL)
      AND extracted_at IS NULL
      AND status IN ('complete', 'in_progress')
    ORDER BY scheduled_date DESC
  `, [limit]);

  for (const s of pending) {
    const r = await extractSessionOutcomes(deps, s.id);
    if (!r.ok || r.error) { out.skipped.push(`${s.agent_name}: ${r.error ?? 'failed'}`); continue; }
    out.processed++;
    out.claimed += r.claimed;
    out.created += r.created;
  }
  return out;
}

/** Actions this agent's transcripts have claimed as done, awaiting confirmation. */
export async function getClaimedActions(agentName: string): Promise<Array<{
  id: number; description: string; owner: string | null; due_date: string | null;
  claim_evidence: string | null; claimed_at: string | null; claimed_on: string | null;
}>> {
  return query(`
    SELECT a.id, a.description, a.owner, a.due_date, a.claim_evidence, a.claimed_at,
           CONVERT(varchar(10), s.scheduled_date, 23) AS claimed_on
    FROM agent_121_actions a
    LEFT JOIN agent_121_sessions s ON s.id = a.claim_session_id
    WHERE a.agent_name = ? AND a.status = 'claimed'
    ORDER BY a.claimed_at ASC
  `, [agentName]);
}

/**
 * Confirm or reject a claimed completion.
 *
 * Rejecting sends it back to `carried_over` rather than to its original status: it IS a
 * carried-over commitment at that point, and it must reappear in the outstanding list
 * next time rather than quietly returning to the pile it came from.
 */
export async function resolveClaim(actionId: number, confirmed: boolean): Promise<void> {
  if (confirmed) {
    await execute(
      `UPDATE agent_121_actions SET status = 'delivered', completed_at = COALESCE(claimed_at, GETUTCDATE())
       WHERE id = ? AND status = 'claimed'`,
      [actionId]);
  } else {
    await execute(
      `UPDATE agent_121_actions SET status = 'carried_over', claim_evidence = NULL, claim_session_id = NULL, claimed_at = NULL
       WHERE id = ? AND status = 'claimed'`,
      [actionId]);
  }
}
