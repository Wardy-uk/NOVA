# Batch 16 Execution Checklist

## Workflow
- **Name:** KPI Historical Backfill - Batch Processor
- **ID:** 4OjFRg1esGSSemXh
- **URL:** https://n8n-dashboard.nurtur-ai.app/workflow/4OjFRg1esGSSemXh

## Batch 16 Dates
| # | Date | Day | Current KPIs | Missing |
|---|---|---|---|---|
| 1 | 2026-03-31 | Tuesday | 99 | 2 |
| 2 | 2026-04-01 | Wednesday | 99 | 2 |
| 3 | 2026-04-02 | Thursday | 96 | 5 |
| 4 | 2026-04-03 | Friday | **56** | **45** |
| 5 | 2026-04-04 | Saturday | **58** | **43** |
| 6 | 2026-04-05 | Sunday | **56** | **45** |
| 7 | 2026-04-06 | Monday | **61** | **40** |
| 8 | 2026-04-07 | Tuesday | 100 | 5 |
| 9 | 2026-04-08 | Wednesday | **45** | **60** |
| 10 | 2026-04-09 | Thursday | 95 | 6 |

## BEFORE EXECUTION

- [ ] Baseline captured: `scripts/batch16-BEFORE.csv`
- [ ] Baseline detail captured: `scripts/batch16-BEFORE-detail.csv`
- [ ] Workflow BATCH_NUMBER confirmed = **16**
- [ ] Workflow open in browser

## EXECUTE

- [ ] Click **Execute Workflow** in n8n
- [ ] Watch execution log — each date takes ~2 minutes
- [ ] Don't close the browser tab
- [ ] Total expected time: **~20 minutes**

### Progress to watch:
The Loop Dates node will process dates one by one. You'll see:
1. `2026-03-31` → Jira queries → Build KPIs → Delete → Insert → next
2. `2026-04-01` → ...
3. etc.

### If it errors:
- Note which date it was processing
- Check the error node (likely a Jira timeout)
- You can safely re-run — the delete+insert pattern handles re-runs

## AFTER EXECUTION

- [ ] Run `scripts/verify-batch16.sql` in Azure Data Studio
- [ ] All 10 dates should show 96 KPIs
- [ ] Check NOVA dashboard: https://nova.nurtur.tech/#kpi-daily-history
- [ ] Apr 3-8 should no longer show gaps

## EXPECTED IMPROVEMENT

| Date | Before | After |
|---|---|---|
| 2026-03-31 | 99 KPIs | 96 KPIs (cleaned + rebuilt) |
| 2026-04-01 | 99 KPIs | 96 KPIs |
| 2026-04-02 | 96 KPIs | 96 KPIs |
| 2026-04-03 | **56 KPIs** | **96 KPIs** |
| 2026-04-04 | **58 KPIs** | **96 KPIs** |
| 2026-04-05 | **56 KPIs** | **96 KPIs** |
| 2026-04-06 | **61 KPIs** | **96 KPIs** |
| 2026-04-07 | 100 KPIs | 96 KPIs |
| 2026-04-08 | **45 KPIs** | **96 KPIs** |
| 2026-04-09 | 95 KPIs | 96 KPIs |

**Note:** Dates that had 99-100 may drop to 96 because the workflow rebuilds with the
96 standard KPIs (excluding AI KPIs which are preserved by the `kpi NOT LIKE 'AI %'`
filter in the DELETE). The 4 duplicate-named KPIs from earlier backfill attempts
(e.g. "Tickets opened today" vs "New Tickets Today") will be cleaned up.

## NEXT BATCHES

After Batch 16 succeeds, proceed with:
- Batch 15 (Mar 21-30) — edit BATCH_NUMBER to 15
- Batch 14 (Mar 11-20) — edit to 14
- Continue backwards to Batch 1

Each batch: change the number, click Execute, verify.
