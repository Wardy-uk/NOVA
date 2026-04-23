# Plaud API Integration Notes

Investigation of the existing n8n workflow "PLAUD Sync to Obsidian" (ID: `FNaKr0V1xEA6Hlee`) running on the Pi at `100.69.158.50:5678`. Goal: replicate as a native NOVA service.

## API Base URL

```
https://api-euc1.plaud.ai
```

EU-Central-1 regional endpoint (AWS). The `euc1` suffix indicates the user's Plaud account is EU-region.

## Authentication

Bearer JWT token in `Authorization` header. The token is a long-lived JWT (expires ~2027 based on `exp` claim). Not OAuth — appears to be issued by Plaud's web login and manually extracted.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3ZGJiYTg3MzRmZjA0Yzk0OGIwYjcwNDJlZTI3NzZmYyIsImF1ZCI6IiIsImV4cCI6MTgwMDUyNjUwMywiaWF0IjoxNzc0NjA2NTAzLCJjbGllbnRfaWQiOiJ3ZWIiLCJyZWdpb24iOiJhd3M6ZXUtY2VudHJhbC0xIn0.R1g755fW-tzHyCUNhLK3nTlaEmGTKPmer-D4omYMrX4
```

JWT payload:
- `sub`: `7dbba8734ff04c948b0b7042ee2776fc` (user ID)
- `client_id`: `web`
- `region`: `aws:eu-central-1`
- `exp`: `1800526503` (~2027-01-17)
- `iat`: `1774606503` (~2026-03-24)

**Risk**: Token has a fixed expiry. Will need manual rotation when it expires. No refresh token flow observed.

## Endpoints

### 1. List Recordings

```
GET /file/simple/web?skip=0&limit=99999&is_trash=0&sort_by=edit_time&is_desc=true
```

Returns all non-trashed recordings sorted by edit time descending.

**Response shape:**
```json
{
  "data_file_list": [
    {
      "id": "string",
      "filename": "string",
      "start_time": 1713000000,
      "duration": 1800,
      "is_summary": true,
      "is_trans": true,
      "keywords": ["keyword1", "keyword2"],
      "filetag_id_list": ["tagId1"]
    }
  ]
}
```

Key fields:
- `id` — unique recording ID, used in detail/patch calls
- `filename` — user-visible name (often auto-generated from date/content)
- `start_time` — Unix timestamp (seconds)
- `duration` — recording length in seconds
- `is_summary` — whether AI summary has been generated
- `is_trans` — whether transcript has been generated
- `keywords` — AI-extracted keywords array
- `filetag_id_list` — array of tag IDs applied to this recording

### 2. Get Recording Detail

```
GET /file/detail/{fileId}
```

Returns full recording metadata including AI summary and transcript.

**Response shape:**
```json
{
  "ai_content": {
    "summary": "string",
    "highlights": ["string"],
    "key_points": ["string"]
  },
  "trans_result": {
    "paragraphs": [
      {
        "start_time": 0.5,
        "end_time": 5.2,
        "speaker": "Speaker 1",
        "content": "string"
      }
    ]
  },
  "content_list": [
    {
      "type": "string",
      "content": "string"
    }
  ]
}
```

Key fields:
- `ai_content.summary` — full AI-generated summary text
- `ai_content.highlights` — bullet-point highlights
- `ai_content.key_points` — extracted key points
- `trans_result.paragraphs[]` — timestamped, speaker-attributed transcript segments
- `content_list[]` — additional content entries (audio segments, etc.)

### 3. Tag Recording (Mark as Synced)

```
PATCH /file/{fileId}
Content-Type: application/json

{
  "filetag_id_list": ["7a2f2c53ad6c305821c4c25cddccab46"]
}
```

The n8n workflow uses tag ID `7a2f2c53ad6c305821c4c25cddccab46` to mark recordings as synced. This prevents re-processing on subsequent runs.

## Sync Logic (from n8n workflow)

1. **Poll** every 30 minutes (cron: `*/30 * * * *`)
2. **List** all recordings via `/file/simple/web`
3. **Filter** to only recordings newer than `lastSyncAtMs` (stored in n8n static data) that have `is_summary === true` and `is_trans === true`
4. **Fetch detail** for each new recording via `/file/detail/{id}`
5. **Write** markdown file to `/home/nickw/nuero-vault/Imports/PLAUD/` with frontmatter (title, date, duration, keywords, tags) and body (summary, highlights, key points, full transcript)
6. **Tag** each processed recording with the sync tag via `PATCH /file/{id}`
7. **Update** `lastSyncAtMs` checkpoint to the newest recording's `start_time`

## Recommendation: Native NOVA Service

Create `src/server/services/plaud.ts` with:

### Settings Keys
- `plaud_api_token` — Bearer JWT (stored in settings.json via Admin UI)
- `plaud_api_base` — defaults to `https://api-euc1.plaud.ai`
- `plaud_sync_tag_id` — defaults to `7a2f2c53ad6c305821c4c25cddccab46`

### Service Class: `PlaudService`

```typescript
class PlaudService {
  constructor(private token: string, private baseUrl: string) {}

  async listRecordings(since?: number): Promise<PlaudRecording[]>
  async getRecordingDetail(fileId: string): Promise<PlaudRecordingDetail>
  async tagRecording(fileId: string, tagIds: string[]): Promise<void>
  async getRecentTranscripts(since: number): Promise<PlaudTranscript[]>
}
```

### Integration Points

1. **1-2-1 Transcript Import** (`POST /api/people/agent/:agentName/import-plaud`):
   - List recordings since last import
   - Match by date proximity to scheduled 1-2-1 (within ±1 hour of calendar event)
   - Extract transcript + AI summary
   - Store in `agent_121_snapshots` with `transcript` and `ai_summary` fields
   - Tag recording as synced

2. **Recording Browser** (`GET /api/people/agent/:agentName/plaud-recordings`):
   - List recent recordings
   - Frontend shows date, duration, keywords, summary preview
   - Click to view full transcript + import into a 1-2-1

### Matching Logic

The n8n workflow doesn't match recordings to agents — it dumps everything to Obsidian. For NOVA, match recordings to agents by:
- Calendar event time: find 1-2-1 calendar events within ±1 hour of recording `start_time`
- Agent name in filename or keywords (Plaud sometimes auto-titles with participant names)
- Manual selection as fallback (UI lets manager pick which recording goes with which agent)

### Considerations

- **Token rotation**: JWT expires ~Jan 2027. Add a health check that warns when <30 days from expiry.
- **Rate limiting**: Unknown. The n8n workflow does sequential requests with no throttling. Start conservative (1 req/sec).
- **Data size**: Transcript paragraphs can be large for long meetings. Store compressed or truncated if needed.
- **Privacy**: Recordings may contain sensitive content. Ensure only admins can access, add audit logging.
- **Existing n8n workflow**: Can coexist — NOVA would use a different sync tag to track its own imports independently.
