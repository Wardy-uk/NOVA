/**
 * Import development plan markdown files into NOVA MSSQL tables.
 *
 * Usage: node scripts/import-dev-plans.mjs
 *
 * Reads NOVA_SQL_* env vars (or NOVA_SQL_CONNECTION) for database connection.
 * Source files: C:\Users\NickW\Documents\Nicks knowledge base\Documents\HR\*Development Plan.md
 *
 * Tables populated: agent_development_plans, agent_development_goals, agent_training_items
 */
import fs from 'fs';
import path from 'path';
import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const HR_DIR = String.raw`C:\Users\NickW\Documents\Nicks knowledge base\Documents\HR`;

// ── DB connection ──

function buildConfig() {
  const connStr = process.env.NOVA_SQL_CONNECTION;
  if (connStr) {
    const parts = {};
    for (const seg of connStr.split(';')) {
      const idx = seg.indexOf('=');
      if (idx === -1) continue;
      parts[seg.slice(0, idx).trim().toLowerCase()] = seg.slice(idx + 1).trim();
    }
    return {
      server: parts['server'] || parts['data source'],
      database: parts['database'] || parts['initial catalog'],
      user: parts['user id'] || parts['uid'],
      password: parts['password'] || parts['pwd'],
      options: { encrypt: true, trustServerCertificate: true },
      requestTimeout: 30000,
    };
  }
  return {
    server: process.env.NOVA_SQL_SERVER,
    database: process.env.NOVA_SQL_DATABASE,
    user: process.env.NOVA_SQL_USER,
    password: process.env.NOVA_SQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true },
    requestTimeout: 30000,
  };
}

// ── Markdown parser ──

function extractMeta(content) {
  const meta = {};
  const blockquoteLines = [];
  for (const line of content.split('\n')) {
    const m = line.match(/^>\s*(.+)/);
    if (m) blockquoteLines.push(m[1].trim());
    else if (blockquoteLines.length > 0) break;
  }
  for (const line of blockquoteLines) {
    const kv = line.match(/^(.+?):\s*(.+)$/);
    if (kv) meta[kv[1].trim().toLowerCase()] = kv[2].trim();
  }
  return meta;
}

function extractSections(content) {
  const sections = {};
  let currentKey = null;
  let currentLines = [];

  for (const line of content.split('\n')) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      if (currentKey) sections[currentKey] = currentLines.join('\n').trim();
      currentKey = h2[1].trim().toLowerCase();
      currentLines = [];
    } else if (currentKey) {
      currentLines.push(line);
    }
  }
  if (currentKey) sections[currentKey] = currentLines.join('\n').trim();
  return sections;
}

function parseStrengths(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(l => l.length > 0);
}

function parseTrainingItems(text) {
  if (!text) return [];
  return text.split('\n')
    .map(l => l.replace(/^[-*]\s*/, '').trim())
    .filter(l => l.length > 0)
    .map((title, i) => ({ title, sort_order: i }));
}

