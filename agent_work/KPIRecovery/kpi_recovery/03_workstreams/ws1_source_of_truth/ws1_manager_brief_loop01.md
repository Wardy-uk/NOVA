# WS1 Manager Brief — Loop 01: Source-of-Truth Recovery

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** First recovery loop
**State:** ACTIVE

---

## Scope

This first loop focuses on establishing source-of-truth boundaries for the P0 KPI slice:

1. **Ghost KPI suppression** — tier validity boundaries
2. **Development backlog count** — source/filter definition
3. **FRT / SLA methodology** — field identity and parser correctness
4. **Per-tier FRT breach counts** — dependent on FRT methodology
5. **Global SLA Breached count** — dependent on Resolution SLA field

---

## Findings Summary

### 1. Ghost KPI Emission (KF-006) — ROOT CAUSE CONFIRMED

**Classification:** Calculation defect

The emission guard at `kpi-pipeline.ts:496` is:
```
if (stats.volume === 0 && !ALL_TIERS.includes(tier)) continue;
```

This allows ANY tier with volume > 0 to emit KPIs, even if it's not in the governed `ALL_TIERS` list. "Customer Care" (parent tier before CC sub-splitting) and "Unclassified" (null-tier fallback) leak through.

**Provisional source decision:** `ALL_TIERS` constant is the authoritative tier list. The guard should suppress all non-governed tiers unconditionally.

**Secondary concern:** `ccBucket()` returns `null` for CC tickets with unmapped request types, leaving them as "Customer Care" (not in `ALL_TIERS`). This means some legitimate tickets may be invisible to per-tier KPIs. Needs a request-type audit before fixing the guard.

### 2. Development Backlog Count (KF-007) — SOURCE AMBIGUITY

**Classification:** Source-of-truth ambiguity

Three systems report different Development ticket counts:
- **NOVA:** 275 — counts all issue types where `current_tier = Development` and `status_category != Done`
- **JSM:** ~230 — Jira board filter, JQL unknown
- **KpiSnapshot (n8n v4):** 213 — query logic not inspected

NOVA applies **no issue-type filter**. The ~45 ticket delta strongly suggests NOVA includes Bugs, Tasks, or Sub-tasks that n8n excludes.

**Provisional source decision:** Jira is the authority for issue existence. But the _business question_ — "what counts as a Development backlog ticket?" — has no documented answer. This is not a code bug; it's a missing business definition.

**Decision needed from Nick:** Should the Development backlog count include all issue types, or only Support requests? This determines whether NOVA needs an issue-type filter.

### 3. FRT / SLA Field Identity (KF-008, KF-009, KF-013) — HIGHEST-RISK AMBIGUITY

**Classification:** Data defect (most likely) or source-of-truth ambiguity

The KPI pipeline reads FRT from `customfield_14046` and Resolution SLA from `customfield_14048`, parsed from the `fields_json` blob. But the Jira sync service extracts a _different_ SLA field — `customfield_10010` — to the `sla_breached` and `sla_breach_time` columns.

**Two failure hypotheses:**

1. **Field absence:** `customfield_14046` / `customfield_14048` may not be present in `fields_json` (some Jira SLA fields require explicit `expand` parameters). If absent, `parseSlaField()` returns null, `isSlaBreached(null)` returns false, and all FRT counts are 0. This exactly matches the observed 100% FRT compliance and zero per-tier FRT breach counts.

2. **Wrong field identity:** `customfield_10010` (extracted during sync) may be the _actual_ FRT or SLA field, and `customfield_14046`/`14048` may be different (or deprecated) fields. The KPI pipeline ignores `customfield_10010` entirely.

**Investigation required before any fix:**
- Sample `fields_json` for 5-10 tickets with known SLA breaches
- Check whether `customfield_14046` and `customfield_14048` are present
- If absent, determine which SLA fields ARE present
- Confirm which Jira SLA configuration maps to which custom field ID
- Compare against n8n v4's SLA field usage

**Provisional source decision:** Jira SLA configuration is the authority. NOVA must use the correct field IDs. Current field usage is unverified and cannot be trusted.

### 4. Per-Tier FRT Breach Counts (KF-009, KF-012) — DEPENDENT

