import sql from 'mssql';
import type { SettingsQueries } from '../db/settings-store.js';

function parseConnectionString(str: string): Partial<sql.config> {
  const parts: Record<string, string> = {};
  for (const segment of str.split(';')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    parts[segment.slice(0, idx).trim().toLowerCase()] = segment.slice(idx + 1).trim();
  }
  return {
    server: parts['server'] || parts['data source'],
    database: parts['database'] || parts['initial catalog'],
    user: parts['user id'] || parts['uid'],
    password: parts['password'] || parts['pwd'],
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

    const connStr = this.settings.get('abuse_report_db_connection');
    if (!connStr) throw new Error('abuse_report_db_connection not configured');

    this.abuseReportPool = new sql.ConnectionPool({
      ...parseConnectionString(connStr),
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
      pool: { min: 0, max: 5, idleTimeoutMillis: 60000 },
    } as sql.config);
    await this.abuseReportPool.connect();
    console.log('[external-db] Connected to abuse report DB');
    return this.abuseReportPool;
  }

  async getAdminPool(): Promise<sql.ConnectionPool> {
    if (this.adminPool?.connected) return this.adminPool;

    const connStr = this.settings.get('abuse_report_admin_db_connection');
    if (!connStr) throw new Error('abuse_report_admin_db_connection not configured');

    this.adminPool = new sql.ConnectionPool({
      ...parseConnectionString(connStr),
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
      pool: { min: 0, max: 5, idleTimeoutMillis: 60000 },
    } as sql.config);
    await this.adminPool.connect();
    console.log('[external-db] Connected to admin DB');
    return this.adminPool;
  }

  async closeAll(): Promise<void> {
    if (this.abuseReportPool) {
      try { await this.abuseReportPool.close(); } catch { /* ignore */ }
      this.abuseReportPool = null;
    }
    if (this.adminPool) {
      try { await this.adminPool.close(); } catch { /* ignore */ }
      this.adminPool = null;
    }
  }
}
