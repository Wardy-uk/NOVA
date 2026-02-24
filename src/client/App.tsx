import { useState, useEffect, useRef, useMemo, Component, type ReactNode } from 'react';
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
import { ServiceDeskKanban } from './components/ServiceDeskKanban.js';
import { ServiceDeskCalendar } from './components/ServiceDeskCalendar.js';
import { NextActions } from './components/NextActions.js';
import { StatusBar } from './components/StatusBar.js';
import { FeedbackModal } from './components/FeedbackModal.js';
import { useTasks, useHealth } from './hooks/useTasks.js';
import { useTheme, type Theme } from './hooks/useTheme.js';
import { useAuth } from './hooks/useAuth.js';
import { filterByOwnership, type OwnershipFilter } from './utils/taskHelpers.js';

// ── Area / View definitions ──

type Area = 'command' | 'servicedesk' | 'onboarding' | 'accounts' | 'admin';
type View = 'daily' | 'focus' | 'tasks' | 'standup' | 'kpis'
  | 'tickets' | 'kanban' | 'sd-calendar'
  | 'delivery' | 'onboarding-config'
  | 'crm'
  | 'settings' | 'admin-panel'
  | 'help' | 'debug';

interface AreaDef {
  label: string;
  defaultView: View;
  tabs: Array<{ view: View; label: string }>;
  role?: 'admin' | 'editor'; // minimum role to see this area
  hidden?: boolean; // hide from top nav (accessed via user menu)
}

const AREAS: Record<Area, AreaDef> = {
  command: {
    label: 'Command Centre',
    defaultView: 'daily',
    tabs: [
      { view: 'daily', label: 'Dashboard' },
      { view: 'focus', label: 'My Focus' },
      { view: 'tasks', label: 'Tasks' },
      { view: 'standup', label: 'Standup' },
      { view: 'kpis', label: 'KPIs' },
    ],
  },
  servicedesk: {
    label: 'Service Desk',
    defaultView: 'tickets',
    tabs: [
      { view: 'tickets', label: 'Tickets' },
      { view: 'kanban', label: 'Kanban' },
      { view: 'sd-calendar', label: 'Calendar' },
    ],
  },
  onboarding: {
    label: 'Onboarding',
    defaultView: 'delivery',
    tabs: [
      { view: 'delivery', label: 'Delivery' },
      { view: 'onboarding-config', label: 'Config' },
    ],
    role: 'editor',
  },
  accounts: {
    label: 'Account Management',
    defaultView: 'crm',
    tabs: [
      { view: 'crm', label: 'CRM' },
    ],
  },
  admin: {
    label: 'Administration',
    defaultView: 'settings',
    tabs: [
      { view: 'settings', label: 'Settings' },
      { view: 'admin-panel', label: 'Admin' },
    ],
    hidden: true, // accessed via user menu instead
  },
};

const AREA_ORDER: Area[] = ['command', 'servicedesk', 'onboarding', 'accounts', 'admin'];

// Derive area from view
function getArea(view: View): Area {
  for (const [area, def] of Object.entries(AREAS) as [Area, AreaDef][]) {
    if (def.tabs.some((t) => t.view === view)) return area;
  }
  return 'command'; // fallback for help/debug
}

