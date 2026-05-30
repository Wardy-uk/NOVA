/**
 * KPI Recovery — Manual Entry + Spreadsheet Import (P4-WP1)
 *
 * Phase 4 of the clean-sheet KPI system. Everything here is NEW and runs in
 * parallel with the untouched legacy KPI system. It builds on the live Phase 1
 * foundation (KpiEngine, kpi_* tables) and the Phase 2 RAG helper, and adds the
 * write path for the non-Jira teams (CS / KAM / ONBOARD / COMMS):
 *
 *   1. An entry form read model: the space's enabled metrics, each pre-filled
 *      with any value already stored for the selected date, plus the promoted
 *      daily value so the full round-trip is observable.
 *   2. Validation by metric value_type (integer / decimal / percentage /
 *      currency / duration_minutes).
 *   3. Save into kpi_manual_entries (idempotent upsert per space/metric/date).
 *   4. Promotion of each saved value into kpi_daily (with denormalised target +
 *      computed RAG) so the official daily store carries manual values too.
 *   5. Bulk historical import from the Daily KPI Tracker spreadsheet, reusing the
 *      same save+promote path with source = 'import'.
 *
 * Honesty rules (programme constraint): a blank field is NEVER written as 0; an
 * invalid value is rejected with a reason rather than coerced; unmapped import
 * rows are reported, not guessed.
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §3.10, §7, §8.2.
 */
import { query, execute } from '../database.js';
import type { KpiEngine } from './kpi-engine.js';
import { KpiEodService, type RagStatus } from './kpi-eod.js';
import { parseDailyKpiTracker, type ParseResult } from './kpi-tracker-parser.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A metric on the entry form, with any current stored + promoted value. */
export interface ManualFormMetric {
  metricKey: string;
  displayName: string;
  category: string;
  valueType: string;
  direction: string;
  targetValue: number | null;
  displayOrder: number;
  /** Value currently stored in kpi_manual_entries for this space/date (null if none). */
  currentValue: number | null;
  enteredBy: string | null;
  enteredAt: string | null;
  source: string | null;
  notes: string | null;
  /** Value promoted into kpi_daily for this space/date (null if not yet promoted). */
  promotedValue: number | null;
  promotedRag: RagStatus | null;
}

export interface ManualEntryForm {
  spaceKey: string;
  displayName: string;
  ownerName: string | null;
  isJiraSpace: boolean;
  reportDate: string;
  /** Manual entry is intended for non-Jira teams; surfaced honestly for Jira spaces. */
  note: string | null;
  metrics: ManualFormMetric[];
}

export interface ValidationResult {
  ok: boolean;
  value?: number;
  error?: string;
}

/** Result of a save / import: which metrics were written and which were rejected. */
export interface SaveResult {
  spaceKey: string;
  reportDate: string;
  saved: Array<{ metricKey: string; value: number; rag: RagStatus | null }>;
  rejected: Array<{ metricKey: string; reason: string }>;
}

export interface ImportSummary {
  dryRun: boolean;
  sheetsProcessed: number;
  datesDetected: string[];
  entriesParsed: number;
  entriesSaved: number;
  spacesTouched: string[];
  unmapped: Array<{ label: string; spaceKey: string | null }>;
  rejected: Array<{ spaceKey: string; metricKey: string; reportDate: string; reason: string }>;
  warnings: string[];
}

interface BindingRow {
  metric_key: string;
  display_name: string;
  category: string;
  value_type: string;
  direction: string;
  source: string;
  target_value: number | null;
  amber_band: number | null;
  display_order: number | null;
}

export class KpiManualService {
  private readonly eod: KpiEodService;
  constructor(private readonly engine: KpiEngine) {
    this.eod = new KpiEodService(engine);
  }

  /** Enabled metric bindings for a space (definition joined with per-space binding). */
  private async getBindings(spaceKey: string): Promise<BindingRow[]> {
    return query<BindingRow>(
      `SELECT d.metric_key, d.display_name, d.category, d.value_type, d.direction, d.source,
              sm.target_value, sm.amber_band, sm.display_order
       FROM kpi_space_metrics sm
       JOIN kpi_metric_definitions d ON d.metric_key = sm.metric_key
       WHERE sm.space_key = ? AND sm.is_enabled = 1 AND d.is_active = 1
       ORDER BY sm.display_order, d.metric_key`,
      [spaceKey],
    );
  }

