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

// Case- and separator-agnostic prefix match.
// Matches "contract terms bym", "contract_terms_bym", "ContractTermsBYM", etc.
export function normaliseFieldName(s: string): string {
  return (s ?? '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
}

export function fieldMatchesPrefix(fieldName: string, prefix: string): boolean {
  const n = normaliseFieldName(fieldName);
  const p = normaliseFieldName(prefix);
  return p.length > 0 && n.startsWith(p);
}

export interface MergeField { fieldName: string; defaultValue: string }

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
  contract_terms_text?: string;
}

export interface CreateAgreementOutput {
  agreementId: string;
  // Final merge fields actually sent to Adobe (sender values + auto-injected terms).
  mergeFields: MergeField[];
  termsFieldsPopulated: Array<{ fieldName: string; libraryDocumentId: string }>;
}

/**
 * Creates and sends an Adobe Sign agreement. Auto-detects 'contract terms…' fields on
 * each template and injects the concatenated pre-approved terms text into any not
 * explicitly provided by the sender. Returns the Adobe agreement id and the final
 * merge field set. Throws on Adobe API failure — callers surface the error.
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

  if (termsText) {
    const prefix = (settings.adobe_sign_terms_field_prefix || DEFAULT_TERMS_FIELD_PREFIX).trim();
    const explicitlyProvided = new Set(allMergeFields.map(f => f.fieldName));
    const populated = new Set<string>();
    for (const docId of cleanIds) {
      try {
        const fields = await client.getLibraryDocumentFormFields(docId);
        for (const f of fields) {
          if (!fieldMatchesPrefix(f.name, prefix)) continue;
          if (explicitlyProvided.has(f.name)) continue;
          if (populated.has(f.name)) continue;
          allMergeFields.push({ fieldName: f.name, defaultValue: termsText });
          populated.add(f.name);
          termsFieldsPopulated.push({ fieldName: f.name, libraryDocumentId: docId });
        }
      } catch (err) {
        console.warn(`[Adobe Sign] Could not fetch form fields for ${docId} (terms auto-detect):`, err instanceof Error ? err.message : err);
      }
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
