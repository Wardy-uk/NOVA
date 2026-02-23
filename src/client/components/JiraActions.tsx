import { useState } from 'react';

export function JiraActions() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [projectKey, setProjectKey] = useState('');
  const [issueType, setIssueType] = useState('Task');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');

  const create = async () => {
    if (!projectKey.trim() || !summary.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_key: projectKey.toUpperCase(),
          issue_type: issueType,
          summary,
          description,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Failed to create issue');
        return;
      }
      const key = json.data?.key ?? json.data?.id ?? 'Issue';
      setSuccess(`Created ${key}`);
      setSummary('');
      setDescription('');
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[#3a424d]">
        <span className="text-xs font-semibold text-neutral-200">Create Jira Issue</span>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-3 p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-3 p-2 bg-green-950/50 border border-green-900 rounded text-green-400 text-xs">
            {success}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">
                Project Key
              </label>
              <input
                value={projectKey}
                onChange={(e) => setProjectKey(e.target.value)}
                placeholder="e.g. NT"
                className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">
                Issue Type
              </label>
              <select
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
                className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
              >
                <option value="Task">Task</option>
                <option value="Bug">Bug</option>
                <option value="Story">Story</option>
                <option value="Epic">Epic</option>
                <option value="Sub-task">Sub-task</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">
              Summary
            </label>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Issue summary..."
              className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none resize-none h-20"
            />
          </div>
          <button
            onClick={create}
            disabled={loading || !projectKey.trim() || !summary.trim()}
            className="w-full px-4 py-2.5 text-sm font-semibold bg-[#5ec1ca] text-[#272C33] rounded border border-[#4ba8b0] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'Create Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}
