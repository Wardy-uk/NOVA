import { useState, useEffect, useRef, Component, type ReactNode } from 'react';
import { TaskList } from './components/TaskList.js';
import { SettingsView } from './components/SettingsView.js';
import { StandupView } from './components/StandupView.js';
import { DailyStatsView } from './components/DailyStatsView.js';
import { KpisView } from './components/KpisView.js';
import { DeliveryView } from './components/DeliveryView.js';
import { CrmView } from './components/CrmView.js';
import { MyFocusView } from './components/MyFocusView.js';
import { LoginView } from './components/LoginView.js';
import { HelpView } from './components/HelpView.js';
import { AdminView } from './components/AdminView.js';
import { OnboardingConfigView } from './components/OnboardingConfigView.js';
import { OnboardingCalendar } from './components/OnboardingCalendar.js';
import { ServiceDeskKanban } from './components/ServiceDeskKanban.js';
import { ServiceDeskCalendar } from './components/ServiceDeskCalendar.js';
import { NeedsAttentionView } from './components/NeedsAttentionView.js';
import { NextActions } from './components/NextActions.js';
import { StatusBar } from './components/StatusBar.js';
import { FeedbackModal } from './components/FeedbackModal.js';
import { TourOverlay, useTour } from './components/TourOverlay.js';
import { useTasks, useHealth } from './hooks/useTasks.js';
import { useTheme, type Theme } from './hooks/useTheme.js';
import { useAuth } from './hooks/useAuth.js';
import { type OwnershipFilter } from './utils/taskHelpers.js';

// ── Area / View definitions ──

type Area = 'command' | 'servicedesk' | 'onboarding' | 'accounts';
type View = 'daily' | 'focus' | 'tasks' | 'standup' | 'nova'
  | 'tickets' | 'kanban' | 'sd-calendar' | 'attention'
  | 'delivery' | 'onboarding-config' | 'ob-calendar'
  | 'crm'
  | 'settings' | 'admin-panel'
  | 'help' | 'debug';

// Standalone views that don't belong to any area (no sub-tab bar)
const STANDALONE_VIEWS = new Set<View>(['help', 'debug', 'settings', 'admin-panel']);

interface AreaDef {
  label: string;
  defaultView: View;
  tabs: Array<{ view: View; label: string }>;
}

// Per-area access levels resolved from custom roles
type AccessLevel = 'hidden' | 'view' | 'edit';
interface AreaAccess { [areaId: string]: AccessLevel }

const DEFAULT_AREA_ACCESS: AreaAccess = {
  command: 'view', servicedesk: 'view', onboarding: 'view', accounts: 'view', admin: 'hidden',
};

const AREAS: Record<Area, AreaDef> = {
  command: {
    label: 'My NOVA',
    defaultView: 'daily',
    tabs: [
      { view: 'daily', label: 'Dashboard' },
      { view: 'nova', label: 'Ask N.O.V.A' },
      { view: 'focus', label: 'My Focus' },
      { view: 'tasks', label: 'Tasks' },
      { view: 'standup', label: 'Standup' },
    ],
  },
  servicedesk: {
    label: 'Service Desk',
    defaultView: 'tickets',
    tabs: [
      { view: 'tickets', label: 'My Tickets' },
      { view: 'kanban', label: 'Kanban' },
      { view: 'sd-calendar', label: 'Calendar' },
      { view: 'attention', label: 'My Breached' },
    ],
  },
  onboarding: {
    label: 'Onboarding',
    defaultView: 'delivery',
    tabs: [
      { view: 'delivery', label: 'Delivery' },
      { view: 'ob-calendar', label: 'Milestones' },
      { view: 'onboarding-config', label: 'Onboarding Matrix' },
    ],
  },
  accounts: {
    label: 'Account Management',
    defaultView: 'crm',
    tabs: [
      { view: 'crm', label: 'CRM' },
    ],
  },
};

const AREA_ORDER: Area[] = ['command', 'servicedesk', 'onboarding', 'accounts'];

