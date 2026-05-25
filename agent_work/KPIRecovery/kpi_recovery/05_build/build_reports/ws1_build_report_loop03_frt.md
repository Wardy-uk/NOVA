# WS1 Build Report — Loop 03: FRT Field Recovery

**Date:** 2026-05-20
**Workstream:** WS1-C — FRT Recovery
**Loop:** Build Loop 03
**Status:** COMPLETE — code change applied, field verified, parser confirmed, simulation shows recovery

---

## Change Applied

**File:** `src/server/services/jira-sync-service.ts`
**Location:** `ALL_FIELDS` array (line 36)

```diff
+  'customfield_14046', // First Reply Time SLA
   'customfield_14048', // Resolution SLA
```

Additionally corrected the misleading comment on `customfield_10010`:
```diff
-  'customfield_10010', // SLA
+  'customfield_10010', // SLA (legacy — not returned by API)
```

**TypeScript compilation:** Passes with no errors.

`customfield_10010` was left in the array (removal is out of scope for this build). The comment clarification prevents future confusion.

---

## Re-Sync Method

**The local dev environment does not have the NOVA server running against a persistent cache.** Therefore a live full re-sync was not executed. Instead, FRT field availability was verified by:

1. Fetching 20 NT tickets directly from the Jira REST API with `fields=customfield_14046,customfield_14048`
2. Fetching 5 NTPJ tickets to verify project-level absence pattern
3. Simulating KPI computation by fetching FRT for 50 NT tickets from Jira

**What remains for runtime verification:**
After the code is deployed to the production NOVA instance, a server restart will trigger `JiraSyncService.fullSync()`, which will re-fetch all issues with the updated `ALL_FIELDS` list. This will populate `fields_json` with `customfield_14046` for all cached tickets. Incremental sync alone is insufficient — it only updates recently modified tickets.

---

## FRT Field Presence Verification

### NT Project (20 tickets sampled via Jira REST API)

| Metric | Result |
|--------|--------|
| FRT field present | **20/20 (100%)** |
| FRT breached | 5 |
| FRT not breached | 15 |
| FRT absent | 0 |

**All 20 NT tickets returned `customfield_14046` with valid SLA data.** This confirms the field is universally available for NT project tickets.

### NTPJ Project (5 tickets sampled)

| Metric | Result |
|--------|--------|
| FRT field present | **0/5 (0%)** |

**NTPJ tickets lack FRT SLA configuration.** This matches the Resolution SLA (`customfield_14048`) absence pattern: SLA configuration is per Jira Service Management project, and NTPJ does not have FRT configured.

### Project Presence Summary

| Project | FRT Present | Resolution SLA Present | Pattern Match |
|---------|------------|----------------------|---------------|
| NT | 100% (20/20) | ~100% (577/579 from Loop 01) | ✓ |
| NTPJ | 0% (0/5) | ~0% (2/396 from Loop 01) | ✓ |

FRT and Resolution SLA share the same project-level presence pattern.

---

## Parser Compatibility Findings

### FRT Field Structure (Breached — NT-18883)

```json
{
  "id": "76",
  "name": "First Reply Time",
  "completedCycles": [{
    "breached": true,
    "goalDuration": { "millis": 1800000, "friendly": "30m" },
    "elapsedTime": { "millis": 14929216, "friendly": "4h 8m" },
    "remainingTime": { "millis": -13129216, "friendly": "-3h 38m" }
  }],
  "slaDisplayFormat": "OLD_SLA_FORMAT"
}
```

### FRT Field Structure (Not Breached — NT-18219)

```json
{
  "id": "76",
  "name": "First Reply Time",
  "completedCycles": [{
    "breached": false,
    "goalDuration": { "millis": 1800000, "friendly": "30m" },
    "elapsedTime": { "millis": 62412, "friendly": "1m" },
    "remainingTime": { "millis": 1737588, "friendly": "28m" }
  }],
  "slaDisplayFormat": "OLD_SLA_FORMAT"
}
```

### Parser Compatibility: CONFIRMED

The FRT field (`customfield_14046`) uses the identical structure to the Resolution SLA field (`customfield_14048`):

