# WS1 Build Report — Loop 02: Resolution SLA Verification (Track 2)

**Date:** 2026-05-20
**Status:** COMPLETE — Resolution SLA verified, FRT root cause discovered

---

## Part 1: Resolution SLA Cross-Check Results

**8/8 tickets match between cache and live Jira. Resolution SLA data is trustworthy.**

### Breached Tickets (5/5 match)

| Ticket | Tier | Cached | Live Jira | Match |
|--------|------|--------|-----------|-------|
| NT-19109 | Production | BREACHED | BREACHED | ✓ |
| NT-19108 | Customer Care | BREACHED | BREACHED | ✓ |
| NT-19096 | Production | BREACHED | BREACHED | ✓ |
| NT-18832 | Tier 2 | BREACHED | BREACHED | ✓ |
| NT-17235 | Development | BREACHED | BREACHED | ✓ |

### Not-Breached Tickets (3/3 match)

| Ticket | Cached | Live Jira | Match |
|--------|--------|-----------|-------|
| NT-15462 | NOT_BREACHED | NOT_BREACHED | ✓ |
| NT-19249 | NOT_BREACHED | NOT_BREACHED | ✓ |
| NT-19129 | NOT_BREACHED | NOT_BREACHED | ✓ |

### Conclusion

`customfield_14048` data in `jira_issue_cache.fields_json` matches live Jira. The `isSlaBreached()` parser correctly evaluates it. Resolution SLA metrics derived from this field are structurally sound.

---

## Part 2: Absence Analysis

### Field Presence (Open Tickets)

| Metric | Count |
|--------|-------|
| Total open tickets | 1,226 |
| `customfield_14048` present | 579 (47.2%) |
| `customfield_14048` absent | 647 (52.8%) |
| Breached (of present) | 102 (17.6%) |
| Not breached (of present) | 477 (82.4%) |

### Absence by Project

| Project | Absent | Present |
|---------|--------|---------|
| NT | 0 | 577 |
| NTPJ | 394 | 2 |
| YO | 253 | 0 |

**Finding:** Absence is project-dependent. NT tickets almost always have the Resolution SLA field. NTPJ and YO tickets almost never do. This is expected — SLA configurations are per Jira Service Management project, and NTPJ/YO likely don't have Resolution SLA configured.

### Absence by Issue Type

| Issue Type | Absent | Present |
|------------|--------|---------|
| Support | 647 | 575 |
| [System] Service request | 0 | 4 |

All absent tickets are `Support` type — but from NTPJ and YO projects. This is not an issue-type problem; it's a project-level SLA configuration difference.

### Absence by Tier

| Tier | Absent |
|------|--------|
| Customer Care | 647 |

All 647 absent tickets are Customer Care tier. This is because NTPJ and YO tickets route to Customer Care. NT tickets (which have the field) distribute across all tiers.

### Conclusion

The 647/1226 absence rate is **expected and correct**. NTPJ and YO projects don't have Resolution SLA configured in Jira. These tickets correctly lack the field. The current methodology of excluding them from the denominator is defensible.

---

## Part 3: Denominator Methodology

**Current code (kpi-pipeline.ts:433-434):**
```typescript
if (t.resBreached !== null) { totalResChecked++; if (t.resBreached) totalResBreached++; }
```

- Tickets where `customfield_14048` is absent → `resBreached = null` → excluded from `totalResChecked`
- Only tickets with a non-null SLA evaluation enter the compliance calculation
- Compliance = `(totalResChecked - totalResBreached) / totalResChecked * 100`
- If `totalResChecked === 0`, defaults to 100%

**This is correct.** Including tickets without SLA configuration would artificially inflate compliance (they'd count as "not breached" without ever being measured).

**Computed compliance from diagnostic:**
- `(579 - 102) / 579 × 100 = 82.4%`
- This aligns with the NOVA daily output of 82% for Resolution Compliance % (Open Queue)

---

## Part 4: FRT Root Cause Discovered

### Service Desk SLA Enumeration

Querying the Jira Service Desk API for ticket NT-19109 revealed two SLA clocks:

| SLA ID | Name | Custom Field |
|--------|------|-------------|
| 76 | **First Reply Time** | `customfield_14046` |
| 78 | **Resolution** | `customfield_14048` |

### Direct REST API Check

When `customfield_14046` is explicitly requested via `GET /rest/api/3/issue/NT-19109?fields=customfield_14046,customfield_14048`:

- `customfield_14046`: **PRESENT** — contains full FRT SLA data (completedCycles, breach status)
- `customfield_14048`: **PRESENT** — contains full Resolution SLA data
- `customfield_10010`: **UNDEFINED** — not returned

### Root Cause: `customfield_14046` Not in `ALL_FIELDS`

**File:** `src/server/services/jira-sync-service.ts`, line 19-42

The `ALL_FIELDS` array that controls which Jira fields are fetched during sync includes `customfield_14048` (line 36) but **does NOT include `customfield_14046`**. The FRT SLA field is never requested from Jira, so it's never stored in `fields_json`.

This is a simple field-list omission, not an API limitation or Jira configuration issue.

### Resolution Path

Add `'customfield_14046', // First Reply Time SLA` to the `ALL_FIELDS` array. After the next full sync, FRT data will populate `fields_json` and the KPI pipeline will be able to parse it.

---

## Part 5: Recommendation

### Resolution SLA → SOURCE DEFINED

Resolution SLA meets the criteria for advancement to SOURCE DEFINED:

- Source: `customfield_14048` in `jira_issue_cache.fields_json`, fetched via Jira REST API
- Absence pattern: project-dependent, expected and correct
- Parser: `isSlaBreached()` confirmed compatible with live data structure
- Cross-check: 8/8 tickets match between cache and live Jira
- Denominator: excludes tickets without SLA field — correct methodology

Resolution SLA should NOT yet be TRUSTED (no independent evaluation or regression pack), but it can be declared as having a verified source.

### FRT SLA → Fix Available

Adding `customfield_14046` to `ALL_FIELDS` is a one-line fix. After a full re-sync, all FRT metrics should begin producing real data. This fix should be part of the next build loop.
