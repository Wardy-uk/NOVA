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
        Send a progress update to the onboarding's requestor
      </label>

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

// Guild onboarding recipients (backlog #8, level 3) — the org's own addresses
// for the new-submission alert, weekly digest, and INTS escalations. Separate
// from the escalation policy below; saved to /api/portal/onboarding-config.
function OnboardingRecipientsCard() {
  const FIELDS: Array<{ key: string; label: string; hint?: string }> = [
    { key: 'inboxEmail', label: 'Onboarding inbox', hint: 'Alerted on each new onboarding' },
    { key: 'digestRecipients', label: 'Weekly digest recipients', hint: 'Comma-separated' },
    { key: 'intsNudgeEmail', label: 'INTS day 7 — reminder' },
    { key: 'intsLeadEmail', label: 'INTS day 14 — onboarding lead' },
    { key: 'intsManagerEmail', label: 'INTS day 21 — manager' },
  ];
  const [vals, setVals] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    pf('/api/portal/onboarding-config').then(r => r.json())
      .then(d => { if (!cancelled && d.ok) setVals(d.data || {}); })
      .catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await pf('/api/portal/onboarding-config', { method: 'PUT', body: JSON.stringify(vals) });
      const d = await res.json();
      if (d.ok) setSaved(true);
    } finally { setSaving(false); }
  };

  if (loading) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Onboarding notifications</h2>
        <p className="text-xs text-gray-500">Who in your organisation receives onboarding alerts, the weekly status digest, and integration (INTS) escalations.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="text-xs font-medium text-gray-700">{f.label}</label>
            {f.hint && <span className="text-[11px] text-gray-400 ml-1">{f.hint}</span>}
            <input className={inputCls} value={vals[f.key] || ''} placeholder="email@company.com"
              onChange={e => { setVals(prev => ({ ...prev, [f.key]: e.target.value })); setSaved(false); }} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-xs text-green-600">Saved.</span>}
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark disabled:opacity-50 text-sm">
          {saving ? 'Saving…' : 'Save recipients'}
        </button>
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

  // ── Test send ──
  const [onboardings, setOnboardings] = useState<Array<{ key: string; summary: string; stage: string; ageDays: number; reporterEmail: string | null }>>([]);
  const [testLevel, setTestLevel] = useState<number | ''>('');
  const [testTickets, setTestTickets] = useState<Record<string, boolean>>({});
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pf('/api/portal/escalation-policy/onboardings')
      .then(r => r.json())
      .then(d => { if (!cancelled && d.ok) setOnboardings(d.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const sendTest = async () => {
    const ticketKeys = Object.keys(testTickets).filter(k => testTickets[k]);
    if (!testLevel || ticketKeys.length === 0) { setTestErr('Pick a level and at least one onboarding.'); return; }
    setTestBusy(true); setTestErr(null); setTestMsg(null);
    try {
      const res = await pf('/api/portal/escalation-policy/test-send', { method: 'POST', body: JSON.stringify({ levelDay: testLevel, ticketKeys }) });
      const d = await res.json();
      if (d.ok) setTestMsg(d.data.note); else setTestErr(d.error || 'Test send failed');
    } catch {
      setTestErr('Test send failed');
    } finally {
      setTestBusy(false);
    }
  };

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
    levels: [...policy.levels, { day: 7, name: 'New level', sendCustomerUpdate: false, escalate: true, escalationRecipients: [], informRecipients: [] }]
      .sort((a, b) => a.day - b.day),
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Onboarding Configuration</h1>
        <p className="text-sm text-gray-600">
          Set who receives your onboarding notifications, and the schedule for progress updates and escalations.
        </p>
      </div>

      <OnboardingRecipientsCard />

      <div className="pt-2">
        <h2 className="text-lg font-semibold text-gray-900">Escalation schedule</h2>
        <p className="text-sm text-gray-600">Progress updates and escalations for onboardings that aren’t complete by each day threshold.</p>
      </div>

      {isDefault && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          You’re viewing the default template. Add recipient emails and <strong>Save</strong> to store it for your organisation.
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
          While off, nothing is sent. Progress updates go to each onboarding's requestor automatically; you must add a recipient email to every enabled escalation level before turning this on.
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

      {/* Test send */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h2 className="text-base font-semibold text-gray-900">Test send</h2>
        <p className="text-xs text-gray-500">
          Fire a level's emails now for the onboardings you pick, as if they'd hit that milestone. Everything is sent
          <strong> only to you</strong>, marked <strong>[TEST]</strong> (noting who it would really go to). Nothing is logged and real escalations still fire normally.
        </p>
        {testErr && <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{testErr}</div>}
        {testMsg && <div className="p-2 bg-green-50 border border-green-200 rounded text-xs text-green-700">{testMsg}</div>}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Level to test</label>
          <select value={testLevel} onChange={e => setTestLevel(e.target.value ? Number(e.target.value) : '')} className={inputCls}>
            <option value="">Select a level…</option>
            {policy.levels.map((l, i) => <option key={i} value={l.day}>{l.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Onboardings</label>
          {onboardings.length === 0 ? (
            <p className="text-xs text-gray-400">No open onboardings found for your organisation.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {onboardings.map(o => (
                <li key={o.key} className="px-3 py-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={!!testTickets[o.key]} onChange={e => setTestTickets(p => ({ ...p, [o.key]: e.target.checked }))} className="rounded border-gray-300 text-brand focus:ring-brand" />
                    <span className="font-mono text-xs text-gray-500">{o.key}</span>
                    <span className="truncate flex-1">{o.summary}</span>
                    <span className="text-xs text-gray-400 whitespace-nowrap">{o.ageDays}d · {o.stage}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <button type="button" onClick={sendTest} disabled={testBusy || !testLevel || Object.values(testTickets).every(v => !v)} className="px-5 py-2 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50">
            {testBusy ? 'Sending…' : 'Send test to me'}
          </button>
        </div>
      </div>
    </div>
  );
}
