// Migrate settings from SQLite to settings.json
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('daypilot.db');
const settingsFile = path.resolve('settings.json');

if (!fs.existsSync(dbPath)) {
  console.log('No daypilot.db found');
  process.exit(1);
}

const SQL = await initSqlJs();
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'");
if (tables.length === 0 || tables[0].values.length === 0) {
  console.log('No settings table in SQLite');
  process.exit(1);
}

const result = db.exec('SELECT key, value FROM settings');
if (result.length === 0 || result[0].values.length === 0) {
  console.log('No settings in SQLite DB');
  process.exit(1);
}

const settings = {};
for (const [key, value] of result[0].values) {
  settings[key] = value;
}

console.log(`Found ${Object.keys(settings).length} setting(s) in SQLite`);

// Merge with existing settings.json if it exists
let existing = { settings: {} };
if (fs.existsSync(settingsFile)) {
  try {
    existing = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    console.log(`Merging with ${Object.keys(existing.settings).length} existing setting(s)`);
  } catch {
    console.log('Could not parse existing settings.json, overwriting');
  }
}

const merged = { settings: { ...existing.settings, ...settings } };
fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2), 'utf-8');
console.log(`Wrote ${Object.keys(merged.settings).length} setting(s) to ${settingsFile}`);
