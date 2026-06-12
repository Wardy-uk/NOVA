/**
 * Shared Adobe Sign agreement creation.
 *
 * Both the direct send path (POST /api/adobe-sign/agreements) and the
 * contract-approval release path (POST /api/public/contract-approvals/callback,
 * on approve) need to create + send an agreement from one or more Adobe library
 * documents, with pre-approved contract terms auto-injected into matching fields.
 *
 * This module owns that shared logic — and ONLY that. It does no DB writes; each
 * caller persists the result its own way (the direct path inserts a fresh row, the
 * approval path rewrites the held row). Subscription-contract-number formatting also
 * lives here so both callers allocate numbers identically.
 */

import type { AdobeSignClient } from './adobe-sign-client.js';

export const SUBSCRIPTION_CONTRACT_COUNTER = 'subscription_contract_no';
const SUBSCRIPTION_CONTRACT_PREFIX = 'NOVA-';
const SUBSCRIPTION_CONTRACT_PAD = 10;

export function formatSubscriptionContractNo(n: number): string {
  return SUBSCRIPTION_CONTRACT_PREFIX + n.toString().padStart(SUBSCRIPTION_CONTRACT_PAD, '0');
}

export const DEFAULT_TERMS_FIELD_PREFIX = 'contract terms';

// Case- and separator-agnostic normalisation. "BYM Contract Terms" -> "bym contract terms".
export function normaliseFieldName(s: string): string {
  return (s ?? '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
}

// Substring match: a field "matches" the terms phrase if its name CONTAINS it anywhere.
// So "BYM Contract Terms", "Contract Terms Yomdel", "contract_terms_bym" all match the
// phrase "contract terms" — accommodates brand-prefixed names, not just leading prefixes.
export function fieldMatchesPrefix(fieldName: string, prefix: string): boolean {
  const n = normaliseFieldName(fieldName);
  const p = normaliseFieldName(prefix);
  return p.length > 0 && n.includes(p);
}

export interface MergeField { fieldName: string; defaultValue: string }

// A pre-approved term (or concatenation of terms) routed to a specific Adobe field.
export interface TargetedTerm { field_name: string; text: string }

// The intended create-agreement request, in the snake_case shape the wizard POSTs.
// Stored verbatim as JSON in approval_payload so the approval callback can replay it.
export interface CreateAgreementInput {
  library_document_ids: string[];
  name: string;
  signer_emails: string[];
  cc_emails?: string[];
  message?: string;
  merge_fields?: MergeField[];
  expiration_days?: number;
  // Untargeted pre-approved terms — injected into any field starting with the prefix.
  contract_terms_text?: string;
  // Targeted pre-approved terms — each injected into its named field specifically.
  contract_terms_targeted?: TargetedTerm[];
}

export interface CreateAgreementOutput {
  agreementId: string;
  // Final merge fields actually sent to Adobe (sender values + auto-injected terms).
  mergeFields: MergeField[];
  termsFieldsPopulated: Array<{ fieldName: string; libraryDocumentId: string }>;
}

/**
 * Creates and sends an Adobe Sign agreement. Auto-detects 'contract terms…' fields on
 * each template and injects pre-approved terms (targeted by exact field name, or by the
 * prefix sweep). Where a sender also typed custom text into the same field, the two are
 * combined (pre-approved first, custom appended). Returns the Adobe agreement id and the
 * final merge field set. Throws on Adobe API failure — callers surface the error.
 */
export async function createAdobeAgreement(
  client: AdobeSignClient,
  settings: Record<string, string>,
  input: CreateAgreementInput,
): Promise<CreateAgreementOutput> {
  const cleanIds = (input.library_document_ids as unknown[])
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

  const allMergeFields: MergeField[] = Array.isArray(input.merge_fields)
    ? input.merge_fields.filter((m): m is MergeField => typeof m?.fieldName === 'string')
    : [];

  const termsFieldsPopulated: Array<{ fieldName: string; libraryDocumentId: string }> = [];
  const termsText = typeof input.contract_terms_text === 'string' ? input.contract_terms_text.trim() : '';
  const targetedTerms: TargetedTerm[] = Array.isArray(input.contract_terms_targeted)
    ? input.contract_terms_targeted.filter((t): t is TargetedTerm =>
        typeof t?.field_name === 'string' && typeof t?.text === 'string' && t.text.trim().length > 0)
    : [];

  if (termsText || targetedTerms.length > 0) {
    const prefix = (settings.adobe_sign_terms_field_prefix || DEFAULT_TERMS_FIELD_PREFIX).trim();

    // Fetch each template's fields once.
    const fieldCache = new Map<string, Array<{ name: string }>>();
    const getFields = async (docId: string): Promise<Array<{ name: string }>> => {
      if (fieldCache.has(docId)) return fieldCache.get(docId)!;
      try {
        const f = await client.getLibraryDocumentFormFields(docId);
        fieldCache.set(docId, f);
        return f;
      } catch (err) {
        console.warn(`[Adobe Sign] Could not fetch form fields for ${docId} (terms inject):`, err instanceof Error ? err.message : err);
        fieldCache.set(docId, []);
        return [];
      }
    };

    // Resolve which ACTUAL Adobe field each pre-approved source maps to.
    // Targeted terms (exact, case/separator-insensitive match) win over the
    // untargeted prefix sweep for the same field.
    const preApproved = new Map<string, { text: string; docId: string }>();

    for (const tt of targetedTerms) {
      const wanted = normaliseFieldName(tt.field_name);
      for (const docId of cleanIds) {
        for (const f of await getFields(docId)) {
          if (normaliseFieldName(f.name) === wanted && !preApproved.has(f.name)) {
            preApproved.set(f.name, { text: tt.text.trim(), docId });
          }
        }
      }
    }

    if (termsText) {
      for (const docId of cleanIds) {
        for (const f of await getFields(docId)) {
          if (fieldMatchesPrefix(f.name, prefix) && !preApproved.has(f.name)) {
            preApproved.set(f.name, { text: termsText, docId });
          }
        }
      }
    }

    // Merge pre-approved text with any sender-typed value for the same field.
    // Order: pre-approved first, then the sender's custom text appended below.
    // (When a sender both types custom terms AND ticks a pre-approved term for the
    // same field, the contract carries both — and the custom text still triggers
    // the approval gate upstream.)
    for (const [fieldName, { text, docId }] of preApproved) {
      const existing = allMergeFields.find(m => m.fieldName === fieldName);
      const senderVal = existing?.defaultValue?.trim();
      const combined = senderVal ? `${text}\n\n${senderVal}` : text;
      if (existing) existing.defaultValue = combined;
      else allMergeFields.push({ fieldName, defaultValue: combined });
      termsFieldsPopulated.push({ fieldName, libraryDocumentId: docId });
    }
  }

  const result = await client.createAgreement({
    name: input.name,
    signerEmails: input.signer_emails,
    ccEmails: input.cc_emails,
    message: input.message,
    libraryDocumentIds: cleanIds,
    mergeFields: allMergeFields.length > 0 ? allMergeFields : undefined,
    expirationDays: input.expiration_days,
  });

  return { agreementId: result.id, mergeFields: allMergeFields, termsFieldsPopulated };
}
