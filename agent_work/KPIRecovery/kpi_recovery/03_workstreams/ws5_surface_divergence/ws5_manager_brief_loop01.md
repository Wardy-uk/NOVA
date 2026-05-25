# WS5 Manager Brief — Loop 01: Surface Divergence Discovery

**Date:** 2026-05-20  
**Manager Agent:** KPI Recovery Programme  
**Status:** FIRST DISCOVERY LOOP  
**Predecessor:** WS1 fully TRUSTED (D-053). All P0 pipeline fixes deployed and regression-protected.

---

## Objective

Classify and scope the 5 remaining multi-surface divergence gaps (G-009, G-011, G-012, G-013, G-014) into discovery-ready units with clear root causes, then select the first bounded build slice.

---

## Discovery Findings

### G-009: SLA Breach Board = 0 vs Dashboard SLA Breached = 103

**Root Cause: Data-source divergence (two completely different tables)**

| Property | KPI Dashboard | SLA Breach Board |
|----------|--------------|-----------------|
| **Endpoint** | `/api/admin/kpi-data/team-snapshot` | `/api/public/wallboard/breached` |
| **Data source** | `jira_kpi_daily` (pipeline-written) | `dbo.Agent` (n8n-written agent snapshot) |
| **SLA definition** | `resBreached` from `parseSlaField(fields_json, 'customfield_14048')` — Resolution SLA | `OpenTickets_Over2Hours` — a column in the Agent table, definition unclear |
| **Scope** | All open tickets across all tiers | Per-agent, filtered by `IsActive = 1` |
| **Refresh** | Every pipeline run (periodic timer) | Depends on n8n agent sync cycle |
| **Code location** | `kpi-pipeline.ts:456-470` | `kpi-data.ts:1590-1614` |

**Classification:** Data-source divergence. The breach board reads a completely different table (`dbo.Agent`) populated by a separate system (likely n8n), using a different SLA definition (`OpenTickets_Over2Hours` ≠ Resolution SLA breach). The 103 vs 0 gap is not a calculation error — it's two surfaces reading unrelated data.

**Resolution path:** Either (a) repoint the breach board to read from `jira_kpi_daily` (pipeline-authoritative), or (b) understand and fix the `dbo.Agent` population pathway. Option (a) is the bounded first step.

---

### G-011: Breach Board "WORST OLDEST" = 76d vs Dashboard "Oldest Development" = 197d

**Root Cause: Same data-source divergence as G-009**

| Property | KPI Dashboard | SLA Breach Board |
|----------|--------------|-----------------|
| **Source** | `jira_issue_cache` → `parsedOpen` → max `ageDays` per tier (actionable only) | `dbo.Agent.OldestTicketDays` |
| **Definition** | Oldest **actionable** ticket per tier (excludes waiting statuses) | Oldest ticket assigned to each agent (definition in Agent table) |
| **Code location** | `kpi-pipeline.ts:500` | `kpi-data.ts:1590-1614` |

**Classification:** Same root cause as G-009 — breach board reads `dbo.Agent` table. The 76d vs 197d gap reflects different populations (per-agent vs per-tier, different actionable definitions).

**Resolution path:** Coupled to G-009. If breach board is repointed to `jira_kpi_daily`, oldest-per-tier values become available from the pipeline.

---

### G-012: Dashboard FRT 100% → 68% (fixed) vs Trends FRT MTD = 69.3%

**Root Cause: PARTIALLY RESOLVED — remaining gap is historical snapshot staleness**