  /**
   * Entry form for a space + date: every enabled metric, pre-filled with the
   * value already stored in kpi_manual_entries (and the promoted kpi_daily value)
   * for that date, so editing an existing day shows the current state.
   */
  async getEntryForm(spaceKey: string, reportDate: string): Promise<ManualEntryForm | null> {
    if (!DATE_RE.test(reportDate)) throw new Error('reportDate must be YYYY-MM-DD');
    const space = await this.engine.getSpaceConfig(spaceKey);
    if (!space) return null;

    const bindings = await this.getBindings(spaceKey);

    const existing = await query<{ metric_key: string; value: number; entered_by: string | null; entered_at: Date | string | null; source: string | null; notes: string | null }>(
      `SELECT metric_key, value, entered_by, entered_at, source, notes
       FROM kpi_manual_entries WHERE space_key = ? AND report_date = ?`,
      [spaceKey, reportDate],
    );
    const existByMetric = new Map(existing.map((e) => [e.metric_key, e]));

    const promoted = await query<{ metric_key: string; value: number; rag_status: string | null }>(
      `SELECT metric_key, value, rag_status FROM kpi_daily
       WHERE space_key = ? AND report_date = ? AND tier_name IS NULL`,
      [spaceKey, reportDate],
    );
    const promByMetric = new Map(promoted.map((p) => [p.metric_key, p]));

    const metrics: ManualFormMetric[] = bindings.map((b) => {
      const cur = existByMetric.get(b.metric_key);
      const prom = promByMetric.get(b.metric_key);
      return {
        metricKey: b.metric_key,
        displayName: b.display_name,
        category: b.category,
        valueType: b.value_type,
        direction: b.direction,
        targetValue: b.target_value,
        displayOrder: b.display_order ?? 0,
        currentValue: cur ? cur.value : null,
        enteredBy: cur?.entered_by ?? null,
        enteredAt: cur?.entered_at ? new Date(cur.entered_at).toISOString() : null,
        source: cur?.source ?? null,
        notes: cur?.notes ?? null,
        promotedValue: prom ? prom.value : null,
        promotedRag: (prom?.rag_status as RagStatus | null) ?? null,
      };
    });

    return {
      spaceKey: space.spaceKey,
      displayName: space.displayName,
      ownerName: space.ownerName,
      isJiraSpace: space.isJiraSpace,
      reportDate,
      note: space.isJiraSpace
        ? 'This is a Jira-computed space — values are normally captured automatically. Manual entry overrides are still written for the selected date.'
        : null,
      metrics,
    };
  }

  /** Validate a raw value against a metric value_type. Empty input is "skip" (no entry), not 0. */
  validateValue(valueType: string, raw: unknown): ValidationResult {
    if (raw === null || raw === undefined || raw === '') {
      return { ok: false, error: 'empty' };
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[£$,%\s]/g, ''));
    if (!Number.isFinite(n)) return { ok: false, error: 'not a number' };

