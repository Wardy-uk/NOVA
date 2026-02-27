import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDb, initializeSchema, saveDb } from './db/schema.js';
import { TaskQueries, RitualQueries, DeliveryQueries, CrmQueries, TeamQueries, UserSettingsQueries, FeedbackQueries, OnboardingConfigQueries, OnboardingRunQueries, MilestoneQueries } from './db/queries.js';
import { FileUserQueries } from './db/user-store.js';
import { FileSettingsQueries } from './db/settings-store.js';
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
import { createAdminRoutes } from './routes/admin.js';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createOnboardingConfigRoutes } from './routes/onboarding-config.js';
import { createOnboardingRoutes } from './routes/onboarding.js';
import { createMilestoneRoutes, resyncAllMilestoneTasks } from './routes/milestones.js';
import { JiraRestClient } from './services/jira-client.js';
import { OnboardingOrchestrator } from './services/onboarding-orchestrator.js';
import { authMiddleware, createAreaAccessGuard } from './middleware/auth.js';
import type { CustomRole } from './middleware/auth.js';
import crypto from 'crypto';
import { generateMorningBriefing } from './services/ai-standup.js';
import { INTEGRATIONS, buildMcpConfig } from './services/integrations.js';
import { OneDriveWatcher } from './services/onedrive-watcher.js';
import { SharePointSync } from './services/sharepoint-sync.js';
import { Dynamics365Service } from './services/dynamics365.js';
import { createDynamics365Routes } from './routes/dynamics365.js';
import { EntraSsoService } from './services/entra-sso.js';

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
  const settingsQueries = new FileSettingsQueries();
  const ritualQueries = new RitualQueries(db);
  const deliveryQueries = new DeliveryQueries(db);
  // Auto-assign onboarding IDs to any entries missing them
  const backfilled = deliveryQueries.backfillOnboardingIds();
  if (backfilled > 0) console.log(`[N.O.V.A] Backfilled ${backfilled} onboarding IDs`);
  const crmQueries = new CrmQueries(db);
  const userQueries = new FileUserQueries();
  const teamQueries = new TeamQueries(db);
  const userSettingsQueries = new UserSettingsQueries(db);
  const feedbackQueries = new FeedbackQueries(db);
  const onboardingConfigQueries = new OnboardingConfigQueries(db);
  const onboardingRunQueries = new OnboardingRunQueries(db);
  const milestoneQueries = new MilestoneQueries(db);

  // Purge transient MS365 data from previous session
  const purgedCount = taskQueries.deleteTransientTasks();
  if (purgedCount > 0) console.log(`[Startup] Purged ${purgedCount} transient tasks from previous session`);

  // Re-sync milestone task priorities on startup
  resyncAllMilestoneTasks(milestoneQueries, taskQueries);
  saveDb();

  // Auto-seed onboarding matrix from xlsx if tables are empty
  if (onboardingConfigQueries.getAllSaleTypes().length === 0) {
    const xlsxPath = path.resolve('OnboardingMatix.xlsx');
    if (fs.existsSync(xlsxPath)) {
      try {
        const XLSX = (await import('xlsx')).default;
        const { importFromWorkbook } = await import('./routes/onboarding-config.js');
        const wb = XLSX.readFile(xlsxPath);
        const stats = importFromWorkbook(wb, onboardingConfigQueries);
        console.log(`[N.O.V.A] Auto-seeded onboarding matrix: ${stats.ticketGroups} ticket groups, ${stats.saleTypes} sale types, ${stats.capabilities} capabilities, ${stats.matrixCells} matrix cells, ${stats.items} items`);
      } catch (err) {
        console.error('[N.O.V.A] Onboarding auto-seed failed:', err instanceof Error ? err.message : err);
      }
    }
  }

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

  // Resolve uvx path — platform-aware candidate search
  const uvxCandidates: string[] = [];
  if (process.platform === 'win32') {
    uvxCandidates.push(
      path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe/uvx.exe'),
      path.join(process.env.USERPROFILE ?? '', '.local/bin/uvx.exe'),
    );
  }
  const userHome = process.env.HOME || process.env.USERPROFILE || '';
  uvxCandidates.push(path.join(userHome, '.local/bin/uvx'));
  let uvxCommand = 'uvx';
  for (const candidate of uvxCandidates) {
    if (candidate && fs.existsSync(candidate)) {
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
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off for SPA
  app.use(cors());
  app.use(express.json());

  // Rate limit login attempts (15 per 15 min window)
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many login attempts. Try again in 15 minutes.' },
  });

  // Entra SSO service
  const ssoService = new EntraSsoService(() => settingsQueries.getAll());

  // Area access guard for custom role-based route protection
  const requireAreaAccess = createAreaAccessGuard(() => {
    const raw = settingsQueries.get('custom_roles');
    try {
      if (raw) return JSON.parse(raw) as CustomRole[];
    } catch { /* ignore */ }
    return [];
  });

  // Public API routes (no auth required)
  app.post('/api/auth/login', loginLimiter);
  app.post('/api/auth/register', loginLimiter);
  app.use('/api/auth', createAuthRoutes(userQueries, jwtSecret, ssoService, settingsQueries));

  // Debug endpoints are registered after auth middleware below (admin-only)

  // Dynamics 365 — direct Web API with delegated auth (device code flow)
  let d365Service: Dynamics365Service | null = null;
  function buildD365Service() {
    const s = settingsQueries.getAll();
    if (s.d365_enabled === 'true' && s.d365_client_id && s.d365_tenant_id) {
      d365Service = new Dynamics365Service({
        clientId: s.d365_client_id,
        tenantId: s.d365_tenant_id,
      });
      console.log('[N.O.V.A] Dynamics 365: Service configured (device code auth)');
    } else {
      d365Service = null;
    }
  }
  buildD365Service();

  // Protected API routes
  app.use('/api', authMiddleware(jwtSecret));
  app.use('/api/tasks', createTaskRoutes(taskQueries, aggregator, milestoneQueries));
  app.use('/api/health', createHealthRoutes(mcpManager));
  app.use('/api/settings', createSettingsRoutes(settingsQueries, userSettingsQueries, (key) => {
    // Restart sync timers when interval settings change
    if (key.includes('interval_minutes')) restartSyncTimers();
    // Rebuild D365 service when credentials change
    if (key.startsWith('d365_')) buildD365Service();
  }));
  app.use('/api/integrations', createIntegrationRoutes(mcpManager, settingsQueries, uvxCommand, () => d365Service, (key) => {
    if (key.startsWith('d365_')) buildD365Service();
  }));
  app.use('/api/ingest', createIngestRoutes(taskQueries, settingsQueries));
  app.use('/api/actions', createActionRoutes(taskQueries, settingsQueries, userSettingsQueries));
  app.use('/api/jira', createJiraRoutes(mcpManager, taskQueries));
  app.use('/api/standups', createStandupRoutes(taskQueries, settingsQueries, ritualQueries, userSettingsQueries));
  const spSync = new SharePointSync(mcpManager, deliveryQueries, () => settingsQueries.getAll());
  app.use('/api/delivery', createDeliveryRoutes(deliveryQueries, spSync, milestoneQueries, taskQueries, requireAreaAccess));
  app.use('/api/milestones', createMilestoneRoutes(milestoneQueries, deliveryQueries, taskQueries));
  app.use('/api/crm', createCrmRoutes(crmQueries, deliveryQueries, onboardingRunQueries, requireAreaAccess));
  app.use('/api/o365', createO365Routes(mcpManager));
  app.use('/api/admin', createAdminRoutes(userQueries, teamQueries, userSettingsQueries, settingsQueries));
  app.use('/api/dynamics365', createDynamics365Routes(() => d365Service, crmQueries));
  app.use('/api/feedback', createFeedbackRoutes(feedbackQueries, taskQueries));

  // DELETE /api/data/source/:source — purge local records for a given integration source
  app.delete('/api/data/source/:source', (req, res) => {
    const source = req.params.source;
    const validSources = ['jira', 'planner', 'todo', 'calendar', 'email', 'monday', 'dynamics365'];
    if (!validSources.includes(source)) {
      res.status(400).json({ ok: false, error: `Invalid source: ${source}. Valid: ${validSources.join(', ')}` });
      return;
    }
    try {
      let deleted = 0;
      if (source === 'dynamics365') {
        deleted = crmQueries.deleteAllCustomers();
      } else {
        deleted = taskQueries.deleteAllBySource(source);
      }
      res.json({ ok: true, deleted });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });
  app.use('/api/onboarding/config', createOnboardingConfigRoutes(onboardingConfigQueries, requireAreaAccess));

  // Debug endpoints (admin-only, behind auth)
  app.get('/api/debug/tools', (req, res, next) => {
    if (req.user?.role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    next();
  }, async (_req, res) => {
    try {
      const server = (mcpManager as any).servers.get('msgraph');
      if (!server?.client) { res.json({ error: 'msgraph not connected' }); return; }
      const { tools } = await server.client.listTools();
      const spTools = tools.filter((t: any) =>
        t.name.includes('sharepoint') || t.name.includes('drive') || t.name.includes('download') || t.name.includes('list-folder')
      );
      res.json({ count: spTools.length, tools: spTools.map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    } catch (err: any) { res.json({ error: err.message }); }
  });

  app.get('/api/debug/sp-probe', (req, res, next) => {
    if (req.user?.role !== 'admin') { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    next();
  }, async (req, res) => {
    try {
      const tool = String(req.query.tool || 'list-drives');
      const argsStr = String(req.query.args || '{}');
      const args = JSON.parse(argsStr);
      console.log(`[SP-Probe] Calling ${tool} with`, args);
      const result = await mcpManager.callTool('msgraph', tool, args);
      res.json({ ok: true, tool, args, result });
    } catch (err: any) {
      res.json({ ok: false, error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
    }
  });

  // Onboarding ticket orchestrator — lazy JiraRestClient from settings
  function buildJiraClient(): JiraRestClient | null {
    const s = settingsQueries.getAll();
    // Prefer dedicated onboarding credentials
    if (s.jira_ob_enabled === 'true' && s.jira_ob_url && s.jira_ob_email && s.jira_ob_token) {
      return new JiraRestClient({ baseUrl: s.jira_ob_url, email: s.jira_ob_email, apiToken: s.jira_ob_token });
    }
    // Fallback to personal Jira creds
    if (s.jira_enabled !== 'true' || !s.jira_url || !s.jira_username || !s.jira_token) return null;
    return new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token });
  }
  function buildOrchestrator(): OnboardingOrchestrator | null {
    const client = buildJiraClient();
    if (!client) return null;
    return new OnboardingOrchestrator(client, onboardingConfigQueries, onboardingRunQueries, () => settingsQueries.getAll());
  }
  app.use('/api/onboarding', createOnboardingRoutes(buildOrchestrator, buildJiraClient, onboardingRunQueries));

  // 6. OneDrive file watcher (Power Automate bridge)
  const watcher = new OneDriveWatcher(taskQueries, settingsQueries);
  watcher.start();

  app.get('/api/onedrive/status', (_req, res) => {
    res.json({ ok: true, data: watcher.getStatus() });
  });

  // Production: serve built Vite frontend
  if (isProduction) {
    const clientDist = path.resolve(__dirname, '../../client');
    app.use(express.static(clientDist));
    app.get('{*path}', (_req, res) => {
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

  // Periodic auto-save: flush in-memory sql.js database to disk every 30s
  const autoSaveTimer = setInterval(() => {
    try { saveDb(); } catch (err) {
      console.error('[AutoSave] Failed:', err instanceof Error ? err.message : err);
    }
  }, 30_000);

  // Also save after the initial auto-seed completes
  saveDb();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[N.O.V.A] Shutting down...');
    clearInterval(autoSaveTimer);
    for (const timer of syncTimers.values()) clearInterval(timer);
    watcher.stop();
    try { saveDb(); console.log('[N.O.V.A] Database saved to disk'); } catch (err) {
      console.error('[N.O.V.A] Failed to save DB on shutdown:', err instanceof Error ? err.message : err);
    }
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
