import fs from 'fs';
import path from 'path';
import type { TaskQueries } from '../db/queries.js';
import type { SettingsQueries } from '../db/settings-store.js';
import { saveDb } from '../db/schema.js';

const VALID_SOURCES = ['planner', 'todo', 'calendar', 'email'];
const POLL_INTERVAL = 30_000; // 30 seconds

function buildSourceUrl(source: string, sourceId: string): string | undefined {
  switch (source) {
    case 'planner':
      return `https://planner.cloud.microsoft/Home/Task/${sourceId}`;
    case 'todo':
      return `https://to-do.office.com/tasks/id/${sourceId}/details`;
    default:
      return undefined;
  }
}

export class OneDriveWatcher {
  private watchDir: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastModified = new Map<string, number>();
  private lastScanAt: string | null = null;
  private lastIngestAt: string | null = null;
  private lastIngestFile: string | null = null;
  private lastIngestSource: string | null = null;
  private lastError: string | null = null;

  constructor(
    private taskQueries: TaskQueries,
    private settingsQueries?: SettingsQueries,
    watchDir?: string
  ) {
    // Default: OneDrive Business folder / DayPilot
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    this.watchDir = watchDir ?? (process.env.ONEDRIVE_WATCH_DIR || path.join(userHome, 'OneDrive - Nurtur Limited', 'DayPilot'));
  }

  start(): void {
    // Create watch dir if it doesn't exist
    if (!fs.existsSync(this.watchDir)) {
      try {
        fs.mkdirSync(this.watchDir, { recursive: true });
        console.log(`[OneDrive] Created watch folder: ${this.watchDir}`);
      } catch (err) {
        this.lastError = `Cannot create watch folder: ${this.watchDir}`;
        console.warn(`[OneDrive] Cannot create watch folder: ${this.watchDir}`, err);
        return;
      }
    }

    console.log(`[OneDrive] Watching: ${this.watchDir}`);

    // Initial scan
    this.scanFolder();

    // Poll for changes (fs.watch is unreliable with OneDrive sync)
    this.timer = setInterval(() => this.scanFolder(), POLL_INTERVAL);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): {
    watchDir: string;
    lastScanAt: string | null;
    lastIngestAt: string | null;
    lastIngestFile: string | null;
    lastIngestSource: string | null;
    lastError: string | null;
  } {
    return {
      watchDir: this.watchDir,
      lastScanAt: this.lastScanAt,
      lastIngestAt: this.lastIngestAt,
      lastIngestFile: this.lastIngestFile,
      lastIngestSource: this.lastIngestSource,
      lastError: this.lastError,
    };
  }

  private scanFolder(): void {
    this.lastScanAt = new Date().toISOString();
    let files: string[];
    try {
      files = fs.readdirSync(this.watchDir).filter(f => f.endsWith('.json'));
    } catch {
      this.lastError = `Cannot read watch folder: ${this.watchDir}`;
      return; // Folder may not exist yet
    }

    for (const file of files) {
      const filePath = path.join(this.watchDir, file);
      try {
        const stat = fs.statSync(filePath);
        const lastMod = stat.mtimeMs;

        // Skip if not modified since last scan
        if (this.lastModified.get(file) === lastMod) continue;
        this.lastModified.set(file, lastMod);

        this.processFile(filePath, file);
      } catch (err) {
        console.warn(`[OneDrive] Error reading ${file}:`, err);
      }
    }
  }

