import type { SettingsQueries } from '../db/settings-store.js';

// Auto-reply / non-actionable mail guardrail.
//
// Mail systems generate tickets that are not real support requests: out-of-office
// auto-replies, bounce-backs, delivery-failure notifications, read receipts. The triage
// LLM is supposed to treat these as spam and auto-close, but it is unreliable here — a
// subject like "Automatic reply: Resolved: NTPJ-8534" reads to the model like a real
// ticket, so it drafts a reply instead. That clutters the approval queue with misleading
// "Draft Response" decisions and risks NOVA replying to a no-reply mailbox.
//
// Detection is intentionally PRECISION-biased (the opposite of the cancellation guardrail):
// a false positive auto-closes a real ticket, so we only match unambiguous mail-system
// SUBJECT PREFIXES, never bare phrases like "out of office" that appear in genuine tickets.

interface AutoReplyPattern { re: RegExp; kind: 'out_of_office' | 'auto_reply'; }

// Anchored to the start of the subject (optionally behind "Re:"/"Fwd:") because these are
// always mail-generated prefixes, never mid-sentence. Compiled case-insensitively.
const DEFAULT_SOURCES: Array<{ src: string; kind: 'out_of_office' | 'auto_reply' }> = [
  // Out-of-office (Outlook/Gmail emit "Automatic reply:" / "Auto-Reply:")
  { src: 'automatic reply', kind: 'out_of_office' },
  { src: 'auto-?reply', kind: 'out_of_office' },
  { src: 'out of office auto', kind: 'out_of_office' },
  { src: 'automatische antwort', kind: 'out_of_office' }, // common non-EN OOO prefix
  // Bounce-backs / delivery failures
  { src: 'undeliverable', kind: 'auto_reply' },
  { src: 'undelivered mail returned', kind: 'auto_reply' },
  { src: 'delivery status notification', kind: 'auto_reply' },
  { src: 'mail delivery (failed|subsystem|system)', kind: 'auto_reply' },
  { src: 'returned mail', kind: 'auto_reply' },
  { src: 'failure notice', kind: 'auto_reply' },
];

export interface AutoReplyMatch {
  matched: boolean;
  phrase: string | null;
  kind: 'out_of_office' | 'auto_reply' | null;
}

function loadPatterns(settings?: SettingsQueries | null): AutoReplyPattern[] {
  let sources = DEFAULT_SOURCES;
  const override = settings?.get('agent_auto_reply_patterns');
  if (override) {
    try {
      const parsed = JSON.parse(override);
      if (Array.isArray(parsed) && parsed.length > 0
        && parsed.every(p => p && typeof p.src === 'string' && (p.kind === 'out_of_office' || p.kind === 'auto_reply'))) {
        sources = parsed;
      }
    } catch { /* keep defaults on malformed config */ }
  }
  const compiled: AutoReplyPattern[] = [];
  for (const { src, kind } of sources) {
    try {
      // ^ optional Re:/Fwd: prefix, then the marker, then a word boundary or ":" / "-".
      compiled.push({ re: new RegExp(`^\\s*(?:(?:re|fwd?)\\s*:\\s*)*(?:${src})\\b`, 'i'), kind });
    } catch { /* skip invalid pattern */ }
  }
  return compiled;
}

export function isAutoReplyGuardrailEnabled(settings?: SettingsQueries | null): boolean {
  return settings?.get('agent_auto_reply_guardrail_enabled') !== 'false';
}

/**
 * Detect a mail-generated auto-reply / bounce from the ticket SUBJECT.
 * Matched against the subject only — bodies contain too many false-positive phrases.
 */
export function detectAutoReply(subject: string, settings?: SettingsQueries | null): AutoReplyMatch {
  if (!subject) return { matched: false, phrase: null, kind: null };
  for (const { re, kind } of loadPatterns(settings)) {
    const m = subject.match(re);
    if (m) return { matched: true, phrase: m[0].trim(), kind };
  }
  return { matched: false, phrase: null, kind: null };
}
