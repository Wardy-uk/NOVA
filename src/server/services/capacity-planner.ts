import type { SettingsQueries } from '../db/settings-store.js';
import { query, execute, executeAndGetId } from './database.js';
import { getKpiPool } from './kpi-pipeline.js';
import { getAllInRange } from './kpi-agent/store.js';

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

interface CapacityBenchmark {
  byDow: Map<number, number>;
  defaultCapacity: number;
  sampleDaysByDow: Map<number, number>;
  source: 'kpi_6_week_average' | 'fallback';
}

export class CapacityPlanner {
  constructor(private settings: SettingsQueries) {}

  async generateForecast(): Promise<CapacityForecastResult> {
    const project = 'NT';

    // Backfill recent actuals first so the forecast trains on stable captured history.
    // If KPI history is unavailable, do not contaminate stored actuals with weak cache counts.
    await this.backfillActuals(project);

    const dailyCounts = await this.loadHistoricalDailyCounts(project);

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

    const capacityBenchmark = await this.loadCapacityBenchmark(activeNames, activeAgents.length);
    console.log(
      `[capacity] Team capacity benchmark source=${capacityBenchmark.source} default=${capacityBenchmark.defaultCapacity} activeAgents=${activeAgents.length}`,
    );

    // Generate 14-day forecast
    const forecasts: DayForecast[] = [];
    const recommendations: string[] = [];
    const today = new Date();

    for (let i = 0; i < 14; i++) {
      const forecastDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
      const dow = forecastDate.getDay() + 1; // SQL Server DATEPART(WEEKDAY) is 1-based, Sunday=1
      const dateStr = forecastDate.toISOString().split('T')[0];

      const stats = dowStats.get(dow);
      const avg = stats ? stats.sum / stats.count : 0;
      const stddev = stats ? this.computeStddev(stats.values, avg) : 0;

      const predicted = Math.round(avg);
      const confidenceLow = Math.max(Math.round(avg * 0.5), Math.round(avg - stddev));
      const confidenceHigh = Math.round(avg + stddev);

      const isWeekend = dow === 1 || dow === 7;
      const weekdayCapacity = capacityBenchmark.byDow.get(dow) ?? capacityBenchmark.defaultCapacity;
      const capacityForDay = isWeekend ? 0 : weekdayCapacity;
      const surplus = capacityForDay - predicted;

      forecasts.push({
        forecast_date: dateStr,
        day_of_week: dow,
        predicted_volume: predicted,
        confidence_low: confidenceLow,
        confidence_high: confidenceHigh,
        actual_volume: null,
        team_capacity: capacityForDay,
        surplus_deficit: surplus,
      });

      // Flag days where predicted exceeds 80% capacity
      if (!isWeekend && capacityForDay > 0 && predicted > capacityForDay * 0.8) {
        const dayName = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
        recommendations.push(
          `${dayName} ${dateStr}: predicted ${predicted} tickets vs capacity ${capacityForDay} (${((predicted / capacityForDay) * 100).toFixed(0)}% utilisation)`,
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
    const twentyEightDaysAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const actuals = await this.loadKpiActualCounts(twentyEightDaysAgo);
    if (actuals.length === 0) {
      console.warn('[capacity] KPI actual history unavailable — skipping cache-based actual backfill to avoid corrupting forecast history');
      return;
    }

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

  private async loadCapacityBenchmark(activeNames: Set<string>, activeAgentCount: number): Promise<CapacityBenchmark> {
    const fallbackCount = activeAgentCount || parseInt(this.settings.get('capacity_default_agents') ?? '5', 10);
    const fallbackRate = parseInt(this.settings.get('agent_max_capacity') ?? '12', 10);
    const fallbackCapacity = fallbackCount * fallbackRate;

    if (activeNames.size === 0) {
      return {
        byDow: new Map(),
        defaultCapacity: fallbackCapacity,
        sampleDaysByDow: new Map(),
        source: 'fallback',
      };
    }

    try {
      const kpiPool = await getKpiPool(this.settings);
      // Rebuild store, not dbo.jira_agent_kpi_daily.
      const capFrom = new Date(); capFrom.setUTCDate(capFrom.getUTCDate() - 42);
      const capKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
      const rows = (await getAllInRange(capKey(capFrom), capKey(new Date())))
        .filter(r => r.solvedToday != null && r.solvedToday >= 0)
        .map(r => ({
          dt: r.date,
          dow: ((new Date(`${r.date}T00:00:00Z`).getUTCDay() + 1)),  // SQL DATEPART(WEEKDAY): Sunday = 1
          AgentName: r.agentName,
          solved: r.solvedToday,
        }));

      const totalsByDate = new Map<string, { dow: number; total: number }>();
      for (const row of rows as Array<{ dt: string; dow: number; AgentName: string | null; solved: number | null }>) {
        const agentName = row.AgentName?.trim().toLowerCase();
        if (!agentName || !activeNames.has(agentName)) continue;
        const dt = String(row.dt).slice(0, 10);
        const solved = Number(row.solved ?? 0);
        const existing = totalsByDate.get(dt) ?? { dow: row.dow, total: 0 };
        existing.total += solved;
        totalsByDate.set(dt, existing);
      }

      const grouped = new Map<number, number[]>();
      for (const row of totalsByDate.values()) {
        if (!Number.isFinite(row.total) || row.total <= 0) continue;
        const values = grouped.get(row.dow) ?? [];
        values.push(row.total);
        grouped.set(row.dow, values);
      }

      const byDow = new Map<number, number>();
      const sampleDaysByDow = new Map<number, number>();
      const allWeekdayValues: number[] = [];
      for (const dow of [2, 3, 4, 5, 6]) {
        const values = grouped.get(dow) ?? [];
        const cleaned = this.filterCapacityOutliers(values);
        if (cleaned.length === 0) continue;
        const avg = cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length;
        byDow.set(dow, Math.round(avg));
        sampleDaysByDow.set(dow, cleaned.length);
        allWeekdayValues.push(...cleaned);
      }

      if (allWeekdayValues.length > 0) {
        const defaultCapacity = Math.round(
          allWeekdayValues.reduce((sum, value) => sum + value, 0) / allWeekdayValues.length,
        );
        return {
          byDow,
          defaultCapacity,
          sampleDaysByDow,
          source: 'kpi_6_week_average',
        };
      }
    } catch (kpiErr) {
      console.warn('[capacity] KPI pool unavailable for agent throughput benchmark, using fallback:', kpiErr instanceof Error ? kpiErr.message : kpiErr);
    }

    return {
      byDow: new Map(),
      defaultCapacity: fallbackCapacity,
      sampleDaysByDow: new Map(),
      source: 'fallback',
    };
  }

  private async loadHistoricalDailyCounts(project: string): Promise<Array<{ dt: string; cnt: number; dow: number }>> {
    const kpiHistory = await this.loadKpiActualCounts();
    if (kpiHistory.length >= 10) {
      const cleaned = this.filterAnomalousCounts(kpiHistory);
      console.log(`[capacity] Training forecast from KPI New Tickets Today history (${cleaned.length} daily rows)`);
      return cleaned;
    }

    const forecastHistory = await query<{ dt: string; cnt: number; dow: number }>(
      `SELECT CAST(forecast_date AS DATE) AS dt,
              CAST(actual_volume AS INT) AS cnt,
              day_of_week AS dow
       FROM agent_capacity_forecasts
       WHERE actual_volume IS NOT NULL
         AND forecast_date >= DATEADD(day, -90, GETUTCDATE())
       ORDER BY forecast_date`,
    );

    const cleanedForecastHistory = this.filterAnomalousCounts(forecastHistory);
    const distinctDays = new Set(cleanedForecastHistory.map(r => String(r.dt).slice(0, 10)));
    if (distinctDays.size >= 10) {
      console.log(`[capacity] Training forecast from ${distinctDays.size} cleaned historical forecast actuals`);
      return cleanedForecastHistory;
    }

    const cacheHistory = await query<{ dt: string; cnt: number; dow: number }>(
      `SELECT CAST(jira_created AS DATE) AS dt, COUNT(*) AS cnt, DATEPART(WEEKDAY, jira_created) AS dow
       FROM jira_issue_cache
       WHERE project_key = ? AND jira_created >= DATEADD(day, -90, GETUTCDATE())
       GROUP BY CAST(jira_created AS DATE), DATEPART(WEEKDAY, jira_created)
       ORDER BY dt`,
      [project],
    );
    const cleanedCacheHistory = this.filterAnomalousCounts(cacheHistory);
    console.log(`[capacity] Training forecast from live jira_issue_cache fallback (${cleanedCacheHistory.length} daily rows)`);
    return cleanedCacheHistory;
  }

  private async loadKpiActualCounts(sinceDate?: string): Promise<Array<{ dt: string; cnt: number; dow: number }>> {
    try {
      const kpiPool = await getKpiPool(this.settings);
      const request = kpiPool.request();
      if (sinceDate) request.input('sinceDate', sinceDate);
      const result = await request.query(`
        WITH ranked AS (
          SELECT
            CAST(CreatedAt AS DATE) AS dt,
            CAST([count] AS INT) AS cnt,
            DATEPART(WEEKDAY, CAST(CreatedAt AS DATE)) AS dow,
            ROW_NUMBER() OVER (
              PARTITION BY CAST(CreatedAt AS DATE)
              ORDER BY CASE WHEN kpi = 'New Tickets Today' THEN 0 ELSE 1 END, CreatedAt DESC
            ) AS rn
          FROM dbo.jira_kpi_daily
          WHERE kpi IN ('New Tickets Today', 'Created Today')
            ${sinceDate ? 'AND CAST(CreatedAt AS DATE) >= @sinceDate' : 'AND CreatedAt >= DATEADD(day, -90, GETUTCDATE())'}
        )
        SELECT dt, cnt, dow
        FROM ranked
        WHERE rn = 1
        ORDER BY dt
      `);
      return result.recordset as Array<{ dt: string; cnt: number; dow: number }>;
    } catch (err) {
      console.warn('[capacity] KPI ticket history unavailable:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private filterAnomalousCounts(rows: Array<{ dt: string; cnt: number; dow: number }>): Array<{ dt: string; cnt: number; dow: number }> {
    const byDow = new Map<number, number[]>();
    for (const row of rows) {
      if (!Number.isFinite(row.cnt) || row.cnt <= 0) continue;
      const values = byDow.get(row.dow) ?? [];
      values.push(row.cnt);
      byDow.set(row.dow, values);
    }

    return rows.filter(row => {
      const values = byDow.get(row.dow) ?? [];
      if (values.length < 4) return row.cnt > 0;
      const median = this.computeMedian(values);
      const lowFloor = Math.max(1, median * 0.6);
      const highCeiling = median * 1.75;
      return row.cnt >= lowFloor && row.cnt <= highCeiling;
    });
  }

  private filterCapacityOutliers(values: number[]): number[] {
    if (values.length < 4) return values.filter(v => Number.isFinite(v) && v > 0);
    const median = this.computeMedian(values);
    const lowFloor = Math.max(1, median * 0.5);
    const highCeiling = median * 1.5;
    return values.filter(v => v >= lowFloor && v <= highCeiling);
  }

  private computeMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
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
