# WS1 Build Report — Loop 01: Diagnostics

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Build Loop 01 (Discovery + Instrumentation)
**Status:** COMPLETE

---

## Work Completed

1. Wrote and executed read-only diagnostic scripts against `jira_issue_cache` (MSSQL)
2. Sampled 200 recent open tickets for SLA field presence analysis
3. Tested `isSlaBreached()` parser against live cached data
4. Audited all distinct request types for Customer Care tier tickets
5. Investigated null request_type root cause for CC tickets
6. Searched local codebase for n8n workflow definitions

Diagnostic scripts: `_diag_sla_cc_audit.mjs`, `_diag_sla_deep.mjs`, `_diag_sla_deep2.mjs` (temporary, can be deleted after review).

---

## Task A: SLA Field Diagnostic Findings

### Summary

**`customfield_14046` (FRT) is completely absent from all cached Jira data. This is the confirmed root cause of 100% FRT compliance and zero per-tier FRT breach counts.**

### Evidence

| Field | Presence in 200 open tickets | Conclusion |
|-------|------------------------------|------------|
| `customfield_14046` (FRT) | **0/200 — ABSENT** | Not returned by Jira REST API. Pipeline reads null. |
| `customfield_14048` (Resolution) | **128/200 — PRESENT** | Named "Resolution". Contains proper SLA structure. |
| `customfield_10010` | **0/200 — ABSENT** | Not returned by Jira REST API. `sla_breached` column is always false. |

### Key Finding 1: FRT Field Does Not Exist in Cached Data

`customfield_14046` is not present in a single `fields_json` record. The pipeline calls `parseSlaField(fields_json, 'customfield_14046')` which returns `null` for every ticket. `isSlaBreached(null)` returns `null` (not `false`), so `frtBreached` is always `null`. Since `totalFrtChecked` counts only non-null results, it stays at 0, and the compliance formula `(0 - 0) / 0` defaults to 100%.

**This fully explains KF-008, KF-009, and KF-012.**

### Key Finding 2: Resolution SLA Field IS Present and Parser Compatible

`customfield_14048` is present in 128/200 open tickets (64%). The existing `isSlaBreached()` parser works correctly:

| Parser Result | Count |
|---------------|-------|
| Breached (true) | 27 |
| Not breached (false) | 101 |
| Field absent | 72 |

The 27/128 = 21% breach rate is plausible for Resolution SLA. The parser correctly handles the `completedCycles[].breached` and `ongoingCycle.breached` structure.

### Key Finding 3: `customfield_10010` Is Dead

Despite being listed in the sync service's `ALL_FIELDS`, `customfield_10010` is not present in any `fields_json` record. The `sla_breached` column derived from it is `false` for all 5,693 cached issues. This column provides no useful signal.

### Key Finding 4: Resolution SLA Structure

`customfield_14048` has `name: "Resolution"` and the structure:
```json
{
  "id": "78",
  "name": "Resolution",
  "completedCycles": [{ "breached": true, "remainingTime": { "millis": -9396228 }, ... }],
  "slaDisplayFormat": "OLD_SLA_FORMAT"
}
```

The field is NOT an array — it's a single object. The parser wraps non-arrays with `[slaField]`, so this works correctly.

### Remaining Question: Where Is the FRT SLA Field?

Three possibilities (in order of likelihood):

1. **FRT is served under a different custom field ID** — the Jira SLA configuration may map FRT to a different `customfield_XXXXX` that NOVA doesn't know about.
2. **FRT requires an API expansion parameter** — some Jira SLA fields require `expand=names,renderedFields` or the Service Desk API (`/rest/servicedeskapi/request/{id}/sla`) rather than the standard REST API.
3. **FRT was removed or renamed** in the Jira instance — `customfield_14046` may be a historical field that no longer exists.

**Resolution path:** Check Jira admin → SLA configuration, or query the Service Desk API directly for a known ticket to discover which SLA IDs map to FRT.

---

## Task B: Customer Care Request-Type Audit Findings

### Summary

**84.8% of open Customer Care tickets (690/814) have null `request_type` and fall through `ccBucket()`. Tightening the ghost KPI emission guard without addressing this would make the vast majority of CC tickets invisible.**

### Evidence: Request-Type Distribution (Open CC Tickets)

| Request Type | Open Count | ccBucket() Result |
|-------------|-----------|-------------------|
| **null** | **688** | **NULL — falls through** |
| TPJ Request | 46 | CC (TPJ) |
| Service Request | 44 | CC (Service Requests) |
| Incident | 28 | CC (Incidents) |
| AI Request | 3 | CC (Incidents) |
| Emailed request | 2 | CC (Incidents) |
| Chat | 1 | CC (Incidents) |
| Support Request | 1 | NULL — falls through |
| Technical Projects | 1 | NULL — falls through |

**Total open: 814. Fallthrough: 690 (84.8%).**

### Root Cause of Null Request Types

