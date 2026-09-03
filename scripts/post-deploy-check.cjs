const sql = require("mssql");
const cfg = {
  server: "bym-asqlep01.database.windows.net",
  database: "NOVA",
  user: "nova_app",
  password: "Alchemy123/",
  options: { encrypt: true, trustServerCertificate: false }
};

sql.connect(cfg).then(async (pool) => {
  // 1. Calls since deploy (last 15 min)
  const recent = await pool.request().query(`
    SELECT provider, model, call_type, success, COUNT(*) as cnt,
           AVG(latency_ms) as avg_latency,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as ok,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as fail
    FROM agent_llm_calls
    WHERE created_at >= DATEADD(minute, -15, GETUTCDATE())
    GROUP BY provider, model, call_type, success
    ORDER BY provider, call_type, success
  `);
  console.log("=== LAST 15 MIN BY PROVIDER ===");
  console.log(JSON.stringify(recent.recordset, null, 2));

  // 2. Any Anthropic calls since deploy?
  const anthropic = await pool.request().query(`
    SELECT TOP 10 id, call_type, model, success, LEFT(error, 300) as err,
           latency_ms, created_at
    FROM agent_llm_calls
    WHERE provider = 'anthropic'
      AND created_at >= DATEADD(minute, -15, GETUTCDATE())
    ORDER BY created_at DESC
  `);
  console.log("\n=== RECENT ANTHROPIC CALLS ===");
  console.log(JSON.stringify(anthropic.recordset, null, 2));

  // 3. Overall success rate last 15 min
  const rates = await pool.request().query(`
    SELECT provider,
           COUNT(*) as total,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as ok,
           CAST(SUM(CASE WHEN success = 1 THEN 1.0 ELSE 0 END) / COUNT(*) * 100 AS DECIMAL(5,1)) as pct
    FROM agent_llm_calls
    WHERE created_at >= DATEADD(minute, -15, GETUTCDATE())
    GROUP BY provider
    ORDER BY provider
  `);
  console.log("\n=== SUCCESS RATES (LAST 15 MIN) ===");
  console.log(JSON.stringify(rates.recordset, null, 2));

  // 4. Last triage call
  const triage = await pool.request().query(`
    SELECT TOP 5 id, provider, model, success, LEFT(error, 400) as err,
           latency_ms, created_at
    FROM agent_llm_calls
    WHERE call_type = 'triage'
    ORDER BY created_at DESC
  `);
  console.log("\n=== LAST 5 TRIAGE CALLS ===");
  console.log(JSON.stringify(triage.recordset, null, 2));

  // 5. What version is running? Check latest call timestamp
  const latest = await pool.request().query(`
    SELECT TOP 1 created_at FROM agent_llm_calls ORDER BY created_at DESC
  `);
  console.log("\n=== LATEST CALL ===");
  console.log(JSON.stringify(latest.recordset, null, 2));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