  // Extract description from various source field formats
  private extractDescription(item: Record<string, unknown>, source: string): string | undefined {
    // Already has description
    if (item.description && typeof item.description === 'string') return item.description;

    // To-Do: body.content (HTML or text)
    const body = item.body as Record<string, unknown> | undefined;
    if (body?.content && typeof body.content === 'string') {
      return this.stripHtml(body.content);
    }

    // Planner: may have description or notes field
    if (item.notes && typeof item.notes === 'string') return item.notes;

    // Calendar: bodyPreview or body.content
    if (item.bodyPreview && typeof item.bodyPreview === 'string') return item.bodyPreview as string;

    // Email: bodyPreview
    if (source === 'email' && item.bodyPreview) return item.bodyPreview as string;

    return undefined;
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Map raw Outlook/Graph fields to our normalized task shape
  private normalizeRawItem(item: Record<string, unknown>, source: string): Record<string, unknown> {
    // If already has source_id + title, add description if missing and return
    if (item.source_id && item.title) {
      if (!item.description) {
        item.description = this.extractDescription(item, source);
      }
      return item;
    }

    // Calendar events: subject → title, id → source_id
    if (source === 'calendar') {
      return {
        source_id: item.id as string,
        title: item.subject as string,
        description: this.extractDescription(item, source),
        status: 'open',
        priority: 40,
        due_date: item.startWithTimeZone ?? item.start ?? undefined,
        source_url: item.webLink as string ?? undefined,
      };
    }

    // Email: subject → title, id → source_id
    if (source === 'email') {
      return {
        source_id: item.id as string,
        title: item.subject as string,
        description: this.extractDescription(item, source),
        status: 'open',
        priority: (item.importance === 'high') ? 75 : 45,
        source_url: item.webLink as string ?? undefined,
      };
    }

    // Fallback: try common field names
    return {
      source_id: (item.source_id ?? item.id) as string,
      title: (item.title ?? item.subject ?? item.name) as string,
      description: this.extractDescription(item, source),
      status: (item.status as string) ?? 'open',
      priority: item.priority ?? 50,
      due_date: item.due_date ?? item.dueDateTime ?? undefined,
    };
  }

  private processFile(filePath: string, fileName: string): void {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      // Support two formats:
      // 1. Wrapped: { source: "calendar", tasks: [...] }
      // 2. Raw array: [ { id, subject, ... } ] — infer source from filename
      let source: string;
      let tasks: unknown[];

      if (Array.isArray(data)) {
        // Raw array — infer source from filename (e.g. "calendar.json" → "calendar")
        source = fileName.replace(/\.json$/i, '').toLowerCase();
        // Handle common typos
        if (source === 'calender') source = 'calendar';
        tasks = data;
      } else {
        source = data.source;
        tasks = data.tasks;
      }

      if (!source || !VALID_SOURCES.includes(source)) {
        console.warn(`[OneDrive] ${fileName}: Invalid source "${source}"`);
        return;
      }

      // Check if PA bridge is disabled globally
      if (this.settingsQueries?.get('pa_bridge_enabled') === 'false') {
        console.log(`[OneDrive] ${fileName}: Skipped — PA bridge disabled`);
        return;
      }

      // Check if this source is enabled in settings
      if (this.settingsQueries?.get(`sync_${source}_enabled`) === 'false') {
        console.log(`[OneDrive] ${fileName}: Skipped — ${source} sync disabled`);
        return;
      }

      if (!Array.isArray(tasks)) {
        console.warn(`[OneDrive] ${fileName}: "tasks" is not an array`);
        return;
      }

      // Normalize raw items to our task shape
      const normalized = tasks.map(t => this.normalizeRawItem(t as Record<string, unknown>, source));

      // Upsert tasks
      const freshIds: string[] = [];
      for (const task of normalized) {
        const t = task as Record<string, unknown>;
        if (!t.source_id || !t.title) continue;
        t.source = source; // Ensure source matches

        // Normalize status — handle Planner (percentComplete) and To-Do (text) formats
        if (t.status !== undefined) {
          const s = String(t.status).toLowerCase();
          if (s === '100' || s === 'completed') { continue; } // Skip completed
          if (s === '0' || s === '' || s === 'notstarted') { t.status = 'open'; }
          else if (s === 'inprogress' || (/^\d+$/.test(s) && parseInt(s) > 0)) { t.status = 'in_progress'; }
          else if (s === 'waitingonothers' || s === 'deferred') { t.status = 'open'; }
        }

        // Normalize priority — PA may send empty string or raw number string
        if (t.priority === '' || t.priority === undefined || t.priority === null) {
          t.priority = 50;
        } else if (typeof t.priority === 'string') {
          const p = parseInt(t.priority);
          t.priority = isNaN(p) ? 50 : p;
        }

        // Construct source URL if not provided
        if (!t.source_url) {
          t.source_url = buildSourceUrl(source, t.source_id as string);
        }

        this.taskQueries.upsertFromSource(t as { source: string; source_id: string; title: string; [key: string]: unknown }, { deferSave: true });
        freshIds.push(`${source}:${t.source_id}`);
      }

      // Clean up stale tasks for this source
      const removed = normalized.length > 0
        ? this.taskQueries.deleteStaleBySource(source, freshIds, { deferSave: true })
        : 0;

      if (normalized.length > 0 || removed > 0) {
        saveDb();
      }

      this.lastIngestAt = new Date().toISOString();
      this.lastIngestFile = fileName;
      this.lastIngestSource = source;
      this.lastError = null;

      console.log(
        `[OneDrive] ${fileName}: ${normalized.length} tasks ingested, ${removed} stale removed`
      );

      // Delete file after successful processing so PA flow can re-create it
      try {
        fs.unlinkSync(filePath);
        this.lastModified.delete(fileName);
        console.log(`[OneDrive] ${fileName}: Deleted after processing`);
      } catch {
        console.warn(`[OneDrive] ${fileName}: Could not delete (may be locked by OneDrive)`);
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[OneDrive] ${fileName}: Parse error —`, err);
    }
  }
}
