import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDb, initializeSchema } from './db/schema.js';
import { TaskQueries, SettingsQueries, RitualQueries, DeliveryQueries, CrmQueries, UserQueries } from './db/queries.js';
import { McpClientManager } from './services/mcp-client.js';
import { TaskAggregator } from './services/aggregator.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createHealthRoutes } from './routes/health.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createIntegrationRoutes } from './routes/integrations.js';
import { createIngestRoutes } from './routes/ingest.js';
import { createActionRoutes } from './routes/actions.js';
import { createJiraRoutes } from './routes/jira.js';
import { createStandupRoutes } from './routes/standups.js';
import { createDeliveryRoutes } from './routes/delivery.js';
import { createCrmRoutes } from './routes/crm.js';
import { createAuthRoutes } from './routes/auth.js';
import { createO365Routes } from './routes/o365.js';
import { authMiddleware } from './middleware/auth.js';
import crypto from 'crypto';
import { generateMorningBriefing } from './services/ai-standup.js';
import { INTEGRATIONS, buildMcpConfig } from './services/integrations.js';
import { OneDriveWatcher } from './services/onedrive-watcher.js';
import { SharePointSync } from './services/sharepoint-sync.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const isProduction = process.env.NODE_ENV === 'production';

async function main() {
  // 1. Database
  console.log('[N.O.V.A] Initializing database...');
  const db = await getDb();
  initializeSchema(db);

  const taskQueries = new TaskQueries(db);
  const settingsQueries = new SettingsQueries(db);
  const ritualQueries = new RitualQueries(db);
  const deliveryQueries = new DeliveryQueries(db);
  const crmQueries = new CrmQueries(db);
  const userQueries = new UserQueries(db);

  // JWT secret — use env, or persist a random one in settings
  let jwtSecret = process.env.JWT_SECRET ?? settingsQueries.get('jwt_secret');
  if (!jwtSecret) {
    jwtSecret = crypto.randomBytes(32).toString('hex');
    settingsQueries.set('jwt_secret', jwtSecret);
    console.log('[N.O.V.A] Generated and saved JWT secret');
  }

  // 2. MCP Client Manager
  console.log('[N.O.V.A] Setting up MCP servers...');
  const mcpManager = new McpClientManager();

  // Resolve uvx path — winget installs to a non-PATH location
  const uvxCandidates = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uvx.exe'),
    path.join(process.env.USERPROFILE ?? '', '.local/bin/uvx.exe'),
    path.join(process.env.USERPROFILE ?? '', '.local/bin/uvx'),
  ];
  let uvxCommand = 'uvx';
  for (const candidate of uvxCandidates) {
    if (fs.existsSync(candidate)) {
      uvxCommand = candidate;
      console.log(`[N.O.V.A] Found uvx at: ${candidate}`);
      break;
    }
  }

  // Seed credentials from .env on first run (backward compat)
  if (settingsQueries.get('jira_enabled') === null) {
    if (process.env.JIRA_URL && process.env.JIRA_PERSONAL_TOKEN) {
      settingsQueries.set('jira_enabled', 'true');
      settingsQueries.set('jira_url', process.env.JIRA_URL);
      settingsQueries.set('jira_token', process.env.JIRA_PERSONAL_TOKEN);
    }
    if (process.env.MONDAY_API_TOKEN) {
      settingsQueries.set('monday_enabled', 'true');
      settingsQueries.set('monday_token', process.env.MONDAY_API_TOKEN);
      settingsQueries.set('monday_board_ids', process.env.MONDAY_BOARD_IDS ?? '');
    }
  }

  // Seed OpenAI API key from env if not already in DB
  if (!settingsQueries.get('openai_api_key')?.trim()) {
    const envKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY;
    if (envKey?.trim()) {
      settingsQueries.set('openai_api_key', envKey.trim());
      console.log('[N.O.V.A] Seeded OpenAI API key from environment');
    }
  }

  // Register enabled integrations from DB settings
  const settings = settingsQueries.getAll();
  for (const integ of INTEGRATIONS) {
    if (settings[integ.enabledKey] !== 'true') continue;
    const hasRequired = integ.fields.filter(f => f.required).every(f => settings[f.key]?.trim());
    if (!hasRequired) {
      console.log(`[N.O.V.A] ${integ.name}: Enabled but missing required credentials`);
      continue;
    }
    const config = buildMcpConfig(integ.id, settings, uvxCommand);
    if (config) {
      mcpManager.registerServer(integ.id, config);
      console.log(`[N.O.V.A] ${integ.name}: Registered`);
    }
  }

  // Attempt connections (non-blocking)
  mcpManager.connectAll().catch((err) =>
    console.error('[Startup] MCP connection error:', err)
  );

  // 3. Aggregator
  const aggregator = new TaskAggregator(mcpManager, taskQueries, settingsQueries);

  // 4. Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Public API routes (no auth required)
  app.use('/api/auth', createAuthRoutes(userQueries, jwtSecret));

  // Protected API routes
  app.use('/api', authMiddleware(jwtSecret));
  app.use('/api/tasks', createTaskRoutes(taskQueries, aggregator));
  app.use('/api/health', createHealthRoutes(mcpManager));
  app.use('/api/settings', createSettingsRoutes(settingsQueries, (key) => {
    // Restart sync timers when interval settings change
    if (key.includes('interval_minutes')) restartSyncTimers();
  }));
  app.use('/api/integrations', createIntegrationRoutes(mcpManager, settingsQueries, uvxCommand));
  app.use('/api/ingest', createIngestRoutes(taskQueries, settingsQueries));
  app.use('/api/actions', createActionRoutes(taskQueries, settingsQueries));
  app.use('/api/jira', createJiraRoutes(mcpManager, taskQueries));
  app.use('/api/standups', createStandupRoutes(taskQueries, settingsQueries, ritualQueries));
  const spSync = new SharePointSync(mcpManager, deliveryQueries);
  app.use('/api/delivery', createDeliveryRoutes(deliveryQueries, spSync));
  app.use('/api/crm', createCrmRoutes(crmQueries));
  app.use('/api/o365', createO365Routes(mcpManager));

  // 6. OneDrive file watcher (Power Automate bridge)
  const watcher = new OneDriveWatcher(taskQueries, settingsQueries);
  watcher.start();

  app.get('/api/onedrive/status', (_req, res) => {
    res.json({ ok: true, data: watcher.getStatus() });
  });

  // Production: serve built Vite frontend
  if (isProduction) {
    const clientDist = path.resolve(__dirname, '../client');
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // 5. Start server
  app.listen(PORT, () => {
    console.log(`[N.O.V.A] API server running on http://localhost:${PORT}`);
    if (!isProduction) {
      console.log(`[N.O.V.A] Frontend dev server: http://localhost:5173`);
    }
  });

  // 7. Auto-sync: per-source timers with individual intervals
  const syncTimers = new Map<string, ReturnType<typeof setInterval>>();
  let lastAutoSync: string | null = null;
  const lastSourceSync: Record<string, string> = {};

  const preloadMorningBriefing = async () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      const existing = ritualQueries.getByDate(todayStr, 'morning');
      if (existing.length > 0) return; // already generated

      const apiKey = settingsQueries.get('openai_api_key')?.trim()
        ?? process.env.OPENAI_API_KEY?.trim()
        ?? process.env.OPENAI_KEY?.trim();
      if (!apiKey) return;

      const tasks = taskQueries.getAll();
      if (tasks.length === 0) return;

      // Get yesterday's ritual for rollover context
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayRituals = ritualQueries.getByDate(
        yesterday.toISOString().split('T')[0], 'morning'
      );

      console.log('[PreLoad] Generating morning briefing in background...');
      const briefing = await generateMorningBriefing(tasks, apiKey, yesterdayRituals[0] ?? null);
      const plannedIds = briefing.top_priorities.map((p) => p.task_id);
      ritualQueries.create({
        type: 'morning',
        date: todayStr,
        summary_md: briefing.summary,
        planned_items: JSON.stringify(plannedIds),
        conversation: JSON.stringify(briefing),
      });
      console.log('[PreLoad] Morning briefing cached');
    } catch (err) {
      console.error('[PreLoad] Failed:', err instanceof Error ? err.message : err);
    }
  };

  const runFullSync = async () => {
    try {
      const results = await aggregator.syncAll();
      const now = new Date().toISOString();
      lastAutoSync = now;
      for (const r of results) lastSourceSync[r.source] = now;
      const total = results.reduce((s, r) => s + r.count, 0);
      const errors = results.filter((r) => r.error);
      console.log(
        `[AutoSync] Synced ${total} tasks from ${results.length} sources` +
          (errors.length > 0 ? ` (${errors.length} errors)` : '')
      );
      // Pre-load morning briefing after sync if not already cached
      preloadMorningBriefing();
    } catch (err) {
      console.error('[AutoSync] Failed:', err instanceof Error ? err.message : err);
    }
  };

  /** Get the sync interval for a specific source, falling back to global default */
  const getSourceInterval = (source: string): number => {
    const perSource = parseInt(settingsQueries.get(`sync_${source}_interval_minutes`) ?? '', 10);
    if (perSource > 0) return perSource;
    return parseInt(settingsQueries.get('refresh_interval_minutes') ?? '5', 10) || 5;
  };

  /** Start (or restart) per-source sync timers */
  const startSyncTimers = () => {
    // Clear all existing timers
    for (const timer of syncTimers.values()) clearInterval(timer);
    syncTimers.clear();

    for (const source of aggregator.sourceNames) {
      const minutes = getSourceInterval(source);
      syncTimers.set(
        source,
        setInterval(async () => {
          try {
            const result = await aggregator.syncSource(source);
            const now = new Date().toISOString();
            lastAutoSync = now;
            lastSourceSync[source] = now;
            if (result.count > 0 || result.error) {
              console.log(
                `[AutoSync:${source}] ${result.error ? 'Error: ' + result.error : 'Synced ' + result.count + ' tasks'}`
              );
            }
          } catch (err) {
            console.error(`[AutoSync:${source}] Failed:`, err instanceof Error ? err.message : err);
          }
        }, minutes * 60 * 1000)
      );
      console.log(`[N.O.V.A] Auto-sync ${source}: every ${minutes} min`);
    }
  };

  /** Restart timers — called when sync interval settings change */
  const restartSyncTimers = () => {
    console.log('[N.O.V.A] Restarting sync timers...');
    startSyncTimers();
  };

  // Initial full sync 5s after startup (let MCP connections establish), then start per-source timers
  setTimeout(() => {
    runFullSync();
    startSyncTimers();
  }, 5000);

  // Expose last sync time + per-source intervals
  app.get('/api/sync/status', (_req, res) => {
    const globalMinutes = parseInt(settingsQueries.get('refresh_interval_minutes') ?? '5', 10) || 5;
    const perSource: Record<string, { intervalMinutes: number; lastSync: string | null }> = {};
    for (const source of aggregator.sourceNames) {
      perSource[source] = {
        intervalMinutes: getSourceInterval(source),
        lastSync: lastSourceSync[source] ?? null,
      };
    }
    res.json({
      ok: true,
      data: { lastAutoSync, globalIntervalMinutes: globalMinutes, sources: perSource },
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[N.O.V.A] Shutting down...');
    for (const timer of syncTimers.values()) clearInterval(timer);
    watcher.stop();
    await mcpManager.disconnectAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[N.O.V.A] Fatal startup error:', err);
  process.exit(1);
});
