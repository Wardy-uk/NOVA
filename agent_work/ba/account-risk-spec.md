# NOVA Account-Level Risk Intelligence — Build Spec

**Status:** Spec / pre-build. Supersedes the assumptions in `HANDOFF.md` (root).
**Decided:** 08 June 2026 with Nick.
**Owner:** Nick Ward.

This spec is the source of truth. The root `HANDOFF.md` was written before investigating the
live Jira data and the NOVA codebase; two of its core premises were wrong (see below). Where they
conflict, **this file wins**.

---

## What changed from the original HANDOFF

The HANDOFF assumed (a) the BC number is the primary key living on Jira tickets, and (b) NOVA has
no risk capability so everything must be built fresh in n8n. Investigation (step 1) disproved both:

1. **BC number is NOT in Jira.** Pulled NT-20964 (live customer ticket) with all ~200 fields — no
   populated BC custom field. The JSM organisation field reads "Unknown" even on real customer
   tickets. NOVA's own AI triage already resolves the customer via **website URL + reporter email
   domain**, not a BC number.
2. **NOVA already has a substantial risk system, in-app (TypeScript, not n8n):**
   - `services/risk-scorer.ts` — 12-factor **per-ticket** risk model (escalation regex incl.
     *formal complaint / lawyer / solicitor / legal action / trading standards / ombudsman / ICO /
     GDPR*, sentiment, SLA breach, age/activity, bounce, agent inaction, stale, unassigned,
     priority, parked). Scores 0–100, persists to `agent_flagged_tickets`, Teams alerts, review/
     dismiss workflow.
   - `services/agent-loop.ts` — runs the risk sweep on a timer + does per-ticket AI triage on every
     new ticket (the "🤖 AI New Ticket Triage" comments from the NOVA-Jira app account) + Lifecycle
     Manager.
   - Plumbing already populated: `jira_issue_cache`, `jira_comment_cache`, `problem_ticket_alerts`
     (sentiment), `agent_customer_memory`.
3. **Customer registries already exist** (main MSSQL): `bc_customers` (BC-number keyed, from
   Business Central), `crm_customers` (has `rag_status`, `dynamics_id`, `account_number`, MRR,
   contract dates), `contracts` (keyed by `bc_customer_id`). We resolve onto these — we do NOT
   build a new customer master.

