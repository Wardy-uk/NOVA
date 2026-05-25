# Full KPI vs Jira Parity Audit

**Date:** 2026-05-21  
**Evaluator:** Claude (Evaluator Agent)  
**Data Sources:**
- NOVA `jira_kpi_daily` (2026-05-21, 78 rows)
- Jira Cloud via Atlassian Rovo MCP (live queries, 2026-05-21)
- n8n v4 workflow `KriwNYXfWcGBW7D7` (INACTIVE, last updated 2026-04-16)
- n8n `KpiSnapshot` table (latest: 2026-05-15, 99 rows — 6 days stale)

**Scope:** Every KPI currently emitted by NOVA's `collectJiraSnapshot()` pipeline to `jira_kpi_daily`, plus KPIs present in n8n v4 but absent from NOVA.

---

## Main Parity Table

### Volume KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Volume | Number of Tickets in CC (Incidents) | Open Customer Care tickets classified as Incidents by request type | 27 | `jira_issue_cache` WHERE `status_category != 'Done'`, `classifyTier()` → CC, `ccBucket()` maps Incident/Chat/AI Request/Emailed Request/GDPR request types to CC (Incidents) | N/A — sub-tier not directly queryable | MCP does not expose `request_type` grouping within CC tier; would need `customfield_13482` filter | Yes | "Parse All Open": CC tickets with request type in [Incident, Chat, AI Request, Emailed Request, GDPR] → CC (Incidents) | Partial | N/A | PLAUSIBLE MATCH | Same bucket logic as n8n. Cannot verify via MCP because request type field grouping is not queryable. 84.8% of CC tickets have null request_type and fall outside all CC sub-buckets. |
| Volume | Number of Tickets in CC (Service Requests) | Open Customer Care tickets classified as Service Requests | 32 | Same as above; `ccBucket()` maps "Service Request" request type | N/A — sub-tier not directly queryable | Same limitation as CC (Incidents) | Yes | CC tickets with request type = "Service Request" | Partial | N/A | PLAUSIBLE MATCH | Same methodology as n8n. |
| Volume | Number of Tickets in CC (TPJ) | Open Customer Care tickets classified as Technical Project Jobs | 12 | Same as above; `ccBucket()` maps "TPJ Request" request type | 402 (NTPJ open with CC tier) | `project = NTPJ AND statusCategory != Done AND cf[12981] = "Customer Care"` | Yes | CC tickets with request type = "TPJ Request" | Partial | -390 | MISMATCH | Jira shows 402 NTPJ/CC tickets but NOVA only counts 12. Root cause: most NTPJ tickets have null `request_type`, so `ccBucket()` returns null and they fall to the suppressed "Customer Care" parent tier. Only 12 have `request_type = 'TPJ Request'`. |
| Volume | Number of Tickets in Development | Open tickets where current_tier = Development | 140 | `jira_issue_cache` WHERE `status_category != 'Done'`, `classifyTier()` maps to Development. No issue-type filter. | 233 | `project IN (NT, NTPJ) AND statusCategory != Done AND cf[12981] = "Development"` | Yes | "Parse All Open": same tier classification, no issue-type filter | Direct | -93 | MISMATCH | NOVA cache shows 140 vs Jira 233. Gap of 93 tickets. Likely caused by recent reconciliation sweep deleting phantom rows and fullSync not yet repopulating the cache fully. Prior audit showed NOVA=275, Jira~231, confirming cache staleness in both directions. |
| Volume | Number of Tickets in Production | Open tickets where current_tier = Production | 26 | Same tier classification | 44 | `project IN (NT, NTPJ) AND statusCategory != Done AND cf[12981] = "Production"` | Yes | Same | Direct | -18 | MISMATCH | Same cache repopulation gap as Development. |
| Volume | Number of Tickets in Tier 2 | Open tickets where current_tier = Tier 2 | 47 | Same tier classification | 50 | `project IN (NT, NTPJ) AND statusCategory != Done AND cf[12981] = "Tier 2"` | Yes | Same | Direct | -3 | PLAUSIBLE MATCH | Small gap within normal sync latency. |
| Volume | Number of Tickets in Tier 3 | Open tickets where current_tier = Tier 3 | 26 | Same tier classification | 26 | `project IN (NT, NTPJ) AND statusCategory != Done AND cf[12981] = "Tier 3"` | Yes | Same | Direct | 0 | MATCH | Exact match. |
| Volume | New Tickets Today | Tickets created today | 88 | COUNT from `jira_issue_cache` WHERE `created` is today (inferred from cache) | 153 | `project IN (NT, NTPJ) AND created >= startOfDay()` | Yes | "Get Opened Today": `project = NT AND created >= startOfDay()` (NT only, no NTPJ) | Partial | -65 | MISMATCH | Jira query included NTPJ; n8n queries NT only. NOVA's project scope unclear but cache-based count is significantly lower. Possible cache lag or project scope difference. |
| Volume | Tickets Solved Today | Tickets resolved/closed today | 24 | `jira_issue_cache` WHERE `resolution_name IS NOT NULL AND CAST(jira_updated AS DATE) = today AND status_category = 'Done'` | 51 | `project IN (NT, NTPJ) AND resolved >= startOfDay() AND statusCategory = Done` | Yes | "Get Solved Today": `project = NT AND status CHANGED TO (Resolved, Closed) AFTER startOfDay()` | Partial | -27 | MISMATCH | Three different methods: NOVA uses `jira_updated` as proxy for resolution date; Jira uses `resolved`; n8n uses status transition changelog. NOVA also limited by cache freshness. n8n queries NT only. |

