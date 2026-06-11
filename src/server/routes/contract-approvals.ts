import { Router, type RequestHandler } from 'express';
import type { AdobeSignClient } from '../services/adobe-sign-client.js';
import type { AdobeSignAgreementQueries, AgreementFieldValueQueries, CounterQueries } from '../db/queries.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import {
  SUBSCRIPTION_CONTRACT_COUNTER,
  formatSubscriptionContractNo,
  createAdobeAgreement,
  type CreateAgreementInput,
} from '../services/adobe-agreement-sender.js';
import { readApprovalConfig, verifyCallbackSecret } from '../services/contract-approval-service.js';

export interface ContractApprovalDeps {
  getClient: () => AdobeSignClient | null;
  agreementQueries: AdobeSignAgreementQueries;
  fieldValueQueries: AgreementFieldValueQueries;
  counterQueries: CounterQueries;
  settingsQueries: FileSettingsQueries;
}

function normaliseDecision(raw: unknown): 'approve' | 'reject' | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'approve' || s === 'approved' || s === 'yes' || s === 'accept') return 'approve';
  if (s === 'reject' || s === 'rejected' || s === 'no' || s === 'deny' || s === 'decline') return 'reject';
  return null;
}

// The shared callback logic — used by the public webhook callback. Power Automate (or
// any approval system) POSTs { token, decision, approver?, note? }. On approve we create
// the real Adobe agreement and release the held row; on reject we park it.
export function createContractApprovalCallbackHandler(deps: ContractApprovalDeps): RequestHandler {
  return async (req, res) => {
    const { agreementQueries, counterQueries, fieldValueQueries, settingsQueries, getClient } = deps;
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const decision = normaliseDecision(req.body?.decision);
    const approver = typeof req.body?.approver === 'string' ? req.body.approver.trim() || null : null;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() || null : null;

    if (!token) { res.status(400).json({ ok: false, error: 'token is required' }); return; }
    if (!decision) { res.status(400).json({ ok: false, error: "decision must be 'approve' or 'reject'" }); return; }

    const settings = settingsQueries.getAll();
    const cfg = readApprovalConfig(settings);
    if (!verifyCallbackSecret(cfg.secret, req.header('X-Nova-Secret') ?? undefined)) {
      res.status(401).json({ ok: false, error: 'Invalid or missing X-Nova-Secret' });
      return;
    }

    const hold = await agreementQueries.getByApprovalToken(token);
    if (!hold) { res.status(404).json({ ok: false, error: 'Approval request not found' }); return; }
    if (hold.approval_status !== 'PENDING') {
      res.status(409).json({ ok: false, error: `Approval request already ${String(hold.approval_status).toLowerCase()}` });
      return;
    }

    if (decision === 'reject') {
      await agreementQueries.markApprovalRejected(token, { approver, note });
      res.json({ ok: true, data: { rejected: true } });
      return;
    }

    // ── Approve → create the Adobe agreement and release the held row ──
    const client = getClient();
    if (!client) {
      // Keep the hold PENDING so it can be retried once Adobe Sign reconnects.
      res.status(503).json({ ok: false, error: 'Adobe Sign is not connected — cannot release the agreement. The approval is still pending; retry once connected.' });
      return;
    }

    let payload: CreateAgreementInput;
    try {
      payload = JSON.parse(hold.approval_payload ?? '{}') as CreateAgreementInput;
    } catch {
      res.status(500).json({ ok: false, error: 'Stored approval payload is corrupt — cannot release.' });
      return;
    }

    try {
      const out = await createAdobeAgreement(client, settings, payload);
      const counterValue = await counterQueries.nextValue(SUBSCRIPTION_CONTRACT_COUNTER);
      const subscriptionContractNo = formatSubscriptionContractNo(counterValue);

      await agreementQueries.releaseApproval(token, {
        realAgreementId: out.agreementId,
        subscriptionContractNo,
        filledFields: out.mergeFields.length > 0 ? JSON.stringify(out.mergeFields) : null,
        rawData: JSON.stringify({ id: out.agreementId }),
        approver,
        note,
      });

      if (out.mergeFields.length > 0) {
        await fieldValueQueries.bulkInsert(out.agreementId, 'SENDER',
          out.mergeFields.map(m => ({ field_name: m.fieldName, field_value: m.defaultValue ?? null })));
      }

      res.json({ ok: true, data: { approved: true, agreement_id: out.agreementId, subscription_contract_no: subscriptionContractNo } });
    } catch (err) {
      console.error('[Contract Approvals] Release-to-Adobe failed:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to release agreement to Adobe Sign' });
    }
  };
}

// Authenticated routes (mounted behind the /api auth gate) — visibility + manual action
// for admins who want to approve/reject from inside NOVA rather than via Power Automate.
export function createContractApprovalRoutes(deps: ContractApprovalDeps): Router {
  const router = Router();
  const callback = createContractApprovalCallbackHandler(deps);

  // GET /api/contract-approvals?status=PENDING — list approval holds
  router.get('/', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined;
    const holds = await deps.agreementQueries.listApprovalHolds(status);
    res.json({ ok: true, data: holds });
  });

  // POST /api/contract-approvals/decide — manual approve/reject from the NOVA UI.
  // Reuses the callback logic; the X-Nova-Secret check is satisfied implicitly only
  // when no secret is set, so an authenticated admin should pass the secret header too
  // if one is configured. (They're already JWT-authed to reach this route.)
  router.post('/decide', callback);

  return router;
}
