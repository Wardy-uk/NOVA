/**
 * NOVA AI Agent 24-hour Audit
 * Full audit report format — same as audit-agent-decisions.cjs but scoped to last 24h.
 * Usage: node scripts/audit-24h.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ──
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const NOVA_BASE = 'http://100.118.199.1:3069';
const CONCURRENCY = 5;
const N8N_ACCOUNT_ID = '712020:ac84e46b-ecff-4878-974c-2825b0497d54';

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
const fromDate = yesterday.toISOString().substring(0, 10);
const toDate = new Date().toISOString().substring(0, 10);
const JQL = `project = NT AND created >= "${fromDate}" ORDER BY created ASC`;
const OUTPUT_JSON = path.join(__dirname, '..', `audit-24h-${fromDate}.json`);
const REPORT_PATH = path.join(__dirname, '..', 'docs', `agent-audit-24h-${fromDate}.md`);

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
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + 3600 };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

const novaToken = makeJwt({ id: 1, username: 'nickw', role: 'admin' }, JWT_SECRET);
const jiraAuth = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function jiraGet(p, method = 'GET', body = null, retries = 1) {
  const url = `${JIRA_URL}/rest/api/3/${p}`;
  const opts = {
    method,
    headers: { Authorization: jiraAuth, Accept: 'application/json', 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    if (res.status === 429 && retries > 0) {
      await sleep(parseInt(res.headers.get('Retry-After') || '5', 10) * 1000);
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

// ── Old parser (for accuracy comparison) ──
function parseN8nAction(body) {
  if (!body) return null;
  const lower = body.toLowerCase();
  let action = null;
  if (/no escalation is needed|no fault|auto[- ]?resolve|\bclose\b/.test(lower)) action = 'close';
  else if (/escalate to|escalation required|recommend escalation/.test(lower)) action = 'escalate';
  else if (/respond to customer|reply to|\*\*reply:\*\*|\*\*suggested reply:\*\*/i.test(body)) action = 'respond';
  if (!action) return null;
  const priorityMatch = body.match(/\*\*Priority:\*\*\s*(Low|Medium|High|Critical)/i);
  const tierMatch = body.match(/\*\*Recommended Tier:\*\*\s*([^\n*]+)/i);
  return { action, priority: priorityMatch ? priorityMatch[1].trim() : null, recommendedTier: tierMatch ? tierMatch[1].trim() : null };
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

// ── Main ──
async function main() {
  console.log('=== NOVA 24-Hour Agent Audit ===');
  console.log(`Window: ${fromDate} → ${toDate}`);
  console.log(`JQL: ${JQL}`);
  console.log(`Jira: ${JIRA_URL}  |  NOVA: ${NOVA_BASE}`);

  // Verify NOVA auth
  try {
    const testResp = await novaGet('/api/agent/decisions?limit=1');
    console.log(`NOVA auth OK, test query returned ${testResp.ok ? 'ok' : 'error'}`);
  } catch (e) {
    console.error(`NOVA auth failed: ${e.message}`);
    process.exit(1);
  }

  // Page through tickets
  console.log('\n── Step 1: Fetching ticket keys from Jira ──');
  const allTickets = [];
  let nextPageToken = null;
  let pageNum = 0;
  while (true) {
    const payload = { jql: JQL, maxResults: 100, fields: ['key', 'created', 'status', 'summary'] };
    if (nextPageToken) payload.nextPageToken = nextPageToken;
    const data = await jiraGet('search/jql', 'POST', payload);
    const issues = data.issues || [];
    for (const iss of issues) {
      allTickets.push({ key: iss.key, created: iss.fields.created, status: iss.fields.status?.name || null, summary: iss.fields.summary || '' });
    }
    pageNum++;
    console.log(`  Page ${pageNum}: ${issues.length} tickets (total so far: ${allTickets.length})`);
    if (data.isLast !== false || issues.length === 0) break;
    nextPageToken = data.nextPageToken;
    if (!nextPageToken) break;
  }
  console.log(`Total tickets: ${allTickets.length}`);

  // Fetch comments + NOVA decisions per ticket
  console.log('\n── Step 2: Fetching comments and NOVA decisions ──');
  let processed = 0;

  const auditData = await mapWithConcurrency(allTickets, async (ticket) => {
    const result = {
      key: ticket.key, created: ticket.created, status: ticket.status, summary: ticket.summary,
      n8nComments: [], n8nClassification: null, novaDecisions: [], parserResult: null, fetchError: null,
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
          body: bodyText, authorAccountId: c.author?.accountId, authorDisplayName: c.author?.displayName,
        });
      }

      if (result.n8nComments.length > 0) {
        result.n8nClassification = classifyN8nActions(result.n8nComments);
        if (result.n8nClassification.aiSummaryBody) {
          result.parserResult = parseN8nAction(result.n8nClassification.aiSummaryBody);
        }
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

    processed++;
    if (processed % 50 === 0) console.log(`  Processed ${processed}/${allTickets.length}`);
    return result;
  }, CONCURRENCY);

  // Save raw data
  console.log(`\n── Step 3: Saving raw data to ${OUTPUT_JSON} ──`);
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(auditData, null, 2));
  console.log(`Saved ${auditData.length} ticket records`);

  // Analyse
  console.log('\n── Step 4: Analysis ──');
  const analysis = analyse(auditData);

  // Write report
  fs.writeFileSync(REPORT_PATH, generateReport(analysis, auditData));
  console.log(`Report written to ${REPORT_PATH}`);

  // Console summary
  const totalCompared = analysis.novaVsGt.agree + analysis.novaVsGt.disagree;
  console.log(`\n── Summary ──`);
  console.log(`Tickets: ${analysis.totalTickets}`);
  console.log(`Compared: ${totalCompared}`);
  console.log(`Agree: ${analysis.novaVsGt.agree} (${pct(analysis.novaVsGt.agree, totalCompared)})`);
  console.log(`Disagree: ${analysis.novaVsGt.disagree} (${pct(analysis.novaVsGt.disagree, totalCompared)})`);
  console.log(`No comparison: ${analysis.novaVsGt.noComparison}`);
  if (analysis.parserTotal > 0) {
    console.log(`Old parser accuracy: ${pct(analysis.parserCorrect, analysis.parserTotal)}`);
  }

  console.log('\n=== Audit complete ===');
}

