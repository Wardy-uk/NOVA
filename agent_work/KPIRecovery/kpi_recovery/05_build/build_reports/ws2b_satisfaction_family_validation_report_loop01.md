# WS2-B: Satisfaction-Family Metric Validation Report — Loop 01

**Date:** 2026-05-21  
**Status:** BOUNDED DEFECTS CONFIRMED  
**Scope:** CSAT %, KAM Satisfaction, CSM Satisfaction

---

## Executive Summary

The three satisfaction-family metrics use **two completely separate source paths** and have **two different defect classes**:

| Metric | Source Path | Current State | Defect Class |
|--------|-----------|---------------|-------------|
| **CSAT %** | Jira `customfield_12802` via `parseCsat()` in KPI pipeline | **Always 0%** | Missing field in Jira sync — field never fetched |
| **KAM Satisfaction** | Internal NOVA surveys (`surveys` table, category `kam_satisfaction`) | **Null / no data** | Working correctly — no surveys have been run yet |
| **CSM Satisfaction** | Internal NOVA surveys (`surveys` table, category `csm_satisfaction`) | **Null / no data** | Working correctly — no surveys have been run yet |

**Recommendation:** CSAT % is a bounded 1-line fix. KAM/CSM Satisfaction are not broken — they are waiting for survey data. These should be **split into separate remediation slices**.

---

## Metric 1: CSAT %

### How It Is Currently Calculated

**Source:** `kpi-pipeline.ts` line 153 — `parseCsat()` function  
**Field:** `customfield_12802.rating` from `fields_json` column of `jira_issue_cache`  
**Population:** Resolved-today tickets only (`status_category = 'Done' AND jira_updated = today`)  
**Formula:** `csatPct = csatCount > 0 ? Math.round((csatSum / csatCount) * 20) : 0`  
(Converts 1-5 scale to 0-100% by multiplying average by 20)

The same logic is reused in three places:

1. **Team-level snapshot** (`kpi-pipeline.ts` lines 440-445, 475-482): emits `CSAT %` to `jira_kpi_daily`
2. **Derived KPI** (`kpi-pipeline.ts` lines 751-763, 824): emits `CSAT % (Derived)` to `jira_kpi_daily`
3. **Agent-level metrics** (`kpi-pipeline.ts` lines 1266-1283, 1319): writes `CSATCount` + `CSATAverage` to `Jira_KPI_AgentDaily`

### Root Cause: Missing Field in Jira Sync

`parseCsat()` reads `customfield_12802` from `fields_json`. However, `fields_json` is populated by `JSON.stringify(f)` where `f` is the Jira issue fields object — but the Jira REST API only returns fields that are **requested**.

The field request list is `ALL_FIELDS` in `jira-sync-service.ts` lines 19-43:

```
'customfield_14046', // First Reply Time SLA
'customfield_14048', // Resolution SLA
'customfield_14081', // Agent Last Updated
...
```

**`customfield_12802` is NOT in this list.** Therefore:

1. The Jira API never returns the CSAT rating field
2. `fields_json` never contains `customfield_12802`
3. `parseCsat()` always returns `null`
4. `csatCount` is always 0
5. The fallback `csatCount > 0 ? ... : 0` always produces **0**

### Defect Classification

| Aspect | Finding |
|--------|---------|
| **Defect class** | Data defect — field not fetched from source |
| **Root cause** | `customfield_12802` missing from `ALL_FIELDS` in `jira-sync-service.ts` line 19 |
| **Scope of impact** | All three CSAT calculation sites (team snapshot, derived, agent-level) |
| **Is the parser correct?** | Cannot verify until field is present — `fields?.customfield_12802?.rating` looks structurally plausible for a Jira satisfaction rating field but needs live data validation |
| **Is the formula correct?** | `average * 20` converts 1-5 to 20-100%. This means a perfect 5.0 = 100%, which is correct. A score of 4.0 = 80%, which matches the default target |
| **n8n comparison** | n8n v4 was intended to emit CSAT but `KpiSnapshot` shows no CSAT rows — n8n may also not have had access to this field, or it was sourced differently |

### Smallest Safe Remediation

**Fix:** Add `'customfield_12802', // Customer Satisfaction (CSAT rating)` to `ALL_FIELDS` in `jira-sync-service.ts`.

**Preconditions before deploying:**
1. Verify `customfield_12802` actually exists in the NT project's Jira field configuration (not all JSM projects have this)
2. Verify the field structure is `{ rating: number }` — if it's a different shape (e.g. `{ value: number }` or a bare number), `parseCsat()` will still return null
3. After adding the field, a full re-sync is needed for existing cached tickets to pick up the CSAT data
4. Existing `jira_kpi_daily` rows for past dates will NOT be backfilled — CSAT % will start populating from the day the fix deploys

**Estimated effort:** Trivial (1 line + verification)

---

## Metric 2: KAM Satisfaction

### How It Is Currently Sourced

**NOT from Jira.** This metric is sourced from NOVA's internal survey system.

**Source path:**
1. `surveys.ts` defines template `kam_satisfaction` (line 53) — a 7-question scale_5 survey for Key Account Managers
2. `surveys.ts` route `GET /api/surveys/satisfaction-scores` (line 331) — aggregates responses from the most recent completed `kam_satisfaction` survey
3. `trends.ts` line 218 — Trends checkpoint panel fetches this as `source: 'survey'`, reads from NOVA's local surveys table (not MSSQL KPI tables)
4. **Not emitted to `jira_kpi_daily`** — this metric is survey-only, rendered directly on the Trends panel

### Current State

