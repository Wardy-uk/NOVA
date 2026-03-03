# Customer Setup Portal

**Phase 6 of the Onboarding.Tool Integration**

A self-service portal where customers fill in their own brand data via a magic link — no NOVA login required. Data writes directly to existing delivery tables so NOVA users see progress in real-time.

---

## Overview

Previously, NOVA users manually entered brand settings, branches, and logos on behalf of customers. The Customer Setup Portal shifts this data collection to the customer themselves, reducing back-and-forth and accelerating onboarding timelines.

The portal is a standalone public page rendered outside of the NOVA application. Customers receive a magic link via email (or copied manually by an onboarder), complete a guided wizard at their own pace, and submit when ready. NOVA users can monitor progress and see submitted data immediately within the delivery drawer.

---

## How It Works

### Sending a Link

1. Open a delivery in the NOVA drawer
2. Expand the **Customer Setup Portal** panel (requires `feature_instance_setup` enabled)
3. Enter the customer's email and optionally their name
4. Click **Send Email** to dispatch a branded email with the link, or **Copy Link** to grab the URL manually
5. A 64-character hex token is generated with a 30-day expiry (configurable via `setup_link_expiry_days` setting)

### Customer Experience

The customer clicks the link and lands on a clean, light-themed wizard with six steps:

| Step | Content |
|------|---------|
| **1. Company Info** | Company name, subdomain, website URL, registered details |
| **2. Colours & Theme** | 7 colour pickers (primary, secondary, header/footer bg/text, main text) |
| **3. Branches** | Add/edit/delete office branches with contact details and addresses |
| **4. Logos & Images** | Upload up to 5 logo types (primary, splash, print, alternate, alternate print) |
| **5. Social & URLs** | Social media links, CTAs, analytics IDs, contact URLs |
| **6. Review & Submit** | Read-only summary with validation of required fields, submit button |

### Key Behaviours

- **Auto-save**: Every text field debounce-saves after 800ms of inactivity. Branches and logos save on action (create/upload/delete).
- **Progress tracking**: A horizontal progress bar shows completed steps. Progress persists server-side so NOVA users can see how far along a customer is.
- **Resume**: Closing the browser and reopening the same link picks up exactly where the customer left off.
- **Expired link**: Displays a friendly "This link has expired" message with guidance to contact their account manager.
- **Already submitted**: Shows a read-only summary with a "Thank you" confirmation banner. No further edits possible.
- **Responsive**: Single-column layout on mobile, multi-column on desktop.

### Back in NOVA

Once the customer fills in data, it appears immediately in the delivery drawer:
- Brand settings show in the **Brand Settings** panel
- Branches show in the **Branches** panel
- Logos show in the **Logos & Images** panel

The **Customer Setup Portal** panel shows all issued tokens with:
- Customer email
- Progress percentage
- Last accessed date
- Completed/expired badges
- Copy link and revoke actions

---

## Architecture

### Database

A single new table stores portal tokens:

```
setup_portal_tokens
├── id              (PK)
├── token           (64-char hex, unique)
├── delivery_id     (FK → delivery_entries)
├── customer_email
├── customer_name
├── expires_at
├── created_at
├── last_accessed
├── completed_at
├── created_by      (FK → users)
└── progress_json   (e.g. {"company":true,"colors":false,...})
```

No new tables for the actual data — brand settings, branches, and logos write to the same tables used by the internal NOVA panels (`delivery_brand_settings`, `delivery_branches`, `delivery_logos`).

### API Routes

**Public routes** (`/api/public/setup/*`) — registered before auth middleware, validated by token query parameter:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/info` | Delivery name, brand field definitions, progress |
| GET | `/brand-settings` | Current brand settings |
| PUT | `/brand-settings` | Bulk upsert settings |
| PATCH | `/brand-settings/:key` | Single field auto-save |
| GET/POST/PUT/DELETE | `/branches[/:id]` | Branch CRUD |
| GET/PUT/DELETE | `/logos[/:type]` | Logo management |
| GET/PUT | `/progress` | Read/update wizard progress |
| POST | `/complete` | Mark as submitted |

**Internal routes** (`/api/setup-portal/*`) — behind NOVA auth:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/generate/:deliveryId` | Generate token, optionally send email |
| GET | `/tokens/:deliveryId` | List tokens for a delivery |
| DELETE | `/tokens/:tokenId` | Revoke a token |

### Security

- **Token validation**: Every public request must include a valid, non-expired 64-char hex token
- **Rate limiting**: 60 requests per 15 minutes per IP on public routes
- **Delivery scoping**: All operations are scoped to the token's `delivery_id` — a customer can never access another delivery's data
- **Read-only after submission**: Once `completed_at` is set, all mutation endpoints return 400
- **Automatic cleanup**: Expired tokens are purged every 6 hours

### Frontend

The portal renders as a completely standalone page — no NOVA header, sidebar, or authentication:

```
App.tsx
├── /setup/:token  →  <SetupPortal />   (standalone, public)
└── everything else →  NOVA app          (auth-gated)
```

The wizard reuses the same shared definitions (`BRAND_SETTING_DEFS`, `BRAND_SETTING_GROUPS`, `LOGO_TYPE_DEFS`) from `src/shared/brand-settings-defs.ts` to ensure field parity with the internal panels.

---

## Files

| File | Type | Purpose |
|------|------|---------|
| `src/server/db/schema.ts` | Modified | `setup_portal_tokens` table |
| `src/server/db/queries.ts` | Modified | `SetupPortalQueries` class |
| `src/server/routes/setup-portal.ts` | **New** | Public + internal API routes |
| `src/server/services/email-templates.ts` | Modified | `setupPortalHtml()` branded email |
| `src/server/index.ts` | Modified | Route wiring, rate limiter, cleanup timer |
| `src/client/App.tsx` | Modified | `/setup/:token` route intercept |
| `src/client/components/SetupPortal.tsx` | **New** | Standalone wizard component |
| `src/client/components/SetupPortalPanel.tsx` | **New** | DeliveryDrawer management panel |
| `src/client/components/DeliveryDrawer.tsx` | Modified | Panel integration |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `feature_instance_setup` | `false` | Feature flag — must be enabled in Admin > Feature Flags |
| `setup_link_expiry_days` | `30` | Days before a setup link expires |
| `smtp_from` | (required) | Sender address for setup emails |
| `sso_base_url` or `app_base_url` | `http://localhost:3001` | Base URL used to construct portal links |

---

## Prerequisites

This feature builds on Phases 1-5 of the Onboarding.Tool integration:
- Phase 1: Instance setup checklist
- Phase 2: Delivery branches
- Phase 3: Brand settings + logos
- Phase 4: Azure DevOps integration
- Phase 5: Setup execution engine

All phases share the `feature_instance_setup` feature flag.
