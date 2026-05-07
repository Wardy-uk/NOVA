import sql from 'mssql';
import nodemailer from 'nodemailer';
import dns from 'dns';
import { promisify } from 'util';
import type { SettingsQueries } from '../db/settings-store.js';
import type { PipelineMonitor, PipelineTarget } from './pipeline-monitor.js';
import { tableSuffix } from './pipeline-monitor.js';

const resolveMx = promisify(dns.resolveMx);

let pool: sql.ConnectionPool | null = null;

async function getKpiPool(settings: SettingsQueries): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;

  const all = settings.getAll();
  const server = all.kpi_sql_server;
  const database = all.kpi_sql_database;
  const user = all.kpi_sql_user;
  const password = all.kpi_sql_password;

  if (!server || !database || !user || !password) {
    throw new Error('KPI SQL Server not configured');
  }

  pool = await new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  }).connect();

  return pool;
}

export class QaDigest {
  constructor(
    private settings: SettingsQueries,
    private monitor?: PipelineMonitor,
  ) {}

  private get target(): PipelineTarget {
    const val = this.settings.get('qa_pipeline_target');
    return val === 'live' ? 'live' : 'uat';
  }

  private get s(): string {
    return tableSuffix(this.target);
  }

  async sendDailyDigest(): Promise<void> {
    const started = new Date();
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;

      const statsResult = await p.request().query(`
        SELECT
          COUNT(*) AS totalToday,
          SUM(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN 1 ELSE 0 END) AS fullQA,
          SUM(CASE WHEN qaType = 'excluded' THEN 1 ELSE 0 END) AS excluded,
          SUM(CASE WHEN grade = 'Green' THEN 1 ELSE 0 END) AS green,
          SUM(CASE WHEN grade = 'Amber' THEN 1 ELSE 0 END) AS amber,
          SUM(CASE WHEN grade = 'Red' THEN 1 ELSE 0 END) AS red,
          SUM(CASE WHEN isConcerning = 1 THEN 1 ELSE 0 END) AS concerning,
          AVG(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN overallScore END) AS avgScore
        FROM dbo.jira_qa_results${s}
        WHERE CAST(CreatedAt AS DATE) = CAST(GETUTCDATE() AS DATE)
      `);
      const stats = statsResult.recordset[0] ?? {};

      const agentResult = await p.request().query(`
        SELECT
          assigneeName,
          COUNT(*) AS total,
          SUM(CASE WHEN grade = 'Green' THEN 1 ELSE 0 END) AS green,
          SUM(CASE WHEN grade = 'Amber' THEN 1 ELSE 0 END) AS amber,
          SUM(CASE WHEN grade = 'Red' THEN 1 ELSE 0 END) AS red,
          AVG(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN overallScore END) AS avgScore
        FROM dbo.jira_qa_results${s}
        WHERE CAST(CreatedAt AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND qaType IN ('resolved', 'ticket_full')
        GROUP BY assigneeName
        ORDER BY avgScore DESC
      `);

      const concerningResult = await p.request().query(`
        SELECT TOP 20
          issueKey, assigneeName, grade, overallScore, issues, coachingPoints
        FROM dbo.jira_qa_results${s}
        WHERE CAST(CreatedAt AS DATE) = CAST(GETUTCDATE() AS DATE)
          AND isConcerning = 1
        ORDER BY overallScore ASC
      `);

      const today = new Date().toISOString().slice(0, 10);
      const html = this.buildDailyHtml(today, stats, agentResult.recordset, concerningResult.recordset);

      await this.sendEmail(`QA Daily Digest — ${today}`, html);

      await this.monitor?.logRun({
        pipeline_name: 'qa-daily-digest', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: stats.totalToday ?? 0, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
      console.log(`[qa-digest] Daily digest sent for ${today}`);
    } catch (err) {
      console.error('[qa-digest] Daily failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'qa-daily-digest', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: 0, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
    }
  }

  async sendWeeklyDigest(): Promise<void> {
    const started = new Date();
    try {
      const p = await getKpiPool(this.settings);
      const s = this.s;

      const thisWeek = await p.request().query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN 1 ELSE 0 END) AS fullQA,
          SUM(CASE WHEN grade = 'Green' THEN 1 ELSE 0 END) AS green,
          SUM(CASE WHEN grade = 'Amber' THEN 1 ELSE 0 END) AS amber,
          SUM(CASE WHEN grade = 'Red' THEN 1 ELSE 0 END) AS red,
          SUM(CASE WHEN isConcerning = 1 THEN 1 ELSE 0 END) AS concerning,
          AVG(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN overallScore END) AS avgScore
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -7, GETUTCDATE())
      `);

      const lastWeek = await p.request().query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN 1 ELSE 0 END) AS fullQA,
          AVG(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN overallScore END) AS avgScore,
          SUM(CASE WHEN isConcerning = 1 THEN 1 ELSE 0 END) AS concerning
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -14, GETUTCDATE()) AND CreatedAt < DATEADD(day, -7, GETUTCDATE())
      `);

      const dailyTrend = await p.request().query(`
        SELECT
          CAST(CreatedAt AS DATE) AS day,
          AVG(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN overallScore END) AS avgScore,
          COUNT(*) AS volume
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -7, GETUTCDATE())
        GROUP BY CAST(CreatedAt AS DATE)
        ORDER BY day
      `);

      const agentResult = await p.request().query(`
        SELECT
          assigneeName,
          COUNT(*) AS total,
          SUM(CASE WHEN grade = 'Green' THEN 1 ELSE 0 END) AS green,
          SUM(CASE WHEN grade = 'Amber' THEN 1 ELSE 0 END) AS amber,
          SUM(CASE WHEN grade = 'Red' THEN 1 ELSE 0 END) AS red,
          AVG(CASE WHEN qaType IN ('resolved', 'ticket_full') THEN overallScore END) AS avgScore
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -7, GETUTCDATE())
          AND qaType IN ('resolved', 'ticket_full')
        GROUP BY assigneeName
        ORDER BY avgScore DESC
      `);

      const flaggedResult = await p.request().query(`
        SELECT TOP 10
          issueKey, assigneeName, grade, overallScore, issues, coachingPoints
        FROM dbo.jira_qa_results${s}
        WHERE CreatedAt >= DATEADD(day, -7, GETUTCDATE())
          AND isConcerning = 1
        ORDER BY overallScore ASC
      `);

      const tw = thisWeek.recordset[0] ?? {};
      const lw = lastWeek.recordset[0] ?? {};
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

      const html = this.buildWeeklyHtml(
        startDate, endDate, tw, lw,
        dailyTrend.recordset, agentResult.recordset, flaggedResult.recordset,
      );

      await this.sendEmail(`QA Weekly Digest — ${startDate} to ${endDate}`, html);

      await this.monitor?.logRun({
        pipeline_name: 'qa-weekly-digest', started_at: started, completed_at: new Date(),
        status: 'success', rows_affected: tw.total ?? 0, error_message: null,
        duration_ms: Date.now() - started.getTime(),
      });
      console.log(`[qa-digest] Weekly digest sent for ${startDate} to ${endDate}`);
    } catch (err) {
      console.error('[qa-digest] Weekly failed:', err instanceof Error ? err.message : err);
      await this.monitor?.logRun({
        pipeline_name: 'qa-weekly-digest', started_at: started, completed_at: new Date(),
        status: 'error', rows_affected: 0, error_message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - started.getTime(),
      });
    }
  }

  private async sendEmail(subject: string, html: string): Promise<void> {
    const all = this.settings.getAll();
    const from = all.smtp_from?.trim() || 'nova@nurtur.tech';
    const to = all.qa_digest_recipients?.trim() || 'nickw@nurtur.tech';
    const relayHost = all.smtp_host?.trim();

    let host: string;
    let port: number;
    let auth: { user: string; pass: string } | undefined;
    let secure: boolean;

    if (relayHost) {
      host = relayHost;
      port = parseInt(all.smtp_port || '587', 10);
      secure = port === 465;
      auth = all.smtp_user?.trim() ? { user: all.smtp_user, pass: all.smtp_pass } : undefined;
    } else {
      const domain = to.split(',')[0].trim().split('@')[1];
      const records = await resolveMx(domain);
      records.sort((a, b) => a.priority - b.priority);
      host = records[0]?.exchange ?? domain;
      port = 25;
      secure = false;
      auth = undefined;
    }

    const transport = nodemailer.createTransport({
      host, port, secure, auth,
      tls: { rejectUnauthorized: false },
      name: from.split('@')[1] || 'localhost',
    });

    const recipients = to.split(',').map(r => r.trim()).filter(Boolean);
    for (const recipient of recipients) {
      await transport.sendMail({ from, to: recipient, subject, html, text: subject });
    }
  }

  private buildDailyHtml(
    date: string,
    stats: any,
    agents: any[],
    concerning: any[],
  ): string {
    const total = stats.totalToday ?? 0;
    const fullQA = stats.fullQA ?? 0;
    const avgScore = stats.avgScore != null ? (stats.avgScore as number).toFixed(1) : 'N/A';
    const concernCount = stats.concerning ?? 0;
    const green = stats.green ?? 0;
    const amber = stats.amber ?? 0;
    const red = stats.red ?? 0;
    const gradeTotal = green + amber + red;

    const greenPct = gradeTotal > 0 ? Math.round(green / gradeTotal * 100) : 0;
    const amberPct = gradeTotal > 0 ? Math.round(amber / gradeTotal * 100) : 0;
    const redPct = gradeTotal > 0 ? Math.round(red / gradeTotal * 100) : 0;

    const flaggedRows = concerning.map(r => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #333">${esc(r.issueKey)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333">${esc(r.assigneeName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;color:${gradeColour(r.grade)}">${esc(r.grade)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333">${r.overallScore?.toFixed(1) ?? '-'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;font-size:12px">${esc(r.issues ?? '')}</td>
      </tr>
    `).join('');

    const agentRows = agents.map(a => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #333">${esc(a.assigneeName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center">${a.total}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;color:#4ade80">${a.green}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;color:#fbbf24">${a.amber}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center;color:#f87171">${a.red}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #333;text-align:center">${a.avgScore?.toFixed(1) ?? '-'}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#111;color:#e5e7eb;font-family:Arial,sans-serif">
      <div style="max-width:700px;margin:0 auto;background:#1a1a2e">
        <div style="background:#16213e;padding:20px 24px;border-bottom:3px solid #0ea5e9">
          <h1 style="margin:0;font-size:22px;color:#e5e7eb">QA Daily Digest</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:14px">${date}</p>
        </div>
        <div style="padding:20px 24px">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
            ${kpiCard('Processed', String(total), '#0ea5e9')}
            ${kpiCard('Full QA', String(fullQA), '#8b5cf6')}
            ${kpiCard('Avg Score', avgScore, '#4ade80')}
            ${kpiCard('Concerning', String(concernCount), concernCount > 0 ? '#f87171' : '#4ade80')}
          </div>
          <div style="margin-bottom:20px">
            <p style="margin:0 0 6px;font-size:13px;color:#94a3b8">Grade Distribution</p>
            <div style="display:flex;height:24px;border-radius:4px;overflow:hidden">
              <div style="width:${greenPct}%;background:#4ade80"></div>
              <div style="width:${amberPct}%;background:#fbbf24"></div>
              <div style="width:${redPct}%;background:#f87171"></div>
            </div>
            <p style="margin:4px 0 0;font-size:12px;color:#94a3b8">
              Green ${green} (${greenPct}%) · Amber ${amber} (${amberPct}%) · Red ${red} (${redPct}%)
            </p>
          </div>
          ${concerning.length > 0 ? `
          <h2 style="font-size:16px;color:#f87171;margin:0 0 8px">Flagged Tickets</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#e5e7eb">
            <tr style="background:#16213e"><th style="padding:6px 10px;text-align:left">Key</th><th style="padding:6px 10px;text-align:left">Agent</th><th style="padding:6px 10px;text-align:left">Grade</th><th style="padding:6px 10px;text-align:left">Score</th><th style="padding:6px 10px;text-align:left">Issues</th></tr>
            ${flaggedRows}
          </table>` : ''}
          ${agents.length > 0 ? `
          <h2 style="font-size:16px;color:#e5e7eb;margin:20px 0 8px">Agent Breakdown</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#e5e7eb">
            <tr style="background:#16213e"><th style="padding:6px 10px;text-align:left">Agent</th><th style="padding:6px 10px;text-align:center">Total</th><th style="padding:6px 10px;text-align:center">G</th><th style="padding:6px 10px;text-align:center">A</th><th style="padding:6px 10px;text-align:center">R</th><th style="padding:6px 10px;text-align:center">Avg</th></tr>
            ${agentRows}
          </table>` : ''}
        </div>
        <div style="padding:12px 24px;background:#16213e;border-top:1px solid #333;text-align:center;font-size:11px;color:#64748b">
          QA System V5 &middot; Nurtur Support
        </div>
      </div>
    </body></html>`;
  }

  private buildWeeklyHtml(
    startDate: string,
    endDate: string,
    tw: any,
    lw: any,
    dailyTrend: any[],
    agents: any[],
    flagged: any[],
  ): string {
    const twAvg = tw.avgScore != null ? (tw.avgScore as number).toFixed(1) : 'N/A';
    const lwAvg = lw.avgScore != null ? (lw.avgScore as number).toFixed(1) : 'N/A';
    const scoreDelta = (tw.avgScore != null && lw.avgScore != null)
      ? ((tw.avgScore - lw.avgScore) as number).toFixed(1) : null;
    const scoreArrow = scoreDelta ? (parseFloat(scoreDelta) >= 0 ? `<span style="color:#4ade80">&#9650; ${scoreDelta}</span>` : `<span style="color:#f87171">&#9660; ${scoreDelta}</span>`) : '';

    const totalDelta = (tw.total && lw.total) ? tw.total - lw.total : null;
    const totalArrow = totalDelta != null ? (totalDelta >= 0 ? `<span style="color:#94a3b8">&#9650; ${totalDelta}</span>` : `<span style="color:#94a3b8">&#9660; ${totalDelta}</span>`) : '';

    const green = tw.green ?? 0;
    const amber = tw.amber ?? 0;
    const red = tw.red ?? 0;
    const gradeTotal = green + amber + red;
    const greenPct = gradeTotal > 0 ? Math.round(green / gradeTotal * 100) : 0;
    const amberPct = gradeTotal > 0 ? Math.round(amber / gradeTotal * 100) : 0;
    const redPct = gradeTotal > 0 ? Math.round(red / gradeTotal * 100) : 0;

    const trendRows = dailyTrend.map(d => {
      const dayStr = d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day).slice(0, 10);
      const avg = d.avgScore != null ? (d.avgScore as number).toFixed(1) : '-';
      const barWidth = d.avgScore != null ? Math.round(d.avgScore / 10 * 100) : 0;
      return `<tr>
        <td style="padding:4px 10px;border-bottom:1px solid #333;font-size:12px">${dayStr}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center">${avg}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333"><div style="height:14px;width:${barWidth}%;background:#0ea5e9;border-radius:2px"></div></td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center">${d.volume}</td>
      </tr>`;
    }).join('');

    const agentRows = agents.map(a => {
      const greenPctAgent = a.total > 0 ? Math.round(a.green / a.total * 100) : 0;
      return `<tr>
        <td style="padding:4px 10px;border-bottom:1px solid #333">${esc(a.assigneeName)}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center">${a.total}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center;color:#4ade80">${a.green}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center;color:#fbbf24">${a.amber}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center;color:#f87171">${a.red}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center">${a.avgScore?.toFixed(1) ?? '-'}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;text-align:center">${greenPctAgent}%</td>
      </tr>`;
    }).join('');

    const flaggedRows = flagged.map(r => `
      <tr>
        <td style="padding:4px 10px;border-bottom:1px solid #333">${esc(r.issueKey)}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333">${esc(r.assigneeName)}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;color:${gradeColour(r.grade)}">${esc(r.grade)}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333">${r.overallScore?.toFixed(1) ?? '-'}</td>
        <td style="padding:4px 10px;border-bottom:1px solid #333;font-size:12px">${esc(r.issues ?? '')}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#111;color:#e5e7eb;font-family:Arial,sans-serif">
      <div style="max-width:700px;margin:0 auto;background:#1a1a2e">
        <div style="background:#16213e;padding:20px 24px;border-bottom:3px solid #8b5cf6">
          <h1 style="margin:0;font-size:22px;color:#e5e7eb">QA Weekly Digest</h1>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:14px">${startDate} to ${endDate}</p>
        </div>
        <div style="padding:20px 24px">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
            ${kpiCard('Total', `${tw.total ?? 0}`, '#0ea5e9', totalArrow)}
            ${kpiCard('Full QA', `${tw.fullQA ?? 0}`, '#8b5cf6')}
            ${kpiCard('Avg Score', twAvg, '#4ade80', scoreArrow)}
            ${kpiCard('Concerning', `${tw.concerning ?? 0}`, (tw.concerning ?? 0) > 0 ? '#f87171' : '#4ade80')}
          </div>
          <p style="margin:0 0 4px;font-size:12px;color:#64748b">Previous week: ${lw.total ?? 0} tickets, avg ${lwAvg}</p>
          <div style="margin-bottom:20px">
            <p style="margin:12px 0 6px;font-size:13px;color:#94a3b8">Grade Distribution</p>
            <div style="display:flex;height:24px;border-radius:4px;overflow:hidden">
              <div style="width:${greenPct}%;background:#4ade80"></div>
              <div style="width:${amberPct}%;background:#fbbf24"></div>
              <div style="width:${redPct}%;background:#f87171"></div>
            </div>
            <p style="margin:4px 0 0;font-size:12px;color:#94a3b8">
              Green ${green} (${greenPct}%) · Amber ${amber} (${amberPct}%) · Red ${red} (${redPct}%)
            </p>
          </div>
          ${dailyTrend.length > 0 ? `
          <h2 style="font-size:16px;color:#e5e7eb;margin:20px 0 8px">Daily Score Trend</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#e5e7eb">
            <tr style="background:#16213e"><th style="padding:4px 10px;text-align:left">Day</th><th style="padding:4px 10px;text-align:center">Avg</th><th style="padding:4px 10px;text-align:left">Score</th><th style="padding:4px 10px;text-align:center">Vol</th></tr>
            ${trendRows}
          </table>` : ''}
          ${agents.length > 0 ? `
          <h2 style="font-size:16px;color:#e5e7eb;margin:20px 0 8px">Agent Breakdown</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#e5e7eb">
            <tr style="background:#16213e"><th style="padding:4px 10px;text-align:left">Agent</th><th style="padding:4px 10px;text-align:center">Total</th><th style="padding:4px 10px;text-align:center">G</th><th style="padding:4px 10px;text-align:center">A</th><th style="padding:4px 10px;text-align:center">R</th><th style="padding:4px 10px;text-align:center">Avg</th><th style="padding:4px 10px;text-align:center">G%</th></tr>
            ${agentRows}
          </table>` : ''}
          ${flagged.length > 0 ? `
          <h2 style="font-size:16px;color:#f87171;margin:20px 0 8px">Flagged Tickets</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#e5e7eb">
            <tr style="background:#16213e"><th style="padding:4px 10px;text-align:left">Key</th><th style="padding:4px 10px;text-align:left">Agent</th><th style="padding:4px 10px;text-align:left">Grade</th><th style="padding:4px 10px;text-align:left">Score</th><th style="padding:4px 10px;text-align:left">Issues</th></tr>
            ${flaggedRows}
          </table>` : ''}
        </div>
        <div style="padding:12px 24px;background:#16213e;border-top:1px solid #333;text-align:center;font-size:11px;color:#64748b">
          QA System V5 &middot; Nurtur Support
        </div>
      </div>
    </body></html>`;
  }
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function gradeColour(grade: string): string {
  switch (grade) {
    case 'Green': return '#4ade80';
    case 'Amber': return '#fbbf24';
    case 'Red': return '#f87171';
    default: return '#94a3b8';
  }
}

function kpiCard(label: string, value: string, colour: string, subtext?: string): string {
  return `<div style="flex:1;min-width:140px;background:#16213e;border-radius:8px;padding:14px 16px;border-left:4px solid ${colour}">
    <div style="font-size:12px;color:#94a3b8;margin-bottom:4px">${label}</div>
    <div style="font-size:26px;font-weight:bold;color:${colour}">${value}</div>
    ${subtext ? `<div style="font-size:11px;margin-top:2px">${subtext}</div>` : ''}
  </div>`;
}
