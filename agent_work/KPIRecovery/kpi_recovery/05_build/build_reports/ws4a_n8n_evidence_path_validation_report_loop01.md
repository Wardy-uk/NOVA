# WS4-A Build Report — n8n Evidence Path Validation (Loop 01)

**Date:** 2026-05-21
**Workstream:** WS4 — n8n Workflow Integrity
**Slice:** WS4-A — n8n Evidence Path Validation
**Type:** Discovery / Classification (no implementation)

---

## 1. Executive Summary

NOVA has already absorbed the core KPI pipeline functions that n8n originally owned. The remaining n8n dependency is narrower than expected: primarily the `dbo.Agent` roster table and the `Jira_QA_GoldenRules` table. `KpiSnapshot` is stale and non-authoritative. The n8n comment-parsing comparison infrastructure is demonstrably unreliable (78.8% false escalation matches). WS4 should proceed as **documentation / decommission work** with one bounded dependency-migration slice for `dbo.Agent`.

---

## 2. What Is Known Locally

### 2.1 n8n Artefacts Present in This Repo

| Artefact | Path | Purpose | Status |
|----------|------|---------|--------|
| SQL setup workflow generator | `scripts/generate-n8n-setup.mjs` | One-time Azure SQL provisioning via n8n | Historical — setup complete |
| Generated workflow JSON | `scripts/n8n-nova-sql-setup.json` | Output of the above | Historical |
| Workflow registry | `docs/N8N_Workflow_Documentation.md` | Lists 50+ active n8n workflows (as of 2026-03-25) | Stale — retirement status unclear |
| Retirement plan | `docs/n8n-workflow-retirement.md` | Maps n8n workflows replaced by NOVA services | Documentation — not enforced |
| Coexistence matrix | `docs/agent-n8n-coexistence.md` | Marker-based and scope-split patterns for AI action transition | Documentation |
| Parser audit | `scripts/audit-24h.cjs`, `scripts/audit-agent-decisions.cjs` | n8n action parser accuracy testing | Audit tooling — found parser unreliable |

### 2.2 n8n-Owned Tables Referenced in Code

| Table | n8n Writes? | NOVA Writes? | NOVA Reads? | Current Authority |
|-------|-------------|--------------|-------------|-------------------|
| `KpiSnapshot` | Yes (stale, last run ~May 15) | No | Yes (comparison only) | **Non-authoritative** — NOVA pipeline is authoritative (D-039) |
| `dbo.Agent` | Yes (agent roster sync) | Yes (synth agent, department fields) | Yes (extensively — 7+ services) | **Shared** — n8n is primary roster populator; NOVA supplements |
| `jira_kpi_daily` | Formerly | **Yes** — MERGE upsert via `collectJiraSnapshot()` | Yes | **NOVA is authoritative** — replaced n8n WP-16 |
| `jira_agent_kpi_daily` | Formerly | **Yes** — MERGE upsert via `snapshotAgentKpis()` | Yes | **NOVA is authoritative** — replaced n8n |
| `jira_qa_results` | Formerly | **Yes** — INSERT via `qa-pipeline.ts` | Yes | **NOVA is authoritative** — replaced n8n WP-17 |
| `Jira_QA_GoldenRules` | Yes | No | Yes (coaching, trends) | **n8n is authoritative** — NOVA reads only |

### 2.3 n8n Comment-Tracking Infrastructure

NOVA tracks n8n's Jira comments for AI comparison/audit purposes:

- **Schema columns:** `last_n8n_comment`, `last_n8n_comment_at`, `last_n8n_comment_author` in `jira_issue_cache`
- **AI comparison log:** `n8n_raw_excerpt`, `n8n_recommended_tier`, `n8n_posted_reply`, `n8n_assigned`, `parser_version`
- **Settings keys:** `n8n_comment_author_emails` (default: `Alerts@Nurtur.tech`), `n8n_comment_author_display_names` (default: `Nurtur`), `n8n_comment_body_marker` (default: `AI Summary`)
- **Parser:** `parseN8nAction()` in `triage-tuning.ts` — regex-based extraction of close/escalate/respond from comment body
- **Known defect:** Parser audit found **78.8% false escalation matches** due to conditional language in AI Summaries ("Escalate to Tier 2 if…" matching as escalation). Comparison logging is fundamentally unreliable.

### 2.4 NOVA-Absorbed Pipelines (Formerly n8n)

| Pipeline | NOVA Service | Timer | Replaced n8n WP |
|----------|-------------|-------|------------------|
| Team KPI snapshot | `kpi-pipeline.ts:collectJiraSnapshot()` | 10 min | WP-16 |
| Agent KPI snapshot | `kpi-pipeline.ts:snapshotAgentKpis()` | 30 min | WP-16 |
| QA scoring | `qa-pipeline.ts` | Scheduled | WP-17 |
| Daily digest | `kpi-pipeline.ts:generateDailyDigest()` | 17:30 daily | WP-16 |
| Weekly digest | `kpi-pipeline.ts:generateWeeklyDigest()` | Monday 09:00 | WP-16 |
| AI auto-responses | Agent comment handler (WP-06) | Event-driven | WP-20 |
| KB search | `kb-search.ts` | On demand | WP-23 (Confluence) |

### 2.5 n8n Workflows Documented as "Keep" (per retirement plan)

| Workflow | Reason | NOVA Replacement Path |
|----------|--------|----------------------|
| Teams Listener (WP-23) | Creates Jira tickets from Teams messages | None — would require Teams webhook integration |
| Back Date Auto2020 (WP-22) | Touches 11 SQL Server instances | Too complex to migrate; operational utility |

---

## 3. What Remains Inaccessible or Unverified

