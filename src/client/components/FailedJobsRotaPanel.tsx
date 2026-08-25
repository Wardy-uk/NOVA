import { useState, useEffect, useCallback } from 'react';

/**
 * Admin controls for the daily failed-jobs ticket. The rota owner itself comes from
 * dbo.Agent.isCurrentFailedJob (the flag the n8n "Daily Agent Selection" flow sets and
 * the Grafana board shows) — this panel governs the ticket NOVA raises against it.
 */

const SETTING_KEYS = [
  'failed_jobs_ticket_enabled',
  'failed_jobs_respect_availability',
  'failed_jobs_ticket_hour',
  'failed_jobs_ticket_minute',
  'failed_jobs_ticket_project',
  'failed_jobs_ticket_summary',
  'failed_jobs_ticket_issue_type_id',
  'failed_jobs_ticket_request_type_id',
  'failed_jobs_ticket_tier_id',
  'failed_jobs_ticket_tier_field',
  'failed_jobs_request_type_field',
] as const;

// Mirrors DEFAULTS in services/failed-jobs-ticket.ts — shown as placeholders so an
// empty box reads as "using the default" rather than "unset".
const PLACEHOLDERS: Record<string, string> = {
  failed_jobs_ticket_project: 'NT',
  failed_jobs_ticket_summary: 'Failed Jobs — investigate, resolve and reprocess ({date})',
  failed_jobs_ticket_issue_type_id: '10706 (Support)',
  failed_jobs_ticket_request_type_id: '598 (Service Request)',
  failed_jobs_ticket_tier_id: '13062 (Tier 2)',
  failed_jobs_ticket_tier_field: 'customfield_12981',
  failed_jobs_request_type_field: 'customfield_12800',
};

interface Status {
  date: string;
  enabled: boolean;
  isTicketDay: boolean;
  dueTime: string;
  owner: string | null;
  ownerError: string | null;
  wouldReassign: boolean;
  issueKey: string | null;
  ticketAgent: string | null;
  reassigned: boolean;
  note: string | null;
}

