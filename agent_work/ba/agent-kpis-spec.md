# NOVA KPI Rebuild — Layer 3: Individual / Agent KPIs (BA Spec)

Per-agent KPIs, rebuilt from scratch with agreed definitions. Same process as the
Layer-1 org KPIs ([[org-kpis-spec.md]]): one card per metric, agreed before build.

## Cadence (same as Layer 1)
- **Live during the day, frozen at 18:00 (EOD snapshot)** into a per-agent daily table.
- Rollup per metric (sum / latest / average …) decided per card.

## Scope
All metrics **except gamification** (achievements/streaks/leaderboard deferred). I.e. tiers 1–3
from the NOVA sweep:

### Tier 1 — Core operational (per-agent slices of the NT engine — CROSSOVER)
Mirror dbo.Agent / SLA Breach Board (which itself mirrors n8n "Daily KPI Report v4"):
- Open tickets (assigned, support tiers)
- Over-SLA (resolution SLA breached, actionable)
- No-Update-Today (stale, not parked)
- Solved Today
- Solved This Week
- Oldest ticket (days) + key

### Tier 2 — Quality (separate pipelines)
- QA: overall / accuracy / clarity / tone, grade distribution (R/A/G), concerning count
- Golden Rules: overall / ownership / next-action / timeframe
- CSAT (Jira cf12802 rating average)
- Call QA: tone / confidence / knowledge / flow / satisfaction (if SupportCallAnalysis present)

### Tier 3 — Productivity / health
- SLA compliance % (resolved-today: (resolved − breached)/resolved)
- Tickets per hour
- RAG health statuses (productivity / CSAT / QA / golden-rules / over-2h / stale / SLA / oldest)

### Excluded (for now)
- Gamification (achievements, streaks, points, leaderboard composite)
- `FrtCompliancePercent`, `ResolutionSlaPercent` — referenced in people.ts but no longer computed (legacy ghosts); decide whether to revive.

## Reference sources (existing definitions)
- `services/kpi-pipeline.ts` — `refreshAllAgentMetrics` (tier 1, dbo.Agent), `snapshotAgentKpis` (~47 cols, tiers 1–3 daily), `refreshNovaAiMetrics` (NOVA special-case).
- `/wallboard/breached` (index.ts) — live tier-1 per-agent compute (agentStatsForSubset).
- QA: `services/qa-pipeline.ts`, `qa-digest.ts`, `dbo.jira_qa_results`, `dbo.Jira_QA_GoldenRules`.
- n8n "Daily KPI Report v4" (`KriwNYXfWcGBW7D7`) — code mirrors it; raw workflow not pulled (n8n MCP not connected this session).

## Definition card template (same as Layer 1)
```
AGENT KPI: <name>
Source:        Jira:NT(assignee) | QA pipeline | CSAT | derived
Measures:      <plain-English>
Computation:   <exact logic, per-agent>
Unit:          count | % | days | score | minutes
Direction:     higher-better | lower-better | target-band
Target:        <per-agent target>
Rollup (MTD):  sum | latest | average | min | max
RAG:           green … / amber … / red …
Edge cases:    <scope tiers, NOVA handling, parked statuses>
Status:        DRAFT | AGREED | BUILT
```

---

## Framework decisions
- **Roster = `dbo.Agent`** (techservicesjsm) — the source of truth. Active agents only; only
  agents in this table get KPIs. (Migrate the roster into the NOVA DB later.) Read via the KPI pool
  (read-only); dbo.Agent is a pipeline-owned table, not on the forbidden list.
- **Tier scope = ALL tiers** per agent (incl. Development), keyed by `assignee_account_id` =
  dbo.Agent.AccountId.
- **Compute approach** (efficiency): stocks (open / over-SLA / no-update / oldest) from a single
  pass over `jira_issue_cache` bucketed by assignee — NOT per-agent JQL. Solved via one transition
  JQL (`status CHANGED TO Done DURING day`) bucketed by assignee + NOVA credit. Quality from the QA
  tables; CSAT from cache `fields_json` cf12802. Mirrors legacy `refreshAllAgentMetrics`/`snapshotAgentKpis`
  but with the agreed correct definitions.

## Cards

### Tier 1 — core operational (AGREED)
All keyed by `assignee_account_id` = dbo.Agent.AccountId, project NT, ALL tiers.
Computed from `jira_issue_cache` (stocks, single pass bucketed by assignee) except Solved (transition JQL).
RAG bands provisional — taken from the legacy snapshot thresholds; per-agent targets TBD.

```
AGENT KPI: Open tickets
Computation:   COUNT open NT (statusCategory != Done AND status NOT IN (Closed,Resolved)) WHERE assignee = agent
Unit: count | Direction: informational | Rollup: latest | Status: AGREED
```
```
AGENT KPI: Over-SLA (actionable)
Computation:   open + Resolution SLA (cf14048) breached + actionable (not waiting-on-external)
               + due-date gate (no due date OR due <= end of today)   [LEGACY def — confirmed correct]
Unit: count | Direction: lower-better | Target: 0 | Rollup: latest
RAG (legacy ragOver2h): green 0 / amber ≤2 / red >2 | Status: AGREED
```
```
AGENT KPI: No-Update (No Reply)
Computation:   open + isNoReply (our org rule: >4h, not waiting-on-requestor, no future next-update,
               last agent-touch before today, ≤52wk)   [= org No Reply, per assignee]
Unit: count | Direction: lower-better | Target: 0 | Rollup: latest
RAG (legacy ragStale): green 0 / amber ≤1 / red >1 | Status: AGREED
```
```
AGENT KPI: Solved Today
Computation:   COUNT NT where status CHANGED TO (Resolved,Closed,Done) DURING today AND currently Done,
               by assignee; NOVA credited for tickets it closed (same as org #2/#3 split)
Unit: count | Direction: higher-better | Rollup: sum (the day's count) | Status: AGREED
```
```
AGENT KPI: Solved This Week
Computation:   as Solved Today but DURING the ISO week (Mon→now), by assignee
Unit: count | Direction: higher-better | Rollup: latest (running week total) | Status: AGREED
```
```
AGENT KPI: Oldest actionable ticket
Computation:   MAX(days since jira_created) over open + actionable tickets assigned to agent (+ oldest key)
Unit: days | Direction: lower-better | Rollup: latest
RAG (legacy ragOldestTicket): green ≤3 / amber ≤7 / red >7 | Status: AGREED
```

### Tier 2 — quality / Tier 3 — productivity-health
<!-- to be carded next -->

