// P4-WP1 endpoint discovery — reliable Node fetch (bypasses HTTP proxy)
const BASE = 'http://127.0.0.1:3099';

async function j(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res, text;
  try {
    res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    text = await res.text();
  } catch (e) {
    return { status: 'ERR', body: String(e) };
  }
  return { status: res.status, body: text };
}

async function login() {
  // try login, else register
  let r = await j('POST', '/api/auth/login', { body: { username: 'p4eval', password: 'P4eval!2345' } });
  if (r.status === 200) return JSON.parse(r.body).token;
  r = await j('POST', '/api/auth/register', { body: { username: 'p4eval', password: 'P4eval!2345', email: 'p4eval@test.local', name: 'P4 Eval' } });
  if (r.status === 200 || r.status === 201) return JSON.parse(r.body).token;
  // register may say exists -> login again
  r = await j('POST', '/api/auth/login', { body: { username: 'p4eval', password: 'P4eval!2345' } });
  if (r.status === 200) return JSON.parse(r.body).token;
  throw new Error('cannot auth: ' + JSON.stringify(r));
}

const CANDS = [
  ['GET', '/api/kpi-engine/spaces'],
  ['GET', '/api/kpi-engine/manual/CS/2026-05-29'],
  ['GET', '/api/kpi-engine/manual/cs/2026-05-29'],
  ['GET', '/api/kpi-engine/space/CS/manual/2026-05-29'],
  ['GET', '/api/kpi-engine/manual-entries/CS/2026-05-29'],
  ['POST', '/api/kpi-engine/manual/CS/2026-05-29', { values: {} }],
  ['PUT', '/api/kpi-engine/manual/CS/2026-05-29', { values: {} }],
  ['POST', '/api/kpi-engine/manual', { space_key: 'CS', metric_key: 'cs_open_tickets', report_date: '2026-05-29', value: 10 }],
  ['POST', '/api/kpi-engine/manual-entry', { space_key: 'CS', metric_key: 'cs_open_tickets', report_date: '2026-05-29', value: 10 }],
  ['POST', '/api/kpi-engine/manual/save', { space_key: 'CS', report_date: '2026-05-29', values: {} }],
  ['POST', '/api/kpi-engine/import', {}],
  ['POST', '/api/kpi-engine/import/preview', {}],
  ['POST', '/api/kpi-engine/manual/import', {}],
  ['POST', '/api/kpi-engine/tracker/import', {}],
  ['POST', '/api/kpi-engine/import/tracker', {}],
  ['GET', '/api/kpi-engine/manual/spaces'],
  ['GET', '/api/kpi-engine/manual-teams'],
  ['GET', '/api/kpi-engine/space/CS/metrics'],
  ['GET', '/api/kpi-engine/metrics?space=CS'],
];

const token = await login();
console.log('TOKEN_OK len=' + token.length);
for (const [m, p, b] of CANDS) {
  const r = await j(m, p, { token, body: b });
  let body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  if (body.length > 180) body = body.slice(0, 180);
  console.log(`[${r.status}] ${m} ${p} :: ${body}`);
}
