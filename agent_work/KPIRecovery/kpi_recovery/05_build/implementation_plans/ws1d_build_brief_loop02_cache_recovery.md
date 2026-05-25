# WS1-D Build Brief — Loop 02 (Cache Freshness Recovery)

## Type: Targeted Data Cleanup + Verification

This is a bounded data-correction task followed by parity verification. No code changes to the NOVA application are required.

---

## Objective

Remove 47 stale deleted-ticket rows from `jira_issue_cache` and verify that the Development count aligns with live Jira within ≤5 ticket tolerance.

---

## Background

- **D-035:** Development backlog = every ticket where `current_tier = Development`
- **D-044:** Spot-check confirmed discrepant tickets (NT-543, NT-626, NT-18099) are deleted in Jira
- **D-045:** Manager decision: targeted stale-entry cleanup is the first recovery step
- **Root cause:** `jira-sync-service.ts` never DELETEs rows from `jira_issue_cache` — deleted Jira tickets persist as phantom rows indefinitely

---

## Step 1: Delete Stale Rows

Execute against NOVA's local MSSQL (`jira_issue_cache`):

```sql
DELETE FROM jira_issue_cache
WHERE issue_key IN (
  'NT-543','NT-544','NT-545','NT-546','NT-547','NT-548','NT-549','NT-550',
  'NT-551','NT-552','NT-553','NT-554','NT-555','NT-556','NT-557','NT-558',
  'NT-559','NT-561','NT-562','NT-563','NT-565','NT-626','NT-628','NT-631',
  'NT-633','NT-1431','NT-1459','NT-1601','NT-1602','NT-1793','NT-1805',
  'NT-1807','NT-2186','NT-2618','NT-3700','NT-5897','NT-6038','NT-11324',
  'NT-15435','NT-15455','NT-15456','NT-15458','NT-15480','NT-15483',
  'NT-16985','NT-18099'
)
```

**Expected:** 47 rows deleted (46 if NT-560 was already missing — the list in the verification report skips NT-560).

**Safety:** These tickets are confirmed deleted in Jira (D-044). Removing them from cache is the correct action. No other tables reference these rows (no foreign key constraints in `jira_issue_cache`).

---

## Step 2: Verify Development Count

```sql
SELECT COUNT(*) AS dev_count
FROM jira_issue_cache
WHERE status_category != 'Done'
  AND current_tier = 'Development'
```

**Expected:** ~231 (±5 for normal sync timing drift since the Jira count was taken).

---

## Step 3: Cross-Check Against Live Jira

Execute JQL: `project = NT AND statusCategory != Done AND "Current Tier" = "Development"`

**Method:** Use Jira REST API or Atlassian Rovo MCP to get total count.

**Pass condition:** |pipeline count - Jira count| ≤ 5

---

## Step 4: Run Existing Regression Checks

Execute `ws1_regression_check.mjs` (RC-001 through RC-006) to confirm no collateral damage from the DELETE.

**Expected:** All 6 checks PASS. The deletion removes Development-tier tickets, which will:
- Reduce the Development tier count in RC-002 (but it must remain > 0 — will be ~231)
- Reduce total open ticket count (but RC-001 only checks tier governance, not total)
- Not affect SLA/FRT checks (RC-004, RC-005, RC-006) because the deleted tickets had no SLA/FRT data

---

## Step 5: Confirm Stale Rows Gone

```sql
SELECT COUNT(*) AS remaining
FROM jira_issue_cache
WHERE issue_key IN (
  'NT-543','NT-544','NT-545','NT-546','NT-547','NT-548','NT-549','NT-550',
  'NT-551','NT-552','NT-553','NT-554','NT-555','NT-556','NT-557','NT-558',
  'NT-559','NT-561','NT-562','NT-563','NT-565','NT-626','NT-628','NT-631',
  'NT-633','NT-1431','NT-1459','NT-1601','NT-1602','NT-1793','NT-1805',
  'NT-1807','NT-2186','NT-2618','NT-3700','NT-5897','NT-6038','NT-11324',
  'NT-15435','NT-15455','NT-15456','NT-15458','NT-15480','NT-15483',
  'NT-16985','NT-18099'
)
```

**Expected:** 0

---

## Success Criteria (D-046)

| # | Evidence | Required |
|---|----------|----------|
| VE-1 | Post-cleanup pipeline Development count | ≤ 236 (was 278, expect ~231) |
| VE-2 | Live Jira JQL count | Obtained |
| VE-3 | Difference ≤ 5 tickets | YES |
| VE-4 | 47 stale rows confirmed absent | 0 remaining |
| VE-5 | Regression checks RC-001–RC-006 PASS | 6/6 PASS |

---

## Evidence To Produce

File: `agent_work/KPIRecovery/kpi_recovery/05_build/build_reports/ws1d_cache_recovery_report_loop02.md`

Must contain:
- Pre-cleanup Development count
- DELETE execution result (rows affected)
- Post-cleanup Development count
- Live Jira cross-check count and difference
- Regression check results (RC-001 through RC-006)
- Stale row confirmation query result
- Pass/fail verdict against D-046 criteria
- Timestamp of all queries

---

## Promotion Path

If all success criteria met:
- WS1-D → **SOURCE DEFINED** (source hierarchy explicit, cache corrected, parity within tolerance)
- WS1-D can then proceed to independent evaluation and regression protection

If any criterion fails:
- Report exact evidence to Manager Agent
- Do not speculate on fixes — hand back for classification

---

## Out of Scope

- Code changes to `jira-sync-service.ts` (reconciliation logic is WS3 — D-048)
- Cleanup of stale tickets in non-Development tiers (broader cache integrity is WS3)
- Schema changes to `jira_issue_cache` (soft-delete columns are WS3)
- Wallboard label changes
- n8n JQL inspection (HDR-3)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| DELETE removes a ticket that actually exists in Jira | Very Low — spot-check confirmed deletion | Medium — ticket would re-sync on next incrementalSync if it exists | Can re-sync individual tickets via `syncSingleIssue()` |
| Regression checks fail after DELETE | Low — removed tickets had no SLA/FRT data | High — would block promotion | Run regression checks immediately after and report |
| More stale tickets exist beyond the 47 identified | Medium — deletion gap is structural | Low for WS1-D — only Development tier is in scope | WS3 will address broader cache integrity |
