import { useState, useEffect } from 'react';

/**
 * Warning signals, on a screen, for the first time.
 *
 * Every number here already existed. Over 18-19 Sep 2026 the risk scorer had been dead for
 * three and a half weeks, proactive SLA management had never run, the incident scan had failed
 * on invalid SQL every fifteen minutes since it shipped, and 26 P1 cancellations hit an empty
 * assignment pool overnight with nothing raised — all of it found by reading server logs.
 *
 * Two rules, both learned from that:
 *  - An empty section says whether it is empty because nothing is wrong or because nothing
 *    could be read. Those are not the same finding and must never render the same.
 *  - Nothing here is a vanity metric. Every row is something you would act on.
 */

interface Section<T> { ok: boolean; error: string | null; data: T | null }

interface Signals {
  generatedAt: string;
  days: number;
  escalationRisk: Section<Array<{ ticket_key: string; probability: number; reasoning: string; summary: string | null; status_name: string | null; assignee_display: string | null; priority_name: string | null }>>;
  predictionAccuracy: Section<Array<{ total: number; correct: number; pending: number }>>;
  flaggedTickets: Section<Array<{ ticket_key: string; risk_score: number; summary: string | null; assignee: string | null; flagged_at: string }>>;
  safetyNetAcks: Section<Array<{ day: string; total: number; machine: number; customer: number }>>;
  assignmentFailures: Section<Array<{ ticket_key: string; pool: string; project_key: string; last_error: string | null; created_at: string; retry_count: number; summary: string | null; priority_name: string | null }>>;
  slaInterventions: Section<Array<{ ticket_key: string; sla_type: string; minutes_remaining: number; intervention_type: string; created_at: string }>>;
  incidents: Section<Array<{ incident_key: string; summary: string; ticket_count: number; detected_at: string }>>;
  agentErrors: Section<Array<{ source: string; severity: string; message: string; occurred_at: string }>>;
}

const JIRA = 'https://nurturtech.atlassian.net/browse/';

function Panel({ title, why, section, emptyMeans, children }: {
  title: string; why: string; section: Section<unknown[]>; emptyMeans: string; children: React.ReactNode;
}) {
  const rows = section.data ?? [];
  return (
    <div className="rounded border border-[#2f353d] bg-[#232830] p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm text-neutral-200">{title}</h3>
        <span className="text-[11px] text-neutral-500">{section.ok ? `${rows.length}` : 'unavailable'}</span>
      </div>
      <p className="text-[11px] text-neutral-500 mt-0.5 mb-2">{why}</p>
      {/* A section that could not be read is not a quiet one. */}
      {!section.ok ? (
        <div className="text-xs text-red-400">
          Could not be read — {section.error ?? 'no error reported'}.
          <span className="text-neutral-400"> Nothing was measured, so this is not a clean result.</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-xs text-neutral-500">{emptyMeans}</div>
      ) : children}
    </div>
  );
}

function Ticket({ k }: { k: string }) {
  return <a href={`${JIRA}${k}`} target="_blank" rel="noreferrer" className="font-mono text-[#5ec1ca] hover:underline">{k}</a>;
}

