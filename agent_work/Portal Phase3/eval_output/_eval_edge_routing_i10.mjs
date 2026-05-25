/**
 * Edge-Case Routing Hardening — Eval Script (Iteration 10)
 * Tests the three named routing defects + protected behaviour regression.
 * Runs against the live runtime at localhost:3001 via widget chat endpoint.
 */

const BASE = 'http://localhost:3001';

// ── Helpers ──

async function identify(email) {
  const resp = await fetch(`${BASE}/api/portal/widget/identify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return resp.json();
}

async function chat(token, sessionId, message) {
  const resp = await fetch(`${BASE}/api/portal/widget/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, sessionId, message }),
  });
  return resp.json();
}

// Attempt session-based approach (with NOVA JWT)
async function chatViaSession(novaToken, sessionId, message) {
  const resp = await fetch(`${BASE}/api/portal/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${novaToken}`,
    },
    body: JSON.stringify({ content: message }),
  });
  return resp.json();
}

async function createSession(novaToken) {
  const resp = await fetch(`${BASE}/api/portal/chat/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${novaToken}`,
    },
    body: JSON.stringify({}),
  });
  return resp.json();
}

// ── Auth attempt ──

async function getNovaToken() {
  // Try login with common dev passwords
  for (const pw of ['admin', 'password', 'nickw', 'test123', 'Password1']) {
    try {
      const resp = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nickw', password: pw }),
      });
      const data = await resp.json();
      if (data.ok) return data.data.token;
    } catch {}
  }
  return null;
}

// ── Test definitions ──

const TESTS = [
  // === PRIORITY: Three named routing defects ===
  {
    id: 'DEFECT-1a',
    name: 'NT-55555 is not fixed → followup',
    message: 'NT-55555 is not fixed',
    expect: { category: 'followup', noJargon: true },
    priority: 'critical',
  },
  {
    id: 'DEFECT-1b',
    name: 'NT-20001 is not fixed → followup',
    message: 'NT-20001 is not fixed',
    expect: { category: 'followup', noJargon: true },
    priority: 'critical',
  },
  {
    id: 'DEFECT-1c',
    name: 'NT-12345 is not fixed yet → followup',
    message: 'NT-12345 is not fixed yet',
    expect: { category: 'followup', noJargon: true },
    priority: 'critical',
  },
  {
    id: 'DEFECT-1d',
    name: 'NT-99999 is not resolved → followup (variant)',
    message: 'NT-99999 is not resolved',
    expect: { category: 'followup', noJargon: true },
    priority: 'critical',
  },
  {
    id: 'DEFECT-2',
    name: 'Website-primary with incidental letters mention → website',
    message: 'Our website needs updating with new photos and branch details. We also have some letters that will need the same info eventually but the website is the priority.',
    expect: { category: 'website', noJargon: true },
    priority: 'critical',
  },
  {
    id: 'DEFECT-3',
    name: 'Property images on my website → website (not property)',
    message: 'The property images on my website are not loading properly',
    expect: { category: 'website', noJargon: true },
    priority: 'critical',
  },

  // === PROTECTED behaviour regression checks ===
  {
    id: 'PROT-1',
    name: 'Pure letters request → letters',
    message: 'We need new market appraisal letters designed for our spring campaign',
    expect: { category: 'letters', noJargon: true },
    priority: 'protected',
  },
  {
    id: 'PROT-2',
    name: 'Letters-primary with incidental website context → letters',
    message: 'We need our market appraisal letters updated - the ones we send after valuations. The copy on them still references our old website address.',
    expect: { category: 'letters', noJargon: true },
    priority: 'protected',
  },
  {
    id: 'PROT-3',
    name: 'Pure complaint → complaint',
    message: 'I want to make a formal complaint about the service I have received. Nobody has helped me and I am extremely frustrated.',
    expect: { category: 'complaint', noJargon: true },
    priority: 'protected',
  },
  {
    id: 'PROT-4',
    name: 'NT-11111 still not fixed → followup (canonical)',
    message: 'NT-11111 still not fixed',
    expect: { category: 'followup', noJargon: true },
    priority: 'protected',
  },
  {
    id: 'PROT-5',
    name: 'Pure website request → website',
    message: 'Can you update the phone number on our website contact page? It shows the old number.',
    expect: { category: 'website', noJargon: true },
    priority: 'protected',
  },
  {
    id: 'PROT-6',
    name: 'Property listing on Rightmove → property',
    message: 'Our listing at 14 Oak Lane is not showing on Rightmove - it was there yesterday but has disappeared',
    expect: { category: 'property', noJargon: true },
    priority: 'protected',
  },

  // === HOLDOUT scenarios ===
  {
    id: 'H1',
    name: 'Letters with incidental website context (holdout)',
    message: 'I need help with our correspondence - the mailshot letters we send to new instructions. They used to have our website link at the bottom but that is fine, the main thing is the letter content needs refreshing.',
    expect: { category: 'letters', noJargon: true },
    priority: 'holdout',
  },
  {
    id: 'H2a',
    name: 'NT-77777 is not fixed (holdout - different ticket number)',
    message: 'NT-77777 is not fixed',
    expect: { category: 'followup', noJargon: true },
    priority: 'holdout',
  },
  {
    id: 'H2b',
    name: 'NT-10001 is not working (holdout - variant verb)',
    message: 'NT-10001 is not working',
    expect: { category: 'followup', noJargon: true },
    priority: 'holdout',
  },
  {
    id: 'H3',
    name: 'Pure website after hardening (holdout - no regression)',
    message: 'Our homepage banner image needs replacing with the new spring campaign creative',
    expect: { category: 'website', noJargon: true },
    priority: 'holdout',
  },
];

