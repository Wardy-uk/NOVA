const sql = require("mssql");
const cfg = {
  server: "bym-asqlep01.database.windows.net",
  database: "NOVA",
  user: "nova_app",
  password: "Alchemy123/",
  options: { encrypt: true, trustServerCertificate: false }
};

sql.connect(cfg).then(async (pool) => {
  // 1. Get all Anthropic failures today
  const failures = await pool.request().query(`
    SELECT TOP 20 id, call_type, provider, model, LEFT(error, 800) as err, created_at
    FROM agent_llm_calls
    WHERE provider = 'anthropic' AND success = 0 AND created_at >= '2026-04-26'
    ORDER BY created_at DESC
  `);
  console.log("=== ANTHROPIC FAILURES TODAY ===");
  console.log(JSON.stringify(failures.recordset, null, 2));

  // 2. Get success/fail counts by provider today
  const stats = await pool.request().query(`
    SELECT provider, model, call_type, success, COUNT(*) as cnt
    FROM agent_llm_calls
    WHERE created_at >= '2026-04-26'
    GROUP BY provider, model, call_type, success
    ORDER BY provider, call_type, success
  `);
  console.log("\n=== TODAY'S STATS BY PROVIDER ===");
  console.log(JSON.stringify(stats.recordset, null, 2));

  // 3. Get triage-specific results across all providers
  const triage = await pool.request().query(`
    SELECT TOP 20 id, call_type, provider, model, success, LEFT(error, 500) as err, created_at
    FROM agent_llm_calls
    WHERE call_type = 'triage' AND created_at >= '2026-04-20'
    ORDER BY created_at DESC
  `);
  console.log("\n=== TRIAGE CALLS (LAST WEEK) ===");
  console.log(JSON.stringify(triage.recordset, null, 2));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
