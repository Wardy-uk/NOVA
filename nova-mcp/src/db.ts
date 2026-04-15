import sql from 'mssql';
import { loadConfig, type SqlConfig } from './config.js';

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  const cfg: SqlConfig = loadConfig();

  pool = new sql.ConnectionPool({
    server: cfg.server,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: true,
      trustServerCertificate: false,
    },
    requestTimeout: 30000,
    connectionTimeout: 15000,
  });

  await pool.connect();
  return pool;
}

export async function query<T = sql.IRecordSet<unknown>>(
  sqlText: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const p = await getPool();
  const req = p.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      req.input(key, value);
    }
  }

  const result = await req.query(sqlText);
  return result.recordset as T;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}
