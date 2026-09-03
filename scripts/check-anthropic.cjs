const fs = require('fs');
const path = require('path');

// 1. Check .env for API keys
const envPath = path.join(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n').filter(l => /KEY|ANTHRO|OPENAI|OPENROUTER/i.test(l));
console.log('=== .env API KEY entries (masked) ===');
for (const line of lines) {
  const [key, ...valParts] = line.split('=');
  const val = valParts.join('=').trim();
  console.log(`${key.trim()} = ${val ? val.slice(0, 10) + '...' : '(empty)'}`);
}

// 2. Check settings.json
const settingsPath = path.join(process.cwd(), 'settings.json');
if (fs.existsSync(settingsPath)) {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  console.log('\n=== settings.json API keys (masked) ===');
  const s = settings.settings || settings;
  for (const [k, v] of Object.entries(s)) {
    if (/key|model|routing|anthropic|openai|openrouter/i.test(k)) {
      const val = String(v);
      console.log(`${k} = ${val.length > 20 ? val.slice(0, 10) + '...' : val}`);
    }
  }
} else {
  console.log('\n=== settings.json: NOT FOUND ===');
}

// 3. Make a raw Anthropic API test call
const apiKey = envContent.split('\n')
  .find(l => l.startsWith('ANTHROPIC_API_KEY='))
  ?.split('=').slice(1).join('=').trim();

// Also check settings.json for the key
let settingsKey = null;
if (fs.existsSync(settingsPath)) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settingsKey = (s.settings || s).anthropic_api_key;
  } catch {}
}

const key = apiKey || settingsKey;
if (!key) {
  console.log('\n=== NO ANTHROPIC API KEY FOUND ===');
  console.log('Neither .env ANTHROPIC_API_KEY nor settings.json anthropic_api_key is set.');
  process.exit(0);
}

console.log(`\nUsing key: ${key.slice(0, 10)}...`);

// Test with correct model ID
const https = require('https');

function testModel(modelId) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: modelId,
      max_tokens: 50,
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
        console.log(`\n=== Test: ${modelId} → HTTP ${res.statusCode} ===`);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.log(`ERROR: ${parsed.error.type}: ${parsed.error.message}`);
          } else {
            console.log(`OK: ${parsed.content?.[0]?.text || '(no text)'}`);
            console.log(`Tokens: ${parsed.usage?.input_tokens}in / ${parsed.usage?.output_tokens}out`);
          }
        } catch {
          console.log(`Raw: ${data.slice(0, 200)}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`\n=== Test: ${modelId} → NETWORK ERROR: ${e.message} ===`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

async function run() {
  // Test the broken model ID
  await testModel('claude-sonnet-4-6-20250514');
  // Test the correct model ID
  await testModel('claude-sonnet-4-6');
  // Test haiku
  await testModel('claude-haiku-4-5-20251001');
}

run().then(() => process.exit(0));
