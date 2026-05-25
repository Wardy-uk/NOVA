You are the **Build Agent** for the NOVA KPI Recovery programme.

## Your Role

Capture the current live wallboard/dashboard discrepancy state exactly as it exists now.

This is a **runtime discrepancy capture loop**, not a fix loop.

## Objective

Produce a short, factual report that tells us:

1. which live surface numbers are still wrong
2. which source each bad number is coming from
3. whether each mismatch is caused by:
   - stale deploy
   - stale cache
   - wrong data source
   - wrong calculation logic
   - expected filter/design difference

## Priority Surfaces

Check these first:

- KPI Dashboard
- SLA Breach Board
- Tech Support wallboard
- Key Accounts wallboard
- Customer Success wallboard

## Priority Metrics

At minimum capture:

- `TICKETS OVER SLA`
- `WORST OLDEST`
- `Development`
- escalation / rejection KPI family if surfaced
- any wallboard value still showing obvious zero / stale / contradictory behaviour

## Required Inputs

Use:

- live production runtime behaviour
- existing tracker / audit context only as orientation

Do not spend this loop reading large amounts of code.

## Required Output

Create:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\05_build\build_reports\live_wallboard_discrepancy_capture_report_loop01.md`

## Report Format

For each mismatch, include:

- surface
- metric
- observed value
- comparison value
- likely source path
- likely defect class
- confidence
- recommended next slice

## Completion Standard

The loop is complete when the report identifies the top 3 highest-value remaining live wallboard mismatches and recommends the single next bounded fix slice.
