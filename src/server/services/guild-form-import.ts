/**
 * Guild form import (backlog #8, stage 3). Extracts text from an uploaded Guild
 * form (text-layer PDF via pdf-parse, or xlsx via SheetJS) and uses the LLM to
 * map it onto the target form's fields, so the portal form can be pre-filled for
 * the user to review before submitting.
 *
 * Note: the LLM path runs through the PII sanitiser, which redacts phone numbers
 * (and cards/secrets) — those come back as [REDACTED-…] and are dropped by the
 * caller, so phone fields stay blank for the user to fill. Emails/names/addresses
 * pass through normally.
 */
import { createRequire } from 'module';
import { z } from 'zod';
import { PortalMembershipApplicationSchema, PortalOnboardingRequestSchema } from '../../shared/portal-types.js';
import type { LlmService } from './llm-service.js';

const require = createRequire(import.meta.url);

export type GuildImportFormType = 'application' | 'setup';

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = (await import('xlsx')).default;
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames
      .map(n => `# Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
      .join('\n\n')
      .slice(0, 24000);
  }
  // PDF — pdf-parse is CJS.
  const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
  const parsed = await pdfParse(buffer);
  return String(parsed.text || '').slice(0, 24000);
}

/** Extract the form text and map it to the target form's fields via the LLM.
 *  Returns a partial field object (only keys the model could fill). */
export async function importGuildForm(
  buffer: Buffer, filename: string, formType: GuildImportFormType, llm: LlmService,
): Promise<Record<string, unknown>> {
  const text = await extractText(buffer, filename);
  if (!text.trim()) throw new Error('Could not read any text from that file. If it\'s a scanned PDF, please enter the details manually.');

  const shape = formType === 'application' ? PortalMembershipApplicationSchema.shape : PortalOnboardingRequestSchema.shape;
  const keys = Object.keys(shape);
  const formName = formType === 'application' ? 'Guild Membership Application' : 'Guild Membership Set-Up';

  const system = [
    `You extract structured data from a "${formName}" form and return it as JSON.`,
    `Only output these keys (omit any you cannot determine): ${keys.join(', ')}.`,
    `Rules: booleans as true/false; dates as YYYY-MM-DD; list fields (e.g. directors, users, portals) as JSON arrays; emails and names verbatim.`,
    `For "users", each item is { name, email, accessLevel, jobTitle }. Do not invent values — omit unknowns.`,
  ].join(' ');

  const result = await llm.call(system, text, z.record(z.unknown()), { callType: 'guild_form_import', tier: 'standard' });

  // Drop redaction placeholders so redacted phones don't pre-fill as noise.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result.data)) {
    if (typeof v === 'string' && /\[REDACTED/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}
