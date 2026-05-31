# KPI Escalation Router Activation — runtime mounting + observability (KPX-WP5A)

**Work package:** `KPX-WP5A` — make the escalation capture router observably present in runtime
**Date:** 2026-05-31
**Agent:** Build Agent (Claude Code)
**Basis:** `agent_work/build_status/kpi_escalation_capture_hardening_2026-05-31.md` (KPX-WP5) + eval `agent_work/eval_output/kpi_escalation_capture_hardening_eval_2026-05-31.md` (QUALIFIED PASS, single material blocker: whole `/api/escalations` router 404 in the running instance)
**Scope discipline:** runtime / mounting / proof of the escalation capture path and stats behaviour only. No Escalations parity screen, no read-side rewiring, no engine changes, no holdout consumption, no forbidden tables, no feature redesign.

---

## 0. Summary

The KPX-WP5 eval was a qualified pass for one reason only: the **entire `/api/escalations` router returned 404** in the running instance — the new `POST /rejection` *and* the pre-existing stats/list routes — so the headline claim (*"a real rejection can now be captured"*) could not be proven behaviourally. The eval correctly judged this an environment/runtime condition rather than a read-side regression.

That diagnosis was right. This slice fixes the runtime condition and proves the whole escalation surface live:

1. **Root cause found:** the escalation router was mounted **inside the `if (agentJiraClient)` agent-subsystem block**. When no onboarding Jira client is configured, that whole block is skipped and the router is never mounted — while `/api/kpi/*` and `/api/auth/*` (mounted outside the block) stay live. That is exactly the 200-vs-404 split the eval observed.
2. **Fix:** the escalation router is now mounted **unconditionally**, before the agent block, so it is present regardless of Jira/agent configuration.
3. **Second, pre-existing defect found and fixed:** once reachable, `GET /api/escalations/stats` returned **500 `Invalid column name 'ticket_key'`** — a bad column reference in `getStats` that had been masked by the router never being reachable. Fixed so stats behaviour is observable, as the slice requires.
4. **Proven live** against a running instance that **reproduces the eval's exact condition** (no onboarding Jira creds → `agentJiraClient` is null).
5. **Read-side wiring and honest behaviour preserved**; legacy KPI reads non-regressed.

---

## 1. Runtime / mounting issue found

In `src/server/index.ts`, the escalation router was mounted here (pre-WP5A):

```
if (agentJiraClient) {            // line ~1116
   agentLoop = new AgentLoop(...)
   ...
   // Escalation logging
   const escalationLog = new EscalationLogService();
   app.use('/api/escalations', createEscalationRoutes({ escalationLog, jiraClient: agentLoop.getJiraClient() }));
   ...
}
```

`agentJiraClient = buildOnboardingJiraClient()` returns **`null`** whenever onboarding Jira credentials (`jira_ob_*` / `jira_*`) are absent (index.ts §`buildOnboardingJiraClient`, returns `null` when creds are empty). When it is null:

- the entire `if (agentJiraClient) { … }` block — **including the `/api/escalations` mount** — is skipped;
- routers mounted **outside** that block (`/api/auth`, `/api/kpi/*`, the global auth gate at `app.use('/api', …)`) remain live.

Result: every `/api/escalations/*` path falls through to Express's default handler → **404**, while control routes return 200. This is precisely the table the eval recorded. The router's availability was incorrectly coupled to AI-agent/Jira configuration even though escalation logging has no such dependency: `EscalationLogService` is constructed with **no arguments**, and the route's `jiraClient` dependency is used **only** by `POST /backfill`, which already returns `503` when it is null.

**Confirmed environmentally:** the instance used for this proof has all `jira_ob_*` / `jira_*` settings empty, so `agentJiraClient` is null here too — i.e. this environment reproduces the eval's exact 404 condition. Pre-WP5A, the escalation routes 404 here; that is the behaviour being corrected.

---

## 2. What was changed to make the escalation router observable

### 2.1 Unconditional mount (the core change) — `src/server/index.ts`

The escalation router mount was **relocated out of the `if (agentJiraClient)` block** to just before it, so it always runs:

```
// Escalation logging — mounted unconditionally so the escalation capture /
// stats / list surface is reachable even when no onboarding Jira client is
// configured (the agent block below is skipped when agentJiraClient is null).
// EscalationLogService is standalone; the jiraClient dep is used only by the
// /backfill route, which already returns 503 when it is null.
const escalationLog = new EscalationLogService();
app.use('/api/escalations', createEscalationRoutes({
  escalationLog,
  jiraClient: agentJiraClient,
}));

if (agentJiraClient) {
  agentLoop = new AgentLoop(...)
  ...
}
```

- The `jiraClient` dep is now the null-safe `agentJiraClient` (instead of `agentLoop.getJiraClient()`, which is unreachable outside the block). When null, only `/backfill` is affected, and it already degrades to `503` — capture / stats / list are unaffected.
- `escalationLog` remains a single declaration in `main()` scope and is still consumed later inside the agent block (unchanged), so no duplicate construction and no broken reference.
- The old in-block mount block was removed. No other behaviour in the agent block changed.

### 2.2 Stats route 500 → 200 (pre-existing column defect) — `src/server/services/escalation-log-service.ts`

