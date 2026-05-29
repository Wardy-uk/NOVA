# P0-WP1 — Live Prerequisite Audit Findings

**Work package:** P0-WP1 — Live prerequisite audit for the clean-sheet KPI recovery programme
**Date of inspection:** 2026-05-29
**Scope:** Inspect and report only. No Phase 1 implementation performed.
**Environment inspected:** NOVA primary MSSQL schema (`src/server/db/schema.ts`), live Jira cache sync (`src/server/services/jira-sync-service.ts`), and the Express route surface (`src/server/index.ts`).

---

## A. `jira_issue_cache` prerequisite field audit

| # | Required field | Verdict | Evidence |
|---|----------------|---------|----------|
| 1 | First public comment timestamp | **Present but needs interpretation / mapping clarification** | See A1 |
| 2 | Resolution date | **Present and directly usable** | See A2 |
| 3 | Satisfaction rating | **Present but needs interpretation / mapping clarification** | See A3 |
| 4 | Labels array | **Present but needs interpretation / mapping clarification** | See A4 |
| 5 | NTPJ story points custom field | **Missing** | See A5 |

### A1. First public comment timestamp — *present but needs mapping*
- `jira_issue_cache` has `last_public_comment` and `last_public_comment_updated_at` ([schema.ts:639-642](src/server/db/schema.ts#L639-L642)). These are **not** suitable as-is for a first-response metric:
  - They track the **last** public comment, not the **first** (`ORDER BY c.jira_created DESC` in [jira-sync-service.ts:572-586](src/server/services/jira-sync-service.ts#L572-L586)).
  - `last_public_comment_updated_at` is set to `GETUTCDATE()` (the sync time), **not** the comment's Jira timestamp.
- The **first** public comment timestamp **is derivable** from `jira_comment_cache`, which stores per-comment `is_public BIT` and `jira_created DATETIME2`, indexed on `(issue_key, jira_created DESC)` ([schema.ts:646-661](src/server/db/schema.ts#L646-L661)). i.e. `MIN(jira_created) WHERE issue_key = ? AND is_public = 1`.
- Additionally, the JSM **First Reply Time SLA** object (`customfield_14046`) is fetched and persisted into `fields_json` ([jira-sync-service.ts:36](src/server/services/jira-sync-service.ts#L36), [:340](src/server/services/jira-sync-service.ts#L340)), but as a raw nested SLA object requiring parsing.
- **Mapping clarification required:** decide whether the clean-sheet design reads first-response from the derived `MIN()` over `jira_comment_cache`, or from the First Reply Time SLA field in `fields_json`. There is **no dedicated first-comment-timestamp column** on `jira_issue_cache`.

### A2. Resolution date — *present and directly usable*
- `jira_issue_cache.resolved_at DATETIME2 NULL` ([schema.ts:635-636](src/server/db/schema.ts#L635-L636)), populated directly from Jira's `resolutiondate` field on every sync ([jira-sync-service.ts:413](src/server/services/jira-sync-service.ts#L413), [:432](src/server/services/jira-sync-service.ts#L432)). Directly usable, no mapping needed.

### A3. Satisfaction rating — *present but needs mapping*
- CSAT is fetched as `customfield_12802` (Customer Satisfaction) and is included in `ALL_FIELDS` ([jira-sync-service.ts:43](src/server/services/jira-sync-service.ts#L43)).
- It is **not** extracted to a dedicated column. It is only persisted inside the raw `fields_json` blob (`fields_json = JSON.stringify(f)`, [jira-sync-service.ts:340](src/server/services/jira-sync-service.ts#L340)).
- **Mapping clarification required:** the clean-sheet design must parse `customfield_12802` out of `fields_json` (a nested option object), or the sync must be extended to surface it as a first-class column. Data is present in the cache; it is not directly queryable as a typed column.

### A4. Labels array — *present but needs mapping*
- `jira_issue_cache.labels NVARCHAR(1000) NULL` ([schema.ts:602](src/server/db/schema.ts#L602)).
- Stored as a **`;`-joined string**, not a JSON array: `Array.isArray(f.labels) ? (f.labels as string[]).join(';') : null` ([jira-sync-service.ts:338](src/server/services/jira-sync-service.ts#L338)).
- **Mapping clarification required:** consumers must split on `;`. It is not an array/JSON column. The 1000-char width also caps very heavily-labelled issues.

### A5. NTPJ story points custom field — *missing*
- The story points custom field is **not present anywhere in the cache pipeline**:
  - It is **not** in the `ALL_FIELDS` fetch list ([jira-sync-service.ts:19-44](src/server/services/jira-sync-service.ts#L19-L44)), so it is **never requested from Jira** and therefore is **not** in `fields_json` either.
  - There is **no story-points column** on `jira_issue_cache`.
  - A codebase-wide search for a story-points field id (`story.?point`, `customfield_10016`) returned **no matches** in `src/server`.
- NTPJ rows themselves **do** exist in the cache (the sync covers projects from `agent_jira_project`, configurable as `NT,NTPJ`, and the assignment engine queries `WHERE c.project_key = 'NTPJ'` against `jira_issue_cache` — [assignment-engine.ts:751](src/server/services/assignment-engine.ts#L751)). The **rows** are present; the **story points field on those rows is not**.

---

## B. Route-prefix safety audit

**The `/api/kpi/*` namespace is NOT clean — it is already partially occupied by exactly one endpoint.**

- Existing registration: `app.post('/api/kpi/derived/run', requireRole('admin', 'super_admin'), ...)` ([index.ts:1208](src/server/index.ts#L1208)). This triggers a manual derived-KPI pipeline run.
- This is the **only** path under `/api/kpi/*`. A precise search for any `/api/kpi` route that is not `/api/kpi-data` returned this single inline route and nothing else.
- The legacy families the brief expects to leave untouched are confirmed separate and will **not** collide with a `/api/kpi/*` mount (Express matches mount paths on segment boundaries, so `/api/kpi` does not capture `/api/kpi-data`):
  - `app.use('/api/kpi-data', ...)` ([index.ts:1033](src/server/index.ts#L1033))
  - `app.use('/api/trends', ...)` ([index.ts:1056](src/server/index.ts#L1056))

**Implication:** Introducing a new `/api/kpi/*` router is feasible but the namespace is not empty. Any new router must (a) not redefine `POST /api/kpi/derived/run`, and (b) be mounted so it does not shadow that existing inline handler. Per the Manager Decision Rule ("if `/api/kpi/*` collides with an existing route family"), this pre-existing occupancy needs an explicit decision: either claim the namespace and absorb/relocate `/api/kpi/derived/run`, or pick a different prefix.

---

## C. Manager decision — Phase 1 status

### **BLOCKED**

Two independent blockers, both matching the Manager Decision Rule:

1. **Missing field (hard block per rule):** the **NTPJ story points custom field is missing** — it is not fetched, not stored in any column, and not present in `fields_json`. Per the rule "If any required `jira_issue_cache` field is missing, Phase 1 is blocked until the sync is extended."

2. **Route namespace not clean (block per rule):** `/api/kpi/*` is **already partially occupied** by `POST /api/kpi/derived/run`. Per the rule "If `/api/kpi/*` collides with an existing route family, Phase 1 is blocked until the route plan is reclassified."

### Prerequisite extensions required to unblock

- **Sync extension:** Add the NTPJ story points custom field id to `ALL_FIELDS` in `jira-sync-service.ts` and either expose it as a dedicated typed column on `jira_issue_cache` (preferred for the clean-sheet design) or document that it must be parsed from `fields_json`. The story points field id must first be confirmed against the live NTPJ project metadata (not present anywhere in the current codebase).
- **Route-plan reclassification:** Decide ownership of the `/api/kpi/*` prefix — either fold the existing `POST /api/kpi/derived/run` into the new clean-sheet router (and guarantee mount order), or assign the clean-sheet endpoints a non-colliding prefix.

### Fields that are *not* blockers (already present; only mapping clarification needed)

- First public comment timestamp — derive `MIN(jira_created)` over `is_public = 1` rows in `jira_comment_cache`, or parse the First Reply Time SLA from `fields_json`.
- Satisfaction rating — parse `customfield_12802` from `fields_json` (or promote to a column during the sync extension above).
- Labels — split the `;`-joined `labels` string.
- Resolution date — usable as-is via `resolved_at`.
