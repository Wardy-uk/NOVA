# WS1 Manager Brief — Loop 03: Partial Evaluation Readiness + FRT Recovery Routing

**Date:** 2026-05-20
**Workstream:** WS1 — Source of Truth Validation
**Loop:** Third manager loop (post-Build-02)
**State:** ACTIVE — split into sub-slices with independent progression

---

## Programme State Shift

Build Loop 02 materially changed WS1. It is no longer a single monolithic blocked slice. The evidence now supports splitting WS1 into four sub-slices with independent lifecycle progression:

| Sub-Slice | State | Next Step |
|-----------|-------|-----------|
| **WS1-A:** Tier governance / ghost suppression / CC visibility | BUILD COMPLETE — awaiting runtime verification | First partial evaluator brief |
| **WS1-B:** Resolution SLA source verification | VERIFIED — 8/8 cross-check passed | Advance to SOURCE DEFINED; include in evaluator brief |
| **WS1-C:** FRT recovery | ROOT CAUSE RESOLVED — fix identified, not yet applied | Build Loop 03 |
| **WS1-D:** Development backlog definition/parity | EXTERNALLY BLOCKED | Await Nick's business definition |

---

## What Changed After Build Loop 02

### Confirmed Findings

| Finding | Previous State | Current State |
|---------|---------------|---------------|
| Ghost suppression code changes | Scoped | **IMPLEMENTED** — compiles cleanly, awaiting deploy |
| Resolution SLA cross-check | Planned | **COMPLETE** — 8/8 match, absence explained, denominator correct, compliance 82.4% matches NOVA output |
| FRT field identity | BLOCKED (HDR-2) | **RESOLVED** — `customfield_14046` = "First Reply Time" (SLA ID 76), available via REST API, absent from cache only because missing from `ALL_FIELDS` |
| `customfield_10010` | Confirmed dead | **CONFIRMED** — not returned by REST API, dead field (Service Desk API enumeration proved this definitively) |
| SLA field ambiguity (KF-013) | Partially resolved | **FULLY RESOLVED** — complete field mapping established |

### Blockers Resolved

| Blocker | Previous State | Current State |
|---------|---------------|---------------|
| B-1: FRT field ID unknown | OPEN | **RESOLVED** — `customfield_14046`, one-line fix |
| B-2: CC null request_type | OPEN | **RESOLVED** — `ccBucket()` defaults to CC (Incidents) |
| EB-1: FRT field identity blocks evaluation | BLOCKED | **PARTIALLY RESOLVED** — field known, fix not yet applied. FRT-specific evaluation still blocked until Build Loop 03 + re-sync. |
| EB-2: ccBucket() not implemented | BLOCKED | **RESOLVED** — build complete, awaiting deploy |

### Blockers Remaining

| Blocker | Status | Impact |
|---------|--------|--------|
| B-3: n8n Development JQL | OPEN | Informs Development parity but not blocking other sub-slices |
| B-4: Development backlog business definition | OPEN | Blocks WS1-D only |
| EB-3: Development definition not provided | OPEN | Blocks WS1-D evaluation only |

---

## Manager Decisions

### MD-A: Ghost Suppression Status — READY FOR PARTIAL EVALUATION

**Decision:** Ghost suppression (WS1-A) is now ready for independent evaluation, contingent on runtime verification after deployment.

**Rationale:**
- Code changes are implemented and compile cleanly
- The two-step fix (ccBucket null default + emission guard) addresses the confirmed root cause
- 688 null-RT tickets will route to CC (Incidents); 2 unmapped types also handled
- All 7 governed tiers continue emitting; non-governed tiers are unconditionally suppressed
- The evaluator can verify this by checking `jira_kpi_daily` output after a single snapshot run

**Evidence the evaluator should check:**
1. No KPI rows exist for "Customer Care" or "Unclassified" tiers in post-deploy `jira_kpi_daily` output
2. CC (Incidents) volume has increased to absorb previously invisible tickets (~722 expected)
3. CC (Service Requests) and CC (TPJ) volumes are unchanged
4. Sum of all CC sub-tier volumes matches total open CC-tier tickets
5. All 7 governed tiers are present in output, including zero-volume tiers

### MD-B: Resolution SLA Status — ADVANCE TO SOURCE DEFINED

**Decision:** Resolution SLA (WS1-B) should be advanced to SOURCE DEFINED and included in the first evaluator brief.

**Rationale:**
- Source confirmed: `customfield_14048` ("Resolution", SLA ID 78) in `jira_issue_cache.fields_json`
- Cross-check: 8/8 sampled tickets match between cache and live Jira (5 breached, 3 not breached)
- Absence pattern: project-dependent (NT has field, NTPJ/YO do not) — expected and correct
- Denominator: excludes tickets without SLA field — defensible methodology
- Computed compliance: 82.4% matches NOVA daily output
- Parser: `isSlaBreached()` confirmed compatible with field structure

**What SOURCE DEFINED means:** The authoritative source is identified, the extraction path is traced, the parser is verified, and the methodology is documented. It does NOT mean TRUSTED — independent evaluation and regression protection are still required.

