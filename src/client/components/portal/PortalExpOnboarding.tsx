import React, { useState } from 'react';
import { expMicrositeUrl } from '../../../shared/portal-types.js';

// eXp "Notification of New Agent Joining" (NT-24880) — the simplified onboarding
// intake. One or more joining agents in, a QA + Onboarding ticket pair out per
// agent. Agents can be typed in, pasted from the email eXp already send, or
// imported from a spreadsheet.

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm';
const labelCls = 'block text-sm font-medium text-gray-700 mb-1';

interface AgentRow {
  name: string;
  email: string;
  phone: string;
  address: string;
  hasMicrosite: boolean;
  micrositeUrl: string;
  existingAgent: boolean;
  notes: string;
}

interface AgentResult {
  agent: string;
  ref: string;
  qaKey: string | null;
  onboardingKey: string | null;
  error: string | null;
}

const blankAgent = (): AgentRow => ({
  name: '', email: '', phone: '', address: '',
  hasMicrosite: false, micrositeUrl: '', existingAgent: false, notes: '',
});

export default function PortalExpOnboarding({ onCreated }: { onCreated: (ticketKey: string) => void }) {
  const [agents, setAgents] = useState<AgentRow[]>([blankAgent()]);
  const [notes, setNotes] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importedNotice, setImportedNotice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AgentResult[] | null>(null);

  const setField = (i: number, k: keyof AgentRow, v: string | boolean) =>
    setAgents(prev => prev.map((a, idx) => (idx === i ? { ...a, [k]: v } : a)));
  const addAgent = () => setAgents(prev => [...prev, blankAgent()]);
  const removeAgent = (i: number) => setAgents(prev => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const applyImported = (imported: Array<Partial<AgentRow>>) => {
    if (imported.length === 0) { setError('We couldn\'t find any agent details in that.'); return; }
    setAgents(imported.map(a => ({ ...blankAgent(), ...a } as AgentRow)));
    setImportedNotice(true);
    setPasteOpen(false);
    setPasteText('');
  };

  const importFromText = async () => {
    if (!pasteText.trim()) return;
    setImporting(true); setError(null);
    try {
      const res = await pf('/api/portal/onboarding/exp/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      });
      const d = await res.json();
      if (d.ok) applyImported(d.data.agents);
      else setError(d.error || 'Import failed');
    } catch { setError('Import failed'); }
    finally { setImporting(false); }
  };

  const importFromFile = async (file: File) => {
    setImporting(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await pf('/api/portal/onboarding/exp/import', { method: 'POST', body: fd });
      const d = await res.json();
      if (d.ok) applyImported(d.data.agents);
      else setError(d.error || 'Import failed');
    } catch { setError('Import failed'); }
    finally { setImporting(false); }
  };

  const canSubmit = agents.every(a => a.name.trim() && a.email.trim());

  const submit = async () => {
    if (!canSubmit) { setError('Every agent needs a full name and an email address.'); return; }
    setSubmitting(true); setError(null);
    try {
      const res = await pf('/api/portal/onboarding/exp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: agents.map(a => ({
            name: a.name.trim(), email: a.email.trim(),
            phone: a.phone.trim() || undefined, address: a.address.trim() || undefined,
            hasMicrosite: a.hasMicrosite, micrositeUrl: a.micrositeUrl.trim() || undefined,
            existingAgent: a.existingAgent, notes: a.notes.trim() || undefined,
          })),
          notes: notes.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (d.ok) setResults(d.data.results);
      else setError(d.error || 'Failed to submit');
    } catch { setError('Failed to submit'); }
    finally { setSubmitting(false); }
  };

  if (results) {
    const created = results.filter(r => !r.error);
    const failed = results.filter(r => r.error);
    return (
      <div className="text-center py-6">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          {created.length} agent{created.length === 1 ? '' : 's'} logged
        </h2>
        <p className="text-sm text-gray-600 mb-5">Each agent has a QA ticket and an Onboarding ticket. The team will pick them up shortly.</p>
        <div className="space-y-2 text-left max-w-md mx-auto">
          {created.map(r => (
            <div key={r.ref} className="rounded-lg border border-gray-200 px-4 py-3">
              <div className="text-sm font-medium text-gray-900">{r.agent}</div>
              <div className="text-xs text-gray-600 mt-1 flex gap-3">
                <button onClick={() => r.qaKey && onCreated(r.qaKey)} className="font-mono text-brand hover:underline">{r.qaKey}</button>
                <span className="text-gray-300">·</span>
                <button onClick={() => r.onboardingKey && onCreated(r.onboardingKey)} className="font-mono text-brand hover:underline">{r.onboardingKey}</button>
              </div>
            </div>
          ))}
          {failed.map(r => (
            <div key={r.ref} className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <div className="text-sm font-medium text-red-800">{r.agent} — not created</div>
              <div className="text-xs text-red-700 mt-1">{r.error} Please contact support@nurtur.tech quoting {r.ref}.</div>
            </div>
          ))}
        </div>
        <button
          onClick={() => { setResults(null); setAgents([blankAgent()]); setNotes(''); }}
          className="mt-6 px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors"
        >
          Log another agent
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        One QA ticket and one Onboarding ticket are raised per agent. All users are set up as <strong>Agents, not Admins</strong>,
        under <strong>eXp World UK Limited</strong>, with the LeadPro abandoned basket enabled for the IVT.
      </p>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {importedNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          We've pre-filled these agents from what you provided. Automated extraction can make mistakes —
          <strong> please check every detail before submitting.</strong>
        </div>
      )}

      {/* Import — paste the email eXp already send, or upload a spreadsheet */}
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setPasteOpen(o => !o)} disabled={importing}
            className="px-3 py-1.5 bg-brand text-white rounded-lg text-sm hover:bg-brand-dark disabled:opacity-50">
            {pasteOpen ? 'Cancel paste' : 'Paste from email'}
          </button>
          <label className="cursor-pointer px-3 py-1.5 border border-gray-300 bg-white rounded-lg text-sm hover:bg-gray-100">
            {importing ? 'Reading…' : 'Upload a file'}
            <input type="file" accept=".pdf,.xlsx,.xls,.csv,.txt" className="hidden" disabled={importing}
              onChange={e => { const f = e.target.files?.[0]; if (f) importFromFile(f); e.target.value = ''; }} />
          </label>
          <p className="text-xs text-gray-500">Fills the agent rows below for you to check.</p>
        </div>
        {pasteOpen && (
          <div className="space-y-2">
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6}
              placeholder={'Paste the whole email here, e.g.\n\nAgents Full Name: Adriana Martinez\nAgents Email Address: adriana.martinez@expuk.com\nAgents Phone Number: 07950890204\n…'}
              className={`${inputCls} resize-none font-mono text-xs`} />
            <button type="button" onClick={importFromText} disabled={importing || !pasteText.trim()}
              className="px-3 py-1.5 bg-brand text-white rounded-lg text-sm hover:bg-brand-dark disabled:opacity-50">
              {importing ? 'Reading…' : 'Read agents from this'}
            </button>
          </div>
        )}
      </div>

      {agents.map((a, i) => {
        const url = expMicrositeUrl({ name: a.name, hasMicrosite: a.hasMicrosite, micrositeUrl: a.micrositeUrl });
        return (
          <div key={i} className="rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Agent {i + 1}</div>
              {agents.length > 1 && (
                <button type="button" onClick={() => removeAgent(i)} className="text-xs text-gray-500 hover:text-red-600">Remove</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Agent full name *</label>
                <input value={a.name} onChange={e => setField(i, 'name', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Agent email address *</label>
                <input value={a.email} onChange={e => setField(i, 'email', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Agent phone number</label>
                <input value={a.phone} onChange={e => setField(i, 'phone', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Registered address</label>
                <input value={a.address} onChange={e => setField(i, 'address', e.target.value)} className={inputCls} />
              </div>
            </div>

            <div className="space-y-2">
              <label className={labelCls}>Microsite</label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="radio" checked={a.hasMicrosite} onChange={() => setField(i, 'hasMicrosite', true)} className="text-brand focus:ring-brand" />
                Yes — eXp agent microsite
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="radio" checked={!a.hasMicrosite} onChange={() => setField(i, 'hasMicrosite', false)} className="text-brand focus:ring-brand" />
                No — LeadPro URL
              </label>
              <div>
                <input value={a.micrositeUrl} onChange={e => setField(i, 'micrositeUrl', e.target.value)}
                  placeholder={url || 'valuation.firstnamesurname.expuk.com'} className={`${inputCls} font-mono text-xs`} />
                <p className="mt-1 text-xs text-gray-500">
                  {a.micrositeUrl.trim() ? 'Using the URL you entered.' : url ? `We'll use ${url} unless you enter a different one.` : 'Filled in from the agent\'s name.'}
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={a.existingAgent} onChange={e => setField(i, 'existingAgent', e.target.checked)} className="mt-0.5 rounded text-brand focus:ring-brand" />
              <span>They may already be on LeadPro (moving team / returning) — add a <strong>new IVT</strong> to the existing account.</span>
            </label>

            <div>
              <label className={labelCls}>Notes for this agent</label>
              <textarea value={a.notes} onChange={e => setField(i, 'notes', e.target.value)} rows={2} className={`${inputCls} resize-none`} />
            </div>
          </div>
        );
      })}

      <button type="button" onClick={addAgent}
        className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
        + Add another agent
      </button>

      <div>
        <label className={labelCls}>Notes for the whole request</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
      </div>

      <div className="flex items-center justify-end pt-2">
        <button onClick={submit} disabled={submitting || !canSubmit}
          className="px-6 py-2.5 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {submitting ? 'Submitting…' : `Submit ${agents.length} agent${agents.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