**Classification:** Same root as #3

These metrics share the `isSlaBreached()` code path. If the FRT field identity issue is resolved, these metrics should self-correct. No independent investigation needed until #3 is resolved.

### 5. Global SLA Breached Count (KF-006 extension) — DEPENDENT

**Classification:** Same root as #3

Uses `resBreached` from `customfield_14048` via the same parser. If Resolution SLA field is absent from `fields_json`, this count is also wrong.

---

## Manager Decisions

### MD-001: P0 KPI Subset for Active Recovery

The following KPIs are in active recovery:

| KPI | Recovery Priority | Reason |
|-----|-------------------|--------|
| Ghost KPI suppression | P0-immediate | Root cause confirmed, bounded fix |
| Development backlog count | P0-definition | Business definition missing |
| FRT Compliance % (Open Queue) | P0-investigation | Field identity ambiguity |
| FRT Compliance % (Resolved Today) | P0-investigation | Same root |
| Per-tier FRT breach counts (14 KPIs) | P0-dependent | Resolves with FRT field fix |
| SLA Breached (global) | P0-dependent | Resolves with Resolution SLA field fix |

### MD-002: Provisional Authoritative Sources

| KPI | Provisional Authority | Confidence |
|-----|----------------------|------------|
| Tier validity | `ALL_TIERS` constant in `kpi-pipeline.ts` | High — code is explicit |
| Development ticket count | Jira + business definition (pending) | Low — definition missing |
| FRT SLA data | Jira SLA configuration (field ID TBD) | Low — field identity unverified |
| Resolution SLA data | Jira SLA configuration (field ID TBD) | Low — field identity unverified |

### MD-003: Defect Classification Summary

| KPI Failure | Most Likely Class |
|-------------|-------------------|
| Ghost KPIs | Calculation defect |
| Development count | Source-of-truth ambiguity |
| FRT Compliance 100% | Data defect (field absent) OR source-of-truth ambiguity (wrong field) |
| Per-tier FRT = 0 | Same as FRT Compliance |
| SLA Breached total | Same as FRT Compliance |

### MD-004: Next Step Decision

**The next step should be: Discovery instrumentation + bounded calculation audit.**

Specifically, a Build Agent brief should:

1. **Instrument `fields_json` inspection** — add a one-time diagnostic that samples 10 tickets with known SLA breaches and logs which SLA-related custom fields are present in `fields_json`. This resolves AQ-1 and AQ-2.

2. **Fix ghost KPI emission** — change the guard at line 496 to `if (!ALL_TIERS.includes(tier)) continue;`. This is a confirmed calculation defect with a bounded fix. BUT: first audit `ccBucket()` coverage to ensure no legitimate tickets fall through.

3. **Hold on Development count fix** — this requires a business definition from Nick, not a code change.

4. **Do not expand** to CSAT, escalation counts, agent-level KPIs, or derived KPIs in this loop.

---

## What Remains Uncertain

| # | Uncertainty | Impact | Resolution Path |
|---|-----------|--------|-----------------|
| U-1 | Whether `customfield_14046` / `14048` are present in `fields_json` | Blocks all FRT/SLA recovery | Diagnostic instrumentation |
| U-2 | Which Jira SLA custom field is the authoritative FRT field | Blocks FRT source declaration | Jira admin inspection or field audit |
| U-3 | Whether n8n v4 filters Development by issue type | Informs business definition discussion | n8n workflow inspection |
| U-4 | Whether CC tickets with unmapped request types are legitimate | Affects ghost KPI fix scope | Request-type audit |
| U-5 | Business definition of "Development backlog" | Blocks count fix | Decision from Nick |

---

## Build Agent Handoff Readiness

A Build Agent brief is ready for:
- Ghost KPI emission fix (pending ccBucket audit)
- SLA field diagnostic instrumentation

A Build Agent brief is NOT ready for:
- Development count fix (needs business definition)
- FRT calculation fix (needs field identity confirmed first)
- Any expansion beyond current P0 scope

---

## Next Loop Trigger

This loop is complete. The next manager loop should fire after:
1. SLA field diagnostic results are available
2. Nick has provided the Development backlog business definition
3. ccBucket() request-type coverage has been audited
