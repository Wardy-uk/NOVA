/**
 * File-based settings store — stores all settings (including API keys and
 * integration credentials) in settings.json in the project root.
 * Drop-in replacement for SettingsQueries (same method signatures).
 *
 * TODO: Replace with a proper database (PostgreSQL/MySQL) when deploying to server.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_FILE = path.resolve(__dirname, '../../../settings.json');

interface SettingsData {
  settings: Record<string, string>;
}

function load(): SettingsData {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return JSON.parse(raw) as SettingsData;
    }
  } catch {
    console.error('[SettingsStore] Failed to read settings.json, starting fresh');
  }
  return { settings: {} };
}

function save(data: SettingsData): void {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export type SettingsQueries = FileSettingsQueries;

export class FileSettingsQueries {
  get(key: string): string | null {
    return load().settings[key] ?? null;
  }

  set(key: string, value: string): void {
    const data = load();
    data.settings[key] = value;
    save(data);
  }

  getAll(): Record<string, string> {
    return { ...load().settings };
  }

  delete(key: string): void {
    const data = load();
    delete data.settings[key];
    save(data);
  }
}