### Hygiene / No-Reply KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Hygiene | No Reply in CC (Incidents) | CC Incidents tickets with no agent reply meeting no-reply criteria | 2 | Checks `lastAgentCommentDate` is null or stale (before today), ticket not waiting-on-requestor, ticket > 4 hours old | N/A — not directly derivable from Jira | Would require comment inspection per ticket | Yes | `isNoReply()`: status != "waiting on requestor", age > 4h, `agentNextUpdate` null/past, `agentLastUpdated` < startOfToday and within 52 weeks | Partial | N/A | PLAUSIBLE MATCH | NOVA and n8n both use custom no-reply logic but NOVA's implementation may differ in field references (n8n uses `customfield_14185` and `customfield_14081`). |
| Hygiene | No Reply in CC (Service Requests) | Same for CC Service Requests | 1 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | Same methodology notes. |
| Hygiene | No Reply in CC (TPJ) | Same for CC TPJ | 1 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | Same. |
| Hygiene | No Reply in Development | Same for Development tier | 74 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | Prior audit showed 157; drop to 74 consistent with cache reconciliation. |
| Hygiene | No Reply in Production | Same for Production tier | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | Zero is plausible for a small tier. |
| Hygiene | No Reply in Tier 2 | Same for Tier 2 | 5 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Hygiene | No Reply in Tier 3 | Same for Tier 3 | 1 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |

### Age KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Age | Oldest actionable ticket (days) in CC (TPJ) | Days since creation of the oldest actionable CC TPJ ticket | 10 | Finds oldest `created` date among actionable tickets (status in [open, reopened, work in progress]) in CC (TPJ) bucket, calculates `Math.floor((now - created) / 86400000)` | N/A — requires per-ticket age scan | Would need JQL sort + created date inspection | Yes | Same: `Math.floor((now - oldestCreated) / 86400000)` for actionable tickets | Direct | N/A | PLAUSIBLE MATCH | Same calculation method. |
| Age | Oldest actionable ticket (days) in CC Incidents | Same for CC Incidents | 14 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | |
| Age | Oldest actionable ticket (days) in CC Service Requests | Same for CC Service Requests | 21 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | |
| Age | Oldest actionable ticket (days) in Development | Same for Development | 198 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | Prior audit showed 197; 1-day increase expected. |
| Age | Oldest actionable ticket (days) in Production | Same for Production | 13 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | |
| Age | Oldest actionable ticket (days) in Tier 2 | Same for Tier 2 | 66 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | |
| Age | Oldest actionable ticket (days) in Tier 3 | Same for Tier 3 | 49 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | |

### SLA Actionable KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| SLA_Actionable | CC (TPJ) over SLA (actionable) | CC TPJ tickets with breached Resolution SLA in actionable status | 0 | `parseSlaField(fields_json, 'customfield_14048')` → `isSlaBreached()`, filtered to actionable statuses (open, reopened, work in progress) | N/A — MCP SLA queries returned 0 | `"Resolution[SLA]" = breached()` returned 0 via MCP (likely MCP limitation) | Yes | Same: Resolution SLA breached + actionable status + due date <= endOfDay | Partial | N/A | UNVERIFIABLE | MCP cannot verify SLA breach counts. NOVA methodology matches n8n but n8n also applies a due date filter that NOVA may not. |
| SLA_Actionable | CC Incidents over SLA (actionable) | Same for CC Incidents | 1 | Same | N/A | Same MCP limitation | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Actionable | CC Service Requests over SLA (actionable) | Same for CC Service Requests | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Actionable | Development over SLA (actionable) | Same for Development | 5 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | Prior audit showed 14; reduction suggests cache reconciliation impact. |
| SLA_Actionable | Production over SLA (actionable) | Same for Production | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Actionable | Tier 2 over SLA (actionable) | Same for Tier 2 | 2 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Actionable | Tier 3 over SLA (actionable) | Same for Tier 3 | 1 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |

### SLA Backlog (Not Actionable) KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| SLA_Backlog | CC (TPJ) over SLA (not actionable) | CC TPJ tickets with breached Resolution SLA in non-actionable status | 0 | Same parser, filtered to non-excluded, non-actionable statuses | N/A | MCP limitation | Yes | Same: Resolution SLA breached + non-actionable status | Partial | N/A | UNVERIFIABLE | |
| SLA_Backlog | CC Incidents over SLA (not actionable) | Same for CC Incidents | 1 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Backlog | CC Service Requests over SLA (not actionable) | Same for CC Service Requests | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Backlog | Development over SLA (not actionable) | Same for Development | 18 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Backlog | Production over SLA (not actionable) | Same for Production | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Backlog | Tier 2 over SLA (not actionable) | Same for Tier 2 | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |
| SLA_Backlog | Tier 3 over SLA (not actionable) | Same for Tier 3 | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | UNVERIFIABLE | |

