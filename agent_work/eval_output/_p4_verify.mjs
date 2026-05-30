// P4-WP1 authoritative verification — single process, reliable auth, Node fetch (bypasses proxy)
const BASE = 'http://127.0.0.1:3099';
const log = [];
function out(s){ log.push(s); }

async function call(method, path, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let text = await res.text();
  return { status: res.status, body: text };
}

// 1. Authenticate: register a unique user this run, use the returned token immediately.
const uname = 'p4v_' + Date.now().toString(36);
let token = null, authNote = '';
let reg = await call('POST', '/api/auth/register', null, { username: uname, password: 'Verify!2345', email: uname+'@test.local', name: 'P4 Verify' });
if ((reg.status === 200 || reg.status === 201)) {
  try { token = JSON.parse(reg.body).token; authNote = 'registered+token'; } catch {}
}
if (!token) {
  // fall back to login with the same creds
  const lg = await call('POST', '/api/auth/login', null, { username: uname, password: 'Verify!2345' });
  if (lg.status === 200) { try { token = JSON.parse(lg.body).token; authNote = 'login+token'; } catch {} }
  else authNote = 'register=' + reg.status + ' login=' + lg.status;
}
out('AUTH: user=' + uname + ' note=' + authNote + ' tokenLen=' + (token ? token.length : 0));

if (!token) { out('FATAL: could not obtain token — verification ABORTED, no conclusion drawn.'); console.log(log.join('\n')); process.exit(2); }

// 2. PROVE the token works on a known-good clean-sheet read endpoint.
const spaces = await call('GET', '/api/kpi-engine/spaces', token);
out('PROOF GET /api/kpi-engine/spaces -> ' + spaces.status + ' bodyLen=' + spaces.body.length);
let spaceKeys = [];
if (spaces.status === 200) {
  try { const d = JSON.parse(spaces.body).data; spaceKeys = (d||[]).map(s=>s.space_key); } catch {}
  out('  space_keys=' + spaceKeys.join(','));
}
const tokenWorks = spaces.status === 200 && spaceKeys.length > 0;
out('TOKEN_WORKS=' + tokenWorks);
if (!tokenWorks) { out('FATAL: token did not authenticate against a known read endpoint — cannot trust any 404 as route-absence. ABORTED.'); console.log(log.join('\n')); process.exit(3); }

// 3. Re-confirm known-good READ endpoints (sanity that 404s are meaningful)
const D = '2026-05-29';
const reads = [
  ['GET','/api/kpi-engine/space/CS/daily?date='+D],
  ['GET','/api/kpi-engine/space/CS'],
  ['GET','/api/kpi-engine/health'],
  ['GET','/api/kpi-engine/slt'],
  ['GET','/api/kpi-engine/zzz_definitely_not_a_route'],  // control: must be 404
];
out('\n-- READ SANITY (expect 200s, last control = 404) --');
for (const [m,p] of reads){ const r=await call(m,p,token); out('['+r.status+'] '+m+' '+p); }

// 4. Probe the Phase 4 WRITE/IMPORT surface
const ENTRY = { space_key:'CS', metric_key:'cs_open_tickets', report_date:D, date:D, value:10, values:{cs_open_tickets:10} };
const probes = [
  ['GET','/api/kpi-engine/manual/CS/'+D],
  ['POST','/api/kpi-engine/manual/CS/'+D, {values:{cs_open_tickets:10}}],
  ['PUT','/api/kpi-engine/manual/CS/'+D, {values:{cs_open_tickets:10}}],
  ['POST','/api/kpi-engine/manual', ENTRY],
  ['POST','/api/kpi-engine/manual-entry', ENTRY],
  ['POST','/api/kpi-engine/entries', ENTRY],
  ['POST','/api/kpi-engine/space/CS/manual', {date:D, values:{cs_open_tickets:10}}],
  ['POST','/api/kpi-engine/space/CS/entry', {date:D, values:{cs_open_tickets:10}}],
  ['POST','/api/kpi-engine/import', {}],
  ['POST','/api/kpi-engine/import/preview', {}],
  ['POST','/api/kpi-engine/import?dryRun=true', {}],
  ['POST','/api/kpi-engine/manual/import', {}],
  ['POST','/api/kpi-engine/import-xlsx', {}],
  ['POST','/api/kpi-engine/upload', {}],
  ['POST','/api/kpi/manual-entry', ENTRY],
  ['POST','/api/kpi/import', {}],
];
out('\n-- WRITE/IMPORT PROBES --');
let nonAbsent = 0;
for (const [m,p,b] of probes){
  const r = await call(m,p,token,b);
  const tag = (r.status===404) ? '404(absent)' : r.status + '(PRESENT)';
  if (r.status!==404) nonAbsent++;
  let bd=(r.body||'').replace(/\s+/g,' ').slice(0,90);
  out('['+tag+'] '+m+' '+p+' :: '+bd);
}
out('\nVERDICT_INPUT: write/import endpoints PRESENT (non-404) = ' + nonAbsent + ' / ' + probes.length);
console.log(log.join('\n'));
