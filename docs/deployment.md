# N.O.V.A DayPilot — Deployment Guide

## Prerequisites

| Requirement | Version | Why |
|------------|---------|-----|
| **Node.js** | 18+ (LTS recommended) | Runtime for API server + MCP servers |
| **npm** | Bundled with Node | Installs dependencies, spawns MS365/Monday MCP |
| **uv** | Latest | Python package manager, spawns Jira MCP via `uvx` |
| **Reverse proxy** | nginx or Caddy | HTTPS termination, optional |

### Install uv (for Jira MCP)

```bash
# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
irm https://astral.sh/uv/install.ps1 | iex
```

After install, ensure `uvx` is on your PATH: `uvx --version`

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> nova
cd nova
npm install

# 2. Build for production
npm run build

# 3. Configure
cp .env.template .env
# Edit .env — set NODE_ENV=production, configure integrations

# 4. Run
NODE_ENV=production node dist/server/index.js
```

The server starts on port 3001 (or whatever `PORT` is set to). On first run it creates `daypilot.db`, `users.json`, and `settings.json` in the data directory.

The first user to register gets the `admin` role.

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `NODE_ENV` | `development` | Set to `production` to serve built frontend |
| `DATA_DIR` | Project root | Where `daypilot.db`, `users.json`, `settings.json`, and token caches live |

### Paths

| Variable | Default | Description |
|----------|---------|-------------|
| `DELIVERY_XLSX_PATH` | `~/Downloads/Delivery sheet Master.xlsx` | Local copy of delivery spreadsheet |
| `ONEDRIVE_WATCH_DIR` | `~/OneDrive - Nurtur Limited/DayPilot` | Power Automate bridge watch folder |
| `D365_ORG_URL` | `https://nurtur-prod.crm11.dynamics.com` | Dynamics 365 organization URL |

### Integrations (first-run seeding)

These env vars are only read on **first run** to seed the settings database. After that, all integration credentials are managed via Admin > Integrations in the UI.

| Variable | Description |
|----------|-------------|
| `JIRA_URL` | Jira Cloud URL |
| `JIRA_PERSONAL_TOKEN` | Jira API token |
| `MONDAY_API_TOKEN` | Monday.com API token |
| `OPENAI_API_KEY` | OpenAI key for Ask NOVA / standups |

---

## Data Files

All data files live in `DATA_DIR` (defaults to project root).

| File | Purpose | Created by |
|------|---------|-----------|
| `daypilot.db` | SQLite database (tasks, deliveries, milestones, CRM, onboarding) | Server on first start |
| `users.json` | User accounts and password hashes | First user registration |
| `settings.json` | Integration credentials, sync intervals, feature flags | Server on first start |
| `.d365-token-cache.json` | Dynamics 365 OAuth token cache | D365 sign-in |

### Backup strategy

Back up `DATA_DIR` regularly. These four files are your entire state. A simple cron job works:

```bash
# Daily backup at 2am
0 2 * * * cp /var/lib/nova/daypilot.db /backups/nova/daypilot-$(date +\%Y\%m\%d).db
0 2 * * * cp /var/lib/nova/settings.json /backups/nova/settings-$(date +\%Y\%m\%d).json
0 2 * * * cp /var/lib/nova/users.json /backups/nova/users-$(date +\%Y\%m\%d).json
```

### Migrating from dev laptop

Copy these files from your dev machine to the server's `DATA_DIR`:

```bash
scp daypilot.db users.json settings.json .d365-token-cache.json user@server:/var/lib/nova/
```

---

## Database

NOVA uses **sql.js** (SQLite compiled to WASM). The entire database loads into memory on startup and persists to `daypilot.db` on disk.

### How persistence works

- On startup: reads `daypilot.db` from disk into memory
- Every 30 seconds: auto-saves memory to disk
- On shutdown (SIGINT/SIGTERM): saves before exit
- Maximum data loss window: 30 seconds (if the process is killed without signal)

### Do I need PostgreSQL?

**No** — for a single-server deployment with <10 concurrent users, sql.js is perfectly fine. The database is currently ~1.2MB and would need to grow well past 500MB before memory becomes a concern.

Consider PostgreSQL only if you need:
- Multiple server instances behind a load balancer
- Real-time multi-user collaboration with write contention
- Database-level backups and point-in-time recovery

### Tables (20)

