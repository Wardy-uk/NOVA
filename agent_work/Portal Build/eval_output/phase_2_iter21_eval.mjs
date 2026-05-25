// Phase 2 Iteration 21 — Structured-field fidelity evaluation
// Tests: account fields, correction propagation, alphanumeric ID capture,
//        phone-number contamination, and conversational continuity

const BASE = 'http://localhost:3001';
const TOKEN_ENDPOINT = '/api/portal/auth/codex-test-login';
const CHAT_SESSIONS = '/api/portal/chat/sessions';

let token = '';

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE}${path}`, opts);
  const json = await r.json();
  return json;
}

async function login() {
  const r = await fetch(`${BASE}${TOKEN_ENDPOINT}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const json = await r.json();
  token = json.data.token;
  console.log(`Logged in as ${json.data.user.email} (org: ${json.data.user.orgName})`);
}

async function createSession() {
  const r = await api('POST', CHAT_SESSIONS);
  return r.data;
}

async function send(sessionId, content) {
  const r = await api('POST', `${CHAT_SESSIONS}/${sessionId}/messages`, { content });
  return r;
}

async function getSession(sessionId) {
  return api('GET', `${CHAT_SESSIONS}/${sessionId}`);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Scenario runners ──

async function scenario1_accountFieldReliability() {
  console.log('\n═══ SCENARIO 1: Account field reliability ═══');
  console.log('Goal: Provide account name in initial message and see if it sticks');

  const session = await createSession();
  console.log(`Session ${session.id} created`);

  // Send a message with the account name clearly stated
  const msg1 = await send(session.id,
    "Hi, we need to update the phone number on our website. The account is Greenfield Lettings, account number GF-2847."
  );
  console.log(`\nUser: "account is Greenfield Lettings, account number GF-2847"`);
  console.log(`Bot: ${msg1.data?.content || msg1.error}`);
  console.log(`Metadata: ${JSON.stringify(msg1.data?.metadata || {})}`);

  await delay(1500);

  // Check session state
  const state1 = await getSession(session.id);
  console.log(`\nSession fields after msg1:`);
  console.log(JSON.stringify(state1.data?.fields || state1.data?.metadata, null, 2));

  // Continue conversation
  const msg2 = await send(session.id,
    "The current number is 01onal 234 5678 and it should be 0191 555 9012. It's on the contact page."
  );
  console.log(`\nUser: gives phone details + page`);
  console.log(`Bot: ${msg2.data?.content || msg2.error}`);

  await delay(1500);

  const state2 = await getSession(session.id);
  console.log(`\nSession fields after msg2:`);
  console.log(JSON.stringify(state2.data?.fields || state2.data?.metadata, null, 2));

  return { session: session.id, state: state2.data };
}

async function scenario2_correctionPropagation() {
  console.log('\n═══ SCENARIO 2: Correction propagation ═══');
  console.log('Goal: Provide details, then correct them, and see if the fields update');

  const session = await createSession();
  console.log(`Session ${session.id} created`);

  const msg1 = await send(session.id,
    "I need to report a problem with our website. The site is https://www.wrongurl.com and it's showing a 500 error on the home page."
  );
  console.log(`\nUser: reports problem with wrongurl.com`);
  console.log(`Bot: ${msg1.data?.content || msg1.error}`);

  await delay(1500);

  const state1 = await getSession(session.id);
  console.log(`\nFields after initial: ${JSON.stringify(state1.data?.fields || state1.data?.metadata, null, 2)}`);

  // Now correct the URL
  const msg2 = await send(session.id,
    "Sorry, I gave you the wrong URL. The actual website is https://www.correctsite.co.uk"
  );
  console.log(`\nUser: corrects URL to correctsite.co.uk`);
  console.log(`Bot: ${msg2.data?.content || msg2.error}`);

  await delay(1500);

  const state2 = await getSession(session.id);
  console.log(`\nFields after URL correction: ${JSON.stringify(state2.data?.fields || state2.data?.metadata, null, 2)}`);

  // Now correct the account too
  const msg3 = await send(session.id,
    "Oh and the account name is actually Premier Properties, not whatever I said before."
  );
  console.log(`\nUser: corrects account name`);
  console.log(`Bot: ${msg3.data?.content || msg3.error}`);

  await delay(1500);

  const state3 = await getSession(session.id);
  console.log(`\nFields after account correction: ${JSON.stringify(state3.data?.fields || state3.data?.metadata, null, 2)}`);

  return { session: session.id, state: state3.data };
}

async function scenario3_alphanumericIdCapture() {
  console.log('\n═══ SCENARIO 3: Alphanumeric listing/reference ID capture ═══');
  console.log('Goal: See if property listing IDs are captured correctly');

  const session = await createSession();
  console.log(`Session ${session.id} created`);

  const msg1 = await send(session.id,
    "One of our property listings isn't appearing on Rightmove. The listing reference is RM-45821-A and the property is 14 Orchard Lane, Leeds, LS6 3PQ."
  );
  console.log(`\nUser: listing ref RM-45821-A, property address`);
  console.log(`Bot: ${msg1.data?.content || msg1.error}`);

  await delay(1500);

  const state1 = await getSession(session.id);
  console.log(`\nFields: ${JSON.stringify(state1.data?.fields || state1.data?.metadata, null, 2)}`);

  // Provide account when asked
  const msg2 = await send(session.id,
    "The account is Yorkshire Homes, and the portal reference is YH-2024-Q3-117."
  );
  console.log(`\nUser: gives account + another reference ID`);
  console.log(`Bot: ${msg2.data?.content || msg2.error}`);

  await delay(1500);

  const state2 = await getSession(session.id);
  console.log(`\nFields after IDs provided: ${JSON.stringify(state2.data?.fields || state2.data?.metadata, null, 2)}`);

  return { session: session.id, state: state2.data };
}

async function scenario4_phoneNumberContamination() {
  console.log('\n═══ SCENARIO 4: Phone number contamination of identifiers ═══');
  console.log('Goal: Ensure phone numbers are not captured as property/listing IDs');

  const session = await createSession();
  console.log(`Session ${session.id} created`);

  const msg1 = await send(session.id,
    "Hi, our website contact page has the wrong phone number. It shows 0161 234 5678 but it should be 0161 987 6543. Our account is Northside Estates. Call me on 07700 900123 if you need more info."
  );
  console.log(`\nUser: three phone numbers + account name`);
  console.log(`Bot: ${msg1.data?.content || msg1.error}`);

  await delay(1500);

  const state1 = await getSession(session.id);
  console.log(`\nFields: ${JSON.stringify(state1.data?.fields || state1.data?.metadata, null, 2)}`);

  // Follow up with a URL
  const msg2 = await send(session.id,
    "The website is https://www.northsideestates.co.uk/contact"
  );
  console.log(`\nUser: provides URL`);
  console.log(`Bot: ${msg2.data?.content || msg2.error}`);

  await delay(1500);

  const state2 = await getSession(session.id);
  console.log(`\nFields after URL: ${JSON.stringify(state2.data?.fields || state2.data?.metadata, null, 2)}`);

  return { session: session.id, state: state2.data };
}

async function scenario5_conversationalContinuity() {
  console.log('\n═══ SCENARIO 5: Conversational continuity (regression check) ═══');
  console.log('Goal: Ensure earlier Phase 2 gains remain intact');

  const session = await createSession();
  console.log(`Session ${session.id} created`);

  // Test natural free-text activation
  const msg1 = await send(session.id,
    "Something weird is happening with our website search. When people search for properties the results are all jumbled up."
  );
  console.log(`\nUser: vague free-text problem`);
  console.log(`Bot: ${msg1.data?.content || msg1.error}`);

  await delay(1500);

  // Test natural clarification
  const msg2 = await send(session.id,
    "It's our main client site, Premier Properties at premierprops.co.uk"
  );
  console.log(`\nUser: provides account + URL naturally`);
  console.log(`Bot: ${msg2.data?.content || msg2.error}`);

  await delay(1500);

  // Test accepting ticket creation naturally
  const msg3 = await send(session.id,
    "Yes, that sounds right. Please go ahead and log it."
  );
  console.log(`\nUser: natural confirmation`);
  console.log(`Bot: ${msg3.data?.content || msg3.error}`);

  await delay(1500);

  const state = await getSession(session.id);
  console.log(`\nFinal session state: ${JSON.stringify(state.data?.fields || state.data?.metadata, null, 2)}`);
  console.log(`Stage: ${state.data?.stage || 'unknown'}`);

  return { session: session.id, state: state.data };
}

async function scenario6_accountCorrectionAfterSummary() {
  console.log('\n═══ SCENARIO 6: Account correction during summary review ═══');
  console.log('Goal: Correct account in summary review and see if it updates');

  const session = await createSession();
  console.log(`Session ${session.id} created`);

  // Rich initial message to fast-track
  const msg1 = await send(session.id,
    "Our website www.testaccount.co.uk has a broken image on the About Us page. Account name is Test Account Ltd, reference TA-001."
  );
  console.log(`\nUser: detailed initial request`);
  console.log(`Bot: ${msg1.data?.content || msg1.error}`);

  await delay(1500);

  // If asked to confirm or if more details needed
  const msg2 = await send(session.id,
    "Yes, please create the ticket."
  );
  console.log(`\nUser: confirms ticket creation`);
  console.log(`Bot: ${msg2.data?.content || msg2.error}`);

  await delay(1500);

  const state = await getSession(session.id);
  console.log(`\nSession state: ${JSON.stringify(state.data?.fields || state.data?.metadata, null, 2)}`);
  console.log(`Stage: ${state.data?.stage || 'unknown'}`);

  // If we reached summary, try correcting
  if (state.data?.stage === 'summary') {
    const msg3 = await send(session.id,
      "Actually the account name should be Test Account Holdings, not Test Account Ltd."
    );
    console.log(`\nUser: corrects account in summary`);
    console.log(`Bot: ${msg3.data?.content || msg3.error}`);

    await delay(1500);

    const state2 = await getSession(session.id);
    console.log(`\nFields after summary correction: ${JSON.stringify(state2.data?.fields || state2.data?.metadata, null, 2)}`);
  }

  return { session: session.id, state: state.data };
}

// ── Main ──

async function main() {
  console.log('Phase 2 Iteration 21 — Structured Field Fidelity Evaluation');
  console.log('='.repeat(60));

  await login();

  const results = {};

  results.s1 = await scenario1_accountFieldReliability();
  results.s2 = await scenario2_correctionPropagation();
  results.s3 = await scenario3_alphanumericIdCapture();
  results.s4 = await scenario4_phoneNumberContamination();
  results.s5 = await scenario5_conversationalContinuity();
  results.s6 = await scenario6_accountCorrectionAfterSummary();

  console.log('\n' + '='.repeat(60));
  console.log('All scenarios complete. Review output above for structured-field fidelity assessment.');

  // Write raw results
  const fs = await import('fs');
  fs.writeFileSync(
    'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/Portal Build/eval_output/phase_2_iter21_results.json',
    JSON.stringify(results, null, 2)
  );
  console.log('\nResults written to phase_2_iter21_results.json');
}

main().catch(console.error);
