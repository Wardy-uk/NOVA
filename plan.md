# Sales Hotbox Rebuild Plan

## Overview
Rebuild SalesHotboxView.tsx from 4 tabs (1010 lines) to 10 tabs matching hotbox-dashboard-v3.html design. Dark theme, Tailwind CSS, React.

## Architecture
- Single file: `SalesHotboxView.tsx` (will be large but consistent with codebase pattern)
- Backend: DONE (sales-queries.ts + sales-hotbox.ts routes for bookings, taken place, LG/BDM KPIs)
- Demo data: LG KPI data (calls, days worked, individual KPIs) mocked with "Demo Data" badge overlay

## Build Steps (each step = one write/edit to SalesHotboxView.tsx)

### Step 1: Foundation
Write file top: imports, ALL types, constants (stage colors, demo data), helper functions, shared components (KpiCard, StageChip, HwcChip, DemoBadge, ProgressBar).

### Step 2: Summary Tab
SummaryTab component — 5 KPI cards (calls, booked, TP, pipeline, contracts), conversion funnel, pipeline by person table, pipeline by product bars.

### Step 3: Lead Gen KPIs Tab
LeadGenTab component — 5 KPI cards, person cards grid (mini funnel + KPI bars per person), history table. Uses demo data with badge.

### Step 4: Demo Tracker Tab
DemoTrackerTab component — bookings sub-tab (table with status chips, "taken place" action button) + taken place sub-tab (HWC KPI cards, table with hwc/hotbox chips). Booking and TakenPlace modals.

### Step 5: Hotbox + Monthly Sales Tabs
HotboxTab (existing, minor updates) + MonthlyTab (existing, keep as-is). Keep DealModal and SaleModal.

### Step 6: BDM Targets Tab
TargetsTab — KPI cards (total closed, target, hit rate), BDM card grid with progress bars + demo pipeline stats (booked/TP/conv). Uses demo data.

### Step 7: Reporting Tabs
BookingSummaryTab, SalesSummaryTab, KpiTrackerTab — period selector (This Month/Last Month/Custom), summary tables by person/product/lead source. KPI tracker has dual-header table for LG + BDM KPIs.

### Step 8: Board Pack Placeholder
BoardPackTab — sub-nav with 11 sections, placeholder content for each. Chart.js integration deferred.

### Step 9: Modals
DealModal (existing), SaleModal (existing), BookingModal (new), TakenPlaceModal (new), OnboardingModal (existing).

### Step 10: Main Component
SalesHotboxView export — state, fetchAll, CRUD handlers, tab bar with 10 tabs + reporting separator, render all views + modals. Import handler.

## Current Status
- **Backend: COMPLETE** — all 4 new tables, query methods, API routes, updated reference data
- **Step 1: COMPLETE** — types (PipelineDeal, MonthlySale, SalesTarget, Booking, TakenPlace, RefData, LgKpiRow, BdmKpiRow), constants (STAGE_COLOR, HWC_COLOR, demo data), helpers (fmt, fmtS, fmtN, pct, pctColor), shared components (KpiCard, StageChip, HwcChip, DemoBadge, ProgressBar, TypeBadge, Pill, PeriodSelector, Card, SectionTitle)
- **Steps 2–10: COMPLETE** — All 10 tabs written, all 5 modals, main component with full CRUD
- **Data Pack Import: COMPLETE** — per-person monthly KPIs from Lead Gen 2023, team-wide history from LG Charts, frontend wired to API
- Files modified so far:
  - `src/server/db/schema.ts` — 4 new CREATE TABLE statements
  - `src/server/db/sales-queries.ts` — 4 interfaces + full CRUD methods for bookings, taken_place, lg_kpi, bdm_kpi
  - `src/server/routes/sales-hotbox.ts` — routes for /bookings, /taken-place, /lg-kpis, /bdm-kpis + updated /reference
