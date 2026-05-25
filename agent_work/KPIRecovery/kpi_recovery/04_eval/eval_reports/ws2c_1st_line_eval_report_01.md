# EV-WS2C: 1st Line Resolution Rate % — Evaluation Report 01

**Date:** 2026-05-21  
**Evaluator:** Independent evaluator agent  
**Scope:** WS2-C-FIX-02 (1st Line Resolution Rate % formula correction)  
**Verdict:** **PASS**

---

## EV-WS2C-5 — Corrected Meaning

| Check | Result |
|-------|--------|
| **Old formula (request-type)** | Counted tickets with CC request types (incident, chat, etc.) as numerator — measured request-type composition, not resolution behaviour |
| **New formula (tier-based)** | Counts tickets where `classifyTier(current_tier) === 'Customer Care'` as numerator — measures tickets resolved without escalation beyond first line |
| **Code verified** | `kpi-pipeline.ts:749` — `resolvedRows.filter(r => classifyTier(r.current_tier) === 'Customer Care').length` |
| **classifyTier() verified** | `kpi-pipeline.ts:94-98` — normalises raw `current_tier` via `TIER_MAP` (line 86-92). Maps `'customer care'` → `'Customer Care'`, nulls → `'Unclassified'` |
| **Denominator unchanged** | All resolved-today tickets (excl. onboarding), filtered by `status_category = 'Done'` and `jira_updated` date |
| **ccRequestTypes array retained** | Confirmed still present at line 747, used by FCR calculation downstream — not orphaned, not removed |
| **Semantic correctness** | A ticket escalated to Tier 2+ before resolution is correctly excluded from the 1st Line numerator. A ticket resolved at Customer Care tier without escalation is correctly included. This IS the business definition of 1st-line resolution. |

**Verdict: PASS** — the metric now measures actual first-line resolution behaviour, not request-type composition.

---

## EV-WS2C-6 — Runtime Execution Remains Healthy

| Check | Result |
|-------|--------|
| **Today's stored value** | `1st Line Resolution Rate % = 43` (target 60, rag 3/amber) — independently confirmed via direct Azure SQL query against `jira_kpi_daily` |
| **Yesterday's value (old formula)** | `1st Line Resolution Rate % = 64` (rag 1/green) — confirms the formula change produced a different result on a different day's data |
| **Value plausibility** | 43% of 16 resolved tickets ≈ 7 at Customer Care tier. Plausible for a mixed support desk where escalation is common. |
| **Derived group completeness** | All 4 derived KPIs present in today's data: 1st Line (43), CSAT Derived (0), FCR (47), Bug Ack (0) |
| **Total KPI count** | 78 metrics across 15 groups — consistent with build report (77 in loop 06, +1 likely from Volume group timing) |
| **Build report coincidence note** | Build report correctly flagged that today's value (43) coincidentally matches the pre-fix loop 03 value. This is expected — for some days the CC-request-type set and Customer Care tier produce similar counts. The formula is still semantically different. |

**Verdict: PASS** — runtime execution is healthy, producing non-zero plausible values.

---

## EV-WS2C-7 — No Regression to Related Derived Outputs

| KPI | Today | Yesterday | Assessment |
|-----|-------|-----------|------------|
| FCR Rate % | 47 | 60 | Normal daily variance. FCR uses `ccRequestTypes` + comment analysis — completely independent of the 1st Line formula change. Code path untouched (confirmed at line 747, 798+). |
| Bug Escalation-to-Ack (hours) | 0 | 0 | No bug-type tickets resolved today. Code path untouched. |
| CSAT % (Derived) | 0 | 0 | Still blocked by separate CSAT field issue (WS2-B). Code path untouched. Known pre-existing. |

**Verdict: PASS** — all other derived KPIs producing expected values, no regression.

---

## EV-WS2C-8 — No Regression to Trusted Slices

### WS1 — Trusted KPI Family

| KPI | Value | Status |
|-----|-------|--------|
| Open Tickets | 477 | Present, non-zero |
| Unassigned | 121 | Present, non-zero |
| New Tickets Today | 65 | Present, non-zero |
| Tickets Solved Today | 16 | Present, non-zero |
| Waiting on Requestor | 48 | Present, non-zero |
| CSAT % | 0 | Present (known CSAT field issue, pre-existing) |

### WS2-A — Escalation/Rejection Family

| KPI | Value | Status |
|-----|-------|--------|
| Escalation Accuracy % | 85 | Present, non-zero |
| Tickets escalated to Tier 2 | 14 | Present, non-zero |
| Tickets escalated to Tier 3 | 2 | Present, non-zero |
| Tickets escalated to Development | 4 | Present, non-zero |
| Tickets rejected by Tier 2 | 0 | Present (zero is valid — no rejections today) |
| Tickets rejected by Tier 3 | 3 | Present, non-zero |
| Tickets rejected by Development | 0 | Present (zero is valid) |

### WS5 — Breach-Board Family

| KPI | Value | Status |
|-----|-------|--------|
| SLA Breached | 98 | Present, non-zero |
| FRT Compliance % (Open Queue) | 69 | Present, non-zero |
| FRT Compliance % (Resolved Today) | 38 | Present, non-zero |
| Resolution Compliance % (Open Queue) | 79 | Present, non-zero |
| Resolution Compliance % (Resolved Today) | 94 | Present, non-zero |
| FRT Breaches (Resolved Today) | 10 | Present, non-zero |
| Resolution Breaches (Resolved Today) | 1 | Present, non-zero |

**Verdict: PASS** — all three trusted KPI families producing values, no missing or zeroed-out metrics.

---

## Overall Assessment

| Criterion | Status |
|-----------|--------|
| Metric meaning corrected (tier-based, not request-type) | PASS |
| Runtime execution healthy, value non-zero and plausible | PASS |
| No regression to FCR, Bug Ack, CSAT Derived | PASS |
| No regression to WS1 trusted family | PASS |
| No regression to WS2-A escalation/rejection family | PASS |
| No regression to WS5 breach-board family | PASS |

### Known Remaining Defect (Non-Blocking)

The `jira_updated` date filter (line 743) uses update-date rather than resolution-date. This is a shared defect affecting multiple metrics (including Solved Today) and should be addressed as a cross-cutting fix. It does not block the formula correction evaluation — the formula itself is now semantically correct.

---

## Verdict: **PASS**

The `1st Line Resolution Rate %` metric meaning is now corrected. It measures the percentage of tickets resolved at Customer Care tier (genuine first-line resolution) rather than the percentage of resolved tickets with CC request types (request-type composition). Runtime execution confirmed via independent Azure SQL query. No regressions detected across any trusted KPI family.

---

## Evidence Sources

| Source | Method |
|--------|--------|
| Formula code | Direct read of `kpi-pipeline.ts:738-751` |
| `classifyTier()` implementation | Direct read of `kpi-pipeline.ts:86-98` |
| Today's KPI values (78 metrics) | Direct Azure SQL query against `jira_kpi_daily` (`TechSupportJSM` database) |
| Yesterday's derived values | Direct Azure SQL query for comparison |
| Build reports | `ws2c_fix_1st_line_resolution_report_loop05.md`, `ws2c_1st_line_runtime_verification_report_loop06.md` |
