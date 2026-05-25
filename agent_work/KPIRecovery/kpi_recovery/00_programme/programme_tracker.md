# Programme Tracker — NOVA KPI Recovery

STATUS: AUTHORITATIVE ORCHESTRATION STATE

Purpose:
This file is the live tracker for the NOVA KPI Engine Recovery & Trust Restoration programme.

It records:

- active workstreams
- trust state of critical KPI domains
- current convergence focus
- blockers and decision gates
- promotion readiness

---

## Programme State

| Area | State | Notes |
|------|-------|-------|
| Programme initialisation | ACTIVE | Scaffold created, 11 manager loops + 5 build loops complete |
| Programme recovery method | RESET IN EFFECT | Global KPI trust is being re-baselined from cache/snapshot integrity upward following the full Jira parity audit (D-142). |
| Discovery baseline | COMPLETE (P0 pipeline) | All P0 root causes identified and builds complete. Multi-surface divergence now documented. |
| Source-of-truth governance | **TRUSTED (ALL)** | WS1-A/B/C promoted to TRUSTED (D-042). WS1-D promoted to TRUSTED (D-053). WS1 operationally closed. |
| P0 KPI trust | **TRUSTED** | Ghost suppression, Resolution SLA, FRT recovery all TRUSTED. 3 consecutive clean regression runs + manager review. |
| Independent evaluation | **STAGE 4 — CONVERGENCE ISSUED** | WS1-EVAL-01 PASS. All regression runs PASS. Trust promotion complete. |
| Regression protection | **COMPLETE — TRUSTED GRANTED** | Run 01 PASS, Run 02 PASS, Run 03 PASS (all 6/6). All trust gate conditions met (D-042). |
| Multi-surface divergence | **WS5 TRUSTED — OPERATIONALLY CLOSED** | G-010, G-014, G-015 RESOLVED. G-012 MONITORING. G-013 presentation design (D-058). **G-009+G-011 FULLY RESOLVED: WS5-A TRUSTED (D-072), WS5-B TRUSTED (D-089)**. |

---

## WS1 Sub-Slice State

| Sub-Slice | Code State | Trust State | Next Step |
|-----------|-----------|-------------|-----------|
| **WS1-A** | DEPLOYED + VERIFIED | **TRUSTED** (D-042) | Operationally closed. Regression script available for periodic checks. |
| **WS1-B** | DEPLOYED + VERIFIED | **TRUSTED** (D-042) | Operationally closed. Regression script available for periodic checks. |
| **WS1-C** | DEPLOYED + VERIFIED | **TRUSTED** (D-042) | Operationally closed. Regression script available for periodic checks. |
| **WS1-D** | DEPLOYED + VERIFIED | **TRUSTED** (D-053) | Operationally closed. EVALUATED (D-050) → REGRESSION PROTECTED (D-052) → TRUSTED (D-053). RC-002 covers Development count. Deletion-handling gap deferred to WS3 (D-048). |

---

## Deploy Pack — Shipped

All three changes deployed as a single deployment on 2026-05-20:

| Change | File | Build Loop | Deployed | Evaluated |
|--------|------|-----------|----------|-----------|
| ccBucket() null → CC (Incidents) | `kpi-pipeline.ts` | Loop 02 | ✅ | ✅ PASS |
| Emission guard tightened | `kpi-pipeline.ts` | Loop 02 | ✅ | ✅ PASS |
| `customfield_14046` added to ALL_FIELDS | `jira-sync-service.ts` | Loop 03 | ✅ | ✅ PASS |

---

## Active Workstreams

| Workstream | Focus | State | Current Loop |
|------------|-------|-------|--------------|
| WS1 | Source-of-truth validation | **TRUSTED — OPERATIONALLY CLOSED** | WS1-A/B/C TRUSTED (D-042). WS1-D TRUSTED (D-053). Entire workstream closed. |
| WS2 | Calculation validation | PARKED (PARTIAL) | WS2-A TRUSTED (D-108). WS2-B-1 CSAT runtime pending. WS2-B-2 operational survey setup. WS2-C 1st Line slice TRUSTED (D-128). FCR decision and Bug Ack remain parked. |
| WS3 | SQL and snapshot integrity | ACTIVE | WS3-A batch-fix deployment verification |
| WS4 | n8n workflow integrity | PARTIALLY CLOSED | WS4-A and WS4-B complete. Shared-authority `dbo.Agent` dependency documented; optional WS4-C new-agent automation gap only. |
| WS5 | **Surface divergence recovery** | **TRUSTED — OPERATIONALLY CLOSED** | Loop 01–12 (D-054–D-091). WS5-A population-path: TRUSTED (D-072). WS5-B SLA-definition alignment: TRUSTED (D-089). Both sub-slices fully trusted. G-009+G-011 fully resolved. |
| WS6 | Evidence/report parity | QUEUED | — |

---

## Human Decision Requests

| ID | Question | For | Status |
|----|----------|-----|--------|
| HDR-1 | Development backlog definition | Nick | **RESOLVED** — every ticket where `current_tier = Development` (D-035) |
| HDR-2 | FRT field identity | Jira Admin | **RESOLVED** (D-017) |
| HDR-3 | n8n v4 Development JQL inspection | n8n Owner / Nick | **STILL PENDING** |
| HDR-4 | How should 10 "Escalations" tier tickets be governed? | Nick | **NEW** (D-024) |

---

## Critical KPI Trust Board

