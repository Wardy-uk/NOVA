# Clean-Sheet KPI — n8n Thin Trigger (P5-WP1)

This is the **thin trigger** that replaces the legacy n8n KPI engine logic for the
clean-sheet KPI platform. Per `KPI-Clean-Sheet-Design.md` §1 and §5.2, n8n's role
is reduced to:

> **No logic, no SQL, no API calls** beyond one HTTP GET. n8n simply fires on a
> cron, fetches the fully-assembled daily report (metrics + RAG + EOD snapshot +
> agent rows + **AI digests**) from NOVA, formats it into an email, and sends it.

All KPI computation, EOD freezing, RAG, and digest generation now happen **inside
NOVA** (the `kpi-engine` services). The endpoint below returns everything the
email needs in one payload:

```
GET {NOVA_BASE_URL}/api/kpi/daily-report/{YYYY-MM-DD}
```

Response shape (abridged):

```jsonc
{
  "ok": true,
  "data": {
    "reportDate": "2026-05-29",
    "spaces": [ { "spaceKey": "NT", "displayName": "...", "metrics": [...],
                  "ragSummary": { "green": 9, "amber": 2, "red": 1 },
                  "eodSnapshot": { "totalTickets": 145, "overSla": 3, ... },
                  "agents": [...] } ],
    "summary": { "spacesCaptured": 3, "spacesExpected": 4 },
    "digests": {
      "date": "2026-05-29",
      "slt": { "spaceKey": null, "summary": "SLT cross-team summary ...", "generatedAt": "..." },
      "spaces": [ { "spaceKey": "NT", "summary": "Team digest ...", "generatedAt": "..." } ]
    }
  }
}
```

## Migration (operational — NOT performed automatically by the build)

The Build Agent does **not** modify the live n8n instance (that is an outward-facing
production change requiring Nick's sign-off). To cut over:

1. Import `kpi-daily-email-thin-trigger.workflow.json` into n8n.
2. Set the `NOVA_BASE_URL` workflow variable (or edit the HTTP node URL) and attach
   the SMTP / email credential.
3. Run it once manually against a date that has captured data and confirm the email
   matches the legacy email for the parallel-run window.
4. Disable the legacy KPI workflow (keep it as a backup — do **not** delete), per
   the decommission checklist in the design (§12).

Until step 4, the legacy KPI n8n workflow and the new thin trigger can run in
parallel (the new one against the new `/api/kpi/daily-report` endpoint, the old one
against its own pipeline). They do not collide.

## Schedules (design §5.2)

| Job | When | Node |
|-----|------|------|
| Daily email | 18:00 Mon–Fri | Schedule Trigger → HTTP GET → format → send |
| Catch-up | 23:00 Mon–Fri | same flow; NOVA's report is idempotent, so a re-send reflects the frozen EOD truth |

The 17:30/18:00 EOD freeze and 17:45 digest generation are **NOVA-side** jobs
(`kpi-engine-eod`, `kpi-engine-digest`), observable at `GET /api/kpi/health`. n8n
only needs to fire after those have run.
