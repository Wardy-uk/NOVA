import { z } from 'zod';
import { query, execute, executeAndGetId } from './database.js';
import type { KbEmbedder } from './kb-embedder.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { flexString, flexNullableString } from './shared/flex-schemas.js';

// The KB gap REGISTER sits above kb_gap_log (the raw per-ticket log). Its job is to
// answer "which articles should we write next, and what goes in them" — which the log
// cannot, because the log holds one free-text title per ticket and 86% of its rows are
// a group of one.
//
// Two passes:
//   1. cluster — embed "category: title / reason" and greedily merge into topics, so
//      "How to Process a Product Cancellation Request" and "How to Process Product
//      Cancellations for Customers" become one row with the combined ticket count.
//   2. brief   — one LLM call per cluster over its member reasons and source tickets,
//      producing what a person actually needs: why the article is needed, who it's for,
//      and the sections it must contain.

// Cosine distributions differ sharply between embedding models, so one number is not
// portable: 0.86 on bge-base and 0.70 on text-embedding-3-small produce comparable
// clusterings, and using either value on the other model is badly wrong. Both were
// swept against the full open backlog — below these, distinct articles merge (the
// "Property of the Week editor" folds into "property images not displaying"); above
// them, one topic splits across several rows again.
const THRESHOLD_BGE = 0.86;
const THRESHOLD_OPENAI = 0.70;
const EMBED_BATCH = 200;

const BriefSchema = z.object({
  canonical_title: flexString,
  why_needed: flexString,
  audience: flexString,
  outline: z.array(z.object({
    heading: flexString,
    covers: flexNullableString,
  })),
});

export interface GapCluster {
  id: number;
  canonical_title: string;
  category: string | null;
  why_needed: string | null;
  outline_json: string | null;
  audience: string | null;
  brief_generated_at: string | null;
  member_count: number;
  status: string;
  assigned_to: string | null;
  jira_ticket_key: string | null;
  confluence_url: string | null;
  draft_id: number | null;
  first_seen: string | null;
  last_seen: string | null;
}

export class KbGapRegisterService {
  constructor(
    private embedder: KbEmbedder,
    private llm: LlmService,
    private settings: SettingsQueries,
  ) {}

  private threshold(): number {
    const raw = parseFloat(this.settings.get('kb_gap_cluster_threshold') || '');
    if (Number.isFinite(raw) && raw > 0 && raw < 1) return raw;
    return /bge|gte|minilm|e5/i.test(this.embedder.activeModel()) ? THRESHOLD_BGE : THRESHOLD_OPENAI;
  }

  /** Text we cluster on. The reason carries the substance — two tickets phrased
   *  differently but describing the same missing article agree here far more than
   *  their titles do. */
  private gapText(g: { category: string | null; suggested_title: string | null; reason: string | null }): string {
    return [g.category, g.suggested_title, g.reason].filter(Boolean).join(' — ').slice(0, 2000);
  }

  // ── Pass 1: embed ──

  /** Embed any open triage gap that has no vector yet (or was embedded with a
   *  different model). Returns how many were embedded. */
  async embedPending(limit = 2000): Promise<number> {
    const model = this.embedder.activeModel();
    const rows = await query<{ id: number; category: string | null; suggested_title: string | null; reason: string | null }>(
      `SELECT TOP (?) id, category, suggested_title, reason
       FROM kb_gap_log
       WHERE status = 'open'
         AND (embedding IS NULL OR embedding_model <> ?)
         AND suggested_title IS NOT NULL
       ORDER BY created_at DESC`,
      [limit, model],
    );
    if (rows.length === 0) return 0;

    let embedded = 0;
    for (let i = 0; i < rows.length; i += EMBED_BATCH) {
      const batch = rows.slice(i, i + EMBED_BATCH);
      const vectors = await this.embedder.embed(batch.map(r => this.gapText(r)));
      for (let j = 0; j < batch.length; j++) {
        await execute(
          `UPDATE kb_gap_log SET embedding = ?, embedding_model = ? WHERE id = ?`,
          [this.embedder.serializeEmbedding(vectors[j]), model, batch[j].id],
        );
        embedded++;
      }
      console.log(`[kb-gap-register] embedded ${embedded}/${rows.length}`);
    }
    return embedded;
  }

  // ── Pass 2: cluster ──

