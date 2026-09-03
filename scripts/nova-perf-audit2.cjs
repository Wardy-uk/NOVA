const sql = require('mssql');

const config = {
  server: 'bym-asqlep01.database.windows.net',
  database: 'NOVA',
  user: 'azureadmin',
  password: 'Bl45t3r!',
  options: { encrypt: true, trustServerCertificate: false },
  requestTimeout: 120000,
  connectionTimeout: 30000,
};

const queries = [
  ['A1', `SELECT action, COUNT(*) as count, AVG(confidence) as avg_confidence, MIN(confidence) as min_conf, MAX(confidence) as max_conf, SUM(CASE WHEN shadow_mode = 1 THEN 1 ELSE 0 END) as shadow, SUM(CASE WHEN shadow_mode = 0 THEN 1 ELSE 0 END) as live FROM agent_decisions WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY action ORDER BY count DESC`],
  ['A2', `SELECT action, COUNT(*) as count, AVG(confidence) as avg_confidence FROM agent_decisions GROUP BY action ORDER BY count DESC`],
  ['A3', `SELECT approval_status, COUNT(*) as count FROM agent_decisions WHERE approval_required = 1 AND created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY approval_status`],
  ['A4', `SELECT action, approval_status, COUNT(*) as count FROM agent_decisions WHERE approval_status IS NOT NULL AND approval_status NOT IN ('pending', '') GROUP BY action, approval_status ORDER BY action, approval_status`],
  ['A5', `SELECT CASE WHEN confidence >= 0.9 THEN '90-100%' WHEN confidence >= 0.8 THEN '80-89%' WHEN confidence >= 0.7 THEN '70-79%' WHEN confidence >= 0.6 THEN '60-69%' WHEN confidence > 0 THEN 'Below 60%' ELSE 'Zero/null' END as band, COUNT(*) as count FROM agent_decisions WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY CASE WHEN confidence >= 0.9 THEN '90-100%' WHEN confidence >= 0.8 THEN '80-89%' WHEN confidence >= 0.7 THEN '70-79%' WHEN confidence >= 0.6 THEN '60-69%' WHEN confidence > 0 THEN 'Below 60%' ELSE 'Zero/null' END ORDER BY band`],
  ['A6', `SELECT CAST(created_at AS DATE) as day, COUNT(*) as decisions, SUM(CASE WHEN shadow_mode = 1 THEN 1 ELSE 0 END) as shadow, SUM(CASE WHEN shadow_mode = 0 THEN 1 ELSE 0 END) as live FROM agent_decisions WHERE created_at > DATEADD(day, -14, GETUTCDATE()) GROUP BY CAST(created_at AS DATE) ORDER BY day`],
  ['A7', `SELECT TOP 20 ticket_id, action, confidence, approval_status, LEFT(CAST(reasoning AS VARCHAR(MAX)), 200) as reasoning_preview, created_at FROM agent_decisions WHERE approval_status = 'declined' ORDER BY created_at DESC`],
  ['B1', `SELECT call_type, COUNT(*) as calls, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success, ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_pct, AVG(latency_ms) as avg_latency, MAX(latency_ms) as max_latency, SUM(estimated_cost) as total_cost FROM agent_llm_calls WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY call_type ORDER BY calls DESC`],
  ['B2', `SELECT call_type, COUNT(*) as calls, ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_pct, SUM(estimated_cost) as total_cost FROM agent_llm_calls GROUP BY call_type ORDER BY calls DESC`],
  ['B3', `SELECT provider, model, COUNT(*) as calls, ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_pct, AVG(latency_ms) as avg_latency, SUM(estimated_cost) as total_cost FROM agent_llm_calls WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY provider, model ORDER BY calls DESC`],
  ['B4', `SELECT provider, model, COUNT(*) as calls, ROUND(100.0 * SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) as success_pct, SUM(estimated_cost) as total_cost FROM agent_llm_calls GROUP BY provider, model ORDER BY calls DESC`],
  ['B5a', `SELECT call_type, provider, model, COUNT(*) as failures FROM agent_llm_calls WHERE success = 0 AND created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY call_type, provider, model ORDER BY failures DESC`],
  ['B5b', `SELECT TOP 15 call_type, provider, model, LEFT(CAST(error AS VARCHAR(MAX)), 200) as error_preview, created_at FROM agent_llm_calls WHERE success = 0 AND created_at > DATEADD(day, -7, GETUTCDATE()) ORDER BY created_at DESC`],
  ['B6', `SELECT DATEPART(hour, created_at) as hour_utc, COUNT(*) as calls FROM agent_llm_calls WHERE created_at > DATEADD(day, -3, GETUTCDATE()) GROUP BY DATEPART(hour, created_at) ORDER BY hour_utc`],
  ['B7', `SELECT call_type, MIN(latency_ms) as p0, AVG(latency_ms) as avg_ms, MAX(latency_ms) as max_ms FROM agent_llm_calls WHERE success = 1 AND created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY call_type ORDER BY call_type`],
  ['C1', `SELECT SUM(estimated_cost) as total_cost_7d, SUM(estimated_cost) / 7.0 * 30 as projected_monthly FROM agent_llm_calls WHERE created_at > DATEADD(day, -7, GETUTCDATE())`],
  ['C2', `SELECT CAST(created_at AS DATE) as day, SUM(estimated_cost) as daily_cost, COUNT(*) as calls FROM agent_llm_calls WHERE created_at > DATEADD(day, -14, GETUTCDATE()) GROUP BY CAST(created_at AS DATE) ORDER BY day`],
  ['C3', `SELECT AVG(sub.decision_cost) as avg_cost_per_decision, MIN(sub.decision_cost) as min_cost, MAX(sub.decision_cost) as max_cost FROM (SELECT d.id, SUM(l.estimated_cost) as decision_cost FROM agent_decisions d JOIN agent_llm_calls l ON l.ticket_id = d.ticket_id AND l.created_at BETWEEN DATEADD(minute, -5, d.created_at) AND DATEADD(minute, 5, d.created_at) WHERE d.created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY d.id) sub`],
  ['D1', `SELECT CAST(created_at AS DATE) as day, MIN(created_at) as first_decision, MAX(created_at) as last_decision, COUNT(*) as decisions, DATEDIFF(hour, MIN(created_at), MAX(created_at)) as active_hours FROM agent_decisions WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY CAST(created_at AS DATE) ORDER BY day`],
  ['D2', `SELECT (SELECT COUNT(*) FROM agent_decisions WHERE created_at > DATEADD(day, -7, GETUTCDATE())) as decisions_made, (SELECT COUNT(DISTINCT ticket_id) FROM agent_decisions WHERE created_at > DATEADD(day, -7, GETUTCDATE())) as unique_tickets_processed`],
  ['D3', `SELECT TOP 50 ticket_id, COUNT(*) as decision_count FROM agent_decisions WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY ticket_id HAVING COUNT(*) > 2 ORDER BY decision_count DESC`],
  ['D4_autonomy', `IF OBJECT_ID('agent_autonomy_rules','U') IS NOT NULL SELECT * FROM agent_autonomy_rules WHERE enabled = 1 ELSE SELECT * FROM agent_autonomy WHERE enabled = 1`],
  ['D5', `SELECT [key], [value] FROM settings WHERE [key] LIKE 'agent_%' ORDER BY [key]`],
  ['E1', `SELECT alert_type, COUNT(*) as count FROM agent_alerts WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY alert_type ORDER BY count DESC`],
  ['E2_tables', `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%qa%' OR TABLE_NAME LIKE '%coaching%'`],
  ['E3', `SELECT LEFT(CAST(output AS VARCHAR(MAX)), 500) as sample FROM agent_decisions WHERE action = 'draft_response' AND created_at > DATEADD(day, -7, GETUTCDATE()) ORDER BY created_at DESC OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY`],
  ['E4', `SELECT COUNT(*) as kb_gaps_identified FROM agent_alerts WHERE alert_type = 'kb_gap' AND created_at > DATEADD(day, -7, GETUTCDATE())`],
  ['F1', `SELECT TOP 10 id, ticket_id, action, confidence, shadow_mode, created_at FROM agent_decisions WHERE action LIKE '%n8n%' ORDER BY created_at DESC`],
  ['F2_check', `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ('agent_learnings','ai_learning','ai_comparison_log')`],
  ['F3', `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%n8n%' OR TABLE_NAME LIKE '%webhook%' OR TABLE_NAME LIKE '%automation%'`],
  ['G1', `SELECT prompt_version, call_type, MIN(created_at) as first_seen, MAX(created_at) as last_seen, COUNT(*) as calls FROM agent_llm_calls WHERE created_at > DATEADD(day, -7, GETUTCDATE()) GROUP BY prompt_version, call_type ORDER BY first_seen`],
  ['G2', `SELECT TOP 1 * FROM agent_drift_snapshots ORDER BY created_at DESC`],
  ['G3', `SELECT CAST(d.created_at AS DATE) as day, COUNT(*) as total, SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved, SUM(CASE WHEN approval_status = 'declined' THEN 1 ELSE 0 END) as declined, ROUND(100.0 * SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) / NULLIF(SUM(CASE WHEN approval_status IN ('approved','declined') THEN 1 ELSE 0 END), 0), 1) as accept_pct FROM agent_decisions d WHERE created_at > DATEADD(day, -14, GETUTCDATE()) GROUP BY CAST(d.created_at AS DATE) ORDER BY day`],
];

