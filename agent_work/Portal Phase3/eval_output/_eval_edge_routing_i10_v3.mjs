/**
 * Edge-Case Routing Hardening — Eval Script v3 (Iteration 10)
 * Uses NOVA JWT to authenticate as admin, then tests portal chat routing.
 */

import { createHmac } from 'crypto';

const BASE = 'http://localhost:3001';
const NOVA_JWT_SECRET = '2105ec08741a4253325e11ac421e6c4612869b4e7a605366185a91264d0b67e3';

// ── JWT helper (HS256) ──

function base64url(buf) {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf)
    .toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = base64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

// ── API helpers ──

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

// ── Jargon check ──

const JARGON_PATTERNS = [
  [/\bcategor(y|ies)\b/i, 'category'],
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
];

function detectJargon(text) {
  return JARGON_PATTERNS.filter(([p]) => p.test(text)).map(([, name]) => name);
}

function inferCategory(reply) {
  if (!reply) return 'unknown';
  const lower = reply.toLowerCase();
  if (/follow.?up|following up|linked to that ticket|still needs attention|raise a follow.?up|your original request/i.test(reply)) return 'followup';
  if (/i can see.*\b(NT|NTPJ)-/i.test(reply)) return 'followup';
  if (/complaint|formal complaint|sorry.*(hear|experience)|understand.*(frustr|disappoint)|concern.*seriously/i.test(lower)) return 'complaint';
  if (/\b(letter|correspondence|mailshot|market appraisal|production team)\b/i.test(lower)) return 'letters';
  if (/\b(rightmove|zoopla|listing.*(not showing|disappeared|missing)|property.*feed|syndication)\b/i.test(lower)) return 'property';
  if (/\b(website|web.?site|your site|homepage|page|url|content|phone.*number|banner|design|not loading|broken|display)\b/i.test(lower)) return 'website';
  return 'unknown';
}

function extractMeta(msgData) {
  if (!msgData?.metadata) return null;
  try { return typeof msgData.metadata === 'string' ? JSON.parse(msgData.metadata) : msgData.metadata; } catch { return null; }
}

// ── Tests ──

const TESTS = [
  // CRITICAL: Three named routing defects
  { id: 'DEFECT-1a', name: 'NT-55555 is not fixed', message: 'NT-55555 is not fixed', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-1b', name: 'NT-20001 is not fixed', message: 'NT-20001 is not fixed', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-1c', name: 'NT-12345 is not fixed yet', message: 'NT-12345 is not fixed yet', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-1d', name: 'NT-99999 is not resolved', message: 'NT-99999 is not resolved', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-2', name: 'Website-primary + letters mention → website', message: 'Our website needs updating with new photos and branch details. We also have some letters that will need the same info eventually but the website is the priority.', expect: 'website', priority: 'critical' },
  { id: 'DEFECT-3', name: 'Property images on my website → website', message: 'The property images on my website are not loading properly', expect: 'website', priority: 'critical' },

  // PROTECTED: Regression checks
  { id: 'PROT-1', name: 'Pure letters → letters', message: 'We need new market appraisal letters designed for our spring campaign', expect: 'letters', priority: 'protected' },
  { id: 'PROT-2', name: 'Letters with old website ref → letters', message: 'We need our market appraisal letters updated - the ones we send after valuations. The copy on them still references our old website address.', expect: 'letters', priority: 'protected' },
  { id: 'PROT-3', name: 'Formal complaint → complaint', message: 'I want to make a formal complaint about the service I have received. Nobody has helped me and I am extremely frustrated.', expect: 'complaint', priority: 'protected' },
  { id: 'PROT-4', name: 'NT-11111 still not fixed → followup', message: 'NT-11111 still not fixed', expect: 'followup', priority: 'protected' },
  { id: 'PROT-5', name: 'Phone number on website → website', message: 'Can you update the phone number on our website contact page? It shows the old number.', expect: 'website', priority: 'protected' },
  { id: 'PROT-6', name: 'Rightmove listing → property', message: 'Our listing at 14 Oak Lane is not showing on Rightmove - it was there yesterday but has disappeared', expect: 'property', priority: 'protected' },

  // HOLDOUT scenarios
  { id: 'H1', name: 'Mailshot letters + website context → letters', message: 'I need help with our correspondence - the mailshot letters we send to new instructions. They used to have our website link at the bottom but that is fine, the main thing is the letter content needs refreshing.', expect: 'letters', priority: 'holdout' },
  { id: 'H2a', name: 'NT-77777 is not fixed → followup', message: 'NT-77777 is not fixed', expect: 'followup', priority: 'holdout' },
  { id: 'H2b', name: 'NT-10001 is not working → followup', message: 'NT-10001 is not working', expect: 'followup', priority: 'holdout' },
  { id: 'H3', name: 'Homepage banner → website', message: 'Our homepage banner image needs replacing with the new spring campaign creative', expect: 'website', priority: 'holdout' },
];

// ── Runner ──

