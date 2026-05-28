import { Router } from 'express';
import { AdobeSignApiError, type AdobeSignClient } from '../services/adobe-sign-client.js';
import type { AdobeSignAgreementQueries, AgreementFieldValueQueries, CounterQueries, TemplateFieldOverrideQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { BcSubscriptionImportService } from '../services/bc-subscription-import-service.js';

const SUBSCRIPTION_CONTRACT_COUNTER = 'subscription_contract_no';
const SUBSCRIPTION_CONTRACT_PREFIX = 'NOVA-';
const SUBSCRIPTION_CONTRACT_PAD = 10;

function formatSubscriptionContractNo(n: number): string {
  return SUBSCRIPTION_CONTRACT_PREFIX + n.toString().padStart(SUBSCRIPTION_CONTRACT_PAD, '0');
}

// Signer-only field types — these are filled at signing time, never by the sender.
// Anything NOT in this set is shown as a sender-fillable input in the wizard.
const SIGNER_ONLY_FIELD_TYPES = new Set([
  'SIGNATURE_FIELD',
  'SIGNATURE',
  'SIGNATURE_BLOCK',
  'INITIALS_FIELD',
  'INITIALS',
  'DATE_OF_SIGNING_FIELD',
  'DATE_OF_SIGNING',
  'HYPERLINK_FIELD',
  'HYPERLINK',
]);

const DEFAULT_TERMS_FIELD_PREFIX = 'contract terms';

// Case- and separator-agnostic prefix match.
// Matches "contract terms bym", "contract_terms_bym", "ContractTermsBYM", etc.
function normaliseFieldName(s: string): string {
  return (s ?? '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
}

function fieldMatchesPrefix(fieldName: string, prefix: string): boolean {
  const n = normaliseFieldName(fieldName);
  const p = normaliseFieldName(prefix);
  return p.length > 0 && n.startsWith(p);
}

function adobeError(err: unknown): { status: number; error: string; retryAfter?: number } {
  if (err instanceof AdobeSignApiError) {
    return {
      status: err.statusCode === 429 ? 429 : 500,
      error: err.message,
      retryAfter: err.retryAfterSeconds,
    };
  }
  return { status: 500, error: err instanceof Error ? err.message : 'Unknown error' };
}

export function createAdobeSignRoutes(
  getClient: () => AdobeSignClient | null,
  agreementQueries: AdobeSignAgreementQueries,
  fieldValueQueries: AgreementFieldValueQueries,
  counterQueries: CounterQueries,
  templateFieldOverrideQueries: TemplateFieldOverrideQueries,
  bcSubscriptionImportService: BcSubscriptionImportService,
  settingsQueries: FileSettingsQueries,
): Router {
  const router = Router();

  // ── OAuth Flow ──

  // GET /api/adobe-sign/auth-url — generate OAuth consent URL
  router.get('/auth-url', (_req, res) => {
    const client = getClient();
    if (!client) {
      res.status(503).json({ ok: false, error: 'Adobe Sign is not configured. Add credentials in Admin > Integrations.' });
      return;
    }
    const url = client.getAuthUrl();
    res.json({ ok: true, data: { url } });
  });

  // GET /api/adobe-sign/callback — OAuth callback, exchange code for tokens
  router.get('/callback', async (req, res) => {
    const client = getClient();
    const code = req.query.code as string | undefined;
    if (!client) {
      res.status(503).json({ ok: false, error: 'Adobe Sign is not configured.' });
      return;
    }
    if (!code) {
      const error = req.query.error as string | undefined;
      res.status(400).json({ ok: false, error: error ?? 'No authorization code received' });
      return;
    }
    try {
      await client.exchangeCode(code);
      // Redirect back to the Adobe Sign view in the SPA
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}/#adobe-sign?connected=1`);
    } catch (err) {
      console.error('[Adobe Sign] OAuth callback error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'OAuth exchange failed' });
    }
  });

  // GET /api/adobe-sign/status — connection status
  router.get('/status', (_req, res) => {
    const client = getClient();
    if (!client) {
      res.json({ ok: true, data: { status: 'not_configured' } });
      return;
    }
    res.json({ ok: true, data: client.getStatus() });
  });

  // POST /api/adobe-sign/disconnect — clear tokens
  router.post('/disconnect', (_req, res) => {
    const client = getClient();
    if (client) {
      client.disconnect();
      settingsQueries.set('adobe_sign_refresh_token', '');
    }
    res.json({ ok: true });
  });

  // ── Agreements ──

  // GET /api/adobe-sign/agreements — list from local DB
  router.get('/agreements', async (req, res) => {
    const agreements = await agreementQueries.getAll({
      status: req.query.status as string | undefined,
      search: req.query.search as string | undefined,
      contract_id: req.query.contract_id ? parseInt(req.query.contract_id as string, 10) : undefined,
    });
    res.json({ ok: true, data: agreements });
  });

  // POST /api/adobe-sign/agreements/sync — sync from Adobe Sign API
  router.post('/agreements/sync', async (_req, res) => {
    const client = getClient();
    if (!client) {
      res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' });
      return;
    }
    try {
      const remoteAgreements = await client.listAgreements();
      let synced = 0;
      for (const a of remoteAgreements) {
        const signerEmails = a.participantSetsInfo
          ?.filter(ps => ps.role === 'SIGNER')
          .flatMap(ps => ps.memberInfos.map(m => m.email)) ?? [];

        await agreementQueries.upsert({
          agreement_id: a.id,
          contract_id: null,
          bc_customer_id: null,
          subscription_contract_no: null,
          name: a.name,
          status: a.status,
          sender_email: a.senderEmail ?? null,
          signer_emails: JSON.stringify(signerEmails),
          filled_fields: null,
          created_via_nova: 0,
          adobe_created_date: a.createdDate ?? null,
          adobe_expiration_date: a.expirationDate ?? null,
          signed_document_url: null,
          raw_data: JSON.stringify(a),
          synced_at: new Date().toISOString(),
        });
        synced++;
      }
      res.json({ ok: true, synced });
    } catch (err) {
      console.error('[Adobe Sign] Sync error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' });
    }
  });

  // GET /api/adobe-sign/agreements/:id — single agreement detail
  router.get('/agreements/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const agreement = await agreementQueries.getById(id);
    if (!agreement) { res.status(404).json({ ok: false, error: 'Agreement not found' }); return; }
    res.json({ ok: true, data: agreement });
  });

  // POST /api/adobe-sign/agreements — create + send new agreement from one or more Adobe library documents.
  // Multiple library_document_ids are concatenated by Adobe in array order into a single signable agreement.
  router.post('/agreements', async (req, res) => {
    const client = getClient();
    if (!client) {
      res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' });
      return;
    }

    const { library_document_ids, contract_id, bc_customer_id, name, signer_emails, cc_emails, message, merge_fields, expiration_days, contract_terms_text } = req.body;
    if (!Array.isArray(library_document_ids) || library_document_ids.length === 0) {
      res.status(400).json({ ok: false, error: 'library_document_ids must be a non-empty array' });
      return;
    }
    const cleanIds = (library_document_ids as unknown[])
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    if (cleanIds.length === 0) {
      res.status(400).json({ ok: false, error: 'library_document_ids must contain at least one non-empty string' });
      return;
    }
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    if (!signer_emails?.length) { res.status(400).json({ ok: false, error: 'At least one signer email is required' }); return; }

    // Auto-detect terms fields on each template and inject the concatenated terms text.
    // Field names matching the configured prefix (default 'contract terms') receive the same value.
    const allMergeFields: Array<{ fieldName: string; defaultValue: string }> = Array.isArray(merge_fields)
      ? merge_fields.filter((m: { fieldName?: unknown }) => typeof m?.fieldName === 'string')
      : [];
    let termsFieldsPopulated: Array<{ fieldName: string; libraryDocumentId: string }> = [];
    const termsText = typeof contract_terms_text === 'string' ? contract_terms_text.trim() : '';

    if (termsText) {
      const settings = settingsQueries.getAll();
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

    try {
      const result = await client.createAgreement({
        name,
        signerEmails: signer_emails,
        ccEmails: cc_emails,
        message,
        libraryDocumentIds: cleanIds,
        mergeFields: allMergeFields.length > 0 ? allMergeFields : undefined,
        expirationDays: expiration_days,
      });

      // Allocate the NOVA-NNNNNNNNNN subscription contract number now so it's stored
      // on the agreement alongside the Adobe agreement id. Post-sign handler reads
      // this to know what to write to BC's importedCustomerSubscriptionContracts.
      const counterValue = await counterQueries.nextValue(SUBSCRIPTION_CONTRACT_COUNTER);
      const subscriptionContractNo = formatSubscriptionContractNo(counterValue);

      await agreementQueries.upsert({
        agreement_id: result.id,
        contract_id: contract_id ?? null,
        bc_customer_id: typeof bc_customer_id === 'string' && bc_customer_id.trim() ? bc_customer_id.trim() : null,
        subscription_contract_no: subscriptionContractNo,
        name,
        status: 'OUT_FOR_SIGNATURE',
        sender_email: null,
        signer_emails: JSON.stringify(signer_emails),
        filled_fields: allMergeFields.length > 0 ? JSON.stringify(allMergeFields) : null,
        created_via_nova: 1,
        adobe_created_date: new Date().toISOString(),
        adobe_expiration_date: null,
        signed_document_url: null,
        raw_data: JSON.stringify(result),
        synced_at: new Date().toISOString(),
      });

      // Capture every sender-filled merge field into agreement_field_values so the
      // post-sign handler doesn't have to refetch from Adobe. Signer can't modify
      // anything per current Adobe template policy, so SENDER is the only source.
      if (allMergeFields.length > 0) {
        await fieldValueQueries.bulkInsert(result.id, 'SENDER',
          allMergeFields.map(m => ({ field_name: m.fieldName, field_value: m.defaultValue ?? null })));
      }

      res.json({ ok: true, data: { agreement_id: result.id, subscription_contract_no: subscriptionContractNo, terms_fields_populated: termsFieldsPopulated } });
    } catch (err) {
      console.error('[Adobe Sign] Create agreement error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create agreement' });
    }
  });

  // POST /api/adobe-sign/agreements/:id/push-to-bc — manual trigger for the BC
  // Subscription Import write. Takes the LOCAL adobe_sign_agreements.id (int),
  // looks up the agreement_id (Adobe's GUID), and delegates to the service.
  // Used for testing or retrying a failed import without waiting for sign sync.
  // Auto-fire on SIGNED is intentionally NOT wired yet — verify the field
  // names land in BC successfully via this manual path first, then we flip
  // the post-sign handler to auto-fire.
  router.post('/agreements/:id/push-to-bc', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const agreement = await agreementQueries.getById(id);
    if (!agreement) { res.status(404).json({ ok: false, error: 'Agreement not found' }); return; }

    try {
      const result = await bcSubscriptionImportService.pushAgreementToBC(agreement.agreement_id);
      res.json({ ok: true, data: result });
    } catch (err) {
      console.error('[Adobe Sign] BC push error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'BC push failed' });
    }
  });

  // GET /api/adobe-sign/agreements/:id/download — download signed document
  router.get('/agreements/:id/download', async (req, res) => {
    const client = getClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' }); return; }

    const agreement = await agreementQueries.getById(parseInt(req.params.id, 10));
    if (!agreement) { res.status(404).json({ ok: false, error: 'Agreement not found' }); return; }

    try {
      const pdfBuffer = await client.downloadSignedDocument(agreement.agreement_id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${agreement.name}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('[Adobe Sign] Download error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Download failed' });
    }
  });

  // ── Library Documents (from Adobe Sign) ──

  router.get('/library-documents', async (req, res) => {
    const client = getClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' }); return; }
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    try {
      const docs = await client.getLibraryDocuments(force);
      res.json({ ok: true, data: docs });
    } catch (err) {
      console.error('[Adobe Sign] Library documents error:', err);
      const e = adobeError(err);
      res.status(e.status).json({ ok: false, error: e.error, retryAfter: e.retryAfter });
    }
  });

  // GET /api/adobe-sign/terms-prefix — returns the configured prefix used to auto-detect
  // contract-terms merge fields on templates. Default 'contract terms'.
  router.get('/terms-prefix', (_req, res) => {
    const s = settingsQueries.getAll();
    const prefix = (s.adobe_sign_terms_field_prefix || DEFAULT_TERMS_FIELD_PREFIX).trim();
    res.json({ ok: true, data: { prefix } });
  });

  // GET /api/adobe-sign/library-documents/:id/form-fields
  // Returns sender-fillable merge fields defined on the Adobe template.
  // Signature/initials/etc. fields are excluded — those are signer-only.
  // ?debug=1 returns the raw Adobe response untouched plus our parsed list — for diagnosis only.
  router.get('/library-documents/:id/form-fields', async (req, res) => {
    const client = getClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' }); return; }
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    const debug = req.query.debug === '1' || req.query.debug === 'true';
    try {
      if (debug) {
        const raw = await client.getLibraryDocumentFormFieldsRaw(req.params.id);
        const parsed = await client.getLibraryDocumentFormFields(req.params.id, true);
        res.json({ ok: true, data: parsed, raw });
        return;
      }
      const all = await client.getLibraryDocumentFormFields(req.params.id, force);
      const senderFillable = all.filter(f => !SIGNER_ONLY_FIELD_TYPES.has(f.contentType));
      res.json({ ok: true, data: senderFillable });
    } catch (err) {
      console.error('[Adobe Sign] Form fields error:', err);
      const e = adobeError(err);
      res.status(e.status).json({ ok: false, error: e.error, retryAfter: e.retryAfter });
    }
  });

  // ── Per-template "signer fills" overrides ──
  // The wizard reads these to push additional fields into the Signer panel,
  // on top of whatever Adobe's assignee says. Scoped per Adobe library
  // document id so an override on BYM doesn't bleed into Yomdel.

  // GET /api/adobe-sign/templates/:libraryDocId/signer-overrides
  router.get('/templates/:libraryDocId/signer-overrides', async (req, res) => {
    const templateId = req.params.libraryDocId;
    if (!templateId?.trim()) { res.status(400).json({ ok: false, error: 'libraryDocId required' }); return; }
    const rows = await templateFieldOverrideQueries.getByTemplateId(templateId);
    res.json({ ok: true, data: rows });
  });

  // POST /api/adobe-sign/templates/:libraryDocId/signer-overrides  { field_name }
  router.post('/templates/:libraryDocId/signer-overrides', async (req, res) => {
    const templateId = req.params.libraryDocId;
    const fieldName = typeof req.body?.field_name === 'string' ? req.body.field_name.trim() : '';
    if (!templateId?.trim()) { res.status(400).json({ ok: false, error: 'libraryDocId required' }); return; }
    if (!fieldName) { res.status(400).json({ ok: false, error: 'field_name required' }); return; }
    const userId = (req as any).user?.id ?? null;
    await templateFieldOverrideQueries.add(templateId, fieldName, userId);
    res.json({ ok: true });
  });

  // DELETE /api/adobe-sign/templates/:libraryDocId/signer-overrides/:fieldName
  // Field name in URL — express decodes it. Caller must encodeURIComponent.
  router.delete('/templates/:libraryDocId/signer-overrides/:fieldName', async (req, res) => {
    const templateId = req.params.libraryDocId;
    const fieldName = req.params.fieldName;
    if (!templateId?.trim() || !fieldName?.trim()) {
      res.status(400).json({ ok: false, error: 'libraryDocId and fieldName required' });
      return;
    }
    await templateFieldOverrideQueries.remove(templateId, fieldName);
    res.json({ ok: true });
  });

  return router;
}
