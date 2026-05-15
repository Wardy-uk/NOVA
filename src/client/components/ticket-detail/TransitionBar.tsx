import { useState } from 'react';
import { GlassCard, getDefaultCommentType } from '../queue/index.js';

interface JiraTransition {
  id?: number | string;
  name?: string;
  to?: { name?: string };
}

export interface TransitionBarProps {
  ticketKey: string;
  transitions: JiraTransition[];
  onTransitioned?: () => void;
}

export function TransitionBar({ ticketKey, transitions, onTransitioned }: TransitionBarProps) {
  const [modal, setModal] = useState<{ transition: JiraTransition; comment: string; commentType: 'internal' | 'public' } | null>(null);
  const [busy, setBusy] = useState(false);

  if (transitions.length === 0) return null;

  const openModal = (t: JiraTransition) => {
    setModal({
      transition: t,
      comment: '',
      commentType: getDefaultCommentType(t.name ?? ''),
    });
  };

  const handleTransition = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { transition: String(modal.transition.id ?? modal.transition.name ?? '') };
      if (modal.comment.trim()) {
        body.comment = modal.comment.trim();
        body.commentVisibility = modal.commentType;
      }
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Transition failed');
      setModal(null);
      onTransitioned?.();
    } catch { /* silent */ } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <GlassCard className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">Status Transitions</div>
        <div className="flex flex-wrap gap-2">
          {transitions.map((t) => (
            <button
              key={String(t.id ?? t.name)}
              onClick={() => openModal(t)}
              disabled={busy}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-white/10 text-neutral-200 hover:bg-white/8 transition-all disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              {'→'} {t.to?.name ?? t.name}
            </button>
          ))}
        </div>
      </GlassCard>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div
            className="relative rounded-2xl p-6 w-full max-w-lg mx-4"
            style={{
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 25px 80px rgba(0,0,0,0.6)',
            }}
          >
            <h3 className="text-lg font-bold text-neutral-100 mb-1">
              Transition to: {modal.transition.to?.name ?? modal.transition.name}
            </h3>
            <p className="text-[12px] text-neutral-400 mb-4">
              {ticketKey} {'—'} optional comment will be posted with the transition.
            </p>
            <textarea
              value={modal.comment}
              onChange={(e) => setModal(m => m ? { ...m, comment: e.target.value } : null)}
              placeholder="Optional comment..."
              rows={4}
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 mb-3"
              style={{ background: 'rgba(255,255,255,0.04)' }}
              autoFocus
            />
            <div className="flex items-center gap-2 mb-4">
              {(['internal', 'public'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setModal(m => m ? { ...m, commentType: t } : null)}
                  className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all"
                  style={{
                    background: modal.commentType === t
                      ? (t === 'public' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)')
                      : 'transparent',
                    color: modal.commentType === t
                      ? (t === 'public' ? '#10b981' : '#f59e0b')
                      : '#64748b',
                    border: `1px solid ${modal.commentType === t
                      ? (t === 'public' ? 'rgba(16,185,129,0.4)' : 'rgba(245,158,11,0.4)')
                      : 'rgba(255,255,255,0.05)'}`,
                  }}
                >
                  {t === 'internal' ? 'Internal' : 'Public'}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-xs rounded-lg font-semibold text-neutral-300 border border-white/10 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleTransition}
                disabled={busy}
                className="px-5 py-2 text-xs rounded-lg font-bold text-[#0f172a] disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)', boxShadow: '0 4px 16px rgba(16,185,129,0.35)' }}
              >
                {busy ? 'Transitioning...' : 'Confirm Transition'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
