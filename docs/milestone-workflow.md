# Milestone-Driven Onboarding Workflow

Progressive task and Jira ticket creation aligned to delivery milestones.

## Overview

Instead of creating all onboarding tasks and Jira tickets upfront, the workflow engine creates them progressively as each milestone approaches its target date. This keeps My NOVA focused on what's relevant now, and stages Jira ticket creation so teams aren't overwhelmed.

## How It Works

1. **Delivery created** — milestones are generated from templates. Only the first milestone (day 0) gets a task immediately.
2. **Lead time triggers** — a background job runs every 15 minutes. When a milestone's target date minus its `lead_days` reaches today, the engine creates the task and any linked Jira tickets.
3. **Completion cascade** — when a milestone is marked complete, the engine immediately evaluates the next milestone. If it's within lead time, its task is created right away rather than waiting for the next scheduled run.
4. **Staged Jira tickets** — each milestone template can be linked to specific ticket groups from the onboarding matrix. Only those groups' tickets are created when that milestone triggers, using the existing orchestrator with a `filterGroupIds` filter.

## Configuration

### Milestone Templates

Each template has a configurable `lead_days` (default: 3) — how many days before the target date to create the task and tickets.

### Template-to-Ticket Group Linking

In **Admin > Onboarding > Milestone Links** tab:
- Rows = milestone templates (e.g. "Contract Received", "Site Survey", "Go Live")
- Columns = ticket groups (e.g. "Setup", "Integration", "QA")
- Check the box to link a ticket group to a milestone stage
- Adjust lead days per template with the number input

When a milestone triggers, only its linked ticket groups get Jira tickets created.

## Schema Changes

| Table | Change |
|-------|--------|
| `milestone_templates` | Added `lead_days INTEGER DEFAULT 3` |
| `delivery_milestones` | Added `workflow_task_created`, `workflow_tickets_created`, `jira_keys` |
| `milestone_template_ticket_groups` | **New** — linking table (template_id, ticket_group_id) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/milestones/template-groups` | All template-to-ticket-group mappings |
| GET | `/api/milestones/templates/:id/ticket-groups` | Linked group IDs for a template |
| PUT | `/api/milestones/templates/:id/ticket-groups` | Set linked group IDs |
| GET | `/api/milestones/delivery/:id/workflow` | Milestones with workflow status + Jira keys |
| POST | `/api/milestones/workflow/evaluate` | Manual workflow evaluation trigger |

## UI Components

### OnboardingWorkflow (horizontal stepper)

`src/client/components/OnboardingWorkflow.tsx`

- **Full mode** — horizontal stepper with circles, connecting lines, progress bar, click-to-expand detail panel
- **Compact mode** (`compact` prop) — inline dots for embedding in cards
- Circle colours: green (complete), amber/pulse (in progress), red (overdue), gray (pending)
- Detail panel shows: status, dates, checklist progress, Jira keys, workflow state

### Where it appears

- **DeliveryDrawer** — full stepper above the milestone timeline
- **MyFocusView** — compact stepper on each delivery card
- **OnboardingConfigView** — "Milestone Links" tab for configuration

## Files Changed

| File | What |
|------|------|
| `src/server/db/schema.ts` | New table + migration columns |
| `src/server/db/queries.ts` | 7 new MilestoneQueries methods |
| `src/server/services/milestone-workflow.ts` | **New** — MilestoneWorkflowEngine |
| `src/server/services/onboarding-orchestrator.ts` | Added `filterGroupIds` to `execute()` |
| `src/server/routes/milestones.ts` | Completion trigger, new endpoints, progressive sync |
| `src/server/routes/delivery.ts` | Progressive task creation on delivery create |
| `src/server/index.ts` | Engine wiring, 15-min scheduled job |
| `src/client/components/OnboardingWorkflow.tsx` | **New** — horizontal stepper component |
| `src/client/components/DeliveryDrawer.tsx` | Embedded full stepper |
| `src/client/components/MyFocusView.tsx` | Embedded compact stepper |
| `src/client/components/OnboardingConfigView.tsx` | "Milestone Links" config tab |