- `customfield_13482` (the Jira source for `request_type`) is genuinely `null` in Jira for these tickets.
- All 688 null-RT tickets are `issuetype = Support` — they are legitimate service desk tickets.
- They come from both NT and NTPJ projects.
- These tickets have no Jira Service Management "Customer Request Type" set. This is normal for tickets created via email, API, or direct creation rather than the customer portal.

### Impact Assessment

If the ghost KPI emission guard is tightened to `if (!ALL_TIERS.includes(tier)) continue;`:
- 688 CC tickets with null request type would have `classifyTier() → 'Customer Care'` then `ccBucket() → null`, leaving their tier as `'Customer Care'`
- `'Customer Care'` is NOT in `ALL_TIERS` (only the sub-buckets are)
- These 688 tickets would be silently dropped from all per-tier KPIs
- The "Customer Care" ghost KPI (currently showing 70 tickets) actually represents a real population — just not sub-bucketed

### Additional Fallthrough Types

| Request Type | Open Count | Recommendation |
|-------------|-----------|----------------|
| Support Request | 1 | Add to `ccBucket()` as CC (Incidents) — functionally equivalent to "Incident" |
| Technical Projects | 1 | Determine correct bucket — may be Development or CC |

### Recommendation

Before deploying the ghost KPI emission guard fix, `ccBucket()` must handle null request types. The most defensible approach: **null/unmapped request types on CC-tier tickets should map to `CC (Incidents)`** (the default/catch-all CC sub-bucket). This ensures no legitimate tickets are lost.

---

## Task C: n8n Development Query Findings

### Summary

**The n8n v4 Development backlog JQL is NOT locally discoverable.**

### What Was Checked

| Source | Result |
|--------|--------|
| Local n8n workflow exports | Only `scripts/n8n-nova-sql-setup.json` found (Azure SQL setup, not KPI) |
| `docs/N8N_Workflow_Documentation.md` | Lists workflow IDs and descriptions, but NOT JQL |
| `nova-mcp/` directory | Empty (no workflow definitions) |
| Grep for `KriwNYXfWcGBW7D7` | Not found locally |
| Grep for `issuetype = Support` | Not found in KPI context |

### What Is Known

From `kpi-pipeline.ts` code inspection:
- NOVA's open tickets query: `SELECT ... FROM jira_issue_cache WHERE status_category != 'Done'` — **no issue-type filter**
- NOVA includes all issue types (Support, Bug, Task, Sub-task) in the Development backlog count
- The ~45 ticket delta (NOVA 275 vs JSM ~230) strongly suggests n8n filters by issue type

### Resolution Path

The n8n v4 workflow (ID `KriwNYXfWcGBW7D7`) must be inspected on the n8n instance. Use `mcp__n8n-mcp__n8n_get_workflow` or the n8n UI to check the "Get All Open" node's JQL.

---

## Confirmed Blockers

| # | Blocker | Blocks | Resolution Path |
|---|---------|--------|-----------------|
| B-1 | FRT custom field ID unknown | All FRT metrics (KF-008, KF-009, KF-012) | Check Jira admin SLA config or query Service Desk API |
| B-2 | 84.8% of CC tickets have null request_type | Ghost KPI emission fix (KF-006) | Update `ccBucket()` to handle null → default bucket |
| B-3 | n8n Development JQL not inspected | Development count reconciliation (KF-007) | Inspect n8n v4 workflow on instance |
| B-4 | Business definition: Development backlog scope | Development count fix | Decision from Nick |

---

## Unresolved Business Definition Dependency

> **Should the Development backlog count include all issue types (Support, Bug, Task, Sub-task), or only Support requests?**

This question was raised by the Manager Agent and remains unresolved. It cannot be answered by code inspection — it requires a business decision from Nick.

---

## Recommended Next Manager Actions

1. **Immediate — ccBucket() null handling:** Route a build task to add a null/default mapping in `ccBucket()` before deploying the ghost KPI guard fix. Suggest: `null → 'CC (Incidents)'`.

2. **Immediate — FRT field identity:** Either:
   - Ask Nick to check Jira admin → SLA configuration → which custom field ID maps to "First Response Time"
   - Or write a diagnostic that queries the Jira Service Desk API (`/rest/servicedeskapi/request/{issueKey}/sla`) for a known ticket to enumerate all SLA clock names and IDs

3. **When FRT field is identified:** If it's a field the current REST API doesn't return, the sync service may need to:
   - Add `expand=names` to the JQL search, or
   - Make supplementary Service Desk API calls per ticket, or
   - Use a different field extraction approach

4. **Hold on Development count fix** — pending Nick's business definition and n8n workflow inspection.

5. **Hold on ghost KPI emission guard** — pending B-2 resolution (ccBucket null handling).

---

## Diagnostic Artefacts

| File | Purpose | Disposable? |
|------|---------|-------------|
| `_diag_sla_cc_audit.mjs` | Initial SLA + CC audit | Yes — delete after review |
| `_diag_sla_deep.mjs` | Deep SLA investigation (timed out) | Yes — delete |
| `_diag_sla_deep2.mjs` | Successful deep SLA survey | Yes — delete after review |
