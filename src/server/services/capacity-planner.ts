import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';
import { getKpiPool } from './kpi-pipeline.js';

export interface DayForecast {
  forecast_date: string;
  day_of_week: number;
  predicted_volume: number;
  confidence_low: number;
  confidence_high: number;
  actual_volume: number | null;
  team_capacity: number;
  surplus_deficit: number;
}

export interface CapacityForecastResult {
  forecasts: DayForecast[];
  staffing_recommendations: string[];
}

export class CapacityPlanner {
  constructor(private settings: SettingsQueries) {}

  async generateForecast(): Promise<CapacityForecastResult> {
    const project = 'NT';

    // Backfill last week's actuals first
    await this.backfillActuals(project);

    // Get 90 days of historical data by day of week
    const historical = await query<{ day_of_week: number; avg_volume: number; stddev: number }>(
      `SELECT
         DATEPART(WEEKDAY, jira_created) AS day_of_week,
         CAST(COUNT(*) AS FLOAT) / NULLIF(COUNT(DISTINCT CAST(jira_created AS DATE)), 0) AS avg_volume,
         STDEV(sub.daily_count) AS stddev
       FROM jira_issue_cache
       CROSS APPLY (
         SELECT COUNT(*) AS daily_count
         FROM jira_issue_cache j2
         WHERE j2.project_key = ? AND CAST(j2.jira_created AS DATE) = CAST(jira_issue_cache.jira_created AS DATE)
       ) sub
       WHERE project_key = ? AND jira_created >= DATEADD(day, -90, GETUTCDATE())
       GROUP BY DATEPART(WEEKDAY, jira_created)`,
      [project, project],
    );

    // Simpler fallback if the cross apply query is too complex
    const dailyCounts = await query<{ dt: string; cnt: number; dow: number }>(
      `SELECT CAST(jira_created AS DATE) AS dt, COUNT(*) AS cnt, DATEPART(WEEKDAY, jira_created) AS dow
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= DATEADD(day, -90, GETUTCDATE())
       GROUP BY CAST(jira_created AS DATE), DATEPART(WEEKDAY, jira_created)
       ORDER BY dt`,
      [project],
    );

    // Compute averages and stddev by day of week
    const dowStats = new Map<number, { sum: number; count: number; values: number[] }>();
    for (const d of dailyCounts) {
      const existing = dowStats.get(d.dow) ?? { sum: 0, count: 0, values: [] };
      existing.sum += d.cnt;
      existing.count++;
      existing.values.push(d.cnt);
      dowStats.set(d.dow, existing);
    }

    // Get team capacity from real per-agent historical throughput
    const activeAgents = await query<{ display_name: string }>(
      `SELECT display_name FROM agent_roster WHERE active = 1`,
    );
    const activeNames = new Set(activeAgents.map(a => a.display_name?.trim().toLowerCase()));

    let dailyCapacity = 0;
    try {
      const kpiPool = await getKpiPool(this.settings);
      const agentAverages = await kpiPool.request().query(`
        SELECT AgentName, AVG(CAST(SolvedTickets_Today AS FLOAT)) AS avg_solved
        FROM dbo.jira_agent_kpi_daily
        WHERE ReportDate >= DATEADD(day, -90, GETUTCDATE())
          AND SolvedTickets_Today IS NOT NULL
          AND SolvedTickets_Today > 0
        GROUP BY AgentName
      `);
      for (const a of agentAverages.recordset) {
        if (activeNames.has(a.AgentName?.trim().toLowerCase())) {
          dailyCapacity += a.avg_solved;
        }
      }
      dailyCapacity = Math.round(dailyCapacity);
      console.log(`[capacity] Team daily capacity: ${dailyCapacity} tickets (${activeAgents.length} active agents)`);
    } catch (kpiErr) {
      console.warn('[capacity] KPI pool unavailable for agent throughput, using fallback:', kpiErr instanceof Error ? kpiErr.message : kpiErr);
    }

    if (dailyCapacity === 0) {
      const fallbackCount = activeAgents.length || parseInt(this.settings.get('capacity_default_agents') ?? '5', 10);
      const fallbackRate = parseInt(this.settings.get('agent_max_capacity') ?? '12', 10);
      dailyCapacity = fallbackCount * fallbackRate;
    }

    // Generate 14-day forecast
    const forecasts: DayForecast[] = [];
    const recommendations: string[] = [];
    const today = new Date();

    for (let i = 0; i < 14; i++) {
      const forecastDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      const dow = forecastDate.getDay() + 1; // SQL Server DATEPART(WEEKDAY) is 1-based, Sunday=1
      const dateStr = forecastDate.toISOString().split('T')[0];

      // Weekend — skip or minimal
      if (dow === 1 || dow === 7) {
        forecasts.push({
          forecast_date: dateStr,
          day_of_week: dow,
          predicted_volume: 0,
          confidence_low: 0,
          confidence_high: 0,
          actual_volume: null,
          team_capacity: 0,
          surplus_deficit: 0,
        });
        continue;
      }

      const stats = dowStats.get(dow);
      const avg = stats ? stats.sum / stats.count : 0;
      const stddev = stats ? this.computeStddev(stats.values, avg) : 0;

      const predicted = Math.round(avg);
      const confidenceLow = Math.max(Math.round(avg * 0.5), Math.round(avg - stddev));
      const confidenceHigh = Math.round(avg + stddev);

      const surplus = dailyCapacity - predicted;

      forecasts.push({
        forecast_date: dateStr,
        day_of_week: dow,
        predicted_volume: predicted,
        confidence_low: confidenceLow,
        confidence_high: confidenceHigh,
        actual_volume: null,
        team_capacity: dailyCapacity,
        surplus_deficit: surplus,
      });

      // Flag days where predicted exceeds 80% capacity
      if (predicted > dailyCapacity * 0.8) {
        const dayName = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
        recommendations.push(
          `${dayName} ${dateStr}: predicted ${predicted} tickets vs capacity ${dailyCapacity} (${((predicted / dailyCapacity) * 100).toFixed(0)}% utilisation)`,
        );
      }
    }

    // Persist forecasts
    for (const f of forecasts) {
      const existing = await query<{ id: number }>(
        `SELECT id FROM agent_capacity_forecasts WHERE forecast_date = ?`, [f.forecast_date],
      );
      if (existing.length > 0) {
        await execute(
          `UPDATE agent_capacity_forecasts
           SET predicted_volume = ?, confidence_low = ?, confidence_high = ?,
               team_capacity = ?, surplus_deficit = ?, day_of_week = ?, generated_at = GETUTCDATE()
           WHERE id = ?`,
          [f.predicted_volume, f.confidence_low, f.confidence_high, f.team_capacity, f.surplus_deficit, f.day_of_week, existing[0].id],
        );
      } else {
        await executeAndGetId(
          `INSERT INTO agent_capacity_forecasts
           (forecast_date, day_of_week, predicted_volume, confidence_low, confidence_high, team_capacity, surplus_deficit)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [f.forecast_date, f.day_of_week, f.predicted_volume, f.confidence_low, f.confidence_high, f.team_capacity, f.surplus_deficit],
        );
      }
    }

    return { forecasts, staffing_recommendations: recommendations };
  }

  private async backfillActuals(project: string): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const actuals = await query<{ dt: string; cnt: number }>(
      `SELECT CAST(jira_created AS DATE) AS dt, COUNT(*) AS cnt
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= ? AND jira_created < CAST(GETUTCDATE() AS DATE)
       GROUP BY CAST(jira_created AS DATE)`,
      [project, sevenDaysAgo],
    );

    for (const actual of actuals) {
      await execute(
        `UPDATE agent_capacity_forecasts SET actual_volume = ? WHERE forecast_date = ?`,
        [actual.cnt, actual.dt],
      );
    }
  }

  private computeStddev(values: number[], mean: number): number {
    if (values.length < 2) return 0;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  async getForecast(): Promise<DayForecast[]> {
    return query<DayForecast>(
      `SELECT forecast_date, day_of_week, predicted_volume, confidence_low, confidence_high,
              actual_volume, team_capacity, surplus_deficit
       FROM agent_capacity_forecasts
       WHERE forecast_date >= CAST(GETUTCDATE() AS DATE)
       ORDER BY forecast_date`,
    );
  }

  async getHistorical(days: number = 28): Promise<DayForecast[]> {
    return query<DayForecast>(
      `SELECT forecast_date, day_of_week, predicted_volume, confidence_low, confidence_high,
              actual_volume, team_capacity, surplus_deficit
       FROM agent_capacity_forecasts
       WHERE forecast_date >= DATEADD(day, -?, GETUTCDATE())
       ORDER BY forecast_date`,
      [days],
    );
  }

  async getAccuracy(days: number = 30): Promise<{ total: number; avg_error_pct: number | null }> {
    const rows = await query<{ total: number; avg_error: number | null }>(
      `SELECT COUNT(*) AS total,
              AVG(ABS(CAST(predicted_volume - actual_volume AS FLOAT) / NULLIF(actual_volume, 0)) * 100) AS avg_error
       FROM agent_capacity_forecasts
       WHERE actual_volume IS NOT NULL AND forecast_date >= DATEADD(day, -?, GETUTCDATE())`,
      [days],
    );
    return { total: rows[0]?.total ?? 0, avg_error_pct: rows[0]?.avg_error ?? null };
  }
}
