# WS1 Manager Brief — Loop 04: FRT Build Complete + Multi-Surface Divergence

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Fourth manager loop (post-FRT build + audit cross-surface evidence)
**State:** ACTIVE — all code builds complete, deployment + runtime verification required

---

## Programme State Shift

Build Loop 03 completed the last code change in the WS1 P0 slice. All four sub-slices now have clear status:

| Sub-Slice | Code State | Trust State | Next Step |
|-----------|-----------|-------------|-----------|
| **WS1-A:** Ghost suppression / CC visibility | BUILD COMPLETE | UNTRUSTED → pending evaluation | Deploy + evaluate |
| **WS1-B:** Resolution SLA | VERIFIED | **SOURCE DEFINED** | Evaluate |
| **WS1-C:** FRT recovery | BUILD COMPLETE | UNTRUSTED → pending deploy/runtime | Deploy + re-sync + verify + evaluate |
| **WS1-D:** Development backlog | EXTERNALLY BLOCKED | UNTRUSTED | Await Nick (HDR-1) |

**Critical new context:** The comprehensive audit (Part 8) reveals that KPI trust failure is not confined to `jira_kpi_daily` pipeline correctness. It extends across three surfaces that read different data sources with different logic, producing user-visible contradictions. This is now a governed programme concern.

---

## What Changed After Build Loop 03

### FRT Recovery Findings

| Finding | Detail |
|---------|--------|
| Field addition | `customfield_14046` added to `ALL_FIELDS` in `jira-sync-service.ts` |
| Compilation | Clean — no TypeScript errors |
| NT presence | 20/20 sampled NT tickets return FRT data from Jira API |
| NTPJ presence | 0/5 — matches Resolution SLA project-level pattern |
| Parser compatibility | **CONFIRMED** — identical structure to `customfield_14048` (Resolution SLA) |
| Simulated FRT Compliance % | **~72.3%** (vs current trivial 100%) |
| Simulated per-tier FRT breaches | Non-zero — Development shows most breaches (consistent with 30-minute FRT goal + escalation patterns) |
| FRT goal | 30 minutes (1,800,000 ms) — breaches accumulate fast |
| Formula changes needed | **None** — existing `isSlaBreached()` handles the structure correctly |

### What Still Requires Runtime

The FRT code change is verified against the live Jira API but has not been deployed. After deployment:
1. Server restart triggers `fullSync()` with updated `ALL_FIELDS`
2. `fields_json` populates with `customfield_14046` for all cached tickets
3. Next `collectJiraSnapshot()` produces real FRT values
4. FRT Compliance % drops from 100% to ~60-75%
5. Per-tier FRT breach counts become non-zero

---

## Multi-Surface Divergence — New Governance Concern

The audit (Part 8) establishes that NOVA's KPI trust problem is not just a pipeline calculation issue. Three different surfaces read different data sources and produce contradictory values visible to users.

### Evidence of Cross-Surface Divergence

| Metric | KPI Dashboard (`jira_kpi_daily`) | Trends (`KpiSnapshot`) | Wallboard (live cache) | JSM |
|--------|--------------------------------|----------------------|----------------------|-----|
| FRT Compliance % | 100% | 69.3% MTD | — | — |
| Total Queue Size / Open Tickets | 557 | 477 | — | — |
| SLA Breached | 103 | — | **0** (Breach Board) | — |
| Development Count | 275 | 213 | **292** (Tech Support) | ~230 |
| TOTAL KPIS (count) | 88 (includes 14 ghosts) | — | 88 (Breach Board) | — |
| CSAT % | 0% | 0% (was 100% last month) | — | — |
| Oldest Development | 197 days | — | 76 days (Breach Board) | — |
| Key Accounts data | — | — | **746 minutes stale** | — |
| Customer Success data | — | — | **747 minutes stale** | — |

### Source Boundary Analysis

| Surface | Data Source | Query Path | Freshness |
|---------|-----------|-----------|-----------|
| KPI Dashboard | `jira_kpi_daily` (Azure SQL) | Reads NOVA pipeline output | Updated each snapshot cycle |
| Trends | `KpiSnapshot` (Azure SQL) | Reads n8n v3.1 output (last run May 15) | **5 days stale** — n8n workflow INACTIVE |
| SLA Breach Wallboard | Live `jira_issue_cache` | Direct cache query with different SLA/actionable logic | Real-time but different filter logic |
| Tech Support Wallboard | Live `jira_issue_cache` | Direct cache query — may include broader status set | Real-time but different filter logic |
| KPI Breach Wallboard | `jira_kpi_daily` | Reads same as Dashboard | Same pipeline — inherits ghost KPIs |
| Key Accounts / CS Wallboards | Live cache | Filtered to customer cohort | **12+ hours stale** |

