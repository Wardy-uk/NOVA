// Migrate users from SQLite to users.json
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('daypilot.db');
const usersFile = path.resolve('users.json');

if (!fs.existsSync(dbPath)) {
  console.log('No daypilot.db found');
  process.exit(1);
}

const SQL = await initSqlJs();
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

// Check if users table exists
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
if (tables.length === 0 || tables[0].values.length === 0) {
  console.log('No users table in SQLite');
  process.exit(1);
}

const result = db.exec('SELECT * FROM users');
if (result.length === 0 || result[0].values.length === 0) {
  console.log('No users in SQLite DB');
  process.exit(1);
}

const cols = result[0].columns;
const rows = result[0].values;
console.log(`Found ${rows.length} user(s) in SQLite`);

const users = [];
let maxId = 0;
for (const row of rows) {
  const user = {};
  cols.forEach((c, i) => { user[c] = row[i]; });
  maxId = Math.max(maxId, user.id);
  users.push({
    id: user.id,
    username: user.username,
    display_name: user.display_name || null,
    email: user.email || null,
    password_hash: user.password_hash,
    role: user.role || 'viewer',
    auth_provider: user.auth_provider || 'local',
    provider_id: user.provider_id || null,
    team_id: user.team_id || null,
    created_at: user.created_at || new Date().toISOString(),
    updated_at: user.updated_at || new Date().toISOString(),
  });
  console.log(`  - ${user.username} (role: ${user.role}, id: ${user.id})`);
}

const data = { nextId: maxId + 1, users };
fs.writeFileSync(usersFile, JSON.stringify(data, null, 2), 'utf-8');
console.log(`Wrote ${users.length} user(s) to ${usersFile}`);
