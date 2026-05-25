# WS2-C: Derived KPI Family Validation Report — Loop 01

**Date:** 2026-05-21  
**Scope:** FCR Rate %, 1st Line Resolution Rate %, Bug Escalation-to-Ack (hours), CSAT % (Derived)  
**Method:** Source-trace through `collectDerivedKpis()` and all consumers

---

## Executive Summary

`collectDerivedKpis()` is **fully implemented and actively scheduled** — it is NOT a stub or dead code. The method runs at server startup (120s delay) and daily at 17:30 UK weekdays. It writes 4 derived metrics to `jira_kpi_daily` via MSSQL MERGE.

The audit states these metrics "never worked" / "never written". The most probable root cause is **silent failure swallowed by `.catch(() => {})`** at the startup call site (index.ts:1524), combined with narrow execution windows (17:30 weekdays only for the scheduled path). The method has real logic issues (documented below) but is not disabled.

---

## Per-KPI Source Trace

### 1. 1st Line Resolution Rate %

| Field | Value |
|-------|-------|
| **Code location** | `kpi-pipeline.ts:737–749` |
| **State** | IMPLEMENTED — ACTIVE |
| **Calculation** | CC-tier resolved today / total resolved today × 100 |
| **Data source** | `jira_issue_cache` (MSSQL) — `status_category = 'Done' AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE)` |
| **CC request types** | incident, chat, ai request, emailed request, gdpr, service request, tpj request |
| **Output** | `{ kpi: '1st Line Resolution Rate %', group: 'Derived' }` → `jira_kpi_daily` |
| **Defect class** | **Definition ambiguity + date filter risk** |

**Issues found:**

1. **"1st Line Resolution" is not what this calculates.** The code measures "what % of resolved-today tickets were CC request types" — that's a CC-tier share, not a 1st-line resolution rate. A true 1st-line resolution rate would measure tickets resolved without escalation beyond Tier 1. The current formula has no tier-path check.
2. **Date filter uses `jira_updated`, not `resolved_at`.** Same issue flagged in P0 audit finding #3 (Solved Today). A ticket could have `jira_updated = today` from any field change, not just resolution.
3. **Excludes onboarding** — intentional and correct.
4. **No comment dependency** — this KPI doesn't need Jira API calls, so it should succeed independently of comment-fetching issues.

**Verdict:** Code runs, but the metric measures the wrong thing and uses the wrong date field. Output is likely a number (possibly 0 if no resolved tickets), not a crash.

---

### 2. FCR Rate %

| Field | Value |
|-------|-------|
| **Code location** | `kpi-pipeline.ts:765–819` |
| **State** | IMPLEMENTED — ACTIVE but fragile |
| **Calculation** | For each CC-type resolved-today ticket: fetch up to 50 comments via Jira REST. If the first agent response had no customer reply after it → counted as FCR. Rate = fcrCount / fcrTotal × 100. |
| **Data source** | `jira_issue_cache` (resolved-today filter) + live Jira REST `GET /issue/{key}/comment` |
| **Ticket cap** | 30 tickets max (`commentCap = 30`) |
| **Throttle** | 200ms sleep between tickets |
| **Output** | `{ kpi: 'FCR Rate %', group: 'Derived' }` → `jira_kpi_daily` |
| **Defect class** | **Multiple logic bugs + fragility** |

**Issues found:**

1. **Comment ordering assumption is correct but risky.** `getComments()` requests `orderBy=-created` (newest first), maxResults=50. `agentComments[agentComments.length - 1]` correctly gets the oldest = first agent comment. However, if there are >50 comments, the oldest comments are truncated and the "first" agent comment is actually the 50th-newest, which could be wrong.
2. **`accountType` filtering is fragile.** The code assumes `accountType === 'customer'` for portal users and filters agents as `accountType !== 'customer' && !isBot(name)`. In JSM, service desk customers have `accountType: 'customer'`, Atlassian users have `accountType: 'atlassian'`. This should work for standard setups, but internal comments (not visible to customers) are also fetched — there's no `jsdPublic` property filter despite the expand being requested.
3. **FCR definition is unconventional.** Standard FCR = resolved on first contact (no follow-up needed). This code measures "no customer reply after first agent comment" — a proxy, not true FCR. If a customer never replies because they gave up, it counts as FCR.
4. **30-ticket cap with 200ms throttle** = minimum ~6 seconds of Jira API calls. If resolved-today returns >30 tickets, the sample is biased toward whichever tickets the SQL returns first (no ORDER BY in the query).
5. **Silent per-ticket error swallowing** (line 814–816) — if Jira API auth is broken or rate-limited, all 30 attempts fail silently, `fcrTotal` stays 0, and `fcrRate` defaults to 0.

