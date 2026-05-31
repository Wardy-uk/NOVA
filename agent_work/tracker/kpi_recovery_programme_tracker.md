# KPI Recovery Programme Tracker

Status: Authoritative orchestration state for the clean-sheet KPI Recovery & Evidence Integrity programme.

## Programme Identity

| Field | Value |
| --- | --- |
| Programme | KPI Recovery & Evidence Integrity |
| Governance source | `C:\Users\NickW\Documents\Nicks knowledge base\Projects\Attractor Programme Methodology\NOVA_Attractor_Governance_and_Operating_Model.md` |
| Scope source | `C:\Users\NickW\Claude\windows automation\daypilot\KPI-Clean-Sheet-Design.md` |
| Orchestrator / Manager | Codex |
| Build Agent | Claude Code |
| Evaluator Agent | Separate Claude Code session |
| Human approver | Nick Ward |

## Current State

| Area | State | Notes |
| --- | --- | --- |
| Programme initialisation | Active | Top-level `agent_work` governance lane established for this programme on 2026-05-29. |
| Active phase | Phase 5 | AI digest, config admin, health monitoring, and final KPI polish. |
| Active work package | `P5-WP1` | Final clean-sheet KPI delivery slice. |
| Current convergence state | Ready For Evaluation | Build completion reviewed; independent evaluation brief prepared. |
| Scope protection | Active | No production code changes by Manager; no implementation prescription in briefs. |
| Hidden evaluator logic | Protected | Holdouts stored outside Build-readable planning artefacts. |
| Promotion gate | Eval Running | Phase 5 must now pass independent evaluation before convergence can be claimed for this slice. |

## Work Package Board

| Work Package | Goal | State | Next Step |
| --- | --- | --- | --- |
| `P0-WP1` | Confirm `jira_issue_cache` prerequisite fields and route-prefix safety | Completed — Blocked outcome | Findings reviewed by Manager; blocker closure brief required. |
| `P0-WP2` | Close prerequisite blockers for story-points coverage and KPI route namespace | Completed — Cleared outcome | Phase 0 exit achieved; findings promoted into Phase 1 inputs. |
| `P1-WP1` | Foundation delivery per clean-sheet Phase 1 | Failed Evaluation | Foundation exists in working tree but is observably inert at runtime. |
| `P1-WP1-ITER1` | Restore observable foundation activation and surfaced runtime status | Qualified Pass — Converged | Activation loop closed. Carry auth-token route exercise as non-blocking follow-on evidence only if desired. |
| `P2-WP1` | Deliver EOD and daily capture slice per clean-sheet Phase 2 | Failed Evaluation | Core freeze/write path remained unobservable in the evaluation window. |
| `P2-WP1-ITER1` | Make Phase 2 freeze/capture path directly exercisable and observable | Qualified Pass — Converged | Capture-observability loop closed. Carry auth-gated API discovery note as process guidance only. |
| `P2-RP1` | Protect the converged Phase 2 freeze/capture behaviour against regression | Qualified Pass — Regression Protected | Regression harness independently validated; optional auth-gated HTTP probe remains a bounded non-blocking gap. |
| `P3-WP1` | Deliver clean-sheet KPI views on the new data source | Qualified Pass — Converged | View surfaces and wallboards independently validated; bounded sparse-data and fallback gaps remain visible but non-blocking. |
| `P4-WP1` | Deliver manual entry UI and spreadsheet import on the clean-sheet path | Qualified Pass — Converged | Manual entry, promotion, dry-run import, and real import independently validated. |
| `P5-WP1` | Deliver AI digest, config admin, health monitoring, and final KPI polish | Ready For Evaluation | Send evaluator brief and await independent behavioural assessment. |

## Phase Gate Rules

### Phase 0 exit conditions

- `jira_issue_cache` field audit completed against the live NOVA environment.
- Findings clearly distinguish present fields from missing fields.
- Route-prefix audit confirms whether `/api/kpi/*` is collision-safe.
- Any missing prerequisite fields are explicitly classified as a blocker requiring sync extension before Phase 1.

### Phase 1 entry conditions

