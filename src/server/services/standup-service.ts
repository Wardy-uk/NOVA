/**
 * Shared business logic for the daily team standup, called from both the HTTP
 * routes (routes/team-standup.ts) and the scheduled jobs (index.ts).
 */
import type { TeamStandupQueries, CommitmentStatus } from '../db/team-standup-queries.js';
import type { JiraRestClient } from './jira-client.js';
import type { PlaudService } from './plaud-service.js';
import type { EmailService } from './email.js';
import type { AuditQueries } from '../db/audit.js';
import { buildStandupBrief, findAgentBrief, type StandupBrief } from './standup-brief.js';
import { standupPromptHtml, standupAccountabilityHtml } from './email-templates.js';
import { TEAM_AGENTS } from '../../shared/team-standup.js';
import { agentEmail, nickEmail, novaBaseUrl } from '../config/standup-config.js';

export interface StandupDeps {
  standupQueries: TeamStandupQueries;
  getJiraClient: () => JiraRestClient | null;
  plaudService: PlaudService;
  emailService: EmailService;
  auditQueries: AuditQueries;
}

/** YYYY-MM-DD for "today" in UK time. */
export function ukToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/** YYYY-MM-DD for N days ago in UK time. */
export function ukDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

/** Human display date, e.g. "Monday 15 June". */
export function displayDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}

// ── Jira brief ──

/** Build the Jira brief for a date and persist it to the session. Returns the brief. */
export async function refreshBrief(date: string, deps: StandupDeps): Promise<StandupBrief> {
  const client = deps.getJiraClient();
  if (!client) throw new Error('Jira is not configured — cannot build the standup brief.');
  const brief = await buildStandupBrief(client);
  await deps.standupQueries.ensureSession(date);
  await deps.standupQueries.updateSession(date, { brief_json: JSON.stringify(brief) });
  return brief;
}

// ── Plaud import ──

export interface PlaudImportResult {
  found: boolean;
  recordingId?: string;
  alreadyImported?: boolean;
  error?: string;
}

