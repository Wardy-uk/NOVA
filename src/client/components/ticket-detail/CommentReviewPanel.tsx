import { useState } from 'react';

export interface CommentReview {
  overallScore: number;
  rule1Score: number;
  rule2Score: number;
  rule3Score: number;
  summary: string;
  suggestedRewrite: string;
}

export interface CommentReviewPanelProps {
  /** Current draft text to review. */
  draft: string;
  ticketKey?: string;
  /** Called when the user clicks "Use this rewrite". */
  onUseRewrite: (text: string) => void;
  /** Optional: disable the trigger (e.g. while posting). */
  disabled?: boolean;
}

const RULES: Array<{ key: 'rule1Score' | 'rule2Score' | 'rule3Score'; label: string }> = [
  { key: 'rule1Score', label: 'Ownership' },
  { key: 'rule2Score', label: "What's happening" },
  { key: 'rule3Score', label: 'Timeframe' },
];

const PASS_THRESHOLD = 2;

/**
 * "Review this comment" button + Golden-Rules results panel. Reused by every
 * public comment composer. Manages its own fetch/state — host just supplies the
 * draft and an onUseRewrite handler.
 */
export function CommentReviewPanel({ draft, ticketKey, onUseRewrite, disabled }: CommentReviewPanelProps) {
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<CommentReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runReview = async () => {
    if (!draft.trim()) return;
    setReviewing(true);
    setError(null);
    try {
      const res = await fetch('/api/comments/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentBody: draft.trim(), ticketKey }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Review failed');
      setReview(json.data as CommentReview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={runReview}
        disabled={disabled || reviewing || !draft.trim()}
        className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all disabled:opacity-40"
        style={{
          background: 'rgba(94,193,202,0.12)',
          color: '#5ec1ca',
          border: '1px solid rgba(94,193,202,0.35)',
        }}
        title="Score this draft against the 3 Golden Rules"
      >
        {reviewing ? 'Reviewing…' : '✦ Review this comment'}
      </button>

      {error && (
        <div className="mt-2 text-[11px] text-rose-400">{error}</div>
      )}

      {review && (
        <div
          className="mt-2 p-3 rounded-lg border border-white/10 space-y-2"
          style={{ background: 'rgba(255,255,255,0.03)' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {RULES.map(({ key, label }) => {
              const score = review[key];
              const pass = score >= PASS_THRESHOLD;
              return (
                <span
                  key={key}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: pass ? 'rgba(16,185,129,0.15)' : 'rgba(244,63,94,0.15)',
                    color: pass ? '#10b981' : '#f43f5e',
                    border: `1px solid ${pass ? 'rgba(16,185,129,0.4)' : 'rgba(244,63,94,0.4)'}`,
                  }}
                >
                  {pass ? '✓' : '✗'} {label} {score}/3
                </span>
              );
            })}
          </div>

          {review.summary && (
            <div className="text-[11px] text-[#94a3b8]">{review.summary}</div>
          )}

          {review.suggestedRewrite && (
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[#64748b] font-bold mb-1">Suggested rewrite</div>
              <div className="text-[12px] text-neutral-200 whitespace-pre-wrap mb-2">{review.suggestedRewrite}</div>
              <button
                onClick={() => { onUseRewrite(review.suggestedRewrite); setReview(null); }}
                className="px-3 py-1 text-[10px] font-bold rounded-lg text-[#0f172a]"
                style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)' }}
              >
                Use this rewrite
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
