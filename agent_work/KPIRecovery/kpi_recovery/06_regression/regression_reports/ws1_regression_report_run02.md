# WS1 Regression Report — Run 02

## 1. Header

| Field | Value |
|-------|-------|
| Run Number | 02 |
| Date | 2026-05-20 |
| Time | Evening run (same calendar day as Run 01) |
| Data Source | NOVA MSSQL — `jira_issue_cache` (FALLBACK path) |
| Script | `ws1_regression_check.mjs` v2 (SQL-side field extraction) |
| Executor | Build Agent |

---

## 2. Check Results

| Check ID | Description | Result | Evidence |
|----------|-------------|--------|----------|
| RC-001 | No ghost tier emission | **PASS** | 7 governed tiers found. 10 Escalations excluded by guard. Total open: 1175. |
| RC-002 | Governed tier conservation | **PASS** | 7/7 governed tiers populated: CC(I)=679, CC(SR)=44, CC(TPJ)=44, Prod=42, T2=63, T3=14, Dev=279 |
| RC-003 | CC null handling stable | **PASS** | CC (Incidents) = 679 (threshold: >= 50) |
| RC-004 | Resolution SLA plausible | **PASS** | Compliance = 66.2% (186 breached / 551 with field). Range: 50%-95%. |
| RC-005 | FRT non-trivial | **PASS** | FRT Compliance = 68.4% (108 breached / 342 with field). Range: >0%, <100%. |
| RC-006 | Per-tier FRT breaches present | **PASS** | 7/7 tiers with breaches (threshold: >= 4): CC(I)=4, CC(SR)=13, CC(TPJ)=8, Prod=10, T2=18, T3=7, Dev=48 |

---

## 3. Overall Verdict

**PASS** — 6/6 checks passed.

---

## 4. Drift Observations (Run 01 → Run 02)

| Metric | Run 01 | Run 02 | Delta |
|--------|--------|--------|-------|
| Total open tickets | 1165 | 1175 | +10 |
| CC (Incidents) | 680 | 679 | -1 |
| CC (Service Requests) | 43 | 44 | +1 |
| CC (TPJ) | 44 | 44 | 0 |
| Production | 42 | 42 | 0 |
| Tier 2 | 63 | 63 | 0 |
| Tier 3 | 14 | 14 | 0 |
| Development | 279 | 279 | 0 |
| Resolution SLA compliance | 66.0% | 66.2% | +0.2pp |
| FRT compliance | 68.0% | 68.4% | +0.4pp |
| FRT with field (denominator) | 338 | 342 | +4 |
| Tiers with FRT breaches | 7/7 | 7/7 | 0 |

All drift is minor and within normal ticket lifecycle fluctuation. No structural changes detected.

---

## 5. New Blockers or Regressions

None.

---

## 6. Recommendation for Manager

- **Run 02 is a clean PASS.** This is the second consecutive clean run on the same day.
- The protected model remains stable — no ghost emission, tier conservation holds, SLA/FRT values are plausible, CC null routing is correct.
- **Next step:** Schedule Run 03 for 2026-05-21 (next business day) to accumulate the 3 consecutive clean runs needed for REGRESSION PROTECTED → TRUSTED promotion gate.
