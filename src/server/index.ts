import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initializeDatabase, shutdownDatabase } from './db/schema.js';
import { query, queryOne } from './services/database.js';
import { TaskQueries, RitualQueries, DeliveryQueries, CrmQueries, TeamQueries, UserQueries, UserSettingsQueries, UserTeamQueries, FeedbackQueries, OnboardingConfigQueries, OnboardingRunQueries, MilestoneQueries, BcCustomerQueries, ContractsQueries, ContractTemplateQueries, AdobeSignAgreementQueries, TrainingQueries } from './db/queries.js';
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
import { createBoardMiRoutes } from './routes/board-mi.js';
import { createDevReviewRoutes } from './routes/dev-review.js';
import { createBriefingRoutes } from './routes/briefing.js';
import { createKbArticleRoutes } from './routes/kb-articles.js';
import { KbArticleService } from './services/kb-article-service.js';
import { createAiImprovementRoutes } from './routes/ai-improvement.js';
import { AiImprovementService } from './services/ai-improvement.js';
import { createAiLearningRoutes } from './routes/ai-learnings.js';
import { AiLearningService } from './services/ai-learning-service.js';
import { createGamificationRoutes } from './routes/gamification.js';
import { GamificationService } from './services/gamification.js';
import { createEscalationRoutes } from './routes/escalation.js';
import { EscalationLogService } from './services/escalation-log-service.js';
import { DevReviewQueries } from './db/dev-review-queries.js';
import { createTrendsRoutes } from './routes/trends.js';
import { createFeedbackRoutes } from './routes/feedback.js';
import { createOnboardingConfigRoutes } from './routes/onboarding-config.js';
import { createOnboardingRoutes } from './routes/onboarding.js';
import { createMilestoneRoutes, resyncAllMilestoneTasks } from './routes/milestones.js';
import { SalesQueries } from './db/sales-queries.js';
import { createSalesHotboxRoutes } from './routes/sales-hotbox.js';
import { JiraRestClient } from './services/jira-client.js';
import { OnboardingOrchestrator } from './services/onboarding-orchestrator.js';
import { authMiddleware, createAreaAccessGuard, requireRole } from './middleware/auth.js';
import type { CustomRole } from './middleware/auth.js';
import { isAdmin } from './utils/role-helpers.js';
import crypto from 'crypto';
import { generateMorningBriefing } from './services/ai-standup.js';
import { INTEGRATIONS, buildMcpConfig } from './services/integrations.js';
import { OneDriveWatcher } from './services/onedrive-watcher.js';
import { SharePointSync } from './services/sharepoint-sync.js';
import { MsGraphClient } from './services/msgraph-client.js';
import { Dynamics365Service } from './services/dynamics365.js';
import { createDynamics365Routes } from './routes/dynamics365.js';
import { EntraSsoService } from './services/entra-sso.js';
import { MilestoneWorkflowEngine } from './services/milestone-workflow.js';
import { AuditQueries } from './db/audit.js';
import { createAuditRoutes } from './routes/audit.js';
import { createTeamRoutes } from './routes/team.js';
import { JiraOAuthService } from './services/jira-oauth.js';
import { NotificationQueries } from './db/notifications.js';
import { NotificationEngine } from './services/notification-engine.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { ProblemTicketQueries, InstanceSetupQueries, BranchQueries, BrandSettingsQueries, LogoQueries, SetupExecutionQueries, SetupPortalQueries, PortalAccountQueries, BranchDistrictQueries, WelcomePackQueries, ApprovalQueries, BacklogQueries } from './db/queries.js';
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
import { createBacklogRoutes } from './routes/backlog.js';
import { logWallboard, getWallboardLogs, clearWallboardLogs, logWallboardClient } from './services/wallboard-logger.js';
import { startWallboardLiveCache, getCohortSnapshot, type CohortSnapshot } from './services/wallboard-live-cache.js';
import { createContractsRoutes } from './routes/contracts.js';
import { createAdobeSignRoutes } from './routes/adobe-sign.js';
import { AdobeSignClient, buildAdobeSignClient } from './services/adobe-sign-client.js';
import { createSurveyRoutes, createSurveyPublicRoutes, runSurveyScheduler } from './routes/surveys.js';
import { createAgentRoutes } from './routes/agent.js';
import { createMyTicketsRoutes } from './routes/my-tickets.js';
import { QueueRanker } from './services/queue-ranker.js';
import { DeferService } from './services/defer-service.js';
import { AgentLoop } from './services/agent-loop.js';
import { JiraSyncService } from './services/jira-sync-service.js';
import { JiraCacheQueries } from './services/jira-cache-queries.js';
import { LlmService } from './services/llm-service.js';
import { AssignmentEngine } from './services/assignment-engine.js';
import { AgentAvailabilityService } from './services/agent-availability.js';
import { TicketClassifier } from './services/ticket-classifier.js';
import { BriefEngine } from './services/brief-engine.js';

import { KbSearchService } from './services/kb-search.js';
import { KbEmbedder } from './services/kb-embedder.js';
import { KbChunker } from './services/kb-chunker.js';
import { KbSyncWorker } from './services/kb-sync-worker.js';
import { TfsDocsSyncProvider } from './services/kb-tfs-docs-sync.js';
import { ConfluenceSyncProvider } from './services/kb-confluence-sync.js';
import type { KbSyncProvider } from './services/kb-sync-provider.js';
import { createKbAdminRoutes } from './routes/kb-admin.js';
import { KpiPipeline } from './services/kpi-pipeline.js';
import { QaPipeline } from './services/qa-pipeline.js';
import { PipelineMonitor } from './services/pipeline-monitor.js';
import { DriftDetector } from './services/drift-detector.js';
import { ConfigService } from './services/config-service.js';
import { SuggestionEngine } from './services/suggestion-engine.js';
import { CalendarSyncService } from './services/calendar-sync.js';
import { DailyBriefingService } from './services/daily-briefing.js';
import { EmailService } from './services/email.js';
import { ProductCancellationService } from './services/product-cancellation.js';
import { AbuseReportProcessor } from './services/abuse-report-processor.js';
import { CallReviewService } from './services/call-reviews.js';
import { createApprovalRoutes } from './routes/approvals.js';
import { createTrainingRoutes } from './routes/training.js';
import { sendTrainingReminders } from './services/training-reminder.js';
import { addBusinessHours, toSqliteDatetime } from './utils/business-hours.js';
import { getCalyxDb, initializeCalyxSchema, seedCalyxData } from './db/calyx-db.js';
import { CalyxQueries } from './db/calyx-queries.js';
import { createCalyxRoutes } from './routes/calyx.js';
import { createCalyxPhase4Routes } from './routes/calyx-phase4.js';
import { createCalyxPhase5Routes } from './routes/calyx-phase5.js';
import { createCalyxReportRoutes } from './routes/calyx-reports.js';
import { createCalyxPortalRoutes } from './routes/calyx-portal.js';
import { createPeopleRoutes, generatePrepForAgent } from './routes/people.js';
import { checkSloBreaches } from './services/calyx-slo-engine.js';
import { processEmailQueue } from './services/calyx-email.js';
import { syncCalyxKpisToNova } from './services/calyx-kpi-sync.js';
import cookieParser from 'cookie-parser';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const isProduction = process.env.NODE_ENV === 'production';