/** Find and import the standup recording for a date. Never throws on "not found". */
export async function importPlaudRecording(date: string, deps: StandupDeps): Promise<PlaudImportResult> {
  const session = await deps.standupQueries.ensureSession(date);
  if (session.plaud_recording_id && session.transcript_text) {
    return { found: true, recordingId: session.plaud_recording_id, alreadyImported: true };
  }
  if (!deps.plaudService.isConfigured()) {
    return { found: false, error: 'Plaud not configured' };
  }
  try {
    const recording = await deps.plaudService.findStandupRecording(date);
    if (!recording) return { found: false };
    const [transcript, notes] = await Promise.all([
      deps.plaudService.getTranscript(recording.id),
      deps.plaudService.getNotes(recording.id),
    ]);
    // Don't clobber an accountability report already appended to notes_text.
    const existingNotes = session.notes_text ?? '';
    const mergedNotes = existingNotes.includes('## Accountability report')
      ? `${notes}\n\n${existingNotes}`.trim()
      : notes;
    await deps.standupQueries.updateSession(date, {
      plaud_recording_id: recording.id,
      transcript_text: transcript,
      notes_text: mergedNotes || existingNotes || null,
    });
    return { found: true, recordingId: recording.id };
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Accountability report ──

export interface AgentAccountability {
  agent_name: string;
  submitted: boolean;
  commitments: number;
  delivered: number;
  missed: number;
  excused: number;
  pending: number;
}

export interface AccountabilityReport {
  date: string;
  submitted: number;
  totalAgents: number;
  stats: { total: number; delivered: number; missed: number; excused: number; pending: number; deliveryRate: number };
  perAgent: AgentAccountability[];
  commitments: Array<{ id: number; agent_name: string; commitment_text: string; status: CommitmentStatus }>;
}

export async function buildAccountabilityReport(date: string, deps: StandupDeps): Promise<AccountabilityReport | null> {
  const session = await deps.standupQueries.getSession(date);
  if (!session) return null;
  const submissions = await deps.standupQueries.getSubmissions(session.id);
  const commitments = await deps.standupQueries.getCommitments(session.id);
  const submittedNames = new Set(submissions.map((s) => s.agent_name));

  const perAgent: AgentAccountability[] = TEAM_AGENTS.map((name) => {
    const own = commitments.filter((c) => c.agent_name === name);
    return {
      agent_name: name,
      submitted: submittedNames.has(name),
      commitments: own.length,
      delivered: own.filter((c) => c.status === 'delivered').length,
      missed: own.filter((c) => c.status === 'missed').length,
      excused: own.filter((c) => c.status === 'excused').length,
      pending: own.filter((c) => c.status === 'pending').length,
    };
  });

  const delivered = commitments.filter((c) => c.status === 'delivered').length;
  const missed = commitments.filter((c) => c.status === 'missed').length;
  const excused = commitments.filter((c) => c.status === 'excused').length;
  const pending = commitments.filter((c) => c.status === 'pending').length;
  const reviewed = delivered + missed;
  const deliveryRate = reviewed > 0 ? Math.round((delivered / reviewed) * 100) : 0;

  return {
    date,
    submitted: submissions.length,
    totalAgents: TEAM_AGENTS.length,
    stats: { total: commitments.length, delivered, missed, excused, pending, deliveryRate },
    perAgent,
    commitments: commitments.map((c) => ({
      id: c.id, agent_name: c.agent_name, commitment_text: c.commitment_text, status: c.status,
    })),
  };
}

function reportToMarkdown(r: AccountabilityReport): string {
  const lines: string[] = [];
  lines.push('## Accountability report');
  lines.push(`**${displayDate(r.date)}** — ${r.submitted} of ${r.totalAgents} agents submitted.`);
  lines.push(`Delivered ${r.stats.delivered} · Missed ${r.stats.missed} · Excused ${r.stats.excused} · Awaiting review ${r.stats.pending} (delivery rate ${r.stats.deliveryRate}%)`);
  lines.push('');
  lines.push('### Per agent');
  for (const a of r.perAgent.filter((a) => a.commitments > 0 || a.submitted)) {
    lines.push(`- **${a.agent_name}** — ${a.commitments} commitment(s): ${a.delivered} delivered, ${a.missed} missed, ${a.pending} pending${a.submitted ? '' : ' _(did not submit)_'}`);
  }
  lines.push('');
  lines.push('### Commitments');
  for (const c of r.commitments) {
    lines.push(`- [${c.status}] ${c.agent_name}: ${c.commitment_text}`);
  }
  return lines.join('\n');
}

/**
 * Job 2 — accountability report for a date (default yesterday): build the report,
 * append it to notes_text, attempt a Plaud import, and email Nick.
 */
export async function runAccountabilityReport(date: string, deps: StandupDeps): Promise<{ ok: boolean; report: AccountabilityReport | null }> {
  const report = await buildAccountabilityReport(date, deps);
  if (!report) return { ok: false, report: null };

  // Append report markdown to notes_text (preserve any transcript notes already there).
  const session = await deps.standupQueries.getSession(date);
  const md = reportToMarkdown(report);
  const existing = session?.notes_text ?? '';
  const withoutOldReport = existing.split('## Accountability report')[0].trim();
  const merged = withoutOldReport ? `${withoutOldReport}\n\n${md}` : md;
  await deps.standupQueries.updateSession(date, { notes_text: merged });

  // Best-effort transcript import (don't fail the report if Plaud is down).
  try { await importPlaudRecording(date, deps); } catch { /* logged inside */ }

  // Email Nick.
  if (deps.emailService.isConfigured()) {
    try {
      const html = standupAccountabilityHtml({
        dateDisplay: displayDate(date),
        submitted: report.submitted,
        totalAgents: report.totalAgents,
        delivered: report.stats.delivered,
        missed: report.stats.missed,
        pending: report.stats.pending,
        agents: report.perAgent
          .filter((a) => a.commitments > 0)
          .map((a) => ({ name: a.agent_name, commitments: a.commitments, delivered: a.delivered, missed: a.missed, pending: a.pending })),
        sessionUrl: `${novaBaseUrl()}/#standup-board?date=${date}`,
      });
      await deps.emailService.send({
        to: nickEmail(),
        subject: `Standup accountability — ${displayDate(date)}`,
        text: md,
        html,
      });
    } catch (err) {
      console.warn('[standup] accountability email failed:', err instanceof Error ? err.message : err);
    }
  }
  return { ok: true, report };
}

// ── Morning prompts (Job 1) ──

export interface MorningPromptResult {
  date: string;
  sent: number;
  skipped: number;
  failed: number;
  noEmail: string[];
}

/**
 * Job 1 — morning prompt emails. Idempotent: each (session, agent) send is logged
 * and never repeated within a day. Per-agent failures are logged and skipped.
 */
export async function sendMorningPrompts(date: string, deps: StandupDeps): Promise<MorningPromptResult> {
  const session = await deps.standupQueries.ensureSession(date);

  // Pull a fresh brief so emails can include queue data; tolerate Jira failure.
  let brief: StandupBrief | null = null;
  try {
    brief = await refreshBrief(date, deps);
  } catch (err) {
    console.warn('[standup] morning brief unavailable:', err instanceof Error ? err.message : err);
    if (session.brief_json) { try { brief = JSON.parse(session.brief_json); } catch { /* ignore */ } }
  }

  const result: MorningPromptResult = { date, sent: 0, skipped: 0, failed: 0, noEmail: [] };
  if (!deps.emailService.isConfigured()) {
    console.warn('[standup] email not configured — skipping morning prompts');
    return result;
  }

  for (const name of TEAM_AGENTS) {
    const to = agentEmail(name);
    if (!to) { result.noEmail.push(name); continue; }
    if (await deps.standupQueries.wasEmailSent(session.id, name)) { result.skipped++; continue; }

    const agentBrief = findAgentBrief(brief, name);
    const queue = agentBrief
      ? { total: agentBrief.total, over5: agentBrief.over5_count, oldest: agentBrief.oldest ? `${agentBrief.oldest.key} (${agentBrief.oldest.ageDays}d)` : null }
      : null;

    try {
      await deps.emailService.send({
        to,
        subject: `Standup prep — ${displayDate(date)}`,
        text: `Before today's standup, please take 2 minutes to submit your numbers and commitments.\n\n${novaBaseUrl()}/standup/submit/${date}\n\nSee you at standup.`,
        html: standupPromptHtml({ name, dateDisplay: displayDate(date), submitUrl: `${novaBaseUrl()}/standup/submit/${date}`, queue }),
      });
      // Mark sent only after a successful send so a transient failure can retry next tick.
      await deps.standupQueries.logEmailSend(session.id, name);
      await deps.auditQueries.log(0, 'standup', `${date}:${name}`, 'morning_prompt_sent').catch(() => {});
      result.sent++;
    } catch (err) {
      console.warn(`[standup] prompt to ${name} <${to}> failed:`, err instanceof Error ? err.message : err);
      result.failed++;
    }
  }
  return result;
}
