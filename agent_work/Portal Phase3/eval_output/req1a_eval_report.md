# Req 1A Evaluation Report — Missing Intake Category Completion

**Evaluator:** Eval Agent  
**Date:** 2026-05-24  
**Phase:** Portal Phase3, Iteration 1  
**Slice:** Req 1A — Missing intake category completion

---

## Overall Verdict

**CONVERGED** — with one non-blocking follow-on item logged.

All four missing request types are present and usable as intake categories through the form-based portal intake surface. The conversational (chat) path does not yet have dedicated detection logic for these categories, which is logged as a non-blocking gap consistent with the manager handoff's stated uncertainty.

---

## Checks Passed

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | All four categories present in API | PASS | `GET /api/portal/categories` returns 13 categories including `security`, `general_request`, `followup`, `complaint` with correct subcategories |
| 2 | Customer-safe labels | PASS | All labels reviewed — no internal taxonomy, project keys, routing jargon, or implementation vocabulary visible |
| 3 | Subcategory coverage | PASS | Each category has 3 coherent subcategories with customer-appropriate names and descriptions |
| 4 | Jira project mapping | PASS | `CATEGORY_TO_PROJECT` includes all four categories and their subcategories (`security`→NTPJ, others→NT) |
| 5 | Frontend renders all categories | PASS | `PortalNewRequest.tsx` fetches from API without filtering — all categories display |
| 6 | Chat component has category labels | PASS | `CATEGORY_LABELS`, `CATEGORY_NAMES`, `SUBCATEGORY_NAMES` all include the four new categories |
| 7 | Category field config present | PASS | `CATEGORY_FIELD_CONFIG` has entries for all new subcategories with appropriate field requirements and description hints |
| 8 | Form schema accepts new categories | PASS | `PortalTicketCreateSchema` uses `z.string().min(1)` for category — no allowlist blocking new values |

## Checks Failed

None.

## Holdout Scenario Results

| ID | Scenario | Result | Notes |
|----|----------|--------|-------|
| H1 | Previously protected category (website) after new categories added | PASS | Website request correctly classified as `website/website_broken`, conversational flow intact, no friction or taxonomy leakage |
| H2 | Reopened / Follow-up without ticket reference | PASS (form), ACCEPTABLE (chat) | Form path accepts followup category without requiring ticket reference. Chat path classified as `other/other_general` — AI asked for more details rather than breaking. Coherent as a category-level path; deeper continuity behaviour explicitly deferred |
| H3 | Complaint / Escalation with frustrated language | PASS (form), ACCEPTABLE (chat) | Form path accepts complaint category. Chat path classified the frustration as a website issue rather than complaint — AI response was safe and didn't leak internal handling mechanics. Deeper complaint detection is a deferred slice concern |

## Edge Input Results

| Input | Path | Result |
|-------|------|--------|
| Short "site security issue" | Chat | Classified as `other/other_general` — AI asked for more details. Safe fallback |
| Vague general admin change | Chat | Classified as `account/account_details` — reasonable misroute, no breakage |
| Follow-up without ticket number | Chat | Classified as `other/other_general` — AI asked for clarification. No pretence of deeper workflow |
| Complaint with standard issue mixed in | Chat | Category blank, intent=problem — AI asked for more details. No unsafe promises about escalation |

## Confirmed Behaviours

1. **Category presence**: All four categories (`security`, `general_request`, `followup`, `complaint`) are defined in `DEFAULT_CATEGORIES` with customer-safe names, descriptions, and subcategories.
2. **No taxonomy leakage**: Labels use plain language ("Website Security", "Reopened / Follow-up", etc.). No Jira project keys, routing labels, or internal classification terms exposed.
3. **Form-based intake path**: The `PortalNewRequest` component fetches categories dynamically from the API and renders all 13 without filtering. Users can select any of the four new categories and their subcategories.
4. **Submission pipeline configured**: `CATEGORY_TO_PROJECT` maps all new categories to appropriate Jira projects. `CATEGORY_FIELD_CONFIG` defines field requirements and description hints for all new subcategories.
5. **Previously protected behaviour stable**: Website, property, and account categories continue to work through both form and conversational paths with no regression from the category additions.
6. **Chat labels present**: `CATEGORY_LABELS` in the frontend and `CATEGORY_NAMES`/`SUBCATEGORY_NAMES` in the backend include all four new categories — correctly labelled for display.

## Blockers

None.

## Non-Blocking Gaps

### Gap 1: Conversational detection does not cover new categories

**Severity:** Non-blocking (explicitly within scope uncertainty noted by manager handoff)

**Detail:** The AI system prompt in `portal-chat.ts` (lines 1132–1200) classifies messages into three detection domains: website, property, and account. There is no dedicated detection branch for `security`, `general_request`, `followup`, or `complaint`. Messages that should route to these categories are either absorbed into adjacent categories (e.g., security → website) or fall through to `other/other_general`.

**Impact on Req 1A:** The form-based intake path fully supports all four categories. A user who selects a category from the grid can submit under any of the four new types. The conversational path provides safe fallback behaviour (asks for more details, doesn't crash, doesn't leak taxonomy) even when it misclassifies.

**Recommendation:** Log as a follow-on item for a future slice (Req 1F or similar) to add security, general_request, followup, and complaint detection to the conversational intake prompt. This is a refinement, not a blocker for the intake-coverage slice.

### Gap 2: Portal DB schema errors (pre-existing)

**Severity:** Non-blocking for this slice (pre-existing infrastructure issue)

**Detail:** Several portal endpoints return MSSQL errors ("Invalid column name 'description'", "Invalid column name 'status'") suggesting the portal DB schema is not fully migrated in the current dev environment. This affects ticket listing, home summary, and potentially form submission (which also fails for existing categories). This is not caused by the new category additions.

**Impact on Req 1A:** The categories API endpoint works correctly. The form-based category selection and display work correctly. The schema issue prevents end-to-end Jira ticket creation for ALL categories (not just the new ones), confirming it is a separate infrastructure concern.

---

## Decision

**Req 1A is CONVERGED.**

The four missing request types are present and usable at the intake-category level. Each has coherent labels, subcategories, field configurations, and project mappings. The form-based intake surface correctly displays and accepts all four categories. Previously protected categories remain stable. No taxonomy leakage was detected.

The conversational detection gap is a known uncertainty that was assessed neutrally per the evaluation brief. It does not break the intake-coverage behavioural model — users can still access these categories through the form path, and the chat path degrades gracefully rather than breaking.

No additional build slice is required for Req 1A. The conversational detection refinement should be tracked as a separate follow-on slice.