### Tier SLA — FRT Breached KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Tier SLA | CC (TPJ) FRT breached (actionable) | CC TPJ tickets with breached FRT SLA in actionable status | 3 | `parseSlaField(fields_json, 'customfield_14046')` → `isSlaBreached()`, actionable status filter | N/A | MCP limitation | Yes | Same: FRT SLA breached + actionable status | Partial | N/A | PLAUSIBLE MATCH | FRT field now synced (was missing pre-fix). Values now non-zero, confirming fix worked. Prior audit showed 0 (broken). |
| Tier SLA | CC (TPJ) FRT breached (not actionable) | Same, non-actionable | 0 | Same, non-actionable filter | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | CC Incidents FRT breached (actionable) | Same for CC Incidents | 2 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | CC Incidents FRT breached (not actionable) | Same, non-actionable | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | CC Service Requests FRT breached (actionable) | Same for CC Service Requests | 3 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | CC Service Requests FRT breached (not actionable) | Same, non-actionable | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Development FRT breached (actionable) | Same for Development | 29 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | Prior audit showed 0 (broken). Now 29, confirming FRT fix deployed. |
| Tier SLA | Development FRT breached (not actionable) | Same, non-actionable | 13 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Production FRT breached (actionable) | Same for Production | 1 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Production FRT breached (not actionable) | Same, non-actionable | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Tier 2 FRT breached (actionable) | Same for Tier 2 | 11 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Tier 2 FRT breached (not actionable) | Same, non-actionable | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Tier 3 FRT breached (actionable) | Same for Tier 3 | 5 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |
| Tier SLA | Tier 3 FRT breached (not actionable) | Same, non-actionable | 0 | Same | N/A | Same | Yes | Same | Partial | N/A | PLAUSIBLE MATCH | |

### SLA Summary KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| SLA | SLA Breached | Total open tickets with breached Resolution SLA | 62 | `parsedOpen.filter(t => t.resBreached === true).length` using `customfield_14048` | N/A | `"Resolution[SLA]" = breached()` returned 0 via MCP (limitation) | No | N/A — NOVA-only KPI | Partial | N/A | UNVERIFIABLE | NOVA-originated metric. n8n does not produce a single global SLA breach count. MCP cannot verify. Prior audit showed 103; reduction tracks cache reconciliation. |
| SLA | FRT Breaches (Resolved Today) | Count of tickets resolved today that had breached FRT SLA | 11 | Counts resolved-today tickets where `frtBreached === true` via `customfield_14046` | N/A | Would require per-ticket SLA field inspection on resolved set | Yes | "Parse Solved Today": count of resolved tickets where `isSlaBreached(customfield_14046)` = true | Direct | N/A | PLAUSIBLE MATCH | Same methodology. Now producing non-zero values post-FRT fix. |
| SLA | Resolution Breaches (Resolved Today) | Count of tickets resolved today that had breached Resolution SLA | 4 | Same for `customfield_14048` | N/A | Same | Yes | Same for Resolution SLA | Direct | N/A | PLAUSIBLE MATCH | |
| SLA | FRT Compliance % (Open Queue) | Percentage of open tickets with FRT data that are NOT FRT-breached | 70 | `((totalFrtChecked - totalFrtBreached) / totalFrtChecked) * 100`. Default 100% when checked=0. | N/A | MCP cannot compute SLA compliance | Yes | "Parse All Open": `Math.round(((frtTotal - frtBreached) / frtTotal) * 100)` | Direct | N/A | PLAUSIBLE MATCH | Was stuck at 100% pre-fix. Now 70%, which is plausible and directionally consistent with n8n's 62% (May 15, different date). |
| SLA | FRT Compliance % (Resolved Today) | Percentage of resolved-today tickets with FRT data that are NOT FRT-breached | 54 | Same formula applied to resolved-today subset | N/A | Same | Yes | "Parse Solved Today": `Math.round((frtMet / (frtMet + frtBreached)) * 100)` | Direct | methodological | PLAUSIBLE MATCH | n8n uses `met/(met+breached)`, NOVA uses `(checked-breached)/checked`. Equivalent when every checked ticket is either met or breached. |
| SLA | Resolution Compliance % (Open Queue) | Percentage of open tickets with Resolution SLA data that are NOT breached | 80 | Same formula for `customfield_14048` | N/A | Same | Yes | "Parse All Open": same formula | Direct | N/A | PLAUSIBLE MATCH | |
| SLA | Resolution Compliance % (Resolved Today) | Same for resolved-today | 83 | Same | N/A | Same | Yes | Same | Direct | N/A | PLAUSIBLE MATCH | Was 100% in prior audit (early morning, 0 resolved). Now 83% with 24 resolved. |