function fmt(rows) {
  if (!rows || rows.length === 0) return '(0 rows)';
  const keys = Object.keys(rows[0]);
  const widths = keys.map(k => Math.max(k.length, ...rows.map(r => String(r[k] ?? 'NULL').length)));
  // cap column width at 120
  const capped = widths.map(w => Math.min(w, 120));
  const hdr = keys.map((k, i) => k.padEnd(capped[i])).join(' | ');
  const sep = capped.map(w => '-'.repeat(w)).join('-+-');
  const body = rows.map(r => keys.map((k, i) => {
    let v = r[k];
    if (v instanceof Date) v = v.toISOString();
    v = String(v ?? 'NULL');
    if (v.length > capped[i]) v = v.slice(0, capped[i] - 3) + '...';
    return v.padEnd(capped[i]);
  }).join(' | ')).join('\n');
  return `${hdr}\n${sep}\n${body}\n(${rows.length} rows)`;
}

async function run() {
  let pool;
  try {
    pool = await sql.connect(config);
    process.stdout.write('Connected to NOVA database.\n\n');

    for (const [label, q] of queries) {
      process.stdout.write(`\n========== ${label} ==========\n`);
      try {
        const result = await pool.request().query(q);
        // some queries return multiple recordsets
        const rs = result.recordsets ? result.recordsets.find(r => r.length > 0) || result.recordset : result.recordset;
        process.stdout.write(fmt(rs) + '\n');
      } catch (err) {
        process.stdout.write(`ERROR: ${err.message}\n`);
      }
    }

    // F2 conditional — check which comparison tables exist and query them
    process.stdout.write('\n========== F2 ==========\n');
    try {
      const tables = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME IN ('agent_learnings','ai_learning','ai_comparison_log')");
      if (tables.recordset.length === 0) {
        process.stdout.write('No learnings/comparison tables exist.\n');
        // try ai_comparison_log anyway since it was mentioned in stderr
        try {
          const r = await pool.request().query('SELECT TOP 20 * FROM ai_comparison_log ORDER BY created_at DESC');
          process.stdout.write(fmt(r.recordset) + '\n');
        } catch(e2) {
          process.stdout.write('ai_comparison_log also not found: ' + e2.message + '\n');
        }
      } else {
        process.stdout.write('Found tables: ' + tables.recordset.map(r => r.TABLE_NAME).join(', ') + '\n');
        for (const t of tables.recordset) {
          const r = await pool.request().query(`SELECT TOP 20 * FROM [${t.TABLE_NAME}] ORDER BY created_at DESC`);
          process.stdout.write(`\n--- ${t.TABLE_NAME} ---\n`);
          process.stdout.write(fmt(r.recordset) + '\n');
        }
      }
    } catch (err) {
      process.stdout.write('ERROR: ' + err.message + '\n');
    }

  } catch (err) {
    process.stderr.write('Connection failed: ' + err.message + '\n');
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

run();
