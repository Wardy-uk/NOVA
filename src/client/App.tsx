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
import { StatusBar } from './components/StatusBar.js';
import { useTasks, useHealth } from './hooks/useTasks.js';
import { useTheme, type Theme } from './hooks/useTheme.js';
import { useAuth } from './hooks/useAuth.js';

type View = 'tasks' | 'focus' | 'settings' | 'standup' | 'daily' | 'kpis' | 'delivery' | 'crm' | 'debug';

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
  const standupChecked = useRef(false);

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

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#272C33] text-neutral-100 flex flex-col">
        {/* Header */}
        <header className="border-b border-[#3a424d] px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight font-[var(--font-heading)]">
              <span className="text-[#5ec1ca]">N.O.V.A</span>
            </h1>
            <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-medium">
              Nurtur Operational Virtual Assistant
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('daily')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'daily'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              Command Centre
            </button>
            <button
              onClick={() => setView('focus')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'focus'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              My Focus
            </button>
            <button
              onClick={() => setView('tasks')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'tasks'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setView('standup')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'standup'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              Standup
            </button>
            <button
              onClick={() => setView('kpis')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'kpis'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              KPIs
            </button>
            <button
              onClick={() => setView('delivery')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'delivery'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              Delivery
            </button>
            <button
              onClick={() => setView('crm')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'crm'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              CRM
            </button>
            <button
              onClick={() => setView('settings')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'settings'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              Settings
            </button>
            {/* Theme toggle */}
            <div className="flex items-center bg-[#2f353d] rounded border border-[#3a424d] ml-2">
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
            {import.meta.env.DEV && (
              <button
                onClick={() => setView('debug')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  view === 'debug'
                    ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                    : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
                }`}
              >
                Debug
              </button>
            )}
            {/* User / Logout */}
            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[#3a424d]">
              <span className="text-[10px] text-neutral-500">
                {auth.user?.display_name || auth.user?.username}
              </span>
              <button
                onClick={auth.logout}
                className="px-2 py-1 text-[10px] text-neutral-400 hover:text-red-400 rounded transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className={`flex-1 px-6 py-6 mx-auto w-full ${view === 'delivery' ? 'max-w-full' : 'max-w-4xl'}`}>
          {view === 'tasks' ? (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
                  {error}
                </div>
              )}
              <TaskList
                tasks={tasks}
                loading={loading}
                onUpdateTask={updateTask}
              />
            </>
          ) : view === 'focus' ? (
            <MyFocusView tasks={tasks} onUpdateTask={updateTask} />
          ) : view === 'standup' ? (
            <StandupView
              onUpdateTask={updateTask}
              onNavigate={(v) => setView(v as View)}
            />
          ) : view === 'daily' ? (
            <DailyStatsView tasks={tasks} onNavigate={(v) => setView(v as View)} />
          ) : view === 'kpis' ? (
            <KpisView tasks={tasks} />
          ) : view === 'delivery' ? (
            <DeliveryView />
          ) : view === 'crm' ? (
            <CrmView />
          ) : view === 'settings' ? (
            <SettingsView />
          ) : (
            <div className="space-y-4">
              <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                  Debug Summary
                </div>
                <div className="text-sm text-neutral-200 space-y-1">
                  <div>Tasks: {tasks.length}</div>
                  <div>Loading: {String(loading)}</div>
                  <div>Syncing: {String(syncing)}</div>
                  <div>Error: {error ?? 'none'}</div>
                </div>
              </div>
              <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                  API Debug (AI Actions)
                </div>
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
                  <div className="text-xs text-neutral-500 uppercase tracking-wider">
                    SharePoint Sync Debug
                  </div>
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
                      <div>
                        <span className="text-neutral-500">Registered: </span>
                        <span className={spDebug.registered ? 'text-green-400' : 'text-red-400'}>
                          {String(spDebug.registered)}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Connected: </span>
                        <span className={spDebug.connected ? 'text-green-400' : 'text-red-400'}>
                          {String(spDebug.connected)}
                        </span>
                      </div>
                      <div>
                        <span className="text-neutral-500">Available: </span>
                        <span className={spDebug.available ? 'text-green-400' : 'text-red-400'}>
                          {String(spDebug.available)}
                        </span>
                      </div>
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
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                  Sample Task
                </div>
                <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[420px]">
                  {JSON.stringify(tasks[0] ?? null, null, 2)}
                </pre>
              </div>
              <div className="border border-[#3a424d] rounded-lg p-4 bg-[#2f353d]">
                <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                  Raw Data Sample
                </div>
                <pre className="text-[11px] text-neutral-300 overflow-auto max-h-[420px]">
                  {JSON.stringify(tasks[0]?.raw_data ?? null, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </main>

        {/* Status bar */}
        <StatusBar health={health} />
      </div>
    </ErrorBoundary>
  );
}
