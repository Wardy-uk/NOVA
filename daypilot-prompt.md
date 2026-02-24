# Claude Code Prompt — Unified Priority Dashboard App

Paste this into Claude Code:

---

```
I want you to build me a personal productivity app called "DayPilot" (or suggest a better name). It's a unified priority dashboard that pulls tasks and work items from ALL my workstreams, intelligently prioritises them into a single to-do list, and runs structured morning standups and end-of-day reflections via ChatGPT. It runs locally on my Windows laptop initially but must be accessible via web browser and designed for eventual remote deployment.

## My role & context
I'm a service desk team manager. My work is fragmented across multiple tools and I need a single pane of glass to see what matters most today. I manage SLAs, a team of agents, cross-team projects, and my own task list.

## The app must do the following

### 1. Unified Task Aggregation
Pull tasks/items from ALL of these sources and normalise them into a common format:

- **Jira Service Management** — My assigned tickets, tickets I'm watching, SLA-approaching items, team queue overview. Use `mcp-atlassian` (sooperset/mcp-atlassian) via uvx with Personal Access Token auth.

- **Microsoft To Do** — My personal task lists. Use `@softeria/ms-365-mcp-server` with `--org-mode` (covers To Do, Planner, SharePoint, Outlook, Calendar all in one server).

- **Microsoft Planner** — Team task boards and assignments. Same server as above — it exposes `list-planner-tasks`, `create-planner-task`, `list-plan-tasks`.

- **Outlook Email** — Flagged emails, unread from key senders, emails requiring action. Same ms-365 server — `list-mail-messages`, `get-mail-message`.

- **Monday.com** — My assigned items across service improvement boards, project boards. Use official `@mondaydotcomorg/monday-api-mcp` via npx with MONDAY_TOKEN, OR the hosted MCP at `https://mcp.monday.com/mcp` if OAuth is set up.

- **Calendar** — Today's meetings and upcoming commitments that block time. Same ms-365 server — `list-calendar-events`, `get-calendar-view`.

### 2. Intelligent Prioritisation Engine
Don't just dump everything in a list. Apply smart prioritisation:

- **SLA urgency**: Jira tickets approaching SLA breach get highest priority. Calculate time-to-breach.
- **Due dates**: Items with due dates today or overdue float to the top.
- **Source weighting**: I should be able to configure relative priority weights per source (e.g. Jira SLA breaches > Planner tasks > Monday items > flagged emails).
- **Meeting awareness**: If I have a meeting in 30 mins about Project X, surface related tasks from any source.
- **Staleness**: Items untouched for 3+ days get flagged.
- **Categories**: Group by context — "Urgent/SLA", "Team Management", "Projects", "Admin/Email", "Personal".
- Let me manually pin, snooze, or dismiss items.

### 3. Morning Standup (via ChatGPT)
Every morning, the app should initiate a structured standup conversation using the OpenAI API (my ChatGPT account):

- Use the OpenAI Responses API with conversation state (response_id) so it's a genuine multi-turn conversation, not isolated API calls.
- Config: OPENAI_API_KEY, model: gpt-4o (configurable)
- The standup flow:
  1. ChatGPT receives my aggregated task list + yesterday's completed items + any SLA alerts as context
  2. It asks me: "What did you accomplish yesterday?" (pre-populated with data, I confirm/edit)
  3. It asks: "What are your priorities for today?" (suggests based on the prioritised list, I confirm/reorder)
  4. It asks: "Any blockers or things you need help with?"
  5. It produces a structured standup summary in markdown
- Save the standup output with timestamp to a local SQLite database AND as a markdown file
- The standup should feel conversational, not like filling in a form

### 4. End-of-Day Reflection (via ChatGPT)
Similar flow at end of day:

- ChatGPT receives: morning's planned priorities + what actually got done (check completed items across all sources) + any new items that came in during the day
- It asks: "How did today go overall?" 
- It asks: "What didn't get done and why?"
- It asks: "Anything you want to carry forward or flag for tomorrow?"
- It produces a reflection summary, saves to SQLite and markdown
- Over time, it should reference patterns: "You've had SLA breaches 3 days in a row — want to discuss this with the team?"

### 5. Web Dashboard UI
A clean, functional web interface accessible via browser at localhost:3000 (initially):

