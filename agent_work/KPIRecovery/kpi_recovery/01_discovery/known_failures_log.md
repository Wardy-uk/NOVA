# Known Failures Log

## Purpose

This log captures known or suspected KPI recovery failures without prematurely deciding root cause.

Every entry should distinguish between:

- observable symptom
- suspected class
- scope
- current confidence

---

## Entries

| ID | Symptom | Suspected Class | Scope | Confidence | Status |
|----|---------|-----------------|-------|------------|--------|
| KF-001 | Some KPI outputs may not match Jira reality | Source-of-truth ambiguity / data defect | Cross-programme | High | OPEN |
| KF-002 | Certain calculations are believed to be incorrect or inconsistent | Calculation defect | Cross-programme | High | OPEN |
| KF-003 | Data lineage is unclear in places | Source-of-truth ambiguity | Cross-programme | High | PARTIALLY ADDRESSED — P0 lineage traced |
| KF-004 | Source-of-truth boundaries have drifted | Governance failure | Cross-programme | High | PARTIALLY ADDRESSED — SLA field mapping resolved |
| KF-005 | Confidence in reporting layer is degrading | Presentation / evidence integrity | Cross-programme | High | OPEN — multi-surface divergence now documented |

### Audit-Derived Failures (2026-05-20)

| ID | Symptom | Suspected Class | Scope | Confidence | Status | Evidence |
|----|---------|-----------------|-------|------------|--------|----------|
| KF-006 | 14 ghost KPIs emitting for "Customer Care" and "Unclassified" tiers | Calculation defect | Per-tier KPI emission | High | **FIX APPLIED (Loop 02)** — awaiting deploy | `ccBucket()` defaults null to CC (Incidents); emission guard tightened to `if (!ALL_TIERS.includes(tier)) continue;` |
| KF-007 | Development ticket count: four-way divergence (275/292/230/213) across dashboard, wallboard, JSM, n8n | Source-of-truth ambiguity | Development backlog | High | OPEN — hypothesis formed | NOVA all-issue-types, wallboard broader status, JSM/n8n unknown filters |
| KF-008 | FRT Compliance % (Open Queue) stuck at 100% for 3+ days; n8n shows 62% | **Data defect — FIX APPLIED (Loop 03)** | FRT compliance metrics | High | **FIX APPLIED** — awaiting deploy + re-sync | `customfield_14046` added to `ALL_FIELDS`. Parser verified compatible (20/20 NT tickets). Simulated FRT Compliance = 72.3%. |
| KF-009 | All per-tier FRT breached counts stuck at 0; n8n shows 11, 11, 46 etc. | **Data defect — FIX APPLIED (Loop 03)** | Per-tier FRT breach counts | High | **FIX APPLIED** — shares fix with KF-008 | Same field addition. Simulated per-tier breaches: Development actionable=7, not_actionable=6 (50-ticket sample). |
| KF-010 | CSAT % emitting 0% | **Data defect — ROOT CAUSE CONFIRMED (WS2-B)** | CSAT metric (team, derived, agent-level) | **High** | **ROOT CAUSE CONFIRMED** — awaiting fix | `customfield_12802` is NOT in `ALL_FIELDS` in `jira-sync-service.ts` line 19. Field never fetched from Jira API → `fields_json` never contains it → `parseCsat()` always returns null → CSAT % always 0. Fix: add `'customfield_12802'` to `ALL_FIELDS`, verify field exists in NT project, full re-sync after deploy. |
| KF-011 | Escalation and rejection counts stuck at 0 | **Data pipeline gap — FIX DEPLOYED** | Escalation metrics | **High** | **RUNTIME VERIFIED — SOURCE PATH RECOVERED** | Sync-path tier-change detection is live, historical backfill now reads Current Tier (`customfield_12981`) correctly, and bidirectional recording is working. Runtime evidence: 1,254 total records, 1,083 upward escalations, 115 downward rejections, and non-zero current-day KPI outputs. |
| KF-012 | Per-tier FRT breached (not actionable) always 0 | **Data defect — FIX APPLIED (Loop 03)** | Per-tier FRT | High | **FIX APPLIED** — shares fix with KF-008 | Same field addition resolves this. |
| KF-013 | SLA field identity ambiguity: `customfield_10010` (sync) vs `customfield_14046`/`customfield_14048` (KPI pipeline) | **RESOLVED** | SLA field governance | High | RESOLVED | Service Desk API confirms: SLA ID 76 = FRT = `customfield_14046`, SLA ID 78 = Resolution = `customfield_14048`. `customfield_10010` = dead. |
| KF-014 | Resolved-today uses `jira_updated` date, not actual resolution timestamp | Calculation defect | Resolved-today metrics | Medium | OPEN | Commit `bcde0b9` reverted `resolved_at` back to `jira_updated` — column not yet backfilled |

