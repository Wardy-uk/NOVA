# BF-005: Cross-Check Ticket Set

**Frozen:** 2026-05-20
**Sub-Slice:** All (WS1-A/B/C)
**Source Evidence:** ws1_eval_report_01.md

---

## Purpose

Reference set of 16 Jira tickets used during independent evaluation. These tickets serve as known-good reference points for future regression cross-checks if needed.

## Resolution SLA Cross-Check Tickets (8)

| Ticket | Tier | Cache State | Live Jira State | Match |
|--------|------|------------|-----------------|-------|
| NT-18151 | Tier 2 | breached | breached=true | MATCH |
| NT-18476 | Tier 3 | breached | breached=true | MATCH |
| NT-9438 | Development | breached | breached=false | MISMATCH (stale cache) |
| NT-9348 | Development | breached | breached=false | MISMATCH (stale cache) |
| NT-15900 | Development | breached | breached=true | MATCH |
| NT-19316 | Customer Care | not-breached | breached=false | MATCH |
| NT-19244 | Customer Care | not-breached | breached=false | MATCH |
| NT-19233 | Customer Care | not-breached | breached=false | MATCH |

**Result:** 6/8 match (75%). 2 mismatches explained by sync timing drift on old Development tickets.

## FRT Cross-Check Tickets (8)

| Ticket | Cache FRT | Live FRT | Match |
|--------|-----------|----------|-------|
| NT-19316 | present | present (breached=false) | MATCH |
| NT-18151 | present | present (breached=true) | MATCH |
| NT-18476 | present | present (breached=true) | MATCH |
| NT-19244 | present | present (breached=false) | MATCH |
| NT-9438 | present | present (breached=true) | MATCH |
| NTPJ-7787 | absent | absent | MATCH |
| NTPJ-7258 | absent | absent | MATCH |
| NTPJ-7735 | absent | absent | MATCH |

**Result:** 8/8 match (100%).

## Usage

These tickets are frozen reference data. They are NOT re-checked on every regression run (tickets change state organically). They exist as audit evidence that the evaluation was grounded in verifiable Jira data.
