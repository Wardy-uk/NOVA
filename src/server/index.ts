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
import { ATLAS_HTML, MAP_HTML } from './atlas-map-html.js';
import { query, queryOne, execute } from './services/database.js';
import { TaskQueries, RitualQueries, DeliveryQueries, CrmQueries, TeamQueries, UserQueries, UserSettingsQueries, UserTeamQueries, FeedbackQueries, OnboardingConfigQueries, OnboardingRunQueries, OnboardingRecordQueries, MilestoneQueries, BcCustomerQueries, ContractsQueries, AdobeSignAgreementQueries, ContractTermsQueries, TrainingQueries, CounterQueries, AgreementFieldValueQueries, TemplateFieldOverrideQueries } from './db/queries.js';
import { FileSettingsQueries } from './db/settings-store.js';
import { McpClientManager } from './services/mcp-client.js';
import { TaskAggregator } from './services/aggregator.js';
import { createTaskRoutes } from './routes/tasks.js';
import { createHealthRoutes } from './routes/health.js';
import { createSettingsRoutes } from './routes/settings.js';
import { createIntegrationRoutes } from './routes/integrations.js';

import { createActionRoutes } from './routes/actions.js';
import { createJiraRoutes } from './routes/jira.js';
import { createCommentReviewRoutes } from './routes/comment-review.js';
import { createStandupRoutes } from './routes/standups.js';
import { createTeamStandupRoutes, createTeamStandupPublicRoutes } from './routes/team-standup.js';
import { createOne21PublicRoutes, createOne21Routes } from './routes/one21-public.js';
import { runDayBeforePrep as runOne21Prep, runWeeklyKpiEmail as runOne21WeeklyKpi, ukTomorrow as one21UkTomorrow, type One21Deps } from './services/one21-service.js';
import { TeamStandupQueries } from './db/team-standup-queries.js';
import { PlaudService } from './services/plaud-service.js';
import { sendMorningPrompts as runStandupPrompts, runAccountabilityReport as runStandupReport, ukToday as standupUkToday, ukDaysAgo as standupUkDaysAgo, type StandupDeps } from './services/standup-service.js';
import { getStandupRoster } from './services/standup-roster.js';
import { PlaudOAuthProvider } from './services/plaud-oauth-provider.js';
import { PLAUD_MCP_URL } from './routes/integrations.js';
import { createDeliveryRoutes } from './routes/delivery.js';
import { createCrmRoutes } from './routes/crm.js';
import { createAuthRoutes } from './routes/auth.js';

import { createNeuroBridgeRoutes } from './routes/neuro-bridge.js';
import { createNeuroBridgeKpiRoutes } from './routes/neuro-bridge-kpi.js';
import { createNeuroBridgeFlowRoutes } from './routes/neuro-bridge-flow.js';
import { ManualEscalationService } from './services/manual-escalation-service.js';
import { createAdminRoutes } from './routes/admin.js';
import { createKpiDataRoutes, createKpiWallboardRoutes } from './routes/kpi-data.js';
import { createPipelineUatRoutes } from './routes/pipeline-uat.js';
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
import { createGuildOnboardingRoutes } from './routes/guild-onboarding.js';
import { GuildDashboardService } from './services/guild-dashboard.js';
import { GuildDigestService } from './services/guild-digest.js';
import { createMilestoneRoutes, resyncAllMilestoneTasks } from './routes/milestones.js';
import { SalesQueries } from './db/sales-queries.js';
import { createSalesHotboxRoutes } from './routes/sales-hotbox.js';
import { JiraRestClient, type BcAccountResolver } from './services/jira-client.js';
import { buildBcClient } from './services/bc-client.js';
import { resolveBcAccountNumber } from './services/bc-account-resolver.js';
import { OnboardingOrchestrator } from './services/onboarding-orchestrator.js';
import { authMiddleware, createAreaAccessGuard, requireRole, requireRoleAndTeam } from './middleware/auth.js';
import type { CustomRole } from './middleware/auth.js';
import { isAdmin } from './utils/role-helpers.js';
import crypto from 'crypto';
import { generateMorningBriefing } from './services/ai-standup.js';
import { INTEGRATIONS, buildMcpConfig } from './services/integrations.js';

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
import { JiraUserClientFactory } from './services/jira-user-client.js';
import { NotificationQueries } from './db/notifications.js';
import { NotificationEngine } from './services/notification-engine.js';
import { createNotificationRoutes } from './routes/notifications.js';
import { ProblemTicketQueries, InstanceSetupQueries, BranchQueries, BrandSettingsQueries, LogoQueries, SetupExecutionQueries, SetupPortalQueries, PortalAccountQueries, BranchDistrictQueries, WelcomePackQueries, ApprovalQueries, BacklogQueries, AutoRuleOverrideQueries, AssignmentRetryQueries } from './db/queries.js';
import { createInstanceSetupRoutes } from './routes/instance-setup.js';
import { createBranchRoutes } from './routes/branches.js';
import { createBrandSettingsRoutes } from './routes/brand-settings.js';
import { createLogoRoutes } from './routes/logos.js';
import { ProblemTicketScanner } from './services/problem-ticket-scanner.js';
import { JobRegistry } from './services/job-registry.js';
import { EscalationPredictor } from './services/escalation-predictor.js';
import { IncidentDetector } from './services/incident-detector.js';
import { SlaManager } from './services/sla-manager.js';
import { createPredictionRoutes } from './routes/predictions.js';
import { createIncidentRoutes } from './routes/incidents.js';
import { createSlaManagementRoutes } from './routes/sla-management.js';
import { createAdminJobRoutes } from './routes/admin-jobs.js';
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
import { createPortalAuthRoutes } from './routes/portal-auth.js';
import { createPortalTicketRoutes } from './routes/portal-tickets.js';
import { createPortalChatRoutes, createWidgetChatRoutes } from './routes/portal-chat.js';
import { createPortalKbRoutes } from './routes/portal-kb.js';
import { createPortalAdminRoutes } from './routes/portal-admin.js';
import { createPortalEventsRoutes } from './routes/portal-events.js';
import { createPortalCsatRoutes } from './routes/portal-csat.js';
import { createCsatMetricsRoutes } from './routes/csat-metrics.js';
import { createPortalDashboardRoutes } from './routes/portal-dashboards.js';
import { createPortalEscalationRoutes } from './routes/portal-escalation.js';
import { createPortalOrgUserRoutes } from './routes/portal-org-users.js';
import { createErrorRoutes } from './routes/errors.js';
import { captureError } from './services/error-log.js';
import { OnboardingEscalationService } from './services/onboarding-escalation-service.js';
import { portalAuthMiddleware, portalViewAsReadOnly } from './middleware/portal-auth-middleware.js';
import { PortalJiraService } from './services/portal-jira.js';
import { PortalIntakeService } from './services/portal-intake.js';
import { GuildOnboardingService } from './services/guild-onboarding.js';
import { PortalChatService } from './services/portal-chat.js';
import { PortalKbService } from './services/portal-kb.js';
import { createContractsRoutes } from './routes/contracts.js';
import { createAdobeSignRoutes } from './routes/adobe-sign.js';
import { createContractTermsRoutes } from './routes/contract-terms.js';
import { createContractApprovalRoutes, createContractApprovalCallbackHandler } from './routes/contract-approvals.js';
import { AdobeSignClient, buildAdobeSignClient } from './services/adobe-sign-client.js';
import { BcSubscriptionImportClient, buildBcSubscriptionImportClient } from './services/bc-subscription-import-client.js';
import { BcSubscriptionImportService } from './services/bc-subscription-import-service.js';
import { createSurveyRoutes, createSurveyPublicRoutes, runSurveyScheduler } from './routes/surveys.js';
import { createAgentRoutes } from './routes/agent.js';
import { createMyTicketsRoutes } from './routes/my-tickets.js';
import { QueueRanker } from './services/queue-ranker.js';
import { DeferService } from './services/defer-service.js';
import { AgentLoop } from './services/agent-loop.js';
import { recordEvent } from './services/agent-events.js';
import { buildResolveFields } from './utils/jira-resolve-fields.js';
import { createWorkingDayClock } from '../shared/utils/workingDayClock.js';
import { JiraSyncService } from './services/jira-sync-service.js';
import { JiraCacheQueries } from './services/jira-cache-queries.js';
import { LlmService } from './services/llm-service.js';
import { AssignmentEngine } from './services/assignment-engine.js';
import { upsertIssueCard, getAtRiskCustomersFromIssues, canonicalCustomer, accountRiskSummary } from './services/issue-router-store.js';
import { AgentAvailabilityService } from './services/agent-availability.js';
import { syncPeopleHR } from './services/people-hr-sync.js';
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
import { KpiPipeline, computeRag, getKpiPool } from './services/kpi-pipeline.js';
import { runKpiMigrations } from './services/kpi-migrations.js';
import { QaPipeline } from './services/qa-pipeline.js';
import { GrPipeline } from './services/gr-pipeline.js';
import { CoachingEngine } from './services/coach.js';
import { QaDigest } from './services/qa-digest.js';
import { PipelineMonitor } from './services/pipeline-monitor.js';
import { DriftDetector } from './services/drift-detector.js';
import { ConfigService } from './services/config-service.js';
import { SuggestionEngine } from './services/suggestion-engine.js';

import { DailyBriefingService } from './services/daily-briefing.js';
import { EmailService } from './services/email.js';
import { KbHealthService } from './services/kb-health.js';
import { KbGapClosureService } from './services/kb-gap-closure.js';
import { TrainingSignalGenerator } from './services/training-signal-generator.js';
import { Briefing121Service } from './services/briefing-121.js';
import { OpsPackService } from './services/ops-pack.js';
import { SelfDirectedLearning } from './services/self-directed-learning.js';
import { CapacityPlanner } from './services/capacity-planner.js';
import { CrossFunctionalIntelligence } from './services/cross-functional-intelligence.js';
import { createKbHealthRoutes } from './routes/kb-health.js';
import { createTrainingSignalRoutes } from './routes/training-signals.js';
import { createBriefing121Routes } from './routes/briefing-121.js';
import { createOpsPackRoutes } from './routes/ops-pack.js';
import { createCapacityRoutes } from './routes/capacity.js';
import { createCrossFunctionalRoutes } from './routes/cross-functional.js';
import { createLearningRoutes } from './routes/learning.js';
import { ProductCancellationService } from './services/product-cancellation.js';
import { AbuseReportProcessor } from './services/abuse-report-processor.js';
import { CallReviewService } from './services/call-reviews.js';
import { createApprovalRoutes } from './routes/approvals.js';
import { createTrainingRoutes } from './routes/training.js';
import { sendTrainingReminders } from './services/training-reminder.js';
import { addBusinessHours, businessDaysBetween, toSqliteDatetime } from './utils/business-hours.js';
import { getResolutionSlaTarget } from './services/jira-sla.js';
/* CALYX SHELVED — imports commented out
import { getCalyxDb, initializeCalyxSchema, seedCalyxData } from './db/calyx-db.js';
import { CalyxQueries } from './db/calyx-queries.js';
import { createCalyxRoutes } from './routes/calyx.js';
import { createCalyxPhase4Routes } from './routes/calyx-phase4.js';
import { createCalyxPhase5Routes } from './routes/calyx-phase5.js';
import { createCalyxReportRoutes } from './routes/calyx-reports.js';
import { createCalyxPortalRoutes } from './routes/calyx-portal.js';
import { checkSloBreaches } from './services/calyx-slo-engine.js';
import { processEmailQueue } from './services/calyx-email.js';
import { syncCalyxKpisToNova } from './services/calyx-kpi-sync.js';
*/
import { createPeopleRoutes, generatePrepForAgent } from './routes/people.js';
import { createKpiOrgRoutes } from './routes/kpi-org.js';
import { captureSupportNt, recaptureSupportFlows, recaptureSupportLateData, runKpiOrgStartupTasks } from './services/kpi-org/index.js';
import { getSupportLiveSnapshot } from './services/kpi-org/live.js';
import { getTierSnapshot, type TierSnapshot, type Cohort, type TierStatKind } from './services/kpi-org/wallboard-tiers.js';
import { createKpiAgentRoutes } from './routes/kpi-agent.js';
import { createTpjMaintenanceRoutes } from './routes/tpj-maintenance.js';
import { createRiskRoutes } from './routes/risk.js';
import { captureAgentKpis, getAgentLiveSnapshot, syncAgentRosterStats, type AgentKpiRow } from './services/kpi-agent/index.js';
import { sendAllKpiEmails } from './services/kpi-email-digest.js';
import { runFailedJobsTicket, isTicketDay, dueMinuteOfDay } from './services/failed-jobs-ticket.js';
import cookieParser from 'cookie-parser';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT ?? '3001', 10);
const isProduction = process.env.NODE_ENV === 'production';

