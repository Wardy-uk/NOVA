import { useState, useEffect, useRef, useCallback, Component, Suspense, lazy, type ReactNode } from 'react';
import { TaskList } from './components/TaskList.js';
import { SettingsView } from './components/SettingsView.js';
import { DeliveryView } from './components/DeliveryView.js';
import { CrmView } from './components/CrmView.js';
import { ContractsView } from './components/ContractsView.js';
import { AdobeSignView } from './components/AdobeSignView.js';
import { NewContractWizard } from './components/NewContractWizard.js';
import { LoginView } from './components/LoginView.js';
import { HelpView } from './components/HelpView.js';
const AdminView = lazy(() => import('./components/AdminView.js').then(m => ({ default: m.AdminView })));
const AdminContractTermsView = lazy(() => import('./components/AdminContractTermsView.js').then(m => ({ default: m.AdminContractTermsView })));
const OnboardingConfigView = lazy(() => import('./components/OnboardingConfigView.js').then(m => ({ default: m.OnboardingConfigView })));
import { OnboardingCalendar } from './components/OnboardingCalendar.js';
import { OnboardingDashboard } from './components/OnboardingDashboard.js';
import { OverdueDeliveriesView } from './components/OverdueDeliveriesView.js';
import { ProblemTicketsView } from './components/ProblemTicketsView.js';
import { MyFeedbackView } from './components/MyFeedbackView.js';
import { ServiceDeskKanban } from './components/ServiceDeskKanban.js';
import { ServiceDeskCalendar } from './components/ServiceDeskCalendar.js';
import { NeedsAttentionView } from './components/NeedsAttentionView.js';
import { ServiceDeskDashboard } from './components/ServiceDeskDashboard.js';
const ApprovalQueueView = lazy(() => import('./components/ApprovalQueueView.js').then(m => ({ default: m.ApprovalQueueView })));
const KpiDashboardView = lazy(() => import('./components/KpiDashboardView.js').then(m => ({ default: m.KpiDashboardView })));
const KpiDataView = lazy(() => import('./components/KpiDataView.js').then(m => ({ default: m.KpiDataView })));
const KpiComparisonView = lazy(() => import('./components/KpiComparisonView.js').then(m => ({ default: m.KpiComparisonView })));
const KpiLeaderboardView = lazy(() => import('./components/KpiLeaderboardView.js').then(m => ({ default: m.KpiLeaderboardView })));
const KpiDailyHistoryView = lazy(() => import('./components/KpiDailyHistoryView.js').then(m => ({ default: m.KpiDailyHistoryView })));
const KpiBreachedView = lazy(() => import('./components/KpiBreachedView.js').then(m => ({ default: m.KpiBreachedView })));
const SupportKpiScorecard = lazy(() => import('./components/SupportKpiScorecard.js').then(m => ({ default: m.SupportKpiScorecard })));
const AgentScorecardRebuild = lazy(() => import('./components/AgentScorecardRebuild.js').then(m => ({ default: m.AgentScorecardRebuild })));
const LeaderboardRebuild = lazy(() => import('./components/LeaderboardRebuild.js').then(m => ({ default: m.LeaderboardRebuild })));
const KpiRebuildHistory = lazy(() => import('./components/KpiRebuildHistory.js').then(m => ({ default: m.KpiRebuildHistory })));
const KpiRebuildLegacy = lazy(() => import('./components/KpiRebuildLegacy.js').then(m => ({ default: m.KpiRebuildLegacy })));
const OperationalIndicators = lazy(() => import('./components/OperationalIndicators.js').then(m => ({ default: m.OperationalIndicators })));
const KpiRebuildTrends = lazy(() => import('./components/KpiRebuildTrends.js').then(m => ({ default: m.KpiRebuildTrends })));
const TpjMaintenanceView = lazy(() => import('./components/TpjMaintenanceView.js').then(m => ({ default: m.TpjMaintenanceView })));
const QAView = lazy(() => import('./components/QAView.js').then(m => ({ default: m.QAView })));
const BackfillStatusView = lazy(() => import('./components/BackfillStatusView.js').then(m => ({ default: m.BackfillStatusView })));
const SalesHotboxView = lazy(() => import('./components/SalesHotboxView.js').then(m => ({ default: m.SalesHotboxView })));
import { NotificationBell } from './components/NotificationBell.js';
import { StatusBar } from './components/StatusBar.js';
import { FeedbackModal } from './components/FeedbackModal.js';
import { ReleaseNotesModal, LATEST_RELEASE_VERSION } from './components/ReleaseNotesModal.js';
import { TourOverlay, useTour } from './components/TourOverlay.js';
import { SetupPortal } from './components/SetupPortal.js';
const SurveyAdminView = lazy(() => import('./components/SurveyAdminView.js').then(m => ({ default: m.SurveyAdminView })));
const PortalAdminView = lazy(() => import('./components/PortalAdminView.js'));
import { SurveyRespondView } from './components/SurveyRespondView.js';
import { StandupSubmitForm } from './components/StandupSubmitForm.js';
import { OneToOneSubmitForm } from './components/OneToOneSubmitForm.js';
const StandupView = lazy(() => import('./components/StandupView.js').then(m => ({ default: m.StandupView })));
import { WallboardDrillPanel } from './components/WallboardDrillPanel.js';
const TrendsView = lazy(() => import('./components/TrendsView.js').then(m => ({ default: m.TrendsView })));
const EscalationReportView = lazy(() => import('./components/EscalationReportView.js').then(m => ({ default: m.EscalationReportView })));
const RiskIntelligenceView = lazy(() => import('./components/RiskIntelligenceView.js').then(m => ({ default: m.RiskIntelligenceView })));
const TrainingMatrixView = lazy(() => import('./components/TrainingMatrixView.js').then(m => ({ default: m.TrainingMatrixView })));
const TrainingSummaryView = lazy(() => import('./components/TrainingSummaryView.js').then(m => ({ default: m.TrainingSummaryView })));
const BoardMiView = lazy(() => import('./components/BoardMiView.js').then(m => ({ default: m.BoardMiView })));
const DevReviewQueueView = lazy(() => import('./components/DevReviewQueueView.js').then(m => ({ default: m.DevReviewQueueView })));
const DevReviewDashboard = lazy(() => import('./components/DevReviewDashboard.js').then(m => ({ default: m.DevReviewDashboard })));
const MyTicketsQueueView = lazy(() => import('./components/MyTicketsQueueView.js').then(m => ({ default: m.MyTicketsQueueView })));
const AgentKpisView = lazy(() => import('./components/AgentKpisView.js').then(m => ({ default: m.AgentKpisView })));
/* CALYX SHELVED — lazy imports commented out
const CalyxQueueView = lazy(() => import('./components/CalyxQueueView.js').then(m => ({ default: m.CalyxQueueView })));
const CalyxDashboardView = lazy(() => import('./components/CalyxDashboardView.js').then(m => ({ default: m.CalyxDashboardView })));
const CalyxPlaylistView = lazy(() => import('./components/CalyxPlaylistView.js').then(m => ({ default: m.CalyxPlaylistView })));
const CalyxProblemsView = lazy(() => import('./components/CalyxProblemsView.js').then(m => ({ default: m.CalyxProblemsView })));
const CalyxChangesView = lazy(() => import('./components/CalyxChangesView.js').then(m => ({ default: m.CalyxChangesView })));
const CalyxKnowledgeBaseView = lazy(() => import('./components/CalyxKnowledgeBaseView.js').then(m => ({ default: m.CalyxKnowledgeBaseView })));
const CalyxMajorIncidentsView = lazy(() => import('./components/CalyxMajorIncidentsView.js').then(m => ({ default: m.CalyxMajorIncidentsView })));
const CalyxImprovementsView = lazy(() => import('./components/CalyxImprovementsView.js').then(m => ({ default: m.CalyxImprovementsView })));
const CalyxSloSettingsView = lazy(() => import('./components/CalyxSloSettingsView.js').then(m => ({ default: m.CalyxSloSettingsView })));
const CalyxBusinessHoursView = lazy(() => import('./components/CalyxBusinessHoursView.js').then(m => ({ default: m.CalyxBusinessHoursView })));
const CalyxOrganisationsView = lazy(() => import('./components/CalyxOrganisationsView.js').then(m => ({ default: m.CalyxOrganisationsView })));
const CalyxTicketsView = lazy(() => import('./components/CalyxTicketsView.js').then(m => ({ default: m.CalyxTicketsView })));
const CalyxSettingsView = lazy(() => import('./components/CalyxSettingsView.js').then(m => ({ default: m.CalyxSettingsView })));
const CalyxPortal = lazy(() => import('./components/CalyxPortal.js').then(m => ({ default: m.CalyxPortal })));
*/
const AgentDashboardView = lazy(() => import('./components/AgentDashboardView.js').then(m => ({ default: m.AgentDashboardView })));
const AgentWorkspaceView = lazy(() => import('./components/AgentWorkspaceView.js').then(m => ({ default: m.AgentWorkspaceView })));
const AgentCoachingView = lazy(() => import('./components/AgentCoachingView.js').then(m => ({ default: m.AgentCoachingView })));
const AgentPipelinesView = lazy(() => import('./components/AgentPipelinesView.js').then(m => ({ default: m.AgentPipelinesView })));
const AgentImpactView = lazy(() => import('./components/AgentImpactView.js').then(m => ({ default: m.AgentImpactView })));
const UatComparisonView = lazy(() => import('./components/UatComparisonView.js').then(m => ({ default: m.UatComparisonView })));
const AgentProfileView = lazy(() => import('./components/AgentProfileView.js').then(m => ({ default: m.AgentProfileView })));
const KbGapsView = lazy(() => import('./components/KbGapsView.js').then(m => ({ default: m.KbGapsView })));
const AgentLearningsView = lazy(() => import('./components/AgentLearningsView.js').then(m => ({ default: m.AgentLearningsView })));
const ManagerDashboardView = lazy(() => import('./components/ManagerDashboardView.js').then(m => ({ default: m.ManagerDashboardView })));
const AgentRosterView = lazy(() => import('./components/AgentRosterView.js').then(m => ({ default: m.AgentRosterView })));
const OneToOneSetupView = lazy(() => import('./components/OneToOneSetupView.js').then(m => ({ default: m.OneToOneSetupView })));
const OneToOneOverviewView = lazy(() => import('./components/OneToOneOverviewView.js').then(m => ({ default: m.OneToOneOverviewView })));
const BacklogKanbanView = lazy(() => import('./components/BacklogKanbanView.js').then(m => ({ default: m.BacklogKanbanView })));
const KbHealthView = lazy(() => import('./components/KbHealthView.js').then(m => ({ default: m.KbHealthView })));
const TrainingSignalsView = lazy(() => import('./components/TrainingSignalsView.js').then(m => ({ default: m.TrainingSignalsView })));
const CapacityView = lazy(() => import('./components/CapacityView.js').then(m => ({ default: m.CapacityView })));
const IntelligenceView = lazy(() => import('./components/IntelligenceView.js').then(m => ({ default: m.IntelligenceView })));
const OpsPackView = lazy(() => import('./components/OpsPackView.js').then(m => ({ default: m.OpsPackView })));
const Briefing121View = lazy(() => import('./components/Briefing121View.js').then(m => ({ default: m.Briefing121View })));
import { useTasks, useHealth } from './hooks/useTasks.js';
import { useTheme, type Theme } from './hooks/useTheme.js';
import { useAuth } from './hooks/useAuth.js';
import { useVisibilityInterval } from './hooks/useVisibilityInterval.js';
import { type OwnershipFilter } from './utils/taskHelpers.js';

