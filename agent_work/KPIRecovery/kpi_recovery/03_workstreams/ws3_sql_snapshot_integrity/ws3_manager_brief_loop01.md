# WS3 Manager Brief — Loop 01

## Workstream

WS3 — SQL and Snapshot Integrity

## Objective

Start WS3 with the smallest high-value structural integrity slice:

- permanent reconciliation for deleted Jira tickets in `jira_issue_cache`
- classification of whether the fix belongs only in sync logic or also in snapshot / downstream persistence handling

This is the deferred structural gap from WS1-D (`D-048`) and the cleanest entry point into WS3.

## Why This Slice First

- It is already evidenced in production.
- It has already caused a trusted KPI domain to drift once.
- It is structurally separate from KPI maths.
- It is smaller and safer than taking on broad snapshot redesign first.

## Slice Definition

### WS3-A — Cache Reconciliation Validation

Goal:

Determine the smallest safe permanent fix for deleted Jira ticket reconciliation so stale rows do not silently re-accumulate in `jira_issue_cache`.

Expected outputs:

- exact current deletion-handling behaviour across `fullSync()`, incremental sync, and single-issue sync
- whether current code can safely reconcile missing Jira issues without schema change
- whether soft-delete, hard-delete, or reconciliation sweep is the smallest credible production-safe fix
- whether downstream snapshot tables rely on rows never disappearing

## Explicit Scope

In scope:

- `jira-sync-service.ts`
- any cache persistence logic touching `jira_issue_cache`
- any snapshot or downstream logic that assumes cache rows persist forever
- evidence needed to route a bounded build

Out of scope:

- KPI calculation logic
- wallboards
- CSAT / derived KPIs
- n8n workflows
- broad SQL redesign

## Decision For This Loop

This is a build-side validation / design-constraint loop, not an implementation loop.

The next step is a bounded Build Agent investigation that produces a permanent-fix recommendation narrow enough to build immediately after review.
