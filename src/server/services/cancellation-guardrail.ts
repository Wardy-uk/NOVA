import type { SettingsQueries } from '../db/settings-store.js';

// Cancellation / termination guardrail.
//
// NOVA puts a first response on every ticket. If a customer is asking to cancel,
// terminate, end their contract, hand in notice, or anything that could be construed
// as ending their relationship with us, NOVA must NEVER handle it itself (no AI answer,
// no auto-close, no auto-route). It must post a warm holding acknowledgement and hand the
// ticket to a human in Customer Care. This is a commercial/retention decision for people.
//
// Detection is intentionally broad (recall over precision): a false positive just means a
// customer gets a polite "a member of the team will be in touch" and a human reviews the
// ticket — a false negative means NOVA could "accept" a cancellation, which is unacceptable.

// Default intent patterns. Source strings compiled case-insensitively.
const DEFAULT_PATTERNS: string[] = [
  // Core verbs — broad on purpose
  'cancel(l?ing|l?ed|lation)?',
  'terminat(e|es|ing|ion|ed)',
  'resign(ation|ing|ed)?',
  'discontinu(e|es|ing|ation|ed)',
  // Ending an account / contract / subscription
  '(end|ending|close|closing|cease|ceasing)\\s+(my|our|the)\\s+(account|contract|subscription|agreement|membership|service|services|plan|direct\\s+debit)',
  // Giving / handing in notice
  '(give|giving|hand(ing)?\\s+in|serve|serving|submit(ting)?|provide|providing)\\s+(my|our|you|in|formal)?\\s*notice',
  'notice\\s+(to|of)\\s+(cancel|terminat|end|leave)',
  // Intent phrasing
  'no\\s+longer\\s+(wish|want|require|need|use)',
  '(wish|want|would\\s+like|intend|intending|looking|plan(ning)?)\\s+to\\s+(cancel|terminate|leave|end|close|stop)',
  // Leaving / switching provider
  'leav(e|ing)\\s+(nurtur|briefyourmarket|bym|you|your\\s+(service|platform))',
  '(switch|switching|mov(e|ing))\\s+(to\\s+)?(another|a\\s+different|new)\\s+(provider|supplier|system|crm|software|platform)',
];

export interface CancellationMatch {
  matched: boolean;
  phrase: string | null;
}

function loadPatterns(settings?: SettingsQueries | null): RegExp[] {
  let sources = DEFAULT_PATTERNS;
  const override = settings?.get('agent_cancellation_patterns');
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (Array.isArray(parsed) && parsed.every(p => typeof p === 'string') && parsed.length > 0) {
        sources = parsed;
      }
    } catch { /* keep defaults on malformed config */ }
  }
  const compiled: RegExp[] = [];
  for (const src of sources) {
    try {
      compiled.push(new RegExp(`\\b(?:${src})`, 'i'));
    } catch { /* skip invalid pattern */ }
  }
  return compiled;
}

export function isCancellationGuardrailEnabled(settings?: SettingsQueries | null): boolean {
  return settings?.get('agent_cancellation_guardrail_enabled') !== 'false';
}

export function detectCancellationIntent(text: string, settings?: SettingsQueries | null): CancellationMatch {
  if (!text) return { matched: false, phrase: null };
  for (const re of loadPatterns(settings)) {
    const m = text.match(re);
    if (m) return { matched: true, phrase: m[0] };
  }
  return { matched: false, phrase: null };
}

export function buildCancellationHoldingResponse(ticketKey: string, settings?: SettingsQueries | null): string {
  const template = settings?.get('agent_cancellation_holding_response');
  if (template && template.trim()) {
    return template.replaceAll('{{ticket_key}}', ticketKey);
  }
  return `Hi,\n\n`
    + `Thank you for getting in touch. We've received your message and a member of our team `
    + `will be in touch with you directly to help with this.\n\n`
    + `We appreciate your patience in the meantime.\n\n`
    + `(Ref: ${ticketKey})`;
}