  /** Assign every embedded, unclustered open gap to a cluster — joining the nearest
   *  existing centroid above threshold, or starting a new cluster. Rebuilding from
   *  scratch (rebuild=true) drops existing clusters first; used when the threshold or
   *  embedding model changes. */
  async cluster(rebuild = false): Promise<{ clustered: number; created: number; joined: number }> {
    const model = this.embedder.activeModel();
    const threshold = this.threshold();

    if (rebuild) {
      await execute(`UPDATE kb_gap_log SET cluster_id = NULL`);
      // Keep clusters a human has acted on; those carry assignment, Jira links and
      // published articles that must not be thrown away by a re-cluster.
      await execute(`DELETE FROM kb_gap_clusters WHERE status = 'open' AND jira_ticket_key IS NULL AND draft_id IS NULL`);
      await execute(`UPDATE kb_gap_clusters SET centroid = NULL, member_count = 0`);
    }

    // Load surviving centroids into memory — a few hundred at most.
    const centroids = new Map<number, { vec: Float32Array; count: number }>();
    for (const c of await query<{ id: number; centroid: Buffer | null; member_count: number }>(
      `SELECT id, centroid, member_count FROM kb_gap_clusters WHERE centroid IS NOT NULL AND embedding_model = ?`,
      [model],
    )) {
      if (c.centroid) centroids.set(c.id, { vec: this.embedder.deserializeEmbedding(c.centroid), count: c.member_count });
    }

    const rows = await query<{ id: number; category: string | null; suggested_title: string | null; embedding: Buffer; created_at: string }>(
      `SELECT id, category, suggested_title, embedding, created_at
       FROM kb_gap_log
       WHERE status = 'open' AND cluster_id IS NULL AND embedding IS NOT NULL AND embedding_model = ?
       ORDER BY created_at ASC`,
      [model],
    );

    let created = 0, joined = 0;
    for (const row of rows) {
      const vec = this.embedder.deserializeEmbedding(row.embedding);

      let bestId = -1, bestSim = threshold;
      for (const [id, c] of centroids) {
        const sim = cosineSimilarity(vec, c.vec);
        if (sim >= bestSim) { bestSim = sim; bestId = id; }
      }

      if (bestId === -1) {
        const newId = await executeAndGetId(
          `INSERT INTO kb_gap_clusters (canonical_title, category, centroid, member_count, embedding_model, first_seen, last_seen)
           VALUES (?, ?, ?, 1, ?, ?, ?)`,
          [
            row.suggested_title || row.category || 'Untitled gap',
            row.category,
            this.embedder.serializeEmbedding(vec),
            model,
            row.created_at,
            row.created_at,
          ],
        );
        centroids.set(newId, { vec, count: 1 });
        await execute(`UPDATE kb_gap_log SET cluster_id = ? WHERE id = ?`, [newId, row.id]);
        created++;
      } else {
        // Incremental mean: centroid moves 1/(n+1) of the way toward the new member.
        const c = centroids.get(bestId)!;
        const next = new Float32Array(c.vec.length);
        for (let i = 0; i < c.vec.length; i++) next[i] = (c.vec[i] * c.count + vec[i]) / (c.count + 1);
        c.vec = next;
        c.count++;
        await execute(
          `UPDATE kb_gap_clusters
           SET centroid = ?, member_count = ?, last_seen = CASE WHEN last_seen IS NULL OR last_seen < ? THEN ? ELSE last_seen END,
               first_seen = CASE WHEN first_seen IS NULL OR first_seen > ? THEN ? ELSE first_seen END,
               updated_at = GETUTCDATE()
           WHERE id = ?`,
          [this.embedder.serializeEmbedding(next), c.count, row.created_at, row.created_at, row.created_at, row.created_at, bestId],
        );
        await execute(`UPDATE kb_gap_log SET cluster_id = ? WHERE id = ?`, [bestId, row.id]);
        joined++;
      }
    }

    // Clusters whose every member has since been drafted/dismissed shouldn't linger.
    await execute(
      `DELETE FROM kb_gap_clusters
       WHERE member_count = 0 AND status = 'open' AND jira_ticket_key IS NULL AND draft_id IS NULL`,
    );

    return { clustered: rows.length, created, joined };
  }

  // ── Pass 3: brief ──

