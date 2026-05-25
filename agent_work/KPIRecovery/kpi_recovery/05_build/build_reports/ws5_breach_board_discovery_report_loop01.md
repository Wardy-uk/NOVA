# WS5 Breach Board Discovery Report — Loop 01

**Date:** 2026-05-20  
**Scope:** G-009 + G-011 — SLA Breach Board data-source tracing  
**Status:** DISCOVERY COMPLETE  

---

## 1. Breach Board Endpoint & Handler Locations

The SLA Breach Board is served by **two independent endpoints** with identical query logic:

| Endpoint | File | Lines | Auth | Response |
|----------|------|-------|------|----------|
| `GET /wallboard/breached` | `src/server/index.ts` | 2149–2268 | None (TV wallboard) | Server-rendered HTML |
| `GET /api/public/wallboard/breached` | `src/server/routes/kpi-data.ts` | 1590–1614 | None (public API) | JSON `{ ok, data, ts }` |

Both open their own ad-hoc MSSQL connection to the KPI database (`kpi_sql_server` settings), query `dbo.Agent`, and close.

The React client (`src/client/components/KpiBreachedView.tsx`, line 67) calls the JSON endpoint when embedded in-app or the HTML endpoint when in wallboard mode.

---

## 2. Exact Source Tables and Queries

### Primary query (both endpoints)

```sql
SELECT AgentName, AgentSurname, TierCode, Team,
       OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
       ISNULL(OldestTicketDays, 0) AS OldestTicketDays, OldestTicketKey,
       SolvedTickets_Today, TicketsSnapshotAt
FROM dbo.Agent
WHERE IsActive = 1 AND Department IN ('NT', 'NOVA_AI')
ORDER BY OpenTickets_Over2Hours DESC, AgentName
```

**Source table:** `dbo.Agent` (KPI MSSQL database, `techservicesjsm`)

### Dynamic column checks

Before querying, both endpoints probe `sys.columns` for:
- `OldestTicketDays` — falls back to `0` if absent
- `OldestTicketKey` — omitted from SELECT if absent
- `Department` — omits department filter if absent

### How dbo.Agent is populated

`kpi-pipeline.ts:refreshAllAgentMetrics()` (lines 948–1073) populates `dbo.Agent` by:

1. Querying **local MSSQL** `jira_issue_cache` (NOT `jira_kpi_daily`):
   - `OpenTickets_Over2Hours`: `SUM(CASE WHEN sla_breached = 1 AND status NOT IN (Done/Closed/Resolved/WoR/WoP) AND (due_date IS NULL OR due_date <= today) THEN 1 END)`
   - `OpenTickets_NoUpdateToday`: `SUM(CASE WHEN jira_updated < today THEN 1 END)`
   - `OldestTicketDays`: `MAX(DATEDIFF(day, jira_created, GETUTCDATE()))`
   - `OpenTickets_Total`: `COUNT(*)`
   - **Tier filter:** `current_tier IN ('Customer Care', 'Production', 'Tier 2', 'Tier 3')` — **Development tier is EXCLUDED**
   - **Onboarding filter:** `request_type != 'onboarding'`

2. Querying `jira_issue_cache` for `SolvedTickets_Today` (status_category = Done, updated today)

3. Writing per-agent UPDATE to `dbo.Agent WHERE AccountId = @accountId`

4. Zeroing out agents not in the open-tickets result set

**Critical finding:** `OldestTicketKey` is NEVER written by the pipeline. It is read from `dbo.Agent` but no NOVA code populates it. It must be written by an external system (likely n8n).

**Critical finding:** `refreshAllAgentMetrics()` excludes Development tier agents entirely. Any Development-tier tickets are invisible to the breach board.

---

## 3. Field-by-Field Mapping Table

### Summary KPI Cards (4 cards rendered at top of board)

| Breach Board Value | Current Source | Calculation | Pipeline Equivalent (`jira_kpi_daily`) | Equivalence |
|---|---|---|---|---|
| **Tickets Over SLA** | `SUM(dbo.Agent.OpenTickets_Over2Hours)` | Sum across all active agents | `SLA Breached` KPI (line 465): count of `resBreached === true` in open queue | **Approximate** — different SLA definition (see §4) |
| **Agents Breached** | Count of agents where `OpenTickets_Over2Hours > 0` | Per-agent count + ratio | No pipeline equivalent | **No equivalent** — pipeline emits per-tier, not per-agent |
| **Tickets Not Updated** | `SUM(dbo.Agent.OpenTickets_NoUpdateToday)` | Per-agent, rolled up | No pipeline equivalent | **No equivalent** — not a KPI in `jira_kpi_daily` |
| **Worst Oldest (days)** | `MAX(dbo.Agent.OldestTicketDays)` | Max across all agents | Per-tier `{Tier} — Oldest Actionable` KPIs (line 500) | **Approximate** — pipeline is per-tier and actionable-only |

### Per-Agent Table Columns (7 columns)

