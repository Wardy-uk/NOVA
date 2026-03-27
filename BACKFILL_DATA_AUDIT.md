# Backfill Data Audit — Final Status
**Last updated:** 2026-03-24 09:00

---

## Confirmed Data State (as of 2026-03-24)

### IMPORTANT: API Query Note
Always use `from=2025-11-01&to=YYYY-MM-DD` params when querying NOVA API.
`days=365` is capped by the API and returns incomplete data.

---

## Stream 1 — QA Full Ticket Scoring
| Metric | Value |
|---|---|
| Table | `jira_qa_resultsUAT` |
| Total rows | 7,507 |
| Distinct tickets | 7,507 (1 row per ticket) |
| Issue range | NT-116 → NT-13452 |
| Avg score | 7.36 (1-10 scale) |
| Green / Amber / Red | 5,624 / 1,370 / 513 |
| QA type | ticket_full only |
| vs V4 archive | 7,507 unique tickets vs 3,777 — 2x coverage |

**Note:** `processedAt` = INSERT timestamp (Mar 22-23), not resolution date.
Ticket coverage is historical (NT-116 onwards). "Date gaps" vs archive are an
artifact of processedAt being insert time, not resolution time.
V4's missing tickets are from deprecated ticket_closure/comment_reply QA types
that V5's ticket_full approach supersedes.

**Verdict: ✅ COMPLETE**

---

## Stream 2 — Golden Rules Scoring
| Metric | Value |
|---|---|
| Table | `Jira_QA_GoldenRulesUAT` |
| Total rows | 11,649+ |
| Comment date range | Oct 31, 2025 → Mar 23, 2026 |
| Distinct comment days | 99 |
| Avg score | 1.80 (1-3 scale) |
| vs V4 archive | 11,649 rows vs 7,367 — 58% more, wider coverage |

**Known gaps:** 12 dates missing (Feb 28 – Mar 13)
These dates had data in V4 but haven't been backfilled in V5 yet.

**Action needed:** Run `QA_GoldenRules_Backfill` with `startDate=2026-02-28`,
`endDate=2026-03-13` to close the gap.

**Verdict: ⚠️ PARTIAL — 12 dates missing (Feb 28 – Mar 13)**

---

## Stream 3 — Team KPI Daily
| Metric | Value |
|---|---|
| Table | `jira_kpi_daily` |
| Total rows | 8,997 |
| Date range | Nov 1, 2025 → Mar 23, 2026 (142 days) |
| KPIs per day | 61-65 (consistent, variation = KPIs added over time) |
| Date gaps | 0 |
| Mar 22 | Missing (Sunday — live workflow skipped) |
| vs V4 archive | 8,997 rows vs 3,835 — 2.3x more, 47 more days |

**Note:** 21 KPI names in archive not in new table — all deprecated CC/Tier
queue definitions that were restructured. Not data loss, expected difference.

**Low days (58 KPIs):** Dec 20, 25-27, Jan 3 (holidays — expected)
**Saturday days (59 KPIs):** Mar 7, 14, 21 (weekend queue activity — expected)

**Verdict: ✅ COMPLETE**

---

## Stream 4 — Agent KPI Daily
| Metric | Value |
|---|---|
| Table | `jira_agent_kpi_daily` |
| Total rows | 2,002 (after phantom agent cleanup) |
| Date range | Nov 1, 2025 → Mar 23, 2026 (143 days) |
| Agents per day | 14 (confirmed correct) |
| Date gaps | 0 |
| vs V4 archive | 2,002 rows vs 214 — 9x more, 126 more days |

**Phantom agents removed (5):** Prasanna Prabakar, Kieran Eccles,
Jerson Arokianathan, Kannan Gandhigram Rajendran, Nicki Wilson
(715 rows deleted — these agents were never part of the support team)

**Former agents (2):** Lucy Read, Toby Hunter — absent from new table
(left before backfill ran — their historical data is not required)

**Active agents (14):** Abdi Mohamed, Arman Shazad, Heidi Power, Hope Goodall,
Isabel Busk, Kayleigh Russell, Luke Scaife, Naomi Wentworth, Nathan Rutland,
Nick Ward, Sebastian Broome, Stephen Mitchell, Willem Kruger, Zoe Rees

**QA/GR fields:** 100% NULL — expected for backfilled data. Live workflow
populates these daily. Cannot be retroactively filled for historical dates.

**Verdict: ✅ COMPLETE**

---

## Summary

| Stream | Old Rows | Old Range | New Rows | New Range | Verdict |
|---|---|---|---|---|---|
| QA FullQA | 20,161 (3,777 tickets) | Dec 5 – Mar 20 | 7,507 tickets | NT-116 → NT-13452 | ✅ COMPLETE |
| Golden Rules | 7,367 | Jan 6 – Mar 20 | 11,649 | Oct 31 – Mar 23 | ⚠️ PARTIAL |
| KPI Team | 3,835 | Dec 5 – Mar 20 | 8,997 | Nov 1 – Mar 23 | ✅ COMPLETE |
| Agent KPI | 214 | Feb 20 – Mar 20 | 2,002 | Nov 1 – Mar 23 | ✅ COMPLETE |

---

## Remaining Actions

- [ ] Golden Rules gap fill: run `QA_GoldenRules_Backfill` with dates 2026-02-28 → 2026-03-13
- [ ] Promote KPI Team + Agent KPI from current tables to live (Nick must confirm)
- [ ] Promote QA FullQA from UAT to live (Nick must confirm)
- [ ] Promote Golden Rules from UAT to live (after gap fill confirmed)
- [ ] Update NOVA QA grade thresholds for V5 scale (Green ≥7.5, Amber ≥5.5, Red <5.5)
- [ ] Update Ticket_QA_V5 to write to live tables (after promotion)
- [ ] Activate Ticket_QA_V5 (`jR8hKoPF4QOAEM1h`) after promotion
- [ ] AI Digest backfill (low priority — separate task)
- [ ] Fix Trends screen bugs (5 issues — CC task in progress)
- [ ] Golden Rules Feb 28 – Mar 13 gap fill