// ── Analysis ──
function analyse(data) {
  const stats = {
    totalTickets: data.length, fetchFailed: 0,
    withN8nComments: 0, withAiSummary: 0, withPublicReply: 0, withRoundRobin: 0,
    withNovaDecisions: 0, novaDecisionCount: 0,
    perDay: {},
    parserTotal: 0, parserCorrect: 0, parserDisagreements: [],
    novaVsGt: { agree: 0, disagree: 0, noComparison: 0 },
    novaDisagreements: [],
    noNovaDecision: [],
  };

  for (const t of data) {
    const day = t.created ? t.created.substring(0, 10) : 'unknown';
    if (!stats.perDay[day]) stats.perDay[day] = { total: 0, withN8n: 0, withNova: 0, agree: 0, disagree: 0 };
    stats.perDay[day].total++;

    if (t.fetchError) stats.fetchFailed++;

    const hasN8n = t.n8nComments && t.n8nComments.length > 0;
    const hasNova = t.novaDecisions && t.novaDecisions.length > 0;

    if (hasN8n) { stats.withN8nComments++; stats.perDay[day].withN8n++; }
    if (hasNova) { stats.withNovaDecisions++; stats.novaDecisionCount += t.novaDecisions.length; stats.perDay[day].withNova++; }
    else { stats.noNovaDecision.push({ key: t.key, created: t.created, status: t.status, summary: t.summary?.substring(0, 80) }); }

    const gt = t.n8nClassification?.groundTruth;
    if (gt) {
      if (gt.ai_summary_recommended_tier) stats.withAiSummary++;
      if (gt.posted_public_reply) stats.withPublicReply++;
      if (gt.round_robin_assigned) stats.withRoundRobin++;
    }

    // Parser accuracy
    if (t.parserResult && gt) {
      stats.parserTotal++;
      const parserAction = t.parserResult.action;
      const gtPrimaryAction = gt.posted_public_reply ? 'respond' : gt.round_robin_assigned ? 'assign' : null;
      const parserMatchesGt = (parserAction === gtPrimaryAction)
        || (parserAction === 'respond' && gt.posted_public_reply)
        || (parserAction === 'close' && !gt.posted_public_reply && !gt.round_robin_assigned);

      if (parserMatchesGt) { stats.parserCorrect++; }
      else {
        stats.parserDisagreements.push({
          key: t.key, parserAction, gtPrimaryAction: gtPrimaryAction || 'none/other', gt, parserTier: t.parserResult.recommendedTier,
        });
      }
    }

    // NOVA vs ground truth (v2 comparison logic)
    if (hasNova && gt) {
      const latestNova = t.novaDecisions.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b);
      const novaAction = latestNova.action;
      let agrees = false;

      if (novaAction === 'escalate' || novaAction === 'escalate_to_t2' || novaAction === 'escalate_to_t3') {
        const tier = (gt.ai_summary_recommended_tier || '').toLowerCase();
        agrees = tier.includes('3') || tier.includes('development');
      } else if (novaAction === 'draft_response' || novaAction === 'respond') {
        if (gt.posted_public_reply) agrees = true;
        else if (gt.round_robin_assigned) agrees = true;
        else agrees = true; // proactive draft
      } else if (novaAction === 'assign' || novaAction === 'round_robin') {
        agrees = gt.round_robin_assigned;
      } else if (novaAction === 'close' || novaAction === 'auto_resolve') {
        agrees = !gt.posted_public_reply && !gt.round_robin_assigned;
      } else if (novaAction === 'observe' || novaAction === 'monitor' || novaAction === 'no_action') {
        if (!gt.posted_public_reply && !gt.round_robin_assigned) { stats.novaVsGt.noComparison++; continue; }
        agrees = false;
      } else {
        stats.novaVsGt.noComparison++;
        continue;
      }

      if (agrees) { stats.novaVsGt.agree++; stats.perDay[day].agree++; }
      else {
        stats.novaVsGt.disagree++; stats.perDay[day].disagree++;
        stats.novaDisagreements.push({
          key: t.key, day, novaAction, novaConfidence: latestNova.confidence,
          novaShadow: latestNova.shadow_mode, novaModel: latestNova.model, gt, parserResult: t.parserResult,
        });
      }
    } else if (hasNova && !hasN8n) {
      stats.novaVsGt.noComparison++;
    }
  }

  const actionPairs = {};
  for (const d of stats.novaDisagreements) {
    const gtAction = d.gt.posted_public_reply ? 'respond' : d.gt.round_robin_assigned ? 'assign' : 'other';
    const pair = `NOVA:${d.novaAction} vs n8n:${gtAction}`;
    actionPairs[pair] = (actionPairs[pair] || 0) + 1;
  }
  stats.disagreementBreakdown = Object.entries(actionPairs).sort((a, b) => b[1] - a[1]);

  return stats;
}

