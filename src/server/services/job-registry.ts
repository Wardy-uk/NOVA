export interface RegisteredJob {
  id: string;
  name: string;
  intervalMs: number;
  lastRun: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  runCount: number;
  errorCount: number;
  enabled: boolean;
  running: boolean;
}

interface JobEntry extends RegisteredJob {
  fn: () => Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
}

export class JobRegistry {
  private jobs = new Map<string, JobEntry>();

  register(id: string, name: string, fn: () => Promise<void>, intervalMs: number): void {
    if (this.jobs.has(id)) {
      console.warn(`[job-registry] Job "${id}" already registered — skipping`);
      return;
    }
    const entry: JobEntry = {
      id,
      name,
      intervalMs,
      fn,
      timer: null,
      lastRun: null,
      lastDurationMs: null,
      lastError: null,
      runCount: 0,
      errorCount: 0,
      enabled: true,
      running: false,
    };
    this.jobs.set(id, entry);
    this.startTimer(entry);
  }

  start(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.enabled = true;
    if (!job.timer) this.startTimer(job);
  }

  stop(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.enabled = false;
    if (job.timer) {
      clearInterval(job.timer);
      job.timer = null;
    }
  }

  pauseAll(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) {
        clearInterval(job.timer);
        job.timer = null;
      }
      job.enabled = false;
    }
  }

  resumeAll(): void {
    for (const job of this.jobs.values()) {
      job.enabled = true;
      if (!job.timer) this.startTimer(job);
    }
  }

  async runNow(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job "${id}" not found`);
    await this.executeJob(job);
  }

  getStatus(): RegisteredJob[] {
    return [...this.jobs.values()].map(({ fn, timer, ...rest }) => rest);
  }

  getJob(id: string): RegisteredJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const { fn, timer, ...rest } = job;
    return rest;
  }

  private startTimer(entry: JobEntry): void {
    entry.timer = setInterval(() => {
      if (!entry.enabled || entry.running) return;
      this.executeJob(entry).catch(() => {});
    }, entry.intervalMs);
  }

  private async executeJob(entry: JobEntry): Promise<void> {
    if (entry.running) return;
    entry.running = true;
    const start = Date.now();
    try {
      await entry.fn();
      entry.lastRun = new Date();
      entry.lastDurationMs = Date.now() - start;
      entry.lastError = null;
      entry.runCount++;
    } catch (err) {
      entry.lastRun = new Date();
      entry.lastDurationMs = Date.now() - start;
      entry.lastError = err instanceof Error ? err.message : String(err);
      entry.runCount++;
      entry.errorCount++;
      console.warn(`[job-registry] Job "${entry.id}" failed:`, entry.lastError);
    } finally {
      entry.running = false;
    }
  }
}
