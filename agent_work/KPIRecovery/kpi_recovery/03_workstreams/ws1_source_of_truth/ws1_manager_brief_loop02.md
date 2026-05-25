# WS1 Manager Brief — Loop 02: Post-Diagnostic Recovery Routing

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Second manager loop (post-diagnostic)
**State:** ACTIVE — diagnostic evidence incorporated, build routing ready
**Evaluation State:** Stage 0 — BLOCKED (per Evaluation Lifecycle Standard)

---

## What Changed After Diagnostics

The Build Loop 01 diagnostic eliminated several hypotheses and confirmed root causes. The P0 slice is no longer in speculative discovery — it now has concrete, evidence-backed failure explanations for most items.

### Confirmed Since Loop 01

| Finding | Previous State | Current State |
|---------|---------------|---------------|
| `customfield_14046` (FRT) absent from cache | Hypothesis | **CONFIRMED** — 0/200 sampled, field not returned by Jira REST API |
| `customfield_14048` (Resolution SLA) present and parseable | Hypothesis | **CONFIRMED** — 128/200 present, 27 breached, 101 not, parser compatible |
| `customfield_10010` dead | Hypothesis | **CONFIRMED** — 0/200 present, `sla_breached` column always false |
| FRT Compliance 100% root cause | Suspected data defect | **CONFIRMED data defect** — field absent → checked=0 → defaults to 100% |
| Per-tier FRT breach counts = 0 root cause | Suspected data defect | **CONFIRMED data defect** — same absent field |
| CC null request_type scale | Unknown | **CONFIRMED** — 688/814 (84.8%) open CC tickets have null `request_type` |
| Ghost KPI fix complexity | Assumed one-line fix | **CONFIRMED multi-step** — must fix ccBucket() before tightening emission guard |
| n8n Development JQL | Unknown | **CONFIRMED not locally discoverable** — requires instance inspection |

### Still Uncertain

| # | Uncertainty | Impact | Resolution Path |
|---|-----------|--------|-----------------|
| U-1 | Which Jira field ID is the FRT SLA | Blocks all FRT metric recovery (16+ KPIs) | Jira admin inspection or Service Desk API probe |
| U-2 | Whether n8n filters Development by issue type | Informs business definition discussion | n8n workflow inspection |
| U-3 | Business definition of "Development backlog" | Blocks Development count correction | Decision from Nick |

---

## Manager Decisions

### MD-A: Ghost KPI Recovery — ccBucket() Null Handling First

**Decision:** WS1 Build Loop 02 MUST implement ccBucket() null/default handling BEFORE deploying the governed tier suppression guard.

**Rationale:** 688 legitimate Support tickets (84.8% of CC tier) have null `request_type`. Deploying `if (!ALL_TIERS.includes(tier)) continue;` without a fallback bucket would silently hide these tickets from all per-tier KPIs. This would replace one trust defect (ghost emission) with a worse one (invisible tickets).

**Provisional default bucket:** `CC (Incidents)`

Justification:
- All 688 null-RT tickets are `issuetype = Support` — they are legitimate service desk tickets
- They entered Jira via email, API, or direct creation (no portal request type set)
- CC (Incidents) is the catch-all CC sub-bucket — it already includes Incident, Chat, AI Request, Emailed Request, GDPR
- Mapping null to CC (Incidents) is operationally conservative — it makes tickets visible without inflating a specialised bucket
- "Support Request" (1 ticket) should also map to CC (Incidents)
- "Technical Projects" (1 ticket) should map to CC (Incidents) as default — if it belongs in Development, the `current_tier` field will already route it there

**Build scope:**
1. Update `ccBucket()` to return `'CC (Incidents)'` when `request_type` is null, empty, or unmapped
2. Then tighten emission guard to `if (!ALL_TIERS.includes(tier)) continue;`
3. Both changes in same build, tested together

### MD-B: FRT Recovery — Isolate and Flag, Do Not Guess

