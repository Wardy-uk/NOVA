import { useState, useEffect, useCallback } from 'react';

// "Nick — you need to look at this!" — a calm, scannable board of the tickets
// the risk scorer thinks need a human's eyes, grouped by *why* rather than one
// flat anxiety-inducing list. Built to be engaged with, not avoided:
// low visual noise, one clear action per card, an honest "you're clear" state.

interface LookTicket {
  ticket_key: string;
  risk_score: number;
  summary: string | null;
  assignee: string | null;
  priority: string | null;
  ticket_status: string | null;
  current_tier: string | null;
  project_key: string | null;
  flagged_at: string;
  sla_breached: boolean;
  sla_breach_at: string | null;
  category: string;
  why: string;
  reasons: string[];
}

interface LookGroup {
  key: string;
  label: string;
  emoji: string;
  count: number;
  tickets: LookTicket[];
}

interface LookResult {
  total: number;
  groups: LookGroup[];
  generatedAt: string;
}

const JIRA_BASE = 'https://nurturtech.atlassian.net/browse';

// Category → calm left-border accent. Colour signals *type of concern*, not alarm.
const CATEGORY_ACCENT: Record<string, string> = {
  impact: 'border-l-red-500/70',
  legal: 'border-l-violet-400/70',
  angry: 'border-l-rose-400/70',
  sla: 'border-l-amber-400/70',
  stuck: 'border-l-sky-400/70',
};

function scoreChip(score: number): string {
  if (score >= 80) return 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30';
  if (score >= 70) return 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30';
  return 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30';
}

function sinceFlagged(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  if (isNaN(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function LookAtThisView() {
  const [data, setData] = useState<LookResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const authFetch = useCallback((path: string, init?: RequestInit) => {
    const token = localStorage.getItem('nova_auth_token') || '';
    return fetch(`/api/agent${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init?.headers || {}) },
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/flagged/look-at-this');
      const json = await res.json();
      if (json.ok) { setData(json.data); setError(null); }
      else setError(json.error || 'Failed to load');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => { load(); }, [load]);

  // Keep it live but unobtrusive: refresh every 60s and when the tab regains focus.
  useEffect(() => {
    const interval = setInterval(load, 60_000);
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // "I've got it" — mark reviewed (not dismissed) so it leaves the board but stays
  // in the audit trail. Optimistic: drop the card immediately, reconcile on error.
  const gotIt = useCallback(async (key: string) => {
    setBusy(prev => new Set(prev).add(key));
    setData(prev => prev && {
      ...prev,
      total: prev.total - 1,
      groups: prev.groups
        .map(g => ({ ...g, tickets: g.tickets.filter(t => t.ticket_key !== key), count: g.tickets.filter(t => t.ticket_key !== key).length }))
        .filter(g => g.count > 0),
    });
    try {
      await authFetch(`/flagged/${key}/review`, { method: 'POST', body: JSON.stringify({ dismiss: false }) });
    } catch {
      load(); // failed — pull the true state back
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  }, [authFetch, load]);

  if (loading) {
    return <div className="p-8 text-neutral-500 text-sm">Checking what needs your eyes…</div>;
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-400 text-sm mb-3">Couldn't load: {error}</p>
        <button onClick={load} className="px-3 py-1.5 rounded-lg bg-[#272C33] text-neutral-300 text-sm hover:bg-[#2f353d]">Try again</button>
      </div>
    );
  }

  const total = data?.total ?? 0;

  return (
    <div className="max-w-5xl mx-auto p-6 sm:p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-neutral-100">Look at this</h1>
        <p className="text-sm text-neutral-400 mt-1">
          {total === 0
            ? "Nothing needs your eyes right now."
            : `${total} ${total === 1 ? 'ticket needs' : 'tickets need'} your judgement — grouped by why.`}
        </p>
      </header>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="text-5xl mb-4" aria-hidden>✨</div>
          <p className="text-lg text-neutral-200 font-medium">You're all clear</p>
          <p className="text-sm text-neutral-500 mt-1">Nothing concerning enough to pull you in. Go do the deep work.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {data!.groups.map(group => (
            <section key={group.key}>
              <h2 className="flex items-center gap-2 text-sm font-medium text-neutral-300 mb-3">
                <span className="text-base" aria-hidden>{group.emoji}</span>
                {group.label}
                <span className="text-xs text-neutral-500 font-normal">· {group.count}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.tickets.map(t => (
                  <article
                    key={t.ticket_key}
                    className={`rounded-2xl border border-white/5 border-l-4 ${CATEGORY_ACCENT[t.category] || 'border-l-neutral-500/60'} bg-[#1c2026] p-4 flex flex-col gap-3`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${scoreChip(t.risk_score)}`}>{t.risk_score}</span>
                          <span className="font-mono text-sm text-neutral-200">{t.ticket_key}</span>
                        </div>
                        <p className="text-sm text-neutral-300 mt-2 leading-snug">{t.why}</p>
                      </div>
                    </div>

                    {t.summary && (
                      <p className="text-xs text-neutral-500 leading-snug line-clamp-2">{t.summary}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
                      {t.assignee ? <span className="px-1.5 py-0.5 rounded bg-white/5">{t.assignee}</span> : <span className="px-1.5 py-0.5 rounded bg-white/5 text-amber-400/80">Unassigned</span>}
                      {t.current_tier && <span className="px-1.5 py-0.5 rounded bg-white/5">{t.current_tier}</span>}
                      {t.ticket_status && <span className="px-1.5 py-0.5 rounded bg-white/5">{t.ticket_status}</span>}
                      <span className="ml-auto">{sinceFlagged(t.flagged_at)}</span>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={`${JIRA_BASE}/${t.ticket_key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center text-xs font-medium px-3 py-2 rounded-lg bg-[#272C33] text-neutral-200 hover:bg-[#2f353d] transition-colors"
                      >
                        Open in Jira ↗
                      </a>
                      <button
                        onClick={() => gotIt(t.ticket_key)}
                        disabled={busy.has(t.ticket_key)}
                        className="text-xs font-medium px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                      >
                        I've got it ✓
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