// Derive area from view (standalone views fall back to 'command')
function getArea(view: View): Area {
  if (STANDALONE_VIEWS.has(view)) return 'command';
  for (const [area, def] of Object.entries(AREAS) as [Area, AreaDef][]) {
    if (def.tabs.some((t) => t.view === view)) return area;
  }
  return 'command';
}

// Full-width views (no max-w constraint)
const FULL_WIDTH_VIEWS = new Set<View>(['delivery', 'onboarding-config', 'ob-calendar', 'kanban', 'tickets', 'sd-calendar', 'attention', 'admin-panel']);

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

export function App() {
  const [view, setView] = useState<View>('daily');
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
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sdFilter, setSdFilter] = useState<OwnershipFilter>(() => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem('nova_sd_filter');
    // Migrate old 'mine' value to null (left tab shows user's own tickets)
    if (!stored || stored === 'mine') return null;
    return stored as OwnershipFilter;
  });
  const userMenuRef = useRef<HTMLDivElement>(null);
  const standupChecked = useRef(false);

  const currentArea = getArea(view);
  const areaDef = AREAS[currentArea];
  const userRole = auth.user?.role ?? 'viewer';

  // Resolved area access from custom roles
  const [areaAccess, setAreaAccess] = useState<AreaAccess>(
    userRole === 'admin'
      ? { command: 'edit', servicedesk: 'edit', onboarding: 'edit', accounts: 'edit', admin: 'edit' }
      : DEFAULT_AREA_ACCESS,
  );
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.token) return;
    fetch('/api/auth/permissions', {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.areaAccess) setAreaAccess(json.data.areaAccess);
      })
      .catch(() => {});
  }, [auth.isAuthenticated, auth.token]);

  // Auto-show tour on first visit
  useEffect(() => {
    if (auth.isAuthenticated) checkFirstVisit();
  }, [auth.isAuthenticated, checkFirstVisit]);

  // Auto-trigger standup on first visit if no morning ritual today
  useEffect(() => {
    if (!auth.isAuthenticated || standupChecked.current) return;
    standupChecked.current = true;
    fetch('/api/standups/today')
      .then((r) => r.json())
      .then((json) => {
        if (json.ok && !json.data.hasMorning) {
          setView('standup');
        }
      })
      .catch(() => {});
  }, [auth.isAuthenticated]);

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

  // Navigate helper — used by child components
  const navigate = (v: string) => setView(v as View);

  // Service Desk: fetch tickets from live Jira search
  // Left tabs (sdFilter=null) use 'mine', right pills use their specific filter
  const [sdTasks, setSdTasks] = useState<typeof tasks>([]);
  const [sdLoading, setSdLoading] = useState(false);
  const sdApiFilter = sdFilter === null ? 'mine' : sdFilter;
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    // Don't fetch ticket list for 'all-breached' — NeedsAttentionView handles its own fetch
    if (sdApiFilter === 'all-breached') return;
    let active = true;
    setSdLoading(true);
    fetch(`/api/tasks/service-desk?filter=${sdApiFilter}`)
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        if (json.ok && json.data) {
          setSdTasks(json.data);
        } else {
          setSdTasks(tasks.filter((t) => t.source === 'jira'));
        }
      })
      .catch(() => {
        if (active) setSdTasks(tasks.filter((t) => t.source === 'jira'));
      })
      .finally(() => { if (active) setSdLoading(false); });
    return () => { active = false; };
  }, [sdApiFilter, auth.isAuthenticated, tasks]);

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

  // Check if user can see an area (uses resolved area access from custom roles)
  const canSeeArea = (area: Area): boolean => {
    return (areaAccess[area] || 'hidden') !== 'hidden';
  };

  const getVisibleTabs = (area: Area) => {
    return AREAS[area].tabs;
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
              <h1 className="text-lg font-bold tracking-tight font-[var(--font-heading)]">
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
                      <button
                        onClick={() => { setView('admin-panel'); setShowUserMenu(false); }}
                        className="w-full text-left px-3 py-2 text-xs text-neutral-300 hover:bg-[#363d47] hover:text-neutral-100 transition-colors"
                      >
                        Admin
                      </button>
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
                </button>
              ))}

              {/* Service Desk right-side pills (global views) */}
              {currentArea === 'servicedesk' && (
                <div className="ml-auto flex items-center gap-1">
                  {([
                    { value: 'unassigned' as OwnershipFilter, label: 'Unassigned' },
                    { value: 'all' as OwnershipFilter, label: 'All Tickets' },
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
                  {sdFilter && sdFilter !== 'all-breached' && (
                    <span className="text-[10px] text-neutral-500 ml-2">
                      {sdTasks.length} ticket{sdTasks.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Main content */}
        <main className={`flex-1 px-6 py-6 mx-auto w-full ${isFullWidth ? 'max-w-full' : 'max-w-4xl'}`}>
          {/* Command Centre */}
          {view === 'daily' && (
            <>
              <DailyStatsView tasks={tasks} onNavigate={navigate} />
              <KpisView tasks={tasks} embedded />
            </>
          )}
          {view === 'nova' && (
            <NextActions onUpdateTask={updateTask} />
          )}
          {view === 'focus' && (
            <MyFocusView tasks={tasks} onUpdateTask={updateTask} />
          )}
          {view === 'tasks' && (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}
              <TaskList tasks={tasks} loading={loading} onUpdateTask={updateTask} />
            </>
          )}
          {view === 'standup' && (
            <StandupView onUpdateTask={updateTask} onNavigate={navigate} />
          )}

          {/* Service Desk — right pill overrides left tab content */}
          {currentArea === 'servicedesk' && sdFilter === 'all-breached' && (
            <NeedsAttentionView onUpdateTask={updateTask} scope="all" />
          )}
          {currentArea === 'servicedesk' && sdFilter && sdFilter !== 'all-breached' && (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}
              <TaskList tasks={sdTasks} loading={sdLoading} onUpdateTask={updateTask} minimal />
            </>
          )}
          {view === 'tickets' && !sdFilter && (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}
              <TaskList tasks={sdTasks} loading={sdLoading} onUpdateTask={updateTask} minimal />
            </>
          )}
          {view === 'kanban' && !sdFilter && (
            <ServiceDeskKanban tasks={sdTasks} onUpdateTask={updateTask} />
          )}
          {view === 'sd-calendar' && !sdFilter && (
            <ServiceDeskCalendar tasks={sdTasks} onUpdateTask={updateTask} />
          )}
          {view === 'attention' && !sdFilter && (
            <NeedsAttentionView onUpdateTask={updateTask} scope="mine" />
          )}

          {/* Onboarding */}
          {view === 'delivery' && (
            <DeliveryView canWrite={areaAccess.onboarding === 'edit'} />
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

          {/* Administration */}
          {view === 'settings' && (
            <SettingsView />
          )}
          {view === 'admin-panel' && (
            <AdminView />
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
        </main>

        {/* Status bar */}
        <StatusBar health={health} />
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
      <TourOverlay show={showTour} onClose={closeTour} />
    </ErrorBoundary>
  );
}

// ── Debug View (extracted to keep App clean) ──

function DebugView({
  tasks, loading, syncing, error, apiDebug, lastSuggest, spDebug, spDebugLoading, setSpDebugLoading, setSpDebug, d365Debug,
}: {
  tasks: Array<{ id: string; raw_data: unknown; [k: string]: unknown }>;
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
            ? 'No AI debug entries yet. Run Ask N.O.V.A to populate.'
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
              {spDebug.lastAttempt && (
                <div className="text-[11px]">
                  <span className="text-neutral-500">Last attempt: </span>
                  <span className="text-neutral-300">{String(spDebug.lastAttempt)}</span>
                </div>
              )}
              {spDebug.lastResult && (
                <div className="text-[11px]">
                  <div className="text-neutral-500 mb-0.5">Last result:</div>
                  <pre className="text-[10px] text-neutral-300 overflow-auto max-h-[200px] whitespace-pre-wrap bg-[#272C33] rounded p-2">
                    {JSON.stringify(spDebug.lastResult, null, 2)}
                  </pre>
                </div>
              )}
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
          {JSON.stringify(tasks[0]?.raw_data ?? null, null, 2)}
        </pre>
      </div>
    </div>
  );
}
