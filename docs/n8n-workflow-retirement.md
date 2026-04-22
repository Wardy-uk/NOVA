# n8n Workflow Retirement Log

Workflows absorbed into NOVA's background services or retired because they've been superseded by agent capabilities.

---

## WP-16: KPI Pipeline — Absorbed into `kpi-pipeline.ts`

These workflows are replaced by `src/server/services/kpi-pipeline.ts`, which runs on scheduled timers inside NOVA.

| n8n Workflow | ID | NOVA Replacement |
|---|---|---|
| Daily KPI Report v3.1 | `pBrRdWYxtYFy4mGh` | `collectJiraSnapshot()` (10 min timer) + `generateDailyDigest()` (17:30 daily) |
| Weekly KPI Report | (part of Daily v3.1) | `generateWeeklyDigest()` (Monday 09:00) |
| Agent KPI Snapshot | (part of Daily v3.1) | `snapshotAgentKpis()` (30 min timer) |
| KPI Snapshot upsert | (part of Daily v3.1) | `collectJiraSnapshot()` MERGE upsert to `jira_kpi_daily` |
| Intervention Radar (Daily 2pm) | — | Superseded by WP-09 queue monitor in agent loop |

**Tables written:** `jira_kpi_daily`, `KpiSnapshot`, `jira_agent_kpi_daily`, `jira_kpi_digest`

**Action:** Disable these n8n workflows once NOVA KPI pipeline is confirmed working in production. Keep inactive for 2 weeks as rollback, then delete.

---

## WP-17: QA Pipeline — Absorbed into `qa-pipeline.ts`

These workflows are replaced by `src/server/services/qa-pipeline.ts`, running every 2 hours.

| n8n Workflow | ID | NOVA Replacement |
|---|---|---|
| Ticket QA — Full QA (Hourly) | `kP4T3lzP4y5DyeJF` | `scoreRecentlyResolved()` (2h timer) |
| Ticket QA V4 | `t1_H2ThQqALnt316LUGt6` | `scoreSingle()` — single Anthropic call replaces 5 OpenAI calls |

**Tables written:** `jira_qa_results`, `Jira_QA_GoldenRules`

**Improvement:** QA scoring consolidated from 5 separate OpenAI calls per ticket to 1 structured Anthropic call. Scoring dimensions (accuracy, clarity, tone) map to Golden Rules (Rule1=clarity, Rule2=tone, Rule3=accuracy).

**Action:** Disable these n8n workflows once QA pipeline confirmed in production. Keep inactive for 2 weeks.

---

## WP-20: Auto Reply Workflows — Retired (Already Replaced)

These 5 workflows were already replaced by WP-06 (agent comment handler) and WP-10 (chase automation). No new code needed.

| n8n Workflow | ID | Replaced By |
|---|---|---|
| Auto Reply — New Ticket | `pgLEfwMWcz1lPs5f` | WP-06: Agent comment handler (triage + first response) |
| Auto Reply — Customer Update | `hmdQa4lq8oZDfZSjxzL4C` | WP-06: Agent comment handler (re-triage on update) |
| Auto Reply — Chase (3 day) | `OJdK72S2Ui5om53FW4xXN` | WP-10: Chase automation |
| Auto Reply — Chase (7 day) | `XWJYlUGxvDjbDjOWH0t-W` | WP-10: Chase automation |
| Auto Reply — Chase (14 day) | `IlgfRo3AXsZPZIHcFLPIC` | WP-10: Chase automation |

**Action:** These should already be disabled. Verify and delete after confirming agent loop handles all cases.

---

## WP-23: Utility Workflows — Retired/Absorbed

| n8n Workflow | ID | Status | NOVA Replacement |
|---|---|---|---|
| Confluence Search | `V35NGuyiqgTkY0F0` | Retired | `kb-search.ts` — direct Confluence API via agent KB search |
| Manual Ticket Reply | `kiVrk6BCqgf3Y1WB` | Retired | Reply composer in agent workspace (`/agent/quick-actions/draft-reply` + `/send-reply`) |
| Resolved Ticket QA | `t1_H2ThQqALnt316LUGt6` | Absorbed | `qa-pipeline.ts` + `resolution-reviewer.ts` in agent loop |
| Teams Listener | `wwL3hTALqaE3OxUR` | **Keep active** | Not yet replaced — listens for Teams messages and creates Jira tickets. Will assess in future WP. |

**Action:** Disable Confluence Search, Manual Reply, and Resolved QA workflows. Keep Teams Listener active until a replacement is built.

---

## WP-22: Operational Workflows — Mixed

| n8n Workflow | ID | Status | NOVA Replacement |
|---|---|---|---|
| Product Cancellation — Trigger | `g-8bd5DQq9NsNNRibD2hH` | Absorbed | `product-cancellation.ts` — polls D365 every 4h, creates Jira tickets |
| Jira Abuse Report Processor | `YSg6n6qs3JKCFO5N` | Absorbed | `abuse-report-processor.ts` — webhook at `/api/public/webhooks/abuse-report` |
| Call Reviews | `oaEFAZPlQ2Goanc3` | Absorbed | `call-reviews.ts` — Whisper transcription + LLM scoring + Teams notification |
| Back Date Auto2020 | `soHFXArsi1G_bT6aJecXm` | **Keep in n8n** | Touches 11 SQL Server instances with a multi-step form. Too many external dependencies to safely absorb into NOVA. |

**Action:** Disable Product Cancellation, Abuse Report, and Call Reviews workflows once NOVA services confirmed in production. Keep Back Date Auto2020 in n8n indefinitely.

---

*Updated: 22 April 2026*
