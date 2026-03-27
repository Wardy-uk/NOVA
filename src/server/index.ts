import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { getDb, initializeSchema, saveDb, createBackup } from './db/schema.js';
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
import { createNeuroBridgeRoutes } from './routes/neuro-bridge.js';
import { createAdminRoutes } from './routes/admin.js';
import { createKpiDataRoutes, createKpiWallboardRoutes } from './routes/kpi-data.js';
import { createTrendsRoutes } from './routes/trends.js';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createOnboardingConfigRoutes } from './routes/onboarding-config.js';
import { createOnboardingRoutes } from './routes/onboarding.js';
import { createMilestoneRoutes, resyncAllMilestoneTasks } from './routes/milestones.js';
import { SalesQueries } from './db/sales-queries.js';
import { createSalesHotboxRoutes } from './routes/sales-hotbox.js';
import { JiraRestClient } from './services/jira-client.js';
import { OnboardingOrchestrator } from './services/onboarding-orchestrator.js';
import { authMiddleware, createAreaAccessGuard } from './middleware/auth.js';
import type { CustomRole } from './middleware/auth.js';
import { isAdmin } from './utils/role-helpers.js';
import crypto from 'crypto';
import { generateMorningBriefing } from './services/ai-standup.js';
import { INTEGRATIONS, buildMcpConfig } from './services/integrations.js';
import { OneDriveWatcher } from './services/onedrive-watcher.js';
import { SharePointSync } from './services/sharepoint-sync.js';
import { Dynamics365Service } from './services/dynamics365.js';
import { createDynamics365Routes } from './routes/dynamics365.js';
import { EntraSsoService } from './services/entra-sso.js';
import { MilestoneWorkflowEngine } from './services/milestone-workflow.js';
import { AuditQueries } from './db/audit.js';
import { createAuditRoutes } from './routes/audit.js';
import { createTeamRoutes } from './routes/team.js';
import { createChatRoutes } from './routes/chat.js';
import { JiraOAuthService } from './services/jira-oauth.js';
import { NotificationQueries } from './db/notifications.js';
import { NotificationEngine } from './services/notification-engine.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { ProblemTicketQueries, InstanceSetupQueries, BranchQueries, BrandSettingsQueries, LogoQueries, SetupExecutionQueries, SetupPortalQueries, PortalAccountQueries, BranchDistrictQueries, WelcomePackQueries } from './db/queries.js';
import { createInstanceSetupRoutes } from './routes/instance-setup.js';
import { createBranchRoutes } from './routes/branches.js';
import { createBrandSettingsRoutes } from './routes/brand-settings.js';
import { createLogoRoutes } from './routes/logos.js';
import { ProblemTicketScanner } from './services/problem-ticket-scanner.js';
import { createProblemTicketRoutes } from './routes/problem-tickets.js';
import { AzDoClient } from './services/azdo-client.js';
import { BymClient } from './services/bym-client.js';
import { SetupOrchestrator } from './services/setup-orchestrator.js';
import { createAzDoRoutes } from './routes/azdo.js';
import { createSetupExecutionRoutes } from './routes/setup-execution.js';
import { createSetupPortalPublicRoutes, createSetupPortalRoutes } from './routes/setup-portal.js';
import { createBackfillRoutes } from './routes/backfill.js';
import { logWallboard, getWallboardLogs, clearWallboardLogs } from './services/wallboard-logger.js';

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
  const salesQueries = new SalesQueries(db);
  const userQueries = new FileUserQueries();
  const teamQueries = new TeamQueries(db);
  const userSettingsQueries = new UserSettingsQueries(db);
  const feedbackQueries = new FeedbackQueries(db);
  const onboardingConfigQueries = new OnboardingConfigQueries(db);
  const onboardingRunQueries = new OnboardingRunQueries(db);
  const milestoneQueries = new MilestoneQueries(db);
  const auditQueries = new AuditQueries(db);
  const notificationQueries = new NotificationQueries(db);
  const notificationEngine = new NotificationEngine(notificationQueries, milestoneQueries, deliveryQueries, taskQueries);
  const problemTicketQueries = new ProblemTicketQueries(db);
  const instanceSetupQueries = new InstanceSetupQueries(db);
  const branchQueries = new BranchQueries(db);
  const brandSettingsQueries = new BrandSettingsQueries(db);
  const logoQueries = new LogoQueries(db);
  const execQueries = new SetupExecutionQueries(db);
  const portalQueries = new SetupPortalQueries(db);
  const portalAccountQueries = new PortalAccountQueries(db);
  const districtQueries = new BranchDistrictQueries(db);
  const welcomePackQueries = new WelcomePackQueries(db);

  // Purge transient MS365 data from previous session
  const purgedCount = taskQueries.deleteTransientTasks();
  if (purgedCount > 0) console.log(`[Startup] Purged ${purgedCount} transient tasks from previous session`);

  // Build onboarder name → user ID lookup for milestone ownership
  const onboarderToUserId = new Map<string, number>();
  for (const u of userQueries.getAll()) {
    onboarderToUserId.set(u.username.toLowerCase(), u.id);
    if (u.display_name) onboarderToUserId.set(u.display_name.toLowerCase(), u.id);
  }

  // Re-sync milestone task priorities on startup (with per-onboarder ownership)
  resyncAllMilestoneTasks(milestoneQueries, taskQueries, onboarderToUserId);
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

  // Ensure "Delivery QA" ticket group exists (used for the parent QA ticket)
  const existingGroups = onboardingConfigQueries.getAllTicketGroups();
  if (!existingGroups.find(g => g.name === 'Delivery QA')) {
    onboardingConfigQueries.createTicketGroup('Delivery QA', -1);
    console.log('[N.O.V.A] Auto-seeded "Delivery QA" ticket group');
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
  // Onboarding/Admin Jira client — uses Admin > Jira (Global) credentials only.
  // For ticket creation, service desk shared views, problem scanner.
  function buildOnboardingJiraClient(): JiraRestClient | null {
    const s = settingsQueries.getAll();
    if (s.jira_ob_enabled !== 'true' || !s.jira_ob_email || !s.jira_ob_token) {
      console.log(`[OnboardingClient] Not configured: enabled=${s.jira_ob_enabled}, email=${!!s.jira_ob_email}, token=${!!s.jira_ob_token}`);
      return null;
    }
    // Prefer Cloud ID (api.atlassian.com gateway) — jira_ob_url is for browse links only
    if (s.jira_ob_cloud_id) {
      console.log(`[OnboardingClient] Using Cloud ID: ${s.jira_ob_cloud_id.slice(0, 8)}...`);
      return new JiraRestClient({ cloudId: s.jira_ob_cloud_id, email: s.jira_ob_email, apiToken: s.jira_ob_token });
    }
    // Fallback to direct URL if no Cloud ID configured
    if (s.jira_ob_url) {
      console.log(`[OnboardingClient] Using direct URL: ${s.jira_ob_url}`);
      return new JiraRestClient({ baseUrl: s.jira_ob_url, email: s.jira_ob_email, apiToken: s.jira_ob_token });
    }
    console.log(`[OnboardingClient] No Cloud ID or URL configured`);
    return null;
  }

  // Service desk Jira client — uses seeded personal creds from global settings.
  // Used by aggregator for service desk searches (filter=mine/all/unassigned).
  function buildServiceDeskJiraClient(): JiraRestClient | null {
    const s = settingsQueries.getAll();
    // Use seeded personal creds (jira_url/jira_username/jira_token in global settings)
    if (s.jira_enabled === 'true' && s.jira_url && s.jira_username && s.jira_token) {
      return new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token });
    }
    // Fallback to onboarding creds for service desk
    return buildOnboardingJiraClient();
  }

  const aggregator = new TaskAggregator(mcpManager, taskQueries, settingsQueries, buildServiceDeskJiraClient);

  // 4. Express app
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off for SPA
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));

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
  const jiraOAuthService = new JiraOAuthService(() => settingsQueries.getAll());

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
  app.use('/api/auth', createAuthRoutes(userQueries, jwtSecret, ssoService, settingsQueries, jiraOAuthService, userSettingsQueries));

  // Customer setup portal — public routes (token-validated, no NOVA auth)
  const portalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please try again shortly.' },
  });
  app.use('/api/public/setup', portalLimiter, createSetupPortalPublicRoutes(portalQueries, brandSettingsQueries, branchQueries, logoQueries, deliveryQueries, portalAccountQueries, districtQueries));

  // KPI Wallboard — public route for TV displays (no auth required)
  app.use('/api/public/wallboard', createKpiWallboardRoutes(settingsQueries));

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

  // Azure DevOps — direct REST with PAT
  let azdoClient: AzDoClient | null = null;
  function buildAzDoService() {
    const s = settingsQueries.getAll();
    if (s.azdo_enabled === 'true' && s.azdo_org && s.azdo_pat) {
      azdoClient = new AzDoClient({
        org: s.azdo_org,
        project: s.azdo_project || s.azdo_org,
        repo: s.azdo_repo || s.azdo_project || s.azdo_org,
        pat: s.azdo_pat,
        baseBranch: s.azdo_base_branch || undefined,
      });
      console.log('[N.O.V.A] Azure DevOps: Service configured');
    } else {
      azdoClient = null;
    }
  }
  buildAzDoService();

  // BriefYourMarket — direct API client
  let bymClient: BymClient | null = null;
  function buildBymService() {
    const s = settingsQueries.getAll();
    if (s.bym_enabled === 'true' && s.bym_api_key && s.bym_url_template && s.bym_build_api_url && s.bym_image_url) {
      bymClient = new BymClient({
        apiKey: s.bym_api_key,
        urlTemplate: s.bym_url_template,
        buildApiUrl: s.bym_build_api_url,
        imageServiceUrl: s.bym_image_url,
      });
      console.log('[N.O.V.A] BriefYourMarket Setup: Service configured');
    } else {
      bymClient = null;
    }
  }
  buildBymService();

  // Setup orchestrator — coordinates direct BYM API execution
  const setupOrchestrator = new SetupOrchestrator({
    getBym: () => bymClient,
    branchQueries,
    brandQueries: brandSettingsQueries,
    logoQueries,
    setupQueries: instanceSetupQueries,
    execQueries,
    deliveryQueries,
    portalAccountQueries,
    districtQueries,
  });

  // NEURO bridge — uses its own shared-secret auth, must be registered before JWT middleware
  app.use('/api/neuro-bridge', createNeuroBridgeRoutes(mcpManager));

  // Protected API routes — look up fresh role from DB so stale JWTs always reflect current role
  app.use('/api', authMiddleware(jwtSecret, (id) => userQueries.getById(id)?.role));

  // Lightweight user list — any authenticated user
  app.get('/api/users/list', (_req, res) => {
    const users = userQueries.getAll();
    const list = users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      team_id: (u as any).team_id ?? null,
    }));
    res.json({ ok: true, data: list });
  });

  app.use('/api/tasks', createTaskRoutes(taskQueries, aggregator, milestoneQueries, userSettingsQueries, settingsQueries, onboardingRunQueries, problemTicketQueries));
  app.use('/api/health', createHealthRoutes(mcpManager));
  app.use('/api/settings', createSettingsRoutes(settingsQueries, userSettingsQueries, (key) => {
    // Restart sync timers when interval settings change
    if (key.includes('interval_minutes')) restartSyncTimers();
    // Rebuild D365 service when credentials change
    if (key.startsWith('d365_')) buildD365Service();
    // Rebuild AzDO / BYM services
    if (key.startsWith('azdo_')) buildAzDoService();
    if (key.startsWith('bym_')) buildBymService();
  }));
  app.use('/api/integrations', createIntegrationRoutes(mcpManager, settingsQueries, userSettingsQueries, uvxCommand, () => d365Service, (key) => {
    if (key.startsWith('d365_')) buildD365Service();
    if (key.startsWith('azdo_')) buildAzDoService();
    if (key.startsWith('bym_')) buildBymService();
  }, buildOnboardingJiraClient, () => bymClient));
  app.use('/api/ingest', createIngestRoutes(taskQueries, settingsQueries));
  app.use('/api/actions', createActionRoutes(taskQueries, settingsQueries, userSettingsQueries));
  app.use('/api/jira', createJiraRoutes(taskQueries, buildOnboardingJiraClient, () => settingsQueries.getAll(), userSettingsQueries));
  app.use('/api/standups', requireAreaAccess('nova_features', 'view'), createStandupRoutes(taskQueries, settingsQueries, ritualQueries, userSettingsQueries));
  const spSync = new SharePointSync(mcpManager, deliveryQueries, () => settingsQueries.getAll());
  app.use('/api/delivery', createDeliveryRoutes(deliveryQueries, spSync, milestoneQueries, taskQueries, requireAreaAccess, auditQueries, onboardingRunQueries, settingsQueries));
  // Milestone routes — wired with workflow engine after buildOrchestrator is defined (see below)
  // app.use('/api/milestones', ...) is registered after buildOrchestrator
  app.use('/api/crm', createCrmRoutes(crmQueries, deliveryQueries, onboardingRunQueries, requireAreaAccess));
  app.use('/api/o365', createO365Routes(mcpManager));
  app.use('/api/admin', createAdminRoutes(userQueries, teamQueries, userSettingsQueries, settingsQueries));

  // Wallboard diagnostics log endpoints (admin-only)
  app.get('/api/admin/wallboard-logs', (req, res) => {
    if (!isAdmin((req as any).user?.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    res.json({ ok: true, data: getWallboardLogs() });
  });
  app.delete('/api/admin/wallboard-logs', (req, res) => {
    if (!isAdmin((req as any).user?.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    clearWallboardLogs();
    res.json({ ok: true });
  });

  app.use('/api/kpi-data', requireAreaAccess(['kpis', 'qa'], 'view'), createKpiDataRoutes(settingsQueries, userQueries));
  app.use('/api/trends', requireAreaAccess(['kpis', 'qa'], 'view'), createTrendsRoutes(settingsQueries, userQueries));
  app.use('/api/backfill', requireAreaAccess('qa', 'view'), createBackfillRoutes(settingsQueries));
  app.use('/api/sales', requireAreaAccess('sales', 'view'), createSalesHotboxRoutes(salesQueries, requireAreaAccess));
  app.use('/api/dynamics365', createDynamics365Routes(() => d365Service, crmQueries));
  app.use('/api/feedback', createFeedbackRoutes(feedbackQueries, taskQueries, userQueries, notificationQueries));
  app.use('/api/audit', createAuditRoutes(auditQueries));
  app.use('/api/team', requireAreaAccess('nova_features', 'view'), createTeamRoutes(deliveryQueries, milestoneQueries, taskQueries, userQueries));
  app.use('/api/notifications', createNotificationRoutes(notificationQueries, notificationEngine));
  app.use('/api/chat', requireAreaAccess('nova_features', 'view'), createChatRoutes(taskQueries, deliveryQueries, milestoneQueries, settingsQueries, userSettingsQueries));

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
  app.use('/api/instance-setup', createInstanceSetupRoutes(instanceSetupQueries, deliveryQueries));
  app.use('/api/branches', createBranchRoutes(branchQueries));
  app.use('/api/brand-settings', createBrandSettingsRoutes(brandSettingsQueries));
  app.use('/api/logos', createLogoRoutes(logoQueries));
  app.use('/api/azdo', createAzDoRoutes(() => azdoClient, brandSettingsQueries, logoQueries, deliveryQueries, instanceSetupQueries));
  app.use('/api/setup-execution', createSetupExecutionRoutes(execQueries, () => setupOrchestrator, {
    getAzdo: () => azdoClient,
    templateDir: path.resolve(__dirname, '../../data/templates'),
    brandQueries: brandSettingsQueries,
    branchQueries,
    logoQueries,
    deliveryQueries,
    portalAccountQueries,
    districtQueries,
    welcomePackQueries,
    requireAreaAccess,
  }));
  app.use('/api/setup-portal', createSetupPortalRoutes(portalQueries, deliveryQueries, () => settingsQueries.getAll()));

  // Debug endpoints (admin-only, behind auth)
  app.get('/api/debug/tools', (req, res, next) => {
    if (!isAdmin(req.user?.role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
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
    if (!isAdmin(req.user?.role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
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

  // Onboarding ticket orchestrator — uses Admin > Jira (Global) credentials
  function buildOrchestrator(): OnboardingOrchestrator | null {
    const client = buildOnboardingJiraClient();
    if (!client) return null;
    return new OnboardingOrchestrator(client, onboardingConfigQueries, onboardingRunQueries, () => settingsQueries.getAll());
  }
  app.use('/api/onboarding', createOnboardingRoutes(buildOrchestrator, buildOnboardingJiraClient, onboardingRunQueries));

  // Milestone workflow engine — evaluates milestones and creates tasks/tickets progressively
  const workflowEngine = new MilestoneWorkflowEngine(
    milestoneQueries, deliveryQueries, taskQueries, onboardingConfigQueries,
    buildOrchestrator, (msg) => console.log(msg),
  );
  app.use('/api/milestones', createMilestoneRoutes(milestoneQueries, deliveryQueries, taskQueries, workflowEngine, buildOrchestrator, onboardingConfigQueries));

  // Problem Ticket Scanner — AI + rule-based detection
  const problemTicketScanner = new ProblemTicketScanner(
    buildOnboardingJiraClient(),
    problemTicketQueries,
    settingsQueries,
  );
  app.use('/api/problem-tickets', createProblemTicketRoutes(problemTicketQueries, () => {
    // Refresh Jira client on each scan (credentials may change)
    problemTicketScanner.setJiraClient(buildOnboardingJiraClient());
    return problemTicketScanner;
  }, () => settingsQueries));

  // 6. OneDrive file watcher (Power Automate bridge)
  const watcher = new OneDriveWatcher(taskQueries, settingsQueries);
  watcher.start();

  app.get('/api/onedrive/status', (_req, res) => {
    res.json({ ok: true, data: watcher.getStatus() });
  });

  // JSON error handler — catch unhandled errors before Express default HTML handler
  app.use('/api', (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[API Error]', err.message, err.stack?.split('\n').slice(0, 3).join('\n'));
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message || 'Internal server error' });
    }
  });

  // Wallboard — server-rendered page for TV displays (no auth, no JS required)
  app.get('/wallboard/breached', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const settings = settingsQueries.getAll();
      const { kpi_sql_server: srv, kpi_sql_database: db, kpi_sql_user: usr, kpi_sql_password: pwd } = settings;
      if (!srv || !db || !usr || !pwd) {
        logWallboard('/wallboard/breached', 'error', 500, Date.now() - wbStart, 'KPI SQL not configured');
        res.status(500).send('KPI SQL not configured'); return;
      }
      const sql = await import('mssql');
      const pool = await new sql.default.ConnectionPool({
        server: srv, database: db, user: usr, password: pwd,
        options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 30000,
      }).connect();
      const hasOldest = await pool.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'OldestTicketDays'`);
      const oldestCol = hasOldest.recordset.length > 0 ? 'ISNULL(OldestTicketDays, 0)' : '0';
      const hasOldestKey = await pool.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'OldestTicketKey'`);
      const oldestKeyCol = hasOldestKey.recordset.length > 0 ? ', OldestTicketKey' : '';
      const hasDept = await pool.request().query(`SELECT 1 AS ok FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Agent') AND name = 'Department'`);
      const deptFilter = hasDept.recordset.length > 0 ? "AND Department = 'NT'" : '';
      const result = await pool.request().query(`
        SELECT AgentName, AgentSurname, TierCode, Team,
               OpenTickets_Total, OpenTickets_Over2Hours, OpenTickets_NoUpdateToday,
               ${oldestCol} AS OldestTicketDays${oldestKeyCol},
               SolvedTickets_Today, TicketsSnapshotAt
        FROM dbo.Agent WHERE IsActive = 1 ${deptFilter}
        ORDER BY OpenTickets_Over2Hours DESC, AgentName
      `);
      const data = result.recordset;
      await pool.close();

      const TEAM_COLORS: Record<string, string> = { CC: '#3b82f6', 'Customer Care': '#3b82f6', Production: '#8b5cf6', 'Tier 2': '#f59e0b', 'Tier 3': '#ef4444', Development: '#10b981', NTL: '#3b82f6' };
      const totalOver = data.reduce((s: number, a: any) => s + (a.OpenTickets_Over2Hours || 0), 0);
      const totalStale = data.reduce((s: number, a: any) => s + (a.OpenTickets_NoUpdateToday || 0), 0);
      const agentsBreached = data.filter((a: any) => a.OpenTickets_Over2Hours > 0).length;
      const worstOldest = data.reduce((m: number, a: any) => Math.max(m, a.OldestTicketDays || 0), 0);

      function rag(v: number, g: number, a: number) { return v <= g ? 'green' : v <= a ? 'amber' : 'red'; }
      function ragHtml(v: number, g: number, a: number, suffix = '') {
        const r = rag(v, g, a);
        const colors: Record<string, { bg: string; fg: string; bd: string }> = {
          green: { bg: 'rgba(16,185,129,.12)', fg: '#10b981', bd: 'rgba(16,185,129,.25)' },
          amber: { bg: 'rgba(245,158,11,.12)', fg: '#f59e0b', bd: 'rgba(245,158,11,.25)' },
          red: { bg: 'rgba(239,68,68,.15)', fg: '#ef4444', bd: 'rgba(239,68,68,.3)' },
        };
        const c = colors[r];
        return `<td class="c"><span style="display:inline-block;padding:3px 10px;border-radius:7px;font-size:12px;font-weight:700;min-width:40px;text-align:center;background:${c.bg};color:${c.fg};border:1px solid ${c.bd}">${v}${suffix}</span></td>`;
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-GB');

      function kpiCard(label: string, value: string | number, color: string) {
        return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px 18px"><div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">${label}</div><div style="font-size:26px;font-weight:800;letter-spacing:-1px;color:${color}">${value}</div></div>`;
      }

      const rows = data.map((a: any) => {
        const name = a.AgentSurname ? `${a.AgentName} ${a.AgentSurname}` : a.AgentName;
        const hasIssues = a.OpenTickets_Over2Hours > 0 || (a.OldestTicketDays || 0) > 7;
        const tc = TEAM_COLORS[a.TierCode || a.Team] || '#64748b';
        const escapedName = name.replace(/'/g, "\\'");
        return `<tr style="cursor:pointer;${hasIssues ? 'background:rgba(239,68,68,.04)' : ''}" onclick="window.parent.postMessage({type:'wallboard-drill',agent:'${escapedName}',label:'${escapedName}'},'*')">
          <td><span style="font-weight:600;color:${hasIssues ? '#fca5a5' : '#e2e8f0'}">${name}</span></td>
          <td><span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:${tc}22;color:${tc};border:1px solid ${tc}33">${a.TierCode || a.Team || '—'}</span></td>
          <td class="c" style="color:#94a3b8;font-weight:600">${a.OpenTickets_Total}</td>
          ${ragHtml(a.OpenTickets_Over2Hours || 0, 0, 2)}
          ${ragHtml(a.OpenTickets_NoUpdateToday || 0, 0, 1)}
          ${(() => {
            const days = a.OldestTicketDays || 0;
            const key = a.OldestTicketKey;
            const r = rag(days, 3, 7);
            const colors: Record<string, { bg: string; fg: string; bd: string }> = {
              green: { bg: 'rgba(16,185,129,.12)', fg: '#10b981', bd: 'rgba(16,185,129,.25)' },
              amber: { bg: 'rgba(245,158,11,.12)', fg: '#f59e0b', bd: 'rgba(245,158,11,.25)' },
              red: { bg: 'rgba(239,68,68,.15)', fg: '#ef4444', bd: 'rgba(239,68,68,.3)' },
            };
            const c = colors[r];
            const badge = `<span style="display:inline-block;padding:3px 10px;border-radius:7px;font-size:12px;font-weight:700;min-width:40px;text-align:center;background:${c.bg};color:${c.fg};border:1px solid ${c.bd}">${days}d</span>`;
            if (key) {
              return `<td class="c"><a href="https://nurturtech.atlassian.net/browse/${key}" target="_blank" style="text-decoration:none">${badge}</a></td>`;
            }
            return `<td class="c">${badge}</td>`;
          })()}
          <td class="c" style="color:#5ec1ca;font-weight:700">${a.SolvedTickets_Today || 0}</td>
        </tr>`;
      }).join('');

      res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>SLA Breach Board</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}.wrap{max-width:1600px;margin:0 auto;padding:16px 24px}table{width:100%;border-collapse:collapse}th{padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#64748b;background:#1e2228;border-bottom:1px solid #2f353d}th.c{text-align:center}td{padding:7px 12px;border-bottom:1px solid #2f353d;font-size:13px}td.c{text-align:center}tr[onclick]:hover{background:rgba(94,193,202,.08)!important}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
  <div><h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px">SLA Breach Board</h1><div style="font-size:10px;color:#64748b;margin-top:1px">Live ticket health per agent</div></div>
  <div style="font-size:10px;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
  ${kpiCard('Tickets Over SLA', totalOver, totalOver === 0 ? '#10b981' : '#ef4444')}
  ${kpiCard('Agents Breached', `${agentsBreached} / ${data.length}`, agentsBreached === 0 ? '#10b981' : '#f59e0b')}
  ${kpiCard('Tickets Not Updated', totalStale, totalStale === 0 ? '#10b981' : '#f59e0b')}
  ${kpiCard('Worst Oldest (days)', worstOldest, worstOldest <= 3 ? '#10b981' : worstOldest <= 7 ? '#f59e0b' : '#ef4444')}
</div>
<div style="border:1px solid #2f353d;border-radius:14px;overflow:hidden;background:rgba(255,255,255,.03)">
<table><thead><tr><th>Agent</th><th>Team</th><th class="c">Open</th><th class="c">Over SLA</th><th class="c">Not Updated</th><th class="c">Oldest (days)</th><th class="c">Solved Today</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div style="text-align:center;margin-top:10px;font-size:10px;color:#475569">nurtur.tech &middot; SLA Breach Board &middot; ${dateStr}</div>
</div></body></html>`);
      logWallboard('/wallboard/breached', 'info', 200, Date.now() - wbStart, `OK — ${data.length} agents`, { sqlServer: srv });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/breached', 'error', 500, Date.now() - wbStart, msg, { sqlServer: settingsQueries.getAll().kpi_sql_server, error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Wallboard — server-rendered Breached KPIs page for TV displays
  app.get('/wallboard/team-kpis', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const settings = settingsQueries.getAll();
      const { kpi_sql_server: srv, kpi_sql_database: db, kpi_sql_user: usr, kpi_sql_password: pwd } = settings;
      if (!srv || !db || !usr || !pwd) {
        logWallboard('/wallboard/team-kpis', 'error', 500, Date.now() - wbStart, 'KPI SQL not configured');
        res.status(500).send('KPI SQL not configured'); return;
      }
      const sql = await import('mssql');
      const pool = await new sql.default.ConnectionPool({
        server: srv, database: db, user: usr, password: pwd,
        options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 30000,
      }).connect();
      const result = await pool.request().query(`
        SELECT KPI, KPIGroup, [Count], KPITarget, KPIDirection, RAG, CreatedAt
        FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
          FROM dbo.KpiSnapshot
        ) t WHERE rn = 1
        ORDER BY KPIGroup, KPI
      `);
      const allKpis = result.recordset as Array<{ KPI: string; KPIGroup: string; Count: number; KPITarget: number | null; KPIDirection: string | null; RAG: number | null; CreatedAt: string }>;
      await pool.close();

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-GB');

      // Summary stats
      const totalKpis = allKpis.length;
      const greenCount = allKpis.filter(k => k.RAG === 1).length;
      const amberCount = allKpis.filter(k => k.RAG === 2).length;
      const redCount = allKpis.filter(k => k.RAG === 3).length;
      const breachedKpis = allKpis.filter(k => k.RAG === 2 || k.RAG === 3);
      const greenPct = totalKpis > 0 ? Math.round((greenCount / totalKpis) * 100) : 0;
      const redPct = totalKpis > 0 ? Math.round((redCount / totalKpis) * 100) : 0;

      function kpiCard(label: string, value: string | number, color: string) {
        return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px 18px"><div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px">${label}</div><div style="font-size:26px;font-weight:800;letter-spacing:-1px;color:${color}">${value}</div></div>`;
      }

      // Build rows — red first, then amber
      const sorted = [...breachedKpis].sort((a, b) => {
        if (a.RAG !== b.RAG) return (b.RAG ?? 0) - (a.RAG ?? 0); // red (3) before amber (2)
        return a.KPI.localeCompare(b.KPI);
      });

      const rows = sorted.map(k => {
        const isRed = k.RAG === 3;
        const ragColors = isRed
          ? { bg: 'rgba(239,68,68,.15)', fg: '#ef4444', bd: 'rgba(239,68,68,.3)' }
          : { bg: 'rgba(245,158,11,.12)', fg: '#f59e0b', bd: 'rgba(245,158,11,.25)' };
        const rowBg = isRed ? 'background:rgba(239,68,68,.04)' : '';
        const target = k.KPITarget !== null ? k.KPITarget : '—';
        const escapedKpi = k.KPI.replace(/'/g, "\\'");
        return `<tr style="cursor:pointer;${rowBg}" onclick="window.parent.postMessage({type:'wallboard-drill',kpi:'${escapedKpi}',label:'${escapedKpi}'},'*')">
          <td><span style="font-weight:600;color:${isRed ? '#fca5a5' : '#fde68a'}">${k.KPI}</span></td>
          <td class="c"><span style="display:inline-block;padding:3px 10px;border-radius:7px;font-size:12px;font-weight:700;min-width:40px;text-align:center;background:${ragColors.bg};color:${ragColors.fg};border:1px solid ${ragColors.bd}">${k.Count}</span></td>
          <td class="c" style="color:#94a3b8;font-weight:600">${target}</td>
          <td class="c"><span style="display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;text-transform:uppercase;background:${ragColors.bg};color:${ragColors.fg};border:1px solid ${ragColors.bd}">${isRed ? 'RED' : 'AMBER'}</span></td>
        </tr>`;
      }).join('');

      const emptyRow = breachedKpis.length === 0
        ? '<tr><td colspan="4" style="text-align:center;padding:40px;color:#64748b">All KPIs are green — nothing breached!</td></tr>'
        : '';

      res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>KPI Breach Board</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}.wrap{max-width:1600px;margin:0 auto;padding:16px 24px}table{width:100%;border-collapse:collapse}th{padding:8px 12px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#64748b;background:#1e2228;border-bottom:1px solid #2f353d}th.c{text-align:center}td{padding:7px 12px;border-bottom:1px solid #2f353d;font-size:13px}td.c{text-align:center}tr[onclick]:hover{background:rgba(94,193,202,.08)!important}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
  <div><h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px">KPI Breach Board</h1><div style="font-size:10px;color:#64748b;margin-top:1px">Breached team KPIs from Jira</div></div>
  <div style="font-size:10px;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:14px">
  ${kpiCard('Total KPIs', totalKpis, '#e2e8f0')}
  ${kpiCard('KPIs Green', `${greenCount} (${greenPct}%)`, '#10b981')}
  ${kpiCard('KPIs Amber', String(amberCount), amberCount === 0 ? '#10b981' : '#f59e0b')}
  ${kpiCard('KPIs Red', String(redCount), redCount === 0 ? '#10b981' : '#ef4444')}
  ${kpiCard('Red %', redPct + '%', redPct === 0 ? '#10b981' : redPct <= 20 ? '#f59e0b' : '#ef4444')}
</div>
<div style="border:1px solid #2f353d;border-radius:14px;overflow:hidden;background:rgba(255,255,255,.03)">
<table><thead><tr><th>KPI Name</th><th class="c">Value</th><th class="c">Target</th><th class="c">Status</th></tr></thead>
<tbody>${emptyRow}${rows}</tbody></table></div>
<div style="text-align:center;margin-top:10px;font-size:10px;color:#475569">nurtur.tech &middot; KPI Breach Board &middot; ${dateStr}</div>
</div></body></html>`);
      logWallboard('/wallboard/team-kpis', 'info', 200, Date.now() - wbStart, `OK — ${allKpis.length} KPIs, ${breachedKpis.length} breached`, { sqlServer: srv });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/team-kpis', 'error', 500, Date.now() - wbStart, msg, { sqlServer: settingsQueries.getAll().kpi_sql_server, error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Wallboard — server-rendered stat panels (Grafana replacement)
  async function renderStatWallboard(
    settingsQueries: any,
    title: string,
    subtitle: string,
    panels: Array<{ label: string; kpi: string; altKpi?: string }>,
    cols: number,
  ): Promise<string> {
    const settings = settingsQueries.getAll();
    const { kpi_sql_server: srv, kpi_sql_database: db, kpi_sql_user: usr, kpi_sql_password: pwd } = settings;
    if (!srv || !db || !usr || !pwd) throw new Error('KPI SQL not configured');
    const sql = await import('mssql');
    const pool = await new sql.default.ConnectionPool({
      server: srv, database: db, user: usr, password: pwd,
      options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 30000,
    }).connect();
    const result = await pool.request().query(`
      SELECT KPI, [Count], RAG FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY KPI ORDER BY CreatedAt DESC) AS rn
        FROM dbo.KpiSnapshot
      ) t WHERE rn = 1
    `);
    await pool.close();
    const kpis = new Map<string, { count: number; rag: number | null }>();
    for (const r of result.recordset) kpis.set(r.KPI.toLowerCase(), { count: r.Count, rag: r.RAG });

    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB');
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    function lookup(kpi: string, altKpi?: string): { count: number; rag: number | null } {
      const k = kpis.get(kpi.toLowerCase());
      if (k) return k;
      if (altKpi) {
        const a = kpis.get(altKpi.toLowerCase());
        if (a) return a;
      }
      return { count: 0, rag: null };
    }

    function ragColor(rag: number | null): string {
      if (rag === 1) return '#10b981';
      if (rag === 2) return '#eab308';
      if (rag === 3) return '#ef4444';
      return '#94a3b8';
    }

    const panelHtml = panels.map(p => {
      const data = lookup(p.kpi, p.altKpi);
      const color = ragColor(data.rag);
      const flashClass = data.rag === 3 ? ' flash-red' : '';
      const escaped = p.kpi.replace(/'/g, "\\'");
      return `<div class="${flashClass}" data-kpi="${p.kpi}" onclick="window.parent.postMessage({type:'wallboard-drill',kpi:'${escaped}',label:'${p.label.replace(/'/g, "\\'")}'},'*')" style="cursor:pointer;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:20px 24px;display:flex;flex-direction:column;justify-content:center;align-items:center;transition:transform .1s">
        <div style="font-size:16px;color:#94a3b8;font-weight:600;text-align:center;margin-bottom:12px;letter-spacing:.3px">${p.label}</div>
        <div style="font-size:96px;font-weight:800;letter-spacing:-3px;line-height:1;color:${color}">${data.count}</div>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}.wrap{max-width:1600px;margin:0 auto;padding:20px 28px;min-height:100vh;display:flex;flex-direction:column}.flash-red{animation:flash 1s ease-in-out infinite}@keyframes flash{0%,100%{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}50%{background:rgba(239,68,68,.35);border-color:rgba(239,68,68,.8);box-shadow:0 0 24px rgba(239,68,68,.5)}}[data-kpi]:hover{transform:scale(1.02);filter:brightness(1.1)}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
  <div><h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px">${title}</h1><div style="font-size:10px;color:#64748b;margin-top:1px">${subtitle}</div></div>
  <div style="font-size:10px;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;flex:1">
${panelHtml}
</div>
<div style="text-align:center;margin-top:14px;font-size:10px;color:#475569">nurtur.tech &middot; ${title} &middot; ${dateStr}</div>
</div></body></html>`;
  }

  // Customer Care wallboard
  app.get('/wallboard/cc', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const html = await renderStatWallboard(settingsQueries, 'Customer Care', 'Live queue metrics', [
        { label: 'CC Incidents', kpi: 'Number of Tickets in CC (Incidents)' },
        { label: 'CC Service Requests', kpi: 'Number of Tickets in CC (Service Requests)' },
        { label: 'Property Jungle', kpi: 'Number of Tickets in CC (TPJ)' },
        { label: 'CC Incidents — No Update', kpi: 'Number of Tickets With No Reply in CC (Incidents)' },
        { label: 'CC Service Requests — No Update', kpi: 'Number of Tickets With No Reply in CC (Service Requests)' },
        { label: 'Property Jungle — No Update', kpi: 'Number of Tickets With No Reply in CC (TPJ)' },
        { label: 'CC Incidents — Over SLA', kpi: 'CC Incidents over SLA (actionable)' },
        { label: 'CC Service Requests — Over SLA', kpi: 'CC Service Requests over SLA (actionable)' },
        { label: 'Property Jungle — Over SLA', kpi: 'CC TPJ over SLA (actionable)', altKpi: 'CC (TPJ) over SLA (actionable)' },
      ], 3);
      res.send(html);
      logWallboard('/wallboard/cc', 'info', 200, Date.now() - wbStart, 'OK', { sqlServer: settingsQueries.getAll().kpi_sql_server });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/cc', 'error', 500, Date.now() - wbStart, msg, { sqlServer: settingsQueries.getAll().kpi_sql_server, error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Technical Support wallboard
  app.get('/wallboard/tech-support', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const html = await renderStatWallboard(settingsQueries, 'Technical Support', 'Live queue metrics', [
        { label: 'Production Active Tickets', kpi: 'Number of Tickets in Production' },
        { label: 'Tier 2 Active Tickets', kpi: 'Number of Tickets in Tier 2' },
        { label: 'Development Active Tickets', kpi: 'Number of Tickets in Development' },
        { label: 'Production — No Reply', kpi: 'Number of Tickets With No Reply in Production' },
        { label: 'Tier 2 — No Reply', kpi: 'Number of Tickets With No Reply in Tier 2' },
        { label: 'Tier 3 — No Reply', kpi: 'Number of Tickets With No Reply in Tier 3' },
        { label: 'Production — Over SLA', kpi: 'Production over SLA (actionable)' },
        { label: 'Tier 2 — Over SLA', kpi: 'Tier 2 over SLA (actionable)' },
        { label: 'Development — Over SLA', kpi: 'Development over SLA (actionable)' },
      ], 3);
      res.send(html);
      logWallboard('/wallboard/tech-support', 'info', 200, Date.now() - wbStart, 'OK', { sqlServer: settingsQueries.getAll().kpi_sql_server });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/tech-support', 'error', 500, Date.now() - wbStart, msg, { sqlServer: settingsQueries.getAll().kpi_sql_server, error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
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

      const tasks = taskQueries.getAll();
      if (tasks.length === 0) return;

      // Get yesterday's ritual for rollover context
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayRituals = ritualQueries.getByDate(
        yesterday.toISOString().split('T')[0], 'morning'
      );

      console.log('[PreLoad] Generating morning briefing in background...');
      const briefing = generateMorningBriefing(tasks, yesterdayRituals[0] ?? null);
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

  // Resolve primary admin user for background sync ownership
  const primaryAdmin = (() => {
    const users = userQueries.getAll();
    return users.find(u => u.role.split(',').map(r => r.trim()).includes('admin'));
  })();
  const primaryAdminId = primaryAdmin?.id ?? 1;
  // Background sync builds a per-user Jira REST client from the primary admin's creds
  function buildBgSyncCtx() {
    const s = settingsQueries.getAll();
    if (s.jira_enabled === 'true' && s.jira_url && s.jira_username && s.jira_token) {
      return {
        jiraClient: new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token }),
        jiraBaseUrl: s.jira_url,
      };
    }
    return { jiraClient: null as JiraRestClient | null };
  }

  const runFullSync = async () => {
    try {
      const results = await aggregator.syncAll(primaryAdminId, buildBgSyncCtx());
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
            const result = await aggregator.syncSource(source, primaryAdminId, buildBgSyncCtx());
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
  setTimeout(async () => {
    await runFullSync();
    startSyncTimers();
    // Run initial workflow evaluation after sync
    try {
      const wfResult = await workflowEngine.evaluateAll();
      if (wfResult.tasksCreated > 0 || wfResult.ticketsCreated > 0) {
        console.log(`[Startup] Workflow: ${wfResult.tasksCreated} tasks, ${wfResult.ticketsCreated} tickets created`);
      }
    } catch (err) {
      console.error('[Startup] Workflow evaluation failed:', err instanceof Error ? err.message : err);
    }
  }, 5000);

  // Milestone workflow evaluation every 15 minutes
  const workflowTimer = setInterval(async () => {
    try {
      const result = await workflowEngine.evaluateAll();
      if (result.tasksCreated > 0 || result.ticketsCreated > 0) {
        console.log(`[Workflow] Scheduled: ${result.tasksCreated} tasks, ${result.ticketsCreated} tickets created`);
      }
    } catch (err) {
      console.error('[Workflow] Scheduled evaluation failed:', err instanceof Error ? err.message : err);
    }
  }, 15 * 60 * 1000);

  // Problem Ticket Scanner: every 15 minutes + initial scan after 30s
  const ptScanTimer = setInterval(async () => {
    try {
      problemTicketScanner.setJiraClient(buildOnboardingJiraClient());
      await problemTicketScanner.scan();
    } catch (err) {
      console.error('[ProblemTicketScanner] Scheduled scan failed:', err instanceof Error ? err.message : err);
    }
  }, 15 * 60 * 1000);
  setTimeout(async () => {
    try {
      problemTicketScanner.setJiraClient(buildOnboardingJiraClient());
      await problemTicketScanner.scan();
    } catch (err) {
      console.error('[ProblemTicketScanner] Initial scan failed:', err instanceof Error ? err.message : err);
    }
  }, 30_000);

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

  // Periodic auto-save: flush in-memory sql.js database to disk every 15s
  const autoSaveTimer = setInterval(() => {
    try { saveDb(); } catch (err) {
      console.error('[AutoSave] Failed:', err instanceof Error ? err.message : err);
    }
  }, 15_000);

  // Also save after the initial auto-seed completes
  saveDb();

  // Expired portal token cleanup: every 6 hours
  const portalCleanupTimer = setInterval(() => {
    try {
      const deleted = portalQueries.deleteExpired();
      if (deleted > 0) console.log(`[SetupPortal] Cleaned up ${deleted} expired tokens`);
    } catch (err) {
      console.error('[SetupPortal] Cleanup failed:', err instanceof Error ? err.message : err);
    }
  }, 6 * 60 * 60 * 1000);

  // Daily backup: check hourly, create one backup per day (7-day rotation)
  createBackup();
  const backupTimer = setInterval(() => {
    try { createBackup(); } catch (err) {
      console.error('[Backup] Timer error:', err instanceof Error ? err.message : err);
    }
  }, 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[N.O.V.A] Shutting down...');
    clearInterval(autoSaveTimer);
    clearInterval(backupTimer);
    clearInterval(workflowTimer);
    clearInterval(ptScanTimer);
    clearInterval(portalCleanupTimer);
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
