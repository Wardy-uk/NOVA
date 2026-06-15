// P2 (KPI retirement parity): NOVA-owned KPI email digests, reading the Rebuild
// tables/engines instead of the legacy jira_kpi_daily path. Replaces the three
// Outlook sends in the n8n "Daily KPI Report v4" workflow:
//   1. Daily KPI comparison  (today vs previous vs target, + LLM narrative)  → kpi-org
//   2. Exceptions / Evidence (no-reply + over-SLA ticket-level detail)        → jira_issue_cache
//   3. Agent KPI report      (per-agent scorecard with RAG)                   → kpi-agent
//
// Gated by `kpi_email_digests_enabled` (default off) so NOVA does NOT double-send
// while the n8n workflow is still active — flip the flag when n8n is retired.
// Recipients are settings-driven, defaulting to the n8n hard-coded addresses.

import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { EmailService } from './email.js';
import { query } from './database.js';
import { loadPrompt } from './prompt-loader.js';
import { DailyDigestSchema, type DailyDigest } from './kpi-schemas.js';
import { getAgentLiveSnapshot } from './kpi-agent/index.js';
import { slaBreached, isNoReply, parseDate } from './kpi-agent/compute.js';
import { getSupportLiveSnapshot } from './kpi-org/live.js';
import { getDay } from './kpi-org/store.js';

export interface KpiEmailDeps {
  settings: SettingsQueries;
  jira: JiraRestClient;
  llm: LlmService;
  email: EmailService;
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmt(v: number | null | undefined, dp = 0): string {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(dp) : '-';
}
function ukNow(): string { return new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }); }
function ukToday(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); }
function ukDate(iso: string | Date | null): string {
  if (!iso) return '';
  const d = iso instanceof Date ? iso : new Date(iso);
  return isNaN(d.getTime()) ? esc(String(iso)) : d.toLocaleString('en-GB', { timeZone: 'Europe/London' });
}
function ragBg(rag: string | null | undefined): string {
  if (rag === 'green') return 'background:#0f2f1c;';
  if (rag === 'red') return 'background:#3a1f24;';
  if (rag === 'amber') return 'background:#3a2f0f;';
  return 'background:#2f2f2f;';
}

/** Resolve a comma-separated recipient setting, falling back to the n8n default. */
function recipients(settings: SettingsQueries, key: string, fallback: string): string[] {
  const raw = settings.get(key)?.trim() || fallback;
  return raw.split(',').map(r => r.trim()).filter(Boolean);
}

/** Send one HTML email per recipient (direct-MX resolves on the recipient's own domain). */
async function sendToAll(email: EmailService, to: string[], subject: string, html: string): Promise<void> {
  for (const recipient of to) {
    await email.send({ to: recipient, subject, text: subject, html });
  }
}

// ── 3. Agent KPI report — direct from the Rebuild kpi-agent live snapshot ──
export async function sendAgentKpiEmail(deps: KpiEmailDeps): Promise<{ sent: boolean; agents: number }> {
  const { settings, jira, email } = deps;
  const snap = await getAgentLiveSnapshot(settings, jira);
  const agents = snap.agents.slice().sort((a, b) =>
    (a.team || '').localeCompare(b.team || '') || (a.agentName || '').localeCompare(b.agentName || ''));

  const td = 'padding:8px 10px;border-bottom:1px solid #444;text-align:center;font-size:13px;';
  const tdL = 'padding:8px 10px;border-bottom:1px solid #444;text-align:left;font-size:13px;';
  const cell = (val: number | null, rag: string | null | undefined, dp = 0) =>
    `<td style="${td}${ragBg(rag)}">${fmt(val, dp)}</td>`;

  const rows = agents.map(a => '<tr>' +
    `<td style="${tdL}white-space:nowrap;">${esc(a.agentName)}</td>` +
    `<td style="${td}">${esc(a.tierCode)}</td>` +
    `<td style="${td}">${a.open ?? 0}</td>` +
    cell(a.overSla, a.rag.over2h) +
    cell(a.noReply, a.rag.stale) +
    `<td style="${td}">${a.solvedToday ?? 0}</td>` +
    cell(a.ticketsPerHour, a.rag.productivity, 1) +
    cell(a.csatAvg, a.rag.csat, 1) +
    cell(a.qaOverall, a.rag.qa, 1) +
    cell(a.grOverall, a.rag.goldenRules, 1) +
    '</tr>').join('');

  const html = '<div style="font-family:Inter,Arial,sans-serif;color:#ffffff;">' +
    '<h2 style="margin:0 0 12px 0;">Agent KPI Report</h2>' +
    '<table style="border-collapse:collapse;width:100%;font-size:13px;"><thead>' +
    '<tr style="background:#1b6b73;">' +
    `<th style="${tdL}">Agent</th><th style="${td}">Tier</th><th style="${td}">Open</th>` +
    `<th style="${td}">&gt;2h</th><th style="${td}">Stale</th><th style="${td}">Solved</th>` +
    `<th style="${td}">Tix/Hr</th><th style="${td}">CSAT</th><th style="${td}">QA</th><th style="${td}">Rules</th>` +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div style="margin-top:10px;font-size:11px;color:#c7e5e9;">' +
    'Green = on target | Amber = borderline | Red = off target | Grey = no data<br>' +
    'Tix/Hr: solved today / 7.5h. CSAT: avg satisfaction (1-5). QA: avg overall (1-5). Rules: avg golden rules (1-3).' +
    '</div></div>';

  const to = recipients(settings, 'kpi_agent_email_recipients', 'nickw@nurtur.tech, Nathan.Rutland@nurtur.tech');
  await sendToAll(email, to, `Agent KPI Report - ${ukToday()}`, html);
  console.log(`[kpi-email] agent KPI report sent to ${to.length} recipient(s), ${agents.length} agents`);
  return { sent: true, agents: agents.length };
}

