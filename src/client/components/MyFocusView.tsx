import { useState, useMemo, useCallback } from 'react';
import type { Task } from '../../shared/types.js';
import { TaskCard } from './TaskCard.js';
import { TaskDrawer } from './TaskDrawer.js';

interface Props {
  tasks: Task[];
  onUpdateTask: (id: string, updates: Record<string, unknown>) => void;
}

export function MyFocusView({ tasks, onUpdateTask }: Props) {
  const focused = useMemo(() => tasks.filter((t) => t.is_pinned), [tasks]);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

  const drawerIndex = useMemo(() => {
    if (!drawerTaskId) return -1;
    return focused.findIndex((t) => t.id === drawerTaskId);
  }, [drawerTaskId, focused]);

  const drawerTask = drawerIndex >= 0 ? focused[drawerIndex] : null;

  const openDrawer = useCallback((taskId: string) => setDrawerTaskId(taskId), []);
  const closeDrawer = useCallback(() => setDrawerTaskId(null), []);
  const prevDrawer = useCallback(() => {
    if (drawerIndex > 0) setDrawerTaskId(focused[drawerIndex - 1].id);
  }, [drawerIndex, focused]);
  const nextDrawer = useCallback(() => {
    if (drawerIndex < focused.length - 1) setDrawerTaskId(focused[drawerIndex + 1].id);
  }, [drawerIndex, focused]);

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
          My Focus
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">{today}</p>
      </div>

      {focused.length === 0 ? (
        <div className="border border-[#3a424d] rounded-lg px-6 py-12 bg-[#2f353d] text-center">
          <div className="text-neutral-400 text-sm mb-2">No focused tasks yet</div>
          <p className="text-xs text-neutral-500">
            Add tasks from the Tasks view, Ask N.O.V.A, or Standup to build your workstream.
          </p>
        </div>
      ) : (
        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
              Focused Tasks
            </h3>
            <span className="text-xs text-neutral-500">
              {focused.length} {focused.length === 1 ? 'task' : 'tasks'}
            </span>
          </div>
          <div className="space-y-1">
            {focused.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onUpdate={onUpdateTask}
                onClick={() => openDrawer(task.id)}
              />
            ))}
          </div>
        </div>
      )}

      {drawerTask && (
        <TaskDrawer
          task={drawerTask}
          index={drawerIndex}
          total={focused.length}
          onClose={closeDrawer}
          onPrev={prevDrawer}
          onNext={nextDrawer}
          onTaskUpdated={() => {
            onUpdateTask(drawerTask.id, {});
          }}
        />
      )}
    </div>
  );
}
