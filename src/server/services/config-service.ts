import sql from 'mssql';
import { getPool } from './database.js';
import type { SettingsQueries } from '../db/settings-store.js';

const SECRET_KEYS = new Set([
  'jira_ob_email', 'jira_ob_api_token', 'jira_api_email', 'jira_api_token',
  'openai_api_key', 'anthropic_api_key',
  'sso_client_secret', 'sso_tenant_id', 'sso_client_id',
  'd365_client_id', 'd365_client_secret', 'd365_tenant_id',
  'kpi_sql_server', 'kpi_sql_database', 'kpi_sql_user', 'kpi_sql_password',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
  'teams_webhook_url', 'people_hr_api_key',
  'confluence_api_email', 'confluence_api_token', 'confluence_base_url',
  'adobe_sign_client_id', 'adobe_sign_client_secret', 'adobe_sign_refresh_token',
]);

function isSecret(key: string): boolean {
  return SECRET_KEYS.has(key) || key.endsWith('_api_key') || key.endsWith('_api_token')
    || key.endsWith('_password') || key.endsWith('_secret') || key.endsWith('_token');
}

type SecretProvider = {
  getSecret(name: string): Promise<string | null>;
};

let keyVaultClient: SecretProvider | null = null;

async function initKeyVault(): Promise<SecretProvider | null> {
  const vaultUrl = process.env.KEY_VAULT_URL;
  if (!vaultUrl) return null;

  try {
    // @ts-ignore — optional dependency, graceful fallback if not installed
    const { DefaultAzureCredential } = await import('@azure/identity');
    // @ts-ignore — optional dependency, graceful fallback if not installed
    const { SecretClient } = await import('@azure/keyvault-secrets');
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(vaultUrl, credential);
    console.log(`[config] Connected to Key Vault: ${vaultUrl}`);
    return {
      async getSecret(name: string): Promise<string | null> {
        try {
          const kvName = name.replace(/_/g, '-');
          const secret = await client.getSecret(kvName);
          return secret.value ?? null;
        } catch {
          return null;
        }
      },
    };
  } catch (err) {
    console.warn(`[config] Key Vault unavailable (${err instanceof Error ? err.message : 'unknown'}), falling back to env/DB`);
    return null;
  }
}

export class ConfigService implements SettingsQueries {
  private secretCache = new Map<string, { value: string; expiresAt: number }>();
  private configCache = new Map<string, string>();
  private cacheLoaded = false;
  private fallback: SettingsQueries | null;
  private static CACHE_TTL_MS = 30 * 60 * 1000;

  constructor(fallback?: SettingsQueries) {
    this.fallback = fallback ?? null;
  }

  async initialize(): Promise<void> {
    keyVaultClient = await initKeyVault();
    await this.ensureSettingsTable();
    await this.loadConfigCache();
    console.log(`[config] Initialized — vault: ${keyVaultClient ? 'yes' : 'no'}, DB settings: ${this.configCache.size} keys`);
  }

