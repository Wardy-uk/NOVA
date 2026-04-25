import type { JiraRestClient } from './jira-client.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { ApprovalQueries } from '../db/queries.js';
import type { ExternalDbService } from './external-db.js';
import type { HybridActionMatch, HybridActionResult } from './agent-types.js';
import { executeAndGetId } from './database.js';
import { addBusinessHours, toSqliteDatetime } from '../utils/business-hours.js';

const WEBHOOK_URL = 'https://api-private.atlassian.com/automation/webhooks/jira/a/78b1ef43-90fa-4cc8-ba47-663b5b22883f/019b1736-31c0-700d-82da-8b51a90e2938';
const WEBHOOK_TOKEN = '6b97043e8f74e6b6e842da286de0e72501ab1ecc';

export class AbuseReportExecutor {
  private jiraClient: JiraRestClient;
  private settings: SettingsQueries;
  private approvalQueries: ApprovalQueries;
  private externalDb: ExternalDbService;
  private baseUrl: string;

  constructor(
    jiraClient: JiraRestClient,
    settings: SettingsQueries,
    approvalQueries: ApprovalQueries,
    externalDb: ExternalDbService,
  ) {
    this.jiraClient = jiraClient;
    this.settings = settings;
    this.approvalQueries = approvalQueries;
    this.externalDb = externalDb;
    this.baseUrl = settings.get('sso_base_url') ?? process.env.FRONTEND_URL ?? 'http://localhost:3001';
  }

  async executePhaseA(match: HybridActionMatch): Promise<HybridActionResult> {
    const { ticketKey, parsedData } = match;
    const contactId = parsedData.contactId as string;
    const instanceId = parsedData.instanceId as string;
    const instanceUrl = (parsedData.instanceUrl as string) ?? '';
    const abuseEmail = (parsedData.abuseEmail as string) ?? '';
    let logId: number | null = null;

    try {
      // 1. Insert log row into AbuseReportAutomationLog
      try {
        const pool = await this.externalDb.getAbuseReportPool();
        const summary = match.summary?.slice(0, 255) ?? '';
        const result = await pool.request()
          .input('TicketKey', ticketKey)
          .input('Summary', summary)
          .input('AbuseEmail', abuseEmail)
          .input('InstanceId', parseInt(instanceId, 10))
          .input('ContactId', parseInt(contactId, 10))
          .input('InstanceUrl', instanceUrl)
          .input('ProcessedBy', 'NOVA-Agent')
          .query(`INSERT INTO dbo.AbuseReportAutomationLog
                  (TicketKey, Summary, AbuseEmail, InstanceId, ContactId, InstanceUrl, ProcessedBy, LoggedAtUtc)
                  OUTPUT INSERTED.LogId
                  VALUES (@TicketKey, @Summary, @AbuseEmail, @InstanceId, @ContactId, @InstanceUrl, @ProcessedBy, GETUTCDATE())`);
        logId = result.recordset?.[0]?.LogId ?? null;
        console.log(`[abuse-report] Logged to AbuseReportAutomationLog (id=${logId}) for ${ticketKey}`);
      } catch (err) {
        console.error(`[abuse-report] Failed to insert abuse log for ${ticketKey}:`, err);
        return this.fail(ticketKey, 'Failed to log to AbuseReportAutomationLog', err);
      }

      // 2. Call stored procedure on Admin DB
      try {
        const adminPool = await this.externalDb.getAdminPool();
        await adminPool.request()
          .input('ContactID', parseInt(contactId, 10))
          .input('InstanceID', parseInt(instanceId, 10))
          .input('UserName', 'bym\\AbuseReport')
          .execute('dbo.ProcessAbuseReport');
        console.log(`[abuse-report] Stored procedure executed for ${ticketKey}`);
      } catch (err) {
        console.error(`[abuse-report] Stored procedure failed for ${ticketKey}:`, err);
        await this.updateExternalLog(logId, 'sql_error', err);
        return this.fail(ticketKey, 'ProcessAbuseReport stored procedure failed', err);
      }

      // 3. Update log: SqlProcessed=1
      await this.updateExternalLog(logId, 'sql_ok', null);

      // 4. Post internal note on Jira ticket
      const noteText = `Abuse report processed. Contact ${contactId} on instance ${instanceId} (${instanceUrl}) has been actioned. Email: ${abuseEmail}. Awaiting human review before closing.`;
      try {
        await this.jiraClient.addComment(ticketKey, noteText, { internal: true });
      } catch (err) {
        console.warn(`[abuse-report] Failed to post internal note on ${ticketKey}:`, err);
      }

      // 5. Submit to approval queue for human review
      const conversationJson = JSON.stringify({
        action_type: 'abuse_report',
        ticketKey,
        contactId,
        instanceId,
        instanceUrl,
        abuseEmail,
        externalLogId: logId,
      });

      const expiresAt = toSqliteDatetime(addBusinessHours(new Date(), 4));
      const approvalId = await this.approvalQueries.create({
        ticket_id: ticketKey,
        ticket_summary: `Abuse Report — Contact ${contactId}, Instance ${instanceId}`,
        reporter_name: abuseEmail || undefined,
        ai_response_adf: noteText,
        conversation_json: conversationJson,
        resume_url: `${this.baseUrl}/api/public/agent/approval-callback?ticketKey=${encodeURIComponent(ticketKey)}`,
        priority: 'High',
        expires_at: expiresAt,
        action_type: 'abuse_report',
      });

      // 6. Log to hybrid_action_log
      await executeAndGetId(
        `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, detail, approval_id)
         VALUES ('abuse_report', ?, 'awaiting_approval', ?, ?)`,
        [ticketKey, `Phase A complete. Contact=${contactId}, Instance=${instanceId}. Awaiting human approval.`, approvalId],
      );

      console.log(`[abuse-report] Phase A complete for ${ticketKey}, approval #${approvalId}`);
      return {
        success: true,
        actionId: 'abuse_report',
        ticketKey,
        detail: `Phase A complete — abuse processed, awaiting human approval (#${approvalId})`,
        approvalId,
      };
    } catch (err) {
      return this.fail(ticketKey, 'Unexpected error in Phase A', err);
    }
  }

