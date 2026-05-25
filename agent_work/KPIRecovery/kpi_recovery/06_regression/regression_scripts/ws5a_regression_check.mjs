// WS5-A Regression Check — RC-007 through RC-009
// Queries breach board endpoint directly (same evidence path as evaluation)
// Baselines: BF-006 (Development visibility), BF-007 (OldestTicketKey), BF-008 (WORST OLDEST)

const PROD_BASE = process.env.NOVA_PROD_URL || 'http://100.118.199.1:3069';
const BREACHED_URL = `${PROD_BASE}/api/public/wallboard/breached`;

const results = [];
const now = new Date();
const today = now.toISOString().slice(0, 10);
const timestamp = now.toISOString();

console.log(`\nWS5-A REGRESSION CHECK — ${today}`);
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

// ── RC-007: Development agent visibility (BF-006) ──
// At least 1 agent must have OpenTickets_Total > 20
// Pre-fix maximum was 18; post-fix multiple agents exceed 24
const agentsAbove20 = breachedData.filter(a =>
  (a.OpenTickets_Total || a.openTickets_Total || a.opentickets_total || 0) > 20
);
const maxOpenTickets = Math.max(...breachedData.map(a =>
  a.OpenTickets_Total || a.openTickets_Total || a.opentickets_total || 0
));
const rc007Pass = agentsAbove20.length >= 1;

console.log(`RC-007: Development visibility ......... ${rc007Pass ? 'PASS' : 'FAIL'}`);
console.log(`  Agents with OpenTickets_Total > 20: ${agentsAbove20.length}`);
console.log(`  Max OpenTickets_Total: ${maxOpenTickets}`);
if (agentsAbove20.length > 0) {
  for (const a of agentsAbove20.slice(0, 5)) {
    const name = a.AgentName || a.agentName || a.agent_name || 'unknown';
    const count = a.OpenTickets_Total || a.openTickets_Total || a.opentickets_total || 0;
    console.log(`    ${name}: ${count}`);
  }
}
console.log();
results.push({ id: 'RC-007', name: 'Development agent visibility', pass: rc007Pass });

// ── RC-008: OldestTicketKey population (BF-007) ──
// For agents with open tickets: OldestTicketKey must be non-null and match NT-\d+
// For agents with zero tickets: OldestTicketKey must be null
const ntPattern = /^NT-\d+$/;
const rc008Failures = [];
let activeAgentsPopulated = 0;
let activeAgentsTotal = 0;
let zeroAgentsCorrectlyNull = 0;
let zeroAgentsTotal = 0;

for (const a of breachedData) {
  const name = a.AgentName || a.agentName || a.agent_name || 'unknown';
  const openTotal = a.OpenTickets_Total || a.openTickets_Total || a.opentickets_total || 0;
  const oldestKey = a.OldestTicketKey || a.oldestTicketKey || a.oldest_ticket_key || null;

  if (openTotal > 0) {
    activeAgentsTotal++;
    if (oldestKey && ntPattern.test(oldestKey)) {
      activeAgentsPopulated++;
    } else {
      rc008Failures.push(`${name}: OpenTickets=${openTotal} but OldestTicketKey=${oldestKey}`);
    }
  } else {
    zeroAgentsTotal++;
    if (!oldestKey) {
      zeroAgentsCorrectlyNull++;
    } else {
      rc008Failures.push(`${name}: OpenTickets=0 but OldestTicketKey=${oldestKey} (should be null)`);
    }
  }
}

const rc008Pass = rc008Failures.length === 0;
console.log(`RC-008: OldestTicketKey population ...... ${rc008Pass ? 'PASS' : 'FAIL'}`);
console.log(`  Active agents with key populated: ${activeAgentsPopulated}/${activeAgentsTotal}`);
console.log(`  Zero-ticket agents with null key: ${zeroAgentsCorrectlyNull}/${zeroAgentsTotal}`);
if (rc008Failures.length > 0) {
  console.log(`  Failures:`);
  for (const f of rc008Failures) console.log(`    ✗ ${f}`);
}
console.log();
results.push({ id: 'RC-008', name: 'OldestTicketKey population', pass: rc008Pass });

// ── RC-009: WORST OLDEST convergence (BF-008) ──
// Maximum OldestTicketDays across all agents must be >= 150
// Baseline: 198 days. Pre-fix: 76 days. Floor: 150 days.
const worstOldest = Math.max(...breachedData.map(a =>
  a.OldestTicketDays || a.oldestTicketDays || a.oldest_ticket_days || 0
));
const worstAgent = breachedData.find(a =>
  (a.OldestTicketDays || a.oldestTicketDays || a.oldest_ticket_days || 0) === worstOldest
);
const worstAgentName = worstAgent
  ? (worstAgent.AgentName || worstAgent.agentName || worstAgent.agent_name || 'unknown')
  : 'unknown';
const worstAgentKey = worstAgent
  ? (worstAgent.OldestTicketKey || worstAgent.oldestTicketKey || worstAgent.oldest_ticket_key || 'N/A')
  : 'N/A';

const rc009Pass = worstOldest >= 150;
console.log(`RC-009: WORST OLDEST convergence ....... ${rc009Pass ? 'PASS' : 'FAIL'}`);
console.log(`  WORST OLDEST: ${worstOldest} days (floor: >= 150)`);
console.log(`  Agent: ${worstAgentName} (${worstAgentKey})`);
console.log(`  Baseline at freeze: 198 days (Sebastian Broome, NT-355)`);
console.log(`  Pre-fix value: 76 days`);
console.log();
results.push({ id: 'RC-009', name: 'WORST OLDEST convergence', pass: rc009Pass });

// ── SUMMARY ──
const allPass = results.every(r => r.pass);
console.log('='.repeat(60));
console.log(`OVERALL: ${allPass ? 'PASS' : 'FAIL'} (${results.filter(r => r.pass).length}/${results.length} checks passed)`);
console.log('='.repeat(60));
console.log(`\nFull agent snapshot:`);
for (const a of breachedData) {
  const name = (a.AgentName || a.agentName || a.agent_name || 'unknown').padEnd(22);
  const open = String(a.OpenTickets_Total || a.openTickets_Total || a.opentickets_total || 0).padStart(3);
  const days = String(a.OldestTicketDays || a.oldestTicketDays || a.oldest_ticket_days || 0).padStart(4);
  const key = a.OldestTicketKey || a.oldestTicketKey || a.oldest_ticket_key || 'null';
  console.log(`  ${name} Open=${open}  OldestDays=${days}  Key=${key}`);
}

process.exit(allPass ? 0 : 1);