// Full-width views (no max-w constraint)
const FULL_WIDTH_VIEWS = new Set<View>(['delivery', 'onboarding-config', 'kanban', 'tickets', 'sd-calendar']);

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
  const [apiDebug, setApiDebug] = useState<Array<{ ts: string; text: string }>>([]);
  const [lastSuggest, setLastSuggest] = useState<string>('');
  const [spDebug, setSpDebug] = useState<Record<string, unknown> | null>(null);
  const [spDebugLoading, setSpDebugLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [sdFilter, setSdFilter] = useState<OwnershipFilter>(() => {
    if (typeof window === 'undefined') return 'mine';
    return (window.localStorage.getItem('nova_sd_filter') as OwnershipFilter) || 'mine';
  });
  const userMenuRef = useRef<HTMLDivElement>(null);
  const standupChecked = useRef(false);

  const currentArea = getArea(view);
  const areaDef = AREAS[currentArea];
  const userRole = auth.user?.role ?? 'viewer';

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

    fetchDebug();
    fetchSpDebug();
    const interval = setInterval(fetchDebug, 5000);
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
    if (typeof window !== 'undefined') window.localStorage.setItem('nova_sd_filter', sdFilter);
  }, [sdFilter]);

  // Navigate helper — used by child components
  const navigate = (v: string) => setView(v as View);

  // Service Desk: filtered Jira tasks by ownership
  const userName = auth.user?.display_name || auth.user?.username || '';
  const sdTasks = useMemo(
    () => filterByOwnership(tasks.filter((t) => t.source === 'jira'), sdFilter, userName),
    [tasks, sdFilter, userName],
  );

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
          error={auth.error}
          loading={auth.busy}
        />
      </ErrorBoundary>
    );
  }

  // Check if user can see an area
  const canSeeArea = (area: Area): boolean => {
    const def = AREAS[area];
    if (!def.role) return true;
    if (def.role === 'editor') return userRole === 'admin' || userRole === 'editor';
    if (def.role === 'admin') return userRole === 'admin';
    return true;
  };

  // Filter admin-panel tab for non-admins
  const getVisibleTabs = (area: Area) => {
    return AREAS[area].tabs.filter((t) => {
      if (t.view === 'admin-panel') return userRole === 'admin';
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
              <h1 className="text-lg font-bold tracking-tight font-[var(--font-heading)]">
                <span className="text-[#5ec1ca]">N.O.V.A</span>
              </h1>

              {/* Area tabs */}
              <nav className="flex items-center gap-1">
                {AREA_ORDER.filter((a) => canSeeArea(a) && !AREAS[a].hidden).map((area) => (
                  <button
                    key={area}
                    onClick={() => setView(AREAS[area].defaultView)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      currentArea === area
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
              <div className="relative ml-1 pl-2 border-l border-[#3a424d]" ref={userMenuRef}>
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
                      Settings
                    </button>
                    {userRole === 'admin' && (
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
        {view !== 'help' && view !== 'debug' && getVisibleTabs(currentArea).length > 1 && (
          <div className="border-b border-[#3a424d] px-6 py-1.5 bg-[#2a2f36]">
            <div className="flex items-center gap-1">
              {getVisibleTabs(currentArea).map((tab) => (
                <button
                  key={tab.view}
                  onClick={() => setView(tab.view)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    view === tab.view
                      ? 'bg-[#363d47] text-neutral-100 font-medium'
                      : 'text-neutral-500 hover:text-neutral-300 hover:bg-[#363d47]/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}

              {/* Service Desk ownership filter */}
              {currentArea === 'servicedesk' && (
                <div className="ml-auto flex items-center gap-1">
                  {([
                    { value: 'mine' as OwnershipFilter, label: 'My Tickets' },
                    { value: 'unassigned' as OwnershipFilter, label: 'Unassigned' },
                    { value: 'all' as OwnershipFilter, label: 'All Tickets' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSdFilter(opt.value)}
                      className={`px-2.5 py-1 text-[11px] rounded-full transition-colors ${
                        sdFilter === opt.value
                          ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                          : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  <span className="text-[10px] text-neutral-500 ml-2">
                    {sdTasks.length} ticket{sdTasks.length !== 1 ? 's' : ''}
                  </span>
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
              <NextActions onUpdateTask={updateTask} />
            </>
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
          {view === 'kpis' && (
            <KpisView tasks={tasks} />
          )}

          {/* Service Desk */}
          {view === 'tickets' && (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}
              <TaskList tasks={sdTasks} loading={loading} onUpdateTask={updateTask} minimal />
            </>
          )}
          {view === 'kanban' && (
            <ServiceDeskKanban tasks={sdTasks} onUpdateTask={updateTask} />
          )}
          {view === 'sd-calendar' && (
            <ServiceDeskCalendar tasks={sdTasks} onUpdateTask={updateTask} />
          )}

          {/* Onboarding */}
          {view === 'delivery' && (
            <DeliveryView userRole={userRole} />
          )}
          {view === 'onboarding-config' && (
            <OnboardingConfigView />
          )}

          {/* Account Management */}
          {view === 'crm' && (
            <CrmView userRole={userRole} />
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
            />
          )}
        </main>

        {/* Status bar */}
        <StatusBar health={health} />
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </ErrorBoundary>
  );
}

// ── Debug View (extracted to keep App clean) ──

function DebugView({
  tasks, loading, syncing, error, apiDebug, lastSuggest, spDebug, spDebugLoading, setSpDebugLoading, setSpDebug,
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
