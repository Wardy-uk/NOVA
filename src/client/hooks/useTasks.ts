import { useState, useEffect, useCallback, useRef } from 'react';
import type { Task, ApiResponse, HealthResponse } from '../../shared/types.js';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const initialLoadDone = useRef(false);

  // Silent fetch — updates data without triggering loading states.
  // Only calls setTasks when data actually changed to avoid re-renders that close drawers.
  const lastJson = useRef('');
  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const json: ApiResponse<Task[]> = await res.json();
      if (json.ok && json.data) {
        const serialized = JSON.stringify(json.data);
        if (serialized !== lastJson.current) {
          lastJson.current = serialized;
          setTasks(json.data);
        }
        setError(null);
      }
    } catch {
      // Silent — don't flash errors on background refresh
    } finally {
      // Only clear loading on initial fetch
      if (!initialLoadDone.current) {
        setLoading(false);
        initialLoadDone.current = true;
      }
    }
  }, []);

  // Sync: only shows syncing indicator on manual trigger, not background
  const syncTasks = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    try {
      await fetch('/api/tasks/sync', { method: 'POST' });
      await fetchTasks();
    } catch {
      if (!silent) setError('Sync failed');
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [fetchTasks]);

  const updateTask = useCallback(
    async (id: string, updates: Record<string, unknown>) => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        const json: ApiResponse<Task> = await res.json();
        if (json.ok && json.data) {
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? json.data! : t))
          );
        }
      } catch {
        setError('Update failed');
      }
    },
    []
  );

  useEffect(() => {
    // Initial sync (silent — no syncing spinner, just populates data)
    syncTasks(true);
    // Background poll every 30s — silent, no UI disruption
    const interval = setInterval(fetchTasks, 30_000);
    return () => clearInterval(interval);
  }, [fetchTasks, syncTasks]);

  return { tasks, loading, error, syncing, fetchTasks, syncTasks, updateTask };
}

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) return;
        const json = await res.json();
        if (json.servers) setHealth(json);
      } catch {
        /* server unreachable */
      }
    };
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  return health;
}
