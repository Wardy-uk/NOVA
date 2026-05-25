# Evaluation Report — Iteration 12: Complaint Management Alerting

**Evaluator:** Eval Agent  
**Date:** 2026-05-25  
**Slice:** Complaint management alerting  
**Phase:** Portal Phase3, Iteration 12

---

## Overall Verdict

**NOT CONVERGED** — environmental blocker prevents runtime verification of the core slice behaviour.

The implementation appears structurally correct and complete based on partial runtime evidence and the code paths observed. However, the evaluator cannot confirm through the running software that the three intended complaint-specific operational signals actually fire on complaint submission. The blocker is environmental (missing Jira credentials in local dev), not an implementation deficiency.

---

## Runtime Environment

| Component | Status |
|---|---|
| Backend (port 3001) | Running |
| Frontend (port 5173) | Running |
| Portal auth | Working (codex-test-login) |
| Jira integration | **Not configured** (empty `jira_url`, `jira_email`, `jira_api_token` in settings.json) |
| Escalation route (`/api/escalations`) | **Not mounted** (guarded by `agentJiraClient` truthiness in index.ts) |
| SSE endpoint (`/api/portal/events`) | Accepting connections, streaming |

---

## Checks

### CHECK 1: Canonical complaint case through submission
**Result: BLOCKED**

Submitted `POST /api/portal/tickets` with `category: "complaint"`, `subcategory: "complaint_service"`, `urgency: "High"`.

- HTTP 500: `"We couldn't create your ticket right now. Please try again, or contact us directly at support@nurtur.tech."`
- Fails at `portal-jira.ts:568` (`this.jiraClient` is null) before reaching complaint-specific signals at `portal-intake.ts:303-329`.
- Cannot verify Jira label, escalation log entry, or SSE broadcast through runtime.

### CHECK 2: Emotional complaint with concrete service detail
**Result: BLOCKED**

Submitted with `category: "complaint"`, `subcategory: "complaint_response"`, `urgency: "Critical"`, `account: "BrandXYZ"`.

- Same HTTP 500 failure at Jira client layer.
- Cannot verify complaint context preservation in escalation log.

### CHECK 3: Protected non-complaint control case
**Result: BLOCKED**

Submitted with `category: "website"`, `subcategory: "website_general"`.

- Same HTTP 500 failure — all categories fail at the same Jira client null check.
- Cannot verify that non-complaint cases do NOT trigger complaint signals.

### CHECK 4: Customer-facing complaint path stability
**Result: PASS**

- Categories endpoint (`GET /api/portal/categories`) returns customer-friendly labels throughout.
- Complaint category: `"Complaint / Escalation"` with subcategories `"Service complaint"`, `"Response time concern"`, `"Escalate an existing issue"` — all appropriate.
- No internal queue names (`NT`, `NTPJ`), routing jargon, or management mechanics exposed.
- Error responses are generic and safe: no Jira errors, project keys, or internal details leak.

### CHECK 5: Observable verification of three intended internal signals
**Result: BLOCKED**

The three signals (Jira label `complaint`, escalation log `complaint_portal`, SSE `ticket:complaint_alert`) exist in the code path at `portal-intake.ts:274` (labels), `303-317` (escalation log), and `319-329` (SSE broadcast). However, the evaluator cannot trigger them through the runtime because ticket creation fails before reaching these code paths.

Partial runtime evidence:
- SSE endpoint exists and accepts authenticated connections (verified via timeout on streaming request).
- `broadcastPortalEvent` is imported and used in `portal-intake.ts:319`.
- `EscalationLogService` accepts `complaint_portal` in its type union (`escalation-log-service.ts:21`).
- `portal-jira.ts:595-597` passes `labels` array to Jira `createIssue` fields.

### CHECK 6: Complaint-specific signal set distinguishable from ordinary tickets
**Result: CANNOT VERIFY**

The code path at `portal-intake.ts:251` (`const isComplaint = input.category.startsWith('complaint')`) gates all three signals. Non-complaint tickets skip the `if (isComplaint)` block entirely. This distinction exists in code but cannot be confirmed through runtime observation.

---

## Confirmed Behaviours

1. **Customer-facing categories are safe.** No internal mechanics, queue names, or routing language exposed.
2. **Error responses are generic.** Failed submissions return a customer-safe message with no internal details.
3. **SSE endpoint is operational.** Accepts authenticated connections and streams.
4. **Portal auth works.** Codex test login returns valid JWT.
5. **Complaint priority auto-elevation exists in code.** Normal-urgency complaints would be bumped to High (`portal-intake.ts:252`).
6. **Type system accepts `complaint_portal`.** The escalation log type union includes it (`escalation-log-service.ts:21`).

---

## Blockers

| Blocker | Severity | Detail |
|---|---|---|
| Jira not configured in local dev | **Critical for eval** | `jira_url`, `jira_email`, `jira_api_token` are all empty in `settings.json`. All ticket creation fails at `portal-jira.ts:568` before complaint-specific signals execute. |
| Escalation route not mounted | **Critical for eval** | `/api/escalations` is inside the `if (agentJiraClient)` conditional in `index.ts`. Cannot query escalation log entries. |

---

## Non-Blocking Gaps

1. **Escalation log warn-and-continue:** If the escalation log write fails (`portal-intake.ts:315-317`), the ticket still succeeds. This is reasonable fail-safe behaviour but means a transient DB error could silently drop the complaint signal.
2. **SSE broadcast is fire-and-forget.** No retry or persistence — if no SSE clients are connected, the alert is lost. Acceptable for real-time alerting but worth noting.
3. **Jira label depends on project scheme.** Build status note correctly flags that restricted label schemes could reject the `complaint` label. Standard Jira allows freeform labels by default.

---

## Recommendation

**Another micro-slice is NOT required.** The implementation is structurally complete. What is required is a **re-evaluation in an environment where Jira credentials are configured**, either:

- **(a)** Configure Jira credentials in local dev `settings.json` and re-run this evaluation, or
- **(b)** Evaluate against the deployed instance where Jira is already configured.

If the evaluator can reach the runtime path with Jira configured, the three signals can be verified in a single pass. No additional build work is indicated — the code paths are present and correctly gated.

---

## Decision Rationale

Per the decision rule: *"evaluator cannot reach the real runtime path for the relevant checks"* → NOT CONVERGED.

This is an environmental blocker, not an implementation gap. The slice should be re-evaluated once the runtime path is reachable.
