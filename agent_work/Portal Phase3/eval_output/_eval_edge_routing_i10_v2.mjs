/**
 * Edge-Case Routing Hardening — Eval Script v2 (Iteration 10)
 * Tests three named routing defects + protected behaviour regression.
 * Mints a portal JWT using the known fallback secret, then tests via session API.
 */

import { createHmac } from 'crypto';

const BASE = 'http://localhost:3001';

// ── JWT helper (HS256) ──

function base64url(buf) {
  return (typeof buf === 'string' ? Buffer.from(buf) : buf)
    .toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
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

// ── Jargon check ──

const JARGON_PATTERNS = [
  /\bNT\b(?!-\d)/i,
  /\bcategor(y|ies)\b/i,
  /\bsubcategor/i,
  /\brouting\b/i,
  /\bintake\b/i,
  /\bclassif/i,
  /\bproject.*key\b/i,
  /\bqueue.*name\b/i,
  /\bjira.*queue\b/i,
  /\bfollowup_not_resolved\b/,
  /\bfollowup_reopen\b/,
  /\bwebsite_broken\b/,
  /\bwebsite_content\b/,
  /\bletters_general\b/,
  /\bproperty_media\b/,
];

function detectJargon(text) {
  return JARGON_PATTERNS.filter(p => p.test(text)).map(p => p.source);
}

function inferCategory(reply) {
  const lower = reply.toLowerCase();
  if (/follow.?up|following up|linked to that ticket|still needs attention|raise a follow.?up|your original request/i.test(reply)) return 'followup';
  if (/i can see.*\b(NT|NTPJ)-/i.test(reply)) return 'followup';
  if (/complaint|formal complaint|escalat(e|ion)|sorry.*(hear|experience)|understand.*(frustr|disappoint)|concern.*seriously/i.test(lower)) return 'complaint';
  if (/\b(letter|correspondence|mailshot|market appraisal|production team|print)\b/i.test(lower) && !/website/i.test(lower)) return 'letters';
  if (/\b(letter|correspondence|mailshot|market appraisal|production team)\b/i.test(lower)) return 'letters';
  if (/\b(rightmove|zoopla|listing|property.*feed|portal.*listing|syndication)\b/i.test(lower)) return 'property';
  if (/\b(website|web.?site|your site|page|homepage|url|content.*updat|phone.*number|photo|banner|design|not loading|broken|display)\b/i.test(lower)) return 'website';
  return 'unknown';
}

// ── Parse metadata from session response ──

function extractMeta(msgData) {
  if (!msgData) return null;
  // The message metadata contains the routing decision
  if (msgData.metadata) {
    try {
      const meta = typeof msgData.metadata === 'string' ? JSON.parse(msgData.metadata) : msgData.metadata;
      return meta;
    } catch {}
  }
  return null;
}

// ── Tests ──

const TESTS = [
  // PRIORITY: Three named routing defects
  { id: 'DEFECT-1a', name: 'NT-55555 is not fixed → followup', message: 'NT-55555 is not fixed', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-1b', name: 'NT-20001 is not fixed → followup', message: 'NT-20001 is not fixed', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-1c', name: 'NT-12345 is not fixed yet → followup', message: 'NT-12345 is not fixed yet', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-1d', name: 'NT-99999 is not resolved → followup', message: 'NT-99999 is not resolved', expect: 'followup', priority: 'critical' },
  { id: 'DEFECT-2', name: 'Website-primary with letters mention → website', message: 'Our website needs updating with new photos and branch details. We also have some letters that will need the same info eventually but the website is the priority.', expect: 'website', priority: 'critical' },
  { id: 'DEFECT-3', name: 'Property images on my website → website', message: 'The property images on my website are not loading properly', expect: 'website', priority: 'critical' },

  // Protected behaviour
  { id: 'PROT-1', name: 'Pure letters request → letters', message: 'We need new market appraisal letters designed for our spring campaign', expect: 'letters', priority: 'protected' },
  { id: 'PROT-2', name: 'Letters-primary with website mention → letters', message: 'We need our market appraisal letters updated - the ones we send after valuations. The copy on them still references our old website address.', expect: 'letters', priority: 'protected' },
  { id: 'PROT-3', name: 'Pure complaint → complaint', message: 'I want to make a formal complaint about the service I have received. Nobody has helped me and I am extremely frustrated.', expect: 'complaint', priority: 'protected' },
  { id: 'PROT-4', name: 'NT-11111 still not fixed → followup (canonical)', message: 'NT-11111 still not fixed', expect: 'followup', priority: 'protected' },
  { id: 'PROT-5', name: 'Pure website → website', message: 'Can you update the phone number on our website contact page? It shows the old number.', expect: 'website', priority: 'protected' },
  { id: 'PROT-6', name: 'Rightmove listing → property', message: 'Our listing at 14 Oak Lane is not showing on Rightmove - it was there yesterday but has disappeared', expect: 'property', priority: 'protected' },

  // Holdout scenarios
  { id: 'H1', name: 'Letters + incidental website context → letters', message: 'I need help with our correspondence - the mailshot letters we send to new instructions. They used to have our website link at the bottom but that is fine, the main thing is the letter content needs refreshing.', expect: 'letters', priority: 'holdout' },
  { id: 'H2a', name: 'NT-77777 is not fixed → followup', message: 'NT-77777 is not fixed', expect: 'followup', priority: 'holdout' },
  { id: 'H2b', name: 'NT-10001 is not working → followup', message: 'NT-10001 is not working', expect: 'followup', priority: 'holdout' },
  { id: 'H3', name: 'Homepage banner → website (no regression)', message: 'Our homepage banner image needs replacing with the new spring campaign creative', expect: 'website', priority: 'holdout' },
];

// ── Runner ──

async function run() {
  console.log('=== Edge-Case Routing Hardening Eval v2 (Iteration 10) ===\n');

  // Mint a portal JWT with fallback secret
  const secret = 'portal-default-secret';
  const portalToken = mintJwt({
    userId: 999,
    email: 'eval-agent@testeval.com',
    orgId: 1,
    orgName: 'TestEval Corp',
    role: 'requester',
  }, secret);

  // Test auth
  const testSession = await createSession(portalToken);
  if (!testSession.ok) {
    console.log(`Auth failed: ${testSession.error}`);
    console.log('Cannot reach runtime. VERDICT: NOT CONVERGED (blocked by auth)\n');
    return;
  }
  console.log(`Auth OK — test session ${testSession.data?.id || 'created'}\n`);

  const results = [];

  for (const test of TESTS) {
    const result = { ...test, status: 'SKIP', reply: null, meta: null, inferredCategory: null, jargon: [] };

    try {
      // Fresh session per test for clean routing state
      const sess = await createSession(portalToken);
      if (!sess.ok) {
        result.status = 'ERROR';
        result.failReason = `Session creation failed: ${sess.error}`;
        results.push(result);
        continue;
      }

      const msgResp = await sendMessage(portalToken, sess.data.id, test.message);
      if (!msgResp.ok) {
        result.status = 'ERROR';
        result.failReason = `Message failed: ${msgResp.error}`;
        results.push(result);
        continue;
      }

      result.reply = msgResp.data.content;
      result.meta = extractMeta(msgResp.data);
      result.inferredCategory = inferCategory(result.reply);

      // Also check metadata for explicit category
      if (result.meta?.fields?.category) {
        result.metaCategory = result.meta.fields.category;
      }

      result.jargon = detectJargon(result.reply);

      const effectiveCategory = result.metaCategory || result.inferredCategory;
      const categoryMatch = effectiveCategory === test.expect;
      const noJargonViolation = result.jargon.length === 0;

      result.status = categoryMatch && noJargonViolation ? 'PASS' : 'FAIL';
      if (!categoryMatch) result.failReason = `Expected ${test.expect}, got ${effectiveCategory} (inferred: ${result.inferredCategory}, meta: ${result.metaCategory || 'n/a'})`;
      if (!noJargonViolation) result.failReason = (result.failReason || '') + ` | Jargon: ${result.jargon.join(', ')}`;

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
    console.log(`  [${icon}] ${r.id}: ${r.name} → ${r.status}`);
    if (r.failReason) console.log(`      Reason: ${r.failReason}`);
    if (r.reply) console.log(`      Reply: ${r.reply.substring(0, 150).replace(/\n/g, ' ')}${r.reply.length > 150 ? '...' : ''}`);
    if (r.metaCategory) console.log(`      Meta category: ${r.metaCategory}`);
    console.log();
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;

  const criticalFails = results.filter(r => r.priority === 'critical' && r.status !== 'PASS');
  const protectedFails = results.filter(r => r.priority === 'protected' && r.status === 'FAIL');

  console.log('─── Summary ───');
  console.log(`  Total: ${results.length}  |  Pass: ${passed}  |  Fail: ${failed}  |  Error: ${errors}`);
  if (criticalFails.length > 0) console.log(`  CRITICAL FAILURES: ${criticalFails.map(r => r.id).join(', ')}`);
  if (protectedFails.length > 0) console.log(`  PROTECTED REGRESSIONS: ${protectedFails.map(r => r.id).join(', ')}`);

  const converged = criticalFails.length === 0 && protectedFails.length === 0 && errors === 0;
  console.log(`\n  VERDICT: ${converged ? 'CONVERGED' : 'NOT CONVERGED'}`);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
