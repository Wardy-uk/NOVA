import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';

function parseConnectionString(str: string): Partial<sql.config> & { _encrypt?: boolean } {
  const parts: Record<string, string> = {};
  for (const segment of str.split(';')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    parts[segment.slice(0, idx).trim().toLowerCase()] = segment.slice(idx + 1).trim();
  }
  const encrypt = parts['encrypt']?.toLowerCase();
  return {
    server: parts['server'] || parts['data source'],
    database: parts['database'] || parts['initial catalog'],
    user: parts['user id'] || parts['uid'],
    password: parts['password'] || parts['pwd'],
    _encrypt: encrypt === undefined ? true : encrypt === 'true',
  };
}

export class ExternalDbService {
  private settings: SettingsQueries;
  private abuseReportPool: sql.ConnectionPool | null = null;
  private adminPool: sql.ConnectionPool | null = null;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
  }

  async getAbuseReportPool(): Promise<sql.ConnectionPool> {
    if (this.abuseReportPool?.connected) return this.abuseReportPool;
    return this.createAbuseReportPool();
  }

  async getAdminPool(): Promise<sql.ConnectionPool> {
    if (this.adminPool?.connected) return this.adminPool;
    return this.createAdminPool();
  }

  async resetAbuseReportPool(): Promise<void> {
    if (this.abuseReportPool) {
      try { await this.abuseReportPool.close(); } catch { /* ignore */ }
      this.abuseReportPool = null;
    }
  }

  async resetAdminPool(): Promise<void> {
    if (this.adminPool) {
      try { await this.adminPool.close(); } catch { /* ignore */ }
      this.adminPool = null;
    }
  }

  private async createAbuseReportPool(): Promise<sql.ConnectionPool> {
    const connStr = this.settings.get('abuse_report_db_connection');
    if (!connStr) throw new Error('abuse_report_db_connection not configured');

    const parsed = parseConnectionString(connStr);
    const encrypt = parsed._encrypt ?? true;
    delete (parsed as any)._encrypt;
    this.abuseReportPool = new sql.ConnectionPool({
      ...parsed,
      options: { encrypt, trustServerCertificate: true },
      requestTimeout: 30000,
      pool: { min: 0, max: 5, idleTimeoutMillis: 60000 },
    } as sql.config);
    await this.abuseReportPool.connect();
    console.log('[external-db] Connected to abuse report DB');
    return this.abuseReportPool;
  }

  private async createAdminPool(): Promise<sql.ConnectionPool> {
    const connStr = this.settings.get('abuse_report_admin_db_connection');
    if (!connStr) throw new Error('abuse_report_admin_db_connection not configured');

    const parsed = parseConnectionString(connStr);
    const encryptAdmin = parsed._encrypt ?? true;
    delete (parsed as any)._encrypt;
    this.adminPool = new sql.ConnectionPool({
      ...parsed,
      options: { encrypt: encryptAdmin, trustServerCertificate: true },
      requestTimeout: 30000,
      pool: { min: 0, max: 5, idleTimeoutMillis: 60000 },
    } as sql.config);
    await this.adminPool.connect();
    console.log('[external-db] Connected to admin DB');
    return this.adminPool;
  }

  async closeAll(): Promise<void> {
    await this.resetAbuseReportPool();
    await this.resetAdminPool();
  }
}
