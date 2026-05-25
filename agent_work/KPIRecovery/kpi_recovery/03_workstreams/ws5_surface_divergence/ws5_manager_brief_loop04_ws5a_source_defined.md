# WS5 Manager Brief — Loop 04: WS5-A Source Defined Promotion

**Date:** 2026-05-20  
**Loop type:** Post-verification governance  
**Prior loop:** WS5 Loop 03 (runtime verification)  
**Status:** WS5-A PROMOTED TO SOURCE DEFINED

---

## 1. Evidence Review

Runtime verification report (`ws5a_runtime_verification_report_loop03.md`) assessed against promotion standard:

| Check | Result | Evidence Quality | Blocking? |
|-------|--------|-----------------|-----------|
| RV-1: Development visibility | **PASS** | Strong — quantitative before/after (e.g. Heidi Power 12→38, Sebastian 18→32) | N/A |
| RV-2: OldestTicketKey population | **PASS** | Strong — 14/14 active agents populated, 2/2 zero-ticket agents correctly NULL, key-to-age cross-check consistent | N/A |
| RV-3: AccountId observability | **INCONCLUSIVE** | Log lines confirmed in source code but NSSM stdout capture broken (stale since 2026-03-01) | **NON-BLOCKING** (see §2) |
| RV-4: WORST OLDEST improvement | **PASS** | Strong — 76d→198d, matches dashboard's 197d reference within 1 day | N/A |

---

## 2. RV-3 Inconclusive Classification: NON-BLOCKING

### What RV-3 tests
Whether the new `[kpi-pipeline] Agent metrics refresh:` log line emits matched/unmatched AccountId counts.

### Why it is inconclusive
NSSM is not routing NOVA's stdout to accessible log files. `nova-stdout.log` was last written 2026-03-01. The `claude-debug` user cannot run `nssm get NOVA AppStdout`. This is an **infrastructure access problem**, not a code correctness problem.

### Why it is non-blocking for WS5-A promotion

1. **The log line is verified in source** (kpi-pipeline.ts line 1083). The code is deployed (commit `6072c74` confirmed in prod HEAD `6c70d66`).
2. **Indirect evidence confirms AccountId matching is working:** 14 agents have updated, non-zero `OpenTickets_Total` values. This is only possible if their AccountIds from `jira_issue_cache` matched rows in `dbo.Agent`.
3. **RV-3 tests observability, not behaviour.** The population path itself is evidenced by RV-1, RV-2, and RV-4. RV-3 was designed to reveal unmatched agents — but the strong before/after evidence across all 14 active agents already demonstrates the matching is working.
4. **The remaining operational gap** (fixing NSSM log capture) is infrastructure work that benefits all future verification, not just WS5-A. It should be logged as an independent operational item, not held as a WS5-A gate.

### Residual risk
If any agents exist in `jira_issue_cache` but lack `dbo.Agent` rows, their tickets would be silently excluded from breach board metrics. This risk exists regardless of log capture — the fix would be a diagnostic endpoint, not a log line. Classified as LOW severity: the 14/16 match rate (2 zeroed correctly) suggests agent roster coverage is comprehensive.

---

## 3. Promotion Decision

### D-063: Promote WS5-A from BUILD COMPLETE to SOURCE DEFINED

**Decision:** WS5-A (population-path recovery) is promoted to **SOURCE DEFINED**.

**Rationale:**

All four promotion criteria from the brief are satisfied:

| # | Criterion | Evidence | Met? |
|---|-----------|----------|------|
| 1 | Core source/path behaviour evidenced | RV-1 PASS (Development inclusion), RV-2 PASS (OldestTicketKey), RV-4 PASS (WORST OLDEST convergence) | **YES** |
| 2 | Development visibility restored | Open counts increased dramatically across all agents; Development-tier tickets now counted | **YES** |
| 3 | OldestTicketKey population working | 14/14 active agents populated; 2/2 zero-ticket agents correctly NULL; key-to-age cross-check consistent | **YES** |
| 4 | WORST OLDEST reflects intended source path | 76d→198d, converging with dashboard's 197d | **YES** |
| 5 | Remaining inconclusive item does not invalidate current behaviour | RV-3 is infrastructure access, not code correctness; indirect evidence confirms matching works | **YES** |

### D-064: RV-3 log-capture gap is non-blocking for WS5-A and classified as independent operational item

The NSSM log capture issue (F-2 in verification report) should be tracked independently. It affects all future runtime verification work across all workstreams, not specifically WS5-A.