Core: `tasks`, `rituals`, `settings`, `users`, `teams`, `user_settings`, `user_task_pins`, `feedback`
Delivery: `delivery_entries`
Milestones: `milestone_templates`, `delivery_milestones`, `milestone_sale_type_offsets`
CRM: `crm_customers`, `crm_reviews`
Onboarding: `onboarding_sale_types`, `onboarding_capabilities`, `onboarding_matrix`, `onboarding_capability_items`, `onboarding_ticket_groups`, `onboarding_runs`

---

## MCP Servers

NOVA spawns external MCP (Model Context Protocol) servers as child processes to communicate with third-party services.

| Integration | Command | Runtime |
|-------------|---------|---------|
| **Jira** | `uvx mcp-atlassian` | Python (via uv) |
| **Microsoft 365** | `npx @softeria/ms-365-mcp-server` | Node.js |
| **Monday.com** | `npx @mondaydotcomorg/monday-api-mcp@latest` | Node.js |

These are enabled/disabled via Admin > Integrations. When disabled, no child process is spawned.

Each server communicates via stdio and auto-reconnects if the connection drops.

---

## Running in Production

### Option A: pm2 (recommended)

```bash
npm install -g pm2

# Start
pm2 start dist/server/index.js --name nova --env production

# Auto-restart on crash
pm2 save
pm2 startup

# Logs
pm2 logs nova

# Restart after deploy
pm2 restart nova
```

### Option B: systemd

Create `/etc/systemd/system/nova.service`:

```ini
[Unit]
Description=N.O.V.A DayPilot
After=network.target

[Service]
Type=simple
User=nova
WorkingDirectory=/opt/nova
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=DATA_DIR=/var/lib/nova
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable nova
sudo systemctl start nova
sudo journalctl -u nova -f   # view logs
```

### Reverse proxy (nginx)

```nginx
server {
    listen 443 ssl;
    server_name nova.yourcompany.com;

    ssl_certificate     /etc/ssl/certs/nova.crt;
    ssl_certificate_key /etc/ssl/private/nova.key;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name nova.yourcompany.com;
    return 301 https://$host$request_uri;
}
```

---

## Security Considerations

### File permissions

```bash
# Restrict data directory
chmod 700 /var/lib/nova
chown nova:nova /var/lib/nova

# settings.json contains API tokens — don't expose
chmod 600 /var/lib/nova/settings.json
chmod 600 /var/lib/nova/users.json
```

### Credentials

All integration credentials (Jira tokens, OpenAI keys, etc.) are stored in `settings.json` in plaintext. This is acceptable for an internal tool on a private server with restricted file permissions. Do not expose this file publicly.

The JWT secret is auto-generated on first run and stored in `settings.json`. It persists across restarts.

### Network

- Always run behind a reverse proxy with HTTPS in production
- The API server should only listen on `127.0.0.1` (localhost) — let the proxy handle external traffic
- Do not expose port 3001 directly to the internet

---

## Deploy Checklist

- [ ] Server has Node.js 18+, npm, uv/uvx installed
- [ ] Repository cloned, `npm install` run
- [ ] `npm run build` completes successfully
- [ ] `.env` created from `.env.template` with `NODE_ENV=production`
- [ ] `DATA_DIR` configured and writable (or using project root)
- [ ] Data files copied from dev machine (if migrating)
- [ ] `DELIVERY_XLSX_PATH` set (if using local xlsx cache)
- [ ] Process manager configured (pm2 or systemd)
- [ ] Reverse proxy with SSL configured
- [ ] First user registered (gets admin role)
- [ ] Integrations configured in Admin > Integrations
- [ ] Backup schedule configured for DATA_DIR
- [ ] Test: login, view dashboard, check MCP connections in Settings

---

## Troubleshooting

### Server won't start

```
Error: Cannot find module './dist/server/index.js'
```
Run `npm run build` first.

### MCP server fails to connect

Check that `uvx` (for Jira) and `npx` (for MS365/Monday) are available:
```bash
uvx --version
npx --version
```

If Jira MCP fails, install uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`

### Database file not found

On first start, `daypilot.db` is created automatically. If `DATA_DIR` is set, ensure the directory exists and is writable.

### "Not authenticated" errors

The JWT secret in `settings.json` must match the tokens issued to clients. If you replace `settings.json`, all existing login sessions become invalid — users need to log in again.

### Site loads but shows blank page

Check that `NODE_ENV=production` is set. In production mode, Express serves the built frontend from `dist/client/`. Without it, only the API is available.

### Data loss after restart

The database auto-saves every 30 seconds. If the process is killed with `kill -9` (SIGKILL), up to 30 seconds of changes may be lost. Use `kill` (SIGTERM) or `pm2 stop` for graceful shutdown.