declare const __APP_VERSION__: string;

// ── Area / View definitions ──

type Area = 'servicedesk' | 'sales' | 'onboarding' | 'accounts' | 'people' | 'kpis' | 'kpi-rebuild' | 'trends' | 'qa' | 'wallboards' | 'training' | 'board' | 'devreview' | 'ai-agent' | 'backlog' | 'standup';
type View = 'tickets' | 'kanban' | 'sd-calendar' | 'attention' | 'sd-dashboard' | 'ai-approvals'
  | 'delivery' | 'onboarding-config' | 'ob-calendar' | 'ob-dashboard' | 'ob-overdue'
  | 'crm' | 'contracts' | 'adobe-sign' | 'new-contract'
  | 'sales-hotbox'
  | 'kpi-dashboard' | 'kpi-data' | 'kpi-compare' | 'kpi-leaderboard' | 'kpi-daily-history' | 'kpi-breached' | 'kpi-team-breached' | 'kpi-trends' | 'kpi-escalations' | 'risk-intelligence' | 'agent-kpis' | 'qa'
  | 'kpi-rebuild-support'
  | 'wb-breached' | 'wb-team-kpis' | 'wb-cc' | 'wb-tech-support' | 'wb-key-accounts' | 'wb-customer-success' | 'wb-support' | 'wb-dev-review' | 'wb-ricky'
  | 'kpi-rebuild-agents' | 'kpi-rebuild-leaderboard' | 'kpi-rebuild-history' | 'kpi-rebuild-trends' | 'kpi-rebuild-operational' | 'kpi-rebuild-legacy' | 'tpj-maintenance'
  | 'backfill-status'
  | 'surveys' | 'people-roster' | 'people-profile' | 'people-121-setup' | 'people-121-overview'
  | 'training-matrix' | 'training-summary'
  | 'board-mi'
  | 'dev-review' | 'dev-review-dashboard'
  | 'agent-dashboard' | 'agent-workspace' | 'agent-coaching' | 'agent-manager' | 'agent-pipelines' | 'agent-uat-compare' | 'agent-kb-gaps' | 'agent-learnings'
  | 'agent-kb-health' | 'agent-training' | 'agent-capacity' | 'agent-intelligence' | 'agent-impact' | 'agent-ops-pack' | 'agent-121'
  | 'backlog-board'
  | 'standup-board'
  | 'settings' | 'admin-panel' | 'portal-admin' | 'admin-contract-terms' | 'my-feedback'
  | 'help' | 'debug';

// Standalone views that don't belong to any area (no sub-tab bar)
const STANDALONE_VIEWS = new Set<View>(['help', 'debug', 'settings', 'admin-panel', 'portal-admin', 'admin-contract-terms', 'my-feedback']);

interface AreaDef {
  label: string;
  defaultView: View;
  tabs: Array<{ view: View; label: string }>;
}

// Per-area access levels resolved from custom roles
type AccessLevel = 'hidden' | 'view' | 'edit';
interface AreaAccess { [areaId: string]: AccessLevel }

const DEFAULT_AREA_ACCESS: AreaAccess = {
  nova_features: 'view',
  servicedesk: 'view', sales: 'hidden', onboarding: 'view', accounts: 'view', people: 'view', kpis: 'hidden', trends: 'hidden', qa: 'hidden', wallboards: 'view', training: 'edit', admin: 'hidden', mi: 'hidden', devreview: 'hidden', 'ai-agent': 'view', backlog: 'view', standup: 'hidden',
};

const TAB_AREA_GATE: Partial<Record<View, string>> = {
  'people-roster': 'admin',
  'people-121-setup': 'admin',
  'people-121-overview': 'admin',
  'agent-manager': 'admin',
};

