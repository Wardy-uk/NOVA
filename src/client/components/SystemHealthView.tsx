import { useState, useEffect } from 'react';

/**
 * NOVA's self-report — is the platform still doing what it believes it is doing?
 *
 * Built after 14 Sep 2026, when a fault stopped AI first responses, FRT breaches
 * went from five a day to forty-five, and nothing in NOVA said a word. The page
 * exists to make a silent absence visible, so it is written to state the boring
 * result plainly rather than to look reassuring.
 *
 * Two presentation rules carry real weight here:
 *
 * - `trustworthy: false` takes over the page. A report whose positive controls
 *   are themselves unhealthy is not evidence that NOVA is fine, it is evidence
 *   that the checker cannot see, and rendering its greens normally would be the
 *   same false all-clear this page was built to prevent.
 * - `unknown` never renders as a pass. A check that could not run is shown in
 *   its own colour, next to its error.
 *
 * The judgement all lives server-side in `services/health-signals.ts`; this only
 * displays it. The same function answers VANTAGE at
 * `GET /api/neuro-bridge/health-signals`, so the page and the poller cannot
 * disagree about whether NOVA is well.
 */

type Severity = 'ok' | 'warn' | 'fail' | 'unknown';

interface Signal<T> { ok: boolean; error: string | null; data: T | null }

interface TableHealth {
  table: string; cadence: string; why: string; control: boolean; severity: Severity;
  exists: boolean; rowCount: number | null; lastRowAt: string | null;
  hoursSinceLastRow: number | null; timestampColumn: string | null;
  neverWritten: boolean; unverified: boolean; verdict: string;
}

interface ColumnHealth {
  table: string; column: string; why: string; severity: Severity;
  rowCount: number; distinctValues: number; constantValue: string | null; verdict: string;
}

interface JobHealth {
  id: string; name: string; severity: Severity; enabled: boolean; intervalMs: number;
  lastRun: string | null; lastError: string | null; runCount: number; errorCount: number; verdict: string;
}

interface JobsHealth {
  uptimeSeconds: number; warmingUp: boolean; inMemoryOnly: true; jobs: JobHealth[];
}

interface HealthSignals {
  build: string; generatedAt: string; overall: Severity; trustworthy: boolean;
  tables: Signal<TableHealth[]>;
  columns: Signal<ColumnHealth[]>;
  jobs: Signal<JobsHealth>;
  unavailable: Array<{ name: string; error: string | null }>;
}

const SEVERITY_TEXT: Record<Severity, string> = {
  ok: 'text-green-400',
  warn: 'text-amber-400',
  fail: 'text-red-400',
  unknown: 'text-neutral-400',
};

const SEVERITY_DOT: Record<Severity, string> = {
  ok: 'bg-green-400',
  warn: 'bg-amber-400',
  fail: 'bg-red-400',
  // Hollow rather than filled: a check that did not run is not a state of the
  // system, and should not read as one at a glance.
  unknown: 'border border-neutral-500',
};

const OVERALL_LABEL: Record<Severity, string> = {
  ok: 'Everything checked is reporting normally',
  warn: 'Something needs a look',
  fail: 'Something has failed',
  unknown: 'Some checks could not run',
};