async function main() {
  // 1. Database
  console.log('[N.O.V.A] Initializing database...');
  await initializeDatabase();

  // Job registry — central visibility for all background timers
  const jobRegistry = new JobRegistry();

  // Forward declaration — populated later when Jira creds are available
  let agentLoop: AgentLoop | null = null;

  /* CALYX SHELVED — database init commented out
  const calyxDb = getCalyxDb();
  let calyxQueries: CalyxQueries | null = null;
  if (calyxDb) {
    console.log('[N.O.V.A] Initializing Calyx database...');
    initializeCalyxSchema(calyxDb);
    seedCalyxData(calyxDb);
    calyxQueries = new CalyxQueries(calyxDb);
  } else {
    console.log('[N.O.V.A] Calyx database not available (better-sqlite3 not installed) — Calyx features disabled');
  }
  */

  const taskQueries = new TaskQueries();
  const fileSettings = new FileSettingsQueries();
  const configService = new ConfigService(fileSettings);
  await configService.initialize().catch(err =>
    console.warn('[N.O.V.A] Config service init failed, using file fallback:', err instanceof Error ? err.message : err)
  );
  const settingsQueries = configService as FileSettingsQueries;

  /* CALYX SHELVED — background timers commented out
  if (calyxDb) {
    jobRegistry.register('calyx-slo-check', 'Calyx SLO breach check', async () => {
      checkSloBreaches(calyxDb, settingsQueries.getAll());
    }, 5 * 60 * 1000);
    jobRegistry.register('calyx-email-queue', 'Calyx email queue processor', async () => {
      processEmailQueue(calyxDb, settingsQueries.getAll());
    }, 60_000);
    jobRegistry.register('calyx-kpi-sync', 'Calyx KPI sync to NOVA', async () => {
      await syncCalyxKpisToNova(calyxDb, settingsQueries);
    }, 30 * 60 * 1000);
    setTimeout(() => syncCalyxKpisToNova(calyxDb, settingsQueries).catch(() => {}), 60_000);
  }
  */

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
        // Never overwrite role or team on an existing account — those are managed
        // in Admin → Users and this seed runs on every boot, so writing them here
        // silently reverted any role change at the next restart. Only backfill
        // identity fields that are actually missing.
        const patch: { display_name?: string; email?: string } = {};
        if (!existing.display_name && u.display_name) patch.display_name = u.display_name;
        if (!existing.email && u.email) patch.email = u.email;
        if (Object.keys(patch).length > 0) {
          await userQueries.update(existing.id, patch);
          seedUpdated++;
        }
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
  const teamStandupQueries = new TeamStandupQueries();
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
  const adobeSignAgreementQueries = new AdobeSignAgreementQueries();
  const agreementFieldValueQueries = new AgreementFieldValueQueries();
  const counterQueries = new CounterQueries();
  const templateFieldOverrideQueries = new TemplateFieldOverrideQueries();
  const contractTermsQueries = new ContractTermsQueries();
  const approvalQueries = new ApprovalQueries();
  const trainingQueries = new TrainingQueries();
  const devReviewQueries = new DevReviewQueries();
  const backlogQueries = new BacklogQueries();
  const autoRuleOverrideQueries = new AutoRuleOverrideQueries();

  // Purge transient MS365 data from previous session
  const purgedCount = await taskQueries.deleteTransientTasks();
  if (purgedCount > 0) console.log(`[Startup] Purged ${purgedCount} transient tasks from previous session`);

  // Expire stale NOVA AI decisions that have been pending > 24 hours
  try {
    const { rowsAffected } = await execute(
      `UPDATE agent_decisions SET approval_status = 'timed_out', resolved_at = created_at, resolved_by = 'system-cleanup'
       WHERE approval_required = 1 AND (approval_status IS NULL OR approval_status = 'pending')
       AND created_at < DATEADD(hour, -24, GETUTCDATE())`
    );
    if (rowsAffected > 0) console.log(`[Approvals] Startup cleanup: expired ${rowsAffected} stale NOVA decisions`);
  } catch (err) {
    console.error('[Approvals] Startup cleanup failed:', err instanceof Error ? err.message : err);
  }

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

  // Safety net: auto-heal integrations with credentials but explicitly disabled
  for (const integ of INTEGRATIONS) {
    if (settings[integ.enabledKey] === 'false') {
      const hasAllRequired = integ.fields.filter(f => f.required).every(f => !!settings[f.key]?.trim());
      if (hasAllRequired && integ.fields.some(f => f.required)) {
        console.warn(`[N.O.V.A] ⚠ AUTO-HEAL: ${integ.name} has all credentials but was disabled — re-enabling (${integ.enabledKey})`);
        settingsQueries.set(integ.enabledKey, 'true');
        settings[integ.enabledKey] = 'true';
      }
    }
  }

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

  // Plaud — hosted MCP over HTTP with OAuth. Registered directly (not via the stdio
  // INTEGRATIONS loop). redirect_uri uses the public NOVA URL.
  const plaudOAuth = new PlaudOAuthProvider(
    settingsQueries,
    () => settingsQueries.get('app_base_url') || process.env.NOVA_BASE_URL || 'https://nova.nurtur.tech',
  );
  if (settings['plaud_enabled'] === 'true') {
    mcpManager.registerServer('plaud', { url: PLAUD_MCP_URL, authProvider: plaudOAuth });
    console.log('[N.O.V.A] Plaud: Registered (hosted MCP)');
  }

  // Attempt connections (non-blocking)
  mcpManager.connectAll().catch((err) =>
    console.error('[Startup] MCP connection error:', err)
  );

  // 3. Aggregator
  // Resolves the real BC Account Number for tickets blocked by the NT "Quick
  // Resolve" validator. Injected into every JiraRestClient so all close paths
  // resolve a real account (or hold for a human) instead of writing 'N/A'.
  const bcAccountResolver: BcAccountResolver = async (ticket, opts) => {
    const bc = buildBcClient(settingsQueries.getAll());
    if (!bc) return undefined; // BC not configured → caller falls back to legacy sentinel
    return resolveBcAccountNumber(bc, ticket, { infraFallback: opts.infraFallback });
  };

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
      return new JiraRestClient({ cloudId: s.jira_ob_cloud_id, email: s.jira_ob_email, apiToken: s.jira_ob_token }, { bcResolver: bcAccountResolver });
    }
    // Fallback to direct URL if no Cloud ID configured
    if (s.jira_ob_url) {
      console.log(`[OnboardingClient] Using direct URL: ${s.jira_ob_url}`);
      return new JiraRestClient({ baseUrl: s.jira_ob_url, email: s.jira_ob_email, apiToken: s.jira_ob_token }, { bcResolver: bcAccountResolver });
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
      return new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token }, { bcResolver: bcAccountResolver });
    }
    // Fallback to onboarding creds for service desk
    return buildOnboardingJiraClient();
  }

  const aggregator = new TaskAggregator(mcpManager, taskQueries, settingsQueries, buildServiceDeskJiraClient);

  // Daily team standup — shared deps for routes + scheduled jobs.
  const standupDeps: StandupDeps = {
    standupQueries: teamStandupQueries,
    getJiraClient: buildServiceDeskJiraClient,
    getRoster: () => getStandupRoster(settingsQueries),
    plaudService: new PlaudService(mcpManager),
    emailService: new EmailService(() => settingsQueries.getAll()),
    auditQueries,
  };

  // 1-2-1 closed loop — shared deps for the day-before prep job + manual trigger.
  const one21Deps: One21Deps = {
    settingsQueries,
    notificationQueries,
    emailService: new EmailService(() => settingsQueries.getAll()),
    plaudService: new PlaudService(mcpManager),
  };

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
  const jiraUserClientFactory = new JiraUserClientFactory(userSettingsQueries, jiraOAuthService);

  // Shared custom role loader — used by area access guard and portal auth
  const getRoles = (): CustomRole[] => {
    const raw = settingsQueries.get('custom_roles');
    try {
      if (raw) return JSON.parse(raw) as CustomRole[];
    } catch { /* ignore */ }
    return [];
  };

  // Area access guard for custom role-based route protection
  const requireAreaAccess = createAreaAccessGuard(getRoles);

  // Public API routes (no auth required)
  app.post('/api/auth/login', loginLimiter);
  app.post('/api/auth/register', loginLimiter);
  app.use('/api/auth', createAuthRoutes(userQueries, jwtSecret, ssoService, settingsQueries, jiraOAuthService, userSettingsQueries, userTeamQueries, teamQueries));

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

  // Team standup — public agent submission endpoints (form has no NOVA login).
  // Mounted before auth; unmatched paths fall through to the authed manager router.
  app.use('/api/standup', createTeamStandupPublicRoutes(standupDeps));

  // 1-2-1 prep — public agent submission form (token-gated, no NOVA login).
  // Mounted before auth; unmatched paths fall through to the authed router below.
  app.use('/api/121', createOne21PublicRoutes(settingsQueries));

  // Plaud hosted-MCP OAuth callback — public (browser redirect carries no NOVA JWT).
  app.get('/api/public/plaud/oauth/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code) { res.status(400).send('Missing authorization code'); return; }
    const saved = plaudOAuth.savedState();
    if (saved && state && saved !== state) {
      res.status(400).send('State mismatch — please retry the Plaud connection from N.O.V.A.');
      return;
    }
    try {
      await mcpManager.finishAuth('plaud', code);
      plaudOAuth.clearAuthorizationUrl();
      await mcpManager.connectWithRetry('plaud');
      res.send('<html><body style="font-family:sans-serif;background:#1e2228;color:#e5e5e5;text-align:center;padding:60px"><h2 style="color:#5ec1ca">Plaud connected &#10003;</h2><p>You can close this tab and return to N.O.V.A.</p></body></html>');
    } catch (err) {
      res.status(500).send(`Plaud sign-in failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  });

  // AI Approval ingest from n8n (no auth required)
  app.post('/api/public/approvals/ingest', (req, res) => {
    const { ticket_id, ticket_summary, reporter_name, reporter_email, ai_response_adf, conversation_json, kb_sources, resume_url, priority, business_hours } = req.body;
    if (!ticket_id || !ticket_summary || !resume_url) {
      res.status(400).json({ ok: false, error: 'ticket_id, ticket_summary, and resume_url are required' });
      return;
    }
    const resolvedAdf = typeof ai_response_adf === 'string' ? ai_response_adf : JSON.stringify(ai_response_adf);
    if (typeof ai_response_adf !== 'string') {
      console.warn(`[approvals/ingest] ai_response_adf for ${ticket_id} is not a string — stored as JSON. This will be blocked from public posting.`);
    }
    const businessHours = business_hours || 2;
    const expiresAt = toSqliteDatetime(addBusinessHours(new Date(), businessHours));
    const id = approvalQueries.create({
      ticket_id, ticket_summary, reporter_name, reporter_email,
      ai_response_adf: resolvedAdf,
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

  // Issue Router (AgentBrain) — Liam's cross-customer issue cards. Machine-to-machine, no JWT;
  // authenticated by a shared secret in the x-issue-router-secret header. One issue per POST,
  // upsert on signature. See issue-router-dashboard-handover.md.
  app.post('/api/public/webhooks/issue-router', express.json({ limit: '2mb' }), async (req, res) => {
    const expected = settingsQueries.get('issue_router_secret') || process.env.ISSUE_ROUTER_SECRET;
    if (!expected) { res.status(503).json({ ok: false, error: 'issue_router_secret not configured' }); return; }
    const provided = (req.headers['x-issue-router-secret'] as string | undefined) ?? '';
    const ok = provided.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    if (!ok) { res.status(401).json({ ok: false, error: 'Invalid or missing x-issue-router-secret' }); return; }
    try {
      await upsertIssueCard(req.body);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Invalid payload' });
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
    adobeSignClient = buildAdobeSignClient(
      s,
      (newToken) => {
        settingsQueries.set('adobe_sign_refresh_token', newToken);
      },
      (newAccessToken, expiresAtMs) => {
        // Persist access token + expiry so NOVA restarts don't force a refresh.
        // Reduces refresh frequency from "every restart" to "every ~1 hour" (real token TTL).
        settingsQueries.set('adobe_sign_access_token', newAccessToken);
        settingsQueries.set('adobe_sign_access_token_expires', String(expiresAtMs));
      },
    );
    if (adobeSignClient) {
      console.log('[N.O.V.A] Adobe Sign: Service configured');
    }
  }
  buildAdobeSignService();

  // BC Subscription Import — custom BC API client for pushing signed contracts
  // into the importedCustomerSubscriptionContracts staging tables. Reuses the
  // main BC integration's Entra creds, but targets a different env + company.
  let bcSubscriptionImportClient: BcSubscriptionImportClient | null = null;
  function buildBcSubscriptionImportService() {
    const s = settingsQueries.getAll();
    bcSubscriptionImportClient = buildBcSubscriptionImportClient(s);
    if (bcSubscriptionImportClient) {
      console.log('[N.O.V.A] BC Subscription Import: Service configured');
    }
  }
  buildBcSubscriptionImportService();

  const bcSubscriptionImportService = new BcSubscriptionImportService(
    adobeSignAgreementQueries,
    bcCustomerQueries,
    // Build the client fresh from current settings on every call rather than
    // returning a cached instance. Pushes are infrequent (manual, and later
    // per-signed-agreement), so the per-call OAuth token fetch is negligible —
    // and it guarantees env/company/credential changes take effect immediately
    // without a restart or relying on the settings-change rebuild hook.
    () => buildBcSubscriptionImportClient(settingsQueries.getAll()),
  );

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
  // Resolved lazily below — the bridge mounts ahead of the JWT middleware, so it
  // is wired before the Jira client and escalation service exist.
  let bridgeJiraClient: JiraRestClient | null = null;
  let bridgeManualEscalation: ManualEscalationService | null = null;
  let bridgeEscalationLog: EscalationLogService | null = null;
  app.use('/api/neuro-bridge', createNeuroBridgeRoutes(
    mcpManager,
    () => agentLoop?.getRiskScorer() ?? null,
    {
      getJiraClient: () => bridgeJiraClient,
      getManualEscalation: () => bridgeManualEscalation,
      getEscalationLog: () => bridgeEscalationLog,
    },
  ));
  // KPI half of the same bridge — read-only, same shared-secret door, so it
  // must mount ahead of the JWT middleware alongside the router above.
  app.use('/api/neuro-bridge', createNeuroBridgeKpiRoutes(
    settingsQueries,
    () => bridgeEscalationLog,
  ));
  // Flow half — how tickets MOVE (handbacks, ping-pong, breach-by-queue,
  // unowned, stalled). Reads NOVA's own MSSQL directly rather than taking a
  // service dependency, so it has nothing to wire lazily; same shared-secret
  // door, so it mounts here with the other two.
  app.use('/api/neuro-bridge', createNeuroBridgeFlowRoutes());

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

  // Contract Approvals callback — public (Power Automate / Teams approval flow POSTs the
  // decision back here, no NOVA JWT). Auth is the unguessable approval token plus an
  // optional X-Nova-Secret shared-secret header. Must be before the JWT gate.
  app.post('/api/public/contract-approvals/callback', express.json(), createContractApprovalCallbackHandler({
    getClient: () => adobeSignClient,
    agreementQueries: adobeSignAgreementQueries,
    fieldValueQueries: agreementFieldValueQueries,
    counterQueries,
    settingsQueries,
  }));

  /* CALYX SHELVED — portal routes commented out
  // Calyx portal — public + portal-JWT auth (no NOVA auth)
  if (calyxDb) {
    app.use('/api/calyx/portal', createCalyxPortalRoutes(calyxDb, settingsQueries));
  }
  */

  // Protected API routes — role cache with 30s TTL avoids hitting DB on every single request
  const roleCache = new Map<number, { role: string; expires: number }>();
  const ROLE_CACHE_TTL = 30_000;
  const novaAuthHandler = authMiddleware(jwtSecret, async (id) => {
    const now = Date.now();
    const cached = roleCache.get(id);
    if (cached && cached.expires > now) return cached.role;
    const user = await userQueries.getById(id);
    if (user?.role) roleCache.set(id, { role: user.role, expires: now + ROLE_CACHE_TTL });
    return user?.role;
  });
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/portal') && !req.path.startsWith('/portal/admin')) {
      // Always public: auth endpoints + KB (read-only)
      if (req.path.startsWith('/portal/auth') || req.path.startsWith('/portal/kb') || req.path.startsWith('/portal/csat') || req.path.startsWith('/portal/widget')) return next();
      const authMode = settingsQueries.get('portal_auth_mode') || 'internal';
      if (authMode === 'internal') {
        // Internal mode: portal routes need NOVA JWT — let them through NOVA auth
        return novaAuthHandler(req, res, next);
      }
      // OIDC mode: portal routes use their own auth — skip NOVA JWT
      return next();
    }
    novaAuthHandler(req, res, next);
  });

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

  /* CALYX SHELVED — API routes commented out
  const getCalyxSettings = () => settingsQueries.getAll();
  if (calyxDb && calyxQueries) {
    app.use('/api/calyx', createCalyxRoutes(calyxQueries, calyxDb, getCalyxSettings));
    app.use('/api/calyx', createCalyxPhase4Routes(calyxDb, getCalyxSettings));
    app.use('/api/calyx', createCalyxPhase5Routes(calyxDb, settingsQueries));
    app.use('/api/calyx', createCalyxReportRoutes(calyxDb));
  }
  */
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
    // BC Subscription Import rebuilds when either its own settings change OR
    // when the shared BC credentials change (because the client reuses them).
    if (key.startsWith('bc_sub_') || key === 'bc_tenant_id' || key === 'bc_client_id' || key === 'bc_client_secret') {
      buildBcSubscriptionImportService();
    }
  }));
  app.use('/api/integrations', createIntegrationRoutes(mcpManager, settingsQueries, userSettingsQueries, uvxCommand, () => d365Service, (key) => {
    if (key.startsWith('d365_')) buildD365Service();
    if (key.startsWith('sp_')) buildMsGraphClient();
    if (key.startsWith('azdo_')) buildAzDoService();
    if (key.startsWith('bym_')) buildBymService();
    if (key.startsWith('adobe_sign_')) buildAdobeSignService();
    if (key.startsWith('bc_sub_') || key === 'bc_tenant_id' || key === 'bc_client_id' || key === 'bc_client_secret') {
      buildBcSubscriptionImportService();
    }
  }, buildOnboardingJiraClient, () => bymClient, plaudOAuth));

  app.use('/api/actions', createActionRoutes(taskQueries, settingsQueries, userSettingsQueries));
  app.use('/api/jira', createJiraRoutes(taskQueries, buildOnboardingJiraClient, () => settingsQueries.getAll(), userSettingsQueries, jiraUserClientFactory));
  app.use('/api/standups', requireAreaAccess('nova_features', 'view'), createStandupRoutes(taskQueries, settingsQueries, ritualQueries, userSettingsQueries));
  // Team standup — authenticated manager routes, gated by the 'standup' permission
  // area (admins always pass; others need a role granting it).
  app.use('/api/standup', requireAreaAccess('standup', 'view'), createTeamStandupRoutes(standupDeps));
  app.use('/api/121', requireAreaAccess('nova_features', 'view'), createOne21Routes(one21Deps));

  // ── Daily team standup jobs (poll every 5 min; gated to UK weekday mornings) ──
  jobRegistry.register('standup-morning-prompts', 'Standup morning prompts (Mon–Fri 09:00)', async () => {
    const now = new Date();
    const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
    const ukMin = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }), 10);
    const ukWeekday = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
    if (['Sat', 'Sun'].includes(ukWeekday)) return;
    if (ukHour === 9 && ukMin < 5) {
      const r = await runStandupPrompts(standupUkToday(), standupDeps);
      console.log(`[standup] morning prompts: sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}, no-email ${r.noEmail.length}`);
    }
  }, 5 * 60 * 1000);

  jobRegistry.register('standup-accountability', 'Standup accountability report (Mon–Fri 09:15)', async () => {
    const now = new Date();
    const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
    const ukMin = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }), 10);
    const ukWeekday = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
    if (['Sat', 'Sun'].includes(ukWeekday)) return;
    if (ukHour === 9 && ukMin >= 15 && ukMin < 20) {
      const r = await runStandupReport(standupUkDaysAgo(1), standupDeps);
      console.log(`[standup] accountability report for ${standupUkDaysAgo(1)}: ${r.ok ? 'sent' : 'no session'}`);
    }
  }, 5 * 60 * 1000);

  jobRegistry.register('one21-day-before-prep', '1-2-1 day-before prep + emails (daily 07:00)', async () => {
    const now = new Date();
    const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
    const ukMin = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }), 10);
    if (ukHour === 7 && ukMin < 5) {
      const r = await runOne21Prep(one21Deps, one21UkTomorrow());
      if (r.processed > 0) {
        console.log(`[121] day-before prep for ${r.date}: processed ${r.processed}, agent emails ${r.agentEmails}, manager emails ${r.managerEmails}, no-email ${r.noEmail.length}, prep-failed ${r.prepFailed.length}`);
      }
    }
  }, 5 * 60 * 1000);

  jobRegistry.register('one21-weekly-kpi', '1-2-1 weekly KPI email to agents (Fri 16:00)', async () => {
    const now = new Date();
    const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
    const ukMin = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }), 10);
    const ukWeekday = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
    if (ukWeekday === 'Fri' && ukHour === 16 && ukMin < 5) {
      const r = await runOne21WeeklyKpi(one21Deps);
      console.log(`[121] weekly KPI email: sent ${r.sent}, skipped ${r.skipped}, no-email ${r.noEmail.length}, no-data ${r.noData.length}`);
    }
  }, 5 * 60 * 1000);
  const spSync = msGraphClient ? new SharePointSync(msGraphClient, deliveryQueries, () => settingsQueries.getAll()) : undefined;
  app.use('/api/delivery', createDeliveryRoutes(deliveryQueries, spSync, milestoneQueries, taskQueries, requireAreaAccess, auditQueries, onboardingRunQueries, settingsQueries));
  // Milestone routes — wired with workflow engine after buildOrchestrator is defined (see below)
  // app.use('/api/milestones', ...) is registered after buildOrchestrator
  app.use('/api/crm', createCrmRoutes(crmQueries, deliveryQueries, onboardingRunQueries, requireAreaAccess));
  app.use('/api/contracts', createContractsRoutes(bcCustomerQueries, contractsQueries, settingsQueries));
  app.use('/api/adobe-sign', createAdobeSignRoutes(() => adobeSignClient, adobeSignAgreementQueries, agreementFieldValueQueries, counterQueries, templateFieldOverrideQueries, bcSubscriptionImportService, settingsQueries));
  app.use('/api/contract-terms', createContractTermsRoutes(contractTermsQueries));
  app.use('/api/contract-approvals', createContractApprovalRoutes({
    getClient: () => adobeSignClient,
    agreementQueries: adobeSignAgreementQueries,
    fieldValueQueries: agreementFieldValueQueries,
    counterQueries,
    settingsQueries,
  }));
  app.use('/api/surveys', createSurveyRoutes(settingsQueries, userQueries, teamQueries));
  app.use('/api/approvals', createApprovalRoutes(approvalQueries, settingsQueries, buildOnboardingJiraClient() ?? undefined, async (action, ticketKey, approvalId, editedResponse, decidedBy) => {
    if (!agentLoop) throw new Error('Agent loop not available');
    await agentLoop.handleApprovalCallback(action, ticketKey, approvalId, editedResponse, decidedBy);
  }, async (approvalId, declineReason, requestedBy) => {
    if (!agentLoop) return { ok: false, error: 'Agent loop not available' };
    return agentLoop.reReviewTicket(approvalId, declineReason, requestedBy);
  }));
  app.use('/api/training', createTrainingRoutes(trainingQueries, userQueries, requireAreaAccess, settingsQueries));

  app.use('/api/admin', createAdminRoutes(userQueries, teamQueries, userSettingsQueries, settingsQueries, buildServiceDeskJiraClient, userTeamQueries));
  app.use('/api/admin/jobs', createAdminJobRoutes(jobRegistry));

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
  app.use('/api/pipeline', requireRole('admin'), createPipelineUatRoutes({ settings: settingsQueries }));
  app.use('/api/errors', requireRole('admin', 'super_admin'), createErrorRoutes());
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

  // AI scan jobs registered via jobRegistry below

  // Agent loop — feature-flagged, admin-only
  const agentJiraClient = buildOnboardingJiraClient();
  const llmService = new LlmService(settingsQueries);
  boardMiLlm = llmService;
  const llmDiag = llmService.getDiagnostics();
  console.log(`[N.O.V.A] LLM config: primary=${llmDiag.primaryProvider} (${llmDiag.primaryKeyPrefix}), failover=${llmDiag.failoverProvider} (${llmDiag.failoverKeyPrefix})`);
  if (!llmDiag.primaryAvailable) console.warn(`[N.O.V.A] WARNING: Primary LLM provider has no API key configured!`);

  // Escalation logging — mounted unconditionally so the escalation capture /
  // stats / list surface is reachable even when no onboarding Jira client is
  // configured (the agent block below is skipped when agentJiraClient is null).
  // EscalationLogService is standalone; the jiraClient dep is used only by the
  // /backfill route, which already returns 503 when it is null.
  const escalationLog = new EscalationLogService();
  bridgeEscalationLog = escalationLog;
  bridgeJiraClient = agentJiraClient;
  bridgeManualEscalation = agentJiraClient ? new ManualEscalationService(agentJiraClient, escalationLog) : null;
  app.use('/api/escalations', createEscalationRoutes({
    escalationLog,
    jiraClient: agentJiraClient,
    getSettings: () => settingsQueries.getAll() as unknown as Record<string, unknown>,
  }));

  // ── On-demand Golden-Rules comment review — used by comment composers to
  // check a draft public reply before it's posted. ──
  app.use('/api/comments', createCommentReviewRoutes({ llmService }));

  // ── Org KPIs (Layer 1 rebuild) — Support/NT scorecard from kpi_org_daily ──
  // New, fully isolated parallel system: reads/computes the agreed Support/NT
  // KPI definitions (agent_work/ba/org-kpis-spec.md). Jira-backed KPIs compute
  // via the REST client (validated JQL); manual KPIs are entered via the API.
  app.use('/api/kpi-org', requireAreaAccess(['kpis', 'qa'], 'view'),
    createKpiOrgRoutes({ getJiraClient: () => agentJiraClient, settings: settingsQueries }));

  // ── Agent KPIs (Layer 3 rebuild) — per-agent scorecard + SLA Breach Board ──
  app.use('/api/kpi-agent', requireAreaAccess(['kpis', 'qa'], 'view'),
    createKpiAgentRoutes({ getJiraClient: () => agentJiraClient, settings: settingsQueries }));

  // ── CSAT adoption + response instrumentation (agent-macro experiment) ──
  app.use('/api/csat-metrics', requireAreaAccess(['kpis', 'qa'], 'view'),
    createCsatMetricsRoutes({ getJiraClient: () => agentJiraClient }));

  // ── TPJ Maintenance (NTPJ) dashboard — Lucy's team, scoped to the NTPJ project ──
  // Access: super_admin, OR the KPI role AND membership of the TPJ team.
  app.use('/api/tpj-maintenance',
    requireRoleAndTeam('kpi', 'TPJ', (uid) => userTeamQueries.getTeamsForUser(uid, teamQueries).then(ts => ts.map(t => t.name))),
    createTpjMaintenanceRoutes({ getJiraClient: () => agentJiraClient, settings: settingsQueries }));

  // ── Risk Intelligence (account-level) — read API for the dashboard + ticket sidebar ──
  app.use('/api/risk', requireAreaAccess(['servicedesk', 'kpis'], 'view'),
    createRiskRoutes());

  // Risk Intelligence is now fed entirely by AgentBrain's issue-router webhook
  // (POST /api/public/webhooks/issue-router) — the home-grown resolver/AI-inference attribution
  // has been removed.

  if (agentJiraClient) {
    agentLoop = new AgentLoop(agentJiraClient, llmService, settingsQueries, approvalQueries, jiraCacheQueries);
    agentLoop.getAutoRulesEngine().setOverrideQueries(autoRuleOverrideQueries);

    const assignmentEngine = new AssignmentEngine(agentJiraClient, settingsQueries, 'NT');
    const retryQueries = new AssignmentRetryQueries();
    assignmentEngine.setApprovalQueries(approvalQueries);
    assignmentEngine.setRetryQueries(retryQueries);
    assignmentEngine.validateProjectConfig();
    assignmentEngine.seedPoolCapsFromKpi().catch(() => {});
    agentLoop.getAutoRulesEngine().setAssignmentEngine(assignmentEngine);
    agentLoop.setAssignmentEngine(assignmentEngine);
    // Event-driven round-robin on tier escalation (assignee cleared → straight to T2 pool)
    jiraSyncService?.setAssignmentEngine(assignmentEngine);

    const availabilityService = new AgentAvailabilityService(settingsQueries);

    // People HR → agent_availability sync (variable schedule matching workday pattern)
    const runPeopleHrSync = async () => {
      try {
        const agents = await availabilityService.getAgentsFromKpiPublic();
        await syncPeopleHR(settingsQueries, availabilityService, agents);
      } catch (err) {
        console.warn('[people-hr-sync] error:', err instanceof Error ? err.message : err);
      }
    };

    const getNextPeopleHrSyncTime = (now: Date): Date => {
      const h = now.getHours();
      const m = now.getMinutes();
      const mins = h * 60 + m;
      const at = (hour: number, minute: number, tomorrow = false): Date => {
        const d = new Date(now);
        if (tomorrow) d.setDate(d.getDate() + 1);
        d.setHours(hour, minute, 0, 0);
        return d;
      };
      if (mins < 450) return at(7, 30);                                      // 00:00–07:29 → 07:30
      if (mins < 540) {                                                       // 07:30–08:59 → every 30m
        const next30 = Math.ceil((mins + 1) / 30) * 30;
        return next30 < 540 ? at(Math.floor(next30 / 60), next30 % 60) : at(9, 0);
      }
      if (mins < 600) {                                                       // 09:00–09:59 → every 10m
        const next10 = Math.ceil((mins + 1) / 10) * 10;
        return next10 < 600 ? at(Math.floor(next10 / 60), next10 % 60) : at(10, 5);
      }
      if (mins < 1020) {                                                      // 10:00–16:59 → at :05 and :35
        if (m < 5) return at(h, 5);
        if (m < 35) return at(h, 35);
        return h < 16 ? at(h + 1, 5) : at(7, 30, true);
      }
      return at(7, 30, true);                                                 // 17:00–23:59 → tomorrow 07:30
    };

    const schedulePeopleHrSync = () => {
      const next = getNextPeopleHrSyncTime(new Date());
      const delayMs = Math.max(60_000, next.getTime() - Date.now());
      console.log(`[people-hr-sync] Next run: ${next.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} (in ${Math.round(delayMs / 60_000)}m)`);
      setTimeout(async () => {
        await runPeopleHrSync();
        schedulePeopleHrSync();
      }, delayMs);
    };

    jobRegistry.register('people-hr-sync', 'People HR leave sync', runPeopleHrSync, 0);
    setTimeout(async () => {
      await runPeopleHrSync();
      schedulePeopleHrSync();
    }, 30_000);

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
    jobRegistry.register('kb-sync-tfs', 'KB sync: TFS Docs', async () => {
      if (tfsProvider.isConfigured()) await kbSyncWorker.sync(tfsProvider);
    }, tfsSyncMin * 60_000);
    jobRegistry.register('kb-sync-confluence', 'KB sync: Confluence', async () => {
      if (confluenceProvider.isConfigured()) await kbSyncWorker.sync(confluenceProvider);
    }, confSyncMin * 60_000);
    const pipelineMonitor = new PipelineMonitor(settingsQueries);
    pipelineMonitor.ensureRunsTable().catch(e => console.warn('[pipeline-monitor] ensureRunsTable failed:', e.message));
    pipelineMonitor.ensureUatTables().catch(e => console.warn('[pipeline-monitor] UAT table setup failed:', e.message));

    const kpiProjects = settingsQueries.get('kpi_jira_projects') || 'NT';
    const kpiPipeline = new KpiPipeline(settingsQueries, llmService, agentJiraClient, kpiProjects, pipelineMonitor, jiraCacheQueries);
    const qaPipeline = new QaPipeline(settingsQueries, llmService, agentJiraClient, 'NT', pipelineMonitor);
    const grPipeline = new GrPipeline(settingsQueries, llmService, agentJiraClient, 'NT', pipelineMonitor);
    const grCoachingEngine = new CoachingEngine(llmService, agentJiraClient, 'NT', settingsQueries);
    grPipeline.setCoachingEngine(grCoachingEngine);
    const qaDigest = new QaDigest(settingsQueries, pipelineMonitor);
    const driftDetector = new DriftDetector(settingsQueries, agentLoop.getAlertService());

    app.post('/api/kpi/derived/run', requireRole('admin', 'super_admin'), async (_req, res) => {
      try {
        console.log('[kpi-pipeline] Manual derived KPI run triggered');
        const start = Date.now();
        await kpiPipeline.collectDerivedKpis();
        res.json({ ok: true, data: { message: 'Derived KPIs collected', duration_ms: Date.now() - start } });
      } catch (err) {
        console.error('[kpi-pipeline] Manual derived KPI run failed:', err instanceof Error ? err.message : err);
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    // Operational workflow services (WP-22)
    const productCancellation = new ProductCancellationService(settingsQueries, agentJiraClient);
    const abuseReportProcessor = new AbuseReportProcessor(settingsQueries, agentJiraClient);
    const callReviewService = new CallReviewService(settingsQueries, llmService);

    const suggestionEngine = new SuggestionEngine(agentLoop.getGuardrails(), agentLoop.getAutonomyEngine(), settingsQueries, llmService);

    // Daily briefing service
    const briefingEmailService = new EmailService(() => settingsQueries.getAll());
    const dailyBriefingService = new DailyBriefingService(llmService, jiraCacheQueries, settingsQueries, briefingEmailService);
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

    // Escalation policy engine (Gap 1)
    const { EscalationPolicy } = await import('./services/escalation-policy.js');
    agentLoop.getReasoner().setEscalationPolicy(new EscalationPolicy());

    // Triage tuning feedback (Gap 8)
    const { TriageTuningFeedback } = await import('./services/triage-tuning-feedback.js');
    const tuningFeedback = new TriageTuningFeedback();
    agentLoop.getReasoner().setTuningFeedback(tuningFeedback);

    // Human edit detection — every 30 minutes, initial run after 2 minutes
    jobRegistry.register('ai-improvement-edits', 'AI improvement: human edit detection', async () => {
      const signals = await aiImprovementService.detectHumanEdits();
      if (signals > 0) console.log(`[ai-improvement] edit scan: ${signals} signals`);
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
    jobRegistry.register('ai-improvement-comparison', 'AI improvement: comparison scan', async () => {
      const ukHour = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false });
      const hour = parseInt(ukHour, 10);
      if (comparisonHours.includes(hour) && hour !== lastComparisonHour) {
        lastComparisonHour = hour;
        const n = await aiImprovementService.runComparisonScan();
        if (n > 0) console.log(`[ai-improvement] comparison scan: ${n} compared`);
      }
    }, 60_000);
    // Initial comparison scan after 3 minutes
    setTimeout(() => { aiImprovementService.runComparisonScan().catch(() => {}); }, 180_000);

    // Gamification
    const gamificationService = new GamificationService();
    app.use('/api/gamification', createGamificationRoutes(gamificationService));

    // P5: Predictive Intelligence + Platform Hardening services
    const escalationPredictor = new EscalationPredictor(llmService, settingsQueries);
    const incidentDetector = new IncidentDetector(llmService, settingsQueries, agentJiraClient);
    const slaManager = new SlaManager(settingsQueries, agentJiraClient, assignmentEngine);

    app.use('/api/agent/predictions', createPredictionRoutes(escalationPredictor));
    app.use('/api/agent/incidents', createIncidentRoutes(incidentDetector));
    app.use('/api/agent/sla-management', createSlaManagementRoutes(slaManager));

    // Incident detection — piggyback on problem scanner interval (every 15 min)
    jobRegistry.register('incident-scan', 'Incident Detection Scan', async () => {
      try { await incidentDetector.scan(); } catch (e) {
        console.warn('[incident-detector] scan failed:', e instanceof Error ? e.message : e);
      }
    }, 15 * 60 * 1000);

    // SLA proactive management — check every 5 min during working hours
    jobRegistry.register('sla-proactive', 'Proactive SLA Management', async () => {
      try {
        if (!assignmentEngine.isWorkingTime()) return;
        const projects = assignmentEngine.getConfiguredProjects();
        const projectJql = projects.length === 1 ? `project = ${projects[0]}` : `project IN (${projects.join(', ')})`;
        const jql = `${projectJql} AND resolution = EMPTY ORDER BY created DESC`;
        const result = await agentJiraClient.searchJql(jql, undefined, 200);
        await slaManager.runProactiveCheck(result.issues);
      } catch (e) {
        console.warn('[sla-manager] proactive check failed:', e instanceof Error ? e.message : e);
      }
    }, 5 * 60 * 1000);

    // P5 Theme 2: Knowledge Autonomy
    const kbGapClosure = new KbGapClosureService();
    const kbHealth = new KbHealthService(llmService, settingsQueries, kbArticleService);
    app.use('/api/kb-health', createKbHealthRoutes(kbHealth, kbGapClosure));

    // P5 Theme 3: Operational Colleague
    const trainingSignals = new TrainingSignalGenerator(llmService, settingsQueries);
    const briefing121 = new Briefing121Service(llmService, settingsQueries);
    const opsPack = new OpsPackService(llmService, settingsQueries);
    const selfDirectedLearning = new SelfDirectedLearning(settingsQueries);
    agentLoop.getObserver().setLearning(selfDirectedLearning);
    const capacityPlanner = new CapacityPlanner(settingsQueries);
    const crossFunctional = new CrossFunctionalIntelligence(llmService, settingsQueries);

    app.use('/api/training-signals', createTrainingSignalRoutes(trainingSignals));
    app.use('/api/briefing/121', createBriefing121Routes(briefing121));
    app.use('/api/ops-pack', createOpsPackRoutes(opsPack));
    app.use('/api/learning', createLearningRoutes(selfDirectedLearning));
    app.use('/api/capacity', createCapacityRoutes(capacityPlanner));
    app.use('/api/cross-functional', createCrossFunctionalRoutes(crossFunctional));

    // P5 background jobs — registered with JobRegistry
    jobRegistry.register('kb-staleness-scan', 'KB Staleness & Drift Scan (every 6h)', async () => {
      const processed = await kbHealth.runStalenessCheck();
      if (processed > 0) console.log(`[kb-health] Auto-scan: ${processed} articles checked`);
    }, 6 * 60 * 60 * 1000);

    // Initial KB health scan after 60s
    setTimeout(async () => {
      try {
        const processed = await kbHealth.runStalenessCheck();
        console.log(`[kb-health] Initial scan: ${processed} articles checked`);
      } catch (err) {
        console.error('[kb-health] Initial scan failed:', err instanceof Error ? err.message : err);
      }
    }, 60_000);

    jobRegistry.register('training-signals-weekly', 'Weekly Training Signal Generation (Mon 07:00)', async () => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      if (now.getDay() === 1 && ukHour === 7) {
        const count = await trainingSignals.generateWeeklySignals();
        console.log(`[training-signals] Generated ${count} signals`);
      }
    }, 60 * 60 * 1000);

    jobRegistry.register('capacity-forecast-monday', 'Capacity Forecast (Mon 06:00)', async () => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      if (now.getDay() === 1 && ukHour === 6) {
        await capacityPlanner.generateForecast();
        console.log('[capacity] Forecast generated');
      }
    }, 60 * 60 * 1000);

    jobRegistry.register('cross-functional-monthly', 'Cross-Functional Intelligence (1st of month)', async () => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      if (now.getDate() === 1 && ukHour === 6) {
        await crossFunctional.generateMonthlyReport();
        console.log('[cross-functional] Monthly report generated');
      }
    }, 60 * 60 * 1000);

    // Gap 8: Triage tuning refresh (Mon 08:00)
    jobRegistry.register('triage-tuning-refresh', 'Triage Tuning Signal Refresh (Mon 08:00)', async () => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      if (now.getDay() === 1 && ukHour === 8) {
        const result = await tuningFeedback.refresh();
        console.log(`[triage-tuning] Refreshed: ${result.created} new signals`);
      }
    }, 60 * 60 * 1000);

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
      autoRuleOverrideQueries,
      jiraUserClientFactory,
    }));

    const bankHolidaysPath = path.join(__dirname, '../../config/bank-holidays.json');
    let bankHolidays: string[] = [];
    try {
      const bhData = JSON.parse(fs.readFileSync(bankHolidaysPath, 'utf-8'));
      bankHolidays = bhData.holidays ?? [];
    } catch { /* bank holidays file optional */ }

    const queueRanker = new QueueRanker(jiraCacheQueries, settingsQueries, bankHolidays);
    const deferService = new DeferService();
    app.use('/api/my-tickets', createMyTicketsRoutes({
      jiraClient: agentLoop.getJiraClient(),
      queueRanker,
      deferService,
      userQueries,
      bankHolidays,
    }));

    // Defer sweeper — check every 60s for overdue/elapsed defers
    jobRegistry.register('defer-sweeper', 'Defer sweeper', async () => {
      await deferService.sweepOverdueDefers();
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
        const novaAccountId = all.nova_ai_jira_account_id || '712020:67acd53f-75f0-4548-adfe-91bba72ad38f';
        const exists = await p.request()
          .input('key', sqlMod.default.NVarChar(200), 'nova-ai@system.local')
          .query(`SELECT AgentId, AccountId FROM dbo.Agent WHERE AgentKey = @key`);
        if (exists.recordset.length === 0) {
          await p.request()
            .input('name', sqlMod.default.NVarChar(100), 'NOVA')
            .input('surname', sqlMod.default.NVarChar(100), 'AI')
            .input('key', sqlMod.default.NVarChar(200), 'nova-ai@system.local')
            .input('accountId', sqlMod.default.NVarChar(200), novaAccountId)
            .input('tierCode', sqlMod.default.NVarChar(10), 'AI')
            .input('team', sqlMod.default.NVarChar(50), 'NOVA AI')
            .input('dept', sqlMod.default.NVarChar(10), 'NOVA_AI')
            .input('now', sqlMod.default.DateTime2, new Date())
            .query(`INSERT INTO dbo.Agent (AgentName, AgentSurname, AgentKey, AccountId, TierCode, Team,
                     MaxTickets, MaxTicketsCustomerCare, MaxTicketsT2T3,
                     IsAvailable, IsActive, Department, CreatedAt, UpdatedAt)
                    VALUES (@name, @surname, @key, @accountId, @tierCode, @team, 0, 0, 0, 0, 1, @dept, @now, @now)`);
          console.log('[kpi] NOVA AI synthetic agent created in dbo.Agent');
        } else if (!exists.recordset[0].AccountId) {
          await p.request()
            .input('accountId', sqlMod.default.NVarChar(200), novaAccountId)
            .input('key', sqlMod.default.NVarChar(200), 'nova-ai@system.local')
            .query(`UPDATE dbo.Agent SET AccountId = @accountId WHERE AgentKey = @key`);
          console.log('[kpi] NOVA AI agent AccountId updated');
        }
        await p.close();
      } catch (err) {
        console.warn('[kpi] Failed to seed NOVA AI agent:', err instanceof Error ? err.message : err);
      }
    })();

    // Auto-populate missing AccountIds from Jira (delayed startup, best-effort)
    if (agentJiraClient) {
      setTimeout(async () => {
        try {
          const all = settingsQueries.getAll();
          const { kpi_sql_server: srv, kpi_sql_database: db, kpi_sql_user: usr, kpi_sql_password: pwd } = all;
          if (!srv || !db || !usr || !pwd) return;
          const sqlMod = await import('mssql');
          const p = await new sqlMod.default.ConnectionPool({
            server: srv, database: db, user: usr, password: pwd,
            options: { encrypt: true, trustServerCertificate: true }, requestTimeout: 30000,
          }).connect();
          const missing = await p.request().query(
            `SELECT AgentId, AgentKey FROM dbo.Agent WHERE IsActive = 1 AND (AccountId IS NULL OR AccountId = '') AND AgentKey IS NOT NULL AND AgentKey <> ''`
          );
          let filled = 0;
          for (const row of missing.recordset) {
            try {
              const users = await agentJiraClient.searchUsers(row.AgentKey, 1);
              if (users.length > 0) {
                await p.request()
                  .input('id', sqlMod.default.Int, row.AgentId)
                  .input('accountId', sqlMod.default.NVarChar(200), users[0].accountId)
                  .query(`UPDATE dbo.Agent SET AccountId = @accountId WHERE AgentId = @id`);
                filled++;
              }
            } catch { /* best effort per agent */ }
          }
          if (filled > 0) console.log(`[kpi] Auto-populated AccountId for ${filled} agent(s)`);
          await p.close();
        } catch (err) {
          console.warn('[kpi] AccountId auto-populate failed:', err instanceof Error ? err.message : err);
        }
      }, 60_000);
    }

    // Ensure NOVA AI synthetic agent exists in KPI database
    kpiPipeline.ensureNovaAiAgent().catch(() => {});
    kpiPipeline.ensureDigestColumns().catch(() => {});
    kpiPipeline.ensureKpiTargetDirections().catch(() => {});

    // KPI pipeline timers (initial kicks staggered to avoid startup storm)
    jobRegistry.register('kpi-jira-snapshot', 'KPI Jira snapshot', async () => {
      await kpiPipeline.collectJiraSnapshot();
    }, 10 * 60 * 1000);
    jobRegistry.register('kpi-agent-snapshot', 'KPI agent daily snapshot (all 27 cols)', async () => {
      await kpiPipeline.snapshotAgentKpis();
    }, 30 * 60 * 1000);
    // B1: Rebuild engine owns dbo.Agent live stat maintenance (round-robin dependency),
    // replacing the legacy kpi-pipeline refreshAllAgentMetrics so n8n + kpi-pipeline can be retired.
    jobRegistry.register('kpi-agent-roster-sync', 'KPI agent roster stats → dbo.Agent', async () => {
      if (agentJiraClient) await syncAgentRosterStats(settingsQueries, agentJiraClient);
    }, 10 * 60 * 1000);
    setTimeout(() => kpiPipeline.collectJiraSnapshot().catch(() => {}), 90_000);
    setTimeout(() => { if (agentJiraClient) syncAgentRosterStats(settingsQueries, agentJiraClient).catch(() => {}); }, 100_000);
    setTimeout(() => {
      kpiPipeline.collectDerivedKpis().catch(err => console.error('[kpi-pipeline] Derived KPIs startup failed:', err instanceof Error ? err.message : err));
    }, 120_000);

    // Org KPI (Layer 1) capture — freeze Support/NT KPIs at end of day (18:00 UK).
    // Runs once per UK day on the FIRST tick at/after 18:00, guarded by a date in
    // settings — NOT a narrow 10-minute window. A missed/slow tick or an evening
    // restart still performs the freeze, instead of losing the whole day (the old
    // `ukMin < 10` window silently dropped the freeze, leaving the board frozen at
    // the morning startup-capture snapshot).
    jobRegistry.register('kpi-org-capture', 'Org KPI capture (Support/NT end-of-day freeze)', async () => {
      if (!agentJiraClient) return;
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
      const todayUk = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
      if (ukHour >= 18 && settingsQueries.get('kpi_org_freeze_day') !== todayUk) {
        await captureSupportNt(agentJiraClient);
        await captureAgentKpis(settingsQueries, agentJiraClient);
        settingsQueries.set('kpi_org_freeze_day', todayUk);
        // Yesterday is now fully complete — re-capture its flow KPIs (New Tickets /
        // Solved) so their columns reflect the whole day, not the 18:00-partial freeze.
        const y = new Date(); y.setUTCDate(y.getUTCDate() - 1);
        await recaptureSupportFlows(agentJiraClient, y.toLocaleDateString('en-CA', { timeZone: 'Europe/London' }));
        // Ratings keep arriving days after the solve, so re-run CSAT over the last week.
        await recaptureSupportLateData(agentJiraClient, todayUk, 7);
      }
    }, 10 * 60 * 1000);

    // Daily digest at 17:30, weekly digest Monday 09:00, derived KPIs 17:30
    jobRegistry.register('kpi-daily-rollup', 'KPI daily/weekly digest + derived', async () => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
      const ukMin = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }), 10);
      const ukDay = now.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
      const isWeekday = !['Sat', 'Sun'].includes(ukDay);

      if (isWeekday && ukHour === 17 && ukMin >= 30 && ukMin < 40) {
        await kpiPipeline.collectDerivedKpis();
        await kpiPipeline.generateDailyDigest();
      }
      // P2: NOVA-owned KPI emails (daily comparison + evidence + agent KPI) from the
      // Rebuild engines. No-op unless kpi_email_digests_enabled='true' — avoids
      // double-sending while n8n "Daily KPI Report v4" is still active.
      if (isWeekday && ukHour === 17 && ukMin >= 40 && ukMin < 50 && agentJiraClient) {
        await sendAllKpiEmails({ settings: settingsQueries, jira: agentJiraClient, llm: llmService, email: briefingEmailService });
      }
      if (ukDay === 'Mon' && ukHour === 9 && ukMin < 10) {
        await kpiPipeline.generateWeeklyDigest();
      }
    }, 10 * 60 * 1000);

    // Daily failed-jobs ticket — one T2 Support ticket each weekday, assigned to the
    // agent holding the failed-jobs rota (dbo.Agent.isCurrentFailedJob, set by the n8n
    // "Daily Agent Selection" flow at 08:00 and shown on the Grafana board). Fires on
    // the first tick at/after the configured time rather than in a narrow window, so a
    // late start still raises it; the unique date in failed_jobs_ticket_log stops
    // double-raising. Off until failed_jobs_ticket_enabled is set.
    jobRegistry.register('failed-jobs-ticket', 'Daily failed-jobs ticket (Mon–Fri)', async () => {
      if (settingsQueries.get('failed_jobs_ticket_enabled') !== 'true') return;
      if (!isTicketDay(settingsQueries)) return;
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
      const ukMin = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }), 10);
      if (ukHour * 60 + ukMin < dueMinuteOfDay(settingsQueries)) return;
      await runFailedJobsTicket(settingsQueries, agentJiraClient);
    }, 10 * 60 * 1000);

    // SharePoint delivery sheet — auto-pull daily at 02:00
    if (spSync) {
      jobRegistry.register('sp-delivery-pull', 'SharePoint delivery sheet pull', async () => {
        const now = new Date();
        if (now.getHours() === 2 && now.getMinutes() < 10 && !spSync.running) {
          console.log('[SP-Sync] Starting scheduled overnight pull');
          await spSync.pull();
        }
      }, 10 * 60 * 1000);
    }

    // QA pipeline — score resolved tickets every 2 hours
    jobRegistry.register('qa-scoring', 'QA pipeline: score resolved tickets', async () => {
      await qaPipeline.scoreRecentlyResolved(24);
    }, 2 * 60 * 60 * 1000);
    setTimeout(() => qaPipeline.scoreRecentlyResolved(24).catch(e => console.warn('[qa-pipeline] initial run failed:', e instanceof Error ? e.message : e)), 120_000);

    // GR comment scoring — every 60 min during business hours (Mon-Fri 08-18 UTC)
    jobRegistry.register('gr-scoring', 'Golden rules pipeline', async () => {
      const hour = new Date().getUTCHours();
      const day = new Date().getUTCDay();
      if (hour >= 8 && hour <= 18 && day >= 1 && day <= 5) {
        await grPipeline.scoreRecentComments();
      }
    }, 60 * 60 * 1000);
    setTimeout(() => grPipeline.scoreRecentComments().catch(e => console.warn('[gr-pipeline] initial run failed:', e instanceof Error ? e.message : e)), 30_000);

    // QA daily digest email — 17:00 UTC
    jobRegistry.register('qa-daily-digest', 'QA daily digest email', async () => {
      const now = new Date();
      if (now.getUTCHours() === 17 && now.getUTCMinutes() < 15) {
        await qaDigest.sendDailyDigest();
      }
    }, 15 * 60 * 1000);

    // QA weekly digest email — Monday 08:00 UTC
    jobRegistry.register('qa-weekly-digest', 'QA weekly digest email', async () => {
      const now = new Date();
      if (now.getUTCDay() === 1 && now.getUTCHours() === 8 && now.getUTCMinutes() < 15) {
        await qaDigest.sendWeeklyDigest();
      }
    }, 15 * 60 * 1000);

    // Pipeline health check — every 15 min
    jobRegistry.register('pipeline-monitor', 'Pipeline monitor: stale run check', async () => {
      await pipelineMonitor.checkStaleRuns();
    }, 15 * 60 * 1000);

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
    jobRegistry.register('drift-detection', 'Drift detection (Mon 06:00)', async () => {
      const now = new Date();
      const ukHour = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
      const ukMinute = parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: 'numeric' }));
      if (now.getDay() === 1 && ukHour === 6 && ukMinute < 10) {
        if (!driftFiredThisWindow) {
          driftFiredThisWindow = true;
          await driftDetector.snapshotDrift();
        }
      } else {
        driftFiredThisWindow = false;
      }
    }, 10 * 60 * 1000);

    // Daily briefing generation — check every 10 min, generate at configured time (default 07:00)
    jobRegistry.register('daily-briefing', 'Daily briefing generation', async () => {
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
    }, 10 * 60 * 1000);

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
    jobRegistry.register('product-cancellation', 'Product cancellation check', async () => {
      const hour = new Date().getHours();
      if (hour >= 8 && hour <= 18) {
        await productCancellation.checkForCancellations();
      }
    }, 4 * 60 * 60 * 1000);

    // Always auto-start the agent on boot unless explicitly disabled via agent_disabled setting.
    // Manual stop (POST /agent/stop) only applies to the current process — deploys always restart the agent.
    let agentDisabled = false;
    try {
      const row = await queryOne<{ config_value: string }>(`SELECT config_value FROM agent_config WHERE config_key = 'agent_disabled'`);
      if (row) agentDisabled = row.config_value === 'true';
    } catch {}
    if (!agentDisabled) agentDisabled = settingsQueries.get('agent_disabled') === 'true';
    const persistedMode = settingsQueries.get('agent_running_mode');
    if (!agentDisabled) {
      setTimeout(() => {
        agentLoop!.start(persistedMode || undefined);
        console.log(`[N.O.V.A] Agent auto-started on boot (delayed 60s for startup stagger)`);

        if (fullSyncPromise) {
          fullSyncPromise.then(async () => {
            try {
              const projects = (settingsQueries.get('agent_jira_project') || 'NT').split(',').map((p: string) => p.trim()).filter(Boolean);
              // Look back 72h (not 1h) so tickets that arrived during an outage spanning
              // a weekend are still caught on restart. This is the ONLY recovery net while
              // the unbounded backfill sweep (agent_backfill_enabled) is off, so the window
              // is deliberately generous. getRestartGapTickets only returns tickets with NO
              // agent state, so a wider window never re-processes anything already handled —
              // it just back-fills genuinely-missed tickets.
              const catchUpSince = new Date(Date.now() - 72 * 60 * 60 * 1000);
              const gapTickets = await jiraCacheQueries.getRestartGapTickets(projects, catchUpSince);
              if (gapTickets.length > 0) {
                console.log(`[Startup] Restart catch-up: ${gapTickets.length} ticket(s) created in last 72h with no agent state — queuing`);
                agentLoop!.getPerceiver().queueCatchUpIssues(gapTickets);
              }
            } catch (err) {
              console.warn('[Startup] Restart catch-up failed:', err instanceof Error ? err.message : err);
            }
          });
        }
      }, 60_000);
    } else {
      console.log('[N.O.V.A] Agent not started (agent_disabled=true — use POST /api/agent/start to re-enable)');
    }
    // SOP-003: Day 10 auto-close backstop — runs once per hour during working hours
    const backstopClock = createWorkingDayClock();
    jobRegistry.register('day10-auto-close', 'SOP-003 Day 10 auto-close backstop', async () => {
      if (!backstopClock.isWorkingTime(new Date())) return;
      if (!agentLoop) return;
      const cache = jiraCacheQueries;
      const waiting = await cache.getOpenIssues(['NT']);
      const waitingForCustomer = waiting.filter(t => {
        const status = (t.status_name ?? '').toLowerCase();
        return status.includes('waiting for customer') || status.includes('waiting on requestor');
      });

      const now = new Date();
      let closed = 0;
      for (const ticket of waitingForCustomer) {
        const comments = await cache.getComments(ticket.issue_key, 20);
        const lastAgentPublic = comments.find(c =>
          c.is_public && c.author_email === ticket.assignee_email,
        );
        if (!lastAgentPublic) continue;

        const hoursSince = backstopClock.workingHoursBetween(new Date(lastAgentPublic.jira_created), now);
        const daysSince = hoursSince / 8;
        if (daysSince < 10) continue;

        const jira = agentLoop.getJiraClient();
        const { fields, comment } = buildResolveFields({
          tldr: 'Auto-closed: no customer response after 10 working days (SOP-003 backstop)',
          resolution: 'Request Cancelled / Withdrawn',
          comment: 'This ticket has been automatically closed after 10 working days without a customer response. If you still need help, please reply to this email or raise a new ticket.',
        });

        try {
          await jira.transitionIssue(ticket.issue_key, '17', { fields, comment });
          await recordEvent('auto_close_backstop_fired', null, ticket.issue_key, {
            agent_who_owned_it: ticket.assignee_display ?? ticket.assignee_email ?? 'unknown',
            days_in_state: Math.round(daysSince),
          });
          closed++;
        } catch (err) {
          console.warn(`[backstop] Failed to auto-close ${ticket.issue_key}:`, err instanceof Error ? err.message : err);
        }
      }

      if (closed > 0) console.log(`[backstop] Auto-closed ${closed} ticket(s) at Day 10`);
    }, 60 * 60 * 1000);

    // Flagged ticket auto-dismiss sweep — every 30 minutes
    jobRegistry.register('flag-auto-dismiss', 'Flagged ticket auto-dismiss sweep', async () => {
      const { FlagAutoDismissService } = await import('./services/flag-auto-dismiss.js');
      const svc = new FlagAutoDismissService(settingsQueries);
      const result = await svc.sweep();
      if (result.total > 0) {
        console.log(`[flag-dismiss] Auto-dismissed ${result.total} flags: resolved=${result.resolved}, aged=${result.aged_out}, handled=${result.auto_handled}`);
      }
    }, 30 * 60 * 1000);

    // Ticket severity classification — LLM-assess business impact / blast radius
    // of open tickets so the risk scorer can rank a broken feed above a cosmetic
    // bug. Cached + hash-deduped, so most tickets are skipped each run. Every 30 min.
    jobRegistry.register('severity-classifier', 'Ticket severity classification (30 min)', async () => {
      const { SeverityClassifier } = await import('./services/severity-classifier.js');
      const svc = new SeverityClassifier(settingsQueries, llmService);
      const projects = (settingsQueries.get('agent_jira_project') || 'NT').split(',').map((p: string) => p.trim());
      const res = await svc.runSeveritySweep(projects);
      if (res.classified > 0) console.log(`[severity] Classified ${res.classified} ticket(s)`);
    }, 30 * 60 * 1000);

    // NUERO push — mirror flagged tickets into Nick's NUERO Focus every 10 min.
    // No-op unless neuro_push_url + neuro_api_token are configured in settings.
    jobRegistry.register('neuro-push', 'Push flagged tickets to NUERO Focus (10 min)', async () => {
      const rs = agentLoop?.getRiskScorer();
      if (!rs) return;
      const { pushFlaggedToNeuro } = await import('./services/neuro-push.js');
      const result = await pushFlaggedToNeuro(rs, settingsQueries);
      if (result && result.pushed > 0) console.log(`[neuro-push] Pushed ${result.pushed} flagged ticket(s) to NUERO`);
    }, 10 * 60 * 1000);

    // Due Date sweep DISABLED — NOVA no longer stamps SLA-breach dates onto CC/Tier 2
    // tickets. Onboarding still sets its own due dates (onboarding-orchestrator.ts).
    // The sweepDueDates() method is left in place but is no longer scheduled.

    // Assignment retry sweep — every 5 min during working hours, max 10 per sweep
    jobRegistry.register('assignment-retry-sweep', 'Assignment retry sweep (5 min, working hours)', async () => {
      if (!assignmentEngine.isWorkingTime()) return;

      const items = await retryQueries.getUnresolved(10);
      if (items.length === 0) return;

      let assigned = 0;
      let exhausted = 0;
      for (const item of items) {
        try {
          // Check if ticket is still unassigned and in an assignable status
          const cached = await query<{ assignee_account_id: string | null; status_name: string | null }>(
            `SELECT assignee_account_id, status_name FROM jira_issue_cache WHERE issue_key = ?`,
            [item.ticket_key],
          ).then(rows => rows[0] ?? null);

          if (!cached) {
            await retryQueries.markResolved(item.ticket_key, 'not_in_cache');
            continue;
          }

          // Already assigned by someone else
          const novaAccountId = settingsQueries.get('nova_ai_jira_account_id') ?? '';
          if (cached.assignee_account_id && cached.assignee_account_id !== novaAccountId) {
            await retryQueries.markResolved(item.ticket_key, 'manually_assigned');
            continue;
          }

          // Skip non-assignable statuses
          const status = (cached.status_name ?? '').toLowerCase();
          if (['resolved', 'closed', 'done', 'waiting on partner'].includes(status)) {
            await retryQueries.markResolved(item.ticket_key, `status_${status.replace(/\s+/g, '_')}`);
            continue;
          }

          const result = await assignmentEngine.assignWithFallback(
            item.ticket_key,
            item.pool as import('./services/assignment-engine.js').Pool,
            item.project_key,
          );

          if (result) {
            // Post the round-robin comment so retry-queue assignments are visible on the
            // ticket, matching the initial-triage and unassigned-sweep paths. Without this,
            // retry-placed tickets got an assignee with no NOVA comment (looked untouched).
            try { await assignmentEngine.postAssignmentComment(item.ticket_key, result); }
            catch (err) { console.warn(`[retry-sweep] Failed to post assignment comment for ${item.ticket_key}:`, err instanceof Error ? err.message : err); }
            console.log(`[retry-sweep] Assigned ${item.ticket_key} → ${result.agent.display_name} (attempt ${item.retry_count + 1})`);
            assigned++;
          } else {
            await retryQueries.incrementRetry(item.id, 'No agents available');
            if (item.retry_count + 1 >= item.max_retries) {
              await retryQueries.markExhausted(item.id);
              exhausted++;
              await agentLoop?.getAlertService().createAlert({
                alertType: 'error',
                severity: 'critical',
                title: `Assignment exhausted: ${item.ticket_key}`,
                detail: `${item.max_retries} retry attempts failed. Manual assignment required. Last error: ${item.last_error ?? 'No agents available'}`,
                ticketKey: item.ticket_key,
              });
            }
          }
        } catch (err) {
          console.warn(`[retry-sweep] Error processing ${item.ticket_key}:`, err instanceof Error ? err.message : err);
          await retryQueries.incrementRetry(item.id, err instanceof Error ? err.message : 'Unknown error').catch(() => {});
        }
      }

      if (assigned > 0 || exhausted > 0) {
        console.log(`[retry-sweep] Sweep complete: ${assigned} assigned, ${exhausted} exhausted out of ${items.length} items`);
      }
    }, 5 * 60 * 1000);

    // Cold-start scan: queue any unassigned Open tickets not already in retry queue
    setTimeout(async () => {
      if (!assignmentEngine.isWorkingTime()) return;
      try {
        const novaAccountId = settingsQueries.get('nova_ai_jira_account_id') ?? '';
        const projects = assignmentEngine.getConfiguredProjects();
        const placeholders = projects.map(() => '?').join(',');
        const unassigned = await query<{ issue_key: string; project_key: string; current_tier: string | null; labels: string | null }>(
          `SELECT issue_key, project_key, current_tier, labels FROM jira_issue_cache
           WHERE status_name IN ('Open', 'Waiting on Assignee')
             AND (assignee_account_id IS NULL OR assignee_account_id = ?)
             AND project_key IN (${placeholders})
             AND NOT EXISTS (SELECT 1 FROM assignment_retry_queue r WHERE r.ticket_key = jira_issue_cache.issue_key AND r.resolved = 0)
           ORDER BY jira_created ASC`,
          [novaAccountId, ...projects],
        );
        if (unassigned.length > 0) {
          let queued = 0;
          for (const t of unassigned) {
            const labels = (t.labels || '').toLowerCase();
            const tier = (t.current_tier || '').trim();
            const pool = labels.includes('int_setup')
              ? 't2' // integration-setup is T2 work, not TPJ maintenance
              : (['Tier 2', 'Tier2', 'T2', 'Tier 3', 'Tier3', 'T3', 'Production'].includes(tier) ? 't2' : 'cc');
            await retryQueries.insert(t.issue_key, pool, t.project_key, 'cold-start scan');
            queued++;
          }
          console.log(`[retry-sweep] Cold-start: queued ${queued} unassigned ticket(s) for retry`);
        }
      } catch (err) {
        console.warn('[retry-sweep] Cold-start scan failed:', err instanceof Error ? err.message : err);
      }
    }, 30_000);

    // Weekly impact snapshot — runs Monday 07:00 UK time
    let lastImpactSnapshotDay = -1;
    jobRegistry.register('weekly-impact-snapshot', 'Weekly impact snapshot (Mon 07:00)', async () => {
      const ukNow = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', hour12: false });
      const [day, hourStr] = ukNow.split(' ');
      const hour = parseInt(hourStr, 10);
      const dayNum = new Date().getDay();
      if (day === 'Mon' && hour === 7 && dayNum !== lastImpactSnapshotDay) {
        lastImpactSnapshotDay = dayNum;
        const { ImpactMeasurement } = await import('./services/impact-measurement.js');
        const svc = new ImpactMeasurement(settingsQueries);
        const metrics = await svc.computeMetrics(7);
        await svc.saveSnapshot(metrics);
        console.log(`[impact] Weekly snapshot saved: hours_saved=${metrics.queue_hours_saved}, resolution_rate=${(metrics.autonomous_resolution_rate * 100).toFixed(1)}%`);
      }
    }, 60_000);

  } else {
    console.log('[N.O.V.A] Agent loop not available — no Jira credentials configured.');
  }

  // DELETE /api/data/source/:source — purge local records for a given integration source
  app.delete('/api/data/source/:source', async (req, res) => {
    const source = req.params.source;
    const validSources = ['jira', 'milestone', 'dynamics365'];
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

  app.get('/api/debug/jira-locale', (req, res, next) => {
    if (!isAdmin(req.user?.role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    next();
  }, async (_req, res) => {
    const client = buildOnboardingJiraClient();
    if (!client) { res.json({ ok: false, error: 'Jira client not configured' }); return; }

    const results: Record<string, unknown> = {};
    const testKey = 'NT-17800';

    // 1. Issue fields — check localised field values
    try {
      const raw = await client.rawGet(`issue/${testKey}?fields=summary,status,priority,resolution,issuetype`);
      const f = (raw as any)?.fields ?? {};
      results.issue = {
        key: testKey,
        status_name: f.status?.name,
        status_category_key: f.status?.statusCategory?.key,
        status_category_name: f.status?.statusCategory?.name,
        priority_name: f.priority?.name,
        resolution_name: f.resolution?.name ?? null,
        issuetype_name: f.issuetype?.name,
        _raw_status: f.status,
        _raw_priority: f.priority,
        _raw_resolution: f.resolution,
        _raw_issuetype: f.issuetype,
      };
    } catch (err: any) {
      results.issue = { error: err.message, statusCode: err.statusCode, body: err.body };
    }

    // 2. Transitions — check localised transition names
    try {
      const raw = await client.rawGet(`issue/${testKey}/transitions`);
      const transitions = ((raw as any)?.transitions ?? []) as any[];
      results.transitions = transitions.map((t: any) => ({
        id: t.id,
        name: t.name,
        to_name: t.to?.name,
        to_status_category: t.to?.statusCategory?.name,
      }));
    } catch (err: any) {
      results.transitions = { error: err.message, statusCode: err.statusCode, body: err.body };
    }

    // 3. Project statuses — all status names for NT
    try {
      const raw = await client.rawGet('project/NT/statuses');
      const issueTypes = (Array.isArray(raw) ? raw : []) as any[];
      results.project_statuses = issueTypes.map((it: any) => ({
        issuetype: it.name,
        statuses: (it.statuses ?? []).map((s: any) => ({ id: s.id, name: s.name, category: s.statusCategory?.name })),
      }));
    } catch (err: any) {
      results.project_statuses = { error: err.message, statusCode: err.statusCode, body: err.body };
    }

    // 4. Force a 403 — attempt to create in NTPJ
    try {
      await client.createIssue({
        fields: {
          project: { key: 'NTPJ' },
          summary: '[LOCALE TEST — delete if created]',
          issuetype: { name: 'Support' },
        },
      });
      results.ntpj_403_test = { unexpected: 'Issue was created — expected 403' };
    } catch (err: any) {
      results.ntpj_403_test = {
        statusCode: err.statusCode,
        statusText: err.statusText,
        message: err.message,
        body: err.body,
      };
    }

    res.json({ ok: true, data: results });
  });

  app.get('/api/debug/jira-transitions/:ticketKey', (req, res, next) => {
    if (!isAdmin(req.user?.role ?? '')) { res.status(403).json({ ok: false, error: 'Admin only' }); return; }
    next();
  }, async (req, res) => {
    const client = buildOnboardingJiraClient();
    if (!client) { res.json({ ok: false, error: 'Jira client not configured' }); return; }
    const { ticketKey } = req.params;
    try {
      const raw = await client.getTransitionsWithFields(ticketKey);
      const transitions = ((raw as any)?.transitions ?? []) as any[];
      const summary = transitions.map((t: any) => {
        const fields = t.fields ?? {};
        const fieldSummary: Record<string, any> = {};
        for (const [fid, meta] of Object.entries(fields)) {
          const m = meta as any;
          fieldSummary[fid] = {
            name: m.name,
            required: m.required,
            schema: m.schema,
            allowedValues: m.allowedValues?.map((v: any) => ({ id: v.id, value: v.value, name: v.name })),
            hasDefaultValue: m.hasDefaultValue,
            defaultValue: m.defaultValue,
          };
        }
        return {
          id: t.id,
          name: t.name,
          to: { name: t.to?.name, id: t.to?.id, statusCategory: t.to?.statusCategory?.name },
          fields: fieldSummary,
          requiredFields: Object.entries(fieldSummary)
            .filter(([, v]: [string, any]) => v.required)
            .map(([k, v]: [string, any]) => `${k} (${v.name})`),
        };
      });
      res.json({ ok: true, issueKey: ticketKey, transitions: summary, _raw: raw });
    } catch (err: any) {
      res.json({ ok: false, error: err.message, statusCode: err.statusCode, body: err.body });
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

  // ── System Atlas + System Map — static showcase / orientation wallboards ──
  // Public, no-auth, server-rendered like the other /wallboard/* routes.
  // HTML lives in atlas-map-html.ts (plain template strings, ships in the build).

  /** System Atlas — fills the three header metrics with live agent-status values. */
  async function renderAtlasWallboard(): Promise<string> {
    // Defaults match the static source so the page still reads well if the agent is unavailable.
    let autonomy = 'full';
    let tickets = '317';
    let actions = '46';
    try {
      if (agentLoop) {
        const status = agentLoop.status;
        if (status.mode) autonomy = String(status.mode);
        if (typeof status.ticketsProcessed === 'number') tickets = String(status.ticketsProcessed);
        const stats = await agentLoop.getObserver().getStats();
        if (typeof stats.total === 'number') actions = String(stats.total);
      }
    } catch {
      // Fall back to the static defaults on any failure — never break the wallboard.
    }
    return ATLAS_HTML
      .replace('{{AUTONOMY}}', autonomy)
      .replace('{{TICKETS}}', tickets)
      .replace('{{ACTIONS}}', actions);
  }

  /** System Map — fully static. */
  function renderMapWallboard(): string {
    return MAP_HTML;
  }

  app.get('/wallboard/atlas', async (_req, res) => {
    const start = Date.now();
    try {
      res.type('html').send(await renderAtlasWallboard());
      logWallboard('/wallboard/atlas', 'info', 200, Date.now() - start, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWallboard('/wallboard/atlas', 'error', 500, Date.now() - start, msg);
      res.status(500).send('Atlas render failed');
    }
  });

  app.get('/wallboard/map', (_req, res) => {
    const start = Date.now();
    try {
      res.type('html').send(renderMapWallboard());
      logWallboard('/wallboard/map', 'info', 200, Date.now() - start, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logWallboard('/wallboard/map', 'error', 500, Date.now() - start, msg);
      res.status(500).send('Map render failed');
    }
  });

  // Wallboard — server-rendered page for TV displays (no auth, no JS required)
  app.get('/wallboard/breached', async (_req, res) => {
    const wbStart = Date.now();
    try {
      if (!agentJiraClient) {
        logWallboard('/wallboard/breached', 'error', 503, Date.now() - wbStart, 'Jira client not configured');
        res.status(503).send('Jira client not configured'); return;
      }
      // Per-agent stats from the rebuilt kpi-agent engine (roster from dbo.Agent,
      // tier-1 stocks from jira_issue_cache — same source as the agent drill-down,
      // so every row matches its drill). Mapped to the legacy row shape so the
      // table render below is untouched.
      const snap = await getAgentLiveSnapshot(settingsQueries, agentJiraClient);
      const nowLive = new Date();
      const data = snap.agents.map(a => ({
        AgentName: a.agentName, AgentSurname: '', TierCode: a.tierCode, Team: a.team, AccountId: a.accountId,
        OpenTickets_Total: a.open, OpenTickets_Over2Hours: a.overSla, OpenTickets_NoUpdateToday: a.noReply,
        OldestTicketDays: a.oldestDays, OldestTicketKey: a.oldestKey,
        SolvedTickets_Today: a.solvedToday, TicketsSnapshotAt: nowLive,
      }));
      data.sort((x, y) => (y.OpenTickets_Over2Hours || 0) - (x.OpenTickets_Over2Hours || 0) || (x.AgentName || '').localeCompare(y.AgentName || ''));

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
        return `<td class="c"><span style="display:inline-block;padding:.4vh .8vw;border-radius:7px;font-size:1.6vh;font-weight:700;min-width:3vw;text-align:center;background:${c.bg};color:${c.fg};border:1px solid ${c.bd}">${v}${suffix}</span></td>`;
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-GB');

      function kpiCard(label: string, value: string | number, color: string) {
        return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:1.2vh 1.5vw"><div style="font-size:1.3vh;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:.5vh">${label}</div><div style="font-size:3.2vh;font-weight:800;letter-spacing:-1px;color:${color}">${value}</div></div>`;
      }

      const ONE_HOUR_MS = 60 * 60 * 1000;
      const rows = data.map((a: any) => {
        const name = a.AgentSurname ? `${a.AgentName} ${a.AgentSurname}` : a.AgentName;
        const hasIssues = a.OpenTickets_Over2Hours > 0 || (a.OldestTicketDays || 0) > 7;
        const snapshotAge = a.TicketsSnapshotAt ? now.getTime() - new Date(a.TicketsSnapshotAt).getTime() : Infinity;
        const isStale = snapshotAge > ONE_HOUR_MS;
        const tc = TEAM_COLORS[a.TierCode || a.Team] || '#64748b';
        const escapedName = name.replace(/'/g, "\\'");
        const acct = (a.AccountId || '').replace(/'/g, "\\'");
        const staleIcon = isStale ? ' <span title="Data stale — pipeline not reaching this agent" style="color:#f59e0b;font-size:1.4vh">⚠</span>' : '';
        return `<tr style="cursor:pointer;${hasIssues ? 'background:rgba(239,68,68,.04)' : ''}" onclick="window.parent.postMessage({type:'wallboard-drill',agent:'${escapedName}',accountId:'${acct}',label:'${escapedName}'},'*')">
          <td><span style="font-weight:600;color:${hasIssues ? '#fca5a5' : '#e2e8f0'}">${name}${staleIcon}</span></td>
          <td><span style="display:inline-block;padding:.3vh .6vw;border-radius:4px;font-size:1.3vh;font-weight:700;text-transform:uppercase;letter-spacing:.5px;background:${tc}22;color:${tc};border:1px solid ${tc}33">${a.TierCode || a.Team || '—'}</span></td>
          <td class="c" style="color:#94a3b8;font-weight:600">${a.OpenTickets_Total ?? '—'}</td>
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
            const badge = `<span style="display:inline-block;padding:.4vh .8vw;border-radius:7px;font-size:1.6vh;font-weight:700;min-width:3vw;text-align:center;background:${c.bg};color:${c.fg};border:1px solid ${c.bd}">${days}d</span>`;
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
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow:hidden}.wrap{height:100vh;display:flex;flex-direction:column;padding:2vh 2.5vw}table{width:100%;border-collapse:collapse}th{padding:1.2vh 1vw;text-align:left;font-size:1.4vh;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#64748b;background:#1e2228;border-bottom:1px solid #2f353d}th.c{text-align:center}td{padding:1.1vh 1vw;border-bottom:1px solid #2f353d;font-size:1.8vh}td.c{text-align:center}tr[onclick]:hover{background:rgba(94,193,202,.08)!important}.tbl-wrap{flex:1;min-height:0;overflow:hidden;border:1px solid #2f353d;border-radius:14px;background:rgba(255,255,255,.03)}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5vh">
  <div><h1 style="font-size:2.8vh;font-weight:800;letter-spacing:-0.5px">SLA Breach Board</h1><div style="font-size:1.4vh;color:#64748b;margin-top:2px">Live ticket health per agent</div></div>
  <div style="font-size:1.4vh;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.2vh;margin-bottom:1.5vh">
  ${kpiCard('Tickets Over SLA', totalOver, totalOver === 0 ? '#10b981' : '#ef4444')}
  ${kpiCard('Agents Breached', `${agentsBreached} / ${data.length}`, agentsBreached === 0 ? '#10b981' : '#f59e0b')}
  ${kpiCard('Tickets Not Updated', totalStale, totalStale === 0 ? '#10b981' : '#f59e0b')}
  ${kpiCard('Worst Oldest (days)', worstOldest, worstOldest <= 3 ? '#10b981' : worstOldest <= 7 ? '#f59e0b' : '#ef4444')}
</div>
<div class="tbl-wrap">
<table><thead><tr><th>Agent</th><th>Team</th><th class="c">Open</th><th class="c">Over SLA</th><th class="c">Not Updated</th><th class="c">Oldest (days)</th><th class="c">Solved Today</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<div style="text-align:center;padding-top:1vh;font-size:1.2vh;color:#475569">nurtur.tech &middot; SLA Breach Board &middot; ${dateStr}</div>
</div></body></html>`);
      logWallboard('/wallboard/breached', 'info', 200, Date.now() - wbStart, `OK — ${data.length} agents`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/breached', 'error', 500, Date.now() - wbStart, msg, { sqlServer: settingsQueries.getAll().kpi_sql_server, error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Wallboard — server-rendered Breached KPIs page for TV displays
  app.get('/wallboard/team-kpis', async (_req, res) => {
    const wbStart = Date.now();
    const route = '/wallboard/team-kpis';
    if (!agentJiraClient) {
      logWallboard(route, 'error', 503, Date.now() - wbStart, 'Jira client not configured');
      res.status(503).send('Jira client not configured'); return;
    }
    try {
      // Rebuilt 22-KPI registry, live from Jira (60s-cached). Breach board shows
      // the amber/red items; each row drills the SAME registry JQL. No n8n snapshot.
      const snap = await getSupportLiveSnapshot(agentJiraClient);
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-GB');

      const fmtVal = (unit: string, v: number | null): string => {
        if (v == null) return '—';
        if (unit === 'percent') return `${v}%`;
        if (unit === 'days') return `${v}d`;
        if (unit === 'minutes') return `${v}m`;
        if (unit === 'currency') return `£${Math.round(v).toLocaleString('en-GB')}`;
        return String(v);
      };

      const items = snap.items;
      const totalKpis = items.length;
      const greenCount = items.filter(k => k.rag === 'green').length;
      const amberCount = items.filter(k => k.rag === 'amber').length;
      const redCount = items.filter(k => k.rag === 'red').length;
      const breachedKpis = items.filter(k => k.rag === 'amber' || k.rag === 'red');
      const greenPct = totalKpis > 0 ? Math.round((greenCount / totalKpis) * 100) : 0;
      const redPct = totalKpis > 0 ? Math.round((redCount / totalKpis) * 100) : 0;

      function kpiCard(label: string, value: string | number, color: string) {
        return `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:1.2vh 1.5vw"><div style="font-size:1.3vh;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:.5vh">${label}</div><div style="font-size:3.2vh;font-weight:800;letter-spacing:-1px;color:${color}">${value}</div></div>`;
      }

      const sorted = [...breachedKpis].sort((a, b) => {
        const rank = (r: string | null) => (r === 'red' ? 3 : r === 'amber' ? 2 : 0);
        if (rank(a.rag) !== rank(b.rag)) return rank(b.rag) - rank(a.rag);
        return a.label.localeCompare(b.label);
      });

      const rows = sorted.map(k => {
        const isRed = k.rag === 'red';
        const ragColors = isRed
          ? { bg: 'rgba(239,68,68,.15)', fg: '#ef4444', bd: 'rgba(239,68,68,.3)' }
          : { bg: 'rgba(245,158,11,.12)', fg: '#f59e0b', bd: 'rgba(245,158,11,.25)' };
        const rowBg = isRed ? 'background:rgba(239,68,68,.04)' : '';
        const target = k.target != null ? fmtVal(k.unit, k.target) : '—';
        const escapedKpi = k.label.replace(/'/g, "\\'");
        return `<tr style="cursor:pointer;${rowBg}" onclick="window.parent.postMessage({type:'wallboard-drill',kpi:'${escapedKpi}',label:'${escapedKpi}'},'*')">
          <td><span style="font-weight:600;color:${isRed ? '#fca5a5' : '#fde68a'}">${k.label}</span></td>
          <td class="c"><span style="display:inline-block;padding:.4vh .8vw;border-radius:7px;font-size:1.6vh;font-weight:700;min-width:3vw;text-align:center;background:${ragColors.bg};color:${ragColors.fg};border:1px solid ${ragColors.bd}">${fmtVal(k.unit, k.value)}</span></td>
          <td class="c" style="color:#94a3b8;font-weight:600">${target}</td>
          <td class="c"><span style="display:inline-block;padding:.3vh .6vw;border-radius:5px;font-size:1.3vh;font-weight:700;text-transform:uppercase;background:${ragColors.bg};color:${ragColors.fg};border:1px solid ${ragColors.bd}">${isRed ? 'RED' : 'AMBER'}</span></td>
        </tr>`;
      }).join('');

      const emptyRow = breachedKpis.length === 0
        ? '<tr><td colspan="4" style="text-align:center;padding:40px;color:#64748b">All KPIs are green — nothing breached!</td></tr>'
        : '';

      res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KPI Breach Board</title>
${wallboardRefreshScript(route)}
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow:hidden}.wrap{height:100vh;display:flex;flex-direction:column;padding:2vh 2.5vw}table{width:100%;border-collapse:collapse}th{padding:1.2vh 1vw;text-align:left;font-size:1.4vh;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#64748b;background:#1e2228;border-bottom:1px solid #2f353d}th.c{text-align:center}td{padding:1.1vh 1vw;border-bottom:1px solid #2f353d;font-size:1.8vh}td.c{text-align:center}tr[onclick]:hover{background:rgba(94,193,202,.08)!important}.tbl-wrap{flex:1;min-height:0;overflow:hidden;border:1px solid #2f353d;border-radius:14px;background:rgba(255,255,255,.03)}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5vh">
  <div><h1 style="font-size:2.8vh;font-weight:800;letter-spacing:-0.5px">KPI Breach Board</h1><div style="font-size:1.4vh;color:#64748b;margin-top:2px">Support / NT &middot; live from Jira</div></div>
  <div style="font-size:1.4vh;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1.2vh;margin-bottom:1.5vh">
  ${kpiCard('Total KPIs', totalKpis, '#e2e8f0')}
  ${kpiCard('KPIs Green', `${greenCount} (${greenPct}%)`, '#10b981')}
  ${kpiCard('KPIs Amber', String(amberCount), amberCount === 0 ? '#10b981' : '#f59e0b')}
  ${kpiCard('KPIs Red', String(redCount), redCount === 0 ? '#10b981' : '#ef4444')}
  ${kpiCard('Red %', redPct + '%', redPct === 0 ? '#10b981' : redPct <= 20 ? '#f59e0b' : '#ef4444')}
</div>
<div class="tbl-wrap">
<table><thead><tr><th>KPI Name</th><th class="c">Value</th><th class="c">Target</th><th class="c">Status</th></tr></thead>
<tbody>${emptyRow}${rows}</tbody></table></div>
<div style="text-align:center;padding-top:1vh;font-size:1.2vh;color:#475569">nurtur.tech &middot; KPI Breach Board &middot; ${dateStr}</div>
</div></body></html>`);
      logWallboard(route, 'info', 200, Date.now() - wbStart, `OK — ${totalKpis} KPIs, ${breachedKpis.length} breached`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard(route, 'error', 500, Date.now() - wbStart, msg, { error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Tier wallboard (Customer Care / Tech Support). Counts come from the rebuilt
  // kpi-org tier snapshot (live JQL); each tile's onclick drills the SAME JQL so
  // the listed tickets always match the number. Big-tile legacy look preserved.
  type TierPanel = { label: string; bucket: string; stat: TierStatKind };
  function renderTierWallboard(
    snap: TierSnapshot,
    title: string,
    subtitle: string,
    panels: TierPanel[],
    cols: number,
    route: string,
    cohort: Cohort,
  ): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB');
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const panelHtml = panels.map(p => {
      const count = snap.tiers[p.bucket]?.[p.stat] ?? 0;
      const breach = p.stat !== 'active';
      const color = breach ? (count > 0 ? '#ef4444' : '#10b981') : '#5ec1ca';
      const flashClass = breach && count > 0 ? ' flash-red' : '';
      const lbl = p.label.replace(/'/g, "\\'");
      return `<div class="${flashClass}" data-kpi="${p.bucket}:${p.stat}" onclick="window.parent.postMessage({type:'wallboard-drill',bucket:'${p.bucket}',stat:'${p.stat}',cohort:'${cohort}',label:'${lbl}'},'*')" style="cursor:pointer;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:20px 24px;display:flex;flex-direction:column;justify-content:center;align-items:center;transition:transform .1s">
        <div style="font-size:16px;color:#94a3b8;font-weight:600;text-align:center;margin-bottom:12px;letter-spacing:.3px">${p.label}</div>
        <div style="font-size:96px;font-weight:800;letter-spacing:-3px;line-height:1;color:${color}">${count}</div>
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
  <div style="font-size:10px;color:#64748b">Live &middot; Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:14px;flex:1">
${panelHtml}
</div>
<div style="text-align:center;margin-top:14px;font-size:10px;color:#475569">nurtur.tech &middot; ${title} &middot; ${dateStr}</div>
</div></body></html>`;
  }

  // Cohort wallboard (Key Accounts / Customer Success) — compact 6-wide legacy
  // look. Same rebuilt tier snapshot, scoped to the cohort; drill posts the
  // bucket/stat/cohort so the lists match.
  function renderCohortWallboard(title: string, subtitle: string, snap: TierSnapshot, route: string, cohort: Cohort): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB');
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const COHORT_PANELS: Array<{ label: string; bucket: string; stat: TierStatKind }> = [
      { label: 'CC Incidents', bucket: 'cc_incidents', stat: 'active' },
      { label: 'CC Service Requests', bucket: 'cc_service_requests', stat: 'active' },
      { label: 'Property Jungle', bucket: 'cc_tpj', stat: 'active' },
      { label: 'Production Active', bucket: 'production', stat: 'active' },
      { label: 'Tier 2 Active', bucket: 'tier2', stat: 'active' },
      { label: 'Development — Active', bucket: 'development', stat: 'active' },
      { label: 'CC Incidents — No Update', bucket: 'cc_incidents', stat: 'noReply' },
      { label: 'CC SRs — No Update', bucket: 'cc_service_requests', stat: 'noReply' },
      { label: 'Property Jungle — No Update', bucket: 'cc_tpj', stat: 'noReply' },
      { label: 'Production — No Reply', bucket: 'production', stat: 'noReply' },
      { label: 'Tier 2 — No Reply', bucket: 'tier2', stat: 'noReply' },
      { label: 'Development — No Reply', bucket: 'development', stat: 'noReply' },
      { label: 'CC Incidents — Over SLA', bucket: 'cc_incidents', stat: 'overSla' },
      { label: 'CC SRs — Over SLA', bucket: 'cc_service_requests', stat: 'overSla' },
      { label: 'Property Jungle — Over SLA', bucket: 'cc_tpj', stat: 'overSla' },
      { label: 'Production — Over SLA', bucket: 'production', stat: 'overSla' },
      { label: 'Tier 2 — Over SLA', bucket: 'tier2', stat: 'overSla' },
      { label: 'Development — Over SLA', bucket: 'development', stat: 'overSla' },
    ];

    const panelHtml = COHORT_PANELS.map(p => {
      const total = snap.tiers[p.bucket]?.[p.stat] ?? 0;
      const isBreach = p.stat !== 'active';
      const color = isBreach ? (total > 0 ? '#ef4444' : '#10b981') : (total > 0 ? '#e2e8f0' : '#10b981');
      const flashClass = isBreach && total > 0 ? ' flash-red' : '';
      const lbl = p.label.replace(/'/g, "\\'");
      return `<div class="${flashClass}" onclick="window.parent.postMessage({type:'wallboard-drill',bucket:'${p.bucket}',stat:'${p.stat}',cohort:'${cohort}',label:'${lbl}'},'*')" style="cursor:pointer;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;justify-content:center;align-items:center">
        <div style="font-size:10px;color:#94a3b8;font-weight:600;text-align:center;margin-bottom:6px;letter-spacing:.2px">${p.label}</div>
        <div style="font-size:48px;font-weight:800;letter-spacing:-2px;line-height:1;color:${color}">${total}</div>
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
  <div style="font-size:9px;color:#64748b">Live &middot; Updated ${timeStr}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;flex:1">
${panelHtml}
</div>
<div style="text-align:center;margin-top:8px;font-size:9px;color:#475569">nurtur.tech &middot; ${title} &middot; ${dateStr}</div>
</div></body></html>`;
  }


  // CC + TS tier-bucket panels, fed by the rebuilt kpi-org tier snapshot (live JQL).
  const CC_TIER_PANELS: TierPanel[] = [
    { label: 'CC Incidents', bucket: 'cc_incidents', stat: 'active' },
    { label: 'CC Service Requests', bucket: 'cc_service_requests', stat: 'active' },
    { label: 'Property Jungle', bucket: 'cc_tpj', stat: 'active' },
    { label: 'CC Incidents — No Update', bucket: 'cc_incidents', stat: 'noReply' },
    { label: 'CC Service Requests — No Update', bucket: 'cc_service_requests', stat: 'noReply' },
    { label: 'Property Jungle — No Update', bucket: 'cc_tpj', stat: 'noReply' },
    { label: 'CC Incidents — Over SLA', bucket: 'cc_incidents', stat: 'overSla' },
    { label: 'CC Service Requests — Over SLA', bucket: 'cc_service_requests', stat: 'overSla' },
    { label: 'Property Jungle — Over SLA', bucket: 'cc_tpj', stat: 'overSla' },
  ];
  const TS_TIER_PANELS: TierPanel[] = [
    { label: 'Production Active Tickets', bucket: 'production', stat: 'active' },
    { label: 'Tier 2 Active Tickets', bucket: 'tier2', stat: 'active' },
    { label: 'Development — Active Tickets', bucket: 'development', stat: 'active' },
    { label: 'Production — No Reply', bucket: 'production', stat: 'noReply' },
    { label: 'Tier 2 — No Reply', bucket: 'tier2', stat: 'noReply' },
    { label: 'Development — No Reply', bucket: 'development', stat: 'noReply' },
    { label: 'Production — Over SLA', bucket: 'production', stat: 'overSla' },
    { label: 'Tier 2 — Over SLA', bucket: 'tier2', stat: 'overSla' },
    { label: 'Development — Over SLA', bucket: 'development', stat: 'overSla' },
  ];

  async function serveTierWallboard(res: import('express').Response, route: string, title: string, subtitle: string, panels: TierPanel[], cols: number, cohort: Cohort): Promise<void> {
    const wbStart = Date.now();
    if (!agentJiraClient) {
      logWallboard(route, 'error', 503, Date.now() - wbStart, 'Jira client not configured');
      res.status(503).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Jira client not configured</body></html>`);
      return;
    }
    try {
      const snap = await getTierSnapshot(agentJiraClient, cohort);
      res.send(renderTierWallboard(snap, title, subtitle, panels, cols, route, cohort));
      logWallboard(route, 'info', 200, Date.now() - wbStart, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard(route, 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  }

  // Customer Care wallboard
  app.get('/wallboard/cc', (_req, res) =>
    serveTierWallboard(res, '/wallboard/cc', 'Customer Care', 'Live queue metrics', CC_TIER_PANELS, 3, 'all'));

  // Technical Support wallboard
  app.get('/wallboard/tech-support', (_req, res) =>
    serveTierWallboard(res, '/wallboard/tech-support', 'Technical Support', 'Live queue metrics', TS_TIER_PANELS, 3, 'all'));

  // Key Accounts wallboard — CC+TS panels scoped to Key_Account / Enterprise_Account label
  app.get('/wallboard/key-accounts', async (_req, res) => {
    const wbStart = Date.now();
    const route = '/wallboard/key-accounts';
    if (!agentJiraClient) { res.status(503).send('Jira client not configured'); return; }
    try {
      const snap = await getTierSnapshot(agentJiraClient, 'key_accounts');
      res.send(renderCohortWallboard('Key Accounts', 'CC + TS queue metrics — Key Account customers only', snap, route, 'key_accounts'));
      logWallboard(route, 'info', 200, Date.now() - wbStart, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard(route, 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // Customer Success wallboard — CC+TS panels scoped to non-KA customers
  app.get('/wallboard/customer-success', async (_req, res) => {
    const wbStart = Date.now();
    const route = '/wallboard/customer-success';
    if (!agentJiraClient) { res.status(503).send('Jira client not configured'); return; }
    try {
      const snap = await getTierSnapshot(agentJiraClient, 'customer_success');
      res.send(renderCohortWallboard('Customer Success', 'CC + TS queue metrics — Customer Success cohort (excludes Key Accounts)', snap, route, 'customer_success'));
      logWallboard(route, 'info', 200, Date.now() - wbStart, 'OK');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard(route, 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // ── Dev Review wallboard ──
  // Server-rendered TV display of the Dev Review queue dashboard stat cards.
  function devReviewFmtMinutes(m: number | null): string {
    if (m === null) return '—';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
    const d = Math.floor(h / 24);
    const remH = h % 24;
    return remH ? `${d}d ${remH}h` : `${d}d`;
  }
  function devReviewFmtHours(h: number | null): string {
    if (h === null) return '—';
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    const rem = h % 24;
    return rem ? `${d}d ${rem}h` : `${d}d`;
  }
  function devReviewAgeColor(hours: number | null): string {
    if (hours === null) return '#64748b';
    if (hours < 4) return '#10b981';
    if (hours < 24) return '#f59e0b';
    return '#ef4444';
  }

  app.get('/wallboard/dev-review', async (_req, res) => {
    const wbStart = Date.now();
    try {
      const d = await devReviewQueries.getDashboard();
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB');
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      const tile = (label: string, value: string | number, color: string, sub?: string) => `
        <div class="${color === '#ef4444' ? 'flash-red' : ''}" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:18px 22px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
          <div style="font-size:13px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">${label}</div>
          <div style="font-size:72px;font-weight:800;letter-spacing:-2px;line-height:1;color:${color}">${value}</div>
          ${sub ? `<div style="font-size:12px;color:#64748b;margin-top:8px">${sub}</div>` : ''}
        </div>`;

      const unpicked = d.unpickedKpi;

      // ── Targets / breach thresholds ──
      const ACCEPTANCE_TARGET_PCT = 75;   // below target → breach
      const TIME_TARGET_MIN = 8 * 60;     // 8 hours → breach when exceeded
      const acceptColor = (pct: number | null) =>
        pct === null ? '#94a3b8' : pct < ACCEPTANCE_TARGET_PCT ? '#ef4444' : '#10b981';
      const timeColor = (min: number | null) =>
        min === null ? '#94a3b8' : min > TIME_TARGET_MIN ? '#ef4444' : '#10b981';
      // This Week reuses the acceptance-rate criteria, computed from this week's decisions.
      const weekDecisions = d.week.accepted + d.week.returned;
      const weekAcceptPct = weekDecisions > 0 ? Math.round((d.week.accepted / weekDecisions) * 100) : null;
      // In Queue breaches when any unclaimed ticket has passed the 8h SLA (no first dev touch).
      const queueColor = unpicked.currentlyBreached > 0 ? '#ef4444' : '#9b6aed';

      const unpickedColor = unpicked.today === 0 ? '#10b981' : unpicked.today < 3 ? '#f59e0b' : '#ef4444';
      const breachedColor = unpicked.currentlyBreached === 0 ? '#10b981' : '#ef4444';

      const row1 = [
        tile('New Today', d.today.new, '#5ec1ca'),
        tile('Processed Today', d.today.processed, '#10b981', `${d.today.accepted} accepted · ${d.today.returned} returned`),
        tile('Unpicked Today', unpicked.today, unpickedColor, 'Passed 8 working hours with no dev action today'),
        tile('In Queue Now', d.queue.total, queueColor, `${d.queue.unclaimed} unclaimed · ${d.queue.fast_track} 🔥`),
        tile('Oldest Pending', devReviewFmtHours(d.averages.oldestPendingHours), devReviewAgeColor(d.averages.oldestPendingHours)),
      ].join('');
      const row2 = [
        tile('Acceptance Rate', d.averages.acceptanceRatePct === null ? '—' : `${d.averages.acceptanceRatePct}%`, acceptColor(d.averages.acceptanceRatePct)),
        tile('Avg Time to Claim', devReviewFmtMinutes(d.averages.avgTimeToClaimMinutes), timeColor(d.averages.avgTimeToClaimMinutes)),
        tile('Avg Time to Decision', devReviewFmtMinutes(d.averages.avgTimeToDecisionMinutes), timeColor(d.averages.avgTimeToDecisionMinutes)),
        tile('This Week', d.week.new, acceptColor(weekAcceptPct), `${d.week.accepted} accepted · ${d.week.returned} returned`),
        tile('Currently Breached', unpicked.currentlyBreached, breachedColor, 'Still waiting on a first dev touch'),
      ].join('');

      // ── 14-day charts (pad sparse series to a full 14 days) ──
      const dayKeys: string[] = [];
      for (let i = 13; i >= 0; i--) {
        const dt = new Date(now);
        dt.setDate(dt.getDate() - i);
        dayKeys.push(dt.toISOString().slice(0, 10));
      }
      const arrivalsMap = new Map(d.arrivals14d.map(a => [a.date, a.count]));
      const decisionsMap = new Map(d.decisions14d.map(x => [x.date, x]));
      const arrivals = dayKeys.map(date => ({ date, count: arrivalsMap.get(date) ?? 0 }));
      const decisions = dayKeys.map(date => {
        const e = decisionsMap.get(date);
        return { date, accepted: e?.accepted ?? 0, returned: e?.returned ?? 0 };
      });

      const chartShell = (title: string, titleColor: string, headerRight: string, barsHtml: string, axis: string[]) => `
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:18px 22px;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="font-size:13px;color:${titleColor};font-weight:700;text-transform:uppercase;letter-spacing:.6px">${title}</div>
            <div style="font-size:11px;color:#64748b">${headerRight}</div>
          </div>
          <div style="display:flex;gap:4px;flex:1;align-items:stretch;min-height:120px">${barsHtml}</div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#475569">
            <span>${axis[0]?.slice(5) ?? ''}</span><span>${axis[axis.length - 1]?.slice(5) ?? ''}</span>
          </div>
        </div>`;

      const barChart = (title: string, titleColor: string, rows: Array<{ date: string; count: number }>, color: string) => {
        const max = Math.max(...rows.map(r => r.count), 1);
        const bars = rows.map(r => {
          const pct = r.count > 0 ? Math.max(Math.round((r.count / max) * 80), 14) : 0;
          return `<div title="${r.date}: ${r.count}" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px">
            <div style="font-size:14px;font-weight:800;line-height:1;color:${r.count > 0 ? color : '#475569'}">${r.count}</div>
            <div style="width:64%;height:${pct}%;background:${color};border-radius:4px 4px 0 0"></div>
          </div>`;
        }).join('');
        return chartShell(title, titleColor, `peak: ${Math.max(...rows.map(r => r.count), 0)}`, bars, rows.map(r => r.date));
      };

      const decisionsChart = () => {
        const max = Math.max(...decisions.map(r => r.accepted + r.returned), 1);
        const bars = decisions.map(r => {
          const tot = r.accepted + r.returned;
          const totPct = tot > 0 ? Math.max(Math.round((tot / max) * 80), 14) : 0;
          const aShare = tot > 0 ? (r.accepted / tot) * 100 : 0;
          const rShare = tot > 0 ? (r.returned / tot) * 100 : 0;
          return `<div title="${r.date}: ${r.accepted} accepted, ${r.returned} returned" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px">
            <div style="font-size:14px;font-weight:800;line-height:1;color:${tot > 0 ? '#cbd5e1' : '#475569'}">${tot}</div>
            <div style="width:64%;height:${totPct}%;display:flex;flex-direction:column;border-radius:4px 4px 0 0;overflow:hidden">
              <div style="height:${rShare}%;background:#9b6aed"></div>
              <div style="height:${aShare}%;background:#10b981"></div>
            </div>
          </div>`;
        }).join('');
        const legend = `<div style="display:flex;gap:10px;align-items:center;color:#94a3b8">
          <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#10b981;display:inline-block"></span>accepted</span>
          <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:2px;background:#9b6aed;display:inline-block"></span>returned</span>
        </div>`;
        return chartShell('Decisions · Last 14 Days', '#9b6aed', legend, bars, decisions.map(r => r.date));
      };

      const row3 = [
        barChart('Arrivals · Last 14 Days', '#5ec1ca', arrivals, '#5ec1ca'),
        decisionsChart(),
        barChart('Unpicked · Last 14 Days', '#f87171', unpicked.history14d, '#ef4444'),
      ].join('');

      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev Review</title>
${wallboardRefreshScript('/wallboard/dev-review')}
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}.wrap{width:100%;padding:20px 28px;min-height:100vh;display:flex;flex-direction:column;gap:14px}.grid5{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;flex:1}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;flex:1}.flash-red{animation:flash 1s ease-in-out infinite}@keyframes flash{0%,100%{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}50%{background:rgba(239,68,68,.35);border-color:rgba(239,68,68,.8);box-shadow:0 0 24px rgba(239,68,68,.5)}}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center">
  <div><h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px">Dev Review Dashboard</h1><div style="font-size:10px;color:#64748b;margin-top:1px">Technical Support · review queue</div></div>
  <div style="font-size:10px;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
<div class="grid5">${row1}</div>
<div class="grid5">${row2}</div>
<div class="grid3">${row3}</div>
<div style="text-align:center;font-size:10px;color:#475569">nurtur.tech &middot; Dev Review &middot; ${dateStr}</div>
</div></body></html>`;
      res.send(html);
      logWallboard('/wallboard/dev-review', 'info', 200, Date.now() - wbStart, `OK — queue ${d.queue.total}, breached ${unpicked.currentlyBreached}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/dev-review', 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // ── "Ricky" wallboard — Technical Director risk view ──
  // Two zones for Tech Support (NT project, dev tiers): what's ON FIRE now
  // (already breached) and what's AT RISK (breaching within the next 2h).
  app.get('/wallboard/ricky', async (_req, res) => {
    const wbStart = Date.now();
    const AT_RISK_HOURS = 2;
    type TierAgg = { on_fire: number; at_risk: number; stale: number; active: number };
    try {
      // 1. SLA state per Tech Support tier from the Jira issue cache.
      const tierRows = await query<{ tier: string } & TierAgg>(`
        SELECT current_tier AS tier,
          SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS on_fire,
          SUM(CASE WHEN sla_breached = 0 AND sla_breach_time IS NOT NULL
                    AND sla_breach_time > GETUTCDATE()
                    AND sla_breach_time <= DATEADD(hour, ${AT_RISK_HOURS}, GETUTCDATE())
                   THEN 1 ELSE 0 END) AS at_risk,
          SUM(CASE WHEN sla_breached = 0 AND no_reply = 1 THEN 1 ELSE 0 END) AS stale,
          COUNT(*) AS active
        FROM jira_issue_cache
        WHERE status_category != 'Done' AND project_key = 'NT'
          AND current_tier IN ('Customer Care','Production','Tier 2','Tier 3','Development','Escalations')
        GROUP BY current_tier
      `);
      const tierMap = new Map<string, TierAgg>();
      for (const r of tierRows) {
        const name = r.tier === 'Escalations' ? 'Tier 2' : r.tier;   // fold Escalations into Tier 2
        const e = tierMap.get(name) ?? { on_fire: 0, at_risk: 0, stale: 0, active: 0 };
        e.on_fire += r.on_fire; e.at_risk += r.at_risk; e.stale += r.stale; e.active += r.active;
        tierMap.set(name, e);
      }
      const TIERS = ['Customer Care', 'Production', 'Tier 2', 'Tier 3', 'Development'];
      const tiers = TIERS.map(t => ({ tier: t, ...(tierMap.get(t) ?? { on_fire: 0, at_risk: 0, stale: 0, active: 0 }) }));
      const totalFire = tiers.reduce((s, t) => s + t.on_fire, 0);
      const totalRisk = tiers.reduce((s, t) => s + t.at_risk, 0);
      const totalStale = tiers.reduce((s, t) => s + t.stale, 0);

      // 2. Flagged tickets (NOVA AI risk alerting) — matches the AI Dashboard count
      //    (getFlaggedSummary: status 'pending', ticket not done).
      let flaggedTickets = 0;
      try {
        const f = await queryOne<{ c: number }>(
          `SELECT COUNT(*) AS c FROM agent_flagged_tickets f
           JOIN jira_issue_cache j ON j.issue_key = f.ticket_key
           WHERE f.status = 'pending' AND j.status_category != 'done'`,
        );
        flaggedTickets = f?.c ?? 0;
      } catch { /* risk scorer optional */ }

      // 3. Dev Review breached + unpicked today.
      let devBreached = 0, devUnpickedToday = 0;
      try {
        const dd = await devReviewQueries.getDashboard();
        devBreached = dd.unpickedKpi.currentlyBreached;
        devUnpickedToday = dd.unpickedKpi.today;
      } catch { /* non-fatal */ }

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB');
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      const fireTile = (label: string, value: number | string, sub?: string) => {
        const v = Number(value) || 0;
        const color = v > 0 ? '#ef4444' : '#10b981';
        return `<div class="${v > 0 ? 'flash-red' : ''}" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 18px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
          <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${label}</div>
          <div style="font-size:58px;font-weight:800;letter-spacing:-2px;line-height:1;color:${color}">${value}</div>
          ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:6px">${sub}</div>` : ''}
        </div>`;
      };
      const riskTile = (label: string, value: number | string, sub?: string) => {
        const v = Number(value) || 0;
        const color = v > 0 ? '#f59e0b' : '#10b981';
        return `<div class="${v > 0 ? 'pulse-amber' : ''}" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 18px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">
          <div style="font-size:12px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">${label}</div>
          <div style="font-size:58px;font-weight:800;letter-spacing:-2px;line-height:1;color:${color}">${value}</div>
          ${sub ? `<div style="font-size:11px;color:#64748b;margin-top:6px">${sub}</div>` : ''}
        </div>`;
      };

      const fireTiers = tiers.map(t => fireTile(t.tier, t.on_fire, 'SLA breached')).join('');
      const fireExtra = [
        fireTile('Flagged Tickets', flaggedTickets, 'NOVA AI risk alerts'),
        fireTile('Dev Review Breached', devBreached, 'unpicked > 8h'),
      ].join('');
      const riskTiers = tiers.map(t => riskTile(t.tier, t.at_risk, `breaching < ${AT_RISK_HOURS}h`)).join('');
      const riskExtra = [
        riskTile('No Reply', totalStale, 'awaiting first/next update'),
        riskTile('Dev Unpicked Today', devUnpickedToday, 'no dev action yet'),
      ].join('');

      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tech Support — Risk Board</title>
${wallboardRefreshScript('/wallboard/ricky')}
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}
.wrap{width:100%;padding:18px 26px;min-height:100vh;display:flex;flex-direction:column;gap:12px}
.zone{flex:1;display:flex;flex-direction:column;gap:10px;border-radius:16px;padding:14px 16px}
.zone-fire{background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.18)}
.zone-risk{background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.18)}
.zone-head{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}
.grid4{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;flex:2}
.grid3{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;flex:1}
.flash-red{animation:flash 1s ease-in-out infinite}@keyframes flash{0%,100%{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}50%{background:rgba(239,68,68,.35);border-color:rgba(239,68,68,.8);box-shadow:0 0 24px rgba(239,68,68,.5)}}
.pulse-amber{animation:pulseA 1.8s ease-in-out infinite}@keyframes pulseA{0%,100%{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}50%{background:rgba(245,158,11,.18);border-color:rgba(245,158,11,.55)}}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center">
  <div><h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px">Technical Support — Risk Board</h1><div style="font-size:10px;color:#64748b;margin-top:1px">What's on fire now &middot; what's about to be</div></div>
  <div style="text-align:right"><div style="font-size:14px;font-weight:800"><span style="color:#ef4444">🔥 ${totalFire}</span> &nbsp; <span style="color:#f59e0b">⚠️ ${totalRisk}</span></div><div style="font-size:10px;color:#64748b">Auto-refresh 30s &middot; Updated ${timeStr}</div></div>
</div>
<div class="zone zone-fire">
  <div class="zone-head" style="color:#f87171">🔥 On Fire Now &mdash; SLA breached</div>
  <div class="grid4">${fireTiers}</div>
  <div class="grid3">${fireExtra}</div>
</div>
<div class="zone zone-risk">
  <div class="zone-head" style="color:#fbbf24">⚠️ At Risk &mdash; breaching within ${AT_RISK_HOURS}h</div>
  <div class="grid4">${riskTiers}</div>
  <div class="grid3">${riskExtra}</div>
</div>
<div style="text-align:center;font-size:10px;color:#475569">nurtur.tech &middot; Tech Support Risk Board &middot; ${dateStr}</div>
</div></body></html>`;
      res.send(html);
      logWallboard('/wallboard/ricky', 'info', 200, Date.now() - wbStart, `OK — fire ${totalFire}, risk ${totalRisk}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/ricky', 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // ── Wallboards (Rebuild) — Layer-1 org KPIs (Support/NT) ──
  // NEW, parallel TV boards sourced ENTIRELY from the rebuilt KPI engine
  // (kpi-org live snapshot). The legacy /wallboard/* boards above are untouched.
  // Live (60s-cached) recompute so the board isn't stuck on the 18:00 freeze.
  function rebuildWbValue(unit: string, value: number | null): string {
    if (value == null) return '—';
    if (unit === 'days') return `${value}d`;
    if (unit === 'percent') return `${value}%`;
    if (unit === 'currency') return `£${Math.round(value).toLocaleString('en-GB')}`;
    return String(value);
  }
  function rebuildWbColor(rag: string | null): string {
    if (rag === 'green') return '#10b981';
    if (rag === 'amber') return '#eab308';
    if (rag === 'red') return '#ef4444';
    return '#5ec1ca';
  }
  function renderRebuildSupportWb(
    snap: { day: string; items: Array<{ label: string; colA: string; unit: string; value: number | null; target: number | null; rag: string | null }> },
    opts: { title: string; subtitle: string; route: string; breachOnly: boolean },
  ): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB');
    const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const items = opts.breachOnly ? snap.items.filter(i => i.rag === 'red') : snap.items;
    const groups = ['Support', 'Development'];

    const sections = groups.map(group => {
      const rows = items.filter(i => (i.colA || 'Support') === group);
      if (!rows.length) return '';
      const cards = rows.map(p => {
        const color = rebuildWbColor(p.rag);
        const flash = p.rag === 'red' ? ' flash-red' : '';
        const target = p.target != null ? `Target ${rebuildWbValue(p.unit, p.target)}` : '';
        return `<div class="${flash}" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;align-items:center">
          <div style="font-size:13px;color:#94a3b8;font-weight:600;text-align:center;margin-bottom:8px;letter-spacing:.2px;min-height:2.4em;display:flex;align-items:center">${p.label}</div>
          <div style="font-size:54px;font-weight:800;letter-spacing:-2px;line-height:1;color:${color}">${rebuildWbValue(p.unit, p.value)}</div>
          <div style="font-size:10px;color:#64748b;margin-top:6px">${target}</div>
        </div>`;
      }).join('');
      return `<div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin:8px 0 6px">${group}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${cards}</div>`;
    }).join('');

    const body = items.length
      ? sections
      : `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:#10b981;font-size:28px">No breaching KPIs — all green ✅</div>`;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
${wallboardRefreshScript(opts.route)}
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow-x:hidden}.wrap{max-width:1600px;margin:0 auto;padding:20px 28px;min-height:100vh;display:flex;flex-direction:column}.flash-red{animation:flash 1s ease-in-out infinite}@keyframes flash{0%,100%{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.06)}50%{background:rgba(239,68,68,.35);border-color:rgba(239,68,68,.8);box-shadow:0 0 24px rgba(239,68,68,.5)}}</style>
</head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <div><h1 style="font-size:22px;font-weight:800;letter-spacing:-0.5px">${opts.title}</h1><div style="font-size:10px;color:#64748b;margin-top:1px">${opts.subtitle}</div></div>
  <div style="font-size:10px;color:#64748b">Live (rebuild) &middot; Auto-refresh 30s &middot; Updated ${timeStr}</div>
</div>
${body}
<div style="text-align:center;margin-top:14px;font-size:10px;color:#475569">nurtur.tech &middot; ${opts.title} &middot; ${dateStr} &middot; Source: kpi-org (NT)</div>
</div></body></html>`;
  }

  async function serveRebuildWb(res: import('express').Response, route: string, title: string, subtitle: string, breachOnly: boolean): Promise<void> {
    const wbStart = Date.now();
    if (!agentJiraClient) {
      logWallboard(route, 'error', 503, Date.now() - wbStart, 'Jira client not configured');
      res.status(503).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Jira client not configured</body></html>`);
      return;
    }
    try {
      const snap = await getSupportLiveSnapshot(agentJiraClient);
      res.send(renderRebuildSupportWb(snap, { title, subtitle, route, breachOnly }));
      logWallboard(route, 'info', 200, Date.now() - wbStart, `OK — ${snap.items.length} KPIs`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard(route, 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  }

  // Support KPIs — full 22-KPI scorecard board (live from Jira). No legacy twin,
  // so it keeps a permanent home here (the KPI-breach subset lives on /wallboard/team-kpis).
  app.get('/wallboard/support', (_req, res) =>
    serveRebuildWb(res, '/wallboard/support', 'Support — KPIs', 'Live Support/NT KPIs', false));

  // ── Public Dash — unauthenticated index of mini wallboards (summary cards). ──
  // Each card shows a headline metric from the same live engines the full boards
  // use; clicking opens the full board in a new tab. Public, like /wallboard/*.
  interface DashCard { title: string; href: string; metric: string; metricLabel: string; sub: string; color: string }
  app.get(['/wallboard/dash', '/dash'], async (_req, res) => {
    const wbStart = Date.now();
    try {
      const settings = settingsQueries.getAll();
      const kaEnabled = settings.wallboard_key_accounts_enabled !== 'false';
      const csEnabled = settings.wallboard_cs_enabled !== 'false';
      const jira = agentJiraClient;

      const sumTier = (snap: TierSnapshot, buckets: string[]) => {
        let active = 0, over = 0;
        for (const b of buckets) { active += snap.tiers[b]?.active ?? 0; over += snap.tiers[b]?.overSla ?? 0; }
        return { active, over };
      };
      const CC_B = ['cc_incidents', 'cc_service_requests', 'cc_tpj'];
      const TS_B = ['production', 'tier2', 'development'];
      const ALL_B = [...CC_B, ...TS_B];

      // Each card computes independently; a failing board shows "—" rather than
      // taking down the whole Dash.
      const guard = async (title: string, href: string, fn: () => Promise<Omit<DashCard, 'title' | 'href'>>): Promise<DashCard> => {
        try { return { title, href, ...(await fn()) }; }
        catch { return { title, href, metric: '—', metricLabel: '', sub: 'unavailable', color: '#64748b' }; }
      };

      const jobs: Array<Promise<DashCard | null>> = [
        guard('SLA Breach Board', '/wallboard/breached', async () => {
          if (!jira) throw new Error('no jira');
          const s = await getAgentLiveSnapshot(settingsQueries, jira);
          const over = s.agents.reduce((a, x) => a + x.overSla, 0);
          const breached = s.agents.filter(x => x.overSla > 0).length;
          return { metric: String(over), metricLabel: 'over SLA', sub: `${breached} agents breached`, color: over > 0 ? '#ef4444' : '#10b981' };
        }),
        guard('KPI Breach Board', '/wallboard/team-kpis', async () => {
          if (!jira) throw new Error('no jira');
          const s = await getSupportLiveSnapshot(jira);
          const red = s.items.filter(i => i.rag === 'red').length;
          const amber = s.items.filter(i => i.rag === 'amber').length;
          return { metric: String(red), metricLabel: 'KPIs red', sub: `${amber} amber`, color: red > 0 ? '#ef4444' : amber > 0 ? '#f59e0b' : '#10b981' };
        }),
        guard('Customer Care', '/wallboard/cc', async () => {
          if (!jira) throw new Error('no jira');
          const { active, over } = sumTier(await getTierSnapshot(jira, 'all'), CC_B);
          return { metric: String(active), metricLabel: 'open', sub: `${over} over SLA`, color: over > 0 ? '#ef4444' : '#5ec1ca' };
        }),
        guard('Technical Support', '/wallboard/tech-support', async () => {
          if (!jira) throw new Error('no jira');
          const { active, over } = sumTier(await getTierSnapshot(jira, 'all'), TS_B);
          return { metric: String(active), metricLabel: 'open', sub: `${over} over SLA`, color: over > 0 ? '#ef4444' : '#5ec1ca' };
        }),
        kaEnabled ? guard('Key Accounts', '/wallboard/key-accounts', async () => {
          if (!jira) throw new Error('no jira');
          const { active, over } = sumTier(await getTierSnapshot(jira, 'key_accounts'), ALL_B);
          return { metric: String(active), metricLabel: 'open', sub: `${over} over SLA`, color: over > 0 ? '#ef4444' : '#5ec1ca' };
        }) : Promise.resolve(null),
        csEnabled ? guard('Customer Success', '/wallboard/customer-success', async () => {
          if (!jira) throw new Error('no jira');
          const { active, over } = sumTier(await getTierSnapshot(jira, 'customer_success'), ALL_B);
          return { metric: String(active), metricLabel: 'open', sub: `${over} over SLA`, color: over > 0 ? '#ef4444' : '#5ec1ca' };
        }) : Promise.resolve(null),
        guard('Support KPIs', '/wallboard/support', async () => {
          if (!jira) throw new Error('no jira');
          const s = await getSupportLiveSnapshot(jira);
          const total = s.items.length;
          const green = s.items.filter(i => i.rag === 'green').length;
          return { metric: `${green}/${total}`, metricLabel: 'KPIs green', sub: `${total - green} not green`, color: green === total ? '#10b981' : green >= total * 0.7 ? '#f59e0b' : '#ef4444' };
        }),
        guard('Dev Review', '/wallboard/dev-review', async () => {
          const d = await devReviewQueries.getDashboard();
          const breached = d.unpickedKpi.currentlyBreached;
          return { metric: String(d.queue.total), metricLabel: 'in queue', sub: `${breached} breached`, color: breached > 0 ? '#ef4444' : '#9b6aed' };
        }),
        guard('Risk Board', '/wallboard/ricky', async () => {
          const r = await query<{ on_fire: number; at_risk: number }>(`
            SELECT SUM(CASE WHEN sla_breached = 1 THEN 1 ELSE 0 END) AS on_fire,
                   SUM(CASE WHEN sla_breached = 0 AND sla_breach_time IS NOT NULL AND sla_breach_time > GETUTCDATE()
                             AND sla_breach_time <= DATEADD(hour, 2, GETUTCDATE()) THEN 1 ELSE 0 END) AS at_risk
            FROM jira_issue_cache WHERE status_category != 'Done' AND project_key = 'NT'
              AND current_tier IN ('Production','Tier 2','Tier 3','Development','Escalations')`);
          const onFire = r[0]?.on_fire ?? 0; const atRisk = r[0]?.at_risk ?? 0;
          return { metric: String(onFire), metricLabel: 'on fire', sub: `${atRisk} at risk`, color: onFire > 0 ? '#ef4444' : atRisk > 0 ? '#f59e0b' : '#10b981' };
        }),
        guard('Strategic (SLT)', '/wallboard/strategic', async () => {
          // High-risk = AgentBrain at-risk customers in tier 3+ (issue-card inversion).
          const hi = (await getAtRiskCustomersFromIssues()).filter(c => c.tier >= 3).length;
          return { metric: String(hi), metricLabel: 'high-risk accounts', sub: 'End-of-day SLT view', color: hi > 0 ? '#f59e0b' : '#10b981' };
        }),
      ];

      const cards = (await Promise.all(jobs)).filter((c): c is DashCard => c !== null);

      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-GB');
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      const cardHtml = cards.map(c => `
        <div class="card" role="link" tabindex="0" data-href="${c.href}" data-title="${c.title}" data-color="${c.color}">
          <div class="card-title">${c.title}</div>
          <div class="card-metric" style="color:${c.color}">${c.metric}</div>
          <div class="card-label">${c.metricLabel}</div>
          <div class="card-sub">${c.sub}</div>
          <div class="card-open">Expand board ⤢</div>
        </div>`).join('');

      res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NOVA — Wallboard Dash</title>
<script>setInterval(()=>{if(!document.body.classList.contains('wb-expanded'))location.reload();},60000);</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;min-height:100vh}
.wrap{max-width:1500px;margin:0 auto;padding:24px 28px}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px}
h1{font-size:24px;font-weight:800;letter-spacing:-0.5px}
.sub{font-size:11px;color:#64748b;margin-top:2px}
.meta{font-size:11px;color:#64748b}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}}
.card{display:flex;flex-direction:column;align-items:center;text-align:center;text-decoration:none;color:inherit;cursor:pointer;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:24px 20px;
  transition:transform .16s cubic-bezier(.2,.8,.2,1),border-color .16s,box-shadow .16s}
.card:hover,.card:focus-visible{transform:translateY(-4px) scale(1.015);border-color:rgba(94,193,202,.45);box-shadow:0 10px 32px rgba(0,0,0,.4);outline:none}
.card:active{transform:scale(.98)}
.card.lifting{transform:scale(1.04);box-shadow:0 0 0 1px rgba(94,193,202,.6),0 0 40px rgba(94,193,202,.35)}
.card-title{font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;margin-bottom:14px}
.card-metric{font-size:64px;font-weight:800;letter-spacing:-2px;line-height:1}
.card-label{font-size:12px;color:#64748b;margin-top:6px;text-transform:uppercase;letter-spacing:.5px}
.card-sub{font-size:13px;color:#cbd5e1;margin-top:10px}
.card-open{font-size:11px;color:#5ec1ca;margin-top:14px;font-weight:600}
.foot{text-align:center;margin-top:26px;font-size:11px;color:#475569}

/* ── Expand-to-fullscreen overlay ── */
.wb-overlay{position:fixed;inset:0;z-index:1000;display:none}
.wb-overlay.show{display:block}
.wb-backdrop{position:absolute;inset:0;background:rgba(8,11,15,0);backdrop-filter:blur(0px);
  transition:background .4s ease,backdrop-filter .4s ease}
.wb-overlay.open .wb-backdrop{background:rgba(8,11,15,.8);backdrop-filter:blur(6px)}
.wb-panel{position:fixed;overflow:hidden;background:#1a1f26;will-change:left,top,width,height;
  box-shadow:0 0 0 1px var(--glow,#5ec1ca),0 0 90px -10px var(--glow,#5ec1ca),0 30px 80px rgba(0,0,0,.6);
  transition:left .46s cubic-bezier(.16,1,.3,1),top .46s cubic-bezier(.16,1,.3,1),
    width .46s cubic-bezier(.16,1,.3,1),height .46s cubic-bezier(.16,1,.3,1),border-radius .46s ease}
.wb-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#1a1f26;opacity:0;transition:opacity .3s ease .18s}
.wb-overlay.open .wb-frame{opacity:1}
.wb-overlay.closing .wb-frame{opacity:0;transition:opacity .14s ease}
.wb-pulse{position:absolute;inset:0;pointer-events:none;opacity:0;
  background:radial-gradient(circle at 50% 45%,var(--glow,#5ec1ca) 0%,transparent 60%)}
.wb-overlay.open .wb-pulse{animation:wbpulse .6s ease-out}
@keyframes wbpulse{0%{opacity:.5}100%{opacity:0}}
.wb-close{position:absolute;top:16px;right:16px;z-index:3;display:flex;align-items:center;gap:8px;
  font:600 12px/1 system-ui,-apple-system,sans-serif;letter-spacing:.4px;color:#e2e8f0;cursor:pointer;
  background:rgba(20,25,32,.7);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:9px 14px;
  backdrop-filter:blur(8px);opacity:0;transform:translateY(-6px);transition:opacity .3s ease .25s,transform .3s ease .25s,background .15s,border-color .15s}
.wb-overlay.open .wb-close{opacity:1;transform:none}
.wb-overlay.closing .wb-close{opacity:0;transition:opacity .12s}
.wb-close:hover{background:rgba(239,68,68,.9);border-color:rgba(239,68,68,.9)}
.wb-close .x{font-size:14px;line-height:1}
@media(prefers-reduced-motion:reduce){
  .wb-panel,.wb-frame,.wb-close,.wb-backdrop{transition-duration:.01s}
  .card{transition-duration:.01s}
}
</style>
</head><body><div class="wrap">
<div class="head">
  <div><h1>NOVA Wallboards</h1><div class="sub">Live support &amp; KPI boards — click any tile for the full board</div></div>
  <div class="meta">Auto-refresh 60s · Updated ${timeStr}</div>
</div>
<div class="grid">${cardHtml}</div>
<div class="foot">nurtur.tech · NOVA Wallboard Dash · ${dateStr}</div>
</div>
<div class="wb-overlay" id="wb-overlay">
  <div class="wb-backdrop"></div>
  <div class="wb-panel" id="wb-panel">
    <div class="wb-pulse"></div>
    <iframe class="wb-frame" id="wb-frame" title="Wallboard"></iframe>
    <button class="wb-close" id="wb-close" aria-label="Close board"><span class="x">✕</span><span id="wb-otitle"></span></button>
  </div>
</div>
<script>
(function(){
  var ov=document.getElementById('wb-overlay'),panel=document.getElementById('wb-panel'),
      frame=document.getElementById('wb-frame'),otitle=document.getElementById('wb-otitle'),
      closeBtn=document.getElementById('wb-close'),origin=null,busy=false;
  function once(prop,cb){
    function h(e){ if(e.target===panel&&e.propertyName===prop){panel.removeEventListener('transitionend',h);cb();} }
    panel.addEventListener('transitionend',h);
  }
  function expand(card){
    if(busy||ov.classList.contains('show'))return; busy=true;
    var href=card.dataset.href,color=card.dataset.color||'#5ec1ca',r=card.getBoundingClientRect();
    origin=r; document.body.classList.add('wb-expanded');
    ov.style.setProperty('--glow',color); otitle.textContent=card.dataset.title||'';
    card.classList.add('lifting'); setTimeout(function(){card.classList.remove('lifting');},400);
    panel.style.transition='none';
    panel.style.left=r.left+'px';panel.style.top=r.top+'px';
    panel.style.width=r.width+'px';panel.style.height=r.height+'px';panel.style.borderRadius='16px';
    ov.classList.add('show'); void panel.offsetWidth; panel.style.transition='';
    requestAnimationFrame(function(){
      ov.classList.add('open');
      panel.style.left='0px';panel.style.top='0px';
      panel.style.width='100vw';panel.style.height='100vh';panel.style.borderRadius='0px';
    });
    setTimeout(function(){ if(frame.getAttribute('src')!==href)frame.setAttribute('src',href); },260);
    once('width',function(){busy=false;});
  }
  function collapse(){
    if(busy||!ov.classList.contains('open')||!origin)return; busy=true;
    var r=origin; ov.classList.add('closing'); ov.classList.remove('open');
    panel.style.left=r.left+'px';panel.style.top=r.top+'px';
    panel.style.width=r.width+'px';panel.style.height=r.height+'px';panel.style.borderRadius='16px';
    once('width',function(){
      ov.classList.remove('show'); ov.classList.remove('closing');
      frame.setAttribute('src','about:blank'); document.body.classList.remove('wb-expanded'); busy=false;
    });
  }
  document.querySelectorAll('.card').forEach(function(card){
    card.addEventListener('click',function(){expand(card);});
    card.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();expand(card);} });
  });
  closeBtn.addEventListener('click',collapse);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')collapse(); });
})();
</script>
</body></html>`);
      logWallboard('/wallboard/dash', 'info', 200, Date.now() - wbStart, `OK — ${cards.length} cards`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard('/wallboard/dash', 'error', 500, Date.now() - wbStart, msg);
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // ── Strategic Dashboard (SLT) — calm, leadership-facing wallboard. ──
  // Unlike /wallboard/dash (live intraday), this shows END-OF-DAY outcomes for
  // the last 5 completed business days so a red tile at 10am doesn't read as a
  // systemic failure. Left = 8 grouped KPI metrics (5-day RAG + trend); right =
  // key-account risks (top) + Jira commitments past normal SLA (bottom); a
  // collapsed roll-up bar expands to the 20 granular per-queue metrics.
  // Open-access, no auth, like every /wallboard/* route.
  app.get(['/wallboard/strategic', '/wallboard/slt'], async (_req, res) => {
    const wbStart = Date.now();
    const route = '/wallboard/strategic';
    const esc = (s: unknown) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    try {
      const now = new Date();
      // Browse-link base = the Jira SITE, not jira_ob_url (that's the api.atlassian.net
      // gateway used by the REST client, which 404s for /browse). Override via jira_browse_url.
      const jiraBase = (settingsQueries.get('jira_browse_url') || 'https://nurturtech.atlassian.net').replace(/\/$/, '');

      // ── LEFT: 5-day end-of-day KPI snapshots from jira_kpi_daily (NOVA-populated) ──
      const pool = await getKpiPool(settingsQueries);
      const snapRows = (await pool.request().query(`
        SELECT kpi, [count] AS cnt, rag, CAST(CreatedAt AS DATE) AS d
        FROM dbo.jira_kpi_daily
        WHERE CAST(CreatedAt AS DATE) >= DATEADD(day, -35, CAST(GETDATE() AS DATE))
          AND CAST(CreatedAt AS DATE) < CAST(GETDATE() AS DATE)
      `)).recordset as Array<{ kpi: string; cnt: number; rag: number | null; d: Date | string }>;

      // Index by day → kpiName(lower) → {count, rag}
      const toDayKey = (d: Date | string) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
      const isWeekday = (key: string) => { const wd = new Date(key + 'T00:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6; };
      const byDay = new Map<string, Map<string, { count: number; rag: number | null }>>();
      for (const r of snapRows) {
        const key = toDayKey(r.d);
        if (!byDay.has(key)) byDay.set(key, new Map());
        byDay.get(key)!.set(String(r.kpi).toLowerCase().trim(), { count: Number(r.cnt) || 0, rag: r.rag == null ? null : Number(r.rag) });
      }

      // Org QA score has no single jira_kpi_daily row — derive a per-day,
      // tickets-weighted average from the per-agent table (QAOverallAvg is 0–10:
      // ≥8 green, ≥6 amber, else red) and inject under a sentinel key.
      try {
        const qaRows = (await pool.request().query(`
          SELECT CAST(ReportDate AS DATE) AS d, SUM(QAOverallAvg * QATicketsScored) AS s, SUM(QATicketsScored) AS n
          FROM dbo.jira_agent_kpi_daily
          WHERE ReportDate >= DATEADD(day, -35, CAST(GETDATE() AS DATE))
            AND ReportDate < CAST(GETDATE() AS DATE)
            AND QAOverallAvg IS NOT NULL AND QATicketsScored > 0
          GROUP BY CAST(ReportDate AS DATE)
        `)).recordset as Array<{ d: Date | string; s: number; n: number }>;
        for (const r of qaRows) {
          const n = Number(r.n) || 0; if (!n) continue;
          const avg = Math.round((Number(r.s) / n) * 10) / 10;          // 1dp, 0–10
          const rag = avg >= 8 ? 1 : avg >= 6 ? 2 : 3;  // QAOverallAvg is 0–10
          const key = toDayKey(r.d);
          if (!byDay.has(key)) byDay.set(key, new Map());
          byDay.get(key)!.set('__org_qa__', { count: avg, rag });
        }
      } catch { /* QA optional — agent table may be absent */ }

      // Rolling 7-day org CSAT, injected per day under a sentinel key. Resolved-today
      // CSAT is too spiky for SLT (mostly no-survey dashes + the odd lone red), so
      // each day shows the trailing-7-day, volume-weighted average instead.
      try {
        const CSAT_ROLL_DAYS = 7;
        const csatRows = (await pool.request().query(`
          SELECT CAST(ReportDate AS DATE) AS d, SUM(CSATAverage * CSATCount) AS s, SUM(CSATCount) AS n
          FROM dbo.jira_agent_kpi_daily
          WHERE ReportDate >= DATEADD(day, -42, CAST(GETDATE() AS DATE))
            AND ReportDate < CAST(GETDATE() AS DATE)
            AND CSATAverage IS NOT NULL AND CSATCount > 0
          GROUP BY CAST(ReportDate AS DATE)
        `)).recordset as Array<{ d: Date | string; s: number; n: number }>;
        // Denominator for coverage = resolved tickets across all agents per day
        // (independent of whether a survey came back). Coverage = responses ÷ solved.
        const csatSolvedRows = (await pool.request().query(`
          SELECT CAST(ReportDate AS DATE) AS d, SUM(SolvedTickets_Today) AS solved
          FROM dbo.jira_agent_kpi_daily
          WHERE ReportDate >= DATEADD(day, -42, CAST(GETDATE() AS DATE))
            AND ReportDate < CAST(GETDATE() AS DATE)
          GROUP BY CAST(ReportDate AS DATE)
        `)).recordset as Array<{ d: Date | string; solved: number }>;
        const csatDaily = new Map<string, { s: number; n: number }>();
        for (const r of csatRows) csatDaily.set(toDayKey(r.d), { s: Number(r.s) || 0, n: Number(r.n) || 0 });
        const csatSolvedDaily = new Map<string, number>();
        for (const r of csatSolvedRows) csatSolvedDaily.set(toDayKey(r.d), Number(r.solved) || 0);
        for (const dayKey of byDay.keys()) {
          const end = new Date(dayKey + 'T00:00:00Z');
          let s = 0, n = 0, solved = 0;
          for (let i = 0; i < CSAT_ROLL_DAYS; i++) {
            const dk = new Date(end); dk.setUTCDate(dk.getUTCDate() - i);
            const key = dk.toISOString().slice(0, 10);
            const v = csatDaily.get(key);
            if (v) { s += v.s; n += v.n; }
            solved += csatSolvedDaily.get(key) || 0;
          }
          if (n > 0) {
            const avg = Math.round((s / n) * 10) / 10;            // 1–5 average, 1dp
            const rag = avg >= 4 ? 1 : avg >= 3 ? 2 : 3;          // 4/5 = green
            byDay.get(dayKey)!.set('__csat_roll__', { count: avg, rag });
          }
          // Coverage: % of resolved tickets that returned a CSAT rating (7-day rolling).
          // Neutral/grey — no agreed target yet; the point is to expose how thin it is
          // (a 2.3 built on 0.4% coverage is an impression, not a measurement).
          if (solved > 0) {
            const cov = Math.round((n / solved) * 1000) / 10;   // 1dp — "0.4%" not "0%"
            byDay.get(dayKey)!.set('__csat_cov__', { count: cov, rag: null });
          }
        }
      } catch { /* CSAT rolling optional */ }

      // Solved by Team / Solved by NOVA come from the BA-spec engine (kpi_org_daily,
      // the canonical org KPIs), injected per day under sentinel keys. Higher-better.
      try {
        const ragNum = (r: string | null) => r === 'green' ? 1 : r === 'amber' ? 2 : r === 'red' ? 3 : null;
        const solvedRows = await query<{ d: Date | string; kpi_key: string; value: number; rag: string | null }>(
          `SELECT kpi_date AS d, kpi_key, value, rag FROM kpi_org_daily
           WHERE team_key = 'Support' AND kpi_key IN ('nt_solved_team', 'nt_solved_nova')
             AND kpi_date >= DATEADD(day, -42, CAST(GETDATE() AS DATE)) AND kpi_date < CAST(GETDATE() AS DATE)`);
        for (const r of solvedRows) {
          const key = toDayKey(r.d);
          if (!byDay.has(key)) byDay.set(key, new Map());
          const sentinel = r.kpi_key === 'nt_solved_nova' ? '__solved_nova__' : '__solved_team__';
          byDay.get(key)!.set(sentinel, { count: Math.round(Number(r.value) || 0), rag: ragNum(r.rag) });
        }
      } catch { /* solved KPIs optional — kpi_org_daily may be unpopulated */ }

      const days = [...byDay.keys()].filter(isWeekday).sort().slice(-5);

      // Fragments to locate a stored KPI name for a queue. `noreply` names keep
      // the parenthesised tier; `bare` names (over-SLA / oldest) strip parens.
      const FRAG: Record<string, { noreply: string; bare: string }> = {
        'CC (Incidents)': { noreply: 'cc (incidents)', bare: 'cc incidents' },
        'CC (Service Requests)': { noreply: 'cc (service requests)', bare: 'cc service requests' },
        'CC (TPJ)': { noreply: 'cc (tpj)', bare: 'cc (tpj)' },
        'Production': { noreply: 'production', bare: 'production' },
        'Tier 2': { noreply: 'tier 2', bare: 'tier 2' },
        'Tier 3': { noreply: 'tier 3', bare: 'tier 3' },
        'Development': { noreply: 'development', bare: 'development' },
      };
      type Kind = 'newvol' | 'noreply' | 'oversla' | 'oldest' | 'csat' | 'qa' | 'pct' | 'solved';
      const matches = (name: string, kind: Kind, queue?: string) => {
        if (kind === 'newvol') return name.includes('new tickets');
        const f = queue ? FRAG[queue] : null; if (!f) return false;
        if (kind === 'noreply') return name.includes('no reply') && name.includes(f.noreply);
        if (kind === 'oversla') return name.includes('over sla') && name.includes('actionable') && name.includes(f.bare);
        return name.includes('oldest actionable') && name.includes(f.bare); // oldest
      };
      const getCell = (dm: Map<string, { count: number; rag: number | null }>, kind: Kind, queue?: string): { num: number; rag: number | null } | null => {
        for (const [name, v] of dm) if (matches(name, kind, queue)) return { num: v.count, rag: v.rag };
        return null;
      };
      const groupCell = (dm: Map<string, { count: number; rag: number | null }>, kind: Kind, queues: string[]): { num: number; rag: number | null } | null => {
        const parts = queues.map(q => getCell(dm, kind, q)).filter((p): p is { num: number; rag: number | null } => p !== null);
        if (!parts.length) return null;
        const rag = Math.max(...parts.map(p => p.rag ?? 1));            // worst child RAG
        const num = kind === 'oldest' ? Math.max(...parts.map(p => p.num)) : parts.reduce((s, p) => s + p.num, 0);
        return { num, rag };
      };
      // Find a single named org KPI (CSAT, injected QA) by name predicate.
      const getNamed = (dm: Map<string, { count: number; rag: number | null }>, pred: (name: string) => boolean): { num: number; rag: number | null } | null => {
        for (const [name, v] of dm) if (pred(name)) return { num: v.count, rag: v.rag };
        return null;
      };
      // New ticket volume RAG is a fixed business band: ≤110 green, 111–120 amber,
      // >120 red. Computed here from the value (not the stored rag) so the
      // displayed history is correct immediately.
      const newvolRag = (v: number) => v <= 110 ? 1 : v <= 120 ? 2 : 3;
      const newvolCell = (dm: Map<string, { count: number; rag: number | null }>): { num: number; rag: number | null } | null => {
        const c = getCell(dm, 'newvol');
        return c ? { num: c.num, rag: newvolRag(c.num) } : null;
      };
      // CSAT = rolling 7-day average (injected above). No surveys in the trailing
      // week → not injected → grey dash, excluded from trend/weekly.
      const csatCell = (dm: Map<string, { count: number; rag: number | null }>): { num: number; rag: number | null } | null =>
        getNamed(dm, n => n === '__csat_roll__');
      // CSAT coverage: % of resolved tickets that returned a rating (rolling 7-day).
      // Neutral grey — exposes how thin the CSAT sample is behind the score.
      const csatCovCell = (dm: Map<string, { count: number; rag: number | null }>): { num: number; rag: number | null } | null =>
        getNamed(dm, n => n === '__csat_cov__');

      // Muted RAG palette — calm "attention" tones, not alarm, for the SLT board.
      const ragColor = (rag: number | null) => rag === 1 ? '#4ca88a' : rag === 2 ? '#c99a3f' : rag === 3 ? '#c2554f' : '#475569';
      const ragBg = (rag: number | null) => rag === 1 ? 'rgba(76,168,138,.10)' : rag === 2 ? 'rgba(201,154,63,.10)' : rag === 3 ? 'rgba(194,85,79,.12)' : 'rgba(255,255,255,.03)';
      const TREND_UP = '#4ca88a', TREND_DOWN = '#c2554f';  // muted green/red for arrows
      type DayVal = { num: number; rag: number | null; display: string } | null;
      const cellHtml = (v: DayVal) => {
        if (!v) return `<div class="cell"><span class="pill" style="color:#475569;border:1px solid rgba(255,255,255,.06)">—</span></div>`;
        const c = ragColor(v.rag), bg = ragBg(v.rag);
        return `<div class="cell"><span class="pill" style="background:${bg};color:${c};border:1px solid ${c}44">${v.display}</span></div>`;
      };
      const trendHtml = (vals: DayVal[], opts?: { neutral?: boolean; higher?: boolean }) => {
        const present = vals.filter((v): v is NonNullable<DayVal> => v !== null);
        if (present.length < 2) return `<span style="color:#475569">▬</span>`;
        const first = present[0].num, last = present[present.length - 1].num;
        if (opts?.neutral || first === last) return `<span style="color:#64748b">${first === last ? '▬' : last > first ? '▲' : '▼'}</span>`;
        if (opts?.higher) return last > first ? `<span style="color:${TREND_UP}">▲</span>` : `<span style="color:${TREND_DOWN}">▼</span>`;
        // default: lower-is-better
        return last < first ? `<span style="color:${TREND_UP}">▼</span>` : `<span style="color:${TREND_DOWN}">▲</span>`;
      };
      type Band = { greenMax: number; amberMax: number };
      // The single source of truth for a metric's RAG on a given day, shared by
      // the daily cells AND the weekly green-day tally so they never diverge:
      //  - count "bad things" (no-reply, over-SLA): value <= greenMax green,
      //    <= amberMax amber, else red. Default band 0/4; per-metric override via opts.band.
      //  - higher-is-better (volume band, CSAT, QA): keep the stored/derived rag.
      //  - oldest: muted (null → neutral grey) so the always-red age rows don't dominate.
      const displayRag = (kind: Kind, c: { num: number; rag: number | null }, band?: Band): number | null => {
        if (kind === 'oldest') return null;
        // Higher-is-better metrics keep their stored/derived RAG.
        if (kind === 'newvol' || kind === 'csat' || kind === 'qa' || kind === 'pct' || kind === 'solved') return c.rag;
        const g = band?.greenMax ?? 0, a = band?.amberMax ?? 4;
        return c.num <= g ? 1 : c.num <= a ? 2 : 3;
      };
      const metricRow = (label: string, get: (dm: Map<string, { count: number; rag: number | null }>) => { num: number; rag: number | null } | null, kind: Kind, opts?: { neutral?: boolean; sub?: boolean; higher?: boolean; band?: Band }): string => {
        const vals: DayVal[] = days.map(d => {
          const c = get(byDay.get(d)!);
          if (!c) return null;
          const display = kind === 'oldest' ? `${c.num}d` : kind === 'pct' ? `${c.num}%` : kind === 'csat' ? `${c.num}/5` : String(c.num);
          return { num: c.num, rag: displayRag(kind, c, opts?.band), display };
        });
        return `<div class="mrow${opts?.sub ? ' sub' : ''}"><div class="mlabel">${label}</div><div class="mcells">${vals.map(cellHtml).join('')}</div><div class="mtrend">${trendHtml(vals, opts)}</div></div>`;
      };
      const dayHeadHtml = days.map(d => {
        const dt = new Date(d + 'T00:00:00Z');
        const wd = dt.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
        return `<div class="cell dh">${wd}<br><span class="dh-n">${dt.getUTCDate()}</span></div>`;
      }).join('');

      const CUSTOMER_CARE = ['CC (Incidents)', 'CC (Service Requests)', 'CC (TPJ)'];
      const TIER2 = ['Tier 2'];
      const DEV = ['Tier 3', 'Development'];
      // The 8 grouped metrics declared once, so the daily (top) and the weekly
      // days-breached (bottom) views render from the same getters.
      type Getter = (dm: Map<string, { count: number; rag: number | null }>) => { num: number; rag: number | null } | null;
      type MetricDef = { label: string; get: Getter; kind: Kind; opts?: { neutral?: boolean; sub?: boolean; higher?: boolean; band?: Band } };
      const LEFT_GROUPS: Array<{ header: string; metrics: MetricDef[]; sep?: boolean }> = [
        { header: 'Intake', metrics: [{ label: 'New ticket volume', get: newvolCell, kind: 'newvol', opts: { neutral: true } }] },
        { header: 'Quality &middot; CSAT + QA', metrics: [
          { label: 'CSAT', get: csatCell, kind: 'csat', opts: { sub: true, higher: true } },
          { label: 'CSAT % scored', get: csatCovCell, kind: 'pct', opts: { sub: true, neutral: true } },
          { label: 'QA score (/10)', get: dm => getNamed(dm, n => n === '__org_qa__'), kind: 'qa', opts: { sub: true, higher: true } },
        ] },
        { header: 'Performance', metrics: [
          { label: 'FRT compliance', get: dm => getNamed(dm, n => n.includes('frt compliance') && n.includes('resolved')), kind: 'pct', opts: { sub: true, higher: true } },
          { label: 'Resolution compliance', get: dm => getNamed(dm, n => n.includes('resolution compliance') && n.includes('resolved')), kind: 'pct', opts: { sub: true, higher: true } },
          { label: 'Solved by NOVA', get: dm => getNamed(dm, n => n === '__solved_nova__'), kind: 'solved', opts: { sub: true, higher: true } },
        ] },
        { header: 'Customer Care', metrics: [
          { label: 'Tickets with no reply', get: dm => groupCell(dm, 'noreply', CUSTOMER_CARE), kind: 'noreply', opts: { sub: true } },
          { label: 'Over SLA (actionable)', get: dm => groupCell(dm, 'oversla', CUSTOMER_CARE), kind: 'oversla', opts: { sub: true } },
          { label: 'Oldest actionable', get: dm => groupCell(dm, 'oldest', CUSTOMER_CARE), kind: 'oldest', opts: { sub: true } },
        ] },
        { header: 'Tier 2', metrics: [
          { label: 'Tickets with no reply', get: dm => groupCell(dm, 'noreply', TIER2), kind: 'noreply', opts: { sub: true } },
          { label: 'Over SLA (actionable)', get: dm => groupCell(dm, 'oversla', TIER2), kind: 'oversla', opts: { sub: true } },
          { label: 'Oldest actionable', get: dm => groupCell(dm, 'oldest', TIER2), kind: 'oldest', opts: { sub: true } },
        ] },
        { header: 'Production', metrics: [{ label: 'Oldest actionable', get: dm => groupCell(dm, 'oldest', ['Production']), kind: 'oldest', opts: { sub: true } }] },
        { header: 'Development &middot; Tier 3 + Dev', sep: true, metrics: [
          // Dev runs a naturally larger no-reply backlog — looser band than Support.
          // Over SLA stays strict (golden rule: over-SLA should always be zero).
          { label: 'Tickets with no reply', get: dm => groupCell(dm, 'noreply', DEV), kind: 'noreply', opts: { sub: true, band: { greenMax: 9, amberMax: 29 } } },
          { label: 'Over SLA (actionable)', get: dm => groupCell(dm, 'oversla', DEV), kind: 'oversla', opts: { sub: true } },
          { label: 'Oldest actionable', get: dm => groupCell(dm, 'oldest', DEV), kind: 'oldest', opts: { sub: true } },
        ] },
      ];
      const dailyHtml = LEFT_GROUPS.map(g => `<div class="grp${g.sep ? ' grp-sep' : ''}"><div class="grp-h">${g.header}</div>${g.metrics.map(m => metricRow(m.label, m.get, m.kind, m.opts)).join('')}</div>`).join('');

      // ── Weekly red-day counts (bottom): per metric, how many business days in
      // each of the last 4 ISO weeks the metric was RED. Week RAG: 5=red/3–4=amber/≤2=green. ──
      const isoWeekKey = (d: Date) => {
        const dd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const day = dd.getUTCDay() || 7;
        dd.setUTCDate(dd.getUTCDate() + 4 - day);                       // nearest Thursday
        const yearStart = new Date(Date.UTC(dd.getUTCFullYear(), 0, 1));
        const wk = Math.ceil((((dd.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return `${dd.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
      };
      const weekDays = new Map<string, string[]>();
      for (const dk of [...byDay.keys()].filter(isWeekday)) {
        const wk = isoWeekKey(new Date(dk + 'T00:00:00Z'));
        if (!weekDays.has(wk)) weekDays.set(wk, []);
        weekDays.get(wk)!.push(dk);
      }
      const weeks = [...weekDays.keys()].sort().slice(-4);
      const weekHeadHtml = weeks.map(wk => {
        const first = weekDays.get(wk)!.slice().sort()[0];
        const mon = new Date(first + 'T00:00:00Z');
        const md = mon.getUTCDay() || 7;
        mon.setUTCDate(mon.getUTCDate() - (md - 1));                    // back to Monday
        const lbl = mon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        return `<div class="cell dh">w/c<br><span class="dh-n">${lbl}</span></div>`;
      }).join('');
      const weekRow = (m: MetricDef): string => {
        // Count RED days per week. Cell RAG: 5 red days = red, 3–4 = amber, ≤2 = green.
        // No-data days excluded. Oldest is muted (grey) on the daily view, but here it
        // counts red days via its value band (5+ days = red) like every other metric.
        const dayRedRag = (c: { num: number; rag: number | null }): number | null =>
          m.kind === 'oldest' ? (c.num === 0 ? 1 : c.num <= 4 ? 2 : 3) : displayRag(m.kind, c, m.opts?.band);
        const series = weeks.map(wk => {
          let red = 0, total = 0;
          for (const dk of weekDays.get(wk)!) {
            const c = m.get(byDay.get(dk)!);
            if (!c) continue;
            total++;
            if (dayRedRag(c) === 3) red++;
          }
          return total === 0 ? null : { red, total };
        });
        const cells = series.map(s => {
          if (!s) return `<div class="cell"><span class="pill" style="color:#475569;border:1px solid rgba(255,255,255,.06)">—</span></div>`;
          const rag = s.red >= 5 ? 3 : s.red >= 3 ? 2 : 1;
          const col = ragColor(rag), bg = ragBg(rag);
          return `<div class="cell"><span class="pill" title="${s.red} of ${s.total} days red" style="background:${bg};color:${col};border:1px solid ${col}44">${s.red}</span></div>`;
        }).join('');
        // Trend on red days (lower = better): fewer red = ▼ green, more = ▲ red.
        const pres = series.filter((s): s is { red: number; total: number } => s !== null);
        let trend = `<span style="color:#475569">▬</span>`;
        if (pres.length >= 2) {
          const first = pres[0].red, lastv = pres[pres.length - 1].red;
          trend = first === lastv ? `<span style="color:#64748b">▬</span>` : lastv < first ? `<span style="color:${TREND_UP}">▼</span>` : `<span style="color:${TREND_DOWN}">▲</span>`;
        }
        return `<div class="mrow${m.opts?.sub ? ' sub' : ''}"><div class="mlabel">${m.label}</div><div class="mcells mcellsw">${cells}</div><div class="mtrend">${trend}</div></div>`;
      };
      const weeklyHtml = LEFT_GROUPS.map(g => `<div class="grp${g.sep ? ' grp-sep' : ''}"><div class="grp-h">${g.header}</div>${g.metrics.map(weekRow).join('')}</div>`).join('');

      // ── Roll-up: 20 granular per-queue metrics ──
      const Q6 = ['CC (Incidents)', 'CC (Service Requests)', 'CC (TPJ)', 'Tier 2', 'Tier 3', 'Development'];
      const Q7 = ['CC (Incidents)', 'CC (Service Requests)', 'CC (TPJ)', 'Production', 'Tier 2', 'Tier 3', 'Development'];
      const shortQ = (q: string) => q.replace('CC (Incidents)', 'CC Incidents').replace('CC (Service Requests)', 'CC Service Req').replace('CC (TPJ)', 'CC TPJ');
      const rollSection = (title: string, kind: Kind, queues: string[]) =>
        `<div class="grp"><div class="grp-h">${title}</div>${queues.map(q => metricRow(shortQ(q), dm => getCell(dm, kind, q), kind, { sub: true })).join('')}</div>`;
      const rollupHtml = [
        `<div class="grp"><div class="grp-h">Intake</div>${metricRow('New ticket volume', newvolCell, 'newvol', { neutral: true, sub: true })}</div>`,
        rollSection('Tickets with no reply', 'noreply', Q6),
        rollSection('Over SLA (actionable)', 'oversla', Q6),
        rollSection('Oldest actionable (days)', 'oldest', Q7),
      ].join('');

      // ── RIGHT TOP: Key Account Risks (AgentBrain issue-card inversion, top 5 tier 2+) ──
      // Source: getAtRiskCustomersFromIssues() inverts AgentBrain's cross-customer issue
      // cards into a per-customer at-risk league table. In-panel = compact top-5; expanded
      // = the WHY (the specific cross-customer issues each account is caught up in).
      let riskSummaryHtml = '', riskDetailHtml = '';
      const badgeStyle = (high: boolean) => `background:${high ? 'rgba(239,68,68,.16)' : 'rgba(245,158,11,.14)'};color:${high ? '#ef4444' : '#f59e0b'};border:1px solid ${high ? '#ef444455' : '#f59e0b55'}`;
      try {
        const atRiskAll = (await getAtRiskCustomersFromIssues()).filter(c => c.tier >= 2).slice(0, 10);
        const atRisk = atRiskAll.slice(0, 5); // compact in-panel summary; expand shows full top-10
        if (!atRiskAll.length) {
          riskSummaryHtml = `<div class="empty">No accounts currently flagged &mdash; waiting on AgentBrain issue feed</div>`;
          riskDetailHtml = riskSummaryHtml;
        } else {
          // Pull the issues affecting these customers for the WHY panel (top-10).
          // Query by raw member names, then re-bucket by canonical KEY so merged
          // accounts (e.g. GPEA = Fine & Country + The Guild) show one combined list.
          const keyToDisplay = new Map(atRiskAll.map(c => [c.key, c.customer]));
          const memberNames = [...new Set(atRiskAll.flatMap(c => c.members).filter(Boolean))];
          const issuesByCust = new Map<string, Array<{ title: string | null; route: string | null; trend: string | null; customer_count: number | null; ticket_count: number }>>();
          if (memberNames.length) {
            const ph = memberNames.map(() => '?').join(',');
            const rows = await query<{ customer: string; signature: string; title: string | null; route: string | null; trend: string | null; customer_count: number | null; ticket_count: number }>(
              `SELECT ic.customer, ic.signature, c.title, c.route, c.trend, c.customer_count, ic.ticket_count
               FROM agent_issue_customers ic JOIN agent_issue_cards c ON c.signature = ic.signature
               WHERE ic.customer IN (${ph}) ORDER BY c.customer_count DESC`, memberNames);
            const seenSig = new Map<string, Set<string>>(); // display → signatures already listed
            for (const r of rows) {
              const canon = canonicalCustomer(r.customer);
              const display = canon && keyToDisplay.get(canon.key);
              if (!display) continue;
              let seen = seenSig.get(display);
              if (!seen) { seen = new Set(); seenSig.set(display, seen); }
              if (seen.has(r.signature)) continue; // dedupe issue across merged variants
              seen.add(r.signature);
              if (!issuesByCust.has(display)) issuesByCust.set(display, []);
              issuesByCust.get(display)!.push(r);
            }
          }
          const meta = (c: typeof atRisk[number]) =>
            `${c.issue_count} issue${c.issue_count === 1 ? '' : 's'} &middot; ${c.ticket_total} ticket${c.ticket_total === 1 ? '' : 's'}${c.growing ? ` &middot; ${c.growing} growing` : ''}`;
          riskSummaryHtml = atRisk.map((c, i) => {
            const high = c.tier >= 3;
            return `<div class="rrow">
              <div class="rname"><span class="rrank">${i + 1}</span>${esc(c.customer || 'Unknown account')}</div>
              <div class="rmeta">${meta(c)}</div>
              <div class="rbadge" style="${badgeStyle(high)}">${high ? 'HIGH' : 'MEDIUM'}</div>
            </div>`;
          }).join('') + (atRiskAll.length > atRisk.length ? `<div class="rmore">+${atRiskAll.length - atRisk.length} more &middot; expand for full top-10 league table</div>` : '');
          riskDetailHtml = atRiskAll.map((c, i) => {
            const high = c.tier >= 3;
            const issues = issuesByCust.get(c.customer) || [];
            const name = c.customer || 'Unknown account';
            // One plain-English paragraph (why ranked + what to do) + a theme
            // breakdown, instead of the raw firehose of fragmented AgentBrain cards.
            const { paragraph, themes } = accountRiskSummary(c, issues, i + 1);
            const themeHtml = themes.length
              ? `<div class="why-th">${themes.slice(0, 5).map(t => `<span class="tchip">${esc(t.name)} &middot; <b>${t.tickets}</b> tix &middot; ${t.cards} pattern${t.cards === 1 ? '' : 's'}</span>`).join('')}</div>`
              : '';
            const jql = encodeURIComponent(`text ~ "${name.replace(/"/g, '')}" ORDER BY updated DESC`);
            return `<div class="why">
              <div class="why-h"><span class="why-name"><span class="rrank">${i + 1}</span>${esc(name)}</span><span class="rbadge" style="${badgeStyle(high)}">${high ? 'HIGH' : 'MEDIUM'}</span><span class="why-meta">${meta(c)} &middot; score ${c.score}</span><a class="why-jira" href="${jiraBase}/issues/?jql=${jql}" target="_blank">Open in Jira ↗</a></div>
              <div class="why-sum">${esc(paragraph)}</div>
              ${themeHtml}
            </div>`;
          }).join('');
        }
      } catch {
        riskSummaryHtml = `<div class="empty">Risk data unavailable</div>`;
        riskDetailHtml = riskSummaryHtml;
      }

      // ── RIGHT BOTTOM: Key Commitments — future due dates that defer past SLA ──
      // Only surface tickets where a CONSCIOUS commitment was made beyond the SLA:
      // the manually-set due date is later than the resolution-SLA target, computed
      // as created + N working days (commitment_sla_working_days, default 10). We do
      // NOT use Jira's customfield_14048 — that's an 8h first-resolution SLA which
      // would flag almost everything. Within-SLA tickets are excluded.
      // In-panel = count dashboard bucketed by time-to-due; expanded = full list.
      let commitSummaryHtml = '', commitDetailHtml = '';
      try {
        const projsRaw = settingsQueries.get('agent_jira_project') || 'NT,NTPJ';
        const projs = projsRaw.split(',').map(p => p.trim()).filter(Boolean).join(', ');
        // Resolution SLA goal in WORKING HOURS — reproduces Jira's "Resolution" goal
        // rule list (first match wins: request type → Current Tier → priority). Used
        // ONLY as a fallback when a ticket has no live SLA cycle. Null = no SLA goal.
        const slaHoursFor = (reqType: string, tier: string, prio: string): number | null => {
          const rt = reqType.replace(/\s*\(NT\)\s*$/, '');
          const p = prio || 'Unset';
          if (rt === 'Delivery QA') return 240;
          if (rt === 'TPJ Request') {
            if (p === 'Normal') return 18; if (p === 'Major') return 8;
            if (p === 'None' || p === 'Minor' || p === 'Unset') return 48; return 6;
          }
          if (tier === 'Production') return 176;
          if (tier === 'Development') return 1640;
          if (rt === 'Incident' || rt === '' || rt === 'Emailed request' || rt === 'AI Request') {
            if (p === 'Major') return 4; if (p === 'Unset' || p === 'Minor' || p === 'Normal') return 8; return 4;
          }
          if (rt === 'Service Request') {
            if (p === 'Normal') return 40; if (p === 'Major') return 21.5;
            if (p === 'None' || p === 'Minor') return 80; return 8;
          }
          return null;
        };
        // SLA target: Jira's LIVE ongoing cycle breachTime (pause-adjusted) when present;
        // otherwise created + the goal-rule hours (no live cycle → no active pauses to miss).
        if (agentJiraClient && projs) {
          const jql = `project = NT AND due is not EMPTY AND due >= now() AND statusCategory != Done ORDER BY due ASC`;
          const r = await agentJiraClient.searchJql(jql, ['summary', 'duedate', 'created', 'issuetype', 'priority', 'assignee', 'customfield_12981', 'customfield_12800', 'customfield_14048'], 100);
          const dayMs = 86400000;
          const dateOnly = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
          type Commit = { key: string; trunc: string; tier: string; assignee: string; dueStr: string; daysRem: number; pastSla: number; over60: boolean };
          const items: Commit[] = [];
          for (const iss of (r.issues || [])) {
            const f = iss.fields as Record<string, any>;
            const due = f.duedate ? new Date(f.duedate + 'T00:00:00Z') : null;
            const created = f.created ? new Date(f.created) : null;
            if (!due || !created) continue;
            const tierName = (f.customfield_12981 && f.customfield_12981.value) || '';
            let slaTarget = getResolutionSlaTarget(iss as unknown as Record<string, unknown>);
            if (!slaTarget) {
              const reqType = (f.customfield_12800 && f.customfield_12800.requestType && f.customfield_12800.requestType.name) || '';
              const h = slaHoursFor(reqType, tierName, (f.priority && f.priority.name) || '');
              if (h != null) slaTarget = addBusinessHours(created, h);
            }
            // Beyond SLA only: due date later than the SLA target. No target → skip.
            if (!slaTarget || dateOnly(due) <= dateOnly(slaTarget)) continue;
            const cycle = Math.round((due.getTime() - created.getTime()) / dayMs);
            const summary = String(f.summary || '');
            items.push({
              key: iss.key,
              trunc: summary.length > 60 ? summary.slice(0, 59) + '…' : summary,
              tier: tierName || (f.issuetype && f.issuetype.name) || '—',
              assignee: (f.assignee && f.assignee.displayName) || 'Unassigned',
              dueStr: due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
              daysRem: Math.ceil((due.getTime() - now.getTime()) / dayMs),
              pastSla: businessDaysBetween(slaTarget, due),
              over60: cycle > 60,
            });
          }
          if (!items.length) {
            commitSummaryHtml = `<div class="empty">No commitments beyond SLA</div>`;
            commitDetailHtml = commitSummaryHtml;
          } else {
            // Dev (incl Tier 3) is the expected long backlog — excluded from the headline
            // counts by default and tucked behind a toggle in the detail.
            const DEV_TIERS = new Set(['Tier 3', 'Development']);
            const mainItems = items.filter(i => !DEV_TIERS.has(i.tier));
            const devItems = items.filter(i => DEV_TIERS.has(i.tier));
            const buckets: Array<{ label: string; cls: string; test: (d: number) => boolean }> = [
              { label: 'Overdue', cls: 'b-red', test: d => d < 0 },
              { label: 'Due ≤7d', cls: 'b-amber', test: d => d >= 0 && d <= 7 },
              { label: '8–30d', cls: 'b-cyan', test: d => d > 7 && d <= 30 },
              { label: '31–60d', cls: 'b-cyan', test: d => d > 30 && d <= 60 },
              { label: '60d+', cls: 'b-amber', test: d => d > 60 },
            ];
            const bucketRow = (label: string, its: Commit[]) => `<div class="bk-row-label">${label} &middot; ${its.length}</div><div class="bk-grid">${buckets.map(b => {
              const n = its.filter(i => b.test(i.daysRem)).length;
              return `<div class="bk ${b.cls}${n === 0 ? ' bk-0' : ''}"><div class="bk-n">${n}</div><div class="bk-l">${b.label}</div></div>`;
            }).join('')}</div>`;
            commitSummaryHtml = bucketRow('Customer Care &middot; Tier 2 &middot; Prod', mainItems) + bucketRow('Tier 3 &middot; Development', devItems);
            const renderRow = (i: Commit) => {
              const rowCls = i.daysRem < 0 ? ' c-red' : i.daysRem <= 7 ? ' c-amber' : '';
              const remLbl = i.daysRem < 0 ? `${-i.daysRem}d overdue` : `${i.daysRem}d`;
              return `<a class="crow${rowCls}" href="${jiraBase}/browse/${esc(i.key)}" target="_blank">
                <div class="ckey">${esc(i.key)}</div>
                <div class="csum">${esc(i.trunc)}<span class="ctier">${esc(i.tier)}</span><span class="casg">${esc(i.assignee)}</span></div>
                <div class="cdue"><span class="cbadge" style="${i.over60 ? 'background:rgba(245,158,11,.14);color:#f59e0b;border:1px solid #f59e0b55' : 'background:rgba(94,193,202,.12);color:#5ec1ca;border:1px solid #5ec1ca44'}">${i.over60 ? '&gt;60d' : 'cycle'}</span><span class="cdate">${i.dueStr}</span><span class="cpast">${i.pastSla}d past SLA</span><span class="crem">${remLbl}</span></div>
              </a>`;
            };
            const tierOrder = ['Customer Care', 'Tier 2', 'Production', 'Tier 3', 'Development'];
            const rank = (t: string) => { const i = tierOrder.indexOf(t); return i < 0 ? 99 : i; };
            const groupByTier = (its: Commit[]) => {
              const byTier = new Map<string, Commit[]>();
              for (const i of its) { const t = i.tier || 'Other'; if (!byTier.has(t)) byTier.set(t, []); byTier.get(t)!.push(i); }
              return [...byTier.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
                .map(t => `<div class="grp"><div class="grp-h">${esc(t)} &middot; ${byTier.get(t)!.length}</div>${byTier.get(t)!.map(renderRow).join('')}</div>`).join('');
            };
            const section = (label: string, its: Commit[]) => `<div class="grp2-h">${label} &middot; ${its.length}</div>${its.length ? groupByTier(its) : '<div class="empty">None beyond SLA</div>'}`;
            commitDetailHtml = section('Customer Care &middot; Tier 2 &middot; Prod', mainItems) + section('Tier 3 &middot; Development', devItems);
          }
        } else {
          commitSummaryHtml = `<div class="empty">Jira not configured</div>`;
          commitDetailHtml = commitSummaryHtml;
        }
      } catch {
        commitSummaryHtml = `<div class="empty">Commitments unavailable</div>`;
        commitDetailHtml = commitSummaryHtml;
      }

      // ── LEFT (toggle): per-agent performance league — Model A (2026-07).
      // Ranked ONLY on census-based, cross-comparable dimensions: SLA compliance,
      // throughput (Solved) and tickets/hr, weighted 50/30/20 (redistributed over
      // present dims). QA and CSAT are shown as GREY CONTEXT with honest sample sizes
      // but NOT scored: QA sampling is not comparable across agents (coverage varies
      // widely, Support/Design reviewed far more than CC; cause being established) and
      // its raw count is ~66% inflated by re-scoring — so QA n here is DISTINCT tickets
      // from jira_qa_results, not QATicketsScored. CSAT coverage is ~0.4% of solved.
      // Fixing QA sampling/attribution = backlog item C. Agents with no activity drop
      // to an "insufficient data" bucket, shown but unranked. Leadership-only board.
      let agentViewHtml = '';
      try {
        const agRows = (await pool.request().query(`
          SELECT a.AccountId AS accountId, d.AgentName AS name, d.TierCode AS tier, a.Team AS team,
                 d.OpenTickets_Total AS openT, d.SolvedTickets_Today AS solved,
                 d.SLACompliancePct AS sla, d.TicketsPerHour AS tph, d.CSATAverage AS csat, d.CSATCount AS csatN
          FROM dbo.jira_agent_kpi_daily d
          JOIN dbo.Agent a ON a.AgentId = d.AgentId
          WHERE d.ReportDate >= DATEADD(day, -7, CAST(GETDATE() AS DATE))
            AND d.ReportDate < CAST(GETDATE() AS DATE)
            AND a.IsActive = 1
            AND a.Team IN ('CustomerCare', 'DigitalDesign', 'Support')
            AND d.AgentName NOT IN ('Nick Ward', 'NOVA AI')
          ORDER BY d.ReportDate
        `)).recordset as Array<{ accountId: string; name: string; tier: string | null; team: string | null; openT: number | null; solved: number | null; sla: number | null; tph: number | null; csat: number | null; csatN: number | null }>;
        // Honest QA context: DISTINCT tickets per assignee (dedupes the ~66% re-score
        // inflation in QATicketsScored) + avg score, from the raw QA table, same window.
        const qaByName = new Map<string, { n: number; avg: number | null }>();
        try {
          const qaRows = (await pool.request().query(`
            SELECT assigneeName AS name, COUNT(DISTINCT issueKey) AS n, AVG(CAST(overallScore AS float)) AS avg
            FROM dbo.jira_qa_results
            WHERE CreatedAt >= DATEADD(day, -7, CAST(GETDATE() AS DATE)) AND CreatedAt < CAST(GETDATE() AS DATE)
              AND ISNULL(qaType, '') <> 'excluded'
            GROUP BY assigneeName
          `)).recordset as Array<{ name: string; n: number; avg: number | null }>;
          for (const r of qaRows) qaByName.set(String(r.name || '').toLowerCase().trim(), { n: Number(r.n) || 0, avg: r.avg == null ? null : Number(r.avg) });
        } catch { /* QA context optional */ }

        const byAgent = new Map<string, typeof agRows>();
        for (const r of agRows) { if (!byAgent.has(r.accountId)) byAgent.set(r.accountId, [] as typeof agRows); byAgent.get(r.accountId)!.push(r); }
        const av = (xs: Array<number | null>): number | null => { const v = xs.filter((x): x is number => x != null).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
        type Ag = { name: string; tier: string; team: string; solved: number; tph: number | null; sla: number | null; qaAvg: number | null; qaN: number; csat: number | null; csatN: number; activity: number; composite: number };
        const raw: Ag[] = [];
        for (const [, days] of byAgent) {
          const last = days[days.length - 1];
          const solved = days.reduce((s, x) => s + (Number(x.solved) || 0), 0);
          const tph = av(days.map(x => x.tph)), sla = av(days.map(x => x.sla)), csat = av(days.map(x => x.csat));
          const csatN = days.reduce((s, x) => s + (Number(x.csatN) || 0), 0);
          const latestOpen = Number(last.openT) || 0;
          const qc = qaByName.get(last.name.toLowerCase().trim());
          raw.push({ name: last.name, tier: last.tier || '', team: last.team || '', solved, tph, sla,
            qaAvg: qc ? qc.avg : null, qaN: qc ? qc.n : 0, csat, csatN, activity: solved + latestOpen, composite: 0 });
        }
        const maxSolved = Math.max(1, ...raw.map(a => a.solved));
        // Model A composite — SLA 50 / Solved 30 / tph 20, redistributed over present dims.
        for (const a of raw) {
          const parts: Array<[number, number]> = [];
          if (a.sla != null) parts.push([50, a.sla]);
          parts.push([30, a.solved / maxSolved * 100]);
          if (a.tph != null) parts.push([20, Math.min(a.tph * 20, 100)]);
          let sv = 0, sw = 0; for (const [w, v] of parts) { sv += w * v; sw += w; }
          a.composite = sw > 0 ? sv / sw : 0;
        }
        const insufficient = raw.filter(a => a.activity === 0);
        const ranked = raw.filter(a => a.activity > 0).sort((a, b) => b.composite - a.composite || b.solved - a.solved);
        const sc = (v: number | null) => v == null ? '#e2e8f0' : v >= 75 ? '#10b981' : v >= 50 ? '#eab308' : '#ef4444';
        const ragSla = (v: number | null) => v == null ? '#e2e8f0' : v >= 95 ? '#10b981' : v >= 90 ? '#eab308' : '#ef4444';
        const ragTph = (v: number | null) => v == null ? '#e2e8f0' : v >= 1.5 ? '#10b981' : v >= 1.0 ? '#eab308' : '#ef4444';
        const n1 = (v: number | null, dp = 0) => v == null ? '—' : Number(v).toFixed(dp);
        if (!ranked.length && !insufficient.length) {
          agentViewHtml = `<div class="empty">No agent KPI data for this week yet</div>`;
        } else {
          const rowsHtml = ranked.map((a, i) => `<tr class="arow">
            <td class="a-rank">${i + 1}</td>
            <td class="a-name">${esc(a.name)}<span class="a-sub">${esc(a.tier)}${a.team ? ' · ' + esc(a.team) : ''}</span></td>
            <td class="a-c" style="color:${sc(a.composite)};font-weight:700">${Math.round(a.composite)}</td>
            <td class="a-c">${n1(a.solved)}</td>
            <td class="a-c" style="color:${ragTph(a.tph)}">${n1(a.tph, 1)}</td>
            <td class="a-c" style="color:${ragSla(a.sla)}">${a.sla == null ? '—' : Math.round(a.sla) + '%'}</td>
            <td class="a-ctx">${a.qaAvg == null ? '—' : n1(a.qaAvg, 1)}<span class="a-n">n=${a.qaN}</span></td>
            <td class="a-ctx">${a.csat == null ? '—' : n1(a.csat, 1)}<span class="a-n">n=${a.csatN}</span></td>
          </tr>`).join('');
          const insufHtml = insufficient.length
            ? `<div class="a-insuf-h">Insufficient data &middot; not ranked</div>` +
              insufficient.map(a => `<div class="a-insuf">${esc(a.name)}<span class="a-sub">${esc(a.team)}</span></div>`).join('')
            : '';
          agentViewHtml = `<div class="kblock-h">Agent performance &middot; last 5 business days &middot; ranked SLA 50 / Solved 30 / Tkts-hr 20</div>
            <div class="atbl-wrap"><table class="atbl">
              <thead><tr><th>#</th><th class="a-name">Agent</th><th>Score</th><th>Solved</th><th>Tkts/hr</th><th>SLA%</th><th class="a-ctx-h">QA</th><th class="a-ctx-h">CSAT</th></tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div class="a-note">QA &amp; CSAT are context only — not part of the rank. QA sampling is not comparable across agents (coverage varies widely; cause being established); CSAT coverage is ~0.4% of solved this week. n = tickets sampled.</div>
            ${insufHtml}</div>`;
        }
      } catch {
        agentViewHtml = `<div class="empty">Agent performance unavailable</div>`;
      }

      const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NOVA — Strategic Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}html,body{height:100%}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a1f26;color:#e2e8f0;overflow:hidden}
/* subtle thin scrollbars (wallboard is a standalone page) */
*{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}
::-webkit-scrollbar{width:7px;height:7px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.26);background-clip:padding-box}
::-webkit-scrollbar-corner{background:transparent}
.page{height:100vh;display:flex;flex-direction:column;padding:1.8vh 1.8vw;gap:1.2vh}
.head{display:flex;justify-content:space-between;align-items:flex-end;flex:0 0 auto}
.head h1{font-size:2.4vh;font-weight:800;letter-spacing:-.5px}
.head .sub{font-size:1.2vh;color:#64748b;margin-top:2px}
.head .meta{font-size:1.2vh;color:#64748b;text-align:right}
.cols{display:grid;grid-template-columns:60% 40%;gap:1.2vw;flex:1 1 auto;min-height:0}
.panel{background:rgba(255,255,255,.025);border:1px solid #2f353d;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;min-height:0}
.panel-h{font-size:1.3vh;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#94a3b8;padding:1vh 1.1vw;border-bottom:1px solid #2f353d;flex:0 0 auto}
.panel-body{flex:1 1 auto;min-height:0;overflow:auto;padding:.6vh .8vw}
.right{display:grid;grid-template-rows:2fr 1fr;gap:1.2vh;min-height:0}
/* metric rows */
.grp{margin-bottom:.8vh}
.grp-sep{border-top:1px dotted rgba(255,255,255,.22);margin-top:.3vh;padding-top:.2vh}
.grp-h{font-size:1.15vh;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5ec1ca;padding:.5vh .3vw .3vh;opacity:.85}
.mrow{display:grid;grid-template-columns:minmax(0,1fr) 46% 3vw;align-items:center;gap:.6vw;padding:.35vh .3vw}
.mrow.sub .mlabel{color:#cbd5e1;font-size:1.5vh}
.mlabel{font-size:1.6vh;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mcells{display:grid;grid-template-columns:repeat(5,1fr);gap:.4vw}
.cell{display:flex;justify-content:center}
.pill{display:inline-block;min-width:2.6vw;text-align:center;padding:.35vh .4vw;border-radius:7px;font-size:1.5vh;font-weight:700}
.cell.dh{flex-direction:column;color:#64748b;font-size:1vh;font-weight:700;text-transform:uppercase;letter-spacing:.4px;line-height:1.25}
.dh-n{color:#94a3b8;font-size:1.2vh}
.mtrend{text-align:center;font-size:1.8vh}
.mhead{padding-bottom:.4vh;border-bottom:1px solid #2f353d;margin-bottom:.4vh}
/* risk rows */
.rrow{display:grid;grid-template-columns:1fr auto;grid-template-areas:"name badge" "meta badge";align-items:center;gap:.2vh .6vw;text-decoration:none;color:inherit;padding:.9vh .7vw;border-radius:10px;margin-bottom:.5vh;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05)}
.rrow:hover{border-color:rgba(94,193,202,.4);background:rgba(94,193,202,.06)}
.rname{grid-area:name;font-size:1.7vh;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rmeta{grid-area:meta;font-size:1.25vh;color:#94a3b8}
.rbadge{grid-area:badge;font-size:1.25vh;font-weight:800;letter-spacing:.5px;padding:.5vh .8vw;border-radius:7px}
/* commitment rows */
.crow{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:.7vw;text-decoration:none;color:inherit;padding:.75vh .7vw;border-radius:9px;margin-bottom:.4vh;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05)}
.crow:hover{border-color:rgba(94,193,202,.4);background:rgba(94,193,202,.06)}
.crow.c-amber{border-color:#f59e0b55;background:rgba(245,158,11,.06)}
.crow.c-red{border-color:#ef444466;background:rgba(239,68,68,.08)}
.ckey{font-size:1.35vh;font-weight:700;color:#5ec1ca;font-variant-numeric:tabular-nums}
.csum{font-size:1.5vh;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctier{display:inline-block;margin-left:.5vw;font-size:1.15vh;color:#64748b;text-transform:uppercase;letter-spacing:.4px}
.casg{display:inline-block;margin-left:.5vw;font-size:1.15vh;color:#5ec1ca;opacity:.8}
.cdue{display:flex;align-items:center;gap:.5vw;white-space:nowrap}
.cbadge{font-size:1.1vh;font-weight:700;padding:.3vh .5vw;border-radius:5px}
.cdate{font-size:1.4vh;color:#cbd5e1;font-weight:600}
.crem{font-size:1.2vh;color:#94a3b8;min-width:4vw;text-align:right}
.empty{padding:2vh 1vw;text-align:center;color:#64748b;font-size:1.5vh}
.foot{flex:0 0 auto;text-align:center;font-size:1.1vh;color:#475569;padding-top:.3vh}
/* expandable panels */
.exp{cursor:pointer;transition:border-color .15s,box-shadow .15s}
.exp:hover,.exp:focus-visible{border-color:rgba(94,193,202,.45);box-shadow:0 6px 24px rgba(0,0,0,.3);outline:none}
.exp .panel-h{display:flex;justify-content:space-between;align-items:center}
.exp-hint{font-size:1.05vh;color:#5ec1ca;font-weight:700;letter-spacing:.4px;opacity:.8}
.wk-toggle{cursor:pointer;font:700 1.05vh system-ui,-apple-system,sans-serif;letter-spacing:.3px;color:#94a3b8;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:.4vh .9vw}
.wk-toggle:hover{color:#5ec1ca;border-color:rgba(94,193,202,.45)}
.detail-src{display:none}
/* commitment bucket dashboard */
.bk-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:.6vh .6vw;padding:.4vh .2vw}
.bk{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:.9vh .4vw;text-align:center}
.bk-n{font-size:3vh;font-weight:800;letter-spacing:-1.5px;line-height:1}
.bk-l{font-size:1vh;color:#94a3b8;margin-top:.4vh;text-transform:uppercase;letter-spacing:.3px}
.bk.b-red .bk-n{color:#ef4444}.bk.b-amber .bk-n{color:#f59e0b}.bk.b-cyan .bk-n{color:#5ec1ca}
.bk.bk-0 .bk-n{color:#475569}.bk.bk-0{opacity:.6}
.bk-total{text-align:center;font-size:1.3vh;color:#64748b;margin-top:.7vh;font-weight:600}
.bk-row-label{font-size:1.15vh;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#5ec1ca;opacity:.85;padding:.7vh .3vw .1vh}
.grp2-h{font-size:1.4vh;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#5ec1ca;padding:1vh .3vw .4vh;border-bottom:1px solid rgba(94,193,202,.25);margin:.9vh 0 .5vh}
.cpast{font-size:1.1vh;color:#94a3b8;min-width:5.5vw;text-align:right}
/* risk "why" detail */
.why{border:1px solid #2f353d;border-radius:12px;background:rgba(255,255,255,.02);padding:1.4vh 1.4vw;margin-bottom:1.2vh}
.why-h{display:flex;align-items:center;gap:1vw;flex-wrap:wrap}
.why-name{font-size:2.1vh;font-weight:800}
.why-meta{font-size:1.4vh;color:#94a3b8}
.why-jira{margin-left:auto;font-size:1.3vh;color:#5ec1ca;text-decoration:none;font-weight:600}
.why-jira:hover{text-decoration:underline}
.why-flags{margin:1vh 0 .4vh;display:flex;gap:.5vw;flex-wrap:wrap}
.chip{font-size:1.2vh;font-weight:700;color:#fca5a5;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:.4vh .7vw;text-transform:uppercase;letter-spacing:.4px}
.why-sigs{margin-top:.8vh;display:flex;flex-direction:column;gap:.6vh}
.sig{display:flex;align-items:baseline;gap:.7vw;flex-wrap:wrap;text-decoration:none;color:inherit;padding:.7vh .9vw;border-radius:8px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05)}
.sig:hover{border-color:rgba(94,193,202,.4);background:rgba(94,193,202,.06)}
.sig-t{font-size:1.5vh;font-weight:700;color:#fde68a}
.sig-k{font-size:1.3vh;font-weight:700;color:#5ec1ca;font-variant-numeric:tabular-nums}
.sig-e{font-size:1.4vh;color:#cbd5e1;font-style:italic}
.muted{font-size:1.4vh;color:#64748b;padding:.4vh 0}
.why-sum{margin-top:.9vh;font-size:1.6vh;line-height:1.55;color:#e2e8f0}
.why-th{margin-top:.9vh;display:flex;gap:.5vw;flex-wrap:wrap}
.tchip{font-size:1.3vh;font-weight:600;color:#cbd5e1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:.45vh .9vw;font-variant-numeric:tabular-nums}
.tchip b{color:#fde68a;font-weight:800}
/* fullscreen overlay */
.kpi-detail-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:0 3vw}
.ov{position:fixed;inset:0;z-index:1000;display:none}
.ov.show{display:block}
.ov-back{position:absolute;inset:0;background:rgba(8,11,15,0);backdrop-filter:blur(0);transition:background .42s ease,backdrop-filter .42s ease}
.ov.open .ov-back{background:rgba(8,11,15,.82);backdrop-filter:blur(6px)}
.ov-card{position:fixed;overflow:hidden;display:flex;flex-direction:column;background:#1a1f26;border:1px solid #2f353d;
  box-shadow:0 0 0 1px rgba(94,193,202,.5),0 30px 90px rgba(0,0,0,.6);
  transition:left .44s cubic-bezier(.16,1,.3,1),top .44s cubic-bezier(.16,1,.3,1),width .44s cubic-bezier(.16,1,.3,1),height .44s cubic-bezier(.16,1,.3,1),border-radius .44s ease}
.ov-bar{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;padding:1.6vh 2vw;border-bottom:1px solid #2f353d}
.ovt{font-size:2.1vh;font-weight:800;letter-spacing:-.3px}
.ov-min{cursor:pointer;display:flex;align-items:center;gap:.5vw;font:700 1.4vh system-ui,-apple-system,sans-serif;color:#e2e8f0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:.9vh 1.5vw}
.ov-min:hover{background:rgba(94,193,202,.18);border-color:rgba(94,193,202,.5)}
.ov-body{flex:1 1 auto;overflow:auto;padding:1.8vh 2vw;opacity:0;transition:opacity .3s ease .16s}
.ov.open .ov-body{opacity:1}
.ov.closing .ov-body{opacity:0;transition:opacity .12s}
@media(prefers-reduced-motion:reduce){.ov-card,.ov-back,.ov-body,.exp{transition-duration:.01s}}
/* Strategic KPIs panel — split top (daily) / bottom (weekly breach counts) */
.left .panel-body{display:flex;flex-direction:column;gap:.4vh;overflow:hidden;padding:.5vh 1.2vw}
.kblock{flex:1;min-height:0;display:flex;flex-direction:column}
.kblock-h{font-size:1.05vh;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#5ec1ca;opacity:.9;padding:.15vh .3vw .25vh;border-bottom:1px solid #2f353d;margin-bottom:.15vh}
.kgrid{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:space-between;overflow:auto}
.mcells.mcellsw{grid-template-columns:repeat(4,1fr)}
.left .mhead{margin-bottom:.1vh}
.left .grp{margin-bottom:0}
.left .grp-h{font-size:1.05vh;padding:.15vh .3vw .1vh}
.left .mrow{padding:.18vh .3vw}
.left .mlabel{font-size:1.4vh}
.left .mrow.sub .mlabel{font-size:1.3vh}
.left .pill{font-size:1.4vh;min-width:2.5vw;padding:.22vh .4vw;border-radius:6px}
.left .mtrend{font-size:1.55vh}
.left .cell.dh{font-size:.95vh}
.left .dh-n{font-size:1.15vh}
/* Risk panel now 2/3 height — give rows room to fill it */
.right .rrow{padding:1.3vh .8vw;margin-bottom:.6vh}
.right .rrow .rname{font-size:1.95vh}
.right .rrow .rmeta{font-size:1.4vh}
.rrank{display:inline-flex;align-items:center;justify-content:center;min-width:1.9vh;height:1.9vh;margin-right:.5vw;padding:0 .4vh;border-radius:.5vh;background:rgba(148,163,184,.16);color:#94a3b8;font-size:1.3vh;font-weight:700;vertical-align:middle}
.rmore{padding:.9vh .8vw;color:#94a3b8;font-size:1.35vh;font-style:italic;text-align:center}
.atbl-wrap{overflow-y:auto;max-height:78vh}
.atbl{width:100%;border-collapse:collapse;font-size:1.5vh}
.atbl thead th{position:sticky;top:0;background:#212832;color:#94a3b8;font-weight:600;font-size:1.35vh;text-align:center;padding:1vh .4vw;border-bottom:1px solid rgba(255,255,255,.1)}
.atbl thead th.a-name{text-align:left}
.atbl td{padding:1.05vh .4vw;text-align:center;border-top:1px solid rgba(255,255,255,.05)}
.atbl .a-rank{color:#64748b;font-size:1.35vh}
.atbl .a-name{text-align:left;font-size:1.6vh}
.atbl .a-name .a-sub{display:block;color:#64748b;font-size:1.15vh;margin-top:.15vh}
.atbl .arow:nth-child(even){background:rgba(255,255,255,.02)}
.atbl th.a-ctx-h{color:#64748b;border-left:1px solid rgba(255,255,255,.07)}
.atbl .a-ctx{padding:1.05vh .4vw;text-align:center;color:#64748b;font-size:1.35vh;border-left:1px solid rgba(255,255,255,.05)}
.atbl .a-ctx .a-n{display:block;color:#475569;font-size:1.05vh;margin-top:.1vh}
.a-note{padding:1vh .6vw;color:#64748b;font-size:1.2vh;font-style:italic;line-height:1.45}
.a-insuf-h{padding:1vh .6vw .3vh;color:#94a3b8;font-size:1.3vh;font-weight:600;border-top:1px solid rgba(255,255,255,.06);margin-top:.4vh}
.a-insuf{padding:.5vh .6vw;color:#64748b;font-size:1.45vh}
.a-insuf .a-sub{color:#475569;font-size:1.15vh;margin-left:.5vw}
</style>
</head><body><div class="page">
<div class="head">
  <div><h1>Strategic Dashboard</h1><div class="sub">End-of-day outcomes &middot; last 5 business days &middot; not intraday</div></div>
  <div class="meta">Last updated ${timeStr}<br>${dateStr}</div>
</div>
<div class="cols">
  <div class="panel left exp" data-expand="src-kpi" data-title="Strategic KPIs — full granular breakdown" tabindex="0" role="button">
    <div class="panel-h"><span id="left-title">Strategic KPIs</span>
      <span style="display:flex;align-items:center;gap:1vw">
        <button class="wk-toggle" id="view-toggle" type="button" onclick="event.stopPropagation();window.__toggleView&&window.__toggleView(this)">Show agents</button>
        <button class="wk-toggle" id="wk-toggle" type="button" onclick="event.stopPropagation();window.__toggleWk&&window.__toggleWk(this)">Show daily view</button>
        <span class="exp-hint">Expand ⤢</span>
      </span>
    </div>
    <div class="panel-body">
      <div id="team-view">
        <div class="kblock" id="day-block" style="display:none">
          <div class="kblock-h">This week &middot; day by day</div>
          <div class="kgrid">
            <div class="mrow mhead"><div class="mlabel"></div><div class="mcells">${dayHeadHtml}</div><div></div></div>
            ${dailyHtml}
          </div>
        </div>
        <div class="kblock" id="wk-block" style="display:flex">
          <div class="kblock-h">Red days per week &middot; last 4 weeks</div>
          <div class="kgrid">
            <div class="mrow mhead"><div class="mlabel"></div><div class="mcells mcellsw">${weekHeadHtml}</div><div></div></div>
            ${weeklyHtml}
          </div>
        </div>
      </div>
      <div id="agent-view" style="display:none">${agentViewHtml}</div>
    </div>
  </div>
  <div class="right">
    <div class="panel exp" data-expand="src-risk" data-title="Top 10 accounts with issues — why each is flagged" tabindex="0" role="button">
      <div class="panel-h"><span>Top Accounts with Issues</span><span class="exp-hint">Expand ⤢</span></div>
      <div class="panel-body">${riskSummaryHtml}</div>
    </div>
    <div class="panel exp" data-expand="src-commit" data-title="Key Commitments — tickets due beyond SLA" tabindex="0" role="button">
      <div class="panel-h"><span>Key Commitments &middot; Due Dates</span><span class="exp-hint">Expand ⤢</span></div>
      <div class="panel-body">${commitSummaryHtml}</div>
    </div>
  </div>
</div>
<div class="foot">nurtur.tech &middot; NOVA Strategic Dashboard &middot; auto-refresh 5 min &middot; click any panel to expand &middot; SLA figures are end-of-day snapshots, not retroactively recomputed</div>

<!-- hidden detail bodies, injected into the overlay on expand -->
<div class="detail-src" id="src-kpi">
  <div class="mrow mhead"><div class="mlabel"></div><div class="mcells">${dayHeadHtml}</div><div></div></div>
  <div class="kpi-detail-grid">${rollupHtml}</div>
</div>
<div class="detail-src" id="src-commit">${commitDetailHtml}</div>
<div class="detail-src" id="src-risk">${riskDetailHtml}</div>

<div class="ov" id="ov">
  <div class="ov-back"></div>
  <div class="ov-card" id="ovcard">
    <div class="ov-bar"><span class="ovt" id="ovt"></span><button class="ov-min" id="ovmin" type="button"><span style="font-size:1.7vh;line-height:1">⤡</span> Minimise</button></div>
    <div class="ov-body" id="ovbody"></div>
  </div>
</div>
<script>
(function(){
  function byId(i){return document.getElementById(i);}
  // Toggle between the daily view and the 4-week view (mutually exclusive).
  window.__toggleWk=function(btn){
    var wk=byId('wk-block'),day=byId('day-block'); if(!wk||!day)return;
    var showWeekly=wk.style.display==='none';
    wk.style.display=showWeekly?'flex':'none';
    day.style.display=showWeekly?'none':'flex';
    btn.textContent=showWeekly?'Show daily view':'Show 4-week view';
  };
  // Toggle the left panel between team KPIs and the per-agent league.
  window.__toggleView=function(btn){
    var team=byId('team-view'),agent=byId('agent-view'),wkBtn=byId('wk-toggle'),title=byId('left-title');
    if(!team||!agent)return;
    var showAgent=agent.style.display==='none';
    agent.style.display=showAgent?'block':'none';
    team.style.display=showAgent?'none':'block';
    if(wkBtn)wkBtn.style.display=showAgent?'none':'';
    if(title)title.textContent=showAgent?'Agent Performance':'Strategic KPIs';
    btn.textContent=showAgent?'Show team':'Show agents';
  };
  var ov=byId('ov'),card=byId('ovcard'),body=byId('ovbody'),title=byId('ovt'),min=byId('ovmin'),last=null,busy=false;
  function expand(src){
    if(busy||ov.classList.contains('show'))return; busy=true;
    var detail=document.getElementById(src.getAttribute('data-expand'));
    body.innerHTML=detail?detail.innerHTML:'';
    title.textContent=src.getAttribute('data-title')||'';
    var r=src.getBoundingClientRect(); last=r;
    card.style.transition='none';
    card.style.left=r.left+'px'; card.style.top=r.top+'px';
    card.style.width=r.width+'px'; card.style.height=r.height+'px'; card.style.borderRadius='14px';
    ov.classList.add('show'); void card.offsetWidth; card.style.transition='';
    requestAnimationFrame(function(){
      ov.classList.add('open');
      card.style.left='2vw'; card.style.top='2vh'; card.style.width='96vw'; card.style.height='96vh'; card.style.borderRadius='16px';
    });
    setTimeout(function(){busy=false;},460);
  }
  function minimise(){
    if(busy||!ov.classList.contains('open')||!last)return; busy=true;
    var r=last; ov.classList.add('closing'); ov.classList.remove('open');
    card.style.left=r.left+'px'; card.style.top=r.top+'px';
    card.style.width=r.width+'px'; card.style.height=r.height+'px'; card.style.borderRadius='14px';
    setTimeout(function(){ ov.classList.remove('show'); ov.classList.remove('closing'); body.innerHTML=''; busy=false; },460);
  }
  var els=document.querySelectorAll('[data-expand]');
  for(var i=0;i<els.length;i++){
    (function(el){
      el.addEventListener('click',function(){expand(el);});
      el.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();expand(el);} });
    })(els[i]);
  }
  min.addEventListener('click',minimise);
  ov.querySelector('.ov-back').addEventListener('click',minimise);
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')minimise(); });
  // 5-min auto-refresh, but never while a panel is expanded
  setInterval(function(){ if(!ov.classList.contains('show'))location.reload(); },300000);
})();
</script>
</div></body></html>`);
      logWallboard(route, 'info', 200, Date.now() - wbStart, `OK — ${days.length} days, ${snapRows.length} kpi rows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logWallboard(route, 'error', 500, Date.now() - wbStart, msg, { error: msg, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).send(`<html><body style="background:#1a1f26;color:#ef4444;padding:40px;font-family:system-ui">Error: ${msg}</body></html>`);
    }
  });

  // ── P6: Customer Portal routes (always wired, gated by portal_enabled setting) ──
  const portalGate: import('express').RequestHandler = (_req, res, next) => {
    if (settingsQueries.get('portal_enabled') === 'true') return next();
    res.status(503).json({ ok: false, error: 'Customer portal is disabled' });
  };

  const portalJiraClient = buildOnboardingJiraClient();
  const portalJira = new PortalJiraService(settingsQueries, portalJiraClient);

  // Onboarding escalation engine — scans each org's enabled policy and sends
  // scheduled progress updates + escalations. Per-org policy is off by default,
  // so nothing sends until an org admin enables it. Runs in-hours; deduped.
  const portalEmailService = new EmailService(() => settingsQueries.getAll());
  const escalationService = new OnboardingEscalationService(
    settingsQueries,
    portalJiraClient,
    portalEmailService,
  );
  setTimeout(() => { escalationService.runScan().catch(err => console.error('[escalation] initial scan failed:', err)); }, 150_000);
  setInterval(() => { escalationService.runScan().catch(err => console.error('[escalation] scan failed:', err)); }, 3 * 60 * 60 * 1000);
  // Guild/BYM onboarding pipeline (backlog #8) — needs a Jira client; when absent
  // PortalIntakeService falls back to the legacy setup+QA path for all onboardings.
  const onboardingRecordQueries = new OnboardingRecordQueries();
  const guildOnboarding = portalJiraClient
    ? new GuildOnboardingService(portalJiraClient, onboardingRecordQueries, (k) => settingsQueries.get(k))
    : null;
  const portalIntake = new PortalIntakeService(settingsQueries, portalJira, onboardingRecordQueries, guildOnboarding, portalEmailService);
  // Guild onboarding dashboard + manual capture (backlog #8, R5/R6) — internal staff.
  const guildDashboard = new GuildDashboardService(portalJiraClient, onboardingRecordQueries);
  app.use('/api/guild-onboarding', createGuildOnboardingRoutes({ dashboard: guildDashboard, records: onboardingRecordQueries, guild: guildOnboarding }));

  // Guild digest (R8, Monday ~14:00 UTC) + INTS escalation sweep (R4, hourly).
  // Both off by default (guild_digest_enabled / guild_ints_escalations_enabled).
  const guildDigest = new GuildDigestService(guildDashboard, portalEmailService, (k) => settingsQueries.get(k));
  jobRegistry.register('guild-weekly-digest', 'Guild onboarding weekly digest (Mon 14:00)', async () => {
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 14 && now.getUTCMinutes() < 15) {
      await guildDigest.sendWeeklyDigest();
    }
  }, 15 * 60 * 1000);
  jobRegistry.register('guild-ints-escalations', 'Guild INTS escalation sweep', async () => {
    await guildDigest.runIntsEscalations();
  }, 60 * 60 * 1000);
  const portalChat = new PortalChatService(settingsQueries, typeof llmService !== 'undefined' ? llmService : null, portalJira);
  const portalKb = new PortalKbService(settingsQueries, mcpManager);

  portalChat.setIntakeService(portalIntake);

  // Gap 5: Playbook service
  const { PortalPlaybookService } = await import('./services/portal-playbooks.js');
  portalChat.setPlaybookService(new PortalPlaybookService(settingsQueries));

  // Start KB sync timer (checks portal_enabled internally)
  portalKb.startSync();

  // Portal admin (requires internal NOVA auth + admin role — no portalGate so admins can configure before enabling)
  app.use('/api/portal/admin', requireRole('admin', 'super_admin'), createPortalAdminRoutes(settingsQueries, typeof llmService !== 'undefined' ? llmService : null));

  // Auth routes (no portal auth middleware — these handle login/callback)
  app.use('/api/portal/auth', portalGate, createPortalAuthRoutes(settingsQueries));

  // KB routes (public — no auth required for read)
  app.use('/api/portal/kb', portalGate, createPortalKbRoutes(portalKb));

  // CSAT survey routes (public, no auth). MUST be mounted before the authenticated
  // `/api/portal` mounts below — otherwise portalAuth intercepts `/api/portal/csat/*`
  // and 401s ("Missing portal authentication token") before this route is reached.
  app.use('/api/portal/csat', portalGate, createPortalCsatRoutes({
    settings: settingsQueries,
    getJiraClient: buildServiceDeskJiraClient,
  }));

  // Authenticated portal routes. portalReadOnly must sit after portalAuth (it reads
  // req.portalUser.viewAs) and before every route that can mutate.
  const portalAuth = portalAuthMiddleware(settingsQueries, getRoles);
  const portalReadOnly = portalViewAsReadOnly();
  app.use('/api/portal', portalGate, portalAuth, portalReadOnly, createPortalTicketRoutes(portalJira, portalIntake, settingsQueries, typeof llmService !== 'undefined' ? llmService : null));
  app.use('/api/portal', portalGate, portalAuth, portalReadOnly, createPortalChatRoutes(portalChat, portalJira));
  app.use('/api/portal', portalGate, portalAuth, portalReadOnly, createPortalEventsRoutes());
  app.use('/api/portal', portalGate, portalAuth, portalReadOnly, createPortalDashboardRoutes(settingsQueries, portalJiraClient, guildDashboard));
  app.use('/api/portal', portalGate, portalAuth, portalReadOnly, createPortalEscalationRoutes(escalationService));
  app.use('/api/portal', portalGate, portalAuth, portalReadOnly, createPortalOrgUserRoutes());

  // Widget routes (public, CORS-gated, own auth via email identification)
  app.use('/api/portal/widget', portalGate, createWidgetChatRoutes(portalChat, settingsQueries));

  console.log(`[N.O.V.A] Portal routes wired (currently ${settingsQueries.get('portal_enabled') === 'true' ? 'enabled' : 'disabled'} — toggle via Admin > Feature Flags)`);

  // Serve portal SPA (always serve even if portal disabled — shows login page)
  app.get('/portal', (_req, res) => {
    if (isProduction) {
      res.sendFile(path.resolve(__dirname, '../../client/portal.html'));
    } else {
      res.redirect('http://localhost:5173/portal.html');
    }
  });
  app.get('/portal/{*path}', (_req, res) => {
    if (isProduction) {
      res.sendFile(path.resolve(__dirname, '../../client/portal.html'));
    } else {
      res.redirect('http://localhost:5173/portal.html');
    }
  });

  // Serve widget bundle
  if (isProduction) {
    app.use('/widget', express.static(path.resolve(__dirname, '../../client/portal-widget')));
  }

  // Production: serve built Vite frontend
  if (isProduction) {
    const clientDist = path.resolve(__dirname, '../../client');
    app.use(express.static(clientDist));
    app.get('{*path}', (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  // Global safety nets — unhandled async errors and uncaught exceptions land in
  // the central error log as critical instead of vanishing to stderr.
  process.on('unhandledRejection', (reason) => {
    captureError('process.unhandledRejection', reason, { severity: 'critical' });
  });
  process.on('uncaughtException', (err) => {
    captureError('process.uncaughtException', err, { severity: 'critical' });
    // Preserve crash-restart behaviour (the service manager restarts us); brief
    // delay lets the log write flush first.
    setTimeout(() => process.exit(1), 750);
  });

  // Express error-handling middleware — catches errors thrown in any route so
  // API 500s land in the central error log instead of vanishing.
  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    captureError('api', err, { context: { path: req.path, method: req.method } });
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // 5. Start server
  app.listen(PORT, () => {
    console.log(`[N.O.V.A] API server running on http://localhost:${PORT}`);
    if (!isProduction) {
      console.log(`[N.O.V.A] Frontend dev server: http://localhost:5173`);
    }
  });

  // One-time KPI data migrations (each guarded by a settings flag → runs once).
  // Fire-and-forget so a slow/failed Azure SQL call never blocks boot.
  void runKpiMigrations(settingsQueries);

  // Org-KPI startup tasks: one-time history backfill + a fresh capture of today,
  // so the Legacy KPIs view populates after a deploy without manual POSTs.
  if (agentJiraClient) void runKpiOrgStartupTasks(settingsQueries, agentJiraClient);

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
        jiraClient: new JiraRestClient({ baseUrl: s.jira_url, email: s.jira_username, apiToken: s.jira_token }, { bcResolver: bcAccountResolver }),
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
  jobRegistry.register('milestone-eval', 'Milestone evaluation', async () => {
    const result = await workflowEngine.evaluateAll();
    if (result.tasksCreated > 0 || result.ticketsCreated > 0) {
      console.log(`[Workflow] Scheduled: ${result.tasksCreated} tasks, ${result.ticketsCreated} tickets created`);
    }
  }, 15 * 60 * 1000);

  // Problem Ticket Scanner: configurable interval (default 15 min), 0 disables
  const ptScanMinutes = Number(settingsQueries.get('problem_scanner_interval_minutes')) || 15;
  // Problem scan registered via jobRegistry below
  if (ptScanMinutes > 0) {
    const ptScanMs = ptScanMinutes * 60 * 1000;
    console.log(`[ProblemTicketScanner] Scheduled every ${ptScanMinutes} minutes`);
    jobRegistry.register('problem-scan', 'Problem ticket scan', async () => {
      problemTicketScanner.setJiraClient(buildOnboardingJiraClient());
      await problemTicketScanner.scan();
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

  // Post-sign capture handler — runs once per agreement when status flips to SIGNED.
  // Signer can't modify the contract under current Adobe template policy, so
  // NOVA's send-time agreement_field_values capture is authoritative — no need
  // to refetch values from Adobe. We just archive the signed PDF locally and
  // hand off to the BC subscription import writer (next phase).
  // Failures in PDF save are non-fatal; we still markSigned so we don't loop.
  const signedContractsDir = path.join(process.cwd(), 'data', 'signed-contracts');
  async function handleSignedAgreement(agreementId: string) {
    console.log(`[Adobe Sign] Capturing post-sign data for ${agreementId}`);
    let pdfRelPath: string | null = null;

    try {
      const pdf = await adobeSignClient!.downloadSignedDocument(agreementId);
      await fs.promises.mkdir(signedContractsDir, { recursive: true });
      // Sanitise the agreement ID for filesystem safety even though Adobe IDs
      // are alphanumeric — defensive against future ID format changes.
      const safeName = agreementId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf';
      pdfRelPath = path.posix.join('signed-contracts', safeName);
      await fs.promises.writeFile(path.join(signedContractsDir, safeName), pdf);
    } catch (err) {
      console.warn(`[Adobe Sign] PDF download/save failed for ${agreementId}:`, err instanceof Error ? err.message : err);
    }

    await adobeSignAgreementQueries.markSigned(agreementId, {
      signedFormData: null,    // sender values live in agreement_field_values; never reach Adobe-side
      signedPdfPath: pdfRelPath,
      signedAt: new Date().toISOString(),
    });
    console.log(`[Adobe Sign] Post-sign captured ${agreementId} — pdf:${pdfRelPath ?? 'fail'}`);
    // TODO: hand off to BC subscription import writer once that client lands.
  }

  // Adobe Sign agreement sync — every 5 minutes
  jobRegistry.register('adobe-sign-sync', 'Adobe Sign agreement sync', async () => {
    if (!adobeSignClient || adobeSignClient.getStatus().status !== 'connected') return;
    const remoteAgreements = await adobeSignClient.listAgreements();
    // Collect agreements whose status flipped to SIGNED on this poll so we can fire
    // the post-sign handler AFTER all upserts complete. Doing it serially after the
    // loop avoids hammering Adobe with parallel /formData + /combinedDocument calls.
    const newlySigned: string[] = [];
    for (const a of remoteAgreements) {
      const signerEmails = a.participantSetsInfo
        ?.filter(ps => ps.role === 'SIGNER')
        .flatMap(ps => ps.memberInfos.map(m => m.email)) ?? [];

      // Snapshot prior local state to detect SIGNED transitions. We only fire the
      // post-sign handler if (a) Adobe now says SIGNED, (b) we haven't already
      // captured (signed_at is null). Existing rows that were SIGNED before this
      // change rolled out won't re-trigger because signed_at is set on first capture.
      const prior = await adobeSignAgreementQueries.getByAgreementId(a.id);
      const transitionedToSigned = a.status === 'SIGNED'
        && (!prior || prior.signed_at === null);

      await adobeSignAgreementQueries.upsert({
        agreement_id: a.id,
        contract_id: null,
        bc_customer_id: null,
        subscription_contract_no: null,
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

      if (transitionedToSigned) newlySigned.push(a.id);
    }
    console.log(`[Adobe Sign] Synced ${remoteAgreements.length} agreements (${newlySigned.length} newly signed)`);

    for (const agreementId of newlySigned) {
      try {
        await handleSignedAgreement(agreementId);
      } catch (err) {
        console.error(`[Adobe Sign] Post-sign handler crashed for ${agreementId}:`, err);
      }
    }
  }, 5 * 60 * 1000);

  // ── Dev Review outbox worker — drain failed Jira writes every 2 min ──
  // When an accept/return/comment fails to write through to Jira, the route
  // queues an entry in dev_review_outbox. This worker picks them up, retries,
  // marks done on success, increments attempts on failure, and gives up after 5.
  jobRegistry.register('dev-review-outbox', 'Dev Review outbox worker', async () => {
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
          // Move CurrentTier off Tier 3 → Development so the ticket leaves
          // the dev review queue (the transition doesn't do this on its own).
          try {
            await client.updateFields(entry.jira_key, { customfield_12981: { id: '13064' } });
          } catch (tierErr) {
            console.warn(`[DevReviewOutbox] ${entry.jira_key}: tier→Development update failed: ${tierErr instanceof Error ? tierErr.message : tierErr}`);
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
          await client.addComment(entry.jira_key, text, { internal: true });
        }
        await devReviewQueries.markOutboxDone(entry.id);
      } catch (e) {
        await devReviewQueries.bumpOutboxFailure(entry.id, e instanceof Error ? e.message : 'unknown');
      }
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
  jobRegistry.register('dev-review-watcher', 'Dev Review T3 watcher', devWatch, 5 * 60 * 1000);
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
              body_adf: c.body && typeof c.body === 'object' ? c.body : undefined,
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
  jobRegistry.register('dev-review-comments', 'Dev Review comment watcher', commentWatch, 2 * 60 * 1000);
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
  jobRegistry.register('survey-scheduler', 'Survey scheduler', async () => {
    await runSurveyScheduler(settingsQueries);
  }, 15 * 60 * 1000);

  // Expired portal token cleanup: every 6 hours
  jobRegistry.register('portal-token-cleanup', 'Expired portal token cleanup', async () => {
    const deleted = await portalQueries.deleteExpired();
    if (deleted > 0) console.log(`[SetupPortal] Cleaned up ${deleted} expired tokens`);
  }, 6 * 60 * 60 * 1000);

  // Auto-expire approval queue items and check Jira status every minute
  const LOW_RISK_ACTION_PREFIXES = ['auto_rule_', 'plugin_to_tpj'];
  const SLA_WARNING_MINUTES = 30;

  const NOVA_TIMEOUT_HOURS = Number(settingsQueries.get('approval_nova_timeout_hours')) || 4;

  jobRegistry.register('approval-sla-check', 'Approval SLA/expiry check', async () => {
    const pending = await approvalQueries.getAll('pending');
    const now = new Date();
    const queueItems = pending.filter(item => item.id > 0);
    const novaItems = pending.filter(item => item.id < 0);

      // 1a. SLA warning — alert when ≤30 min remaining (queue items only, NOVA has no expires_at)
      for (const item of queueItems) {
        const expiresAt = new Date(item.expires_at);
        if (isNaN(expiresAt.getTime()) || expiresAt <= now) continue;
        const minsRemaining = (expiresAt.getTime() - now.getTime()) / 60_000;
        if (minsRemaining <= SLA_WARNING_MINUTES && !item.warned_at) {
          console.log(`[Approvals] SLA warning: approval ${item.id} (${item.ticket_id}) expires in ${Math.round(minsRemaining)} minutes`);
          await approvalQueries.markWarned(item.id);
          try {
            await agentLoop?.getAlertService().createAlert({
              alertType: 'approval_sla_warning',
              severity: 'warning',
              title: `Approval SLA: ${item.ticket_id} expires in ${Math.round(minsRemaining)}m`,
              detail: `Approval ${item.id} for "${item.ticket_summary}" is approaching its SLA deadline.`,
              ticketKey: item.ticket_id,
            });
          } catch { /* alert creation is best-effort */ }
        }
      }

      // 1b. Expire queue items past their expires_at deadline
      for (const item of queueItems) {
        const expiresAt = new Date(item.expires_at);
        if (isNaN(expiresAt.getTime()) || expiresAt > now) continue;

        const isLowRisk = item.action_type && LOW_RISK_ACTION_PREFIXES.some(p => item.action_type!.startsWith(p));
        const isNova = item.source === 'nova_ai';

        if (isNova && isLowRisk) {
          await approvalQueries.decide(item.id, 'approved', 'system-sla');
          try {
            await fetch(`${item.resume_url}?action=approve`, { method: 'GET' });
            console.log(`[Approvals] SLA auto-approved low-risk approval ${item.id} (${item.ticket_id}, action: ${item.action_type})`);
          } catch (err) {
            console.error(`[Approvals] Failed to hit resume URL for auto-approved ${item.id}:`, err instanceof Error ? err.message : err);
          }
          continue;
        }

        await approvalQueries.decide(item.id, 'timed_out', 'system');
        try {
          await fetch(`${item.resume_url}?action=timeout`, { method: 'GET' });
          console.log(`[Approvals] Auto-expired approval ${item.id} (${item.ticket_id}), triggered n8n resume`);
        } catch (err) {
          console.error(`[Approvals] Failed to hit resume URL for expired approval ${item.id}:`, err instanceof Error ? err.message : err);
        }

        if (isNova && !isLowRisk) {
          try {
            await agentLoop?.getAlertService().createAlert({
              alertType: 'approval_timeout',
              severity: 'critical',
              title: `High-risk approval timed out: ${item.ticket_id}`,
              detail: `Approval ${item.id} (action: ${item.action_type || 'unknown'}) expired without review.`,
              ticketKey: item.ticket_id,
            });
          } catch { /* best-effort */ }
        }
      }

      // 1c. Expire NOVA AI decisions by age (no expires_at — use created_at + timeout hours)
      for (const item of novaItems) {
        const createdAt = new Date(item.created_at);
        if (isNaN(createdAt.getTime())) continue;
        const ageHours = (now.getTime() - createdAt.getTime()) / 3_600_000;
        if (ageHours < NOVA_TIMEOUT_HOURS) continue;

        const isLowRisk = item.action_type && LOW_RISK_ACTION_PREFIXES.some(p => item.action_type!.startsWith(p));
        if (isLowRisk) {
          await approvalQueries.decide(item.id, 'approved', 'system-sla');
          console.log(`[Approvals] Auto-approved stale low-risk NOVA decision ${item.id} (${item.ticket_id}, action: ${item.action_type}, age: ${Math.round(ageHours)}h)`);
        } else {
          await approvalQueries.decide(item.id, 'timed_out', 'system');
          console.log(`[Approvals] Timed out NOVA decision ${item.id} (${item.ticket_id}, action: ${item.action_type || 'unknown'}, age: ${Math.round(ageHours)}h)`);
          try {
            await agentLoop?.getAlertService().createAlert({
              alertType: 'approval_timeout',
              severity: 'critical',
              title: `High-risk approval timed out: ${item.ticket_id}`,
              detail: `NOVA decision ${item.id} (action: ${item.action_type || 'unknown'}) expired after ${Math.round(ageHours)}h without review.`,
              ticketKey: item.ticket_id,
            });
          } catch { /* best-effort */ }
        }
      }

      // 2. Check Jira status for all remaining pending items — auto-cancel if resolved/closed
      const s = settingsQueries.getAll();
      if (s.jira_enabled === 'true' && s.jira_username && s.jira_token) {
        const stillPending = pending.filter(item => {
          if (item.id < 0) return true; // NOVA items always eligible
          const expiresAt = new Date(item.expires_at);
          return !isNaN(expiresAt.getTime()) && expiresAt > now;
        });
        const auth = 'Basic ' + Buffer.from(`${s.jira_username}:${s.jira_token}`).toString('base64');
        const cloudId = '9357a1ba-0ad9-4ff0-964d-fad84dd30f96';
        for (const item of stillPending) {
          try {
            const resp = await fetch(
              `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${item.ticket_id}?fields=status,resolution`,
              { headers: { Authorization: auth, Accept: 'application/json' } }
            );
            if (!resp.ok) continue;
            const data = await resp.json() as { fields?: { status?: { name?: string; statusCategory?: { key?: string } }; resolution?: { name?: string } } };
            if (data.fields?.status?.statusCategory?.key === 'done') {
              const statusName = data.fields.status?.name ?? 'unknown';
              const resolution = data.fields.resolution?.name ?? 'none';
              const ageMins = Math.round((now.getTime() - new Date(item.created_at).getTime()) / 60_000);
              await approvalQueries.decide(item.id, 'cancelled', 'system');
              if (item.resume_url) {
                try { await fetch(`${item.resume_url}?action=decline`, { method: 'GET' }); } catch { /* ignore */ }
              }
              console.log(`[Approvals] Auto-cancelled approval ${item.id} (${item.ticket_id}) — Jira status: ${statusName}, resolution: ${resolution}, approval age: ${ageMins}min`);
            }
          } catch { /* skip, try next */ }
        }
      }
  }, 60_000);


  // Weekly training matrix reminder — check hourly, send on Mondays at 9am
  let lastTrainingReminderDate = '';
  jobRegistry.register('training-reminder', 'Training matrix weekly reminder', async () => {
    const now = new Date();
    if (now.getDay() !== 1) return;
    if (now.getHours() < 9) return;
    const today = now.toISOString().split('T')[0];
    if (lastTrainingReminderDate === today) return;
    lastTrainingReminderDate = today;
    console.log('[TrainingReminder] Monday 9am — sending weekly reminders...');
    await sendTrainingReminders(trainingQueries, userQueries, settingsQueries);
  }, 60 * 60 * 1000);

  // Auto-prep scheduling: daily at 18:00, generate 1-2-1 prep for agents with meetings tomorrow
  jobRegistry.register('auto-prep-121', 'Auto-prep 1-2-1 scheduling', async () => {
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
  }, 10 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[N.O.V.A] Shutting down...');
    jobRegistry.pauseAll();
    for (const timer of syncTimers.values()) clearInterval(timer);
    agentLoop?.stop();
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