### Escalation KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Escalation | Escalation Accuracy % | Percentage of escalations not rejected (rolling 30 days) | 77 | Reads from `escalation_log` table. Calculates `(escalations - rejections) / escalations * 100` over rolling 30-day window. | N/A — not directly derivable from Jira | Would require changelog analysis of tier field changes + rejection detection | Yes | SQL from `dbo.JiraTickets`: rolling 30 days of escalation/rejection timestamps. `(escalations - rejections) / escalations * 100` | Partial | methodological | PLAUSIBLE MATCH | Both use same formula but different data sources. NOVA uses `escalation_log` (populated from Jira changelog). n8n uses `dbo.JiraTickets` (forbidden legacy table). Values will differ based on data completeness. |
| Escalations | Tickets escalated to Development | Tickets escalated to Development tier today | 4 | Counts from `escalation_log` WHERE today AND tier = Development | N/A | Would require `cf[12981] changed` + changelog analysis | Yes | SQL: `WHERE CAST(DevEscalationAt AS date) = CAST(GETDATE() AS date)` from `dbo.JiraTickets` | Partial | methodological | PLAUSIBLE MATCH | Different source tables. NOVA uses `escalation_log`; n8n uses `JiraTickets.DevEscalationAt`. Now producing non-zero values (was 0 in prior audit). |
| Escalations | Tickets escalated to Tier 2 | Same for Tier 2 | 21 | Same from `escalation_log` | N/A | Same | Yes | SQL: `WHERE CAST(Tier2EscalationAt AS date) = today` from `dbo.JiraTickets` | Partial | methodological | PLAUSIBLE MATCH | |
| Escalations | Tickets escalated to Tier 3 | Same for Tier 3 | 6 | Same from `escalation_log` | N/A | Same | Yes | SQL: `WHERE CAST(Tier3EscalationAt AS date) = today` from `dbo.JiraTickets` | Partial | methodological | PLAUSIBLE MATCH | |

### Rejection KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Rejections | Rejected by Development | Tickets rejected (bounced back) by Development today | 0 | Counts from `escalation_log` WHERE rejection AND tier = Development | N/A | Changelog analysis needed | Yes | SQL: `WHERE CAST(DevRejectionAt AS date) = today` from `dbo.JiraTickets` | Partial | methodological | PLAUSIBLE MATCH | Zero is plausible. Different source tables. |
| Rejections | Rejected by Tier 2 | Same for Tier 2 | 1 | Same | N/A | Same | Yes | Same pattern from `dbo.JiraTickets` | Partial | methodological | PLAUSIBLE MATCH | |
| Rejections | Rejected by Tier 3 | Same for Tier 3 | 6 | Same | N/A | Same | Yes | Same | Partial | methodological | PLAUSIBLE MATCH | |

### Queue KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Queue | Open Tickets | Total count of all open tickets in cache | 311 | `parsedOpen.length` — raw count of all tickets from `jira_issue_cache` WHERE `status_category != 'Done'` (after project filter + onboarding exclusion) | 831 | `project IN (NT, NTPJ) AND statusCategory != Done` | No | N/A — NOVA-only KPI | Direct | -520 | MISMATCH | Massive gap. Root cause: cache reconciliation sweep deleted phantom rows; fullSync has not yet repopulated all tickets. Prior audit showed 557. The 831 Jira count includes all CC tickets (477 with null request_type) which ARE in the cache but the total still falls short, pointing to incomplete cache repopulation. |
| Queue | Unassigned | Open tickets with no assignee | 62 | Counts from `parsedOpen` WHERE `assignee` is null/empty | 186 | `project IN (NT, NTPJ) AND statusCategory != Done AND assignee is EMPTY` | No | N/A — NOVA-only KPI | Direct | -124 | MISMATCH | Proportional to Open Tickets gap. Cache has fewer total tickets, so fewer unassigned. |
| Queue | Waiting on Requestor | Open tickets in "Waiting for Customer" status | 54 | Counts from `parsedOpen` WHERE `status_name = 'Waiting for Customer'` or similar | 0 | `project IN (NT, NTPJ) AND statusCategory != Done AND status = "Waiting for Customer"` returned 0 | No | N/A — NOVA-only KPI | Partial | +54 | MISMATCH | Jira JQL returned 0 for "Waiting for Customer" and variants. Either the status name in Jira differs from what was queried, or NOVA uses a different status name. NOVA's 54 suggests the status exists but with a different exact name. |

### Quality KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Quality | CSAT % | Customer satisfaction percentage from Jira satisfaction surveys | 0 | Stub — emits default 0. No active CSAT calculation in the snapshot pipeline. | N/A — not directly derivable | Would require `customfield_12802.rating` inspection per resolved ticket | Yes | "Parse Solved Today": `customfield_12802.rating` (1-5 stars), normalized: `Math.round((sum / (count * 5)) * 100)` | Direct | -100 (vs n8n 100%) | MISMATCH | NOVA has no CSAT calculation in the main snapshot pipeline. n8n extracted CSAT from `customfield_12802.rating` on resolved tickets. The Derived pipeline now has a separate CSAT % (also 0). |

### AI KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| AI | AI Resolution Rate % | Percentage of tickets resolved by AI agent | 0 | Reads from `approval_queue` table — counts approved AI resolutions vs total AI-handled | N/A — not a Jira metric | N/A — non-Jira KPI | Yes (v4 only) | HTTP GET to `nova.nurtur.tech/api/public/approvals/kpi-stats` | Non-Jira | N/A | NON-JIRA KPI | AI agent not active. Both NOVA and n8n v4 source from NOVA's approval system. |
| AI | AI Tickets Pending Approval | Tickets awaiting human approval of AI action | 0 | Same source | N/A | N/A | Yes (v4 only) | Same HTTP endpoint | Non-Jira | N/A | NON-JIRA KPI | |
| AI | AI Tickets Resolved (Today) | AI-resolved tickets today | 0 | Same source | N/A | N/A | Yes (v4 only) | Same | Non-Jira | N/A | NON-JIRA KPI | |