| KPI Domain | Priority | Trust State | Status |
|------------|----------|-------------|--------|
| Ghost KPI suppression | P0 | **TRUSTED** | Emission guard working. 3 consecutive clean regression runs. Promoted D-042. |
| Resolution SLA metrics | P0 | **TRUSTED** | ~66% compliance (organic drift). 3 consecutive clean regression runs. Promoted D-042. |
| FRT metrics (4 global + 14 per-tier) | P0 | **TRUSTED** | ~68% compliance, 7/7 tiers show breaches. 3 consecutive clean regression runs. Promoted D-042. |
| Development backlog count | P0 | **TRUSTED** (D-053) | EVALUATED → REGRESSION PROTECTED (D-052) → TRUSTED (D-053). RC-002 covers Development count. 3+ clean runs with RC-002 PASS. Deletion-handling gap deferred to WS3 (D-048). |

---

## Multi-Surface Divergence Register

| Gap | Surface A | Surface B | Classification | Status |
|-----|----------|----------|----------------|--------|
| G-009 | Dashboard SLA Breached=103 | Breach Board=0 | Calculation defect (wallboard logic) | **FULLY RESOLVED** — WS5-A TRUSTED (D-072), WS5-B TRUSTED (D-089). Both population-path and SLA-definition aligned. |
| G-010 | Dashboard Dev=275 | Wallboard Dev=292 | Presentation design (intentional Dev+T3 sum) | **RESOLVED** — 292 = Dev(275) + T3(17) via `sumKpis` |
| G-011 | Dashboard Oldest Dev=197d | Breach Board Worst Oldest=76d | Calculation defect (different definition) | **FULLY RESOLVED** — WS5-A TRUSTED (D-072, WORST OLDEST recovered 76d→198d), WS5-B TRUSTED (D-089). SLA-definition component trusted. |
| G-012 | Dashboard FRT=100% | Trends FRT MTD=69.3% | Data defect (G-004) + source staleness | PARTIALLY ADDRESSED — Dashboard now 68% |
| G-013 | Dashboard Open=557 | Trends Queue=477 | Source divergence (stale n8n) | OPEN |
| G-014 | Key Accts/CS wallboards | 12+ hours stale | Workflow defect (cache refresh) | **FULLY RESOLVED** — 24/7 refresh deployed and runtime-verified |
| G-015 | Breach Board TOTAL=88, RED=36 | Ghost inflation | **RESOLVED** — ghost suppression deployed |

---

## Evaluation State

| Slice | Stage | Brief | Status |
|-------|-------|-------|--------|
| WS1-A + WS1-B + WS1-C | **Stage 4 — Convergence** | `ws1_ab_evaluator_brief_v1.md` | PASS — converged (D-022, D-026) |
| WS1-D (Dev count) | **Stage 5 — TRUSTED** | `ws1d_eval_report_01.md` | QUALIFIED PASS (D-050) → REGRESSION PROTECTED (D-052) → TRUSTED (D-053). WS1 fully closed. |
| Surface parity | Not yet scoped | — | After WS1-D cache recovery is complete |

---

## Regression Protection State

| Sub-Slice | Baseline | Script | Last Run | Status |
|-----------|----------|--------|----------|--------|
| WS1-A (BF-001, BF-004) | ✅ FROZEN | ✅ `_eval_ws1_regression.mjs` v2 | Run 01-03: PASS | **TRUSTED** (D-042) |
| WS1-B (BF-002) | ✅ FROZEN | ✅ `_eval_ws1_regression.mjs` v2 | Run 01-03: PASS | **TRUSTED** (D-042) |
| WS1-C (BF-003) | ✅ FROZEN | ✅ `_eval_ws1_regression.mjs` v2 | Run 01-03: PASS | **TRUSTED** (D-042) |
| WS1-D (via BF-001/RC-002) | ✅ FROZEN | ✅ `_eval_ws1_regression.mjs` v2 | Run 01-03 + eval: PASS | **TRUSTED** (D-053) |
| WS5-A (BF-006, BF-007, BF-008) | ✅ FROZEN | ✅ `ws5a_regression_check.mjs` | Run 01-03: PASS (3/3) | **TRUSTED** (D-072) |
| WS5-B (BF-009, BF-010) | ✅ FROZEN | ✅ `ws5b_regression_check.mjs` | Run 01-03: PASS (2/2) | **TRUSTED** (D-089) |

---

## Next Actions

