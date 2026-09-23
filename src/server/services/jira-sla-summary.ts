/**
 * Compact SLA/CSAT summaries lifted out of `fields_json` at sync time.
 *
 * `jira_issue_cache.fields_json` is the raw Jira payload: 581MB of LOB against 86MB in-row
 * across 13,771 rows. Seven query sites across kpi-pipeline.ts and kpi-agent/compute.ts used
 * to SELECT it over every open or resolved-today ticket, and each of those queries measured
 * 240-250s on 23 Sep 2026 against a database pegged at 100% data IO — two of them were
 * observed running concurrently, both still suspended on PAGEIOLATCH_SH five minutes in.
 * They are what timed the KPI screens out on the 30s request timeout.
 *
 * All seven wanted the same three scalars: the First Reply Time SLA (customfield_14046), the
 * Resolution SLA (customfield_14048) and the CSAT rating (customfield_12802). This module
 * reduces each SLA cycle object to four flags stored as ~40 bytes of JSON, so the same
 * questions are answered from in-row columns and the LOB is never touched.
 *
 * Two different breach semantics are in use and BOTH are preserved exactly:
 *
 *   - `slaBreachedFromSummary` reproduces kpi-agent/compute.ts `slaBreached()`, which matches
 *     Jira's `breached()` JQL when ongoingOnly is set: only the CURRENT cycle counts, so a
 *     cycle that breached months ago cannot resurrect as a phantom breach on a live board.
 *   - `anySlaBreachedFromSummary` reproduces kpi-pipeline.ts `isSlaBreached()`, which counts a
 *     breach in ANY completed cycle as well as the ongoing one.
 *
 * They disagree on real tickets, so collapsing them into one stored boolean would have
 * silently changed a published KPI. Hence four fields rather than one.
 */

/** Decoded summary. Fields are terse because this is stored per row. */
export interface SlaSummary {
  /** The SLA field was present on the issue at all. Distinguishes "not breached" from "unknown". */
  h: boolean;
  /**
   * Ongoing-cycle verdict: true/false when the current cycle gives an answer, null when it
   * does not (no ongoing cycle, or one carrying neither `breached` nor `remainingTime.millis`).
   */
  o: boolean | null;
  /** Last completed cycle's `breached`, or null when there are no completed cycles. */
  lc: boolean | null;
  /** Any completed cycle breached (by flag or by negative remaining time). */
  ac: boolean;
  /** Any ongoing cycle breached. Array-aware, unlike `o`. */
  ao: boolean;
}

const EMPTY: SlaSummary = { h: false, o: null, lc: null, ac: false, ao: false };

/** True when a cycle object is breached, by explicit flag or by negative remaining time. */
function cycleBreached(cycle: any): boolean {
  if (!cycle) return false;
  if (cycle.breached === true) return true;
  const millis = cycle.remainingTime?.millis;
  return millis != null && millis < 0;
}

/**
 * Reduce a raw Jira SLA field to its summary.
 *
 * Mirrors the original readers exactly, including their quirks: the ongoing verdict prefers
 * the `breached` flag, falls back to `remainingTime.millis`, and stays null when the cycle
 * offers neither — that null is what made the old `slaBreached()` fall through to the
 * completed cycles rather than answering "not breached".
 */
export function summariseSla(slaField: unknown): SlaSummary {
  if (!slaField) return EMPTY;

  // The two readers disagree on shape, and both are reproduced rather than reconciled.
  //
  // kpi-pipeline's reader tolerated an array of cycle objects; kpi-agent's did not — handed an
  // array it read `.ongoingCycle` off the array itself, got undefined, and fell through to
  // "unknown". Real Jira SLA fields are objects, so this only matters in principle, but `o`
  // and `lc` are therefore taken from the object form ALONE (both null for an array) while
  // `ac` and `ao` flatten. Collapsing the two views would change a published KPI on a shape
  // we have not proven absent.
  const isArray = Array.isArray(slaField);
  const cycles: any[] = isArray ? (slaField as any[]) : [slaField];

  let o: boolean | null = null;
  let lc: boolean | null = null;
  let ac = false;
  let ao = false;

  if (!isArray) {
    const oc = (slaField as any).ongoingCycle;
    if (oc) {
      if (oc.breached === true) o = true;
      else if (oc.remainingTime?.millis != null) o = oc.remainingTime.millis < 0;
    }
    const completed = (slaField as any).completedCycles;
    if (Array.isArray(completed) && completed.length) {
      const last = completed[completed.length - 1];
      if (last?.breached != null) lc = last.breached === true;
    }
  }

  for (const c of cycles) {
    if (!c) continue;
    if (cycleBreached(c.ongoingCycle)) ao = true;
    const completed = c.completedCycles;
    if (Array.isArray(completed)) {
      for (const cc of completed) if (cycleBreached(cc)) ac = true;
    }
  }

  return { h: true, o, lc, ac, ao };
}

/** Encode for storage. Returns null when the field was absent, so the column stays NULL. */
export function encodeSlaSummary(slaField: unknown): string | null {
  const s = summariseSla(slaField);
  if (!s.h) return null;
  return JSON.stringify(s);
}

/** Decode a stored summary. A NULL column and unparseable text both mean "unknown". */
export function decodeSlaSummary(stored: string | null | undefined): SlaSummary {
  if (!stored) return EMPTY;
  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return EMPTY;
    return {
      h: parsed.h === true,
      o: typeof parsed.o === 'boolean' ? parsed.o : null,
      lc: typeof parsed.lc === 'boolean' ? parsed.lc : null,
      ac: parsed.ac === true,
      ao: parsed.ao === true,
    };
  } catch {
    return EMPTY;
  }
}

/**
 * kpi-agent/compute.ts `slaBreached()` semantics.
 *
 * ongoingOnly=true matches Jira's `breached()` JQL: only the current cycle counts. Used for
 * the live "Over SLA" stock on open tickets. ongoingOnly=false keeps the completed-cycle
 * read for resolved tickets, where the final cycle is the answer.
 */
export function slaBreachedFromSummary(stored: string | null | undefined, ongoingOnly = false): boolean | null {
  const s = decodeSlaSummary(stored);
  if (!s.h) return null;
  if (s.o !== null) return s.o;
  if (ongoingOnly) return false;
  return s.lc;
}

/**
 * kpi-pipeline.ts `isSlaBreached()` semantics: a breach in any completed cycle, or in the
 * ongoing one, counts. Returns null only when the SLA field was absent.
 */
export function anySlaBreachedFromSummary(stored: string | null | undefined): boolean | null {
  const s = decodeSlaSummary(stored);
  if (!s.h) return null;
  return s.ac || s.ao;
}

/** CSAT rating (customfield_12802) constrained to Jira's 1-5 scale, or null. */
export function extractCsatRating(csatField: unknown): number | null {
  const rating = (csatField as any)?.rating;
  return typeof rating === 'number' && rating >= 1 && rating <= 5 ? rating : null;
}

/** Pull the CSAT rating straight out of a raw `fields_json` payload. Used by the backfill. */
export function csatFromFieldsJson(fieldsJson: string | null): number | null {
  if (!fieldsJson) return null;
  try {
    return extractCsatRating(JSON.parse(fieldsJson)?.customfield_12802);
  } catch {
    return null;
  }
}

/** Pull one SLA field out of a raw `fields_json` payload and summarise it. Used by the backfill. */
export function slaSummaryFromFieldsJson(fieldsJson: string | null, field: string): string | null {
  if (!fieldsJson) return null;
  try {
    return encodeSlaSummary(JSON.parse(fieldsJson)?.[field]);
  } catch {
    return null;
  }
}