- Phase 0 findings reviewed by Manager.
- Any prerequisite data gaps are either cleared or formally classified as blocking.
- A Phase 1 build brief exists and remains within clean-sheet scope.

## Blockers

| ID | Status | Description |
| --- | --- | --- |
| `B0-1` | Closed | NTPJ story points confirmed as `customfield_11706`; sync exposure blocker cleared. |
| `B0-2` | Closed | `/api/kpi/*` remains viable despite existing `POST /api/kpi/derived/run`; no route-family reclassification required. |
| `B1-1` | Open phase input | NTPJ story points are now capturable but currently zero in source Jira data; this is an operational/source-data dependency, not a Phase 1 blocker. |
| `B1-2` | Open phase input | STBY currently has zero cache rows and will require sync-scope/settings alignment for meaningful Phase 1 space coverage. |
| `B1-3` | Open phase input | A sync cycle must run before newly added fields populate live cache rows. |
| `B1-4` | Open bounded gap | Roughly 14 seeded metric definitions are intentionally skipped in computation because they require changelog, comment-threading, sprint telemetry, or other pipeline inputs not delivered in Phase 1. |
| `B1-5` | Open bounded gap | Backfill is partial: delivered for `jira_kpi_daily`, `JiraEodTicketStatusSnapshot`, and retroactive cache SLA only. |
| `B1-6` | Closed | Activation blocker resolved in `P1-WP1-ITER1`; schema, seeds, snapshot registration, and surfaced init status were all observed. |
| `B1-7` | Open non-blocking evidence gap | Evaluator could not exercise authenticated `/api/kpi/*` 200-paths without a valid token. This is a bounded evidence gap, not a Phase 1 convergence blocker. |
| `B2-1` | Open phase input | Phase 2 should build on the now-live foundation and must not absorb optional auth-route evidence cleanup into core scope. |
| `B2-2` | Open bounded gap | Agent-daily outputs are intentionally limited to implemented Phase 1 agent metrics only. |
| `B2-3` | Open bounded gap | Manual/non-Jira spaces remain outside computed daily capture in this phase. |
| `B2-4` | Open bounded gap | Pause-status subtraction is still not applied because status-change history is not yet available in the cache path. |
| `B2-5` | Closed | Forced operator-facing capture trigger added for evaluation and operational catch-up; core freeze/write path is now directly exercisable on demand. |
| `B2-6` | Open non-blocking process note | The global API auth gate prevents route-existence probing without a valid token. Future evaluator briefs should name the exact KPI endpoints or provide evaluator credentials. |
| `B2-7` | Open process integrity note | Evaluator disclosed an earlier false narration caused by tool-output rendering stall; no fabricated report was written, and the final promotion relies only on the later genuine observed runs. |
| `B3-1` | Open bounded gap | No seed currently sets `show_on_wallboard = 1`, so clean-sheet wallboards use the documented fallback selection logic until later config/admin work. |
| `B3-2` | Open bounded gap | Snapshot rows are still absent across Jira spaces in the evaluated environment, so Phase 3 convergence rests on honest empty-state handling rather than populated live view values. |
| `B3-3` | Open polish note | Daily response shape differs between manual-team spaces and Jira spaces (`data:null` vs structured `captured:false` object). Honest but inconsistent. |
| `B4-1` | Open bounded phase input | Real Daily KPI Tracker workbook mapping has not yet been validated against a live file; current parser behaviour is inferred from the clean-sheet design and intended to be proven through dry-run preview. |
| `B4-2` | Open bounded gap | Real-workbook label/layout variance remains partially open: some labels map cleanly, while others are honestly reported unmapped. |
| `B4-3` | Open bounded gap | The `sheets[]` JSON import path does not currently resolve team/space the same way the xlsx path does. |
| `B4-4` | Open bounded gap | Manual-entry API currently accepts writes to Jira/computed spaces as well as manual teams; out of current scope but worth tightening later. |
| `B4-5` | Open process integrity note | An earlier FAIL report for Phase 4 was preserved as a superseded prior-session artefact because that session used a compromised/proxy-tainted runtime path. Final convergence relies only on the later clean DB-verified evaluation. |
| `B5-1` | Open phase input | Phase 5 should absorb bounded polish items from prior slices only where they naturally fit the clean-sheet admin/health/digest scope. |
| `B5-2` | Open bounded gap | n8n cut-over remains an operational sign-off item; workflow artefacts can be prepared, but live n8n remains untouched until approved. |
| `B5-3` | Open process note | Tool-channel reliability was poor during Phase 5 build; Build Agent had to verify file effects via real build artefacts rather than trusting edit confirmations. |

