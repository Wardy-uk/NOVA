# P0-WP2 — Blocker Closure Report

**Work package:** P0-WP2 — Close or crisply classify the two prerequisites blocking Phase 1.
**Date of inspection:** 2026-05-29
**Inputs:** Live Jira (`nurturtech.atlassian.net`, cloudId `9357a1ba-…`) via Atlassian MCP; live NOVA MSSQL (`bym-asqlep01.database.windows.net/NOVA`) via read-only SELECT; source inspection of `jira-sync-service.ts` and `index.ts`.
**Code changes in this WP:** 2 additive lines in `src/server/services/jira-sync-service.ts` `ALL_FIELDS` (prerequisite-level only — no Phase 1 foundation work). No route code changed.

---

## 1. NTPJ Story Points — source-of-truth finding

### Field identity (confirmed against live Jira)
- **Source of truth: `customfield_11706` — "Story Points".** Numeric field, present on the NTPJ "Support" issue type (issue type id `10706`), project `NTPJ` ("TPJ Maintenance and Support", project id `11808`, **company-managed** JSM — `simplified: false`).
- A second similarly-named field exists — **`customfield_12827` — "Story point estimate"** — but this is the *team-managed / next-gen* variant and is **not used** on NTPJ. It is `null` on sampled issues and has zero NTPJ issues with a value. **Do not use `customfield_12827`.**
- Evidence: the `names` map on issue `NTPJ-8062` resolves `customfield_11706 → "Story Points"` (value present) and `customfield_12827 → "Story point estimate"` (value `null`). Because NTPJ is company-managed, `customfield_11706` is the canonical field.

### Operational reality (important caveat for the Manager)
- **Story points are currently unpopulated across NTPJ.** Live JQL on the whole project:
  - `project = NTPJ AND cf[11706] > 0` → **0 issues**
  - `project = NTPJ AND cf[12827] > 0` → **0 issues**
  - Ordering `cf[11706]` descending, the **maximum stored value is 0** (the field defaults to 0 and is never set to a meaningful value).
- **This is a business-process / data-entry gap inside Jira, not a NOVA-side blocker.** The field *identity* and the *capture path* are both proven; the team simply isn't entering points yet. NTPJ bespoke metrics (`story_points_completed`, `sprint_velocity`, etc.) will compute to `0` until the field is populated at source.

### Sync-path closure (bounded prerequisite change made)
- Before this WP, `customfield_11706` was **not** in the sync fetch list, so it was absent from `fields_json` (confirmed live: `0 / 2005` cached rows contained the key).
- **Change made:** added `'customfield_11706'` to `ALL_FIELDS` in `jira-sync-service.ts`. It will now be captured into `fields_json` on the next sync cycle — exactly the same handling already used for CSAT (`customfield_12802`).
- NTPJ is confirmed in the live sync scope (392 NTPJ rows already in cache; the NOVA-Jira service account is actively commenting on NTPJ tickets), so no sync-scope change is needed.

### Classification after closure
**Present but requiring mapping** (parse `customfield_11706` out of `fields_json`) — the same tier as CSAT/labels, which WP1 already deemed non-blocking. It is **no longer "missing."** Promoting it to a dedicated typed column would make it "directly usable," but that is a Phase 1 design choice, not a prerequisite, so it was deliberately **not** done here.

---

## 2. `/api/kpi/*` namespace — route finding

### What occupies the namespace
- Exactly **one** existing endpoint lives under `/api/kpi/*`: `POST /api/kpi/derived/run` (inline app-level route, `src/server/index.ts:1208`, admin/super_admin only). It triggers the **legacy** KPI pipeline (`kpiPipeline.collectDerivedKpis()` → `techservicesjsm`). A precise search confirms no other `/api/kpi/*` route exists (and `/api/kpi-data/*`, `/api/trends/*` are separate families that Express matches on segment boundaries — they do not collide).

### Can the clean-sheet family coexist?
**Yes — `/api/kpi/*` remains viable; no reclassification required.**
- The clean-sheet design's planned endpoints (spec §9: `/api/kpi/spaces`, `/snapshot/:spaceKey`, `/daily/...`, `/agent/...`, `/eod/:date`, `/slt`, `/digest/:date`, `/daily-report/:date`, `/leaderboard/...`, `/manual-entry`, `/import`, `/backfill`, `/recompute/:date`, `/health`) include **no** `derived/run` path, and **none** is a greedy top-level single-segment parameter that could swallow `/derived/run`. There is therefore zero path overlap.
- A new `app.use('/api/kpi', cleanSheetRouter)` will coexist with the existing inline route regardless of mount order, provided the new router does not itself define `POST /derived/run` (the design does not).
- Per the design's "everything new, nothing modified" rule, the legacy `POST /api/kpi/derived/run` should be **left in place**. Relocating it is optional Phase 1 tidy-up, not a prerequisite.

