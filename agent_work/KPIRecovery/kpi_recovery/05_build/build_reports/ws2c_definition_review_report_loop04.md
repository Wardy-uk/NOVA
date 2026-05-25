# WS2-C: Derived KPI Definition Review — Loop 04

**Date:** 2026-05-21  
**Scope:** 1st Line Resolution Rate %, FCR Rate %, Bug Escalation-to-Ack (hours)  
**Prerequisite:** WS2-C-FIX-01 complete (observability + manual trigger verified in loop 03)  
**Method:** Code trace of `collectDerivedKpis()` in `kpi-pipeline.ts:730–872`, cross-referenced with TIER_MAP and tier classification logic

---

## 1. 1st Line Resolution Rate %

### Current Formula (kpi-pipeline.ts:740–750)

```
resolvedRows = SELECT request_type, current_tier FROM jira_issue_cache
  WHERE status_category = 'Done'
    AND CAST(jira_updated AS DATE) = CAST(GETUTCDATE() AS DATE)
    AND request_type != 'onboarding'

ccRequestTypes = [incident, chat, ai request, emailed request, gdpr, service request, tpj request]
ccResolved = resolvedRows WHERE request_type IN ccRequestTypes
firstLineRate = ccResolved / totalResolved × 100
```

**What it actually measures:** The percentage of today's resolved tickets that belong to CC request types. This is a **request-type composition metric**, not a resolution metric.

**What "1st Line Resolution" should mean:** The percentage of tickets resolved by Tier 1 (Customer Care) without escalation to Tier 2, Tier 3, or Development.

### Mismatch Analysis

| Aspect | Current formula | Intended meaning |
|--------|----------------|------------------|
| Numerator | Tickets with CC request types | Tickets resolved while `current_tier` = Customer Care |
| Denominator | All resolved-today (excl. onboarding) | All resolved-today (excl. onboarding) |
| Tier-awareness | None — uses request_type only | Needs `current_tier` field |
| Date field | `jira_updated` (any edit counts) | Should use resolution date |

**Key observation:** The data needed for the correct formula already exists. `current_tier` is SELECTed in the query but never used. The TIER_MAP (line 86–92) classifies tiers into Customer Care, Production, Tier 2, Tier 3, Development. A ticket resolved while still at `current_tier = 'Customer Care'` is a genuine 1st-line resolution.

### Verdict: **Bounded formula correction**

The fix is mechanical: change the numerator from `ccRequestTypes.includes(request_type)` to `current_tier === 'Customer Care'` (or the equivalent `classifyTier(current_tier) === 'Customer Care'`). The denominator stays the same. No new data sources, no API calls, no architectural change.

