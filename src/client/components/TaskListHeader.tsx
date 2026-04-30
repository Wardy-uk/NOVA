import { useState, useEffect } from 'react';

interface Props {
  agentName: string;
  teamName?: string;
  ticketCount: number;
}

export function TaskListHeader({ agentName, teamName, ticketCount }: Props) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

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
        <span className="text-neutral-600">Hygiene: pass not run</span>
      </div>
    </div>
  );
}
