import type { McpClientManager } from './mcp-client.js';
import type { DeliveryQueries, DeliveryEntry } from '../db/queries.js';

// SharePoint location for the delivery sheet
const SP_SITE_PATH = 'sites/Nurtur';
const SP_FILE_PATH = 'Clients/Tech/!Overview Documents/Delivery sheet Master.xlsx';

// Product sheets to sync (must match delivery.ts PRODUCT_SHEETS)
const PRODUCT_SHEETS = [
  'BYM', 'KYM', 'Yomdel', 'Leadpro', 'TPJ', 'Voice AI',
  'GRS', 'Undeliverable',
  'SB - Web', 'SB - DM', 'Google Ad Spend', 'Google SEO',
  'Guild Package',
];

export interface SyncResult {
  direction: 'pull' | 'push';
  sheetsProcessed: number;
  entriesCreated: number;
  entriesUpdated: number;
  entriesSkipped: number;
  errors: string[];
  timestamp: string;
}

/**
 * SharePoint delivery sheet sync service.
 * Manual-only — no automatic scheduling.
 *
 * Uses the ms-365-mcp-server's file tools via MCP to read/write
 * the delivery xlsx on SharePoint.
 */
export class SharePointSync {
  private _lastResult: SyncResult | null = null;
  private _lastAttempt: string | null = null;

  constructor(
    private mcp: McpClientManager,
    private deliveryQueries: DeliveryQueries,
  ) {}

  /** Diagnostic info for the debug screen */
  getDebugInfo() {
    const registered = this.mcp.isRegistered('msgraph');
    const connected = registered ? this.mcp.isConnected('msgraph') : false;
    const allTools = registered ? this.mcp.getServerTools('msgraph') : [];
    const spTools = this.getAvailableTools();
    return {
      registered,
      connected,
      available: this.isAvailable(),
      allMsgraphTools: allTools,
      spRelevantTools: spTools,
      sitePath: SP_SITE_PATH,
      filePath: SP_FILE_PATH,
      productSheets: PRODUCT_SHEETS,
      lastAttempt: this._lastAttempt,
      lastResult: this._lastResult,
    };
  }

  /** Check if the msgraph MCP server is connected and has file tools */
  isAvailable(): boolean {
    if (!this.mcp.isConnected('msgraph')) return false;
    const tools = this.mcp.getServerTools('msgraph');
    return tools.some((t) => t.includes('drive') || t.includes('file') || t.includes('sharepoint'));
  }

  getAvailableTools(): string[] {
    return this.mcp.getServerTools('msgraph').filter(
      (t) => t.includes('drive') || t.includes('file') || t.includes('sharepoint') || t.includes('site')
    );
  }

