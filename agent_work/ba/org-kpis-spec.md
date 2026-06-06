# NOVA KPI Rebuild — Layer 1: Organisational KPIs (BA Spec)

Single source of truth for the rebuilt KPI system. We define **each KPI one at a time**;
nothing gets built until its card below is agreed.

Source spreadsheet: `Daily KPI Tracker support v2.xlsx` (tab `June 26` used for the inventory).
Grouping = the spreadsheet's **"Team Responsible"** column (top-level team = one tab each).

## Three-layer plan
1. **Organisational KPIs** — from the spreadsheet above (THIS doc).
2. Operational KPIs — running teams (later).
3. Individual KPIs — per person (later).

## Locked framework decisions
- **Jira-backed teams** (NT, NTPJ, STBY, YO): compute **fresh inside NOVA** from Jira — but
  every KPI's computation is **defined from scratch and agreed individually**. We do NOT bulk-port
  the old engine (that produced the bizarre numbers).
- **Rollup (daily → MTD)** is decided **per KPI** (no global rule). Each card declares its rule:
  `sum` (flows) | `latest` (stocks) | `average` | `min` | `max`.
- Non-Jira teams: **manual entry or import** (spec'd when we reach them).
- **EOD capture / freeze:** stock KPIs are *live during the day and frozen at 18:00 (6pm) UK*.
  The daily captured value = the state at 18:00. Rollup for stocks = `latest`.
- **NT "open" filter (canonical):** `statusCategory != Done AND status NOT IN (Closed, Resolved)`
  — whole Done category plus the named statuses (belt and braces). Use for every NT open-count KPI.
- **NT request-type field (canonical):** JSM customer request type = **`customfield_12800`**
  (JQL `"request type"`, values suffixed `(NT)` e.g. `Incident (NT)`). NOT cf13482.
  ⚠ BUILD FLAG: `jira-sync-service.ts` currently reads **cf13482** into the cache `request_type`
  column. KPI compute must use **cf12800** (or first confirm cf12800 == cf13482 on NT), else the
  cached field is the wrong one for these KPIs.
- **NT CurrentTier:** `customfield_12981` (.value: Customer Care / Production / Tier 2 / Tier 3 / Development).

## Definition card template
```
KPI: <name>                          Team Responsible: <tab>
Sheet context (col A): <sub-label>
Source:        Jira:<space> | Manual | Import
Measures:      <plain-English: what this number means>
Computation:   <exact JQL / field logic / formula>
Unit:          count | % | £ | duration | date
Direction:     higher-better | lower-better | target-band
Daily target:  <val>     Monthly target: <val>
Rollup (MTD):  sum | latest | average | min | max
RAG:           green … / amber … / red …
Edge cases:    <exclusions, statuses, business-hours, timezone>
Status:        DRAFT | AGREED | BUILT
```

---

# Team: Support (Jira space: NT) — 22 KPIs

Inventory (daily targets from sheet; monthly targets all blank):

| # | KPI | col A | Daily target |
|---|-----|-------|--------------|
| 1 | New Tickets | Support | 100 |
| 2 | Solved by Team | Support | 120 |
| 3 | Solved by NOVA | Support | 15 |
| 4 | Number of Incidents Tickets | Support | 75 |
| 5 | Number of Production Tickets | Support | 75 |
| 6 | Number of Tickets in Development | Development | 150 |
| 7 | Number of Incidents Tickets With No Reply | Support | 0 |
| 8 | Number of Production Tickets With No Reply | Support | 0 |
| 9 | Number of Incident tickets over SLA (actionable) | Support | 0 |
| 10 | Number of Production tickets over SLA (actionable) | Support | 0 |
| 11 | Number of Incident tickets over SLA (Not actionable) | Support | 20 |
| 12 | Number of Production tickets over SLA (Not actionable) | Support | 20 |
| 13 | Tickets escalated | Support | 20 |
| 14 | Tickets rejected | Support | 10 |
| 15 | Oldest actionable Incident ticket | Support | 5 |
| 16 | Oldest actionable Production ticket | Support | 15 |
| 17 | Oldest actionable Development ticket | Support | 60 |
| 18 | Failed Jobs remaining on Board | Support | 100 |
| 19 | No. of CI In Progress (unmitigated) | Support | 0 |
| 20 | Number of TPJ Tickets | Support | 50 |
| 21 | Open Product Launch Incidents | Development | 0 |
| 22 | Number of TPJ Tickets in Dev/T3 | Development | 75 |

## Reference
- NT `CurrentTier` field = `customfield_12981` (Customer Care / Production / Tier 2 / Tier 3 / Development) — splits Incident vs Production vs Development.
- Existing computation reference: n8n **Daily KPI Report v4** (`KriwNYXfWcGBW7D7`).

---

## Cards

```
KPI: New Tickets                     Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (via jira_issue_cache)
Measures:      Count of all tickets raised in the NT project on the day.
Computation:   COUNT(jira_issue_cache WHERE project_key='NT'
               AND jira_created BETWEEN day 00:00 and 23:59:59 UK)
               No filtering — every NT issue created that day counts.
Unit:          count
Direction:     lower-better (ceiling)
Daily target:  100      Monthly target: —
Rollup (MTD):  sum
RAG:           green ≤100 / amber 101–120 / red >120   (bands provisional)
Edge cases:    No issue-type / request-type / reporter filtering.
               Flow metric → captured daily at EOD into kpi_daily.
Status:        AGREED
```

### Evidence: "Solved" counting methods (yesterday, 2026-06-05, project NT)
Empirical comparison run via live Jira JQL before locking the definition:

| Method | Total | NOVA | Team |
|--------|------:|-----:|-----:|
| A — *legacy*: statusCategory=Done AND `updated`=day | 119 | 32 | 87 |
| B — `resolutiondate`=day | 23 | 0 | 23 |
| C — status CHANGED TO Done DURING day | 141 | 61 | 80 |
| **D — currently Done AND changed to Done during day** ✅ | **138** | **61** | **77** |

Findings:
- **Legacy method (A) is wrong**: `updated` inflates the total (counts edits to already-closed
  tickets) and under-reports NOVA (32 vs true 61 — only sees NOVA tickets still Done + edited).
- **`resolutiondate` (B) is unusable on NT**: NOVA sets it on 0 tickets (moves to *Resolved*
  without setting the resolution field); humans set it on only 23 of 77. Would silently zero NOVA.
- **Correct signal = the status transition into a Done-category status on the day** (Method D),
  split by current assignee. C vs D differ by 3 → reopens are rare.
- NOVA's 61 = 48 WP Engine Smart-Plugin-Manager auto-tickets + ~13 other (mostly automation).
  Decision: **count every solved NT ticket regardless of source** — no automated-ticket exclusion.

```
KPI: Solved by Team                  Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (EOD JQL capture — NOT jira_issue_cache)
Measures:      Tickets solved in NT on the day by anyone other than NOVA (incl. unassigned)
Computation:   COUNT NT issues WHERE status CHANGED TO ("Resolved","Closed","Done")
               DURING the day AND currently statusCategory=Done
               AND current assignee ≠ NOVA-Jira (712020:67acd53f-75f0-4548-adfe-91bba72ad38f)
Unit:          count
Direction:     higher-better (floor)
Daily target:  120      Monthly target: —
Rollup (MTD):  sum
RAG:           green ≥120 / amber 100–119 / red <100   (bands provisional)
Edge cases:    Team = everything not solved by NOVA (unassigned counts as Team).
               Captured daily at EOD; cannot be derived from current-state cache.
Status:        AGREED
```

```
KPI: Solved by NOVA                  Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (EOD JQL capture)
Measures:      Tickets solved in NT on the day by the NOVA-Jira app account
Computation:   COUNT NT issues WHERE status CHANGED TO ("Resolved","Closed","Done")
               DURING the day AND currently statusCategory=Done
               AND current assignee = NOVA-Jira (712020:67acd53f-75f0-4548-adfe-91bba72ad38f)
Unit:          count
Direction:     higher-better (floor) — informational; tracks NOVA throughput
Daily target:  15       Monthly target: —
Rollup (MTD):  sum
RAG:           provisional — target 15/day looks low vs observed ~61. Revisit target.
Edge cases:    Current assignee = NOVA because prepareTicketForClose reassigns to NOVA on close.
               Includes auto-closed machine tickets (plugin alerts etc.) — counted by design.
Status:        AGREED
```

> ⚠ Target review: "Solved by NOVA" target is 15/day but NOVA cleared 61 yesterday. The sheet
> targets predate NOVA's current throughput — flag for re-baselining once all NT cards are done.

```
KPI: Number of Incidents Tickets     Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (open-count off current state; freeze at 18:00)
Measures:      Open incident tickets in the front-line support queue
Computation (canonical JQL):
   project = NT
   AND statusCategory != Done AND status NOT IN (Closed, Resolved)
   AND "current tier" (cf12981) IN ("Customer Care", "Tier 2")
   AND "request type" (cf12800) IN
       ("Incident (NT)", "Chat (NT)", "Emailed request (NT)", "AI Request (NT)",
        "TPJ Request (NT)", "GDPR (NT)", EMPTY)
   (Service Request (NT) explicitly excluded.)
Unit:          count
Direction:     lower-better (ceiling)
Daily target:  75       Monthly target: —
Rollup (MTD):  latest (stock; value frozen at 18:00)
RAG:           green ≤75 / amber 76–90 / red >90   (bands provisional)
Edge cases:    Untriaged (EMPTY request type) counts as Incident. Live during day, frozen 18:00.
Validation:    Nick's JQL = 107, my equivalent = 109 (live-queue drift + field nuance) on 2026-06-06.
               Currently over the 75 target.
Status:        AGREED
```

```
KPI: Number of Production Tickets    Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (open-count; freeze at 18:00)
Measures:      Open production-class tickets (onboarding / delivery QA / service requests)
Computation (canonical JQL):
   project = NT
   AND statusCategory != Done AND status NOT IN (Closed, Resolved)
   AND "current tier" (cf12981) IN ("Customer Care", "Tier 2", "Production")
   AND "request type" (cf12800) IN ("Onboarding (NT)", "Delivery QA (NT)", "Service Request (NT)")
Unit:          count
Direction:     lower-better (ceiling)
Daily target:  75       Monthly target: —
Rollup (MTD):  latest (stock; frozen 18:00)
RAG:           green ≤75 / amber 76–90 / red >90   (bands provisional)
Edge cases:    Complement of Incident by request type (Service Request is here, not in Incident).
               Gap: a Production-tier ticket whose request type ∉ this set falls into neither #4 nor #5.
Validation:    90 open on 2026-06-06 (target 75) → slightly over.
Status:        AGREED
```

```
KPI: Number of Tickets in Development  Team Responsible: Support (NT)
Sheet context (col A): Development
Source:        Jira:NT (open-count; freeze at 18:00)
Measures:      Open tickets escalated to the dev tiers
Computation (canonical JQL):
   project = NT
   AND statusCategory != Done AND status NOT IN (Closed, Resolved)
   AND "current tier" (cf12981) IN ("Tier 3", "Development")
   (No request-type filter — all request types at these tiers count.)
Unit:          count
Direction:     lower-better (ceiling)
Daily target:  150      Monthly target: —
Rollup (MTD):  latest (stock; frozen 18:00)
RAG:           green ≤150 / amber 151–180 / red >180   (bands provisional)
Edge cases:    Tier 3 folds into Development (per Nick). This is the only KPI that captures Tier 3.
Validation:    199 open on 2026-06-06 (target 150) → over.
Status:        AGREED
```

### Shared condition: isNoReply (adopted verbatim from kpi-pipeline.ts:152)
A ticket is "No Reply" iff ALL hold:
1. status ≠ "Waiting on requestor"
2. ≥ 4h old (`jira_created`)
3. no future `agent_next_update` (cf14185)
4. `agent_last_updated` (cf14081) is set (untouched tickets are NOT No Reply — known blind spot, accepted)
5. `agent_last_updated` < today 00:00 UTC (not updated today)
6. `agent_last_updated` ≥ now − 52 weeks
Meaning: "overdue for an agent update". Build needs cf14081/cf14185 (already synced to cache).

```
KPI: Number of Incidents Tickets With No Reply   Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (open-count; freeze 18:00)
Measures:      Open Incident-bucket tickets overdue for an agent update
Computation:   (Incident bucket, see #4) AND isNoReply (shared condition above)
Unit:          count    Direction: lower-better (ceiling)
Daily target:  0        Rollup (MTD): latest (stock, frozen 18:00)
RAG:           green 0 / amber 1–5 / red >5   (bands provisional)
Edge cases:    Brand-new untouched tickets excluded (gate 4). 4h grace (gate 2).
Status:        AGREED
```

```
KPI: Number of Production Tickets With No Reply   Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (open-count; freeze 18:00)
Measures:      Open Production-bucket tickets overdue for an agent update
Computation:   (Production bucket, see #5) AND isNoReply (shared condition above)
Unit:          count    Direction: lower-better (ceiling)
Daily target:  0        Rollup (MTD): latest (stock, frozen 18:00)
RAG:           green 0 / amber 1–5 / red >5   (bands provisional)
Status:        AGREED
```

### Shared conditions: Over-SLA + actionable split (#9–#12)
- **Over SLA** = Resolution SLA breached = `customfield_14048` JSM SLA cycle `breached` or remaining < 0.
- **Due-date gate (ACTIONABLE only)** — added 2026-06-06 per Nick (legacy def is correct):
  over-SLA *actionable* (#9/#10) counts only tickets with `(duedate is EMPTY OR duedate <= endOfDay())`.
  The *not-actionable* counts (#11/#12) keep NO due-date gate. Applied in registry + wallboard-tiers.
- **Actionable** statuses (target 0 — we can act): Open, Work in progress, Reopened,
  Waiting on Assignee, Pending Rejection Approval (+ any other open status NOT waiting-on-external).
- **Not actionable** statuses (target 20 — out of our hands): Waiting On Requestor,
  Waiting On Partner, Waiting on Development (rule: any "Waiting on <external party>";
  "Waiting on Assignee" is OURS → actionable).
- Differs from legacy code, which excluded waiting-on-customer entirely. New scheme puts them in not-actionable.

```
KPI: Number of Incident tickets over SLA (actionable)    Team: Support (NT)
Computation:   (Incident bucket #4) AND Resolution SLA (cf14048) breached
               AND status ∈ Actionable set
Unit: count | Direction: lower-better | Daily target: 0 | Rollup: latest (frozen 18:00)
RAG: green 0 / amber 1–5 / red >5 (provisional)
Status: AGREED
```

```
KPI: Number of Production tickets over SLA (actionable)  Team: Support (NT)
Computation:   (Production bucket #5) AND Resolution SLA (cf14048) breached
               AND status ∈ Actionable set
Unit: count | Direction: lower-better | Daily target: 0 | Rollup: latest (frozen 18:00)
RAG: green 0 / amber 1–5 / red >5 (provisional)
Status: AGREED
```

```
KPI: Number of Incident tickets over SLA (Not actionable)   Team: Support (NT)
Computation:   (Incident bucket #4) AND Resolution SLA (cf14048) breached
               AND status ∈ Not-actionable set (Waiting On Requestor/Partner/Development)
Unit: count | Direction: lower-better (ceiling) | Daily target: 20 | Rollup: latest (frozen 18:00)
RAG: green ≤20 / amber 21–30 / red >30 (provisional)
Status: AGREED
```

```
KPI: Number of Production tickets over SLA (Not actionable)  Team: Support (NT)
Computation:   (Production bucket #5) AND Resolution SLA (cf14048) breached
               AND status ∈ Not-actionable set (Waiting On Requestor/Partner/Development)
Unit: count | Direction: lower-better (ceiling) | Daily target: 20 | Rollup: latest (frozen 18:00)
RAG: green ≤20 / amber 21–30 / red >30 (provisional)
Status: AGREED
```

> Validation deferred to build (JSM SLA breach needs `"Time to resolution" = breached()` JQL — check then).

```
KPI: Tickets escalated               Team Responsible: Support (NT)
Source:        NOVA escalation_log table (NOT Jira directly)
Measures:      Distinct NT tickets escalated on the day
Computation:   COUNT(DISTINCT ticket_key) FROM escalation_log
               WHERE ticket_key LIKE 'NT-%' AND escalation_type <> 'rejection'
               AND created_at within the day
Unit:          count    Direction: lower-better (ceiling)
Daily target:  20       Rollup (MTD): sum
RAG:           green ≤20 / amber 21–30 / red >30   (provisional)
Edge cases:    Distinct tickets, not events (a ticket bumped 2 tiers = 1).
               Flow → daily capture. escalation_log includes manual/ai_agent/jira_transition/sla_risk/complaint_portal.
Status:        AGREED
```

```
KPI: Tickets rejected                Team Responsible: Support (NT)
Source:        NOVA escalation_log table
Measures:      Distinct NT tickets rejected/bounced on the day
Computation:   COUNT(DISTINCT ticket_key) FROM escalation_log
               WHERE ticket_key LIKE 'NT-%' AND escalation_type = 'rejection'
               AND created_at within the day
Unit:          count    Direction: lower-better (ceiling)
Daily target:  10       Rollup (MTD): sum
RAG:           green ≤10 / amber 11–15 / red >15   (provisional)
Status:        AGREED
```

### Shared: Oldest actionable (#15–17)
Max age in days among ACTIONABLE tickets in the bucket. Actionable set = same as #9-12
(Open, WIP, Reopened, Waiting on Assignee, Pending Rejection Approval). Age = (18:00 freeze − `jira_created`)
in whole days. Stock → rollup `latest`. Direction lower-better.

```
KPI: Oldest actionable Incident ticket     Team: Support (NT)
Computation:   MAX(days since jira_created) over (Incident bucket #4) AND status ∈ Actionable set
Unit: days | Direction: lower-better | Daily target: 5 | Rollup: latest (frozen 18:00)
RAG: green ≤5 / amber 6–10 / red >10 (provisional)
Status: AGREED
```

```
KPI: Oldest actionable Production ticket    Team: Support (NT)
Computation:   MAX(days since jira_created) over (Production bucket #5) AND status ∈ Actionable set
Unit: days | Direction: lower-better | Daily target: 15 | Rollup: latest (frozen 18:00)
RAG: green ≤15 / amber 16–25 / red >25 (provisional)
Status: AGREED
```

```
KPI: Oldest actionable Development ticket    Team: Support (NT)
Computation:   MAX(days since jira_created) over (Development bucket #6) AND status ∈ Actionable set
Unit: days | Direction: lower-better | Daily target: 60 | Rollup: latest (frozen 18:00)
RAG: green ≤60 / amber 61–90 / red >90 (provisional)
Status: AGREED
```

```
KPI: Failed Jobs remaining on Board   Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        MANUAL ENTRY (for now)
Measures:      Failed automated jobs remaining on the Grafana board
Computation:   Manual. Underlying data = a SQL query on a specific DB feeding a Grafana board.
               FUTURE: automate by running that SQL query directly.
Unit: count | Direction: lower-better (ceiling) | Daily target: 100 | Rollup: latest (manual, EOD)
RAG: green ≤100 / amber 101–150 / red >150 (provisional)
Status: AGREED (manual)
```

```
KPI: No. of CI In Progress (unmitigated)   Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        MANUAL ENTRY (for now)
Measures:      Active Critical Incidents not yet mitigated
Computation:   Manual. FUTURE: build a mechanism to identify CIs and pull from Jira.
Unit: count | Direction: lower-better (ceiling) | Daily target: 0 | Rollup: latest (manual, EOD)
RAG: green 0 / amber 1 / red >1 (provisional)
Status: AGREED (manual) — automation is a follow-up workstream
```

```
KPI: Number of TPJ Tickets            Team Responsible: Support (NT)
Sheet context (col A): Support
Source:        Jira:NT (open-count; freeze 18:00)
Computation:   project = NT AND (open filter) AND "request type" (cf12800) = "TPJ Request (NT)"
               AND "current tier" (cf12981) IN ("Customer Care", "Tier 2")
Unit: count | Direction: lower-better (ceiling) | Daily target: 50 | Rollup: latest (frozen 18:00)
RAG: green ≤50 / amber 51–65 / red >65 (provisional)
Edge cases:    Subset of #4 Incident (which also counts TPJ Request at CC/T2) — intentional overlap.
Status: AGREED
```

```
KPI: Open Product Launch Incidents    Team Responsible: Development (NT)
Sheet context (col A): Development
Source:        Jira:NT (open-count; freeze 18:00)
Computation:   project = NT AND (open filter) AND "request type" (cf12800) = <Product Launch request type>
               ⚠ Confirm exact request-type value (e.g. "Product Launch Incident (NT)") at build.
Unit: count | Direction: lower-better (ceiling) | Daily target: 0 | Rollup: latest (frozen 18:00)
RAG: green 0 / amber 1 / red >1 (provisional)
Status: AGREED (pending exact request-type value)
```

```
KPI: Number of TPJ Tickets in Dev/T3   Team Responsible: Development (NT)
Sheet context (col A): Development
Source:        Jira:NT (open-count; freeze 18:00)
Computation:   project = NT AND (open filter) AND "request type" (cf12800) = "TPJ Request (NT)"
               AND "current tier" (cf12981) IN ("Tier 3", "Development")
Unit: count | Direction: lower-better (ceiling) | Daily target: 75 | Rollup: latest (frozen 18:00)
RAG: green ≤75 / amber 76–90 / red >90 (provisional)
Status: AGREED
```

---

## ✅ Support (NT) — ALL 22 KPIs AGREED (2026-06-06)
20 Jira-computed + 2 manual (#18 Failed Jobs, #19 CI). Open items: re-baseline targets vs current
throughput; confirm #21 product-launch request-type value; validate #9–12 & #18–22 counts at build;
build flag — KPI compute must read cf12800 (sync currently caches cf13482).

