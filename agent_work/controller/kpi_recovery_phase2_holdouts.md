# KPI Recovery Phase 2 Holdouts

Restricted: Manager / Evaluator use only. Do not share with Build Agent.

## Holdout Themes

- detect apparent daily capture that does not actually freeze official rows
- detect timezone handling that works for UK spaces but not STBY
- detect RAG outcomes that are effectively hardcoded despite configurable tables

## Holdout Scenarios

1. The daily endpoint exists, but no real write path lands in `kpi_daily` or `kpi_eod_snapshot`.
2. UK EOD capture works but STBY is treated as another UK space rather than its own Asia/Kolkata schedule.
3. RAG values appear, but changing stored target or amber-band config would not actually alter the result.
4. Agent-daily output is claimed broadly, but no implemented agent-level metric is genuinely frozen into `kpi_agent_daily`.