export function ManagementSignalsView() {
  const [s, setS] = useState<Signals | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async (d: number) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('nova_auth_token') ?? sessionStorage.getItem('nova_auth_token');
      const r = await fetch(`/api/management/signals?days=${d}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json();
      if (j.ok) { setS(j.data); setErr(null); } else setErr(j.error ?? 'Failed to load signals');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not reach the signals endpoint');
    }
    setLoading(false);
  };

  useEffect(() => { load(days); }, [days]);

  if (loading && !s) return <div className="p-4 text-sm text-neutral-400">Gathering signals…</div>;
  if (err && !s) return <div className="p-4"><div className="p-3 rounded bg-red-900/20 border border-red-900/40 text-sm text-red-400">{err}</div></div>;
  if (!s) return null;

  const acc = s.predictionAccuracy.data?.[0];
  const scored = acc ? acc.total - acc.pending : 0;

  return (
    <div className="p-4 space-y-3 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg text-neutral-200">Warning signals</h2>
          <p className="text-xs text-neutral-500">
            Checked {new Date(s.generatedAt).toLocaleString()} · last {s.days} days
          </p>
        </div>
        <div className="flex gap-1">
          {[1, 7, 30].map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2 py-1 text-xs rounded ${days === d ? 'bg-[#5ec1ca]/20 text-[#5ec1ca]' : 'bg-[#2f353d] text-neutral-400 hover:bg-[#3a424d]'}`}>
              {d}d
            </button>
          ))}
          <button onClick={() => load(days)} disabled={loading}
            className="px-2 py-1 text-xs rounded bg-[#2f353d] text-neutral-400 hover:bg-[#3a424d] disabled:opacity-50">
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      <Panel
        title="Tickets forecast to escalate"
        why="Predicted at triage, not yet escalated. Acting now is cheaper than acting on day three."
        section={s.escalationRisk} emptyMeans="Nothing above the forecast threshold in this window.">
        <div className="space-y-1">
          {(s.escalationRisk.data ?? []).map(r => (
            <div key={r.ticket_key} className="text-xs p-2 rounded bg-[#2f353d]/40">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={r.probability >= 0.8 ? 'text-red-400' : 'text-amber-400'}>
                  {Math.round(r.probability * 100)}%
                </span>
                <Ticket k={r.ticket_key} />
                <span className="text-neutral-300">{r.summary ?? '(not in cache)'}</span>
                {r.assignee_display && <span className="text-neutral-500">· {r.assignee_display}</span>}
              </div>
              <div className="text-neutral-500 mt-0.5">{r.reasoning}</div>
            </div>
          ))}
          {/* Shown with the forecasts, not on a separate tab: a prediction nobody has scored
              is a guess, and the reader should see which they are looking at. */}
          <p className="text-[11px] text-neutral-500 pt-1">
            {scored > 0
              ? `Accuracy so far: ${acc!.correct} of ${scored} scored predictions correct. ${acc!.pending} still open.`
              : `No prediction has been scored yet${acc ? ` (${acc.pending} open)` : ''} — treat these as unproven.`}
          </p>
        </div>
      </Panel>

      <Panel
        title="Assignment failures"
        why="NOVA triaged these and could not hand them to anyone. Oldest first. The retry sweep only runs in working hours, so anything queued on a Saturday waits until Monday."
        section={s.assignmentFailures} emptyMeans="Every ticket found an owner.">
        <div className="space-y-1">
          {(s.assignmentFailures.data ?? []).map(r => (
            <div key={r.ticket_key} className="text-xs p-2 rounded bg-[#2f353d]/40 flex items-center gap-2 flex-wrap">
              <Ticket k={r.ticket_key} />
              {r.priority_name && <span className="text-amber-400">{r.priority_name}</span>}
              <span className="text-neutral-300">{r.summary}</span>
              <span className="text-neutral-400">{r.pool?.toUpperCase()} · {r.project_key}</span>
              <span className="text-neutral-500">
                {r.retry_count === 0 ? 'never retried' : `retried ${r.retry_count}×`}
              </span>
              <span className="text-neutral-500">queued {new Date(r.created_at).toLocaleString()}</span>
              {r.last_error && <span className="text-red-400 basis-full">{r.last_error}</span>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Automated first replies"
        why="Each one stops the FRT clock, so the SLA reads MET. A busy day here means the reply pipeline is failing, not that SLAs are healthy."
        section={s.safetyNetAcks} emptyMeans="The safety net did not need to fire.">
        <div className="space-y-1">
          {(s.safetyNetAcks.data ?? []).map(r => (
            <div key={String(r.day)} className="text-xs p-2 rounded bg-[#2f353d]/40 flex items-center gap-3">
              <span className="text-neutral-400 w-24">{new Date(r.day).toLocaleDateString()}</span>
              <span className={r.customer >= 5 ? 'text-red-400' : r.customer > 0 ? 'text-amber-400' : 'text-neutral-300'}>
                {r.customer} customer
              </span>
              <span className="text-neutral-500">{r.machine} machine-raised</span>
            </div>
          ))}
          <p className="text-[11px] text-neutral-500 pt-1">
            A handful a day is a safety net working. Dozens means it is carrying the desk.
          </p>
        </div>
      </Panel>

      <Panel
        title="Flagged by the risk scorer"
        why="Reactive counterpart to the forecast above — tickets already showing trouble."
        section={s.flaggedTickets} emptyMeans="Nothing flagged in this window.">
        <div className="space-y-1">
          {(s.flaggedTickets.data ?? []).map(r => (
            <div key={r.ticket_key} className="text-xs p-2 rounded bg-[#2f353d]/40 flex items-center gap-2 flex-wrap">
              <span className="text-amber-400">{r.risk_score}</span>
              <Ticket k={r.ticket_key} />
              <span className="text-neutral-300">{r.summary}</span>
              {r.assignee && <span className="text-neutral-500">· {r.assignee}</span>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="SLA interventions"
        why="Tickets NOVA acted on because they were close to breaching."
        section={s.slaInterventions} emptyMeans="No ticket came close enough to breach to need one.">
        <div className="space-y-1">
          {(s.slaInterventions.data ?? []).map((r, i) => (
            <div key={`${r.ticket_key}-${i}`} className="text-xs p-2 rounded bg-[#2f353d]/40 flex items-center gap-2 flex-wrap">
              <Ticket k={r.ticket_key} />
              <span className="text-neutral-400">{r.intervention_type.replace(/_/g, ' ')}</span>
              <span className="text-neutral-500">{r.sla_type} · {r.minutes_remaining}m left</span>
              <span className="text-neutral-500">{new Date(r.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Incident clusters"
        why="Several tickets that look like one underlying fault rather than unrelated reports."
        section={s.incidents} emptyMeans="No cluster large enough to look like a single incident.">
        <div className="space-y-1">
          {(s.incidents.data ?? []).map(r => (
            <div key={r.incident_key} className="text-xs p-2 rounded bg-[#2f353d]/40 flex items-center gap-2 flex-wrap">
              <Ticket k={r.incident_key} />
              <span className="text-neutral-300">{r.summary}</span>
              <span className="text-neutral-500">{r.ticket_count} tickets</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="What NOVA could not do"
        why="Unresolved errors from the agent's own machinery. A feature failing silently shows up here first."
        section={s.agentErrors} emptyMeans="No unresolved errors logged.">
        <div className="space-y-1">
          {(s.agentErrors.data ?? []).map((r, i) => (
            <div key={i} className="text-xs p-2 rounded bg-[#2f353d]/40">
              <div className="flex items-center gap-2">
                <span className={r.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}>{r.severity}</span>
                <span className="font-mono text-neutral-400">{r.source}</span>
                <span className="text-neutral-500">{new Date(r.occurred_at).toLocaleString()}</span>
              </div>
              <div className="text-neutral-400 mt-0.5">{r.message}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