const AREAS: Record<Area, AreaDef> = {
  servicedesk: {
    label: 'Service Desk',
    defaultView: 'sd-dashboard',
    tabs: [
      { view: 'sd-dashboard', label: 'Dashboard' },
      { view: 'kanban', label: 'Kanban' },
      { view: 'sd-calendar', label: 'Calendar' },
      { view: 'attention', label: 'My Breached' },
    ],
  },
  sales: {
    label: 'Sales Hotbox',
    defaultView: 'sales-hotbox',
    tabs: [
      { view: 'sales-hotbox', label: 'Sales Hotbox' },
    ],
  },
  onboarding: {
    label: 'Onboarding',
    defaultView: 'delivery',
    tabs: [
      { view: 'ob-dashboard', label: 'Overview' },
      { view: 'delivery', label: 'Delivery' },
      { view: 'ob-overdue', label: 'Overdue' },
      { view: 'ob-calendar', label: 'Milestones' },
      { view: 'onboarding-config', label: 'Onboarding Matrix' },
    ],
  },
  accounts: {
    label: 'Account Management',
    defaultView: 'crm',
    tabs: [
      { view: 'crm', label: 'CRM' },
      { view: 'contracts', label: 'Contracts' },
      { view: 'adobe-sign', label: 'Adobe Sign' },
      { view: 'new-contract', label: 'New Contract' },
    ],
  },
  people: {
    label: 'People',
    defaultView: 'people-profile',
    tabs: [
      { view: 'people-roster', label: 'My Team' },
      { view: 'people-121-overview', label: '1-2-1 Overview' },
      { view: 'people-profile', label: 'My Performance' },
      { view: 'surveys', label: 'Team Surveys' },
      { view: 'people-121-setup', label: '1-2-1 Setup' },
    ],
  },
  kpis: {
    label: 'Legacy KPIs (do not use)',
    defaultView: 'kpi-dashboard',
    tabs: [
      { view: 'kpi-dashboard', label: 'Dashboard' },
      { view: 'kpi-leaderboard', label: 'Leaderboard' },
      { view: 'kpi-data', label: 'KPI Data' },
      { view: 'kpi-daily-history', label: 'Daily History' },
      { view: 'kpi-breached', label: 'Agent Breaches' },
      { view: 'kpi-team-breached', label: 'Team Breaches' },
      { view: 'kpi-escalations', label: 'Escalations' },
      { view: 'risk-intelligence', label: 'Risk Intelligence' },
      { view: 'agent-kpis', label: 'Agent KPIs' },
    ],
  },
  'kpi-rebuild': {
    label: 'KPIs (Rebuild)',
    defaultView: 'kpi-rebuild-support',
    tabs: [
      { view: 'kpi-rebuild-support', label: 'Support' },
      { view: 'kpi-rebuild-agents', label: 'Agents' },
      { view: 'kpi-rebuild-leaderboard', label: 'Leaderboard' },
      { view: 'kpi-rebuild-history', label: 'Daily History' },
      { view: 'kpi-rebuild-trends', label: 'Trends' },
      { view: 'kpi-rebuild-operational', label: 'Operational Indicators' },
      { view: 'kpi-rebuild-legacy', label: 'Legacy KPIs' },
      { view: 'tpj-maintenance', label: 'TPJ Maintenance' },
    ],
  },
  trends: {
    label: 'Trends',
    defaultView: 'kpi-trends',
    tabs: [
      { view: 'kpi-trends', label: 'Trends' },
    ],
  },
  qa: {
    label: 'QA',
    defaultView: 'qa',
    tabs: [
      { view: 'qa', label: 'QA Dashboard' },
      { view: 'backfill-status', label: 'Backfill Status' },
    ],
  },
  wallboards: {
    label: 'Wallboards',
    defaultView: 'wb-breached',
    tabs: [
      { view: 'wb-breached', label: 'SLA Breach Board' },
      { view: 'wb-team-kpis', label: 'KPI Breach Board' },
      { view: 'wb-cc', label: 'Customer Care' },
      { view: 'wb-tech-support', label: 'Technical Support' },
      { view: 'wb-key-accounts', label: 'Key Accounts' },
      { view: 'wb-customer-success', label: 'Customer Success' },
      { view: 'wb-support', label: 'Support KPIs' },
      { view: 'wb-dev-review', label: 'Dev Review' },
      { view: 'wb-ricky', label: 'Risk Board' },
    ],
  },
  training: {
    label: 'Training',
    defaultView: 'training-matrix',
    tabs: [
      { view: 'training-matrix', label: 'Matrix' },
      { view: 'training-summary', label: 'Dashboard' },
    ],
  },
  board: {
    label: 'Board MI',
    defaultView: 'board-mi',
    tabs: [
      { view: 'board-mi', label: 'Monthly Pack' },
    ],
  },
  devreview: {
    label: 'Dev Review',
    defaultView: 'dev-review',
    tabs: [
      { view: 'dev-review', label: 'Queue' },
      { view: 'dev-review-dashboard', label: 'Dashboard' },
    ],
  },
  /* CALYX SHELVED
  calyx: {
    label: 'Calyx',
    defaultView: 'calyx-queue',
    tabs: [
      { view: 'calyx-queue', label: 'Queue' },
      { view: 'calyx-playlist', label: 'My Queue' },
      { view: 'calyx-dashboard', label: 'Dashboard' },
      { view: 'calyx-tickets', label: 'Tickets' },
      { view: 'calyx-kb', label: 'Knowledge Base' },
      { view: 'calyx-improvements', label: 'Improvements' },
      { view: 'calyx-settings', label: 'Settings' },
    ],
  },
  */
  'ai-agent': {
    label: 'NOVA AI Agent',
    defaultView: 'agent-workspace',
    tabs: [
      { view: 'tickets', label: 'My Tickets' },
      { view: 'ai-approvals', label: 'AI Approvals' },
      { view: 'agent-workspace', label: 'Workspace' },
      { view: 'agent-dashboard', label: 'Dashboard' },
      { view: 'agent-coaching', label: 'Coaching' },
      { view: 'agent-manager', label: 'Manager' },
      { view: 'agent-pipelines', label: 'Pipelines' },
      { view: 'agent-uat-compare', label: 'UAT Compare' },
      { view: 'agent-kb-gaps', label: 'KB Gaps' },
      { view: 'agent-kb-health', label: 'KB Health' },
      { view: 'agent-training', label: 'Training' },
      { view: 'agent-learnings', label: 'Learnings' },
      { view: 'agent-capacity', label: 'Capacity' },
      { view: 'agent-intelligence', label: 'Intelligence' },
      { view: 'agent-impact', label: 'Impact' },
      { view: 'agent-ops-pack', label: 'Ops Pack' },
      { view: 'agent-121', label: '1-2-1 Prep' },
    ],
  },
  backlog: {
    label: 'Backlog',
    defaultView: 'backlog-board',
    tabs: [
      { view: 'backlog-board', label: 'Kanban' },
    ],
  },
  standup: {
    label: 'Standup',
    defaultView: 'standup-board',
    tabs: [
      { view: 'standup-board', label: 'Standup' },
    ],
  },
};

const AREA_ORDER: Area[] = ['ai-agent', 'servicedesk', 'sales', 'onboarding', 'accounts', 'people', 'kpis', 'kpi-rebuild', 'trends', 'qa', 'wallboards', 'training', 'devreview', 'board', 'backlog', 'standup'];

// Derive area from view (standalone views fall back to 'ai-agent')
function getArea(view: View): Area {
  if (STANDALONE_VIEWS.has(view)) return 'ai-agent';
  for (const [area, def] of Object.entries(AREAS) as [Area, AreaDef][]) {
    if (def.tabs.some((t) => t.view === view)) return area;
  }
  return 'ai-agent';
}

