import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { closePool } from './db.js';

import { trendAnalysisSchema, trendAnalysis } from './tools/trend-analysis.js';
import { agentComparisonSchema, agentComparison } from './tools/agent-comparison.js';
import { focusAreasSchema, focusAreas } from './tools/focus-areas.js';
import { qaDeepDiveSchema, qaDeepDive } from './tools/qa-deep-dive.js';
import { slaBreakdownSchema, slaBreakdown } from './tools/sla-breakdown.js';
import { checkpointSummarySchema, checkpointSummary } from './tools/checkpoint-summary.js';
import { rawKpiQuerySchema, rawKpiQuery } from './tools/raw-kpi-query.js';
import {
  getConfigSchema,
  getConfig,
  setSettingSchema,
  setSetting,
} from './tools/admin-config.js';

const server = new McpServer({
  name: 'nova',
  version: '1.0.0',
});

// 1. Trend Analysis
server.tool(
  'nova_trend_analysis',
  'Analyse a KPI trend over time from jira_kpi_daily. Returns time series, week-over-week change, rolling average, breach periods, and whether the metric is improving or degrading vs target.',
  trendAnalysisSchema,
  async (args) => trendAnalysis(args as any),
);

// 2. Agent Comparison
server.tool(
  'nova_agent_comparison',
  'Compare all team agents on a given metric (QA score, open tickets, solved today, over 2h, no update). Returns ranked list with team average, above/below flags, and outliers.',
  agentComparisonSchema,
  async (args) => agentComparison(args as any),
);

// 3. Focus Areas
server.tool(
  'nova_focus_areas',
  'Cross-reference KPIs, QA scores, Golden Rules, SLA, and week-on-week changes to surface the top 5 areas needing attention. Each has severity, metric, target, gap, and recommended action.',
  focusAreasSchema,
  async (args) => focusAreas(args as any),
);

// 4. QA Deep Dive
server.tool(
  'nova_qa_deep_dive',
  'Deep QA analysis: score distribution (GREEN/AMBER/RED), dimension averages (accuracy, clarity, tone), category breakdown, concerning tickets, Golden Rules pass rates, and coaching priorities. Optional agent filter.',
  qaDeepDiveSchema,
  async (args) => qaDeepDive(args as any),
);

// 5. SLA Breakdown
server.tool(
  'nova_sla_breakdown',
  'SLA compliance analysis: FRT and Resolution compliance percentages, over-SLA counts, escalation accuracy, and first-half vs second-half trend. Filterable by tier.',
  slaBreakdownSchema,
  async (args) => slaBreakdown(args as any),
);

// 6. Checkpoint Summary
server.tool(
  'nova_checkpoint_summary',
  'Pull key metrics across the 90-day checkpoint framework (Day 0, Day 1, Day 15, Day 30, WTD, MTD). Returns a metric × period matrix with RAG statuses and movement since Day 1.',
  checkpointSummarySchema,
  async (args) => checkpointSummary(args as any),
);

// 7. Raw KPI Query
server.tool(
  'nova_raw_kpi_query',
  'Low-level escape hatch: query jira_kpi_daily for any KPI matching a LIKE pattern. Returns raw time series grouped by KPI name. Has SQL injection protection.',
  rawKpiQuerySchema,
  async (args) => rawKpiQuery(args as any),
);

// 8. Admin — read config
server.tool(
  'nova_admin_get_config',
  'Read NOVA admin config from settings.json. Returns a masked view of all settings keys (tokens/passwords/emails redacted) or an unmasked view if explicitly requested. Optional regex filter on key names. Use this to inspect how integrations, Dev Review, and other config is set up without needing to touch the Admin UI.',
  getConfigSchema,
  async (args) => getConfig(args as { key_pattern?: string; unmask: boolean }),
);

// 9. Admin — write a single setting (dry-run by default, denylisted keys blocked)
server.tool(
  'nova_admin_set_setting',
  'Write a single key in NOVA settings.json. Performs a dry-run by default — pass confirm: true to actually apply. Blocked for any key matching the secret denylist (tokens, passwords, SSO config, custom_roles, role_permissions) — those must be changed via the Admin UI. NOVA reloads settings on every get() call so no server restart is needed.',
  setSettingSchema,
  async (args) => setSetting(args as { key: string; value: string; confirm: boolean }),
);

// Start
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await closePool();
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await closePool();
    await server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error starting NOVA MCP server:', err);
  process.exit(1);
});