Once the router was reachable, `GET /api/escalations/stats` returned **500 `Invalid column name 'ticket_key'`**. Cause: the `getStats` ticket-count query referenced columns that do not exist on `jira_issue_cache` (whose PK is `issue_key` and whose creation timestamp is `jira_created`; there is no `ticket_key` or `created` column). This is **independent of WP5's rejection work** — WP5 only added the `escalation_type <> 'rejection'` filters to the `escalation_log` queries; this query was already wrong and had simply never been reachable to fail.

Minimal one-query fix (the only change in this file from this slice):

```
-  `SELECT COUNT(DISTINCT ticket_key) as cnt FROM jira_issue_cache
-   WHERE created >= DATEADD(day, ?, GETUTCDATE())`,
+  `SELECT COUNT(DISTINCT issue_key) as cnt FROM jira_issue_cache
+   WHERE jira_created >= DATEADD(day, ?, GETUTCDATE())`,
```

This keeps the slice within "stats behaviour" scope (the stats route now actually behaves) without touching the rejection partitioning, rate maths, or any WP5 read-side wiring.

> Note: the rest of the diff in `escalation-log-service.ts` is the pre-existing, already-uncommitted KPX-WP5 work (rejection capture + `getStats` rejection exclusion). This slice's only addition there is the two-column fix above.

---

## 3. How runtime observability now proves capture + stats routes are live

Verified against a **running instance reproducing the eval's null-`agentJiraClient` condition** (onboarding Jira creds empty), authenticated as admin (`nickw`, role `admin`). A deliberately-fake path is included as a control to prove these are genuine routed responses (not a blanket gate artefact):

| Request (authenticated) | Result | Meaning |
|---|---|---|
| `GET /api/escalations` (list) | **200** `{ok:true,data:[…real rows…]}` | List route live |
| `GET /api/escalations/stats` | **200** `{ok:true,data:{total:988, by_type:[jira_transition,ai_agent], …}}` | Stats route live; `by_type` contains **no `rejection`** → exclusion filter working |
| `POST /api/escalations/rejection` `{ticket_key:"…"}` | **200** `{ok:true,data:{id}}` | **Capture path works — a real rejection event was recorded** |
| `POST /api/escalations/rejection` `{}` (no body) | **400** `ticket_key is required` | Validation reachable |
| `POST /api/escalations/rejection` (no auth) | **401** `Not authenticated` | Auth gate reachable |
| `GET /api/escalations/FAKEXYZ-nonexistent` (control) | **404** | Genuine 404 still 404 → the 200/400 above are real routing, not gate noise |

This directly clears the eval's two unverified questions:

- **Q1 (capture):** `POST /api/escalations/rejection` now returns `200 {ok:true,data:{id}}` and persisted a real `escalation_type='rejection'` row — capture is proven, not just claimed.
- **Q5 (stats non-inflation):** `GET /api/escalations/stats` is now reachable and its `by_type`/`total` exclude `rejection` rows (the `<> 'rejection'` filter is observable in the live payload).

**Test-data hygiene:** the single rejection row created to prove capture (`ticket_key NT-DUMMY-PROOF`, id 1522) was **deleted immediately after verification** (confirmed `0` remaining). No fabricated or residual escalation/rejection data was left in the store, so honest behaviour is preserved.

### Read-side wiring + honesty + non-regression (preserved)

- `GET /api/kpi/team/NT` → **200**. Escalation family: `escalation_rate`, `escalation_accuracy`, `rejection_rate` all `unwired:false, value:null` — the same honest "wired, awaiting-capture" state the WP5 eval blessed. Unchanged by this slice (no read-side code touched).
- `GET /api/kpi/admin-health` → **200**, no errors.
- Legacy KPI reads non-regressed; `escalation_rate` intact.
- **Server typecheck** `tsc -p tsconfig.server.json --noEmit` → **0 errors.**

---

## 4. Remaining bounded gap

- **Capture path still has no automated writer.** As stated in KPX-WP5, `rejection_rate` and `escalation_accuracy` will read `—` (`value:null`) until real rejection actions are routed through `POST /api/escalations/rejection`. This is the intended WP5 design (no heuristic fabrication), **not** a WP5A defect — and is now an *operational integration* task (wire the manual SOP gate / AI agent / portal flows to the capture route), companion to the Escalations parity screen. WP5A does not build that writer (out of scope), but it makes the surface it would write to genuinely live and observable.
- No other gap: list, stats, and capture are all reachable and behave correctly in the reproduced no-Jira-creds condition.

---

## 5. Ready for independent evaluation?

**Yes.** The single material blocker from the KPX-WP5 eval — the whole `/api/escalations` router unmounted (404) in the running instance — is resolved: the router is mounted unconditionally and the previously-broken stats route now returns 200. The escalation capture path, stats route, and list route are all behaviourally reachable in an instance that reproduces the eval's exact configuration, the rejection-exclusion is observable in live stats output, and the WP5 read-side wiring + honest awaiting-capture behaviour are preserved with a clean server typecheck.

Suggested re-eval checks (running software only):
1. `GET /api/escalations`, `GET /api/escalations/stats` → `200` (not 404/500).
2. `POST /api/escalations/rejection` → `200 {ok:true}` with `ticket_key`; `400` without; `401` without auth.
3. Capture a rejection on an in-scope NT ticket → confirm `GET /api/escalations/stats` / `escalation_rate` are **not** inflated by it, and (post-EOD freeze) `rejection_rate` / `escalation_accuracy` carry real values. *(Remember to remove any test row afterwards to keep the store honest.)*
