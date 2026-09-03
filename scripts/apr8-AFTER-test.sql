-- ============================================================
-- APR 8 SINGLE DATE TEST - Verification
-- Run in Azure Data Studio against: techservicesjsm
-- ============================================================

-- 1. How many KPIs does Apr 8 have now?
SELECT
    COUNT(DISTINCT kpi) AS kpi_count,
    COUNT(*) AS total_rows,
    CASE
        WHEN COUNT(DISTINCT kpi) >= 96 THEN 'PASS - Full coverage'
        WHEN COUNT(DISTINCT kpi) >= 80 THEN 'PARTIAL'
        ELSE 'FAIL - Too few KPIs'
    END AS status
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) = '2026-04-08';

-- 2. Full list of Apr 8 KPIs (compare with apr8-BEFORE-test.csv)
SELECT
    kpi,
    [count] AS value,
    kpiGroup
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) = '2026-04-08'
ORDER BY kpi;

-- 3. Sanity checks - flag suspicious values
SELECT 'SANITY CHECK' AS test, kpi, [count] AS value,
    CASE
        WHEN kpi LIKE '%Compliance %' AND [count] > 100 THEN 'FAIL: >100%'
        WHEN kpi LIKE '%Compliance %' AND [count] < 0 THEN 'FAIL: negative %'
        WHEN kpi LIKE 'Number of Tickets in%' AND [count] > 1000 THEN 'WARN: very high count'
        WHEN kpi LIKE 'Number of Tickets in%' AND [count] < 0 THEN 'FAIL: negative count'
        WHEN kpi LIKE '%No Reply%' AND [count] > 500 THEN 'WARN: very high no-reply'
        WHEN kpi = 'CSAT %' AND [count] > 100 THEN 'FAIL: >100%'
        WHEN kpi = 'FCR Rate %' AND [count] > 100 THEN 'FAIL: >100%'
        ELSE 'OK'
    END AS check_result
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) = '2026-04-08'
  AND (
    ([count] < 0)
    OR (kpi LIKE '%[%]%' AND [count] > 100)
    OR (kpi LIKE 'Number of Tickets in%' AND [count] > 1000)
    OR (kpi LIKE '%No Reply%' AND [count] > 500)
  )
ORDER BY kpi;

-- 4. Compare with a known-good date (Apr 7 or Mar 10)
-- Apr 8 should have similar magnitude to nearby dates
SELECT '2026-04-07' AS compare_date, kpi, [count] AS apr7_value
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) = '2026-04-07'
  AND kpi IN ('Number of Tickets in CC (Incidents)', 'Number of Tickets in Tier 2',
              'FRT Compliance % (Open Queue)', 'Tickets Solved Today', 'New Tickets Today')
UNION ALL
SELECT '2026-04-08', kpi, [count]
FROM dbo.jira_kpi_daily
WHERE CAST(CreatedAt AS date) = '2026-04-08'
  AND kpi IN ('Number of Tickets in CC (Incidents)', 'Number of Tickets in Tier 2',
              'FRT Compliance % (Open Queue)', 'Tickets Solved Today', 'New Tickets Today')
ORDER BY kpi, compare_date;
