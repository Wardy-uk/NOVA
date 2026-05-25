# WS2-A Regression Report — Run 03

**Date:** 2026-05-21
**Script:** `ws2a_regression_check.mjs`
**Result:** PASS (4/4 checks passed)
**Promotion Status:** CLEAN — eligible for TRUSTED promotion

---

## Check Results

| Check | Name | Result | Detail |
|-------|------|--------|--------|
| RC-011 | Non-zero escalation activity | PASS | 173 entries in last 3 days |
| RC-012 | Rejection behaviour exists | PASS | 148 downward tier-change entries |
| RC-013 | Escalation Accuracy non-default | PASS | Accuracy=85%, totalEsc=13 — derived from real data |
| RC-014 | WS1/WS5 cross-regression guard | PASS | Development backlog: 233 (threshold: >100) |

---

## KPI Snapshot at Run Time

| KPI | Value | Date |
|-----|-------|------|
| Tickets escalated to Tier 2 | 9 | 2026-05-21 |
| Tickets escalated to Tier 3 | 1 | 2026-05-21 |
| Tickets escalated to Development | 3 | 2026-05-21 |
| Tickets rejected by Tier 3 | 2 | 2026-05-21 |
| Tickets rejected by Tier 2 | 0 | 2026-05-21 |
| Tickets rejected by Development | 0 | 2026-05-21 |
| Escalation Accuracy % | 85 | 2026-05-21 |
| Bug Escalation-to-Ack (hours) | 0 | 2026-05-21 |

---

## Escalation Log Source Breakdown

| Source | Count |
|--------|-------|
| jira_backfill | 1,201 |
| nova_ai | 46 |
| jira_sync | 8 |

---

## Drift Analysis (vs Run 01 baseline)

| Metric | Run 01 | Run 03 | Delta |
|--------|--------|--------|-------|
| escalation_log (3d) | 173 | 173 | 0 |
| Rejection entries | 148 | 148 | 0 |
| Accuracy % | 85 | 85 | 0 |
| Dev backlog | 233 | 233 | 0 |
| jira_backfill | 1,201 | 1,201 | 0 |
| nova_ai | 46 | 46 | 0 |
| jira_sync | 8 | 8 | 0 |

**No drift detected.** All values identical across all three runs.

---

## Frozen Baselines

| Baseline | File | Frozen |
|----------|------|--------|
| BF-011: Escalation activity | `bf_011_ws2a_escalation_activity.md` | 2026-05-21 |
| BF-012: Rejection behaviour | `bf_012_ws2a_rejection_behaviour.md` | 2026-05-21 |

---

## Promotion Assessment — TRUSTED

**WS2-A is ready for TRUSTED status.**

Evidence:
1. **3 consecutive clean runs** — Run 01, Run 02, Run 03 all passed 4/4 checks with zero drift
2. **Baselines stable** — escalation activity (173 entries/3d), rejection behaviour (148 entries), accuracy (85%), dev backlog (233) all unchanged across runs
3. **No false positives** — Accuracy is 85% (not false-100%), rejections exist, escalations flow from all 3 sources (backfill, AI, live sync)
4. **No cross-regression** — WS1/WS5 Development backlog remains at 233, well above the >100 threshold

### Remaining Qualifications (non-blocking)

- `Tickets rejected by Tier 2` and `Tickets rejected by Development` remain 0 — plausible but thin. Will resolve with more business days of data.
- `jira_sync` source still at 8 entries — live detection volume grows naturally with each sync cycle.
- `nova_ai` entries (46) have NULL `from_tier` — known limitation, non-blocking.
