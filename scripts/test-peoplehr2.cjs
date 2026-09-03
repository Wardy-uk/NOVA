// Check PeopleHrId mapping for all NT agents, then test leave for those marked as off
const sql = require('mssql');

const config = {
  server: 'bym-asqlep01.database.windows.net',
  database: 'TechSupportJSM',
  user: 'azureadmin',
  password: 'Bl45t3r!',
  options: { encrypt: true, trustServerCertificate: true },
};

const API_KEY = '0008c79d-0fc7-472f-a8e5-0fa7c4285c1d';
const BASE_URL = 'https://api.peoplehr.net';

async function phrCall(endpoint, body) {
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ APIKey: API_KEY, ...body }),
  });
  const json = await res.json();
  if (json.isError) throw new Error(json.Message);
  return json.Result ?? [];
}

async function main() {
  const pool = await sql.connect(config);
  const result = await pool.request().query(`
    SELECT AgentId,
           LTRIM(RTRIM(AgentName)) + ' ' + LTRIM(RTRIM(ISNULL(AgentSurname, ''))) AS display_name,
           PeopleHrId
    FROM dbo.Agent WHERE IsActive = 1 AND Department = 'NT'
    ORDER BY AgentName
  `);

  console.log('=== All NT Agents ===');
  for (const a of result.recordset) {
    console.log(`  ${a.display_name.padEnd(25)} AgentId=${a.AgentId}  PeopleHrId=${a.PeopleHrId || '(none)'}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const endStr = today; // just check today

  // Check leave for agents with PeopleHrId
  const withId = result.recordset.filter(a => a.PeopleHrId);
  console.log(`\n=== Checking today (${today}) leave for ${withId.length} agents with PeopleHrId ===`);

  for (const agent of withId) {
    await new Promise(r => setTimeout(r, 2200));
    try {
      const holidays = await phrCall('Holiday', {
        Action: 'GetHolidayDetail',
        EmployeeId: agent.PeopleHrId,
        StartDate: today,
        EndDate: today,
      });
      const approved = Array.isArray(holidays)
        ? holidays.filter(h => (h.Status || '').toLowerCase() === 'approved')
        : [];

      await new Promise(r => setTimeout(r, 2200));
      const absences = await phrCall('Absence', {
        Action: 'GetAbsenceDetail',
        EmployeeId: agent.PeopleHrId,
        StartDate: today,
        EndDate: today,
      });
      const absArr = Array.isArray(absences) ? absences : [];

      if (approved.length > 0 || absArr.length > 0) {
        console.log(`  ${agent.display_name} (${agent.PeopleHrId}): ${approved.length} holidays, ${absArr.length} absences`);
        for (const h of approved) console.log(`    Holiday: ${h.StartDate}-${h.EndDate} ${h.Status}`);
        for (const a of absArr) console.log(`    Absence: ${a.StartDate}-${a.EndDate} ${a.Reason}`);
      } else {
        console.log(`  ${agent.display_name} (${agent.PeopleHrId}): no leave today`);
      }
    } catch (err) {
      console.log(`  ${agent.display_name} (${agent.PeopleHrId}): ERROR - ${err.message}`);
    }
  }

  await pool.close();
}

main().catch(console.error);
