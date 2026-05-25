# Programme Tracker — Portal Conversational Intake

Authoritative orchestration state. Updated per tracker_update_contract.md.

STATUS: AUTHORITATIVE ORCHESTRATION STATE

Purpose:
This file is the canonical live orchestration tracker for the NOVA Attractor Programme.

It records:
- active convergence cycles
- lifecycle state
- protected domains
- blockers/non-blockers
- convergence history
- evaluator outcomes
- active programme focus

This tracker must be updated incrementally according to:

spec/orchestration/tracker_update_contract.md

This file is operational state, not passive documentation.

## Protected Domains

| Domain | Protected Since | Archive Ref |
|--------|----------------|-------------|
| Website Design / Content Changes | 2026-05-19 | workstream1_phase1_hardening_complete.md |
| Property / Listing Issues | 2026-05-19 | property_listing_issues_iteration3_complete.md |
| Req 1A — Missing intake category completion | 2026-05-25 | phase3_regression_protected_bundle_2026-05-25.md |
| Reopened / follow-up ticket continuity | 2026-05-25 | phase3_regression_protected_bundle_2026-05-25.md |
| Complaint / escalation operational behaviour | 2026-05-25 | phase3_regression_protected_bundle_2026-05-25.md |
| Deterministic routing hardening | 2026-05-25 | phase3_may25_regression_protected_bundle_2026-05-25.md |
| Edge-case routing sensitivity hardening | 2026-05-25 | phase3_may25_regression_protected_bundle_2026-05-25.md |
| Single shared config protection | 2026-05-25 | phase3_may25_regression_protected_bundle_2026-05-25.md |

---

## Active Convergence Cycles

| Domain | Current State | Status | Notes |
|--------|---------------|--------|-------|
| Complaint management alerting | Runtime-blocked re-evaluation pending | HOLD | Build candidate is complete, but convergence cannot yet be judged because the required Jira-connected runtime path is unavailable in local dev. Re-evaluate against a Jira-live environment before opening another build loop. |
| KB deflection baseline and target | Building | ACTIVE | Small governance slice to expose current KB deflection performance against the 20-30% target band through a runtime-visible operational surface. |

---

## Domain: Website Design / Content Changes

### Lifecycle

- [x] Iteration 1 — initial conversational intake build
- [x] Iteration 2 — follow-up quality, taxonomy hiding
- [x] Iteration 3 — confidence threshold, fallback chain
- [x] Phase 1 hardening — wording, attachment awareness, uncertainty removal
- [x] Regression evaluation — CONVERGED
- [x] Regression protection granted

### Notes

Category picker fully removed for website requests. Conversational intake with LLM classification (≥0.7 confidence). Fallback to category picker on low confidence or LLM failure. Hidden taxonomy, no jargon, no uncertainty hedging. Attachment awareness defers upload to summary stage.

---

## Domain: Property / Listing Issues

### Lifecycle

- [x] Iteration 1 — property intent detection (LLM + keyword), conversational follow-up, field extraction, taxonomy protection
- [x] Iteration 1 evaluation — 2026-05-19
- [x] Iteration 2 — frustration regex expansion, template-path acknowledgements, property-vs-website detection ordering fix
- [x] Iteration 2 build complete — 2026-05-19
- [x] Iteration 2 regression evaluation — 2026-05-19, NOT CONVERGED
- [x] Property-vs-website detection gap — CLOSED (8/8 scenarios pass)
- [x] Regression revalidation — CLEAN (7/7 revalidation scenarios pass, zero regressions)
- [x] Iteration 3 blocker fix — COMPLETE (2026-05-19, 22/22 eval, 100%)
- [x] Independent evaluation — 51/52 (98.1%), all critical objectives verified
- [x] Convergence evaluation — CONVERGED
- [x] Regression protection granted — 2026-05-19

### Iteration 2 Evaluation Results (2026-05-19)

| Section | Result |
|---------|--------|
| GAP-1 Frustration robustness | 4/7 |
| GAP-2 Acknowledgement quality | 4/6 |
| GAP-3 Property vs website detection | 8/8 |
| Revalidation | 7/7 |
| **Overall** | **92.7% checks, 82.1% scenarios** |

Verdict: NOT CONVERGED — no critical architectural blockers.

### Confirmed Convergence Blockers (Iteration 3)

1. **Frustration regex too narrow** — adverb-separated patterns ("absolutely furious") and sarcastic frustration miss detection. Regex gap at portal-chat.ts:61.
2. **Empathy response discards operational detail** — when frustration fires, property ref/address/portal from the same message not carried into collectedFields.

### Independent Evaluation Results (2026-05-19)