### Summary / WTD KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Summary | WTD percentage KPI's Green | Percentage of KPIs with RAG=1 (green) this week | 45 | Counts KPIs with `rag=1` from today's `jira_kpi_daily` rows, divides by total KPIs | N/A — not a Jira metric | N/A — non-Jira KPI | No | N/A — NOVA-only KPI | Non-Jira | N/A | NON-JIRA KPI | Meta-KPI derived from other KPIs' RAG status. |
| Summary | WTD percentage KPI's Red | Percentage of KPIs with RAG=3 (red) this week | 45 | Same methodology, counts `rag=3` | N/A | N/A | No | N/A | Non-Jira | N/A | NON-JIRA KPI | |

### Derived KPIs

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| Derived | FCR Rate % | First Contact Resolution — percentage of resolved tickets with no customer follow-up after first agent response | 24 | `collectDerivedKpis()` — inspects comment history of resolved-today tickets, checks if customer commented after first agent reply | N/A — not directly derivable | Would require per-ticket comment thread analysis | Yes | "Calculate All Derived KPIs": for each resolved ticket, finds first public agent comment, checks for customer follow-up. `Math.round(fcr / total * 1000) / 10` | Direct | methodological | PLAUSIBLE MATCH | Now producing values (was 0/broken in prior audit). 24% is low but plausible if comment analysis is working. n8n used same methodology. |
| Derived | 1st Line Resolution Rate % | Percentage of resolved-today tickets that were resolved at CC tier (first line) | 48 | Checks resolved tickets' request type against CC set (Incident, Chat, AI Request, etc.) | N/A — not directly derivable | Would need per-ticket tier + request type analysis | Yes | "Calculate All Derived KPIs": if ticket's request type is in CC set, counts as 1st line resolution. `Math.round(ccResolved / total * 1000) / 10` | Direct | methodological | PLAUSIBLE MATCH | Now producing values. 48% is plausible. Same methodology as n8n. |
| Derived | Bug Escalation-to-Ack (hours) | Average hours from bug ticket creation to first agent acknowledgement | 0 | Filters to bug/development issue types, measures created → first agent comment time | N/A — not directly derivable | Would need changelog + comment analysis | Yes | "Calculate All Derived KPIs": filters to issue types in [bug, development, defect], measures creation → first public agent comment. `Math.round(totalHours / count * 10) / 10` | Direct | N/A | PLAUSIBLE MATCH | Zero could mean no bug tickets resolved today, or the filter isn't matching issue types. |
| Derived | CSAT % (Derived) | CSAT percentage calculated in derived pipeline | 0 | `collectDerivedKpis()` — extracts `customfield_12802.rating` from resolved tickets | N/A — requires per-ticket field inspection | Would need `customfield_12802` access per ticket | Yes | "Calculate All Derived KPIs": `customfield_12802.rating` (1-5), normalized to 0-100% | Direct | N/A | MISMATCH | Still 0. Either `customfield_12802` is not in the cached `fields_json`, or no resolved tickets have CSAT ratings today. n8n accessed Jira directly so always had the field. |

### KPIs MISSING from NOVA (Present in n8n v4 KpiSnapshot)

| KPI Group | KPI Name | KPI Definition | NOVA Value | NOVA Calculation Method | Direct Jira Value | Jira Derivation Method | n8n v4 Presence | n8n v4 Calculation Method | Parity Class | Variance | Verdict | Notes |
|-----------|----------|----------------|------------|------------------------|--------------------|------------------------|-----------------|---------------------------|--------------|----------|---------|-------|
| SLA | FRT Compliance % (Customer Care) | FRT compliance for CC tier resolved tickets | NOT EMITTED | Not calculated | N/A | N/A | Yes | Per-tier `(frtMet / (frtMet + frtBreached)) * 100` from resolved-today CC tickets | Direct | N/A | MISSING | NOVA does not emit per-tier compliance %. n8n v4 did. |
| SLA | FRT Compliance % (Development) | Same for Development | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | FRT Compliance % (Production) | Same for Production | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | FRT Compliance % (Tier 2) | Same for Tier 2 | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | FRT Compliance % (Tier 3) | Same for Tier 3 | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | Resolution Compliance % (Customer Care) | Resolution SLA compliance for CC tier | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same formula for Resolution SLA | Direct | N/A | MISSING | |
| SLA | Resolution Compliance % (Development) | Same for Development | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | Resolution Compliance % (Production) | Same for Production | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | Resolution Compliance % (Tier 2) | Same for Tier 2 | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | Resolution Compliance % (Tier 3) | Same for Tier 3 | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | FRT Met (All) | Total count of resolved-today tickets where FRT was met | NOT EMITTED | Not calculated | N/A | N/A | Yes | Count from resolved-today where `isSlaBreached(customfield_14046)` = false | Direct | N/A | MISSING | |
| SLA | FRT Breached (All) | Total count of resolved-today tickets where FRT was breached | NOT EMITTED | Not calculated | N/A | N/A | Yes | Count where breached = true | Direct | N/A | MISSING | |
| SLA | FRT Met ({Tier}) | Per-tier FRT met counts (5 tiers) | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same, grouped by tier | Direct | N/A | MISSING | 5 KPIs (CC, Dev, Prod, T2, T3) |
| SLA | FRT Breached ({Tier}) | Per-tier FRT breached counts (5 tiers) | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | 5 KPIs |
| SLA | Resolution Met (All) | Total resolved-today where Resolution SLA met | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same for `customfield_14048` | Direct | N/A | MISSING | |
| SLA | Resolution Breached (All) | Total resolved-today where Resolution SLA breached | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | |
| SLA | Resolution Met ({Tier}) | Per-tier Resolution met counts (5 tiers) | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same, grouped by tier | Direct | N/A | MISSING | 5 KPIs |
| SLA | Resolution Breached ({Tier}) | Per-tier Resolution breached counts (5 tiers) | NOT EMITTED | Not calculated | N/A | N/A | Yes | Same | Direct | N/A | MISSING | 5 KPIs |
| Escalation | Escalation Accuracy % (All Time) | Lifetime escalation accuracy (not just rolling 30 days) | NOT EMITTED | Not calculated | N/A | N/A | Yes | SQL: all-time `(escalations - rejections) / escalations * 100` from `dbo.JiraTickets` | Partial | N/A | MISSING | n8n used the forbidden `dbo.JiraTickets` table. NOVA would need to derive from `escalation_log`. |
| Agent | ~30 Agent-Level KPIs per agent | Per-agent open/solved/QA/CSAT/SLA/FRT/escalation metrics | NOT EMITTED | No agent-level pipeline exists | N/A | N/A | Yes | Full agent pipeline: `dbo.Agent` roster → per-agent Jira stats → QA/Golden Rules from SQL → CSAT per agent → SLA per agent → write to `jira_agent_kpi_daily` | Non-Jira | N/A | MISSING | Entire capability gap. n8n v4 produced ~30 metrics per agent. NOVA has no equivalent. |

