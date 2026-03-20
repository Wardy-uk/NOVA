# Wallboard Drill-Down — Todo

## Tasks

- [x] **Confirm open questions** — Property Jungle = Tier "Customer Care" + Request Type "TPJ Request" (customfield_13482). CC Incidents includes Chat, AI Request, Emailed Request, GDPR. Confirmed from n8n KPI engine.
- [x] **Step 1**: Add click handlers to `renderStatWallboard` tiles (CC + Tech Support) — postMessage to parent
- [x] **Step 2**: Add click handlers to SLA Breach Board agent rows — postMessage to parent
- [x] **Step 3**: Add click handlers to KPI Breach Board table rows — postMessage to parent
- [x] **Step 4**: Create drill-down API endpoint (`GET /api/tasks/service-desk/wallboard/drill-down`) with KPI→filter mapping
- [x] **Step 5**: Create `WallboardDrillPanel.tsx` side panel component
- [x] **Step 6**: Add postMessage listener + drill panel mount in App.tsx
- [x] **Step 7**: Build — all clean, no compile errors

## Files changed
- `src/server/index.ts` — Added `cursor:pointer`, `data-kpi`, `onclick` postMessage to tiles in `renderStatWallboard`, SLA Breach Board agent rows, and KPI Breach Board rows. No layout/style changes.
- `src/server/routes/tasks.ts` — New endpoint `GET /api/tasks/service-desk/wallboard/drill-down?kpi=...&agent=...` with KPI→Jira filter mapping from n8n engine logic.
- `src/client/components/WallboardDrillPanel.tsx` — New slide-out panel component showing matching tickets.
- `src/client/App.tsx` — postMessage listener + WallboardDrillPanel mount.
