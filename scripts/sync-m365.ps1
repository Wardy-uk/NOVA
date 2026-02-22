#Requires -Version 7.0
#Requires -Modules Microsoft.Graph.Authentication, Microsoft.Graph.Planner, Microsoft.Graph.Calendar, Microsoft.Graph.Mail, Microsoft.Graph.Users

<#
.SYNOPSIS
    Syncs Microsoft 365 data (Planner, To-Do, Calendar, Flagged Emails) to DayPilot.

.DESCRIPTION
    Connects to Microsoft Graph using interactive/device code auth,
    fetches tasks from M365 sources, and POSTs them to the DayPilot ingest API.
    Run manually or schedule with Task Scheduler.

.PARAMETER Sources
    Which sources to sync. Default: all. Options: planner, todo, calendar, email

.PARAMETER DayPilotUrl
    Base URL of the DayPilot API. Default: http://localhost:3001

.PARAMETER CalendarDays
    Number of days ahead to fetch calendar events. Default: 7
#>

param(
    [string[]]$Sources = @('planner', 'todo', 'calendar', 'email'),
    [string]$DayPilotUrl = 'http://localhost:3001',
    [int]$CalendarDays = 7
)

$ErrorActionPreference = 'Stop'
$IngestUrl = "$DayPilotUrl/api/ingest"

# --- Check DayPilot is running ---
try {
    $status = Invoke-RestMethod -Uri "$IngestUrl/status" -Method GET -TimeoutSec 5
    if ($status.ok -ne $true) { throw "Unexpected response" }
    Write-Host "[OK] DayPilot is running" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] DayPilot not reachable at $DayPilotUrl" -ForegroundColor Red
    Write-Host "Start it with: npm run dev" -ForegroundColor Yellow
    exit 1
}

# --- Connect to Microsoft Graph ---
$scopes = @(
    'Tasks.Read'        # Planner
    'Tasks.ReadWrite'   # To-Do (needs ReadWrite for list access)
    'Calendars.Read'    # Calendar
    'Mail.Read'         # Email
)

$context = Get-MgContext
if (-not $context) {
    Write-Host "Signing in to Microsoft Graph (device code)..." -ForegroundColor Cyan
    Write-Host "A code will appear below — open the URL in your browser and enter it." -ForegroundColor Yellow
    Connect-MgGraph -Scopes $scopes -UseDeviceCode -NoWelcome
    $context = Get-MgContext
}
Write-Host "[OK] Connected as $($context.Account)" -ForegroundColor Green

function Send-ToDayPilot {
    param(
        [string]$Source,
        [array]$Tasks
    )
    $body = @{
        source = $Source
        tasks  = $Tasks
    } | ConvertTo-Json -Depth 10 -Compress

    try {
        $result = Invoke-RestMethod -Uri $IngestUrl -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 30
        Write-Host "  -> $Source : $($result.data.upserted) upserted, $($result.data.removed) removed" -ForegroundColor Gray
    } catch {
        Write-Host "  -> $Source : FAILED - $($_.Exception.Message)" -ForegroundColor Red
    }
}

# === PLANNER ===
if ($Sources -contains 'planner') {
    Write-Host "`n[Planner] Fetching tasks..." -ForegroundColor Cyan
    $tasks = @()

    try {
        $plans = Get-MgUserPlannerPlan -UserId 'me' -All
        foreach ($plan in $plans) {
            $planTasks = Get-MgPlannerPlanTask -PlannerPlanId $plan.Id -All

            foreach ($t in $planTasks) {
                if ($t.PercentComplete -eq 100) { continue }

                $priority = switch ($t.Priority) {
                    { $_ -le 1 } { 90 }
                    { $_ -le 3 } { 70 }
                    { $_ -le 5 } { 50 }
                    { $_ -le 7 } { 30 }
                    default { 20 }
                }

                $status = if ($t.PercentComplete -gt 0) { 'in_progress' } else { 'open' }

                $tasks += @{
                    source    = 'planner'
                    source_id = $t.Id
                    title     = $t.Title
                    status    = $status
                    priority  = $priority
                    due_date  = if ($t.DueDateTime) { $t.DueDateTime.ToString('o') } else { $null }
                    category  = 'project'
                }
            }
        }
        Write-Host "  Found $($tasks.Count) active planner tasks"
        Send-ToDayPilot -Source 'planner' -Tasks $tasks
    } catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}

