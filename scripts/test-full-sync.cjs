// Full end-to-end sync simulation — exactly what prod does
const sql = require('mssql');
const fs = require('fs');

const API_KEY = '0008c79d-0fc7-472f-a8e5-0fa7c4285c1d';
const BASE_URL = 'https://api.peoplehr.net';

async function phrCall(endpoint, body) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ APIKey: API_KEY, ...body }),
  });
  if (!res.ok) throw new Error(`People HR API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json.isError) throw new Error(`People HR error: ${json.Message ?? 'unknown'}`);
  return json.Result ?? [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Step 1: Get agents from KPI database (same as getAgentsFromKpi)
  console.log('Step 1: Connecting to KPI database...');
  const kpiPool = await sql.connect({
    server: 'bym-asqlep01.database.windows.net',
    database: 'TechSupportJSM',
    user: 'azureadmin',
    password: 'Bl45t3r!',
    options: { encrypt: true, trustServerCertificate: true },
  });

  const agentResult = await kpiPool.request().query(`
    SELECT AgentId,
           LTRIM(RTRIM(AgentName)) + ' ' + LTRIM(RTRIM(ISNULL(AgentSurname, ''))) AS display_name,
           LOWER(Team) AS pool,
           PeopleHrId
    FROM dbo.Agent WHERE IsActive = 1 AND Department = 'NT'
    ORDER BY AgentName
  `);
  const kpiAgents = agentResult.recordset;
  console.log(`  Found ${kpiAgents.length} KPI agents`);
  await kpiPool.close();

  // Step 2: Filter to agents with PeopleHrId
  const agentsWithHrId = kpiAgents.filter(a => a.PeopleHrId);
  const skipped = kpiAgents.length - agentsWithHrId.length;
  console.log(`Step 2: ${agentsWithHrId.length} agents have People HR IDs (${skipped} without)`);

  // Step 3: Fetch leave from People HR
  const today = new Date();
  const endDate = new Date(today.getTime() + 14 * 86400000);
  const startStr = today.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  console.log(`Step 3: Fetching leave ${startStr} to ${endStr}...`);

  const leaveEntries = [];
  const errors = [];

  for (const agent of agentsWithHrId) {
    const hrId = agent.PeopleHrId;
    try {
      await sleep(2200);
      const holidays = await phrCall('Holiday', {
        Action: 'GetHolidayDetail', EmployeeId: hrId, StartDate: startStr, EndDate: endStr,
      });
      const approvedHolidays = Array.isArray(holidays)
        ? holidays.filter(h => (h.Status ?? '').toLowerCase() === 'approved')
        : [];

      await sleep(2200);
      const absences = await phrCall('Absence', {
        Action: 'GetAbsenceDetail', EmployeeId: hrId, StartDate: startStr, EndDate: endStr,
      });
      const absArr = Array.isArray(absences) ? absences : [];

      const allLeave = [
        ...approvedHolidays.map(h => ({ startDate: h.StartDate, endDate: h.EndDate, reason: h.RequesterComments || 'Annual Leave', type: 'holiday' })),
        ...absArr.map(a => ({ startDate: a.StartDate, endDate: a.EndDate, reason: a.Reason || 'Sick', type: 'absence' })),
      ];

      for (const leave of allLeave) {
        if (!leave.startDate || !leave.endDate) continue;
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().slice(0, 10);
          if (dateStr < startStr || dateStr > endStr) continue;
          leaveEntries.push({
            rosterId: agent.AgentId,
            date: dateStr,
            status: leave.type === 'absence' ? 'sick' : 'annual_leave',
            reason: leave.reason ?? (leave.type === 'absence' ? 'Sick' : 'Annual Leave'),
            name: agent.display_name,
          });
        }
      }
    } catch (err) {
      errors.push(`${agent.display_name} (${hrId}): ${err.message}`);
    }
  }

  console.log(`\nStep 4: Found ${leaveEntries.length} leave entries to write`);
  for (const e of leaveEntries) {
    console.log(`  ${e.name}: ${e.date} ${e.status} (${e.reason})`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`);
    for (const e of errors) console.log(`  ${e}`);
  }

  // Step 5: Write to NOVA database
  console.log('\nStep 5: Writing to NOVA database...');
  const novaPool = await new sql.ConnectionPool({
    server: 'bym-asqlep01.database.windows.net',
    database: 'NOVA',
    user: 'nova_app',
    password: 'Alchemy123/',
    options: { encrypt: true, trustServerCertificate: false },
  }).connect();

  let synced = 0;
  for (const entry of leaveEntries) {
    try {
      await novaPool.request()
        .input('p0', sql.Int, entry.rosterId)
        .input('p1', sql.NVarChar, entry.date)
        .input('p2', sql.NVarChar, entry.status)
        .input('p3', sql.NVarChar, entry.reason)
        .input('p4', sql.Int, entry.rosterId)
        .input('p5', sql.NVarChar, entry.date)
        .input('p6', sql.NVarChar, entry.status)
        .input('p7', sql.NVarChar, entry.reason)
        .query(`
          MERGE agent_availability AS target
          USING (SELECT @p0 AS roster_id, @p1 AS available_date) AS source
          ON target.roster_id = source.roster_id AND target.available_date = source.available_date
          WHEN MATCHED THEN UPDATE SET status = @p2, reason = @p3, updated_at = GETUTCDATE()
          WHEN NOT MATCHED THEN INSERT (roster_id, available_date, status, reason) VALUES (@p4, @p5, @p6, @p7);
        `);
      synced++;
    } catch (err) {
      console.log(`  Write error for ${entry.name} ${entry.date}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${synced} entries written`);

  // Verify
  const check = await novaPool.request().query(`SELECT * FROM agent_availability ORDER BY available_date, roster_id`);
  console.log(`\nVerification — ${check.recordset.length} rows in agent_availability:`);
  for (const r of check.recordset) {
    console.log(`  roster_id=${r.roster_id} date=${r.available_date?.toISOString().slice(0,10)} status=${r.status} reason=${r.reason}`);
  }

  await novaPool.close();
}

main().catch(console.error);