| Item | What We Don't Know | Why | Impact |
|------|-------------------|-----|--------|
| n8n v4 live workflow state | Which workflows are actually running, disabled, or errored | n8n instance not locally accessible (HDR-3 still pending) | Cannot confirm retirement plan is enacted |
| `KpiSnapshot` current JQL | What query logic n8n uses for KpiSnapshot | Workflow definition not in this repo | Non-blocking — KpiSnapshot is already classified non-authoritative (D-039) |
| `dbo.Agent` population schedule | How often n8n refreshes the agent roster | n8n workflow schedule not inspectable | **Material** — if n8n stops, agent-dependent features degrade |
| `Jira_QA_GoldenRules` population | Whether n8n is still actively writing Golden Rules scores | n8n instance not accessible | **Material** — NOVA reads but cannot generate these |
| `KpiTargets` table source | Whether n8n populates KPI targets or they are static | No local evidence of population path | Low — targets appear static/manual |
| Workflow retirement enforcement | Whether the 5+ retired workflows are actually disabled | Requires n8n admin access | Low — NOVA MERGE upserts overwrite n8n's writes for shared tables |

---

## 4. What Still Materially Depends on n8n

### 4.1 Critical Dependencies (Would Break If n8n Stopped)

| Dependency | Table | Impact | NOVA Consumers |
|------------|-------|--------|----------------|
| **Agent roster population** | `dbo.Agent` | Assignment engine fallback, agent availability, coaching, capacity planning, KPI enrichment, training reminders | `assignment-engine.ts`, `agent-availability.ts`, `kpi-pipeline.ts`, `gr-pipeline.ts`, `training-reminder.ts`, `coach.ts`, `kpi-data.ts` (7+ services) |
| **Golden Rules scores** | `Jira_QA_GoldenRules` | Coaching data, agent scoring, trend analysis | `agent.ts` (coaching endpoint), trend modules |

### 4.2 Non-Critical Dependencies (Informational Only)

| Dependency | Table | Impact | Notes |
|------------|-------|--------|-------|
| KpiSnapshot comparison | `KpiSnapshot` | UAT comparison surface only | Already classified non-authoritative (D-039). Stale. |
| n8n comment parsing | `jira_issue_cache` columns | AI comparison logging | Parser is demonstrably broken (78.8% false matches). Comparison data is unreliable. |

### 4.3 Resolved Dependencies (NOVA Has Absorbed)

- `jira_kpi_daily` — NOVA is now the authoritative writer
- `jira_agent_kpi_daily` — NOVA is now the authoritative writer
- `jira_qa_results` — NOVA is now the authoritative writer
- Daily/weekly digest generation — NOVA-owned
- AI auto-responses — NOVA-owned (WP-06)

---

## 5. WS4 Classification

### Question: Is WS4 primarily…

| Classification | Evidence | Verdict |
|----------------|----------|---------|
| A runtime access / inspection problem? | HDR-3 is still pending. We cannot verify live n8n state. | **Partially** — but the unknowns are narrower than expected |
| A stale non-authoritative comparator problem? | `KpiSnapshot` is stale and non-authoritative. n8n comment parser is broken. | **Yes** — significant cleanup opportunity |
| A workflow failure / retry problem? | No evidence of n8n workflow failures affecting NOVA KPIs. NOVA has absorbed the pipelines. | **No** |
| A decommission / documentation problem? | NOVA has absorbed 5+ pipeline functions. Retirement plan exists but is unenforced. | **Primarily yes** |

### Overall Classification

**WS4 is primarily a decommission / documentation workstream** with **one bounded dependency-migration slice** (`dbo.Agent` roster). The core KPI pipeline ownership transfer from n8n to NOVA is already complete in code. What remains is:

1. **Documenting** which n8n workflows are genuinely still needed vs stale/retired
2. **Decommissioning** the comparison infrastructure that doesn't work (parser, comparison log)
3. **Migrating** the `dbo.Agent` roster population into NOVA (or confirming n8n will continue to maintain it)
4. **Deciding** what to do about `Jira_QA_GoldenRules` (absorb into NOVA QA pipeline or keep in n8n)

---

## 6. Recommended Next Slice

### WS4-B — Agent Roster Dependency Classification

**Goal:** Determine whether the `dbo.Agent` roster dependency on n8n is:
- (a) an active, healthy population path that should be preserved
- (b) a fragile dependency that should be migrated into NOVA
- (c) already redundant because NOVA's `agent_roster` table + `refreshAllAgentMetrics()` covers the same ground

**Scope:**
- Map all NOVA code paths that read from `dbo.Agent`
- Identify which columns are used and whether NOVA already has equivalent local data
- Classify each consumer as "needs n8n" or "could use local data"
- Recommend: keep, migrate, or hybrid

**Why this slice:** `dbo.Agent` is the only remaining critical n8n dependency. Everything else is either already absorbed, non-authoritative, or informational. Resolving this dependency would make NOVA operationally independent of n8n for KPI purposes.

**Not in scope:** Actually migrating the roster (that would be WS4-C if needed), decommissioning comparison infrastructure (WS4-D), or Golden Rules absorption (separate slice).

---

## 7. Completion Checklist

| Criterion | Status |
|-----------|--------|
| What is known locally | **COMPLETE** — 6 artefacts, 6 tables mapped, 7 absorbed pipelines documented |
| What remains inaccessible or unverified | **COMPLETE** — 6 items listed with impact classification |
| What still materially depends on n8n | **COMPLETE** — 2 critical, 2 non-critical, 3+ resolved |
| Whether WS4 should continue as recovery, access request, or closure/decommission | **COMPLETE** — classified as decommission/documentation with one bounded dependency-migration slice |
| The exact next slice to run | **COMPLETE** — WS4-B Agent Roster Dependency Classification |