async function main() {
  // 1. Database
  console.log('[N.O.V.A] Initializing database...');
  await initializeDatabase();

  // Forward declaration — populated later when Jira creds are available
  let agentLoop: AgentLoop | null = null;

  // Calyx database (separate SQLite via better-sqlite3)
  console.log('[N.O.V.A] Initializing Calyx database...');
  const calyxDb = getCalyxDb();
  initializeCalyxSchema(calyxDb);
  seedCalyxData(calyxDb);
  const calyxQueries = new CalyxQueries(calyxDb);

  const taskQueries = new TaskQueries();
  const fileSettings = new FileSettingsQueries();
  const configService = new ConfigService(fileSettings);
  await configService.initialize().catch(err =>
    console.warn('[N.O.V.A] Config service init failed, using file fallback:', err instanceof Error ? err.message : err)
  );
  const settingsQueries = configService as FileSettingsQueries;

  // Calyx background timers (must be after settingsQueries is initialized)
  setInterval(() => checkSloBreaches(calyxDb, settingsQueries.getAll()), 5 * 60 * 1000);
  setInterval(() => processEmailQueue(calyxDb, settingsQueries.getAll()), 60_000);
  setInterval(() => syncCalyxKpisToNova(calyxDb, settingsQueries).catch(() => {}), 30 * 60 * 1000);
  setTimeout(() => syncCalyxKpisToNova(calyxDb, settingsQueries).catch(() => {}), 60_000);

  // Wallboard live cache — cohort-scoped stats from jira_issue_cache (5-min refresh)
  startWallboardLiveCache().catch(err => console.warn('[wallboard-live-cache] startup failed:', err instanceof Error ? err.message : err));
  const ritualQueries = new RitualQueries();
  const deliveryQueries = new DeliveryQueries();
  // Auto-assign onboarding IDs to any entries missing them
  const backfilled = await deliveryQueries.backfillOnboardingIds();
  if (backfilled > 0) console.log(`[N.O.V.A] Backfilled ${backfilled} onboarding IDs`);
  const crmQueries = new CrmQueries();
  const salesQueries = new SalesQueries();
  const userQueries = new UserQueries();

  // Idempotent user restore from CSV backup (2026-04-16).
  // Matches by email (case-insensitive) or username. Updates existing users'
  // roles and team assignments; creates missing users. Safe to run repeatedly.
  const teamQueries = new TeamQueries();
  const userTeamQueries = new UserTeamQueries();
  const allTeams = await teamQueries.getAll();
  const teamByName = new Map(allTeams.map(t => [t.name.toLowerCase(), t.id]));
  const SEED_USERS: Array<{ username: string; display_name: string; email: string; role: string; team: string; auth_provider: string }> = [
    { username: 'nickw', display_name: 'Nick Ward', email: 'nickw@nurtur.tech', role: 'super_admin,support,design,uat,briefing,kpi,sales,qa,ai-approver', team: 'Support', auth_provider: 'entra' },
    { username: 'support', display_name: 'Support', email: '', role: 'support', team: 'Support', auth_provider: 'local' },
    { username: 'seb', display_name: 'Sebastian Broome', email: 'sebastian.broome@nurtur.tech', role: 'onboader,support,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'onboarding', display_name: 'Onboarding', email: '', role: 'onboader', team: 'Onboarding', auth_provider: 'local' },
    { username: 'isabel.busk@nurtur.tech', display_name: 'Isabel Busk', email: 'Isabel.Busk@nurtur.tech', role: 'onboader,support,qa,kpi', team: 'Design', auth_provider: 'entra' },
    { username: 'chris@nurtur.tech', display_name: 'Chris Middleton', email: 'chris@nurtur.tech', role: 'onboader,admin,support,uat,design,kpi,briefing,sales,qa,ai-approver', team: '', auth_provider: 'entra' },
    { username: 'abdi.mohamed@nurtur.tech', display_name: 'Abdi Mohamed', email: 'abdi.mohamed@nurtur.tech', role: 'onboader,support,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'stephen.mitchell@nurtur.tech', display_name: 'Stephen Mitchell', email: 'stephen.mitchell@nurtur.tech', role: 'onboader,support,ai-approver,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'naomi.wentworth@nurtur.tech', display_name: 'Naomi Wentworth', email: 'naomi.wentworth@nurtur.tech', role: 'onboader,support,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'hope.goodall@nurtur.tech', display_name: 'Hope Goodall', email: 'hope.goodall@nurtur.tech', role: 'onboader,support,briefing,qa', team: 'Support', auth_provider: 'local' },
    { username: 'arman.shazad@nurtur.tech', display_name: 'Arman Shazad', email: 'Arman.Shazad@nurtur.tech', role: 'onboader,support,viewer,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'joshua.mills', display_name: 'Joshua Mills', email: 'joshua.mills@nurtur.tech', role: 'admin,onboader', team: '', auth_provider: 'entra' },
    { username: 'nathan.rutland@nurtur.tech', display_name: 'Nathan Rutland', email: 'Nathan.Rutland@nurtur.tech', role: 'viewer,onboader,support,design,kpi,qa,briefing', team: 'Support', auth_provider: 'local' },
    { username: 'richardc@nurtur.tech', display_name: 'Richard', email: 'richardc@nurtur.tech', role: 'viewer,onboader,sales', team: 'Onboarding', auth_provider: 'local' },
    { username: 'luke.scaife', display_name: 'Luke Scaife', email: 'luke.scaife@nurtur.tech', role: 'onboader,support,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'heidi.power@nurtur.tech', display_name: 'Heidi Power', email: 'Heidi.Power@nurtur.tech', role: 'onboader,support,viewer,qa', team: 'Support', auth_provider: 'entra' },
    { username: 'willem.kruger@nurtur.tech', display_name: 'Willem', email: 'Willem.Kruger@nurtur.tech', role: 'viewer,onboader,support,qa,briefing', team: 'Support', auth_provider: 'local' },
    { username: 'zoe.rees@nurtur.tech', display_name: 'Zoe Rees', email: 'zoe.rees@nurtur.tech', role: 'onboader,support,viewer,qa,ai-approver', team: 'Support', auth_provider: 'entra' },
    { username: 'jmtesting', display_name: 'JM Testing', email: 'JMTesting@nurtur.tech', role: 'admin,onboader,support,uat,kpi', team: '', auth_provider: 'entra' },
    { username: 'georginag@nurtur.tech', display_name: 'Georgie', email: 'GeorginaG@nurtur.tech', role: 'viewer,onboader,design,kpi,sales,qa,mi', team: '', auth_provider: 'local' },
    { username: 'ward.nickj@gmail.com', display_name: 'Nick Test', email: 'ward.nickj@gmail.com', role: 'viewer,onboader,support,uat,design,kpi,sales,qa', team: 'UAT', auth_provider: 'local' },
    { username: 'kayleigh.russell', display_name: 'Kayleigh Russell', email: 'Kayleigh.Russell@nurtur.tech', role: 'onboader,support', team: '', auth_provider: 'entra' },
    { username: 'maria.pappa@nurtur.tech', display_name: 'Maria', email: 'Maria.Pappa@nurtur.tech', role: 'viewer,support,kpi', team: 'Support', auth_provider: 'local' },
    { username: 'adele.norman-swift@nurtur.tech', display_name: 'Adele', email: 'Adele.Norman-Swift@nurtur.tech', role: 'viewer,support,kpi', team: 'Support', auth_provider: 'local' },
    { username: 'ricky.bostock@nurtur.tech', display_name: 'Ricky', email: 'Ricky.Bostock@nurtur.tech', role: 'viewer,admin,onboader,support,uat,design,kpi,briefing,sales,qa,ai-approver', team: '', auth_provider: 'local' },
  ];
  let seedCreated = 0, seedUpdated = 0;
  for (const u of SEED_USERS) {
    try {
      const teamId = u.team ? (teamByName.get(u.team.toLowerCase()) ?? null) : null;
      // Always match by canonical username — never let email match hijack the wrong account
      const existing = await userQueries.getByUsername(u.username);
      if (existing) {
        await userQueries.update(existing.id, {
          display_name: u.display_name || existing.display_name,
          email: u.email || existing.email,
          role: u.role,
          ...(teamId ? { team_id: teamId } : {}),
        });
        seedUpdated++;
      } else {
        const newId = await userQueries.create({
          username: u.username,
          display_name: u.display_name || undefined,
          email: u.email || undefined,
          password_hash: '',
          role: u.role,
          auth_provider: u.auth_provider,
        });
        if (teamId) await userQueries.update(newId, { team_id: teamId });
        seedCreated++;
      }
    } catch (err) {
      console.warn(`[Startup] Failed to seed user ${u.username}:`, err instanceof Error ? err.message : err);
    }
  }
  if (seedCreated > 0 || seedUpdated > 0) {
    console.log(`[Startup] User seed: ${seedCreated} created, ${seedUpdated} updated`);
  }

  // Clean up duplicate SSO accounts — if a user was auto-provisioned with a
  // suffixed username (e.g. nickw_mo9wyy88) but the canonical seed account
  // now exists, delete the duplicate.
  const allUsers = await userQueries.getAll();
  for (const u of allUsers) {
    if (!u.email) continue;
    const canonical = SEED_USERS.find(s => s.email && s.email.toLowerCase() === u.email!.toLowerCase());
    if (!canonical) continue;
    const canonicalUser = await userQueries.getByUsername(canonical.username);
    if (canonicalUser && canonicalUser.id !== u.id && u.username !== canonical.username) {
      await userQueries.delete(u.id);
      console.log(`[Startup] Removed duplicate account ${u.username} (canonical: ${canonical.username})`);
    }
  }

  const novaMcpCreated = await userQueries.ensureServiceAccount({
    username: 'nova-mcp',
    password_hash: '$2b$10$14kBcPzWdHR/G2UBK8YMWuQozUp4iQNIbM1jAw9lhvP1zFixAxVMe',
    role: 'admin',
    display_name: 'NOVA MCP Service Account',
  });
  if (novaMcpCreated) console.log('[Startup] Bootstrapped service account: nova-mcp');
  const nickAdmCreated = await userQueries.ensureServiceAccount({
    username: 'nickadm',
    password_hash: '$2b$10$1yEOBA8qhaK1.ClDJLPWluGBo2UMywJdH2BgGdSHmcc562YAojqE6',
    role: 'admin',
    display_name: 'Nick (Emergency Admin)',
  });
  if (nickAdmCreated) console.log('[Startup] Bootstrapped emergency admin: nickadm');
  const userSettingsQueries = new UserSettingsQueries();
  const feedbackQueries = new FeedbackQueries();
  const onboardingConfigQueries = new OnboardingConfigQueries();
  const onboardingRunQueries = new OnboardingRunQueries();
  const milestoneQueries = new MilestoneQueries();
  const auditQueries = new AuditQueries();
  const notificationQueries = new NotificationQueries();
  const notificationEngine = new NotificationEngine(notificationQueries, milestoneQueries, deliveryQueries, taskQueries, userQueries);
  const problemTicketQueries = new ProblemTicketQueries();
  const instanceSetupQueries = new InstanceSetupQueries();
  const branchQueries = new BranchQueries();
  const brandSettingsQueries = new BrandSettingsQueries();
  const logoQueries = new LogoQueries();
  const execQueries = new SetupExecutionQueries();
  const portalQueries = new SetupPortalQueries();
  const portalAccountQueries = new PortalAccountQueries();
  const districtQueries = new BranchDistrictQueries();
  const welcomePackQueries = new WelcomePackQueries();
  const bcCustomerQueries = new BcCustomerQueries();
  const contractsQueries = new ContractsQueries();
  const contractTemplateQueries = new ContractTemplateQueries();
  const adobeSignAgreementQueries = new AdobeSignAgreementQueries();
  const approvalQueries = new ApprovalQueries();
  const trainingQueries = new TrainingQueries();
  const devReviewQueries = new DevReviewQueries();
  const backlogQueries = new BacklogQueries();

  // Purge transient MS365 data from previous session
  const purgedCount = await taskQueries.deleteTransientTasks();
  if (purgedCount > 0) console.log(`[Startup] Purged ${purgedCount} transient tasks from previous session`);

  // Build onboarder name → user ID lookup for milestone ownership
  const onboarderToUserId = new Map<string, number>();
  for (const u of await userQueries.getAll()) {
    onboarderToUserId.set(u.username.toLowerCase(), u.id);
    if (u.display_name) onboarderToUserId.set(u.display_name.toLowerCase(), u.id);
  }

  // Re-sync milestone task priorities on startup (with per-onboarder ownership)
  await resyncAllMilestoneTasks(milestoneQueries, taskQueries, onboarderToUserId);

  // Auto-seed onboarding matrix from xlsx if tables are empty
  if ((await onboardingConfigQueries.getAllSaleTypes()).length === 0) {
    const xlsxPath = path.resolve('OnboardingMatix.xlsx');
    if (fs.existsSync(xlsxPath)) {
      try {
        const XLSX = (await import('xlsx')).default;
        const { importFromWorkbook } = await import('./routes/onboarding-config.js');
        const wb = XLSX.readFile(xlsxPath);
        const stats = await importFromWorkbook(wb, onboardingConfigQueries);
        console.log(`[N.O.V.A] Auto-seeded onboarding matrix: ${stats.ticketGroups} ticket groups, ${stats.saleTypes} sale types, ${stats.capabilities} capabilities, ${stats.matrixCells} matrix cells, ${stats.items} items`);
      } catch (err) {
        console.error('[N.O.V.A] Onboarding auto-seed failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  // Ensure "Delivery QA" ticket group exists (used for the parent QA ticket)
  const existingGroups = await onboardingConfigQueries.getAllTicketGroups();
  if (!existingGroups.find(g => g.name === 'Delivery QA')) {
    await onboardingConfigQueries.createTicketGroup('Delivery QA', -1);
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

  // Jira cache layer — single background sync replaces per-consumer live API calls
  const jiraCacheQueries = new JiraCacheQueries();
  let jiraSyncService: JiraSyncService | null = null;

  // Create sync service early so routes can reference it
  const syncJiraClient = buildOnboardingJiraClient();
  if (syncJiraClient) {
    jiraSyncService = new JiraSyncService(syncJiraClient, settingsQueries);
  }

  // 4. Express app
  const app = express();
  app.use(compression());
  app.use(helmet({ contentSecurityPolicy: false })); // CSP off for SPA
  app.use(cors());
  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());

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

  // Public survey routes — token-based, no auth
  app.use('/api/survey', createSurveyPublicRoutes());

  // KPI Wallboard — public route for TV displays (no auth required)
  app.use('/api/public/wallboard', createKpiWallboardRoutes(settingsQueries));

  // AI Approval ingest from n8n (no auth required)
  app.post('/api/public/approvals/ingest', (req, res) => {
    const { ticket_id, ticket_summary, reporter_name, reporter_email, ai_response_adf, conversation_json, kb_sources, resume_url, priority, business_hours } = req.body;
    if (!ticket_id || !ticket_summary || !resume_url) {
      res.status(400).json({ ok: false, error: 'ticket_id, ticket_summary, and resume_url are required' });
      return;
    }
    const businessHours = business_hours || 2;
    const expiresAt = toSqliteDatetime(addBusinessHours(new Date(), businessHours));
    const id = approvalQueries.create({
      ticket_id, ticket_summary, reporter_name, reporter_email,
      ai_response_adf: typeof ai_response_adf === 'string' ? ai_response_adf : JSON.stringify(ai_response_adf),
      conversation_json: typeof conversation_json === 'string' ? conversation_json : JSON.stringify(conversation_json),
      kb_sources: typeof kb_sources === 'string' ? kb_sources : JSON.stringify(kb_sources),
      resume_url, priority, expires_at: expiresAt,
    });
    res.json({ ok: true, data: { id } });
  });

  // AI Approval KPI stats for n8n (no auth required)
  app.get('/api/public/approvals/kpi-stats', (_req, res) => {
    const today = approvalQueries.getTodayStats();
    const daily = approvalQueries.getDailyStats(90);
    res.json({ ok: true, data: { today, daily } });
  });

  // Agent approval callback (no auth — called by internal approval system)
  // Handles both GET (from approval route's resume_url fetch) and POST (direct API)
  const agentCallbackHandler = async (req: any, res: any) => {
    if (!agentLoop) {
      res.status(503).json({ ok: false, error: 'Agent loop not available' });
      return;
    }
    const action = req.body?.action || req.query?.action;
    const ticketKey = req.body?.ticketKey || req.query?.ticketKey;
    const approvalId = req.body?.approvalId || req.query?.approvalId;
    const editedResponse = req.body?.editedResponse;
    const decidedBy = req.body?.decidedBy || req.query?.decidedBy;
    if (!action || !ticketKey) {
      res.status(400).json({ ok: false, error: 'action and ticketKey are required' });
      return;
    }
    try {
      await agentLoop.handleApprovalCallback(action, ticketKey, approvalId ? Number(approvalId) : undefined, editedResponse, decidedBy);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Callback failed' });
    }
  };
  app.get('/api/public/agent/approval-callback', agentCallbackHandler);
  app.post('/api/public/agent/approval-callback', agentCallbackHandler);

  // Abuse report webhook (WP-22) — public endpoint for external systems (n8n, etc.)
  app.post('/api/public/webhooks/abuse-report', express.json(), async (req, res) => {
    try {
      if (!agentJiraClient) { res.status(503).json({ ok: false, error: 'Jira not configured' }); return; }
      const processor = new AbuseReportProcessor(settingsQueries, agentJiraClient);
      const result = await processor.processReport(req.body);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Abuse report processing failed' });
    }
  });

  // Training export — token-gated, no JWT, for n8n automation (Training Matrix Sync).
  // Returns a flat dump of categories, items, scores, members, and the display-name
  // map needed to render the matrix into Obsidian. Requires TRAINING_EXPORT_TOKEN env
  // var set and caller to provide header X-Training-Export-Token matching it.
  app.get('/api/public/training-export', async (req, res) => {
    const expected = process.env.TRAINING_EXPORT_TOKEN;
    if (!expected) {
      res.status(503).json({ ok: false, error: 'TRAINING_EXPORT_TOKEN not configured on server' });
      return;
    }
    const provided = (req.headers['x-training-export-token'] || req.query.token) as string | undefined;
    if (!provided || provided !== expected) {
      res.status(401).json({ ok: false, error: 'Invalid or missing X-Training-Export-Token' });
      return;
    }

    try {
      const categories = trainingQueries.getCategories();
      const items = trainingQueries.getItems();
      const scores = trainingQueries.getScores();
      const memberIds = trainingQueries.getMembers();
      const users = (await userQueries.getAll()).map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name || u.username,
        email: u.email,
        role: u.role,
      }));
      res.json({
        ok: true,
        exportedAt: new Date().toISOString(),
        categories,
        items,
        scores,
        memberIds,
        users,
      });
    } catch (e) {
      console.error('[training-export]', e);
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

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

  // Microsoft Graph — direct API with client credentials (SharePoint sync)
  let msGraphClient: MsGraphClient | null = null;
  function buildMsGraphClient() {
    const s = settingsQueries.getAll();
    if (s.sp_client_id && s.sp_client_secret && s.sp_tenant_id) {
      msGraphClient = new MsGraphClient({
        clientId: s.sp_client_id,
        clientSecret: s.sp_client_secret,
        tenantId: s.sp_tenant_id,
      });
      console.log('[N.O.V.A] Microsoft Graph: Client configured (client credentials)');
    } else {
      msGraphClient = null;
    }
  }
  buildMsGraphClient();

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
        configApiUrl: s.bym_config_api_url || undefined,
      });
      console.log('[N.O.V.A] BriefYourMarket Setup: Service configured');
    } else {
      bymClient = null;
    }
  }
  buildBymService();

  // Adobe Sign — OAuth REST client
  let adobeSignClient: AdobeSignClient | null = null;
  function buildAdobeSignService() {
    const s = settingsQueries.getAll();
    adobeSignClient = buildAdobeSignClient(s, (newToken) => {
      settingsQueries.set('adobe_sign_refresh_token', newToken);
    });
    if (adobeSignClient) {
      console.log('[N.O.V.A] Adobe Sign: Service configured');
    }
  }
  buildAdobeSignService();

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

  // Adobe Sign OAuth callback — public (redirect from Adobe, no NOVA JWT)
  app.get('/api/adobe-sign/callback', async (req, res) => {
    const client = adobeSignClient;
    const code = req.query.code as string | undefined;
    if (!client) { res.status(503).json({ ok: false, error: 'Adobe Sign is not configured.' }); return; }
    if (!code) {
      const error = req.query.error as string | undefined;
      res.status(400).json({ ok: false, error: error ?? 'No authorization code received' });
      return;
    }
    try {
      await client.exchangeCode(code);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontendUrl}/#adobe-sign?connected=1`);
    } catch (err) {
      console.error('[Adobe Sign] OAuth callback error:', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'OAuth exchange failed' });
    }
  });

  // Calyx portal — public + portal-JWT auth (no NOVA auth)
  app.use('/api/calyx/portal', createCalyxPortalRoutes(calyxDb, settingsQueries));

  // Protected API routes — role cache with 30s TTL avoids hitting DB on every single request
  const roleCache = new Map<number, { role: string; expires: number }>();
  const ROLE_CACHE_TTL = 30_000;
  app.use('/api', authMiddleware(jwtSecret, async (id) => {
    const now = Date.now();
    const cached = roleCache.get(id);
    if (cached && cached.expires > now) return cached.role;
    const user = await userQueries.getById(id);
    if (user?.role) roleCache.set(id, { role: user.role, expires: now + ROLE_CACHE_TTL });
    return user?.role;
  }));

  // Lightweight user list — any authenticated user
  app.get('/api/users/list', async (_req, res) => {
    const users = await userQueries.getAll();
    const list = users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      team_id: u.team_id ?? null,
    }));
    res.json({ ok: true, data: list });
  });

  const getCalyxSettings = () => settingsQueries.getAll();
  app.use('/api/calyx', createCalyxRoutes(calyxQueries, calyxDb, getCalyxSettings));
  app.use('/api/calyx', createCalyxPhase4Routes(calyxDb, getCalyxSettings));
  app.use('/api/calyx', createCalyxPhase5Routes(calyxDb, settingsQueries));
  app.use('/api/calyx', createCalyxReportRoutes(calyxDb));
  app.use('/api/tasks', createTaskRoutes(taskQueries, aggregator, milestoneQueries, userSettingsQueries, settingsQueries, onboardingRunQueries, problemTicketQueries));
  app.use('/api/health', createHealthRoutes(mcpManager));
  app.use('/api/settings', createSettingsRoutes(settingsQueries, userSettingsQueries, (key) => {
    // Restart sync timers when interval settings change
    if (key.includes('interval_minutes')) restartSyncTimers();
    // Rebuild D365 service when credentials change
    if (key.startsWith('d365_')) buildD365Service();
    if (key.startsWith('sp_')) buildMsGraphClient();
    // Rebuild AzDO / BYM services
    if (key.startsWith('azdo_')) buildAzDoService();
    if (key.startsWith('bym_')) buildBymService();
    if (key.startsWith('adobe_sign_')) buildAdobeSignService();
  }));
  app.use('/api/integrations', createIntegrationRoutes(mcpManager, settingsQueries, userSettingsQueries, uvxCommand, () => d365Service, (key) => {
    if (key.startsWith('d365_')) buildD365Service();
    if (key.startsWith('sp_')) buildMsGraphClient();
    if (key.startsWith('azdo_')) buildAzDoService();
    if (key.startsWith('bym_')) buildBymService();
    if (key.startsWith('adobe_sign_')) buildAdobeSignService();
  }, buildOnboardingJiraClient, () => bymClient));
  app.use('/api/ingest', createIngestRoutes(taskQueries, settingsQueries));
  app.use('/api/actions', createActionRoutes(taskQueries, settingsQueries, userSettingsQueries));
  app.use('/api/jira', createJiraRoutes(taskQueries, buildOnboardingJiraClient, () => settingsQueries.getAll(), userSettingsQueries));
  app.use('/api/standups', requireAreaAccess('nova_features', 'view'), createStandupRoutes(taskQueries, settingsQueries, ritualQueries, userSettingsQueries));
  const spSync = msGraphClient ? new SharePointSync(msGraphClient, deliveryQueries, () => settingsQueries.getAll()) : undefined;
  app.use('/api/delivery', createDeliveryRoutes(deliveryQueries, spSync, milestoneQueries, taskQueries, requireAreaAccess, auditQueries, onboardingRunQueries, settingsQueries));
  // Milestone routes — wired with workflow engine after buildOrchestrator is defined (see below)
  // app.use('/api/milestones', ...) is registered after buildOrchestrator
  app.use('/api/crm', createCrmRoutes(crmQueries, deliveryQueries, onboardingRunQueries, requireAreaAccess));
  app.use('/api/contracts', createContractsRoutes(bcCustomerQueries, contractsQueries, settingsQueries));
  app.use('/api/adobe-sign', createAdobeSignRoutes(() => adobeSignClient, adobeSignAgreementQueries, contractTemplateQueries, settingsQueries));
  app.use('/api/surveys', createSurveyRoutes(settingsQueries, userQueries, teamQueries));
  app.use('/api/approvals', createApprovalRoutes(approvalQueries, settingsQueries));
  app.use('/api/training', createTrainingRoutes(trainingQueries, userQueries, requireAreaAccess, settingsQueries));
  app.use('/api/o365', createO365Routes(mcpManager));
  app.use('/api/admin', createAdminRoutes(userQueries, teamQueries, userSettingsQueries, settingsQueries, buildServiceDeskJiraClient, userTeamQueries));

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

  // Config service management (admin-only)
  app.post('/api/admin/config/migrate', async (req, res) => {
    if (!isAdmin((req as any).user?.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    try {
      const result = await configService.migrateFromFallback();
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Migration failed' });
    }
  });
  app.post('/api/admin/config/refresh-secrets', async (req, res) => {
    if (!isAdmin((req as any).user?.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    try {
      const count = await configService.refreshSecrets();
      res.json({ ok: true, data: { refreshed: count } });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Refresh failed' });
    }
  });
  app.get('/api/admin/config/settings', async (req, res) => {
    if (!isAdmin((req as any).user?.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    try {
      const settings = await configService.getSettingsWithMeta();
      res.json({ ok: true, data: settings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get settings' });
    }
  });

  app.use('/api/kpi-data', requireAreaAccess(['kpis', 'qa'], 'view'), createKpiDataRoutes(settingsQueries, userQueries));
  let boardMiLlm: import('./services/llm-service.js').LlmService | null = null;
  app.use('/api/board-mi', requireAreaAccess('mi', 'view'), createBoardMiRoutes(
    settingsQueries,
    devReviewQueries,
    buildServiceDeskJiraClient,
    jiraCacheQueries,
    jiraSyncService,
    () => boardMiLlm,
  ));
  app.use('/api/dev-review', createDevReviewRoutes(
    devReviewQueries,
    settingsQueries,
    userQueries,
    notificationQueries,
    teamQueries,
    requireAreaAccess,
    buildOnboardingJiraClient,
    userTeamQueries,
    jiraCacheQueries,
    jiraSyncService,
  ));
  app.use('/api/trends', requireAreaAccess(['kpis', 'qa'], 'view'), createTrendsRoutes(settingsQueries, userQueries));
  app.use('/api/backfill', requireAreaAccess('qa', 'view'), createBackfillRoutes(settingsQueries));
  app.use('/api/backlog', createBacklogRoutes(backlogQueries));
  app.use('/api/sales', requireAreaAccess('sales', 'view'), createSalesHotboxRoutes(salesQueries, requireAreaAccess));
  app.use('/api/dynamics365', createDynamics365Routes(() => d365Service, crmQueries));
  app.use('/api/feedback', createFeedbackRoutes(feedbackQueries, taskQueries, userQueries, notificationQueries));
  app.use('/api/audit', createAuditRoutes(auditQueries));
  app.use('/api/team', requireAreaAccess('nova_features', 'view'), createTeamRoutes(deliveryQueries, milestoneQueries, taskQueries, userQueries));
  app.use('/api/notifications', createNotificationRoutes(notificationQueries, notificationEngine));
  app.use('/api/people', createPeopleRoutes({ userQueries, settingsQueries, mcpManager, notificationQueries }));

  // Start Jira sync (service was created earlier so routes can reference it)
  let fullSyncPromise: Promise<void> | null = null;
  if (jiraSyncService) {
    fullSyncPromise = jiraSyncService.fullSync().catch(err =>
      console.error('[jira-sync] Initial full sync failed:', err instanceof Error ? err.message : err)
    );
    jiraSyncService.start(45_000);
  }

  let aiScanTimer: ReturnType<typeof setInterval> | null = null;

  // Agent loop — feature-flagged, admin-only
  const agentJiraClient = buildOnboardingJiraClient();
  const llmService = new LlmService(settingsQueries);
  boardMiLlm = llmService;
  const llmDiag = llmService.getDiagnostics();
  console.log(`[N.O.V.A] LLM config: primary=${llmDiag.primaryProvider} (${llmDiag.primaryKeyPrefix}), failover=${llmDiag.failoverProvider} (${llmDiag.failoverKeyPrefix})`);
  if (!llmDiag.primaryAvailable) console.warn(`[N.O.V.A] WARNING: Primary LLM provider has no API key configured!`);

  if (agentJiraClient) {
    agentLoop = new AgentLoop(agentJiraClient, llmService, settingsQueries, approvalQueries, jiraCacheQueries);

    const assignmentEngine = new AssignmentEngine(agentJiraClient, settingsQueries, 'NT');
    const availabilityService = new AgentAvailabilityService(settingsQueries);
    const ticketClassifier = new TicketClassifier(llmService, agentJiraClient, 'NT');
    const kbEmbedder = new KbEmbedder(settingsQueries);
    agentLoop.setKbEmbedder(kbEmbedder);
    const kbChunker = new KbChunker(settingsQueries);
    const kbSyncWorker = new KbSyncWorker(kbEmbedder, kbChunker);
    const agentKbSearch = new KbSearchService(settingsQueries, kbEmbedder);
    const briefEngine = new BriefEngine(llmService, agentJiraClient, agentKbSearch, 'NT');

    // KB Retrieval — register providers and schedule sync
    const kbProviders = new Map<string, KbSyncProvider>();
    const tfsProvider = new TfsDocsSyncProvider(settingsQueries);
    const confluenceProvider = new ConfluenceSyncProvider(settingsQueries);
    kbProviders.set('tfs-docs', tfsProvider);
    kbProviders.set('confluence', confluenceProvider);

    app.use('/api/kb-admin', createKbAdminRoutes({ syncWorker: kbSyncWorker, searchService: agentKbSearch, embedder: kbEmbedder, providers: kbProviders }));

    // Staggered initial sync (30s for TFS, 45s for Confluence)
    setTimeout(() => {
      if (tfsProvider.isConfigured()) {
        kbSyncWorker.sync(tfsProvider).catch(e => console.warn('[kb-sync] TFS initial sync failed:', e.message));
      } else {
        console.log('[kb-sync] TFS: skipping (no PAT configured)');
      }
    }, 30_000);
    setTimeout(() => {
      if (confluenceProvider.isConfigured()) {
        kbSyncWorker.sync(confluenceProvider).catch(e => console.warn('[kb-sync] Confluence initial sync failed:', e.message));
      } else {
        console.log('[kb-sync] Confluence: skipping (no space keys configured)');
      }
    }, 45_000);

    // Recurring sync timers
    const tfsSyncMin = parseInt(settingsQueries.get('tfs_docs_sync_interval_min') || '60', 10);
    const confSyncMin = parseInt(settingsQueries.get('confluence_sync_interval_min') || '60', 10);
    setInterval(() => {
      if (tfsProvider.isConfigured()) kbSyncWorker.sync(tfsProvider).catch(() => {});
    }, tfsSyncMin * 60_000);
    setInterval(() => {
      if (confluenceProvider.isConfigured()) kbSyncWorker.sync(confluenceProvider).catch(() => {});
    }, confSyncMin * 60_000);
    const pipelineMonitor = new PipelineMonitor(settingsQueries);
    pipelineMonitor.ensureRunsTable().catch(e => console.warn('[pipeline-monitor] ensureRunsTable failed:', e.message));
    pipelineMonitor.ensureUatTables().then(() =>
      pipelineMonitor.truncateUatTables()
    ).catch(e => console.warn('[pipeline-monitor] UAT table setup failed:', e.message));

    const kpiPipeline = new KpiPipeline(settingsQueries, llmService, agentJiraClient, 'NT', pipelineMonitor, jiraCacheQueries);
    const qaPipeline = new QaPipeline(settingsQueries, llmService, agentJiraClient, 'NT', pipelineMonitor);
    const driftDetector = new DriftDetector(settingsQueries, agentLoop.getAlertService());

    // Calendar sync (WP-12)
    const calendarSync = new CalendarSyncService(settingsQueries);

    // Operational workflow services (WP-22)
    const productCancellation = new ProductCancellationService(settingsQueries, agentJiraClient);
    const abuseReportProcessor = new AbuseReportProcessor(settingsQueries, agentJiraClient);
    const callReviewService = new CallReviewService(settingsQueries, llmService);

    const suggestionEngine = new SuggestionEngine(agentLoop.getGuardrails(), agentLoop.getAutonomyEngine(), settingsQueries, llmService);

    // Daily briefing service
    const briefingEmailService = new EmailService(() => settingsQueries.getAll());
    const dailyBriefingService = new DailyBriefingService(llmService, jiraCacheQueries, settingsQueries, calendarSync, briefingEmailService);
    app.use('/api/briefing', createBriefingRoutes(dailyBriefingService, userQueries));

    // KB article service
    const kbArticleService = new KbArticleService(llmService, settingsQueries, mcpManager);
    app.use('/api/kb-articles', createKbArticleRoutes(kbArticleService));

    // AI self-improvement engine
    const aiImprovementService = new AiImprovementService(llmService, settingsQueries, agentJiraClient);
    app.use('/api/ai-improvement', createAiImprovementRoutes(aiImprovementService));

    // AI learnings (human-directed feedback)
    const aiLearningService = new AiLearningService();
    app.use('/api/ai-learnings', createAiLearningRoutes(aiLearningService));
    agentLoop.getReasoner().setLearningService(aiLearningService);

    // Human edit detection — every 30 minutes, initial run after 2 minutes
    aiScanTimer = setInterval(async () => {
      try {
        const signals = await aiImprovementService.detectHumanEdits();
        if (signals > 0) console.log(`[ai-improvement] edit scan: ${signals} signals`);
      } catch (err) {
        console.error('[ai-improvement] edit scan failed:', err);
      }
    }, 30 * 60 * 1000);
    setTimeout(() => { aiImprovementService.detectHumanEdits().catch(() => {}); }, 120_000);

    // Comparison scan — 4x daily (default 06:00, 11:00, 14:00, 17:00 UK)
    function parseCronHours(cron: string): number[] {
      const parts = cron.trim().split(/\s+/);
      if (parts.length < 2) return [6, 11, 14, 17];
      return parts[1].split(',').map(h => parseInt(h, 10)).filter(h => !isNaN(h));
    }
    const comparisonCron = settingsQueries.get('agent_comparison_scan_cron') || '0 6,11,14,17 * * *';
    const comparisonHours = parseCronHours(comparisonCron);
    let lastComparisonHour = -1;
    void setInterval(() => {
      const ukHour = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false });
      const hour = parseInt(ukHour, 10);
      if (comparisonHours.includes(hour) && hour !== lastComparisonHour) {
        lastComparisonHour = hour;
        aiImprovementService.runComparisonScan().then(n => {
          if (n > 0) console.log(`[ai-improvement] comparison scan: ${n} compared`);
        }).catch(err => console.error('[ai-improvement] comparison scan failed:', err));
      }
    }, 60_000);
    // Initial comparison scan after 3 minutes
    setTimeout(() => { aiImprovementService.runComparisonScan().catch(() => {}); }, 180_000);

    // Gamification
    const gamificationService = new GamificationService();
    app.use('/api/gamification', createGamificationRoutes(gamificationService));

    // Escalation logging
    const escalationLog = new EscalationLogService();
    app.use('/api/escalations', createEscalationRoutes({
      escalationLog,
      jiraClient: agentLoop.getJiraClient(),
    }));

    app.use('/api/agent', createAgentRoutes(agentLoop, {
      assignmentEngine,
      availabilityService,
      ticketClassifier,
      briefEngine,
      kpiPipeline,
      qaPipeline,
      pipelineMonitor,
      settingsQueries,
      jiraCache: jiraCacheQueries,
      jiraSyncService,
      suggestionEngine,
      riskScorer: agentLoop.getRiskScorer(),
      escalationLog,
      driftDetector,
      userQueries,
      userTeamQueries,
      teamQueries,
    }));

    const bankHolidaysPath = path.join(__dirname, '../../config/bank-holidays.json');
    let bankHolidays: string[] = [];
    try {
      const bhData = JSON.parse(fs.readFileSync(bankHolidaysPath, 'utf-8'));
      bankHolidays = bhData.holidays ?? [];
    } catch { /* bank holidays file optional */ }

    const queueRanker = new QueueRanker(jiraCacheQueries, settingsQueries, bankHolidays);
    const deferService = new DeferService(bankHolidays);
    app.use('/api/my-tickets', createMyTicketsRoutes({
      jiraClient: agentLoop.getJiraClient(),
      queueRanker,
      deferService,
      userQueries,
      bankHolidays,
    }));

    // Defer sweeper — check every 60s for overdue/elapsed defers
    setInterval(() => {
      deferService.sweepOverdueDefers().catch(e =>
        console.warn('[defer-sweeper] sweep failed:', e.message));
    }, 60_000);

    // Ensure NOVA AI synthetic agent exists in dbo.Agent (idempotent)
    (async () => {
      try {
        const all = settingsQueries.getAll();
        const { kpi_sql_server: srv, kpi_sql_database: db, kpi_sql_user: usr, kpi_sql_password: pwd } = all;
        if (!srv || !db || !usr || !pwd) return;
        const sqlMod = await import('mssql');
        const p = await new sqlMod.default.ConnectionPool({
          server: srv, database: db, user: usr, password: pwd,
          options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 30000,
        }).connect();
        const exists = await p.request()
          .input('key', sqlMod.default.NVarChar(200), 'nova-ai@system.local')
          .query(`SELECT AgentId FROM dbo.Agent WHERE AgentKey = @key`);
        if (exists.recordset.length === 0) {
          await p.request()
            .input('name', sqlMod.default.NVarChar(100), 'NOVA')
            .input('surname', sqlMod.default.NVarChar(100), 'AI')
            .input('key', sqlMod.default.NVarChar(200), 'nova-ai@system.local')
            .input('tierCode', sqlMod.default.NVarChar(10), 'AI')
            .input('team', sqlMod.default.NVarChar(50), 'NOVA AI')
            .input('dept', sqlMod.default.NVarChar(10), 'NOVA_AI')
            .input('now', sqlMod.default.DateTime2, new Date())
            .query(`INSERT INTO dbo.Agent (AgentName, AgentSurname, AgentKey, TierCode, Team,
                     MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3,
                     IsAvailable, IsActive, Department, CreatedAt, UpdatedAt)
                    VALUES (@name, @surname, @key, @tierCode, @team, 0, 0, 0, 0, 1, @dept, @now, @now)`);
          console.log('[kpi] NOVA AI synthetic agent created in dbo.Agent');
        }
        await p.close();
      } catch (err) {
        console.warn('[kpi] Failed to seed NOVA AI agent:', err instanceof Error ? err.message : err);
      }
    })();

    // Ensure NOVA AI synthetic agent exists in KPI database
    kpiPipeline.ensureNovaAiAgent().catch(() => {});

    // KPI pipeline timers (initial kicks staggered to avoid startup storm)
    setInterval(() => kpiPipeline.collectJiraSnapshot().catch(e => console.warn('[kpi-pipeline] snapshot failed:', e.message)), 10 * 60 * 1000);
    setInterval(() => kpiPipeline.snapshotAgentKpis().catch(e => console.warn('[kpi-pipeline] agent snapshot failed:', e.message)), 30 * 60 * 1000);
    setTimeout(() => kpiPipeline.collectJiraSnapshot().catch(() => {}), 90_000);

    // Daily digest at 17:30, weekly digest Monday 09:00
    setInterval(() => {
      const now = new Date();
      if (now.getHours() === 17 && now.getMinutes() >= 30 && now.getMinutes() < 40) {
        kpiPipeline.generateDailyDigest().catch(e => console.warn('[kpi-pipeline] daily digest failed:', e.message));
      }
      if (now.getDay() === 1 && now.getHours() === 9 && now.getMinutes() < 10) {
        kpiPipeline.generateWeeklyDigest().catch(e => console.warn('[kpi-pipeline] weekly digest failed:', e.message));
      }
    }, 10 * 60 * 1000);

    // SharePoint delivery sheet — auto-pull daily at 02:00
    if (spSync) {
      setInterval(() => {
        const now = new Date();
        if (now.getHours() === 2 && now.getMinutes() < 10 && !spSync.running) {
          console.log('[SP-Sync] Starting scheduled overnight pull');
          spSync.pull().catch(e => console.warn('[SP-Sync] scheduled pull failed:', e.message));
        }
      }, 10 * 60 * 1000);
    }

    // QA pipeline — score resolved tickets every 2 hours
    setInterval(() => qaPipeline.scoreRecentlyResolved(24).catch(e => console.warn('[qa-pipeline] scoring failed:', e.message)), 2 * 60 * 60 * 1000);
    setTimeout(() => qaPipeline.scoreRecentlyResolved(24).catch(() => {}), 120_000);

    // Pipeline health check — every 15 min
    setInterval(() => pipelineMonitor.checkStaleRuns().catch(() => {}), 15 * 60 * 1000);

    // WP-62: Drift detection — Monday 06:00 UK, with startup catch-up
    let driftFiredThisWindow = false;
    (async () => {
      try {
        const latest = await driftDetector.getLatestSnapshotDate();
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        if (!latest || latest < sevenDaysAgo) {
          console.log('[drift-detector] No recent snapshot — running startup catch-up');
          await driftDetector.snapshotDrift();
          driftFiredThisWindow = true;
        }
      } catch (e) {
        console.warn('[drift-detector] Startup catch-up failed:', e instanceof Error ? e.message : e);
      }
    })();
    setInterval(() => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      const ukMinute = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }));
      if (now.getDay() === 1 && ukHour === 6 && ukMinute < 10) {
        if (!driftFiredThisWindow) {
          driftFiredThisWindow = true;
          driftDetector.snapshotDrift().catch(e => console.warn('[drift-detector] Weekly snapshot failed:', e.message));
        }
      } else {
        driftFiredThisWindow = false;
      }
    }, 10 * 60 * 1000);

    // Daily briefing generation — check every 10 min, generate at configured time (default 07:00)
    setInterval(async () => {
      try {
        const briefingTime = settingsQueries.get('agent_briefing_time') || '07:00';
        const [targetH, targetM] = briefingTime.split(':').map(Number);
        const now = new Date();
        const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
        const ukMinute = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }));
        if (ukHour === targetH && ukMinute >= targetM && ukMinute < targetM + 10) {
          const allUsers = await userQueries.getAll();
          const eligible = allUsers.filter(u => u.email && u.role && u.role.split(',').map(r => r.trim()).includes('briefing'));
          await dailyBriefingService.generateAll(eligible.map(u => ({
            id: u.id, email: u.email!, display_name: u.display_name || u.username, role: u.role,
          })));
        }
      } catch (e) {
        console.warn('[daily-briefing] Timer failed:', e instanceof Error ? e.message : e);
      }
    }, 10 * 60 * 1000);

    // Calendar sync (WP-12) — every 30 min during working hours
    const runCalendarSync = () => {
      const hour = new Date().getHours();
      if (hour >= 7 && hour <= 19) {
        calendarSync.sync().catch(e => console.warn('[calendar-sync] sync failed:', e instanceof Error ? e.message : e));
      }
    };
    setInterval(runCalendarSync, 30 * 60 * 1000);
    setTimeout(runCalendarSync, 105_000);

    // Calendar availability routes (WP-12) — already behind global /api auth
    app.get('/api/calendar/availability', async (req, res) => {
      try {
        const date = req.query.date as string | undefined;
        const data = await calendarSync.getTeamAvailability(date);
        res.json({ ok: true, data });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get availability' });
      }
    });
    app.post('/api/calendar/sync', async (req, res) => {
      if (!isAdmin((req as any).user?.role)) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
      try {
        const result = await calendarSync.sync();
        res.json({ ok: true, data: result });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Calendar sync failed' });
      }
    });

    // Operational workflow routes (WP-22)
    app.get('/api/agent/abuse-reports', requireRole('admin', 'super_admin'), async (req, res) => {
      try {
        const status = req.query.status as string | undefined;
        const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
        const data = await abuseReportProcessor.getReports(status, limit);
        res.json({ ok: true, data });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get abuse reports' });
      }
    });

    app.post('/api/agent/call-reviews', requireRole('admin', 'super_admin'), async (req, res) => {
      try {
        const result = await callReviewService.reviewCall(req.body);
        res.json({ ok: true, data: result });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Call review failed' });
      }
    });

    app.get('/api/agent/call-reviews', requireRole('admin', 'super_admin'), async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
        const agentName = req.query.agentName as string | undefined;
        const data = await callReviewService.getReviews(limit, agentName);
        res.json({ ok: true, data });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to get call reviews' });
      }
    });

    app.post('/api/agent/product-cancellation/check', requireRole('admin', 'super_admin'), async (_req, res) => {
      try {
        const result = await productCancellation.checkForCancellations();
        res.json({ ok: true, data: result });
      } catch (err) {
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Cancellation check failed' });
      }
    });

    // Product cancellation check — every 4 hours during working hours
    setInterval(() => {
      const hour = new Date().getHours();
      if (hour >= 8 && hour <= 18) {
        productCancellation.checkForCancellations().catch(e =>
          console.warn('[product-cancellation] check failed:', e instanceof Error ? e.message : e)
        );
      }
    }, 4 * 60 * 60 * 1000);

    // Check MSSQL agent_config first (survives deploys), fall back to settings.json
    let agentEnabled = settingsQueries.get('agent_enabled') === 'true';
    try {
      const row = await queryOne<{ config_value: string }>(`SELECT config_value FROM agent_config WHERE config_key = 'agent_enabled'`);
      if (row) agentEnabled = row.config_value === 'true';
    } catch {}
    if (agentEnabled) {
      setTimeout(() => {
        agentLoop!.start();
        console.log('[N.O.V.A] Agent loop auto-started (agent_enabled=true, delayed 60s for startup stagger)');

        if (fullSyncPromise) {
          fullSyncPromise.then(async () => {
            try {
              const projects = (settingsQueries.get('agent_jira_project') || 'NT').split(',').map((p: string) => p.trim()).filter(Boolean);
              const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
              const gapTickets = await jiraCacheQueries.getRestartGapTickets(projects, oneHourAgo);
              if (gapTickets.length > 0) {
                console.log(`[Startup] Restart catch-up: ${gapTickets.length} ticket(s) created in last hour with no agent state — queuing`);
                agentLoop!.getPerceiver().queueCatchUpIssues(gapTickets);
              }
            } catch (err) {
              console.warn('[Startup] Restart catch-up failed:', err instanceof Error ? err.message : err);
            }
          });
        }
      }, 60_000);
    }
  } else {
    console.log('[N.O.V.A] Agent loop not available — no Jira credentials configured.');
  }

  // DELETE /api/data/source/:source — purge local records for a given integration source
  app.delete('/api/data/source/:source', async (req, res) => {
    const source = req.params.source;
    const validSources = ['jira', 'planner', 'todo', 'calendar', 'email', 'monday', 'dynamics365'];
    if (!validSources.includes(source)) {
      res.status(400).json({ ok: false, error: `Invalid source: ${source}. Valid: ${validSources.join(', ')}` });
      return;
    }
    try {
      let deleted = 0;
      if (source === 'dynamics365') {
        deleted = await crmQueries.deleteAllCustomers();
      } else {
        deleted = await taskQueries.deleteAllBySource(source);
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
    undefined,
    llmService,
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

  // Wallboard health-check (ultra-lightweight, no SQL)
  app.get('/wallboard/ping', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ts: Date.now() });
  });

  // Client-side error reporting — wallboard pages POST here when they detect failures
  app.post('/wallboard/report-error', express.json(), (req, res) => {
    const { route, status, message, consecutiveFailures, downSince } = req.body || {};
    if (route && status) {
      logWallboardClient(route, status, message || 'Client-reported error', consecutiveFailures || 1, downSince);
    }
    res.json({ ok: true });
  });

  /** JS-based auto-refresh for wallboard pages — detects 502s and reports them back */
  function wallboardRefreshScript(route: string): string {
    return `<script>
(function(){
  var fails=0, downSince=null, INTERVAL=30000, RETRY=5000, route='${route}';
  function refresh(){
    fetch(location.href,{cache:'no-store',redirect:'follow'}).then(function(r){
      if(r.ok) return r.text().then(function(html){
        if(fails>0){
          // recovered — report the outage to server
          fetch('/wallboard/report-error',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({route:route,status:502,message:'Recovered after '+fails+' failures',consecutiveFailures:fails,downSince:downSince})
          }).catch(function(){});
        }
        fails=0; downSince=null;
        document.open(); document.write(html); document.close();
      });
      // non-ok response (502, 500, etc)
      fails++;
      if(!downSince) downSince=new Date().toISOString();
      if(fails===1||fails%5===0){
        fetch('/wallboard/report-error',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({route:route,status:r.status,message:'HTTP '+r.status+' on refresh',consecutiveFailures:fails,downSince:downSince})
        }).catch(function(){});
      }
      setTimeout(refresh, RETRY);
    }).catch(function(err){
      // network error — IIS completely unreachable
      fails++;
      if(!downSince) downSince=new Date().toISOString();
      setTimeout(refresh, RETRY);
    });
  }
  setTimeout(refresh, INTERVAL);
})();
</script>`;
  }

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
<title>SLA Breach Board</title>
${wallboardRefreshScript('/wallboard/breached')}
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
<title>KPI Breach Board</title>
${wallboardRefreshScript('/wallboard/team-kpis')}
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
    panels: Array<{ label: string; kpi: string; altKpi?: string; sumKpis?: string[] }>,
    cols: number,
    route: string,
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

    function lookupOne(kpi: string, altKpi?: string): { count: number; rag: number | null } {
      const k = kpis.get(kpi.toLowerCase());
      if (k) return k;
      if (altKpi) {
        const a = kpis.get(altKpi.toLowerCase());
        if (a) return a;
      }
      return { count: 0, rag: null };
    }

    function lookup(p: { kpi: string; altKpi?: string; sumKpis?: string[] }): { count: number; rag: number | null } {
      if (!p.sumKpis?.length) return lookupOne(p.kpi, p.altKpi);
      let total = 0;
      let worstRag: number | null = null;
      for (const name of p.sumKpis) {
        const v = kpis.get(name.toLowerCase());
        if (v) {
          total += v.count;
          if (v.rag !== null && (worstRag === null || v.rag > worstRag)) worstRag = v.rag;
        }
      }
      return { count: total, rag: worstRag };
    }

    function ragColor(rag: number | null): string {
      if (rag === 1) return '#10b981';
      if (rag === 2) return '#eab308';
      if (rag === 3) return '#ef4444';
      return '#94a3b8';
    }

    const panelHtml = panels.map(p => {
      const data = lookup(p);
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
<title>${title}</title>
${wallboardRefreshScript(route)}
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

  type LivePanel = { label: string; queueKey: string; stat: 'active' | 'slaBreached' | 'noReply' | null };

  const LIVE_PANELS: LivePanel[] = [
    // CC row — Active
    { label: 'CC Incidents', queueKey: 'cc_incidents', stat: 'active' },
    { label: 'CC Service Requests', queueKey: 'cc_service_requests', stat: 'active' },
    { label: 'Property Jungle', queueKey: 'cc_tpj', stat: 'active' },
    // TS row — Active (Dev+T3 consolidated)
    { label: 'Production Active', queueKey: 'production', stat: 'active' },
    { label: 'Tier 2 Active', queueKey: 'tier2', stat: 'active' },
    { label: 'Development — Active', queueKey: 'development+tier3', stat: 'active' },
    // CC row — No Reply
    { label: 'CC Incidents — No Update', queueKey: 'cc_incidents', stat: 'noReply' },
    { label: 'CC SRs — No Update', queueKey: 'cc_service_requests', stat: 'noReply' },
    { label: 'Property Jungle — No Update', queueKey: 'cc_tpj', stat: 'noReply' },
    // TS row — No Reply (Dev+T3 consolidated)
    { label: 'Production — No Reply', queueKey: 'production', stat: 'noReply' },
    { label: 'Tier 2 — No Reply', queueKey: 'tier2', stat: 'noReply' },
    { label: 'Development — No Reply', queueKey: 'development+tier3', stat: 'noReply' },
    // CC row — Over SLA
    { label: 'CC Incidents — Over SLA', queueKey: 'cc_incidents', stat: 'slaBreached' },
    { label: 'CC SRs — Over SLA', queueKey: 'cc_service_requests', stat: 'slaBreached' },
    { label: 'Property Jungle — Over SLA', queueKey: 'cc_tpj', stat: 'slaBreached' },
    // TS row — Over SLA (Dev+T3 consolidated)
    { label: 'Production — Over SLA', queueKey: 'production', stat: 'slaBreached' },
    { label: 'Tier 2 — Over SLA', queueKey: 'tier2', stat: 'slaBreached' },
    { label: 'Development — Over SLA', queueKey: 'development+tier3', stat: 'slaBreached' },
  ];

  function renderLiveWallboard(title: string, subtitle: string, snap: CohortSnapshot, route: string): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB');
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const staleMs = Date.now() - snap.updatedAt.getTime();
    const neverLoaded = snap.updatedAt.getTime() === 0;
    const staleBanner = neverLoaded
      ? `<div style="background:#78350f;color:#fbbf24;padding:6px 12px;border-radius:8px;font-size:11px;margin-bottom:10px;text-align:center">Cache not yet loaded — waiting for first refresh</div>`
      : staleMs > 10 * 60 * 1000
        ? `<div style="background:#78350f;color:#fbbf24;padding:6px 12px;border-radius:8px;font-size:11px;margin-bottom:10px;text-align:center">Data is ${Math.round(staleMs / 60000)}m old — cache may be stale</div>`
        : '';

    const queues = snap.queues as Record<string, { active: number; noReply: number; slaBreached: number }>;

    function resolve(p: LivePanel): { value: string; color: string; flash: boolean } {
      if (p.stat === null) return { value: '—', color: '#475569', flash: false };
      const keys = p.queueKey.split('+');
      let total = 0;
      for (const k of keys) total += queues[k]?.[p.stat] ?? 0;
      const isBreachStat = p.stat === 'slaBreached';
      const color = isBreachStat ? (total > 0 ? '#ef4444' : '#10b981') : (total > 0 ? '#e2e8f0' : '#10b981');
      return { value: String(total), color, flash: isBreachStat && total > 0 };
    }

    const panelHtml = LIVE_PANELS.map(p => {
      const { value, color, flash } = resolve(p);
      const flashClass = flash ? ' flash-red' : '';
      return `<div class="${flashClass}" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center;align-items:center">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;text-align:center;margin-bottom:6px;letter-spacing:.2px">${p.label}</div>
        <div style="font-size:48px;font-weight:800;letter-spacing:-2px;line-height:1;color:${color}">${value}</div>
      </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${wallboardRefreshScript(route)}
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}.wrap{max-width:1600px;margin:0 auto;padding:12px 20px;min-height:100vh;display:flex;flex-direction:column}.flash-red{animation:flash 1s ease-in-out infinite}@keyframes flash{0%,100%{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}50%{background:rgba(239,68,68,.35);border-color:rgba(239,68,68,.8);box-shadow:0 0 24px rgba(239,68,68,.5)}}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
  <div><h1 style="font-size:18px;font-weight:800;letter-spacing:-0.5px">${title}</h1><div style="font-size:9px;color:#64748b;margin-top:1px">${subtitle}</div></div>
  <div style="font-size:9px;color:#64748b">Live from cache &middot; Updated ${timeStr}</div>
</div>
${staleBanner}
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;flex:1">
${panelHtml}
</div>
<div style="text-align:center;margin-top:8px;font-size:9px;color:#475569">nurtur.tech &middot; ${title} &middot; ${dateStr}</div>
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
      ], 3, '/wallboard/cc');
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
        { label: 'Development — Active Tickets', kpi: 'Number of Tickets in Development', sumKpis: ['Number of Tickets in Development', 'Number of Tickets in Tier 3'] },
        { label: 'Production — No Reply', kpi: 'Number of Tickets With No Reply in Production' },
        { label: 'Tier 2 — No Reply', kpi: 'Number of Tickets With No Reply in Tier 2' },
        { label: 'Development — No Reply', kpi: 'Number of Tickets With No Reply in Tier 3', sumKpis: ['Number of Tickets With No Reply in Development', 'Number of Tickets With No Reply in Tier 3'] },
        { label: 'Production — Over SLA', kpi: 'Production over SLA (actionable)' },
        { label: 'Tier 2 — Over SLA', kpi: 'Tier 2 over SLA (actionable)' },
        { label: 'Development — Over SLA', kpi: 'Development over SLA (actionable)', sumKpis: ['Development over SLA (actionable)', 'Tier 3 over SLA (actionable)'] },
      ], 3, '/wallboard/tech-support');
      res.send(html);
      logWallboard('/wallboard/tech-support', 'info', 200, Date.now() - wbStart, 'OK', { sqlServer: settingsQueries.getAll().kpi_sql_server });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/tech-support', 'error', 500, Date.now() - wbStart, msg, { sqlServer: settingsQueries.getAll().kpi_sql_server, error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Key Accounts wallboard — CC+TS panels scoped to Key_Account label
  app.get('/wallboard/key-accounts', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const snap = getCohortSnapshot('key_accounts');
      const html = renderLiveWallboard('Key Accounts', 'CC + TS queue metrics — Key Account customers only', snap, '/wallboard/key-accounts');
      res.send(html);
      logWallboard('/wallboard/key-accounts', 'info', 200, Date.now() - wbStart, `OK — cache age ${Math.round((Date.now() - snap.updatedAt.getTime()) / 1000)}s`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/key-accounts', 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Customer Success wallboard — CC+TS panels scoped to non-KA customers
  app.get('/wallboard/customer-success', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const snap = getCohortSnapshot('customer_success');
      const html = renderLiveWallboard('Customer Success', 'CC + TS queue metrics — Customer Success cohort (excludes Key Accounts)', snap, '/wallboard/customer-success');
      res.send(html);
      logWallboard('/wallboard/customer-success', 'info', 200, Date.now() - wbStart, `OK — cache age ${Math.round((Date.now() - snap.updatedAt.getTime()) / 1000)}s`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/customer-success', 'error', 500, Date.now() - wbStart, msg);
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
      const existing = await ritualQueries.getByDate(todayStr, 'morning');
      if (existing.length > 0) return; // already generated

      const tasks = await taskQueries.getAll();
      if (tasks.length === 0) return;

      // Get yesterday's ritual for rollover context
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayRituals = await ritualQueries.getByDate(
        yesterday.toISOString().split('T')[0], 'morning'
      );

      console.log('[PreLoad] Generating morning briefing in background...');
      const briefing = generateMorningBriefing(tasks, yesterdayRituals[0] ?? null);
      const plannedIds = briefing.top_priorities.map((p) => p.task_id);
      await ritualQueries.create({
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
  const primaryAdmin = await (async () => {
    const users = await userQueries.getAll();
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

  // Problem Ticket Scanner: configurable interval (default 15 min), 0 disables
  const ptScanMinutes = Number(settingsQueries.get('problem_scanner_interval_minutes')) || 15;
  let ptScanTimer: ReturnType<typeof setInterval> | null = null;
  if (ptScanMinutes > 0) {
    const ptScanMs = ptScanMinutes * 60 * 1000;
    console.log(`[ProblemTicketScanner] Scheduled every ${ptScanMinutes} minutes`);
    ptScanTimer = setInterval(async () => {
      try {
        problemTicketScanner.setJiraClient(buildOnboardingJiraClient());
        await problemTicketScanner.scan();
      } catch (err) {
        console.error('[ProblemTicketScanner] Scheduled scan failed:', err instanceof Error ? err.message : err);
      }
    }, ptScanMs);
    setTimeout(async () => {
      try {
        problemTicketScanner.setJiraClient(buildOnboardingJiraClient());
        await problemTicketScanner.scan();
      } catch (err) {
        console.error('[ProblemTicketScanner] Initial scan failed:', err instanceof Error ? err.message : err);
      }
    }, 90_000);
  } else {
    console.log('[ProblemTicketScanner] Disabled (problem_scanner_interval_minutes = 0)');
  }

  // Adobe Sign agreement sync — every 5 minutes
  setInterval(async () => {
    if (!adobeSignClient || adobeSignClient.getStatus().status !== 'connected') return;
    try {
      const remoteAgreements = await adobeSignClient.listAgreements();
      for (const a of remoteAgreements) {
        const signerEmails = a.participantSetsInfo
          ?.filter(ps => ps.role === 'SIGNER')
          .flatMap(ps => ps.memberInfos.map(m => m.email)) ?? [];
        adobeSignAgreementQueries.upsert({
          agreement_id: a.id,
          contract_id: null,
          template_id: null,
          name: a.name,
          status: a.status,
          sender_email: a.senderEmail ?? null,
          signer_emails: JSON.stringify(signerEmails),
          filled_fields: null,
          created_via_nova: 0,
          adobe_created_date: a.createdDate ?? null,
          adobe_expiration_date: a.expirationDate ?? null,
          signed_document_url: null,
          raw_data: JSON.stringify(a),
          synced_at: new Date().toISOString(),
        });
      }
      console.log(`[Adobe Sign] Synced ${remoteAgreements.length} agreements`);
    } catch (err) {
      console.error('[Adobe Sign] Auto-sync failed:', err instanceof Error ? err.message : err);
    }
  }, 5 * 60 * 1000);

  // ── Dev Review outbox worker — drain failed Jira writes every 2 min ──
  // When an accept/return/comment fails to write through to Jira, the route
  // queues an entry in dev_review_outbox. This worker picks them up, retries,
  // marks done on success, increments attempts on failure, and gives up after 5.
  setInterval(async () => {
    try {
      const client = buildServiceDeskJiraClient();
      if (!client) return;
      const pending = await devReviewQueries.pendingOutbox(20);
      if (pending.length === 0) return;
      console.log(`[DevReviewOutbox] Draining ${pending.length} pending`);
      for (const entry of pending) {
        try {
          const payload = JSON.parse(entry.payload_json) as Record<string, unknown>;
          if (entry.op === 'accept') {
            const transitionId = String(payload.transitionId || '141');
            const text = String(payload.commentText || '');
            const tldr = String(payload.tldr || '');
            const developmentDetails = String(payload.developmentDetails || '');
            const adf = (t: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
            const fields: Record<string, unknown> = {};
            if (tldr) fields.customfield_13184 = adf(tldr);
            if (developmentDetails) fields.customfield_13215 = adf(developmentDetails);
            try {
              await client.transitionIssue(entry.jira_key, transitionId, {
                fields: Object.keys(fields).length > 0 ? fields : undefined,
                comment: { body: adf(text) },
              });
            } catch (fieldErr: unknown) {
              const msg = fieldErr instanceof Error ? fieldErr.message : String(fieldErr);
              if (msg.includes('cannot be set') || msg.includes('not on the appropriate screen')) {
                console.warn(`[DevReviewOutbox] ${entry.jira_key}: transition fields rejected, retrying without custom fields`);
                await client.transitionIssue(entry.jira_key, transitionId, {
                  comment: { body: adf(text) },
                });
              } else {
                throw fieldErr;
              }
            }
            await devReviewQueries.markAccepted(entry.jira_key);
          } else if (entry.op === 'return') {
            const transitionId = String(payload.returnTransitionId || '');
            const text = String(payload.commentText || '');
            if (transitionId) {
              await client.transitionIssue(entry.jira_key, transitionId, {
                comment: { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } },
              });
            } else {
              await client.updateFields(entry.jira_key, { customfield_12981: { id: '13062' } });
              await client.addComment(entry.jira_key, text);
            }
            await devReviewQueries.markReturned(entry.jira_key);
          } else if (entry.op === 'comment') {
            const text = String(payload.commentText || payload.body || '');
            await client.addComment(entry.jira_key, text);
          }
          await devReviewQueries.markOutboxDone(entry.id);
        } catch (e) {
          await devReviewQueries.bumpOutboxFailure(entry.id, e instanceof Error ? e.message : 'unknown');
        }
      }
    } catch (err) {
      console.error('[DevReviewOutbox] Worker failed:', err instanceof Error ? err.message : err);
    }
  }, 2 * 60 * 1000);

  // ── Dev Review T3 watcher — fire NOVA notifications on new arrivals ──
  // Polls NT every 5 min for tickets at Tier 3 we haven't seen before, and
  // notifies any user with the 'developer' role. Also archives tickets that
  // have left T3 since last poll.
  let devReviewLastSeen = new Set<string>();
  const devReviewTeamsQueue: Array<{ key: string; summary: string }> = [];
  const devReviewTeamsSentKeys = new Map<string, number>(); // key → timestamp (24h dedup)

  const isDevReviewWorkingHours = (): boolean => {
    const now = new Date();
    const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
    const ukDay = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'narrow' }).length > 0
      ? String(new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' })).getDay())
      : '0');
    return ukDay >= 1 && ukDay <= 5 && ukHour >= 8 && ukHour < 18;
  };

  const sendDevReviewTeamsNotification = async (items: Array<{ key: string; summary: string }>): Promise<void> => {
    const webhookUrl = settingsQueries.getAll().teams_webhook_url;
    if (!webhookUrl || items.length === 0) return;

    // 24h dedup
    const now = Date.now();
    const fresh = items.filter(i => {
      const lastSent = devReviewTeamsSentKeys.get(i.key);
      return !lastSent || (now - lastSent) > 24 * 60 * 60 * 1000;
    });
    if (fresh.length === 0) return;

    const lines = fresh.map(i => `- **${i.key}** — ${i.summary}`).join('\n');
    const payload = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      themeColor: 'FFA500',
      summary: `Dev Review: ${fresh.length} new T3 escalation(s)`,
      sections: [{
        activityTitle: `🔧 Dev Review — ${fresh.length} new escalation${fresh.length > 1 ? 's' : ''}`,
        text: lines,
      }],
    };
    try {
      const resp = await fetch(String(webhookUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        for (const i of fresh) devReviewTeamsSentKeys.set(i.key, now);
        console.log(`[DevReviewWatcher] Teams notification sent for ${fresh.length} ticket(s)`);
      } else {
        console.warn(`[DevReviewWatcher] Teams webhook failed: ${resp.status}`);
      }
    } catch (err) {
      console.warn('[DevReviewWatcher] Teams webhook error:', err instanceof Error ? err.message : err);
    }

    // Prune dedup map entries older than 24h
    for (const [k, ts] of devReviewTeamsSentKeys) {
      if (now - ts > 24 * 60 * 60 * 1000) devReviewTeamsSentKeys.delete(k);
    }
  };

  const devWatch = async () => {
    try {
      const client = buildServiceDeskJiraClient();
      if (!client) return;
      const result = await client.searchJqlAll(
        `project = NT AND cf[12981] = "Tier 3" AND statusCategory != Done`,
        ['summary', 'updated', 'reporter', 'assignee'],
        200,
      );
      const liveKeys = new Set<string>();
      const newKeys: Array<{ key: string; summary: string }> = [];
      for (const issue of result.issues) {
        liveKeys.add(issue.key);
        if (!devReviewLastSeen.has(issue.key)) {
          const existing = await devReviewQueries.getState(issue.key);
          if (!existing) {
            newKeys.push({ key: issue.key, summary: String((issue.fields as { summary?: string }).summary || '') });
          }
          await devReviewQueries.upsertFromPoll(issue.key, null);
        }
      }
      // Archive stale rows (left T3)
      for (const row of await devReviewQueries.listQueue()) {
        if (!liveKeys.has(row.jira_key)) await devReviewQueries.archive(row.jira_key);
      }
      devReviewLastSeen = liveKeys;

      // Backfill submitter + actual escalation time via Jira changelog for any
      // state row still missing the submitter. Looks for the most recent change
      // to customfield_12981 (CurrentTier) where the new value is "Tier 3"; that
      // change's author becomes the submitter and its timestamp becomes
      // first_seen_at — fixing the bootstrap problem where every long-standing
      // T3 ticket was inserted with first_seen_at = now.
      const missing = await devReviewQueries.getKeysMissingSubmitter(15);
      for (const key of missing) {
        try {
          const issue = await client.getIssue(key, ['summary'], { expand: ['changelog'] });
          const changelog = (issue as { changelog?: { histories?: Array<{ created?: string; author?: { emailAddress?: string; displayName?: string }; items?: Array<{ field?: string; fieldId?: string; from?: string; fromString?: string; to?: string; toString?: string }> }> } } | null)?.changelog;
          const histories = changelog?.histories || [];
          let submitter: string | null = null;
          let escalationIso: string | null = null;
          let assigneeClearedByT3: string | null = null;
          for (let i = histories.length - 1; i >= 0; i--) {
            const h = histories[i];
            const tierChange = h.items?.find((it) =>
              (it.fieldId === 'customfield_12981' || it.field === 'CurrentTier') &&
              (it.toString === 'Tier 3' || it.toString === '13063'),
            );
            if (tierChange) {
              submitter = h.author?.emailAddress || h.author?.displayName || null;
              escalationIso = h.created || null;
              // Check if assignee was cleared in the same changelog entry
              // (Jira workflow post-function strips assignee on T3 transition)
              const assigneeCleared = h.items?.find((it) =>
                it.field === 'assignee' && it.from && !it.to,
              );
              if (assigneeCleared?.from) {
                assigneeClearedByT3 = assigneeCleared.from;
              }
              break;
            }
          }
          if (submitter || escalationIso) {
            const escalationDate = escalationIso ? new Date(escalationIso) : null;
            const safeIso = escalationDate && !isNaN(escalationDate.getTime()) ? escalationDate.toISOString() : null;
            await devReviewQueries.setEscalationMetadata(key, submitter, safeIso);
          }
          // Restore assignee if the Jira T3 post-function stripped it
          if (assigneeClearedByT3) {
            try {
              const current = await client.getIssue(key, ['assignee']);
              const currentAssignee = (current?.fields as { assignee?: { accountId?: string } | null } | undefined)?.assignee;
              if (!currentAssignee?.accountId) {
                await client.updateFields(key, { assignee: { accountId: assigneeClearedByT3 } });
                console.log(`[DevReviewWatcher] Restored assignee on ${key} (cleared by T3 post-function)`);
              }
            } catch (restoreErr) {
              console.warn(`[DevReviewWatcher] Failed to restore assignee on ${key}: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`);
            }
          }
        } catch (e) {
          console.warn(`[DevReviewWatcher] Failed to resolve metadata for ${key}: ${e instanceof Error ? e.message : e}`);
        }
      }

      // Notify all developers about new arrivals
      if (newKeys.length > 0) {
        const allUsers = await userQueries.getAll();
        const devs = allUsers.filter((u) => {
          const roles = (u.role || '').split(',').map((r) => r.trim());
          return roles.includes('developer') || roles.includes('admin');
        });
        for (const u of devs) {
          for (const nk of newKeys) {
            notificationQueries.create({
              user_id: u.id,
              type: 'dev_review_new',
              title: `New T3 escalation: ${nk.key}`,
              message: nk.summary.slice(0, 200),
              entity_type: 'jira_ticket',
              entity_id: nk.key,
            });
          }
        }
        console.log(`[DevReviewWatcher] ${newKeys.length} new T3 ticket(s), notified ${devs.length} dev(s)`);

        // Teams webhook: queue for working hours or send immediately
        if (isDevReviewWorkingHours()) {
          await sendDevReviewTeamsNotification(newKeys);
        } else {
          devReviewTeamsQueue.push(...newKeys);
          console.log(`[DevReviewWatcher] ${newKeys.length} ticket(s) queued for Teams (outside working hours, queue=${devReviewTeamsQueue.length})`);
        }
      }

      // Drain queued Teams notifications at the start of working hours
      if (devReviewTeamsQueue.length > 0 && isDevReviewWorkingHours()) {
        const batch = devReviewTeamsQueue.splice(0);
        await sendDevReviewTeamsNotification(batch);
      }
    } catch (err) {
      console.error('[DevReviewWatcher] Poll failed:', err instanceof Error ? err.message : err);
    }
  };
  setInterval(devWatch, 5 * 60 * 1000);
  setTimeout(devWatch, 75_000);

  // ── Dev Review comment watcher — pulls external (agent) Jira comments ──
  // Every 2 min, for each active dev_review_state row, fetches the last 20
  // Jira comments. Any comment whose ID isn't already in dev_review_thread
  // is an external agent reply — insert it into the thread and, if the
  // ticket is currently 'waiting_on_assignee', flip it back to 'in_review'.
  //
  // Simple text-walker for Atlassian Doc Format → plain text.
  const adfToPlain = (adf: unknown): string => {
    const walk = (n: unknown): string => {
      if (!n) return '';
      if (typeof n === 'string') return n;
      const node = n as { text?: string; type?: string; content?: unknown[] };
      if (node.text) return node.text;
      if (Array.isArray(node.content)) {
        const inner = node.content.map(walk).join('');
        return node.type === 'paragraph' || node.type === 'heading' ? inner + '\n' : inner;
      }
      return '';
    };
    return walk(adf).trim();
  };

  const commentWatch = async () => {
    try {
      const client = buildServiceDeskJiraClient();
      if (!client) return;
      const keys = await devReviewQueries.getActiveKeys();
      if (keys.length === 0) return;
      let newCount = 0;
      for (const key of keys) {
        try {
          const comments = await client.getComments(key, 20);
          for (const c of comments) {
            if (await devReviewQueries.hasJiraComment(key, c.id)) continue;
            const body = adfToPlain(c.body);
            const authorName = c.author?.displayName || 'Unknown';
            await devReviewQueries.addExternalJiraComment({
              jira_key: key,
              author_display: authorName,
              body,
              jira_comment_id: c.id,
              author_account_id: c.author?.accountId,
              internal: c.jsdPublic === false,
            });
            newCount++;
            // Flip waiting → in_review if this is the first external reply
            const state = await devReviewQueries.getState(key);
            if (state?.status === 'waiting_on_assignee') {
              await devReviewQueries.setStatus(key, 'in_review');
            }
          }
        } catch (err) {
          console.warn(`[DevReviewComments] Failed to fetch ${key}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if (newCount > 0) console.log(`[DevReviewComments] Imported ${newCount} new external comment(s)`);
    } catch (err) {
      console.error('[DevReviewComments] Watcher failed:', err instanceof Error ? err.message : err);
    }
  };
  setInterval(commentWatch, 2 * 60 * 1000);
  setTimeout(commentWatch, 120_000);

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


  // Survey scheduler: auto-activate, auto-close, send invites/reminders every 15 min
  const surveyTimer = setInterval(() => runSurveyScheduler(settingsQueries), 15 * 60 * 1000);

  // Expired portal token cleanup: every 6 hours
  const portalCleanupTimer = setInterval(async () => {
    try {
      const deleted = await portalQueries.deleteExpired();
      if (deleted > 0) console.log(`[SetupPortal] Cleaned up ${deleted} expired tokens`);
    } catch (err) {
      console.error('[SetupPortal] Cleanup failed:', err instanceof Error ? err.message : err);
    }
  }, 6 * 60 * 60 * 1000);

  // Auto-expire approval queue items and check Jira status every minute
  setInterval(async () => {
    try {
      const pending = await approvalQueries.getAll('pending');

      // 1. Expire items past their business-hours deadline
      const expired = pending.filter((item) => new Date(item.expires_at) <= new Date());
      for (const item of expired) {
        await approvalQueries.decide(item.id, 'timed_out', 'system');
        try {
          await fetch(`${item.resume_url}?action=timeout`, { method: 'GET' });
          console.log(`[Approvals] Auto-expired approval ${item.id} (${item.ticket_id}), triggered n8n resume`);
        } catch (err) {
          console.error(`[Approvals] Failed to hit resume URL for expired approval ${item.id}:`, err instanceof Error ? err.message : err);
        }
      }

      // 2. Check Jira status for remaining pending items — auto-cancel if resolved/closed
      const s = settingsQueries.getAll();
      if (s.jira_enabled === 'true' && s.jira_username && s.jira_token) {
        const stillPending = pending.filter((item) => new Date(item.expires_at) > new Date());
        const auth = 'Basic ' + Buffer.from(`${s.jira_username}:${s.jira_token}`).toString('base64');
        const cloudId = '9357a1ba-0ad9-4ff0-964d-fad84dd30f96';
        for (const item of stillPending) {
          try {
            const resp = await fetch(
              `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${item.ticket_id}?fields=status`,
              { headers: { Authorization: auth, Accept: 'application/json' } }
            );
            if (!resp.ok) continue;
            const data = await resp.json() as { fields?: { status?: { statusCategory?: { key?: string } } } };
            if (data.fields?.status?.statusCategory?.key === 'done') {
              await approvalQueries.decide(item.id, 'cancelled', 'system');
              try { await fetch(`${item.resume_url}?action=decline`, { method: 'GET' }); } catch { /* ignore */ }
              console.log(`[Approvals] Auto-cancelled approval ${item.id} (${item.ticket_id}) — already resolved in Jira`);
            }
          } catch { /* skip, try next */ }
        }
      }
    } catch (err) {
      console.error('[Approvals] Expiry check error:', err instanceof Error ? err.message : err);
    }
  }, 60_000); // Check every minute


  // Weekly training matrix reminder — check hourly, send on Mondays at 9am
  let lastTrainingReminderDate = '';
  const trainingReminderTimer = setInterval(async () => {
    try {
      const now = new Date();
      if (now.getDay() !== 1) return; // Monday only
      if (now.getHours() < 9) return; // After 9am
      const today = now.toISOString().split('T')[0];
      if (lastTrainingReminderDate === today) return; // Already sent today
      lastTrainingReminderDate = today;
      console.log('[TrainingReminder] Monday 9am — sending weekly reminders...');
      await sendTrainingReminders(trainingQueries, userQueries, settingsQueries);
    } catch (err) {
      console.error('[TrainingReminder] Error:', err instanceof Error ? err.message : err);
    }
  }, 60 * 60 * 1000); // Check hourly

  // Auto-prep scheduling: daily at 18:00, generate 1-2-1 prep for agents with meetings tomorrow
  const autoPrepTimer = setInterval(async () => {
    try {
      const now = new Date();
      if (now.getHours() !== 18 || now.getMinutes() >= 10) return;

      const tools = mcpManager.getServerTools('msgraph');
      const hasCalendarView = tools.includes('get-calendar-view') || tools.includes('list-calendar-events');
      if (!hasCalendarView) return;

      const tomorrow = new Date(now.getTime() + 86400000);
      const tomorrowStart = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());
      const tomorrowEnd = new Date(tomorrowStart.getTime() + 86400000);

      const toolName = tools.includes('get-calendar-view') ? 'get-calendar-view' : 'list-calendar-events';
      const result = await mcpManager.callTool('msgraph', toolName, {
        startDateTime: tomorrowStart.toISOString(),
        endDateTime: tomorrowEnd.toISOString(),
      });

      const text = (result as any)?.content?.[0]?.text;
      let events: any[] = [];
      if (text) {
        try { const parsed = JSON.parse(text); events = Array.isArray(parsed) ? parsed : (parsed?.value ?? []); } catch { /* */ }
      }

      const agents = await query<{ agent_name: string }>(`
        SELECT agent_name FROM agent_development_plans WHERE status IN ('active', 'deferred')
      `);

      const today = now.toISOString().slice(0, 10);
      const adminUser = await queryOne<{ id: number }>(`SELECT TOP 1 id FROM users WHERE role = 'admin'`);
      let generated = 0;

      for (const agent of agents) {
        const firstName = agent.agent_name.split(' ')[0].toLowerCase();
        const match = events.find((e: any) => {
          const subject = (e.subject ?? e.Subject ?? '').toLowerCase();
          return subject.includes(firstName) && (
            subject.includes('1-2-1') || subject.includes('121') ||
            subject.includes('one to one') || subject.includes('1:1') ||
            subject.includes('catch up') || subject.includes('catchup')
          );
        });
        if (!match) continue;

        const existing = await queryOne<{ id: number }>(`
          SELECT TOP 1 id FROM agent_121_snapshots
          WHERE agent_name = ? AND snapshot_date = ? AND prep_json IS NOT NULL
        `, [agent.agent_name, today]);
        if (existing) continue;

        try {
          await generatePrepForAgent(agent.agent_name, settingsQueries, notificationQueries, adminUser?.id);
          generated++;
          console.log(`[auto-prep] Generated prep for ${agent.agent_name}`);
        } catch (err) {
          console.warn(`[auto-prep] Failed for ${agent.agent_name}:`, err instanceof Error ? err.message : err);
        }
      }

      if (generated > 0) console.log(`[auto-prep] Generated ${generated} prep(s) for tomorrow's 1-2-1s`);
    } catch (err) {
      console.warn('[auto-prep] Error:', err instanceof Error ? err.message : err);
    }
  }, 10 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[N.O.V.A] Shutting down...');
    clearInterval(workflowTimer);
    if (ptScanTimer) clearInterval(ptScanTimer);
    clearInterval(portalCleanupTimer);
    clearInterval(surveyTimer);
    clearInterval(trainingReminderTimer);
    clearInterval(autoPrepTimer);
    if (aiScanTimer) clearInterval(aiScanTimer);
    for (const timer of syncTimers.values()) clearInterval(timer);
    agentLoop?.stop();
    watcher.stop();
    await mcpManager.disconnectAll();
    await shutdownDatabase();
    console.log('[N.O.V.A] Database pool closed');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[N.O.V.A] Fatal startup error:', err);
  process.exit(1);
});
