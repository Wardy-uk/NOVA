const fs = require('fs');
const https = require('https');

// Load key from settings.json
const settings = JSON.parse(fs.readFileSync('C:\\ProgramData\\NOVA\\settings.json', 'utf8'));
const key = settings.settings.anthropic_api_key;
console.log(`API key: ${key.slice(0, 12)}...`);

function testModel(modelId, bodyOverride) {
  return new Promise((resolve) => {
    const body = JSON.stringify(bodyOverride || {
      model: modelId,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Say hello in one word.' }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`\n=== ${modelId} → HTTP ${res.statusCode} ===`);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.log(`ERROR: ${parsed.error.type}: ${parsed.error.message}`);
          } else {
            console.log(`OK: "${parsed.content?.[0]?.text}"`);
            console.log(`Model: ${parsed.model}`);
            console.log(`Tokens: ${parsed.usage?.input_tokens}in / ${parsed.usage?.output_tokens}out`);
          }
        } catch {
          console.log(`Raw: ${data.slice(0, 300)}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`\n=== ${modelId} → ERROR: ${e.message} ===`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

async function run() {
  // Test 1: The BROKEN model ID (currently deployed)
  console.log('--- Test 1: BROKEN model ID ---');
  await testModel('claude-sonnet-4-6-20250514');

  // Test 2: Model ID without date suffix
  console.log('--- Test 2: claude-sonnet-4-6 (no date) ---');
  await testModel('claude-sonnet-4-6');

  // Test 3: Haiku
  console.log('--- Test 3: claude-haiku-4-5-20251001 ---');
  await testModel('claude-haiku-4-5-20251001');

  // Test 4: Structured output (triage-like) with working model
  console.log('--- Test 4: Structured JSON output (triage-like) ---');
  await testModel('claude-sonnet-4-6', {
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: 'You are a ticket triage system. Respond with valid JSON only. No markdown fencing, no commentary.',
    messages: [{
      role: 'user',
      content: `Triage this ticket:
Subject: "Can't log in"
Description: "I keep getting an error when trying to log in since yesterday"

Respond with JSON:
{
  "classification": { "ticket_type": "incident", "category": "access", "sub_category": "login", "impact": "medium", "urgency": "high", "priority_matrix": "P2", "confidence": 0.85 },
  "priority_assessment": { "suggested_priority": 2, "reasoning": "..." },
  "sentiment": "frustrated",
  "sla_risk": "Medium - login issues affect user productivity",
  "recommended_action": "respond",
  "draft_response": "...",
  "internal_note": "...",
  "reasoning_trace": "...",
  "kb_gap": { "should_have_article": true, "reason": "...", "suggested_title": "..." }
}`
    }]
  });
}

run().then(() => process.exit(0));
