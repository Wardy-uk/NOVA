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

// Big cap so the whole Guild form is sent — the application form is 20 pages
// with the actual data fields only from ~page 7 (after the T&C boilerplate).
const MAX_EXTRACT_CHARS = 120_000;

async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = (await import('xlsx')).default;
    const wb = XLSX.read(buffer, { type: 'buffer' });
    return wb.SheetNames
      .map(n => `# Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`)
      .join('\n\n')
      .slice(0, MAX_EXTRACT_CHARS);
  }
  // PDF — pdf-parse is CJS.
  const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
  const parsed = await pdfParse(buffer);
  return String(parsed.text || '').slice(0, MAX_EXTRACT_CHARS);
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
    `You extract structured data from a "${formName}" form (a DocuSign PDF) and return it as JSON.`,
    `IMPORTANT layout note: the document text lists blank field LABELS first, and the user's ENTERED VALUES appear grouped together separately — often at the end of the page or section, or right after a "Docusign Envelope ID" line — NOT next to each label. Associate each value to its label by order, position and context.`,
    `Ignore the Membership Terms & Conditions / legal boilerplate, page headers/footers, "Docusign Envelope ID" lines, and signatures — none of that is form data.`,
    `Only output these keys (omit any you genuinely cannot find): ${keys.join(', ')}.`,
    `Rules: booleans as true/false (a ticked checkbox = true); dates as YYYY-MM-DD; list fields (e.g. directors, users, portals) as JSON arrays; emails, names, phone numbers and addresses verbatim.`,
    `For "users", each item is { name, email, accessLevel, jobTitle }. Do not invent values — omit unknowns.`,
  ].join(' ');

  // Phones import fine (skipPhoneRedaction); cards/secrets still redacted, so
  // drop any remaining redaction placeholders rather than pre-fill them as noise.
  const result = await llm.call(system, text, z.record(z.unknown()), { callType: 'guild_form_import', tier: 'standard', skipPhoneRedaction: true });
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result.data)) {
    if (typeof v === 'string' && /\[REDACTED/i.test(v)) continue;
    out[k] = v;
  }
  return out;
}