## Change Log

| Date | Update |
| --- | --- |
| 2026-05-29 | Tracker created. Programme set to Phase 0 prerequisite audit. Phase 0 brief routed next. |
| 2026-05-29 | `P0-WP1` findings reviewed. Phase 1 blocked on two independent prerequisites: missing NTPJ story points coverage and occupied `/api/kpi/*` namespace. Mapping-only findings for first public comment timestamp, satisfaction rating, and labels are classified as non-blocking design integration work. |
| 2026-05-29 | `P0-WP2` findings reviewed. Phase 0 cleared. NTPJ story points confirmed as `customfield_11706` and exposed via sync; `/api/kpi/*` confirmed viable; `resolutiondate` exposure gap was also closed. Phase 1 foundation is now opened as `P1-WP1`. |
| 2026-05-30 | `P1-WP1` build completion reviewed from `agent_work/build_status/p1-wp1-phase1-foundation-2026-05-29.md`. Phase 1 foundation is classified as build-complete and ready for independent evaluation with bounded residual gaps carried forward as explicit non-convergence inputs. |
| 2026-05-30 | Independent evaluation returned FAIL from `agent_work/eval_output/phase1_foundation_eval_report_2026-05-30.md`. Runtime showed no `kpi_*` schema, no seed data, no snapshot job, no live `/api/kpi/*` routes, and no surfaced init failure. Scoped recovery iteration opened as `P1-WP1-ITER1`. |
| 2026-05-30 | `P1-WP1-ITER1` build completion reviewed from `agent_work/build_status/p1-wp1-iter1-activation-recovery-2026-05-30.md`. Root cause classified as incorrect Jira-client gating plus silent success surfacing. Activation recovery complete on branch `nova-codex` at commit `9929c39`; re-evaluation opened. |
| 2026-05-30 | Re-evaluation returned QUALIFIED PASS from `agent_work/eval_output/phase1_iteration1_eval_report_2026-05-30.md`. Prior failure mode resolved: 11 `kpi_*` tables, seeded configuration, explicit ACTIVE init surfacing, snapshot job registration, and legacy non-regression all observed. Qualified only by missing evaluator access token for authenticated `/api/kpi/*` route exercise. Phase 1 is converged for its scoped foundation outcome. |
| 2026-05-30 | Manager decision: keep Phase 1 closed and carry the authenticated-route probe as a non-blocking evidence gap. Opened `P2-WP1` for the clean-sheet Phase 2 EOD and daily-capture slice. |
| 2026-05-30 | `P2-WP1` build completion reviewed from `agent_work/build_status/p2-wp1-eod-daily-2026-05-30.md`. Phase 2 slice is classified as build-complete and ready for independent evaluation with bounded residual gaps around limited agent metrics, non-Jira teams, and pause-status subtraction. |
| 2026-05-30 | Independent evaluation returned FAIL from `agent_work/eval_output/phase2_eod_daily_eval_report_2026-05-30.md`. Structural outputs around schema, seeds, STBY timezone handling, daily-report honesty, scheduler registration, and legacy non-regression all passed, but the core freeze/write path was not observable because the evaluation window was Saturday and no operator trigger existed to force capture. Scoped recovery iteration opened as `P2-WP1-ITER1`. |
| 2026-05-30 | `P2-WP1-ITER1` build completion reviewed from `agent_work/build_status/p2-wp1-iter1-capture-observability-2026-05-30.md`. Root cause classified as trigger semantics rather than freeze-path defect. Forced capture option added to the existing operator-facing trigger without changing scheduler behaviour. Re-evaluation opened. |
| 2026-05-30 | Re-evaluation returned QUALIFIED PASS from `agent_work/eval_output/phase2_iteration1_eval_report_2026-05-30.md`. Prior failure mode resolved: forced capture wrote 83 `kpi_daily`, 186 `kpi_agent_daily`, and 109 `kpi_eod_snapshot` rows on demand; daily-report reflected frozen outputs; repeated capture remained idempotent; gated scheduler did not inflate rows; legacy remained untouched. Qualified only by pre-declared bounded gaps and an auth-gate process note. Phase 2 is converged for its scoped outcome. |
| 2026-05-30 | Manager decision: open `P2-RP1` next. Regression protection will lock forced capture, idempotency, frozen-row writes, daily-report output, and legacy non-regression before Phase 3 begins. |
| 2026-05-30 | `P2-RP1` build completion reviewed from `agent_work/build_status/p2-rp1-regression-protection-2026-05-30.md`. Regression baseline and executable sentinel-date protection check created; first run PASS 9/9 and repeat pass clean. Slice is ready for independent regression evaluation. |
| 2026-05-30 | Independent regression evaluation returned QUALIFIED PASS from `agent_work/eval_output/phase2_regression_eval_report_2026-05-30.md`. Real repeated runs confirmed all 9 protected invariants: frozen writes, daily-report fidelity to frozen rows, idempotent recapture, scheduler non-inflation, teardown cleanliness, and legacy non-regression. Phase 2 is promoted to Regression Protected. Qualification limited to optional auth-gated HTTP probing and other pre-declared bounded gaps. |
| 2026-05-30 | Manager decision: open `P3-WP1` next. Phase 3 will deliver the clean-sheet KPI views on top of the now-converged and regression-protected Phase 1–2 substrate. |
| 2026-05-30 | `P3-WP1` build completion reviewed from `agent_work/build_status/p3-wp1-views-2026-05-30.md`. Phase 3 slice is classified as build-complete and ready for independent evaluation with bounded residual gaps around sparse-data handling, manual-team representation, limited agent metrics, and wallboard metric fallback. Commit `815b37a` pushed on `nova-codex`. |
| 2026-05-30 | Independent evaluation returned QUALIFIED PASS from `agent_work/eval_output/phase3_views_eval_report_2026-05-30.md`. SLT, team, agent, and wallboard surfaces were all observed and clean-sheet-backed; manual/non-Jira and sparse spaces were handled honestly; legacy coexistence was decisively preserved. Qualifications limited to sparse live snapshot data, wallboard fallback visibility, and a minor response-shape inconsistency. Phase 3 is converged for its scoped outcome. |
| 2026-05-30 | Manager decision: open `P4-WP1` next. Phase 4 will deliver manual entry and Daily KPI Tracker import on top of the converged Phase 1–3 substrate. |
| 2026-05-30 | `P4-WP1` build completion reviewed from `agent_work/build_status/p4-wp1-manual-import-2026-05-30.md`. Phase 4 slice is classified as build-complete and ready for independent evaluation with bounded residual risk around live-workbook label/layout validation. |
| 2026-05-30 | A prior FAIL evaluation for Phase 4 was preserved as `agent_work/eval_output/phase4_manual_import_eval_report_2026-05-30_SUPERSEDED_prior-session.md` after later evidence showed that session relied on a compromised/proxy-tainted runtime path. |
| 2026-05-30 | Clean follow-up evaluation returned QUALIFIED PASS from `agent_work/eval_output/phase4_manual_import_eval_report_2026-05-30.md`. Manual entry exists for all scoped teams, any-date edit works, prefill is correct, validation is enforced, valid saves persist to `kpi_manual_entries` and promote to `kpi_daily`, dry-run and real import behave honestly, and legacy remains untouched. Phase 4 is converged for its scoped outcome. |
| 2026-05-30 | Manager decision: open `P5-WP1` next. Phase 5 will deliver AI digests, config admin, health monitoring, and final clean-sheet KPI polish on top of the converged Phase 1–4 substrate. |
| 2026-05-31 | `P5-WP1` build completion reviewed from `agent_work/build_status/p5-wp1-final-slice-2026-05-30.md`. Phase 5 slice is classified as build-complete and ready for independent evaluation with bounded residual risk around live n8n cut-over approval and the AI/deterministic-fallback provenance split. Tool-channel unreliability was disclosed and compensated for by direct build verification. |
