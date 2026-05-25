# WS1-D Manager Brief — Loop 08 (Development Backlog Alignment)

## 1. Context

WS1-D was the final sub-slice of WS1, blocked since programme start on HDR-1 (business definition ambiguity). D-035 resolved HDR-1: **Development backlog = every ticket where `current_tier = Development`**. No issue-type filter. No status sub-filter beyond `status_category != 'Done'`.

This brief records the scoping analysis and manager decisions for WS1-D activation.

---

## 2. Key Discovery: Pipeline Already Matches Governed Definition

Code inspection of `kpi-pipeline.ts` (lines 327-334, 408-414) confirms:

- The pipeline loads all open tickets from `jira_issue_cache` where `status_category != 'Done'`
- Classifies by `current_tier` via `classifyTier()`
- Counts ALL issue types — no `issuetype` filter applied
- Emits `Number of Tickets in Development` to `jira_kpi_daily`

**This is exactly the governed rule from D-035.** No code change is required.

---

## 3. Four-Way Divergence Decomposition

The original G-003 gap (275 / 292 / 230 / 213) decomposes cleanly:

| Surface | Count | Root Cause | Classification | Action |
|---------|-------|-----------|----------------|--------|
| **NOVA KPI Pipeline** | 275 (Run 01) / 279 (Run 02) | Matches governed rule | **No defect** | Verify against live Jira |
| **Tech Support Wallboard** | 292 | Intentionally sums Dev(275) + T3(17) via `sumKpis` config in `index.ts` line ~2562 | **Presentation design** | Label clarity review (optional) |
| **n8n KpiSnapshot** | 213 | Stale (May 15), possibly narrower JQL | **Non-authoritative** | Document only |
| **JSM Queue** | ~230 | Operational filter, not KPI surface | **Non-authoritative** | Document only |

**Critical finding:** The wallboard's 292 count is not a defect. The code explicitly configures:
```typescript
{ label: 'Development — Active Tickets',
  sumKpis: ['Number of Tickets in Development', 'Number of Tickets in Tier 3'] }
```
This is a deliberate design choice to show a consolidated Development+T3 view on the wallboard.

---

## 4. Manager Decisions

### D-037: NOVA KPI Pipeline is the surface closest to the governed Development backlog definition

The pipeline query (`jira_issue_cache WHERE status_category != 'Done'`, classified by `current_tier`, no issue-type filter) is a direct implementation of D-035. No other surface is closer.

### D-038: WS1-D first loop should be a runtime parity verification, not a code change

Since the pipeline already implements the governed rule, the first loop is a **verification task**: cross-check the pipeline's Development count against live Jira JQL to confirm no cache-vs-source drift. This is not a build task — it's a trust-establishment exercise.

### D-039: JSM and n8n should be treated as non-authoritative comparators

- **JSM queues** serve agent workflow purposes. Their JQL is operational, not KPI-aligned. Divergence from the governed definition is expected and not a recovery target.
- **n8n KpiSnapshot** is stale (last run May 15) and may use narrower JQL. HDR-3 (n8n JQL inspection) remains open for documentation purposes but is not a WS1-D blocker.
- Neither surface should be treated as a parity target or an active blocker.

### D-040: Tech Support Wallboard 292 count is intentional Dev+T3 consolidation

The wallboard's `sumKpis` configuration is a deliberate design choice. The 292 = 275 + 17 (Development + Tier 3). This is not a broader status set, not stale data, and not a calculation defect. G-010 is **RESOLVED**.

**Optional follow-up:** The label "Development — Active Tickets" may mislead readers who expect Development-only. A label change to "Development + T3 — Active Tickets" would improve clarity but is not a trust issue.

### D-041: G-003 source-of-truth ambiguity is RESOLVED — reclassified per surface

The original gap was a compound classification. With D-035 providing the governed definition and code inspection confirming pipeline alignment, G-003 is reclassified:
- Pipeline: aligned, no defect
- Wallboard: presentation design, resolved
- n8n/JSM: non-authoritative, closed

---

## 5. WS1-D Verification Scope

The bounded first-slice verification brief should answer:

> Does the NOVA KPI pipeline's Development count match a live Jira JQL query using the governed definition?

**Verification JQL:** `project = NT AND statusCategory != Done AND cf[12981] = "Development"`

**Expected outcome:** The live Jira count should be within normal sync-drift tolerance (±5 tickets) of the pipeline's cached count.

**Success criteria:**
1. Live Jira count obtained via REST API
2. Pipeline count obtained from `jira_issue_cache`
3. Difference is ≤5 tickets (sync timing tolerance)
4. If difference > 5, investigate which tickets are in one source but not the other

**Promotion path if verification passes:** WS1-D → SOURCE DEFINED → ready for independent evaluation (can share regression script with WS1-A/B/C since the pipeline logic is unchanged).

---

## 6. Gaps Logged Neutrally (Not In WS1-D Scope)

| Gap | Notes |
|-----|-------|
| G-009 | SLA Breach Board shows 0 vs Dashboard 103. Different wallboard logic — not a Development count issue. |
| G-011 | Oldest Dev days differ across surfaces. Different "oldest" calculation — deferred. |
| G-012 | FRT parity across Dashboard/Trends. Partially addressed by FRT field fix. Trends staleness is n8n issue. |
| G-013 | Queue size divergence (557 vs 477). Stale n8n + different project/status filters. |
| G-014 | Key Accounts/CS wallboards 12+ hours stale. Workflow/cache refresh defect. |
| HDR-3 | n8n v4 Development JQL inspection. Still pending — for documentation, not blocking. |
| HDR-4 | Escalations tier governance. Deferred to WS2+ (D-024). |

---

## 7. Completion Standard Assessment

| Criterion | Met? |
|-----------|------|
| WS1-D is formally activated as the next governed slice | ✅ Yes — active in verification phase |
| Development backlog KPI has explicit authoritative definition recorded | ✅ Yes — D-035 in KPI Inventory, Lineage Map, Gap Log |
| Four-way divergence reclassified under governed rule | ✅ Yes — G-003 reclassified, G-010 resolved |
| First bounded build/discovery brief is ready | ✅ Yes — verification brief scoped (NA-24) |

**Loop 08 is COMPLETE.**
