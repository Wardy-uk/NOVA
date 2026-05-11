import { useEffect } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  kind?: 'ok' | 'err' | 'info';
}

let toastIdCounter = 0;
export function nextToastId(): number { return ++toastIdCounter; }

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <ToastNotification key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastNotification({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const bg = toast.kind === 'err' ? 'rgba(239,68,68,0.15)' : toast.kind === 'ok' ? 'rgba(16,185,129,0.15)' : 'rgba(94,193,202,0.15)';
  const border = toast.kind === 'err' ? '#ef4444' : toast.kind === 'ok' ? '#10b981' : '#5ec1ca';

  return (
    <div
      className="px-4 py-2.5 rounded-xl text-[11px] text-neutral-200 shadow-lg animate-in slide-in-from-right-5 duration-300"
      style={{ background: bg, border: `1px solid ${border}40`, backdropFilter: 'blur(12px)' }}
    >
      {toast.message}
    </div>
  );
}
