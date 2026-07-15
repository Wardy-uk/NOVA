import { createHash } from 'crypto';
import { query, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import { SeverityBatchSchema, type SeverityBatch } from './severity-schema.js';

// Assesses the BUSINESS SEVERITY / blast radius of an open ticket's underlying
// fault — how bad the broken thing is and how widely it hits — independent of
// how upset the customer is. A portal feed dropping listings outranks a button
// showing the wrong colour. Results are cached per ticket (one LLM call only
// when the ticket text changes) and read by the risk scorer as a weighted factor.

const SYSTEM_PROMPT = `You are a triage lead at Nurtur, a UK proptech SaaS company serving estate & letting agents.
Our products: estate-agency WEBSITES, property PORTAL FEEDS (Rightmove, Zoopla, OnTheMarket), a CRM / marketing platform (BriefYourMarket), lead capture, and reporting.

For each support ticket, rate the BUSINESS SEVERITY of the underlying fault — how damaging the broken thing is, combined with its BLAST RADIUS (how much/how many it affects). Judge the fault itself, NOT the customer's tone.

Severity levels:
- "critical": revenue/lead loss or data integrity at scale — e.g. portal feed down or dropping properties, website offline, all/most listings missing, lead capture broken, data loss/leak, a whole client or many clients affected.
- "high": a core function broken for one client or a significant subset — e.g. some properties not feeding, a key page/form broken, reporting wrong, one client's site degraded.
- "medium": a non-core feature broken or a workaround exists — e.g. a single listing wrong, minor function fault, one user affected.
- "low": cosmetic or trivial — wrong colour, typo, alignment, wording, "how do I" questions, enhancement requests.

Weigh SCOPE heavily: "all properties" or "all clients" pushes severity up; "one property" or "one user" pulls it down. If scope is unclear, judge by the fault's worst plausible reasonable impact but don't over-inflate.

Return JSON only: { "results": [{ "issueKey": "NT-123", "severity": "critical|high|medium|low", "impactScore": 0-100, "rationale": "one short sentence: the fault and its scope" }] }
impactScore is your 0–100 confidence-weighted business impact (critical ~80-100, high ~55-79, medium ~25-54, low ~0-24).`;

interface OpenTicketRow {
  issue_key: string;
  summary: string | null;
  description_text: string | null;
  content_hash: string | null;
}

export class SeverityClassifier {
  constructor(
    private settings: SettingsQueries,
    private llmService: LlmService,
  ) {}

  private isEnabled(): boolean {
    const val = this.settings.get('severity_classifier_enabled');
    return val === undefined || val === null || val === '' ? true : val === 'true';
  }

  private hashContent(summary: string | null, description: string | null): string {
    return createHash('sha256').update(`${summary ?? ''}\n${description ?? ''}`).digest('hex').slice(0, 16);
  }

  /** Classify open tickets whose text changed since last run. Returns count classified. */
  async runSeveritySweep(projects: string[]): Promise<{ classified: number; skipped: number }> {
    if (!this.isEnabled() || !this.llmService || projects.length === 0) return { classified: 0, skipped: 0 };

    const projectPlaceholders = projects.map(() => '?').join(',');
    // Join to existing severity rows so we can skip tickets whose text is unchanged.
    const rows = await query<OpenTicketRow>(
      `SELECT j.issue_key, j.summary, j.description_text, s.content_hash
       FROM jira_issue_cache j
       LEFT JOIN ticket_severity s ON s.ticket_key = j.issue_key
       WHERE j.project_key IN (${projectPlaceholders}) AND j.status_category != 'done'`,
      projects,
    );

    const stale: OpenTicketRow[] = [];
    for (const r of rows) {
      const hash = this.hashContent(r.summary, r.description_text);
      if (r.content_hash !== hash) stale.push(r);
    }
    const skipped = rows.length - stale.length;
    if (stale.length === 0) return { classified: 0, skipped };

    // Cap per run to bound LLM cost; the rest are picked up next cycle.
    const maxPerRun = parseInt(this.settings.get('severity_classifier_max_per_run') || '', 10) || 60;
    const toProcess = stale.slice(0, maxPerRun);

    let classified = 0;
    const batchSize = 10;
    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);
      const userMessage = batch
        .map(t => `--- ${t.issue_key} ---\nSummary: ${t.summary ?? '(none)'}\nDetail: ${(t.description_text ?? '').slice(0, 1500)}`)
        .join('\n\n');

      let result;
      try {
        result = await this.llmService.call<SeverityBatch>(
          SYSTEM_PROMPT,
          userMessage,
          SeverityBatchSchema,
          { temperature: 0.2, callType: 'severity_classification' },
        );
      } catch (err) {
        console.warn('[severity] LLM batch failed:', err instanceof Error ? err.message : err);
        continue;
      }

      const byKey = new Map(batch.map(t => [t.issue_key, t]));
      for (const entry of result.data.results) {
        const src = byKey.get(entry.issueKey);
        if (!src) continue;
        const impact = Math.max(0, Math.min(100, Math.round(entry.impactScore || 0)));
        const rationale = (entry.rationale ?? '').slice(0, 500);
        const hash = this.hashContent(src.summary, src.description_text);
        // Upsert (delete + insert keeps it simple and idempotent under sql.js/MSSQL).
        await execute(`DELETE FROM ticket_severity WHERE ticket_key = ?`, [entry.issueKey]);
        await execute(
          `INSERT INTO ticket_severity (ticket_key, severity, impact_score, rationale, content_hash, computed_at)
           VALUES (?, ?, ?, ?, ?, GETUTCDATE())`,
          [entry.issueKey, entry.severity, impact, rationale, hash],
        );
        classified++;
      }
    }

    console.log(`[severity] Classified ${classified} ticket(s), skipped ${skipped} unchanged`);
    return { classified, skipped };
  }
}
