import { z } from 'zod';
import { query, queryOne, executeAndGetId, execute } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';

export interface DetectedIncident {
  id: number;
  incident_key: string | null;
  summary: string;
  root_cause: string | null;
  ticket_count: number;
  ticket_keys: string[];
  status: string;
  detected_at: string;
}

interface TicketCluster {
  tickets: Array<{ key: string; summary: string; component: string | null; request_type: string | null; reporter_domain: string | null }>;
  similarity_reason: string;
}

const IncidentConfirmSchema = z.object({
  is_incident: z.boolean(),
  summary: z.string(),
  root_cause: z.string().nullable(),
  explanation: z.string(),
});

export class IncidentDetector {
  constructor(
    private llmService: LlmService,
    private settings: SettingsQueries,
    private jiraClient: JiraRestClient | null,
  ) {}

  async scan(): Promise<DetectedIncident[]> {
    const windowHours = parseInt(this.settings.get('agent_incident_window_hours') ?? '4', 10);
    const clusterThreshold = parseInt(this.settings.get('agent_incident_cluster_threshold') ?? '5', 10);

    const tickets = await query<{
      issue_key: string; summary: string; component: string | null;
      request_type: string | null; reporter_email: string | null;
      created_at: string;
    }>(
      `SELECT issue_key, summary, component, request_type, reporter_email, created_at
       FROM jira_issue_cache
       WHERE created_at >= DATEADD(hour, -?, GETUTCDATE())
       ORDER BY created_at DESC`,
      [windowHours],
    );

    if (tickets.length < clusterThreshold) return [];

    const enriched = tickets.map(t => ({
      key: t.issue_key,
      summary: t.summary ?? '',
      component: t.component,
      request_type: t.request_type,
      reporter_domain: t.reporter_email ? t.reporter_email.split('@')[1] ?? null : null,
    }));

    const clusters = this.findClusters(enriched, clusterThreshold);
    const confirmed: DetectedIncident[] = [];

    for (const cluster of clusters) {
      const existing = await this.isAlreadyDetected(cluster.tickets.map(t => t.key));
      if (existing) continue;

      const confirmation = await this.confirmWithLlm(cluster);
      if (!confirmation.is_incident) continue;

      const incidentKey = await this.createJiraProblem(confirmation.summary, cluster.tickets.map(t => t.key));

      const id = await executeAndGetId(
        `INSERT INTO agent_incidents (incident_key, summary, root_cause, ticket_count, ticket_keys, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [
          incidentKey,
          confirmation.summary,
          confirmation.root_cause,
          cluster.tickets.length,
          JSON.stringify(cluster.tickets.map(t => t.key)),
        ],
      );

      await this.postInternalNotes(cluster.tickets.map(t => t.key), confirmation.summary, incidentKey);
      await this.logAlert(confirmation.summary, cluster.tickets.length, incidentKey);

      confirmed.push({
        id,
        incident_key: incidentKey,
        summary: confirmation.summary,
        root_cause: confirmation.root_cause,
        ticket_count: cluster.tickets.length,
        ticket_keys: cluster.tickets.map(t => t.key),
        status: 'open',
        detected_at: new Date().toISOString(),
      });
    }

    return confirmed;
  }

  async getActiveIncidents(): Promise<DetectedIncident[]> {
    const rows = await query<{
      id: number; incident_key: string | null; summary: string; root_cause: string | null;
      ticket_count: number; ticket_keys: string; status: string; detected_at: string;
    }>(
      `SELECT id, incident_key, summary, root_cause, ticket_count, ticket_keys, status, detected_at
       FROM agent_incidents WHERE status IN ('open', 'investigating')
       ORDER BY detected_at DESC`,
    );
    return rows.map(r => ({
      ...r,
      ticket_keys: this.parseTicketKeys(r.ticket_keys),
    }));
  }

  async getRecentIncidents(days: number = 30): Promise<DetectedIncident[]> {
    const rows = await query<{
      id: number; incident_key: string | null; summary: string; root_cause: string | null;
      ticket_count: number; ticket_keys: string; status: string; detected_at: string;
    }>(
      `SELECT id, incident_key, summary, root_cause, ticket_count, ticket_keys, status, detected_at
       FROM agent_incidents WHERE detected_at >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY detected_at DESC`,
      [days],
    );
    return rows.map(r => ({
      ...r,
      ticket_keys: this.parseTicketKeys(r.ticket_keys),
    }));
  }

  async resolveIncident(id: number): Promise<void> {
    await execute(
      `UPDATE agent_incidents SET status = 'resolved', resolved_at = GETUTCDATE() WHERE id = ?`,
      [id],
    );
  }

  private findClusters(
    tickets: Array<{ key: string; summary: string; component: string | null; request_type: string | null; reporter_domain: string | null }>,
    threshold: number,
  ): TicketCluster[] {
    const clusters: TicketCluster[] = [];

    // Group by component + similar summary
    const componentGroups = new Map<string, typeof tickets>();
    for (const t of tickets) {
      const comp = t.component ?? 'none';
      if (!componentGroups.has(comp)) componentGroups.set(comp, []);
      componentGroups.get(comp)!.push(t);
    }

    for (const [comp, group] of componentGroups) {
      if (group.length >= threshold) {
        const subClusters = this.clusterBySimilarity(group, 0.3);
        for (const sub of subClusters) {
          if (sub.length >= threshold) {
            clusters.push({
              tickets: sub,
              similarity_reason: `same component (${comp}) + similar summaries`,
            });
          }
        }
      }
    }

    // Group by request_type + same reporter domain
    const rtDomainGroups = new Map<string, typeof tickets>();
    for (const t of tickets) {
      if (!t.request_type || !t.reporter_domain) continue;
      const key = `${t.request_type}|${t.reporter_domain}`;
      if (!rtDomainGroups.has(key)) rtDomainGroups.set(key, []);
      rtDomainGroups.get(key)!.push(t);
    }

    for (const [key, group] of rtDomainGroups) {
      if (group.length >= threshold) {
        const alreadyCovered = clusters.some(c =>
          group.every(g => c.tickets.some(ct => ct.key === g.key)));
        if (!alreadyCovered) {
          clusters.push({ tickets: group, similarity_reason: `same request type + domain (${key})` });
        }
      }
    }

    return clusters;
  }

  private clusterBySimilarity(
    tickets: Array<{ key: string; summary: string; component: string | null; request_type: string | null; reporter_domain: string | null }>,
    threshold: number,
  ): Array<typeof tickets> {
    const assigned = new Set<string>();
    const clusters: Array<typeof tickets> = [];

    for (let i = 0; i < tickets.length; i++) {
      if (assigned.has(tickets[i].key)) continue;
      const cluster = [tickets[i]];
      assigned.add(tickets[i].key);

      for (let j = i + 1; j < tickets.length; j++) {
        if (assigned.has(tickets[j].key)) continue;
        if (this.jaccardSimilarity(tickets[i].summary, tickets[j].summary) >= threshold) {
          cluster.push(tickets[j]);
          assigned.add(tickets[j].key);
        }
      }
      clusters.push(cluster);
    }
    return clusters;
  }

  private jaccardSimilarity(a: string, b: string): number {
    const tokenize = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
    const setA = tokenize(a);
    const setB = tokenize(b);
    if (setA.size === 0 && setB.size === 0) return 0;

    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private async confirmWithLlm(cluster: TicketCluster): Promise<
    z.infer<typeof IncidentConfirmSchema>
  > {
    const ticketList = cluster.tickets
      .map(t => `- ${t.key}: ${t.summary}`)
      .join('\n');

    const systemPrompt = `You are an incident detection system for an IT service desk.
Analyse the following cluster of tickets that arrived in a short time window.
Determine if they are reporting the same underlying issue (an incident).`;

    const userMessage = `These ${cluster.tickets.length} tickets arrived recently (${cluster.similarity_reason}):

${ticketList}

Are they reporting the same underlying issue?
If yes: provide a one-line incident summary and the likely root cause.
If no: explain why they are unrelated.`;

    const result = await this.llmService.call(
      systemPrompt,
      userMessage,
      IncidentConfirmSchema,
      { callType: 'incident_detection', tier: 'cheap', temperature: 0.1 },
    );

    return result.data;
  }

  private async createJiraProblem(summary: string, ticketKeys: string[]): Promise<string | null> {
    if (!this.jiraClient) return null;

    try {
      const project = this.settings.get('agent_jira_project') ?? 'NT';
      const problemTypeId = this.settings.get('jira_problem_issue_type_id');
      if (!problemTypeId) return null;

      const created = await this.jiraClient.createIssue({
        fields: {
          project: { key: project.split(',')[0].trim() },
          issuetype: { id: problemTypeId },
          summary: `[INCIDENT] ${summary}`,
          description: {
            type: 'doc', version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: `Auto-detected incident affecting ${ticketKeys.length} tickets: ${ticketKeys.join(', ')}` }],
            }],
          },
        },
      });

      for (const key of ticketKeys) {
        try {
          await this.jiraClient.createIssueLink({
            type: { name: 'Problem/Incident' },
            inwardIssue: { key: created.key },
            outwardIssue: { key },
          });
        } catch {}
      }

      return created.key;
    } catch (err) {
      console.warn('[incident-detector] Failed to create Jira problem:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  private async postInternalNotes(ticketKeys: string[], summary: string, incidentKey: string | null): Promise<void> {
    if (!this.jiraClient) return;
    const note = incidentKey
      ? `This ticket is part of incident ${incidentKey} — ${summary}`
      : `This ticket appears to be part of a detected incident — ${summary}`;

    for (const key of ticketKeys) {
      try {
        await this.jiraClient.addComment(key, note, { internal: true });
      } catch {}
    }
  }

  private async logAlert(summary: string, ticketCount: number, incidentKey: string | null): Promise<void> {
    await executeAndGetId(
      `INSERT INTO agent_alerts (alert_type, severity, title, detail, ticket_key)
       VALUES ('incident_detected', 'high', ?, ?, ?)`,
      [
        `Incident detected: ${summary}`,
        `${ticketCount} tickets clustered. Problem ticket: ${incidentKey ?? 'none'}`,
        incidentKey,
      ],
    );
  }

  private async isAlreadyDetected(ticketKeys: string[]): Promise<boolean> {
    const recent = await query<{ ticket_keys: string }>(
      `SELECT ticket_keys FROM agent_incidents
       WHERE detected_at >= DATEADD(hour, -24, GETUTCDATE()) AND status != 'resolved'`,
    );

    for (const row of recent) {
      const existing = this.parseTicketKeys(row.ticket_keys);
      const overlap = ticketKeys.filter(k => existing.includes(k));
      if (overlap.length >= ticketKeys.length * 0.5) return true;
    }
    return false;
  }

  private parseTicketKeys(json: string): string[] {
    try { return JSON.parse(json); } catch { return []; }
  }
}