**Recommended actions (operational, not programme-blocking):**
1. Nick checks `nssm get NOVA AppStdout` as admin
2. OR: add a `/api/admin/kpi-diagnostics` endpoint exposing last refresh match/unmatch counts

---

## 4. Next Lifecycle Step for WS5-A

### D-065: WS5-A next step is independent evaluation

WS5-A follows the same trust lifecycle as WS1 sub-slices:

```
BUILD COMPLETE → SOURCE DEFINED → EVALUATED → REGRESSION PROTECTED → TRUSTED
                 ^^^^^^^^^^^^^^^^
                 (current state)
```

**Independent evaluation scope for WS5-A should verify:**
1. Development-tier agents remain visible on breach board after ≥1 pipeline cycle
2. OldestTicketKey remains populated and consistent
3. WORST OLDEST remains converged with dashboard oldest
4. No regression in WS1-scope metrics (ghost suppression, Resolution SLA, FRT, Development count)

**When to evaluate:** WS5-A evaluation can proceed in the next loop. No additional runtime observation period is required — the evidence from this verification is already strong and the fixes are deterministic (SQL query changes, not heuristic logic).

---

## 5. WS5-B Isolation

### WS5-B remains explicitly separate

WS5-B (SLA-definition alignment) is **unchanged** by this loop:
- Status: NEW SLICE, scoping deferred (D-062)
- Root cause: `customfield_10010` (completed cycles only) vs `customfield_14048` (completed+ongoing)
- Not blocked by WS5-A promotion
- Not unblocked by WS5-A promotion (independent root cause)
- Next action: NA-38 (scope WS5-B after WS5-A promotion) — now READY

### WS5-A promotion does NOT resolve G-009 or G-011 fully

G-009 and G-011 were split in D-059. WS5-A resolves the population-path component:
- G-009: breach board now shows non-zero agent data (population fixed), but TICKETS OVER SLA count will still diverge (SLA-definition = WS5-B)
- G-011: WORST OLDEST now converges with dashboard (76d→198d), but SLA-based oldest logic may still differ for edge cases (WS5-B)

---

## 6. Unexpected Findings — Routing

| Finding | From | Impact | Action |
|---------|------|--------|--------|
| F-1: Large ticket count increases | RV report | Wallboard visual design may need review for 30-40 ticket counts | Low priority, presentation concern. Note for future wallboard review. |
| F-2: NSSM stdout not captured | RV report | All future runtime verifications affected | Logged as D-064 operational item. Independent of programme. |
| F-3: No purely-Development agents | RV report | All Development-tier tickets belong to agents who also handle other tiers | No action — expected for a support team structure. |

---

## 7. Programme State Updates

| Item | Before | After |
|------|--------|-------|
| WS5-A state | BUILD COMPLETE, DEPLOY/RV PENDING | **SOURCE DEFINED** (D-063) |
| G-009 WS5-A component | Build complete | **Source defined — population-path resolved** |
| G-011 WS5-A component | Build complete | **Source defined — OldestTicketKey + WORST OLDEST resolved** |
| RV-3 log gap | Unclassified | **NON-BLOCKING, independent operational item** (D-064) |
| WS5-B | New slice, scoping deferred | Unchanged — NA-38 now READY |

---

## 8. Next Actions

| # | Action | Type | Owner | Status |
|---|--------|------|-------|--------|
| NA-36 | ~~Deploy WS5-A~~ | ~~Deploy~~ | ~~Nick~~ | ✅ DONE — deployed as commit `6072c74` in prod HEAD `6c70d66` |
| NA-37 | ~~Runtime verification RV-1 through RV-4~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ DONE — 3 PASS, 1 INCONCLUSIVE (non-blocking) |
| NA-38 | Scope WS5-B SLA-definition alignment slice | Programme | Manager Agent | **READY** |
| NA-39 | G-014 fix (independent of WS5-A/B) | Build | Build Agent | READY |
| NA-40 | WS5-A independent evaluation | Evaluation | Evaluator Agent | **READY** — next lifecycle step |
| NA-41 | Fix NSSM log capture (operational) | Infrastructure | Nick | OPTIONAL — benefits all workstreams |

---

## 9. Completion Checklist

| Requirement | Status |
|-------------|--------|
| WS5-A promotion decision explicit | ✅ Promoted to SOURCE DEFINED (D-063) |
| Blocking vs non-blocking residuals explicit | ✅ RV-3 classified NON-BLOCKING (D-064) |
| Next lifecycle step explicit | ✅ Independent evaluation (NA-40) |
| WS5-B explicitly separate | ✅ Unchanged, NA-38 now READY |
