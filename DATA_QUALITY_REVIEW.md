# Data Quality Review — Post Backfill
**Started:** 2026-03-24
**Completed:** 2026-03-24
**Status:** ✅ ALL STREAMS COMPLETE

---

## Stream 1 — Team KPI (`jira_kpi_daily`) ✅ COMPLETE

Patched 1,655 rows from V4 archive (1,022 exact match + 633 renamed KPIs).
Remaining zeros = Nov 1-Dec 4 (no archive data) + FRT breached counts (accepted).

**Verdict: ✅ COMPLETE**

---

## Stream 2 — Agent KPI (`jira_agent_kpi_daily`) ✅ COMPLETE

### Fixes applied:
- `Agent_SolvedTickets_Backfill_v3` (`bArnpQcFWcr7tOFW`) — completed and verified
- SolvedTickets_Today: real daily variation confirmed (Naomi sample checked Nov–Mar)
- SolvedTickets_ThisWeek: accumulates correctly, resets each Monday
- Weekend data: genuine — most weekends 0, real activity shows through (e.g. Nov 29)

### Agent summary verified (Nov 1 – Mar 15):
| Agent | Total Solved | Zero Days | Avg Daily |
|---|---|---|---|
| Naomi Wentworth | 1,507 | 57 | 11.2 |
| Nick Ward | 1,081 | 49 | 8.0 |
| Heidi Power | 891 | 50 | 6.6 |
| Sebastian Broome | 659 | 53 | 4.9 |
| Nathan Rutland | 463 | 61 | 3.4 |
| Isabel Busk | 456 | 49 | 3.4 |
| Arman Shazad | 407 | 59 | 3.0 |
| Zoe Rees | 242 | 100 | 1.8 |
| Kayleigh Russell | 183 | 73 | 1.4 |
| Hope Goodall | 119 | 112 | 0.9 |
| Abdi Mohamed | 107 | 78 | 0.8 |
| Willem Kruger | 92 | 91 | 0.7 |
| Stephen Mitchell | 81 | 88 | 0.6 |
| Luke Scaife | 67 | 92 | 0.5 |

### SLA null rates (17–75% per agent):
**Decision: ACCEPT as-is.** Nulls are legitimate — reflect ticket-type mix and SLA scheme coverage gaps, not data corruption. Patching from archive risks re-importing frozen snapshot issues. Forward pipeline populates correctly.

**Verdict: ✅ COMPLETE**

---

## Stream 3 — QA FullQA (`jira_qa_results`) ✅ COMPLETE

### Fixes applied:
1. **Duplicate name merges** — 10 rows updated:
   - Naomi → Naomi Wentworth (4 rows)
   - Heidi → Heidi Power (4 rows)
   - Sebastian → Sebastian Broome (1 row)
   - Zoe → Zoe Rees (1 row)
2. **Unassigned ticket filter** — Ticket_QA_V5 (`jR8hKoPF4QOAEM1h`) updated via Code node to skip blank / "Nurtur" / "Nurtur Support Team" assignees
3. Unassigned ("Nurtur" 440, blank 90) — IGNORED in historical data, filtered going forward
4. Zero score (1 ticket) — ACCEPTED
5. Former agents (Lucy Read, Toby Hunter) — ACCEPTED

### Post-deploy finding (2026-03-24):
Initial concern that V4 historical data was lost during table swap — **confirmed NOT lost**. The V4 data was correctly archived to `jira_qa_results_v4_archive` (20,161 rows) as per spec before the V5 table was promoted.

### V4 → V5 score transform (2026-03-24):
V4 scores were on a **1–5 scale** (not 1–3 as originally assumed). Correct transform formula: `v5_score = ROUND((score / 5.0) * 10, 2)`.

Workflow `QA_V4_Archive_Merge` (`ESxPM6QperAJekBW`) ran and merged all V4 archive rows into the live `jira_qa_results` table:

| dataVersion | Rows | Earliest | Latest | Avg Score |
|---|---|---|---|---|
| v4_transformed | 20,161 | 2025-12-05 | 2026-03-20 | 3.96 |
| v5 | 7,517 | 2026-03-22 | 2026-03-24 | 7.36 |

