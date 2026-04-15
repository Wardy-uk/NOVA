# nova-mcp

MCP server that exposes NOVA data + admin config as tools, for use from
Claude Desktop / Claude Code.

Bundled inside the daypilot repo so it stays in sync with the main server.

## Tools

**KPI analysis** (reads from MSSQL `jira_kpi_daily`):
- `nova_trend_analysis`
- `nova_agent_comparison`
- `nova_focus_areas`
- `nova_qa_deep_dive`
- `nova_sla_breakdown`
- `nova_checkpoint_summary`
- `nova_raw_kpi_query`

**Admin config** (reads/writes `../settings.json` directly):
- `nova_admin_get_config` — masked dump of all settings keys (optional
  regex filter, optional `unmask: true` for raw values)
- `nova_admin_set_setting` — writes a single key, dry-run by default,
  secret denylist enforced. NOVA reloads settings on every get() so no
  server restart is required.

## Setup

```bash
cd nova-mcp
npm install
npm run build
```

KPI tools need the MSSQL connection configured via either:
1. `config.json` in this directory (gitignored), see `config.example.json`, or
2. Falls back to reading `../settings.json`'s `kpi_sql_*` keys automatically

Admin config tools need no configuration — they read `../settings.json`
relative to this package's location.

## Wire into Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "nova": {
      "command": "node",
      "args": ["C:\\Users\\NickW\\Claude\\windows automation\\daypilot\\nova-mcp\\dist\\index.js"]
    }
  }
}
```

Then fully quit and relaunch Claude Desktop. The new tools appear in the
tool picker automatically.

## Development

```bash
npm run dev      # run via tsx directly (no rebuild)
npm run build    # tsc to dist/
npm start        # run the compiled dist/index.js
```

After changing tool code:

1. `npm run build`
2. Quit Claude Desktop (system tray → right-click → Quit)
3. Relaunch Claude Desktop — the MCP server respawns with the new code