**Decision:** The next build should isolate FRT-dependent metrics from Resolution SLA-dependent metrics and add explicit logging/flagging for FRT data absence. It must NOT guess the FRT field ID.

**Rationale:** The FRT field identity is a Jira platform question, not a code question. Two diagnostics have confirmed `customfield_14046` and `customfield_10010` are both absent. The correct FRT field ID can only be determined by:
1. Jira admin → Project settings → SLA configuration → checking which field ID maps to "First Response Time"
2. Or querying the Jira Service Desk API (`/rest/servicedeskapi/request/{issueKey}/sla`) for a known ticket

Until the correct field ID is known:
- FRT Compliance % (Open Queue) should emit a sentinel value or be suppressed, not default to 100%
- FRT Compliance % (Resolved Today) should be similarly handled
- Per-tier FRT breach counts should remain at 0 but with a logged warning
- The pipeline should log "FRT SLA field not found in cached data" on each run to make the absence visible

**Build scope for this decision:** Optional — this is a quality-of-life improvement. The primary FRT fix is blocked by U-1 regardless.

### MD-C: Resolution SLA — Ready for Bounded Corrective Build

**Decision:** Resolution SLA metrics are ready for a bounded verification and potential correction build.

**Rationale:**
- `customfield_14048` is confirmed present in 128/200 open tickets (64%)
- The existing `isSlaBreached()` parser correctly handles the field structure
- 27 breached / 101 not breached (21% breach rate) is plausible
- The Global "SLA Breached" count (line 458) uses `resBreached` from this field and should be producing valid numbers already
- Resolution Compliance % calculations should also be functional for tickets that have the field

**What needs verification:**
- Confirm that the 72/200 tickets missing `customfield_14048` are genuinely tickets without a Resolution SLA (e.g., certain issue types or request types may not have SLA goals), not a data gap
- Confirm that Resolution SLA metrics emitted to `jira_kpi_daily` match what a direct Jira query would produce for the same date
- These are verification tasks, not fixes — the code may already be correct for Resolution SLA

**Build scope:** Include Resolution SLA verification in the Loop 02 build. This is bounded and low-risk.

### MD-D: Human Decision Requests

Three decisions require human input. These are documented below and should be surfaced to the appropriate decision-maker.

---

## Human Decision Requests

### For Nick (Business Owner)

**HDR-1: Development Backlog Definition**

> Should the Development backlog count include all issue types (Support, Bug, Task, Sub-task), or only Support requests?

Context:
- NOVA currently counts 275 Development tickets (all issue types)
- JSM shows ~230 (filter unknown)
- n8n KpiSnapshot shows 213 (query unknown)
- The ~45 ticket delta is likely caused by NOVA including Bugs/Tasks/Sub-tasks that other systems exclude
- This is not a code bug — it's an undefined business rule

Impact of decision:
- "All issue types" → NOVA count is correct, n8n needs updating
- "Support only" → NOVA needs an issue-type filter added to `collectJiraSnapshot()`

### For Jira Administrator

**HDR-2: FRT SLA Field Identity**

> Which Jira custom field ID is the authoritative First Response Time SLA field for project NT, and is it available through the standard REST API (`/rest/api/3/search/jql` with `fields=*all`)?

Context:
- NOVA uses `customfield_14046` but this field is not returned by the Jira REST API (confirmed absent from all 5,693 cached tickets)
- `customfield_10010` is also absent
- The only SLA field present is `customfield_14048` (Resolution SLA)
- FRT may require the Service Desk API expansion or may be under a different field ID

Resolution path options:
1. Check Jira admin → Project settings → SLA configuration → note the field IDs
2. Or: query `GET /rest/servicedeskapi/request/{issueKey}/sla` for any NT ticket to list all SLA names and their IDs

### For n8n Workflow Owner

**HDR-3: n8n Development JQL**

> Can the "Get All Open" JQL in n8n workflow `KriwNYXfWcGBW7D7` be inspected to confirm whether the Development backlog query filters by `issuetype`?

