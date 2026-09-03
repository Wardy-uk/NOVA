// Check raw People HR response format for date parsing
const API_KEY = '0008c79d-0fc7-472f-a8e5-0fa7c4285c1d';
const BASE_URL = 'https://api.peoplehr.net';

async function main() {
  // Kayleigh's holiday — known to exist today
  const res = await fetch(`${BASE_URL}/Holiday`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      APIKey: API_KEY,
      Action: 'GetHolidayDetail',
      EmployeeId: 'D2V00318',
      StartDate: '2026-05-13',
      EndDate: '2026-05-13',
    }),
  });
  const json = await res.json();
  console.log('=== Raw Holiday Response (Kayleigh) ===');
  console.log(JSON.stringify(json.Result[0], null, 2));

  await new Promise(r => setTimeout(r, 2200));

  // Nathan's absence
  const res2 = await fetch(`${BASE_URL}/Absence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      APIKey: API_KEY,
      Action: 'GetAbsenceDetail',
      EmployeeId: 'D2V00269',
      StartDate: '2026-05-13',
      EndDate: '2026-05-13',
    }),
  });
  const json2 = await res2.json();
  console.log('\n=== Raw Absence Response (Nathan) ===');
  console.log(JSON.stringify(json2.Result[0], null, 2));

  // Now test date parsing
  const holiday = json.Result[0];
  const absence = json2.Result[0];

  console.log('\n=== Date Parsing Test ===');
  console.log(`Holiday StartDate raw: "${holiday.StartDate}"`);
  console.log(`Holiday EndDate raw: "${holiday.EndDate}"`);
  console.log(`Holiday StartDate parsed: ${new Date(holiday.StartDate)}`);
  console.log(`Holiday EndDate parsed: ${new Date(holiday.EndDate)}`);
  console.log(`Absence StartDate raw: "${absence.StartDate}"`);
  console.log(`Absence EndDate raw: "${absence.EndDate}"`);
  console.log(`Absence StartDate parsed: ${new Date(absence.StartDate)}`);
  console.log(`Absence EndDate parsed: ${new Date(absence.EndDate)}`);

  // Check if our date loop would work
  const start = new Date(holiday.StartDate);
  const end = new Date(holiday.EndDate);
  console.log(`\nDate loop test (holiday):`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    console.log(`  ${d.toISOString().slice(0, 10)}`);
  }
}

main().catch(console.error);
