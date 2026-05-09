import fs from 'fs';
import path from 'path';
import { query, queryOne, execute } from '../services/database.js';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const MIGRATED_FILE = path.join(DATA_DIR, 'settings.json.migrated');

export class SqlSettingsQueries {
  private cache = new Map<string, string>();
  private cacheLoaded = false;

  async migrateFromFile(): Promise<number> {
    if (!fs.existsSync(SETTINGS_FILE)) return 0;
    if (fs.existsSync(MIGRATED_FILE)) return 0;

    let data: { settings: Record<string, string> };
    try {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      data = JSON.parse(raw);
    } catch {
      console.warn('[sql-settings] Failed to read settings.json for migration');
      return 0;
    }

    const entries = Object.entries(data.settings ?? {});
    let migrated = 0;
    for (const [key, value] of entries) {
      try {
        await execute(
          `MERGE nova_settings AS target
           USING (SELECT ? AS setting_key) AS source ON target.setting_key = source.setting_key
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value) VALUES (?, ?)`,
          [key, key, value],
        );
        migrated++;
      } catch (err) {
        console.warn(`[sql-settings] Failed to migrate key "${key}":`, err);
      }
    }

    try {
      fs.renameSync(SETTINGS_FILE, MIGRATED_FILE);
      console.log(`[sql-settings] Migrated ${migrated}/${entries.length} settings, renamed settings.json → settings.json.migrated`);
    } catch {
      console.warn('[sql-settings] Could not rename settings.json — it will be re-migrated on next boot');
    }

    this.cacheLoaded = false;
    return migrated;
  }

  get(key: string): string | null {
    if (this.cacheLoaded) return this.cache.get(key) ?? null;
    return this.getSync(key);
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
    this.setAsync(key, value).catch(err => {
      console.error(`[sql-settings] Failed to persist "${key}":`, err);
    });
  }

  getAll(): Record<string, string> {
    if (this.cacheLoaded) return Object.fromEntries(this.cache);
    return this.getAllSync();
  }

  delete(key: string): void {
    this.cache.delete(key);
    execute(`DELETE FROM nova_settings WHERE setting_key = ?`, [key]).catch(err => {
      console.error(`[sql-settings] Failed to delete "${key}":`, err);
    });
  }

  async loadCache(): Promise<void> {
    const rows = await query<{ setting_key: string; setting_value: string }>(
      `SELECT setting_key, setting_value FROM nova_settings`,
    );
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.setting_key, row.setting_value);
    }
    this.cacheLoaded = true;
    console.log(`[sql-settings] Loaded ${rows.length} settings into cache`);
  }

  private getSync(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  private getAllSync(): Record<string, string> {
    return Object.fromEntries(this.cache);
  }

  private async setAsync(key: string, value: string): Promise<void> {
    await execute(
      `MERGE nova_settings AS target
       USING (SELECT ? AS setting_key) AS source ON target.setting_key = source.setting_key
       WHEN MATCHED THEN UPDATE SET setting_value = ?, updated_at = GETUTCDATE()
       WHEN NOT MATCHED THEN INSERT (setting_key, setting_value) VALUES (?, ?)`,
      [key, value, key, value],
    );
  }
}
