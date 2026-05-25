/**
 * Phase 2 Iteration 20 — Downstream Summary Fidelity Eval
 * Tests: phone contamination, account carry-through, description fidelity,
 *        post-summary correction propagation, conversational continuity
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

function parseMeta(reply) {
  if (!reply.metadata) return {};
  return typeof reply.metadata === 'string' ? JSON.parse(reply.metadata) : reply.metadata;
}

const results = [];

async function runScenario(name, steps) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${name}`);
  console.log('='.repeat(60));
  const sid = await startSession();
  console.log(`Session ID: ${sid}`);
  const transcript = [];
  let lastReply = null;
  let lastMeta = {};

  for (const step of steps) {
    if (typeof step === 'string') {
      console.log(`\n  USER: ${step}`);
      const reply = await send(sid, step);
      console.log(`  BOT: ${reply.content}`);
      lastMeta = parseMeta(reply);
      if (Object.keys(lastMeta).length > 0) {
        console.log(`  META: ${JSON.stringify(lastMeta, null, 2)}`);
      }
      if (reply.suggestedActions?.length) {
        console.log(`  ACTIONS: ${JSON.stringify(reply.suggestedActions)}`);
      }
      lastReply = reply;
      transcript.push({ role: 'user', content: step });
      transcript.push({ role: 'assistant', content: reply.content, meta: lastMeta });
    } else if (typeof step === 'function') {
      await step(sid, lastReply, lastMeta, transcript);
    }
  }

  // Get final session state
  const session = await getSession(sid);
  const sessionMeta = typeof session.metadata === 'string' ? JSON.parse(session.metadata) : (session.metadata || {});
  console.log(`\n  FINAL SESSION STAGE: ${sessionMeta.stage}`);
  console.log(`  FINAL COLLECTED FIELDS: ${JSON.stringify(sessionMeta.collectedFields, null, 2)}`);
  if (sessionMeta.synthesizedDescription) {
    console.log(`  SYNTHESIZED DESC: ${sessionMeta.synthesizedDescription}`);
  }

  results.push({ name, sessionId: sid, sessionMeta, transcript });
  return { sid, sessionMeta, transcript };
}

async function main() {
  await getToken();

  // ─── Scenario 1: Phone number in property issue ───
  // Tests whether phone numbers contaminate listingId
  await runScenario('Phone number in property issue', [
    "Hi, I'm having a problem with a property listing for Acme Estates. The phone number shown on the listing is wrong - it says 01onal234 5678 but should be 07700 900123. The property is at 42 High Street.",
    "The listing is on their main website at acmeestates.co.uk",
    "No that's everything thanks",
  ]);

  // ─── Scenario 2: Phone + listing ID coexistence ───
  // Tests whether phone numbers are separated from real listing IDs
  await runScenario('Phone + listing ref coexistence', [
    "We have a property listing ABC-12345 for Greenwood Estates that's showing the wrong contact numbers. The office number 0161 234 5678 and the mobile 0161 987 6543 are both out of date.",
    "It's the Greenwood Estates Manchester branch, and the listing is on their main site",
    "That looks right, yes",
  ]);

  // ─── Scenario 3: Account name carry-through with complex name ───
  // Tests account extraction with ampersand and suffix
  await runScenario('Account name carry-through', [
    "Hi, I need help with Henderson & Sons Lettings. Their website is loading really slowly, takes about 30 seconds to show any page. The URL is hendersonlettings.co.uk",
    "It started about two days ago, no changes were made on our end",
    "Yes that covers it",
  ]);

  // ─── Scenario 4: Late correction before summary ───
  // Tests whether corrections before summary are absorbed into structured fields
  await runScenario('Late correction before summary', [
    "I need to update a property listing for Baxter Properties. The address is wrong - it shows 14 Elm Lane but should be 14 Elm Close",
    "The listing ID is BP-2024-001 on their website baxterprops.co.uk",
    // Correct the address BEFORE summary
    "Actually sorry, it should be 14 Elm Crescent, not Elm Close",
    "Yes that's correct, submit it",
  ]);

  // ─── Scenario 5: Post-summary correction ───
  // Tests whether corrections AFTER summary are propagated
  await runScenario('Post-summary correction', [
    "Photos aren't loading on a listing for Maple Homes. The listing ref is ML-9876 and it's on their site maplehomes.co.uk",
    "It's the London branch",
    // After summary appears, correct the URL
    async (sid, lastReply, lastMeta, transcript) => {
      // Check if we're at summary stage
      const session = await getSession(sid);
      const meta = typeof session.metadata === 'string' ? JSON.parse(session.metadata) : (session.metadata || {});
      console.log(`  [CHECK] Stage before correction: ${meta.stage}`);
    },
    "Actually the URL is wrong, it should be maple-homes.co.uk not maplehomes.co.uk, and the listing ref is ML-9877 not 9876",
    "Yes that's all correct now, go ahead",
  ]);

  // ─── Scenario 6: Non-property issue (email/BYM) ───
  // Tests conversational continuity + correct categorisation
  await runScenario('Non-property email issue', [
    "We're getting bounce-backs on emails sent from BriefYourMarket for Sunrise Properties. About 40% of the last campaign bounced.",
    "The campaign was sent yesterday, campaign name was 'Spring Newsletter 2026'",
    "That's everything",
  ]);

  // ─── Scenario 7: Rich initial message + natural confirmation ───
  // Tests fast-path extraction and natural confirmation recognition
  await runScenario('Rich initial + natural confirmation', [
    "Hi, the website for Wilson & Co Estate Agents at wilsonco.co.uk is showing a 502 error on their property search page. This started about an hour ago and affects all search results. They're a key account so this is quite urgent.",
    "that's the badger, go ahead and raise it",
  ]);

  // ─── Write results ───
  console.log('\n\n' + '='.repeat(60));
  console.log('ANALYSIS');
  console.log('='.repeat(60));

  for (const r of results) {
    const fields = r.sessionMeta?.collectedFields || {};
    console.log(`\n[${r.name}] (session ${r.sessionId})`);
    console.log(`  Stage: ${r.sessionMeta?.stage}`);
    console.log(`  Account: ${fields.account || '(empty)'}`);
    console.log(`  ListingId: ${fields.listingId || '(empty)'}`);
    console.log(`  URL: ${fields.url || '(empty)'}`);
    console.log(`  PropertyAddress: ${fields.propertyAddress || '(empty)'}`);
    console.log(`  AffectedPersonName: ${fields.affectedPersonName || '(empty)'}`);
    console.log(`  Subject: ${fields.subject || '(empty)'}`);
    console.log(`  Description (first 200): ${(fields.description || '').substring(0, 200)}`);
    if (r.sessionMeta?.synthesizedDescription) {
      console.log(`  Synthesized (first 200): ${r.sessionMeta.synthesizedDescription.substring(0, 200)}`);
    }
  }

  // Write JSON for analysis
  const fs = await import('fs');
  fs.writeFileSync(
    'agent_work/Portal Build/eval_output/phase2_iter20_results.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\nResults written to phase2_iter20_results.json');
}

main().catch(err => {
  console.error('EVAL FAILED:', err);
  process.exit(1);
});
