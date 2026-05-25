# KPI Inventory

## Purpose

This file is the canonical working inventory of KPIs in scope for recovery.

Each KPI should eventually include:

- business definition
- authoritative source
- calculation summary
- validation method
- trust state

---

## P0 Recovery Slice — First Active Scope

These KPIs are in active recovery as of 2026-05-20. They were selected because audit evidence demonstrates observable failures or methodology ambiguity requiring immediate resolution before any expansion work.

### KPI-P0-001: Ghost KPI Suppression

| Field | Value |
|-------|-------|
| **KPI** | Per-tier KPI emission validity |
| **Priority** | P0 |
| **Trust State** | UNTRUSTED |
| **Primary Concern** | 14 ghost KPIs emitting for "Customer Care" and "Unclassified" tiers that are not in the valid tier list (`ALL_TIERS`) |
| **Source** | `kpi-pipeline.ts` line 496 — emission guard `if (stats.volume === 0 && !ALL_TIERS.includes(tier)) continue;` allows any tier with non-zero volume to emit, even if it is not a governed tier |
| **Valid Tiers** | CC (Incidents), CC (Service Requests), CC (TPJ), Production, Tier 2, Tier 3, Development |
| **Observable Failure** | "Customer Care" (pre-ccBucket parent) and "Unclassified" (null tier fallback) appear in `jira_kpi_daily` when tickets exist with unmapped tiers |
| **Provisional Defect Class** | Calculation defect — emission boundary too permissive |
| **Provisional Fix Hypothesis** | Change guard to `if (!ALL_TIERS.includes(tier)) continue;` — suppress all non-governed tiers regardless of volume |
| **Validation Needed** | Confirm which tiers currently emit; confirm no legitimate tier is accidentally excluded by `ALL_TIERS`; confirm n8n v4 also emits only these 7 tiers |

### KPI-P0-002: Development Backlog Count

| Field | Value |
|-------|-------|
| **KPI** | Number of Tickets in Development |
| **Priority** | P0 |
| **Trust State** | UNTRUSTED — GOVERNED DEFINITION SET (D-035), READY FOR ALIGNMENT |
| **Governed Definition** | Every ticket where `current_tier = Development`. No issue-type filter. No status sub-filter beyond `status_category != 'Done'`. Set by Nick via D-035. |
| **Source (NOVA KPI Pipeline)** | `kpi-pipeline.ts` lines 327-334 — loads all open tickets from `jira_issue_cache` where `status_category != 'Done'`, classifies by `current_tier`. No issue-type filter. **This matches the governed definition.** |
| **Source (Tech Support Wallboard)** | `index.ts` line ~2562 — reads `jira_kpi_daily` but uses `sumKpis` to consolidate Development + Tier 3 into a single "Development — Active Tickets" row. Displays 292 = 275 + 17. **This is intentional design, not a defect.** |
| **Source (n8n KpiSnapshot)** | 213 (last run May 15). Stale by 5 days. May also filter by `issuetype = Support`. n8n JQL not yet inspected (HDR-3 still pending). **Non-authoritative comparator.** |
| **Source (JSM Queue)** | ~230 (observed by Nick May 19). JSM queues use operational JQL filters that may exclude issue types or apply status sub-filters. **Non-authoritative comparator.** |
| **Observable Divergence** | Pipeline=275, Wallboard=292 (intentional Dev+T3 sum), JSM~230, n8n=213. Pipeline is the closest surface to the governed rule. |
| **Defect Class (revised)** | Pipeline: **no defect** — matches governed definition. Wallboard: **presentation design** — intentional consolidation, needs labelling review only. n8n/JSM: **non-authoritative comparators** — divergence is expected and not a recovery target. |
| **Validation Needed** | 1. Verify pipeline count matches live Jira JQL `project = NT AND statusCategory != Done AND cf[12981] = "Development"`. 2. Confirm wallboard consolidation is still intentional (label accuracy). 3. Optionally inspect n8n JQL for documentation purposes (HDR-3). |

### KPI-P0-003: FRT Compliance % (Open Queue)

| Field | Value |
|-------|-------|
| **KPI** | FRT Compliance % (Open Queue) |
| **Priority** | P0 |
| **Trust State** | UNTRUSTED |
| **Primary Concern** | NOVA reports 100% for 3 consecutive days; n8n reported 62% on the same date |
| **Source** | `kpi-pipeline.ts` line 486 — `frtComplianceOpen = ((totalFrtChecked - totalFrtBreached) / totalFrtChecked) * 100` |
| **Calculation Logic** | Iterates `parsedOpen` tickets, checks `frtBreached` field parsed from `customfield_14046`. Compliance = (checked - breached) / checked * 100. If no tickets have FRT data (`totalFrtChecked === 0`), defaults to 100%. |
| **Observable Failure** | 100% compliance for open queue is implausible. Either `isSlaBreached()` is returning false incorrectly, `customfield_14046` is not present in `fields_json`, or the field structure doesn't match the parser. |
| **Provisional Defect Class** | Calculation defect OR data defect — root cause not yet isolated |
| **Key Questions** | 1. Are `customfield_14046` values present in `fields_json` for cached tickets? 2. Does `isSlaBreached()` handle the field structure correctly? 3. Does n8n use a different SLA field or methodology? 4. Is the open-queue methodology (checking live SLA state) even valid, vs n8n's approach? |
| **Validation Needed** | Sample 10 open tickets with known FRT breaches in Jira; check whether `fields_json` contains `customfield_14046`; check whether `isSlaBreached()` returns true for them |

