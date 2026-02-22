# Power Automate Cloud Flows for DayPilot

These flows run in Power Automate Cloud (flow.microsoft.com) using first-party Microsoft connectors (no admin consent needed). Each flow writes a JSON file to your OneDrive, which syncs locally. DayPilot's server watches the folder and auto-ingests the data.

## Setup

1. Ensure OneDrive sync is active on your PC
2. DayPilot creates/watches: `OneDrive - Nurtur Limited/DayPilot/`
3. Each flow writes one file: `planner.json`, `todo.json`, `calendar.json`, `email.json`

---

## Flow 1: Planner Tasks

**Trigger:** Recurrence — every 15 minutes

### Steps:

1. **Recurrence** — Every 15 minutes
2. **List my plans** (Planner connector) — No parameters needed
3. **Initialize variable** — Name: `allTasks`, Type: Array, Value: `[]`
4. **Apply to each** — Select `value` from "List my plans"
   - Inside the loop:
   - **List tasks** (Planner connector) — Plan Id: `id` from current item
   - **Apply to each** — Select `value` from "List tasks"
     - **Condition** — `percentComplete` is not equal to `100`
     - If yes:
       - **Append to array variable** `allTasks` with value:
```json
{
  "source": "planner",
  "source_id": "@{items('Apply_to_each_2')?['id']}",
  "title": "@{items('Apply_to_each_2')?['title']}",
  "status": "@{if(greater(items('Apply_to_each_2')?['percentComplete'], 0), 'in_progress', 'open')}",
  "priority": "@{if(lessOrEquals(items('Apply_to_each_2')?['priority'], 1), 90, if(lessOrEquals(items('Apply_to_each_2')?['priority'], 3), 70, if(lessOrEquals(items('Apply_to_each_2')?['priority'], 5), 50, 30)))}",
  "due_date": "@{items('Apply_to_each_2')?['dueDateTime']}",
  "category": "project"
}
```
5. **Compose** — Input:
```json
{
  "source": "planner",
  "tasks": @{variables('allTasks')}
}
```
6. **Create file** (OneDrive for Business connector)
   - Folder Path: `/DayPilot`
   - File Name: `planner.json`
   - File Content: Output of Compose
   - (Use "Update file" action if the file already exists — or use the **Create or replace file** variant)

### Simpler Alternative: Single Compose with Select

If you want fewer steps, use the **Select** action instead of looping:

1. **List tasks** for each plan
2. **Filter array** — `percentComplete` not equal to `100`
3. **Select** — Map fields to the JSON shape above
4. **Compose** — Wrap in `{ "source": "planner", "tasks": ... }`
5. **Create file** in OneDrive `/DayPilot/planner.json`

---

## Flow 2: To-Do Items

**Trigger:** Recurrence — every 15 minutes

### Steps:

1. **Recurrence** — Every 15 minutes
2. **Initialize variable** — Name: `allTasks`, Type: Array, Value: `[]`
3. **HTTP** (premium) or **Get lists** (Microsoft To Do connector)
   - If using To Do connector: Get all task lists, then for each list get tasks
   - If using HTTP with Graph API:
     - Method: GET
     - URI: `https://graph.microsoft.com/v1.0/me/todo/lists`
     - Authentication: Active Directory OAuth (your tenant)
4. **For each list** — Get tasks from each list
5. **For each task** — Skip completed, append to `allTasks`:
```json
{
  "source": "todo",
  "source_id": "@{items('Apply_to_each_2')?['id']}",
  "title": "@{items('Apply_to_each_2')?['title']}",
  "description": "@{items('Apply_to_each_2')?['body']?['content']}",
  "status": "@{if(equals(items('Apply_to_each_2')?['status'], 'inProgress'), 'in_progress', 'open')}",
  "priority": "@{if(equals(items('Apply_to_each_2')?['importance'], 'high'), 80, if(equals(items('Apply_to_each_2')?['importance'], 'low'), 30, 50))}",
  "due_date": "@{items('Apply_to_each_2')?['dueDateTime']?['dateTime']}",
  "category": "personal"
}
```
6. **Compose + Create file** — Same as Planner, file name: `todo.json`

---

## Flow 3: Calendar Events (Next 7 Days)

**Trigger:** Recurrence — every 15 minutes

### Steps:

1. **Recurrence** — Every 15 minutes
2. **Get calendar view of events** (Office 365 Outlook connector)
   - Calendar Id: (your default calendar or leave default)
   - Start Time: `@{utcNow()}`
   - End Time: `@{addDays(utcNow(), 7)}`
3. **Select** — From: `value`
   - Map:
```json
{
  "source": "calendar",
  "source_id": "@{item()?['id']}",
  "source_url": "@{item()?['webLink']}",
  "title": "@{item()?['subject']}",
  "description": "@{item()?['bodyPreview']}",
  "status": "open",
  "priority": 40,
  "due_date": "@{item()?['start']?['dateTime']}",
  "category": "admin"
}
```
4. **Compose**:
```json
{
  "source": "calendar",
  "tasks": @{body('Select')}
}
```
5. **Create file** — `/DayPilot/calendar.json`

---

## Flow 4: Flagged Emails

**Trigger:** Recurrence — every 15 minutes

### Steps:

1. **Recurrence** — Every 15 minutes
2. **Get emails** (Office 365 Outlook connector)
   - Folder: Inbox
   - Filter Query: `flag/flagStatus eq 'flagged'`
   - Top: 50
3. **Select** — From: `value`
   - Map:
```json
{
  "source": "email",
  "source_id": "@{item()?['id']}",
  "source_url": "@{item()?['webLink']}",
  "title": "@{item()?['subject']}",
  "description": "From: @{item()?['from']?['emailAddress']?['name']}",
  "status": "open",
  "priority": "@{if(equals(item()?['importance'], 'high'), 75, 45)}",
  "due_date": "@{item()?['flag']?['dueDateTime']?['dateTime']}",
  "category": "admin"
}
```
4. **Compose**:
```json
{
  "source": "email",
  "tasks": @{body('Select')}
}
```
5. **Create file** — `/DayPilot/email.json`

---

## How It Works End-to-End

```
PA Cloud Flow (every 15 min)
  -> Fetches M365 data via first-party connectors
  -> Writes JSON to OneDrive /DayPilot/source.json
  -> OneDrive Desktop Client syncs to local folder
  -> DayPilot server polls the folder every 30s
  -> Reads changed JSON files
  -> Upserts tasks + cleans stale ones
  -> Tasks appear in the dashboard
```

## Testing

1. Create one flow (start with Calendar — it's the simplest)
2. Run it manually in PA Cloud
3. Wait for OneDrive to sync (check the local folder)
4. DayPilot should pick it up within 30 seconds
5. Check the server console for `[OneDrive]` log messages

## Tips

- Use "Create or replace file" not "Create file" to avoid duplicates
- If a flow fails, the old JSON file stays — DayPilot keeps showing the last synced data
- If you want to clear a source, write `{ "source": "planner", "tasks": [] }` to the file
- The DayPilot watch folder is: `C:\Users\NickW\OneDrive - Nurtur Limited\DayPilot\`
