import React, { useEffect, useState } from 'react';
import {
  DEFAULT_ESCALATION_POLICY,
  type OnboardingEscalationPolicy,
  type EscalationLevel,
  type EscalationRecipient,
} from '../../../shared/portal-types.js';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm';
const smallInput = 'px-2 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand text-sm';

function RecipientEditor({ label, hint, items, onChange }: {
  label: string; hint?: string; items: EscalationRecipient[]; onChange: (v: EscalationRecipient[]) => void;
}) {
  const update = (i: number, patch: Partial<EscalationRecipient>) =>
    onChange(items.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        {hint && <span className="text-[11px] text-gray-400">{hint}</span>}
      </div>
      {items.length === 0 && <p className="text-xs text-gray-400">None yet.</p>}
      {items.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={`${smallInput} w-40`} placeholder="Name" value={r.name} onChange={e => update(i, { name: e.target.value })} />
          <input className={`${smallInput} flex-1`} placeholder="email@company.com" value={r.email} onChange={e => update(i, { email: e.target.value })} />
          <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 text-lg leading-none" aria-label="Remove recipient">×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { name: '', email: '' }])} className="text-xs text-brand hover:underline">+ Add recipient</button>
    </div>
  );
}

function LevelCard({ level, onChange, onRemove }: {
  level: EscalationLevel; onChange: (l: EscalationLevel) => void; onRemove: () => void;
}) {
  const set = (patch: Partial<EscalationLevel>) => onChange({ ...level, ...patch });
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-gray-600">Day</span>
          <input type="number" min={1} max={365} value={level.day} onChange={e => set({ day: parseInt(e.target.value, 10) || 1 })} className={`${smallInput} w-20`} />
        </div>
        <input value={level.name} onChange={e => set({ name: e.target.value })} placeholder="Level name" className={`${inputCls} flex-1`} />
        <button type="button" onClick={onRemove} className="text-xs text-red-500 hover:underline whitespace-nowrap">Remove level</button>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={level.sendCustomerUpdate} onChange={e => set({ sendCustomerUpdate: e.target.checked })} className="rounded border-gray-300 text-brand focus:ring-brand" />
        Send a progress update to the customer
      </label>
      {level.sendCustomerUpdate && (
        <RecipientEditor label="Customer recipients" hint="who receives the progress update" items={level.customerRecipients} onChange={v => set({ customerRecipients: v })} />
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={level.escalate} onChange={e => set({ escalate: e.target.checked })} className="rounded border-gray-300 text-brand focus:ring-brand" />
        Raise an internal escalation
      </label>
      {level.escalate && (
        <div className="space-y-3 pl-1">
          <RecipientEditor label="Escalate to" hint="action required" items={level.escalationRecipients} onChange={v => set({ escalationRecipients: v })} />
          <RecipientEditor label="Also inform" hint="visibility only, no action" items={level.informRecipients} onChange={v => set({ informRecipients: v })} />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Note (included in the message)</label>
        <textarea value={level.note || ''} onChange={e => set({ note: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
      </div>
    </div>
  );
}

export default function PortalEscalations() {
  const [policy, setPolicy] = useState<OnboardingEscalationPolicy | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await pf('/api/portal/escalation-policy');
        const d = await res.json();
        if (cancelled) return;
        if (d.ok) { setPolicy(d.data.policy); setIsDefault(d.data.isDefault); }
        else setError(d.error || 'Failed to load policy');
      } catch {
        if (!cancelled) setError('Failed to load policy');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await pf('/api/portal/escalation-policy', { method: 'PUT', body: JSON.stringify(policy) });
      const d = await res.json();
      if (d.ok) { setSaved(true); setIsDefault(false); }
      else setError(d.error || 'Failed to save');
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="max-w-3xl mx-auto animate-pulse h-64 bg-gray-100 rounded-xl" />;
  if (!policy) return <div className="max-w-3xl mx-auto text-sm text-red-600">{error || 'Could not load the escalation policy.'}</div>;

  const setLevel = (i: number, l: EscalationLevel) => setPolicy({ ...policy, levels: policy.levels.map((x, j) => j === i ? l : x) });
  const addLevel = () => setPolicy({
    ...policy,
    levels: [...policy.levels, { day: 7, name: 'New level', sendCustomerUpdate: false, customerRecipients: [], escalate: true, escalationRecipients: [], informRecipients: [] }]
      .sort((a, b) => a.day - b.day),
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Onboarding escalations</h1>
        <p className="text-sm text-gray-600">
          Scheduled progress updates and escalations for onboardings that aren’t complete by each day threshold.
        </p>
      </div>

      {isDefault && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          You’re viewing the default template (from the Guild agreement). Add recipient emails and <strong>Save</strong> to store it for your organisation.
        </div>
      )}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {saved && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">Saved.</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
          <input type="checkbox" checked={policy.enabled} onChange={e => { setPolicy({ ...policy, enabled: e.target.checked }); setSaved(false); }} className="rounded border-gray-300 text-brand focus:ring-brand" />
          Policy active — send updates &amp; escalations automatically
        </label>
        <p className="text-xs text-gray-500">
          While off, nothing is sent. You must add a recipient email to every enabled update/escalation level before turning this on.
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={policy.workingDays} onChange={e => setPolicy({ ...policy, workingDays: e.target.checked })} className="rounded border-gray-300 text-brand focus:ring-brand" />
          Count age in working days (Mon–Fri)
        </label>
      </div>

      {policy.levels.map((l, i) => (
        <LevelCard key={i} level={l} onChange={nl => setLevel(i, nl)} onRemove={() => setPolicy({ ...policy, levels: policy.levels.filter((_, j) => j !== i) })} />
      ))}

      <button type="button" onClick={addLevel} className="text-sm text-brand hover:underline">+ Add level</button>

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => { setPolicy(DEFAULT_ESCALATION_POLICY); setSaved(false); }}
          className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Reset to template
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save policy'}
        </button>
      </div>
    </div>
  );
}