  /** Write the brief for one cluster: what the article is, why it's needed, who for,
   *  and the sections it must contain — synthesised from every member's reason plus
   *  the real tickets behind them. */
  async generateBrief(clusterId: number): Promise<GapCluster> {
    const cluster = await this.getCluster(clusterId);
    if (!cluster) throw new Error(`Cluster ${clusterId} not found`);

    const members = await query<{ ticket_id: string; suggested_title: string | null; reason: string | null }>(
      `SELECT ticket_id, suggested_title, reason FROM kb_gap_log WHERE cluster_id = ? ORDER BY created_at DESC`,
      [clusterId],
    );
    if (members.length === 0) throw new Error(`Cluster ${clusterId} has no members`);

    const ticketKeys = [...new Set(members.map(m => m.ticket_id).filter(k => /^(NT|NTPJ)-\d+$/i.test(k)))].slice(0, 12);
    let ticketContext = '(no ticket detail available)';
    if (ticketKeys.length > 0) {
      // last_public_comment is the agent's actual answer to the customer — the closest
      // thing on the ticket to the steps the article needs to contain.
      const tickets = await query<{
        issue_key: string; summary: string; description: string | null;
        troubleshooting: string | null; answer: string | null; resolution_type: string | null;
      }>(
        `SELECT issue_key, summary,
                LEFT(description_text, 700)      AS description,
                LEFT(troubleshooting_text, 700)  AS troubleshooting,
                LEFT(last_public_comment, 900)   AS answer,
                resolution_type
         FROM jira_issue_cache WHERE issue_key IN (${ticketKeys.map(() => '?').join(',')})`,
        ticketKeys,
      );
      if (tickets.length > 0) {
        ticketContext = tickets.map(t => [
          `[${t.issue_key}] ${t.summary}`,
          `Problem: ${t.description || '(none)'}`,
          t.troubleshooting ? `Troubleshooting done: ${t.troubleshooting}` : null,
          `Answer given to customer: ${t.answer || '(not recorded)'}`,
          t.resolution_type ? `Resolution type: ${t.resolution_type}` : null,
        ].filter(Boolean).join('\n')).join('\n\n');
      }
    }

    const titles = [...new Set(members.map(m => m.suggested_title).filter(Boolean))].slice(0, 15);
    const reasons = [...new Set(members.map(m => m.reason).filter(Boolean))].slice(0, 15);

    const systemPrompt = `You write briefs that tell a support engineer which knowledge base article to write next and what to put in it.
You are given every ticket that hit the same missing article. Synthesise across them — do not describe one ticket.
Be concrete and specific to this organisation's systems. Never invent a process you cannot see evidence for in the tickets;
if the resolution steps are not recorded, say what the author will need to find out instead.`;

    const userMessage = `${members.length} support ticket${members.length === 1 ? '' : 's'} were triaged as needing the same missing KB article.

Category: ${cluster.category || '(none)'}

Titles the triage AI suggested across those tickets:
${titles.map(t => `- ${t}`).join('\n') || '(none)'}

Reasons it gave:
${reasons.map(r => `- ${r}`).join('\n') || '(none)'}

The underlying tickets:
${ticketContext}

Produce:
- canonical_title: one title covering all of the above. Concrete, specific, no vendor-neutral waffle.
- why_needed: 2-3 sentences making the business case — what recurring problem this solves, who is currently absorbing it, what changes once the article exists. Cite the ticket volume.
- audience: exactly one of "support agent", "customer", or "both".
- outline: the sections the article must contain. For each, a heading and what it must cover (specific steps, systems, fields, gotchas drawn from the tickets above). Between 3 and 8 sections.`;

    const result = await this.llm.call(
      systemPrompt,
      userMessage,
      BriefSchema,
      { callType: 'kb_gap_brief', tier: 'standard' },
    );

    const brief = result.data;
    await execute(
      `UPDATE kb_gap_clusters
       SET canonical_title = ?, why_needed = ?, audience = ?, outline_json = ?,
           brief_generated_at = GETUTCDATE(), updated_at = GETUTCDATE()
       WHERE id = ?`,
      [brief.canonical_title, brief.why_needed, brief.audience, JSON.stringify(brief.outline), clusterId],
    );

    return (await this.getCluster(clusterId))!;
  }

