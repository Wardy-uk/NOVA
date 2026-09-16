/**
 * Validate the daily KPI series against the live database — WITHOUT deploying,
 * and BEFORE anything is built on top of it.
 *
 * This is the gate. VANTAGE's early-warning detectors are first derivatives of
 * `kpi_org_daily`, and a derivative is only as honest as the series underneath
 * it. Two things have to be established on the box before a single detector is
 * written, because both have failed silently in this estate before:
 *
 *   GATE 1 — does `kpi_org_daily` actually hold the days it appears to?
 *            A day NOVA was down at 18:00 is simply absent, and an absent day
 *            looks like a healthy series until you count. A detector reading a
 *            missing day as zero fires on an outage and calls it an improvement.
 *
 *            ⚠ Do NOT take `backfill.ts`'s header for this. It states that the
 *            over-SLA and FRT-breach stocks were left blank by the historic
 *            reconstruction; measured on 16 Sep 2026 they carry 72 days of
 *            `source='reconstruct'` with no zeros, so the comment is stale and
 *            was repeated as fact in a report before anyone counted. That is
 *            the whole reason this script exists rather than a reading of the
 *            code: a comment says what someone meant, a COUNT says what is
 *            there.
 *
 *   GATE 2 — are `agent_queue_snapshots`, `agent_capacity_forecasts` and
 *            `ticket_trend_snapshots` being WRITTEN? Writers exist in the code.
 *            That is not evidence rows exist. `sla_breached` had a writer too,
 *            and is 0 on all 5,602 rows; nothing ever called `logRejection()`.
 *            A reader that outlives its writer looks exactly like coverage.
 *
 * It imports `getKpiOrgSeries` — the exact function the bridge route calls — so
 * there is no second copy of the logic to drift. A pass here IS a pass for
 * `GET /api/neuro-bridge/kpi-org-series`.
 *
 * Read-only. Every statement it can reach is a SELECT.
 *
 * Run on AAPP01, FROM THE REPO ROOT — it loads `.env` relative to the working
 * directory, the same file the server reads:
 *
 *     cd C:\nurtur\nova
 *     npx tsx scripts/validate-kpi-org-series.ts
 *     npx tsx scripts/validate-kpi-org-series.ts --days 180
 *     npx tsx scripts/validate-kpi-org-series.ts --json
 *
 * Exit code 1 if either gate fails, so it can gate the work that follows.
 */

import dotenv from 'dotenv';

import { closePool, query } from '../src/server/services/database.js';
import {
  getKpiOrgSeries,
  KPI_ORG_SERIES_BUILD,
  type KpiSeries,
} from '../src/server/services/kpi-org/series.js';

// Same reason as validate-flow-signals: the server loads its environment in
// index.ts, which this deliberately does not import. Safe at import time because
// database.ts reads its settings lazily on first connect.
dotenv.config();

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 120;
const team = args.includes('--team') ? String(args[args.indexOf('--team') + 1]) : 'Support';
const asJson = args.includes('--json');

/**
 * What a detector needs before it is allowed to exist.
 *
 * ⚠ These numbers are set HERE, once, before any back-test has been run, and
 * they are not to be revisited because a detector failed. A threshold moved to
 * make a result look better is not a threshold.
 *
 * 28 days of baseline because four whole weeks cancel day-of-week effects —
 * the desk's volume is strongly weekly and a 3-week baseline would carry a
 * Monday bias. 7 days of current window on top, so 35 days with a value.
 *
 * MAX_INTERIOR_GAP is 2 because the freeze is daily and a single missed
 * evening is a restart; three consecutive misses is an outage, and a slope
 * drawn across one is measuring the outage.
 */
const MIN_DAYS_WITH_VALUE = 35;
const MAX_INTERIOR_GAP = 2;
/** A series whose last value is older than this cannot support a 1-5 day warning. */
const MAX_STALE_DAYS = 2;

/** The five V1 detectors and the KPI keys each one cannot run without. */
const DETECTORS: Array<{ id: string; name: string; keys: string[] }> = [
  {
    id: 'A', name: 'Net flow divergence',
    keys: ['nt_new_tickets', 'nt_solved_team', 'nt_solved_nova'],
  },
  {
    id: 'B', name: 'Ageing acceleration',
    keys: ['nt_oldest_incident', 'nt_oldest_production', 'nt_oldest_development'],
  },
  {
    id: 'C', name: 'Escalation quality shift',
    keys: ['nt_escalated', 'nt_rejected'],
  },
  {
    id: 'D', name: 'Dev-owned drift',
    // Matches what detectDevDrift actually reads. An earlier draft also gated
    // on nt_tpj_dev_t3, which the detector does not touch — a gate that blocks
    // on a source nothing reads is a gate describing a system that is not there.
    keys: ['nt_development', 'nt_oldest_development', 'nt_incidents', 'nt_production'],
  },
  {
    id: 'E', name: 'Capacity collision',
    // Volume history for the day-of-week baseline. Leave and forecast come from
    // agent_availability / agent_capacity_forecasts, checked in gate 2.
    keys: ['nt_new_tickets'],
  },
];

