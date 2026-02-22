# Power Automate Desktop Bridge

Temporary bridge to push Microsoft 365 data into DayPilot while MS365 MCP admin consent is pending.

## Prerequisites

- DayPilot running on `localhost:3001`
- Power Automate Desktop installed (comes with Windows 11)
- Signed into your Microsoft 365 account on the PC

## How It Works

PA Desktop flows fetch data from M365 using your logged-in credentials, transform it to JSON, and POST it to `http://localhost:3001/api/ingest`. DayPilot upserts the tasks and can clean up stale ones when the ingest is authoritative.

## API Endpoint

```
POST http://localhost:3001/api/ingest
POST http://localhost:3001/api/ingest?prune=true   # authoritative sync: remove tasks not in payload
Content-Type: application/json

{
  "source": "planner",       // planner | todo | calendar | email
  "tasks": [
    {
      "source": "planner",
      "source_id": "unique-id-from-source",
      "source_url": "https://...",    // optional
      "title": "Task title",
      "description": "Details",       // optional
      "status": "open",              // open | in_progress | done
      "priority": 50,                // 0-100
      "due_date": "2026-02-25",     // optional, ISO 8601
      "category": "project"          // optional
    }
  ]
}
```

**Health check:** `GET http://localhost:3001/api/ingest/status`

## Flow 1: Planner Tasks

### Steps in PA Desktop

1. **Get Planner plans** — Use the "List my Planner plans" action (Microsoft 365 connector)
2. **For each plan** — Loop through the plans
3. **Get tasks for plan** — Use "List Planner tasks" for each plan
4. **Filter** — Skip tasks where `percentComplete` equals 100
5. **Build JSON** — Use "Run PowerShell script" action (see below)
6. **POST to DayPilot** — Use "Invoke web service" action

### PowerShell Script for Planner

Use this in a "Run PowerShell script" action to build the JSON payload. Replace the `$tasks` array with your actual PA Desktop variables.

```powershell
# $plannerTasks should be the list of tasks from PA Desktop
$output = @()

foreach ($task in $plannerTasks) {
    # Skip completed
    if ($task.percentComplete -eq 100) { continue }

    # Map priority (Planner uses 0-10 scale)
    $priority = switch ($task.priority) {
        { $_ -le 1 } { 90 }   # Urgent
        { $_ -le 3 } { 70 }   # Important
        { $_ -le 5 } { 50 }   # Medium
        { $_ -le 7 } { 30 }   # Low
        default { 20 }
    }

    # Map status
    $status = if ($task.percentComplete -gt 0) { "in_progress" } else { "open" }

    $output += @{
        source     = "planner"
        source_id  = $task.id
        title      = $task.title
        status     = $status
        priority   = $priority
        due_date   = $task.dueDateTime
        category   = "project"
    }
}

$body = @{
    source = "planner"
    tasks  = $output
} | ConvertTo-Json -Depth 5

# POST to DayPilot
Invoke-RestMethod -Uri "http://localhost:3001/api/ingest?prune=true" -Method POST -ContentType "application/json" -Body $body
```

## Flow 2: To-Do Items

### PowerShell Script for To-Do

```powershell
# Uses Microsoft Graph API via the logged-in user's token
# PA Desktop can get the token from the Microsoft 365 connector

$output = @()

foreach ($task in $todoTasks) {
    if ($task.status -eq "completed") { continue }

    $priority = switch ($task.importance) {
        "high"   { 80 }
        "normal" { 50 }
        "low"    { 30 }
        default  { 50 }
    }

    $status = if ($task.status -eq "inProgress") { "in_progress" } else { "open" }

    $output += @{
        source      = "todo"
        source_id   = $task.id
        title       = $task.title
        description = $task.body.content
        status      = $status
        priority    = $priority
        due_date    = $task.dueDateTime.dateTime
        category    = "personal"
    }
}

$body = @{
    source = "todo"
    tasks  = $output
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3001/api/ingest?prune=true" -Method POST -ContentType "application/json" -Body $body
```

## Flow 3: Calendar Events (Next 7 Days)

### PowerShell Script for Calendar

```powershell
$output = @()

foreach ($event in $calendarEvents) {
    $output += @{
        source      = "calendar"
        source_id   = $event.id
        source_url  = $event.webLink
        title       = $event.subject
        description = $event.bodyPreview
        status      = "open"
        priority    = 40
        due_date    = $event.start.dateTime
        category    = "admin"
    }
}

$body = @{
    source = "calendar"
    tasks  = $output
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3001/api/ingest?prune=true" -Method POST -ContentType "application/json" -Body $body
```

## Flow 4: Flagged Emails

### PowerShell Script for Email

```powershell
$output = @()

foreach ($msg in $flaggedMessages) {
    $priority = if ($msg.importance -eq "high") { 75 } else { 45 }
    $fromName = $msg.from.emailAddress.name

    $output += @{
        source      = "email"
        source_id   = $msg.id
        source_url  = $msg.webLink
        title       = $msg.subject
        description = if ($fromName) { "From: $fromName" } else { $null }
        status      = "open"
        priority    = $priority
        due_date    = $msg.flag.dueDateTime.dateTime
        category    = "admin"
    }
}

$body = @{
    source = "email"
    tasks  = $output
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:3001/api/ingest?prune=true" -Method POST -ContentType "application/json" -Body $body
```

## All-In-One Approach

Instead of 4 separate flows, you can create a single PA Desktop flow that uses "Run PowerShell script" to call the Microsoft Graph API directly and push all sources in sequence:

```powershell
# Check if DayPilot is running
try {
    Invoke-RestMethod -Uri "http://localhost:3001/api/ingest/status" -Method GET | Out-Null
} catch {
    Write-Host "DayPilot not running, skipping sync"
    exit
}

# You'll need a Graph API token — PA Desktop can provide this
# via the Microsoft 365 connector, or you can use:
# Connect-MgGraph -Scopes "Tasks.Read", "Calendars.Read", "Mail.Read"

# Then run each section above in sequence...
```

## Scheduling

**Option A: PA Desktop Scheduler**
- Open PA Desktop > Your flow > Triggers > Add trigger > Schedule
- Set to run every 15 minutes

**Option B: Windows Task Scheduler**
- Create a task that launches PA Desktop flow on a schedule
- More reliable for unattended runs

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Connection refused" | DayPilot server not running. Start with `npm run dev` |
| 400 error | Check JSON format matches the schema above |
| Tasks not appearing | Check the `source` field matches: planner, todo, calendar, email |
| Stale tasks not cleared | Add `?prune=true` to the POST URL and send the full list each time. |
| Empty POST clears all | Only when `?prune=true` is used. Without `prune`, empty payloads do nothing. |

## Priority Scale Reference

| Value | Meaning |
|-------|---------|
| 90-100 | Critical/Urgent |
| 70-89 | High/Important |
| 50-69 | Medium/Normal |
| 30-49 | Low |
| 0-29 | Lowest |

## Status Values

| Value | Meaning |
|-------|---------|
| `open` | Not started |
| `in_progress` | Work underway |
| `done` | Completed (usually filtered out) |