### KPI-P0-004: FRT Compliance % (Resolved Today)

| Field | Value |
|-------|-------|
| **KPI** | FRT Compliance % (Resolved Today) |
| **Priority** | P0 |
| **Trust State** | UNTRUSTED |
| **Primary Concern** | Shares the same `isSlaBreached()` parser as Open Queue — if parser is broken, both metrics are wrong |
| **Source** | `kpi-pipeline.ts` line 473 — `frtComplianceResolved = ((resolvedFrtTotal - resolvedFrtBreached) / resolvedFrtTotal) * 100` |
| **Calculation Logic** | Same SLA parsing as Open Queue, but applied to resolved-today subset. Resolved-today defined as: `resolution_name IS NOT NULL AND jira_updated = today AND status_category = 'Done'` |
| **Observable Failure** | Not separately audited yet — shares code path with P0-003, so if parser is broken this is also broken |
| **Provisional Defect Class** | Same as P0-003 until isolated |
| **Validation Needed** | Same SLA field investigation as P0-003; additionally confirm resolved-today filter captures the correct ticket set |

### KPI-P0-005: Per-Tier FRT Breached Counts

| Field | Value |
|-------|-------|
| **KPI** | {Tier} FRT breached (actionable) / (not actionable) — 14 KPIs across 7 tiers |
| **Priority** | P0 |
| **Trust State** | UNTRUSTED |
| **Primary Concern** | All per-tier FRT breached counts stuck at 0; n8n showed 11, 11, 46, etc. |
| **Source** | `kpi-pipeline.ts` lines 428-431 — checks `t.frtBreached === true`, splits by `slaActionable` status |
| **Calculation Logic** | For each open ticket: if `frtBreached === true` AND ticket is `slaActionable` (status in [open, reopened, work in progress]), increment actionable count. Otherwise if not excluded status and not slaActionable, increment not-actionable count. |
| **Observable Failure** | Stuck at 0 implies `frtBreached` is never `true` from `isSlaBreached()` — consistent with P0-003 hypothesis that SLA field parsing is broken |
| **Provisional Defect Class** | Same root as P0-003 — likely data defect (field not in cache) or calculation defect (parser mismatch) |
| **Validation Needed** | Same SLA field investigation as P0-003 — this is a dependent metric |

### KPI-P0-006: SLA Breached (Global)

| Field | Value |
|-------|-------|
| **KPI** | SLA Breached (total count of open tickets with breached Resolution SLA) |
| **Priority** | P0 |
| **Trust State** | UNTRUSTED |
| **Primary Concern** | Uses `resBreached` field (customfield_14048) via same `isSlaBreached()` parser — if parser broken, this is also wrong |
| **Source** | `kpi-pipeline.ts` line 458 — `breachedCount = parsedOpen.filter(t => t.resBreached === true).length` |
| **Calculation Logic** | Counts all open tickets where Resolution SLA (customfield_14048) is breached |
| **Observable Failure** | Not separately flagged in audit, but shares the same SLA parsing mechanism as FRT metrics |
| **Provisional Defect Class** | Calculation defect or data defect — same root as P0-003 |
| **Validation Needed** | Same SLA field investigation; cross-check against Jira SLA breach queue |

---

## P1 Inventory (Deferred — Not In First Recovery Slice)

| KPI | Priority | Current Trust State | Primary Concern |
|-----|----------|---------------------|-----------------|
| Backlog count (global) | P1 | UNTRUSTED | scope and inclusion logic |
| RAG status | P1 | UNTRUSTED | thresholds and consistency |
| Aged backlog buckets | P1 | UNTRUSTED | age calculation and snapshot timing |
| CSAT % | P1 | UNTRUSTED | emitting 0%, likely stub — no real calculation |
| Escalation / Rejection counts | P1 | UNTRUSTED | stuck at 0, escalation_log may be empty |
| Tickets Solved Today | P1 | UNTRUSTED | resolved-today filter uses jira_updated not resolution date |
| Request type distribution | P1 | UNTRUSTED | classification consistency |
| Throughput / closed requests | P1 | UNTRUSTED | state transition correctness |

## P2 Inventory (Expansion Scope — Blocked Until P0 Trust Established)

| KPI | Priority | Current Trust State | Primary Concern |
|-----|----------|---------------------|-----------------|
| 10 per-tier SLA Compliance % KPIs | P2 | NOT YET BUILT | n8n v4 emits these; NOVA does not |
| 12 per-tier FRT Met/Breached counts | P2 | NOT YET BUILT | n8n v4 emits these; NOVA does not |
| 12 per-tier Resolution Met/Breached counts | P2 | NOT YET BUILT | n8n v4 emits these; NOVA does not |
| Escalation Accuracy % (All Time) | P2 | NOT YET BUILT | n8n v4 emits this; NOVA does not |
| Agent-level KPIs (~30 per agent) | P2 | NOT YET BUILT | NOVA has no agent-level capability |
| Derived KPIs (FCR %, 1st Line %, Bug Esc-to-Ack) | P2 | NOT YET BUILT | collectDerivedKpis() exists but disabled/broken |

---

## Required Next Fields To Add (When Promoted Past SOURCE DEFINED)

- KPI owner
- business consumer
- authoritative source candidate (confirmed)
- source latency / freshness note
- formula reference (verified)
- edge-case list
- validation pack reference
- regression baseline reference