| # | Action | Type | Owner | Status |
|---|--------|------|-------|--------|
| NA-14 | ~~Freeze baselines~~ | ~~Regression~~ | ~~Manager Agent~~ | ✅ DONE (D-027) |
| NA-15 | ~~Write regression script~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — `_eval_ws1_regression.mjs` v2 |
| NA-16 | ~~Run first regression check~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — Run 01 PASS (6/6) |
| NA-17 | ~~Promote WS1-A/B/C to REGRESSION PROTECTED~~ | ~~Promotion~~ | ~~Manager Agent~~ | ✅ DONE (D-032) |
| NA-18 | ~~Accumulate consecutive clean regression runs toward TRUSTED~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — 3/3 clean runs. TRUSTED granted (D-042). |
| NA-19 | Store `kpi_sql_password` in settings | Hardening | Nick | OPTIONAL — not blocking (D-028) |
| NA-20 | Optional: trigger manual fullSync for FRT coverage | Hardening | Nick | OPTIONAL |
| NA-21 | Optional: clean 14 stale ghost rows | Hardening | Nick / Build Agent | OPTIONAL |
| NA-22 | ~~Scope WS1-D Development backlog alignment~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — Loop 08 (D-037, D-038, D-039, D-040, D-041) |
| NA-23 | ~~Continue consecutive regression accumulation toward TRUSTED~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — Run 03 PASS. TRUSTED granted (D-042). |
| NA-24 | ~~WS1-D verification: cross-check pipeline Dev count against live Jira JQL~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ DONE — qualified pass; stale deleted tickets confirmed by spot-check |
| NA-25 | Optional: review wallboard "Development — Active Tickets" label for clarity | Presentation | Nick | OPTIONAL — label currently implies Dev-only but shows Dev+T3 |
| NA-26 | ~~Scope bounded WS1-D cache-freshness recovery~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — Loop 10 complete. Build brief routed (D-045, D-046, D-047, D-048). |
| NA-27 | ~~Execute WS1-D cache cleanup: DELETE 47 stale keys + verify parity~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — 46 rows deleted, parity within 1 ticket (ws1d_cache_recovery_report_loop02.md) |
| NA-28 | ~~After cleanup: promote WS1-D to SOURCE DEFINED if D-046 evidence met~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — D-049: WS1-D promoted to SOURCE DEFINED |
| NA-29 | Log WS3 input: permanent reconciliation fix for deletion handling | Programme | Manager Agent | LOGGED — D-048 deferred to WS3 activation |
| NA-30 | ~~WS1-D independent evaluation~~ | ~~Evaluation~~ | ~~Evaluator Agent~~ | ✅ DONE — QUALIFIED PASS (ws1d_eval_report_01.md). Promoted to EVALUATED (D-050). |
| NA-31 | ~~WS1-D regression protection + TRUSTED promotion~~ | ~~Promotion~~ | ~~Manager Agent~~ | ✅ DONE — D-052 (REGRESSION PROTECTED), D-053 (TRUSTED). WS1 fully closed. |
| NA-32 | ~~WS5 activation + first discovery loop~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — WS5 renamed, activated, 5 gaps triaged, first slice scoped (D-054–D-058). |
| NA-33 | ~~WS5 Build Discovery: inspect breach board endpoint + `dbo.Agent` dependency~~ | ~~Discovery~~ | ~~Build Agent~~ | ✅ DONE — discovery + build complete (ws5_breach_board_fix_report_loop02.md) |
| NA-34 | ~~After NA-33: decide repoint feasibility~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — split into WS5-A (population-path, build complete) + WS5-B (SLA-definition, new slice) (D-059) |
| NA-35 | ~~G-014 fix: widen `wallboard-live-cache.ts` refresh window~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — deployed and runtime-verified PASS |
| NA-36 | ~~Deploy WS5-A~~ | ~~Deploy~~ | ~~Nick~~ | ✅ DONE — deployed as commit `6072c74` in prod HEAD `6c70d66` |
| NA-37 | ~~Runtime verification RV-1 through RV-4~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ DONE — 3 PASS, 1 INCONCLUSIVE non-blocking (D-063, D-064) |
| NA-38 | ~~Scope WS5-B SLA-definition alignment slice~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — WS5-B scoped (Loop 08, D-073–D-077) |
| NA-39 | ~~G-014 runtime verification (independent of WS5-A/B)~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ DONE — PASS, both wallboards fresh, no stale warning |
| NA-40 | ~~WS5-A independent evaluation~~ | ~~Evaluation~~ | ~~Evaluator Agent~~ | ✅ DONE — PASS (ws5a_eval_report_01.md). Promoted to EVALUATED (D-066). |
| NA-41 | Fix NSSM log capture (operational) | Infrastructure | Nick | OPTIONAL — benefits all workstreams (D-064) |
| NA-42 | ~~WS5-A regression protection: freeze BF-006–BF-008, define RC-007–RC-009, execute first run~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — baselines frozen, checks defined, Run 01 PASS (3/3). Promoted to REGRESSION PROTECTED (D-069). |
| NA-43 | ~~Accumulate ≥3 consecutive clean WS5-A regression runs toward TRUSTED~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — Run 01-03 PASS. TRUSTED granted (D-072). |
| NA-44 | ~~Scope WS5-B SLA-definition alignment slice~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — WS5-B scoped (D-073–D-077). Build brief produced. |
| NA-45 | ~~Execute WS5-B build: restructure `refreshAllAgentMetrics()` SLA logic~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — ws5b_build_report_loop01.md |
| NA-46 | ~~WS5-B runtime verification (RV-5 through RV-8)~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ DONE — ws5b_runtime_verification_report_loop02.md |
| NA-47 | ~~WS5-B promotion to SOURCE DEFINED~~ | ~~Promotion~~ | ~~Manager Agent~~ | ✅ DONE — D-078 (Loop 09) |
| NA-48 | ~~WS5-B independent evaluation~~ | ~~Evaluation~~ | ~~Evaluator Agent~~ | ✅ DONE — QUALIFIED PASS (ws5b_eval_report_01.md). Promoted to EVALUATED (D-082). |
| NA-49 | ~~After NA-48: WS5-B regression protection + TRUSTED lifecycle~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — D-082 (EVALUATED), D-084 (regression protection next). Superseded by NA-50. |
| NA-50 | ~~WS5-B regression protection: freeze BF-009–BF-010, define RC-010–RC-011, execute first run~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — BF-009/010 frozen, RC-010/011 defined, Run 01 PASS (2/2). Promoted to REGRESSION PROTECTED (D-086). |
| NA-51 | ~~Accumulate ≥3 consecutive clean runs toward WS5-B TRUSTED~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — Run 01, 02, 03 all PASS (2/2). Zero drift. |
| NA-52 | ~~After NA-51: promote WS5-B to TRUSTED (TG-9–TG-12 gate review)~~ | ~~Promotion~~ | ~~Manager Agent~~ | ✅ DONE — D-089: WS5-B promoted to TRUSTED. WS5 operationally closed. |
| NA-53 | ~~Activate WS2 (Calculation validation)~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — WS2 activated as next governed focus (D-093) |
| NA-54 | ~~Execute WS2-A build validation loop for escalation / rejection KPIs~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — bounded defect confirmed in `escalation_log` population path |
| NA-55 | ~~After NA-54: decide whether WS2-A is no-defect, bounded-fix, or definition-blocked~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — bounded sync-path correction build routed (D-096, D-097) |
| NA-56 | Keep WS2 scope isolated from CSAT, derived KPIs, and agent-level expansion until WS2-A is classified | Programme | Manager Agent | ACTIVE CONSTRAINT |
| NA-57 | ~~Execute WS2-A correction build: add automatic tier-change logging + bidirectional recording~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — surgical fix complete, compile clean |
| NA-58 | ~~Runtime-verify WS2-A: sync-path logging, bidirectional recording, KPI unblocking, and no regressions~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ PARTIAL — forward path proven live; backfill branch exposed separate bounded gap |
| NA-59 | ~~After final WS2-A runtime verification: decide whether WS2-A is ready for SOURCE DEFINED or needs any remaining evidence~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — WS2-A promoted to SOURCE DEFINED (D-101) |
| NA-60 | ~~Deploy backfill fix commit `459cd17`~~ | ~~Deploy~~ | ~~Nick~~ | ✅ DONE |
| NA-61 | ~~Re-run 90-day escalation backfill after deploy~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — historical population now working |
| NA-62 | ~~Complete WS2-A runtime verification with forward-path proof + historical population proof + no regressions~~ | ~~Verification~~ | ~~Build Agent~~ | ✅ DONE — KPI family unblocked from structural zero |
| NA-63 | ~~Execute WS2-A independent evaluation~~ | ~~Evaluation~~ | ~~Evaluator Agent~~ | ✅ DONE — QUALIFIED PASS |
| NA-64 | ~~After NA-63: decide whether WS2-A promotes to EVALUATED or needs one bounded correction~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — promoted to EVALUATED (D-104) |
| NA-65 | ~~Freeze WS2-A regression baselines and define protection checks~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — BF-011/012 + RC-011–014 frozen and executable |
| NA-66 | ~~After NA-65: run first WS2-A regression protection check and decide REGRESSION PROTECTED promotion~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — promoted to REGRESSION PROTECTED (D-106) |
| NA-67 | ~~Accumulate WS2-A regression Run 02 and Run 03 toward TRUSTED~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — Run 02 and Run 03 PASS with zero drift |
| NA-68 | ~~After NA-67: review trust gate and decide WS2-A TRUSTED promotion~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — promoted to TRUSTED (D-108) |
| NA-69 | Add `kpi_sql_password` to DB-backed settings path or equivalent governed config surface | Hardening | Nick / Build Agent | OPTIONAL — improves future regression tooling (D-109) |
| NA-70 | ~~Execute WS2-B satisfaction-family validation loop~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — CSAT code defect isolated; KAM/CSM classified operational |
| NA-71 | ~~After NA-70: decide whether satisfaction metrics are one remediation slice or need splitting~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — split into WS2-B-1 and WS2-B-2 (D-111) |
| NA-72 | ~~Execute WS2-B-1 CSAT field-whitelist fix~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — one-line whitelist fix complete, compile clean |
| NA-73 | Create KAM/CSM surveys in Admin so satisfaction metrics have real source data | Operational | Nick | READY |
| NA-74 | Deploy WS2-B-1, run full Jira re-sync, and verify CSAT runtime behaviour | Verification | Build Agent / Nick | READY |
| NA-75 | ~~Execute WS2-C derived KPI validation loop in parallel with CSAT runtime wait~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — family is active; observability gap confirmed |
| NA-76 | ~~Execute WS2-C-FIX-01 derived KPI observability recovery~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — logging + manual trigger added, compile clean |
| NA-77 | ~~Deploy WS2-C-FIX-01 and verify observability/runtime trigger behaviour~~ | ~~Verification~~ | ~~Build Agent / Nick~~ | ✅ DONE — manual trigger verified on prod; derived KPI execution visible |
| NA-78 | ~~Execute WS2-C-FIX-02 1st Line Resolution formula correction~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — one-line formula correction complete |
| NA-79 | FCR definition decision: choose proxy improvement vs new metric basis vs park | Decision | Nick / Manager Agent | READY |
| NA-80 | Bug Ack Time redesign / deferment classification | Programme | Manager Agent | PARKED |
| NA-81 | ~~Deploy WS2-C-FIX-02 and verify corrected 1st Line Resolution behaviour~~ | ~~Verification~~ | ~~Build Agent / Nick~~ | ✅ DONE — PASS, ready for SOURCE DEFINED |
| NA-82 | ~~Execute independent evaluation for 1st Line Resolution Rate %~~ | ~~Evaluation~~ | ~~Evaluator Agent~~ | ✅ DONE — PASS |
| NA-83 | ~~Freeze 1st Line Resolution baseline and run first regression protection check~~ | ~~Build~~ | ~~Build Agent~~ | ✅ DONE — BF-013 frozen, Run 01 PASS 5/5 |
| NA-84 | ~~Accumulate 1st Line Resolution regression Run 02 and Run 03 toward TRUSTED~~ | ~~Regression~~ | ~~Build Agent~~ | ✅ DONE — Run 02 and Run 03 PASS with zero drift |
| NA-85 | ~~After NA-84: review trust gate and decide 1st Line Resolution TRUSTED promotion~~ | ~~Programme~~ | ~~Manager Agent~~ | ✅ DONE — promoted to TRUSTED (D-128) |
| NA-86 | Complete WS2-B-1 CSAT runtime verification after re-sync settles | Verification | Build Agent / Nick | READY |
| NA-87 | Decide FCR metric direction: improve proxy, redefine, or park | Decision | Nick / Manager Agent | READY |
| NA-88 | Execute WS3-A cache deletion reconciliation validation | Build | Build Agent | ✅ DONE — bounded fix shape confirmed |
| NA-89 | Execute WS4-A n8n evidence-path validation | Build | Build Agent | READY |
| NA-90 | Execute WS3-A bounded reconciliation implementation build | Build | Build Agent | ✅ DONE — compile clean, bounded fix complete |
| NA-91 | Execute WS4-B agent roster dependency classification | Build | Build Agent | ✅ DONE — keep/document decision, no migration needed |
| NA-92 | Deploy WS3-A and execute runtime verification | Verification | Build Agent / Nick | ✅ DONE — sweep proven, no regression |
| NA-93 | Optional: scope WS4-C new-agent automation if n8n roster creation is to be removed | Programme | Manager Agent | PARKED |
| NA-94 | Deploy commit `e647670` and verify automatic WS3-A batch-safe sweep behaviour | Verification | Build Agent / Nick | READY |
| NA-95 | After WS3-A hardening, run a narrow baseline integrity audit (Jira vs cache vs KPI output) before resuming broad KPI recovery | Programme | Manager Agent / Build Agent | READY |