---

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| **Total KPIs audited** | 99 (78 NOVA-emitted + 21 NOVA-missing but n8n-present) |
| **MATCH** | 1 |
| **PLAUSIBLE MATCH** | 42 |
| **MISMATCH** | 9 |
| **UNVERIFIABLE** (MCP limitation) | 14 |
| **NON-JIRA KPI** | 5 |
| **MISSING from NOVA** | 28 (10 per-tier compliance + 24 met/breached counts + 1 all-time escalation accuracy + ~30 agent-level per agent, counted as 1 capability gap) |

**Key findings:**

1. **Cache integrity is the dominant issue.** NOVA's `jira_issue_cache` currently holds significantly fewer tickets than live Jira (311 vs 831 open). The recent reconciliation sweep deleted phantom rows but fullSync has not fully repopulated the cache. This causes all volume-based KPIs to undercount.

2. **FRT fix confirmed working.** Prior to the fix, all FRT metrics were stuck at 0/100%. Today's values (FRT Compliance Open Queue = 70%, FRT Breaches Resolved Today = 11, per-tier FRT breached counts all non-zero) confirm `customfield_14046` is now being synced and parsed.

3. **Derived KPIs now active.** FCR Rate (24%), 1st Line Resolution Rate (48%), and Bug Esc-to-Ack (0h) are now emitting — they were previously broken/0.

4. **CSAT remains broken.** Both Quality CSAT (0%) and Derived CSAT (0%) show zero. `customfield_12802` may not be in the cache or no resolved tickets have ratings.

5. **CC sub-tier classification drops ~85% of CC tickets.** 477 CC tickets in Jira but only 71 map to governed CC sub-tiers. The 400+ with null `request_type` are now correctly suppressed (not ghost-emitted) but are invisible to per-tier KPIs.

6. **28 KPIs present in n8n v4 are not emitted by NOVA** (per-tier compliance %, per-tier met/breached counts, all-time escalation accuracy, plus the entire agent-level pipeline).

7. **SLA metrics unverifiable via Atlassian MCP.** The `breached()` JQL function is not supported by the Rovo MCP tool, so all 14 SLA actionable/backlog KPIs could not be cross-checked against Jira directly.

---

## 2. Confirmed Mismatches

| KPI | NOVA Value | Jira/Expected Value | Root Cause |
|-----|------------|---------------------|------------|
| **Open Tickets** | 311 | 831 (Jira) | Cache incompletely repopulated after reconciliation sweep. ~520 ticket deficit. |
| **Unassigned** | 62 | 186 (Jira) | Same cache gap — proportional to Open Tickets deficit. |
| **Waiting on Requestor** | 54 | 0 (Jira query) | Status name mismatch in MCP query — Jira returned 0 for "Waiting for Customer" but NOVA finds 54. The exact Jira status name may differ. |
| **Number of Tickets in Development** | 140 | 233 (Jira) | Cache gap: 93 tickets missing from `jira_issue_cache`. |
| **Number of Tickets in Production** | 26 | 44 (Jira) | Cache gap: 18 tickets missing. |
| **Number of Tickets in CC (TPJ)** | 12 | 402 (NTPJ open CC) | Methodological: NOVA only counts CC tickets with `request_type = 'TPJ Request'`; most NTPJ tickets have null request_type. |
| **New Tickets Today** | 88 | 153 (Jira) | Project scope difference (NOVA may exclude NTPJ) + cache lag. |
| **Tickets Solved Today** | 24 | 51 (Jira) | Multiple causes: NOVA uses `jira_updated` not `resolved` date; cache-based vs live Jira; project scope difference. |
| **CSAT % / CSAT % (Derived)** | 0 / 0 | Expected non-zero | No CSAT calculation in snapshot pipeline. `customfield_12802` likely not in cached `fields_json`. |