interface KeyVerdict {
  key: string;
  ok: boolean;
  reasons: string[];
  label: string;
  daysWithValue: number;
  daysMissing: number;
  daysNull: number;
  longestGapDays: number;
  staleDays: number | null;
  firstValueDay: string | null;
  sources: Record<string, number>;
}

function judge(s: KpiSeries): KeyVerdict {
  const c = s.coverage;
  const reasons: string[] = [];
  if (c.daysWithValue === 0) {
    reasons.push('NO DATA AT ALL in the window');
  } else {
    if (c.daysWithValue < MIN_DAYS_WITH_VALUE) {
      reasons.push(`only ${c.daysWithValue} days with a value (need ${MIN_DAYS_WITH_VALUE})`);
    }
    if (c.longestGapDays > MAX_INTERIOR_GAP) {
      reasons.push(`${c.longestGapDays}-day hole inside the series (max ${MAX_INTERIOR_GAP})`);
    }
    if (c.staleDays !== null && c.staleDays > MAX_STALE_DAYS) {
      reasons.push(`last value is ${c.staleDays} days old (max ${MAX_STALE_DAYS})`);
    }
  }
  return {
    key: s.key,
    ok: reasons.length === 0,
    reasons,
    label: s.label,
    daysWithValue: c.daysWithValue,
    daysMissing: c.daysMissing,
    daysNull: c.daysNull,
    longestGapDays: c.longestGapDays,
    staleDays: c.staleDays,
    firstValueDay: c.firstValueDay,
    sources: c.sources,
  };
}

/**
 * GATE 2 — is anything actually writing to the tables the detectors would read?
 *
 * Row count, span and recency for each. A table that exists and is empty is the
 * failure mode being hunted, so an empty table is a LOUD result, not a zero in
 * a column nobody reads.
 */
async function gateTwo(): Promise<{ ok: boolean; lines: string[]; detail: unknown }> {
  const targets: Array<{ table: string; stamp: string; neededBy: string }> = [
    { table: 'agent_queue_snapshots', stamp: 'created_at', neededBy: 'hourly backlog/unassigned texture (context for A, D)' },
    { table: 'agent_capacity_forecasts', stamp: 'generated_at', neededBy: 'detector E (capacity collision)' },
    { table: 'ticket_trend_snapshots', stamp: 'created_at', neededBy: 'nothing in V1 — checked so its state is on the record' },
  ];

  const lines: string[] = [];
  const detail: Record<string, unknown> = {};
  let ok = true;

  for (const t of targets) {
    try {
      // Sequential and narrow. These are small tables; the point is the facts,
      // not the speed.
      const rows = await query<{ n: number; first: string | null; last: string | null }>(
        `SELECT COUNT(*) AS n,
                CONVERT(varchar(33), MIN(${t.stamp}), 126) AS first,
                CONVERT(varchar(33), MAX(${t.stamp}), 126) AS last
           FROM ${t.table}`,
      );
      const n = Number(rows[0]?.n ?? 0);
      const last = rows[0]?.last ?? null;
      const ageH = last ? Math.round((Date.now() - Date.parse(last)) / 3_600_000) : null;
      detail[t.table] = { rows: n, first: rows[0]?.first ?? null, last, ageHours: ageH };

      if (n === 0) {
        // Only fails the gate if V1 depends on it. ticket_trend_snapshots is
        // recorded either way so the next person does not re-derive it.
        const fatal = t.table !== 'ticket_trend_snapshots';
        if (fatal) ok = false;
        lines.push(`  ${fatal ? '✗' : 'ℹ'} ${t.table.padEnd(26)} EMPTY — writer exists, rows do not. Needed by: ${t.neededBy}`);
      } else {
        lines.push(`  ✓ ${t.table.padEnd(26)} ${n.toLocaleString()} rows, ${rows[0]?.first?.slice(0, 10)} → ${last?.slice(0, 10)}`
          + (ageH === null ? '' : ` (newest ${ageH}h old)`));
      }
    } catch (err) {
      ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      detail[t.table] = { error: msg };
      lines.push(`  ✗ ${t.table.padEnd(26)} COULD NOT BE READ — ${msg}`);
    }
  }
  return { ok, lines, detail };
}

