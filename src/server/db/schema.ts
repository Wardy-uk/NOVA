import { initPool, closePool, execute } from '../services/database.js';

export async function initializeDatabase(): Promise<void> {
  await initPool();
  await runMigrations();
}

async function runMigrations(): Promise<void> {
  const migrations = [
    `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'teams') AND name = 'jira_project_key')
     ALTER TABLE teams ADD jira_project_key NVARCHAR(20) NULL;`,
  ];
  for (const sql of migrations) {
    try { await execute(sql); } catch (e) { console.warn('[schema] Migration warning:', e); }
  }
}

export async function shutdownDatabase(): Promise<void> {
  await closePool();
}

export function saveDb(): void {
  // No-op: MSSQL writes are immediately durable.
}

export function createBackup(): string | null {
  // No-op: MSSQL handles its own backups.
  return null;
}
