import { useEffect, useRef } from 'react';

export function useVisibilityInterval(callback: () => void, delayMs: number) {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id) return;
      id = setInterval(() => savedCallback.current(), delayMs);
    };

    const stop = () => {
      if (id) { clearInterval(id); id = null; }
    };

    const onVisChange = () => {
      if (document.hidden) stop(); else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [delayMs]);
}
