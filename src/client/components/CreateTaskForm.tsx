import { useState } from 'react';

interface Props {
  onCreated?: () => void;
}

export function CreateTaskForm({ onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<'planner' | 'todo'>('planner');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      let url: string;
      let body: Record<string, unknown>;

      if (target === 'planner') {
        url = '/api/o365/planner/tasks';
        body = {
          title: title.trim(),
          ...(description.trim() && { description: description.trim() }),
          ...(dueDate && { dueDateTime: `${dueDate}T00:00:00Z` }),
        };
      } else {
        url = '/api/o365/todo/tasks';
        body = {
          title: title.trim(),
          ...(description.trim() && { body: description.trim() }),
          ...(dueDate && { dueDateTime: { dateTime: `${dueDate}T00:00:00`, timeZone: 'UTC' } }),
        };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Failed to create task');

      setSuccess(`Created in ${target === 'planner' ? 'Planner' : 'To-Do'}`);
      setTitle('');
      setDescription('');
      setDueDate('');
      onCreated?.();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 px-4 py-2 text-xs font-semibold bg-[#5ec1ca] text-[#272C33] rounded border border-[#4ba8b0] hover:bg-[#4db0b9] transition-colors"
      >
        + Create Task
      </button>
    );
  }

  return (
    <div className="mb-4 border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#3a424d] flex items-center justify-between">
        <span className="text-xs font-semibold text-neutral-200">Create Task</span>
        <button
          onClick={() => { setOpen(false); setError(null); setSuccess(null); }}
          className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          Close
        </button>
      </div>

      <div className="p-4 space-y-3">
        {error && (
          <div className="p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">{error}</div>
        )}
        {success && (
          <div className="p-2 bg-green-950/50 border border-green-900 rounded text-green-400 text-xs">{success}</div>
        )}

        {/* Target selector */}
        <div>
          <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1.5">Create in</label>
          <div className="flex gap-2">
            <button
              onClick={() => setTarget('planner')}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                target === 'planner'
                  ? 'bg-green-900/40 border-green-800 text-green-300 font-semibold'
                  : 'bg-[#272C33] border-[#3a424d] text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Planner
            </button>
            <button
              onClick={() => setTarget('todo')}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                target === 'todo'
                  ? 'bg-purple-900/40 border-purple-800 text-purple-300 font-semibold'
                  : 'bg-[#272C33] border-[#3a424d] text-neutral-400 hover:text-neutral-200'
              }`}
            >
              To-Do
            </button>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleCreate()}
            placeholder="Task title..."
            className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional..."
            className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none resize-none h-16"
          />
        </div>

        {/* Due date */}
        <div>
          <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={loading || !title.trim()}
          className="w-full px-4 py-2.5 text-sm font-semibold bg-[#5ec1ca] text-[#272C33] rounded border border-[#4ba8b0] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating...' : `Create in ${target === 'planner' ? 'Planner' : 'To-Do'}`}
        </button>
      </div>
    </div>
  );
}