| Column | dbo.Agent Field | Pipeline Equivalent | Equivalence |
|---|---|---|---|
| **Agent** (name) | `AgentName`, `AgentSurname` | No equivalent | **No equivalent** — pipeline emits per-tier aggregates, not per-agent |
| **Team** (tier badge) | `TierCode` or `Team` | No equivalent | **No equivalent** — `dbo.Agent` stores the agent's team assignment |
| **Open** (total tickets) | `OpenTickets_Total` | No equivalent at agent level | **No equivalent** — per-tier volumes exist but not per-agent |
| **Over SLA** | `OpenTickets_Over2Hours` | No equivalent at agent level | **No equivalent** — per-tier SLA breach counts exist but not per-agent |
| **Not Updated** | `OpenTickets_NoUpdateToday` | No equivalent at any level | **No equivalent** — not emitted to `jira_kpi_daily` at all |
| **Oldest (days)** | `OldestTicketDays` | No equivalent at agent level | **No equivalent** — per-tier oldest actionable exists but not per-agent |
| **Oldest link** | `OldestTicketKey` | No equivalent | **No equivalent** — not written by pipeline, not in `jira_kpi_daily` |
| **Solved Today** | `SolvedTickets_Today` | `Tickets Solved Today` (global KPI, line 467) | **Approximate** — global total exists, per-agent does not |

---

## 4. SLA Definition Divergence

| Property | Breach Board (via `refreshAllAgentMetrics`) | Dashboard (via `collectJiraSnapshot`) |
|---|---|---|
| **SLA field** | `sla_breached` column in `jira_issue_cache` (binary flag, source unclear) | `parseSlaField(fields_json, 'customfield_14048')` — Resolution SLA from Jira fields JSON |
| **Additional filters** | `status NOT IN (Done, Closed, Resolved, WoR, WoP)` AND `due_date IS NULL OR <= today` | `resBreached === true` (from parsed SLA object, checks `isBreached`/`elapsedTime` vs `goal`) |
| **Actionability** | Not considered | Splits into `resBreachedActionable` and `resBreachedNotActionable` based on `slaActionable` |
| **Tier scope** | CC, Production, Tier 2, Tier 3 only | All tiers including Development |

The `sla_breached` column in `jira_issue_cache` and the parsed `customfield_14048` Resolution SLA may measure the same underlying fact, but they use different extraction paths. The breach board path also excludes Development tier entirely.

---

## 5. Why the Board Shows 0

The breach board displays 0 for "Tickets Over SLA" because:

1. `refreshAllAgentMetrics()` queries `jira_issue_cache` and UPDATEs `dbo.Agent`
2. But it only updates agents whose `AccountId` exists in `dbo.Agent` already (`WHERE AccountId = @accountId`)
3. If `dbo.Agent` rows don't have matching `AccountId` values, or if `refreshAllAgentMetrics()` is failing/not running, no data flows through
4. The zeroing logic (lines 1040–1064) actively zeros out agents not in the result set

The most likely immediate cause: either `dbo.Agent.AccountId` values don't match `jira_issue_cache.assignee_account_id`, or `refreshAllAgentMetrics()` is encountering an error (it has a silent catch at line 1070–1072).

---

## 6. dbo.Agent Dependency Analysis

The breach board's per-agent table is **fundamentally dependent on per-agent data**. The pipeline (`jira_kpi_daily`) emits:

- **Per-tier aggregates:** Volume, No Reply, Oldest Actionable, SLA Breached (Actionable/Not Actionable), FRT Breached — all per tier
- **Global aggregates:** SLA Breached (total), Open Tickets, Solved Today
- **NO per-agent data in `jira_kpi_daily`**

The breach board needs:
- Per-agent name, team, open count, SLA breach count, not-updated count, oldest ticket, solved today
- Agent-level granularity is the core purpose of this wallboard

**Conclusion:** `jira_kpi_daily` cannot serve as the sole data source for the breach board in its current form. The board requires per-agent granularity that the pipeline does not emit.

---

## 7. What dbo.Agent Provides That No Pipeline Table Does

| Data Point | Available in `jira_kpi_daily`? | Available in `jira_issue_cache`? | Available in `dbo.Agent`? |
|---|---|---|---|
| Per-agent SLA breach count | No | Yes (can be computed) | Yes (pre-computed) |
| Per-agent open ticket count | No | Yes (can be computed) | Yes (pre-computed) |
| Per-agent "not updated today" | No | Yes (can be computed) | Yes (pre-computed) |
| Per-agent oldest ticket age | No | Yes (can be computed) | Yes (pre-computed) |
| Per-agent oldest ticket key | No | Yes (can be computed) | Partially (populated externally) |
| Per-agent solved today | No | Yes (can be computed) | Yes (pre-computed) |
| Agent name / team | No | No (has `assignee_display` only) | Yes (canonical roster) |
| Agent active status | No | No | Yes |

**Key insight:** `dbo.Agent` is a **pre-computed materialized view** of per-agent metrics derived from `jira_issue_cache`. The pipeline's `refreshAllAgentMetrics()` already does this computation — the problem is in the data flow, not the architecture.