- **Today view**: Prioritised task list with source icons, due times, SLA countdown timers, category grouping
- **Standup panel**: Start standup button, chat interface for the conversation, view past standups
- **Reflection panel**: Same as standup but for EOD
- **History view**: Searchable log of past standups and reflections with date filtering
- **Settings**: Configure source weights, snooze defaults, working hours, ChatGPT model, refresh intervals
- **Status bar**: Connection status for each MCP server (green/red indicators)
- Auto-refresh task list every 5 minutes, manual refresh button
- Responsive — works on laptop browser, tablet, and phone
- Dark mode support

## Technical architecture

### Stack
- **Backend**: Node.js with Express (or Fastify) — TypeScript
- **Frontend**: React with Tailwind CSS — single page app
- **Database**: SQLite via better-sqlite3 (local, zero-config, portable)
- **MCP Integration**: Use the MCP TypeScript SDK (`@modelcontextprotocol/sdk`) to connect to MCP servers as a client
- **ChatGPT Integration**: OpenAI Node SDK (`openai`) using the Responses API for conversation state
- **Build**: Vite for frontend, tsx for backend dev

### MCP Server Configuration
The app acts as an MCP CLIENT connecting to these MCP SERVERS:

```json
{
  "jira": {
    "command": "uvx",
    "args": ["mcp-atlassian"],
    "env": {
      "JIRA_URL": "${JIRA_URL}",
      "JIRA_PERSONAL_TOKEN": "${JIRA_PERSONAL_TOKEN}"
    }
  },
  "ms365": {
    "command": "cmd",
    "args": ["/c", "npx -y @softeria/ms-365-mcp-server --org-mode"],
    "note": "Covers: Outlook, Calendar, To Do, Planner, SharePoint, Teams"
  },
  "monday": {
    "command": "npx",
    "args": ["-y", "@mondaydotcomorg/monday-api-mcp"],
    "env": {
      "MONDAY_TOKEN": "${MONDAY_TOKEN}"
    }
  }
}
```

### Data Model (SQLite)
```sql
-- Normalised task items from all sources
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- 'jira', 'planner', 'todo', 'monday', 'email', 'calendar'
  source_id TEXT,                -- Original ID in source system
  source_url TEXT,               -- Deep link back to source
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,                   -- 'open', 'in_progress', 'done', 'snoozed', 'dismissed'
  priority INTEGER DEFAULT 50,   -- 0-100 calculated priority score
  due_date DATETIME,
  sla_breach_at DATETIME,        -- For Jira SLA items
  category TEXT,                 -- 'urgent_sla', 'team', 'project', 'admin', 'personal'
  is_pinned BOOLEAN DEFAULT 0,
  snoozed_until DATETIME,
  last_synced DATETIME,
  raw_data JSON,                 -- Original source data
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Standup and reflection records
CREATE TABLE rituals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,             -- 'standup' or 'reflection'
  date DATE NOT NULL,
  conversation JSON,             -- Full ChatGPT conversation history
  summary_md TEXT,               -- Markdown summary output
  planned_items JSON,            -- Tasks planned for the day
  completed_items JSON,          -- Tasks completed
  blockers JSON,
  openai_response_id TEXT,       -- For conversation continuity
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Priority weight configuration
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Project Structure
```
daypilot/
├── package.json
├── tsconfig.json
├── .env                         # All credentials (gitignored)
├── .env.template                # Template with instructions
├── daypilot.db                  # SQLite database (gitignored)
├── standups/                    # Markdown standup exports
├── reflections/                 # Markdown reflection exports
├── src/
│   ├── server/
│   │   ├── index.ts             # Express app entry point
│   │   ├── routes/
│   │   │   ├── tasks.ts         # Task CRUD + aggregation endpoints
│   │   │   ├── rituals.ts       # Standup/reflection endpoints
│   │   │   ├── settings.ts      # Config endpoints
│   │   │   └── health.ts        # MCP server health checks
│   │   ├── services/
│   │   │   ├── aggregator.ts    # Pull tasks from all MCP sources
│   │   │   ├── prioritiser.ts   # Priority scoring engine
│   │   │   ├── chatgpt.ts       # OpenAI Responses API wrapper
│   │   │   ├── mcp-client.ts    # MCP client manager (connect to servers)
│   │   │   └── scheduler.ts     # Auto-refresh task sync
│   │   ├── db/
│   │   │   ├── schema.ts        # SQLite schema + migrations
│   │   │   └── queries.ts       # Database operations
│   │   └── types/
│   │       └── index.ts         # Shared TypeScript types
│   └── client/
│       ├── index.html
│       ├── App.tsx
│       ├── components/
│       │   ├── TaskList.tsx      # Prioritised task list with source badges
│       │   ├── TaskCard.tsx      # Individual task with pin/snooze/dismiss
│       │   ├── StandupChat.tsx   # ChatGPT standup conversation UI
│       │   ├── ReflectionChat.tsx
│       │   ├── HistoryView.tsx   # Past standups/reflections
│       │   ├── SettingsPanel.tsx
│       │   ├── StatusBar.tsx     # MCP server connection indicators
│       │   └── SLATimer.tsx      # Countdown timer component
│       ├── hooks/
│       │   ├── useTasks.ts
│       │   ├── useRituals.ts
│       │   └── useSettings.ts
│       └── styles/
│           └── globals.css      # Tailwind + custom styles
├── scripts/
│   ├── setup.ps1               # Windows setup script
│   ├── start.ps1               # Launch everything
│   └── test-connections.ps1    # Test all MCP server connections
└── docs/
    ├── README.md
    ├── credential-setup.md
    └── architecture.md          # Mermaid diagram of data flow
