/**
 * KPI Recovery — Daily KPI Tracker spreadsheet parser (P4-WP1)
 *
 * Pure, dependency-free parser for the legacy "Daily KPI Tracker" spreadsheet
 * format. Operates on a 2-D grid (array of rows, each an array of cells) so it
 * is testable in isolation and reusable whether the grid came from a server-side
 * XLSX.read() or a client-parsed sheet.
 *
 * Layout assumptions (design §4.4, §8.2 — Daily KPI Tracker):
 *   - One monthly sheet. Columns are working days (dated header cells); rows are
 *     KPI labels grouped under per-team section headers.
 *   - The parser maps row labels → metric_key (scoped to the current team space,
 *     because several labels collide across CS / KAM) and dated columns →
 *     report_date, then emits one entry per (space, metric, date) numeric cell.
 *
 * Honesty rules (programme constraint — never fabricate):
 *   - A label it cannot confidently map to a metric is reported in `unmapped`,
 *     NOT silently dropped or guessed.
 *   - A blank / non-numeric data cell yields NO entry (never a fabricated 0).
 *   - If no team context can be established for a row, it is reported, not mapped.
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §4.4 (the "Spreadsheet Row" column).
 */

/** Normalise a label/section string for tolerant matching. */
export function normaliseLabel(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[£$%]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Spreadsheet row label(s) → metric_key, scoped per space because labels such as
 * "Cancellations processed (value)" and "put on hold - quantity" recur across CS
 * and KAM. Keys are the design §4.4 "Spreadsheet Row" strings (plus the metric
 * display name as an extra alias). Matching is done on the normalised form.
 */
export const SPREADSHEET_LABELS: Record<string, Record<string, string[]>> = {
  ONBOARD: {
    onboard_qty_delivered: ['Quantity delivered today', 'Onboarding Delivered (qty)'],
    onboard_value_delivered: ['Value delivered today', 'Onboarding Delivered (value)'],
    onboard_over_sla_calls: ['Over SLA onboarding calls', 'Over SLA Onboarding Calls'],
    onboard_over_sla_deliver: ['Over SLA time to deliver CLIENTS', 'Over SLA time to deliver', 'Over SLA Time to Deliver'],
    onboard_training_calls: ['Onboarding & Training calls', 'Onboarding and Training calls', 'Onboarding & Training Calls'],
  },
  COMMS: {
    comms_content_built_qa_client: ['% content built sent to QA (client)', 'content built sent to QA client'],
    comms_content_qad_client: ["% content QA'd (client)", 'content QAd client'],
    comms_content_built_ka: ['% content built sent to KA', 'content built sent to KA'],
    comms_social_scheduled: ['% social media scheduled', 'social media scheduled'],
    comms_qa_caught_remedy: ['% that QA have internally caught', 'QA internally caught'],
    guild_comms_proof_current: ['Guild Comms Proof (Current Month) %', 'Guild comms proof current month'],
    guild_comms_scheduled_current: ['Guild Comms Scheduled (Current) %', 'Guild comms scheduled current month'],
  },
  CS: {
    cs_proofing_amends: ['% required amends from proofing BY CS', 'required amends from proofing by CS'],
    cs_comms_proof_sent: ['% of comms managed proof sent', 'comms managed proof sent'],
    cs_comms_scheduled: ['% of comms managed scheduled', 'comms managed scheduled'],
    cs_biz_reviews_30d: ['30 day % (uniques)', '30 day uniques'],
    cs_biz_reviews_60d: ['60 day % (uniques)', '60 day uniques'],
    cs_biz_reviews_daily: ['Business reviews completed'],
    cs_other_calls: ['Other calls'],
    cs_on_hold_qty: ['Customers put on hold - quantity', 'Customers put on hold quantity'],
    cs_on_hold_value: ['Customers put on hold - value', 'Customers put on hold value'],
    cs_open_tickets: ['Open CS support tickets'],
    cs_over_sla: ['Open CS support tickets over SLA', 'CS support tickets over SLA'],
    cs_resignations_value: ['Resignations received CS (value)', 'Resignations received CS value'],
    cs_resignations_qty: ['Resignations received CS (quantity)', 'Resignations received CS quantity'],
    cs_cancellations_value: ['Cancellations processed (value)', 'Cancellations processed value'],
    cs_cancellations_qty: ['Cancellations processed (quantity)', 'Cancellations processed quantity'],
    cs_cross_sells: ['Cross sells booked by CS', 'Cross sells booked'],
    cs_red_customers: ['Red Customers'],
    cs_amber_customers: ['Amber Customers'],
    cs_reviews_google_tp: ['Review - Google and Trustpilot', 'Reviews Google and Trustpilot'],
    cs_case_studies: ['Case studies'],
  },
  KAM: {
    kam_comms_proof_current: ['% comms proof sent for current month', 'comms proof sent for current month'],
    kam_comms_proof_next: ['% comms proof sent for next month', 'comms proof sent for next month'],
    kam_comms_scheduled_current: ['% comms scheduled for current month', 'comms scheduled for current month'],
    kam_comms_scheduled_next: ['% comms scheduled for next month', 'comms scheduled for next month'],
    kam_30d_contact: ['30 day % contact', '30 day contact'],
    kam_60d_contact: ['60 day % contact', '60 day contact'],
    kam_open_tickets: ['Open KAM support tickets'],
    kam_over_sla: ['Over SLA', 'KAM Tickets Over SLA'],
    kam_on_hold_qty: ['put on hold - quantity', 'put on hold quantity'],
    kam_on_hold_value: ['put on hold - value', 'put on hold value'],
    kam_cancellations_value: ['Cancellations processed (value)', 'Cancellations processed value'],
    kam_cancellations_qty: ['Cancellations processed (quantity)', 'Cancellations processed quantity'],
  },
};

/** Section-header text → space_key. First match wins; tested on the normalised form. */
const SECTION_ALIASES: Array<{ re: RegExp; spaceKey: string }> = [
  { re: /customer success|^cs( team)?$/, spaceKey: 'CS' },
  { re: /key account|^kam( team)?$|key accounts manager/, spaceKey: 'KAM' },
  { re: /onboard/, spaceKey: 'ONBOARD' },
  { re: /comms managed|^comms( team)?$|communications managed/, spaceKey: 'COMMS' },
];

/** Build the normalised label → metric_key lookup for a given space. */
function labelIndexForSpace(spaceKey: string): Map<string, string> {
  const map = new Map<string, string>();
  const labels = SPREADSHEET_LABELS[spaceKey];
  if (!labels) return map;
  for (const [metricKey, aliases] of Object.entries(labels)) {
    for (const a of aliases) {
      const n = normaliseLabel(a);
      if (n && !map.has(n)) map.set(n, metricKey);
    }
  }
  return map;
}

/** Detect a team section header from a row's first label cell. */
function detectSection(label: string): string | null {
  const n = normaliseLabel(label);
  if (!n) return null;
  for (const { re, spaceKey } of SECTION_ALIASES) if (re.test(n)) return spaceKey;
  return null;
}

/**
 * Parse a cell into an ISO date (YYYY-MM-DD) if it looks like a date, else null.
 * Handles JS Date (from XLSX cellDates), ISO strings, and UK dd/mm/yyyy strings.
 */
export function parseCellDate(cell: unknown): string | null {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) {
    return isNaN(cell.getTime()) ? null : isoDate(cell);
  }
  if (typeof cell === 'number') {
    // Excel serial date (days since 1899-12-30). Only treat plausible serials as dates.
    if (cell > 20000 && cell < 80000) {
      const ms = Math.round((cell - 25569) * 86400 * 1000);
      const d = new Date(ms);
      return isNaN(d.getTime()) ? null : isoDate(d);
    }
    return null;
  }
  const s = String(cell).trim();
  // ISO-ish: 2026-05-01
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // UK: 01/05/2026 or 1-5-26
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return `${year}-${pad(mon)}-${pad(day)}`;
  }
  return null;
}

