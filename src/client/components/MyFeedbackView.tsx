import { useState, useEffect, useCallback } from 'react';

interface FeedbackItem {
  id: number;
  type: 'bug' | 'question' | 'feature';
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  admin_reply: string | null;
  admin_reply_at: string | null;
}

const TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  bug: { bg: 'bg-red-900/40', text: 'text-red-400', label: 'Bug' },
  feature: { bg: 'bg-purple-900/40', text: 'text-purple-400', label: 'Feature' },
  question: { bg: 'bg-blue-900/40', text: 'text-blue-400', label: 'Question' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  new: { bg: 'bg-amber-900/40', text: 'text-amber-400' },
  reviewed: { bg: 'bg-blue-900/40', text: 'text-blue-400' },
  resolved: { bg: 'bg-green-900/40', text: 'text-green-400' },
};

export function MyFeedbackView() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideResolved, setHideResolved] = useState(true);

  const token = localStorage.getItem('nova_token');
  const headers = { 'Authorization': `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/feedback/mine?hideResolved=${hideResolved}`, { headers });
      const json = await res.json();
      if (json.ok) setItems(json.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [hideResolved]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="text-sm text-neutral-500 py-8 text-center">Loading your feedback...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-200">My Feedback</h2>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={hideResolved}
            onChange={e => setHideResolved(e.target.checked)}
            className="rounded"
          />
          Hide resolved
        </label>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-neutral-500 py-8 text-center border border-[#3a424d] rounded-lg bg-[#2f353d]">
          {hideResolved ? 'No open feedback. Toggle "Hide resolved" to see all.' : 'You haven\'t submitted any feedback yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => {
            const typeStyle = TYPE_STYLES[item.type] ?? TYPE_STYLES.question;
            const statusStyle = STATUS_STYLES[item.status] ?? STATUS_STYLES.new;
            return (
              <div key={item.id} className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
                <div className="flex items-start gap-2 mb-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeStyle.bg} ${typeStyle.text}`}>
                    {typeStyle.label}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                    {item.status}
                  </span>
                  <span className="text-[10px] text-neutral-600 ml-auto">
                    {new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div className="text-sm text-neutral-200 font-medium mb-1">{item.title}</div>
                {item.description && (
                  <div className="text-xs text-neutral-400 mb-2">{item.description}</div>
                )}
                {item.admin_reply && (
                  <div className="mt-3 border-t border-[#3a424d] pt-3">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Admin Reply</div>
                    <div className="text-xs text-neutral-300 bg-[#272C33] rounded px-3 py-2">
                      {item.admin_reply}
                    </div>
                    {item.admin_reply_at && (
                      <div className="text-[10px] text-neutral-600 mt-1">
                        {new Date(item.admin_reply_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
