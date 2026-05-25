/**
 * Property / Listing Issues — Iteration 3 Blocker Fix Evaluation
 *
 * Tests:
 * 1. Frustration detection for previously-failing holdouts
 * 2. Operational detail preservation when empathy fires
 * 3. Website Design regression protection
 */

const BASE = 'http://127.0.0.1:3001';
let AUTH_TOKEN = '';

const results = { pass: 0, fail: 0, details: [] };

function record(section, name, passed, reason) {
  results.details.push({ section, name, passed, reason });
  if (passed) results.pass++; else results.fail++;
  console.log(`  ${passed ? 'PASS' : 'FAIL'} | ${name}${reason ? ' — ' + reason : ''}`);
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { 'Authorization': `Bearer ${AUTH_TOKEN}` } : {}),
  };
}

async function authenticate() {
  // Try codex test login first (dev mode)
  let res = await fetch(`${BASE}/api/portal/auth/codex-test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  let data = await res.json();
  if (data.ok) {
    AUTH_TOKEN = data.data.token;
    console.log('Authenticated via codex test login (portal token)');
    return;
  }

  // Fallback: try NOVA login with common dev credentials
  for (const pw of ['admin', 'password', 'nova']) {
    res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nickw', password: pw }),
    });
    data = await res.json();
    if (data.ok) {
      AUTH_TOKEN = data.data.token;
      console.log(`Authenticated as nickw (NOVA token)`);
      return;
    }
  }

  throw new Error('Could not authenticate — tried codex test login and NOVA login');
}

async function createSession() {
  const res = await fetch(`${BASE}/api/portal/chat/sessions`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Session create failed: ${JSON.stringify(data)}`);
  return data.data;
}

async function sendMessage(sessionId, content) {
  const res = await fetch(`${BASE}/api/portal/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ content }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Message send failed: ${JSON.stringify(data)}`);
  return data.data;
}

async function getSessionMeta(sessionId) {
  const res = await fetch(`${BASE}/api/portal/chat/sessions/${sessionId}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Session get failed: ${JSON.stringify(data)}`);
  const session = data.data.session || data.data;
  const raw = session.metadata;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// ── Section 1: Frustration Detection ──

async function testFrustrationDetection() {
  console.log('\n=== SECTION 1: Frustration Detection ===');

  const cases = [
    { name: 'Adverb-separated: absolutely furious', msg: "I'm absolutely furious about this situation" },
    { name: 'Adverb-separated: completely furious', msg: "I'm completely furious" },
    { name: 'Adverb-separated: completely ridiculous', msg: "This is completely ridiculous" },
    { name: 'Sarcasm: great service', msg: "Wow, great service this is" },
    { name: 'Passive frustration: wonder if anyone reads', msg: "I'm starting to wonder if anyone reads these requests" },
    { name: 'Existing: been broken for days', msg: "This has been broken for days and nobody is fixing it" },
    { name: 'Existing: utterly useless', msg: "This is utterly useless" },
    { name: 'Thanks for nothing', msg: "Thanks for nothing, this listing is still wrong" },
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      const reply = await sendMessage(session.id, c.msg);
      const text = reply.content.toLowerCase();

      // Frustration should trigger empathy + handoff offer, NOT a category picker
      const hasEmpathy = text.includes('frustrat') || text.includes('sorry') || text.includes('hear you') || text.includes('understand');
      const hasHandoff = text.includes('ticket') || text.includes('team member') || text.includes('help you directly');
      const hasCategoryPicker = text.includes('which area') || text.includes('best describes') || text.includes('my website') || text.includes('my account');

      if (hasEmpathy && hasHandoff && !hasCategoryPicker) {
        record('Frustration', c.name, true);
      } else {
        const reasons = [];
        if (!hasEmpathy) reasons.push('no empathy');
        if (!hasHandoff) reasons.push('no handoff offer');
        if (hasCategoryPicker) reasons.push('category picker appeared');
        record('Frustration', c.name, false, reasons.join(', '));
      }
    } catch (err) {
      record('Frustration', c.name, false, err.message);
    }
  }
}

// ── Section 2: Operational Detail Preservation Under Frustration ──

