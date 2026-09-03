-- ============================================================
-- KPI Daily History Backfill for 2026-04-07 and 2026-04-08
-- ============================================================
-- These dates had no data due to:
--   Apr 7: Full-day DNS outage (EAI_AGAIN nurturtech.atlassian.net)
--   Apr 8: 87-minute Jira hang at 17:00 blocking 17:30 EOD + 18:00 Daily triggers
--
-- This script backfills the SQL-based KPIs (escalation/rejection counts)
-- from the JiraTickets table. Jira-live KPIs (open ticket counts by queue)
-- should be backfilled by running the "KPI Backfill - April 7-8" n8n workflow.
--
-- RUN THIS: In n8n, open "KPI SQL Backfill Runner" workflow and click Execute,
-- OR paste this SQL into Azure Data Studio connected to techservicesjsm.
-- ============================================================

-- Step 1: Clean any partial data for these dates (idempotent)
DELETE FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) IN ('2026-04-07', '2026-04-08')
  AND kpi IN (
    'Tickets escalated to Tier 2',
    'Tickets escalated to Tier 3',
    'Tickets escalated to Development',
    'Tickets rejected by Tier 2',
    'Tickets rejected by Tier 3',
    'Tickets rejected by Development',
    'Escalation Accuracy %',
    'Escalation Accuracy % (All Time)'
  );

-- ============================================================
-- Step 2: April 7 - Escalation KPIs
-- ============================================================

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets escalated to Tier 2', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 10, 'Lower',
  CASE WHEN COUNT(*) <= 10 THEN 1 WHEN COUNT(*) <= 11 THEN 2 ELSE 3 END,
  '2026-04-07'
FROM JiraTickets WHERE CAST(Tier2EscalationAt AS date) = '2026-04-07';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets escalated to Tier 3', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 2, 'Lower',
  CASE WHEN COUNT(*) <= 2 THEN 1 WHEN COUNT(*) <= 3 THEN 2 ELSE 3 END,
  '2026-04-07'
FROM JiraTickets WHERE CAST(Tier3EscalationAt AS date) = '2026-04-07';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets escalated to Development', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 1, 'Lower',
  CASE WHEN COUNT(*) <= 1 THEN 1 WHEN COUNT(*) <= 2 THEN 2 ELSE 3 END,
  '2026-04-07'
FROM JiraTickets WHERE CAST(DevEscalationAt AS date) = '2026-04-07';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets rejected by Tier 2', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 2, 'Lower',
  CASE WHEN COUNT(*) <= 2 THEN 1 WHEN COUNT(*) <= 3 THEN 2 ELSE 3 END,
  '2026-04-07'
FROM JiraTickets WHERE CAST(Tier2RejectionAt AS date) = '2026-04-07';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets rejected by Tier 3', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 1, 'Lower',
  CASE WHEN COUNT(*) <= 1 THEN 1 WHEN COUNT(*) <= 2 THEN 2 ELSE 3 END,
  '2026-04-07'
FROM JiraTickets WHERE CAST(Tier3RejectionAt AS date) = '2026-04-07';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets rejected by Development', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 0, 'Equal',
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 3 END,
  '2026-04-07'
FROM JiraTickets WHERE CAST(DevRejectionAt AS date) = '2026-04-07';

-- April 7: Escalation Accuracy % (Rolling 30 Days)
INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Escalation Accuracy %', 'Tiered Support',
  CASE WHEN esc.total > 0
    THEN CAST(ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) AS INT)
    ELSE 100
  END,
  90, 'Higher',
  CASE
    WHEN esc.total > 0 AND CAST(ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) AS INT) >= 90 THEN 1
    WHEN esc.total > 0 AND CAST(ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) AS INT) >= 81 THEN 2
    ELSE 3
  END,
  '2026-04-07'
FROM (
  SELECT COUNT(*) AS total FROM JiraTickets
  WHERE Tier2EscalationAt >= DATEADD(day, -30, '2026-04-07')
     OR Tier3EscalationAt >= DATEADD(day, -30, '2026-04-07')
     OR DevEscalationAt >= DATEADD(day, -30, '2026-04-07')
) esc
CROSS JOIN (
  SELECT COUNT(*) AS total FROM JiraTickets
  WHERE Tier2RejectionAt >= DATEADD(day, -30, '2026-04-07')
     OR Tier3RejectionAt >= DATEADD(day, -30, '2026-04-07')
     OR DevRejectionAt >= DATEADD(day, -30, '2026-04-07')
) rej;