// ── 1. Daily KPI comparison — Rebuild kpi-org live + previous day + LLM narrative ──
function prevDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function sendDailyKpiEmail(deps: KpiEmailDeps): Promise<{ sent: boolean; rows: number }> {
  const { settings, jira, llm, email } = deps;
  const snap = await getSupportLiveSnapshot(jira);
  const yesterday = await getDay('Support', prevDay(snap.day)).catch(() => []);
  const prevMap = new Map(yesterday.map(r => [r.kpi_key, r.value] as [string, number | null]));

  const rendered = snap.items.filter(i => i.value !== null || i.target !== null);

  // LLM narrative (reuse the existing daily-digest prompt, fed Rebuild data).
  const kpiData = rendered.map(i =>
    `${i.label}: ${i.value ?? '—'} (target: ${i.target ?? '—'}, RAG: ${i.rag ?? 'n/a'})`).join('\n') || 'No KPI data';
  let summaryHtml = '';
  try {
    const prompt = loadPrompt('kpi-daily-digest', { date: snap.day, kpi_data: kpiData, agent_data: '', queue_health: kpiData });
    const result = await llm.call<DailyDigest>(prompt, 'Generate the daily KPI digest for today.', DailyDigestSchema,
      { temperature: 0.3, callType: 'kpi_daily_digest' });
    const d = result.data;
    const bullets = (d.kpi_summary || []).map(b => `<li>${esc(b)}</li>`).join('');
    const concerns = (d.concerns || []).length ? `<p><strong>Concerns:</strong></p><ul>${d.concerns.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '';
    summaryHtml = `<h2 style="margin:0 0 8px 0;">${esc(d.headline)}</h2>${bullets ? `<ul>${bullets}</ul>` : ''}${concerns}<p style="color:#c7e5e9;"><em>${esc(d.narrative)}</em></p>`;
  } catch (err) {
    console.warn('[kpi-email] daily narrative LLM failed, sending table only:', err instanceof Error ? err.message : err);
  }

  const tdL = 'padding:10px 12px;border-bottom:1px solid #444;text-align:left;';
  const tdR = 'padding:10px 12px;border-bottom:1px solid #444;text-align:right;';
  const tableHtml = rendered.map(i => {
    const prev = prevMap.get(i.key);
    const delta = (i.value !== null && prev !== null && prev !== undefined) ? i.value - prev : null;
    return `<tr style="${ragBg(i.rag)}">` +
      `<td style="${tdL}">${esc(i.label)}</td>` +
      `<td style="${tdR}">${prev ?? ''}</td>` +
      `<td style="${tdR}">${i.value ?? ''}</td>` +
      `<td style="${tdR}">${i.target ?? ''}</td>` +
      `<td style="${tdR}">${delta === null ? '' : (delta > 0 ? `+${delta}` : delta)}</td></tr>`;
  }).join('');

  const html = '<div style="font-family:Inter,Arial,sans-serif;color:#ffffff;">' + summaryHtml +
    '<h2 style="margin:20px 0 12px 0;">Daily KPI Comparison</h2>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px;"><thead>' +
    `<tr style="background:#1b6b73;"><th style="${tdL}">KPI</th><th style="${tdR}">Previous</th>` +
    `<th style="${tdR}">Current</th><th style="${tdR}">Target</th><th style="${tdR}">Delta</th></tr></thead>` +
    '<tbody>' + tableHtml + '</tbody></table>' +
    '<div style="margin-top:10px;font-size:12px;color:#c7e5e9;">Green = on target | Amber = borderline | Red = off target | Grey = no target</div></div>';

  const to = recipients(settings, 'kpi_digest_recipients', 'nickw@nurtur.tech, Nathan.Rutland@nurtur.tech');
  await sendToAll(email, to, `Daily KPI Report - ${snap.day}`, html);
  console.log(`[kpi-email] daily KPI report sent to ${to.length} recipient(s), ${rendered.length} KPIs`);
  return { sent: true, rows: rendered.length };
}

// ── 2. Exceptions / Evidence — no-reply + over-SLA ticket-level detail ──
interface EvidenceTicket {
  key: string; summary: string; status: string; priority: string; assignee: string; requester: string;
  lastUpdate: string; nextUpdate: string; slaRemaining: string; slaBreachTime: string;
}

function slaRemainingText(fieldsJson: string | null): { remaining: string; breachTime: string } {
  if (!fieldsJson) return { remaining: '', breachTime: '' };
  try {
    const oc = JSON.parse(fieldsJson)?.customfield_14048?.ongoingCycle;
    return {
      remaining: oc?.remainingTime?.friendly ?? '',
      breachTime: oc?.breachTime?.iso8601 ?? oc?.breachTime?.epochMillis ?? '',
    };
  } catch { return { remaining: '', breachTime: '' }; }
}

export async function sendEvidenceEmail(deps: KpiEmailDeps): Promise<{ sent: boolean; noReply: number; overSla: number }> {
  const { settings, email } = deps;
  const now = new Date();
  const endToday = new Date(now); endToday.setUTCHours(23, 59, 59, 999);
  const NOT_ACTIONABLE = new Set(['waiting on requestor', 'waiting on partner', 'waiting on development']);

  const rows = await query<{
    issue_key: string; summary: string | null; status_name: string | null; current_tier: string | null;
    priority_name: string | null; assignee_display: string | null; reporter_display: string | null;
    jira_created: Date | null; agent_last_updated: Date | null; agent_next_update: Date | null;
    due_date: Date | null; fields_json: string | null;
  }>(`
    SELECT issue_key, summary, status_name, current_tier, priority_name, assignee_display, reporter_display,
           jira_created, agent_last_updated, agent_next_update, due_date, fields_json
    FROM jira_issue_cache
    WHERE project_key = 'NT' AND status_category <> 'Done'
  `);

  const noReplyByTier = new Map<string, EvidenceTicket[]>();
  const overSlaByTier = new Map<string, EvidenceTicket[]>();

  for (const t of rows) {
    const tier = (t.current_tier || 'Unknown').trim();
    const status = (t.status_name || '').toLowerCase();
    const sla = slaRemainingText(t.fields_json);
    const ticket: EvidenceTicket = {
      key: t.issue_key, summary: t.summary ?? '', status: t.status_name ?? '', priority: t.priority_name ?? '',
      assignee: t.assignee_display ?? '', requester: t.reporter_display ?? '',
      lastUpdate: ukDate(t.agent_last_updated), nextUpdate: ukDate(t.agent_next_update),
      slaRemaining: sla.remaining, slaBreachTime: ukDate(sla.breachTime || null),
    };

    if (isNoReply(t.status_name, parseDate(t.jira_created), parseDate(t.agent_last_updated), parseDate(t.agent_next_update), now)) {
      (noReplyByTier.get(tier) ?? noReplyByTier.set(tier, []).get(tier)!).push(ticket);
    }
    const actionable = !NOT_ACTIONABLE.has(status);
    if (actionable && slaBreached(t.fields_json, 'customfield_14048', true) === true) {
      const dueOk = !t.due_date || new Date(t.due_date) <= endToday;
      if (dueOk && !/development/i.test(tier)) {
        (overSlaByTier.get(tier) ?? overSlaByTier.set(tier, []).get(tier)!).push(ticket);
      }
    }
  }

  const totalNoReply = [...noReplyByTier.values()].reduce((a, l) => a + l.length, 0);
  const totalOverSla = [...overSlaByTier.values()].reduce((a, l) => a + l.length, 0);

  const summaryTable = (title: string, m: Map<string, EvidenceTicket[]>, total: number) => {
    const body = [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([tier, list]) =>
      `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${esc(tier)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${list.length}</td></tr>`).join('');
    return `<div style="margin-top:16px;"><h2 style="margin:0 0 8px;font-size:18px;color:#272c33;">${esc(title)} (Total: ${total})</h2>` +
      '<div style="border:1px solid #e6e6e6;border-radius:12px;overflow:hidden;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
      '<thead><tr style="background:#5ec1ca;color:#fff;"><th style="text-align:left;padding:10px;">Tier</th><th style="text-align:right;padding:10px;">Count</th></tr></thead>' +
      `<tbody>${body || '<tr><td colspan="2" style="padding:12px;color:#666;">No rows.</td></tr>'}</tbody></table></div></div>`;
  };

  const evidenceBlocks = (heading: string, m: Map<string, EvidenceTicket[]>, sla: boolean) => {
    if (!m.size) return '';
    const headExtra = sla ? '<th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">SLA Remaining</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Breach Time</th>' : '';
    const blocks = [...m.entries()].sort((a, b) => b[1].length - a[1].length).map(([tier, list]) => {
      const ticketRows = list.slice(0, 50).map(t => '<tr>' +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;"><strong>${esc(t.key)}</strong></td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.summary)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.status)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.priority)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.assignee)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.requester)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.lastUpdate)}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.nextUpdate)}</td>` +
        (sla ? `<td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.slaRemaining)}</td><td style="padding:8px;border-bottom:1px solid #f0f0f0;">${esc(t.slaBreachTime)}</td>` : '') +
        '</tr>').join('');
      return `<div style="margin-top:22px;"><h3 style="margin:0 0 10px;font-size:16px;color:#272c33;">${esc(tier)} <span style="color:#5ec1ca;">(${list.length})</span></h3>` +
        '<div style="border:1px solid #e6e6e6;border-radius:10px;overflow:hidden;"><table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<thead><tr style="background:#fafafa;"><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Key</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Summary</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Status</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Priority</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Assignee</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Requester</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Last Update</th><th style="text-align:left;padding:8px;border-bottom:1px solid #eee;">Next Update</th>' + headExtra + '</tr></thead>' +
        `<tbody>${ticketRows}</tbody></table></div></div>`;
    }).join('');
    return `<hr style="border:0;border-top:1px solid #eee;margin:22px 0;"><h2 style="margin:0 0 8px;font-size:18px;color:#272c33;">${esc(heading)}</h2>${blocks}`;
  };

  const html = '<!doctype html><html><body style="margin:0;background:#fff;font-family:Inter,Arial,sans-serif;color:#272c33;">' +
    '<div style="max-width:980px;margin:0 auto;padding:22px;">' +
    '<h1 style="margin:0 0 6px;font-size:20px;">KPI Exceptions Snapshot</h1>' +
    `<p style="margin:0 0 16px;color:#595959;">Generated: ${esc(ukNow())} &middot; No-Reply: <strong>${totalNoReply}</strong> &middot; Over-SLA: <strong>${totalOverSla}</strong></p>` +
    summaryTable('No-Reply Snapshot', noReplyByTier, totalNoReply) +
    summaryTable('Over-SLA Snapshot', overSlaByTier, totalOverSla) +
    evidenceBlocks('No-Reply Evidence', noReplyByTier, false) +
    evidenceBlocks('Over-SLA Evidence', overSlaByTier, true) +
    '<p style="margin:24px 0 0;color:#828082;font-size:12px;">Automated report &middot; NOVA</p></div></body></html>';

  const to = recipients(settings, 'kpi_evidence_recipients', 'nickw@nurtur.tech');
  await sendToAll(email, to, `KPI Exceptions - No-Reply ${totalNoReply} / Over-SLA ${totalOverSla} - ${ukNow()}`, html);
  console.log(`[kpi-email] evidence report sent to ${to.length} recipient(s): ${totalNoReply} no-reply, ${totalOverSla} over-SLA`);
  return { sent: true, noReply: totalNoReply, overSla: totalOverSla };
}

/** Run all three KPI emails, gated by `kpi_email_digests_enabled`. Never throws. */
export async function sendAllKpiEmails(deps: KpiEmailDeps): Promise<void> {
  if (deps.settings.get('kpi_email_digests_enabled') !== 'true') return;
  if (!deps.email.isConfigured()) {
    console.warn('[kpi-email] kpi_email_digests_enabled but email not configured — skipping');
    return;
  }
  for (const [name, fn] of [
    ['daily', sendDailyKpiEmail], ['evidence', sendEvidenceEmail], ['agent', sendAgentKpiEmail],
  ] as const) {
    try { await fn(deps); }
    catch (err) { console.error(`[kpi-email] ${name} email failed:`, err instanceof Error ? err.message : err); }
  }
}
