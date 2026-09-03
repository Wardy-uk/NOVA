// Quick diagnostic: test People HR API with a known employee ID
const API_KEY = '0008c79d-0fc7-472f-a8e5-0fa7c4285c1d';
const BASE_URL = 'https://api.peoplehr.net';

async function apiCall(endpoint, body) {
  const url = `${BASE_URL}/${endpoint}`;
  console.log(`\n>>> POST ${url}`);
  console.log('    Body:', JSON.stringify({ ...body, APIKey: '***' }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ APIKey: API_KEY, ...body }),
  });
  console.log(`    Status: ${res.status} ${res.statusText}`);
  const json = await res.json();
  console.log(`    isError: ${json.isError}`);
  console.log(`    Message: ${json.Message ?? '(none)'}`);
  const result = json.Result ?? [];
  console.log(`    Result count: ${Array.isArray(result) ? result.length : typeof result}`);
  return { json, result };
}

async function main() {
  const today = new Date();
  const endDate = new Date(today.getTime() + 14 * 86400000);
  const startStr = today.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  console.log(`Date range: ${startStr} to ${endStr}`);

  // Test with known employee IDs from the screenshot
  const testIds = ['D2V00403', 'D2V00505', '520'];

  for (const empId of testIds) {
    console.log(`\n=== Employee: ${empId} ===`);

    try {
      const { result: holidays } = await apiCall('Holiday', {
        Action: 'GetHolidayDetail',
        EmployeeId: empId,
        StartDate: startStr,
        EndDate: endStr,
      });
      if (Array.isArray(holidays) && holidays.length > 0) {
        for (const h of holidays.slice(0, 3)) {
          console.log(`    Holiday: ${h.StartDate} - ${h.EndDate} Status=${h.Status} ${h.RequesterComments || ''}`);
        }
      }
    } catch (err) {
      console.log(`    Holiday error: ${err.message}`);
    }

    // Small delay for rate limiting
    await new Promise(r => setTimeout(r, 2200));

    try {
      const { result: absences } = await apiCall('Absence', {
        Action: 'GetAbsenceDetail',
        EmployeeId: empId,
        StartDate: startStr,
        EndDate: endStr,
      });
      if (Array.isArray(absences) && absences.length > 0) {
        for (const a of absences.slice(0, 3)) {
          console.log(`    Absence: ${a.StartDate} - ${a.EndDate} Reason=${a.Reason}`);
        }
      }
    } catch (err) {
      console.log(`    Absence error: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 2200));
  }
}

main().catch(console.error);