Context:
- The workflow is not stored locally and cannot be inspected from the codebase
- This information would help determine whether the Development count discrepancy is caused by an issue-type filter in n8n that NOVA lacks

---

## Evaluation Status

### WS1 Evaluation: BLOCKED (Stage 0)

Per the Evaluation Lifecycle Standard, evaluation remains at Stage 0 for this slice.

**Blockers preventing evaluation:**

| # | Blocker | Required For |
|---|---------|-------------|
| EB-1 | FRT field identity unknown | Cannot evaluate FRT metric correctness |
| EB-2 | ccBucket() null handling not yet implemented | Cannot evaluate tier emission correctness |
| EB-3 | Development backlog business definition not provided | Cannot evaluate Development count correctness |

**Conditions for advancing to Stage 1 (Core Evaluator Brief):**
- ccBucket() null handling deployed AND emission guard tightened (EB-2 resolved)
- FRT field identity confirmed by Jira admin (EB-1 resolved)
- Development backlog definition provided by Nick (EB-3 resolved)

When these conditions are met, a core evaluator brief can be written for the P0 slice.

**The evaluator must not be engaged for a slice verdict until at least EB-1 and EB-2 are resolved.** EB-3 may be deferred to a later evaluation addendum if the business definition takes time.

---

## Build Loop 02 Routing

The next build is scoped as two tracks executed in sequence.

### Track 1: CC Null Handling + Ghost Suppression (READY TO BUILD)

No external dependencies. Can proceed immediately.

**Objective:** Make all legitimate CC-tier tickets visible under governed tier names, then suppress ghost tier emission.

**Steps:**
1. Update `ccBucket()` in `kpi-pipeline.ts` to return `'CC (Incidents)'` for null, empty, or unmapped request types
2. Tighten the emission guard at line 496 to `if (!ALL_TIERS.includes(tier)) continue;`
3. Verify that previously ghost-emitting tiers ("Customer Care", "Unclassified") no longer appear
4. Verify that CC (Incidents) volume increases by ~688 to account for formerly invisible tickets
5. Confirm no legitimate tickets are dropped

**Success criteria:**
- Zero ghost KPIs emitted
- All 814 open CC tickets classified into one of: CC (Incidents), CC (Service Requests), CC (TPJ)
- No tier with volume > 0 is suppressed from `jira_kpi_daily` unless it is not in `ALL_TIERS`

### Track 2: Resolution SLA Verification (READY TO BUILD)

No external dependencies. Can proceed immediately.

**Objective:** Confirm that Resolution SLA metrics (`customfield_14048`) are producing correct values, since the field is confirmed present and parseable.

**Steps:**
1. For 5-10 tickets with known Resolution SLA breaches in Jira, confirm that `parseSlaField(fields_json, 'customfield_14048')` returns the correct breach status
2. Confirm that the Global "SLA Breached" count corresponds to the number of open tickets where `customfield_14048` shows breach
3. Confirm that Resolution Compliance % (Open Queue) and Resolution Compliance % (Resolved Today) are calculating from the correct denominator
4. Document the 72/200 tickets missing `customfield_14048` — determine whether this is expected (no SLA goal) or a data gap

**Success criteria:**
- Resolution SLA metrics can be corroborated against a direct Jira query
- The absence of `customfield_14048` on some tickets is explained
- Resolution SLA can be provisionally advanced from UNTRUSTED to SOURCE DEFINED (not yet TRUSTED)

### NOT In Build Loop 02

- FRT field discovery (blocked by HDR-2)
- Development count fix (blocked by HDR-1)
- CSAT, escalation, agent-level KPIs (out of P0 scope)
- Any evaluation or holdout creation

---

## Next Loop Trigger

This manager loop is complete. The next manager loop (Loop 03) should fire after:
1. Build Loop 02 is complete (Track 1 + Track 2)
2. At least one of the human decision requests (HDR-1, HDR-2, HDR-3) has been answered