### Classification of Surface Divergences

| Divergence | Root Cause Category | Recovery Scope |
|------------|-------------------|----------------|
| FRT 100% (dashboard) vs 69.3% (trends) | **Data defect** (FRT field missing from cache) + **source divergence** (Trends reads stale n8n data) | WS1-C fixes the dashboard side; Trends staleness is a separate problem |
| SLA Breach 103 (dashboard) vs 0 (wallboard) | **Calculation defect** — wallboard uses different SLA/actionable definitions from pipeline | Requires wallboard query audit (new scope) |
| Dev count 275/292/230/213 | **Source-of-truth ambiguity** (no business definition) + **calculation defect** (wallboard may include broader status set) | WS1-D (business definition) + wallboard query audit |
| Oldest Dev 197 vs 76 days | **Calculation defect** — wallboard likely uses different "oldest" definition or excludes certain statuses | Wallboard query audit |
| Total KPIs 88 including ghosts | **Calculation defect** (ghost emission) | WS1-A fix resolves this |
| Key Accounts / CS 12hr stale | **Workflow defect** — wallboard cache refresh not running | Separate operational issue |

---

## Manager Decisions

### MD-A: WS1-A Ghost Suppression — READY FOR EVALUATION AFTER DEPLOY

**Decision:** Ghost suppression is ready for independent evaluation. The evaluator should execute after deployment produces at least one new `collectJiraSnapshot()` run.

**What the evaluator checks (unchanged from `ws1_ab_evaluator_brief_v1.md`):**
1. No "Customer Care" or "Unclassified" tier KPIs in `jira_kpi_daily`
2. CC (Incidents) volume ~722 (absorbing 688 null-RT tickets)
3. CC sub-tier volumes sum to total open CC-tier tickets
4. All 7 governed tiers present in output
5. TOTAL KPIS count drops from 88 to ~74

**Additional evaluation note:** The KPI Breach Wallboard (which reads `jira_kpi_daily`) should also show reduced TOTAL KPIS and reduced RED count after ghost removal. This is a natural consequence, not a separate check.

### MD-B: WS1-B Resolution SLA — SOURCE DEFINED, Evaluator Brief Unchanged

**Decision:** Resolution SLA remains at SOURCE DEFINED. The existing partial evaluator brief (`ws1_ab_evaluator_brief_v1.md`) covers Resolution SLA adequately. No changes needed.

**Note:** The audit confirms Resolution Compliance % (Open Queue) = 82% on the dashboard. This is consistent with the Build Loop 02 verification (82.4% computed from cache). Trends shows 76% from May 15 — the 6% drift is expected given 5 days of ticket movement.

### MD-C: WS1-C FRT — SOURCE DEFINED PENDING RUNTIME CONFIRMATION

**Decision:** FRT should be advanced to SOURCE DEFINED *contingent on runtime verification*. The code change is verified, the parser is confirmed, the field is available from Jira, and the simulated output is plausible. However, SOURCE DEFINED requires the data to actually be present in the production cache.

**Promotion criteria (must all be met):**
1. Code deployed (server restart triggers full re-sync)
2. `customfield_14046` confirmed present in `fields_json` for NT tickets post-sync
3. FRT Compliance % (Open Queue) is no longer 100%
4. Per-tier FRT breach counts are non-zero for at least one tier

**Evaluation addendum timing:** The FRT addendum to the evaluator brief should be created AFTER runtime verification confirms the criteria above. Do NOT include FRT in the evaluator brief until production evidence exists.

**Rationale for waiting:** The simulation is compelling (72.3% compliance, non-zero breaches, parser confirmed), but the programme standard requires observed data, not simulated data, before declaring source-defined. Build agent confidence is not sufficient.

### MD-D: WS1-D Development Backlog — BLOCKED, Four-Way Divergence Strengthens Case

**Decision:** Development backlog remains blocked by HDR-1. The four-way divergence (275 / 292 / 230 / 213) from the audit strengthens the argument that this is a governance decision, not a code fix.

