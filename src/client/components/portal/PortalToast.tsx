import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Toast {
  id: number;
  message: string;
  ticketKey?: string;
}

interface Props {
  onViewTicket?: (key: string) => void;
}

let nextId = 0;
const listeners = new Set<(toast: Toast) => void>();

export function showPortalToast(message: string, ticketKey?: string): void {
  const toast: Toast = { id: ++nextId, message, ticketKey };
  listeners.forEach(fn => fn(toast));
}

export default function PortalToastContainer({ onViewTicket }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((toast: Toast) => {
    setToasts(prev => [...prev.slice(-2), toast]);
    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toast.id));
      timers.current.delete(toast.id);
    }, 5000);
    timers.current.set(toast.id, timer);
  }, []);

  useEffect(() => {
    listeners.add(addToast);
    return () => {
      listeners.delete(addToast);
      timers.current.forEach(t => clearTimeout(t));
    };
  }, [addToast]);

  const dismiss = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
      {toasts.map(t => (
        <div
          key={t.id}
          style={{ animation: 'slideInRight 0.3s ease-out' }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 flex items-start gap-3"
        >
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center">
            <svg className="w-4 h-4 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900">{t.message}</p>
            {t.ticketKey && onViewTicket && (
              <button
                onClick={() => { onViewTicket(t.ticketKey!); dismiss(t.id); }}
                className="text-xs text-brand font-medium mt-1 hover:underline"
              >
                View ticket
              </button>
            )}
          </div>
          <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