**Evidence the evaluator should check:**
1. Resolution Compliance % (Open Queue) is plausible (not 100% or 0%)
2. Global "SLA Breached" count reflects tickets with `customfield_14048` breach status
3. Tickets from NTPJ/YO are excluded from the denominator (no SLA configured)
4. A sample of breached/not-breached tickets can be cross-referenced against Jira

### MD-C: FRT Routing — Bounded Build Loop 03

**Decision:** The next build should add `customfield_14046` to `ALL_FIELDS`, trigger a re-sync, and verify FRT data now populates the cache.

**Rationale:**
- Root cause is fully understood: field omission from sync field list, not an API limitation
- The fix is a one-line addition to `jira-sync-service.ts`
- After a full re-sync, `fields_json` will contain FRT data
- The existing `isSlaBreached()` parser should work (same structure as Resolution SLA)
- FRT KPI formulas do NOT need to change — only the data source needs to be populated

**Build scope:**
1. Add `'customfield_14046'` to `ALL_FIELDS` in `jira-sync-service.ts`
2. After deploy, trigger full re-sync (or wait for natural full sync)
3. Verify `customfield_14046` is now present in `fields_json` for a sample of tickets
4. Verify `isSlaBreached()` correctly parses the FRT field structure
5. Verify FRT Compliance % (Open Queue) is no longer 100% and per-tier FRT breach counts are no longer 0
6. Optionally: remove `customfield_10010` from `ALL_FIELDS` since it's a dead field (housekeeping, not recovery-critical)

**What this build must NOT do:**
- Do not change FRT KPI calculation formulas
- Do not change the denominator methodology (it's the same as Resolution SLA — correct)
- Do not touch Development backlog logic
- Do not create FRT regression baselines yet (verification first)

### MD-D: Partial Evaluator Decision — CREATE FIRST PARTIAL EVALUATOR BRIEF

**Decision:** The first real evaluator brief should now be created for WS1-A (ghost suppression) and WS1-B (Resolution SLA), while explicitly excluding WS1-C (FRT) and WS1-D (Development count).

**Rationale:**
- WS1-A has a completed build with clear pass/fail criteria observable from runtime output
- WS1-B has verified source evidence, confirmed cross-check, and documented methodology
- Neither depends on the outstanding FRT fix or Development definition
- Waiting for full WS1 convergence would delay evaluation unnecessarily when two sub-slices are independently stable
- The Evaluation Lifecycle Standard supports partial evaluation — the evaluator brief scope just needs to be explicit

**Evaluator brief scope:**
- IN SCOPE: ghost tier suppression correctness, CC sub-tier visibility, Resolution SLA source integrity, Resolution Compliance % methodology
- OUT OF SCOPE: FRT metrics (data not yet in cache), Development backlog count (business definition pending), CSAT, escalation/rejection, agent-level KPIs

**Evaluation precondition:** The ghost suppression changes must be deployed and at least one `collectJiraSnapshot()` run must have completed so that `jira_kpi_daily` reflects the new logic. The evaluator should not evaluate against pre-deploy data.

### MD-E: Development Backlog — REMAINS BLOCKED

**Decision:** WS1-D remains externally blocked. No changes to Development backlog logic until Nick provides the business definition.

**Outstanding questions:**
- HDR-1: Should Development backlog include all issue types or only Support?
- HDR-3: Can the n8n v4 Development JQL be inspected for issue-type filtering?

---

## Human Decision Requests — Updated Status

| ID | Question | For | Status |
|----|----------|-----|--------|
| HDR-1 | Should the Development backlog count include all issue types or only Support? | Nick | **STILL PENDING** |
| HDR-2 | Which Jira field ID is the authoritative FRT SLA? | Jira Admin / Nick | **RESOLVED by Build Loop 02** — `customfield_14046` = "First Reply Time" (SLA ID 76) |
| HDR-3 | Can the n8n v4 Development JQL be inspected? | n8n Owner / Nick | **STILL PENDING** |

---

## Evaluation Status Update

### WS1-A + WS1-B: Stage 0 → Stage 1 (READY FOR CORE EVALUATOR BRIEF)

Per the Evaluation Lifecycle Standard:
- Scope is stable enough to test ✅
- Intended behaviour is defined ✅
- Source/calculation boundary is sufficiently explicit for independent checking ✅

The first partial evaluator brief should be created in this loop.

### WS1-C (FRT): Stage 0 — STILL BLOCKED

FRT evaluation cannot proceed until:
1. `customfield_14046` is added to `ALL_FIELDS` (Build Loop 03)
2. A full re-sync populates the field in `fields_json`
3. FRT metrics are verified to produce non-trivial values

After Build Loop 03, FRT can be added to the evaluator brief as a Stage 2 addendum.

### WS1-D (Development): Stage 0 — STILL BLOCKED

Blocked by HDR-1 (business definition). No timeline.

---

## Next Loop Trigger

This manager loop is complete. The next manager loop (Loop 04) should fire after:
1. Build Loop 03 is complete (FRT field inclusion + re-sync + verification)
2. The partial evaluator brief (WS1-A + WS1-B) has been created and the evaluation preconditions met
3. Optionally: Nick answers HDR-1 (Development definition)
