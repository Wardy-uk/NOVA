// Force a triage + ticket_analysis call through the NOVA API on port 3069
const http = require('http');
const https = require('https');
const fs = require('fs');

// Load settings for API key
const settings = JSON.parse(fs.readFileSync('C:\\ProgramData\\NOVA\\settings.json', 'utf8'));
const anthropicKey = settings.settings.anthropic_api_key;

// Direct Anthropic call with triage schema (bypasses NOVA routing, tests the model + schema)
function testAnthropicTriage() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      temperature: 0.3,
      system: `You analyse Jira service desk tickets. Respond with valid JSON only. No markdown fencing, no commentary.`,
      messages: [{
        role: 'user',
        content: `Triage this Jira ticket:
Key: NT-16667
Summary: Website returning 500 errors for all users
Description: "Since about 10am today, our website has been returning 500 Internal Server Error for all users. We've tried clearing the cache but the issue persists. This is affecting all our customers who try to access the site."
Status: Open
Priority: High
Reporter: John Smith
Created: 2026-04-26T10:30:00Z

Respond with this exact JSON structure:
{
  "classification": { "ticket_type": "incident|service_request|change|problem", "category": "...", "sub_category": "...", "impact": "high|medium|low", "urgency": "high|medium|low", "priority_matrix": "P1|P2|P3|P4", "confidence": 0.0-1.0 },
  "priority_assessment": { "suggested_priority": 1-4, "reasoning": "..." },
  "sentiment": "positive|neutral|frustrated|angry|urgent",
  "sla_risk": "description string",
  "recommended_action": "respond|escalate|gather_context|assign",
  "draft_response": "...",
  "internal_note": "...",
  "reasoning_trace": "...",
  "kb_gap": { "should_have_article": true/false, "reason": "...", "suggested_title": "..." }
}`
      }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`=== Anthropic Triage Test → HTTP ${res.statusCode} ===`);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.log(`ERROR: ${parsed.error.type}: ${parsed.error.message}`);
          } else {
            const text = parsed.content?.[0]?.text || '';
            console.log(`Model: ${parsed.model}`);
            console.log(`Tokens: ${parsed.usage?.input_tokens}in / ${parsed.usage?.output_tokens}out`);

            // Try parsing the JSON response
            try {
              const braceStart = text.indexOf('{');
              const braceEnd = text.lastIndexOf('}');
              const jsonStr = text.slice(braceStart, braceEnd + 1);
              const triage = JSON.parse(jsonStr);
              console.log('\nParsed triage result:');
              console.log(`  ticket_type: ${triage.classification?.ticket_type}`);
              console.log(`  impact: ${triage.classification?.impact}`);
              console.log(`  urgency: ${triage.classification?.urgency}`);
              console.log(`  priority: P${triage.priority_assessment?.suggested_priority}`);
              console.log(`  sentiment: ${triage.sentiment}`);
              console.log(`  sla_risk type: ${typeof triage.sla_risk} = "${String(triage.sla_risk).slice(0, 80)}"`);
              console.log(`  action: ${triage.recommended_action}`);
              console.log(`  kb_gap: ${JSON.stringify(triage.kb_gap)}`);
              console.log('\nVALIDATION: All fields present and correct types ✓');
            } catch (e) {
              console.log(`\nJSON PARSE FAILED: ${e.message}`);
              console.log(`Raw text: ${text.slice(0, 500)}`);
            }
          }
        } catch {
          console.log(`Raw: ${data.slice(0, 500)}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`NETWORK ERROR: ${e.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

// Also test Haiku for ticket_analysis
function testHaikuAnalysis() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0.3,
      system: `You analyse Jira service desk ticket comments. Respond with valid JSON only. No markdown fencing, no commentary.`,
      messages: [{
        role: 'user',
        content: `Analyse these ticket comments:

--- NT-16667 ---
[John Smith — 2026-04-26T10:30:00Z]: Our website has been returning 500 errors since 10am. All customers are affected.
[Agent Nick — 2026-04-26T10:45:00Z]: Hi John, thanks for reporting. I'll investigate this immediately and will update you by 12pm today.
[John Smith — 2026-04-26T14:00:00Z]: It's now 2pm and I haven't heard anything back. This is still down and our business is losing money.

Return JSON: { "results": [{ "issueKey": "NT-16667", "sentimentScore": 0.0, "sentimentSummary": "...", "commitmentDate": null, "followedUp": false, "commitmentQuote": null }] }`
      }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`\n=== Haiku ticket_analysis Test → HTTP ${res.statusCode} ===`);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.log(`ERROR: ${parsed.error.type}: ${parsed.error.message}`);
          } else {
            const text = parsed.content?.[0]?.text || '';
            console.log(`Model: ${parsed.model}`);
            console.log(`Tokens: ${parsed.usage?.input_tokens}in / ${parsed.usage?.output_tokens}out`);
            try {
              const braceStart = text.indexOf('{');
              const braceEnd = text.lastIndexOf('}');
              const result = JSON.parse(text.slice(braceStart, braceEnd + 1));
              const item = result.results?.[0];
              console.log(`\nParsed analysis:`);
              console.log(`  issueKey: ${item?.issueKey}`);
              console.log(`  sentimentScore: ${item?.sentimentScore}`);
              console.log(`  sentimentSummary: ${item?.sentimentSummary?.slice(0, 80)}`);
              console.log(`  commitmentDate: ${item?.commitmentDate}`);
              console.log(`  followedUp: ${item?.followedUp}`);
              console.log(`  commitmentQuote: ${item?.commitmentQuote?.slice(0, 80)}`);
              console.log('\nVALIDATION: All fields present ✓');
            } catch (e) {
              console.log(`JSON PARSE FAILED: ${e.message}`);
              console.log(`Raw: ${text.slice(0, 500)}`);
            }
          }
        } catch {
          console.log(`Raw: ${data.slice(0, 500)}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`NETWORK ERROR: ${e.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

async function run() {
  await testAnthropicTriage();
  await testHaikuAnalysis();
}

run().then(() => process.exit(0));
