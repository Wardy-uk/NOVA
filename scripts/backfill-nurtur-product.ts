/**
 * One-off backfill for NT tickets NOVA stamped "Not A Nurtur Product" (handoff 25 Sep 2026).
 *
 * DRY RUN IS THE DEFAULT. It reads Jira and writes a CSV for review; it changes nothing.
 *
 *   npx tsx scripts/backfill-nurtur-product.ts                       # dry run, last 90 days
 *   npx tsx scripts/backfill-nurtur-product.ts --days 90 --limit 50  # sample
 *   npx tsx scripts/backfill-nurtur-product.ts --write --csv <approved.csv>
 *
 * Write mode applies ONLY the rows in the CSV you pass it, so deleting or editing a row in
 * the reviewed CSV is how you veto or correct it. It writes with notifyUsers=false, one
 * ticket per request, and appends one audit line per change to <csv>.audit.jsonl.
 *
 * Credentials: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN. Write mode requires them to be set
 * explicitly and should run as NOVA-Jira. A dry run falls back to the local settings.json
 * jira_url / jira_username / jira_token (read-only use).
 *
 * What it proposes, per ticket, in priority order:
 *   1. restore   NOVA-Jira changed Nurtur Product away from a real value, and nobody has
 *                changed it since: put back the previous Product / Sub Category / TL;DR.
 *   2. reclassify  section 4 rules via config/nurtur-product-rules.ts (the same module the
 *                live close path uses). No match keeps Not A Nurtur Product + the
 *                nova-product-unknown label (rule_matched = fallback).
 *   3. eXp review  eXp new-agent emails closed as Duplicate get nova-review-eXp.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyNurturProduct, isWpEngineSpmAlert, websiteProduct,
  NOT_A_NURTUR_PRODUCT, PRODUCT_UNKNOWN_LABEL, NURTUR_PRODUCT_OPTIONS,
} from '../src/server/config/nurtur-product-rules.js';
import { adfToText, textToAdf, CF_NURTUR_PRODUCT, CF_PRODUCT_SUB_CATEGORY, CF_TLDR } from '../src/server/utils/jira-resolve-fields.js';

const NOVA_JIRA_ACCOUNT_ID = '712020:67acd53f-75f0-4548-adfe-91bba72ad38f';
const EXP_REVIEW_LABEL = 'nova-review-eXp';

// ── Args ──
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const WRITE = flag('write');
const DAYS = Number(opt('days') ?? 90);
const LIMIT = opt('limit') ? Number(opt('limit')) : Infinity;
const CSV_IN = opt('csv');
const OUT = opt('out') ?? `backfill-nurtur-product-${new Date().toISOString().slice(0, 10)}.csv`;

// ── Jira ──
function credentials(): { base: string; auth: string } {
  let base = process.env.JIRA_BASE_URL, email = process.env.JIRA_EMAIL, token = process.env.JIRA_API_TOKEN;
  if ((!base || !email || !token) && !WRITE) {
    const path = join(process.cwd(), 'settings.json');
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      const s = raw.settings ?? raw;
      base ??= s.jira_url; email ??= s.jira_username; token ??= s.jira_token;
    }
  }
  if (!base || !email || !token) {
    throw new Error(WRITE
      ? 'Write mode needs JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN set explicitly (run as NOVA-Jira).'
      : 'No Jira credentials: set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.');
  }
  return { base: base.replace(/\/+$/, ''), auth: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') };
}
const { base, auth } = credentials();

async function jira<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/rest/api/3/${path}`, {
      method,
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      const wait = Number(res.headers.get('retry-after') ?? 5) * 1000;
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}

async function searchAll(jql: string, fields: string[], max = Infinity): Promise<any[]> {
  const out: any[] = [];
  let nextPageToken: string | undefined;
  do {
    const page = await jira<{ issues: any[]; nextPageToken?: string; isLast?: boolean }>(
      'POST', 'search/jql', { jql, fields, maxResults: 100, nextPageToken });
    out.push(...page.issues);
    nextPageToken = page.isLast === false ? page.nextPageToken : undefined;
  } while (nextPageToken && out.length < max);
  return out.slice(0, max);
}

interface ChangeItem { fieldId?: string; field?: string; fromString?: string | null; toString?: string | null }
interface ChangeEntry { author?: { accountId?: string }; created: string; items: ChangeItem[] }

async function changelog(key: string): Promise<ChangeEntry[]> {
  const out: ChangeEntry[] = [];
  for (let startAt = 0; ; startAt += 100) {
    const page = await jira<{ values: ChangeEntry[]; isLast?: boolean; total?: number }>(
      'GET', `issue/${key}/changelog?startAt=${startAt}&maxResults=100`);
    out.push(...page.values);
    if (page.isLast !== false || page.values.length === 0) break;
  }
  return out; // oldest first
}

async function pool<T, R>(items: T[], size: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }));
  return results;
}

// ── CSV ──
const COLUMNS = ['key', 'summary', 'current_product', 'proposed_product', 'proposed_subcategory', 'rule_matched', 'confidence', 'action', 'labels_to_add', 'proposed_tldr'] as const;
type Row = Record<(typeof COLUMNS)[number], string>;

const csvCell = (v: string) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
function toCsv(rows: Row[]): string {
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => csvCell(r[c] ?? '')).join(','))].join('\n') + '\n';
}
function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = '', record: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { record.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); records.push(record); record = []; field = '';
    } else field += ch;
  }
  if (field || record.length) { record.push(field); records.push(record); }
  const [header, ...body] = records.filter(r => r.some(c => c !== ''));
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])) as Row);
}

// ── What NOVA's old TL;DR says about why it closed ──
function closeKindFromTldr(tldr: string): string | undefined {
  const qw = tldr.match(/Quick win auto-close: (\w+)|quick-win auto-close \((\w+)\)/i);
  if (qw) return qw[1] ?? qw[2];
  if (/vendor\/subscription notification/i.test(tldr)) return 'auto_rule:vendor-subscription-notification';
  if (/known vendor\/automated domain/i.test(tldr)) return 'auto_rule:vendor-domain-autoclose';
  if (/noreply\/mailer-daemon/i.test(tldr)) return 'auto_rule:noreply-automated-email';
  if (/out-of-office/i.test(tldr)) return 'auto_rule:auto-reply-out-of-office';
  return undefined;
}

// ── Dry run ──
async function dryRun(): Promise<void> {
  const fields = ['summary', 'description', 'reporter', 'labels', 'issuelinks', CF_NURTUR_PRODUCT, CF_PRODUCT_SUB_CATEGORY, CF_TLDR];
  const jql = `project = NT AND "Nurtur Product" = "Not A Nurtur Product" AND created >= -${DAYS}d ORDER BY created DESC`;
  console.log(`Searching: ${jql}`);
  const issues = await searchAll(jql, fields, LIMIT);
  console.log(`${issues.length} ticket(s) in scope`);

  const expJql = `project = NT AND summary ~ "\\"Notification of New agent joining\\"" AND "Resolution Type" = Duplicate AND created >= -${DAYS}d`;
  const expKeys = new Set((await searchAll(expJql, ['summary'])).map(i => i.key as string));
  console.log(`${expKeys.size} eXp duplicate closure(s) to flag`);

  const rows = await pool(issues, 4, async (issue, i): Promise<Row> => {
    if (i > 0 && i % 100 === 0) console.log(`  ${i}/${issues.length}`);
    const f = issue.fields ?? {};
    const summary: string = f.summary ?? '';
    const currentProduct: string = f[CF_NURTUR_PRODUCT]?.value ?? '';
    const tldrText = adfToText(f[CF_TLDR]).trim();
    const labels: string[] = [];
    if (expKeys.has(issue.key)) labels.push(EXP_REVIEW_LABEL);
    const row = (p: Partial<Row>): Row => ({
      key: issue.key, summary, current_product: currentProduct, proposed_product: currentProduct,
      proposed_subcategory: f[CF_PRODUCT_SUB_CATEGORY] ?? '', rule_matched: '', confidence: '',
      action: 'no_change', labels_to_add: '', proposed_tldr: '', ...p,
    });

    // 1. Restore what NOVA-Jira overwrote.
    const history = await changelog(issue.key);
    const productChanges = history.filter(e => e.items.some(it => it.fieldId === CF_NURTUR_PRODUCT));
    const last = productChanges[productChanges.length - 1];
    if (last && last.author?.accountId !== NOVA_JIRA_ACCOUNT_ID) {
      // Someone other than NOVA-Jira (a person, n8n, another rule) set it last. Their call stands.
      return row({ rule_matched: 'not-set-by-nova', confidence: 'high', labels_to_add: labels.join(' '), action: labels.length ? 'label' : 'no_change' });
    }
    const overwrite = [...productChanges].reverse().find(e => e.author?.accountId === NOVA_JIRA_ACCOUNT_ID
      && e.items.some(it => it.fieldId === CF_NURTUR_PRODUCT && it.fromString && it.fromString !== NOT_A_NURTUR_PRODUCT));
    if (overwrite) {
      const item = (id: string) => overwrite.items.find(it => it.fieldId === id);
      const prevProduct = item(CF_NURTUR_PRODUCT)!.fromString!;
      const prevSub = item(CF_PRODUCT_SUB_CATEGORY)?.fromString ?? f[CF_PRODUCT_SUB_CATEGORY] ?? '';
      const prevTldr = item(CF_TLDR)?.fromString?.trim();
      const proposedTldr = prevTldr ? (tldrText && tldrText !== prevTldr ? `${prevTldr} | NOVA: ${tldrText}` : prevTldr) : '';
      return row({
        proposed_product: prevProduct, proposed_subcategory: prevSub, rule_matched: 'restore', confidence: 'high',
        action: 'restore', labels_to_add: labels.join(' '), proposed_tldr: proposedTldr,
      });
    }

    // 2. Reclassify.
    const reporterEmail: string | null = f.reporter?.emailAddress ?? null;
    const description = adfToText(f.description);
    const linkedIssueKeys: string[] = (f.issuelinks ?? []).map((l: any) => l.inwardIssue?.key ?? l.outwardIssue?.key).filter(Boolean);

    // Website amends that the AI triage cloned to NTPJ and closed (before 25 Aug, 9a9c277).
    // Triage judged each one a website amend at >= 0.9, which is a stronger signal than keywords.
    if (/Plugin ticket cloned to/i.test(tldrText) && !isWpEngineSpmAlert(summary, reporterEmail)) {
      const w = websiteProduct(`${summary}\n${description}`, linkedIssueKeys);
      return row({
        proposed_product: w.product, proposed_subcategory: `Website - ${w.platform}`,
        rule_matched: '4.4:website-amend-clone', confidence: w.confidence, action: 'reclassify', labels_to_add: labels.join(' '),
      });
    }

    const c = classifyNurturProduct({ summary, description, reporterEmail, linkedIssueKeys, closeKind: closeKindFromTldr(tldrText) });
    if (c.unknown) labels.push(PRODUCT_UNKNOWN_LABEL);
    const changes = c.product !== currentProduct || (c.subCategory !== (f[CF_PRODUCT_SUB_CATEGORY] ?? ''));
    return row({
      proposed_product: c.product, proposed_subcategory: c.subCategory, rule_matched: c.rule, confidence: c.confidence,
      action: changes ? 'reclassify' : labels.length ? 'label' : 'no_change', labels_to_add: labels.join(' '),
    });
  });

  // eXp duplicate closures whose Product isn't Not A Nurtur Product still need the review label.
  const inScope = new Set(issues.map(i => i.key as string));
  for (const key of expKeys) {
    if (inScope.has(key)) continue;
    rows.push({
      key, summary: 'Notification of New agent joining (closed as Duplicate)', current_product: '', proposed_product: '',
      proposed_subcategory: '', rule_matched: 'exp-review', confidence: 'high', action: 'label',
      labels_to_add: EXP_REVIEW_LABEL, proposed_tldr: '',
    });
  }

  writeFileSync(OUT, toCsv(rows), 'utf8');
  const tally = rows.reduce<Record<string, number>>((t, r) => {
    t[r.action] = (t[r.action] ?? 0) + 1;
    t[`product: ${r.proposed_product}`] = (t[`product: ${r.proposed_product}`] ?? 0) + 1;
    return t;
  }, {});
  console.log(`\nWrote ${rows.length} row(s) to ${OUT}. Nothing was changed in Jira.`);
  for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}: ${v}`);
}

// ── Write ──
async function write(): Promise<void> {
  if (!CSV_IN) throw new Error('--write needs --csv <the approved CSV>');
  const rows = parseCsv(readFileSync(CSV_IN, 'utf8')).filter(r => r.action && r.action !== 'no_change');
  const audit = `${CSV_IN}.audit.jsonl`;
  console.log(`Applying ${rows.length} approved row(s) from ${CSV_IN}; audit → ${audit}`);

  let ok = 0, failed = 0, skipped = 0;
  for (const r of rows) {
    const fields: Record<string, unknown> = {};
    if (r.action === 'restore' || r.action === 'reclassify') {
      if (!(r.proposed_product in NURTUR_PRODUCT_OPTIONS)) {
        console.warn(`${r.key}: unknown product "${r.proposed_product}", skipped`);
        skipped++; continue;
      }
      fields[CF_NURTUR_PRODUCT] = { value: r.proposed_product };
      if (r.proposed_subcategory) fields[CF_PRODUCT_SUB_CATEGORY] = r.proposed_subcategory;
      if (r.proposed_tldr) fields[CF_TLDR] = textToAdf(r.proposed_tldr);
    }
    const labels = r.labels_to_add.split(/\s+/).filter(Boolean);
    const body: Record<string, unknown> = {};
    if (Object.keys(fields).length) body.fields = fields;
    if (labels.length) body.update = { labels: labels.map(l => ({ add: l })) };
    if (!Object.keys(body).length) { skipped++; continue; }

    // Re-read before writing: if someone has set a real Product since the review, leave it.
    const live = await jira<any>('GET', `issue/${r.key}?fields=${CF_NURTUR_PRODUCT},${CF_PRODUCT_SUB_CATEGORY},${CF_TLDR}`);
    const liveProduct = live.fields?.[CF_NURTUR_PRODUCT]?.value ?? '';
    if (body.fields && liveProduct && liveProduct !== NOT_A_NURTUR_PRODUCT) {
      console.warn(`${r.key}: Product is now "${liveProduct}", not overwriting`);
      delete body.fields;
      if (!body.update) { skipped++; continue; }
    }
    const before = {
      product: liveProduct, subCategory: live.fields?.[CF_PRODUCT_SUB_CATEGORY] ?? null,
      tldr: adfToText(live.fields?.[CF_TLDR]),
    };
    try {
      await jira('PUT', `issue/${r.key}?notifyUsers=false`, body);
      ok++;
      appendFileSync(audit, JSON.stringify({ ts: new Date().toISOString(), key: r.key, action: r.action, rule: r.rule_matched, before, after: body, result: 'ok' }) + '\n');
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${r.key}: ${msg}`);
      appendFileSync(audit, JSON.stringify({ ts: new Date().toISOString(), key: r.key, action: r.action, rule: r.rule_matched, before, after: body, result: 'error', error: msg }) + '\n');
    }
    await new Promise(res => setTimeout(res, 150)); // stay well under Jira's rate limit
  }
  console.log(`Done: ${ok} updated, ${skipped} skipped, ${failed} failed.`);
}

(WRITE ? write() : dryRun()).catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
