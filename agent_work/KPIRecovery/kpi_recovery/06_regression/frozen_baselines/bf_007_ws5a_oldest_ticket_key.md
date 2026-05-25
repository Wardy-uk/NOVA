# BF-007: OldestTicketKey Population Baseline

**Frozen:** 2026-05-20
**Workstream:** WS5-A (population-path recovery)
**Source Evidence:** ws5a_eval_report_01.md (EV-2), ws5a_runtime_verification_report_loop03.md (RV-2)

---

## Protected Invariant

Every agent on the breach board with OpenTickets_Total > 0 must have a non-null OldestTicketKey matching the pattern `NT-\d+`. Agents with OpenTickets_Total = 0 must have null OldestTicketKey.

## Baseline Values at Freeze

| Metric | Value | Source |
|--------|-------|--------|
| Agents with open tickets and populated OldestTicketKey | 14/14 (100%) | EV-2 live query 2026-05-20T18:56Z |
| Agents with zero tickets and null OldestTicketKey | 2/2 (100%) | EV-2 (NOVA AI, Willem Kruger) |
| Key-to-age monotonic consistency | Confirmed across all 16 agents | EV-2 cross-check |

## Full Agent Snapshot at Freeze

| Agent | OldestTicketKey | OldestTicketDays | OpenTickets_Total |
|-------|---|:---:|:---:|
| Sebastian Broome | NT-355 | 198 | 32 |
| Luke Scaife | NT-3617 | 167 | 30 |
| Arman Shazad | NT-4255 | 159 | 31 |
| Heidi Power | NT-4649 | 154 | 38 |
| Abdi Mohamed | NT-4779 | 153 | 24 |
| Stephen Mitchell | NT-4699 | 153 | 25 |
| Zoe Rees | NT-9045 | 99 | — |
| Nathan Rutland | NT-10287 | 85 | — |
| Naomi Wentworth | NT-11271 | 79 | — |
| Nick Ward | NT-13023 | 63 | 7 |
| Hope Goodall | NT-13305 | 61 | — |
| Isabel Busk | NT-16128 | 36 | — |
| Kayleigh Russell | NT-18204 | 13 | — |
| Maria Pappa | NT-18626 | 8 | — |
| NOVA AI | null | 0 | 0 |
| Willem Kruger | null | 0 | 0 |

## Regression Check

**RC-008:** For every agent on the breach board: if OpenTickets_Total > 0 then OldestTicketKey must be non-null and match `NT-\d+`; if OpenTickets_Total = 0 then OldestTicketKey must be null.

## Freeze Conditions

- Breach board endpoint: `GET /api/public/wallboard/breached`
- Deploy: Commit `6072c74` in prod HEAD `6c70d66`
- Fix location: `refreshAllAgentMetrics()` in `kpi-pipeline.ts` — OldestTicketKey populated via correlated subquery