function parseGoals(text) {
  if (!text) return [];
  const goals = [];
  let current = null;

  for (const line of text.split('\n')) {
    const goalHeader = line.match(/^### (Goal \d+\s*[—–-]\s*)(.+)/);
    if (goalHeader) {
      if (current) goals.push(current);
      current = {
        title: goalHeader[2].trim(),
        description: '',
        measure_description: '',
        target_date: null,
        sort_order: goals.length,
      };
      continue;
    }

    if (!current) continue;

    const whatMatch = line.match(/^\*\*What:\*\*\s*(.+)/);
    const whyMatch = line.match(/^\*\*Why it matters:\*\*\s*(.+)/);
    const measureMatch = line.match(/^\*\*How we'll measure it:\*\*\s*(.+)/);
    const targetMatch = line.match(/^\*\*Target date:\*\*\s*(.+)/);

    if (whatMatch) {
      current.description = whatMatch[1].trim();
    } else if (whyMatch) {
      current.description += '\n\nWhy it matters: ' + whyMatch[1].trim();
    } else if (measureMatch) {
      current.measure_description = measureMatch[1].trim();
    } else if (targetMatch) {
      const raw = targetMatch[1].trim();
      const dateMatch = raw.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
      if (dateMatch) {
        const months = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
        const day = dateMatch[1].padStart(2, '0');
        const month = months[dateMatch[2].toLowerCase()];
        const year = dateMatch[3];
        current.target_date = `${year}-${month}-${day}`;
      } else {
        current.target_date = raw;
      }
    }
  }
  if (current) goals.push(current);

  // Try to infer metric_key and metric_target from measure_description
  for (const g of goals) {
    if (/golden\s*rules.*timeframe/i.test(g.title) || /timeframe/i.test(g.measure_description)) {
      g.metric_key = 'TimeframeAvg';
      g.metric_target = 2.5;
    } else if (/golden\s*rules.*ownership/i.test(g.title)) {
      g.metric_key = 'OwnershipAvg';
      g.metric_target = 2.5;
    } else if (/golden\s*rules.*clarity/i.test(g.title)) {
      g.metric_key = 'ClarityAvg';
      g.metric_target = 2.5;
    } else if (/golden\s*rules/i.test(g.title) && /2\.5\/3/i.test(g.measure_description)) {
      g.metric_key = 'GoldenRulesAvg';
      g.metric_target = 2.5;
    } else if (/qa\s*score/i.test(g.title) || /qa.*score/i.test(g.measure_description)) {
      const targetMatch = g.measure_description.match(/≥?\s*(\d+(?:\.\d+)?)\s*%/);
      if (targetMatch) {
        g.metric_key = 'QAOverallAvg';
        g.metric_target = parseFloat(targetMatch[1]);
      }
    } else if (/resolution\s*(sla|rate|compliance)/i.test(g.title) || /resolution\s*compliance/i.test(g.measure_description)) {
      const targetMatch = g.measure_description.match(/≥?\s*(\d+(?:\.\d+)?)\s*%/);
      if (targetMatch) {
        g.metric_key = 'ResolutionSlaPercent';
        g.metric_target = parseFloat(targetMatch[1]);
      }
    } else if (/aged\s*ticket/i.test(g.title)) {
      const targetMatch = g.measure_description.match(/[≤<]?\s*(\d+(?:\.\d+)?)\s*%/);
      if (targetMatch) {
        g.metric_key = 'AgedTicketPercent';
        g.metric_target = parseFloat(targetMatch[1]);
      }
    } else if (/first\s*reply/i.test(g.title) || /FRT/i.test(g.measure_description)) {
      const targetMatch = g.measure_description.match(/(\d+(?:\.\d+)?)\s*%/);
      if (targetMatch) {
        g.metric_key = 'FrtCompliancePercent';
        g.metric_target = parseFloat(targetMatch[1]);
      }
    } else if (/throughput/i.test(g.title) || /ticket.*volume/i.test(g.measure_description)) {
      const targetMatch = g.measure_description.match(/(\d+)\/day/);
      if (targetMatch) {
        g.metric_key = 'TicketsPerDay';
        g.metric_target = parseFloat(targetMatch[1]);
      }
    }
  }

  return goals;
}

function parseDevPlan(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const agentName = fileName.replace(/ - Development Plan\.md$/, '');

  const meta = extractMeta(content);
  const sections = extractSections(content);

  const roleClarity = sections['role clarity'] || null;
  const strengths = parseStrengths(sections['current strengths']);
  const trainingItems = parseTrainingItems(
    sections['team-wide training this period'] || sections['team-wide training']
  );
  const goals = parseGoals(sections['development goals']);
  const importantContext = sections['important context — dd team direction'] ||
    sections['important context — career progression'] ||
    sections['important context — read before the return 1-1'] ||
    sections['future aspiration (noted — not a current goal)'] ||
    sections['future aspiration (noted — gated on kpi targets)'] ||
    sections['neurodiversity note'] ||
    null;

  return {
    agent_name: agentName,
    plan_period: meta['plan period'] || null,
    role_title: meta['role'] || null,
    function_name: meta['function'] || null,
    role_clarity: roleClarity,
    strengths,
    important_context: importantContext,
    status: (meta['status'] || '').toLowerCase().includes('deferred') ? 'deferred' : 'active',
    goals,
    training_items: trainingItems,
  };
}

// ── Main ──

async function main() {
  const files = fs.readdirSync(HR_DIR)
    .filter(f => f.endsWith(' - Development Plan.md'))
    .map(f => path.join(HR_DIR, f));

  console.log(`Found ${files.length} development plan files\n`);

  const plans = files.map(f => {
    const plan = parseDevPlan(f);
    console.log(`  Parsed: ${plan.agent_name} — ${plan.goals.length} goals, ${plan.training_items.length} training items`);
    return plan;
  });

  const config = buildConfig();
  if (!config.server) {
    console.error('\nNo NOVA_SQL_* env vars set. Cannot connect to database.');
    process.exit(1);
  }

  const pool = await new sql.ConnectionPool(config).connect();
  console.log(`\nConnected to ${config.server}/${config.database}`);

  const tx = pool.transaction();
  await tx.begin();

  try {
    // Clear existing data (re-import safe)
    await tx.request().query('DELETE FROM agent_training_items WHERE plan_id IN (SELECT id FROM agent_development_plans)');
    await tx.request().query('DELETE FROM agent_development_goals WHERE plan_id IN (SELECT id FROM agent_development_plans)');
    await tx.request().query('DELETE FROM agent_development_plans');
    console.log('Cleared existing plan data');

    for (const plan of plans) {
      const planResult = await tx.request()
        .input('agent_name', sql.NVarChar, plan.agent_name)
        .input('plan_period', sql.NVarChar, plan.plan_period)
        .input('role_title', sql.NVarChar, plan.role_title)
        .input('function_name', sql.NVarChar, plan.function_name)
        .input('role_clarity', sql.NVarChar, plan.role_clarity)
        .input('strengths', sql.NVarChar, JSON.stringify(plan.strengths))
        .input('important_context', sql.NVarChar, plan.important_context)
        .input('status', sql.NVarChar, plan.status)
        .query(`
          INSERT INTO agent_development_plans
            (agent_name, plan_period, role_title, function_name, role_clarity, strengths, important_context, status)
          VALUES
            (@agent_name, @plan_period, @role_title, @function_name, @role_clarity, @strengths, @important_context, @status);
          SELECT SCOPE_IDENTITY() AS id;
        `);

      const planId = planResult.recordset[0].id;

      for (const goal of plan.goals) {
        await tx.request()
          .input('plan_id', sql.Int, planId)
          .input('title', sql.NVarChar, goal.title)
          .input('description', sql.NVarChar, goal.description)
          .input('measure_description', sql.NVarChar, goal.measure_description)
          .input('metric_key', sql.NVarChar, goal.metric_key || null)
          .input('metric_target', sql.Float, goal.metric_target ?? null)
          .input('target_date', sql.NVarChar, goal.target_date)
          .input('status', sql.NVarChar, 'not_started')
          .input('sort_order', sql.Int, goal.sort_order)
          .query(`
            INSERT INTO agent_development_goals
              (plan_id, title, description, measure_description, metric_key, metric_target, target_date, status, sort_order)
            VALUES
              (@plan_id, @title, @description, @measure_description, @metric_key, @metric_target, @target_date, @status, @sort_order)
          `);
      }

      for (const item of plan.training_items) {
        await tx.request()
          .input('plan_id', sql.Int, planId)
          .input('title', sql.NVarChar, item.title)
          .input('sort_order', sql.Int, item.sort_order)
          .query(`
            INSERT INTO agent_training_items (plan_id, title, sort_order)
            VALUES (@plan_id, @title, @sort_order)
          `);
      }

      console.log(`  Inserted: ${plan.agent_name} (plan #${planId}, ${plan.goals.length} goals, ${plan.training_items.length} training)`);
    }

    await tx.commit();
    console.log(`\nDone — ${plans.length} plans imported.`);
  } catch (err) {
    await tx.rollback();
    console.error('Import failed, transaction rolled back:', err);
    process.exit(1);
  } finally {
    await pool.close();
  }
}

main();