async function main(): Promise<void> {
  if (!asJson) {
    console.log(`\nvalidate-kpi-org-series — series build ${KPI_ORG_SERIES_BUILD}`);
    console.log(`team ${team}, last ${days} days\n`);
  }

  const series = await getKpiOrgSeries({ days, team });
  const byKey = new Map(series.series.map(s => [s.key, s]));

  // ── GATE 1 ────────────────────────────────────────────────────────────────
  const needed = [...new Set(DETECTORS.flatMap(d => d.keys))].sort();
  const verdicts = new Map<string, KeyVerdict>();
  for (const key of needed) {
    const s = byKey.get(key);
    verdicts.set(key, s
      ? judge(s)
      : {
        key, ok: false, reasons: ['key returned NO SERIES — absent from kpi_org_daily entirely'],
        label: key, daysWithValue: 0, daysMissing: days, daysNull: 0,
        longestGapDays: 0, staleDays: null, firstValueDay: null, sources: {},
      });
  }

  const detectorVerdicts = DETECTORS.map(d => {
    const failing = d.keys.filter(k => !verdicts.get(k)?.ok);
    return { ...d, ok: failing.length === 0, failing };
  });

  const gate1Ok = detectorVerdicts.some(d => d.ok);
  const gate2 = await gateTwo();

  if (asJson) {
    console.log(JSON.stringify({
      build: KPI_ORG_SERIES_BUILD,
      window: series.window,
      team,
      thresholds: { MIN_DAYS_WITH_VALUE, MAX_INTERIOR_GAP, MAX_STALE_DAYS },
      gate1: { ok: gate1Ok, keys: [...verdicts.values()], detectors: detectorVerdicts },
      gate2: { ok: gate2.ok, tables: gate2.detail },
      absent: series.absent,
      unknownKeys: series.unknownKeys,
    }, null, 2));
  } else {
    console.log(`GATE 1 — does kpi_org_daily hold the days the detectors need?`);
    console.log(`  bar: ${MIN_DAYS_WITH_VALUE}+ days with a value, no interior gap over ${MAX_INTERIOR_GAP} days, last value within ${MAX_STALE_DAYS} days\n`);

    for (const v of verdicts.values()) {
      const src = Object.entries(v.sources).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
      console.log(`  ${v.ok ? '✓' : '✗'} ${v.key.padEnd(24)} ${String(v.daysWithValue).padStart(3)}/${days} days`
        + ` · gap ${v.longestGapDays}d · stale ${v.staleDays ?? 'n/a'}d`
        + ` · from ${v.firstValueDay ?? '—'} · [${src}]`);
      for (const r of v.reasons) console.log(`      ↳ ${r}`);
    }

    console.log(`\n  Detector readiness:`);
    for (const d of detectorVerdicts) {
      console.log(`  ${d.ok ? '✓' : '✗'} ${d.id}  ${d.name.padEnd(26)}`
        + (d.ok ? 'sources verified' : `BLOCKED on ${d.failing.join(', ')}`));
    }

    console.log(`\nGATE 2 — are the snapshot tables actually being written?\n`);
    for (const l of gate2.lines) console.log(l);

    if (series.absent.length) {
      console.log(`\n  ${series.absent.length} registry KPI(s) for ${team} have NO row in this window:`);
      console.log(`    ${series.absent.join(', ')}`);
      console.log(`  Named rather than omitted — a KPI silently missing from a list of KPIs reads as`);
      console.log(`  one that is fine. Check each: a MANUAL KPI with no rows is nobody entering it, a`);
      console.log(`  computed one with no rows is a capture that is not running. Absent is not zero,`);
      console.log(`  and those two do not have the same fix.`);
    }
    if (series.unknownKeys.length) {
      console.log(`\n  ⚠ ${series.unknownKeys.length} key(s) in the table the registry does not know: ${series.unknownKeys.join(', ')}`);
    }

    const blocked = detectorVerdicts.filter(d => !d.ok);
    console.log('');
    if (gate1Ok && gate2.ok && !blocked.length) {
      console.log('Both gates pass, all five detectors have verified sources.\n');
    } else {
      console.log('RESULT:');
      if (!gate2.ok) console.log('  ✗ Gate 2 failed — a table V1 depends on is empty or unreadable. Do not build against it.');
      if (blocked.length) {
        console.log(`  ✗ ${blocked.length} detector(s) blocked: ${blocked.map(d => d.id).join(', ')}.`);
        console.log('    These do NOT get built with a substituted or interpolated source. They stay unbuilt,');
        console.log('    named in the report, until the underlying capture is fixed.');
      }
      if (!gate1Ok) console.log('  ✗ No detector has a usable series. Nothing downstream should be written yet.');
      console.log('');
    }
  }

  await closePool();
  process.exit(gate1Ok && gate2.ok && detectorVerdicts.every(d => d.ok) ? 0 : 1);
}

main().catch(async err => {
  console.error('\nValidation could not run:', err instanceof Error ? err.message : err);
  console.error('If this is a connection error, check you are running from the repo root so `.env` is found, and that it carries NOVA_SQL_CONNECTION (or NOVA_SQL_SERVER/DATABASE/USER/PASSWORD).\n');
  try { await closePool(); } catch { /* already down */ }
  process.exit(1);
});
