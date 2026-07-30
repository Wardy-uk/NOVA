export interface RedactionResult {
  sanitised: string;
  redactions: RedactionEntry[];
}

export interface RedactionEntry {
  type: string;
  count: number;
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

const CARD_RE = /\b(\d[\d\s\-]{11,22}\d)\b/g;

function redactCards(text: string, entries: RedactionEntry[]): string {
  let count = 0;
  const result = text.replace(CARD_RE, (match) => {
    const digits = match.replace(/[\s\-]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      count++;
      return '[REDACTED-CARD]';
    }
    return match;
  });
  if (count > 0) entries.push({ type: 'card', count });
  return result;
}

const AWS_KEY_RE = /\bAKIA[0-9A-Z]{16}\b/g;
const GITHUB_TOKEN_RE = /\bg(hp|ho|hs|hr|hu)_[A-Za-z0-9_]{36,}\b/g;
const GENERIC_SECRET_RE = /\b(?:sk[-_]|secret[-_]|api[-_]?key[-_]?)[A-Za-z0-9\-_]{20,}\b/gi;

function redactApiKeys(text: string, entries: RedactionEntry[]): string {
  let count = 0;
  let result = text.replace(AWS_KEY_RE, () => { count++; return '[REDACTED-KEY]'; });
  result = result.replace(GITHUB_TOKEN_RE, () => { count++; return '[REDACTED-KEY]'; });
  result = result.replace(GENERIC_SECRET_RE, () => { count++; return '[REDACTED-KEY]'; });
  if (count > 0) entries.push({ type: 'api_key', count });
  return result;
}

const INTL_PHONE_RE = /\+\d{1,3}[\s\-.]?\(?\d{2,4}\)?[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b/g;
const FORMATTED_PHONE_RE = /\(?\d{2,4}\)[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b/g;
const SPACED_PHONE_RE = /\b\d{3,5}[\s\-.]\d{3,4}[\s\-.]\d{3,4}\b/g;

function redactPhones(text: string, entries: RedactionEntry[]): string {
  let count = 0;
  let result = text.replace(INTL_PHONE_RE, () => { count++; return '[REDACTED-PHONE]'; });
  result = result.replace(FORMATTED_PHONE_RE, () => { count++; return '[REDACTED-PHONE]'; });
  result = result.replace(SPACED_PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) {
      count++;
      return '[REDACTED-PHONE]';
    }
    return match;
  });
  if (count > 0) entries.push({ type: 'phone', count });
  return result;
}

export function sanitise(text: string, opts?: { skipPhones?: boolean }): RedactionResult {
  const redactions: RedactionEntry[] = [];
  let sanitised = text;
  sanitised = redactCards(sanitised, redactions);
  sanitised = redactApiKeys(sanitised, redactions);
  // Phone redaction can be skipped for trusted extraction (e.g. Guild form
  // import), where the phone number is legitimate data the user is submitting.
  if (!opts?.skipPhones) sanitised = redactPhones(sanitised, redactions);
  return { sanitised, redactions };
}
