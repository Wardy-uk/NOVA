/**
 * Plaud API client — used to auto-import the daily standup recording.
 *
 * Endpoints/shapes documented in NOVA-Plaud-Integration-Notes.md (reverse-engineered
 * from the "PLAUD Sync to Obsidian" n8n workflow). Base API is regional:
 *   https://api-euc1.plaud.ai   (EU-Central-1)
 *
 * Config resolution (env first, then settings.json fallback):
 *   PLAUD_API_URL   / setting: plaud_api_base   (default https://api-euc1.plaud.ai)
 *   PLAUD_API_TOKEN / setting: plaud_api_token   (long-lived Bearer JWT, manual rotation)
 *
 * All Plaud HTTP calls live here — routes/jobs must not fetch Plaud directly.
 */

const DEFAULT_BASE = 'https://api-euc1.plaud.ai';
const REQUEST_TIMEOUT_MS = 20_000;

export interface PlaudRecording {
  id: string;
  filename: string;
  start_time: number; // unix seconds
  duration: number;
  is_summary: boolean;
  is_trans: boolean;
}

interface PlaudListResponse {
  data_file_list?: Array<Record<string, unknown>>;
}

interface PlaudDetailResponse {
  ai_content?: {
    summary?: string;
    highlights?: string[];
    key_points?: string[];
  };
  trans_result?: {
    paragraphs?: Array<{ start_time?: number; speaker?: string; content?: string }>;
  };
}

export class PlaudService {
  private getSettings: () => Record<string, string>;

  constructor(settingsGetter: () => Record<string, string> = () => ({})) {
    this.getSettings = settingsGetter;
  }

  private get baseUrl(): string {
    const s = this.getSettings();
    return (process.env.PLAUD_API_URL || s.plaud_api_base || DEFAULT_BASE).replace(/\/+$/, '');
  }

  private get token(): string {
    const s = this.getSettings();
    return (process.env.PLAUD_API_TOKEN || s.plaud_api_token || '').trim();
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Plaud not configured. Set PLAUD_API_TOKEN (env) or plaud_api_token (settings).');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Plaud API ${path} returned ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Format a unix-seconds timestamp to a YYYY-MM-DD date string in UK time. */
  private ukDate(unixSeconds: number): string {
    return new Date(unixSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  }

  /** List recordings whose start time falls on the given UK calendar date (YYYY-MM-DD). */
  async listRecordings(dateString: string): Promise<PlaudRecording[]> {
    const resp = await this.request<PlaudListResponse>(
      '/file/simple/web?skip=0&limit=99999&is_trash=0&sort_by=edit_time&is_desc=true',
    );
    const all = (resp.data_file_list ?? []).map((r) => ({
      id: String(r.id ?? ''),
      filename: String(r.filename ?? ''),
      start_time: Number(r.start_time ?? 0),
      duration: Number(r.duration ?? 0),
      is_summary: Boolean(r.is_summary),
      is_trans: Boolean(r.is_trans),
    }));
    return all.filter((r) => r.id && r.start_time && this.ukDate(r.start_time) === dateString);
  }

  /** Find the standup recording for a date (filename contains "standup"/"stand up"). null if none. */
  async findStandupRecording(dateString: string): Promise<PlaudRecording | null> {
    const recordings = await this.listRecordings(dateString);
    const match = recordings.find((r) => /stand\s?up/i.test(r.filename));
    return match ?? null;
  }

  private async getDetail(recordingId: string): Promise<PlaudDetailResponse> {
    return this.request<PlaudDetailResponse>(`/file/detail/${encodeURIComponent(recordingId)}`);
  }

  /** Full timestamped transcript as plain text. Empty string if not transcribed yet. */
  async getTranscript(recordingId: string): Promise<string> {
    const detail = await this.getDetail(recordingId);
    const paragraphs = detail.trans_result?.paragraphs ?? [];
    if (paragraphs.length === 0) return '';
    return paragraphs
      .map((p) => {
        const t = Number(p.start_time ?? 0);
        const mm = String(Math.floor(t / 60)).padStart(2, '0');
        const ss = String(Math.floor(t % 60)).padStart(2, '0');
        const speaker = p.speaker ? `${p.speaker}: ` : '';
        return `[${mm}:${ss}] ${speaker}${(p.content ?? '').trim()}`;
      })
      .join('\n');
  }

  /** AI-generated notes/summary as markdown. Empty string if not summarised yet. */
  async getNotes(recordingId: string): Promise<string> {
    const detail = await this.getDetail(recordingId);
    const ai = detail.ai_content;
    if (!ai) return '';
    const parts: string[] = [];
    if (ai.summary?.trim()) parts.push(ai.summary.trim());
    if (ai.highlights?.length) {
      parts.push('### Highlights\n' + ai.highlights.map((h) => `- ${h}`).join('\n'));
    }
    if (ai.key_points?.length) {
      parts.push('### Key points\n' + ai.key_points.map((k) => `- ${k}`).join('\n'));
    }
    return parts.join('\n\n');
  }
}