**Caveat — date filter:** The query uses `jira_updated` instead of a proper resolution date. This is a shared defect with Solved Today (P0 audit finding #3). If `jira_updated` is being addressed elsewhere, this metric inherits the fix. If not, it should use the same date logic as whatever Solved Today ends up using. This is independent of the definition fix.

---

## 2. FCR Rate %

### Current Formula (kpi-pipeline.ts:780–822)

```
For each CC-type resolved-today ticket (max 30):
  1. Fetch up to 50 comments from Jira REST (newest first)
  2. Filter to agent comments (accountType != 'customer' AND not bot)
  3. Filter to customer comments (accountType == 'customer')
  4. Find "first" agent comment = agentComments[last] (oldest in newest-first order)
  5. If no customer comment exists AFTER the first agent comment → count as FCR
  6. FCR Rate = fcrCount / fcrTotal × 100
```

**What it actually measures:** The percentage of sampled tickets where no customer replied after the first agent response.

**What FCR should mean (industry standard):** The percentage of tickets resolved on first contact — the customer's issue was addressed in the initial interaction without requiring follow-up, reopening, or escalation.

### Mismatch Analysis

| Aspect | Current formula | Industry FCR |
|--------|----------------|-------------|
| Definition | No customer reply after first agent comment | Resolved on first contact |
| False positives | Customer gave up → counted as FCR | Would not count |
| False positives | Customer satisfied but didn't reply → correct | Correct |
| False negatives | Customer replied "thanks" → counted as NOT FCR | Should count as FCR |
| Data dependency | Live Jira REST comment API (fragile) | Ideally status/resolution based |
| Sample bias | First 30 tickets, no ORDER BY | Should be full population or random sample |
| Internal comments | Included (no `jsdPublic` filter) | Should exclude |

### Additional Technical Defects

1. **No ORDER BY** on the resolved-today query — sample is non-deterministic
2. **50-comment limit** — if >50 comments, the "first agent comment" calculation is wrong (gets 50th-newest, not actual first)
3. **200ms throttle × 30 tickets** = 6+ seconds of blocking Jira API calls
4. **Silent per-ticket error swallowing** — API failures silently reduce the denominator

### Verdict: **Definition decision required**

This metric cannot be mechanically fixed — it needs a business decision on what FCR means for Nurtur's support operation. Options:

**Option A — Status-based FCR (recommended):** A ticket is FCR if it was resolved without ever being escalated (i.e., `current_tier` never moved beyond Customer Care). This can be derived from the `escalation_log` table (which tracks tier changes) without any Jira API calls. Removes the fragility entirely.

**Option B — Comment-based proxy (current approach, improved):** Keep the comment-based logic but fix the technical defects (ORDER BY, `jsdPublic` filter, handle >50 comments, exclude "thanks" replies). Still fundamentally a proxy.

**Option C — Defer/park.** FCR is a complex metric with many edge cases. If the team doesn't actively use it for decisions, parking it avoids investing in a metric that might still be misleading.

---

## 3. Bug Escalation-to-Ack (hours)

### Current Formula (kpi-pipeline.ts:808–813)

```
For each bug/development/defect-type resolved-today ticket (max 30):
  1. Fetch comments from Jira REST
  2. Find first agent comment (same logic as FCR)
  3. ackHours = (firstAgentComment.created - ticket.jira_created) / 3600000
  4. Average across all matching tickets
```

**What it actually measures:** Average hours from ticket creation to first agent comment, for bug-type tickets resolved today.

**What "Bug Escalation-to-Ack" should mean:** Average hours from when a bug was escalated to the Development tier until a developer acknowledged it.

### Mismatch Analysis

| Aspect | Current formula | Intended meaning |
|--------|----------------|------------------|
| Start time | `jira_created` (ticket creation) | Escalation timestamp (tier change to Development) |
| End time | First agent comment | First Development tier acknowledgement |
| Population | Resolved today | All bugs escalated (regardless of resolution) |
| Data source | Live Jira comments (fragile) | `escalation_log` or tier change history |

### Data Sparsity Problem

Bug/dev/defect tickets resolving on any single day is extremely rare (loop 03 confirmed 0 for today). This metric will be 0 on most days, making it statistically useless as a daily KPI. It might work as a weekly or monthly aggregate.

### Verdict: **Park (defer)**

This metric has three compounding problems:
1. **Wrong start point** — creation ≠ escalation
2. **Wrong end point** — first comment ≠ dev acknowledgement
3. **Near-zero daily population** — even if the formula were correct, the metric would be empty most days

Fixing it properly requires:
- Using `escalation_log` to get the actual escalation timestamp
- Defining what "acknowledgement" means (status change? assignee change? comment?)
- Aggregating over a longer window (weekly/monthly)

This is useful long-term but is not a bounded correction — it's a redesign. Recommend parking it and revisiting when the escalation log has more history to work with.

---

## Summary: Classification & Recommendation

| KPI | Defect Type | Recommendation | Effort | Priority |
|-----|-------------|---------------|--------|----------|
| **1st Line Resolution Rate %** | Formula uses wrong field | **Bounded correction** — swap `request_type` filter for `current_tier` check | Small (30 min) | **Next slice** |
| **FCR Rate %** | Fundamental definition gap | **Definition decision** — needs Nick's input on which approach | Medium–Large | After 1st Line |
| **Bug Escalation-to-Ack (hours)** | Wrong start, wrong end, sparse data | **Park** — revisit as weekly/monthly metric later | Large (redesign) | Deferred |

### Recommended Next Slice: WS2-C-FIX-02

**Fix 1st Line Resolution Rate % definition** — this is the best next correction because:

1. **Smallest change** — one line: change filter from `ccRequestTypes.includes(rt)` to `classifyTier(current_tier) === 'Customer Care'` (or equivalent)
2. **No new dependencies** — `current_tier` is already SELECTed in the query
3. **No API calls** — query-only, no Jira REST fragility
4. **Immediately verifiable** — re-run manual trigger, compare old vs new value
5. **Correct by construction** — a ticket at Customer Care tier that resolved without escalating IS a 1st-line resolution

The `jira_updated` date filter defect should be noted but deferred to a shared fix with Solved Today (P0 audit finding #3), since both use the same pattern.

---

## Completion Checklist

- [x] Current formula traced for each metric (with line references)
- [x] Intended meaning mismatch documented for each
- [x] Each metric classified: correction / decision / park
- [x] Best next bounded correction slice identified: **1st Line Resolution Rate %**
- [x] Metric recommended for parking: **Bug Escalation-to-Ack (hours)**
- [x] Metric requiring business decision: **FCR Rate %**
