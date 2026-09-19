# Archived: internal onboarding engine

Retired 19 September 2026. NOVA now keeps only the onboarding that the customer
portal at `nova.nurtur.tech/portal` depends on. This directory is **not compiled**
— `tsconfig.json` has `include: ["src/**/*"]`, so nothing here is built or shipped.
It is kept so the feature can be brought back without digging through git history.

## What was removed

The staff-facing onboarding process: the Onboarding **area** (Overview, Overdue,
Milestones calendar, Onboarding Matrix), the milestone timeline, and the
matrix-driven Jira ticket generator.

| File | Was |
|---|---|
| `server/routes/onboarding-config.ts` | Onboarding Matrix CRUD + xlsx import (`/api/onboarding/config`) |
| `server/routes/onboarding.ts` | Ticket-set creation (`/api/onboarding/create-tickets`) |
| `server/routes/milestones.ts` | Milestone CRUD, templates, matrix, traffic lights (`/api/milestones`) |
| `server/services/onboarding-orchestrator.ts` | Built the parent QA ticket + children in Jira, idempotent by onboarding ref |
| `server/services/milestone-workflow.ts` | Ran every 15 min; advanced milestones and created tasks/tickets progressively |
| `server/queries-onboarding.ts` | `OnboardingConfigQueries`, `OnboardingRunQueries`, `MilestoneQueries` (lifted out of `src/server/db/queries.ts`) |
| `client/OnboardingDashboard.tsx` | Onboarding area Overview tab |
| `client/OverdueDeliveriesView.tsx` | Overdue tab |
| `client/OnboardingCalendar.tsx` | Milestones calendar tab |
| `client/OnboardingConfigView.tsx` | Onboarding Matrix tab + the Admin > Onboarding section |
| `client/OnboardingWorkflow.tsx` | Workflow stepper inside the Delivery drawer |

## What deliberately stayed

Everything the customer portal touches:

- **Delivery** (`routes/delivery.ts`, `DeliveryView`/`Drawer`/`Kanban`) — a delivery
  row is what a portal token hangs off, so it is the spine of customer onboarding.
  Moved from the Onboarding area into **Service Desk**. Its milestone timeline and
  "Create Tickets in Jira" button were removed; record, portal link, branches,
  brand settings, logos, instance setup and SharePoint sync all remain.
- **Setup portal chain** — `setup-portal.ts`, `setup-execution.ts`, `instance-setup.ts`,
  `branches.ts`, `services/setup-orchestrator.ts`, `services/template-builder.ts`,
  AzDo push. (`SetupOrchestrator` is BYM instance provisioning and was never part of
  the onboarding-ticket engine, despite the similar name.)
- **Guild / EXP onboarding** — `routes/guild-onboarding.ts`, `services/guild-onboarding.ts`,
  `services/exp-onboarding.ts`, `services/guild-onboarding-sla.ts`,
  `OnboardingRecordQueries`, the `onboarding_records` table, `GuildOnboardingView`
  (now a Service Desk tab) and the `Portal*Onboarding` components. This is the
  customer-initiated flow and is untouched.
- **`onboarding_escalation_log`** and `services/onboarding-escalation-service.ts` —
  portal-side Day 7/14/21 escalations.

## Database

No tables were dropped. The `CREATE TABLE` statements were removed from
`src/server/db/schema.ts` so a fresh database no longer grows them, but the live
data is still there:

`onboarding_ticket_groups`, `onboarding_sale_types`, `onboarding_capabilities`,
`onboarding_matrix`, `onboarding_capability_items`, `onboarding_runs`,
`milestone_templates`, `delivery_milestones`, `milestone_template_ticket_groups`,
`milestone_sale_type_offsets`.

## Restoring

1. Move the files back under `src/`, splitting `queries-onboarding.ts` into `db/queries.ts`.
2. Re-add the `CREATE TABLE` blocks to `schema.ts` (they are idempotent).
3. Re-wire in `index.ts`: the three query classes, `createOnboardingRoutes`,
   `createOnboardingConfigRoutes`, `createMilestoneRoutes`, `OnboardingOrchestrator`,
   `MilestoneWorkflowEngine`, the `milestone-eval` job and the startup matrix seed.
4. Re-add the Onboarding area to `App.tsx`.

Two callers were rewritten rather than gutted and would need revisiting:
`DeliveryQueries.getMyFocus` (overdue-milestone test replaced by an open-status
test) and `routes/team.ts` `/workload` (milestone counts dropped).