  async executePhaseB(approvalId: number, action: string, decidedBy: string): Promise<void> {
    const approval = await this.approvalQueries.getById(approvalId);
    if (!approval) {
      console.warn(`[abuse-report] Phase B: approval #${approvalId} not found`);
      return;
    }

    let data: Record<string, string>;
    try {
      data = JSON.parse(approval.conversation_json ?? '{}');
    } catch {
      console.error(`[abuse-report] Phase B: invalid conversation_json for approval #${approvalId}`);
      return;
    }

    const ticketKey = data.ticketKey || approval.ticket_id;
    const abuseEmail = data.abuseEmail || '';
    const externalLogId = data.externalLogId ? parseInt(data.externalLogId, 10) : null;

    if (action === 'approve' || action === 'approved') {
      // Fire Jira Automation webhook
      try {
        const webhookUrl = `${WEBHOOK_URL}?issue=${encodeURIComponent(ticketKey)}`;
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Automation-Webhook-Token': WEBHOOK_TOKEN,
          },
          body: JSON.stringify({
            CustomerEmailAddress: abuseEmail,
            TicketKey: ticketKey,
          }),
        });
        console.log(`[abuse-report] Webhook fired for ${ticketKey}: HTTP ${resp.status}`);

        // Update external log
        await this.updateExternalLogDone(externalLogId, resp.status);

        // Update hybrid_action_log
        await executeAndGetId(
          `UPDATE hybrid_action_log SET status = 'completed', detail = ?
           WHERE action_id = 'abuse_report' AND source_ticket_key = ? AND approval_id = ?`,
          [`Phase B complete. Webhook HTTP ${resp.status}. Approved by ${decidedBy}.`, ticketKey, approvalId],
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[abuse-report] Webhook failed for ${ticketKey}:`, msg);
        await this.updateExternalLogDone(externalLogId, 0, msg);
      }
    } else {
      // Declined
      try {
        await this.jiraClient.addComment(
          ticketKey,
          `Abuse report closure declined by ${decidedBy}.`,
          { internal: true },
        );
      } catch (err) {
        console.warn(`[abuse-report] Failed to post decline note on ${ticketKey}:`, err);
      }

      await executeAndGetId(
        `UPDATE hybrid_action_log SET status = 'declined', detail = ?
         WHERE action_id = 'abuse_report' AND source_ticket_key = ? AND approval_id = ?`,
        [`Declined by ${decidedBy}.`, ticketKey, approvalId],
      );

      console.log(`[abuse-report] Phase B: declined for ${ticketKey} by ${decidedBy}`);
    }
  }

  private async updateExternalLog(logId: number | null, stage: string, err: unknown): Promise<void> {
    if (!logId) return;
    try {
      const pool = await this.externalDb.getAbuseReportPool();
      await pool.request()
        .input('LogId', logId)
        .input('SqlProcessed', stage === 'sql_ok' ? 1 : 0)
        .input('ErrorStage', stage)
        .input('ErrorMessage', err ? (err instanceof Error ? err.message : String(err)) : null)
        .query(`UPDATE dbo.AbuseReportAutomationLog
                SET SqlProcessed = @SqlProcessed, ErrorStage = @ErrorStage, ErrorMessage = @ErrorMessage
                WHERE LogId = @LogId`);
    } catch (e) {
      console.warn(`[abuse-report] Failed to update external log ${logId}:`, e);
    }
  }

  private async updateExternalLogDone(logId: number | null, httpStatus: number, error?: string): Promise<void> {
    if (!logId) return;
    try {
      const pool = await this.externalDb.getAbuseReportPool();
      await pool.request()
        .input('LogId', logId)
        .input('JiraWebhookOk', httpStatus >= 200 && httpStatus < 300 ? 1 : 0)
        .input('JiraHttpStatus', httpStatus)
        .input('ErrorStage', error ? 'webhook_error' : 'done')
        .input('ErrorMessage', error ?? null)
        .query(`UPDATE dbo.AbuseReportAutomationLog
                SET JiraWebhookOk = @JiraWebhookOk, JiraHttpStatus = @JiraHttpStatus,
                    ErrorStage = @ErrorStage, ErrorMessage = @ErrorMessage
                WHERE LogId = @LogId`);
    } catch (e) {
      console.warn(`[abuse-report] Failed to update external log done ${logId}:`, e);
    }
  }

  private fail(ticketKey: string, detail: string, err: unknown): HybridActionResult {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      executeAndGetId(
        `INSERT INTO hybrid_action_log (action_id, source_ticket_key, status, detail)
         VALUES ('abuse_report', ?, 'failed', ?)`,
        [ticketKey, `${detail}: ${msg}`],
      ).catch(() => {});
    } catch { /* best effort */ }
    return { success: false, actionId: 'abuse_report', ticketKey, detail, error: msg };
  }
}
