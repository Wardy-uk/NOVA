/**
 * Seed the backlog_items table with initial items from the NOVA strategic review.
 * Run ONCE after the tables are created: node scripts/seed-backlog.cjs
 * Requires NOVA server to be running (uses the API).
 */

const BASE = process.env.NOVA_URL || 'http://localhost:3001';
const TOKEN = process.env.NOVA_TOKEN; // JWT — grab from browser localStorage

if (!TOKEN) {
  console.error('Set NOVA_TOKEN env var to a valid JWT (copy from browser localStorage "token")');
  process.exit(1);
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} ${path}: ${json.error}`);
  return json.data;
}

async function getColumnId(title) {
  const cols = await api('/api/backlog/columns');
  const col = cols.find(c => c.title.toLowerCase() === title.toLowerCase());
  if (!col) throw new Error(`Column "${title}" not found`);
  return col.id;
}

const SEED = [
  // ── Done (from strategic review decisions already completed) ──
  { column: 'Done', title: 'Git template push to AzDO', wp_ref: 'WP-01', type: 'code', effort: '2-4hr' },
  { column: 'Done', title: 'Jira REST client: POST /search → /search/jql migration', wp_ref: 'WP-02', type: 'code', effort: '1hr' },
  { column: 'Done', title: 'Release notes popup (auto-show on deploy)', wp_ref: 'WP-03', type: 'code', effort: '2hr' },
  { column: 'Done', title: 'Problem ticket scanner — rule engine + LLM scoring', wp_ref: 'WP-04', type: 'code', effort: '1-2 days' },
  { column: 'Done', title: 'Security hardening — settings redaction, admin guards', wp_ref: 'WP-05', type: 'code', effort: '4hr' },
  { column: 'Done', title: 'SharePoint bi-directional sync', wp_ref: 'WP-06', type: 'code', effort: '1 day' },
  { column: 'Done', title: 'Milestone workflow engine', wp_ref: 'WP-07', type: 'code', effort: '2 days' },
  { column: 'Done', title: 'AI Agent autonomy engine + coaching loop', wp_ref: 'WP-08', type: 'code', effort: '3 days' },
  { column: 'Done', title: 'KPI pipeline + QA pipeline', wp_ref: 'WP-09', type: 'code', effort: '2 days' },
  { column: 'Done', title: 'Entra SSO (PKCE auth code flow)', wp_ref: 'WP-10', type: 'code', effort: '1 day' },
  { column: 'Done', title: 'Gamification system (achievements, streaks, leaderboard)', wp_ref: 'WP-11', type: 'code', effort: '1 day' },
  { column: 'Done', title: 'Escalation logging + SOP-002 gate', wp_ref: 'WP-12', type: 'code', effort: '1 day' },
  { column: 'Done', title: 'Replace MCP SharePoint sync with direct Graph API', wp_ref: 'WP-14', type: 'code', effort: '4hr' },
  { column: 'Done', title: 'People HR sync + rate limit throttle', wp_ref: 'WP-16', type: 'code', effort: '4hr' },

  // ── This Sprint (from review "Now — this sprint" actions) ──
  { column: 'This Sprint', title: 'Add 15-min timer to ProblemTicketScanner', wp_ref: 'WP-13', type: 'bugfix', effort: '1hr',
    description: 'Decision 13: scanner has no explicit recurring timer in index.ts — runs on-demand only. Should be a 15min interval.' },
  { column: 'This Sprint', title: 'Verify actor.ts sets assignee on autonomous resolve', wp_ref: 'WP-15', type: 'code', effort: '2hr',
    description: 'Decision 15 pre-req: verify actor.ts sets assignee = NOVA Jira service account on every autonomous resolve. Fix if not.' },
  { column: 'This Sprint', title: 'Add NOVA AI service account to dbo.Agent', wp_ref: 'WP-52', type: 'manual', effort: '30min',
    description: 'Decision 15: add NOVA AI service account as synthetic agent with own pseudo-tier ("NOVA AI") so it doesn\'t dilute team averages.' },

  // ── Backlog (from review "Next — this month" + todo items) ──
  { column: 'Backlog', title: 'Wire AI Improvement Scan hourly', wp_ref: 'WP-23i', type: 'code', effort: 'Half day',
    description: 'Decision 9: hourly schedule, feeds ai_comparison_log and coaching nudges.' },
  { column: 'Backlog', title: 'Add kb_article_drafts table + lifecycle', wp_ref: 'WP-42', type: 'code', effort: 'Half day',
    description: 'Decision 10: hybrid persistence — body stored pre-publish, nulled on publish, kept on rejection.' },
  { column: 'Backlog', title: 'Delete Plaud stubs from people.ts', wp_ref: 'WP-17', type: 'code', effort: '15min',
    description: 'Decision 4: personal tooling, will be rewritten outside NOVA.' },
  { column: 'Backlog', title: 'Remove dead chat.ts route + service', wp_ref: 'WP-18', type: 'code', effort: '15min',
    description: 'Already disabled at index.ts — remove dead code completely.' },
  { column: 'Backlog', title: 'Migrate CRM, Contracts, Adobe Sign, Sales Hotbox out', wp_ref: 'WP-19', type: 'code', effort: '2-3 days',
    description: 'Decision 1: migrate to separate tooling. ~6-8 routes, ~6-8 services, ~5 views, ~7 tables.' },
  { column: 'Backlog', title: 'Gamification BA + consolidation', wp_ref: 'WP-20', type: 'workshop', effort: '1 day',
    description: 'Decision 3: two gamification stores exist. BA required first to confirm intended vs current functionality.' },
  { column: 'Backlog', title: 'Jira OAuth login for personal Jira', wp_ref: 'WP-21', type: 'code', effort: '1 day',
    description: 'Replace manual email/API token with OAuth 2.0 3LO flow via Atlassian developer app.' },
  { column: 'Backlog', title: 'Enhanced permissions — global admin + team admin', wp_ref: 'WP-22', type: 'code', effort: '1 day' },
  { column: 'Backlog', title: 'User-configurable homepage', type: 'code', effort: '2hr',
    description: 'Allow user to set their preferred homepage to load when opening nova.nurtur.tech.' },
  { column: 'Backlog', title: 'Fix onboarding tasks showing as mine in command centre', type: 'bugfix', effort: '2hr',
    description: 'Onboarding tasks all show as mine in My Dashboard > command center, nova insights, my tasks, briefing and notifications.' },
  { column: 'Backlog', title: 'KPI targets + individual targets', type: 'code', effort: '4hr' },
  { column: 'Backlog', title: 'Capture time worked via isAvailable polling', type: 'code', effort: '4hr' },
  { column: 'Backlog', title: 'Add SLAs to daily history > agent KPIs', type: 'code', effort: '2hr' },
  { column: 'Backlog', title: 'WP-49 plugin_to_tpj detector inconsistency', wp_ref: 'WP-49', type: 'bugfix', effort: '4hr',
    description: 'Fix detector path bug (NT-17310/17312/17313 inconsistency). Singular regex coverage, "almost matched" log.' },
  { column: 'Backlog', title: 'Fix production SPA fallback route', wp_ref: 'TD3', type: 'bugfix', effort: '30min',
    description: 'Replace invalid {*path} with Express wildcard for SPA in prod.' },
  { column: 'Backlog', title: 'Jira OAuth base URL resolution', wp_ref: 'TD4', type: 'bugfix', effort: '30min' },
  { column: 'Backlog', title: 'Remove sensitive debug logging', wp_ref: 'TD5', type: 'code', effort: '30min' },
  { column: 'Backlog', title: 'Settings file-store durability (locking or DB-backed)', wp_ref: 'TD6', type: 'infrastructure', effort: '4hr' },
  { column: 'Backlog', title: 'Architecture review for 50+ users', wp_ref: 'TD7', type: 'research', effort: '1 day' },

  // ── Parked ──
  { column: 'Parked', title: 'Dynamics 365 full migrate', wp_ref: 'WP-30', type: 'code', effort: '3-5 days',
    description: 'Decision 2: deferred — Dynamics being rebuilt as new CRM. Lean toward full migrate + rebuild when ready.' },
  { column: 'Parked', title: 'Dynamic checkpoint dates in trends.ts', wp_ref: 'WP-31', type: 'code', effort: '4hr',
    description: 'Decision 11: leave hard-coded — revisit trends framework post-probation (post 31 May 2026).' },
  { column: 'Parked', title: 'KPI view pagination', wp_ref: 'WP-32', type: 'code', effort: '1 day',
    description: 'Decision 12: defer — trigger on perf regression, 12-month history, or material headcount jump.' },
  { column: 'Parked', title: 'Customer 360 timeline', type: 'code', effort: '2-3 days' },
  { column: 'Parked', title: 'Email attachments (list/get/add)', type: 'code', effort: '4hr' },
  { column: 'Parked', title: 'Multi-calendar support UI', type: 'code', effort: '4hr' },
  { column: 'Parked', title: 'Global search across all entities', type: 'code', effort: '1-2 days' },
  { column: 'Parked', title: 'CSV/PDF export for stakeholders', type: 'code', effort: '4hr' },
  { column: 'Parked', title: 'Keyboard shortcuts', type: 'code', effort: '4hr' },
];

async function main() {
  console.log('Checking existing items…');
  const existing = await api('/api/backlog/items');
  if (existing.length > 0) {
    console.log(`Backlog already has ${existing.length} items — skipping seed to avoid duplicates.`);
    console.log('To re-seed, delete all items first.');
    return;
  }

  const colCache = {};
  for (const item of SEED) {
    if (!colCache[item.column]) {
      colCache[item.column] = await getColumnId(item.column);
    }
    const created = await api('/api/backlog/items', 'POST', {
      column_id: colCache[item.column],
      title: item.title,
      description: item.description || null,
      wp_ref: item.wp_ref || null,
      effort: item.effort || null,
      type: item.type || null,
    });
    console.log(`  ✓ [${item.column}] ${item.title}`);
  }
  console.log(`\nSeeded ${SEED.length} items.`);
}

main().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