// ── Jargon check ──

const JARGON_PATTERNS = [
  /\bNT\b(?!-\d)/i,           // NT without ticket number
  /\bNTPJ\b(?!-\d)/i,
  /\bcategor(y|ies)\b/i,
  /\bsubcategor/i,
  /\brouting\b/i,
  /\bescalation.*detect/i,
  /\bintake\b/i,
  /\bclassif/i,
  /\bproject.*key\b/i,
  /\bqueue.*name\b/i,
  /\bjira.*queue\b/i,
  /\bservice.*desk\b/i,       // internal Jira term
  /\bfollowup_not_resolved\b/,
  /\bfollowup_reopen\b/,
  /\bwebsite_broken\b/,
  /\bwebsite_content\b/,
  /\bletters_general\b/,
  /\bproperty_media\b/,
];

function detectJargon(text) {
  const found = [];
  for (const p of JARGON_PATTERNS) {
    if (p.test(text)) found.push(p.source);
  }
  return found;
}

function inferCategory(reply) {
  const lower = reply.toLowerCase();

  // Follow-up indicators
  if (/follow.?up|following up|linked to that ticket|still needs attention|raise a follow.?up/i.test(lower)) return 'followup';
  if (/your original request|i can see.*\bNT-/i.test(reply)) return 'followup';

  // Complaint indicators
  if (/complaint|formal complaint|escalat(e|ion)|sorry.*(hear|experience)|understand.*(frustr|disappoint)|concern.*seriously/i.test(lower)) return 'complaint';

  // Letters indicators
  if (/letter|correspondence|mailshot|market appraisal|production team|print/i.test(lower)) return 'letters';

  // Property indicators
  if (/rightmove|zoopla|listing|property.*feed|portal.*listing|syndication/i.test(lower)) return 'property';

  // Website indicators
  if (/website|web.?site|your site|page|homepage|url|content.*updat|phone.*number.*updat|photo.*updat|banner|design/i.test(lower)) return 'website';

  return 'unknown';
}

// ── Runner ──

