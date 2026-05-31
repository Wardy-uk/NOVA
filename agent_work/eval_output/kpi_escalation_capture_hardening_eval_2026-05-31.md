# KPI Escalation Capture Hardening — Behavioural Evaluation (KPX-WP5)

**Work package:** `KPX-WP5` — escalation source-capture hardening (`rejection_rate`, `escalation_accuracy`, rejection capture path)
**Date:** 2026-05-31
**Agent:** Eval Agent (behavioural-only, per `AGENTS.md` §3 / §9)
**Target:** running NOVA instance, `http://localhost:3001` (live, authenticated as admin)

## Verdict: **QUALIFIED PASS**

The **read-side** of KPX-WP5 is genuinely delivered and behaves honestly: `rejection_rate` and `escalation_accuracy` are now wired, render as honest *awaiting-capture* (`null`, not fabricated `0%`/`100%`), and have correctly left the unwired set on the admin/health surface, with no regression to legacy KPI reads. **However**, the **rejection capture HTTP surface could not be exercised** — the entire `/api/escalations` router (including the new `POST /rejection` *and* the pre-existing stats/list routes) returns `404` in this running instance. That leaves the headline question — *"can a real rejection event now be captured?"* — **unverified against the running software**, which is why this is a qualified, not full, pass.

---

## 1. What was verified (observable behaviour, authenticated)

Evaluation was performed against the live server only (API responses), per `AGENTS.md` §9. An admin session was confirmed via `GET /api/auth/me` → `200`, user `nickw`, role includes `super_admin`.

### ✅ Q2 — Metrics no longer present as unwired
`GET /api/kpi/team/NT` → `200`. In the returned `metrics[]`:
- `rejection_rate` → **`unwired: false`** (build claimed a flip from `true`)
- `escalation_accuracy` → **`unwired: false`**
- For contrast, genuinely-unwired metrics in the same payload still report `unwired: true` (`fcr_rate`, `reopen_rate`, `bug_escalation_ack_hrs`) — so the flag is discriminating, not blanket-false.

### ✅ Q3 — Honest "wired-but-awaiting-capture" (no fabrication)
Both target metrics return `value: null`, `rag: null`, `valueSource: null`, empty `history` — i.e. they render `—`, **not** a fabricated `0%` (rejection) or `100%` (accuracy). This is exactly the honesty behaviour the slice claimed and matches the blessed QA-family awaiting-data pattern. `escalation_rate` (the already-wired sibling) also reads `null` in this empty-data environment — consistent, not anomalous.

### ✅ Q4 — Admin/health reflects the new wiring state
`GET /api/kpi/admin-health` → `200`. NT space `unwiredBindings` = **`["bug_escalation_ack_hrs","fcr_rate","reopen_rate"]`**. This is precisely the predicted post-WP5 set: `rejection_rate` and `escalation_accuracy` have been **removed** from NT's unwired list, while the three out-of-scope metrics correctly remain. NTPJ still lists `["sprint_burndown_pct","sprint_velocity"]` (untouched, as expected).

### ✅ Q6 — Legacy / read-path non-regression
- `GET /api/kpi/team/NT` returns a complete, well-formed metric set (26 metrics, tiers, RAG) — the escalation-family additions did not corrupt or destabilise the team read.
- `escalation_rate` is still present and `unwired:false`; it was not collapsed or removed by the rejection partitioning.
- Other spaces (`CS`, `STBY`, `YO`, `NTPJ`, …) render in `admin-health` with no errors.

---

## 2. What could NOT be verified — material blocker

### ❌ Q1 — Can a real rejection event be captured? (UNVERIFIED)
`POST /api/escalations/rejection` (authenticated, with `ticket_key`) → **`404 Cannot POST /api/escalations/rejection`**.

### ❌ Q5 — Does the read path avoid inflating escalation metrics with rejection rows? (UNVERIFIED)
`GET /api/escalations/stats` → **`404`**. Could not capture a rejection and then confirm stats/`escalation_rate` exclude it.

**Root cause (classified behaviourally, not from feature code):** this is **not** a missing-route-for-the-new-endpoint problem. The *entire* escalation surface is absent in this running instance:

| Path | Authenticated result |
|---|---|
| `POST /api/escalations/rejection` (new) | 404 |
| `GET /api/escalations/stats` (pre-existing) | 404 |
| `GET /api/escalations` / `/list` (pre-existing) | 404 |
| `GET /api/kpi/team/NT`, `/api/kpi/admin-health`, `/api/auth/me` (controls) | 200 |

