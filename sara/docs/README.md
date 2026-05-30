# SARA WS0 Runtime

## Purpose

This directory contains the bounded WS0 runtime foundation for SARA:

- a minimal backend entrypoint
- a minimal frontend surface
- one shared-state stub that keeps the single-SARA model explicit
- Pi-target runtime configuration for always-on launch

## Runtime shape

- `../backend/server.js` - backend entrypoint exposing `/healthz` and `/api/runtime`
- `../backend/src/state/stateEngine.js` - shared-state singleton stub for WS0
- `../backend/src/integrations/` - explicit placeholders for out-of-scope integrations
- `../frontend/src/App.jsx` - frontend surface that calls the backend runtime endpoint
- `../runtime/ecosystem.config.js` - PM2 process definition for Pi bring-up

## Local startup

From the repository root:

```powershell
npm --prefix sara run dev
```

This starts:

- backend on `http://127.0.0.1:4301`
- frontend on `http://127.0.0.1:4173`

## Pi 5 runtime path

1. Build the frontend once:

```powershell
npm --prefix sara run build:frontend
```

2. Start the runtime under PM2 from the repository root:

```powershell
pm2 start sara/runtime/ecosystem.config.js
pm2 save
pm2 startup
```

The PM2 startup step is the WS0 boot-path assumption for automatic launch after reboot.

## Known WS0 boundaries

- state values are intentionally stubbed and ready to be replaced by WS1
- integrations remain explicit placeholders
- no Home Assistant, voice, or distributed-node behaviour is included here