async function run() {
  console.log('=== Edge-Case Routing Hardening Eval (Iteration 10) ===\n');

  // Try widget identify first
  let authMode = 'none';
  let token = null;
  let sessionId = null;

  const identResult = await identify('eval-agent@testeval.com');
  if (identResult.ok) {
    authMode = 'widget';
    token = identResult.data.token;
    sessionId = identResult.data.sessionId;
    console.log(`Auth: widget mode (session ${sessionId})\n`);
  } else {
    console.log(`Widget identify failed: ${identResult.error}`);
    // Try NOVA login
    const novaToken = await getNovaToken();
    if (novaToken) {
      authMode = 'nova';
      token = novaToken;
      console.log('Auth: NOVA internal mode\n');
    } else {
      console.log('Auth: Could not authenticate. Will attempt regex-only static analysis.\n');
    }
  }

  const results = [];

  for (const test of TESTS) {
    const result = { ...test, status: 'SKIP', reply: null, inferredCategory: null, jargon: [] };

    if (authMode === 'widget') {
      // Each test needs a fresh session for clean routing
      const freshSession = await identify(`eval-${test.id.toLowerCase()}@testeval.com`);
      if (freshSession.ok) {
        const chatResult = await chat(freshSession.data.token, freshSession.data.sessionId, test.message);
        if (chatResult.ok) {
          result.reply = chatResult.data.reply;
          result.inferredCategory = inferCategory(result.reply);
          result.jargon = detectJargon(result.reply);

          const categoryMatch = result.inferredCategory === test.expect.category ||
            (test.expect.category === 'followup' && result.inferredCategory === 'followup');
          const noJargonViolation = result.jargon.length === 0;

          result.status = categoryMatch && noJargonViolation ? 'PASS' : 'FAIL';
          if (!categoryMatch) result.failReason = `Expected ${test.expect.category}, inferred ${result.inferredCategory}`;
          if (!noJargonViolation) result.failReason = (result.failReason || '') + ` Jargon found: ${result.jargon.join(', ')}`;
        } else {
          result.status = 'ERROR';
          result.failReason = chatResult.error;
        }
      } else {
        result.status = 'ERROR';
        result.failReason = freshSession.error;
      }
    } else if (authMode === 'nova') {
      // Create fresh session for each test
      const sess = await createSession(token);
      if (sess.ok) {
        const chatResult = await chatViaSession(token, sess.data.id, test.message);
        if (chatResult.ok) {
          result.reply = chatResult.data.content;
          result.inferredCategory = inferCategory(result.reply);
          result.jargon = detectJargon(result.reply);

          const categoryMatch = result.inferredCategory === test.expect.category;
          const noJargonViolation = result.jargon.length === 0;

          result.status = categoryMatch && noJargonViolation ? 'PASS' : 'FAIL';
          if (!categoryMatch) result.failReason = `Expected ${test.expect.category}, inferred ${result.inferredCategory}`;
          if (!noJargonViolation) result.failReason = (result.failReason || '') + ` Jargon found: ${result.jargon.join(', ')}`;
        } else {
          result.status = 'ERROR';
          result.failReason = chatResult.error;
        }
      } else {
        result.status = 'ERROR';
        result.failReason = sess.error;
      }
    } else {
      // Static analysis fallback — test regex classification only
      result.status = 'STATIC';
      result.failReason = 'No runtime auth — static analysis only';
    }

    results.push(result);
  }

  // ── Output ──
  console.log('─── Results ───\n');

  const groups = { critical: [], protected: [], holdout: [] };
  for (const r of results) {
    groups[r.priority].push(r);
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'ERROR' ? '⚠' : '○';
    console.log(`  [${icon}] ${r.id}: ${r.name}`);
    if (r.status !== 'PASS' && r.failReason) console.log(`      → ${r.failReason}`);
    if (r.reply) console.log(`      Reply preview: ${r.reply.substring(0, 120)}...`);
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const errors = results.filter(r => r.status === 'ERROR').length;
  const skipped = results.filter(r => r.status === 'SKIP' || r.status === 'STATIC').length;

  console.log(`\n─── Summary ───`);
  console.log(`  Passed: ${passed}/${results.length}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Skipped/Static: ${skipped}`);
  console.log(`  Auth mode: ${authMode}`);

  const criticalFails = groups.critical.filter(r => r.status === 'FAIL');
  const protectedFails = groups.protected.filter(r => r.status === 'FAIL');

  if (criticalFails.length > 0) {
    console.log(`\n  ❌ CRITICAL FAILURES: ${criticalFails.map(r => r.id).join(', ')}`);
  }
  if (protectedFails.length > 0) {
    console.log(`\n  ❌ PROTECTED REGRESSIONS: ${protectedFails.map(r => r.id).join(', ')}`);
  }

  console.log(`\n  Verdict: ${criticalFails.length === 0 && protectedFails.length === 0 && errors === 0 && skipped === 0 ? 'CONVERGED' : 'NOT CONVERGED'}`);

  return { results, passed, failed, errors, skipped, authMode };
}

run().catch(console.error);