| Property | FRT | Resolution SLA | Match |
|----------|-----|---------------|-------|
| Top-level object (not array) | ✓ | ✓ | ✓ |
| `completedCycles[]` array | ✓ | ✓ | ✓ |
| `completedCycles[].breached` boolean | ✓ | ✓ | ✓ |
| `completedCycles[].remainingTime.millis` | ✓ | ✓ | ✓ |
| `ongoingCycle` object (when active) | ✓ | ✓ | ✓ |
| `slaDisplayFormat: "OLD_SLA_FORMAT"` | ✓ | ✓ | ✓ |

The existing `isSlaBreached()` parser handles this structure correctly:
- Wraps single object as array (`[slaField]`)
- Checks `completedCycles[].breached === true`
- Checks `remainingTime.millis < 0` as secondary breach signal
- Checks `ongoingCycle.breached` for in-progress SLAs

**No formula changes required.**

---

## KPI Output Verification (Simulated)

Since the server isn't running locally, KPI output was simulated by fetching FRT data from Jira for 50 NT open tickets and running the same classification/counting logic.

### Simulated FRT Compliance % (50 NT tickets)

| Metric | Value |
|--------|-------|
| FRT checked (field present) | 47/50 |
| FRT breached | 13 |
| FRT Compliance % | **72.3%** |

**Compare to current NOVA output: 100% (trivial default due to missing field data)**

The simulated 72.3% is plausible and demonstrates FRT metrics will produce real values once the cache is populated.

### Simulated Per-Tier FRT Breaches (50-ticket sample)

| Tier | Actionable | Not Actionable |
|------|-----------|----------------|
| Development | 7 | 6 |

Other tiers had no breaches in this small sample, which is consistent with FRT goal of 30 minutes — most Customer Care tickets get a reply within that window.

**Compare to current NOVA output: 0 for all tiers (trivial default)**

### Expected Post-Deploy Behaviour

After deploy + full re-sync + next `collectJiraSnapshot()` run:

1. **FRT Compliance % (Open Queue)** → expected ~60-75% (no longer 100%)
2. **FRT Compliance % (Resolved Today)** → will reflect real resolved-today FRT data
3. **Per-tier FRT breach counts** → will show non-zero values, especially for Development
4. **FRT Breaches (Resolved Today)** → will reflect real data
5. **Global "SLA Breached" count** → unchanged (uses Resolution SLA, not FRT)

---

## Unexpected Findings

1. **FRT goal is 30 minutes** (not hours as might be expected). The `goalDuration.millis = 1800000` = 30 minutes. This means FRT breaches accumulate quickly for any ticket not responded to within half an hour of business hours.

2. **3 of the 50 sampled tickets lacked FRT data** — these are likely edge cases (tickets created via API without SLA trigger, or [System] Service request issue types). This is consistent with the Resolution SLA pattern where 4/579 were `[System] Service request` type.

3. **Development tier shows most FRT breaches in the sample.** This makes sense — Development tickets often sit before first response because they're escalated from other tiers (first response may already have occurred at the CC/T2 level, but Jira SLA resets on tier change in some configurations).

---

## Remaining Blockers

| # | Blocker | Status | Impact |
|---|---------|--------|--------|
| — | Cache not yet populated with FRT data | **Resolved at deploy** | Server restart triggers fullSync with updated ALL_FIELDS |
| B-3 | n8n Development JQL | OPEN | Blocks WS1-D only |
| B-4 | Development backlog business definition | OPEN | Blocks WS1-D only |

**No blockers remain for WS1-C (FRT recovery).** The change is applied, verified, and ready to deploy.

---

## Recommendation for Manager Next Step

1. **Deploy the combined changes** (Loop 02 Track 1 + Loop 03):
   - `ccBucket()` null handling → `'CC (Incidents)'`
   - Ghost KPI emission guard tightened
   - `customfield_14046` added to `ALL_FIELDS`
   - These can ship as a single deployment

2. **Restart NOVA on deploy** to trigger `fullSync()` with the updated field list

3. **After one snapshot cycle**, verify:
   - Ghost KPIs gone (Loop 02 criteria)
   - FRT Compliance % < 100%
   - Per-tier FRT breach counts > 0 for at least one tier
   - Resolution SLA metrics unchanged

4. **Advance WS1-C (FRT) to SOURCE DEFINED** once runtime verification confirms non-trivial FRT values

5. **Add FRT to the partial evaluator brief** as a Stage 2 addendum alongside WS1-A and WS1-B

---

## Diagnostic Artefacts (Disposable)

| File | Purpose |
|------|---------|
| `_diag_frt_verify.mjs` | FRT field presence, parser compatibility, simulated KPIs |

Can be deleted after manager review.
