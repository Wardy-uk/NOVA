import { useState, useEffect, useCallback } from 'react';
import type { Task, ApiResponse, HealthResponse } from '../../shared/types.js';

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const json: ApiResponse<Task[]> = await res.json();
      if (json.ok && json.data) {
        setTasks(json.data);
        setError(null);
      } else {
        setError(json.error ?? 'Failed to fetch tasks');
      }
    } catch {
      setError('Cannot reach server');
    } finally {
      setLoading(false);
    }
  }, []);

  const syncTasks = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch('/api/tasks/sync', { method: 'POST' });
      await fetchTasks();
    } catch {
      setError('Sync failed');
    } finally {
      setSyncing(false);
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
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, error, syncing, fetchTasks, syncTasks, updateTask };
}

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('/api/health');
        const json = await res.json();
        setHealth(json);
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
