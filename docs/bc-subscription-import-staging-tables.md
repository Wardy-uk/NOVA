# BC Subscription Import — Staging Table Reference

Reference schema for the three Business Central **Subscription Billing** import
staging tables that NOVA pushes signed Adobe Sign agreements into. Captured from
the live OData `$metadata` on **2026-05-20**.

This is Microsoft's standard **Subscription Billing** module (docs path `srb`), not
a bespoke extension — see [Import subscription contracts and contract lines](https://learn.microsoft.com/dynamics365/business-central/srb/setup/import).
The `Microsoft.NAV.*` types below are BC enums.

## API endpoint

```
https://api.businesscentral.dynamics.com/v2.0
  /{bc_tenant_id}
  /{bc_sub_environment}                          # e.g. DA-260318-260518040006 (long format!)
  /api/technologyManagement/billingSub/v2.0
  /companies({bc_sub_company_id})                # GUID, e.g. d01adb5e-... (NOT the name 'Master Data')
  /{entitySet}
```

- **Auth:** OAuth client-credentials, scope `https://api.businesscentral.dynamics.com/.default`,
  reusing the main BC integration's app registration (`bc_tenant_id`, `bc_client_id`, `bc_client_secret`).
- **Settings:** `bc_sub_enabled`, `bc_sub_environment`, `bc_sub_company_id` (Admin → Integrations → "BC — Subscription Import").
- **`$metadata`** (full schema) is at the service root with no company segment:
  `.../api/technologyManagement/billingSub/v2.0/$metadata`.

## Processing flow

The three tables are staging/buffer tables. After rows are POSTed, BC users (or a
job) run in-product **"Create…"** actions to convert them into real records:

```
importedCustomerSubscriptionContracts   (1 per agreement — the contract header)
        │  Create Customer Subscription Contracts
        ▼
importedSubscriptionHeaders             (1 per item/subscription purchased)
        │  Create Subscriptions
        ▼
importedSubscriptionLines               (N billable lines under each header)
           Create Subscription Lines
```

Each entity reports its own outcome: `*Created` boolean, `errorText`, `processedBy`,
`processedAt`.

---

## Gotchas / lessons learned (read before extending)

- **`entryNo` is the primary key and is NOT auto-assigned over the API.** A POST with
  `entryNo` absent/0 fails: *"Entry No. must have a value … cannot be zero or empty."*
  NOVA reads the current max and sends `max+1` (`getMaxContractEntryNo()` for the header;
  the same pattern is needed for headers/lines).
- **Contract Type → `subscriptionContractType`**, NOT `contractType`. The obvious
  camelCase guess is rejected.
- **`createContractDeferrals` (header) is `Edm.Boolean`.** The in-product field caption is
  *"Without Contract Deferrals"* (the inverse), but the OData property is literally
  `createContractDeferrals` and `true` means *create* deferrals. Don't invert it.
- **On the line, `createContractDeferrals` is an ENUM** (`Microsoft.NAV.createContractDeferrals`),
  not a boolean — different type from the header's same-named field.
- Property names ≠ doc captions in several places (e.g. line "Calculation Base %" →
  `calculationBasePct`, "Calculation Base Period" → `billingBasePeriod`, "Contract Line Type" →
  `subContractLineType`, "Subscription No." on the line → `subscriptionHeaderNo`).
- Company in the URL must be the **GUID** (`companies(d01adb5e-…)`); a quoted name
  (`companies('Master Data')`) returns a query-syntax error against this API.

---

## `importedCustomerSubscriptionContract` (header)

POSTed once per agreement. NOVA's current minimal payload uses
`entryNo`, `subscriptionContractNo`, `sellToCustomerNo`, `billToCustomerNo`,
`subscriptionContractType`, `description`.

| Property | Type | Nullable | Notes |
|---|---|---|---|
| `systemId` | Edm.Guid | false | BC-assigned; don't send |
| `entryNo` | Edm.Int32 | false | **PK — supply max+1 (not auto-assigned)** |
| `subscriptionContractNo` | Edm.String | | Contract No. — NOVA sends `NOVA-NNNNNNNNNN` |
| `sellToCustomerNo` | Edm.String | | BC customer No. (e.g. `CU0000001`) |
| `sellToContactNo` | Edm.String | | |
| `billToCustomerNo` | Edm.String | | NOVA uses same as sell-to |
| `billToContactNo` | Edm.String | | |
| `subscriptionContractType` | Edm.String | | e.g. `STD` (**not** `contractType`) |
| `description` | Edm.String | | |
| `yourReference` | Edm.String | | |
| `salespersonCode` | Edm.String | | |
| `assignedUserId` | Edm.String | | |
| `detailOverview` | Microsoft.NAV.contractDetailOverview | | enum |
| `dimensionFromJobNo` | Edm.String | | |
| `shipToCode` | Edm.String | | |
| `paymentTermsCode` | Edm.String | | |
| `paymentMethodCode` | Edm.String | | |
| `shortcutDimension1Code` | Edm.String | | |
| `shortcutDimension2Code` | Edm.String | | |
| `currencyCode` | Edm.String | | |
| `contractCreated` | Edm.Boolean | | outcome flag |
| `errorText` | Edm.String | | outcome |
| `processedBy` | Edm.String | | outcome |
| `processedAt` | Edm.DateTimeOffset | | outcome |
| `createContractDeferrals` | Edm.Boolean | | `true` = create deferrals (caption is "Without Contract Deferrals") |

---

## `importedSubscriptionHeader`

One per item/subscription purchased.

| Property | Type | Nullable | Notes |
|---|---|---|---|
| `systemId` | Edm.Guid | false | BC-assigned |
| `entryNo` | Edm.Int32 | false | **PK — supply max+1** |
| `subscriptionHeaderNo` | Edm.String | | "Subscription No." — links lines to this header |
| `endUserCustomerNo` | Edm.String | | customer No. |
| `billToCustomerNo` | Edm.String | false | required |
| `billToContactNo` | Edm.String | | |
| `shipToCode` | Edm.String | | |
| `itemNo` | Edm.String | | BC item No. (e.g. `ITM0117`) |
| `description` | Edm.String | | |
| `customerReference` | Edm.String | | |
| `serialNo` | Edm.String | | qty must be 1 if set |
| `version` | Edm.String | | |
| `subscriptionKey` | Edm.String | | |
| `provisionStartDate` | Edm.Date | | no billing relevance |
| `provisionEndDate` | Edm.Date | | no billing relevance |
| `endUserContactNo` | Edm.String | | |
| `unitOfMeasure` | Edm.String | | |
| `quantityDecimal` | Edm.Decimal | | quantity |
| `subscriptionHeaderCreated` | Edm.Boolean | | outcome flag |
| `errorText` | Edm.String | | outcome |
| `processedBy` | Edm.String | | outcome |
| `processedAt` | Edm.DateTimeOffset | | outcome |

---

## `importedSubscriptionLine`

N billable lines under a header. `calculationBaseAmount` is mandatory per the docs.

| Property | Type | Nullable | Notes |
|---|---|---|---|
| `systemId` | Edm.Guid | false | BC-assigned |
| `entryNo` | Edm.Int32 | false | **PK — supply max+1** |
| `subscriptionHeaderNo` | Edm.String | | FK to header's `subscriptionHeaderNo` |
| `subscriptionLineEntryNo` | Edm.Int32 | | auto if omitted |
| `partner` | Microsoft.NAV.servicePartner | | enum: Customer / Vendor — NOVA = Customer |
| `subscriptionContractNo` | Edm.String | | FK to contract header |
| `subscriptionContractLineNo` | Edm.Int32 | | auto if omitted |
| `subContractLineType` | Microsoft.NAV.contractLineType | | enum: Comment / Item / G/L Account |
| `subscriptionPackageCode` | Edm.String | false | required |
| `templateCode` | Edm.String | | |
| `description` | Edm.String | | |
| `subscriptionLineStartDate` | Edm.Date | | required |
| `subscriptionLineEndDate` | Edm.Date | | |
| `nextBillingDate` | Edm.Date | | defaults to start date |
| `calculationBaseAmount` | Edm.Decimal | | **required** — price base |
| `calculationBasePct` | Edm.Decimal | | 100% = price equals base |
| `discountPct` | Edm.Decimal | | |
| `discountAmount` | Edm.Decimal | | use Pct OR Amount |
| `amount` | Edm.Decimal | | derived if empty |
| `billingBasePeriod` | Edm.String | | dateformula, e.g. `1M`/`12M` |
| `invoicingVia` | Microsoft.NAV.invoicingVia | | enum: Sales / Contract |
| `invoicingItemNo` | Edm.String | | |
| `noticePeriod` | Edm.String | | dateformula |
| `initialTerm` | Edm.String | | dateformula |
| `extensionTerm` | Edm.String | | dateformula (subsequent term) |
| `billingRhythm` | Edm.String | | dateformula |
| `discountAmountLcy` | Edm.Decimal | | |
| `amountLcy` | Edm.Decimal | | |
| `currencyCode` | Edm.String | | |
| `currencyFactor` | Edm.Decimal | | |
| `currencyFactorDate` | Edm.Date | | |
| `calculationBaseAmountLcy` | Edm.Decimal | | |
| `quantity` | Edm.Decimal | | |
| `nextPriceUpdate` | Edm.Date | | |
| `excludeFromPriceUpdate` | Edm.Boolean | | |
| `createContractDeferrals` | Microsoft.NAV.createContractDeferrals | | **enum here** (boolean on the header) |
| `subscriptionLineCreated` | Edm.Boolean | | outcome flag |
| `errorText` | Edm.String | | outcome |
| `processedBy` | Edm.String | | outcome |
| `processedAt` | Edm.DateTimeOffset | | outcome |
| `subContractLineCreated` | Edm.Boolean | | outcome flag |
| `usageBasedBilling` | Edm.Boolean | | |
| `usageBasedPricing` | Microsoft.NAV.usageBasedPricing | | enum |
| `pricingUnitCostSurchargePct` | Edm.Decimal | | |
| `supplierReferenceEntryNo` | Edm.Int32 | | |

---

## Related code

- Client: [src/server/services/bc-subscription-import-client.ts](../src/server/services/bc-subscription-import-client.ts)
- Service: [src/server/services/bc-subscription-import-service.ts](../src/server/services/bc-subscription-import-service.ts)
- Schema fetch helper (throwaway): `bc-sub-metadata.ps1` (repo root)
