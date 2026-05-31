/**
 * KPI Recovery — AI Digest Generation + Store (P5-WP1)
 *
 * Phase 5 of the clean-sheet KPI system. Everything here is NEW and runs in
 * parallel with the untouched legacy KPI system. It builds on the live Phase 1
 * foundation (KpiEngine), the Phase 2 EOD service (frozen daily report), and the
 * Phase 3 views service (cross-space SLT summary), and adds:
 *
 *   1. A per-space daily AI digest (one row per captured space).
 *   2. A single cross-space SLT digest (space_key NULL).
 *
 * Both are stored in kpi_digests (created in Phase 1). Generation is idempotent
 * per (space_key, report_date, digest_type): re-running replaces that day's
 * digest, so the 17:45 scheduler, the catch-up, and a manual regenerate all
 * converge to one digest set.
 *
 * Honesty rules (programme constraint):
 *   - If no LLM provider is configured (or a call fails / is budget-suppressed),
 *     a DETERMINISTIC structured summary is stored instead — the digest is never
 *     faked as AI-authored. Each generate call reports how many were AI vs
 *     deterministic so the provenance is observable.
 *   - Only spaces with captured daily data get a digest; empty spaces are skipped
 *     and reported, never given an invented narrative.
 *
 * Source of truth: KPI-Clean-Sheet-Design.md §3.11, §5.2, §9.
 */
import { z } from 'zod';
import { query, execute } from '../database.js';
import type { KpiEodService, DailyReport, DailyReportSpace } from './kpi-eod.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict JSON shape the LLM must return (LlmService enforces JSON-only output). */
const DigestSchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()).optional(),
  concerns: z.array(z.string()).optional(),
});
type DigestPayload = z.infer<typeof DigestSchema>;

/** Minimal structural type for the LLM client (decoupled from llm-service import shape). */
export interface DigestLlm {
  call<T>(
    systemPrompt: string,
    userMessage: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    options: { callType: string; tier?: 'reasoning' | 'standard' | 'cheap'; maxTokens?: number; temperature?: number },
  ): Promise<{ data: T }>;
}

/** A stored digest row. */
export interface DigestRecord {
  id: number;
  spaceKey: string | null;
  reportDate: string;
  digestType: string;
  summary: string;
  generatedAt: string;
}

export interface DigestForDate {
  date: string;
  slt: DigestRecord | null;
  spaces: DigestRecord[];
}

export interface GenerateResult {
  date: string;
  spacesGenerated: number;
  sltGenerated: boolean;
  aiCount: number;
  fallbackCount: number;
  skipped: string[];
}

const SYSTEM_SPACE =
  'You are a concise operations analyst for a SaaS support organisation. Summarise one team\'s ' +
  'end-of-day KPI performance in 3–5 plain-English sentences. Be factual and specific: call out ' +
  'red and amber metrics by name, note notable volumes (queue, over-SLA, resolved), and avoid filler ' +
  'or praise. Do not invent numbers that are not in the data.';

const SYSTEM_SLT =
  'You are a concise operations analyst briefing the senior leadership team. Summarise cross-team ' +
  'KPI performance for the day in 4–6 plain-English sentences. Compare teams at a high level, surface ' +
  'the teams or metrics most at risk (reds/ambers, over-SLA), and keep it factual. Do not invent ' +
  'numbers that are not in the data.';

export class KpiDigestService {
  constructor(
    private readonly eod: KpiEodService,
    /** Optional LLM client. When absent, deterministic summaries are stored. */
    private llm: DigestLlm | null = null,
  ) {}

  /** Inject (or clear) the LLM client after construction. The clean-sheet
   *  foundation is wired before the shared LlmService exists, so index.ts calls
   *  this once the service is constructed. Null = deterministic digests. */
  setLlm(llm: DigestLlm | null): void {
    this.llm = llm;
  }

  /** Build a compact, model-friendly data block for one space's daily report. */
  private spaceContext(s: DailyReportSpace): string {
    const lines: string[] = [];
    lines.push(`Team: ${s.displayName} (${s.spaceKey}) — EOD ${s.eodTime} ${s.timezone}`);
    lines.push(`RAG across metrics: ${s.ragSummary.green} green, ${s.ragSummary.amber} amber, ${s.ragSummary.red} red, ${s.ragSummary.none} no-target`);
    lines.push(`Queue: ${s.eodSnapshot.totalTickets} open, ${s.eodSnapshot.overSla} over SLA`);
    const fmt = (m: DailyReportSpace['metrics'][number]) => {
      const tier = m.tierName ? ` [${m.tierName}]` : '';
      const tgt = m.target !== null ? ` (target ${m.target})` : '';
      const rag = m.rag ? ` ${m.rag.toUpperCase()}` : '';
      return `- ${m.displayName}${tier}: ${m.value}${tgt}${rag}`;
    };
    // Space-level metrics only in the narrative context (tiers add noise).
    const spaceLevel = s.metrics.filter((m) => !m.tierName);
    for (const m of spaceLevel) lines.push(fmt(m));
    return lines.join('\n');
  }

