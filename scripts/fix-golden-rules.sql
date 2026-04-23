-- Golden Rules Data Fix
-- =====================
-- The Jira_QA_GoldenRules table contains incorrect data:
-- Rule1/2/3 scores were populated from clarityScore/toneScore/accuracyScore (1-10 scale)
-- instead of Ownership/NextAction/Timeframe (0-3 scale).
-- The pass flags were calculated with threshold >= 5 on the 10-point scale.
--
-- This data cannot be converted — the LLM was scoring the wrong dimensions entirely.
-- The fix: truncate and let the corrected QA pipeline re-populate with correct scores.
--
-- Run this AFTER deploying the code fix (which changes the QA prompt + pipeline).

-- Step 1: Check current data stats before wiping
SELECT 'BEFORE TRUNCATE' AS step,
  COUNT(*) AS total_rows,
  MIN(CreatedAt) AS earliest,
  MAX(CreatedAt) AS latest,
  AVG(CAST(Rule1Score AS FLOAT)) AS avg_r1_should_be_0to3_but_is_1to10,
  AVG(CAST(Rule2Score AS FLOAT)) AS avg_r2,
  AVG(CAST(Rule3Score AS FLOAT)) AS avg_r3
FROM dbo.Jira_QA_GoldenRules;

-- Step 2: Truncate the bad data
TRUNCATE TABLE dbo.Jira_QA_GoldenRules;

-- Step 3: Also fix the daily agent KPI table where GR averages were written
-- The jira_agent_kpi_daily table has columns derived from the bad GR data:
--   GoldenRulesScored, GoldenRulesAvg, OwnershipAvg, NextActionAvg, TimeframeAvg
-- These are aggregated at query time from Jira_QA_GoldenRules, not stored in the daily table,
-- so they will self-correct once new data flows in.

-- Step 4: Verify
SELECT 'AFTER TRUNCATE' AS step, COUNT(*) AS total_rows FROM dbo.Jira_QA_GoldenRules;

-- The QA pipeline runs every 2 hours and will re-score recently resolved tickets.
-- Golden Rules data will rebuild over the next few days with correct 0-3 scoring.