---

## 8. Explicit Finding: Is dbo.Agent the Divergence Source?

**YES.** `dbo.Agent` is definitively the divergence source for both G-009 and G-011:

- **G-009 (SLA Breached = 103 vs 0):** The dashboard reads `jira_kpi_daily.SLA Breached` = 103. The breach board reads `dbo.Agent.OpenTickets_Over2Hours` summed across agents = 0. The zeroing is because `refreshAllAgentMetrics()` either cannot match agents or is failing silently.

- **G-011 (Oldest 197d vs 76d):** The dashboard reads per-tier `Oldest Actionable` from pipeline output (max = 197d for Development). The breach board reads `dbo.Agent.OldestTicketDays` (max = 76d). The gap exists because: (a) Development tier is excluded from `refreshAllAgentMetrics()`, and (b) the breach board's definition is per-agent oldest (any ticket) vs. pipeline's per-tier oldest (actionable only).

---

## 9. Recommendation: Next Implementation Shape

### NOT a simple source swap

The breach board **cannot** be repointed from `dbo.Agent` to `jira_kpi_daily` because `jira_kpi_daily` contains only tier-level and global aggregates. The breach board's core value is **per-agent visibility**.

### Recommended path: Fix the existing `dbo.Agent` population pathway

The correct architecture is already in place:

```
jira_issue_cache → refreshAllAgentMetrics() → dbo.Agent → breach board
```

The problem is not architectural — it's operational:

1. **Diagnose why `refreshAllAgentMetrics()` produces zeros** — either `AccountId` mismatch, silent errors, or the method not being called on schedule
2. **Add Development tier** to the tier filter in `refreshAllAgentMetrics()` (line 976) to close the G-011 gap
3. **Align the SLA definition** — ensure `sla_breached` in `jira_issue_cache` matches the pipeline's `resBreached` from `customfield_14048`
4. **Populate `OldestTicketKey`** from the pipeline (it's currently only written externally)

### Implementation complexity: **Source fix + minor transformation**

| Step | Complexity | Risk |
|---|---|---|
| Debug `refreshAllAgentMetrics()` zero-output | Low — add logging, check AccountId matching | Low |
| Add Development to tier filter | Trivial — one line change | Low |
| Align SLA breach definition | Medium — need to verify `sla_breached` column lineage | Medium |
| Add `OldestTicketKey` to pipeline output | Low — query already computes oldest, just needs to capture the key | Low |

### Alternative path: Query `jira_issue_cache` directly from the breach board

Instead of reading `dbo.Agent`, the breach board endpoints could query `jira_issue_cache` directly, computing per-agent metrics on the fly. This would:
- Eliminate the `dbo.Agent` intermediate table entirely
- Guarantee freshness (same source as the pipeline)
- Require agent roster data (names, teams) from `dbo.Agent` or another source

This is the cleanest long-term solution but requires more work in the first loop.

---

## 10. Blockers and Uncertainties

| Item | Type | Detail |
|---|---|---|
| `sla_breached` column lineage | Uncertainty | How/when is `jira_issue_cache.sla_breached` populated? Is it the same as `customfield_14048` Resolution SLA? Need to trace `jira-sync-service.ts` to confirm. |
| `dbo.Agent.AccountId` matching | Uncertainty | Need to verify that `AccountId` values in `dbo.Agent` match `assignee_account_id` values in `jira_issue_cache`. A mismatch here explains the zero output. |
| `OldestTicketKey` external writer | Uncertainty | Something outside NOVA writes `OldestTicketKey` to `dbo.Agent`. If the board is repointed, this must be replicated. |
| Development tier exclusion | Confirmed gap | `refreshAllAgentMetrics()` explicitly excludes Development from its tier filter. This is a known, fixable gap. |
| `refreshAllAgentMetrics()` error state | Uncertainty | The method has a catch-all that logs but does not surface errors. Need to check logs to confirm it's running and succeeding. |

---

## 11. Summary

| Question | Answer |
|---|---|
| Can the breach board be repointed from `dbo.Agent` to `jira_kpi_daily`? | **No** — `jira_kpi_daily` lacks per-agent granularity |
| Is `dbo.Agent` the divergence source? | **Yes** — confirmed for both G-009 and G-011 |
| Does the pipeline already populate `dbo.Agent`? | **Yes** — via `refreshAllAgentMetrics()`, but it appears to be producing zeros |
| What's the smallest credible fix? | **Fix `refreshAllAgentMetrics()` data flow** (debug zero output, add Development tier, align SLA definition) |
| Is per-agent pipeline data blocked? | **No** — the mechanism exists but needs debugging and minor scope expansion |

**Next manager/build loop:** Diagnose `refreshAllAgentMetrics()` — specifically `AccountId` matching and error state — then apply the Development tier inclusion and SLA alignment fixes. This is a **source fix plus minor transformation**, not blocked by missing pipeline architecture.
