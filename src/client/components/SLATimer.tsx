import { useState, useEffect } from 'react';

interface Props {
  breachAt: string | null | undefined;
}

export function SLATimer({ breachAt }: Props) {
  const [remaining, setRemaining] = useState('');
  const [urgency, setUrgency] = useState<'ok' | 'warning' | 'danger'>('ok');

  useEffect(() => {
    if (!breachAt || isNaN(new Date(breachAt).getTime())) {
      setRemaining('—');
      setUrgency('ok');
      return;
    }

    const update = () => {
      const diff = new Date(breachAt).getTime() - Date.now();

      if (diff <= 0) {
        setRemaining('BREACHED');
        setUrgency('danger');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours < 1) {
        setRemaining(`${mins}m`);
        setUrgency('danger');
      } else if (hours < 4) {
        setRemaining(`${hours}h ${mins}m`);
        setUrgency('warning');
      } else {
        setRemaining(`${hours}h ${mins}m`);
        setUrgency('ok');
      }
    };

    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [breachAt]);

  const colors = {
    ok: 'text-sla-timer-ok',
    warning: 'text-sla-timer-warn',
    danger: 'text-sla-timer-danger font-semibold animate-pulse',
  };

  return (
    <span className={`text-xs ${colors[urgency]}`}>SLA: {remaining}</span>
  );
}
