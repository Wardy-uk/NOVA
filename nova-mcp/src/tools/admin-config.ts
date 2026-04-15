import { z } from 'zod';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolResult, toolError } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// Path to NOVA's settings.json — same file the daypilot server reads and
// writes via FileSettingsQueries. We read it directly here because that's
// cheaper and simpler than going through HTTP for a read-only inspection,
// and NOVA reloads settings on every get() call so an external write is
// picked up on the next request without a restart.
//
// Resolved relative to THIS file's location. The compiled output lives
// at daypilot/nova-mcp/dist/tools/admin-config.js, so we walk up three
// levels (tools → dist → nova-mcp → daypilot) to reach settings.json.
const __dirname = dirname(fileURLToPath(import.meta.url));
const NOVA_SETTINGS_PATH = resolve(__dirname, '..', '..', '..', 'settings.json');

// ── Masking helpers ─────────────────────────────────────────────────────

const SECRET_KEY_PATTERN = /token|password|secret|apikey|api_key|client_secret|pass$|pass_|_pass/i;
const EMAIL_KEY_PATTERN = /email|username|user$|_user/i;

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || !local) return email;
  const masked = local.length <= 3
    ? `${local[0]}***`
    : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${masked}@${domain}`;
}

function maskToken(tok: string): string {
  if (!tok) return '(unset)';
  if (tok.length < 12) return '(too short)';
  return `${tok.slice(0, 4)}…${tok.slice(-4)} (len ${tok.length})`;
}

function maskValue(key: string, val: unknown): unknown {
  if (val == null || val === '') return '(unset)';
  if (typeof val !== 'string') return val;
  if (SECRET_KEY_PATTERN.test(key)) return maskToken(val);
  if (EMAIL_KEY_PATTERN.test(key) && val.includes('@')) return maskEmail(val);
  return val;
}

// ── Write denylist ──────────────────────────────────────────────────────
// These keys cannot be written via MCP. Writing any of them would either:
//  - leak / corrupt credentials
//  - break authentication (custom_roles, role_permissions)
//  - change the auth provider wiring
//
// Reading them is allowed (masked) so we can inspect; writing is not.
const WRITE_DENY_PATTERNS: RegExp[] = [
  /token/i,
  /password/i,
  /secret/i,
  /apikey/i,
  /api_key/i,
  /client_secret/i,
  /^jira_username$/i,
  /^jira_ob_email$/i,
  /^custom_roles$/i,
  /^role_permissions$/i,
  /^sso_/i,
  /^smtp_pass/i,
];

function isWriteDenied(key: string): boolean {
  return WRITE_DENY_PATTERNS.some((rx) => rx.test(key));
}

// ── Settings loader ─────────────────────────────────────────────────────

interface NovaSettingsFile {
  settings: Record<string, string>;
  updatedAt?: string;
}

function loadSettings(): NovaSettingsFile {
  const raw = readFileSync(NOVA_SETTINGS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.settings) {
    throw new Error('settings.json missing `settings` object');
  }
  return parsed as NovaSettingsFile;
}

function writeSettings(file: NovaSettingsFile): void {
  const next: NovaSettingsFile = {
    settings: file.settings,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(NOVA_SETTINGS_PATH, JSON.stringify(next, null, 2));
}

// ── Tool 1: read config ────────────────────────────────────────────────

export const getConfigSchema = {
  key_pattern: z
    .string()
    .optional()
    .describe('Optional regex (JS syntax) to filter keys. E.g. "^jira_" or "dev_review" — matches against the key name. Omit to return everything.'),
  unmask: z
    .boolean()
    .default(false)
    .describe('Set true to return raw (unmasked) values. USE SPARINGLY — exposes tokens and passwords. Default false.'),
};

export async function getConfig(args: {
  key_pattern?: string;
  unmask: boolean;
}): Promise<CallToolResult> {
  let file: NovaSettingsFile;
  try {
    file = loadSettings();
  } catch (err) {
    return toolError(`Failed to read settings.json: ${err instanceof Error ? err.message : err}`);
  }

  let filter: RegExp | null = null;
  if (args.key_pattern) {
    try {
      filter = new RegExp(args.key_pattern, 'i');
    } catch {
      return toolError(`Invalid regex: ${args.key_pattern}`);
    }
  }

  const out: Record<string, unknown> = {};
  let total = 0;
  let matched = 0;
  for (const [k, v] of Object.entries(file.settings || {})) {
    total++;
    if (filter && !filter.test(k)) continue;
    matched++;
    out[k] = args.unmask ? v : maskValue(k, v);
  }

  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];

  return toolResult(
    `Read ${matched}/${total} keys from settings.json${args.unmask ? ' (UNMASKED)' : ' (masked)'}`,
    {
      path: NOVA_SETTINGS_PATH,
      updatedAt: file.updatedAt,
      keyCount: matched,
      totalKeys: total,
      filter: args.key_pattern || '(none)',
      unmask: args.unmask,
      settings: sorted,
    },
  );
}

// ── Tool 2: write a single setting ──────────────────────────────────────

export const setSettingSchema = {
  key: z
    .string()
    .min(1)
    .describe('The settings.json key to write (e.g. "dev_review_accept_transition_id"). Must not match the write denylist.'),
  value: z
    .string()
    .describe('The new value as a plain string. Pass empty string to clear. Values are always stored as strings in settings.json.'),
  confirm: z
    .boolean()
    .default(false)
    .describe('Must be true to actually write. When false (default) the tool performs a dry-run and returns what would change without touching the file.'),
};

export async function setSetting(args: {
  key: string;
  value: string;
  confirm: boolean;
}): Promise<CallToolResult> {
  const key = args.key.trim();
  if (!key) return toolError('`key` is required');

  if (isWriteDenied(key)) {
    return toolError(
      `Write denied: key "${key}" matches the denylist (tokens, passwords, secrets, SSO config, custom_roles, role_permissions). These must be changed via the Admin UI, not MCP.`,
    );
  }

  let file: NovaSettingsFile;
  try {
    file = loadSettings();
  } catch (err) {
    return toolError(`Failed to read settings.json: ${err instanceof Error ? err.message : err}`);
  }

  const before = file.settings[key];
  const after = args.value;
  const changed = before !== after;

  if (!args.confirm) {
    return toolResult(
      `DRY RUN — not written. Re-call with confirm: true to apply.`,
      {
        key,
        before: maskValue(key, before),
        after: maskValue(key, after),
        changed,
        confirm: false,
      },
    );
  }

  if (!changed) {
    return toolResult(
      `No change — value already matches. Nothing written.`,
      {
        key,
        value: maskValue(key, after),
        changed: false,
      },
    );
  }

  file.settings[key] = after;
  try {
    writeSettings(file);
  } catch (err) {
    return toolError(`Failed to write settings.json: ${err instanceof Error ? err.message : err}`);
  }

  return toolResult(
    `Wrote ${key} to settings.json. The running NOVA server will pick up the change on its next read — no restart required.`,
    {
      key,
      before: maskValue(key, before),
      after: maskValue(key, after),
      changed: true,
      path: NOVA_SETTINGS_PATH,
    },
  );
}