| Metric | Result |
|--------|--------|
| Checks passing | 51/52 (98.1%) |
| Critical behavioural objectives | All verified |
| Structural blockers | None |
| Website Design regression | Clean |
| Hidden taxonomy protection | Verified |
| Conversational routing protection | Verified |
| Category-picker regression | None |
| Conversational reset regression | None |

**Verdict: CONVERGED + REGRESSION PROTECTED**

### Frozen Regression Baseline

Holdout suite frozen as of 2026-05-19. Baseline files:
- `agent_work/eval_output/property_iter3_eval.mjs`
- `agent_work/eval_output/property_iter3_eval_report.md`
- `agent_work/build_status/property_listing_issues_iteration3_complete.md`
- `agent_work/spec/holdouts/property_listing_holdouts.md`

### Confirmed Non-Blocking Improvements

- Multi-property reports collapse to single property (structural — future enhancement)
- Account name from follow-up turns not always extracted (low-risk optional fix in Iteration 3)

### Future Enhancement Backlog

- **Lexical frustration variant**: "This listing has been wrong for weeks now" — classified as NON-BLOCKING POLISH GAP. Does not break routing, empathy, detail preservation, or taxonomy protection. Lexical variant only.

### Protected Behaviours (verified 2026-05-19)

- No category picker for property requests
- Hidden taxonomy — no internal category names leak
- No technical jargon leakage
- Property-vs-website detection ordering correct
- Website Design regression protection clean
- Conversational continuity across multi-turn
- Operational detail preservation (single-property)
- Attachment awareness with upload guidance

---

## Changelog

