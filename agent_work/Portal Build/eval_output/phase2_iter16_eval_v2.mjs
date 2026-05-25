/**
 * Phase 2 Iteration 16 — Field-Boundary Handling Eval (v2)
 * Push conversations to summary stage, then test field-boundary edits.
 */

const BASE = 'http://localhost:3001/api/portal';
let TOKEN = '';

async function getToken() {
  const res = await fetch(`${BASE}/auth/codex-test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const d = await res.json();
  TOKEN = d.data.token;
  console.log('Auth OK, userId:', d.data.user.userId);
}

async function startSession() {
  const res = await fetch(`${BASE}/chat/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  });
  const d = await res.json();
  if (!d.ok) throw new Error('Session failed: ' + JSON.stringify(d));
  return d.data.id;
}

async function send(sessionId, content) {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ content }),
  });
  const d = await res.json();
  if (!d.ok) throw new Error('Send failed: ' + JSON.stringify(d));
  return d.data;
}

async function getSession(sessionId) {
  const res = await fetch(`${BASE}/chat/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const d = await res.json();
  return d.data || d;
}

function logReply(reply) {
  console.log(`  BOT: ${reply.content}`);
  if (reply.metadata) {
    const meta = typeof reply.metadata === 'string' ? JSON.parse(reply.metadata) : reply.metadata;
    const keys = Object.keys(meta);
    if (keys.length > 0) console.log(`  META: ${JSON.stringify(meta)}`);
  }
  if (reply.suggestedActions?.length) console.log(`  ACTIONS: ${JSON.stringify(reply.suggestedActions)}`);
}

const results = [];

async function runScenario(name, steps) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${name}`);
  console.log('='.repeat(60));
  const sessionId = await startSession();
  console.log(`  Session: ${sessionId}`);
  const transcript = [];

  for (const step of steps) {
    console.log(`\n  USER: ${step}`);
    const reply = await send(sessionId, step);
    logReply(reply);
    transcript.push({ user: step, bot: reply.content, metadata: reply.metadata, actions: reply.suggestedActions });
    await new Promise(r => setTimeout(r, 1000));
  }

  // Get full session state
  const session = await getSession(sessionId);
  const fields = session?.collectedFields || session?.fields;
  if (fields) {
    console.log('\n  COLLECTED FIELDS:');
    for (const [k, v] of Object.entries(fields)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
  }
  if (session?.status) console.log(`  STATUS: ${session.status}`);

  results.push({ name, sessionId, transcript, session });
  return { sessionId, transcript, session };
}

async function main() {
  await getToken();

  // === TEST 1: Complete flow with inline account — check extraction cleanliness ===
  await runScenario('T1: Inline Account Extraction Cleanliness', [
    "Hi, I need to update the phone number on the website for Acme Properties please, it's currently showing an old number",
    "The URL is acmeproperties.co.uk",
    "The phone number on the contact page says 01onal 111 2222 but it should be 01234 567 890",
  ]);

  // === TEST 2: Account extraction with trailing text ===
  await runScenario('T2: Account With Trailing Clause', [
    "The website for Thompson & Sons Estate Agents has an error on the contact page and needs fixing urgently",
    "www.thompsonandsons.co.uk",
    "The email address is wrong, it says info@old.com but should be hello@thompsonandsons.co.uk",
  ]);

  // === TEST 3: Account + URL bundled ===
  await runScenario('T3: Account + URL Bundled In One Message', [
    "Our site acmeproperties.co.uk for Acme Properties Ltd needs the opening hours changed on the contact page",
    "Currently says Mon-Fri 9-5 but should be Mon-Sat 9-6",
  ]);

  // === TEST 4: Full flow then edit with filler wording ===
  await runScenario('T4: Edit With Filler Wording', [
    "I need to change the phone number on our homepage",
    "It's for Smith & Co Lettings",
    "www.smithlettings.co.uk",
    "The number currently shows 0111 111 1111 but should be 0222 222 2222",
    // Try editing with filler after summary
    "actually the priority should just be high",
  ]);

  // === TEST 5: Edit with "change X to Y" filler ===
  await runScenario('T5: Edit With Change-To Filler', [
    "Need to update the address on our website for Premier Homes",
    "premierhomes.co.uk",
    "The address on the about page says 10 Low Street but should be 42 High Street, London EC1A 1BB",
    // After summary, edit with filler
    "change the summary to Address update needed on about page",
  ]);

  // === TEST 6: Three-field simultaneous edit ===
  await runScenario('T6: Three-Field Simultaneous Edit', [
    "I need some changes on our website please",
    "It's for Premier Homes Realty",
    "premierhomesrealty.co.uk",
    "The phone number on the contact page needs changing from 0800 000 000 to 0800 123 456",
    // Now try 3-field edit at once
    "Actually change the account to Belmont Properties, the priority to urgent, and the summary to Fix broken contact form",
  ]);

  // === TEST 7: Conversational continuity - natural entry still works ===
  await runScenario('T7: Conversational Activation - Natural Entry', [
    "hey, our website has the wrong email address on it",
  ]);

  // === TEST 8: Vague request still gets clarification ===
  await runScenario('T8: Vague Request Clarification', [
    "Something needs changing",
    "on our website",
    "the phone number is wrong on the contact page for Greenfield Lettings",
  ]);

  // === TEST 9: Non-website routing preserved ===
  await runScenario('T9: Non-Website Routing', [
    "My property isn't showing up on Rightmove",
  ]);

  // === TEST 10: Summary confirmation with "yes that's right" ===
  await runScenario('T10: Natural Summary Confirmation', [
    "Need to fix the email on our website for Oakwood Estates",
    "oakwoodestates.co.uk",
    "The contact page email says old@oakwood.com but should be info@oakwoodestates.co.uk",
    "yes that looks right",
  ]);

  // Write output
  const fs = await import('fs');
  fs.writeFileSync(
    'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/Portal Build/eval_output/phase2_iter16_results_v2.json',
    JSON.stringify(results, null, 2),
  );

  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    const lastBot = r.transcript[r.transcript.length - 1]?.bot?.substring(0, 100) || '';
    const fields = r.session?.collectedFields || r.session?.fields;
    const fieldCount = fields ? Object.keys(fields).length : 0;
    console.log(`  ${r.name}: ${r.transcript.length} turns, ${fieldCount} fields, status=${r.session?.status || '?'}`);
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        console.log(`    ${k} = ${JSON.stringify(v)}`);
      }
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
