import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import { GlassCard } from '../queue/index.js';

export interface CommentComposerProps {
  ticketKey: string;
  onCommentPosted?: () => void;
  internalOnly?: boolean;
  aiDraftSupport?: boolean;
  taggedAuthor?: string;
  initialDraft?: string;
  initialType?: 'internal' | 'public';
}

export interface CommentComposerHandle {
  setDraft: (text: string) => void;
  setType: (type: 'internal' | 'public') => void;
}

export const CommentComposer = forwardRef<CommentComposerHandle, CommentComposerProps>(function CommentComposer(
  { ticketKey, onCommentPosted, internalOnly, aiDraftSupport, taggedAuthor, initialDraft, initialType },
  ref,
) {
  const [draft, setDraft] = useState(initialDraft ?? '');
  const [commentType, setCommentType] = useState<'internal' | 'public'>(internalOnly ? 'internal' : (initialType ?? 'internal'));
  const [busy, setBusy] = useState(false);
  const [aiDraftUsed, setAiDraftUsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    setDraft: (text: string) => {
      setDraft(text);
      if (aiDraftSupport) setAiDraftUsed(true);
      setTimeout(() => {
        textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textareaRef.current?.focus();
      }, 100);
    },
    setType: (type: 'internal' | 'public') => {
      if (!internalOnly) setCommentType(type);
    },
  }));

  const handlePost = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const body = taggedAuthor ? `[${taggedAuthor}] ${draft.trim()}` : draft.trim();
      const res = await fetch(`/api/jira/issues/${encodeURIComponent(ticketKey)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: body, commentVisibility: commentType }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Failed to post comment');
      setDraft('');
      setAiDraftUsed(false);
      onCommentPosted?.();
    } catch { /* silent */ } finally {
      setBusy(false);
    }
  };

  return (
    <GlassCard className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold">Add Comment</div>
        {aiDraftSupport && aiDraftUsed && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#5ec1ca]/15 text-[#5ec1ca] border border-[#5ec1ca]/30">AI draft</span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); if (aiDraftUsed) setAiDraftUsed(false); }}
        placeholder="Write a comment..."
        rows={3}
        className="w-full px-3 py-2 text-[13px] rounded-lg border border-white/10 text-neutral-50 placeholder-neutral-600 mb-2"
        style={{ background: 'rgba(255,255,255,0.03)' }}
      />
      <div className="flex items-center justify-between">
        {!internalOnly ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCommentType('internal')}
              className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all"
              style={{
                background: commentType === 'internal' ? 'rgba(245,158,11,0.15)' : 'transparent',
                color: commentType === 'internal' ? '#f59e0b' : '#64748b',
                border: `1px solid ${commentType === 'internal' ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.05)'}`,
              }}
            >
              Internal
            </button>
            <button
              onClick={() => setCommentType('public')}
              className="px-2.5 py-1 text-[10px] font-semibold rounded-full transition-all"
              style={{
                background: commentType === 'public' ? 'rgba(16,185,129,0.15)' : 'transparent',
                color: commentType === 'public' ? '#10b981' : '#64748b',
                border: `1px solid ${commentType === 'public' ? 'rgba(16,185,129,0.4)' : 'rgba(255,255,255,0.05)'}`,
              }}
            >
              Public
            </button>
          </div>
        ) : (
          <span className="px-2.5 py-1 text-[10px] font-semibold rounded-full bg-amber-900/50 text-amber-400">Internal only</span>
        )}
        <button
          onClick={handlePost}
          disabled={busy || !draft.trim()}
          className="px-4 py-1.5 text-[11px] font-bold rounded-lg text-[#0f172a] disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)' }}
        >
          {busy ? 'Posting...' : 'Post Comment'}
        </button>
      </div>
    </GlassCard>
  );
});