# === TO-DO ===
if ($Sources -contains 'todo') {
    Write-Host "`n[To-Do] Fetching tasks..." -ForegroundColor Cyan
    $tasks = @()

    try {
        $lists = Get-MgUserTodoList -UserId 'me' -All

        foreach ($list in $lists) {
            $todoTasks = Get-MgUserTodoListTask -UserId 'me' -TodoTaskListId $list.Id -All

            foreach ($t in $todoTasks) {
                if ($t.Status -eq 'completed') { continue }

                $priority = switch ($t.Importance) {
                    'high'   { 80 }
                    'normal' { 50 }
                    'low'    { 30 }
                    default  { 50 }
                }

                $status = if ($t.Status -eq 'inProgress') { 'in_progress' } else { 'open' }

                $tasks += @{
                    source      = 'todo'
                    source_id   = $t.Id
                    title       = $t.Title
                    description = $t.Body.Content
                    status      = $status
                    priority    = $priority
                    due_date    = if ($t.DueDateTime) { $t.DueDateTime.DateTime } else { $null }
                    category    = 'personal'
                }
            }
        }
        Write-Host "  Found $($tasks.Count) active to-do items"
        Send-ToDayPilot -Source 'todo' -Tasks $tasks
    } catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}

# === CALENDAR ===
if ($Sources -contains 'calendar') {
    Write-Host "`n[Calendar] Fetching events (next $CalendarDays days)..." -ForegroundColor Cyan
    $tasks = @()

    try {
        $start = (Get-Date).ToUniversalTime().ToString('o')
        $end = (Get-Date).AddDays($CalendarDays).ToUniversalTime().ToString('o')

        $events = Get-MgUserCalendarView -UserId 'me' -StartDateTime $start -EndDateTime $end -All

        foreach ($e in $events) {
            $tasks += @{
                source      = 'calendar'
                source_id   = $e.Id
                source_url  = $e.WebLink
                title       = $e.Subject
                description = $e.BodyPreview
                status      = 'open'
                priority    = 40
                due_date    = if ($e.Start) { $e.Start.DateTime } else { $null }
                category    = 'admin'
            }
        }
        Write-Host "  Found $($tasks.Count) calendar events"
        Send-ToDayPilot -Source 'calendar' -Tasks $tasks
    } catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}

# === FLAGGED EMAILS ===
if ($Sources -contains 'email') {
    Write-Host "`n[Email] Fetching flagged messages..." -ForegroundColor Cyan
    $tasks = @()

    try {
        $messages = Get-MgUserMessage -UserId 'me' -Filter "flag/flagStatus eq 'flagged'" -Top 50 -All

        foreach ($m in $messages) {
            $priority = if ($m.Importance -eq 'high') { 75 } else { 45 }
            $fromName = $m.From.EmailAddress.Name

            $tasks += @{
                source      = 'email'
                source_id   = $m.Id
                source_url  = $m.WebLink
                title       = $m.Subject
                description = if ($fromName) { "From: $fromName" } else { $null }
                status      = 'open'
                priority    = $priority
                due_date    = if ($m.Flag.DueDateTime) { $m.Flag.DueDateTime.DateTime } else { $null }
                category    = 'admin'
            }
        }
        Write-Host "  Found $($tasks.Count) flagged emails"
        Send-ToDayPilot -Source 'email' -Tasks $tasks
    } catch {
        Write-Host "  [ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host "`n[Done] M365 sync complete." -ForegroundColor Green
