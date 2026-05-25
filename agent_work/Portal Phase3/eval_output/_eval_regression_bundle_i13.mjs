/**
 * Portal Phase3 Iteration 13 — May 25 Regression Protection Bundle Eval
 *
 * Tests runtime behaviour across all three target domains plus protected behaviours.
 * Creates empty session → sends message → reads session metadata for category.
 */

const BASE = 'http://localhost:3001';

async function getTestToken() {
  const loginRes = await fetch(`${BASE}/api/portal/auth/codex-test-login`, { method: 'POST' });
  const login = await loginRes.json();
  if (login?.ok && login?.data?.token) return login.data.token;
  throw new Error('Cannot get codex test token: ' + JSON.stringify(login));
}

// API helpers
async function createSession(token) {
  const resp = await fetch(`${BASE}/api/portal/chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: '{}',
  });
  return resp.json();
}

async function sendMessage(token, sessionId, content) {
  const resp = await fetch(`${BASE}/api/portal/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  return resp.json();
}

async function getSessionMeta(token, sessionId) {
  const resp = await fetch(`${BASE}/api/portal/chat/sessions/${sessionId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await resp.json();
  if (data.ok && data.data?.session?.metadata) {
    try { return JSON.parse(data.data.session.metadata); } catch { return null; }
  }
  return null;
}

async function getCategories(token) {
  const resp = await fetch(`${BASE}/api/portal/categories`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return resp.json();
}

// Jargon detection
const JARGON_PATTERNS = [
  [/\bsubcategor/i, 'subcategory'],
  [/\brouting\b/i, 'routing'],
  [/\bintake\b/i, 'intake'],
  [/\bclassif/i, 'classification'],
  [/\bproject.*key\b/i, 'project key'],
  [/\bqueue.*name\b/i, 'queue name'],
  [/\bjira.*queue\b/i, 'jira queue'],
  [/\bfollowup_not_resolved\b/, 'followup_not_resolved'],
  [/\bfollowup_reopen\b/, 'followup_reopen'],
  [/\bwebsite_broken\b/, 'website_broken'],
  [/\bwebsite_content\b/, 'website_content'],
  [/\bletters_general\b/, 'letters_general'],
  [/\bproperty_media\b/, 'property_media'],
  [/\bother_general\b/, 'other_general'],
  [/\bcategory_id\b/, 'category_id'],
  [/\bgetProjectFor\b/, 'getProjectFor'],
  [/\bNTPJ\b/, 'NTPJ'],
];

function detectJargon(text) {
  return JARGON_PATTERNS.filter(([p]) => p.test(text)).map(([, name]) => name);
}

// Reply-based category inference (fallback)
function inferCategory(reply) {
  if (!reply) return 'unknown';
  const lower = reply.toLowerCase();
  if (/follow.?up|following up|linked to that ticket|still needs attention|raise a follow.?up|your original request|look into (ticket|this)/i.test(reply)) return 'followup';
  if (/i can see.*\b(NT|NTPJ)-/i.test(reply)) return 'followup';
  if (/complaint|formal complaint|sorry.*(hear|experience)|understand.*(frustr|disappoint)|concern.*seriously/i.test(lower)) return 'complaint';
  if (/\b(letter|correspondence|mailshot|market appraisal|production team|printed)\b/i.test(lower)) return 'letters';
  if (/\b(rightmove|zoopla|listing.*(not showing|disappeared|missing)|property.*feed|syndication)\b/i.test(lower)) return 'property';
  if (/\b(website|web.?site|your site|homepage|page|url|content|phone.*number|banner|design|not loading|broken|display)\b/i.test(lower)) return 'website';
  if (/\b(template|email.*template|email.*design|newsletter)\b/i.test(lower)) return 'email_marketing';
  return 'unknown';
}

function extractMeta(msgData) {
  if (!msgData?.metadata) return null;
  try { return typeof msgData.metadata === 'string' ? JSON.parse(msgData.metadata) : msgData.metadata; } catch { return null; }
}

// ============================================================
// TEST DEFINITIONS
// ============================================================
const TESTS = [
  // DOMAIN 1: Deterministic Routing
  { id: 'DET-1', domain: 'DET', name: 'Email template canonical', message: 'I need a new email template designed for our autumn campaign', expect: 'email_marketing' },
  { id: 'DET-2', domain: 'DET', name: 'Email template variant (H1)', message: 'Can you build us a brand new template for our email newsletters please', expect: 'email_marketing' },
  { id: 'DET-3', domain: 'DET', name: 'Email template + property incidental', message: 'I need a new email template for our property launch campaign, we have listings going live', expect: 'email_marketing' },
  { id: 'DET-4', domain: 'DET', name: 'Letters market appraisal', message: 'We need to send market appraisal letters to properties in the SE1 postcode area', expect: 'letters' },
  { id: 'DET-5', domain: 'DET', name: 'Letters mailshot', message: 'I need to do a property mailshot to all vendors in our area', expect: 'letters' },
  { id: 'DET-6', domain: 'DET', name: 'Letters general variant (H1)', message: 'Can you arrange some printed correspondence to go out to our client database', expect: 'letters' },
  { id: 'DET-7', domain: 'DET', name: 'Email template redesign', message: 'Our email template needs a complete redesign, the current one looks dated', expect: 'email_marketing' },

  // DOMAIN 2: Edge-Case Routing Sensitivity
  { id: 'EDGE-1', domain: 'EDGE', name: 'NT-55555 is not fixed', message: 'NT-55555 is not fixed', expect: 'followup' },
  { id: 'EDGE-2', domain: 'EDGE', name: 'NT-20001 is not fixed', message: 'NT-20001 is not fixed', expect: 'followup' },
  { id: 'EDGE-3', domain: 'EDGE', name: 'NT-99999 is not resolved', message: 'NT-99999 is not resolved', expect: 'followup' },
  { id: 'EDGE-4', domain: 'EDGE', name: 'NT-77777 is not working (H2)', message: 'NT-77777 is not working', expect: 'followup' },
  { id: 'EDGE-5', domain: 'EDGE', name: 'Website-primary + letters incidental', message: 'Our website needs updating with new photos and branch details. We also have some letters that will need the same info eventually but the website is the priority.', expect: 'website' },
  { id: 'EDGE-6', domain: 'EDGE', name: 'Property images on my website', message: 'The property images on my website are not loading properly', expect: 'website' },

  // PROTECTED BEHAVIOURS (H4)
  { id: 'PROT-1', domain: 'PROT', name: 'Complaint formal', message: 'I want to make a formal complaint about the service I have received, it has been terrible', expect: 'complaint' },
  { id: 'PROT-2', domain: 'PROT', name: 'Follow-up still not fixed', message: 'NT-18592 is still not fixed', expect: 'followup' },
  { id: 'PROT-3', domain: 'PROT', name: 'Pure website', message: 'The phone number on our website is wrong, can you update it please', expect: 'website' },
  { id: 'PROT-4', domain: 'PROT', name: 'Property listing', message: 'Our Rightmove listing at 14 Oak Lane is missing the floor plan', expect: 'property' },
  { id: 'PROT-5', domain: 'PROT', name: 'Letters pure', message: 'We need to send out some market appraisal letters to our vendors', expect: 'letters' },
];

// ============================================================
// RUNNER
// ============================================================
async function main() {
  console.log('Portal Phase3 Iteration 13 — May 25 Regression Protection Bundle Eval');
  console.log('=====================================================================\n');

  const token = await getTestToken();
  console.log(`Auth OK — codex test token acquired\n`);

  // Run categories check (shared config domain)
  console.log('=== DOMAIN 3: Single Shared Config Protection — Categories ===');
  const cats = await getCategories(token);
  const configResults = { passed: 0, failed: 0, details: [] };
  if (cats?.ok) {
    const allSubcats = [];
    for (const cat of cats.data) {
      for (const sub of (cat.children || [])) allSubcats.push(sub.id);
    }
    const requiredSubs = ['website_broken', 'website_content', 'account_login', 'followup_reopen', 'complaint_service', 'letters_general', 'other_general'];
    for (const sub of requiredSubs) {
      if (allSubcats.includes(sub)) {
        configResults.passed++;
        configResults.details.push({ name: sub, status: 'PASS' });
        console.log(`  PASS: subcategory ${sub} present`);
      } else {
        configResults.failed++;
        configResults.details.push({ name: sub, status: 'FAIL' });
        console.log(`  FAIL: subcategory ${sub} missing`);
      }
    }
    console.log(`  Total categories: ${cats.data.length}`);
  } else {
    console.log(`  FAIL: categories endpoint returned ${JSON.stringify(cats)}`);
    configResults.failed++;
  }

  // Run routing tests
  const results = [];
  let delay = 0;

  for (const test of TESTS) {
    if (delay > 0) await new Promise(r => setTimeout(r, 800));
    delay++;

    const result = { ...test, status: 'SKIP', reply: null, sessionCategory: null, metaCategory: null, inferredCategory: null, jargon: [], failReason: null };

    try {
      const sess = await createSession(token);
      if (!sess.ok) { result.status = 'ERROR'; result.failReason = `Session: ${sess.error}`; results.push(result); continue; }

      const msgResp = await sendMessage(token, sess.data.id, test.message);
      if (!msgResp.ok) { result.status = 'ERROR'; result.failReason = `Message: ${msgResp.error}`; results.push(result); continue; }

      result.reply = msgResp.data.content;
      const msgMeta = extractMeta(msgResp.data);
      result.metaCategory = msgMeta?.fields?.category || null;

      // Fetch session metadata for authoritative category
      const sessMeta = await getSessionMeta(token, sess.data.id);
      result.sessionCategory = sessMeta?.category || null;

      result.inferredCategory = inferCategory(result.reply);

      const effectiveCategory = result.sessionCategory || result.metaCategory || result.inferredCategory;
      const categoryMatch = effectiveCategory === test.expect;
      const jargonHits = detectJargon(result.reply);
      result.jargon = jargonHits;

      result.status = categoryMatch && jargonHits.length === 0 ? 'PASS' : 'FAIL';
      if (!categoryMatch) result.failReason = `Expected "${test.expect}", got "${effectiveCategory}" (session: ${result.sessionCategory || 'none'}, inferred: ${result.inferredCategory}, msgMeta: ${result.metaCategory || 'none'})`;
      if (jargonHits.length > 0) result.failReason = (result.failReason || '') + ` | Jargon: ${jargonHits.join(', ')}`;

    } catch (err) {
      result.status = 'ERROR';
      result.failReason = err.message;
    }

    const icon = result.status === 'PASS' ? 'PASS' : result.status === 'FAIL' ? 'FAIL' : 'ERR ';
    console.log(`\n  [${icon}] ${result.id}: ${result.name}`);
    if (result.sessionCategory) console.log(`         session category: ${result.sessionCategory}`);
    if (result.inferredCategory) console.log(`         inferred: ${result.inferredCategory}`);
    if (result.failReason) console.log(`         REASON: ${result.failReason}`);
    if (result.jargon.length) console.log(`         JARGON: ${result.jargon.join(', ')}`);

    results.push(result);
  }

  // Summary
  console.log('\n\n=====================================================================');
  console.log('RESULTS SUMMARY');
  console.log('=====================================================================');

  const domains = ['DET', 'EDGE', 'PROT'];
  for (const d of domains) {
    const domResults = results.filter(r => r.domain === d);
    const passed = domResults.filter(r => r.status === 'PASS').length;
    const total = domResults.length;
    const verdict = domResults.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL';
    console.log(`  ${d}: ${passed}/${total} ${verdict}`);
    const failures = domResults.filter(r => r.status !== 'PASS');
    for (const f of failures) console.log(`    - ${f.id} ${f.name}: ${f.failReason}`);
  }
  console.log(`  CONFIG: ${configResults.passed}/${configResults.passed + configResults.failed} ${configResults.failed === 0 ? 'PASS' : 'FAIL'}`);

  const totalPassed = results.filter(r => r.status === 'PASS').length + configResults.passed;
  const totalFailed = results.filter(r => r.status !== 'PASS').length + configResults.failed;
  console.log(`\n  TOTAL: ${totalPassed} passed, ${totalFailed} failed`);

  // Write raw results
  const fs = await import('fs');
  fs.writeFileSync('agent_work/Portal Phase3/eval_output/_iter13_raw_results.json', JSON.stringify({ tests: results, config: configResults }, null, 2));
  console.log('\nRaw results → _iter13_raw_results.json');
}

main().catch(e => { console.error('EVAL FAILED:', e); process.exit(1); });
