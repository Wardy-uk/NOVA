import type { McpClientManager } from './mcp-client.js';
import type { DeliveryQueries, DeliveryEntry } from '../db/queries.js';

// SharePoint location defaults (overridden by settings)
const DEFAULT_SITE_URL = 'nurturcloud.sharepoint.com:/sites/Nurtur:';
const DEFAULT_DRIVE_HINT = 'Documents';
const DEFAULT_FOLDER_PATH = 'Clients/Tech/!Overview Documents';
const DEFAULT_FILE_NAME = 'Delivery sheet Master.xlsx';

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
    private getSettings?: () => Record<string, string>,
  ) {}

  /** Get SP config from settings, falling back to defaults */
  private getSpConfig() {
    const s = this.getSettings?.() ?? {};
    const siteUrl = s.sp_site_url || DEFAULT_SITE_URL;
    const driveHint = s.sp_drive_hint || DEFAULT_DRIVE_HINT;
    const folderPath = (s.sp_folder_path || DEFAULT_FOLDER_PATH).split('/').filter(Boolean);
    const fileName = s.sp_file_name || DEFAULT_FILE_NAME;
    return { siteUrl, driveHint, folderPath, fileName };
  }

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
      ...this.getSpConfig(),
      folderPath: this.getSpConfig().folderPath.join('/'),
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
   *
   * Flow: list-drives → list-folder-files (navigate folder tree) → download-onedrive-file-content
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

    const { siteUrl, driveHint, folderPath, fileName } = this.getSpConfig();

    try {
      // Step 1: List SharePoint site drives (not personal OneDrive)
      console.log('[SP-Sync] Listing site drives for:', siteUrl);
      const drivesResp = await this.mcp.callTool('msgraph', 'list-sharepoint-site-drives', { siteId: siteUrl });
      const drivesText = this.extractText(drivesResp);
      console.log('[SP-Sync] Site drives response (first 2000):', drivesText.slice(0, 2000));

      const driveId = this.findDriveByHint(drivesText, driveHint);
      if (!driveId) {
        result.errors.push(`Could not find a drive matching "${driveHint}" in SharePoint site drives. Available drives: ${drivesText.slice(0, 800)}`);
        this._lastResult = result;
        return result;
      }
      console.log('[SP-Sync] Using drive ID:', driveId);

      // Step 2: Navigate folder tree to find the xlsx file
      // Start from root, traverse folder path one level at a time
      let currentFolderId = 'root'; // Start at drive root
      for (const folderName of folderPath) {
        console.log(`[SP-Sync] Listing folder: ${folderName} (parent: ${currentFolderId})`);
        const folderResp = await this.mcp.callTool('msgraph', 'list-folder-files', {
          driveId,
          driveItemId: currentFolderId,
        });
        const folderText = this.extractText(folderResp);
        console.log(`[SP-Sync] Folder listing response (first 1500):`, folderText.slice(0, 1500));
        const folderId = this.findItemIdByName(folderText, folderName);
        console.log(`[SP-Sync] findItemIdByName("${folderName}") => ${folderId}`);
        if (!folderId) {
          result.errors.push(`Could not find folder "${folderName}" in drive navigation. Response: ${folderText.slice(0, 500)}`);
          this._lastResult = result;
          return result;
        }
        currentFolderId = folderId;
      }

      // Now list the final folder to find the xlsx file
      console.log(`[SP-Sync] Listing final folder for ${fileName} (folder: ${currentFolderId})...`);
      const finalResp = await this.mcp.callTool('msgraph', 'list-folder-files', {
        driveId,
        driveItemId: currentFolderId,
      });
      const finalText = this.extractText(finalResp);
      console.log(`[SP-Sync] Final folder listing (first 2000):`, finalText.slice(0, 2000));
      const fileItemId = this.findItemIdByName(finalText, fileName);
      console.log(`[SP-Sync] findItemIdByName("${fileName}") => ${fileItemId}`);
      if (!fileItemId) {
        result.errors.push(`Could not find "${fileName}" in the target folder. Contents: ${finalText.slice(0, 500)}`);
        this._lastResult = result;
        return result;
      }
      console.log('[SP-Sync] File driveItemId:', fileItemId);

      // Step 3: Download the file by driveItemId
      console.log('[SP-Sync] Downloading file...');
      const downloadResp = await this.mcp.callTool('msgraph', 'download-onedrive-file-content', {
        driveId,
        driveItemId: fileItemId,
      });
      const rawDownload = this.extractText(downloadResp);
      console.log(`[SP-Sync] Download response length: ${rawDownload.length}, first 200:`, rawDownload.slice(0, 200));
      const fileContent = this.extractFileContent(downloadResp);
      console.log(`[SP-Sync] Extracted file content length: ${fileContent?.length ?? 0}`);
      if (!fileContent) {
        result.errors.push(`Downloaded file content is empty. Raw response (first 500): ${rawDownload.slice(0, 500)}`);
        this._lastResult = result;
        return result;
      }

      // Step 4: Parse the xlsx
      const XLSX = (await import('xlsx')).default;
      const buf = Buffer.from(fileContent, 'base64');
      console.log(`[SP-Sync] Base64 decoded to ${buf.length} bytes`);
      const wb = XLSX.read(buf);
      console.log('[SP-Sync] Parsed workbook with', wb.SheetNames.length, 'sheets:', wb.SheetNames.join(', '));

      // Step 5: Process each product sheet
      console.log(`[SP-Sync] Looking for product sheets: ${PRODUCT_SHEETS.join(', ')}`);
      console.log(`[SP-Sync] Workbook sheet names: ${wb.SheetNames.join(', ')}`);
      for (const sheetName of PRODUCT_SHEETS) {
        const ws = wb.Sheets[sheetName];
        if (!ws) {
          console.log(`[SP-Sync] Sheet "${sheetName}" not found in workbook`);
          continue;
        }

        const rows = this.parseSheetRows(XLSX, ws);
        console.log(`[SP-Sync] Sheet "${sheetName}": ${rows.length} parseable rows`);
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
            sale_type: null,
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
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error('[SP-Sync] Pull failed with exception:', msg);
      result.errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._lastResult = result;
    return result;
  }

  /**
   * Push: Build xlsx from local DB entries and upload to SharePoint,
   * replacing the existing file. Uses the same drive/folder navigation as pull().
   *
   * Flow: list-drives → navigate folders → upload-file-content
   */
  async push(): Promise<SyncResult> {
    this._lastAttempt = new Date().toISOString();
    const result: SyncResult = {
      direction: 'push',
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

    const { siteUrl, driveHint, folderPath, fileName } = this.getSpConfig();

    try {
      // Step 1: Locate the SP site drive and target folder (same as pull)
      console.log('[SP-Push] Listing site drives for:', siteUrl);
      const drivesResp = await this.mcp.callTool('msgraph', 'list-sharepoint-site-drives', { siteId: siteUrl });
      const drivesText = this.extractText(drivesResp);
      console.log('[SP-Push] Site drives response (first 2000):', drivesText.slice(0, 2000));
      const driveId = this.findDriveByHint(drivesText, driveHint);
      if (!driveId) {
        result.errors.push(`Could not find a drive matching "${driveHint}" in SharePoint site drives. Available drives: ${drivesText.slice(0, 800)}`);
        this._lastResult = result;
        return result;
      }
      console.log('[SP-Push] Using drive ID:', driveId);

      // Navigate to the target folder
      let currentFolderId = 'root';
      for (const folderName of folderPath) {
        const folderResp = await this.mcp.callTool('msgraph', 'list-folder-files', {
          driveId,
          driveItemId: currentFolderId,
        });
        const folderText = this.extractText(folderResp);
        const folderId = this.findItemIdByName(folderText, folderName);
        if (!folderId) {
          result.errors.push(`Could not find folder "${folderName}" in drive navigation`);
          this._lastResult = result;
          return result;
        }
        currentFolderId = folderId;
      }

      // Step 2: Build the xlsx workbook from DB entries
      const XLSX = (await import('xlsx')).default;
      const wb = XLSX.utils.book_new();

      const headers = [
        'Onboarder', 'Account', 'Order Received', 'MRR Go Live',
        'Predicted Delivery', 'Status', 'Branch No.', 'MRR',
        'Incr/Adhoc/Set Up Fee', 'Monthly Licence Fee', 'Notes',
      ];

      for (const sheetName of PRODUCT_SHEETS) {
        const entries = this.deliveryQueries.getAll(sheetName);
        if (entries.length === 0) continue;

        const rows: unknown[][] = [headers];
        for (const e of entries) {
          rows.push([
            e.onboarder ?? '',
            e.account,
            e.order_date ?? '',
            e.go_live_date ?? '',
            e.predicted_delivery ?? '',
            e.status,
            e.branches ?? '',
            e.mrr ?? '',
            e.incremental ?? '',
            e.licence_fee ?? '',
            e.notes ?? '',
          ]);
          result.entriesUpdated++;
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        result.sheetsProcessed++;
      }

      if (result.sheetsProcessed === 0) {
        result.errors.push('No DB entries to push — all product sheets are empty');
        this._lastResult = result;
        return result;
      }

      // Step 3: Write workbook to base64
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
      const base64Content = buf.toString('base64');
      console.log(`[SP-Push] Built xlsx: ${result.sheetsProcessed} sheets, ${result.entriesUpdated} entries, ${(buf.length / 1024).toFixed(1)}KB`);

      // Step 4: Upload to SharePoint (overwrite the existing file)
      console.log('[SP-Push] Uploading to SharePoint...');
      await this.mcp.callTool('msgraph', 'upload-file-content', {
        driveId,
        parentDriveItemId: currentFolderId,
        fileName,
        content: base64Content,
      });

      console.log('[SP-Push] Push complete');
    } catch (err) {
      result.errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._lastResult = result;
    return result;
  }

  // --- Helpers ---

  /**
   * Find a drive ID from list-drives output by matching the drive name hint.
   * MCP responses are text — we parse structured patterns or JSON fragments.
   */
  private findDriveByHint(text: string, hint?: string): string | null {
    const driveHint = hint || this.getSpConfig().driveHint;
    // Strategy 1: Try JSON parse if the response is structured
    try {
      const parsed = JSON.parse(text);
      const drives = Array.isArray(parsed) ? parsed : parsed?.value ?? parsed?.drives ?? [];
      if (Array.isArray(drives)) {
        for (const d of drives) {
          const name = d.name ?? d.displayName ?? '';
          if (name.toLowerCase().includes(driveHint.toLowerCase())) {
            return d.id ?? null;
          }
        }
        // If no match by hint, return first drive with a "Documents" or "Shared" name
        for (const d of drives) {
          const name = (d.name ?? d.displayName ?? '').toLowerCase();
          if (name.includes('document') || name.includes('shared')) return d.id ?? null;
        }
        // Last resort: first drive
        if (drives.length > 0 && drives[0].id) return drives[0].id;
      }
    } catch {
      // Not pure JSON — fall through to regex
    }

    // Strategy 2: Look for drive entries in semi-structured text
    // Match patterns like: name: "Nurtur..." ... id: "b!xxx" or id: b!xxx
    const lowerText = text.toLowerCase();
    const hintIdx = lowerText.indexOf(driveHint.toLowerCase());
    if (hintIdx >= 0) {
      // Search for a drive ID (b!...) near the hint
      const nearby = text.substring(Math.max(0, hintIdx - 500), hintIdx + 500);
      const idMatch = nearby.match(/(?:id|driveId)["':\s]+["']?(b![^\s"',}]+)/i);
      if (idMatch) return idMatch[1];
    }

    // Fallback: any b! drive ID in the text
    const bMatch = text.match(/b![a-zA-Z0-9_-]+/);
    return bMatch ? bMatch[0] : null;
  }

  /**
   * Find a drive item ID by name from a list-folder-files response.
   * Handles both JSON and text MCP response formats.
   */
  private findItemIdByName(text: string, targetName: string): string | null {
    const lowerTarget = targetName.toLowerCase();

    // Strategy 1: JSON parse
    try {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed?.value ?? parsed?.items ?? parsed?.children ?? [];
      if (Array.isArray(items)) {
        for (const item of items) {
          const name = (item.name ?? '').toLowerCase();
          if (name === lowerTarget) return item.id ?? null;
        }
      }
    } catch {
      // Not pure JSON
    }

    // Strategy 2: regex — look for the target name near an id field
    // Pattern: name followed by id (or vice versa) within a reasonable distance
    const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Try: "name": "Target" ... "id": "xxx"
    const nameFirstRe = new RegExp(
      `["']?name["']?\\s*[:=]\\s*["']?${escapedName}["']?[\\s\\S]{0,300}?["']?id["']?\\s*[:=]\\s*["']?([^"',\\s}]+)`,
      'i'
    );
    const m1 = text.match(nameFirstRe);
    if (m1) return m1[1];

    // Try: "id": "xxx" ... "name": "Target"
    const idFirstRe = new RegExp(
      `["']?id["']?\\s*[:=]\\s*["']?([^"',\\s}]+)["']?[\\s\\S]{0,300}?["']?name["']?\\s*[:=]\\s*["']?${escapedName}["']?`,
      'i'
    );
    const m2 = text.match(idFirstRe);
    if (m2) return m2[1];

    // Strategy 3: line-based — look for target name in text, grab nearby ID-like value
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(lowerTarget)) {
        // Check surrounding lines for an ID
        const window = lines.slice(Math.max(0, i - 3), i + 4).join(' ');
        const idMatch = window.match(/["']?id["']?\s*[:=]\s*["']?([a-zA-Z0-9!_-]{8,})["']?/i);
        if (idMatch) return idMatch[1];
      }
    }

    return null;
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
