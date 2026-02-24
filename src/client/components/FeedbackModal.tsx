import { useState } from 'react';

const TYPES = [
  { value: 'bug', label: 'Report a Bug', icon: '\u26A0' },
  { value: 'question', label: 'Ask a Question', icon: '?' },
  { value: 'feature', label: 'Suggest a Feature', icon: '\u2728' },
] as const;

interface Props {
  onClose: () => void;
}

export function FeedbackModal({ onClose }: Props) {
  const [type, setType] = useState<'bug' | 'question' | 'feature'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Please enter a title'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title: title.trim(), description: description.trim() || undefined }),
      });
      const json = await resp.json();
      if (json.ok) {
        setSubmitted(true);
        setTimeout(onClose, 1500);
      } else {
        setError(json.error ?? 'Failed to submit');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-[#2f353d] border border-[#3a424d] rounded-lg w-full max-w-md mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3a424d]">
          <h3 className="text-sm font-semibold text-neutral-100">Send Feedback</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300 text-sm">{'\u2715'}</button>
        </div>

        {submitted ? (
          <div className="px-5 py-8 text-center">
            <div className="text-green-400 text-2xl mb-2">{'\u2713'}</div>
            <div className="text-sm text-neutral-200">Thanks for your feedback!</div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            {/* Type selector */}
            <div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">Type</div>
              <div className="flex gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setType(t.value)}
                    className={`flex-1 px-3 py-2 text-xs rounded border transition-colors ${
                      type === t.value
                        ? 'bg-[#5ec1ca]/20 border-[#5ec1ca] text-[#5ec1ca] font-semibold'
                        : 'bg-[#272C33] border-[#3a424d] text-neutral-400 hover:border-neutral-500'
                    }`}
                  >
                    <span className="mr-1">{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Title</div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={type === 'bug' ? 'What went wrong?' : type === 'question' ? 'What do you need help with?' : 'What would you like to see?'}
                className="w-full bg-[#272C33] text-neutral-200 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors placeholder:text-neutral-600"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Description <span className="text-neutral-600">(optional)</span></div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add more details..."
                rows={3}
                className="w-full bg-[#272C33] text-neutral-200 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors placeholder:text-neutral-600 resize-none"
              />
            </div>

            {error && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-1.5">{error}</div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !title.trim()}
                className="px-4 py-2 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