**Gap that justifies the build:** what exists is *per-ticket* risk ("which open tickets are going
wrong now"). The new work is *per-account / per-customer* risk ("which customers are at risk of
churn / formal complaint / termination"), aggregated across all of a customer's tickets, decaying
over time, with a daily account briefing.

## Architecture decision

**Extend NOVA in-app** (chosen over standalone n8n and hybrid). Reuse `risk-scorer.ts` signal
detection, the Jira caches, and the agent-loop sweep. New tables live in the main NOVA MSSQL DB
alongside `agent_flagged_tickets` — NOT separate `Nova_Risk_` Azure tables. n8n is used only if a
heavy one-off historical backfill needs offloading (likely not — the recon ledger handles backfill).

## Scope — in-scope JSM projects (7)

`NT`, `NTPJ`, `STBY`, `YO`, `KYM`, `NAI`, `NF` (Nurtur Finance).
Excluded: `TS` (internal Tech Services), `JSP` (sandbox). **Day 1 = 2025-10-31.**
Jira Cloud ID: `9357a1ba-0ad9-4ff0-964d-fad84dd30f96`.

## NT custom field IDs (discovered 08 Jun 2026)

| Field | ID | Notes |
|---|---|---|
| BC Account Number | `customfield_14626` | e.g. `CU0001155`; match against `bc_customers.number`/`bc_id` |
| Instance URL | `customfield_13181` | e.g. `pfg-internal.briefyourmarket.com` |
| Customer Domain | `customfield_13956` | |
| Website URL | `customfield_13415` | |
| Feed Account URL | `customfield_13416` | |
| Organizations (JSM) | `customfield_12500` | array; e.g. `TPFG` |
| Client Name / Customer | `customfield_13444` / `customfield_13311` | |
| Sentiment / Current Tier | `customfield_12880` / `customfield_12981` | already written by NOVA |

## Signal-presence reality (most recent 100 in-scope tickets, 08 Jun 2026)

Reporter email **99%** · BC Account Number **10%** · JSM Organizations **6%** · Instance URL **1%**
· Website URL **1%** · Customer Domain **0%** · **any structured identifier 14%**.

⇒ The **email-domain map is the backbone**; structured fields are a high-confidence boost on the
~14% that have them (BC adoption still ramping). Seeding the domain map well (starting from
`bc_customers.email` domains) is the single highest-leverage task.

## Customer resolution chain (reworked around real data)

Returns `{ customerId, source, confidence }`. Order:
1. **Website URL** in summary/description (e.g. `acenproperties.co.uk`, `*.briefyourmarket.com`) →
   domain map. Strongest; the AI already extracts these.
2. **Reporter email domain** → domain map.
3. **AI inference** on content → best match against `bc_customers` / `crm_customers` names; flag
   `needs_manual_resolution` below confidence threshold (proposed 80%).
4. **Unresolved** → tracked explicitly (recon ledger), retried as the domain map grows.
Network accounts (Guild, PFG, EweMove — umbrella domain, member is the real customer): resolve at
network level by default, flag `is_network_account`; member-level is a later enhancement.

## New tables (main MSSQL, idempotent migrations in `db/schema.ts`, matching existing pattern)

- **`agent_customer_domains`** — `(id, customer_id, customer_source, domain, domain_type
  ['email'|'instance_url'|'website'], confidence, is_verified, added_at)`. The map resolution needs;
  neither `bc_customers` nor `crm_customers` stores a domain today. Seed from the 17 at-risk
  accounts in the investigation as verified rows.
- **`agent_account_risk`** — per-customer: `(id, customer_ref, customer_name, risk_score, risk_tier
  0–4, flags: has_formal_complaint / has_termination / has_active_refund / has_open_escalation,
  is_network_account, needs_manual_resolution, nt/ntpj/total ticket counts, first/last ticket date,
  last_score_update, notes, timestamps)`.
- **`agent_account_risk_signals`** — ticket-linked events: `(id, customer_ref, ticket_key, project,
  signal_type, weight, is_active, evidence_text, detected_at, ticket_created_at, ticket_status)`.
- **`agent_account_risk_history`** — score/tier change audit.
- **`agent_risk_recon_days`** — reconciliation ledger: `(project_key, recon_date, total_tickets,
  resolved_tickets, status ['partial'|'complete'], last_checked_at)`, unique on (project_key,
  recon_date).

(Decay model from HANDOFF retained: >90d signals at 50%, resolved tickets at 25%, open at full.
Tiers: 0 Normal 0–19, 1 Watch 20–39, 2 Medium 40–69, 3 High 70–99, 4 Critical 100+.)

## Nightly reconciliation (Nick's requirement)

Per in-scope project, walk only days NOT marked `complete`, oldest-first from Day 1:
1. `total_tickets` = count created that day in that project (JQL).
2. `resolved_tickets` = those now in risk DB AND attributed to a confirmed customer.
3. `resolved == total` → mark day **`complete`**, never re-check.
4. else → re-run resolution on that day's unresolved tickets (domain map has grown), update counts,
   leave `partial`.
Self-healing backfill: grinds backwards, seals fully-attributed days, auto-retries the long tail.
Surfaces "X days complete / Y partial / Z unresolved tickets" — watch it converge.

## Manual risk-register import (added 08 Jun 2026)

Nick maintains a manual risk register of at-risk accounts — many NOVA AI has not yet
auto-identified. Import these as **verified** seed rows so they're scored from day one and so
their domains bootstrap the resolution map. For now this is a manual spreadsheet import (later
could sync automatically).

- Each row upserts: `agent_account_risk` (verified, `needs_manual_resolution = 0`) + one or more
  `agent_customer_domains` rows (`is_verified = 1`, high confidence) so future tickets from those
  domains resolve to the registered customer.
- "Not already identified by NOVA AI" → import is upsert-by-key: rows that already exist (matched on
  BC number / domain) are updated, not duplicated; brand-new ones are inserted.
- Delivery mechanism: an admin xlsx import (mirrors the existing delivery/onboarding import pattern).
  Exact columns TBC — **Nick to upload the risk-register file in a later session**; importer to be
  written to match it. (Until then, the dry-run seeds the map from `bc_customers` only.)

## Ticket-level enrichment

The per-ticket AI triage already runs in-app. Inject the resolved customer's account-risk tier into
it (no new workflow). Optional later: write a `Risk Level` select field or internal-only comment.

## Build order (each a self-contained, verifiable PR)

1. **Schema + resolver** (first chunk): add the 5 migrations; write `services/customer-resolver.ts`
   (ticket → customer via the chain); seed `agent_customer_domains` from the 17 known at-risk
   accounts; dry-run resolver over a sample of recent in-scope tickets and report hit-rate. No
   scoring/UI yet.
2. **Account rollup + recon ledger**: account-rollup pass in the agent-loop sweep reusing
   `risk-scorer.ts` detection; build the recon walker. Validate the 8 HIGH accounts from the
   investigation score ≥70.
3. **Triage enrichment**: inject account tier into existing triage.
4. **Daily briefing** (Claude API) for Tier 3+.
5. **Risk Intelligence dashboard page** + ticket-level risk panel (most effort, last).

## Definition of done

- 5 tables created & validated; resolver hit-rate measured on live tickets.
- Account rollup running in the sweep; known at-risk accounts scoring correctly.
- Recon ledger converging; fully-reconciled days sealed.
- Triage enrichment showing account tier on new tickets.
- Daily briefing generating for Tier 3+; dashboard page live.