**No route code was changed in this WP** — none is required to make the namespace safe.

---

## 3. Additional prerequisite gap discovered via live evidence — `resolved_at` (resolution date)

While strengthening evidence (task C), live data revealed a real gap that the clean-sheet resolution metrics depend on:

- **`resolved_at` is NULL for 100% of cached rows (0 / 2004)** — including **1,411 `done`-category tickets**, of which 873 have a `resolution_name`. So the column is structurally present and the mapping code exists (`jira-sync-service.ts:414,433` read `f.resolutiondate`), but it is empty in practice.
- **Root cause:** `ALL_FIELDS` fetched the `resolution` *object* but **not** the `resolutiondate` *system timestamp*. Sampled `done` tickets show `resolutiondate` **absent from `fields_json` entirely** → `f.resolutiondate` is always `undefined` → `resolved_at` never populates.
- This corrects WP1's "resolution date — present and directly usable" call: the column exists but live data is empty.
- **Bounded closure made (same class as story points):** added `'resolutiondate'` to `ALL_FIELDS`. The existing mapping at lines 414/433 will now populate `resolved_at` on the next sync. One additive string entry, no behaviour change to existing logic.
- **Note on backfill:** going forward, newly-synced/updated tickets will populate `resolved_at`. Historical rows fill in as they are re-fetched by the sync; a full retroactive backfill remains a Phase 1 concern (already anticipated in design §8.3).

---

## 4. Read-only live evidence summary (NOVA MSSQL cache)

| Check | Result |
|-------|--------|
| Cache rows by project | NT 868, YO 744, NTPJ 392 (total ~2,004). **No STBY rows present** (see §5). |
| `status_category` | done 1,411 · indeterminate 412 · new 182 |
| `resolved_at` populated | **0 / 2,004** → closed via §3 fix |
| `resolution_name` populated (done) | 873 / 1,411 |
| `resolutiondate` in `fields_json` (done sample) | **absent** → root cause of `resolved_at` gap |
| `labels` populated | 943 / 2,004; stored as `;`-joined string (sample: `No_Contact_In_Dynamics`) → present, needs split-mapping |
| `last_public_comment` body | 1,547 / 2,004 |
| `last_public_comment_updated_at` | 1,998 / 2,004 — but this is the **sync timestamp**, not the comment's Jira time (per WP1) |
| CSAT `customfield_12802` in `fields_json` | **2,004 / 2,004** → present, needs mapping |
| Story points `customfield_11706` in `fields_json` | **0 / 2,005** (pre-resync) → closed via §1 fix |
| First-public-comment derivability | `jira_comment_cache`: 46,501 comments, 21,436 public, 5,796 issues. `MIN(jira_created) WHERE is_public=1` per issue verified to return clean first-response timestamps (sample confirmed) |

---

## 5. Observations logged for the Manager (not WP2 blockers)

These are outside the two named blockers and are **not fixed here** (per AGENTS.md §7 — log, don't expand mid-phase):

1. **NTPJ story points are unpopulated at source** (all-zero in Jira). The capture path is ready, but NTPJ velocity/story-point metrics will read 0 until the team enters points. Business-process decision for Nick.
2. **STBY has zero rows in `jira_issue_cache`.** The clean-sheet design lists STBY (Starberry) as a Jira space, but it is not currently in the sync scope. Adding STBY is a settings change (`agent_jira_project` / `assignment_projects`), not code — but it is a Phase 1 data prerequisite for STBY metrics.
3. A **sync cycle must run** after this WP for `resolved_at` and `customfield_11706` to appear in cache; the columns/`fields_json` fill via the existing MERGE on the next cycle.

---

## 6. Phase 0 decision

### Both named blockers are CLOSED. Phase 0 is CLEARED to open Phase 1.

| Blocker | Status | Basis |
|---------|--------|-------|
| NTPJ story points | **Closed** | Field identity confirmed (`customfield_11706`); sync extended to capture it; now "present but needs mapping" (was "missing"). |
| `/api/kpi/*` namespace | **Cleared** | Viable as-is; the single legacy endpoint does not collide with any planned clean-sheet endpoint. No reclassification needed. |

### Remaining blockers
**None** at prerequisite level for the two named items. The §5 observations (NTPJ source data, STBY scope, mandatory re-sync) are Phase 1 inputs/decisions, not Phase 0 gates.

### Bounded changes made in this WP
- `jira-sync-service.ts` `ALL_FIELDS`: `+ 'customfield_11706'` (story points), `+ 'resolutiondate'` (resolution date). Both additive, consumed by existing code, no Phase 1 foundation work.
