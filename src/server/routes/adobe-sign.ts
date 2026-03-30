import { Router } from 'express';
import type { AdobeSignClient } from '../services/adobe-sign-client.js';
import type { AdobeSignAgreementQueries, ContractTemplateQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

export function createAdobeSignRoutes(
  getClient: () => AdobeSignClient | null,
  agreementQueries: AdobeSignAgreementQueries,
  templateQueries: ContractTemplateQueries,
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
  router.get('/agreements', (req, res) => {
    const agreements = agreementQueries.getAll({
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

        agreementQueries.upsert({
          agreement_id: a.id,
          contract_id: null,
          template_id: null,
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
  router.get('/agreements/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const agreement = agreementQueries.getById(id);
    if (!agreement) { res.status(404).json({ ok: false, error: 'Agreement not found' }); return; }
    res.json({ ok: true, data: agreement });
  });

  // POST /api/adobe-sign/agreements — create + send new agreement
  router.post('/agreements', async (req, res) => {
    const client = getClient();
    if (!client) {
      res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' });
      return;
    }

    const { template_id, contract_id, name, signer_emails, cc_emails, message, merge_fields, expiration_days } = req.body;
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'name is required' }); return; }
    if (!signer_emails?.length) { res.status(400).json({ ok: false, error: 'At least one signer email is required' }); return; }

    try {
      let transientDocumentId: string | undefined;
      let libraryDocumentId: string | undefined;

      // If a local template is selected, upload its file as a transient document
      if (template_id) {
        const template = templateQueries.getById(template_id);
        if (template?.adobe_library_doc_id) {
          libraryDocumentId = template.adobe_library_doc_id;
        } else if (template?.file_data) {
          const result = await client.uploadTransientDocument(
            Buffer.from(template.file_data),
            template.file_name ?? 'document.pdf',
            template.file_mime ?? 'application/pdf',
          );
          transientDocumentId = result.transientDocumentId;
        }
      }

      if (!transientDocumentId && !libraryDocumentId) {
        res.status(400).json({ ok: false, error: 'No document source — template must have a file or Adobe library document ID' });
        return;
      }

      const result = await client.createAgreement({
        name,
        signerEmails: signer_emails,
        ccEmails: cc_emails,
        message,
        transientDocumentId,
        libraryDocumentId,
        mergeFields: merge_fields,
        expirationDays: expiration_days,
      });

      // Store in local DB
      agreementQueries.upsert({
        agreement_id: result.id,
        contract_id: contract_id ?? null,
        template_id: template_id ?? null,
        name,
        status: 'OUT_FOR_SIGNATURE',
        sender_email: null,
        signer_emails: JSON.stringify(signer_emails),
        filled_fields: merge_fields ? JSON.stringify(merge_fields) : null,
        created_via_nova: 1,
        adobe_created_date: new Date().toISOString(),
        adobe_expiration_date: null,
        signed_document_url: null,
        raw_data: JSON.stringify(result),
        synced_at: new Date().toISOString(),
      });

      res.json({ ok: true, data: { agreement_id: result.id } });
    } catch (err) {
      console.error('[Adobe Sign] Create agreement error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to create agreement' });
    }
  });

  // GET /api/adobe-sign/agreements/:id/download — download signed document
  router.get('/agreements/:id/download', async (req, res) => {
    const client = getClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' }); return; }

    const agreement = agreementQueries.getById(parseInt(req.params.id, 10));
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

  router.get('/library-documents', async (_req, res) => {
    const client = getClient();
    if (!client) { res.status(503).json({ ok: false, error: 'Adobe Sign is not connected.' }); return; }
    try {
      const docs = await client.getLibraryDocuments();
      res.json({ ok: true, data: docs });
    } catch (err) {
      console.error('[Adobe Sign] Library documents error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to fetch library documents' });
    }
  });

  // ── Local Contract Templates ──

  router.get('/templates', (req, res) => {
    const templates = templateQueries.getAll({
      status: req.query.status as string | undefined,
      category: req.query.category as string | undefined,
      search: req.query.search as string | undefined,
    });
    res.json({ ok: true, data: templates });
  });

  router.get('/templates/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const template = templateQueries.getById(id);
    if (!template) { res.status(404).json({ ok: false, error: 'Template not found' }); return; }
    // Don't send file_data in JSON — use separate download endpoint
    const { file_data, ...rest } = template;
    res.json({ ok: true, data: { ...rest, has_file: !!file_data } });
  });

  router.post('/templates', (req, res) => {
    const { name, description, category, fields_schema, adobe_library_doc_id, file_base64, file_name, file_mime } = req.body;
    if (!name?.trim()) { res.status(400).json({ ok: false, error: 'name is required' }); return; }

    const userId = (req as any).user?.id;
    const fileData = file_base64 ? Buffer.from(file_base64, 'base64') : undefined;

    const id = templateQueries.create({
      name,
      description,
      category,
      fields_schema: fields_schema ? JSON.stringify(fields_schema) : undefined,
      adobe_library_doc_id,
      file_data: fileData,
      file_name,
      file_mime,
      created_by: userId,
    });
    res.json({ ok: true, data: { id } });
  });

  router.put('/templates/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }

    const { name, description, category, fields_schema, adobe_library_doc_id, file_base64, file_name, file_mime, status } = req.body;
    const fileData = file_base64 ? Buffer.from(file_base64, 'base64') : undefined;

    const updated = templateQueries.update(id, {
      name, description, category,
      fields_schema: fields_schema ? JSON.stringify(fields_schema) : undefined,
      adobe_library_doc_id,
      file_data: fileData,
      file_name, file_mime, status,
    });
    if (!updated) { res.status(404).json({ ok: false, error: 'Template not found' }); return; }
    res.json({ ok: true });
  });

  router.delete('/templates/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const deleted = templateQueries.delete(id);
    if (!deleted) { res.status(404).json({ ok: false, error: 'Template not found' }); return; }
    res.json({ ok: true });
  });

  // GET /api/adobe-sign/templates/:id/download — download template file
  router.get('/templates/:id/download', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ ok: false, error: 'Invalid id' }); return; }
    const template = templateQueries.getById(id);
    if (!template?.file_data) { res.status(404).json({ ok: false, error: 'No file attached' }); return; }
    res.setHeader('Content-Type', template.file_mime ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${template.file_name ?? 'template'}"`);
    res.send(Buffer.from(template.file_data));
  });

  return router;
}