  private async ensureSettingsTable(): Promise<void> {
    try {
      const pool = getPool();
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'settings')
        CREATE TABLE dbo.settings (
          [key] VARCHAR(200) PRIMARY KEY,
          [value] NVARCHAR(MAX) NOT NULL,
          category VARCHAR(50) NULL,
          updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
          updated_by VARCHAR(100) NULL
        );
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'settings') AND name = 'category')
          ALTER TABLE dbo.settings ADD category VARCHAR(50) NULL;
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'settings') AND name = 'updated_at')
          ALTER TABLE dbo.settings ADD updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE();
      `);
      await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'settings') AND name = 'updated_by')
          ALTER TABLE dbo.settings ADD updated_by VARCHAR(100) NULL;
      `);
    } catch (err) {
      console.warn('[config] Failed to ensure settings table:', err instanceof Error ? err.message : err);
    }
  }

  private async loadConfigCache(): Promise<void> {
    try {
      const pool = getPool();
      const result = await pool.request().query(`SELECT [key], [value] FROM dbo.settings`);
      this.configCache.clear();
      for (const row of result.recordset) {
        this.configCache.set(row.key, row.value);
      }
      this.cacheLoaded = true;
    } catch {
      this.cacheLoaded = false;
    }
  }

  get(key: string): string | null {
    if (isSecret(key)) {
      const cached = this.secretCache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;

      const envVal = process.env[key.toUpperCase()] ?? process.env[key];
      if (envVal) {
        this.secretCache.set(key, { value: envVal, expiresAt: Date.now() + ConfigService.CACHE_TTL_MS });
        return envVal;
      }

      // Check DB before fallback — secrets like jwt_secret may be stored there
      if (this.configCache.has(key)) {
        const dbVal = this.configCache.get(key)!;
        this.secretCache.set(key, { value: dbVal, expiresAt: Date.now() + ConfigService.CACHE_TTL_MS });
        return dbVal;
      }

      return this.fallback?.get(key) ?? null;
    }

    if (this.configCache.has(key)) return this.configCache.get(key)!;
    return this.fallback?.get(key) ?? null;
  }

  set(key: string, value: string): void {
    if (isSecret(key)) {
      this.secretCache.set(key, { value, expiresAt: Date.now() + ConfigService.CACHE_TTL_MS });
      this.configCache.set(key, value);
      this.writeToDb(key, value).catch(err =>
        console.warn(`[config] Failed to write secret ${key} to DB:`, err instanceof Error ? err.message : err)
      );
      if (this.fallback) this.fallback.set(key, value);
      return;
    }

    this.configCache.set(key, value);
    this.writeToDb(key, value).catch(err =>
      console.warn(`[config] Failed to write ${key} to DB:`, err instanceof Error ? err.message : err)
    );
  }

  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    if (this.fallback) Object.assign(result, this.fallback.getAll());
    for (const [k, v] of this.configCache) result[k] = v;
    for (const [k, cached] of this.secretCache) {
      if (cached.expiresAt > Date.now()) result[k] = cached.value;
    }
    return result;
  }

  delete(key: string): void {
    this.configCache.delete(key);
    this.secretCache.delete(key);
    this.deleteFromDb(key).catch(() => {});
    if (this.fallback) this.fallback.delete(key);
  }

  async refreshSecrets(): Promise<number> {
    if (!keyVaultClient) return 0;
    let refreshed = 0;
    for (const key of SECRET_KEYS) {
      const val = await keyVaultClient.getSecret(key);
      if (val) {
        this.secretCache.set(key, { value: val, expiresAt: Date.now() + ConfigService.CACHE_TTL_MS });
        refreshed++;
      }
    }
    return refreshed;
  }

  async refreshConfig(): Promise<void> {
    await this.loadConfigCache();
  }

  async migrateFromFallback(): Promise<{ migrated: number; secrets: number; config: number }> {
    if (!this.fallback) return { migrated: 0, secrets: 0, config: 0 };
    const all = this.fallback.getAll();
    let secrets = 0;
    let config = 0;
    for (const [key, value] of Object.entries(all)) {
      if (isSecret(key)) {
        this.secretCache.set(key, { value, expiresAt: Date.now() + ConfigService.CACHE_TTL_MS });
        secrets++;
      } else {
        await this.writeToDb(key, value);
        this.configCache.set(key, value);
        config++;
      }
    }
    return { migrated: secrets + config, secrets, config };
  }

  async getSettingsWithMeta(): Promise<any[]> {
    try {
      const pool = getPool();
      const result = await pool.request().query(`
        SELECT [key], [value], category, updated_at, updated_by FROM dbo.settings ORDER BY category, [key]
      `);
      return result.recordset;
    } catch { return []; }
  }

  private async writeToDb(key: string, value: string): Promise<void> {
    const pool = getPool();
    const request = pool.request();
    request.input('key', sql.VarChar, key);
    request.input('value', sql.NVarChar, value);
    const category = this.categorize(key);
    request.input('category', sql.VarChar, category);
    await request.query(`
      MERGE dbo.settings AS t
      USING (SELECT @key AS [key]) AS s ON t.[key] = s.[key]
      WHEN MATCHED THEN UPDATE SET [value] = @value, category = @category, updated_at = GETUTCDATE()
      WHEN NOT MATCHED THEN INSERT ([key], [value], category, updated_at) VALUES (@key, @value, @category, GETUTCDATE());
    `);
  }

  private async deleteFromDb(key: string): Promise<void> {
    const pool = getPool();
    await pool.request().input('key', sql.VarChar, key).query(`DELETE FROM dbo.settings WHERE [key] = @key`);
  }

  private categorize(key: string): string {
    if (key.startsWith('jira_')) return 'jira';
    if (key.startsWith('d365_')) return 'dynamics365';
    if (key.startsWith('sso_')) return 'sso';
    if (key.startsWith('kpi_')) return 'kpi';
    if (key.startsWith('smtp_')) return 'email';
    if (key.startsWith('agent_')) return 'agent';
    if (key.startsWith('adobe_')) return 'adobe_sign';
    if (key.startsWith('confluence_')) return 'confluence';
    if (key.startsWith('people_')) return 'people_hr';
    return 'general';
  }
}
