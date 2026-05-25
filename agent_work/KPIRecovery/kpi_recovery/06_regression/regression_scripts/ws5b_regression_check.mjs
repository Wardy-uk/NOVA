// WS5-B Regression Check — RC-010 and RC-011
// RC-010: OpenTickets_Over2Hours sum > 0 (not dead-field zero)
// RC-011: WS5-A checks stable (RC-007, RC-008, RC-009 re-run)
// Baselines: BF-009 (non-zero SLA), BF-010 (filtered SLA behaviour)

const PROD_BASE = process.env.NOVA_PROD_URL || 'http://100.118.199.1:3069';
const BREACHED_URL = `${PROD_BASE}/api/public/wallboard/breached`;

const results = [];
const now = new Date();
const today = now.toISOString().slice(0, 10);
const timestamp = now.toISOString();

console.log(`\nWS5-B REGRESSION CHECK — ${today}`);
console.log(`Timestamp: ${timestamp}`);
console.log(`Evidence path: ${BREACHED_URL}`);
console.log('='.repeat(60) + '\n');

let breachedData;
try {
  const resp = await fetch(BREACHED_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const json = await resp.json();
  breachedData = json.data || json;
} catch (err) {
  console.error(`FATAL: Cannot reach breach board endpoint: ${err.message}`);
  console.error('All checks BLOCKED — endpoint unreachable.');
  process.exit(2);
}

if (!Array.isArray(breachedData) || breachedData.length === 0) {
  console.error('FATAL: Breach board returned empty or non-array data.');
  process.exit(2);
}

console.log(`Agents on breach board: ${breachedData.length}\n`);

// ── RC-010: OpenTickets_Over2Hours non-zero (BF-009) ──
// Sum across all agents must be > 0
// Pre-fix: structurally 0 (dead field). Post-fix baseline: 17 → 23.
const over2hValues = breachedData.map(a => a.OpenTickets_Over2Hours || 0);
const sumOver2H = over2hValues.reduce((s, v) => s + v, 0);
const agentsNonZero = over2hValues.filter(v => v > 0).length;
const rc010Pass = sumOver2H > 0;

console.log(`RC-010: OpenTickets_Over2Hours non-zero .. ${rc010Pass ? 'PASS' : 'FAIL'}`);
console.log(`  Sum: ${sumOver2H} (baseline at freeze: 23, pre-fix: 0)`);
console.log(`  Agents with non-zero: ${agentsNonZero}`);
if (agentsNonZero > 0) {
  for (const a of breachedData.filter(a => (a.OpenTickets_Over2Hours || 0) > 0)) {
    console.log(`    ${a.AgentName}: ${a.OpenTickets_Over2Hours}`);
  }
}
console.log();
results.push({ id: 'RC-010', name: 'OpenTickets_Over2Hours non-zero', pass: rc010Pass });

// ── RC-011: WS5-A stability under WS5-B (BF-010) ──
// Re-runs RC-007, RC-008, RC-009 to confirm no regression from SLA-definition change

// RC-007: Development visibility — ≥1 agent with OpenTickets_Total > 20
const agentsAbove20 = breachedData.filter(a => (a.OpenTickets_Total || 0) > 20);
const maxOpenTickets = Math.max(...breachedData.map(a => a.OpenTickets_Total || 0));
const rc007Pass = agentsAbove20.length >= 1;

console.log(`RC-011a (RC-007): Development visibility . ${rc007Pass ? 'PASS' : 'FAIL'}`);
console.log(`  Agents with OpenTickets_Total > 20: ${agentsAbove20.length}`);
console.log(`  Max OpenTickets_Total: ${maxOpenTickets}`);
console.log();

// RC-008: OldestTicketKey population
const ntPattern = /^NT-\d+$/;
const rc008Failures = [];
let activePopulated = 0;
let activeTotal = 0;
let zeroCorrectNull = 0;
let zeroTotal = 0;

for (const a of breachedData) {
  const openTotal = a.OpenTickets_Total || 0;
  const oldestKey = a.OldestTicketKey || null;

  if (openTotal > 0) {
    activeTotal++;
    if (oldestKey && ntPattern.test(oldestKey)) {
      activePopulated++;
    } else {
      rc008Failures.push(`${a.AgentName}: Open=${openTotal} Key=${oldestKey}`);
    }
  } else {
    zeroTotal++;
    if (!oldestKey) {
      zeroCorrectNull++;
    } else {
      rc008Failures.push(`${a.AgentName}: Open=0 Key=${oldestKey} (should be null)`);
    }
  }
}

const rc008Pass = rc008Failures.length === 0;
console.log(`RC-011b (RC-008): OldestTicketKey pop. ... ${rc008Pass ? 'PASS' : 'FAIL'}`);
console.log(`  Active agents with key: ${activePopulated}/${activeTotal}`);
console.log(`  Zero-ticket agents null: ${zeroCorrectNull}/${zeroTotal}`);
if (rc008Failures.length > 0) {
  for (const f of rc008Failures) console.log(`    ✗ ${f}`);
}
console.log();

// RC-009: WORST OLDEST convergence — max OldestTicketDays >= 150
const worstOldest = Math.max(...breachedData.map(a => a.OldestTicketDays || 0));
const worstAgent = breachedData.find(a => (a.OldestTicketDays || 0) === worstOldest);
const worstName = worstAgent ? worstAgent.AgentName : 'unknown';
const worstKey = worstAgent ? (worstAgent.OldestTicketKey || 'N/A') : 'N/A';
const rc009Pass = worstOldest >= 150;

console.log(`RC-011c (RC-009): WORST OLDEST .......... ${rc009Pass ? 'PASS' : 'FAIL'}`);
console.log(`  WORST OLDEST: ${worstOldest} days (floor: >= 150)`);
console.log(`  Agent: ${worstName} (${worstKey})`);
console.log(`  Baseline: 198 days (Sebastian, NT-355)`);
console.log();

const rc011Pass = rc007Pass && rc008Pass && rc009Pass;
console.log(`RC-011: WS5-A stability composite ....... ${rc011Pass ? 'PASS' : 'FAIL'}`);
console.log(`  RC-007: ${rc007Pass ? 'PASS' : 'FAIL'}  RC-008: ${rc008Pass ? 'PASS' : 'FAIL'}  RC-009: ${rc009Pass ? 'PASS' : 'FAIL'}`);
console.log();
results.push({ id: 'RC-011', name: 'WS5-A stability under WS5-B', pass: rc011Pass });

// ── SUMMARY ──
const allPass = results.every(r => r.pass);
console.log('='.repeat(60));
console.log(`OVERALL: ${allPass ? 'PASS' : 'FAIL'} (${results.filter(r => r.pass).length}/${results.length} checks passed)`);
console.log('='.repeat(60));
console.log(`\nFull agent snapshot:`);
for (const a of breachedData) {
  const name = (a.AgentName || 'unknown').padEnd(22);
  const open = String(a.OpenTickets_Total || 0).padStart(3);
  const over2h = String(a.OpenTickets_Over2Hours || 0).padStart(3);
  const days = String(a.OldestTicketDays || 0).padStart(4);
  const key = a.OldestTicketKey || 'null';
  console.log(`  ${name} Open=${open}  Over2H=${over2h}  OldestDays=${days}  Key=${key}`);
}

process.exit(allPass ? 0 : 1);