/**
 * Parse a numeric data cell. Strips £ $ , and % decoration. For percentage
 * metrics a 0–1 fraction is scaled to 0–100. Returns null for blank / non-numeric
 * (so no fabricated value is ever emitted).
 */
export function parseCellValue(cell: unknown, valueType: string): number | null {
  if (cell == null || cell === '') return null;
  let n: number;
  if (typeof cell === 'number') {
    n = cell;
  } else {
    const cleaned = String(cell).replace(/[£$,%\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
    if (cleaned === '' || cleaned === '-') return null;
    n = Number(cleaned);
  }
  if (!Number.isFinite(n)) return null;
  if (valueType === 'percentage' && n > 0 && n <= 1) n = n * 100; // fraction → percent
  return n;
}

function pad(v: string | number): string { return String(v).padStart(2, '0'); }
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export interface ParsedEntry {
  spaceKey: string;
  metricKey: string;
  reportDate: string; // YYYY-MM-DD
  value: number;
}

export interface ParseResult {
  entries: ParsedEntry[];
  /** Dates discovered in the header row (ISO), in column order. */
  datesDetected: string[];
  /** Row labels that could not be mapped to a metric (with the active space). */
  unmapped: Array<{ label: string; spaceKey: string | null }>;
  /** Human-readable diagnostics (e.g. no date header found). */
  warnings: string[];
}

export interface ParseOptions {
  /**
   * Force every row to a single space (single-team sheet). When set, section
   * detection is bypassed and all labels resolve against this space's label map.
   */
  spaceKey?: string;
}

/**
 * Parse one sheet's 2-D grid into clean-sheet manual entries.
 *
 * Algorithm:
 *  1. Find the header row = the row with the most date-parseable cells; record
 *     each dated column → ISO date.
 *  2. Walk rows after the header. A row whose first cell matches a team section
 *     (and has no data) sets the active space (unless opts.spaceKey forces one).
 *  3. Each data row's label is mapped to a metric within the active space; for
 *     every dated column with a numeric value, emit a (space, metric, date) entry.
 */
export function parseDailyKpiTracker(grid: unknown[][], opts: ParseOptions = {}): ParseResult {
  const result: ParseResult = { entries: [], datesDetected: [], unmapped: [], warnings: [] };
  if (!Array.isArray(grid) || grid.length === 0) {
    result.warnings.push('Empty sheet.');
    return result;
  }

  // 1. Locate the date header row.
  let headerRowIdx = -1;
  let bestDateCount = 0;
  const headerColDates: Map<number, string> = new Map();
  for (let r = 0; r < Math.min(grid.length, 40); r++) {
    const row = grid[r] ?? [];
    const found = new Map<number, string>();
    for (let c = 1; c < row.length; c++) {
      const iso = parseCellDate(row[c]);
      if (iso) found.set(c, iso);
    }
    if (found.size > bestDateCount) {
      bestDateCount = found.size;
      headerRowIdx = r;
      headerColDates.clear();
      for (const [c, d] of found) headerColDates.set(c, d);
    }
  }

  if (headerRowIdx === -1 || headerColDates.size === 0) {
    result.warnings.push('No date header row found — could not locate dated columns. Expected a row of working-day dates.');
    return result;
  }
  result.datesDetected = [...headerColDates.entries()].sort((a, b) => a[0] - b[0]).map(([, d]) => d);

  // 2/3. Walk data rows.
  const forced = opts.spaceKey ? opts.spaceKey.toUpperCase() : null;
  if (forced && !SPREADSHEET_LABELS[forced]) {
    result.warnings.push(`Unknown forced space "${forced}" — no label map; nothing will be mapped.`);
  }
  let activeSpace: string | null = forced;
  let activeIndex: Map<string, string> = forced ? labelIndexForSpace(forced) : new Map();
  const seen = new Set<string>(); // de-dupe (space|metric|date)

  for (let r = headerRowIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const label = String(row[0] ?? '').trim();
    if (!label) continue;

    // Section header? (only when not forced to a single space)
    if (!forced) {
      const hasData = [...headerColDates.keys()].some((c) => parseCellValue(row[c], 'decimal') !== null);
      const section = detectSection(label);
      if (section && !hasData) {
        activeSpace = section;
        activeIndex = labelIndexForSpace(section);
        continue;
      }
    }

    const space = forced ?? activeSpace;
    if (!space) {
      result.unmapped.push({ label, spaceKey: null });
      continue;
    }

    const metricKey = activeIndex.get(normaliseLabel(label));
    if (!metricKey) {
      result.unmapped.push({ label, spaceKey: space });
      continue;
    }
    const valueType = inferValueType(space, metricKey);
    for (const [c, iso] of headerColDates) {
      const v = parseCellValue(row[c], valueType);
      if (v === null) continue;
      const dk = `${space}|${metricKey}|${iso}`;
      if (seen.has(dk)) continue;
      seen.add(dk);
      result.entries.push({ spaceKey: space, metricKey, reportDate: iso, value: v });
    }
  }

  return result;
}

/**
 * Best-effort value_type for a (space, metric) from the metric key shape so the
 * parser can scale percentages. The authoritative value_type still lives in
 * kpi_metric_definitions and is re-validated at save time by KpiManualService.
 */
function inferValueType(_spaceKey: string, metricKey: string): string {
  if (/_value$/.test(metricKey)) return 'currency';
  if (/%|_pct$|_rate$|_compliance$|contact$|amends$|scheduled|proof|reviews_30d|reviews_60d|qad|caught|built/.test(metricKey)) return 'percentage';
  return 'integer';
}