-- ============================================================
-- Step 3: April 8 - Escalation KPIs
-- ============================================================

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets escalated to Tier 2', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 10, 'Lower',
  CASE WHEN COUNT(*) <= 10 THEN 1 WHEN COUNT(*) <= 11 THEN 2 ELSE 3 END,
  '2026-04-08'
FROM JiraTickets WHERE CAST(Tier2EscalationAt AS date) = '2026-04-08';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets escalated to Tier 3', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 2, 'Lower',
  CASE WHEN COUNT(*) <= 2 THEN 1 WHEN COUNT(*) <= 3 THEN 2 ELSE 3 END,
  '2026-04-08'
FROM JiraTickets WHERE CAST(Tier3EscalationAt AS date) = '2026-04-08';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets escalated to Development', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 1, 'Lower',
  CASE WHEN COUNT(*) <= 1 THEN 1 WHEN COUNT(*) <= 2 THEN 2 ELSE 3 END,
  '2026-04-08'
FROM JiraTickets WHERE CAST(DevEscalationAt AS date) = '2026-04-08';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets rejected by Tier 2', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 2, 'Lower',
  CASE WHEN COUNT(*) <= 2 THEN 1 WHEN COUNT(*) <= 3 THEN 2 ELSE 3 END,
  '2026-04-08'
FROM JiraTickets WHERE CAST(Tier2RejectionAt AS date) = '2026-04-08';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets rejected by Tier 3', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 1, 'Lower',
  CASE WHEN COUNT(*) <= 1 THEN 1 WHEN COUNT(*) <= 2 THEN 2 ELSE 3 END,
  '2026-04-08'
FROM JiraTickets WHERE CAST(Tier3RejectionAt AS date) = '2026-04-08';

INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Tickets rejected by Development', 'Tiered Support',
  CAST(COUNT(*) AS decimal(18,4)), 0, 'Equal',
  CASE WHEN COUNT(*) = 0 THEN 1 ELSE 3 END,
  '2026-04-08'
FROM JiraTickets WHERE CAST(DevRejectionAt AS date) = '2026-04-08';

-- April 8: Escalation Accuracy % (Rolling 30 Days)
INSERT INTO dbo.jira_kpi_daily (kpi, kpiGroup, [count], target, direction, rag, CreatedAt)
SELECT 'Escalation Accuracy %', 'Tiered Support',
  CASE WHEN esc.total > 0
    THEN CAST(ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) AS INT)
    ELSE 100
  END,
  90, 'Higher',
  CASE
    WHEN esc.total > 0 AND CAST(ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) AS INT) >= 90 THEN 1
    WHEN esc.total > 0 AND CAST(ROUND(((esc.total - rej.total) * 100.0 / esc.total), 0) AS INT) >= 81 THEN 2
    ELSE 3
  END,
  '2026-04-08'
FROM (
  SELECT COUNT(*) AS total FROM JiraTickets
  WHERE Tier2EscalationAt >= DATEADD(day, -30, '2026-04-08')
     OR Tier3EscalationAt >= DATEADD(day, -30, '2026-04-08')
     OR DevEscalationAt >= DATEADD(day, -30, '2026-04-08')
) esc
CROSS JOIN (
  SELECT COUNT(*) AS total FROM JiraTickets
  WHERE Tier2RejectionAt >= DATEADD(day, -30, '2026-04-08')
     OR Tier3RejectionAt >= DATEADD(day, -30, '2026-04-08')
     OR DevRejectionAt >= DATEADD(day, -30, '2026-04-08')
) rej;

-- ============================================================
-- Step 4: Verify
-- ============================================================
SELECT
  CAST(CreatedAt AS date) AS [Date],
  COUNT(*) AS [KPI_Count],
  STRING_AGG(kpi, ', ') AS [KPIs]
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) IN ('2026-04-07', '2026-04-08')
GROUP BY CAST(CreatedAt AS date)
ORDER BY [Date];
