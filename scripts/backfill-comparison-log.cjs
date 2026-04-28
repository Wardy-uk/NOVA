/**
 * Backfill ai_comparison_log with v2 parser (multi-signal ground truth).
 *
 * Calls POST /api/ai-improvement/backfill on the prod NOVA server.
 * The server-side method:
 *   1. Deletes all parser_version < 2 rows
 *   2. For each agent_decision since go-live, fetches Jira comments,
 *      builds the n8n ground truth tuple, and runs compareActions()
 *   3. Inserts v2 rows into ai_comparison_log
 *
 * Usage: node scripts/backfill-comparison-log.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const NOVA_BASE = 'http://100.118.199.1:3069';

const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
const settings = raw.settings || raw;
const JWT_SECRET = settings.jwt_secret;

if (!JWT_SECRET) { console.error('Missing jwt_secret in settings.json'); process.exit(1); }

function makeJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + 7200 };
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${b64(header)}.${b64(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${sig}`;
}

async function main() {
  const token = makeJwt({ id: 1, username: 'nickw', role: 'admin' }, JWT_SECRET);

  console.log('=== Backfill ai_comparison_log (v2 parser) ===');
  console.log(`Target: ${NOVA_BASE}`);
  console.log('Calling POST /api/ai-improvement/backfill — this may take several minutes...\n');

  const res = await fetch(`${NOVA_BASE}/api/ai-improvement/backfill`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Failed: HTTP ${res.status}\n${text}`);
    process.exit(1);
  }

  const data = await res.json();
  if (!data.ok) {
    console.error('Backfill returned error:', data.error);
    process.exit(1);
  }

  console.log('── Results ──');
  console.log(`Compared: ${data.data.compared}`);
  console.log(`Agreed:   ${data.data.agreed}`);
  console.log(`Skipped:  ${data.data.skipped}`);
  console.log(`\nAgreement rate: ${data.data.agreementRate}% (was 43.5% with old parser)`);

  const rate = parseFloat(data.data.agreementRate);
  if (rate < 55 || rate > 85) {
    console.warn(`\n⚠ Agreement rate ${rate}% is outside expected 60-75% range — review the comparison mapping.`);
  } else {
    console.log('\n✓ Agreement rate is within expected range.');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
