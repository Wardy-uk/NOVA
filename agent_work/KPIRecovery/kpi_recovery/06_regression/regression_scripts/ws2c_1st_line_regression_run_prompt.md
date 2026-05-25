Execute the existing 1st Line Resolution regression check against the live system and produce the next 1st Line regression report.

Required output naming:

- Run 02 -> `ws2c_1st_line_regression_report_run02.md`
- Run 03 -> `ws2c_1st_line_regression_report_run03.md`

Use the frozen baseline and script already created for this slice:

- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\frozen_baselines\bf_013_ws2c_1st_line_resolution.md`
- `C:\Users\NickW\Claude\windows automation\daypilot\agent_work\KPIRecovery\kpi_recovery\06_regression\regression_scripts\ws2c_1st_line_regression_check.mjs`

Report:

- result of each regression check
- any drift from baseline
- whether the run is clean enough to count toward TRUSTED