### Multi-Surface Divergence Failures (2026-05-20 — Audit Part 8)

| ID | Symptom | Suspected Class | Scope | Confidence | Status | Evidence |
|----|---------|-----------------|-------|------------|--------|----------|
| KF-015 | SLA Breach Board shows 0 tickets over SLA; Dashboard shows SLA Breached = 103 | Calculation defect | Wallboard vs pipeline | High | OPEN — not yet investigated | Wallboard queries live cache with different SLA/actionable definitions |
| KF-016 | Tech Support Wallboard Development = 292 vs Dashboard 275 vs JSM ~230 vs n8n 213 | Calculation defect + source-of-truth ambiguity | Wallboard Development count | High | OPEN | Wallboard may query broader status set than `status_category != 'Done'` |
| KF-017 | Trends FRT Compliance MTD = 69.3% vs Dashboard 100% | Source divergence + data defect | Cross-surface FRT | High | PARTIALLY ADDRESSED | Dashboard 100% is KF-008 (fix applied). Trends reads stale n8n KpiSnapshot (last run May 15). |
| KF-018 | Trends Total Queue Size = 477 vs Dashboard Open Tickets = 557 (80 ticket gap) | Source divergence | Cross-surface queue size | Medium | OPEN | Trends reads n8n data (5 days stale); may also use different filters |
| KF-019 | Key Accounts + Customer Success wallboards 12+ hours stale | Workflow defect | Wallboard cache refresh | Medium | OPEN — operational | Cache refresh timer not running or blocked |
| KF-020 | KPI Breach Board TOTAL KPIS = 88 (inflated by ghosts), RED = 36 (inflated by ~6 ghost RED) | Calculation defect (secondary to KF-006) | Wallboard display | High | ADDRESSED BY KF-006 | Ghost suppression deploy resolves this |

---

## Failure Dependency Graph

```
KF-008 (FRT Compliance 100%) — FIX APPLIED
  └── KF-009 (per-tier FRT counts = 0) — same root — FIX APPLIED
  └── KF-012 (per-tier FRT not-actionable = 0) — same root — FIX APPLIED
  └── KF-013 (SLA field ambiguity) — RESOLVED

KF-006 (ghost KPIs) — FIX APPLIED
  └── KF-020 (Breach Board ghost inflation) — resolves with deploy

KF-007 (Dev count 4-way divergence) — requires business definition
  └── KF-016 (wallboard Dev count) — additional surface dimension

KF-011 (escalation/rejection = 0) — FIX DEPLOYED / RUNTIME VERIFIED
  └── Automatic population now live via jira_sync
  └── Historical backfill now reads Current Tier changelog + records downward changes

KF-010 (CSAT % = 0) — ROOT CAUSE CONFIRMED (WS2-B)
  └── Fix: add customfield_12802 to ALL_FIELDS in jira-sync-service.ts
  └── KAM/CSM Satisfaction: NOT broken — survey system works, no surveys created yet

KF-015 (Breach Board SLA = 0) — independent, wallboard logic
KF-017 (Trends FRT divergence) — partially addressed by KF-008 fix + stale n8n
KF-018 (Trends queue size) — independent, stale n8n
KF-019 (stale wallboards) — independent, operational
KF-014 (resolved-today timing) — independent, deferred
```

---

## Logging Rule

Do not collapse a symptom into a root cause before evidence exists.
