# CSAT cutover — go-live steps

**Target:** Friday 17 July 2026 SOAP (Red 2 → Green).
**Owner:** Nick Ward. **Built:** NOVA-hosted CSAT rating page + adoption instrumentation.

This doc covers the **out-of-NOVA** steps. The NOVA code changes are done and deployed with the branch — see "What NOVA now does" at the bottom.

---

## The one hard fact from the investigation

**Native JSM `Satisfaction` (`customfield_12802`) is NOT writable via the API.** Confirmed live against NT-24269: it's a `com.atlassian.servicedesk:sd-request-feedback` field and does **not** appear in the issue `editmeta` (33 editable fields, not one of them). It can only be set through the customer feedback flow. So:

- We cannot back-fill or write native Satisfaction. From cutover it goes to zero.
- Decision (agreed): store ratings in NOVA **and** mirror into a **new, writable** Jira field, so `"Satisfaction" is not EMPTY`-style JQL and dashboards can be repointed once and keep working.

---

## Step 1 — Create the writable mirror field (Jira admin)

1. Jira Settings → Issues → Custom fields → **Create custom field**.
2. Type: **Number**. Name: **NOVA CSAT** (description: "Customer rating 1–5, written by NOVA CSAT page").
3. Add it to the relevant screens for the **NT** project (and NTPJ if you want ratings there too). It does **not** need to be on the edit *screen* for the API write to work — API writes need it associated with the project/issue-type context — but adding it to a view screen lets you see it.
4. Note the field id (e.g. `customfield_12805`). Find it via **⋯ → View field information**, or the URL when editing the field config.
5. (Optional) Create a second **Paragraph (multi-line text)** field **NOVA CSAT Comment** for the free-text comment; note its id too.

Then in **NOVA → Admin → Settings**, set:

| Setting | Value |
|---|---|
| `csat_jira_mirror_field` | `customfield_XXXXX` (the NOVA CSAT number field) |
| `csat_jira_mirror_comment_field` | `customfield_YYYYY` (optional, the comment field) |
| `csat_accept_window_days` | `14` (how long after resolution a rating is accepted) |
| `csat_comment_mode` | **`off`** (stops NOVA's old auto-poster — the agent macro replaces it) |

> Mirror-write is **best-effort**: NOVA is the source of truth. If the Jira write fails, the rating is still safe in NOVA and the failure is logged.

**New CSAT reporting home:** repoint your CSAT JQL/dashboards from `Satisfaction` to **NOVA CSAT** (e.g. `"NOVA CSAT" >= 4`). Live NOVA view: **KPIs (Rebuild) → CSAT Adoption**.

---

## Step 2 — Update the JSM canned response

Fix the typo and repoint the link. Set the **Please rate my service** link target to:

```
https://nova.nurtur.tech/portal/csat/{{issue.key}}
```

Suggested body:

> I'd really appreciate your feedback on **how** I did today — it takes about five seconds.
> **[Please rate my service](https://nova.nurtur.tech/portal/csat/{{issue.key}})**

Notes:
- Use the **issue key** variable (`{{issue.key}}` / "Work item Key"), not a hash. NOVA now accepts the plain key.
- HMAC signing was considered and **dropped** — canned responses can only substitute `{{issue.key}}`, they can't compute a signature. The endpoint is instead guarded by: ticket-must-exist-and-be-resolved, resolved-within-14-days, first-write-wins, and IP rate-limiting.
- The macro must be run as a **public** reply for it to count toward adoption (instrumentation only counts public comments).

---

## Step 3 — Suppress CSAT on NT→NTPJ handoffs (Jira Automation)

When an NT ticket is resolved by handing off to an NTPJ ticket, the customer's problem isn't solved — don't solicit a rating.

- This is enforced by **agents not running the macro** on handoff resolutions, plus (belt-and-braces) a **Jira Automation condition**: on NT resolve, if the resolution/label indicates an NTPJ handoff (e.g. linked NTPJ issue, or resolution = "Handed off"), **do not** trigger any CSAT notification.
- NOVA does not post the link itself once `csat_comment_mode=off`, so the main lever here is agent behaviour + the automation guard.

---

## Step 4 — Disable native JSM CSAT

Project settings → **Satisfaction settings** → turn **off** "Collect customer satisfaction". This stops the native star email and the Atlassian feedback round-trip.

Do this **after** Steps 1–2 are live so there's no gap.

---

## Step 5 — Watch the experiment (from Monday)

**KPIs (Rebuild) → CSAT Adoption** (also `GET /api/csat-metrics?from=YYYY-MM-DD&to=YYYY-MM-DD`).

- **Adoption** = resolved tickets with a public `/portal/csat/` comment ÷ resolved tickets — *is the macro being run?*
- **Response** = ratings received ÷ links sent.
- Per agent and team-wide.

Interpretation: high adoption + ~1% response → mechanism was never the problem. ~30% adoption → coaching problem, not tooling. Either is worth knowing.

---

## Known failure mode (leave the design alone)

Corporate link scanners (Mimecast, Safe Links, Rocketseed) **prefetch URLs in inbound email**. The design is safe **because** the rating is captured by interaction on the page, not by a bare GET. **Do not** split this into per-rating one-click URLs (`/csat/NT-1234/5`) without solving the scanner problem first — scanners would bank ratings for you.

---

## What NOVA now does (code, shipped this branch)

- **Route** `/portal/csat/{{issue.key}}` — accepts a plain issue key (legacy hex token still works). `src/server/routes/portal-csat.ts`, client route `src/client/portal-main.tsx`.
- **Guards** — ticket must exist + be resolved + within `csat_accept_window_days`; **first-write-wins** per ticket (duplicates logged, not overwritten); **IP rate-limit** (20/min).
- **Page redesign** — `src/client/components/portal/PortalCSAT.tsx`: no login/cookie/consent gate, mobile-first, single star rating **banked on tap** (no submit button), optional comment **after** banking, thank-you confirms what was rated.
- **Mirror write** — on submit, writes the rating (and optional comment) to the configured NOVA CSAT field; best-effort.
- **Instrumentation** — `src/server/routes/csat-metrics.ts` + `src/client/components/CsatAdoptionView.tsx`.

**Caveat on the resolved-window metric:** `jira_issue_cache` has no resolutiondate column, so the adoption denominator uses `jira_updated` on Done tickets as a proxy for "resolved in window" — fine for a weekly snapshot, not an exact resolved-in-range count.