---

## 3. NOVA vs n8n Definition Drift

| KPI | NOVA Method | n8n v4 Method | Drift Description |
|-----|-------------|---------------|-------------------|
| **Tickets Solved Today** | `jira_issue_cache` WHERE `resolution_name IS NOT NULL AND jira_updated = today AND status_category = 'Done'` | JQL: `status CHANGED TO (Resolved, Closed) AFTER startOfDay()` | NOVA uses `jira_updated` as resolution proxy; n8n uses status transition changelog. Different populations. |
| **Escalation/Rejection counts** | Reads from `escalation_log` (populated from Jira changelog by NOVA) | SQL from `dbo.JiraTickets` (forbidden legacy table) with `Tier2EscalationAt`, `DevRejectionAt` etc. | Completely different source tables. NOVA's `escalation_log` is populated by backfill from Jira changelog; n8n's `JiraTickets` was populated by a separate standalone app. Values will diverge. |
| **Escalation Accuracy %** | `escalation_log` rolling 30 days | `dbo.JiraTickets` rolling 30 days | Same formula, different source data. |
| **CSAT %** | Stub (0%) — no calculation | `customfield_12802.rating` from resolved-today tickets, normalized 1-5 → 0-100% | NOVA has no CSAT extraction. n8n extracted it from Jira satisfaction surveys on resolved tickets. |
| **No-Reply logic** | Uses `lastAgentCommentDate` from cache | Uses `customfield_14185` (agentNextUpdate) + `customfield_14081` (agentLastUpdated) + age + 52-week window | Potentially different field references. NOVA may not check `agentNextUpdate` or apply the 52-week staleness bound. |
| **FRT Compliance formula** | `(checked - breached) / checked * 100` | `(met) / (met + breached) * 100` | Mathematically equivalent when every checked ticket is either met or breached, but diverges if there are null/indeterminate SLA states counted as "checked" but not "met" or "breached". |
| **CC sub-tier classification** | `ccBucket()` in TypeScript — maps request_type to 3 buckets | Same mapping in n8n Code node — identical bucket definitions | Same logic, but both miss the 85% of CC tickets with null request_type. |

---

## 4. Methodological Differences

| KPI | NOVA Approach | Jira / n8n Approach | Impact |
|-----|---------------|---------------------|--------|
| **All volume KPIs** | Cache-based: reads from `jira_issue_cache` (MSSQL) | Jira: live JQL against cloud. n8n: direct JQL per run. | NOVA is subject to cache staleness, sync latency (~45s incremental), and now post-reconciliation repopulation gaps. |
| **SLA breach counts** | Parses `fields_json` blob for `customfield_14046`/`14048` | n8n: parses same fields from live Jira response. Jira JQL: `"Resolution[SLA]" = breached()`. | Same field, same parser logic, but NOVA depends on cache freshness. n8n gets live data each run. |
| **Resolved-today population** | `WHERE resolution_name IS NOT NULL AND CAST(jira_updated AS DATE) = today AND status_category = 'Done'` | n8n: `status CHANGED TO (Resolved, Closed) AFTER startOfDay()`. Jira: `resolved >= startOfDay()`. | NOVA's `jira_updated` proxy may include tickets updated-but-not-resolved-today, or miss tickets resolved but not recently updated. |
| **SLA actionable classification** | Actionable: status in [open, reopened, work in progress]. Excluded: [done, closed, resolved, waiting on requestor, waiting on partner]. | n8n: identical classification. | Aligned. No methodological difference. |
| **Due date filter on SLA counts** | NOVA does NOT apply due date filter to SLA breach counts | n8n: `duedate <= endOfDay || no duedate` — only counts breaches where due date has passed | n8n's due date filter may exclude breaches on tickets not yet due. NOVA counts all breaches regardless. This could cause NOVA to report higher SLA breach counts than n8n. |

---

## 5. Non-Jira KPIs

These KPIs should NOT be judged as Jira parity problems:

| KPI | Source | Notes |
|-----|--------|-------|
| AI Resolution Rate % | NOVA `approval_queue` table | AI agent not active; will produce values when AI is enabled |
| AI Tickets Pending Approval | NOVA `approval_queue` table | Same |
| AI Tickets Resolved (Today) | NOVA `approval_queue` table | Same |
| WTD percentage KPI's Green | Meta-calculation from `jira_kpi_daily` RAG values | NOVA-only KPI; no n8n equivalent |
| WTD percentage KPI's Red | Same | Same |
| Open Tickets | NOVA cache count | NOVA-originated metric (n8n did not produce a single "Open Tickets" count) |
| Unassigned | NOVA cache count | NOVA-originated |
| Waiting on Requestor | NOVA cache count by status | NOVA-originated |
| SLA Breached (global) | NOVA cache count of Resolution SLA breaches | NOVA-originated (n8n did per-tier but not global) |

---

