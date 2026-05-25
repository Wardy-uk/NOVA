# WS1-D Build Brief — Loop 01 (Verification)

## Type: Runtime Parity Verification

This is NOT a code-change brief. The NOVA KPI pipeline already implements the governed Development backlog definition (D-035, D-037). This brief directs a verification task to establish trust.

---

## Objective

Cross-check the NOVA KPI pipeline's Development backlog count against a live Jira JQL query to confirm the pipeline is accurately reflecting the source of truth.

---

## Governed Definition (D-035)

> Development backlog = every ticket where `current_tier = Development`

In Jira terms: `project = NT AND statusCategory != Done AND cf[12981] = "Development"`

---

## Verification Steps

### Step 1: Get pipeline count from `jira_issue_cache`

```sql
SELECT COUNT(*) AS pipeline_dev_count
FROM jira_issue_cache
WHERE status_category != 'Done'
  AND current_tier = 'Development'
```

Also capture the issue types present:

```sql
SELECT issuetype_name, COUNT(*) AS cnt
FROM jira_issue_cache
WHERE status_category != 'Done'
  AND current_tier = 'Development'
GROUP BY issuetype_name
ORDER BY cnt DESC
```

### Step 2: Get live Jira count via REST API

Execute JQL: `project = NT AND statusCategory != Done AND "Current Tier" = "Development"`

Use the Jira search endpoint (`/rest/api/3/search/jql`) with `maxResults=0` to get `total` count without fetching issue bodies.

### Step 3: Compare counts

| Source | Count | Notes |
|--------|-------|-------|
| Pipeline (`jira_issue_cache`) | ? | |
| Live Jira JQL | ? | |
| Difference | ? | Tolerance: ≤5 tickets (sync timing) |

### Step 4: If difference > 5, investigate

- Fetch the full issue key lists from both sources
- Identify tickets in Jira but not in cache (sync lag)
- Identify tickets in cache but not in Jira (stale cache entries)
- Report root cause of each discrepancy

---

## Success Criteria

1. Pipeline count obtained from `jira_issue_cache`
2. Live Jira count obtained via REST API
3. Difference is ≤5 tickets (normal sync timing tolerance)
4. Issue-type breakdown documented (confirms all types are counted per D-035)

---

## Promotion Path

If verification passes:
- WS1-D → **SOURCE DEFINED** (source hierarchy explicit, calculation rule confirmed, evidence path established)
- WS1-D can then be included in the existing regression script (`_eval_ws1_regression.mjs`) — RC-002 already checks Development tier population

If verification fails (difference > 5):
- Report the specific discrepancy tickets
- Manager Agent will classify the root cause and decide next action

---

## Out of Scope

- Changing wallboard labels or `sumKpis` configuration
- Inspecting n8n JQL (HDR-3 — documentation only, not blocking)
- Modifying JSM queue filters
- Any code changes to `kpi-pipeline.ts`

---

## Evidence To Produce

File: `agent_work/KPIRecovery/kpi_recovery/04_evidence/ws1d_verification_report_loop01.md`

Must contain:
- Pipeline count + issue-type breakdown
- Live Jira count
- Difference and assessment
- Pass/fail verdict against ≤5 tolerance
- Timestamp of both queries
