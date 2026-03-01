# N.O.V.A DayPilot — Deployment Guide

## Prerequisites

| Requirement | Version | Why |
|------------|---------|-----|
| **Node.js** | 18+ (LTS recommended) | Runtime for API server + MCP servers |
| **npm** | Bundled with Node | Installs dependencies, spawns MS365 MCP |
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

### Install Monday.com MCP (if using Monday.com integration)

```bash
npm install -g @mondaydotcomorg/monday-api-mcp --ignore-scripts
```

The `--ignore-scripts` flag is required to skip the `isolated-vm` native build (needs Visual Studio on Windows). NOVA sets `OTEL_SDK_DISABLED=true` at runtime to prevent OpenTelemetry errors.

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

The server starts on port 3069 (or whatever `PORT` is set to). On first run it creates `daypilot.db`, `users.json`, and `settings.json` in the data directory.

The first user to register gets the `admin` role.

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3069` | API server port |
| `NODE_ENV` | `development` | Set to `production` to serve built frontend |
| `DATA_DIR` | Project root | Where `daypilot.db`, `users.json`, `settings.json`, and token caches live |

### Paths

| Variable | Default | Description |
|----------|---------|-------------|
| `DELIVERY_XLSX_PATH` | `~/Downloads/Delivery sheet Master.xlsx` | Local copy of delivery spreadsheet |
| `ONEDRIVE_WATCH_DIR` | `~/OneDrive - Nurtur Limited/DayPilot` | Power Automate bridge watch folder |
| `D365_ORG_URL` | `https://nurtur-prod.crm11.dynamics.com` | Dynamics 365 organization URL |

### SSO (Microsoft Entra ID)

| Variable | Default | Description |
|----------|---------|-------------|
| `FRONTEND_URL` | _(empty — same origin)_ | Frontend URL for SSO callback redirect. Set to `http://localhost:5173` in dev when Vite runs on a different port. Leave empty in production (reverse proxy serves both). |

