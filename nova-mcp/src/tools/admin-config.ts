import { z } from 'zod';
import { apiGet, apiPut } from '../auth.js';
import { toolResult, toolError } from './helpers.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

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

// ── Tool 1: read config ────────────────────────────────────────────────

export const getConfigSchema = {
  key_pattern: z
    .string()
    .optional()
    .describe('Optional regex (JS syntax) to filter keys. E.g. "^jira_" or "dev_review" — matches against the key name. Omit to return everything.'),
  unmask: z
    .boolean()
    .default(false)
    .describe('Set true to return raw (unmasked) values. USE SPARINGLY — exposes tokens and passwords. Note: admin login already redacts nothing, but non-admin accounts receive a pre-redacted view from the NOVA API. Default false.'),
};

export async function getConfig(args: {
  key_pattern?: string;
  unmask: boolean;
}): Promise<CallToolResult> {
  let settings: Record<string, string>;
  try {
    settings = await apiGet<Record<string, string>>('/api/settings');
  } catch (err) {
    return toolError(`Failed to GET /api/settings: ${err instanceof Error ? err.message : err}`);
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
  for (const [k, v] of Object.entries(settings ?? {})) {
    total++;
    if (filter && !filter.test(k)) continue;
    matched++;
    out[k] = args.unmask ? v : maskValue(k, v);
  }

  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];

  return toolResult(
    `Read ${matched}/${total} keys from NOVA /api/settings${args.unmask ? ' (UNMASKED)' : ' (masked)'}`,
    {
      source: 'GET /api/settings',
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
    .describe('The settings key to write (e.g. "dev_review_accept_transition_id"). Must not match the write denylist.'),
  value: z
    .string()
    .describe('The new value as a plain string. Pass empty string to clear. Values are always stored as strings in NOVA settings.'),
  confirm: z
    .boolean()
    .default(false)
    .describe('Must be true to actually write. When false (default) the tool performs a dry-run and returns what would change without hitting the API.'),
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

  // Fetch current value for the diff.
  let current: Record<string, string>;
  try {
    current = await apiGet<Record<string, string>>('/api/settings');
  } catch (err) {
    return toolError(`Failed to read current settings: ${err instanceof Error ? err.message : err}`);
  }

  const before = current[key];
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

  try {
    await apiPut(`/api/settings/${encodeURIComponent(key)}`, { value: after });
  } catch (err) {
    return toolError(`Failed to PUT /api/settings/${key}: ${err instanceof Error ? err.message : err}`);
  }

  return toolResult(
    `Wrote ${key} via PUT /api/settings/${key}. NOVA reloads settings on every read — no restart required.`,
    {
      key,
      before: maskValue(key, before),
      after: maskValue(key, after),
      changed: true,
      endpoint: `PUT /api/settings/${key}`,
    },
  );
}
