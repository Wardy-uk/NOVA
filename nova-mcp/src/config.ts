import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

export interface SqlConfig {
  server: string;
  database: string;
  user: string;
  password: string;
}

interface LocalConfig {
  sql: SqlConfig;
}

interface NovaSettings {
  settings: Record<string, string>;
}

// Resolved relative to this compiled file (daypilot/nova-mcp/dist/config.js)
// so the MCP server works on any machine once installed as a sibling to
// daypilot's settings.json — no hardcoded absolute paths.
const NOVA_SETTINGS_PATH = resolve(PROJECT_ROOT, '..', 'settings.json');

function tryLoadLocalConfig(): SqlConfig | null {
  try {
    const raw = readFileSync(resolve(PROJECT_ROOT, 'config.json'), 'utf-8');
    const cfg: LocalConfig = JSON.parse(raw);
    if (cfg.sql?.server && cfg.sql?.database && cfg.sql?.user && cfg.sql?.password) {
      return cfg.sql;
    }
    return null;
  } catch {
    return null;
  }
}

function tryLoadNovaSettings(): SqlConfig | null {
  try {
    const raw = readFileSync(NOVA_SETTINGS_PATH, 'utf-8');
    const nova: NovaSettings = JSON.parse(raw);
    const s = nova.settings;
    const server = s['kpi_sql_server'];
    const database = s['kpi_sql_database'];
    const user = s['kpi_sql_user'];
    const password = s['kpi_sql_password'];
    if (server && database && user && password) {
      return { server, database, user, password };
    }
    return null;
  } catch {
    return null;
  }
}

export function loadConfig(): SqlConfig {
  const local = tryLoadLocalConfig();
  if (local) return local;

  const nova = tryLoadNovaSettings();
  if (nova) return nova;

  throw new Error(
    'SQL credentials not found. Provide config.json in the nova-mcp root, ' +
    `or set kpi_sql_server/kpi_sql_database/kpi_sql_user/kpi_sql_password in ${NOVA_SETTINGS_PATH}`
  );
}