SSO credentials (`sso_tenant_id`, `sso_client_id`, `sso_client_secret`) are managed via **Admin > Integrations > Entra ID SSO** in the UI — not env vars. See the [Microsoft Entra ID SSO](#microsoft-entra-id-sso) section below.

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

### Purging local data per integration

Each integration card in **My Settings** has a **Delete Local Data** button. This purges all locally-synced records for that integration without affecting the remote service. Data is re-fetched on the next sync cycle.

| Integration | What gets deleted |
|-------------|-------------------|
| Jira | All tasks where `source = 'jira'` |
| Microsoft 365 | All tasks where source is `planner`, `todo`, `calendar`, or `email` |
| Monday.com | All tasks where `source = 'monday'` |
| Dynamics 365 | All rows in `crm_customers` and `crm_reviews` |

API: `DELETE /api/data/source/:source` (authenticated, valid sources: `jira`, `planner`, `todo`, `calendar`, `email`, `monday`, `dynamics365`)

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
| **Monday.com** | `node <global-path>/monday-api-mcp/dist/index.js` | Node.js (global install) |

These are enabled/disabled via Admin > Integrations. When disabled, no child process is spawned.

Each server communicates via stdio and auto-reconnects if the connection drops.

### Monday.com MCP — Windows note

The Monday.com MCP package (`@mondaydotcomorg/monday-api-mcp`) bundles OpenTelemetry, which causes `EPERM` errors on Windows when run via `npx` (deep nested `node_modules` paths exceed Windows limits during cache cleanup). The workaround:

1. Install globally with scripts disabled (skips `isolated-vm` native build):
   ```powershell
   npm install -g @mondaydotcomorg/monday-api-mcp --ignore-scripts
   ```
2. NOVA spawns it directly via `node` pointing at the global install path, with `OTEL_SDK_DISABLED=true` set in the environment to prevent OpenTelemetry from initialising.

This is handled automatically by the MCP config builder — no manual setup is needed beyond the global install.

---

## Running in Production

### Option A: Windows Server + IIS + NSSM (recommended for Azure VM)

This is the recommended approach for deploying NOVA to a Windows Server VM (Azure or on-prem). IIS handles HTTPS termination and reverse-proxies to the Node.js process, which NSSM manages as a native Windows Service.

#### Prerequisites on the server

1. **Node.js 20 LTS** — [nodejs.org](https://nodejs.org) (includes npm)
2. **Git** — [git-scm.com](https://git-scm.com/download/win)
3. **uv** (for Jira MCP):
   ```powershell
   irm https://astral.sh/uv/install.ps1 | iex
   ```
4. **Monday.com MCP** (if using Monday integration):
   ```powershell
   npm install -g @mondaydotcomorg/monday-api-mcp --ignore-scripts
   ```
5. **NSSM** — download from [nssm.cc](https://nssm.cc), copy `nssm.exe` to a directory on PATH (e.g. `C:\Tools\`)
6. **IIS** with URL Rewrite and ARR:
   - Enable IIS: Server Manager > Add Roles and Features > Web Server (IIS)
   - Install [URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite)
   - Install [Application Request Routing (ARR)](https://www.iis.net/downloads/microsoft/application-request-routing)
7. **SSL certificate** — from your internal CA, or use [win-acme](https://www.win-acme.com/) for Let's Encrypt

#### Server folder structure

```
C:\Apps\NOVA\                     Application code (git clone target)
  ├── dist\                       Built output (client + server)
  ├── node_modules\               Dependencies
  ├── web.config                  IIS rewrite rules (in repo)
  └── deploy\                     Setup & deployment scripts

C:\ProgramData\NOVA\              Persistent data (survives redeploys)
  ├── daypilot.db                 SQLite database
  ├── users.json                  User accounts
  ├── settings.json               Integration credentials + config
  ├── .d365-token-cache.json      D365 OAuth tokens
  └── logs\                       NSSM service logs
      ├── nova-stdout.log
      └── nova-stderr.log
```

#### Initial setup

```powershell
# 1. Clone the repo
git clone <repo-url> C:\Apps\NOVA
cd C:\Apps\NOVA

# 2. Install dependencies and build
npm install
npm run build

# 3. Create data directory
New-Item -ItemType Directory -Force -Path C:\ProgramData\NOVA

# 4. (Optional) Copy data files from dev machine
#    Copy daypilot.db, users.json, settings.json, .d365-token-cache.json
#    to C:\ProgramData\NOVA\

# 5. Install the Windows Service (run as Administrator)
.\deploy\install-service.ps1
```

The `install-service.ps1` script creates an NSSM service called `NOVA` that:
- Runs `node dist/server/index.js` from `C:\Apps\NOVA`
- Sets `NODE_ENV=production`, `PORT=3069`, `DATA_DIR=C:\ProgramData\NOVA`
- Logs stdout/stderr to `C:\ProgramData\NOVA\logs\` with 10 MB rotation
- Auto-starts on boot, auto-restarts on crash
- Graceful shutdown via Ctrl+C signal (5s timeout)

#### Enable ARR proxy (one-time, server-level)

1. Open **IIS Manager**
2. Click the **server node** (top level)
3. Double-click **Application Request Routing Cache**
4. Click **Server Proxy Settings** in the right panel
5. Check **Enable proxy** → Apply

#### Create the IIS site

1. In IIS Manager, right-click **Sites** → **Add Website**
2. Configure:
   - **Site name**: `NOVA`
   - **Physical path**: `C:\Apps\NOVA`
   - **Binding**: HTTPS, port 443, hostname `nova.yourcompany.com`
   - **SSL certificate**: select your certificate
3. The `web.config` in `C:\Apps\NOVA` contains the URL Rewrite rule that forwards all requests to `http://127.0.0.1:3069`
4. (Optional) Add an HTTP binding on port 80 with a redirect rule to force HTTPS

#### Test

```powershell
# Service running?
nssm status NOVA

# Node responding?
Invoke-WebRequest http://localhost:3069/api/health

# IIS proxying?
# Open https://nova.yourcompany.com in a browser
```

#### Subsequent deployments

```powershell
# Run as Administrator
C:\Apps\NOVA\deploy\deploy.ps1
```

This pulls latest code, rebuilds, and restarts the service.

#### Device-code logins (D365, MS365)

After first deploy, integrations that use device code auth need an interactive login:

1. Watch the log: `Get-Content C:\ProgramData\NOVA\logs\nova-stdout.log -Wait`
2. In the NOVA UI, go to My Settings and click "Sign in with Microsoft" for each integration
3. Complete the device code flow in a browser
4. Tokens are cached in `C:\ProgramData\NOVA\` and persist across service restarts

Alternatively, copy `.d365-token-cache.json` from the dev machine to skip re-login.

#### SSO callback update

If using Entra SSO, update the Azure AD app registration to add a new redirect URI:
```
https://nova.yourcompany.com/api/auth/sso/callback
```
And set `sso_base_url` to `https://nova.yourcompany.com` in Admin > Integrations > Entra ID SSO.

#### Service management

```powershell
nssm status NOVA        # Check status
nssm start NOVA         # Start
nssm stop NOVA          # Stop (graceful)
nssm restart NOVA       # Restart
nssm edit NOVA          # Open NSSM GUI to edit service config

# View logs
Get-Content C:\ProgramData\NOVA\logs\nova-stdout.log -Tail 50
Get-Content C:\ProgramData\NOVA\logs\nova-stderr.log -Tail 50

# Remove service entirely
nssm stop NOVA
nssm remove NOVA confirm
```

---

### Option B: pm2 (Linux)

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

### Option C: systemd (Linux)

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
Environment=PORT=3069
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
        proxy_pass http://127.0.0.1:3069;
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

## Microsoft Entra ID SSO

NOVA supports "Sign in with Microsoft" via Entra ID (formerly Azure AD) OAuth2 with PKCE. This allows users to authenticate with their Microsoft 365 work accounts.

### Azure App Registration

1. Go to [Azure Portal > App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **New registration**
2. Set a name (e.g. "NOVA DayPilot")
3. Under **Redirect URIs**, add a **Web** platform URI:
   - Production: `https://nova.yourcompany.com/api/auth/sso/callback`
   - Dev: `http://localhost:3069/api/auth/sso/callback`
4. Click **Register**
5. Note the **Application (client) ID** and **Directory (tenant) ID**
6. Go to **Certificates & secrets** > **New client secret** — copy the secret value immediately (it's shown only once)
7. Go to **API permissions** — ensure these are granted:
   - `openid` (delegated)
   - `profile` (delegated)
   - `email` (delegated)
   - `User.Read` (delegated)

### Configure in NOVA

1. Log in as admin, go to **Admin > Integrations > Entra ID SSO**
2. Enter:
   - **Tenant ID** — Azure AD directory (tenant) ID
   - **Client ID** — Azure AD app registration client ID
   - **Client Secret** — the secret value from step 6
3. Click **Save**, then toggle the integration to **Enabled**

If you're running behind a reverse proxy with a different public URL than `localhost:3069`, also set `sso_base_url` in settings.json to your public URL (e.g. `https://nova.yourcompany.com`). This ensures the OAuth callback redirect URI matches the one registered in Azure.

### How it works

- User clicks "Sign in with Microsoft" on the login page
- Frontend calls `GET /api/auth/sso/login` which generates a Microsoft OAuth URL with PKCE
- User authenticates with Microsoft, which redirects back to `GET /api/auth/sso/callback`
- Backend exchanges the auth code for tokens and reads the ID token claims (oid, email, name)
- User resolution: looks up by Entra OID → matches by email (links existing local account) → auto-provisions new user
- Backend issues a NOVA JWT and redirects to the frontend with the token in the URL hash fragment (`/#sso_token=...`)
- Auto-provisioned users get the `viewer` role by default. Assign a custom role in Admin > Users.

### User account linking

- If a local user already exists with the same email, the account is linked to Entra on first SSO login. The user can then only sign in via Microsoft.
- SSO-only users (no password hash) cannot use the local username/password login form.

### Email (Invites & Password Reset)

NOVA includes a built-in email service for sending user invite emails and self-service password reset links. Configure it in **Admin > Integrations > Email**.

**Minimum setup:** Set a **From Address** (e.g. `noreply@nurtur.tech`). The service sends emails directly to the recipient's mail server by resolving MX DNS records — no external SMTP provider is needed.

**Optional SMTP relay:** If your network blocks outbound port 25, or you prefer routing through a relay, configure the SMTP Host, Port, Username, and Password fields.

**Password reset flow:**
1. User clicks "Forgot password?" on the login page
2. Enters their email address → server sends a reset link (valid for 1 hour)
3. User clicks the link → enters a new password
4. Token is consumed, password is updated

Reset tokens are stored in memory and cleared on server restart. The endpoint always returns success to prevent email enumeration.

**Testing:** Use the "Send Test Email" button in Admin > Integrations > Email to verify delivery.

**Port 25 note:** Direct MX delivery uses port 25 (SMTP). Some cloud providers (Azure, AWS) block outbound port 25 by default. If emails aren't arriving, either:
- Configure an SMTP relay (e.g. Microsoft 365, SendGrid, Mailgun)
- Request port 25 unblock from your cloud provider

### Custom Roles

NOVA uses a custom role system for per-area access control. Roles are managed in **Admin > Permissions**:

- **Admin** — built-in, full edit access everywhere (cannot be modified)
- **Custom roles** — define per-area access levels: `hidden` (area not visible), `view` (read-only), `edit` (full write)
- Areas: Command Centre, Service Desk, Onboarding, Account Management

Example: an "Onboarder" role might have `edit` on Onboarding, `view` on Command Centre and Account Management, and `hidden` on Service Desk.

Assign roles to users in **Admin > Users** via the role dropdown.

---

## Security Considerations

### File permissions

**Linux:**
```bash
chmod 700 /var/lib/nova
chown nova:nova /var/lib/nova
chmod 600 /var/lib/nova/settings.json
chmod 600 /var/lib/nova/users.json
```

**Windows:**
```powershell
# Restrict data directory to Administrators only
icacls C:\ProgramData\NOVA /inheritance:r /grant "BUILTIN\Administrators:(OI)(CI)F" /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F"
```

### Credentials

All integration credentials (Jira tokens, OpenAI keys, Entra SSO client secret, etc.) are stored in `settings.json` in plaintext. This is acceptable for an internal tool on a private server with restricted file permissions. Do not expose this file publicly.

The JWT secret is auto-generated on first run and stored in `settings.json`. It persists across restarts.

### SSO security notes

- The SSO flow uses PKCE (Proof Key for Code Exchange) to prevent authorization code interception
- Pending login states expire after 10 minutes
- SSO tokens are passed to the frontend via URL hash fragment (`#sso_token=...`), which is never sent to the server and is cleared from the URL immediately
- SSO-only users have an empty password hash and cannot fall back to local login

### Network

- Always run behind a reverse proxy with HTTPS in production
- The API server should only listen on `127.0.0.1` (localhost) — let the proxy handle external traffic
- Do not expose port 3069 directly to the internet

---

## Deploy Checklist

### Common (all platforms)

- [ ] Server has Node.js 20+, npm, Git installed
- [ ] uv/uvx installed (for Jira MCP)
- [ ] Monday.com MCP installed globally (if using): `npm install -g @mondaydotcomorg/monday-api-mcp --ignore-scripts`
- [ ] Repository cloned, `npm install` run
- [ ] `npm run build` completes successfully
- [ ] `DATA_DIR` configured and writable
- [ ] Data files copied from dev machine (if migrating)
- [ ] `DELIVERY_XLSX_PATH` set (if using local xlsx cache)
- [ ] First user registered (gets admin role)
- [ ] Integrations configured in Admin > Integrations
- [ ] Device-code logins completed for D365/MS365 (if using)
- [ ] SSO configured (if using): Azure app registered, `sso_base_url` set
- [ ] Custom roles configured in Admin > Permissions (if needed)
- [ ] Backup schedule configured for DATA_DIR
- [ ] Test: login, view dashboard, check MCP connections in Settings
- [ ] Test SSO (if configured): click "Sign in with Microsoft", verify redirect

### Windows Server + IIS (Option A)

- [ ] NSSM installed and on PATH
- [ ] IIS enabled with URL Rewrite + ARR modules installed
- [ ] ARR proxy enabled (server-level in IIS Manager)
- [ ] `deploy\install-service.ps1` run as Administrator
- [ ] `nssm status NOVA` returns `SERVICE_RUNNING`
- [ ] IIS site created with HTTPS binding + SSL certificate
- [ ] `web.config` in IIS site physical path
- [ ] Firewall allows inbound 443 (and optionally 80 for redirect)
- [ ] SSO redirect URI updated in Azure AD: `https://nova.yourcompany.com/api/auth/sso/callback`

### Linux (Option B/C)

- [ ] Process manager configured (pm2 or systemd)
- [ ] `.env` created from `.env.template` with `NODE_ENV=production`
- [ ] Reverse proxy (nginx) with SSL configured

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

### Monday.com MCP fails with EPERM or OpenTelemetry errors (Windows)

This is caused by `@opentelemetry` packages creating deeply nested paths that Windows can't clean up. Ensure the package is installed globally with `--ignore-scripts`:
```powershell
npm install -g @mondaydotcomorg/monday-api-mcp --ignore-scripts
```
NOVA automatically sets `OTEL_SDK_DISABLED=true` when spawning this server.

### Database file not found

On first start, `daypilot.db` is created automatically. If `DATA_DIR` is set, ensure the directory exists and is writable.

### "Not authenticated" errors

The JWT secret in `settings.json` must match the tokens issued to clients. If you replace `settings.json`, all existing login sessions become invalid — users need to log in again.

### Site loads but shows blank page

Check that `NODE_ENV=production` is set. In production mode, Express serves the built frontend from `dist/client/`. Without it, only the API is available.

### SSO: "redirect_uri mismatch" error from Microsoft

The redirect URI in the Azure app registration must exactly match what NOVA sends. Check:
1. Azure Portal > App registration > Authentication > Web redirect URIs includes `https://nova.yourcompany.com/api/auth/sso/callback`
2. `sso_base_url` in settings.json (or Admin > Integrations) matches your public URL
3. No trailing slashes or protocol mismatches (http vs https)

### SSO: "No email in Microsoft token"

The Azure app needs `email` and `User.Read` delegated permissions. Go to Azure Portal > App registration > API permissions and ensure they are granted (with admin consent if required by your tenant).

### SSO: "Invalid or expired SSO state"

The login attempt took longer than 10 minutes, or the user navigated away and back. Click "Sign in with Microsoft" again to start a fresh flow.

### Data loss after restart

The database auto-saves every 30 seconds. If the process is killed with `kill -9` (SIGKILL), up to 30 seconds of changes may be lost. Use `kill` (SIGTERM), `pm2 stop`, or `nssm stop` for graceful shutdown.

### IIS: 502 Bad Gateway

IIS can't reach the Node.js backend. Check:
1. NOVA service is running: `nssm status NOVA`
2. Node is listening: `Invoke-WebRequest http://localhost:3069/api/health`
3. ARR proxy is enabled (IIS Manager > server node > Application Request Routing > Server Proxy Settings > Enable proxy ✓)
4. URL Rewrite module is installed
5. `web.config` exists in the IIS site physical path

### IIS: site loads but API calls fail with 404

The IIS URL Rewrite rule may not be matching. Verify:
1. `web.config` is in the IIS site root directory
2. The rewrite rule points to `http://127.0.0.1:3069/{R:1}` (correct port)
3. No conflicting rules in higher-level `web.config` files

### NSSM: service starts but immediately stops

Check the error log:
```powershell
Get-Content C:\ProgramData\NOVA\logs\nova-stderr.log -Tail 50
```
Common causes:
- `dist/server/index.js` doesn't exist (run `npm run build`)
- Missing `node_modules` (run `npm install`)
- Port 3069 already in use by another process

### MCP servers not connecting on Windows Server

The NSSM service runs under the Local System account by default, which has different PATH and env vars than your user account. To fix:
1. Use `nssm edit NOVA` and change the **Log On** tab to run as your user account, or
2. Ensure `uvx` is accessible system-wide (install uv for all users)