function Dot({ severity }: { severity: Severity }) {
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[severity]}`} />;
}

function SectionError({ name, error }: { name: string; error: string | null }) {
  return (
    <div className="p-3 rounded bg-red-900/20 border border-red-900/40 text-xs">
      <span className="text-red-400">The {name} checks did not run.</span>
      <span className="text-neutral-400"> {error ?? 'No error reported.'}</span>
      <div className="text-neutral-500 mt-1">
        This is not a clean bill of health for {name} — it means nothing was measured.
      </div>
    </div>
  );
}

export function SystemHealthView() {
  const [health, setHealth] = useState<HealthSignals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/health/signals', {
        headers: { Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` },
      });
      const data = await r.json();
      if (data.ok) { setHealth(data.data); setError(null); }
      else setError(data.error ?? 'Health check failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the health endpoint');
    }
    setLoading(false);
  };

  useEffect(() => { fetchHealth(); }, []);

  if (loading && !health) return <div className="text-neutral-400 text-sm p-4">Running health checks…</div>;

  if (error && !health) {
    return (
      <div className="p-4">
        <div className="p-3 rounded bg-red-900/20 border border-red-900/40 text-sm text-red-400">
          Could not run the health checks: {error}
        </div>
      </div>
    );
  }

  if (!health) return null;

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      {/* Headline */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={`flex items-center gap-2 text-lg ${SEVERITY_TEXT[health.overall]}`}>
            <Dot severity={health.overall} />
            {OVERALL_LABEL[health.overall]}
          </div>
          <div className="text-xs text-neutral-500 mt-1">
            Checked {new Date(health.generatedAt).toLocaleString()} · build {health.build}
          </div>
        </div>
        <button onClick={fetchHealth} disabled={loading}
          className="px-2 py-1 bg-[#2f353d] text-neutral-400 text-xs rounded hover:bg-[#3a424d] disabled:opacity-50">
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      {/* A report that cannot see must say so louder than anything it found. */}
      {!health.trustworthy && (
        <div className="p-3 rounded bg-amber-900/20 border border-amber-900/40 text-xs">
          <div className="text-amber-400">Do not trust this report.</div>
          <div className="text-neutral-400 mt-1">
            A positive control — a table known to be busy — is itself reporting as empty or stale.
            That points at the checker or its database connection rather than at the things being
            checked, so the green rows below are not evidence of anything.
          </div>
        </div>
      )}

      {/* Tables */}
      <div>
        <h3 className="text-sm text-neutral-300 mb-2">Tables</h3>
        {!health.tables.ok ? <SectionError name="table" error={health.tables.error} /> : (
          <div className="space-y-1">
            {(health.tables.data ?? []).map(t => (
              <div key={t.table} className="flex items-start gap-2 p-2 rounded bg-[#2f353d]/40 text-xs">
                <div className="pt-1"><Dot severity={t.severity} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-neutral-200">{t.table}</span>
                    {t.control && <span className="text-[10px] px-1 rounded bg-[#5ec1ca]/20 text-[#5ec1ca]">control</span>}
                    {t.unverified && <span className="text-[10px] px-1 rounded bg-neutral-700 text-neutral-300">unverified</span>}
                    <span className="text-neutral-500">expects {t.cadence}</span>
                  </div>
                  <div className={SEVERITY_TEXT[t.severity]}>{t.verdict}</div>
                  <div className="text-neutral-500">{t.why}</div>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-neutral-500 pt-1">
              <span className="text-neutral-400">unverified</span> means the table has never held a row
              and nobody has confirmed whether that is a fault or a retired feature. Those are questions,
              not findings — the AI approval queue looked identically dead and turned out to be a
              deliberate design change from May.
            </p>
          </div>
        )}
      </div>

      {/* Columns */}
      <div>
        <h3 className="text-sm text-neutral-300 mb-2">Columns</h3>
        {!health.columns.ok ? <SectionError name="column" error={health.columns.error} /> : (
          <div className="space-y-1">
            {(health.columns.data ?? []).map(c => (
              <div key={`${c.table}.${c.column}`} className="flex items-start gap-2 p-2 rounded bg-[#2f353d]/40 text-xs">
                <div className="pt-1"><Dot severity={c.severity} /></div>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-neutral-200">{c.table}.{c.column}</div>
                  <div className={SEVERITY_TEXT[c.severity]}>{c.verdict}</div>
                  <div className="text-neutral-500">{c.why}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Jobs */}
      <div>
        <h3 className="text-sm text-neutral-300 mb-2">Jobs</h3>
        {!health.jobs.ok ? <SectionError name="job" error={health.jobs.error} /> : (
          <div className="space-y-1">
            <div className="text-[11px] text-neutral-500 pb-1">
              Run history is held in memory only, so every job reads as never-run after a restart.
              Server up {Math.round((health.jobs.data?.uptimeSeconds ?? 0) / 60)} min.
              {health.jobs.data?.warmingUp && (
                <span className="text-amber-400"> Still warming up — job results below are not meaningful yet.</span>
              )}
            </div>
            {(health.jobs.data?.jobs ?? [])
              // Healthy jobs are the boring majority; lead with what needs attention.
              .slice()
              .sort((a, b) => {
                const rank: Record<Severity, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };
                return rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name);
              })
              .map(j => (
                <div key={j.id} className="flex items-start gap-2 p-2 rounded bg-[#2f353d]/40 text-xs">
                  <div className="pt-1"><Dot severity={j.severity} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-neutral-200">{j.name}</div>
                    <div className="font-mono text-neutral-500">{j.id}</div>
                    <div className={SEVERITY_TEXT[j.severity]}>{j.verdict}</div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>

      {health.unavailable.length > 0 && (
        <p className="text-[11px] text-neutral-500">
          Sections not evaluated this run: {health.unavailable.map(u => u.name).join(', ')}.
        </p>
      )}
    </div>
  );
}