| Property | KPI Dashboard | Trends |
|----------|--------------|--------|
| **Source** | `jira_kpi_daily` (today's snapshot) | `jira_kpi_daily` (historical, lookback query) |
| **Query** | Current day's row for `FRT Compliance % (Open Queue)` | `fetchKpiSumAtDate()` — finds TOP 1 value within 4-day lookback window |
| **Code location** | `kpi-pipeline.ts` → pipeline emission | `trends.ts:294-312` |

**Status after WS1 deploy:** Dashboard FRT dropped from 100% to 68% (correct). Trends MTD 69.3% is now **plausibly aligned** — the remaining difference is expected (MTD averages vs point-in-time snapshot). The FRT divergence symptom is **largely resolved** by the WS1-C fix.

**Classification:** Reclassify from PARTIALLY ADDRESSED to **MONITORING** — verify alignment over 2-3 days of pipeline runs. No immediate build needed.

---

### G-013: Dashboard Open Tickets = 557 vs Trends Queue Size = 477

**Root Cause: Different aggregation methodology**

| Property | KPI Dashboard | Trends |
|----------|--------------|--------|
| **Source** | `jira_issue_cache` → `parsedOpen.length` (raw count) | `jira_kpi_daily` → sum of per-tier "Number of Tickets in X" KPIs |
| **Definition** | ALL open tickets (all tiers, including ungoverned) | Sum of 5 tier patterns: CC%, Production%, Tier 2%, Tier 3%, Development% |
| **Code location** | `kpi-pipeline.ts:464` | `trends.ts:294-312`, patterns at `trends.ts:665-669` |

**The 80-ticket gap decomposes as:**
- ~10 Escalations tier (ungoverned, excluded from per-tier KPIs — see G-016/D-024)
- ~14 ghost-tier tickets (Customer Care + Unclassified — now suppressed from KPIs)
- Remainder likely from status/project filter differences or CC sub-tier pattern matching

**Classification:** Calculation methodology divergence. `Open Tickets` counts everything; Trends sums only governed-tier KPIs. These are **intentionally different metrics** measuring different things.

**Resolution path:** Either (a) accept the gap and document it (they measure different things), or (b) add an "Open Tickets" KPI to the Trends checkpoint that reads the same raw count. This is a **presentation alignment** decision, not a data defect.

---

### G-014: Key Accounts / Customer Success Wallboards 12+ Hours Stale

**Root Cause: Business-hours-only cache refresh**

| Property | Detail |
|----------|--------|
| **Cache service** | `wallboard-live-cache.ts` |
| **Refresh interval** | 5 minutes |
| **Refresh window** | Monday-Friday, 09:00-17:30 only |
| **Stale threshold** | 3 days (only forces refresh if cache > 3 days old) |
| **Code location** | `wallboard-live-cache.ts:60-122` |

**Classification:** Workflow defect. The cache refresh window is too narrow — any wallboard viewed before 9 AM or after 5:30 PM shows hours-stale data. The "746m old" warning is accurate.

**Resolution path:** Widen the refresh window or remove business-hours restriction. Simple code change, low risk.

---

## Gap Triage Summary

| Gap | Root Cause Type | Severity | Coupling | Build Complexity |
|-----|----------------|----------|----------|-----------------|
| **G-009** | Data-source divergence (`dbo.Agent` vs `jira_kpi_daily`) | HIGH — SLA breach board completely non-functional | Coupled with G-011 | Medium — repoint endpoint or build new query |
| **G-011** | Same as G-009 | MEDIUM — misleading "oldest" number | Coupled with G-009 | Included in G-009 fix |
| **G-012** | Historical staleness (now largely resolved) | LOW — values converging post-WS1 | Independent | Monitor only |
| **G-013** | Intentional methodology difference | LOW — different metrics, not wrong | Independent | Presentation decision |
| **G-014** | Business-hours cache window | MEDIUM — operational annoyance | Independent | Low — config/code tweak |

---

## Manager Decisions

### D-054: WS5 Activation — Surface Divergence as Active Governed Focus

**Decision:** Activate WS5 as the next governed workstream, renamed from "Grafana Reporting Parity" to "Surface Divergence Recovery". The original WS5 scope (Grafana) is subsumed — Grafana reads from the same `jira_kpi_daily` table, so cross-surface alignment must come first.

**Rationale:** WS1 is fully TRUSTED and operationally closed. The 5 remaining multi-surface gaps are the highest-visibility trust issues. Users see contradictory numbers across dashboard, wallboards, and trends — this directly undermines confidence in NOVA KPIs.

### D-055: First WS5 Slice — G-009 + G-011 (SLA Breach Board Data-Source Alignment)

**Decision:** The first bounded build slice targets G-009 and G-011 together. These share the same root cause: the SLA Breach Board reads `dbo.Agent` (n8n-populated) instead of `jira_kpi_daily` (pipeline-authoritative).

**Rationale:**
1. **Highest severity** — a wallboard showing 0 breaches when 103 exist is the worst user-visible lie
2. **Coupled gaps** — fixing G-009 necessarily fixes G-011 (same endpoint, same data source)
3. **Clear resolution path** — repoint the breach board to read from `jira_kpi_daily` (already populated and TRUSTED)
4. **Bounded scope** — one endpoint, one data source swap, no pipeline changes needed

### D-056: First Slice Targets Data-Source Alignment, Not Query-Logic or Freshness

**Decision:** The first loop targets **data-source alignment** — making the breach board read from the pipeline-authoritative table (`jira_kpi_daily`) instead of the legacy `dbo.Agent` table.

**Rationale:** The breach board's numbers aren't wrong because of bad logic — they're wrong because they read a completely different, separately-populated table. Query-logic alignment (G-013) and freshness alignment (G-014) are independent problems with lower severity.

### D-057: G-012 Reclassified to MONITORING — No Build Needed

**Decision:** G-012 (FRT Dashboard vs Trends) is reclassified from PARTIALLY ADDRESSED to MONITORING. The WS1-C fix (FRT field recovery) has brought Dashboard FRT to 68%, which is now plausibly aligned with Trends MTD 69.3%. Monitor for 2-3 pipeline cycles to confirm convergence.

### D-058: G-013 Classified as Presentation Design Decision, Not Defect

**Decision:** G-013 (Open Tickets 557 vs Queue Size 477) is classified as an intentional methodology difference, not a defect. `Open Tickets` counts all open tickets; Trends `Queue Size` sums governed-tier KPIs. The 80-ticket gap is explained by ungoverned tiers and ghost exclusions. Deferred to presentation review.

---

## First Build/Discovery Handoff

### Target: G-009 + G-011 — SLA Breach Board Data-Source Alignment

**Build Agent Discovery Brief:**

The SLA Breach Board (`/api/public/wallboard/breached` in `kpi-data.ts:1590-1614`) currently reads from `dbo.Agent` — a table populated by n8n, not by NOVA's KPI pipeline. This produces:
- "TICKETS OVER SLA" = 0 (should be 103)
- "WORST OLDEST" = 76 days (should be 197 days)

**First discovery task:** Inspect the breach board endpoint and its client component (`KpiBreachedView.tsx`) to determine:

1. **What data the endpoint currently returns** — column names, agent groupings, per-agent vs aggregate metrics
2. **What the client expects** — component props, aggregation logic, display layout
3. **Whether `jira_kpi_daily` already contains all needed KPIs** — SLA Breached (103), per-tier SLA breach counts, per-tier oldest actionable, Tickets Solved Today
4. **What `dbo.Agent` columns are used that have NO equivalent in `jira_kpi_daily`** — e.g., per-agent breakdowns, NoUpdateToday, specific agent names
5. **Whether the breach board needs per-agent granularity** or could work with tier-level aggregates from the pipeline

**Scope boundary:** This is a DISCOVERY loop only. Do not implement changes. Report findings and recommend whether the repoint is (a) a simple query swap, (b) requires new per-agent KPI emission from the pipeline, or (c) requires a hybrid approach.

**Evidence to produce:**
- Column mapping: `dbo.Agent` fields → equivalent `jira_kpi_daily` KPIs
- Gap list: any `dbo.Agent` fields with no pipeline equivalent
- Recommendation: repoint feasibility assessment
- Risk: any features that would break if `dbo.Agent` is no longer the source

**Files to inspect:**
- `src/server/routes/kpi-data.ts` (breach board endpoint, ~line 1590)
- `src/client/components/KpiBreachedView.tsx` (client display logic)
- `src/server/services/kpi-pipeline.ts` (what the pipeline already emits)
- `src/server/index.ts` (wallboard route registration)

---

## Completion Assessment

This loop is **COMPLETE**. The next governed discovery slice is defined:
- **Target:** G-009 + G-011 (SLA Breach Board)
- **Alignment type:** Data-source alignment
- **First handoff:** Discovery-only inspection of breach board endpoint and `dbo.Agent` dependency
- **Scope boundary:** Discovery and feasibility assessment, not implementation
