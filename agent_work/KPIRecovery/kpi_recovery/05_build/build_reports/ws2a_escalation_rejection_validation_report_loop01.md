# WS2-A Build Report: Escalation & Rejection Validation — Loop 01

**Date:** 2026-05-21  
**Status:** BOUNDED DEFECT CONFIRMED  
**Outcome:** 2 (direct build fix can be routed next)

---

## 1. Code Path

All escalation/rejection KPIs are calculated in a single method:

**`kpi-pipeline.ts:674`** — `collectEscalationKpis()`

Called at line 512, wrapped in try/catch (failures silently warn, don't break the snapshot).

The method executes 6 SQL queries against the **main MSSQL database** (not the KPI database), all targeting the `escalation_log` table. It then computes `Escalation Accuracy %` as `(totalEsc - totalRej) / totalEsc * 100`, defaulting to 100% when `totalEsc = 0`.

The 7 KPIs emitted:

| KPI | Source Query |
|-----|-------------|
| Tickets escalated to Tier 2 | `escalation_log WHERE created_at = today AND to_tier IN ('T2', 'Tier 2')` |
| Tickets escalated to Tier 3 | `escalation_log WHERE created_at = today AND to_tier IN ('T3', 'Tier 3')` |
| Tickets escalated to Development | `escalation_log WHERE created_at = today AND to_tier IN ('Dev', 'Development')` |
| Tickets rejected by Tier 2 | `escalation_log WHERE created_at = today AND from_tier IN ('T2', 'Tier 2') AND to_tier IN ('T1', 'Customer Care')` |
| Tickets rejected by Tier 3 | `escalation_log WHERE created_at = today AND from_tier IN ('T3', 'Tier 3') AND to_tier IN ('T2', 'Tier 2', 'T1', 'Customer Care')` |
| Tickets rejected by Development | `escalation_log WHERE created_at = today AND from_tier IN ('Dev', 'Development') AND to_tier IN ('T3', 'Tier 3', 'T2', 'Tier 2')` |
| Escalation Accuracy % | Derived: `(totalEsc - totalRej) / totalEsc * 100`, default 100 |

---

## 2. Source Data

### Table: `escalation_log`

Created in `schema.ts:989`. Schema:

```
id INT IDENTITY PRIMARY KEY
ticket_key NVARCHAR(30) NOT NULL
escalation_type NVARCHAR(30) NOT NULL    -- 'manual' | 'ai_agent' | 'jira_transition' | 'sla_risk'
from_tier NVARCHAR(50) NULL
to_tier NVARCHAR(50) NULL
reason_code NVARCHAR(50) NULL
reason_label NVARCHAR(200) NULL
escalated_by NVARCHAR(100) NULL
assigned_to NVARCHAR(200) NULL
notes NVARCHAR(MAX) NULL
decision_id INT NULL
source NVARCHAR(20) NOT NULL DEFAULT 'manual'
created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
```

### Population Paths (exactly 2)

| Path | Trigger | File | Automatic? |
|------|---------|------|-----------|
| Manual SOP-002 escalation | User clicks "Escalate" in Agent Dashboard UI | `routes/agent.ts:1080` | No — requires manual user action |
| Jira changelog backfill | `POST /api/escalations/backfill` | `routes/escalation.ts:58` → `escalation-log-service.ts:158` | **No — manual API call only** |

**There is no scheduled, timer-based, or sync-driven population of `escalation_log`.** The Jira sync service (`jira-sync-service.ts`) does NOT write to this table. There is no `setInterval` or startup job that backfills escalations.

---

## 3. Time Window

The KPI queries use `CAST(created_at AS DATE) = CAST(GETUTCDATE() AS DATE)` — **today only, UTC date boundary**.

This means even if the table were populated historically, only same-day entries count toward the daily KPI. There is no rolling window or accumulation.

---

## 4. Root Cause Analysis: Why All-Zero

### Primary cause: EMPTY SOURCE TABLE

The `escalation_log` table has **no automatic population mechanism**. It is only written to when:

1. A user manually escalates via the Agent Dashboard SOP-002 flow (which the team is not actively using for every escalation — most escalations happen directly in Jira)
2. Someone manually triggers the backfill API endpoint (a one-off admin action, not a scheduled job)

Therefore, on any given day, the table almost certainly has **zero rows** for that date, producing 0 for all escalation counts and 100% for Escalation Accuracy.

### Secondary issue: BACKFILL ONLY CAPTURES UPWARD TIER CHANGES

Even if the backfill were run regularly, `backfillFromChangelog()` at line 174 explicitly filters:

```typescript
if ((tierRank[toTier] ?? 0) <= (tierRank[fromTier] ?? 0)) continue;
```

This means **downward tier changes (rejections) are never recorded by the backfill**. Only upward escalations (T1→T2, T2→T3, T2→Dev, etc.) are captured. The rejection KPIs (`Tickets rejected by Tier 2/3/Dev`) would remain 0 even with a full backfill.

### Tertiary issue: TIER VOCABULARY MISMATCH (minor)

The backfill writes abbreviated tier names from `TIER_PATTERNS`: `T1`, `T2`, `T3`, `Dev`. The KPI queries match on `('T2', 'Tier 2')`, `('T3', 'Tier 3')`, `('Dev', 'Development')`. The abbreviated forms match, so this is not a blocking issue for escalation counts — but rejections also check `to_tier IN ('T1', 'Customer Care')`, and the backfill writes `T1`, which does match.

---

## 5. Defect Classification

| KPI Family | Defect? | Class | Severity |
|------------|---------|-------|----------|
| Tickets escalated to Tier 2/3/Dev | **YES** | Missing source data — no automatic population | HIGH |
| Tickets rejected by Tier 2/3/Dev | **YES** | Missing source data + broken extraction (backfill filters out downward changes) | HIGH |
| Escalation Accuracy % | **YES** | Structurally zeroed — defaults to 100% when totalEsc = 0 | HIGH |

All three are **structurally broken**, not transiently empty. The zero output is **not valid** — real escalations and rejections happen daily in Jira but are never captured into NOVA's `escalation_log`.

---

## 6. How n8n Calculated These KPIs

From the comprehensive audit (Part 5), n8n v4's agent pipeline fetched per-agent escalation accuracy from an HTTP endpoint. The KpiSnapshot (May 15) recorded:

- Tickets escalated to Tier 2: **8**
- Tickets escalated to Tier 3: **4**
- Tickets rejected by Tier 2: **1**
- Escalation Accuracy %: **97%**

n8n's approach was likely Jira changelog-based (querying status transitions for the day), not dependent on a local log table.

---

## 7. Smallest Safe Fix Slice

### Fix 1: Add scheduled escalation log population from Jira sync (REQUIRED)

Add a periodic job (piggyback on Jira sync timer, every 5 minutes) that:

1. Queries `jira_issue_cache` for tickets whose `current_tier` has changed since last check (compare against a `previous_tier` column or a separate tracking mechanism)
2. OR queries Jira changelog API for recent status transitions and detects tier changes
3. Inserts new `escalation_log` entries for each detected tier change

The simplest approach: **extend `jira-sync-service.ts`** to detect tier changes during its normal sync cycle. When a ticket's `current_tier` changes between sync cycles, log an escalation entry. This requires either:

- (a) Adding a `previous_tier` column to `jira_issue_cache` and comparing on each sync, OR
- (b) Running a lightweight Jira changelog query for recently-updated tickets

Option (a) is smaller and fully self-contained within NOVA's existing sync loop.

### Fix 2: Record BOTH upward and downward tier changes (REQUIRED)

Modify `backfillFromChangelog()` to also record downward tier changes (rejections). The existing upward-only filter at line 174 must either:

- Be removed entirely (record all tier changes), with an `escalation_direction` column added to distinguish escalation vs rejection, OR
- Be inverted for a second pass that captures downward changes

### Fix 3: Run a one-time historical backfill (RECOMMENDED)

After fix 2, trigger the backfill endpoint with a date range covering the past 90 days to populate historical data. This allows the Trends page and historical comparisons to have retroactive data.

### Execution Order

1. Fix 2 first (modify backfill logic to capture rejections)
2. Fix 1 (add automatic population — either sync-based or scheduled backfill)
3. Fix 3 (run historical backfill once)
4. Verify daily counts are non-zero after a normal business day

### Estimated Complexity

| Fix | Effort | Risk |
|-----|--------|------|
| Fix 1 (sync-based tier change detection) | ~2-3 hours | Low — additive logic in existing sync loop |
| Fix 2 (bidirectional backfill) | ~30 minutes | Very low — remove one filter condition, add direction column |
| Fix 3 (historical backfill) | ~15 minutes | Very low — single API call with date range |

---

## 8. Recommendation

**Route a direct WS2-A correction build.** The defect is fully bounded:

- The calculation logic in `collectEscalationKpis()` is correct — it would produce accurate numbers if the table had data
- The table schema is correct
- The tier vocabulary matching is adequate
- The only problem is that nothing populates the table automatically, and the backfill doesn't capture rejections

This is a **data pipeline gap**, not a calculation defect. The fix is to close the pipeline gap by wiring tier-change detection into the existing Jira sync cycle.

---

## Appendix: Evidence Index

| Evidence | Location |
|----------|----------|
| Escalation KPI calculation | `kpi-pipeline.ts:674-728` |
| `escalation_log` schema | `schema.ts:989-1010` |
| Backfill implementation | `escalation-log-service.ts:158-200` |
| Upward-only filter | `escalation-log-service.ts:174-175` |
| Manual SOP-002 insert | `routes/agent.ts:1077-1091` |
| Manual backfill endpoint | `routes/escalation.ts:42-76` |
| Jira sync (no escalation logging) | `jira-sync-service.ts` — `escalation_log` not referenced |
| `localQuery` import | `kpi-pipeline.ts:10` — main MSSQL, not KPI database |
| n8n comparison data | Comprehensive audit Part 3a, rows for escalation/rejection KPIs |
