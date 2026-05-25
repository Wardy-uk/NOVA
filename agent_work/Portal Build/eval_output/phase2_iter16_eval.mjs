/**
 * Phase 2 Iteration 16 — Field-Boundary Handling Eval
 * Tests: inline account extraction, edit-derived filler, 3-field simultaneous edits
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
  console.log(`  Session ${d.data.id} started`);
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
  return d.data;
}

function formatFields(fields) {
  if (!fields) return '(no fields)';
  return Object.entries(fields).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n');
}

const results = [];

async function runScenario(name, steps) {
  console.log(`\n=== SCENARIO: ${name} ===`);
  const sessionId = await startSession();
  const transcript = [];
  let lastReply = null;

  for (const step of steps) {
    console.log(`  USER: ${step}`);
    const reply = await send(sessionId, step);
    console.log(`  BOT: ${reply.content?.substring(0, 120)}...`);
    if (reply.metadata) console.log(`  META: ${JSON.stringify(reply.metadata)}`);
    transcript.push({ user: step, bot: reply.content, metadata: reply.metadata });
    lastReply = reply;
    await new Promise(r => setTimeout(r, 800));
  }

  // Capture final session state
  const session = await getSession(sessionId);
  const collectedFields = session?.collectedFields || session?.metadata?.collectedFields || lastReply?.metadata?.collectedFields;

  console.log(`  FINAL FIELDS:\n${formatFields(collectedFields)}`);
  results.push({ name, sessionId, transcript, collectedFields, session });
  return { sessionId, transcript, collectedFields, session };
}

async function main() {
  await getToken();

  // === TEST 1: Inline Account Extraction ===
  // Tests whether account name is cleanly extracted without trailing text
  await runScenario('Inline Account Extraction - Trailing Text', [
    "Hi, I need to update the phone number on our website for Acme Properties please, it's showing the wrong one",
  ]);

  await runScenario('Inline Account Extraction - Mid-sentence', [
    "The website for Thompson & Sons Estate Agents has an error on the contact page",
  ]);

  await runScenario('Inline Account Extraction - With URL Suffix', [
    "Our site acmeproperties.co.uk for Acme Properties Ltd needs the opening hours changed",
  ]);

  // === TEST 2: Edit-Derived Value Filler ===
  // Tests whether editing a summary strips filler like "should be", "just be", "change to"
  const editScenario = await runScenario('Edit-Derived Filler Stripping', [
    "I need to change the phone number on our homepage",
    "It's for Smith & Co Lettings",
    "The number should be 01onal 234 5678",
  ]);

  // Now test an edit with filler wording
  if (editScenario.session) {
    await runScenario('Edit With Filler - Priority Change', [
      "I need to update the office address on our website",
      "It's for Johnson Estates",
      "The current address is wrong, needs changing to 42 High Street",
      // If we get a summary, try editing with filler wording
      "the priority should just be high",
    ]);
  }

  // === TEST 3: Three-Field Simultaneous Edit ===
  await runScenario('Three-Field Simultaneous Edit', [
    "I need some changes on our website please",
    "It's for Premier Homes Realty",
    "Change the phone number on the contact page to 0800 123 456",
    // After getting summary, request 3 changes at once
    "Actually change the account to Belmont Properties, the priority to urgent, and the summary to Fix broken contact form",
  ]);

  // === TEST 4: Conversational Continuity Regression Check ===
  await runScenario('Conversational Activation - Natural Entry', [
    "hey, our website has the wrong email address on it",
  ]);

  await runScenario('Vague Request Clarification', [
    "Something needs changing",
    "on our website",
    "the phone number is wrong on the contact page for Greenfield Lettings",
  ]);

  await runScenario('Non-Website Routing', [
    "My property isn't showing up on Rightmove",
  ]);

  // === Write results ===
  const output = JSON.stringify(results, null, 2);
  const fs = await import('fs');
  fs.writeFileSync(
    'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/Portal Build/eval_output/phase2_iter16_results.json',
    output,
  );
  console.log('\n=== Results written ===');
  console.log(`Total scenarios: ${results.length}`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
