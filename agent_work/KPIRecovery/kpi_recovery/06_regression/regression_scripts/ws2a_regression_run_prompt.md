Execute the existing WS2-A regression check against the live system and produce the next WS2-A regression report.

Required output naming:

- Run 02 -> `ws2a_regression_report_run02.md`
- Run 03 -> `ws2a_regression_report_run03.md`

Use the frozen baselines and script already created for WS2-A:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_011_ws2a_escalation_activity.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_012_ws2a_rejection_behaviour.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_scripts\ws2a_regression_check.mjs`

Report:

- result of each regression check
- any drift from baseline
- whether the run is clean enough to count toward TRUSTED
