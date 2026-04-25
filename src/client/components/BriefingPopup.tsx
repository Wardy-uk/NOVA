import { useState, useEffect } from 'react';

interface PopupData {
  show: boolean;
  headline?: string;
  priorityActions?: Array<{ ticketKey: string; summary: string; reason: string }>;
  briefingDate?: string;
}

export function BriefingPopup({ onNavigate }: { onNavigate: (view: string) => void }) {
  const [data, setData] = useState<PopupData | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const token = localStorage.getItem('token');

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(checkPopup, 2000);
    return () => clearTimeout(timer);
  }, [token]);

  async function checkPopup() {
    try {
      const res = await fetch('/api/briefing/popup', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.ok && json.data?.show) {
        setData(json.data);
        setVisible(true);
      }
    } catch {}
  }

  async function dismiss() {
    setDismissing(true);
    try {
      await fetch('/api/briefing/dismiss', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
    setVisible(false);
  }

  function viewFull() {
    dismiss();
    onNavigate('briefing');
  }

  if (!visible || !data) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 px-5 py-4 border-b border-zinc-800">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-1">Daily Briefing · {data.briefingDate}</p>
          <p className="text-white font-medium">{data.headline}</p>
        </div>

        {/* Priority actions */}
        {data.priorityActions && data.priorityActions.length > 0 && (
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Top Priorities</p>
            {data.priorityActions.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded shrink-0">
                  {a.ticketKey}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{a.summary}</p>
                  <p className="text-xs text-zinc-500">{a.reason}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 bg-zinc-900/80">
          <button
            onClick={viewFull}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View Full Briefing →
          </button>
          <button
            onClick={dismiss}
            disabled={dismissing}
            className="px-4 py-1.5 text-sm rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
