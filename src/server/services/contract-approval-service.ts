/**
 * Contract Approvals — webhook firing + callback verification.
 *
 * When a contract contains custom (non-pre-approved) terms and the Contract Approvals
 * integration is enabled, NOVA holds the agreement and POSTs to a configured webhook
 * (typically a Power Automate flow that runs a Teams approval). Power Automate calls
 * back to /api/public/contract-approvals/callback with the decision.
 *
 * Outbound: we HMAC-sign the JSON body with the shared secret in `X-Nova-Signature`
 * so the receiver can verify the call came from NOVA (optional, only if a secret is set).
 *
 * Inbound (callback): the unguessable approval_token is the primary capability. If a
 * shared secret is configured we ALSO require it in the `X-Nova-Secret` header
 * (timing-safe compare) as defence in depth.
 */

import crypto from 'crypto';

export interface ApprovalWebhookConfig {
  webhookUrl: string;
  secret: string;
  callbackUrl: string;
}

export interface ApprovalWebhookPayload {
  token: string;
  contract_name: string;
  bc_customer_id: string | null;
  signer_emails: string[];
  terms_text: string;
  requested_by: string | null;
  callback_url: string;
  requested_at: string;
}

// Reads the Contract Approvals settings into a typed config. Caller decides whether
// the workflow is enabled (contract_approvals_enabled) and whether a webhook URL exists.
export function readApprovalConfig(settings: Record<string, string>): ApprovalWebhookConfig {
  return {
    webhookUrl: (settings.contract_approvals_webhook_url || '').trim(),
    secret: (settings.contract_approvals_webhook_secret || '').trim(),
    callbackUrl: (settings.contract_approvals_callback_url || '').trim(),
  };
}

export function isApprovalsEnabled(settings: Record<string, string>): boolean {
  return settings.contract_approvals_enabled === 'true';
}

// POST the approval request to the configured webhook. Throws on non-2xx so the
// caller can record the failure — the hold is kept regardless so it can be retried.
export async function fireApprovalWebhook(config: ApprovalWebhookConfig, payload: ApprovalWebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.secret) {
    headers['X-Nova-Signature'] = 'sha256=' + crypto.createHmac('sha256', config.secret).update(body).digest('hex');
  }
  const res = await fetch(config.webhookUrl, { method: 'POST', headers, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Approval webhook returned ${res.status}${text ? ` — ${text.slice(0, 300)}` : ''}`);
  }
}

// Verify the callback's shared secret header. If no secret is configured, the
// unguessable token alone is the gate and this returns true.
export function verifyCallbackSecret(configuredSecret: string, headerValue: string | undefined): boolean {
  if (!configuredSecret) return true;
  if (!headerValue) return false;
  const a = Buffer.from(configuredSecret);
  const b = Buffer.from(headerValue);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
