# WS1 Regression Report — Run 03

## 1. Header

| Field | Value |
|-------|-------|
| Run Number | 03 |
| Date | 2026-05-20 |
| Time | Late evening (after Run 02, same calendar day) |
| Data Source | NOVA MSSQL — `jira_issue_cache` (FALLBACK path) |
| Script | `ws1_regression_check.mjs` v2 (SQL-side field extraction) |
| Executor | Build Agent |

---

## 2. Code Change Verification

**No code changes were introduced between Run 02 and Run 03.**

- Last KPI-related commit: `fecb02c` (2026-05-20 10:14:24 +0100) — predates both Run 01 and Run 02.
- Regression script `ws1_regression_check.mjs` v2: unchanged since creation.
- This run occurred after Run 02 (same calendar day), against a fresh runtime query of `jira_issue_cache`.

Per D-036, this constitutes a valid consecutive evidence point: fresh runtime state, no intervening code changes, consecutive execution.

---

## 3. Check Results

| Check ID | Description | Result | Evidence |
|----------|-------------|--------|----------|
| RC-001 | No ghost tier emission | **PASS** | 7 governed tiers found. 10 Escalations excluded by guard. Total open: 1173. |
| RC-002 | Governed tier conservation | **PASS** | 7/7 governed tiers populated: CC(I)=681, CC(SR)=41, CC(TPJ)=45, Prod=40, T2=63, T3=14, Dev=279 |
| RC-003 | CC null handling stable | **PASS** | CC (Incidents) = 681 (threshold: >= 50) |
| RC-004 | Resolution SLA plausible | **PASS** | Compliance = 65.9% (186 breached / 546 with field). Range: 50%-95%. |
| RC-005 | FRT non-trivial | **PASS** | FRT Compliance = 67.8% (109 breached / 339 with field). Range: >0%, <100%. |
| RC-006 | Per-tier FRT breaches present | **PASS** | 7/7 tiers with breaches (threshold: >= 4): CC(I)=4, CC(SR)=13, CC(TPJ)=8, Prod=10, T2=18, T3=7, Dev=49 |

---

## 4. Overall Verdict

**PASS** — 6/6 checks passed.

---

## 5. Drift Observations (Run 02 → Run 03)

| Metric | Run 02 | Run 03 | Delta |
|--------|--------|--------|-------|
| Total open tickets | 1175 | 1173 | -2 |
| CC (Incidents) | 679 | 681 | +2 |
| CC (Service Requests) | 44 | 41 | -3 |
| CC (TPJ) | 44 | 45 | +1 |
| Production | 42 | 40 | -2 |
| Tier 2 | 63 | 63 | 0 |
| Tier 3 | 14 | 14 | 0 |
| Development | 279 | 279 | 0 |
| Resolution SLA compliance | 66.2% | 65.9% | -0.3pp |
| Resolution SLA denominator | 551 | 546 | -5 |
| FRT compliance | 68.4% | 67.8% | -0.6pp |
| FRT denominator | 342 | 339 | -3 |
| FRT breaches | 108 | 109 | +1 |
| Tiers with FRT breaches | 7/7 | 7/7 | 0 |
| Escalations excluded | 10 | 10 | 0 |

All drift is minor and consistent with normal ticket lifecycle fluctuation (tickets resolving, new tickets arriving, SLA timers progressing). No structural changes detected. Tier governance structure is completely stable.

---

## 6. Three-Run Stability Summary

| Metric | Run 01 | Run 02 | Run 03 | Trend |
|--------|--------|--------|--------|-------|
| Total open | 1165 | 1175 | 1173 | Stable (~1170) |
| CC (Incidents) | 680 | 679 | 681 | Stable (~680) |
| Governed tiers | 7/7 | 7/7 | 7/7 | Invariant |
| Ghost emissions | 0 | 0 | 0 | Invariant |
| Res SLA compliance | 66.0% | 66.2% | 65.9% | Stable (~66%) |
| FRT compliance | 68.0% | 68.4% | 67.8% | Stable (~68%) |
| FRT breach tiers | 7/7 | 7/7 | 7/7 | Invariant |

Three consecutive clean runs. All invariants held across all runs. Continuous metrics show natural organic drift only — no structural regression.

---

## 7. New Blockers or Regressions

None.

---

## 8. TRUSTED Promotion Gate Assessment

Per D-033 and D-036, the TRUSTED gate requires:

| # | Condition | Status |
|---|-----------|--------|
| TG-1 | ≥ 3 consecutive clean regression runs | **MET** — Run 01 PASS, Run 02 PASS, Run 03 PASS |
| TG-2 | No manual intervention required | **MET** — all runs executed without manual fixes |
| TG-3 | No new blocking gaps discovered | **MET** — no new gaps in any run |
| TG-4 | No code changes between runs | **MET** — last KPI commit predates all three runs |
| TG-5 | Fresh runtime state per run (D-036) | **MET** — each run queried live `jira_issue_cache`, showing organic drift |
| TG-6 | Manager review | **PENDING** — awaiting Manager Agent |

---

## 9. Recommendation

**All regression-run conditions for the TRUSTED promotion gate are now satisfied.**

WS1-A/B/C have achieved 3 consecutive clean regression runs (Run 01, Run 02, Run 03) with:
- Zero code changes between runs
- Fresh runtime state for each run (demonstrated by organic ticket count drift)
- No manual intervention
- No new blockers or regressions
- All six invariants held across all three runs

**The regression-run portion of the TRUSTED gate is satisfied.** The Manager Agent should review and, if TG-6 is met, promote WS1-A/B/C from REGRESSION PROTECTED to TRUSTED.