async function run() {
  console.log('=== Edge-Case Routing Hardening Eval v3 (Iteration 10) ===\n');

  // Mint NOVA JWT for admin user (id=1, nickw)
  const novaToken = mintJwt({ id: 1, username: 'nickw', role: 'admin' }, NOVA_JWT_SECRET);

  // Verify auth works
  const testResp = await createSession(novaToken);
  if (!testResp.ok) {
    console.log(`Auth check failed: ${testResp.error}`);
    console.log('VERDICT: NOT CONVERGED (blocked by auth)\n');
    return;
  }
  console.log(`Auth OK — portal session ${testResp.data?.id} created\n`);

  const results = [];
  let delay = 0;

  for (const test of TESTS) {
    // Small delay to avoid overwhelming LLM calls
    if (delay > 0) await new Promise(r => setTimeout(r, 500));
    delay++;

    const result = { ...test, status: 'SKIP', reply: null, meta: null, inferredCategory: null, metaCategory: null, jargon: [], failReason: null };

    try {
      const sess = await createSession(novaToken);
      if (!sess.ok) {
        result.status = 'ERROR';
        result.failReason = `Session: ${sess.error}`;
        results.push(result);
        continue;
      }

      const msgResp = await sendMessage(novaToken, sess.data.id, test.message);
      if (!msgResp.ok) {
        result.status = 'ERROR';
        result.failReason = `Message: ${msgResp.error}`;
        results.push(result);
        continue;
      }

      result.reply = msgResp.data.content;
      result.meta = extractMeta(msgResp.data);
      result.inferredCategory = inferCategory(result.reply);
      result.metaCategory = result.meta?.fields?.category || null;

      // Also fetch session metadata for authoritative category
      const sessMeta = await getSessionMeta(novaToken, sess.data.id);
      result.sessionCategory = sessMeta?.category || null;

      const effectiveCategory = result.sessionCategory || result.metaCategory || result.inferredCategory;
      const categoryMatch = effectiveCategory === test.expect;
      const jargonHits = detectJargon(result.reply);
      result.jargon = jargonHits;

      result.status = categoryMatch && jargonHits.length === 0 ? 'PASS' : 'FAIL';
      if (!categoryMatch) result.failReason = `Expected "${test.expect}", got "${effectiveCategory}" (session: ${result.sessionCategory || 'none'}, reply-inferred: ${result.inferredCategory}, msgMeta: ${result.metaCategory || 'none'})`;
      if (jargonHits.length > 0) result.failReason = (result.failReason || '') + ` | Jargon leaked: ${jargonHits.join(', ')}`;

    } catch (err) {
      result.status = 'ERROR';
      result.failReason = err.message;
    }

    results.push(result);
  }

  // ── Output ──
  console.log('─── Results ───\n');

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⚠';
    console.log(`[${icon}] ${r.id} (${r.priority}): ${r.name} → ${r.status}`);
    if (r.failReason) console.log(`    REASON: ${r.failReason}`);
    if (r.reply) {
      const preview = r.reply.replace(/\n/g, ' ').substring(0, 200);
      console.log(`    REPLY: ${preview}${r.reply.length > 200 ? '...' : ''}`);
    }
    if (r.sessionCategory) console.log(`    SESSION: category=${r.sessionCategory}`);
    if (r.metaCategory) console.log(`    MSG-META: category=${r.metaCategory}`);
    console.log();
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  const critFails = results.filter(r => r.priority === 'critical' && r.status !== 'PASS');
  const protFails = results.filter(r => r.priority === 'protected' && r.status === 'FAIL');
  const holdFails = results.filter(r => r.priority === 'holdout' && r.status === 'FAIL');

  console.log('═══ SUMMARY ═══');
  console.log(`Total: ${results.length}  |  Pass: ${passed}  |  Fail: ${failed}  |  Error: ${errors}`);
  console.log(`Critical: ${results.filter(r=>r.priority==='critical').length - critFails.length}/${results.filter(r=>r.priority==='critical').length} pass`);
  console.log(`Protected: ${results.filter(r=>r.priority==='protected').length - protFails.length}/${results.filter(r=>r.priority==='protected').length} pass`);
  console.log(`Holdout: ${results.filter(r=>r.priority==='holdout').length - holdFails.length}/${results.filter(r=>r.priority==='holdout').length} pass`);

  if (critFails.length > 0) console.log(`\n❌ CRITICAL FAILURES: ${critFails.map(r => `${r.id}`).join(', ')}`);
  if (protFails.length > 0) console.log(`\n❌ PROTECTED REGRESSIONS: ${protFails.map(r => `${r.id}`).join(', ')}`);
  if (holdFails.length > 0) console.log(`\n⚠ HOLDOUT FAILURES: ${holdFails.map(r => `${r.id}`).join(', ')}`);

  const converged = critFails.length === 0 && protFails.length === 0 && errors === 0;
  console.log(`\nVERDICT: ${converged ? '✅ CONVERGED' : '❌ NOT CONVERGED'}`);

  return { passed, failed, errors, converged };
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
