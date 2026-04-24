import sql from 'mssql';

let pool: sql.ConnectionPool | null = null;

function buildConfig(): sql.config {
  const connStr = process.env.NOVA_SQL_CONNECTION;
  if (connStr) {
    return {
      ...parseConnectionString(connStr),
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
      pool: { min: 2, max: 50, idleTimeoutMillis: 30000, acquireTimeoutMillis: 15000 },
    } as sql.config;
  }

  const server = process.env.NOVA_SQL_SERVER;
  const database = process.env.NOVA_SQL_DATABASE;
  const user = process.env.NOVA_SQL_USER;
  const password = process.env.NOVA_SQL_PASSWORD;

  if (!server || !database || !user || !password) {
    throw new Error(
      'Database not configured. Set NOVA_SQL_CONNECTION or individual NOVA_SQL_SERVER/DATABASE/USER/PASSWORD env vars.'
    );
  }

  return {
    server,
    database,
    user,
    password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
    pool: { min: 2, max: 50, idleTimeoutMillis: 30000, acquireTimeoutMillis: 15000 },
  };
}

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

let reconnecting: Promise<sql.ConnectionPool> | null = null;

export async function initPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  const config = buildConfig();
  pool = await new sql.ConnectionPool(config).connect();
  console.log(`[N.O.V.A] Connected to MSSQL: ${config.server}/${config.database}`);

  setInterval(() => {
    if (!pool?.connected) return;
    const s = getPoolStats();
    if (s.used > 0 || s.pending > 0) {
      const pct = Math.round((s.used / s.size) * 100);
      const level = pct >= 80 ? 'WARN' : 'info';
      const fn = pct >= 80 ? console.warn : console.log;
      fn(`[pool-${level}] ${s.used}/${s.size} active (${pct}%), ${s.free} free, ${s.pending} pending`);
    }
  }, 60_000);

  return pool;
}

export function getPoolStats(): { size: number; used: number; free: number; pending: number } {
  if (!pool?.connected) return { size: 0, used: 0, free: 0, pending: 0 };
  const tp = (pool as unknown as { pool: { numUsed(): number; numFree(): number; numPendingAcquires(): number } }).pool;
  return {
    size: tp.numUsed() + tp.numFree(),
    used: tp.numUsed(),
    free: tp.numFree(),
    pending: tp.numPendingAcquires(),
  };
}

export function getPool(): sql.ConnectionPool {
  if (!pool?.connected) {
    throw new Error('Database pool not initialized. Call initPool() first.');
  }
  return pool;
}

async function ensurePool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  if (reconnecting) return reconnecting;
  console.warn('[N.O.V.A] MSSQL pool disconnected — reconnecting...');
  reconnecting = initPool().finally(() => { reconnecting = null; });
  return reconnecting;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('[N.O.V.A] MSSQL pool closed.');
  }
}

function bindParams(request: sql.Request, params: unknown[]): void {
  for (let i = 0; i < params.length; i++) {
    const val = params[i];
    if (val === null || val === undefined) {
      request.input(`p${i}`, sql.NVarChar, null);
    } else if (typeof val === 'number') {
      request.input(`p${i}`, Number.isInteger(val) ? sql.Int : sql.Float, val);
    } else if (typeof val === 'boolean') {
      request.input(`p${i}`, sql.Bit, val);
    } else if (val instanceof Date) {
      request.input(`p${i}`, sql.DateTime2, val);
    } else if (Buffer.isBuffer(val)) {
      request.input(`p${i}`, sql.VarBinary(sql.MAX), val);
    } else {
      request.input(`p${i}`, sql.NVarChar, String(val));
    }
  }
}

function convertPositionalParams(sqlText: string): string {
  let idx = 0;
  return sqlText.replace(/\?/g, () => `@p${idx++}`);
}

export async function query<T = Record<string, unknown>>(
  sqlText: string,
  params: unknown[] = []
): Promise<T[]> {
  const p = await ensurePool();
  const request = p.request();
  bindParams(request, params);
  const converted = convertPositionalParams(sqlText);
  const result = await request.query<T>(converted);
  return result.recordset;
}

export async function queryOne<T = Record<string, unknown>>(
  sqlText: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(sqlText, params);
  return rows[0];
}

export async function execute(
  sqlText: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number }> {
  const p = await ensurePool();
  const request = p.request();
  bindParams(request, params);
  const converted = convertPositionalParams(sqlText);
  const result = await request.query(converted);
  const affected = result.rowsAffected.reduce((sum, n) => sum + n, 0);
  return { rowsAffected: affected };
}

export async function executeAndGetId(
  sqlText: string,
  params: unknown[] = []
): Promise<number> {
  const combined = sqlText.trimEnd().replace(/;?\s*$/, '') + '; SELECT SCOPE_IDENTITY() AS id;';
  const p = await ensurePool();
  const request = p.request();
  bindParams(request, params);
  const converted = convertPositionalParams(combined);
  const result = await request.query(converted);
  const sets = result.recordsets as sql.IRecordSet<{ id: number }>[];
  const lastSet = sets[sets.length - 1];
  return lastSet?.[0]?.id ?? 0;
}

export async function transaction<T>(
  fn: (tx: sql.Transaction) => Promise<T>
): Promise<T> {
  const p = await ensurePool();
  const tx = new sql.Transaction(p);
  await tx.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export function txQuery<T = Record<string, unknown>>(
  tx: sql.Transaction,
  sqlText: string,
  params: unknown[] = []
): Promise<T[]> {
  const request = new sql.Request(tx);
  bindParams(request, params);
  const converted = convertPositionalParams(sqlText);
  return request.query<T>(converted).then(r => r.recordset);
}

export function txExecute(
  tx: sql.Transaction,
  sqlText: string,
  params: unknown[] = []
): Promise<{ rowsAffected: number }> {
  const request = new sql.Request(tx);
  bindParams(request, params);
  const converted = convertPositionalParams(sqlText);
  return request.query(converted).then(r => ({
    rowsAffected: r.rowsAffected.reduce((sum, n) => sum + n, 0),
  }));
}

export function txExecuteAndGetId(
  tx: sql.Transaction,
  sqlText: string,
  params: unknown[] = []
): Promise<number> {
  const combined = sqlText.trimEnd().replace(/;?\s*$/, '') + '; SELECT SCOPE_IDENTITY() AS id;';
  const request = new sql.Request(tx);
  bindParams(request, params);
  const converted = convertPositionalParams(combined);
  return request.query(converted).then(r => {
    const sets = r.recordsets as sql.IRecordSet<{ id: number }>[];
    const lastSet = sets[sets.length - 1];
    return lastSet?.[0]?.id ?? 0;
  });
}
