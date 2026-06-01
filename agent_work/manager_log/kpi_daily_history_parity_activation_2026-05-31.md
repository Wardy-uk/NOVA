# KPI Daily History Parity Activation

## Decision

Human direction is to continue parity closure beyond the current checkpoint set.

## Manager Classification

The next clearly named remaining legacy-only surface is Daily History.

This is the right next slice because:

- it was explicitly identified as only partially covered in the parity-gap inventory
- it is narrower and more bounded than a raw KPI data grid/export parity slice
- it builds directly on the clean-sheet `kpi_daily` substrate already used by Trends and other surfaces
- it continues closing user-visible legacy gaps without broadening into generic analytics tooling

## Scope Protection

This slice should:

- use the clean-sheet KPI path only
- surface only historical data the clean-sheet platform can already support honestly
- avoid fabricating missing days or invented backfill
- stay separate from raw KPI-data export, Board MI, and legacy wallboard decisions

## Routing Decision

Open:

`KPX-WP9` — Daily History parity surface delivery