---

## Promotion Rule

No KPI domain may be promoted beyond `UNTRUSTED` until:
- the source hierarchy is explicit
- the calculation rule is written
- the evidence path is defined

No KPI domain may be marked `TRUSTED` until:
- independent evaluation passes
- regression protection exists

**SOURCE DEFINED** is an intermediate state (D-014) indicating verified source without independent evaluation.

**EVALUATED** is an intermediate state (D-023) indicating independent evaluation passed without regression protection.

---

## Change Log

| Date | Update |
|------|--------|
| 2026-05-20 | Initial KPI recovery programme scaffold created |
| 2026-05-20 | WS1 Loop 01: P0 slice scoped, inventory populated, lineage traced, architecture mapped. |
| 2026-05-20 | WS1 Build Loop 01: Diagnostics — FRT absent, Resolution SLA present, CC null RT confirmed. |
| 2026-05-20 | WS1 Manager Loop 02: Post-diagnostic governance. Decisions D-008–D-012. |
| 2026-05-20 | WS1 Build Loop 02: Ghost suppression built. Resolution SLA verified 8/8. FRT root cause discovered (field omission). |
| 2026-05-20 | WS1 Manager Loop 03: WS1 split into A/B/C/D. Resolution SLA → SOURCE DEFINED. First evaluator brief created. FRT build scoped. |
| 2026-05-20 | WS1 Build Loop 03: FRT field added to ALL_FIELDS. Parser confirmed. Simulated compliance ~72.3%. |
| 2026-05-20 | WS1 Manager Loop 04: All builds complete. Deploy pack ready. Multi-surface divergence captured (G-009–G-015, KF-015–KF-020). FRT SOURCE DEFINED pending runtime (D-018). Surface parity scoped as next focus (D-020). Single deployment decision (D-021). |
| 2026-05-20 | WS1 Build Loop 04: Deployed + verified. FRT 100→68%. CC (Incidents) 30→91. Ghost emission guard working (14 stale MERGE artifacts, clean tomorrow). Resolution SLA stable 81%. All promotion criteria met for WS1-C → SOURCE DEFINED. |
| 2026-05-20 | WS1 Manager Loop 05: Post-evaluation convergence. WS1-A/B/C → EVALUATED (D-023). Converged with non-blocking hardening items (D-022). Regression protection planned. Escalations tier deferred (D-024). Next focus: regression protection → surface divergence (D-025). |
| 2026-05-20 | WS1 Manager Loop 06: Regression protection activation. Baselines frozen (BF-001–005, D-027). 6 regression checks defined (RC-001–006). No hardening items block protection (D-029). Promotion gate = 1 clean run (D-030). Build execution brief routed. |
| 2026-05-20 | WS1 Build Loop 05: Regression script created (`_eval_ws1_regression.mjs` v2). Run 01 executed — PASS (6/6). All promotion gate conditions met. |
| 2026-05-20 | WS1 Manager Loop 07: Promotion granted. WS1-A/B/C → REGRESSION PROTECTED (D-032). TRUSTED gate defined, later clarified to ≥3 consecutive clean regression runs (D-033, D-036). Next focus: regression accumulation + WS1-D or surface divergence (D-034). |
| 2026-05-20 | TRUSTED gate updated: calendar-day separation is no longer required. Same-day completion is valid if clean runs are consecutive, against fresh runtime states, and no code changes occur between runs (D-033, D-036). |
| 2026-05-20 | HDR-1 resolved by direct business decision: Development backlog includes every ticket where `current_tier = Development` (D-035). WS1-D unblocked and becomes the next governed recovery slice while daily regression accumulation continues. |
| 2026-05-20 | WS1 Manager Loop 08 (WS1-D activation): Pipeline already matches governed definition — no code change needed. G-010 resolved (wallboard 292 = Dev+T3 intentional sum). G-003 reclassified: pipeline aligned, n8n/JSM non-authoritative comparators. Verification build brief routed (Jira cross-check). Decisions D-037–D-041. |
| 2026-05-20 | WS1 Manager Loop 09 (TRUSTED promotion): 3 consecutive clean regression runs (Run 01-03, all PASS 6/6). All four trust gate conditions met (TG-1 through TG-4). WS1-A/B/C promoted to TRUSTED (D-042). WS1 operationally closed except WS1-D (verification phase). Next governed focus: WS1-D verification + multi-surface divergence recovery (D-043). |
| 2026-05-20 | WS1-D verification spot-check resolved ambiguity: discrepant tickets `NT-543`, `NT-626`, and `NT-18099` are deleted in Jira. WS1-D now classified as a bounded cache-freshness recovery problem rather than a definition or permission problem (D-044). |
| 2026-05-20 | WS1 Manager Loop 10 (WS1-D cache recovery): Root cause confirmed — `jira-sync-service.ts` has no deletion handling (fullSync/incrementalSync only upsert, never DELETE). Recovery scoped as targeted DELETE of 47 stale keys (D-045). Promotion evidence defined (D-046: 5 items). Scope kept within WS1 (D-047). Permanent reconciliation fix logged as WS3 input (D-048). New gap G-017 classified. Build brief routed: `ws1d_build_brief_loop02_cache_recovery.md`. |
| 2026-05-20 | WS1-D Build Loop 02 (cache cleanup): 46 stale rows deleted from `jira_issue_cache`. Post-cleanup Development count 232 vs live Jira 231 (diff: 1, within ≤5 tolerance). All regression checks PASS (6/6). All D-046 evidence satisfied. |
| 2026-05-20 | WS1 Manager Loop 11 (WS1-D promotion): All D-046 criteria met. No blockers. WS1-D promoted from UNTRUSTED to SOURCE DEFINED (D-049). G-017 resolved (point-in-time). Next lifecycle step: independent evaluation. |
| 2026-05-20 | WS1-D Evaluation: Independent evaluator returned QUALIFIED PASS. Pipeline 232 vs live Jira 231 (diff: 1). RC-001–RC-003 PASS. RC-004–RC-006 timed out (MSSQL infra, not WS1-D related). Qualification: deletion-handling gap, already deferred to WS3 (D-048). |
| 2026-05-20 | WS1 Manager Loop 12 (WS1-D evaluated): Qualification classified NON-BLOCKING. All five promotion criteria met. WS1-D promoted from SOURCE DEFINED to EVALUATED (D-050). RC-002 already covers Development count — no regression addendum needed (D-051). All WS1 sub-slices now through evaluation. Next: REGRESSION PROTECTED promotion. |
| 2026-05-20 | WS1 Manager Loop 13 (WS1-D trusted): All PG-1–PG-5 gate conditions met. WS1-D promoted to REGRESSION PROTECTED (D-052). Existing runs 01-03 all include RC-002 PASS covering Development count post-cache-recovery. All TG-1–TG-4 conditions met. WS1-D promoted to TRUSTED (D-053). WS1 is now fully TRUSTED across all four sub-slices and operationally closed. |
| 2026-05-20 | WS5 Manager Loop 01 (surface divergence activation): WS5 renamed from "Grafana Reporting Parity" to "Surface Divergence Recovery" (D-054). 5 open gaps triaged: G-009+G-011 selected as first slice (D-055, data-source alignment). G-012 reclassified to MONITORING (D-057). G-013 reclassified as presentation design (D-058). G-014 root cause confirmed (business-hours cache). Architecture map extended with per-surface data-source boundaries. Data lineage map extended (LIN-005, LIN-006, LIN-007). Build discovery brief routed for breach board inspection. |
| 2026-05-20 | WS5 Build Loop 02 (breach board population fix): Three bounded fixes in `refreshAllAgentMetrics()`: Development tier added to all 3 query filters, OldestTicketKey populated via correlated subquery, AccountId match observability logging added. SLA-definition difference documented (customfield_10010 vs customfield_14048) but not changed. TypeScript compiles clean. Single file changed. |
| 2026-05-20 | WS5 Manager Loop 03 (post-build governance): Build verified. Slice split into WS5-A (population-path, build complete) and WS5-B (SLA-definition alignment, new slice) (D-059). WS5-A ready for deploy/runtime verification (D-060). Runtime verification scope defined: RV-1 through RV-4 (D-061). WS5-B scoping deferred to after WS5-A RV (D-062). Decisions D-059–D-062. |
| 2026-05-20 | WS5 Build Loop 03 (runtime verification): Deployed commit `6072c74` verified in prod HEAD `6c70d66`. RV-1 PASS (Development agents visible, open counts jumped e.g. 18→32). RV-2 PASS (14/14 OldestTicketKey populated). RV-3 INCONCLUSIVE (NSSM log capture broken, indirect evidence confirms 14 agents matched). RV-4 PASS (WORST OLDEST 76d→198d, matching dashboard 197d). |
| 2026-05-20 | WS5 Manager Loop 04 (WS5-A source defined): RV-3 classified NON-BLOCKING — infrastructure issue, not code correctness (D-064). All promotion criteria met. WS5-A promoted to SOURCE DEFINED (D-063). Next lifecycle step: independent evaluation (D-065, NA-40). WS5-B unchanged, NA-38 now READY. Decisions D-063–D-065. |
| 2026-05-20 | WS5 Manager Loop 05 (WS5-A evaluated): Independent evaluation returned clean PASS (ws5a_eval_report_01.md). All three behavioural objectives verified against live production data. No WS1 regression. Logging residual reconfirmed NON-BLOCKING (D-067). WS5-A promoted to EVALUATED (D-066). Next lifecycle step: regression protection (D-068, NA-42). WS5-B unchanged. Decisions D-066–D-068. |
| 2026-05-20 | WS5 Manager Loop 06 (WS5-A regression protected): All PG-6–PG-10 gate conditions met. Baselines BF-006–BF-008 frozen. Regression checks RC-007–RC-009 defined and executable. Run 01 PASS (3/3). No new blocking gaps. WS5-A promoted to REGRESSION PROTECTED (D-069). TRUSTED gate defined: TG-5–TG-8, ≥3 consecutive clean runs (D-070). WS5-A protection independent of WS5-B (D-071). Decisions D-069–D-071. |
| 2026-05-20 | WS5 Manager Loop 07 (WS5-A trusted): Runs 01–03 all PASS (3/3) with zero drift. All TG-5–TG-8 conditions met. WS5-A promoted to TRUSTED (D-072). WS5-B remains isolated as the next unresolved WS5 slice. |
| 2026-05-20 | WS5 Manager Loop 08 (WS5-B scoping): WS5-B problem statement defined (D-073). Root cause: `sla_breached` column uses dead `customfield_10010`, always false. Fix shape: restructure `refreshAllAgentMetrics()` to parse `fields_json` with trusted `isSlaBreached()` (D-075). Status/due_date filters retained for operational meaning (D-076). Dead code cleanup deferred to WS3 (D-077). Bounded implementation next (D-074). Build brief produced: `ws5b_build_brief_loop01.md`. Decisions D-073–D-077. |
| 2026-05-21 | WS5 Manager Loop 09 (WS5-B source defined): All runtime verification checks pass (RV-5 PASS, RV-6 QUALIFIED PASS, RV-7 PASS, RV-8 PASS). RV-6 qualification classified NON-BLOCKING — 17 vs 188 explained by approved operational filters (D-076, D-079). WS5-B promoted to SOURCE DEFINED (D-078). WS5 now fully through source-definition: WS5-A TRUSTED (D-072), WS5-B SOURCE DEFINED (D-078). Next lifecycle step: independent evaluation (D-080, NA-48). Decisions D-078–D-081. |
| 2026-05-21 | WS5 Manager Loop 10 (WS5-B evaluated): Independent evaluation returned QUALIFIED PASS (ws5b_eval_report_01.md). Qualification (69% due_date filter exclusion) classified NON-BLOCKING (D-083) — operational design characteristic per D-076. All four promotion criteria met. WS5-B promoted to EVALUATED (D-082). WS5 now fully through evaluation: WS5-A TRUSTED (D-072), WS5-B EVALUATED (D-082). Next lifecycle step: regression protection (D-084, NA-50). Decisions D-082–D-085. |
| 2026-05-21 | WS5 Manager Loop 11 (WS5-B regression protected): All PG-11–PG-15 gate conditions met. Baselines BF-009–BF-010 frozen. RC-010–RC-011 defined and executable. Run 01 PASS (2/2). No new blocking gaps. WS5-B promoted to REGRESSION PROTECTED (D-086). TRUSTED gate defined: TG-9–TG-12, ≥3 consecutive clean runs (D-087). WS5 now fully regression-protected: WS5-A TRUSTED (D-072), WS5-B REGRESSION PROTECTED (D-086, D-088). Next: accumulate runs toward TRUSTED (NA-51). Decisions D-086–D-088. |
| 2026-05-21 | WS5 Manager Loop 12 (WS5-B trusted): Runs 01–03 all PASS (2/2) with zero drift. All TG-9–TG-12 conditions met. WS5-B promoted to TRUSTED (D-089). WS5 fully TRUSTED across both sub-slices (D-090) and operationally closed. G-009 and G-011 fully resolved. Next programme focus: G-014 fix (NA-35), then WS2 activation (NA-53, D-091). Decisions D-089–D-091. |
| 2026-05-21 | G-014 runtime close-out: wallboard cache refresh fix deployed and runtime verification updated to PASS. Both Key Accounts and Customer Success wallboards now show fresh data with no stale warning. G-014 fully resolved (D-092). |
| 2026-05-21 | WS2 activated as the next governed focus (D-093). WS1 and WS5 are fully trusted and closed; calculation validation is now the active workstream. |
| 2026-05-21 | WS2 Loop 01 scoped directly: first slice is escalation / rejection count calculation validation (D-094). A tight build-side validation prompt is ready (D-095) so the next handoff is bounded and actionable rather than another broad discovery loop. |
| 2026-05-21 | WS2-A validation complete: the all-zero escalation / rejection KPIs are structurally broken because `escalation_log` has no automatic population path and historical backfill excludes downward tier changes. A direct correction build is now routed (D-096, D-097). |
| 2026-05-21 | WS2-A correction build complete: automatic sync-path tier-change logging added and upward-only backfill restriction removed. Runtime verification is the next step (D-098). |
| 2026-05-21 | WS2-A partial runtime verification: forward path confirmed live in production (`source='jira_sync'` rows present). Historical backfill exposed one additional bounded issue: changelog parsing must read Current Tier (`customfield_12981`) instead of relying primarily on status-pattern mapping. Follow-up fix prepared in commit `459cd17`; next step is deploy + rerun backfill + final runtime verification (D-099, D-100). |
| 2026-05-21 | WS2-A final runtime verification: deployed backfill fix restored historical population and confirmed the KPI family is no longer structurally zero. 1,254 total escalation-log records now exist across live sync, historical backfill, and AI sources; both upward escalations and downward rejections are present; current-day KPI values are non-zero. WS2-A promoted to SOURCE DEFINED (D-101). Evaluation is next (D-102). |
| 2026-05-21 | WS2-A independent evaluation returned QUALIFIED PASS. Non-zero escalation / rejection behaviour is restored, rejection behaviour exists, and Escalation Accuracy % is now real. Qualifications are non-blocking. WS2-A promoted to EVALUATED (D-104) and moves directly into regression protection (D-105). |
| 2026-05-21 | WS2-A regression protection activated and satisfied in one pass: BF-011 and BF-012 frozen, RC-011–RC-014 defined, Run 01 PASS (4/4). WS2-A promoted to REGRESSION PROTECTED (D-106). Next step is trust-run accumulation (D-107). |
| 2026-05-21 | WS2-A trust promotion: Run 01, Run 02, and Run 03 all PASS with zero drift across escalation activity, rejection behaviour, Escalation Accuracy, and cross-regression guard metrics. WS2-A promoted to TRUSTED (D-108). A non-blocking config hardening follow-up was logged for `kpi_sql_password` settings availability (D-109). |
| 2026-05-21 | WS2-B activated as the next calculation-validation slice: satisfaction-family metrics (`CSAT %`, `KAM Satisfaction`, `CSM Satisfaction`). A tight build-side validation prompt is ready so the next handoff stays bounded and source-focused (D-110). |
| 2026-05-21 | WS2-B validation complete: `CSAT %` is a real code defect caused by missing Jira field `customfield_12802` in the sync whitelist; `KAM Satisfaction` and `CSM Satisfaction` are not broken in code and simply have no survey source data yet. WS2-B splits into WS2-B-1 (tiny code fix) and WS2-B-2 (operational survey setup) (D-111, D-112). |
| 2026-05-21 | WS2-B-1 build complete: `customfield_12802` added to Jira sync `ALL_FIELDS`. Build compiles cleanly. Next step is deploy + full Jira re-sync + runtime verification of `CSAT %` (D-113). |
| 2026-05-21 | While WS2-B-1 waits on re-sync, WS2-C derived KPI validation is activated in parallel (D-114) to keep momentum without mixing source families. |
| 2026-05-21 | WS2-C validation complete: the derived KPI family is active, scheduled, and not stubbed, but current failures are obscured by silent error swallowing and weak observability. WS2-C splits to an observability-first fix before any formula changes (D-115). |
| 2026-05-21 | WS2-C-FIX-01 build complete: silent failure swallowing removed, diagnostic logging added, and manual trigger route created. Runtime verification is the next step (D-116). |
| 2026-05-21 | WS2-C-FIX-01 runtime verification complete: the derived KPI pipeline is healthy and visible in production. 1st Line Resolution (43%) and FCR (47%) execute successfully, Bug Ack returns 0 because no bug tickets resolved today, and CSAT Derived remains blocked only by the separate CSAT field issue. Next step is definition correction, not more execution fixes (D-117, D-118). |
| 2026-05-21 | WS2-C definition review complete: 1st Line Resolution is selected as the next bounded fix, FCR is held for an explicit metric decision, and Bug Ack is parked as low-value redesign work (D-119, D-120). |
| 2026-05-21 | WS2-C-FIX-02 build complete: 1st Line Resolution numerator now uses first-line tier resolution rather than Customer Care request-type share. Runtime verification is the next step (D-121). |
| 2026-05-21 | WS2-C-FIX-02 runtime verification passed: the corrected 1st Line formula is live, manual trigger succeeds, and no regressions were introduced. 1st Line Resolution Rate % is promoted to SOURCE DEFINED (D-122). Independent evaluation is next (D-123). |
| 2026-05-21 | WS2-C-FIX-02 independent evaluation passed. 1st Line Resolution Rate % is promoted to EVALUATED (D-124). The shared `jira_updated` date-filter issue remains a separate non-blocking cross-cutting defect. Regression protection is next (D-125). |
| 2026-05-21 | WS2-C-FIX-02 regression protection activated and satisfied in one pass: BF-013 frozen, RC-013a–RC-013e defined, Run 01 PASS (5/5). 1st Line Resolution Rate % is promoted to REGRESSION PROTECTED (D-126). Trust-run accumulation is next (D-127). |
| 2026-05-21 | WS2-C-FIX-02 trust promotion: Run 01, Run 02, and Run 03 all PASS with zero drift. 1st Line Resolution Rate % is promoted to TRUSTED (D-128). |
| 2026-05-21 | Remaining WS2 work is temporarily parked to keep programme pace high: WS2-B-1 waits on CSAT runtime evidence after re-sync; KAM/CSM survey setup remains operational; FCR and Bug Ack stay deferred. WS3 and WS4 are now active in parallel via WS3-A cache deletion reconciliation validation and WS4-A n8n evidence-path validation (D-129–D-132). |
| 2026-05-21 | WS3-A validation complete: all sync paths are confirmed upsert-only, no schema change is needed, and no downstream consumer depends on cache-row permanence. Approved fix shape is a guarded full-sync reconciliation sweep plus 404-driven hard delete in `syncSingleIssue()`. WS3-A now moves directly into bounded implementation (D-133, D-134). |
| 2026-05-21 | WS4-A validation complete: NOVA has already absorbed the core KPI-writing paths, so WS4 is primarily a decommission/documentation stream rather than a workflow-recovery stream. The main remaining material dependency is `dbo.Agent`; next slice is WS4-B agent roster dependency classification (D-135, D-136). |
| 2026-05-21 | WS3-A implementation complete: `jira-sync-service.ts` now performs a guarded full-sync reconciliation sweep and a 404-driven hard delete in `syncSingleIssue()`. No schema change was needed. Next step is deploy + runtime verification (D-137). |
| 2026-05-21 | WS4-B classification complete: `dbo.Agent` is a shared-authority table, not a pure n8n dependency. NOVA already owns operational metrics, synthetic seeding, AccountId backfill, and admin CRUD. No migration is needed now; only optional future gap is automated new-agent discovery if n8n roster creation is later removed (D-138, D-139). |
| 2026-05-21 | WS3-A post-deploy verification passed behaviourally: 3,488 stale rows were swept, cache dropped from 5,988 to 2,004, stale rows went to 0, Development backlog fell from 366 to 161, and no trusted KPI family regressed. A final hardening deploy of commit `e647670` is still required so future sweeps run automatically without manual batch-size correction (D-140, D-141). |
| 2026-05-21 | Full KPI parity audit returned a materially bad overall picture despite several valid local fixes. Recovery method is now reset: keep bounded proven fixes, but re-enter through substrate integrity (cache completeness, field completeness, snapshot/date semantics) before continuing broad KPI recovery (D-142). |