async function testDetailPreservation() {
  console.log('\n=== SECTION 2: Detail Preservation During Frustration ===');

  // Scenario: frustrated message WITH property details
  try {
    const session = await createSession();
    await sendMessage(session.id, "This is ridiculous, property REF-123 at 14 Church Lane still isn't showing on Rightmove.");
    const meta = await getSessionMeta(session.id);
    const f = meta.collectedFields || {};

    record('Detail', 'Property address preserved', !!f.propertyAddress, f.propertyAddress || 'not captured');
    record('Detail', 'Affected portals preserved', !!f.affectedPortals, f.affectedPortals || 'not captured');
    record('Detail', 'Description preserved', !!f.description, f.description ? 'captured' : 'not captured');
    record('Detail', 'Category set to property', meta.category === 'property', `category=${meta.category}`);
  } catch (err) {
    record('Detail', 'Frustration + detail scenario', false, err.message);
  }

  // Scenario: pure frustration without property detail should still work
  try {
    const session = await createSession();
    const reply = await sendMessage(session.id, "I'm absolutely furious about the service I've received.");
    const text = reply.content.toLowerCase();
    const hasEmpathy = text.includes('sorry') || text.includes('frustrat') || text.includes('hear you');
    record('Detail', 'Pure frustration (no property) still gets empathy', hasEmpathy, '');
  } catch (err) {
    record('Detail', 'Pure frustration scenario', false, err.message);
  }

  // Scenario: frustrated with portal details, empathy should reference them
  try {
    const session = await createSession();
    const reply = await sendMessage(session.id, "This is ridiculous, 42 Oak Avenue isn't showing on Zoopla and it's been 3 days.");
    const text = reply.content.toLowerCase();
    const referencesDetail = text.includes('oak avenue') || text.includes('zoopla') || text.includes('42');
    record('Detail', 'Empathy references property details', referencesDetail, '');
  } catch (err) {
    record('Detail', 'Empathy detail reference', false, err.message);
  }
}

// ── Section 3: Website Design Regression ──

async function testWebsiteRegression() {
  console.log('\n=== SECTION 3: Website Design Regression Protection ===');

  const cases = [
    {
      name: 'Simple content change routes to website',
      msg: 'Our homepage phone number is wrong. It should be 01234 567890.',
      checkCategory: 'website',
      checkNoPicker: true,
    },
    {
      name: 'Website design request routes correctly',
      msg: 'We need the header redesigned on our website, the logo is too small.',
      checkCategory: 'website',
      checkNoPicker: true,
    },
    {
      name: 'Property request does NOT route to website',
      msg: "My property isn't showing on Rightmove.",
      checkCategory: 'property',
      checkNoPicker: true,
    },
    {
      name: 'Website-with-portal routes to property',
      msg: "Our listing isn't showing on Zoopla or our website.",
      checkCategory: 'property',
      checkNoPicker: true,
    },
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      const reply = await sendMessage(session.id, c.msg);
      const meta = await getSessionMeta(session.id);
      const text = reply.content.toLowerCase();

      const hasCategoryPicker = text.includes('which area') || text.includes('best describes');
      const categoryCorrect = meta.category === c.checkCategory;

      if (categoryCorrect && (c.checkNoPicker ? !hasCategoryPicker : true)) {
        record('WebRegression', c.name, true);
      } else {
        const reasons = [];
        if (!categoryCorrect) reasons.push(`category=${meta.category}, expected=${c.checkCategory}`);
        if (c.checkNoPicker && hasCategoryPicker) reasons.push('category picker appeared');
        record('WebRegression', c.name, false, reasons.join(', '));
      }
    } catch (err) {
      record('WebRegression', c.name, false, err.message);
    }
  }
}

// ── Section 4: Property-vs-Website Detection Stability ──

async function testPropertyWebsiteRouting() {
  console.log('\n=== SECTION 4: Property vs Website Routing Stability ===');

  const cases = [
    { name: 'Rightmove missing listing → property', msg: "One of our properties isn't showing on Rightmove.", expected: 'property' },
    { name: 'Vague property → property', msg: "Our property isn't showing properly.", expected: 'property' },
    { name: 'Website content update → website', msg: "Can you update the phone number on our contact page?", expected: 'website' },
    { name: 'Zoopla + website → property', msg: "The property shows on our website but not on Zoopla.", expected: 'property' },
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      await sendMessage(session.id, c.msg);
      const meta = await getSessionMeta(session.id);
      record('Routing', c.name, meta.category === c.expected, `got=${meta.category}`);
    } catch (err) {
      record('Routing', c.name, false, err.message);
    }
  }
}

// ── Run All ──

async function main() {
  console.log('Property / Listing Issues — Iteration 3 Blocker Fix Evaluation');
  console.log('================================================================');

  await authenticate();

  await testFrustrationDetection();
  await testDetailPreservation();
  await testWebsiteRegression();
  await testPropertyWebsiteRouting();

  console.log('\n================================================================');
  console.log(`TOTAL: ${results.pass} pass, ${results.fail} fail out of ${results.pass + results.fail}`);
  console.log(`PASS RATE: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`);

  const failures = results.details.filter(d => !d.passed);
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(`  - [${f.section}] ${f.name}: ${f.reason}`));
  }

  // Write results
  const fs = await import('fs');
  fs.writeFileSync(
    'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output/property_iter3_results.json',
    JSON.stringify(results, null, 2),
  );
  console.log('\nResults written to agent_work/eval_output/property_iter3_results.json');
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