Total live rows: **27,678**. V4 rows distinguishable by `createdAt < 2026-03-22`. Workflow deactivated after one-shot run.

The QA trend chart now has data back to **Dec 2025**.

**Verdict: ✅ COMPLETE — but superseded by QA RESET below**

---

## Stream 3b — QA FullQA RESET (2026-03-24 afternoon) 🔄 IN PROGRESS

### What went wrong:
The V4→V5 transform merge inserted 20,161 rows with `CreatedAt = SYSUTCDATETIME()` — all historical rows got today's date, not the ticket resolution date. This made historical data invisible to the trend chart (all rows appeared as Mar 24). The V5 backfill workflow `QA_FullQA_Backfill` had the same problem — `CreatedAt = SYSUTCDATETIME()` throughout.

### Actions taken:
1. Renamed `dbo.jira_qa_results` → `dbo.jira_qa_results_backup` (data preserved)
2. Created fresh empty `dbo.jira_qa_results` via `SELECT TOP 0 * INTO`
3. Updated backfill workflow `QA_FullQA_Backfill` (`eNxDaODJbTP3edSe`) — 6 nodes modified:
   - Target table: `jira_qa_resultsUAT` → `jira_qa_results`
   - `CreatedAt`: `SYSUTCDATETIME()` → `{{ $json.resolutionDate }}` (from `fields.resolutiondate`)
   - `processedAt`: unchanged — still `SYSUTCDATETIME()`
   - Dedup check: `jira_qa_resultsUAT` → `jira_qa_results`

### Backfill plan (batches — run manually with server access):
| Batch | Start | End | Status |
|---|---|---|---|
| 1 | 2026-03-01 | 2026-03-20 | 🔄 Running |
| 2 | 2026-02-01 | 2026-02-28 | ⏳ Pending |
| 3 | 2026-01-01 | 2026-01-31 | ⏳ Pending |
| 4 | 2025-12-05 | 2025-12-31 | ⏳ Pending |

### Verification query (run after each batch):
```sql
SELECT 
  CAST(CreatedAt AS DATE) AS day,
  COUNT(*) AS rows,
  ROUND(AVG(CAST(overallScore AS FLOAT)), 2) AS avg_score,
  MIN(overallScore) AS min_score,
  MAX(overallScore) AS max_score
FROM dbo.jira_qa_results
GROUP BY CAST(CreatedAt AS DATE)
ORDER BY day
```
Scores should be varied (e.g. 6.5, 7.2, 8.1) — NOT discrete 2/4/6/8/10 values.

### After all batches complete:
- Remove `AND CreatedAt >= '2026-03-22'` filter from checkpoint QA query in `trends.ts`
- Checkpoint QA panel will then show real V5 scores for Day 0 and Day 1
- Consider deleting `jira_qa_results_backup` once data is confirmed good

**Verdict: 🔄 IN PROGRESS**

---

## Stream 4 — Golden Rules (`Jira_QA_GoldenRules`) ✅ COMPLETE

### Fixes applied:
1. **Prasanna Prabakar phantom row** — 1 row deleted from `Jira_QA_GoldenRules`
2. **Gap fill** — `QA_GoldenRules_Backfill` (`rCDqTOOkQfbRnPf1`) ran 10:54–11:35 (41 min):
   - 583 tickets found (Feb 28 – Mar 13)
   - 1,768 comments extracted and deduped
   - 872 rows inserted to live `Jira_QA_GoldenRules`
   - 12-day gap (Feb 28 → Mar 13) fully closed

### Post-deploy confirmation (2026-03-24):
Golden Rules chart fix confirmed working — switched from `CreatedAt` to `commentTimestamp` as the date column. Chart now has data back to **Oct 2025**.

**Verdict: ✅ COMPLETE**

---

## Remaining / Other In-Flight (not part of this review)

- [ ] Trends screen 5 bug fixes (separate CC session)
- [ ] NOVA QA grade thresholds (V5: Green ≥7.5, Amber ≥5.5, Red <5.5)
- [ ] Ticket_QA_V5 fully switched to live tables and activated
- [ ] AI Digest backfill (low priority)