**Verdict:** This is the most fragile derived KPI. Most likely failure mode: Jira comment API failures silently producing 0/0 → 0%. Even if successful, the FCR definition is questionable.

---

### 3. Bug Escalation-to-Ack (hours)

| Field | Value |
|-------|-------|
| **Code location** | `kpi-pipeline.ts:804–811` |
| **State** | IMPLEMENTED — ACTIVE but narrow |
| **Calculation** | For each bug/development/defect-type resolved-today ticket: hours from `jira_created` to first agent comment. Average across all matching tickets. |
| **Data source** | `jira_issue_cache` (resolved-today filter, `request_type` in ['bug', 'development', 'defect']) + live Jira REST comments |
| **Output** | `{ kpi: 'Bug Escalation-to-Ack (hours)' }` → `jira_kpi_daily` |
| **Defect class** | **Data sparsity + request_type mismatch risk** |

**Issues found:**

1. **request_type values may not match.** The `request_type` field comes from `customfield_13482` (jira-sync-service.ts:275). The expected values `['bug', 'development', 'defect']` must exactly match (case-insensitive) what Jira stores. If the field uses display names like "Bug Report" or "Development Request", the match fails silently and `ackHours` stays empty → 0.
2. **Resolved-today filter is too narrow.** Bug/dev tickets resolved in a single day are rare. Most bugs take days/weeks. On any given day, 0–2 bug-type tickets might resolve, making this metric noisy or permanently 0.
3. **Shares the comment-fetch fragility** with FCR — same silent failure mode.
4. **Definition mismatch:** "Bug Escalation-to-Ack" implies time from escalation to development acknowledgement. The code measures time from ticket creation to first agent comment — these are very different things.

**Verdict:** Likely produces 0 on most days due to data sparsity (few bug-type tickets resolve daily). Even when non-zero, measures the wrong thing (creation-to-comment, not escalation-to-ack).

---

### 4. CSAT % (Derived)

| Field | Value |
|-------|-------|
| **Code location** | `kpi-pipeline.ts:751–763` |
| **State** | IMPLEMENTED — ACTIVE |
| **Calculation** | Average `customfield_12802.rating` (1–5 scale) from resolved-today tickets × 20 (to convert to percentage) |
| **Data source** | `jira_issue_cache.fields_json` → `customfield_12802.rating` |
| **Output** | `{ kpi: 'CSAT % (Derived)' }` → `jira_kpi_daily` |
| **Defect class** | **Data defect — same as main CSAT** |

**Issues found:**

1. **Shares the CSAT field problem.** If `customfield_12802` is not populated in `fields_json` (the known P1 issue from the audit), this always returns 0.
2. **Separate from the main CSAT KPI.** The main snapshot CSAT (`CSAT %`) is calculated in `collectJiraSnapshot()` at line ~508. This derived version recalculates from the same source but only for resolved-today tickets. Both are broken for the same reason.
3. **Not in scope for this WS2-C slice** — CSAT is being handled separately. Included here only because it shares the `collectDerivedKpis()` method.

**Verdict:** Blocked by the same CSAT field issue. Will resolve when CSAT field sync is fixed.

---

## Method-Level Failure Analysis

### Why "never written" despite active code?

The startup call site (index.ts:1524):
```typescript
kpiPipeline.collectDerivedKpis().catch(() => {});
```

The `.catch(() => {})` **silently swallows all errors**. If the method throws (e.g., MSSQL connection not ready at 120s post-startup, Jira client not authenticated yet), the error is invisible.

The scheduled call (index.ts:1539) runs at 17:30 UK weekdays inside a 10-minute interval check. If the server is restarted outside business hours or the 17:30 window is missed, derived KPIs are only calculated at startup — which may fail silently.

**Most probable failure sequence:**
1. Server starts → 120s → `collectDerivedKpis()` called
2. `getKpiPool()` or `localQuery()` throws (pool not warmed, connection not ready)
3. `.catch(() => {})` swallows the error — no log, no metric written
4. At 17:30, the method MAY succeed, but only if the server has been running since before 17:25 AND the interval check happens to fire in the 17:30–17:40 window
5. Even if 17:30 succeeds, the metrics are all 0 or near-0 due to the logic issues above

### Why the inner try/catch doesn't help

