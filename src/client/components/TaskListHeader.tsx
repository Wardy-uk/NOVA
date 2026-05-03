import { useState, useEffect, useCallback } from 'react';

interface HygieneInfo {
  passesTodayCount: number;
  compliancePercent: number;
  hygieneDue: boolean;
}

interface Props {
  agentName: string;
  teamName?: string;
  ticketCount: number;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}` };
}

export function TaskListHeader({ agentName, teamName, ticketCount }: Props) {
  const [time, setTime] = useState(new Date());
  const [hygiene, setHygiene] = useState<HygieneInfo | null>(null);
  const [jiraConnected, setJiraConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const fetchHygiene = useCallback(async () => {
    try {
      const res = await fetch('/api/agent/hygiene/status', { headers: authHeaders() });
      const json = await res.json();
      if (json.ok) setHygiene(json.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchHygiene();
    const interval = setInterval(fetchHygiene, 60_000);
    return () => clearInterval(interval);
  }, [fetchHygiene]);

  useEffect(() => {
    fetch('/api/auth/jira/status', { headers: authHeaders() })
      .then(r => r.json())
      .then(json => { if (json.ok) setJiraConnected(json.connected ?? false); })
      .catch(() => {});
  }, []);

  const timeStr = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const workingHoursElapsed = Math.max(1, Math.floor(
    time.getHours() >= 9 ? Math.min(time.getHours(), 17) - 9 : 0,
  ));

  let hygieneText = 'Hygiene: pass not run';
  let hygieneColor = 'text-neutral-600';

  if (hygiene) {
    if (hygiene.hygieneDue) {
      hygieneText = 'Hygiene: due now';
      hygieneColor = 'text-amber-400';
    } else {
      hygieneText = `Hygiene: ${hygiene.passesTodayCount}/${workingHoursElapsed}`;
      if (hygiene.compliancePercent >= 95) hygieneColor = 'text-emerald-400';
      else if (hygiene.compliancePercent >= 80) hygieneColor = 'text-amber-400';
      else hygieneColor = 'text-red-400';
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-[#1A1F26] border border-[#2A2F38] rounded-lg mb-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-neutral-100 uppercase tracking-wide">
          My Tickets
        </h2>
        <span className="text-xs text-neutral-400">
          {agentName}{teamName ? ` · ${teamName}` : ''}
        </span>
        <span className="text-xs bg-[#272C33] text-neutral-300 px-2 py-0.5 rounded">
          {ticketCount} ticket{ticketCount !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span>{timeStr}</span>
        <span className={hygieneColor}>{hygieneText}</span>
        {jiraConnected !== null && (
          <span className={jiraConnected ? 'text-emerald-400' : 'text-red-400'}>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: jiraConnected ? '#10b981' : '#ef4444' }} />
            Jira: {jiraConnected ? 'connected' : 'not connected'}
          </span>
        )}
      </div>
    </div>
  );
}