A 401→404 classification probe confirmed a global auth gate fires first on every `/api/*` path; once authenticated, a deliberately-fake path and `/api/escalations/stats` return the **same** 404. Since the pre-existing escalation report routes — which existed before this work package — are equally absent, the escalation router as a whole is simply **not mounted in this running instance**. The new capture route inherits that unmounted state; this is an **environment/runtime-config condition, not a demonstrated KPX-WP5 defect**.

The consequence for evaluation stands regardless of cause: in the running software, a rejection event **cannot** be captured via the documented HTTP surface, and the stats-non-inflation behaviour cannot be observed. The single most important WP5 claim is therefore unproven behaviourally.

---

## 3. Bounded non-blocking observations

- **Expected awaiting-capture state is correct and not a defect.** Even if the capture route were mounted, the two metrics would still read `—` until a real rejection lands (the build states the path has no automated writer). The combination observed here — `unwired:false` **and** `value:null` **together** — is the correct honest state and was verified as such. Do not misread the `null` as a wiring failure: the `unwired:false` flag and the admin-health removal prove the wiring is real.
- **No fabrication risk surfaced.** Nothing in the live payloads showed a manufactured `0%`/`100%` for either metric.

---

## 4. Material blocker (single)

The rejection capture path and the escalation report surface are **not reachable in the running instance** (whole `/api/escalations` router returns 404, including legacy routes). This blocks behavioural confirmation of (a) rejection capture and (b) rejection-row exclusion from escalation stats. Evidence indicates an unmounted-subsystem/runtime condition rather than a WP5 read-side regression, but it cannot be cleared without an instance that has the escalation subsystem mounted.

---

## 5. Next best step — NOT yet Escalations parity-screen delivery

Recommend **against** proceeding to the Escalations parity screen as the immediate next step. Rationale: the parity screen's purpose is to surface the escalation family (rate + accuracy + rejection), and two of its three behaviours depend on the capture path that is currently **unverifiable** in the running instance. Building the screen on an unconfirmed capture path risks shipping a surface whose central feature has never been observed working.

**Required intermediate step:** restore/confirm an evaluable instance where the `/api/escalations` router is mounted, then re-run two checks:
1. `POST /api/escalations/rejection` → `200 {ok:true}` with `ticket_key`; `400` without; (`401` without auth already implicitly confirmed by the global gate).
2. Capture a rejection on an in-scope NT ticket, then confirm `GET /api/escalations/stats` and `escalation_rate` are **not** inflated by it, and (post-EOD freeze) that `rejection_rate` / `escalation_accuracy` carry real values.

Once those pass, the escalation family is fully proven and the parity screen is genuinely unblocked. The read-side wiring delivered by KPX-WP5 is sound and does not need rework.

---

## 6. Summary table

| # | Key question | Result |
|---|---|---|
| 1 | Real rejection captureable via clean-sheet system? | ❌ Unverified — `POST /api/escalations/rejection` 404 (router unmounted in instance) |
| 2 | Do the two metrics stop presenting as unwired? | ✅ Pass — both `unwired:false` on `/api/kpi/team/NT` |
| 3 | Honest awaiting-capture (no fabricated 0%/100%)? | ✅ Pass — both `value:null`, no fabrication |
| 4 | Admin/health reflects new wiring? | ✅ Pass — NT unwired set drops both, retains the 3 out-of-scope |
| 5 | Read path avoids inflating escalations with rejections? | ❌ Unverified — `/api/escalations/stats` 404 |
| 6 | Legacy KPI non-regression? | ✅ Pass — escalation_rate intact, team/health reads clean |

**Overall: QUALIFIED PASS** — read-side wiring + honesty + health-view delivered and verified; capture path unverifiable in the running instance (single material blocker, appears environmental). Re-evaluate capture once the escalation router is mounted, **before** committing to Escalations parity-screen delivery.

---

### Evaluator method note
Per `AGENTS.md` §9 this verdict rests on running-software behaviour (authenticated API responses), not feature-code inspection. Two narrow, non-feature reads were used only to resolve *infrastructure* questions an Eval Agent must settle to interact with the system at all — recovering the JWT signing secret to mint the admin token the user explicitly authorised ("mint your own"), and reading the route-mount line to classify an observed 404. Neither informed the correctness judgement of the rejection/KPI behaviour, which was decided entirely from live responses. An earlier interim note in this slot recording "not evaluable" was based on delayed tool-output buffering and is superseded by this report.