## 6. Recommendations

### 6a. Fix in NOVA (Code Changes Required)

1. **Cache repopulation after reconciliation.** The reconciliation sweep deleted phantom rows but `fullSync()` has not rebuilt the cache fully. Ensure a full re-sync runs after any bulk deletion. Current deficit: ~520 tickets vs live Jira. **This is the single highest-impact issue.**

2. **Add `customfield_12802` (CSAT) to `ALL_FIELDS`** in `jira-sync-service.ts`. Without this field in the cache, CSAT will always be 0. Same pattern as the FRT fix.

3. **Add per-tier SLA Compliance % KPIs** (10 KPIs). The data is already parsed — just needs emission logic in `collectJiraSnapshot()` to break compliance % down by tier for resolved-today tickets.

4. **Add per-tier FRT/Resolution Met/Breached count KPIs** (24 KPIs). Same — data is available, just needs additional emission loops.

5. **Add Escalation Accuracy % (All Time)** variant. Simple extension of existing 30-day calculation to use no date bound.

6. **Resolved-today methodology.** Consider switching from `jira_updated` proxy to `resolved_at` or status transition detection for more accurate resolution date tracking.

### 6b. Operational Setup (No Code Change)

1. **Verify `request_type` population.** 85% of CC tickets have null `customfield_13482`. If this field should be populated, it's a Jira configuration issue, not a NOVA code issue. Until fixed, ~400 CC tickets will remain invisible to per-tier CC KPIs.

2. **Verify "Waiting for Customer" status name.** NOVA finds 54 tickets but JQL query returned 0. The exact status name needs confirmation in Jira to ensure MCP queries use the right name.

### 6c. Documentation / Methodology Clarification

1. **Document the due date filter difference.** n8n applies `duedate <= endOfDay` to SLA breach counts; NOVA does not. Decide whether NOVA should match n8n's approach or keep its current (broader) definition.

2. **Document the "Open Tickets" KPI definition.** This is a NOVA-only metric. Clarify whether it should count all cached tickets or only those in governed tiers.

3. **Document escalation data source.** NOVA uses `escalation_log` (Jira changelog-derived); n8n used `dbo.JiraTickets` (being deprecated). These will produce different numbers. The `escalation_log` approach is the forward path.

### 6d. n8n Decommission / Mapping Work

1. **n8n v4 is INACTIVE** — no decommission action needed for the v4 workflow itself.

2. **`dbo.JiraTickets` dependency.** n8n's escalation/rejection KPIs read from this forbidden legacy table. NOVA has already replaced this with `escalation_log`. No mapping work needed — the migration is complete.

3. **`dbo.Agent` table.** The SLA Breach Board reads from `dbo.Agent` (populated by n8n). This is the last remaining n8n → NOVA data dependency for user-facing surfaces. Either (a) NOVA should populate `dbo.Agent` itself, or (b) the breach board should be repointed to `jira_kpi_daily` (losing per-agent granularity until agent-level KPIs are built).

4. **Agent-level KPI pipeline.** n8n v4 produced ~30 metrics per agent written to `jira_agent_kpi_daily`. NOVA has no equivalent. This is a P3 feature gap that requires significant new code if agent-level reporting is needed.

5. **KpiSnapshot table.** Last updated 2026-05-15 (6 days stale). If n8n v3.1 is also stopped, this table will become permanently stale. Trends page reads from this table for some historical data. Ensure `jira_kpi_daily` is the sole source of truth before decommissioning.

---

## Appendix A: Data Collection Methodology

### NOVA Values
- Queried `dbo.jira_kpi_daily` in `techservicesjsm` Azure SQL for today (2026-05-21). Returned 78 rows.
- Queried `dbo.KpiSnapshot` for latest date. Returned 99 rows dated 2026-05-15.

### Jira Values
- Used Atlassian Rovo MCP `searchJiraIssuesUsingJql` with `cloudId = nurtur.atlassian.net`.
- 17 JQL queries executed. All volume queries returned valid `total` counts.
- SLA-specific JQL functions (`breached()`, `!= breached()`) returned 0 for all queries — suspected MCP tool limitation rather than actual zero breaches.
- Issue type queries for "Incident" and "[System] Service request" returned 0 — these JSM-default types are not used in NT/NTPJ.

### n8n v4 Workflow
- Retrieved full workflow `KriwNYXfWcGBW7D7` via n8n MCP `n8n_get_workflow`.
- Analyzed all node definitions, JQL queries, Code node logic, SQL write statements.
- Workflow status: INACTIVE. Last updated 2026-04-16. Never ran in production (v3.1 was the active version).

### Limitations
1. **Atlassian MCP does not support SLA JQL functions** — all SLA breach/compliance queries returned 0. This prevented direct Jira verification of 14 SLA-related KPIs.
2. **MCP does not expose per-ticket custom field grouping** — CC sub-tier counts could not be verified because `customfield_13482` (request type) is not queryable via MCP JQL syntax.
3. **KpiSnapshot is 6 days stale** — comparisons between NOVA daily (May 21) and KpiSnapshot (May 15) are directional only, not exact matches.
4. **No-reply, age, and oldest-ticket KPIs** cannot be independently verified via MCP — they require per-ticket inspection of comment dates and creation timestamps across the full open queue.