// Full-width views (no max-w constraint)
const FULL_WIDTH_VIEWS = new Set<View>(['delivery', 'onboarding-config', 'contracts', 'ob-calendar', 'ob-dashboard', 'ob-overdue', 'kanban', 'tickets', 'sd-calendar', 'attention', 'sd-dashboard', 'ai-approvals', 'kpi-dashboard', 'kpi-data', 'kpi-compare', 'kpi-leaderboard', 'kpi-daily-history', 'kpi-breached', 'kpi-team-breached', 'kpi-trends', 'agent-kpis', 'qa', 'wb-breached', 'wb-team-kpis', 'wb-cc', 'wb-tech-support', 'wb-support', 'kpi-rebuild-agents', 'kpi-rebuild-leaderboard', 'kpi-rebuild-history', 'kpi-rebuild-trends', 'kpi-rebuild-operational', 'kpi-rebuild-legacy', 'tpj-maintenance', 'admin-panel', 'sales-hotbox', 'training-matrix', 'training-summary', 'board-mi', 'dev-review', 'dev-review-dashboard', 'agent-dashboard', 'agent-workspace', 'agent-kb-gaps', 'wb-key-accounts', 'wb-customer-success', 'people-roster', 'people-profile', 'people-121-overview', 'backlog-board', 'standup-board']);

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#272C33] text-neutral-100 flex items-center justify-center px-6">
          <div className="max-w-xl w-full border border-red-900 bg-red-950/40 rounded-lg p-6">
            <div className="text-sm text-red-400 font-semibold mb-2">UI crashed</div>
            <div className="text-xs text-neutral-300 mb-4">
              {this.state.error.message}
            </div>
            <pre className="text-[11px] text-neutral-400 overflow-auto max-h-64 whitespace-pre-wrap">
              {this.state.error.stack}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Read initial view from URL hash (e.g. #delivery → 'delivery')
function getViewFromHash(): View | null {
  const hash = window.location.hash.slice(1).split('?')[0]; // strip '#' and any ?query
  if (!hash || hash.includes('sso_token')) return null;
  // Validate it's a known view
  const allViews = new Set<string>([
    ...Object.values(AREAS).flatMap(a => a.tabs.map(t => t.view)),
    ...STANDALONE_VIEWS,
  ]);
  // Allow area names as hash aliases (e.g. #trends → kpi-trends)
  const HASH_ALIASES: Record<string, View> = { trends: 'kpi-trends' };
  const resolved = HASH_ALIASES[hash] || hash;
  return allViews.has(resolved) ? (resolved as View) : null;
}

export function App() {
  /* CALYX SHELVED
  if (window.location.pathname.startsWith('/portal/calyx')) return <CalyxPortal />;
  */

  // Customer setup portal — standalone public page (no NOVA auth)
  const setupMatch = window.location.pathname.match(/^\/setup\/([a-f0-9]{64})$/);
  if (setupMatch) return <SetupPortal token={setupMatch[1]} />;

  // Public survey response page — token-based, no auth
  const surveyMatch = window.location.pathname.match(/^\/survey\/([0-9a-f-]{36})$/);
  if (surveyMatch) return <SurveyRespondView token={surveyMatch[1]} />;

  // Public standup submission form — no NOVA auth (agents submit from their phones)
  const standupMatch = window.location.pathname.match(/^\/standup\/submit\/(\d{4}-\d{2}-\d{2})$/);
  if (standupMatch) return <StandupSubmitForm date={standupMatch[1]} />;

  // Public 1-2-1 prep submission form — no NOVA auth (token-gated, emailed the day before)
  const one21Match = window.location.pathname.match(/^\/121\/submit\/([a-f0-9]{32,64})$/);
  if (one21Match) return <OneToOneSubmitForm token={one21Match[1]} />;

  // Public wallboard — no auth required
  if (window.location.hash === '#wallboard') {
    return <KpiBreachedView isWallboard />;
  }

  const [view, setViewRaw] = useState<View>(() => getViewFromHash() ?? 'tickets');

  // Wrap setView to sync hash
  const setView = useCallback((v: View) => {
    setViewRaw(v);
    window.history.replaceState(null, '', `#${v}`);
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      const v = getViewFromHash();
      if (v) setViewRaw(v);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const auth = useAuth();
  const { tasks, loading, error, syncing, updateTask } = useTasks();
  const health = useHealth();
  const { theme, setTheme } = useTheme();
  const { showTour, startTour, closeTour, checkFirstVisit } = useTour();
  const [apiDebug, setApiDebug] = useState<Array<{ ts: string; text: string }>>([]);
  const [lastSuggest, setLastSuggest] = useState<string>('');
  const [spDebug, setSpDebug] = useState<Record<string, unknown> | null>(null);
  const [spDebugLoading, setSpDebugLoading] = useState(false);
  const [d365Debug, setD365Debug] = useState<Array<{ ts: string; text: string }>>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [homepage, setHomepage] = useState<View | null>(null);
  const [selectedAgentName, setSelectedAgentName] = useState<string | null>(null);
  const [sdFilter, setSdFilter] = useState<OwnershipFilter>(() => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem('nova_sd_filter');
    // Migrate old 'mine' value to null (left tab shows user's own tickets)
    if (!stored || stored === 'mine') return null;
    return stored as OwnershipFilter;
  });
  const [sdIssueTypeFilter, setSdIssueTypeFilter] = useState<string | null>(null);
  const [approvalBadge, setApprovalBadge] = useState(0);
  const [flaggedBadge, setFlaggedBadge] = useState(0);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Wallboard drill-down panel state (triggered by postMessage from wallboard iframes)
  const [wbDrill, setWbDrill] = useState<{ kpi?: string; agent?: string; bucket?: string; stat?: string; cohort?: string; accountId?: string; label: string } | null>(null);
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (!e.data || e.data.type !== 'wallboard-drill') return;
      const { kpi, agent, bucket, stat, cohort, accountId, label } = e.data;
      if (kpi || agent || bucket) setWbDrill({ kpi, agent, bucket, stat, cohort, accountId, label: label || kpi || agent || bucket });
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const currentArea = getArea(view);
  const areaDef = AREAS[currentArea];
  const userRole = auth.user?.role ?? 'viewer';

  // Resolved area access from custom roles
  const [areaAccess, setAreaAccess] = useState<AreaAccess>(
    userRole.split(',').map(r => r.trim()).some(r => r === 'admin' || r === 'super_admin')
      ? { nova_features: 'edit', servicedesk: 'edit', sales: 'edit', onboarding: 'edit', accounts: 'edit', people: 'edit', kpis: 'edit', qa: 'edit', wallboards: 'edit', admin: 'edit', ai_approvals: 'edit', training: 'edit', mi: 'edit', devreview: 'edit', 'ai-agent': 'edit' }
      : DEFAULT_AREA_ACCESS,
  );
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token) return;
    fetch('/api/auth/permissions', {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.areaAccess) {
          // Merge with defaults so new areas don't become hidden if missing from saved roles
          setAreaAccess({ ...DEFAULT_AREA_ACCESS, ...json.data.areaAccess });
        }
      })
      .catch(() => {});
  }, [auth.isAuthenticated, auth.token]);

  // Feature flags from settings (used to toggle optional tabs like wallboards)
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token) return;
    fetch('/api/settings/feature-flags', {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(r => r.json())
      .then(json => { if (json.ok) setFeatureFlags(json.data || {}); })
      .catch(() => {});
  }, [auth.isAuthenticated, auth.token]);

  // Fetch user preferences (homepage) on login
  const homepageApplied = useRef(false);
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token) return;
    fetch('/api/auth/preferences', {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.homepage) {
          setHomepage(json.data.homepage as View);
          // Apply homepage on first load if no URL hash override
          if (!homepageApplied.current && !getViewFromHash()) {
            homepageApplied.current = true;
            setView(json.data.homepage as View);
          }
        }
      })
      .catch(() => {});
  }, [auth.isAuthenticated, auth.token, setView]);

  // Auto-show tour on first visit
  useEffect(() => {
    if (auth.isAuthenticated) checkFirstVisit();
  }, [auth.isAuthenticated, checkFirstVisit]);

  // Auto-show release notes only when a new entry is added to RELEASE_NOTES
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    const seen = localStorage.getItem('nova_release_notes_seen');
    if (seen !== LATEST_RELEASE_VERSION) setShowReleaseNotes(true);
  }, [auth.isAuthenticated]);

  // Listen for release notes event (from StatusBar version click)
  useEffect(() => {
    const handler = () => setShowReleaseNotes(true);
    window.addEventListener('nova-show-release-notes', handler);
    return () => window.removeEventListener('nova-show-release-notes', handler);
  }, []);


  // Poll approval queue badge count (pauses when tab hidden)
  const pollApprovals = useCallback(() => {
    if (!auth.isAuthenticated) return;
    fetch('/api/approvals/count')
      .then(r => r.json())
      .then(json => { if (json.ok) setApprovalBadge(json.data.count); })
      .catch(() => {});
  }, [auth.isAuthenticated]);
  useEffect(() => { pollApprovals(); }, [pollApprovals]);
  useVisibilityInterval(pollApprovals, 30000);

  // Poll flagged ticket count (pauses when tab hidden)
  const pollFlagged = useCallback(() => {
    if (!auth.isAuthenticated) return;
    fetch('/api/agent/flagged/summary')
      .then(r => r.json())
      .then(json => { if (json.ok) setFlaggedBadge(json.data.count); })
      .catch(() => {});
  }, [auth.isAuthenticated]);
  useEffect(() => { pollFlagged(); }, [pollFlagged]);
  useVisibilityInterval(pollFlagged, 60000);

  useEffect(() => {
    if (view !== 'debug') return;
    let active = true;

    const fetchDebug = async () => {
      try {
        const res = await fetch('/api/actions/debug-log');
        const json = await res.json();
        if (active && json.ok && Array.isArray(json.data)) {
          setApiDebug(json.data);
        }
        if (typeof window !== 'undefined') {
          setLastSuggest(window.localStorage.getItem('nova_last_suggest') ?? '');
        }
      } catch {
        /* ignore */
      }
    };

    const fetchSpDebug = async () => {
      try {
        const res = await fetch('/api/delivery/sync/debug');
        const json = await res.json();
        if (active) {
          if (json.ok) {
            setSpDebug(json.data);
          } else {
            setSpDebug({ _error: json.error || `HTTP ${res.status}` });
          }
        }
      } catch (err) {
        if (active) setSpDebug({ _error: err instanceof Error ? err.message : 'Fetch failed' });
      }
    };

    const fetchD365Debug = async () => {
      try {
        const res = await fetch('/api/dynamics365/debug-log');
        const json = await res.json();
        if (active && json.ok && Array.isArray(json.data)) {
          setD365Debug(json.data);
        }
      } catch { /* ignore */ }
    };

    fetchDebug();
    fetchSpDebug();
    fetchD365Debug();
    const interval = setInterval(() => { fetchDebug(); fetchD365Debug(); }, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [view]);

  // Close user menu on outside click
  useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

  // Persist SD filter
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('nova_sd_filter', sdFilter ?? '');
  }, [sdFilter]);

  // Pin/unpin current view as homepage
  const togglePinHomepage = useCallback(async () => {
    const newHomepage = homepage === view ? null : view;
    setHomepage(newHomepage);
    try {
      await fetch('/api/auth/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ homepage: newHomepage }),
      });
    } catch { /* ignore */ }
  }, [homepage, view, auth.token]);

  // Navigate helper — used by child components
  const navigate = (v: string) => setView(v as View);

  // Service Desk: fetch tickets from live Jira search
  // Left tabs (sdFilter=null) use 'mine', right pills use their specific filter
  const [sdTasks, setSdTasks] = useState<typeof tasks>([]);
  const [sdLoading, setSdLoading] = useState(false);
  const sdApiFilter = sdFilter === null ? 'mine' : sdFilter;
  const sdInitialDone = useRef(false);
  const lastSdJson = useRef('');

  // Stable SD fetch function — callable from effects and child components
  const refreshSdTasks = useCallback(() => {
    fetch(`/api/tasks/service-desk?filter=${sdApiFilter}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && json.data) {
          const serialized = JSON.stringify(json.data);
          if (serialized !== lastSdJson.current) {
            lastSdJson.current = serialized;
            setSdTasks(json.data);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!sdInitialDone.current) {
          setSdLoading(false);
          sdInitialDone.current = true;
        }
      });
  }, [sdApiFilter]);

  useEffect(() => {
    if (!auth.isAuthenticated) return;
    if (sdApiFilter === 'all-breached') return;
    if (!sdInitialDone.current) setSdLoading(true);
    lastSdJson.current = ''; // Reset on filter change so new data always applies
    refreshSdTasks();
    const interval = setInterval(refreshSdTasks, 60_000);
    return () => clearInterval(interval);
  }, [sdApiFilter, auth.isAuthenticated, refreshSdTasks]);

  // Extract issue types from SD tasks and apply filter
  const getIssueType = (task: typeof tasks[0]): string => {
    const rd = task.raw_data as Record<string, unknown> | null;
    if (!rd) return 'Unknown';
    const fields = rd.fields as Record<string, unknown> | undefined;
    const it = fields?.issuetype ?? rd.issuetype;
    if (it && typeof it === 'object') return (it as any).name ?? 'Unknown';
    if (typeof it === 'string') return it;
    return 'Unknown';
  };
  const sdIssueTypes = Array.from(new Set(sdTasks.map(getIssueType))).filter(t => t !== 'Unknown').sort();
  const filteredSdTasks = sdIssueTypeFilter
    ? sdTasks.filter(t => getIssueType(t) === sdIssueTypeFilter)
    : sdTasks;

  // Manual refresh for current area
  const [refreshing, setRefreshing] = useState(false);
  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (currentArea === 'servicedesk') {
        refreshSdTasks();
      }
      // Onboarding and CRM views manage their own data — dispatching a custom event lets them know
      window.dispatchEvent(new Event('nova-refresh'));
    } catch { /* ignore */ }
    // Brief timeout so spinner is visible
    setTimeout(() => setRefreshing(false), 500);
  }, [currentArea, refreshSdTasks]);

  // Auth gate
  if (auth.initializing) {
    return (
      <div className="min-h-screen bg-[#272C33] flex items-center justify-center">
        <div className="text-neutral-500 text-sm">Loading...</div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <ErrorBoundary>
        <LoginView
          onLogin={auth.login}
          onRegister={auth.register}
          onSsoLogin={auth.loginWithSso}
          error={auth.error}
          loading={auth.busy}
        />
      </ErrorBoundary>
    );
  }

  const canSeeArea = (area: Area): boolean => {
    if (area === 'ai-agent' || area === 'wallboards') return true;
    if (area === 'kpi-rebuild') return true;
    // Standup — admins, or Support-role users who are also on the Support team.
    if (area === 'standup') {
      const roles = userRole.split(',').map(r => r.trim().toLowerCase());
      if (roles.includes('admin') || roles.includes('super_admin')) return true;
      // Any role granted the 'standup' area in Admin > Permissions
      if ((areaAccess['standup'] || 'hidden') !== 'hidden') return true;
      const onSupportTeam = (auth.user?.teams ?? []).some(tm => tm.toLowerCase() === 'support');
      return roles.includes('support') && onSupportTeam;
    }
    // Board MI gated by the 'mi' permission area
    if (area === 'board') return (areaAccess['mi'] || 'hidden') !== 'hidden';
    // Dev Review — standard area permission (configured in Admin > Permissions)
    if (area === 'devreview') return (areaAccess['devreview'] || 'hidden') !== 'hidden';
    // Trends piggybacks on KPIs access (no separate role needed)
    if (area === 'trends') return (areaAccess['kpis'] || 'hidden') !== 'hidden';
    return (areaAccess[area] || 'hidden') !== 'hidden';
  };

  const FEATURE_FLAG_TABS: Partial<Record<View, string>> = {
    'wb-key-accounts': 'wallboard_key_accounts_enabled',
    'wb-customer-success': 'wallboard_cs_enabled',
  };

  const getVisibleTabs = (area: Area) => {
    return AREAS[area].tabs.filter(t => {
      const gateArea = TAB_AREA_GATE[t.view];
      if (gateArea && (areaAccess[gateArea] || 'hidden') === 'hidden') return false;
      const flag = FEATURE_FLAG_TABS[t.view];
      if (flag && featureFlags[flag] === false) return false;
      // TPJ Maintenance: super_admin, OR the KPI role AND membership of the TPJ team.
      if (t.view === 'tpj-maintenance') {
        const roles = (auth.user?.role ?? '').split(',').map(r => r.trim());
        const isSuper = roles.includes('super_admin');
        const inTpj = (auth.user?.teams ?? []).some(tm => tm.toLowerCase() === 'tpj');
        if (!(isSuper || (roles.includes('kpi') && inTpj))) return false;
      }
      return true;
    });
  };

  const isFullWidth = FULL_WIDTH_VIEWS.has(view);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#272C33] text-neutral-100 flex flex-col">
        {/* Top header — branding + area nav + utilities */}
        <header className="border-b border-[#3a424d] px-6 py-3">
          <div className="flex items-center justify-between">
            {/* Left: logo + area tabs */}
            <div className="flex items-center gap-4">
              <h1
                className="text-lg font-bold tracking-tight font-[var(--font-heading)] cursor-pointer"
                onClick={() => setView('tickets')}
              >
                <span className="text-[#5ec1ca]">N.O.V.A</span>
              </h1>

              {/* Area tabs */}
              <nav className="flex items-center gap-1">
                {AREA_ORDER.filter((a) => canSeeArea(a)).map((area) => (
                  <button
                    key={area}
                    data-area={area}
                    onClick={() => setView(AREAS[area].defaultView)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      currentArea === area && !STANDALONE_VIEWS.has(view)
                        ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                        : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
                    }`}
                  >
                    {AREAS[area].label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Right: utilities */}
            <div className="flex items-center gap-2">
              {/* Notifications */}
              <NotificationBell />
              {/* Theme toggle */}
              <div className="flex items-center bg-[#2f353d] rounded border border-[#3a424d]">
                {([
                  { value: 'light' as Theme, label: '\u2600' },
                  { value: 'dark' as Theme, label: '\u263E' },
                  { value: 'system' as Theme, label: '\u2699' },
                ]).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTheme(t.value)}
                    title={t.value.charAt(0).toUpperCase() + t.value.slice(1)}
                    className={`px-2 py-1.5 text-xs transition-colors ${
                      theme === t.value
                        ? 'bg-[#5ec1ca] text-[#272C33]'
                        : 'text-neutral-400 hover:text-neutral-200'
                    } ${t.value === 'light' ? 'rounded-l' : t.value === 'system' ? 'rounded-r' : ''}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {/* Pin as homepage */}
              <button
                onClick={togglePinHomepage}
                className={`px-1.5 py-1.5 transition-colors rounded hover:bg-[#363d47] ${
                  homepage === view ? 'text-[#5ec1ca]' : 'text-neutral-600 hover:text-neutral-400'
                }`}
                title={homepage === view ? 'Unpin homepage' : 'Pin as homepage'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={homepage === view ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="17" x2="12" y2="22" />
                  <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                </svg>
              </button>
              {/* User menu */}
              <div className="relative ml-1 pl-2 border-l border-[#3a424d]" ref={userMenuRef} data-tour="user-menu">
                <button
                  onClick={() => setShowUserMenu((prev) => !prev)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[#363d47] transition-colors"
                >
                  <span className="text-[10px] text-neutral-400">
                    {auth.user?.display_name || auth.user?.username}
                  </span>
                  <svg className={`w-3 h-3 text-neutral-500 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-1 w-44 bg-[#2f353d] border border-[#3a424d] rounded-lg shadow-xl py-1 z-50">
                    <button
                      onClick={() => { setView('settings'); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                    >
                      My Settings
                    </button>
                    {areaAccess.admin === 'edit' && (
                      <>
                        <button
                          onClick={() => { setView('admin-panel'); setShowUserMenu(false); }}
                          className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                        >
                          Admin
                        </button>
                        <button
                          onClick={() => { setView('admin-contract-terms'); setShowUserMenu(false); }}
                          className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                        >
                          Contract Terms
                        </button>
                        <button
                          onClick={() => { setView('portal-admin'); setShowUserMenu(false); }}
                          className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                        >
                          Portal Admin
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => { setView('help'); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                    >
                      Help & Guide
                    </button>
                    <button
                      onClick={() => { setShowFeedback(true); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                    >
                      Send Feedback
                    </button>
                    <button
                      onClick={() => { setView('my-feedback'); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                    >
                      My Feedback
                    </button>
                    <button
                      onClick={() => { setShowReleaseNotes(true); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                    >
                      What's New
                    </button>
                    <button
                      onClick={() => { startTour(); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                    >
                      Take Tour
                    </button>
                    {import.meta.env.DEV && (
                      <button
                        onClick={() => { setView('debug'); setShowUserMenu(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                      >
                        Debug
                      </button>
                    )}
                    <div className="border-t border-[#3a424d] my-1" />
                    <button
                      onClick={() => { auth.logout(); setShowUserMenu(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-[#363d47] hover:text-red-300 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Sub-tab bar — shows tabs for the current area (only if >1 tab) */}
        {!STANDALONE_VIEWS.has(view) && getVisibleTabs(currentArea).length > 1 && (
          <div className="border-b border-[#3a424d] px-6 py-1.5 bg-[#2a2f36]">
            <div className="flex items-center gap-1">
              {getVisibleTabs(currentArea).map((tab) => (
                <button
                  key={tab.view}
                  onClick={() => { setView(tab.view); if (currentArea === 'servicedesk') setSdFilter(null); }}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    view === tab.view && sdFilter === null
                      ? 'bg-[#363d47] text-neutral-100 font-medium'
                      : 'text-neutral-500 hover:text-neutral-300 hover:bg-[#363d47]/50'
                  }`}
                >
                  {tab.label}
                  {tab.view === 'ai-approvals' && approvalBadge > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-400">{approvalBadge}</span>
                  )}
                  {tab.view === 'agent-workspace' && flaggedBadge > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-400">{flaggedBadge}</span>
                  )}
                </button>
              ))}

              {/* Service Desk right-side pills (global views) */}
              {currentArea === 'servicedesk' && (
                <div className="ml-auto flex items-center gap-1">
                  {([
                    { value: 'unassigned' as OwnershipFilter, label: 'Unassigned' },
                    { value: 'problems' as OwnershipFilter, label: 'Problem Tickets' },
                    { value: 'all' as OwnershipFilter, label: 'All Tickets List' },
                    { value: 'all-kanban' as OwnershipFilter, label: 'All Tickets Kanban' },
                    { value: 'all-breached' as OwnershipFilter, label: 'All Breached' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSdFilter(sdFilter === opt.value ? null : opt.value)}
                      className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
                        sdFilter === opt.value
                          ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                          : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {sdFilter && sdFilter !== 'all-breached' && sdFilter !== 'problems' && sdFilter !== 'all-kanban' && (
                    <span className="text-[10px] text-neutral-500 ml-2">
                      {filteredSdTasks.length} ticket{filteredSdTasks.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {/* Issue type filter dropdown */}
                  {sdIssueTypes.length > 1 && sdFilter !== 'problems' && (
                    <select
                      value={sdIssueTypeFilter ?? ''}
                      onChange={e => setSdIssueTypeFilter(e.target.value || null)}
                      className="ml-2 px-2 py-1 text-[11px] rounded bg-[#2f353d] text-neutral-400 border border-[#3a424d] focus:outline-none focus:border-[#5ec1ca]"
                    >
                      <option value="">All Types</option>
                      {sdIssueTypes.map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    className="px-2 py-1 text-[11px] text-neutral-500 hover:text-[#5ec1ca] transition-colors disabled:opacity-50 flex items-center gap-1 ml-2"
                    title="Refresh data"
                  >
                    <span className={`inline-block text-xs ${refreshing ? 'animate-spin' : ''}`}>{'\u21BB'}</span>
                  </button>
                </div>
              )}
              {/* Manual refresh button (non-SD areas) */}
              {currentArea !== 'servicedesk' && (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    className="px-2 py-1 text-[11px] text-neutral-500 hover:text-[#5ec1ca] transition-colors disabled:opacity-50 flex items-center gap-1"
                    title="Refresh data"
                  >
                    <span className={`inline-block text-xs ${refreshing ? 'animate-spin' : ''}`}>{'\u21BB'}</span>
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        <main className={`flex-1 px-6 py-6 mx-auto w-full ${isFullWidth ? 'max-w-full' : 'max-w-4xl'}`}>
        <Suspense fallback={<div className="flex items-center justify-center py-20 text-zinc-400">Loading...</div>}>
          {/* Service Desk — right pill overrides left tab content */}
          {currentArea === 'servicedesk' && sdFilter === 'all-breached' && (
            <NeedsAttentionView onUpdateTask={updateTask} scope="all" />
          )}
          {currentArea === 'servicedesk' && sdFilter === 'problems' && (
            <ProblemTicketsView />
          )}
          {currentArea === 'servicedesk' && sdFilter === 'all-kanban' && (
            <ServiceDeskKanban tasks={filteredSdTasks} onUpdateTask={updateTask} onRefresh={refreshSdTasks} />
          )}
          {currentArea === 'servicedesk' && sdFilter && sdFilter !== 'all-breached' && sdFilter !== 'problems' && sdFilter !== 'all-kanban' && (
            <div className="max-w-5xl mx-auto">
              {error && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}
              <TaskList tasks={filteredSdTasks} loading={sdLoading} onUpdateTask={updateTask} minimal />
            </div>
          )}
          {/* My Tickets + AI Approvals moved to NOVA AI Agent area */}
          {view === 'kanban' && !sdFilter && (
            <ServiceDeskKanban tasks={filteredSdTasks} onUpdateTask={updateTask} onRefresh={refreshSdTasks} />
          )}
          {view === 'sd-calendar' && !sdFilter && (
            <ServiceDeskCalendar tasks={filteredSdTasks} onUpdateTask={updateTask} />
          )}
          {view === 'attention' && !sdFilter && (
            <NeedsAttentionView onUpdateTask={updateTask} scope="mine" />
          )}
          {view === 'sd-dashboard' && !sdFilter && (
            <ServiceDeskDashboard />
          )}
          {/* ai-approvals moved to NOVA AI Agent area */}
          {/* KPIs */}
          {view === 'kpi-dashboard' && (
            <KpiDashboardView />
          )}
          {view === 'kpi-data' && (
            <KpiDataView />
          )}
          {view === 'kpi-compare' && (
            <KpiComparisonView />
          )}
          {view === 'kpi-leaderboard' && (
            <KpiLeaderboardView />
          )}
          {view === 'kpi-daily-history' && (
            <KpiDailyHistoryView />
          )}
          {view === 'kpi-breached' && (
            <KpiBreachedView />
          )}
          {view === 'kpi-trends' && (
            <TrendsView />
          )}
          {view === 'kpi-escalations' && (
            <EscalationReportView />
          )}
          {view === 'risk-intelligence' && (
            <RiskIntelligenceView />
          )}
          {view === 'qa' && (
            <QAView />
          )}
          {view === 'backfill-status' && (
            <BackfillStatusView />
          )}
          {view === 'kpi-team-breached' && (
            <iframe
              src="/wallboard/team-kpis"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Team KPI Breach Board"
            />
          )}
          {view === 'agent-kpis' && (
            <AgentKpisView />
          )}

          {/* KPIs (Rebuild) — Layer 1 org KPIs */}
          {view === 'kpi-rebuild-support' && (
            <SupportKpiScorecard />
          )}
          {view === 'kpi-rebuild-agents' && (
            <AgentScorecardRebuild />
          )}
          {view === 'kpi-rebuild-leaderboard' && (
            <LeaderboardRebuild />
          )}
          {view === 'kpi-rebuild-history' && (
            <KpiRebuildHistory />
          )}
          {view === 'kpi-rebuild-trends' && (
            <KpiRebuildTrends />
          )}
          {view === 'kpi-rebuild-operational' && (
            <OperationalIndicators />
          )}
          {view === 'kpi-rebuild-legacy' && (
            <KpiRebuildLegacy />
          )}
          {view === 'tpj-maintenance' && (
            <TpjMaintenanceView />
          )}

          {/* Wallboards */}
          {view === 'wb-breached' && (
            <iframe
              src="/wallboard/breached"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="SLA Breach Board"
            />
          )}
          {view === 'wb-team-kpis' && (
            <iframe
              src="/wallboard/team-kpis"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="KPI Breach Board"
            />
          )}
          {view === 'wb-cc' && (
            <iframe
              src="/wallboard/cc"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Customer Care"
            />
          )}
          {view === 'wb-tech-support' && (
            <iframe
              src="/wallboard/tech-support"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Technical Support"
            />
          )}
          {view === 'wb-key-accounts' && (
            <iframe
              src="/wallboard/key-accounts"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Key Accounts"
            />
          )}
          {view === 'wb-customer-success' && (
            <iframe
              src="/wallboard/customer-success"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Customer Success"
            />
          )}
          {view === 'wb-dev-review' && (
            <iframe
              src="/wallboard/dev-review"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Dev Review Wallboard"
            />
          )}
          {view === 'wb-ricky' && (
            <iframe
              src="/wallboard/ricky"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Tech Support Risk Board"
            />
          )}

          {view === 'wb-support' && (
            <iframe
              src="/wallboard/support"
              style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none', borderRadius: '12px' }}
              title="Support KPIs Wallboard"
            />
          )}

          {/* Onboarding */}
          {view === 'ob-dashboard' && (
            <OnboardingDashboard />
          )}
          {view === 'delivery' && (
            <DeliveryView canWrite={areaAccess.onboarding === 'edit'} canPushGit={areaAccess.azdo_push === 'edit'} />
          )}
          {view === 'ob-overdue' && (
            <OverdueDeliveriesView />
          )}
          {view === 'ob-calendar' && (
            <OnboardingCalendar />
          )}
          {view === 'onboarding-config' && (
            <OnboardingConfigView readOnly />
          )}

          {/* Account Management */}
          {view === 'crm' && (
            <CrmView canWrite={areaAccess.accounts === 'edit'} />
          )}
          {view === 'contracts' && (
            <ContractsView />
          )}

          {view === 'adobe-sign' && (
            <AdobeSignView />
          )}

          {view === 'new-contract' && (
            <NewContractWizard onNavigateToAgreements={() => setView('adobe-sign')} />
          )}

          {/* Sales Hotbox */}
          {view === 'sales-hotbox' && (
            <SalesHotboxView canWrite={areaAccess.sales === 'edit'} />
          )}

          {/* People */}
          {view === 'people-roster' && (
            <AgentRosterView onSelectAgent={(name) => { setSelectedAgentName(name); setView('people-profile' as View); }} />
          )}
          {view === 'people-profile' && (
            <AgentProfileView
              agentName={selectedAgentName}
              userRole={auth.user?.role}
              onNavigate={navigate}
            />
          )}
          {view === 'surveys' && (
            <SurveyAdminView userRole={auth.user?.role} />
          )}
          {view === 'people-121-setup' && (
            <OneToOneSetupView />
          )}
          {view === 'people-121-overview' && (
            <OneToOneOverviewView />
          )}

          {/* Training */}
          {view === 'training-matrix' && (
            <TrainingMatrixView userId={auth.user?.id ?? 0} isAdmin={areaAccess.admin === 'edit'} />
          )}
          {view === 'training-summary' && (
            <TrainingSummaryView />
          )}

          {/* Board MI — gated by 'mi' permission area */}
          {view === 'board-mi' && canSeeArea('board') && (
            <BoardMiView />
          )}

          {/* Backlog Kanban */}
          {view === 'backlog-board' && (
            <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
              <BacklogKanbanView canWrite={areaAccess.backlog === 'edit'} />
            </Suspense>
          )}

          {view === 'standup-board' && canSeeArea('standup') && (
            <Suspense fallback={<div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" /></div>}>
              <StandupView token={auth.token!} />
            </Suspense>
          )}

          {/* Dev Review Queue — developer + admin */}
          {view === 'dev-review' && canSeeArea('devreview') && (
            <div className="h-[calc(100vh-120px)] -mx-6 -my-6 overflow-hidden">
              <DevReviewQueueView />
            </div>
          )}
          {view === 'dev-review-dashboard' && canSeeArea('devreview') && (
            <DevReviewDashboard />
          )}

          {/* CALYX SHELVED — all Calyx view rendering commented out */}

          {/* NOVA AI Agent */}
          {view === 'tickets' && canSeeArea('ai-agent') && auth.user && (
            <div className="h-[calc(100vh-120px)] -mx-6 -my-6 overflow-hidden">
              <MyTicketsQueueView
                tasks={filteredSdTasks}
                loading={sdLoading}
                onUpdateTask={updateTask}
                agentUsername={auth.user.username}
                agentDisplayName={auth.user.display_name ?? auth.user.username}
              />
            </div>
          )}
          {view === 'ai-approvals' && canSeeArea('ai-agent') && (
            <div className="h-[calc(100vh-120px)] -mx-6 -my-6 overflow-hidden">
              <ApprovalQueueView canInteract={(areaAccess['ai_approvals'] || 'hidden') === 'edit'} onNavigateToAgent={(ticketId) => {
                sessionStorage.setItem('agent_pending_ticket', ticketId);
                setView('agent-dashboard');
              }} />
            </div>
          )}
          {view === 'agent-workspace' && canSeeArea('ai-agent') && (
            <AgentWorkspaceView />
          )}
          {view === 'agent-dashboard' && canSeeArea('ai-agent') && (
            <AgentDashboardView userRole={auth.user?.role ?? ''} onNavigateToWorkspace={(filter) => {
              if (filter.aiAction) sessionStorage.setItem('agent_workspace_filter', JSON.stringify(filter));
              setView('agent-workspace');
            }} />
          )}
          {view === 'agent-coaching' && canSeeArea('ai-agent') && (
            <AgentCoachingView />
          )}
          {view === 'agent-manager' && canSeeArea('ai-agent') && (
            <ManagerDashboardView />
          )}
          {view === 'agent-pipelines' && canSeeArea('ai-agent') && (
            <AgentPipelinesView />
          )}
          {view === 'agent-uat-compare' && canSeeArea('ai-agent') && (
            <UatComparisonView />
          )}
          {view === 'agent-kb-gaps' && canSeeArea('ai-agent') && (
            <KbGapsView token={auth.token!} />
          )}
          {view === 'agent-learnings' && canSeeArea('ai-agent') && (
            <AgentLearningsView token={auth.token!} />
          )}
          {view === 'agent-kb-health' && canSeeArea('ai-agent') && (
            <KbHealthView />
          )}
          {view === 'agent-training' && canSeeArea('ai-agent') && (
            <TrainingSignalsView />
          )}
          {view === 'agent-capacity' && canSeeArea('ai-agent') && (
            <CapacityView />
          )}
          {view === 'agent-intelligence' && canSeeArea('ai-agent') && (
            <IntelligenceView />
          )}
          {view === 'agent-impact' && canSeeArea('ai-agent') && (
            <AgentImpactView />
          )}
          {view === 'agent-ops-pack' && canSeeArea('ai-agent') && (
            <OpsPackView />
          )}
          {view === 'agent-121' && canSeeArea('ai-agent') && selectedAgentName && (
            <Suspense fallback={<div className="animate-pulse h-48 bg-gray-800 rounded-lg" />}>
              <Briefing121View agentId={selectedAgentName} agentName={selectedAgentName} />
            </Suspense>
          )}

          {/* Administration */}
          {view === 'settings' && (
            <SettingsView />
          )}
          {view === 'admin-panel' && (
            <AdminView />
          )}
          {view === 'admin-contract-terms' && (
            <Suspense fallback={<div className="animate-pulse h-48 bg-gray-800 rounded-lg" />}>
              <AdminContractTermsView />
            </Suspense>
          )}
          {view === 'portal-admin' && (
            <Suspense fallback={<div className="animate-pulse h-48 bg-gray-800 rounded-lg" />}>
              <PortalAdminView />
            </Suspense>
          )}
          {view === 'my-feedback' && (
            <MyFeedbackView />
          )}

          {/* Standalone views */}
          {view === 'help' && (
            <HelpView />
          )}
          {view === 'debug' && (
            <DebugView
              tasks={tasks}
              loading={loading}
              syncing={syncing}
              error={error}
              apiDebug={apiDebug}
              lastSuggest={lastSuggest}
              spDebug={spDebug}
              spDebugLoading={spDebugLoading}
              setSpDebugLoading={setSpDebugLoading}
              setSpDebug={setSpDebug}
              d365Debug={d365Debug}
            />
          )}
        </Suspense>
        </main>

        {/* Status bar */}
        <StatusBar health={health} />
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      {showReleaseNotes && <ReleaseNotesModal onClose={() => setShowReleaseNotes(false)} />}
      <TourOverlay show={showTour} onClose={closeTour} />
      {wbDrill && (
        <WallboardDrillPanel
          kpi={wbDrill.kpi}
          agent={wbDrill.agent}
          bucket={wbDrill.bucket}
          stat={wbDrill.stat}
          cohort={wbDrill.cohort}
          accountId={wbDrill.accountId}
          label={wbDrill.label}
          onClose={() => setWbDrill(null)}
        />
      )}
    </ErrorBoundary>
  );
}

// ── Debug View (extracted to keep App clean) ──

function DebugView({
  tasks, loading, syncing, error, apiDebug, lastSuggest, spDebug, spDebugLoading, setSpDebugLoading, setSpDebug, d365Debug,
}: {
  tasks: unknown[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  apiDebug: Array<{ ts: string; text: string }>;
  lastSuggest: string;
  spDebug: Record<string, unknown> | null;
  spDebugLoading: boolean;
  setSpDebugLoading: (v: boolean) => void;
  setSpDebug: (v: Record<string, unknown>) => void;
  d365Debug: Array<{ ts: string; text: string }>;
}) {
  return (
    <div className="space-y-4">
      <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Debug Summary</div>
        <div className="text-sm text-neutral-200 space-y-1">
          <div>Tasks: {tasks.length}</div>
          <div>Loading: {String(loading)}</div>
          <div>Syncing: {String(syncing)}</div>
          <div>Error: {error ?? 'none'}</div>
        </div>
      </div>
      <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">API Debug (AI Actions)</div>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[260px] whitespace-pre-wrap">
          {apiDebug.length === 0
            ? 'No AI debug entries yet. Run NOVA Insights to populate.'
            : apiDebug.map((e) => `${e.ts}  ${e.text}`).join('\n\n')}
        </pre>
        <div className="mt-3 text-[11px] text-neutral-400 whitespace-pre-wrap">
          {lastSuggest ? `Last Suggest: ${lastSuggest}` : 'Last Suggest: none'}
        </div>
      </div>
      <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-neutral-500 uppercase tracking-wider">SharePoint Sync Debug</div>
          <button
            onClick={async () => {
              setSpDebugLoading(true);
              try {
                const res = await fetch('/api/delivery/sync/debug');
                const json = await res.json();
                if (json.ok) setSpDebug(json.data);
              } catch { /* ignore */ }
              setSpDebugLoading(false);
            }}
            className="px-2 py-1 text-[10px] rounded bg-[#363d47] text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {spDebugLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        {spDebug ? (
          spDebug._error ? (
            <div className="text-[11px] text-red-400">Error: {String(spDebug._error)}</div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-3 text-[11px]">
                {(['registered', 'connected', 'available'] as const).map((k) => (
                  <div key={k}>
                    <span className="text-neutral-500">{k}: </span>
                    <span className={spDebug[k] ? 'text-green-400' : 'text-red-400'}>
                      {String(spDebug[k])}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-[11px]">
                <div className="text-neutral-500 mb-0.5">Site path:</div>
                <code className="text-neutral-300">{String(spDebug.sitePath)}</code>
              </div>
              <div className="text-[11px]">
                <div className="text-neutral-500 mb-0.5">File path:</div>
                <code className="text-neutral-300">{String(spDebug.filePath)}</code>
              </div>
              <div className="text-[11px]">
                <div className="text-neutral-500 mb-0.5">
                  All msgraph tools ({Array.isArray(spDebug.allMsgraphTools) ? spDebug.allMsgraphTools.length : 0}):
                </div>
                <pre className="text-[10px] text-neutral-400 overflow-auto max-h-[120px] whitespace-pre-wrap">
                  {Array.isArray(spDebug.allMsgraphTools) && spDebug.allMsgraphTools.length > 0
                    ? (spDebug.allMsgraphTools as string[]).join('\n')
                    : 'none'}
                </pre>
              </div>
              <div className="text-[11px]">
                <div className="text-neutral-500 mb-0.5">
                  SP-relevant tools ({Array.isArray(spDebug.spRelevantTools) ? spDebug.spRelevantTools.length : 0}):
                </div>
                <pre className="text-[10px] text-[#5ec1ca] overflow-auto max-h-[80px] whitespace-pre-wrap">
                  {Array.isArray(spDebug.spRelevantTools) && spDebug.spRelevantTools.length > 0
                    ? (spDebug.spRelevantTools as string[]).join('\n')
                    : 'none'}
                </pre>
              </div>
              {spDebug.lastAttempt ? (
                <div className="text-[11px]">
                  <span className="text-neutral-500">Last attempt: </span>
                  <span className="text-neutral-300">{String(spDebug.lastAttempt)}</span>
                </div>
              ) : null}
              {spDebug.lastResult ? (
                <div className="text-[11px]">
                  <div className="text-neutral-500 mb-0.5">Last result:</div>
                  <pre className="text-[10px] text-neutral-300 overflow-auto max-h-[200px] whitespace-pre-wrap bg-[#272C33] rounded p-2">
                    {JSON.stringify(spDebug.lastResult, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="text-[11px] text-neutral-600">Loading SP debug info...</div>
        )}
      </div>
      <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">D365 Sync Debug</div>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[260px] whitespace-pre-wrap">
          {d365Debug.length === 0
            ? 'No D365 debug entries yet. Run a D365 sync from the CRM page to populate.'
            : d365Debug.map((e) => `${e.ts}  ${e.text}`).join('\n\n')}
        </pre>
      </div>
      <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Sample Task</div>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[420px]">
          {JSON.stringify(tasks[0] ?? null, null, 2)}
        </pre>
      </div>
      <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Raw Data Sample</div>
        <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[420px]">
          {JSON.stringify((tasks[0] as Record<string, unknown>)?.raw_data ?? null, null, 2)}
        </pre>
      </div>
    </div>
  );
}
