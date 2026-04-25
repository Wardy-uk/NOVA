import { useState, useEffect } from 'react';

interface PriorityAction {
  ticketKey: string;
  summary: string;
  reason: string;
}

interface BriefingSection {
  id: string;
  title: string;
  content: string;
  priority?: 'high' | 'medium' | 'low';
  tickets?: string[];
}

interface BriefingData {
  id: number;
  briefing_date: string;
  role_type: string;
  generated_at: string;
  dismissed_at: string | null;
  content: {
    headline: string;
    sections: BriefingSection[];
    priorityActions: PriorityAction[];
    generatedAt: string;
  };
}

interface HistoryEntry {
  id: number;
  briefing_date: string;
  role_type: string;
  headline: string;
  generated_at: string;
  dismissed_at: string | null;
}

const priorityColors: Record<string, string> = {
  high: 'border-red-500/40 bg-red-950/20',
  medium: 'border-amber-500/40 bg-amber-950/20',
  low: 'border-blue-500/40 bg-blue-950/20',
};

const priorityBadge: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-amber-500/20 text-amber-400',
  low: 'bg-blue-500/20 text-blue-400',
};

export function BriefingView() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const token = localStorage.getItem('token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadBriefing(); }, [selectedDate]);

  async function loadBriefing() {
    setLoading(true);
    setError(null);
    try {
      const url = selectedDate
        ? `/api/briefing/date/${selectedDate}`
        : '/api/briefing/today';
      const res = await fetch(url, { headers });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to load');
      setBriefing(json.data);
      if (json.data) {
        const ids = json.data.content.sections
          .filter((s: BriefingSection) => s.priority === 'high')
          .map((s: BriefingSection) => s.id);
        setExpandedSections(new Set(ids));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/briefing/history?limit=30', { headers });
      const json = await res.json();
      if (json.ok) setHistory(json.data || []);
    } catch {}
  }

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/briefing/generate', { method: 'POST', headers });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Failed to generate');
      setSelectedDate(null);
      await loadBriefing();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  }

  function toggleSection(id: string) {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function formatDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function formatTime(d: string) {
    return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Daily Briefing</h2>
          {briefing && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {formatDate(briefing.briefing_date)} · Generated {formatTime(briefing.generated_at)}
              {briefing.role_type && <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{briefing.role_type}</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
            className="px-3 py-1.5 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            {showHistory ? 'Hide History' : 'History'}
          </button>
          <button
            onClick={generate}
            disabled={generating}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating…' : 'Generate Now'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">{error}</div>
      )}

      {/* History sidebar */}
      {showHistory && history.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
          <h3 className="text-sm font-medium text-zinc-300 mb-2">Recent Briefings</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {history.map(h => (
              <button
                key={h.id}
                onClick={() => { setSelectedDate(h.briefing_date); setShowHistory(false); }}
                className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                  selectedDate === h.briefing_date
                    ? 'bg-blue-600/20 border border-blue-500/30 text-blue-300'
                    : 'bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400'
                }`}
              >
                <span className="font-medium text-zinc-300">{h.briefing_date}</span>
                <span className="ml-2 text-zinc-500">·</span>
                <span className="ml-2">{h.headline?.slice(0, 60)}{(h.headline?.length ?? 0) > 60 ? '…' : ''}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDate && (
        <button
          onClick={() => setSelectedDate(null)}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          ← Back to today
        </button>
      )}

      {/* No briefing state */}
      {!briefing && (
        <div className="text-center py-16 bg-zinc-900/40 border border-zinc-800 rounded-lg">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-zinc-400 text-sm">No briefing available{selectedDate ? ` for ${selectedDate}` : ' yet'}.</p>
          <p className="text-zinc-500 text-xs mt-1">
            {selectedDate ? 'Try a different date.' : 'Click "Generate Now" to create one, or wait for the scheduled generation.'}
          </p>
        </div>
      )}

      {/* Briefing content */}
      {briefing && (
        <>
          {/* Headline card */}
          <div className="bg-gradient-to-r from-blue-950/40 to-zinc-900/60 border border-blue-500/20 rounded-lg p-4">
            <p className="text-white text-base font-medium">{briefing.content.headline}</p>
          </div>

          {/* Priority Actions */}
          {briefing.content.priorityActions.length > 0 && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Priority Actions
              </h3>
              <div className="space-y-2">
                {briefing.content.priorityActions.map((a, i) => (
                  <div key={i} className="flex items-start gap-3 p-2 rounded bg-zinc-800/50">
                    <span className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded shrink-0">
                      {a.ticketKey}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200">{a.summary}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{a.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sections */}
          {briefing.content.sections.map(section => {
            const expanded = expandedSections.has(section.id);
            const prio = section.priority || 'low';
            return (
              <div
                key={section.id}
                className={`border rounded-lg overflow-hidden transition-colors ${priorityColors[prio]}`}
              >
                <button
                  onClick={() => toggleSection(section.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${priorityBadge[prio]}`}>
                      {prio}
                    </span>
                    <span className="text-sm font-medium text-white">{section.title}</span>
                  </div>
                  <span className={`text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {expanded && (
                  <div className="px-4 pb-4">
                    <div className="text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
                      {section.content}
                    </div>
                    {section.tickets && section.tickets.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {section.tickets.map(t => (
                          <span key={t} className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
