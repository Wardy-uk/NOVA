# WS5 Manager Brief — Loop 03: Post-Build Governance

**Date:** 2026-05-20
**Loop type:** Post-build governance
**Prior loop:** WS5 Build Loop 02 (breach board population fix)
**Status:** BUILD VERIFIED → SLICE SPLIT → RUNTIME VERIFICATION ROUTED

---

## 1. Build Verification Summary

All three approved fixes confirmed in `kpi-pipeline.ts:refreshAllAgentMetrics()` (lines 948–1087):

| Fix | Verified | Evidence |
|-----|----------|----------|
| Development tier inclusion | ✅ | `'Development'` present in all 3 query tier filters (openStats L984, solvedToday L1000, solvedWeek L1015) |
| OldestTicketKey population | ✅ | Correlated subquery (L973-979), UPDATE writes `@oldestKey` (L1044), zeroing sets `NULL` (L1064, L1075) |
| AccountId match observability | ✅ | `unmatchedAccountIds[]` tracked (L1024, L1049), summary log (L1083), conditional detail log (L1084-1086) |
| TypeScript compilation | ✅ | `npx tsc --noEmit` clean (build report) |
| No other files changed | ✅ | Single-function scope confirmed |

**Manager verdict:** Build is correct and bounded. No scope creep. Ready for deploy/runtime verification.

---

## 2. SLA-Definition Difference — Classification

The build report documented a structural SLA divergence that was **inspected but not changed** (per brief instructions):

| Property | Breach Board (`sla_breached`) | Dashboard (`resBreached`) |
|----------|-------------------------------|---------------------------|
| Jira field | `customfield_10010` (dead field) | `customfield_14048` (Resolution SLA) |
| Cycle scope | Completed cycles only | Completed + ongoing |
| Negative remaining time | Not checked | Treated as breached |
| Additional filters | Status exclusions + due_date gate | None |

**Classification: NON-BLOCKING for WS5-A, but OPEN and requires its own slice (WS5-B).**

Rationale:
- The population-path fixes (Development inclusion, OldestTicketKey, observability) are independently valuable and deployable
- The SLA-definition difference is a separate root cause that will keep TICKETS OVER SLA counts diverged even after WS5-A deploys
- Fixing SLA logic in the same slice as population-path would exceed the bounded scope and increase deploy risk
- The SLA fix has two viable approaches (reparse `fields_json` with `isSlaBreached()`, or update `extractSlaBreached()`) — both need their own scoping and evaluation

---

## 3. Decisions

### D-059: Split WS5 first slice into WS5-A and WS5-B

**WS5-A: Population-path recovery** — Development inclusion, OldestTicketKey, AccountId observability. BUILD COMPLETE. Ready for deploy/runtime verification.

**WS5-B: SLA-definition alignment** — Align breach board SLA logic with dashboard (`customfield_14048`, completed+ongoing cycles). NEW SLICE. Requires its own discovery/build/evaluation cycle.

**Rationale:** Two independent root causes sharing a surface. Population-path is build-complete and independently valuable. SLA logic is a different code path with different risk. Coupling them would delay deployment of verified work.

### D-060: WS5-A is ready for deploy/runtime verification

All three fixes are implemented, verified, and bounded. No other code changes required. Deploy triggers `refreshAllAgentMetrics()` on next pipeline run, which will exercise all three fixes.

### D-061: Runtime verification scope for WS5-A

Runtime verification should check four observables after deploy:

| # | Observable | Method | Expected Outcome |
|---|-----------|--------|------------------|
| RV-1 | Development agents visible on breach board | Check `/api/public/wallboard/breached` response for agents with Development-tier tickets | Development agents now present (were previously excluded) |
| RV-2 | OldestTicketKey populated | Check `dbo.Agent` rows for non-NULL `OldestTicketKey` values | Keys populated for agents with open tickets |
| RV-3 | AccountId match rate | Check server logs for `[kpi-pipeline] Agent metrics refresh:` line | `matched` count > 0; `unmatched` count reveals roster gaps |
| RV-4 | WORST OLDEST improvement | Compare breach board "WORST OLDEST" before/after deploy | Should increase from 76d toward dashboard's 197d (Development now included) |

**NOT in RV scope:** TICKETS OVER SLA parity with dashboard. This requires WS5-B (SLA-definition alignment) to converge. RV-4 is partial — oldest will improve from Development inclusion but OVER SLA count will remain diverged due to different SLA field.

### D-062: WS5-B scoping deferred to next manager loop

WS5-B should not be scoped in this loop. It requires:
- Decision on approach (reparse `fields_json` vs update `extractSlaBreached()`)
- Assessment of whether `customfield_10010` should be replaced entirely or kept for backward compatibility
- Understanding of whether n8n also populates `dbo.Agent.OpenTickets_Over2Hours` (if so, NOVA's population may conflict)

---

## 4. Gap Register Updates

| Gap | Previous Status | New Status |
|-----|----------------|------------|
| G-009 | WS5 FIRST SLICE | **SPLIT: WS5-A (population-path) BUILD COMPLETE + WS5-B (SLA-definition) NEW SLICE** |
| G-011 | WS5 FIRST SLICE | **SPLIT: WS5-A (OldestTicketKey) BUILD COMPLETE + WS5-B (SLA oldest logic) depends on WS5-A deploy** |

G-009 and G-011 each have two contributing root causes:
1. Population-path exclusions (Development tier, OldestTicketKey NULL) → WS5-A (FIXED)
2. SLA-definition divergence (different Jira field, different cycle scope) → WS5-B (OPEN)

---

## 5. Programme State Update

| Item | Before | After |
|------|--------|-------|
| WS5 state | ACTIVE — FIRST DISCOVERY LOOP COMPLETE | ACTIVE — WS5-A BUILD COMPLETE, DEPLOY/RV PENDING |
| G-009 | OPEN (single slice) | SPLIT: WS5-A build complete, WS5-B new slice |
| G-011 | OPEN (single slice) | SPLIT: WS5-A build complete, WS5-B new slice |
| Next action | Build population-path fix | Deploy WS5-A + runtime verification |

---

## 6. Next Actions

| # | Action | Type | Owner | Status |
|---|--------|------|-------|--------|
| NA-36 | Deploy WS5-A (commit containing `refreshAllAgentMetrics()` fixes) | Deploy | Nick | READY |
| NA-37 | Runtime verification: check RV-1 through RV-4 after deploy | Verification | Build Agent | BLOCKED on NA-36 |
| NA-38 | Scope WS5-B SLA-definition alignment slice | Programme | Manager Agent | READY after NA-37 |
| NA-39 | G-014 fix (wallboard cache business-hours restriction) remains independent | Build | Build Agent | READY — independent of WS5-A/B |

---

## 7. Routing

**Immediate next step:** Deploy the current `nova-codex` branch (contains the `refreshAllAgentMetrics()` fixes) and run runtime verification.

**Runtime verification brief:** Written to `05_build/implementation_plans/ws5_runtime_verification_brief_loop03.md` — ready for build agent execution after deploy.

**WS5-B scoping:** Deferred to next manager loop after WS5-A runtime verification completes.