    switch (valueType) {
      case 'integer':
        if (!Number.isInteger(n)) return { ok: false, error: 'must be a whole number' };
        if (n < 0) return { ok: false, error: 'must be ≥ 0' };
        return { ok: true, value: n };
      case 'percentage':
        if (n < 0 || n > 100) return { ok: false, error: 'must be between 0 and 100' };
        return { ok: true, value: n };
      case 'currency':
        if (n < 0) return { ok: false, error: 'must be ≥ 0' };
        return { ok: true, value: Math.round(n * 100) / 100 };
      case 'duration_minutes':
        if (n < 0) return { ok: false, error: 'must be ≥ 0' };
        return { ok: true, value: n };
      case 'decimal':
      default:
        return { ok: true, value: n };
    }
  }

  /**
   * Save a set of manual values for a space/date and promote each into kpi_daily.
   * Validates per value_type; rejected metrics are reported, not written. Blank
   * values are skipped (no fabricated zero). Idempotent per (space, metric, date).
   */
  async saveEntries(
    spaceKey: string,
    reportDate: string,
    entries: Array<{ metricKey: string; value: unknown; notes?: string | null }>,
    enteredBy: string | null,
    source: 'manual' | 'import' = 'manual',
  ): Promise<SaveResult> {
    if (!DATE_RE.test(reportDate)) throw new Error('reportDate must be YYYY-MM-DD');
    const bindings = await this.getBindings(spaceKey);
    const byKey = new Map(bindings.map((b) => [b.metric_key, b]));

    const out: SaveResult = { spaceKey, reportDate, saved: [], rejected: [] };
    for (const e of entries) {
      const b = byKey.get(e.metricKey);
      if (!b) { out.rejected.push({ metricKey: e.metricKey, reason: 'metric not enabled for this space' }); continue; }
      const v = this.validateValue(b.value_type, e.value);
      if (!v.ok) {
        if (v.error === 'empty') continue; // blank → skip silently (not an error, not a fabricated 0)
        out.rejected.push({ metricKey: e.metricKey, reason: v.error ?? 'invalid' });
        continue;
      }
      const value = v.value!;
      const rag = this.eod.computeRag(value, b.target_value, b.amber_band, b.direction);

      // Upsert kpi_manual_entries (delete+insert keeps it idempotent under the
      // unique (space, metric, date) constraint without DB-specific MERGE).
      await execute(
        `DELETE FROM kpi_manual_entries WHERE space_key = ? AND metric_key = ? AND report_date = ?`,
        [spaceKey, e.metricKey, reportDate],
      );
      await execute(
        `INSERT INTO kpi_manual_entries (space_key, metric_key, report_date, value, entered_by, source, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [spaceKey, e.metricKey, reportDate, value, enteredBy, source, e.notes ?? null],
      );

      // Promote into kpi_daily (space-level row, tier_name NULL) with target + RAG.
      await execute(
        `DELETE FROM kpi_daily WHERE space_key = ? AND metric_key = ? AND report_date = ? AND tier_name IS NULL`,
        [spaceKey, e.metricKey, reportDate],
      );
      await execute(
        `INSERT INTO kpi_daily (space_key, metric_key, tier_name, report_date, value, target_value, rag_status)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        [spaceKey, e.metricKey, reportDate, value, b.target_value, rag],
      );

      out.saved.push({ metricKey: e.metricKey, value, rag });
    }
    if (out.saved.length > 0) {
      console.log(`[kpi-manual] ${source} save ${spaceKey} ${reportDate} — ${out.saved.length} saved, ${out.rejected.length} rejected`);
    }
    return out;
  }

  /**
   * Import historical data from one or more Daily KPI Tracker sheets. Each sheet
   * is a 2-D grid (array of rows). Parses to (space, metric, date, value) entries,
   * then save+promotes them (source = 'import'). `dryRun` parses and reports
   * without writing — used to preview a backfill before committing.
   *
   * `spaceKey` forces a single-team sheet (bypasses section detection).
   */
  async importTracker(
    sheets: Array<{ name?: string; rows: unknown[][] }>,
    opts: { spaceKey?: string; dryRun?: boolean; enteredBy?: string | null } = {},
  ): Promise<ImportSummary> {
    const summary: ImportSummary = {
      dryRun: opts.dryRun === true,
      sheetsProcessed: 0,
      datesDetected: [],
      entriesParsed: 0,
      entriesSaved: 0,
      spacesTouched: [],
      unmapped: [],
      rejected: [],
      warnings: [],
    };

    // Group parsed entries by (space, date) so save+promote runs once per day.
    const bySpaceDate = new Map<string, { spaceKey: string; reportDate: string; entries: Array<{ metricKey: string; value: number }> }>();
    const dateSet = new Set<string>();
    const spaceSet = new Set<string>();

    for (const sheet of sheets) {
      const parsed: ParseResult = parseDailyKpiTracker(sheet.rows, { spaceKey: opts.spaceKey });
      summary.sheetsProcessed++;
      summary.warnings.push(...parsed.warnings.map((w) => sheet.name ? `[${sheet.name}] ${w}` : w));
      for (const d of parsed.datesDetected) dateSet.add(d);
      for (const u of parsed.unmapped) summary.unmapped.push(u);
      for (const e of parsed.entries) {
        summary.entriesParsed++;
        spaceSet.add(e.spaceKey);
        const k = `${e.spaceKey}|${e.reportDate}`;
        let g = bySpaceDate.get(k);
        if (!g) { g = { spaceKey: e.spaceKey, reportDate: e.reportDate, entries: [] }; bySpaceDate.set(k, g); }
        g.entries.push({ metricKey: e.metricKey, value: e.value });
      }
    }

    summary.datesDetected = [...dateSet].sort();
    summary.spacesTouched = [...spaceSet].sort();

    if (!summary.dryRun) {
      for (const g of bySpaceDate.values()) {
        const res = await this.saveEntries(g.spaceKey, g.reportDate, g.entries, opts.enteredBy ?? 'import', 'import');
        summary.entriesSaved += res.saved.length;
        for (const r of res.rejected) summary.rejected.push({ spaceKey: g.spaceKey, metricKey: r.metricKey, reportDate: g.reportDate, reason: r.reason });
      }
    }

    console.log(
      `[kpi-manual] import${summary.dryRun ? ' (dry-run)' : ''}: ${summary.sheetsProcessed} sheet(s), ` +
      `${summary.entriesParsed} parsed, ${summary.entriesSaved} saved, ${summary.unmapped.length} unmapped label(s).`,
    );
    return summary;
  }
}
