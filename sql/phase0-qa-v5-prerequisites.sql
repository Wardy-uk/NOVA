-- ============================================================
-- NOVA QA V5 Backfill — Phase 0 Prerequisites
-- Run on LIVE SQL Server before starting backfill
-- ============================================================
-- WARNING: Run each section one at a time. Verify row counts
-- before proceeding to the next section.
-- DO NOT touch: JiraSlaRaw, JiraTickets, JiraTicketsArchive
-- ============================================================

-- ── 0a: Archive V4 QA Results ──
-- Expected: ~19,620 rows
PRINT '=== Step 0a: Archiving V4 jira_qa_results ===';

SELECT *, 'v4' AS dataVersion, GETUTCDATE() AS archivedAt
INTO dbo.jira_qa_results_v4_archive
FROM dbo.jira_qa_results;

PRINT 'Archived rows: ' + CAST(@@ROWCOUNT AS VARCHAR);
GO

-- Verify
SELECT COUNT(*) AS archive_rows FROM dbo.jira_qa_results_v4_archive;
SELECT COUNT(*) AS original_rows FROM dbo.jira_qa_results;
-- These two counts MUST match before proceeding
GO

-- ── 0b: Archive V4 Golden Rules ──
-- Expected: ~7,318 rows
PRINT '=== Step 0b: Archiving V4 Jira_QA_GoldenRules ===';

SELECT *, 'v4' AS dataVersion, GETUTCDATE() AS archivedAt
INTO dbo.Jira_QA_GoldenRules_v4_archive
FROM dbo.Jira_QA_GoldenRules;

PRINT 'Archived rows: ' + CAST(@@ROWCOUNT AS VARCHAR);
GO

-- Verify
SELECT COUNT(*) AS archive_rows FROM dbo.Jira_QA_GoldenRules_v4_archive;
SELECT COUNT(*) AS original_rows FROM dbo.Jira_QA_GoldenRules;
-- These two counts MUST match before proceeding
GO

-- ── 0c: Create Backfill Progress Tracking Table ──
PRINT '=== Step 0c: Creating QA_Backfill_Progress table ===';

IF OBJECT_ID('dbo.QA_Backfill_Progress', 'U') IS NOT NULL
  DROP TABLE dbo.QA_Backfill_Progress;

CREATE TABLE dbo.QA_Backfill_Progress (
  Id INT IDENTITY PRIMARY KEY,
  BackfillDate DATE NOT NULL,
  QAType VARCHAR(20) NOT NULL,        -- 'FullQA' or 'GoldenRules'
  Status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, running, complete, failed
  TicketsFound INT NULL,
  TicketsProcessed INT NULL,
  TicketsSkipped INT NULL,
  ErrorMessage NVARCHAR(MAX) NULL,
  StartedAt DATETIME NULL,
  CompletedAt DATETIME NULL,
  RetryCount INT DEFAULT 0,
  CreatedAt DATETIME DEFAULT GETUTCDATE()
);
GO

-- ── 0d: Populate with date windows (2025-11-01 to 2026-03-15) ──
PRINT '=== Step 0d: Populating date windows ===';

DECLARE @d DATE = '2025-11-01';
WHILE @d < '2026-03-16'
BEGIN
  INSERT INTO dbo.QA_Backfill_Progress (BackfillDate, QAType, Status)
  VALUES (@d, 'FullQA', 'pending'), (@d, 'GoldenRules', 'pending');
  SET @d = DATEADD(DAY, 1, @d);
END;

SELECT COUNT(*) AS total_windows FROM dbo.QA_Backfill_Progress;
-- Expected: 270 rows (135 days x 2 QA types)

SELECT QAType, COUNT(*) AS windows
FROM dbo.QA_Backfill_Progress
GROUP BY QAType;
GO

-- ── 0e: Clear UAT tables for clean backfill ──
PRINT '=== Step 0e: Truncating UAT tables ===';

-- Check current UAT row counts first
SELECT 'jira_qa_resultsUAT' AS tbl, COUNT(*) AS rows FROM dbo.jira_qa_resultsUAT
UNION ALL
SELECT 'Jira_QA_GoldenRulesUAT', COUNT(*) FROM dbo.Jira_QA_GoldenRulesUAT;
GO

TRUNCATE TABLE dbo.jira_qa_resultsUAT;
TRUNCATE TABLE dbo.Jira_QA_GoldenRulesUAT;

PRINT '=== Phase 0 Complete ===';
PRINT 'Ready for backfill orchestrator.';
GO
