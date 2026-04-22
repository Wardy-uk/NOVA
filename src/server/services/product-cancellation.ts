import type { SettingsQueries } from '../db/settings-store.js';
import type { JiraRestClient } from './jira-client.js';
import { execute, query } from './database.js';

interface CancellationRecord {
  accountId: string;
  accountName: string;
  productName: string;
  cancellationDate: string;
  reason: string;
  requestedBy: string;
}

export class ProductCancellationService {
  constructor(
    private settings: SettingsQueries,
    private jiraClient: JiraRestClient,
  ) {}

  async checkForCancellations(): Promise<{ processed: number; ticketsCreated: string[] }> {
    const d365Url = this.settings.get('d365_url');
    const d365Token = this.settings.get('d365_access_token');
    if (!d365Url || !d365Token) {
      console.log('[product-cancellation] Skipping — D365 not configured');
      return { processed: 0, ticketsCreated: [] };
    }

    try {
      const cancellations = await this.fetchPendingCancellations(d365Url, d365Token);
      console.log(`[product-cancellation] Found ${cancellations.length} pending cancellations`);

      const ticketsCreated: string[] = [];

      for (const c of cancellations) {
        const alreadyProcessed = await query(
          `SELECT 1 FROM product_cancellation_log WHERE d365_account_id = ? AND product_name = ? AND created_at >= DATEADD(day, -7, GETUTCDATE())`,
          [c.accountId, c.productName]
        );
        if (alreadyProcessed.length > 0) continue;

        const project = this.settings.get('cancellation_jira_project') ?? 'NT';
        const result = await this.jiraClient.createIssue({
          fields: {
            project: { key: project },
            summary: `Product Cancellation: ${c.accountName} — ${c.productName}`,
            description: `**Account:** ${c.accountName}\n**Product:** ${c.productName}\n**Cancellation Date:** ${c.cancellationDate}\n**Reason:** ${c.reason}\n**Requested By:** ${c.requestedBy}\n\n_Auto-created by NOVA from D365 cancellation trigger._`,
            issuetype: { name: 'Task' },
          },
        });

        if (result?.key) {
          ticketsCreated.push(result.key);
          await execute(
            `INSERT INTO product_cancellation_log (d365_account_id, account_name, product_name, jira_key, created_at) VALUES (?, ?, ?, ?, GETUTCDATE())`,
            [c.accountId, c.accountName, c.productName, result.key]
          );
        }
      }

      console.log(`[product-cancellation] Created ${ticketsCreated.length} Jira tickets`);
      return { processed: cancellations.length, ticketsCreated };
    } catch (err) {
      console.error('[product-cancellation] Failed:', err instanceof Error ? err.message : err);
      throw err;
    }
  }

  private async fetchPendingCancellations(baseUrl: string, token: string): Promise<CancellationRecord[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const url = `${baseUrl}/api/data/v9.2/cancellationrequests?$filter=createdon ge ${sevenDaysAgo} and statecode eq 0&$top=50`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`D365 API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return (data.value ?? []).map((r: any) => ({
      accountId: r._accountid_value ?? '',
      accountName: r.accountname ?? 'Unknown',
      productName: r.productname ?? 'Unknown',
      cancellationDate: r.cancellationdate ?? '',
      reason: r.reason ?? '',
      requestedBy: r.requestedby ?? '',
    }));
  }
}
