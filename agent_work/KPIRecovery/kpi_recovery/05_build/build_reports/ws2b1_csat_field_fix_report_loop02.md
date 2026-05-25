# WS2-B-1: CSAT Field Acquisition Fix — Build Report Loop 02

**Date:** 2026-05-21  
**Status:** CODE CHANGE COMPLETE — AWAITING DEPLOY + RE-SYNC  
**Scope:** Add `customfield_12802` to Jira sync field whitelist so `parseCsat()` receives data

---

## Change Made

| Aspect | Detail |
|--------|--------|
| **File** | `src/server/services/jira-sync-service.ts` |
| **Line** | 43 (appended to `ALL_FIELDS` array) |
| **Change** | Added `'customfield_12802', // Customer Satisfaction (CSAT rating)` |
| **Diff** | Single line insertion — no other files touched |

### Before

```typescript
  'customfield_14626', // BC Account Number
];
```

### After

```typescript
  'customfield_14626', // BC Account Number
  'customfield_12802', // Customer Satisfaction (CSAT rating)
];
```

---

## Build Verification

- **TypeScript compilation:** `npx tsc --noEmit` — **passed, zero errors**
- **No other files changed** — the fix is confined to the field whitelist

---

## How This Fixes CSAT %

1. `jira-sync-service.ts` uses `ALL_FIELDS` when calling `jiraClient.searchJqlAll()` and `jiraClient.getIssue()`
2. With `customfield_12802` now in the list, the Jira REST API will return the CSAT rating field in issue responses
3. `fields_json` in `jira_issue_cache` will contain the `customfield_12802` object (when present on a ticket)
4. `parseCsat()` (kpi-pipeline.ts:153) reads `fields?.customfield_12802?.rating` — will now find actual data instead of always returning `null`
5. All three CSAT calculation sites will start producing non-zero values:
   - Team-level snapshot (kpi-pipeline.ts:440-482) → `CSAT %` in `jira_kpi_daily`
   - Derived KPI (kpi-pipeline.ts:751-763) → `CSAT % (Derived)` in `jira_kpi_daily`
   - Agent-level (kpi-pipeline.ts:1266-1283) → `CSATCount` + `CSATAverage` in `Jira_KPI_AgentDaily`

---

## Next Steps Required (Runtime, Not Code)

1. **Deploy** the updated build to production (push to `azdo`, Azure DevOps pipeline deploys)
2. **Trigger a full Jira re-sync** — existing cached tickets in `jira_issue_cache` do not have `customfield_12802` in their `fields_json`. A full sync will re-fetch all tickets with the expanded field list.
3. **Wait for next KPI pipeline run** — the daily pipeline will then read `customfield_12802.rating` from freshly-synced tickets and emit real CSAT values
4. **Validate** — check `jira_kpi_daily` for a non-zero `CSAT %` row after the next pipeline execution

### Precautions (from Loop 01 report)

- Verify `customfield_12802` actually exists in the NT Jira project (if the field doesn't exist in the project config, the API will simply not return it — no error, but still no data)
- Verify the field structure is `{ rating: number }` — if Jira returns a different shape, `parseCsat()` will still return null
- Historical `jira_kpi_daily` rows will NOT be retroactively corrected — CSAT % will populate from the deploy date forward

---

## Completion Checklist

- [x] `customfield_12802` added to `ALL_FIELDS` in `jira-sync-service.ts`
- [x] TypeScript compilation passes (zero errors)
- [x] No other files modified
- [x] Deploy + full re-sync documented as next runtime steps