const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('nova_auth_token')}` });

export function FailedJobsRotaPanel() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status | null>(null);
  const [jiraUrl, setJiraUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const r = await fetch('/api/settings', { headers: auth() });
      const json = await r.json();
      if (json.ok) {
        const vals: Record<string, string> = {};
        for (const key of SETTING_KEYS) vals[key] = json.data?.[key] ?? '';
        setValues(vals);
        setJiraUrl(json.data?.jira_url ?? '');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/failed-jobs/status', { headers: auth() });
      const json = await r.json();
      if (json.ok) setStatus(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchSettings(); fetchStatus(); }, [fetchSettings, fetchStatus]);

  const set = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const key of SETTING_KEYS) {
        await fetch(`/api/settings/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...auth() },
          body: JSON.stringify({ value: values[key] ?? '' }),
        });
      }
      setSaved(true);
      fetchStatus();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const runNow = async (force: boolean) => {
    setRunning(true);
    setRunMessage(null);
    try {
      const r = await fetch('/api/admin/failed-jobs/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth() },
        body: JSON.stringify({ force }),
      });
      const json = await r.json();
      const d = json.data ?? {};
      setRunMessage(
        json.ok && d.issueKey ? `Raised ${d.issueKey} → ${d.agent}${d.reassigned ? ' (reassigned — rota agent was off)' : ''}${d.linked?.length ? `, linked to ${d.linked.join(', ')}` : ''}`
          : d.skipped === 'already-raised' ? `Already raised today (${d.issueKey})`
          : d.skipped === 'no-available-agent' ? 'No available T2 Support agent to assign it to'
          : d.skipped === 'no-jira-client' ? 'Jira is not configured'
          : json.error || 'Failed — check the server log',
      );
      fetchStatus();
    } catch {
      setRunMessage('Request failed');
    }
    setRunning(false);
  };

  // Time is one field in the UI, two settings on the server.
  const time = `${(values.failed_jobs_ticket_hour || '8').padStart(2, '0')}:${(values.failed_jobs_ticket_minute || '30').padStart(2, '0')}`;
  const setTime = (v: string) => {
    const [h, m] = v.split(':');
    setValues(prev => ({ ...prev, failed_jobs_ticket_hour: String(parseInt(h, 10)), failed_jobs_ticket_minute: String(parseInt(m, 10)) }));
    setSaved(false);
  };

  // On unless explicitly turned off, matching the job's own guard.
  const enabled = values.failed_jobs_ticket_enabled !== 'false';
  const respectAvailability = values.failed_jobs_respect_availability !== 'false';

  if (loading) return <div className="text-neutral-400 text-sm p-4">Loading…</div>;

  const input = 'bg-[#272C33] text-neutral-300 text-xs rounded px-2 py-1.5 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors w-full placeholder:text-neutral-600';
  const label = 'block text-[10px] uppercase tracking-wide text-neutral-500 mb-1';

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-neutral-500">
        Raises one Tier 2 ticket each weekday to investigate, resolve and reprocess failed jobs,
        assigned to whoever holds the failed-jobs rota on the Grafana board.
      </p>

      {/* Today */}
      <div className="border border-[#3a424d] rounded bg-[#2f353d] p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-neutral-200">Today — {status?.date ?? '…'}</span>
          <button onClick={fetchStatus} className="px-2 py-1 bg-[#272C33] text-neutral-400 text-[10px] rounded hover:bg-[#3a424d]">
            Refresh
          </button>
        </div>
        <div className="text-[11px] text-neutral-400">
          {status?.issueKey ? (
            <>
              Ticket{' '}
              {jiraUrl
                ? <a href={`${jiraUrl.replace(/\/$/, '')}/browse/${status.issueKey}`} target="_blank" rel="noreferrer" className="text-[#5ec1ca] hover:underline">{status.issueKey}</a>
                : <span className="text-neutral-200">{status.issueKey}</span>}
              {' '}→ <span className="text-neutral-200">{status.ticketAgent}</span>
              {status.reassigned && <span className="text-amber-400"> (reassigned — rota agent was off)</span>}
              {status.note && <span className="text-amber-400"> · {status.note}</span>}
            </>
          ) : !status?.isTicketDay ? (
            'Not a working day — no ticket due.'
          ) : (
            <>Not raised yet — due {status?.dueTime}.</>
          )}
        </div>
        <div className="text-[11px] text-neutral-500">
          {status?.ownerError
            ? <span className="text-amber-400">Could not read the rota: {status.ownerError}</span>
            : status?.owner
              ? <>Rota owner: <span className="text-neutral-300">{status.owner}</span>
                  {status.wouldReassign && <span className="text-amber-400"> — the flagged agent is unavailable, so this ticket would move to them</span>}</>
              : 'No available T2 Support agent on the rota.'}
        </div>
        {!enabled && <div className="text-[11px] text-amber-400">Disabled — nothing will be raised automatically.</div>}
      </div>

      {/* Toggles */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => set('failed_jobs_ticket_enabled', e.target.checked ? 'true' : 'false')} className="accent-[#5ec1ca]" />
        <span className="text-xs text-neutral-300">Raise the ticket automatically each weekday</span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={respectAvailability} onChange={e => set('failed_jobs_respect_availability', e.target.checked ? 'true' : 'false')} className="accent-[#5ec1ca]" />
        <span className="text-xs text-neutral-300">
          Skip agents who are on leave
          <span className="text-neutral-500"> — re-picks and moves the Grafana flag if the rota agent is off</span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Time (UK)</label>
          <input type="time" value={time} onChange={e => setTime(e.target.value)} className={input} />
        </div>
        <div>
          <label className={label}>Jira project</label>
          <input value={values.failed_jobs_ticket_project ?? ''} onChange={e => set('failed_jobs_ticket_project', e.target.value)} placeholder={PLACEHOLDERS.failed_jobs_ticket_project} className={input} />
        </div>
      </div>

      <div>
        <label className={label}>Summary</label>
        <input value={values.failed_jobs_ticket_summary ?? ''} onChange={e => set('failed_jobs_ticket_summary', e.target.value)} placeholder={PLACEHOLDERS.failed_jobs_ticket_summary} className={input} />
        <p className="text-[10px] text-neutral-600 mt-1">{'{date}'} and {'{agent}'} are substituted.</p>
      </div>

      <details className="border border-[#3a424d] rounded bg-[#2f353d] p-3">
        <summary className="text-[11px] text-neutral-400 cursor-pointer">Jira field IDs</summary>
        <p className="text-[10px] text-neutral-600 mt-2 mb-2">
          Leave blank to use the defaults. Set an ID field to <code className="text-neutral-400">none</code> to leave that field off the ticket.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {([
            ['failed_jobs_ticket_issue_type_id', 'Issue type ID'],
            ['failed_jobs_ticket_request_type_id', 'Request type ID'],
            ['failed_jobs_ticket_tier_id', 'Tier option ID'],
            ['failed_jobs_ticket_tier_field', 'Tier field'],
            ['failed_jobs_request_type_field', 'Request type field'],
          ] as const).map(([key, text]) => (
            <div key={key}>
              <label className={label}>{text}</label>
              <input value={values[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={PLACEHOLDERS[key]} className={input} />
            </div>
          ))}
        </div>
      </details>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-xs hover:bg-[#4db0b9] transition-colors disabled:opacity-40">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="text-[11px] text-emerald-400">Saved</span>}
        <div className="flex-1" />
        <button onClick={() => runNow(false)} disabled={running} className="px-3 py-2 bg-[#2f353d] text-neutral-300 text-xs rounded hover:bg-[#3a424d] disabled:opacity-40">
          {running ? 'Running…' : 'Raise now'}
        </button>
        {status?.issueKey && (
          <button onClick={() => runNow(true)} disabled={running} title="Raise another ticket for today, ignoring the one already raised"
            className="px-3 py-2 bg-[#2f353d] text-neutral-500 text-xs rounded hover:bg-[#3a424d] disabled:opacity-40">
            Force
          </button>
        )}
      </div>
      {runMessage && <div className="text-[11px] text-neutral-400">{runMessage}</div>}
    </div>
  );
}
