import { useState, useEffect, Component, type ReactNode } from 'react';
import { TaskList } from './components/TaskList.js';
import { SettingsView } from './components/SettingsView.js';
import { StatusBar } from './components/StatusBar.js';
import { useTasks, useHealth } from './hooks/useTasks.js';

type View = 'tasks' | 'settings' | 'debug';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

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
  const [view, setView] = useState<View>('tasks');
  const { tasks, loading, error, syncing, syncTasks, updateTask } = useTasks();
  const health = useHealth();
  const [apiDebug, setApiDebug] = useState<Array<{ ts: string; text: string }>>([]);
  const [lastSuggest, setLastSuggest] = useState<string>('');

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

    fetchDebug();
    const interval = setInterval(fetchDebug, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [view]);

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
              onClick={() => setView('settings')}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                view === 'settings'
                  ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                  : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
              }`}
            >
              Settings
            </button>
            {view === 'tasks' && (
              <button
                onClick={syncTasks}
                disabled={syncing}
                className="px-3 py-1.5 text-xs bg-[#2f353d] hover:bg-[#363d47] text-neutral-300 hover:text-neutral-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-2"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            )}
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
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 px-6 py-6 max-w-4xl mx-auto w-full">
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
