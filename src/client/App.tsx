import { useState } from 'react';
import { TaskList } from './components/TaskList.js';
import { SettingsView } from './components/SettingsView.js';
import { StatusBar } from './components/StatusBar.js';
import { useTasks, useHealth } from './hooks/useTasks.js';

type View = 'tasks' | 'settings';

export function App() {
  const [view, setView] = useState<View>('tasks');
  const { tasks, loading, error, syncing, syncTasks, updateTask } = useTasks();
  const health = useHealth();

  return (
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
        ) : (
          <SettingsView />
        )}
      </main>

      {/* Status bar */}
      <StatusBar health={health} />
    </div>
  );
}
