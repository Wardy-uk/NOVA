/**
 * eXp new-agent import (NT-24880). eXp send their joiners as an email body — one
 * block of "Agents Full Name / Email / Phone / Address / Microsite Yes-No" per
 * agent — and occasionally as a spreadsheet. This maps either onto the portal
 * form's agent rows so the submitter reviews rather than retypes.
 *
 * Like the Guild importer this runs through the PII sanitiser with phone
 * redaction skipped (the phone number IS the data here); anything that still
 * comes back redacted is dropped rather than pre-filled as noise.
 */
import { z } from 'zod';
import { extractText } from './guild-form-import.js';
import type { LlmService } from './llm-service.js';

const AgentSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  hasMicrosite: z.boolean().optional(),
  micrositeUrl: z.string().optional(),
  existingAgent: z.boolean().optional(),
  notes: z.string().optional(),
});
const ResultSchema = z.object({ agents: z.array(AgentSchema).default([]) });

export type ExpImportedAgent = z.infer<typeof AgentSchema>;

const MAX_TEXT_CHARS = 60_000;

const SYSTEM = [
  'You extract the joining agents from an eXp "Notification of New Agent Joining" request and return them as JSON.',
  'The source is normally an email listing one or more agents, each as a block of labelled lines:',
  '"Agents Full Name", "Agents Email Address", "Agents Phone Number", "Agents Registered Address",',
  '"EXP Agent Microsite (New URL = valuation.firstnamesurname.expuk.com)" and',
  '"EXP Agent No Microsite (LeadPro URL = valuation.firstnamesurname.lead.pro)".',
  'Return { "agents": [ { name, email, phone, address, hasMicrosite, micrositeUrl, existingAgent, notes } ] } — one entry per agent.',
  'hasMicrosite is TRUE when the "EXP Agent Microsite" line says Yes, and FALSE when the "No Microsite"/LeadPro line says Yes. If neither is stated, omit it.',
  'Only set micrositeUrl if the email states an explicit URL for that agent — never invent or derive one.',
  'Set existingAgent true only if the text says this person may already be / previously was an eXp agent.',
  'Ignore signatures, disclaimers, the standing instructions (agents not admin, registered company name, abandoned basket), and any greeting — those are not agent data.',
  'Do not invent values: omit anything you cannot find. Return an empty agents array if the text contains no agent details.',
].join(' ');

/** Extract joining agents from pasted email text or an uploaded file. */
export async function importExpAgents(
  source: { text?: string; file?: { buffer: Buffer; filename: string } },
  llm: LlmService,
): Promise<ExpImportedAgent[]> {
  const raw = source.file
    ? await extractText(source.file.buffer, source.file.filename)
    : (source.text || '');
  const text = raw.slice(0, MAX_TEXT_CHARS);
  if (!text.trim()) {
    throw new Error('Could not read any text from that. If it\'s a scanned PDF or an image, please enter the details manually.');
  }

  const result = await llm.call(SYSTEM, text, ResultSchema, {
    callType: 'exp_agent_import', tier: 'standard', skipPhoneRedaction: true,
  });

  return (result.data.agents || [])
    .map(a => {
      const clean: ExpImportedAgent = {};
      for (const [k, v] of Object.entries(a)) {
        if (typeof v === 'string' && (/\[REDACTED/i.test(v) || !v.trim())) continue;
        (clean as Record<string, unknown>)[k] = v;
      }
      return clean;
    })
    .filter(a => a.name || a.email);
}
