/**
 * Property / Listing Issues — Iteration 3 INDEPENDENT Eval
 * Eval Agent — Workstream 1
 *
 * Sections:
 * 1. Frustration detection coverage (incl. Build Agent's holdouts + new cases)
 * 2. Operational detail preservation under empathy
 * 3. Property-vs-website routing separation
 * 4. Hidden taxonomy protection (no internal category names leak)
 * 5. No category picker fallback on property paths
 * 6. No conversational resets
 * 7. Website Design / Content Changes regression
 * 8. Edge cases & adversarial inputs
 */

const BASE = 'http://127.0.0.1:3001';
let AUTH_TOKEN = '';

const results = { pass: 0, fail: 0, details: [] };

function record(section, name, passed, reason) {
  results.details.push({ section, name, passed, reason: reason || '' });
  if (passed) results.pass++; else results.fail++;
  console.log(`  ${passed ? 'PASS' : 'FAIL'} | [${section}] ${name}${reason ? ' — ' + reason : ''}`);
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
  };
}

async function authenticate() {
  let res = await fetch(`${BASE}/api/portal/auth/codex-test-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  let data = await res.json();
  if (data.ok) {
    AUTH_TOKEN = data.data.token;
    console.log('Authenticated via codex test login');
    return;
  }
  for (const pw of ['admin', 'password', 'nova']) {
    res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nickw', password: pw }),
    });
    data = await res.json();
    if (data.ok) {
      AUTH_TOKEN = data.data.token;
      console.log(`Authenticated as nickw`);
      return;
    }
  }
  throw new Error('Authentication failed');
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

// ── Section 1: Frustration Detection Coverage ──

async function testFrustrationDetection() {
  console.log('\n=== SECTION 1: Frustration Detection Coverage ===');

  const cases = [
    // Previously-failing holdouts (Build Agent claims fixed)
    { name: 'Adverb: absolutely furious',      msg: "I'm absolutely furious about this" },
    { name: 'Adverb: completely ridiculous',    msg: "This is completely ridiculous" },
    { name: 'Sarcasm: wow great service',       msg: "Wow, great service this is" },
    { name: 'Passive: wonder if anyone reads',  msg: "I'm starting to wonder if anyone reads these" },
    { name: 'Thanks for nothing',               msg: "Thanks for nothing" },

    // Existing cases that should still work
    { name: 'Been broken for days',             msg: "This has been broken for days and nobody is fixing it" },
    { name: 'Utterly useless',                  msg: "This is utterly useless" },
    { name: 'Speak to real person',             msg: "I want to speak to a real person" },
    { name: 'Fed up',                           msg: "I'm fed up with this" },
    { name: 'Excessive punctuation',            msg: "Why is this STILL not working????" },

    // New eval-only holdouts (not in Build Agent's script)
    { name: 'Adverb: totally ridiculous',       msg: "This is totally ridiculous, sort it out" },
    { name: 'Adverb: so frustrated',            msg: "I'm so frustrated with this service" },
    { name: 'Sarcasm: oh brilliant service',    msg: "Oh, brilliant service as always" },
    { name: 'Passive: does anyone even check',  msg: "Does anyone even check these requests?" },
    { name: 'Nobody listening',                 msg: "Nobody is listening to me about this property" },
    { name: 'Been waiting for weeks',           msg: "This listing has been wrong for weeks now" },
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      const reply = await sendMessage(session.id, c.msg);
      const text = reply.content.toLowerCase();

      const hasEmpathy = /\b(frustrat|sorry|hear you|understand|apologise|apologize)\b/.test(text);
      const hasHandoff = text.includes('ticket') || text.includes('team member') || text.includes('help you directly');
      const hasCategoryPicker = text.includes('which area') || text.includes('best describes') || text.includes('my website') || text.includes('my account');

      if (hasEmpathy && hasHandoff && !hasCategoryPicker) {
        record('Frustration', c.name, true);
      } else {
        const reasons = [];
        if (!hasEmpathy) reasons.push('no empathy');
        if (!hasHandoff) reasons.push('no handoff offer');
        if (hasCategoryPicker) reasons.push('CATEGORY PICKER appeared');
        record('Frustration', c.name, false, reasons.join(', '));
      }
    } catch (err) {
      record('Frustration', c.name, false, err.message);
    }
  }
}

// ── Section 2: Operational Detail Preservation Under Empathy ──

async function testDetailPreservation() {
  console.log('\n=== SECTION 2: Operational Detail Preservation ===');

  // Case A: Frustrated + property details
  try {
    const session = await createSession();
    await sendMessage(session.id, "This is ridiculous, property REF-123 at 14 Church Lane still isn't showing on Rightmove.");
    const meta = await getSessionMeta(session.id);
    const f = meta.collectedFields || {};

    record('Detail', 'Address preserved (14 Church Lane)', !!f.propertyAddress, f.propertyAddress || 'empty');
    record('Detail', 'Portal preserved (Rightmove)', /rightmove/i.test(f.affectedPortals || ''), f.affectedPortals || 'empty');
    record('Detail', 'Description preserved', !!f.description, f.description ? 'captured' : 'empty');
    record('Detail', 'Category set to property', meta.category === 'property', `category=${meta.category}`);
  } catch (err) {
    record('Detail', 'Frustrated + property details scenario', false, err.message);
  }

  // Case B: Frustrated + multiple portals + address
  try {
    const session = await createSession();
    await sendMessage(session.id, "This is absolutely ridiculous, 42 Oak Avenue isn't on Zoopla or Rightmove and it's been 3 days.");
    const meta = await getSessionMeta(session.id);
    const f = meta.collectedFields || {};

    record('Detail', 'Address preserved (42 Oak Avenue)', /oak avenue/i.test(f.propertyAddress || ''), f.propertyAddress || 'empty');
    record('Detail', 'Multiple portals preserved', /zoopla/i.test(f.affectedPortals || '') && /rightmove/i.test(f.affectedPortals || ''), f.affectedPortals || 'empty');
  } catch (err) {
    record('Detail', 'Frustrated + multiple portals scenario', false, err.message);
  }

  // Case C: Empathy response references specifics
  try {
    const session = await createSession();
    const reply = await sendMessage(session.id, "This is ridiculous, 7 Maple Drive isn't showing on Zoopla.");
    const text = reply.content.toLowerCase();

    const referencesDetail = text.includes('maple drive') || text.includes('zoopla') || text.includes('7');
    record('Detail', 'Empathy response references property details', referencesDetail, '');
  } catch (err) {
    record('Detail', 'Empathy detail reference scenario', false, err.message);
  }

  // Case D: Pure frustration (no property) still gets empathy
  try {
    const session = await createSession();
    const reply = await sendMessage(session.id, "I'm completely furious about this terrible service.");
    const text = reply.content.toLowerCase();
    const hasEmpathy = /\b(frustrat|sorry|hear you|understand)\b/.test(text);
    record('Detail', 'Pure frustration (no property) still gets empathy', hasEmpathy, '');
  } catch (err) {
    record('Detail', 'Pure frustration scenario', false, err.message);
  }
}

// ── Section 3: Property-vs-Website Routing ──

async function testPropertyWebsiteRouting() {
  console.log('\n=== SECTION 3: Property vs Website Routing ===');

  const cases = [
    { name: 'Rightmove listing → property',        msg: "Our property isn't showing on Rightmove.",               expected: 'property' },
    { name: 'Zoopla wrong details → property',      msg: "The price on Zoopla is wrong for our listing.",          expected: 'property' },
    { name: 'Vague property → property',            msg: "Our property listing isn't showing properly.",           expected: 'property' },
    { name: 'Feed sync → property',                 msg: "The property feed hasn't updated in 2 days.",            expected: 'property' },
    { name: 'Website phone number → website',       msg: "Can you update the phone number on our contact page?",   expected: 'website' },
    { name: 'Website redesign → website',           msg: "We need the header redesigned, the logo is too small.",  expected: 'website' },
    { name: 'Website + portal mix → property',      msg: "The property shows on our website but not on Zoopla.",   expected: 'property' },
    { name: 'OnTheMarket → property',               msg: "Listing not appearing on OnTheMarket.",                  expected: 'property' },
    { name: 'Floorplan missing → property',         msg: "The floorplan is missing from our listing.",             expected: 'property' },
    { name: 'Property status wrong → property',     msg: "We've sold 10 High St but it still shows as available.", expected: 'property' },
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

// ── Section 4: Hidden Taxonomy Protection ──

async function testHiddenTaxonomy() {
  console.log('\n=== SECTION 4: Hidden Taxonomy Protection ===');

  const cases = [
    { name: 'Property listing issue', msg: "My listing isn't appearing on Rightmove." },
    { name: 'Property photos wrong',  msg: "The wrong photos are showing for our property on Zoopla." },
    { name: 'Property feed delay',    msg: "Our property updates aren't syncing to portals." },
  ];

  const forbiddenTerms = [
    'property_missing_listing', 'property_incorrect_details', 'property_media',
    'property_feed_sync', 'property_status', 'property_visibility',
    'feeds_property', 'feeds_integration', 'listings_tours', 'listings_media',
    'subcategory', 'category_picker',
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      const reply = await sendMessage(session.id, c.msg);
      const text = reply.content.toLowerCase();

      const leaked = forbiddenTerms.filter(t => text.includes(t));
      record('Taxonomy', c.name, leaked.length === 0, leaked.length > 0 ? `LEAKED: ${leaked.join(', ')}` : '');
    } catch (err) {
      record('Taxonomy', c.name, false, err.message);
    }
  }
}

// ── Section 5: No Category Picker on Property Paths ──

async function testNoCategoryPickerOnProperty() {
  console.log('\n=== SECTION 5: No Category Picker on Property Paths ===');

  const cases = [
    { name: 'Direct property issue',       msg: "Our property isn't showing on Rightmove." },
    { name: 'Property with frustration',    msg: "This is ridiculous, the listing is still wrong on Zoopla." },
    { name: 'Vague property mention',       msg: "There's an issue with our property listing." },
    { name: 'Property photos',              msg: "The property photos aren't appearing." },
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      const reply = await sendMessage(session.id, c.msg);
      const text = reply.content.toLowerCase();

      const hasPicker = text.includes('which area') || text.includes('best describes') || text.includes('select a category');
      record('NoPicker', c.name, !hasPicker, hasPicker ? 'CATEGORY PICKER appeared' : '');
    } catch (err) {
      record('NoPicker', c.name, false, err.message);
    }
  }
}

// ── Section 6: No Conversational Resets ──

async function testNoConversationalResets() {
  console.log('\n=== SECTION 6: No Conversational Resets ===');

  // Multi-turn: start with property issue, add more detail, verify no reset
  try {
    const session = await createSession();
    const reply1 = await sendMessage(session.id, "My property isn't showing on Rightmove.");
    const meta1 = await getSessionMeta(session.id);
    record('NoReset', 'Turn 1: category set to property', meta1.category === 'property', `category=${meta1.category}`);

    const reply2 = await sendMessage(session.id, "It's 25 Park Road, been missing for 2 days.");
    const meta2 = await getSessionMeta(session.id);
    record('NoReset', 'Turn 2: category still property', meta2.category === 'property', `category=${meta2.category}`);
    record('NoReset', 'Turn 2: address captured', !!(meta2.collectedFields?.propertyAddress), meta2.collectedFields?.propertyAddress || 'empty');

    const text2 = reply2.content.toLowerCase();
    const hasPickerT2 = text2.includes('which area') || text2.includes('best describes');
    record('NoReset', 'Turn 2: no category picker', !hasPickerT2, hasPickerT2 ? 'PICKER appeared on follow-up' : '');
  } catch (err) {
    record('NoReset', 'Multi-turn property flow', false, err.message);
  }
}

// ── Section 7: Website Design / Content Regression ──

async function testWebsiteRegression() {
  console.log('\n=== SECTION 7: Website Design / Content Regression ===');

  const cases = [
    {
      name: 'Content update routes to website',
      msg: 'Our homepage phone number needs updating to 01onal 567890.',
      expected: 'website',
    },
    {
      name: 'Design change routes to website',
      msg: 'We want the header redesigned, the logo is too small.',
      expected: 'website',
    },
    {
      name: 'Broken page routes to website',
      msg: 'Our property search page is showing an error.',
      expected: 'website',
    },
    {
      name: 'New page request routes to website',
      msg: 'We need a new team page added to our website.',
      expected: 'website',
    },
  ];

  for (const c of cases) {
    try {
      const session = await createSession();
      await sendMessage(session.id, c.msg);
      const meta = await getSessionMeta(session.id);
      record('WebRegression', c.name, meta.category === c.expected, `got=${meta.category}`);
    } catch (err) {
      record('WebRegression', c.name, false, err.message);
    }
  }
}

// ── Section 8: Edge Cases ──

async function testEdgeCases() {
  console.log('\n=== SECTION 8: Edge Cases & Adversarial ===');

  // Ambiguous: "property page on website" — could be website or property
  // Since it mentions "website" and "page" without portal names, website is acceptable
  try {
    const session = await createSession();
    await sendMessage(session.id, "The property page on our website needs updating.");
    const meta = await getSessionMeta(session.id);
    const isAcceptable = meta.category === 'website' || meta.category === 'property';
    record('Edge', 'Ambiguous property page on website', isAcceptable, `got=${meta.category}`);
  } catch (err) {
    record('Edge', 'Ambiguous property page on website', false, err.message);
  }

  // Frustration with attachment mention
  try {
    const session = await createSession();
    await sendMessage(session.id, "This is ridiculous, I've attached a screenshot showing the listing is wrong.");
    const meta = await getSessionMeta(session.id);
    record('Edge', 'Frustration + attachment flag', !!meta.attachmentMentioned, `attachmentMentioned=${meta.attachmentMentioned}`);
  } catch (err) {
    record('Edge', 'Frustration + attachment', false, err.message);
  }

  // Multiple exclamation/question marks (frustration via punctuation)
  try {
    const session = await createSession();
    const reply = await sendMessage(session.id, "Why is this STILL broken????? Fix it!!!!");
    const text = reply.content.toLowerCase();
    const hasEmpathy = /\b(frustrat|sorry|hear you|understand)\b/.test(text);
    record('Edge', 'Punctuation-only frustration', hasEmpathy, '');
  } catch (err) {
    record('Edge', 'Punctuation frustration', false, err.message);
  }
}

// ── Run All ──

async function main() {
  console.log('=================================================================');
  console.log('Property / Listing Issues — Iteration 3 INDEPENDENT EVALUATION');
  console.log('Eval Agent — Workstream 1');
  console.log('=================================================================');

  await authenticate();

  await testFrustrationDetection();
  await testDetailPreservation();
  await testPropertyWebsiteRouting();
  await testHiddenTaxonomy();
  await testNoCategoryPickerOnProperty();
  await testNoConversationalResets();
  await testWebsiteRegression();
  await testEdgeCases();

  console.log('\n=================================================================');
  console.log(`TOTAL: ${results.pass} pass, ${results.fail} fail out of ${results.pass + results.fail}`);
  console.log(`PASS RATE: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`);

  const failures = results.details.filter(d => !d.passed);
  if (failures.length > 0) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(`  - [${f.section}] ${f.name}: ${f.reason}`));
  }

  // Section summary
  const sections = {};
  results.details.forEach(d => {
    if (!sections[d.section]) sections[d.section] = { pass: 0, fail: 0 };
    if (d.passed) sections[d.section].pass++; else sections[d.section].fail++;
  });
  console.log('\nSECTION SUMMARY:');
  for (const [section, counts] of Object.entries(sections)) {
    console.log(`  ${section}: ${counts.pass}/${counts.pass + counts.fail}`);
  }

  // Write results
  const fs = await import('fs');
  fs.writeFileSync(
    'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output/property_iter3_independent_results.json',
    JSON.stringify({ ...results, sections, timestamp: new Date().toISOString() }, null, 2),
  );
  console.log('\nResults written to agent_work/eval_output/property_iter3_independent_results.json');
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
