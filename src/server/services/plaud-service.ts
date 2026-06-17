/**
 * Plaud client — imports the daily standup recording via the official Plaud MCP
 * server (npx @plaud-ai/mcp), registered in NOVA's mcpManager like Jira/MS365.
 *
 * Auth is browser OAuth (one-time, tokens auto-refresh at ~/.plaud/tokens-mcp.json)
 * — there is no API key. All Plaud access goes through mcpManager.callTool('plaud', …);
 * routes/jobs never talk to Plaud directly.
 *
 * MCP tool output shapes (confirmed against the live server):
 *   list_files     -> { type:'list', data:[{ id, name, start_at, duration }] }
 *   get_transcript -> [ { speaker, content|text, start_time? }, … ]  (empty [] if none)
 *   get_note       -> [ { data_title, data_content }, … ]            (empty [] if none)
 */
import type { McpClientManager } from './mcp-client.js';

const PLAUD_SERVER = 'plaud';

// Standup runs at ~10:00 UK most weekdays. We match the recording starting nearest
// this time (within the window) rather than by name, since Plaud auto-names by
// timestamp. Adjust here if the standup slot moves.
const STANDUP_TARGET_MINUTES = 10 * 60; // 10:00
const STANDUP_WINDOW_MINUTES = 45; // accept 09:15–10:45

export interface PlaudRecording {
  id: string;
  filename: string;
  start_time: number; // unix seconds
  duration: number; // ms (as Plaud reports)
}

/** Unwrap an MCP CallToolResult into parsed JSON (or the raw text / value). */
function unwrap(result: unknown): any {
  const r = result as any;
  if (r == null) return null;
  if (typeof r === 'object' && Array.isArray(r.content)) {
    const textPart = r.content.find((c: any) => c?.type === 'text');
    if (textPart?.text != null) {
      try { return JSON.parse(textPart.text); } catch { return textPart.text; }
    }
    if (r.structuredContent != null) return r.structuredContent;
    return null;
  }
  return r; // already a plain value (e.g. when called through a pre-parsing client)
}

export class PlaudService {
  constructor(private mcp: McpClientManager) {}

  /** True once the Plaud MCP server is connected and exposing tools. */
  isConfigured(): boolean {
    return this.mcp.getServerTools(PLAUD_SERVER).length > 0;
  }

  /** YYYY-MM-DD for a Plaud start_at (local ISO, no tz) in UK time. */
  private ukDate(startAt: string): string {
    return new Date(startAt).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  }

  /** List recordings whose start falls on the given UK calendar date (YYYY-MM-DD). */
  async listRecordings(dateString: string): Promise<PlaudRecording[]> {
    const raw = unwrap(await this.mcp.callTool(PLAUD_SERVER, 'list_files', {
      date_from: dateString,
      date_to: dateString,
    }));
    const list: any[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.data_file_list ?? raw?.files ?? []);
    return list
      .map((r) => {
        const startAt = r.start_at ?? r.start_time ?? r.created_at ?? '';
        return {
          id: String(r.id ?? r.file_id ?? ''),
          filename: String(r.name ?? r.filename ?? r.title ?? ''),
          start_time: startAt ? Math.floor(new Date(startAt).getTime() / 1000) : 0,
          duration: Number(r.duration ?? 0),
          _startAt: startAt as string,
        };
      })
      // Keep the date filter even though the API filters too (defensive).
      .filter((r) => r.id && (!r._startAt || this.ukDate(r._startAt) === dateString))
      .map(({ _startAt, ...rec }) => rec);
  }

  /** UK minutes-since-midnight for a unix-seconds timestamp. */
  private ukMinutesOfDay(unixSeconds: number): number {
    const d = new Date(unixSeconds * 1000);
    const hh = parseInt(d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }), 10);
    const mm = parseInt(d.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: '2-digit' }), 10);
    return hh * 60 + mm;
  }

  /**
   * Find the standup recording for a date. Prefers any recording explicitly named
   * "standup"; otherwise picks the one starting nearest 10:00 UK (within the window).
   * Returns null if nothing qualifies.
   */
  async findStandupRecording(dateString: string): Promise<PlaudRecording | null> {
    const recordings = await this.listRecordings(dateString);
    if (!recordings.length) return null;

    const named = recordings.find((r) => /stand[\s-]?up/i.test(r.filename));
    if (named) return named;

    let best: PlaudRecording | null = null;
    let bestDelta = Infinity;
    for (const r of recordings) {
      if (!r.start_time) continue;
      const delta = Math.abs(this.ukMinutesOfDay(r.start_time) - STANDUP_TARGET_MINUTES);
      if (delta < bestDelta) { bestDelta = delta; best = r; }
    }
    return best && bestDelta <= STANDUP_WINDOW_MINUTES ? best : null;
  }

  /** Full timestamped transcript as plain text. '' if not transcribed yet. */
  async getTranscript(recordingId: string): Promise<string> {
    const raw = unwrap(await this.mcp.callTool(PLAUD_SERVER, 'get_transcript', { file_id: recordingId }));
    if (typeof raw === 'string') return raw;
    const segments: any[] = Array.isArray(raw) ? raw : (raw?.paragraphs ?? raw?.data ?? []);
    if (!segments.length) return '';
    return segments
      .map((s) => {
        const t = Number(s.start_time ?? s.timestamp ?? NaN);
        const stamp = Number.isFinite(t) ? `[${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}] ` : '';
        const speaker = s.speaker ? `${s.speaker}: ` : '';
        const text = (s.content ?? s.text ?? '').toString().trim();
        return `${stamp}${speaker}${text}`.trim();
      })
      .filter(Boolean)
      .join('\n');
  }

  /** AI-generated notes/summary as markdown. '' if not summarised yet. */
  async getNotes(recordingId: string): Promise<string> {
    const raw = unwrap(await this.mcp.callTool(PLAUD_SERVER, 'get_note', { file_id: recordingId }));
    if (typeof raw === 'string') return raw;
    const blocks: any[] = Array.isArray(raw) ? raw : (raw?.data ?? []);
    if (!blocks.length) return '';
    return blocks
      .map((b) => {
        const title = (b.data_title ?? b.title ?? '').toString().trim();
        const content = (b.data_content ?? b.content ?? '').toString().trim();
        if (!content) return '';
        return title ? `### ${title}\n${content}` : content;
      })
      .filter(Boolean)
      .join('\n\n');
  }
}