  /** Deterministic fallback summary for one space (used when no LLM is available). */
  private spaceFallback(s: DailyReportSpace): string {
    const reds = s.metrics.filter((m) => !m.tierName && m.rag === 'red').map((m) => m.displayName);
    const ambers = s.metrics.filter((m) => !m.tierName && m.rag === 'amber').map((m) => m.displayName);
    const parts: string[] = [];
    parts.push(
      `${s.displayName} (${s.spaceKey}) on ${''}EOD: ` +
      `${s.ragSummary.green} green / ${s.ragSummary.amber} amber / ${s.ragSummary.red} red across tracked metrics.`,
    );
    parts.push(`Queue ${s.eodSnapshot.totalTickets} open, ${s.eodSnapshot.overSla} over SLA.`);
    if (reds.length) parts.push(`Red: ${reds.join(', ')}.`);
    if (ambers.length) parts.push(`Amber: ${ambers.join(', ')}.`);
    if (!reds.length && !ambers.length) parts.push('No metrics in amber or red.');
    return parts.join(' ');
  }

  /** Compact cross-space context for the SLT digest. */
  private sltContext(report: DailyReport): string {
    const lines: string[] = [`Cross-team KPI summary for ${report.reportDate}.`];
    for (const s of report.spaces) {
      if (!s.captured) continue;
      lines.push(
        `${s.displayName} (${s.spaceKey}): ${s.ragSummary.red} red / ${s.ragSummary.amber} amber / ${s.ragSummary.green} green; ` +
        `queue ${s.eodSnapshot.totalTickets} (${s.eodSnapshot.overSla} over SLA).`,
      );
    }
    return lines.join('\n');
  }

  /** Deterministic fallback SLT summary. */
  private sltFallback(report: DailyReport): string {
    const captured = report.spaces.filter((s) => s.captured);
    const worst = [...captured].sort((a, b) => (b.ragSummary.red - a.ragSummary.red) || (b.eodSnapshot.overSla - a.eodSnapshot.overSla));
    const parts: string[] = [];
    parts.push(`SLT cross-team summary for ${report.reportDate}: ${captured.length} team(s) captured.`);
    const totalOver = captured.reduce((s, x) => s + x.eodSnapshot.overSla, 0);
    const totalOpen = captured.reduce((s, x) => s + x.eodSnapshot.totalTickets, 0);
    parts.push(`Combined queue ${totalOpen} open, ${totalOver} over SLA.`);
    const atRisk = worst.filter((s) => s.ragSummary.red > 0 || s.eodSnapshot.overSla > 0).slice(0, 3)
      .map((s) => `${s.displayName} (${s.ragSummary.red} red, ${s.eodSnapshot.overSla} over SLA)`);
    if (atRisk.length) parts.push(`Most at risk: ${atRisk.join('; ')}.`);
    else parts.push('No teams currently showing reds or SLA breaches.');
    return parts.join(' ');
  }

  /** Generate a digest text for a space — AI if available, deterministic otherwise. */
  private async generateSpaceText(s: DailyReportSpace): Promise<{ text: string; ai: boolean }> {
    const llm = this.llm;
    if (llm) {
      try {
        const res = await llm.call<DigestPayload>(SYSTEM_SPACE, this.spaceContext(s), DigestSchema, {
          callType: 'kpi_daily_digest', tier: 'standard', maxTokens: 600, temperature: 0.3,
        });
        return { text: this.renderPayload(res.data), ai: true };
      } catch (err) {
        console.warn(`[kpi-digest] AI space digest failed for ${s.spaceKey}, using deterministic fallback:`, err instanceof Error ? err.message : err);
      }
    }
    return { text: this.spaceFallback(s), ai: false };
  }

  private async generateSltText(report: DailyReport): Promise<{ text: string; ai: boolean }> {
    const llm = this.llm;
    if (llm) {
      try {
        const res = await llm.call<DigestPayload>(SYSTEM_SLT, this.sltContext(report), DigestSchema, {
          callType: 'kpi_daily_digest', tier: 'standard', maxTokens: 800, temperature: 0.3,
        });
        return { text: this.renderPayload(res.data), ai: true };
      } catch (err) {
        console.warn('[kpi-digest] AI SLT digest failed, using deterministic fallback:', err instanceof Error ? err.message : err);
      }
    }
    return { text: this.sltFallback(report), ai: false };
  }

  /** Render the structured LLM payload to a single text blob for storage. */
  private renderPayload(p: DigestPayload): string {
    let out = p.summary.trim();
    if (p.highlights && p.highlights.length) out += `\n\nHighlights:\n` + p.highlights.map((h) => `• ${h}`).join('\n');
    if (p.concerns && p.concerns.length) out += `\n\nConcerns:\n` + p.concerns.map((c) => `• ${c}`).join('\n');
    return out;
  }