| Source | Count | Probable Filter |
|--------|-------|-----------------|
| KPI Dashboard (`jira_kpi_daily`) | 275 | All issue types, tier=Development, status_category≠Done |
| Tech Support Wallboard (live cache) | 292 | Live cache, may include broader status set |
| JSM Queue | ~230 | Likely issuetype=Support only |
| n8n KpiSnapshot (May 15) | 213 | Unknown filter, 5 days stale |

The wallboard showing 292 (vs dashboard 275) adds a new dimension — the wallboard may be querying a broader status set than the KPI pipeline. This means even after Nick answers "which issue types?", there will be a second question about status-filter alignment between surfaces.

**Updated HDR-1 recommendation:** When Nick answers the issue-type question, also ask: "Should the wallboard Development count use the same filter as the KPI dashboard?"

### MD-E: Multi-Surface Divergence — CAPTURED AS NEXT GOVERNED RECOVERY SCOPE

**Decision:** Dashboard / Trends / Wallboard source-boundary divergence must become a governed recovery concern, not an ad hoc observation. It should be the next workstream focus after WS1 pipeline correctness is stabilised.

**Classification:** This is primarily a **source-of-truth ambiguity** problem (different surfaces reading different sources) with secondary **calculation defects** (wallboards using different filter logic) and **workflow defects** (stale cache, inactive n8n workflows).

**What this is NOT:** It is not one root cause. Each surface divergence has its own explanation. Collapsing them into a single fix would be premature.

**Governance routing:**
- Wallboard SLA/filter divergence → could be handled as a WS2 (Calculation Validation) sub-item or a new dedicated workstream
- Trends staleness → could be handled as WS4 (n8n Workflow Integrity) since Trends depends on n8n's `KpiSnapshot` output
- The Key Accounts / Customer Success cache staleness (12+ hours) is an operational/infrastructure issue, not a KPI calculation problem

**This decision does not create a new build.** It establishes that after WS1-A/B/C are evaluated and WS1-D is unblocked, surface parity becomes the next recovery focus. The scope decision for that work should be made in a future manager loop.

---

## Evaluation Routing

### Immediate (after deploy)

Execute `ws1_ab_evaluator_brief_v1.md` for WS1-A + WS1-B. This brief is already written and requires only the deployment precondition.

### After Runtime Verification (WS1-C)

Once the FRT runtime criteria from MD-C are met, create a narrow addendum:

**`ws1_c_evaluation_addendum_01.md`** — FRT metrics evaluation:
- FRT Compliance % (Open Queue) is plausible (not 100%, roughly consistent with simulation range)
- Per-tier FRT breach counts are non-zero for at least some tiers
- FRT field presence pattern matches Resolution SLA (NT has it, NTPJ/YO lack it)
- FRT Compliance % denominator excludes tickets without FRT data (same methodology as Resolution SLA)

This addendum should be created by the manager in the next loop, not pre-written now, because the exact runtime values are needed to set realistic check criteria.

### Not Yet

- WS1-D (Development count) — blocked by HDR-1
- Surface parity evaluation — not yet scoped as a workstream
- Full WS1 convergence evaluation — premature until all sub-slices have passed

---

## Human Decision Requests — Updated

| ID | Question | For | Status |
|----|----------|-----|--------|
| HDR-1 | Should Development backlog include all issue types or only Support? (Now with four-way count divergence as evidence) | Nick | **STILL PENDING** |
| HDR-2 | FRT field identity | Jira Admin | **RESOLVED** (D-017) |
| HDR-3 | n8n v4 Development JQL inspection | n8n Owner / Nick | **STILL PENDING** |

---

## Deploy Readiness

All three WS1 code changes can ship as a single deployment:

| Change | File | Status |
|--------|------|--------|
| ccBucket() null default | `kpi-pipeline.ts` | ✅ Built, compiles |
| Ghost emission guard | `kpi-pipeline.ts` | ✅ Built, compiles |
| FRT field inclusion | `jira-sync-service.ts` | ✅ Built, compiles |

**Post-deploy requirements:**
1. Server restart (triggers full re-sync with `customfield_14046`)
2. Wait for full sync to complete (~5 minutes for 2000+ issues)
3. Wait for next `collectJiraSnapshot()` cycle
4. Verify: ghost KPIs gone, FRT values non-trivial, Resolution SLA unchanged

---

## Next Loop Trigger

This manager loop is complete. The next manager loop (Loop 05) should fire after:
1. All three changes are deployed
2. At least one `collectJiraSnapshot()` run has completed post-deploy
3. WS1-A/B evaluation has been executed (or is ready to execute)
4. FRT runtime verification criteria can be checked
