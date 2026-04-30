import { useState, useEffect } from 'react';

interface DeferReason {
  key: string;
  label: string;
}

interface Props {
  ticketKey: string;
  onClose: () => void;
  onDeferred: () => void;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${localStorage.getItem('nova_auth_token') || ''}`,
    'Content-Type': 'application/json',
  };
}

export function DeferReasonModal({ ticketKey, onClose, onDeferred }: Props) {
  const [reasons, setReasons] = useState<DeferReason[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/my-tickets/defer-reasons', { headers: authHeaders() })
      .then(r => r.json())
      .then(j => { if (j.ok) setReasons(j.data); })
      .catch(() => {});
  }, []);

  const needsCustomTime = selected === 'on_a_call';

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ticket_key: ticketKey,
        reason: selected,
      };
      if (note.trim()) body.note = note.trim();
      if (customTime) body.resurface_at = new Date(customTime).toISOString();

      const res = await fetch('/api/my-tickets/defer', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Failed to defer');
        return;
      }
      onDeferred();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#1A1F26] border border-[#2A2F38] rounded-xl w-full max-w-md p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-neutral-100 mb-1">Defer ticket</h3>
        <p className="text-xs text-neutral-400 mb-4">{ticketKey} — why can't you action this now?</p>

        <div className="space-y-2 mb-4">
          {reasons.map(r => (
            <button
              key={r.key}
              onClick={() => setSelected(r.key)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                selected === r.key
                  ? 'border-blue-500 bg-blue-950/30 text-blue-300'
                  : 'border-[#2A2F38] bg-[#141820] text-neutral-300 hover:border-[#3A3F48]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {needsCustomTime && (
          <div className="mb-3">
            <label className="block text-xs text-neutral-400 mb-1">Resurface at (max 2h)</label>
            <input
              type="datetime-local"
              value={customTime}
              onChange={e => setCustomTime(e.target.value)}
              className="w-full bg-[#141820] border border-[#2A2F38] rounded px-3 py-1.5 text-sm text-neutral-200"
            />
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs text-neutral-400 mb-1">Note (optional)</label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Brief context..."
            className="w-full bg-[#141820] border border-[#2A2F38] rounded px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600"
          />
        </div>

        {error && (
          <p className="text-xs text-red-400 mb-3">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {submitting ? 'Deferring...' : 'Defer'}
          </button>
        </div>
      </div>
    </div>
  );
}