  /** Upsert a digest row (idempotent per space_key/date/type; NULL space_key = SLT). */
  private async upsert(spaceKey: string | null, reportDate: string, digestType: string, summary: string): Promise<void> {
    if (spaceKey === null) {
      await execute(
        `DELETE FROM kpi_digests WHERE space_key IS NULL AND report_date = ? AND digest_type = ?`,
        [reportDate, digestType],
      );
    } else {
      await execute(
        `DELETE FROM kpi_digests WHERE space_key = ? AND report_date = ? AND digest_type = ?`,
        [spaceKey, reportDate, digestType],
      );
    }
    await execute(
      `INSERT INTO kpi_digests (space_key, report_date, digest_type, summary) VALUES (?, ?, ?, ?)`,
      [spaceKey, reportDate, digestType, summary],
    );
  }

  /**
   * Generate per-space digests + the cross-space SLT digest for a date and store
   * them in kpi_digests. Reads the FROZEN daily report (does not recompute), so a
   * digest reflects the captured EOD truth. Idempotent.
   */
  async generateForDate(reportDate: string, _opts: { force?: boolean } = {}): Promise<GenerateResult> {
    if (!DATE_RE.test(reportDate)) throw new Error('reportDate must be YYYY-MM-DD');
    const report = await this.eod.getDailyReport(reportDate);

    const result: GenerateResult = {
      date: reportDate, spacesGenerated: 0, sltGenerated: false,
      aiCount: 0, fallbackCount: 0, skipped: [],
    };

    const captured = report.spaces.filter((s) => s.captured);
    for (const s of captured) {
      const { text, ai } = await this.generateSpaceText(s);
      await this.upsert(s.spaceKey, reportDate, 'daily', text);
      result.spacesGenerated++;
      if (ai) result.aiCount++; else result.fallbackCount++;
    }
    for (const s of report.spaces) {
      if (!s.captured) result.skipped.push(`${s.spaceKey}:no-data`);
    }

    // Cross-space SLT digest only when at least one space has data.
    if (captured.length > 0) {
      const { text, ai } = await this.generateSltText(report);
      await this.upsert(null, reportDate, 'daily', text);
      result.sltGenerated = true;
      if (ai) result.aiCount++; else result.fallbackCount++;
    } else {
      result.skipped.push('SLT:no-data');
    }

    console.log(
      `[kpi-digest] generated ${reportDate} — ${result.spacesGenerated} space digest(s)` +
      `${result.sltGenerated ? ' + SLT' : ''} (${result.aiCount} AI, ${result.fallbackCount} deterministic).`,
    );
    return result;
  }

  /** Map a DB row to a DigestRecord. */
  private mapRow(r: { id: number; space_key: string | null; report_date: string | Date; digest_type: string; summary: string | null; generated_at: string | Date }): DigestRecord {
    return {
      id: r.id,
      spaceKey: r.space_key,
      reportDate: typeof r.report_date === 'string' ? r.report_date.slice(0, 10) : new Date(r.report_date).toISOString().slice(0, 10),
      digestType: r.digest_type,
      summary: r.summary ?? '',
      generatedAt: typeof r.generated_at === 'string' ? r.generated_at : new Date(r.generated_at).toISOString(),
    };
  }

  /** All digests for a date: the cross-space SLT digest + each per-space digest. */
  async getForDate(reportDate: string, digestType = 'daily'): Promise<DigestForDate> {
    if (!DATE_RE.test(reportDate)) throw new Error('reportDate must be YYYY-MM-DD');
    const rows = await query<{ id: number; space_key: string | null; report_date: string | Date; digest_type: string; summary: string | null; generated_at: string | Date }>(
      `SELECT id, space_key, report_date, digest_type, summary, generated_at
       FROM kpi_digests WHERE report_date = ? AND digest_type = ? ORDER BY space_key`,
      [reportDate, digestType],
    );
    const mapped = rows.map((r) => this.mapRow(r));
    const slt = mapped.find((m) => m.spaceKey === null) ?? null;
    const spaces = mapped.filter((m) => m.spaceKey !== null);
    return { date: reportDate, slt, spaces };
  }

  /** A single space digest (or the SLT digest when spaceKey is null). */
  async getOne(spaceKey: string | null, reportDate: string, digestType = 'daily'): Promise<DigestRecord | null> {
    if (!DATE_RE.test(reportDate)) throw new Error('reportDate must be YYYY-MM-DD');
    const rows = await query<{ id: number; space_key: string | null; report_date: string | Date; digest_type: string; summary: string | null; generated_at: string | Date }>(
      spaceKey === null
        ? `SELECT TOP 1 id, space_key, report_date, digest_type, summary, generated_at FROM kpi_digests WHERE space_key IS NULL AND report_date = ? AND digest_type = ?`
        : `SELECT TOP 1 id, space_key, report_date, digest_type, summary, generated_at FROM kpi_digests WHERE space_key = ? AND report_date = ? AND digest_type = ?`,
      spaceKey === null ? [reportDate, digestType] : [spaceKey, reportDate, digestType],
    );
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  /** Most recent date that has any digest (for the digest view default). */
  async latestDigestDate(): Promise<string | null> {
    const rows = await query<{ d: string | Date | null }>(`SELECT MAX(report_date) AS d FROM kpi_digests`);
    const d = rows[0]?.d;
    if (!d) return null;
    return typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
  }
}
