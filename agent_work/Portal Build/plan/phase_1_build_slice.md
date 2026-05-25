# Phase 1 Build Slice

## Problem Statement

The customer portal currently passes raw internal Jira statuses to customers. This exposes internal process language, makes ticket progress harder to understand, and creates a poor customer-facing support journey.

The first controlled loop is to replace those raw statuses with a curated 7-status customer-facing model that expresses support progress clearly while leaving internal Jira workflow unchanged.

## User Outcome

From the customer perspective, ticket status should be easy to understand at a glance. Customers should be able to tell whether their request has been received, reviewed, actively worked on, waiting on them, waiting on a third party, resolved, or closed, without needing to interpret internal Jira terminology.

## Operational Outcome

From the support and service-desk perspective, internal workflows stay exactly as they are, while the portal presents a more understandable customer-facing layer. Support should not need to change how they work in Jira for customers to get a clearer status journey.

## First Build Slice

Implement the curated 7-status customer-facing translation layer for portal ticket status, including current status display and customer-visible status history.

This slice should:

- map raw Jira statuses to the 7 customer-facing portal statuses
- apply the mapping anywhere customers see ticket status
- use a safe fallback for unmapped statuses
- provide a clearer sense of ticket progress in the portal

## Build-Agent Instructions

Build only the first customer-facing portal status slice.

You can inspect and change code, but do not broaden scope beyond status translation and customer-visible status presentation. Reuse the existing portal ticket data flow and rendering patterns where possible. Preserve existing Jira workflow, storage, and post-submit behaviour.

Desired behavioural capability:

- Customers should see understandable support statuses instead of internal Jira labels.
- The same ticket should present status consistently across the main customer-visible portal surfaces.
- The portal should handle known and unknown Jira statuses safely.
- The display should communicate progress without exposing support-team jargon.

## Scope Boundaries

- Do not change Jira workflows.
- Do not redesign ticket intake.
- Do not rebuild the whole ticket-detail experience.
- Do not expand into unrelated support portal improvements.

## Known Constraints

- Preserve existing Jira workflow behaviour.
- Keep the change local to customer-facing portal status presentation.
- Prefer configuration and reuse of existing portal patterns where possible.
- Keep the implementation safe for unmapped or newly introduced Jira statuses.
- Preserve existing post-submit and ticket-tracking flows.
