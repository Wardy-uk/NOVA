const sql = require("mssql");
const cfg = {
  server: "bym-asqlep01.database.windows.net",
  database: "NOVA",
  user: "nova_app",
  password: "Alchemy123/",
  options: { encrypt: true, trustServerCertificate: false }
};

sql.connect(cfg).then(async (pool) => {
  // Post-deploy stats (last 30 min)
  const stats = await pool.request().query(`
    SELECT provider, model, call_type,
           COUNT(*) as total,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as ok,
           SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as fail,
           AVG(latency_ms) as avg_ms
    FROM agent_llm_calls
    WHERE created_at >= DATEADD(minute, -30, GETUTCDATE())
    GROUP BY provider, model, call_type
    ORDER BY provider, call_type
  `);
  console.log("=== POST-DEPLOY STATS (LAST 30 MIN) ===");
  for (const r of stats.recordset) {
    const pct = r.total > 0 ? ((r.ok / r.total) * 100).toFixed(0) : 'N/A';
    console.log(`  ${r.provider}/${r.model} [${r.call_type}]: ${r.ok}/${r.total} (${pct}%) avg ${r.avg_ms}ms`);
  }

  // Any failures?
  const failures = await pool.request().query(`
    SELECT TOP 5 id, provider, model, call_type, LEFT(error, 300) as err, created_at
    FROM agent_llm_calls
    WHERE success = 0 AND created_at >= DATEADD(minute, -30, GETUTCDATE())
    ORDER BY created_at DESC
  `);
  if (failures.recordset.length > 0) {
    console.log("\n=== RECENT FAILURES ===");
    console.log(JSON.stringify(failures.recordset, null, 2));
  } else {
    console.log("\n=== NO FAILURES IN LAST 30 MIN ===");
  }

  // Deployed version check
  const version = await pool.request().query(`
    SELECT TOP 1 model, created_at FROM agent_llm_calls WHERE provider = 'anthropic' ORDER BY created_at DESC
  `);
  console.log("\n=== LATEST ANTHROPIC CALL IN DB ===");
  console.log(JSON.stringify(version.recordset, null, 2));

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
