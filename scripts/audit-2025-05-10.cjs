/**
 * NOVA AI Agent Audit — May 2026
 * Improved audit: fixes broken comparison logic, adds approval/autonomy/portal/KB analysis.
 * Usage: node scripts/audit-2025-05-10.cjs [--7d]
 *
 * Default: 24-hour window. Pass --7d for a 7-day window.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ──
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const NOVA_BASE = 'http://100.118.199.1:3069';
const CONCURRENCY = 5;
const N8N_ACCOUNT_ID = '712020:ac84e46b-ecff-4878-974c-2825b0497d54';

const is7d = process.argv.includes('--7d');
const windowDays = is7d ? 7 : 1;
const windowLabel = is7d ? '7d' : '24h';

const now = new Date();
const fromDate = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
const toDate = now.toISOString().substring(0, 10);

const JQL = `project = NT AND created >= "${fromDate}" ORDER BY created ASC`;
const OUTPUT_JSON = path.join(__dirname, '..', `audit-${windowLabel}-${toDate}.json`);
const REPORT_PATH = path.join(__dirname, '..', 'docs', `agent-audit-${windowLabel}-${toDate}.md`);

// ── Load settings ──
const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
const settings = raw.settings || raw;
const JIRA_URL = (settings.jira_url || '').replace(/\/+$/, '');
const JIRA_EMAIL = settings.jira_username;
const JIRA_TOKEN = settings.jira_token;
const JWT_SECRET = settings.jwt_secret;

if (!JIRA_URL || !JIRA_EMAIL || !JIRA_TOKEN) { console.error('Missing Jira credentials in settings.json'); process.exit(1); }
if (!JWT_SECRET) { console.error('Missing jwt_secret in settings.json'); process.exit(1); }

// ── JWT generation ──
function makeJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: nowSec, exp: nowSec + 3600 };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

const novaToken = makeJwt({ id: 1, username: 'nickw', role: 'admin' }, JWT_SECRET);
const jiraAuth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function pct(n, total) { return total ? `${((n / total) * 100).toFixed(1)}%` : '0%'; }
function pctN(n, total) { return total ? ((n / total) * 100).toFixed(1) : 0; }

async function jiraGet(p, method = 'GET', body = null, retries = 2) {
  const url = `${JIRA_URL}/rest/api/3/${p}`;
  const opts = {
    method,
    headers: { Authorization: jiraAuth, Accept: 'application/json', 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    if (res.status === 429 && retries > 0) {
      const wait = parseInt(res.headers.get('Retry-After') || '5', 10) * 1000;
      console.log(`  Rate limited, waiting ${wait}ms...`);
      await sleep(wait);
      return jiraGet(p, method, body, retries - 1);
    }
    if (!res.ok) throw new Error(`Jira ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  } catch (err) {
    if (retries > 0) { await sleep(2000); return jiraGet(p, method, body, retries - 1); }
    throw err;
  }
}

async function novaGet(p) {
  const res = await fetch(`${NOVA_BASE}${p}`, {
    headers: { Authorization: `Bearer ${novaToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`NOVA ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function mapWithConcurrency(items, fn, limit) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function extractTextFromAdf(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  let text = '';
  if (adf.text) text += adf.text;
  if (adf.content) {
    for (const child of adf.content) {
      text += extractTextFromAdf(child);
      if (['paragraph', 'heading', 'listItem', 'tableRow', 'bulletList', 'orderedList'].includes(child.type)) text += '\n';
    }
  }
  if (adf.type === 'hardBreak') text += '\n';
  return text;
}

// ── Classify n8n actions (v2 multi-signal) ──
function classifyN8nActions(comments) {
  let recommendedTier = null, aiSummaryPriority = null, postedPublicReply = false;
  let roundRobinAssigned = false, roundRobinAssignee = null, aiSummaryBody = null;
  const actions = [];

  for (const c of comments) {
    const body = c.body || '';
    const isPublic = c.jsdPublic === true;

    if (body.includes('AI Summary') || body.includes('AI summary')) {
      const tierMatch = body.match(/\*\*Recommended Tier:\*\*\s*([^\n*]+)/i);
      const prioMatch = body.match(/\*\*Priority:\*\*\s*(Low|Medium|High|Critical)/i);
      recommendedTier = tierMatch ? tierMatch[1].trim() : null;
      aiSummaryPriority = prioMatch ? prioMatch[1].trim() : null;
      aiSummaryBody = body;
      actions.push({ type: 'ai_summary', created: c.created, recommendedTier, priority: aiSummaryPriority });
      continue;
    }
    if (/auto-assigned by|round robin/i.test(body)) {
      roundRobinAssigned = true;
      const m = body.match(/assigned (?:to|by[^.]*?to)\s+([^.(\n]+)/i) || body.match(/Auto-assigned[^:]*:\s*(.+)/i);
      roundRobinAssignee = m ? m[1].trim() : null;
      actions.push({ type: 'assign', created: c.created, assignee: roundRobinAssignee });
      continue;
    }
    if (isPublic) {
      postedPublicReply = true;
      actions.push({ type: 'respond', created: c.created });
      continue;
    }
    actions.push({ type: 'uncategorised', created: c.created, bodySnippet: body.substring(0, 120) });
  }

  return {
    actions,
    groundTruth: {
      ai_summary_recommended_tier: recommendedTier,
      ai_summary_priority: aiSummaryPriority,
      posted_public_reply: postedPublicReply,
      round_robin_assigned: roundRobinAssigned,
      round_robin_assignee: roundRobinAssignee,
    },
    aiSummaryBody,
  };
}

// ── Improved comparison logic ──
// Categories: agree, complementary, proactive, real_disagree, no_comparison
function compareNovaVsGt(novaDecisions, gt) {
  if (!novaDecisions || novaDecisions.length === 0 || !gt) return { verdict: 'no_comparison', reason: 'missing data' };

  // Use the FIRST triage decision (ticket_created), not the latest
  const triageDecision = novaDecisions.find(d => d.event_type === 'ticket_created')
    || novaDecisions.reduce((a, b) => new Date(a.created_at) < new Date(b.created_at) ? a : b);

  const nova = triageDecision.action;
  const conf = triageDecision.confidence || 0;
  const shadow = triageDecision.shadow_mode;
  const model = triageDecision.model;

  const n8nResponded = gt.posted_public_reply;
  const n8nAssigned = gt.round_robin_assigned;
  const n8nTier = (gt.ai_summary_recommended_tier || '').toLowerCase();
  const n8nTierIsT3Dev = n8nTier.includes('3') || n8nTier.includes('development') || n8nTier.includes('dev team');

  // ESCALATE actions
  if (['escalate', 'escalate_to_t2', 'escalate_to_t3'].includes(nova)) {
    if (n8nTierIsT3Dev) return { verdict: 'agree', reason: 'both escalate' };
    if (n8nResponded && !n8nTierIsT3Dev) return { verdict: 'real_disagree', bucket: 'over_escalation', reason: `NOVA escalated but n8n tier=${gt.ai_summary_recommended_tier || 'T1/T2'}` };
    if (n8nAssigned && !n8nResponded) return { verdict: 'real_disagree', bucket: 'over_escalation', reason: 'NOVA escalated but n8n only assigned' };
    if (!n8nResponded && !n8nAssigned) return { verdict: 'real_disagree', bucket: 'over_escalation', reason: 'NOVA escalated but n8n took no action' };
    return { verdict: 'real_disagree', bucket: 'over_escalation', reason: 'NOVA escalated but n8n responded at lower tier' };
  }

  // RESPOND / DRAFT actions
  if (['draft_response', 'respond'].includes(nova)) {
    if (n8nResponded) return { verdict: 'agree', reason: 'both respond' };
    if (n8nAssigned && !n8nResponded) return { verdict: 'complementary', reason: 'NOVA drafted + n8n assigned (complementary)' };
    if (!n8nResponded && !n8nAssigned) return { verdict: 'proactive', reason: 'NOVA drafted but n8n took no action (proactive)' };
    return { verdict: 'complementary', reason: 'NOVA drafted, n8n handled differently' };
  }

  // ASSIGN actions
  if (['assign', 'round_robin', 'plugin_to_tpj'].includes(nova)) {
    if (n8nAssigned) return { verdict: 'agree', reason: 'both assigned' };
    if (n8nResponded) return { verdict: 'complementary', reason: 'NOVA assigned, n8n responded (complementary)' };
    return { verdict: 'proactive', reason: 'NOVA assigned proactively' };
  }

  // NO ACTION
  if (['no_action', 'observe', 'monitor'].includes(nova)) {
    if (!n8nResponded && !n8nAssigned) return { verdict: 'agree', reason: 'both idle' };
    if (n8nResponded) return { verdict: 'real_disagree', bucket: 'false_no_action', reason: 'NOVA idle but n8n responded (missed)' };
    if (n8nAssigned) return { verdict: 'real_disagree', bucket: 'false_no_action', reason: 'NOVA idle but n8n assigned (missed)' };
  }

  // CLOSE / RESOLVE
  if (['close', 'auto_resolve', 'quick_win_close'].includes(nova)) {
    if (!n8nResponded && !n8nAssigned) return { verdict: 'agree', reason: 'both idle/close' };
    return { verdict: 'real_disagree', bucket: 'premature_close', reason: 'NOVA closed but n8n acted' };
  }

  // ABUSE REPORT / SPAM
  if (['abuse_report', 'spam_filter'].includes(nova)) {
    return { verdict: 'no_comparison', reason: `specialized action: ${nova}` };
  }

  return { verdict: 'no_comparison', reason: `unrecognized NOVA action: ${nova}` };
}

// ── Main ──
async function main() {
  console.log(`=== NOVA Agent Audit — ${windowLabel} (${fromDate} → ${toDate}) ===`);
  console.log(`Jira: ${JIRA_URL}  |  NOVA: ${NOVA_BASE}`);

  // Verify NOVA auth
  try {
    const testResp = await novaGet('/api/agent/decisions?limit=1');
    console.log(`NOVA auth OK, test query returned ${testResp.ok ? 'ok' : 'error'}`);
  } catch (e) {
    console.error(`NOVA auth failed: ${e.message}`);
    process.exit(1);
  }

  // ── Phase 1: Collect ticket-level data from Jira + NOVA ──
  console.log('\n── Phase 1: Fetching ticket keys from Jira ──');
  const allTickets = [];
  let nextPageToken = null;
  let pageNum = 0;
  while (true) {
    const payload = { jql: JQL, maxResults: 100, fields: ['key', 'created', 'status', 'summary', 'priority'] };
    if (nextPageToken) payload.nextPageToken = nextPageToken;
    const data = await jiraGet('search/jql', 'POST', payload);
    const issues = data.issues || [];
    for (const iss of issues) {
      allTickets.push({
        key: iss.key,
        created: iss.fields.created,
        status: iss.fields.status?.name || null,
        summary: iss.fields.summary || '',
        priority: iss.fields.priority?.name || null,
      });
    }
    pageNum++;
    console.log(`  Page ${pageNum}: ${issues.length} tickets (total: ${allTickets.length})`);
    if (data.isLast !== false || issues.length === 0) break;
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
  }
  console.log(`Total tickets in window: ${allTickets.length}`);

  // Fetch comments + NOVA decisions per ticket
  console.log('\n── Phase 2: Fetching per-ticket comments + NOVA decisions ──');
  let processed = 0;

  const auditData = await mapWithConcurrency(allTickets, async (ticket) => {
    const result = {
      key: ticket.key, created: ticket.created, status: ticket.status,
      summary: ticket.summary, priority: ticket.priority,
      n8nComments: [], n8nClassification: null, novaDecisions: [],
      comparison: null, fetchError: null,
    };

    try {
      const issueData = await jiraGet(`issue/${ticket.key}?fields=comment&expand=renderedFields`);
      const allComments = issueData.fields?.comment?.comments || [];
      const n8nComments = allComments.filter(c => c.author?.accountId === N8N_ACCOUNT_ID);

      for (const c of n8nComments) {
        let bodyText = '';
        if (c.body && typeof c.body === 'object' && c.body.content) bodyText = extractTextFromAdf(c.body);
        else if (typeof c.body === 'string') bodyText = c.body;
        result.n8nComments.push({
          id: c.id, created: c.created, jsdPublic: c.jsdPublic ?? null,
          body: bodyText, authorAccountId: c.author?.accountId,
        });
      }

      if (result.n8nComments.length > 0) {
        result.n8nClassification = classifyN8nActions(result.n8nComments);
      }
    } catch (err) {
      result.fetchError = `jira: ${err.message}`;
    }

    try {
      const novaResp = await novaGet(`/api/agent/decisions/ticket/${ticket.key}`);
      result.novaDecisions = novaResp.data || [];
    } catch (err) {
      if (!result.fetchError) result.fetchError = '';
      result.fetchError += `nova: ${err.message}`;
    }

    // Run comparison
    if (result.novaDecisions.length > 0 && result.n8nClassification?.groundTruth) {
      result.comparison = compareNovaVsGt(result.novaDecisions, result.n8nClassification.groundTruth);
      result.comparison.novaAction = (result.novaDecisions.find(d => d.event_type === 'ticket_created') || result.novaDecisions[0]).action;
      result.comparison.novaConfidence = (result.novaDecisions.find(d => d.event_type === 'ticket_created') || result.novaDecisions[0]).confidence;
      result.comparison.novaShadow = (result.novaDecisions.find(d => d.event_type === 'ticket_created') || result.novaDecisions[0]).shadow_mode;
      result.comparison.novaModel = (result.novaDecisions.find(d => d.event_type === 'ticket_created') || result.novaDecisions[0]).model;
    }

    processed++;
    if (processed % 50 === 0) console.log(`  Processed ${processed}/${allTickets.length}`);
    return result;
  }, CONCURRENCY);

  // ── Phase 3: Collect NOVA-side aggregate data ──
  console.log('\n── Phase 3: Fetching NOVA aggregate data ──');

  let approvalStats = null, autonomyRules = null, kbGapCounts = null;
  let quickWinStats = null, agentStatus = null, impactData = null;

  const fetchSafe = async (label, fn) => {
    try { return await fn(); } catch (e) { console.log(`  ${label}: ${e.message}`); return null; }
  };

  [approvalStats, autonomyRules, kbGapCounts, quickWinStats, agentStatus] = await Promise.all([
    fetchSafe('approvalStats', async () => (await novaGet('/api/approvals/stats')).data),
    fetchSafe('autonomyRules', async () => (await novaGet('/api/agent/autonomy')).data),
    fetchSafe('kbGapCounts', async () => (await novaGet('/api/agent/kb-gaps/counts')).data),
    fetchSafe('quickWinStats', async () => (await novaGet('/api/agent/quick-win/stats')).data),
    fetchSafe('agentStatus', async () => (await novaGet('/api/agent/status')).data),
  ]);

  // Try to get all decisions with limit for action profile
  let allNovaDecisions = null;
  try {
    const resp = await novaGet(`/api/agent/decisions?limit=500`);
    allNovaDecisions = resp.data || [];
    console.log(`  All NOVA decisions fetched: ${allNovaDecisions.length}`);
  } catch (e) {
    console.log(`  Could not fetch all decisions: ${e.message}`);
  }

  // ── Phase 4: Analysis ──
  console.log('\n── Phase 4: Analysis ──');
  const analysis = analyse(auditData, { approvalStats, autonomyRules, kbGapCounts, quickWinStats, agentStatus, allNovaDecisions });

  // Save raw data
  console.log(`\n── Phase 5: Saving ──`);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ auditData, approvalStats, autonomyRules, kbGapCounts, quickWinStats, agentStatus }, null, 2));
  console.log(`Raw data: ${OUTPUT_JSON}`);

  // Generate & write report
  const report = generateReport(analysis);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`Report: ${REPORT_PATH}`);

  // Console summary
  console.log(`\n── Summary ──`);
  console.log(`Tickets: ${analysis.totalTickets}`);
  console.log(`NOVA coverage: ${pct(analysis.withNovaDecisions, analysis.totalTickets)}`);
  console.log(`Agree: ${analysis.verdicts.agree} | Complementary: ${analysis.verdicts.complementary} | Proactive: ${analysis.verdicts.proactive}`);
  console.log(`Real disagree: ${analysis.verdicts.real_disagree} | No comparison: ${analysis.verdicts.no_comparison}`);
  const effectiveAgree = analysis.verdicts.agree + analysis.verdicts.complementary + analysis.verdicts.proactive;
  const effectiveTotal = effectiveAgree + analysis.verdicts.real_disagree;
  console.log(`Effective alignment: ${pct(effectiveAgree, effectiveTotal)} (${effectiveAgree}/${effectiveTotal})`);
  console.log(`Over-escalation: ${analysis.buckets.over_escalation || 0} | False no_action: ${analysis.buckets.false_no_action || 0} | Premature close: ${analysis.buckets.premature_close || 0}`);
  console.log('\n=== Audit complete ===');
}

// ── Analysis ──
function analyse(data, extras) {
  const s = {
    totalTickets: data.length, fetchFailed: 0,
    withN8nComments: 0, withAiSummary: 0, withPublicReply: 0, withRoundRobin: 0,
    withNovaDecisions: 0, novaDecisionCount: 0,
    perDay: {},
    verdicts: { agree: 0, complementary: 0, proactive: 0, real_disagree: 0, no_comparison: 0 },
    buckets: {},
    disagreements: [],
    noNovaDecision: [],
    // Decision profile
    actionProfile: {},
    shadowCount: 0, liveCount: 0,
    modelProfile: {},
    eventTypeProfile: {},
    confidenceBands: { high: 0, medium: 0, low: 0 },
    // Quick-wins
    quickWinCount: 0, quickWinExecuted: 0, quickWinUndone: 0,
    // Extras
    approvalStats: extras.approvalStats,
    autonomyRules: extras.autonomyRules,
    kbGapCounts: extras.kbGapCounts,
    quickWinStats: extras.quickWinStats,
    agentStatus: extras.agentStatus,
  };

  for (const t of data) {
    const day = t.created ? t.created.substring(0, 10) : 'unknown';
    if (!s.perDay[day]) s.perDay[day] = { total: 0, withN8n: 0, withNova: 0, agree: 0, complementary: 0, proactive: 0, disagree: 0 };
    s.perDay[day].total++;

    if (t.fetchError) s.fetchFailed++;

    const hasN8n = t.n8nComments && t.n8nComments.length > 0;
    const hasNova = t.novaDecisions && t.novaDecisions.length > 0;

    if (hasN8n) { s.withN8nComments++; s.perDay[day].withN8n++; }
    if (hasNova) {
      s.withNovaDecisions++; s.novaDecisionCount += t.novaDecisions.length;
      s.perDay[day].withNova++;

      // Decision profile from this ticket's decisions
      for (const d of t.novaDecisions) {
        s.actionProfile[d.action] = (s.actionProfile[d.action] || 0) + 1;
        if (d.shadow_mode) s.shadowCount++; else s.liveCount++;
        s.modelProfile[d.model || 'unknown'] = (s.modelProfile[d.model || 'unknown'] || 0) + 1;
        s.eventTypeProfile[d.event_type || 'unknown'] = (s.eventTypeProfile[d.event_type || 'unknown'] || 0) + 1;
        const conf = d.confidence || 0;
        if (conf >= 0.8) s.confidenceBands.high++;
        else if (conf >= 0.5) s.confidenceBands.medium++;
        else s.confidenceBands.low++;
        // Quick-win tracking
        if (d.quick_win_type) s.quickWinCount++;
        if (d.quick_win_executed) s.quickWinExecuted++;
        if (d.quick_win_undone) s.quickWinUndone++;
      }
    } else {
      s.noNovaDecision.push({ key: t.key, created: t.created, status: t.status, summary: t.summary?.substring(0, 80), priority: t.priority });
    }

    const gt = t.n8nClassification?.groundTruth;
    if (gt) {
      if (gt.ai_summary_recommended_tier) s.withAiSummary++;
      if (gt.posted_public_reply) s.withPublicReply++;
      if (gt.round_robin_assigned) s.withRoundRobin++;
    }

    // Comparison verdict
    if (t.comparison) {
      const v = t.comparison.verdict;
      s.verdicts[v] = (s.verdicts[v] || 0) + 1;
      s.perDay[day][v === 'real_disagree' ? 'disagree' : v === 'no_comparison' ? 'agree' : v]++;

      if (v === 'real_disagree') {
        s.buckets[t.comparison.bucket] = (s.buckets[t.comparison.bucket] || 0) + 1;
        s.disagreements.push({
          key: t.key, day, reason: t.comparison.reason, bucket: t.comparison.bucket,
          novaAction: t.comparison.novaAction, novaConfidence: t.comparison.novaConfidence,
          novaShadow: t.comparison.novaShadow, novaModel: t.comparison.novaModel,
          gt: t.n8nClassification?.groundTruth, summary: t.summary?.substring(0, 80),
        });
      }
    } else if (hasNova && !hasN8n) {
      s.verdicts.no_comparison++;
    }
  }

  return s;
}

// ── Report Generation ──
function generateReport(s) {
  const L = [];
  const ln = (...a) => L.push(a.join(''));

  ln(`# NOVA AI Agent Audit — ${windowLabel.toUpperCase()} Results`);
  ln(`**Window:** ${fromDate} → ${toDate} (${windowDays} day${windowDays > 1 ? 's' : ''})`);
  ln(`**Generated:** ${new Date().toISOString().substring(0, 16)}Z`);
  ln(`**Method:** Jira comment multi-signal classification + NOVA decision API + NOVA aggregate APIs`);
  ln(`**Methodology version:** v3 — fixed comparison logic (complementary/proactive are not failures)`);
  ln('');

  // ── HEADLINE METRICS ──
  ln('---');
  ln('');
  ln('## 1. Headline Metrics');
  ln('');

  const effectiveAgree = s.verdicts.agree + s.verdicts.complementary + s.verdicts.proactive;
  const effectiveTotal = effectiveAgree + s.verdicts.real_disagree;
  const overEsc = s.buckets.over_escalation || 0;
  const falseNA = s.buckets.false_no_action || 0;
  const premClose = s.buckets.premature_close || 0;

  ln('| Metric | Value | April Baseline |');
  ln('|---|---|---|');
  ln(`| Tickets in window | **${s.totalTickets}** | 159 (24h) / 474 (5d) |`);
  ln(`| NOVA decision coverage | **${pct(s.withNovaDecisions, s.totalTickets)}** (${s.withNovaDecisions}/${s.totalTickets}) | 99.4% (24h) / 93.9% (5d) |`);
  ln(`| Total NOVA decisions | **${s.novaDecisionCount}** | 410 (24h) / 1,246 (5d) |`);
  ln(`| Effective alignment rate | **${pct(effectiveAgree, effectiveTotal)}** (${effectiveAgree}/${effectiveTotal}) | ~44.9% (inflated disagree) |`);
  ln(`| Real disagreement rate | **${pct(s.verdicts.real_disagree, effectiveTotal)}** (${s.verdicts.real_disagree}/${effectiveTotal}) | ~56.5% (inflated) |`);
  ln(`| Over-escalation count | **${overEsc}** | ~36 (5d) |`);
  ln(`| False no_action count | **${falseNA}** | ~90 (5d) |`);
  ln(`| Premature close count | **${premClose}** | not measured |`);
  ln(`| Shadow mode % | **${pct(s.shadowCount, s.novaDecisionCount)}** | 91.6% (5d) |`);
  ln(`| Live mode % | **${pct(s.liveCount, s.novaDecisionCount)}** | 8.4% (5d) |`);
  ln(`| Tickets with no NOVA decision | **${s.noNovaDecision.length}** | 1 (24h) / 29 (5d) |`);
  ln('');

  // Verdict breakdown
  ln('### Verdict Breakdown');
  ln('');
  ln('| Verdict | Count | % of compared |');
  ln('|---|---|---|');
  const totalVerdicts = Object.values(s.verdicts).reduce((a, b) => a + b, 0);
  for (const [v, c] of Object.entries(s.verdicts).sort((a, b) => b[1] - a[1])) {
    ln(`| ${v} | ${c} | ${pct(c, totalVerdicts)} |`);
  }
  ln('');

  // ── PER-DAY BREAKDOWN ──
  ln('## 2. Per-Day Breakdown');
  ln('');
  ln('| Day | Tickets | n8n Cov | NOVA Cov | Agree | Comp | Proactive | Disagree | Alignment |');
  ln('|---|---|---|---|---|---|---|---|---|');
  for (const [day, d] of Object.entries(s.perDay).sort()) {
    const dayEffective = d.agree + d.complementary + d.proactive;
    const dayTotal = dayEffective + d.disagree;
    const rate = dayTotal > 0 ? pct(dayEffective, dayTotal) : 'N/A';
    ln(`| ${day} | ${d.total} | ${pct(d.withN8n, d.total)} | ${pct(d.withNova, d.total)} | ${d.agree} | ${d.complementary} | ${d.proactive} | ${d.disagree} | ${rate} |`);
  }
  ln('');

  // ── DECISION QUALITY ──
  ln('## 3. Decision Quality');
  ln('');

  // 3a. Disagree buckets
  ln('### 3a. Disagreement Buckets');
  ln('');
  if (Object.keys(s.buckets).length > 0) {
    ln('| Bucket | Count | Description |');
    ln('|---|---|---|');
    const bucketDesc = {
      over_escalation: 'NOVA escalated but n8n responded/assigned at lower tier',
      false_no_action: 'NOVA took no action but n8n responded or assigned',
      premature_close: 'NOVA closed but n8n acted on the ticket',
      under_escalation: 'NOVA responded but n8n escalated',
    };
    for (const [b, c] of Object.entries(s.buckets).sort((a, b) => b[1] - a[1])) {
      ln(`| ${b} | ${c} | ${bucketDesc[b] || ''} |`);
    }
    ln('');
  } else {
    ln('No real disagreements found.');
    ln('');
  }

  // 3b. Disagreement examples
  if (s.disagreements.length > 0) {
    ln('### 3b. Disagreement Examples (up to 25)');
    ln('');
    ln('| Ticket | NOVA | Conf | Bucket | n8n Ground Truth | Shadow | Summary |');
    ln('|---|---|---|---|---|---|---|');
    for (const d of s.disagreements.slice(0, 25)) {
      const gtAction = d.gt?.posted_public_reply ? 'respond' : d.gt?.round_robin_assigned ? 'assign' : 'idle';
      const tier = d.gt?.ai_summary_recommended_tier || '-';
      ln(`| ${d.key} | ${d.novaAction} | ${(d.novaConfidence || 0).toFixed(2)} | ${d.bucket} | ${gtAction} (tier: ${tier}) | ${d.novaShadow ? 'Y' : 'N'} | ${d.summary || ''} |`);
    }
    ln('');
  }

  // 3c. Action profile
  ln('### 3c. NOVA Action Profile');
  ln('');
  ln('| Action | Count | % |');
  ln('|---|---|---|');
  for (const [a, c] of Object.entries(s.actionProfile).sort((a, b) => b[1] - a[1])) {
    ln(`| ${a} | ${c} | ${pct(c, s.novaDecisionCount)} |`);
  }
  ln('');

  // 3d. Confidence distribution
  ln('### 3d. Confidence Distribution');
  ln('');
  ln(`| Band | Count | % |`);
  ln(`|---|---|---|`);
  ln(`| High (≥0.80) | ${s.confidenceBands.high} | ${pct(s.confidenceBands.high, s.novaDecisionCount)} |`);
  ln(`| Medium (0.50–0.79) | ${s.confidenceBands.medium} | ${pct(s.confidenceBands.medium, s.novaDecisionCount)} |`);
  ln(`| Low (<0.50) | ${s.confidenceBands.low} | ${pct(s.confidenceBands.low, s.novaDecisionCount)} |`);
  ln('');

  // 3e. Model usage
  ln('### 3e. Model Usage');
  ln('');
  ln('| Model | Count | % |');
  ln('|---|---|---|');
  for (const [m, c] of Object.entries(s.modelProfile).sort((a, b) => b[1] - a[1])) {
    ln(`| ${m} | ${c} | ${pct(c, s.novaDecisionCount)} |`);
  }
  ln('');

  // 3f. Event types
  ln('### 3f. Event Type Distribution');
  ln('');
  ln('| Event | Count | % |');
  ln('|---|---|---|');
  for (const [e, c] of Object.entries(s.eventTypeProfile).sort((a, b) => b[1] - a[1])) {
    ln(`| ${e} | ${c} | ${pct(c, s.novaDecisionCount)} |`);
  }
  ln('');

  // ── APPROVAL FLOW ──
  ln('## 4. Approval Flow');
  ln('');
  if (s.approvalStats) {
    const as = s.approvalStats;
    ln('| Metric | Value |');
    ln('|---|---|');
    for (const [k, v] of Object.entries(as)) {
      if (typeof v === 'object') continue;
      ln(`| ${k} | ${v} |`);
    }
    ln('');
    if (as.sla) {
      ln('**SLA Metrics:**');
      ln('');
      for (const [k, v] of Object.entries(as.sla)) {
        ln(`- ${k}: ${v}`);
      }
      ln('');
    }
  } else {
    ln('*Could not fetch approval stats from NOVA API.*');
    ln('');
  }

  // ── AUTONOMY ──
  ln('## 5. Autonomy Status');
  ln('');
  if (s.autonomyRules && s.autonomyRules.length > 0) {
    ln('| Category | Enabled | Min Conf | Min Accept | Min Decisions | Actions |');
    ln('|---|---|---|---|---|---|');
    for (const r of s.autonomyRules) {
      const actions = typeof r.autonomous_actions === 'string' ? r.autonomous_actions : JSON.stringify(r.autonomous_actions);
      ln(`| ${r.category}${r.sub_category ? ' / ' + r.sub_category : ''} | ${r.enabled ? 'YES' : 'no'} | ${r.min_confidence} | ${r.min_accept_rate}% | ${r.min_decisions} | ${actions} |`);
    }
    ln('');
  } else {
    ln('No autonomy rules configured (all decisions require approval).');
    ln('');
  }

  // Shadow vs Live
  ln('### Shadow vs Live Execution');
  ln('');
  ln(`| Mode | Decisions | % |`);
  ln(`|---|---|---|`);
  ln(`| Shadow | ${s.shadowCount} | ${pct(s.shadowCount, s.novaDecisionCount)} |`);
  ln(`| Live | ${s.liveCount} | ${pct(s.liveCount, s.novaDecisionCount)} |`);
  ln('');

  // ── QUICK WINS ──
  ln('## 6. Quick-Win / Auto-Close');
  ln('');
  if (s.quickWinStats) {
    ln('| Metric | Value |');
    ln('|---|---|');
    for (const [k, v] of Object.entries(s.quickWinStats)) {
      if (typeof v !== 'object') ln(`| ${k} | ${v} |`);
    }
    ln('');
  }
  ln(`- Quick-win decisions in window: ${s.quickWinCount}`);
  ln(`- Executed: ${s.quickWinExecuted}`);
  ln(`- Undone (reversed): ${s.quickWinUndone}`);
  ln('');

  // ── KB GAPS ──
  ln('## 7. Knowledge Base Effectiveness');
  ln('');
  if (s.kbGapCounts) {
    ln('| Metric | Value |');
    ln('|---|---|');
    for (const [k, v] of Object.entries(s.kbGapCounts)) {
      ln(`| ${k} | ${v} |`);
    }
    ln('');
  } else {
    ln('*Could not fetch KB gap counts.*');
    ln('');
  }

  // ── GAP ANALYSIS ──
  if (s.noNovaDecision.length > 0) {
    ln('## 8. Gap Analysis — Tickets with No NOVA Decision');
    ln('');
    ln(`${s.noNovaDecision.length} ticket(s) had no NOVA agent decision.`);
    ln('');
    const limit = Math.min(s.noNovaDecision.length, 40);
    ln('| Ticket | Created | Status | Priority | Summary |');
    ln('|---|---|---|---|---|');
    for (const t of s.noNovaDecision.slice(0, limit)) {
      ln(`| ${t.key} | ${(t.created || '').substring(0, 16)} | ${t.status || '-'} | ${t.priority || '-'} | ${t.summary || ''} |`);
    }
    if (s.noNovaDecision.length > limit) ln(`| ... | ... | ... | ... | (${s.noNovaDecision.length - limit} more) |`);
    ln('');
  }

  // ── AGENT STATUS ──
  ln('## 9. Agent Runtime Status');
  ln('');
  if (s.agentStatus) {
    ln('```json');
    ln(JSON.stringify(s.agentStatus, null, 2));
    ln('```');
    ln('');
  } else {
    ln('*Could not fetch agent status.*');
    ln('');
  }

  // ── METHODOLOGY ──
  ln('## 10. Methodology');
  ln('');
  ln('### Data Sources');
  ln('');
  ln('1. **Jira REST API** — JQL search for all NT tickets in window, per-ticket comment fetch');
  ln('2. **NOVA Decision API** — Per-ticket decision history (`/api/agent/decisions/ticket/{key}`)');
  ln('3. **NOVA Aggregate APIs** — Approval stats, autonomy rules, KB gap counts, quick-win stats, agent status');
  ln('');
  ln('### Ground Truth Derivation');
  ln('');
  ln('n8n actions are classified from Jira comments using multi-signal detection:');
  ln('- **AI Summary** comments → extract Recommended Tier and Priority');
  ln('- **"auto-assigned by" / "round robin"** comments → assignment detection');
  ln('- **Public (jsdPublic=true)** comments → response detection');
  ln('');
  ln('### Comparison Logic (v3)');
  ln('');
  ln('Key improvement over April v2: **complementary and proactive actions are not counted as failures.**');
  ln('');
  ln('| NOVA Action | n8n Action | Verdict |');
  ln('|---|---|---|');
  ln('| escalate | n8n responded (non-T3 tier) | **real_disagree** (over_escalation) |');
  ln('| escalate | n8n escalated (T3/Dev tier) | **agree** |');
  ln('| draft_response | n8n responded | **agree** |');
  ln('| draft_response | n8n assigned only | **complementary** |');
  ln('| draft_response | n8n idle | **proactive** |');
  ln('| no_action | n8n responded or assigned | **real_disagree** (false_no_action) |');
  ln('| no_action | n8n idle | **agree** |');
  ln('| close | n8n acted | **real_disagree** (premature_close) |');
  ln('| assign | n8n assigned | **agree** |');
  ln('| assign | n8n responded | **complementary** |');
  ln('');
  ln('**Effective alignment** = agree + complementary + proactive.');
  ln('**Real disagreement** = only cases where NOVA\'s action would have produced a materially wrong outcome.');
  ln('');
  ln('### Limitations');
  ln('');
  ln('- n8n ground truth only captures public comments, AI summaries, and round-robin assignments. Internal-only handling is invisible.');
  ln('- NOVA decisions made after the Jira comment window may be missing for the most recent tickets.');
  ln('- Approval flow stats are all-time, not window-scoped (NOVA API limitation).');
  ln('- Shadow mode decisions are logged but never executed, so we cannot measure their real-world outcome.');
  ln('');

  // ── COMPARISON TO APRIL ──
  ln('## 11. Compared to April 2026 Audit');
  ln('');
  ln('| Dimension | April (5d, Apr 23–28) | May (this audit) | Change |');
  ln('|---|---|---|---|');
  ln(`| Raw agreement rate | 43.5% (inflated disagree) | ${pct(effectiveAgree, effectiveTotal)} (effective alignment) | Methodology fixed — not directly comparable |`);
  ln(`| Real disagreement | ~21% (reclassified) | ${pct(s.verdicts.real_disagree, effectiveTotal)} | Measured properly now |`);
  ln(`| Over-escalation | ~36 (5d) | ${overEsc} | ${overEsc < 36 ? 'Improved' : overEsc === 36 ? 'Same' : 'Regressed'} |`);
  ln(`| False no_action | ~90 (5d) | ${falseNA} | ${falseNA < 90 ? 'Improved' : 'Same or worse'} |`);
  ln(`| NOVA coverage | 93.9% (5d) | ${pct(s.withNovaDecisions, s.totalTickets)} | ${parseFloat(pctN(s.withNovaDecisions, s.totalTickets)) > 93.9 ? 'Improved' : 'Same or worse'} |`);
  ln(`| Shadow % | 91.6% | ${pct(s.shadowCount, s.novaDecisionCount)} | - |`);
  ln(`| Tickets with no decision | 29 (5d) | ${s.noNovaDecision.length} | - |`);
  ln('');
  ln('### Key Changes Since April');
  ln('');
  ln('1. **Methodology v3** — Complementary/proactive actions correctly separated from real failures');
  ln('2. **Escalation policy** — 5-gate evaluation with evidence scoring, repeat-escalation dampener');
  ln('3. **Critic gate** — LLM review of high-stakes actions before execution');
  ln('4. **Quick-win engine** — Pattern-based auto-close with undo capability');
  ln('5. **Autonomy engine** — Category-based approval bypass with statistical thresholds');
  ln('6. **Impact measurement** — Rolling 7-day metrics (resolution rate, deflection, queue hours saved)');
  ln('');

  // ── VERDICT ──
  ln('## 12. Verdict');
  ln('');
  const effectiveRate = effectiveTotal > 0 ? (effectiveAgree / effectiveTotal) * 100 : 0;
  const realDisagreeRate = effectiveTotal > 0 ? (s.verdicts.real_disagree / effectiveTotal) * 100 : 0;
  if (effectiveRate >= 85 && overEsc <= 10 && falseNA <= 15) {
    ln('**IMPROVED ENOUGH** — Effective alignment ≥85%, over-escalation and false no_action within acceptable bounds.');
  } else if (effectiveRate >= 70) {
    ln('**IMPROVED BUT STILL RISKY** — Effective alignment is improving but disagreement patterns remain.');
  } else {
    ln('**NOT MATERIALLY IMPROVED** — Real disagreement rate remains too high for autonomous operation.');
  }
  ln('');
  ln(`- Effective alignment: ${effectiveRate.toFixed(1)}%`);
  ln(`- Real disagreement: ${realDisagreeRate.toFixed(1)}%`);
  ln(`- Over-escalation: ${overEsc} (target: <10 per 5d window)`);
  ln(`- False no_action: ${falseNA} (target: <15 per 5d window)`);
  ln(`- Premature close: ${premClose}`);
  ln('');

  // ── TOP 10 REMEDIATION ──
  ln('## 13. Top 10 Remediation Items');
  ln('');
  const remediations = [];

  if (overEsc > 5) remediations.push({ severity: 'HIGH', item: `Over-escalation (${overEsc} cases)`, action: 'Tighten escalation policy evidence thresholds. Review top over-escalated tickets for pattern. Consider raising Gate 4 score threshold from 0.6 to 0.7.' });
  if (falseNA > 10) remediations.push({ severity: 'HIGH', item: `False no_action (${falseNA} cases)`, action: 'Review perceiver filters — tickets that n8n handled but NOVA ignored. Check if agent loop timing or event filtering is causing missed tickets.' });
  if (premClose > 3) remediations.push({ severity: 'HIGH', item: `Premature close (${premClose} cases)`, action: 'Review quick-win patterns that are closing tickets prematurely. Tighten confidence thresholds or add exclusion patterns.' });
  if (s.noNovaDecision.length > 5) remediations.push({ severity: 'MEDIUM', item: `Coverage gap (${s.noNovaDecision.length} tickets with no decision)`, action: 'Check agent loop processing for timing gaps, overnight tickets, or filtered event types.' });
  if (s.shadowCount > 0 && s.liveCount === 0) remediations.push({ severity: 'MEDIUM', item: 'All decisions in shadow mode', action: 'No live execution — agent is observing only. Enable autonomy rules for well-understood categories to start executing.' });
  if (s.liveCount > 0 && s.quickWinUndone > 0) remediations.push({ severity: 'MEDIUM', item: `Quick-win reversals (${s.quickWinUndone})`, action: 'Each undo suggests a false-positive auto-close. Review the patterns that triggered these.' });
  remediations.push({ severity: 'MEDIUM', item: 'Approval SLA monitoring', action: 'Ensure approval timeouts are configured. Expired approvals should auto-decline or alert, not sit forever.' });
  remediations.push({ severity: 'LOW', item: 'KB gap closure rate', action: 'Review open KB gaps and close or create articles. High gap count reduces AI response quality.' });
  remediations.push({ severity: 'LOW', item: 'Model cost optimisation', action: 'Review model distribution. If cheaper models perform comparably on low-complexity categories, route accordingly.' });
  remediations.push({ severity: 'LOW', item: 'Portal chat evaluation', action: 'If portal chat is live, audit deflection rate and handoff quality separately.' });

  for (let i = 0; i < Math.min(remediations.length, 10); i++) {
    const r = remediations[i];
    ln(`${i + 1}. **[${r.severity}]** ${r.item}`);
    ln(`   - ${r.action}`);
  }
  ln('');

  ln('---');
  ln('');
  ln(`*Raw data: \`audit-${windowLabel}-${toDate}.json\`. Re-run: \`node scripts/audit-2025-05-10.cjs${is7d ? ' --7d' : ''}\`*`);

  return L.join('\n');
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
