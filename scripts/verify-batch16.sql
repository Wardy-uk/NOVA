-- ============================================================
-- BATCH 16 VERIFICATION SCRIPT
-- Run in Azure Data Studio against: techservicesjsm
-- After executing the KPI Historical Backfill workflow (Batch 16)
-- ============================================================

-- 1. Summary: KPI count per date (should be 96+ for all dates)
SELECT
    CAST(CreatedAt AS date) AS [date],
    DATENAME(dw, CAST(CreatedAt AS date)) AS [day],
    COUNT(DISTINCT kpi) AS kpi_count,
    COUNT(*) AS total_rows,
    CASE
        WHEN COUNT(DISTINCT kpi) >= 96 THEN 'COMPLETE'
        WHEN COUNT(DISTINCT kpi) >= 80 THEN 'MOSTLY COMPLETE'
        ELSE 'INCOMPLETE'
    END AS status
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) BETWEEN '2026-03-31' AND '2026-04-09'
GROUP BY CAST(CreatedAt AS date)
ORDER BY [date];

-- 2. Compare with expected 96 KPIs: which are still missing?
WITH Baseline AS (
    SELECT DISTINCT kpi FROM dbo.jira_kpi_daily
    WHERE CAST(CreatedAt AS date) = '2026-03-10'
    AND kpi NOT LIKE 'AI %'
),
Dates AS (
    SELECT CAST('2026-03-31' AS DATE) AS d
    UNION ALL SELECT DATEADD(day, 1, d) FROM Dates WHERE d < '2026-04-09'
),
Expected AS (
    SELECT d.d, b.kpi FROM Dates d CROSS JOIN Baseline b
),
Actual AS (
    SELECT CAST(CreatedAt AS date) AS d, kpi FROM dbo.jira_kpi_daily
)
SELECT e.d AS missing_date, e.kpi AS missing_kpi
FROM Expected e
LEFT JOIN Actual a ON e.d = a.d AND e.kpi = a.kpi
WHERE a.kpi IS NULL
ORDER BY e.d, e.kpi;

-- 3. Spot-check: Apr 8 (worst gap date) - show all KPIs
SELECT kpi, [count], kpiGroup
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) = '2026-04-08'
ORDER BY kpi;

-- 4. Before vs After comparison
-- (Run this AFTER exporting batch16-AFTER.csv)
-- Expected: Every date should have 96 KPIs
-- Before: Apr 3=56, Apr 4=58, Apr 5=56, Apr 6=61, Apr 8=45
-- After:  All should be 96
