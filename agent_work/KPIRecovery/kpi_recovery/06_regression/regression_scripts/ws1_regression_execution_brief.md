# WS1 Regression Check — Build Execution Brief

**Date:** 2026-05-20
**Routed by:** Manager Loop 06
**Target:** Build Agent
**Scope:** Create and run the WS1 regression check set
**Status:** READY FOR EXECUTION

---

## 1. Objective

Create a regression check script that verifies all six WS1-A/B/C invariants against the current NOVA data. Run it once to produce the first regression report. This is NOT a re-evaluation — it is a stability check against frozen baselines.

---

## 2. Script Requirements

**File:** `_eval_ws1_regression.mjs` (project root, consistent with existing eval script naming)

**Connection:** Use NOVA's MSSQL database (same connection the evaluator used for `jira_issue_cache`). Connection details are in NOVA settings or can be derived from the existing eval scripts (`_eval-v4.mjs` etc.).

**Approach:** Query `jira_issue_cache` for open tickets (`status_category != 'Done'`). This is the fallback path — it does not require `kpi_sql_password`.

If `kpi_sql_password` IS available in settings, the script should ALSO query `jira_kpi_daily` directly as a bonus verification. But the core checks must work without it.

---

## 3. Regression Checks to Implement

### RC-001: No Ghost Tier Emission

```
Query: SELECT DISTINCT current_tier FROM jira_issue_cache WHERE status_category != 'Done'
Logic: Map each current_tier through classifyTier() logic. Verify that ALL resulting
       tier values are in ALL_TIERS = ['CC (Incidents)', 'CC (Service Requests)', 
       'CC (TPJ)', 'Production', 'Tier 2', 'Tier 3', 'Development']
       
       Tickets mapping to ungoverned tiers (e.g., 'Escalations' → 'Unclassified') 
       are EXPECTED — the check verifies they would be EXCLUDED from KPI output, 
       not that they don't exist.
       
Pass: No tier that would be emitted to jira_kpi_daily falls outside ALL_TIERS
Fail: Any tier that passes the emission guard but is not in ALL_TIERS
```

### RC-002: Governed Tier Conservation

```
Query: Same as RC-001
Logic: Count distinct governed tiers after classification. Should be exactly 7.
       Each of the 7 governed tiers should have at least 1 ticket.

Pass: 7 distinct governed tiers, all populated
Fail: Tier count ≠ 7, or any governed tier has 0 tickets
```

### RC-003: CC Null Handling Stable

```
Query: SELECT COUNT(*) FROM jira_issue_cache 
       WHERE status_category != 'Done' 
       AND current_tier = 'Customer Care'
       AND (request_type IS NULL OR request_type NOT IN ('Service Request', 'TPJ Request'))
Logic: These tickets should resolve to CC (Incidents) via ccBucket().
       Count should be ≥ 50 (was 683 at evaluation).

Pass: CC (Incidents) equivalent count ≥ 50
Fail: Count < 50
```

### RC-004: Resolution SLA Plausible

```
Query: For NT project tickets with status_category != 'Done':
       Parse customfield_14048 from fields_json
       Count breached vs not-breached
       Compute compliance = (not-breached / total-with-field) * 100

Pass: Compliance between 50% and 95%
Fail: Compliance = 100% (field lost) or < 50% or field absent from all tickets
```

### RC-005: FRT Non-Trivial

```
Query: For NT project tickets with status_category != 'Done':
       Parse customfield_14046 from fields_json
       Count breached vs not-breached
       Compute compliance = (not-breached / total-with-field) * 100

Pass: Compliance < 100% and > 0%
Fail: Compliance = 100% or = 0% or field absent from all tickets
```

### RC-006: Per-Tier FRT Breaches Present

```
Query: For NT project tickets with customfield_14046 present:
       Group by classified tier
       Count FRT breaches per tier

Pass: ≥ 4 of 7 governed tiers have at least one FRT breach
Fail: Fewer than 4 tiers with any breach
```

---

## 4. Output Format

The script should output a structured regression report:

```
WS1 REGRESSION CHECK — [date]

RC-001: No ghost tier emission ......... PASS/FAIL
  Evidence: [list of distinct tiers found, which are governed/ungoverned]
  
RC-002: Governed tier conservation ..... PASS/FAIL
  Evidence: [7 tiers with counts]

RC-003: CC null handling stable ........ PASS/FAIL
  Evidence: CC (Incidents) equivalent = [N]

RC-004: Resolution SLA plausible ....... PASS/FAIL
  Evidence: Resolution Compliance = [N]% ([breached]/[total])

RC-005: FRT non-trivial ................ PASS/FAIL
  Evidence: FRT Compliance = [N]% ([breached]/[total])

RC-006: Per-tier FRT breaches .......... PASS/FAIL
  Evidence: [N]/7 tiers have breaches: [list]

OVERALL: PASS/FAIL
```

---

## 5. Reference Scripts

Existing eval scripts in the project root follow a similar pattern:

- `_eval-v4.mjs` — connects to NOVA MSSQL, queries jira_issue_cache
- `_eval_ws1_v3.mjs` — WS1-specific evaluation queries (used by evaluator)

Use the same connection approach (tedious or mssql package, reading connection details from settings or environment).

---

## 6. Execution

After writing the script:

1. Run it once against the current NOVA data
2. Capture the output
3. Write the result to `06_regression/regression_reports/ws1_regression_report_run01.md`
4. If all 6 checks PASS: the promotion gate PG-4 is satisfied

---

## 7. What NOT To Do

- Do not re-run the full evaluation. This is a stability check, not an independent audit.
- Do not reopen WS1-A/B/C implementation scope.
- Do not modify any NOVA source code.
- Do not query the deprecated tables (JiraSlaRaw, JiraTickets, etc.).
- Do not assume `kpi_sql_password` is available — the script must work without it.
