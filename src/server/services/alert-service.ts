import { query, executeAndGetId, execute } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type {
  AgentAlert,
  AlertType,
  AlertSeverity,
  QueueHealth,
} from './agent-types.js';

const ALERT_DEDUP_MINUTES = 30;

export class AlertService {
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  async processQueueHealth(health: QueueHealth): Promise<AgentAlert[]> {
    const alerts: AgentAlert[] = [];

    // SLA breach imminent — one alert per ticket
    for (const ticket of health.slaBreachImminent) {
      if (!ticket.assignee && ticket.minutesRemaining < 30) {
        const alert = await this.createAlert({
          alertType: 'sla_breach_imminent',
          severity: ticket.minutesRemaining < 15 ? 'critical' : 'warning',
          title: `SLA breach imminent: ${ticket.ticketKey} (${ticket.slaType}, ${ticket.minutesRemaining}m remaining)`,
          detail: `${ticket.summary} — ${ticket.slaType} SLA breaches at ${ticket.breachTime}. No agent assigned.`,
          ticketKey: ticket.ticketKey,
        });
        if (alert) alerts.push(alert);
      }
    }

    // Volume spike
    if (health.volumeSpike) {
      const vs = health.volumeSpike;
      const alert = await this.createAlert({
        alertType: 'volume_spike',
        severity: vs.sigmaAbove >= 3 ? 'critical' : 'warning',
        title: `Volume spike detected: ${vs.currentHourCount} open tickets (${vs.sigmaAbove.toFixed(1)}σ above average)`,
        detail: `Current: ${vs.currentHourCount}, Average for this time slot: ${vs.averageForSlot}, Std dev: ${vs.stdDevForSlot}`,
      });
      if (alert) alerts.push(alert);
    }

    // Capacity warning
    if (health.capacityWarning) {
      const cw = health.capacityWarning;
      const alert = await this.createAlert({
        alertType: 'capacity_low',
        severity: cw.ticketsPerAgent > cw.threshold * 1.5 ? 'critical' : 'warning',
        title: `Agent capacity low: ${cw.ticketsPerAgent.toFixed(1)} tickets per agent (threshold: ${cw.threshold})`,
        detail: `${cw.totalOpen} open tickets across ${cw.availableAgents} available agent(s).`,
      });
      if (alert) alerts.push(alert);
    }

    // Send Teams notifications for critical alerts
    const critical = alerts.filter(a => a.severity === 'critical');
    if (critical.length > 0) {
      await this.sendTeamsNotification(critical);
    }

    return alerts;
  }

  async createLoopHealthAlert(tickTimeMs: number): Promise<AgentAlert | null> {
    if (tickTimeMs <= 5 * 60 * 1000) return null;
    return this.createAlert({
      alertType: 'agent_loop_unhealthy',
      severity: 'critical',
      title: `Agent loop tick took ${Math.round(tickTimeMs / 1000)}s (threshold: 300s)`,
      detail: `The agent loop is running slowly. This may indicate API timeouts or database issues.`,
    });
  }

  async createAutonomyAlert(decision: { ticketKey: string; action: string; confidence: number; category: string }): Promise<AgentAlert | null> {
    return this.createAlert({
      alertType: 'autonomy_execution',
      severity: 'info',
      title: `Autonomous ${decision.action} on ${decision.ticketKey} (${decision.category}, conf: ${decision.confidence.toFixed(2)})`,
      ticketKey: decision.ticketKey,
    });
  }

  async createAlert(alert: Omit<AgentAlert, 'id' | 'acknowledged' | 'createdAt'>): Promise<AgentAlert | null> {
    // Dedup: skip if same type + ticket within dedup window
    const isDupe = await this.isDuplicate(alert.alertType, alert.ticketKey);
    if (isDupe) return null;

    const id = await executeAndGetId(
      `INSERT INTO agent_alerts (alert_type, severity, title, detail, ticket_key)
       VALUES (?, ?, ?, ?, ?)`,
      [
        alert.alertType,
        alert.severity,
        alert.title,
        alert.detail ?? null,
        alert.ticketKey ?? null,
      ],
    );

    return { id, ...alert, acknowledged: false };
  }

  private async isDuplicate(alertType: string, ticketKey?: string): Promise<boolean> {
    const rows = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM agent_alerts
       WHERE alert_type = ?
         ${ticketKey ? 'AND ticket_key = ?' : ''}
         AND created_at >= DATEADD(minute, -${ALERT_DEDUP_MINUTES}, GETUTCDATE())`,
      ticketKey ? [alertType, ticketKey] : [alertType],
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  private async sendTeamsNotification(alerts: AgentAlert[]): Promise<void> {
    const webhookUrl = this.settings.get('agent_teams_webhook_url');
    if (!webhookUrl) return;

    const lines = alerts.map(a => `- **[${a.severity.toUpperCase()}]** ${a.title}`).join('\n');
    const payload = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: 'FF0000',
      summary: `NOVA Agent: ${alerts.length} critical alert(s)`,
      sections: [{
        activityTitle: '🤖 NOVA AI Agent — Critical Alerts',
        text: lines,
      }],
    };

    try {
      const resp = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        console.warn(`[alert-service] Teams webhook failed: ${resp.status}`);
      }
    } catch (err) {
      console.warn('[alert-service] Teams webhook error:', err instanceof Error ? err.message : err);
    }
  }

  // ── Query methods for API ──

  async getAlerts(limit = 50, includeAcknowledged = false): Promise<AgentAlert[]> {
    const whereClause = includeAcknowledged ? '' : 'WHERE acknowledged = 0';
    const rows = await query<RawAlertRow>(
      `SELECT TOP(?) * FROM agent_alerts ${whereClause} ORDER BY created_at DESC`,
      [limit],
    );
    return rows.map(r => this.mapRow(r));
  }

  async getAlertsByType(alertType: string, limit = 20): Promise<AgentAlert[]> {
    const rows = await query<RawAlertRow>(
      `SELECT TOP(?) * FROM agent_alerts WHERE alert_type = ? ORDER BY created_at DESC`,
      [limit, alertType],
    );
    return rows.map(r => this.mapRow(r));
  }

  async acknowledgeAlert(id: number, username: string): Promise<boolean> {
    const rows = await query<{ id: number }>(
      `SELECT id FROM agent_alerts WHERE id = ?`, [id],
    );
    if (rows.length === 0) return false;
    await execute(
      `UPDATE agent_alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = GETUTCDATE()
       WHERE id = ?`,
      [username, id],
    );
    return true;
  }

  async acknowledgeAll(username: string): Promise<number> {
    const rows = await query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM agent_alerts WHERE acknowledged = 0`,
    );
    const count = rows[0]?.cnt ?? 0;
    if (count > 0) {
      await execute(
        `UPDATE agent_alerts SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = GETUTCDATE()
         WHERE acknowledged = 0`,
        [username],
      );
    }
    return count;
  }

  private mapRow(row: RawAlertRow): AgentAlert {
    return {
      id: row.id,
      alertType: row.alert_type as AlertType,
      severity: row.severity as AlertSeverity,
      title: row.title,
      detail: row.detail ?? undefined,
      ticketKey: row.ticket_key ?? undefined,
      acknowledged: !!row.acknowledged,
      acknowledgedBy: row.acknowledged_by ?? undefined,
      acknowledgedAt: row.acknowledged_at ?? undefined,
      createdAt: row.created_at,
    };
  }
}

interface RawAlertRow {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  detail: string | null;
  ticket_key: string | null;
  acknowledged: boolean | number;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  created_at: string;
}