  /** Brief every open cluster that doesn't have one, biggest first. Bounded per run so
   *  a first pass over a 4,000-row backlog can't run away with the LLM budget. */
  async briefPending(limit = 25): Promise<{ briefed: number; failed: number }> {
    const pending = await query<{ id: number }>(
      `SELECT TOP (?) id FROM kb_gap_clusters
       WHERE status = 'open' AND brief_generated_at IS NULL AND member_count > 0
       ORDER BY member_count DESC`,
      [limit],
    );
    let briefed = 0, failed = 0;
    for (const c of pending) {
      try { await this.generateBrief(c.id); briefed++; }
      catch (err) {
        failed++;
        console.warn(`[kb-gap-register] brief failed for cluster ${c.id}:`, err instanceof Error ? err.message : err);
      }
    }
    return { briefed, failed };
  }

  // ── Reads ──

  async getCluster(id: number): Promise<GapCluster | null> {
    const rows = await query<GapCluster>(`SELECT * FROM kb_gap_clusters WHERE id = ?`, [id]);
    return rows[0] ?? null;
  }

  async listClusters(status = 'open', limit = 100): Promise<GapCluster[]> {
    return query<GapCluster>(
      `SELECT TOP (?) * FROM kb_gap_clusters WHERE status = ? ORDER BY member_count DESC, last_seen DESC`,
      [limit, status],
    );
  }

  async listMembers(clusterId: number): Promise<Array<{ id: number; ticket_id: string; suggested_title: string | null; reason: string | null; created_at: string }>> {
    return query(
      `SELECT id, ticket_id, suggested_title, reason, created_at
       FROM kb_gap_log WHERE cluster_id = ? ORDER BY created_at DESC`,
      [clusterId],
    );
  }

  async counts(): Promise<Record<string, number>> {
    const rows = await query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) AS cnt FROM kb_gap_clusters GROUP BY status`,
    );
    const counts: Record<string, number> = { open: 0, article_drafted: 0, article_published: 0, dismissed: 0 };
    for (const r of rows) counts[r.status] = r.cnt;
    return counts;
  }

  // ── Writes ──

  async setStatus(id: number, status: string): Promise<void> {
    await execute(`UPDATE kb_gap_clusters SET status = ?, updated_at = GETUTCDATE() WHERE id = ?`, [status, id]);
    // Members follow the cluster, so a dismissed topic can't resurface as loose rows.
    await execute(`UPDATE kb_gap_log SET status = ?, resolved_at = CASE WHEN ? IN ('article_published','dismissed') THEN GETUTCDATE() ELSE NULL END WHERE cluster_id = ?`, [status, status, id]);
  }

  async assign(id: number, assignedTo: string | null): Promise<void> {
    await execute(`UPDATE kb_gap_clusters SET assigned_to = ?, updated_at = GETUTCDATE() WHERE id = ?`, [assignedTo, id]);
  }

  async setJiraKey(id: number, key: string): Promise<void> {
    await execute(`UPDATE kb_gap_clusters SET jira_ticket_key = ?, updated_at = GETUTCDATE() WHERE id = ?`, [key, id]);
  }

  async setDraft(id: number, draftId: number): Promise<void> {
    await execute(
      `UPDATE kb_gap_clusters SET draft_id = ?, status = 'article_drafted', updated_at = GETUTCDATE() WHERE id = ?`,
      [draftId, id],
    );
    await execute(`UPDATE kb_gap_log SET status = 'article_drafted' WHERE cluster_id = ?`, [id]);
  }

  async setPublished(id: number, url: string): Promise<void> {
    await execute(
      `UPDATE kb_gap_clusters SET confluence_url = ?, status = 'article_published', updated_at = GETUTCDATE() WHERE id = ?`,
      [url, id],
    );
    await execute(
      `UPDATE kb_gap_log SET status = 'article_published', confluence_url = ?, resolved_at = GETUTCDATE() WHERE cluster_id = ?`,
      [url, id],
    );
  }

  /** Full refresh: embed → cluster → brief the top N. Safe to re-run; each pass only
   *  touches rows the previous runs haven't done. */
  async refresh(opts: { rebuild?: boolean; briefLimit?: number } = {}): Promise<{
    embedded: number; clustered: number; created: number; joined: number; briefed: number; failed: number;
  }> {
    const embedded = await this.embedPending();
    const { clustered, created, joined } = await this.cluster(opts.rebuild);
    const { briefed, failed } = await this.briefPending(opts.briefLimit ?? 25);
    return { embedded, clustered, created, joined, briefed, failed };
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
