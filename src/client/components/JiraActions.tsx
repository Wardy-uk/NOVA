import { useState } from 'react';

interface SearchResult {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  priority?: string;
}

export function JiraActions() {
  const [tab, setTab] = useState<'search' | 'create'>('search');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Search
  const [jql, setJql] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  // Create
  const [projectKey, setProjectKey] = useState('');
  const [issueType, setIssueType] = useState('Task');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');

  const search = async () => {
    if (!jql.trim()) return;
    setLoading(true);
    setError(null);
    setResults([]);
    try {
      const res = await fetch('/api/jira/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql, limit: 20 }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Search failed');
        return;
      }

      // Parse results - MCP returns various formats
      const data = json.data;
      let issues: SearchResult[] = [];

      if (typeof data === 'string') {
        // Text-based response, try to extract key/summary pairs
        const lines = data.split('\n').filter((l: string) => l.trim());
        issues = lines.slice(0, 20).map((l: string) => {
          const match = l.match(/([A-Z]+-\d+)[:\s]+(.+)/);
          return match
            ? { key: match[1], summary: match[2].trim(), status: '' }
            : { key: '', summary: l.trim(), status: '' };
        }).filter((i: SearchResult) => i.key);
      } else if (Array.isArray(data)) {
        issues = data.map((i: Record<string, unknown>) => ({
          key: (i.key as string) ?? '',
          summary: (i.summary as string) ?? (i.fields as Record<string, unknown>)?.summary as string ?? '',
          status: (i.status as string) ?? '',
          assignee: (i.assignee as string) ?? '',
          priority: (i.priority as string) ?? '',
        }));
      } else if (data?.issues && Array.isArray(data.issues)) {
        issues = data.issues.map((i: Record<string, unknown>) => ({
          key: (i.key as string) ?? '',
          summary: (i.summary as string) ?? (i.fields as Record<string, unknown>)?.summary as string ?? '',
          status: (i.status as string) ?? '',
        }));
      }

      setResults(issues);
      if (issues.length === 0) setError('No results found');
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

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

  const presetQueries = [
    { label: 'My Open', jql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC' },
    { label: 'Updated Today', jql: 'assignee = currentUser() AND updated >= startOfDay() ORDER BY updated DESC' },
    { label: 'Overdue', jql: 'assignee = currentUser() AND duedate < now() AND resolution = Unresolved ORDER BY duedate ASC' },
    { label: 'High Priority', jql: 'assignee = currentUser() AND priority in (Highest, High) AND resolution = Unresolved' },
  ];

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[#3a424d]">
        <button
          onClick={() => { setTab('search'); setError(null); setSuccess(null); }}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
            tab === 'search'
              ? 'bg-[#363d47] text-[#5ec1ca] border-b-2 border-[#5ec1ca]'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          JQL Search
        </button>
        <button
          onClick={() => { setTab('create'); setError(null); setSuccess(null); }}
          className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-colors ${
            tab === 'create'
              ? 'bg-[#363d47] text-[#5ec1ca] border-b-2 border-[#5ec1ca]'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Create Issue
        </button>
      </div>

      <div className="p-4">
        {/* Error / Success */}
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

        {/* Search Tab */}
        {tab === 'search' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={jql}
                onChange={(e) => setJql(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                placeholder="Enter JQL query..."
                className="flex-1 bg-[#272C33] border border-[#3a424d] rounded px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none"
              />
              <button
                onClick={search}
                disabled={loading || !jql.trim()}
                className="px-4 py-2 text-xs font-semibold bg-[#5ec1ca] text-[#272C33] rounded border border-[#4ba8b0] hover:bg-[#4db0b9] disabled:opacity-50 transition-colors"
              >
                {loading ? 'Searching...' : 'Search'}
              </button>
            </div>

            {/* Preset queries */}
            <div className="flex flex-wrap gap-1.5">
              {presetQueries.map((p) => (
                <button
                  key={p.label}
                  onClick={() => { setJql(p.jql); }}
                  className="px-2 py-1 text-[10px] bg-[#272C33] border border-[#3a424d] rounded text-neutral-400 hover:text-[#5ec1ca] hover:border-[#5ec1ca] transition-colors"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Results */}
            {results.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {results.map((r) => (
                  <div
                    key={r.key}
                    className="flex items-start gap-2 px-3 py-2 rounded bg-[#272C33] border border-[#3a424d]"
                  >
                    <span className="text-[#5ec1ca] text-xs font-mono font-bold shrink-0 mt-0.5">
                      {r.key}
                    </span>
                    <span className="text-sm text-neutral-200 flex-1 min-w-0 truncate">
                      {r.summary}
                    </span>
                    {r.status && (
                      <span className="text-[10px] text-neutral-500 shrink-0">
                        {r.status}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create Tab */}
        {tab === 'create' && (
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
        )}
      </div>
    </div>
  );
}