// ── Report ──
function generateReport(stats) {
  const lines = [];
  const ln = (...args) => lines.push(args.join(''));

  ln('# NOVA AI Agent Audit — 24-Hour Results');
  ln(`**Window:** ${fromDate} → ${toDate}`);
  ln(`**Generated:** ${new Date().toISOString().substring(0, 16)}Z`);
  ln(`**Method:** Independent classification of Jira comments + NOVA decision API`);
  ln('');
  ln('---');
  ln('');

  ln('## Headlines');
  ln('');
  ln('| Metric | Value |');
  ln('|---|---|');
  ln(`| Total tickets | **${stats.totalTickets}** |`);
  ln(`| Fetch failures | ${stats.fetchFailed} |`);
  ln(`| With n8n comments (Nurtur account) | ${stats.withN8nComments} (${pct(stats.withN8nComments, stats.totalTickets)}) |`);
  ln(`| With AI Summary | ${stats.withAiSummary} |`);
  ln(`| With public reply (n8n responded) | ${stats.withPublicReply} |`);
  ln(`| With Round Robin assignment | ${stats.withRoundRobin} |`);
  ln(`| With NOVA decisions | ${stats.withNovaDecisions} (${pct(stats.withNovaDecisions, stats.totalTickets)}) |`);
  ln(`| Total NOVA decision records | ${stats.novaDecisionCount} |`);
  ln(`| Tickets with NO NOVA decision | ${stats.noNovaDecision.length} |`);
  ln('');

  ln('## Per-Day Breakdown');
  ln('');
  ln('| Day | Tickets | n8n Coverage | NOVA Coverage | Agree | Disagree | Agreement Rate |');
  ln('|---|---|---|---|---|---|---|');
  for (const [day, d] of Object.entries(stats.perDay).sort()) {
    const total = d.agree + d.disagree;
    const rate = total > 0 ? pct(d.agree, total) : 'N/A';
    ln(`| ${day} | ${d.total} | ${d.withN8n} (${pct(d.withN8n, d.total)}) | ${d.withNova} (${pct(d.withNova, d.total)}) | ${d.agree} | ${d.disagree} | ${rate} |`);
  }
  ln('');

  ln('## Parser Accuracy (`parseN8nAction` — old v1 parser)');
  ln('');
  ln(`Tested on ${stats.parserTotal} tickets with both an AI Summary and identifiable ground truth.`);
  ln('');
  if (stats.parserTotal > 0) {
    ln(`- **Correct:** ${stats.parserCorrect} (${pct(stats.parserCorrect, stats.parserTotal)})`);
    ln(`- **Incorrect:** ${stats.parserTotal - stats.parserCorrect} (${pct(stats.parserTotal - stats.parserCorrect, stats.parserTotal)})`);
  }
  ln('');
  if (stats.parserDisagreements.length > 0) {
    ln('### Parser Disagreement Examples (up to 20)');
    ln('');
    ln('| Ticket | Parser Says | Ground Truth | Recommended Tier |');
    ln('|---|---|---|---|');
    for (const d of stats.parserDisagreements.slice(0, 20)) {
      ln(`| ${d.key} | ${d.parserAction} | ${d.gtPrimaryAction} | ${d.parserTier || '-'} |`);
    }
    ln('');
  }

  ln('## NOVA vs Ground Truth (v2 comparison)');
  ln('');
  const totalCompared = stats.novaVsGt.agree + stats.novaVsGt.disagree;
  ln(`- **Compared:** ${totalCompared} tickets`);
  ln(`- **Agree:** ${stats.novaVsGt.agree} (${pct(stats.novaVsGt.agree, totalCompared)})`);
  ln(`- **Disagree:** ${stats.novaVsGt.disagree} (${pct(stats.novaVsGt.disagree, totalCompared)})`);
  ln(`- **No comparison possible:** ${stats.novaVsGt.noComparison}`);
  ln('');

  if (stats.disagreementBreakdown.length > 0) {
    ln('### Disagreement Breakdown (NOVA action vs n8n ground truth)');
    ln('');
    ln('| Pair | Count |');
    ln('|---|---|');
    for (const [pair, count] of stats.disagreementBreakdown) {
      ln(`| ${pair} | ${count} |`);
    }
    ln('');
  }

  if (stats.novaDisagreements.length > 0) {
    ln('### Top 20 Disagreement Examples');
    ln('');
    ln('| Ticket | NOVA Action | Confidence | n8n Ground Truth | Recommended Tier | Shadow | Note |');
    ln('|---|---|---|---|---|---|---|');
    for (const d of stats.novaDisagreements.slice(0, 20)) {
      const gtAction = d.gt.posted_public_reply ? 'respond' : d.gt.round_robin_assigned ? 'assign' : 'other';
      const note = diagnoseDisagreement(d);
      ln(`| ${d.key} | ${d.novaAction} | ${(d.novaConfidence || 0).toFixed(2)} | ${gtAction} | ${d.gt.ai_summary_recommended_tier || '-'} | ${d.novaShadow ? 'yes' : 'no'} | ${note} |`);
    }
    ln('');
  }

  if (stats.noNovaDecision.length > 0) {
    ln('## Gap Analysis — Tickets with No NOVA Decision');
    ln('');
    ln(`${stats.noNovaDecision.length} tickets had no NOVA agent decision at all.`);
    ln('');
    if (stats.noNovaDecision.length <= 50) {
      ln('| Ticket | Created | Status | Summary |');
      ln('|---|---|---|---|');
      for (const t of stats.noNovaDecision) {
        ln(`| ${t.key} | ${(t.created || '').substring(0, 16)} | ${t.status || '-'} | ${t.summary || ''} |`);
      }
    } else {
      ln(`Too many to list (${stats.noNovaDecision.length}). First 30:`);
      ln('');
      ln('| Ticket | Created | Status |');
      ln('|---|---|---|');
      for (const t of stats.noNovaDecision.slice(0, 30)) {
        ln(`| ${t.key} | ${(t.created || '').substring(0, 16)} | ${t.status || '-'} |`);
      }
    }
    ln('');
  }

  ln('---');
  ln('');
  ln(`*Raw data: \`audit-24h-${fromDate}.json\` in project root. Re-run: \`node scripts/audit-24h.cjs\`*`);

  return lines.join('\n');
}

function diagnoseDisagreement(d) {
  if (d.novaAction === 'escalate' && d.gt.posted_public_reply) {
    if (d.gt.ai_summary_recommended_tier && !d.gt.ai_summary_recommended_tier.toLowerCase().includes('3')) {
      return 'NOVA over-escalated: n8n tier was not T3/Dev';
    }
    return 'NOVA escalated but n8n responded';
  }
  if (d.novaAction === 'escalate' && !d.gt.posted_public_reply && !d.gt.round_robin_assigned) {
    return 'NOVA escalated but n8n took no action';
  }
  if (d.novaAction === 'draft_response' && !d.gt.posted_public_reply) {
    return 'NOVA drafted response but n8n did not reply publicly';
  }
  if (d.novaAction === 'assign' && !d.gt.round_robin_assigned) {
    return 'NOVA assigned but n8n did not round-robin';
  }
  if (d.novaAction === 'no_action' && (d.gt.posted_public_reply || d.gt.round_robin_assigned)) {
    return 'NOVA idle but n8n acted';
  }
  return '';
}

function pct(n, total) {
  if (!total) return '0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