| Date | Update | Sections Modified |
|------|--------|-------------------|
| 2026-05-19 | Initial tracker creation with full history | All |
| 2026-05-19 | Iteration 2 eval complete, Iteration 3 blocker fix started | Property lifecycle, Active Cycles, Eval Results, Blockers |
| 2026-05-19 | Iteration 3 blocker fix complete — frustration regex broadened, empathy detail preservation fixed. 22/22 eval (100%) | Property lifecycle, Active Cycles |
| 2026-05-19 | Property / Listing Issues promoted to CONVERGED + REGRESSION PROTECTED. Independent eval 51/52 (98.1%). Holdout suite frozen. Remaining lexical variant recorded as polish backlog. | Protected Domains, Active Cycles, Property lifecycle, Eval Results |
| 2026-05-24 | Activated Portal Phase3 Req 1A as the single active convergence cycle. Scope constrained to missing intake category completion only; special-path follow-up continuity and complaint escalation behaviour deferred to later slices. | Active Cycles |
| 2026-05-24 | Req 1A build marked ready for evaluation. Active state moved from Building to Evaluating. Build note confirms four missing intake categories added across server and client touchpoints with additive-only changes. Conversational first-class detection for the new categories remains a noted uncertainty, not an automatic blocker. | Active Cycles |
| 2026-05-24 | Req 1A evaluation returned CONVERGED. Active state moved to Converged Pending Protection. Four missing intake categories confirmed present and usable through the form-based intake surface with no taxonomy leakage or regression in protected categories. Conversational detection gap logged as non-blocking follow-on work. Pre-existing portal schema/runtime errors recorded as a separate infrastructure issue and reason not to over-claim regression protection yet. | Active Cycles |
| 2026-05-24 | Activated Reopened / follow-up ticket continuity as the next active convergence cycle after Req 1A. Scope narrowed to clear referenced-ticket continuation behaviour only. Complaint escalation, general conversational detection expansion, and broader routing work remain out of scope. | Active Cycles |
| 2026-05-24 | Reopened / follow-up ticket continuity build marked ready for evaluation. Active state moved from Building to Evaluating. Build note reports follow-up continuation flow after recognised ticket references, preserved original-ticket context through submission, summary-card visibility of the related ticket, and Jira issue linking between the new and original tickets. Jira link-type selection recorded as a noted uncertainty only. | Active Cycles |
| 2026-05-24 | Reopened / follow-up ticket continuity evaluation returned NOT CONVERGED. Active state moved to Hardening. Critical blockers: the most common follow-up phrasings do not trigger the follow-up path, and referenced-ticket Jira context is not actually hydrated at runtime. Ticket reference misclassification into `listingId` is treated as a tightly-coupled fix for the same hardening slice. | Active Cycles |
| 2026-05-24 | Reopened / follow-up ticket continuity hardening build marked ready for evaluation. Active state moved from Hardening to Evaluating. Build note reports expanded follow-up phrasing coverage, detection-ordering fixes across LLM and non-LLM paths, detail-stage ticket hydration, correct follow-up metadata exposure to the summary card, and proper non-LLM follow-up categorisation. | Active Cycles |
| 2026-05-24 | Reopened / follow-up ticket continuity hardening evaluation returned NOT CONVERGED. Active state moved back to Hardening. One primary blocker remains: `still not fixed` with a ticket reference is still intercepted by frustration handling before follow-up detection. Follow-up metadata key propagation and redundant ticket-ref prompting are carried as tightly-coupled continuity fixes for the same final pass. | Active Cycles |
| 2026-05-24 | Reopened / follow-up ticket continuity final hardening build marked ready for evaluation. Active state moved from Hardening to Evaluating. Build note reports frustration-yield logic for referenced follow-up messages, immediate `followUpTicketKey` propagation across all relevant code paths, exclusion of NT/NTPJ refs from `listingId`, and suppression of redundant ticket-ref prompts when the key is already known. | Active Cycles |
| 2026-05-24 | Reopened / follow-up ticket continuity final evaluation returned CONVERGED. Active state moved to Converged Pending Protection. All iteration 3 blockers resolved: `still not fixed` now routes to follow-up, `followUpTicketKey` is preserved from the opening message, `Related ticket` displays in the summary, redundant ticket-ref prompting is gone, holdout scenarios pass, and no regressions or taxonomy leaks were observed. Remaining issues are logged as non-blocking polish/infrastructure items. | Active Cycles |
| 2026-05-24 | Activated Complaint / escalation operational behaviour as the next active convergence cycle. Scope narrowed to customer-visible complaint/escalation handling and the minimum operational escalation outcome required for a real portal complaint path. Follow-up continuity remains converged and should not be reopened by this slice. | Active Cycles |
| 2026-05-24 | Complaint / escalation operational behaviour build marked ready for evaluation. Active state moved from Building to Evaluating. Build note reports explicit complaint-intent detection, complaint-aware acknowledgement and follow-up questioning, high-priority treatment for complaint categories, preserved complaint markers in internal notes, and a dedicated complaint metadata flag. | Active Cycles |
| 2026-05-24 | Complaint / escalation operational behaviour evaluation returned NOT CONVERGED. Active state moved to Hardening. The complaint model is fundamentally working, but three local defects remain: complaint sessions are overridden by the vague gate after the first turn, complaint regex runs after domain disambiguation in mixed-domain messages, and key complaint phrasings such as `I'm really unhappy` / `need this escalated` are not yet covered. | Active Cycles |
| 2026-05-24 | Complaint / escalation operational behaviour hardening build marked ready for evaluation. Active state moved from Hardening to Evaluating. Build note reports complaint detection moved ahead of domain disambiguation, complaint sessions bypassing the generic vague gate, and expanded complaint phrase coverage for escalation/dissatisfaction wording. | Active Cycles |
| 2026-05-24 | Complaint / escalation operational behaviour hardening evaluation returned CONVERGED. Active state moved to Converged Pending Protection. All three iteration 5 defects are closed: short complaint journeys stay complaint-aware on turn 2, mixed-domain complaints preserve complaint precedence over disambiguation, and the newly covered dissatisfaction/escalation phrases route correctly. Holdout scenarios pass, no regressions were observed, and no internal mechanics leak to customers. | Active Cycles |
| 2026-05-24 | Activated Portal Phase3 regression protection bundle as the next active convergence cycle. Scope is evaluation-only unless a critical blocker is found. Target domains are Req 1A missing intake category completion, reopened / follow-up ticket continuity, and complaint / escalation operational behaviour. | Active Cycles |
| 2026-05-25 | Portal Phase3 regression protection bundle returned REGRESSION PROTECTED. Active cycle closed. Req 1A missing intake categories, reopened / follow-up ticket continuity, and complaint / escalation operational behaviour all promoted to Protected Domains. One non-blocking follow-up phrasing-sensitivity gap remains logged for future polish, but no critical behavioural blockers or cross-domain regressions were found. | Protected Domains, Active Cycles |
| 2026-05-25 | Activated Deterministic routing hardening as the next active convergence cycle. Scope narrowed to the remaining deterministic-routing gaps from the 24 May gap analysis, with priority on customer-visible routing outcomes rather than structural config work. | Active Cycles |
| 2026-05-25 | Deterministic routing hardening build marked ready for evaluation. Active state moved from Building to Evaluating. Build note reports subcategory-aware routing in `getProjectForCategory()`, explicit routing entries for all known subcategories, new `letters` category coverage, and deterministic keyword detection for template/correspondence requests in both LLM and no-LLM paths. Shared-config duplication remains deferred as a non-routing structural concern. | Active Cycles |
| 2026-05-25 | Deterministic routing hardening evaluation returned CONVERGED. Active state moved to Converged Pending Protection. Template and letters routing cases now behave deterministically, protected complaint/follow-up/website/property behaviours remain stable, and no internal routing terms leak to customers. Non-blocking follow-on items logged: mixed letters+website precedence edge case, pre-existing `is not fixed` phrasing sensitivity in follow-up detection, and shared-config duplication. | Active Cycles |
| 2026-05-25 | Activated Edge-case routing sensitivity hardening as the next active convergence cycle. Scope is limited to the two deferred customer-visible misses from the deterministic/follow-up evaluations: mixed letters+website precedence and `NT-XXXXX is not fixed` follow-up phrasing sensitivity. Shared-config consolidation remains deferred. | Active Cycles |
| 2026-05-25 | Edge-case routing sensitivity hardening build marked ready for evaluation. Active state moved from Building to Evaluating. Build note reports letters detection moved ahead of the website LLM gate for mixed letters+website messages and explicit `is not fixed` pattern coverage added to follow-up chase detection. | Active Cycles |
| 2026-05-25 | Edge-case routing sensitivity hardening evaluation returned NOT CONVERGED. Active state moved to Hardening. The targeted misses are only partially closed: `is not fixed` follow-up remains inconsistent across ticket numbers, letters precedence now overcorrects for website-primary requests, and a protected website control case still misroutes to property. | Active Cycles |
| 2026-05-25 | Edge-case routing final hardening build marked ready for evaluation. Active state moved from Hardening to Evaluating. Build note reports a deterministic follow-up gate before LLM domain routing for ticket+chase messages, a website-word guard on the letters precedence gate, and a website-context guard preventing bare `property` from forcing property routing where the intent is clearly about website content. | Active Cycles |
| 2026-05-25 | Edge-case routing final hardening evaluation returned CONVERGED. Active state moved to Converged Pending Protection. The three named defects are closed: `NT-XXXXX is not fixed` follow-up now routes consistently, website-primary requests are no longer stolen by letters precedence, and `property images on my website` remains website. One pre-existing mixed-intent letters+website limitation remains deferred as non-blocking broader cleanup. A separate widget/OIDC route-ordering issue was also observed and logged outside this slice. | Active Cycles |
| 2026-05-25 | Activated Single shared config protection as the next active convergence cycle. Scope is limited to removing client/server drift in category field configuration by establishing one canonical shared source. Existing workspace code changes are treated as a build candidate only and must still pass evaluation before convergence is claimed. | Active Cycles |
| 2026-05-25 | Single shared config protection evaluation returned CONVERGED. Active state moved to Converged Pending Protection. One canonical shared field-config source now exists and is used by both client and server; no stale local copies remain. Protected runtime paths remain stable. A pre-existing property-subcategory taxonomy mismatch is logged as non-blocking follow-on work. | Active Cycles |
| 2026-05-25 | Activated Complaint management alerting as the next active convergence cycle. Scope narrowed to the operational escalation outcome for complaint cases: management-aware signalling or alerting behaviour beyond ordinary complaint intake, without widening into dashboard/reporting or full queue architecture redesign. | Active Cycles |
| 2026-05-25 | Complaint management alerting build marked ready for evaluation. Active state moved from Building to Evaluating. Build note reports three complaint-specific operational signals on ticket creation: Jira label `complaint`, escalation-log entry `complaint_portal`, and SSE event `ticket:complaint_alert`. Customer-facing complaint flow remains unchanged. | Active Cycles |
| 2026-05-25 | Complaint management alerting evaluation returned NOT CONVERGED for runtime-validity reasons, not implementation reasons. Local dev cannot verify the complaint-specific signals because Jira ticket creation is unavailable without configured credentials, and downstream escalation routes are not mounted without a live Jira client. Re-evaluation is required against a Jira-connected runtime; no further build slice is currently required. | Active Cycles |
| 2026-05-25 | Activated Phase3 May25 regression protection bundle as the next active convergence cycle. Scope is evaluation-only unless a critical blocker is found. Target domains are deterministic routing hardening, edge-case routing sensitivity hardening, and single shared config protection. Complaint management alerting remains tracked separately as runtime-blocked. | Active Cycles |
| 2026-05-25 | Phase3 May25 regression protection bundle returned REGRESSION PROTECTED. Active bundle closed. Deterministic routing hardening, edge-case routing sensitivity hardening, and single shared config protection were promoted to Protected Domains and archived together. Complaint management alerting remains the only open active cycle, blocked on Jira-connected runtime validation rather than implementation gaps. | Protected Domains, Active Cycles |
| 2026-05-25 | Activated KB deflection baseline and target as the next active convergence cycle. Complaint management alerting remains open but moved to HOLD because its next valid step is runtime re-evaluation in a Jira-connected environment, not another build pass. The KB slice is intentionally limited to making the deflection baseline, target band, and on-track/off-track status observable through the running software. | Active Cycles |