| Aspect | Finding |
|--------|---------|
| **Implementation** | Fully implemented — survey templates, questions, response aggregation, and Trends integration all exist |
| **Data state** | No `kam_satisfaction` surveys have been created or run |
| **Output** | `satisfaction-scores` endpoint returns `{ average: null, response_count: 0, survey_count: 0 }` |
| **Is it broken?** | No — it is correctly returning null because no surveys exist |
| **Defect class** | None — working as designed, awaiting first use |

### UI Surfaces

- **Trends panel** (`trends.ts` lines 696-727): renders as a checkpoint metric with target 4.0. Shows `null` when no survey data exists.
- **Agent Roster** (`AgentRosterView.tsx` lines 136-139, 259): shows per-agent satisfaction RAG dot. Currently `grey` (no data).

---

## Metric 3: CSM Satisfaction

### How It Is Currently Sourced

Identical architecture to KAM Satisfaction, different survey template.

**Source path:**
1. `surveys.ts` defines template `csm_satisfaction` (line 70) — a 7-question scale_5 survey for Customer Success Managers
2. Same `satisfaction-scores` endpoint aggregates `csm_satisfaction` category
3. `trends.ts` line 219 — rendered as `source: 'survey'` metric

### Current State

| Aspect | Finding |
|--------|---------|
| **Implementation** | Fully implemented |
| **Data state** | No `csm_satisfaction` surveys have been created or run |
| **Output** | `{ average: null, response_count: 0, survey_count: 0 }` |
| **Is it broken?** | No |
| **Defect class** | None — working as designed |

---

## Surface Map

| Surface | CSAT % | KAM Satisfaction | CSM Satisfaction |
|---------|--------|------------------|------------------|
| **KPI Dashboard** (`jira_kpi_daily`) | Emitted as `CSAT %` — always 0 | Not present | Not present |
| **Trends Panel** (checkpoint grid) | Read from `jira_kpi_daily` via `CSAT%` pattern | Read from `surveys` table via `/satisfaction-scores` | Read from `surveys` table via `/satisfaction-scores` |
| **Board MI** (`board-mi.ts`) | Read from `jira_kpi_daily` — always 0 | Not present | Not present |
| **Agent Daily** (`Jira_KPI_AgentDaily`) | `CSATCount` + `CSATAverage` columns — always null | Not present | Not present |
| **Agent Roster** (UI) | Not directly shown | Shown via satisfaction RAG dot (grey) | Not directly shown |
| **Wallboards** | Not shown | Not shown | Not shown |

---

## Portal CSAT (Separate System — Not In Scope)

There is also a **portal CSAT survey** system (`portal-csat.ts`, `portal_csat_surveys` table) that generates per-ticket surveys when tickets resolve. This is a **Calyx customer portal feature**, completely separate from the KPI pipeline's `customfield_12802`-based CSAT. Portal CSAT scores are stored in `portal_csat_surveys.csat_score` but are NOT read by the KPI pipeline. This is intentional — they serve different purposes (customer-facing survey vs Jira-native satisfaction rating).

---

## Answers to Required Questions

### 1. How is CSAT % currently calculated in NOVA?

`parseCsat()` reads `customfield_12802.rating` from `fields_json` in `jira_issue_cache` for resolved-today tickets. Average is multiplied by 20 to convert 1-5 scale to 0-100%.

### 2. Why is CSAT % = 0?

**Missing field in Jira sync.** `customfield_12802` is not in the `ALL_FIELDS` request list in `jira-sync-service.ts`, so the Jira API never returns it. `fields_json` never contains it. `parseCsat()` always returns null. The zero-default fallback fires every time.

### 3. Where do KAM Satisfaction and CSM Satisfaction come from?

NOVA's internal survey system. Templates are predefined in `surveys.ts`. Scores are aggregated from `survey_responses` for the most recent completed survey in each category. They are NOT sourced from Jira or any external system.

### 4. Are KAM/CSM Satisfaction implemented, disconnected, or missing?

**Implemented and connected.** The full pipeline exists: templates → survey creation → question rendering → response collection → score aggregation → Trends panel display. They show null because no surveys have been created yet, not because of a code defect.

### 5. Do the three metrics belong in one remediation slice?

**No.** They should be split:

- **CSAT %** is a code fix (add missing field to Jira sync) — can be done immediately
- **KAM/CSM Satisfaction** require operational action (creating and distributing surveys) — not a code fix at all

### 6. What is the smallest safe next build slice?

**WS2-B-1: CSAT % field recovery**

1. Add `'customfield_12802'` to `ALL_FIELDS` in `jira-sync-service.ts`
2. Verify field exists and its structure in NT project via Jira API
3. Trigger full re-sync after deploy
4. Validate `parseCsat()` returns non-null for at least some resolved tickets
5. Confirm `CSAT %` emits a non-zero value in `jira_kpi_daily` the next day

**No code change needed for KAM/CSM Satisfaction.** Those require Nick to create surveys in the Admin > Surveys UI.

---

## Completion Checklist

- [x] Source path for each satisfaction-family metric — traced
- [x] Whether each is real, stubbed, or disconnected — determined
  - CSAT %: **disconnected** (field not fetched)
  - KAM Satisfaction: **real but empty** (no survey data)
  - CSM Satisfaction: **real but empty** (no survey data)
- [x] Most likely defect class — identified
  - CSAT %: **data defect — missing field in sync whitelist**
  - KAM/CSM: **no defect**
- [x] Smallest safe next remediation slice — defined (WS2-B-1: add `customfield_12802` to `ALL_FIELDS`)
