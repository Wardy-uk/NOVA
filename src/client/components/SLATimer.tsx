import { useState, useEffect } from 'react';

interface Props {
  breachAt: string;
}

export function SLATimer({ breachAt }: Props) {
  const [remaining, setRemaining] = useState('');
  const [urgency, setUrgency] = useState<'ok' | 'warning' | 'danger'>('ok');

  useEffect(() => {
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
    ok: 'text-neutral-400',
    warning: 'text-amber-400',
    danger: 'text-red-400 font-semibold animate-pulse',
  };

  return (
    <span className={`text-xs ${colors[urgency]}`}>SLA: {remaining}</span>
  );
}