  /**
   * Pull: Download xlsx from SharePoint, parse it, and upsert into local DB.
   * Only creates new entries for rows not already tracked locally.
   */
  async pull(): Promise<SyncResult> {
    this._lastAttempt = new Date().toISOString();
    const result: SyncResult = {
      direction: 'pull',
      sheetsProcessed: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesSkipped: 0,
      errors: [],
      timestamp: new Date().toISOString(),
    };

    if (!this.isAvailable()) {
      result.errors.push('Microsoft 365 MCP server not connected or missing file tools');
      this._lastResult = result;
      return result;
    }

    try {
      // Step 1: Find the SharePoint site
      const tools = this.getAvailableTools();
      const allTools = this.mcp.getServerTools('msgraph');
      console.log('[SP-Sync] ALL msgraph tools:', allTools.join(', '));
      console.log('[SP-Sync] Available file/SP tools:', tools.join(', '));

      // Try to get the site drive and locate the file
      let siteInfo: unknown;
      try {
        siteInfo = await this.mcp.callTool('msgraph', 'get-sharepoint-site-by-path', {
          sitePath: SP_SITE_PATH,
        });
        console.log('[SP-Sync] Found SharePoint site');
      } catch (err) {
        // Fall back to search
        try {
          siteInfo = await this.mcp.callTool('msgraph', 'search-sharepoint-sites', {
            query: 'Nurtur',
          });
          console.log('[SP-Sync] Found site via search');
        } catch {
          result.errors.push(`Cannot find SharePoint site: ${err instanceof Error ? err.message : String(err)}`);
          return result;
        }
      }

      // Step 2: List drives on the site to find "Documents"
      const siteText = this.extractText(siteInfo);
      console.log('[SP-Sync] Site info raw text:', siteText.slice(0, 1000));
      const siteId = this.extractSiteId(siteInfo);
      if (!siteId) {
        result.errors.push('Could not determine SharePoint site ID from response');
        return result;
      }
      console.log('[SP-Sync] Site ID:', siteId);

      let driveId: string | null = null;
      try {
        const drivesResp = await this.mcp.callTool('msgraph', 'list-sharepoint-site-drives', {
          siteId,
        });
        driveId = this.extractDriveId(drivesResp);
      } catch (err) {
        result.errors.push(`Cannot list site drives: ${err instanceof Error ? err.message : String(err)}`);
        return result;
      }

      if (!driveId) {
        result.errors.push('Could not find Documents drive on SharePoint site');
        return result;
      }
      console.log('[SP-Sync] Drive ID:', driveId);

      // Step 3: Download the file
      let fileContent: string | null = null;
      try {
        const downloadResp = await this.mcp.callTool('msgraph', 'download-onedrive-file-content', {
          driveId,
          filePath: SP_FILE_PATH,
        });
        fileContent = this.extractFileContent(downloadResp);
      } catch (err) {
        result.errors.push(`Cannot download file: ${err instanceof Error ? err.message : String(err)}`);
        return result;
      }

      if (!fileContent) {
        result.errors.push('Downloaded file content is empty');
        return result;
      }

      // Step 4: Parse the xlsx using the xlsx library
      const XLSX = (await import('xlsx')).default;
      const buf = Buffer.from(fileContent, 'base64');
      const wb = XLSX.read(buf);
      console.log('[SP-Sync] Parsed workbook with', wb.SheetNames.length, 'sheets');

      // Step 5: Process each product sheet
      for (const sheetName of PRODUCT_SHEETS) {
        const ws = wb.Sheets[sheetName];
        if (!ws) continue;

        const rows = this.parseSheetRows(XLSX, ws);
        if (rows.length === 0) continue;

        result.sheetsProcessed++;

        for (const row of rows) {
          if (!row.account) continue;

          const existing = this.deliveryQueries.findByProductAccount(sheetName, row.account);
          if (existing) {
            result.entriesSkipped++;
            continue;
          }

          // Create new DB entry from SharePoint data
          this.deliveryQueries.create({
            product: sheetName,
            account: row.account,
            status: row.status || 'Not Started',
            onboarder: row.onboarder || null,
            order_date: row.orderDate || null,
            go_live_date: row.goLiveDate || null,
            predicted_delivery: row.predictedDelivery || null,
            training_date: null,
            branches: row.branches ?? null,
            mrr: row.mrr ?? null,
            incremental: row.incremental ?? null,
            licence_fee: row.licenceFee ?? null,
            is_starred: 0,
            star_scope: 'me',
            starred_by: null,
            notes: row.notes || null,
          });
          result.entriesCreated++;
        }
      }

      console.log(
        `[SP-Sync] Pull complete: ${result.sheetsProcessed} sheets, ` +
        `${result.entriesCreated} created, ${result.entriesSkipped} skipped`
      );
    } catch (err) {
      result.errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._lastResult = result;
    return result;
  }

  /**
   * Push: Not yet implemented — would write local DB changes back to the SharePoint xlsx.
   * Requires careful cell-level updates to avoid overwriting other users' changes.
   */
  async push(): Promise<SyncResult> {
    return {
      direction: 'push',
      sheetsProcessed: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesSkipped: 0,
      errors: ['Push to SharePoint is not yet implemented. Pull-only for now.'],
      timestamp: new Date().toISOString(),
    };
  }

  // --- Helpers ---

  private extractSiteId(response: unknown): string | null {
    const text = this.extractText(response);
    // Try to find a site ID pattern (guid format)
    const guidMatch = text.match(/(?:siteId|id)["']?\s*[:=]\s*["']?([a-f0-9-]{36})/i);
    if (guidMatch) return guidMatch[1];
    // Try comma-separated site ID format
    const commaMatch = text.match(/([a-f0-9-]{36},[a-f0-9-]{36},[a-f0-9-]{36})/);
    if (commaMatch) return commaMatch[1];
    // Fallback: any GUID-like string
    const anyGuid = text.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/);
    return anyGuid ? anyGuid[0] : null;
  }

  private extractDriveId(response: unknown): string | null {
    const text = this.extractText(response);
    // Look for drive ID (typically starts with b!)
    const driveMatch = text.match(/(?:driveId|id)["']?\s*[:=]\s*["']?(b![^\s"',]+)/i);
    if (driveMatch) return driveMatch[1];
    // Fallback: any b! string
    const bMatch = text.match(/b![a-zA-Z0-9_-]+/);
    return bMatch ? bMatch[0] : null;
  }

  private extractFileContent(response: unknown): string | null {
    const text = this.extractText(response);
    // The MCP server likely returns base64-encoded content
    // Try to find a base64 block
    const b64Match = text.match(/(?:content|data|base64)["']?\s*[:=]\s*["']?([A-Za-z0-9+/=]{100,})/);
    if (b64Match) return b64Match[1];
    // If the whole response looks like base64
    if (/^[A-Za-z0-9+/=\s]{100,}$/.test(text.trim())) return text.trim();
    return text.length > 100 ? text : null;
  }

  private extractText(response: unknown): string {
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object') {
      const r = response as Record<string, unknown>;
      if (r.content && Array.isArray(r.content)) {
        return r.content
          .map((c: { text?: string; type?: string }) => c.text ?? '')
          .join('\n');
      }
      return JSON.stringify(response);
    }
    return String(response);
  }

  private parseSheetRows(XLSX: typeof import('xlsx'), ws: import('xlsx').WorkSheet): Array<{
    account: string;
    status: string;
    onboarder: string | null;
    orderDate: string | null;
    goLiveDate: string | null;
    predictedDelivery: string | null;
    branches: number | null;
    mrr: number | null;
    incremental: number | null;
    licenceFee: number | null;
    notes: string | null;
  }> {
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    const str = (val: unknown) => String(val ?? '').trim();

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < Math.min(5, raw.length); i++) {
      const row = raw[i];
      if (!row) continue;
      const joined = row.map((c) => str(c).toLowerCase()).join('|');
      if (joined.includes('account') || joined.includes('customer') || joined.includes('onboarder')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) return [];

    const headerRow = Array.from({ length: raw[headerIdx].length }, (_, i) => str(raw[headerIdx][i]));
    const findCol = (...names: string[]) => {
      const lower = names.map((n) => n.toLowerCase());
      return headerRow.findIndex((h) => lower.some((n) => h.toLowerCase().includes(n)));
    };

    const colAccount = findCol('account', 'customer');
    const colStatus = findCol('status');
    const colOnboarder = findCol('onboarder', 'pm');
    const colOrder = findCol('order received', 'order date');
    const colGoLive = findCol('mrr go live', 'go live');
    const colPredicted = findCol('predicted delivery', 'predicted');
    const colBranches = findCol('branch no', 'branches');
    const colMrr = findCol('mrr');
    const colIncr = findCol('incr', 'adhoc', 'set up fee');
    const colLicence = findCol('licence fee', 'monthly licence');
    const colNotes = findCol('notes', 'status detail');

    const excelDateToStr = (val: unknown): string | null => {
      if (!val) return null;
      if (typeof val === 'string') return val;
      if (typeof val === 'number') {
        try {
          const d = XLSX.SSF.parse_date_code(val);
          return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
        } catch { return String(val); }
      }
      return null;
    };

    const rows = [];
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const r = raw[i];
      if (!r || r.length === 0) continue;
      const account = colAccount >= 0 ? str(r[colAccount]) : '';
      if (!account || account.toLowerCase() === 'totals') continue;

      rows.push({
        account,
        status: colStatus >= 0 ? str(r[colStatus]) : '',
        onboarder: colOnboarder >= 0 ? str(r[colOnboarder]) || null : null,
        orderDate: colOrder >= 0 ? excelDateToStr(r[colOrder]) : null,
        goLiveDate: colGoLive >= 0 ? excelDateToStr(r[colGoLive]) : null,
        predictedDelivery: colPredicted >= 0 ? excelDateToStr(r[colPredicted]) : null,
        branches: colBranches >= 0 && r[colBranches] != null ? Number(r[colBranches]) || null : null,
        mrr: colMrr >= 0 && r[colMrr] != null ? Number(r[colMrr]) || null : null,
        incremental: colIncr >= 0 && r[colIncr] != null ? Number(r[colIncr]) || null : null,
        licenceFee: colLicence >= 0 && r[colLicence] != null ? Number(r[colLicence]) || null : null,
        notes: colNotes >= 0 ? str(r[colNotes]) || null : null,
      });
    }
    return rows;
  }
}
