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
    <div className="flex items-center justify-between px-4 py-3 mb-5 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black"
          style={{
            background: 'linear-gradient(135deg, #10b981, #5ec1ca)',
            boxShadow: '0 6px 24px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.3)',
            color: '#0f172a',
          }}
        >
          ◈
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-neutral-500 font-semibold">
            {agentName}{teamName ? ` · ${teamName}` : ''}
          </div>
          <h1
            className="text-lg font-black tracking-tight"
            style={{
              fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
              background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            My Tickets
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <div className="flex flex-col items-end">
          <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-semibold">Queue</div>
          <div className="text-xl font-black tracking-tight text-neutral-200" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
            {ticketCount}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-semibold">Time</div>
          <div className="text-sm font-bold text-neutral-300">{timeStr}</div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-semibold">Hygiene</div>
          <div className={`text-sm font-bold ${hygieneColor}`}>
            {hygiene ? (hygiene.hygieneDue ? 'Due' : `${hygiene.passesTodayCount}/${workingHoursElapsed}`) : '—'}
          </div>
        </div>
        {jiraConnected !== null && (
          <div className="flex flex-col items-end">
            <div className="text-[9px] uppercase tracking-wider text-neutral-500 font-semibold">Jira</div>
            <div className={`text-sm font-bold ${jiraConnected ? 'text-emerald-400' : 'text-red-400'}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ background: jiraConnected ? '#10b981' : '#ef4444' }} />
              {jiraConnected ? 'OK' : 'Off'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