The outer `catch(err)` at line 859 DOES log: `'[kpi-pipeline] Derived KPIs failed: ...'`. But the startup caller's `.catch(() => {})` swallows this before it reaches any meaningful handler. The scheduled path (17:30) has no outer `.catch()`, so errors there would be logged by the job registry.

---

## Consumer Trace

These derived KPIs are consumed in 3 places:

| Consumer | File | How |
|----------|------|-----|
| **MI Board** | `board-mi.ts:421–424` | `pickAvg(kpiRows, 'FCR Rate %')`, `pickAvg(kpiRows, '1st Line Resolution Rate %')` — reads from `jira_kpi_daily` |
| **Trends** | `trends.ts:213–215` | Pattern-matched via `kpiPattern`: `'FCR%'`, `'1st Line Resolution Rate%'`, `'Bug Escalation-to-Ack%hours%'` |
| **KPI Data** | `kpi-data.ts:13` | Comment reference only — no active code |

All consumers read from `jira_kpi_daily`. If the metrics are never written (or written as 0), all consumers show null/0.

---

## Can This Family Stay Bundled?

**Partially.** The 4 metrics split into 2 implementation groups:

| Group | KPIs | Dependencies |
|-------|------|-------------|
| **Query-only** | 1st Line Resolution Rate %, CSAT % (Derived) | MSSQL `jira_issue_cache` only — no Jira API calls |
| **Comment-dependent** | FCR Rate %, Bug Escalation-to-Ack (hours) | MSSQL + live Jira REST comment fetching |

The query-only group can be fixed independently and cheaply. The comment-dependent group requires Jira API reliability and has fundamental definition problems.

**Recommendation:** Split into two remediation sub-slices.

---

## Defect Summary

| KPI | Status | Primary Defect Class | Severity |
|-----|--------|---------------------|----------|
| 1st Line Resolution Rate % | Active, wrong definition | **Definition ambiguity** — measures CC share, not 1st-line resolution | Medium |
| FCR Rate % | Active, fragile | **Logic bug + fragility** — silent API failures, unconventional definition, no ORDER BY, 30-ticket cap | High |
| Bug Escalation-to-Ack (hours) | Active, mostly empty | **Data sparsity + definition mismatch** — few bug tickets resolve daily, measures wrong interval | Medium |
| CSAT % (Derived) | Active, blocked | **Data defect** — same as main CSAT field issue | Blocked (WS2-B) |
| (All) | `.catch(() => {})` startup | **Silent failure** — startup errors invisible | High |

---

## Smallest Safe Next Remediation Slice

### WS2-C-FIX-01: Make derived KPIs observable (1 hour)

1. **Replace `.catch(() => {})` with `.catch(err => console.error(...))`** at index.ts:1524 — stop swallowing startup errors
2. **Add a manual trigger route** (e.g., `POST /api/kpi/derived/run`) so the pipeline can be tested on demand without waiting for 17:30
3. **Add diagnostic logging** at the start of `collectDerivedKpis()` — log how many resolved-today tickets are found, how many comment fetches succeed/fail

This is pure observability — no calculation changes, no risk of breaking existing behaviour. It unblocks all further derived KPI work by making failures visible.

### WS2-C-FIX-02: Fix 1st Line Resolution Rate definition (after FIX-01)

1. **Agree the business definition** with Nick: is it CC-share or true 1st-line (resolved without escalation)?
2. **Fix the date filter** — use `resolved_at` if available, or align with the Solved Today fix from P0 audit finding #3
3. **Add ORDER BY to resolved-today query** — ensure deterministic results

### WS2-C-FIX-03: Stabilise FCR + Bug Ack comment path (after FIX-01)

1. **Add retry/backoff** to comment fetching, or use cached comments from `jira_issue_cache` if available
2. **Filter internal comments** using the `jsdPublic` property (already expanded but not used)
3. **Review FCR definition** — align with industry standard or Nick's business definition
4. **Review Bug Ack definition** — should be escalation-to-dev-ack, not creation-to-first-comment
5. **Verify request_type values** — query actual distinct values from `jira_issue_cache` to confirm match

---

## Completion Checklist

- [x] Source path traced for each derived KPI
- [x] Each KPI classified: all 4 are **active but broken/wrong** (not dead or disabled)
- [x] Defect class identified per KPI
- [x] Family bundling decision: **split into query-only vs comment-dependent**
- [x] Smallest safe next slice defined: **WS2-C-FIX-01 (observability)**
