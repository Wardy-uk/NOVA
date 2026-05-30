# WS0-WP1 Build Status

## Date

2026-05-30

## Scope Delivered

Added the bounded WS0 runtime materials directly into the governed workspace under `sara/`:

- `sara/backend/server.js` backend entrypoint with `/healthz` and `/api/runtime`
- `sara/backend/src/state/stateEngine.js` single shared-state stub for one-SARA runtime ownership
- `sara/backend/src/integrations/index.js` explicit placeholders for later integrations
- `sara/frontend/src/App.jsx` React frontend proving backend connectivity
- `sara/frontend/index.html`, `sara/frontend/src/main.jsx`, and `sara/frontend/src/styles.css` for the frontend runtime surface
- `sara/runtime/ecosystem.config.js` PM2 runtime configuration for Pi-target launch
- `sara/docs/README.md` operator-facing startup and runtime notes
- `sara/package.json` scripts for local dev, frontend build, and runtime start

## How The Runtime Is Started

For local verification:

```powershell
npm --prefix sara run dev
```

For Pi-target runtime launch after the frontend is built:

```powershell
npm --prefix sara run build:frontend
pm2 start sara/runtime/ecosystem.config.js
pm2 save
pm2 startup
```

## Assumptions And Local Dependencies

- the repository root `node_modules` directory is present and contains the existing `express`, `cors`, `react`, `react-dom`, `vite`, and `concurrently` packages already used by this codebase
- PM2 is expected to be installed on the Raspberry Pi 5 for the always-on boot path
- the frontend reads the backend URL from `VITE_SARA_API_BASE_URL` and defaults locally to `http://127.0.0.1:4301`

## Local Verification Performed

- `npm --prefix sara run build:frontend` completed successfully in this workspace
- `GET http://127.0.0.1:4301/healthz` returned `ok: true`
- `GET http://127.0.0.1:4301/api/runtime` returned the WS0 shared runtime payload
- `GET http://127.0.0.1:4173` returned HTTP `200` from the built frontend preview

## Known Limitations Inside WS0 Scope

- the state engine is an honest stub and does not yet implement WS1 logic
- the frontend is a runtime-health surface, not a full dashboard
- integrations remain placeholders and intentionally report themselves as out of scope for WS0

## Readiness

`WS0-WP1` is now materially present in this governed workspace and is ready for Manager review and independent evaluation routing.
