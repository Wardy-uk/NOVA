-- ============================================================
-- Phase 1: KPI Data Archive (pre v3.1 engine)
-- Run BEFORE any KPI backfill or truncation
-- Review output at each step before proceeding
-- ============================================================

-- Step 1: Check current row counts (report these to Nick)
PRINT '=== BEFORE ARCHIVE: Current row counts ==='
SELECT 'jira_kpi_daily' AS [table], COUNT(*) AS rows FROM dbo.jira_kpi_daily;
SELECT 'jira_agent_kpi_daily' AS [table], COUNT(*) AS rows FROM dbo.jira_agent_kpi_daily;

-- Step 2: Archive KPI daily history
PRINT '=== Archiving jira_kpi_daily ==='
SELECT *, 'v_pre_3.1' AS dataVersion, GETUTCDATE() AS archivedAt
INTO dbo.jira_kpi_daily_archive
FROM dbo.jira_kpi_daily;

-- Step 3: Verify archive row count matches
PRINT '=== VERIFY: Archive row count must match original ==='
SELECT 'jira_kpi_daily' AS [table], COUNT(*) AS original FROM dbo.jira_kpi_daily;
SELECT 'jira_kpi_daily_archive' AS [table], COUNT(*) AS archived FROM dbo.jira_kpi_daily_archive;

-- Step 4: Archive agent KPI daily history
PRINT '=== Archiving jira_agent_kpi_daily ==='
SELECT *, 'v_pre_3.1' AS dataVersion, GETUTCDATE() AS archivedAt
INTO dbo.jira_agent_kpi_daily_archive
FROM dbo.jira_agent_kpi_daily;

-- Step 5: Verify archive row count matches
PRINT '=== VERIFY: Archive row count must match original ==='
SELECT 'jira_agent_kpi_daily' AS [table], COUNT(*) AS original FROM dbo.jira_agent_kpi_daily;
SELECT 'jira_agent_kpi_daily_archive' AS [table], COUNT(*) AS archived FROM dbo.jira_agent_kpi_daily_archive;

-- ============================================================
-- STOP HERE. Report counts to Nick. Do NOT proceed until confirmed.
-- ============================================================

-- Step 6: ONLY after Nick confirms archive counts match:
-- TRUNCATE TABLE dbo.jira_kpi_daily;
-- TRUNCATE TABLE dbo.jira_agent_kpi_daily;
-- Then re-run v3.1 KPI engine backfill from 2025-11-01 → today
