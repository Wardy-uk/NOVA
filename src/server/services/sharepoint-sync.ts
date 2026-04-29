import type { MsGraphClient } from './msgraph-client.js';
import type { DeliveryQueries } from '../db/queries.js';

const DEFAULT_SITE_ID = 'nurturcloud.sharepoint.com:/sites/Nurtur';
const DEFAULT_DRIVE_HINT = 'Documents';
const DEFAULT_FOLDER_PATH = 'Clients/Tech/!Overview Documents';
const DEFAULT_FILE_NAME = 'Delivery sheet Master.xlsx';

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
  logs: string[];
  timestamp: string;
}

export class SharePointSync {
  private _lastResult: SyncResult | null = null;
  private _lastAttempt: string | null = null;
  private _running: 'pull' | 'push' | false = false;

  constructor(
    private graph: MsGraphClient,
    private deliveryQueries: DeliveryQueries,
    private getSettings?: () => Record<string, string>,
  ) {}

  private getSpConfig() {
    const s = this.getSettings?.() ?? {};
    const siteId = s.sp_site_url || DEFAULT_SITE_ID;
    const driveHint = s.sp_drive_hint || DEFAULT_DRIVE_HINT;
    const folderPath = (s.sp_folder_path || DEFAULT_FOLDER_PATH).split('/').filter(Boolean);
    const fileName = s.sp_file_name || DEFAULT_FILE_NAME;
    return { siteId, driveHint, folderPath, fileName };
  }

  get running() { return this._running; }

