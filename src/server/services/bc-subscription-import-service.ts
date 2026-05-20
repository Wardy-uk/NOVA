/**
 * BC Subscription Import orchestration.
 *
 * Takes a NOVA Adobe Sign agreement ID and pushes its data to the BC
 * subscription-billing staging tables:
 *
 *   adobe_sign_agreements row + bc_customers row + agreement_field_values rows
 *                                        │
 *                                        ▼
 *                  BC's importedCustomerSubscriptionContracts (header)
 *                                        │
 *                  (later, once item mapping ships)
 *                                        ▼
 *                  BC's importedSubscriptionHeaders + Lines
 *
 * Phase 1 (this file): header-only writes. Subscription Headers + Lines are
 * stubbed out pending the contract_template → BC item mapping work.
 */

import type { AdobeSignAgreementQueries, BcCustomerQueries } from '../db/queries.js';
import type {
  BcSubscriptionImportClient,
  ImportedCustomerSubscriptionContractPayload,
} from './bc-subscription-import-client.js';

export class BcSubscriptionImportError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'BcSubscriptionImportError';
  }
}

export interface PushAgreementToBcResult {
  agreementId: string;
  subscriptionContractNo: string;
  headerCreated: boolean;
  // Once mapping ships, these will report what got written. For now both 0.
  subscriptionHeadersCreated: number;
  subscriptionLinesCreated: number;
}

export class BcSubscriptionImportService {
  constructor(
    private agreementQueries: AdobeSignAgreementQueries,
    private bcCustomerQueries: BcCustomerQueries,
    private getClient: () => BcSubscriptionImportClient | null,
  ) {}

  /**
   * Pushes a single signed agreement to BC's staging tables.
   *
   * On success: marks bc_imported_at, clears bc_import_error.
   * On failure: stores the error in bc_import_error, leaves bc_imported_at null
   * so it can be retried. Throws so the caller (manual endpoint or post-sign
   * handler) can surface the error.
   *
   * Idempotency: callers should check agreement.bc_imported_at first if they
   * want to avoid duplicate writes. BC itself will likely reject duplicate
   * subscription_contract_no values (UNIQUE constraint on the staging table),
   * which is the ultimate guard — but checking locally first is cheaper.
   */
  async pushAgreementToBC(agreementId: string): Promise<PushAgreementToBcResult> {
    // ── Preconditions ──
    const client = this.getClient();
    if (!client) {
      throw new BcSubscriptionImportError(
        'BC — Subscription Import is not configured. Set up the integration in Admin → Integrations first.'
      );
    }

    const agreement = await this.agreementQueries.getByAgreementId(agreementId);
    if (!agreement) {
      throw new BcSubscriptionImportError(`Agreement ${agreementId} not found in NOVA.`);
    }
    if (!agreement.subscription_contract_no) {
      throw new BcSubscriptionImportError(
        `Agreement ${agreementId} has no subscription_contract_no — it was created before the NOVA-N counter was wired in. Cannot push to BC.`
      );
    }
    if (!agreement.bc_customer_id) {
      throw new BcSubscriptionImportError(
        `Agreement ${agreementId} has no bc_customer_id — the sender didn't pick a BC customer in the wizard. Set one before pushing.`
      );
    }

    const customer = await this.bcCustomerQueries.getByBcId(agreement.bc_customer_id);
    if (!customer) {
      throw new BcSubscriptionImportError(
        `BC customer ${agreement.bc_customer_id} not found in the local bc_customers cache. Re-sync customers from BC and try again.`
      );
    }
    if (!customer.number) {
      // BC's customer 'No.' is the natural key the subscription contract joins on.
      // Without it the staging row would be unlinkable.
      throw new BcSubscriptionImportError(
        `BC customer ${customer.display_name} (bc_id ${customer.bc_id}) has no customer Number in NOVA's cache. Re-sync customers from BC.`
      );
    }

    // ── Build header payload ──
    // BC doesn't auto-assign the staging-table Entry No. over the API, so read the
    // current max and send max+1.
    const nextEntryNo = (await client.getMaxContractEntryNo()) + 1;

    // Minimal field test (2026-05-20): only the fields confirmed for this pass.
    // createContractDeferrals intentionally omitted until the full payload is wired.
    const header: ImportedCustomerSubscriptionContractPayload = {
      entryNo: nextEntryNo,
      subscriptionContractNo: agreement.subscription_contract_no,
      sellToCustomerNo: customer.number,
      billToCustomerNo: customer.number,       // same as sellTo
      subscriptionContractType: 'STD',         // BC property: subscriptionContractType
      description: 'NOVA test',
    };

    // ── POST to BC ──
    try {
      await client.createImportedCustomerSubscriptionContract(header);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.agreementQueries.markBcImportError(agreementId, msg);
      throw new BcSubscriptionImportError(`BC header write failed: ${msg}`, err);
    }

    // TODO: when contract_template_item_mappings table + admin UI ship, look up
    // the mapping for this agreement's template, derive item codes + quantities
    // from agreement_field_values, and POST Subscription Headers + Lines here.
    // For now we successfully write the header only — BC users finish off the
    // contract by adding lines manually until mapping is configured.
    const subscriptionHeadersCreated = 0;
    const subscriptionLinesCreated = 0;

    // ── Mark success ──
    await this.agreementQueries.markBcImported(agreementId);

    return {
      agreementId,
      subscriptionContractNo: agreement.subscription_contract_no,
      headerCreated: true,
      subscriptionHeadersCreated,
      subscriptionLinesCreated,
    };
  }
}