```

## Implementation approach

### Phase 1: Foundation (do this first)
1. Scaffold the project with TypeScript, Express, Vite, React
2. Set up SQLite database with schema
3. Build the MCP client manager that can connect to multiple MCP servers via stdio
4. Create the task aggregator service — start with just ONE source (Jira) to prove the pattern
5. Build basic task list UI
6. Get it running at localhost:3000

### Phase 2: All Sources
7. Add ms-365 MCP integration (To Do, Planner, Outlook, Calendar)
8. Add Monday.com MCP integration
9. Build the priority scoring engine
10. Implement auto-refresh scheduler

### Phase 3: ChatGPT Rituals
11. Implement OpenAI Responses API integration with conversation state
12. Build the standup flow — context assembly → multi-turn chat → summary → save
13. Build the reflection flow
14. Build the chat UI components
15. Add history view with search

### Phase 4: Polish
16. MCP server health monitoring
17. Settings panel
18. Dark mode
19. Error handling and retry logic
20. Export standup/reflection to markdown files
21. Write setup documentation

## Important constraints
- Windows environment — `cmd /c` wrappers for npx where needed in MCP configs
- All credentials in .env, never hardcode
- ms-365-mcp-server is the SINGLE server for all Microsoft services — don't install separate ones
- SQLite only — no external database dependencies
- Must work offline for the UI (cached task list) even if MCP servers are temporarily unreachable
- The ChatGPT integration uses MY OpenAI API key, not a ChatGPT Plus subscription — this is API-based
- Start all MCP servers in read-only mode where flags exist
- The app is the MCP CLIENT, the MCP servers are separate processes it connects to

## MCP best practices to follow
(Reference: Anthropic MCP Builder skill)
- Tool naming: `{service}_{action}_{resource}` in snake_case
- Handle pagination properly — some sources may return hundreds of items
- Actionable error messages
- Test connections with MCP Inspector: `npx @modelcontextprotocol/inspector`
- Use Zod for all input/output validation

## Frontend design direction
(Reference: Anthropic frontend-design skill)
- Clean, utilitarian aesthetic — this is a productivity tool, not a marketing site
- Think: linear.app meets cal.com. Functional density, not flashy
- Dark mode as default, light mode option
- Monospace or semi-monospace font for task items (e.g. JetBrains Mono, IBM Plex Mono)
- Accent colour for SLA urgency (red/amber countdown timers)
- Source badges with recognisable icons (Jira blue, MS purple, Monday orange)
- The chat interface for standups should feel like a real conversation, not a form
- Responsive: works on 13" laptop, external monitor, and mobile browser

## Output
Work through this phase by phase. After each phase:
1. Confirm what's working
2. Show me how to test it
3. Flag any issues or decisions I need to make

Start with Phase 1 now. Set up the project scaffold, database, and get the first MCP connection (Jira) working with a basic task list in the browser.
```