  getDebugInfo() {
    const graphStatus = this.graph.getStatus();
    return {
      registered: true,
      connected: graphStatus.status === 'connected',
      available: true,
      graphStatus: graphStatus.status,
      graphError: graphStatus.lastError,
      running: this._running,
      ...this.getSpConfig(),
      folderPath: this.getSpConfig().folderPath.join('/'),
      productSheets: PRODUCT_SHEETS,
      lastAttempt: this._lastAttempt,
      lastResult: this._lastResult,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  getAvailableTools(): string[] {
    return ['graph:listDrives', 'graph:listChildren', 'graph:download', 'graph:upload'];
  }

  private async findDrive(siteId: string, hint: string, log: (msg: string) => void): Promise<string | null> {
    const drives = await this.graph.listSiteDrives(siteId);
    log(`Found ${drives.length} drives: ${drives.map(d => d.name).join(', ')}`);
    const match = drives.find(d => d.name.toLowerCase().includes(hint.toLowerCase()));
    if (match) return match.id;
    const docDrive = drives.find(d => d.name.toLowerCase().includes('document') || d.name.toLowerCase().includes('shared'));
    if (docDrive) return docDrive.id;
    return drives[0]?.id ?? null;
  }

  private async navigateToFolder(driveId: string, folderPath: string[], log: (msg: string) => void): Promise<string> {
    let currentId = 'root';
    for (const folderName of folderPath) {
      log(`Navigating to folder "${folderName}" (parent: ${currentId})`);
      const children = await this.graph.listFolderChildren(driveId, currentId);
      const folder = children.find(c => c.name === folderName && c.folder);
      if (!folder) {
        const names = children.filter(c => c.folder).map(c => c.name).join(', ');
        throw new Error(`Folder "${folderName}" not found. Available folders: ${names}`);
      }
      currentId = folder.id;
    }
    return currentId;
  }

  async pull(): Promise<SyncResult> {
    this._running = 'pull';
    this._lastAttempt = new Date().toISOString();
    const result: SyncResult = {
      direction: 'pull',
      sheetsProcessed: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesSkipped: 0,
      errors: [],
      logs: [],
      timestamp: new Date().toISOString(),
    };
    const log = (msg: string) => { result.logs.push(msg); console.log('[SP-Sync]', msg); };

    const { siteId, driveHint, folderPath, fileName } = this.getSpConfig();
    log(`Config: site=${siteId}, drive=${driveHint}, path=${folderPath.join('/')}, file=${fileName}`);

    try {
      log('Step 1: Finding drive...');
      const driveId = await this.findDrive(siteId, driveHint, log);
      if (!driveId) {
        result.errors.push(`No drives found on site "${siteId}"`);
        this._lastResult = result;
        this._running = false;
        return result;
      }
      log(`Using drive: ${driveId}`);

      log('Step 2: Navigating folder tree...');
      const folderId = await this.navigateToFolder(driveId, folderPath, log);

      const children = await this.graph.listFolderChildren(driveId, folderId);
      const file = children.find(c => c.name === fileName);
      if (!file) {
        const names = children.filter(c => !c.folder).map(c => c.name).join(', ');
        result.errors.push(`File "${fileName}" not found. Available files: ${names}`);
        this._lastResult = result;
        this._running = false;
        return result;
      }
      log(`Found file: ${file.name} (${file.id})`);

      log('Step 3: Downloading file...');
      const buf = await this.graph.downloadFile(driveId, file.id);
      log(`Downloaded ${buf.length} bytes`);

      log('Step 4: Parsing xlsx...');
      const XLSX = (await import('xlsx')).default;
      const wb = XLSX.read(buf);
      log(`Parsed workbook: ${wb.SheetNames.length} sheets — ${wb.SheetNames.join(', ')}`);

      log('Step 5: Processing product sheets...');
      for (const sheetName of PRODUCT_SHEETS) {
        const ws = wb.Sheets[sheetName];
        if (!ws) {
          log(`  Sheet "${sheetName}" — not found, skipping`);
          continue;
        }

        const rows = this.parseSheetRows(XLSX, ws);
        log(`  Sheet "${sheetName}" — ${rows.length} parseable rows`);
        if (rows.length === 0) continue;

        result.sheetsProcessed++;

        for (const row of rows) {
          if (!row.account) continue;

          const existing = await this.deliveryQueries.findByProductAccount(sheetName, row.account);
          if (existing) {
            result.entriesSkipped++;
            continue;
          }

          await this.deliveryQueries.create({
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
            crm_customer_id: null,
            is_starred: 0,
            star_scope: 'me',
            starred_by: null,
            notes: row.notes || null,
          });
          result.entriesCreated++;
        }
      }

      log(`Pull complete: ${result.sheetsProcessed} sheets, ${result.entriesCreated} created, ${result.entriesSkipped} skipped`);
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      log(`EXCEPTION: ${msg}`);
      result.errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._lastResult = result;
    this._running = false;
    return result;
  }

  async push(): Promise<SyncResult> {
    this._running = 'push';
    this._lastAttempt = new Date().toISOString();
    const result: SyncResult = {
      direction: 'push',
      sheetsProcessed: 0,
      entriesCreated: 0,
      entriesUpdated: 0,
      entriesSkipped: 0,
      errors: [],
      logs: [],
      timestamp: new Date().toISOString(),
    };
    const log = (msg: string) => { result.logs.push(msg); console.log('[SP-Push]', msg); };

    const { siteId, driveHint, folderPath, fileName } = this.getSpConfig();
    log(`Config: site=${siteId}, drive=${driveHint}, path=${folderPath.join('/')}, file=${fileName}`);

    try {
      log('Step 1: Finding drive and folder...');
      const driveId = await this.findDrive(siteId, driveHint, log);
      if (!driveId) {
        result.errors.push(`No drives found on site "${siteId}"`);
        this._lastResult = result;
        this._running = false;
        return result;
      }
      log(`Using drive: ${driveId}`);

      const folderId = await this.navigateToFolder(driveId, folderPath, log);
      log(`Target folder: ${folderId}`);

      log('Step 2: Building xlsx from DB entries...');
      const XLSX = (await import('xlsx')).default;
      const wb = XLSX.utils.book_new();

      const headers = [
        'Onboarder', 'Account', 'Order Received', 'MRR Go Live',
        'Predicted Delivery', 'Status', 'Branch No.', 'MRR',
        'Incr/Adhoc/Set Up Fee', 'Monthly Licence Fee', 'Notes',
      ];

      for (const sheetName of PRODUCT_SHEETS) {
        const entries = await this.deliveryQueries.getAll(sheetName);
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
        log(`  Sheet "${sheetName}": ${entries.length} entries`);
      }

      if (result.sheetsProcessed === 0) {
        result.errors.push('No DB entries to push — all product sheets are empty');
        this._lastResult = result;
        this._running = false;
        return result;
      }

      const buf = Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as ArrayBuffer);
      log(`Built xlsx: ${result.sheetsProcessed} sheets, ${result.entriesUpdated} entries, ${(buf.length / 1024).toFixed(1)}KB`);

      log('Step 3: Uploading to SharePoint...');
      await this.graph.uploadFile(driveId, folderId, fileName, buf);
      log('Push complete');
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      log(`EXCEPTION: ${msg}`);
      result.errors.push(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }

    this._lastResult = result;
    this._running = false;
    return result;
  }

  // --- Sheet parsing ---

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

    const HEADER_KEYWORDS = ['account', 'customer', 'onboarder', 'status', 'order', 'mrr', 'delivery', 'branch'];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(5, raw.length); i++) {
      const row = raw[i];
      if (!row) continue;
      const joined = row.map((c) => str(c).toLowerCase()).join('|');
      const matchCount = HEADER_KEYWORDS.filter(kw => joined.includes(kw)).length;
      if (matchCount >= 2) {
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
      const lower = account.toLowerCase();
      if (!account || lower === 'totals' || HEADER_KEYWORDS.includes(lower)) continue;

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
