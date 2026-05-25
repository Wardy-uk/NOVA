# Phase 01 Build Brief

## Build Slice

- Name: Customer-facing portal status flow
- Goal: Replace raw Jira statuses in the customer portal with a curated customer-facing status model.
- Owner: Build Agent

## Behavioural Gap Being Addressed

The portal currently exposes raw internal Jira statuses to customers. That leaks internal process detail, creates confusion, and makes ticket progress harder for customers to understand.

## Desired User Outcome

Customers should see a small, clear set of human-readable statuses that explain where their request is in the support journey.

## Desired Operational Outcome

Support and operations keep their existing Jira workflow, while the portal presents a cleaner customer-facing translation layer that improves clarity without changing internal ticket handling.

## Scope For This Slice

- Focus only on customer-visible status presentation in the portal.
- Apply the curated 7-status model described in `portal-status-flow-spec.md`.
- Keep this as a display translation layer.
- Preserve existing Jira statuses, ticket data, and internal workflow behaviour.

## What To Change

- Translate raw Jira statuses to curated customer-facing portal statuses.
- Use the translated statuses anywhere ticket status is shown to portal customers.
- Ensure status history shown in the portal uses customer-facing labels rather than raw internal Jira labels.
- Provide a clear customer-facing sense of progress through the support journey.

## Constraints

- Do not change Jira workflow behaviour.
- Do not redesign the whole portal.
- Do not broaden into unrelated ticket-detail, intake, or routing work.
- Prefer configuration and reuse of existing portal patterns where possible.
- Keep the implementation safe for unmapped or newly introduced Jira statuses.

## Non-Goals

- Changing internal Jira statuses.
- Reworking ticket creation or intake.
- Rebuilding support workflows.
- Solving every possible edge case beyond a safe fallback for unknown statuses.

## Build Agent Instructions

Implement the smallest viable behavioural change that makes portal ticket status understandable to customers.

Optimise for:

- customer clarity
- stable mapping behaviour
- preserving existing internal support operations
- graceful handling of unknown statuses

Do not optimise for:

- changing Jira workflows
- speculative platform redesign
- broad portal refactors
- unrelated support-journey improvements

Preferred shape:

- Use the curated 7-status model from `portal-status-flow-spec.md`.
- Keep the raw Jira status in internal storage and processing.
- Apply mapping at read/display time for the portal.
- Show customer-friendly progress without exposing internal wording.
- Use a safe default for unmapped statuses.

Implementation guidance:

- Reuse existing portal ticket and status rendering capabilities where possible.
- Keep implementation local to portal status mapping and portal status display surfaces.
- Preserve existing post-submit and ticket-tracking flows.

## Done Signal

- Build Agent writes a readiness note to `agent_work/build_status/`.
- The running portal shows customer-facing statuses instead of raw Jira statuses.
- Eval can verify the behaviour through the running software only.
