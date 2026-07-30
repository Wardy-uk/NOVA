import { useState, useEffect, useCallback } from 'react';
import type { GuildOnboardingRow, GuildMilestoneView } from '../../shared/portal-types.js';

// Internal Guild/BYM onboarding tracker (backlog #8, R5/R6) — replaces the
// "BYM Onboarding Status.xlsx" Guild tab. One row per set-up with a 30-day SLA,
// INTS escalation flag, live JSM status per ticket, and editable manual fields.

const MANUAL_FIELDS: Array<{ key: string; label: string; type: 'date' | 'flag' | 'text' }> = [
  { key: 'dateReceived', label: 'Date Received', type: 'date' },
  { key: 'contractUploaded', label: 'Contract Uploaded', type: 'flag' },
  { key: 'deliverySheetUpdated', label: 'Delivery sheet updated', type: 'flag' },
  { key: 'billedDeliverySheet', label: 'Billed – Delivery Sheet', type: 'flag' },
  { key: 'preBilled', label: 'Pre-billed', type: 'flag' },
  { key: 'formUploadedCrm', label: 'Form uploaded to CRM', type: 'flag' },
  { key: 'welcomeEmail', label: 'BYM – Welcome Email', type: 'flag' },
  { key: 'updateEmailSent', label: 'Update Email Sent', type: 'flag' },
  { key: 'obComments', label: 'OB Comments', type: 'text' },
];

const RAG_COLOR: Record<string, string> = { green: '#16a34a', amber: '#d97706', red: '#dc2626', met: '#2563eb' };
const STATE_COLOR: Record<GuildMilestoneView['state'], string> = {
  done: '#16a34a', in_progress: '#d97706', pending: '#4b5563', na: '#374151',
};

function api<T = unknown>(path: string, opts?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  return fetch(`/api/guild-onboarding${path}`, { headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => r.json());
}

function MilestoneLine({ milestones }: { milestones: GuildMilestoneView[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {milestones.map(m => (
        <div key={m.key} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
          style={{ backgroundColor: '#242a31', border: `1px solid ${STATE_COLOR[m.state]}` }}
          title={`${m.label}${m.detail ? ` — ${m.detail}` : ''}${m.jiraKey ? ` (${m.jiraKey})` : ''}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATE_COLOR[m.state] }} />
          <span className="text-neutral-300">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

function ManualPanel({ row, onSaved }: { row: GuildOnboardingRow; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, unknown>>(row.manualFields || {});
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setVals(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api(`/records/${row.id}/manual`, { method: 'PATCH', body: JSON.stringify({ manualFields: vals }) });
      if (res.ok) onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
      {MANUAL_FIELDS.map(f => (
        <div key={f.key} className={f.type === 'text' ? 'col-span-2 md:col-span-3' : ''}>
          <label className="text-[10px] text-neutral-500 uppercase tracking-wide">{f.label}</label>
          {f.type === 'flag' ? (
            <label className="flex items-center gap-2 text-xs text-neutral-300 mt-1">
              <input type="checkbox" checked={!!vals[f.key]} onChange={e => set(f.key, e.target.checked)} />
              Done
            </label>
          ) : f.type === 'date' ? (
            <input type="date" value={String(vals[f.key] || '')} onChange={e => set(f.key, e.target.value)}
              className="w-full mt-1 bg-[#242a31] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200" />
          ) : (
            <textarea value={String(vals[f.key] || '')} onChange={e => set(f.key, e.target.value)} rows={2}
              className="w-full mt-1 bg-[#242a31] border border-[#3a424d] rounded px-2 py-1 text-xs text-neutral-200 resize-none" />
          )}
        </div>
      ))}
      <div className="col-span-2 md:col-span-3">
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white">
          {saving ? 'Saving…' : 'Save manual fields'}
        </button>
      </div>
    </div>
  );
}

function Row({ row, onChanged }: { row: GuildOnboardingRow; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const office = [row.officeName, row.branchName].filter(Boolean).join(' — ') || '(unnamed)';

  const retry = async () => {
    setRetrying(true);
    try { await api(`/records/${row.id}/retry`, { method: 'POST' }); onChanged(); }
    finally { setRetrying(false); }
  };

  return (
    <div className="bg-[#2f353d] rounded-lg border border-[#3a424d] overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#343b44]">
        <span className="text-neutral-500 text-xs">{open ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-neutral-100 font-medium truncate">{office}</div>
          <div className="text-[10px] text-neutral-500">
            {row.parentKey || 'no QA yet'} · submitted {row.submissionDate.slice(0, 10)}
            {row.invoiceCommencementDate ? ` · invoice ${row.invoiceCommencementDate}` : ''}
          </div>
        </div>
        {row.intsEscalationLevel > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#7f1d1d', color: '#fecaca' }}>
            INTS D{row.intsEscalationLevel}
          </span>
        )}
        <span className="text-[10px] px-2 py-0.5 rounded text-white" style={{ backgroundColor: RAG_COLOR[row.slaRag] }}>
          {row.slaRag === 'met' ? 'SLA met' : row.slaBreached ? 'SLA breached' : `${row.slaDaysRemaining}d left`}
        </span>
        {row.status !== 'success' && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200">{row.status}</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-[#3a424d]">
          <div>
            <div className="text-[10px] text-neutral-500 uppercase tracking-wide mb-1.5">Progress</div>
            <MilestoneLine milestones={row.milestones} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] text-neutral-500 uppercase tracking-wide">Manual fields</div>
              {row.status !== 'success' && (
                <button onClick={retry} disabled={retrying} className="text-[11px] text-blue-400 hover:underline disabled:opacity-50">
                  {retrying ? 'Retrying…' : 'Retry ticket creation'}
                </button>
              )}
            </div>
            <ManualPanel row={row} onSaved={onChanged} />
          </div>
        </div>
      )}
    </div>
  );
}

export function GuildOnboardingView() {
  const [rows, setRows] = useState<GuildOnboardingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rows: GuildOnboardingRow[] }>('/dashboard');
      if (res.ok && res.data) { setRows(res.data.rows); setError(null); }
      else setError(res.error || 'Failed to load');
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-neutral-100">Guild Onboarding</h1>
          <p className="text-xs text-neutral-500">Live tracker for Guild/BYM set-ups — replaces the BYM Onboarding Status spreadsheet.</p>
        </div>
        <button onClick={load} className="text-xs text-neutral-400 hover:text-neutral-200">Refresh</button>
      </div>
      {loading && <div className="text-sm text-neutral-500">Loading…</div>}
      {error && <div className="text-sm text-red-400">{error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div className="text-sm text-neutral-500">No Guild onboardings yet. They appear here once submitted through the portal.</div>
      )}
      <div className="space-y-2">
        {rows.map(r => <Row key={r.id} row={r} onChanged={load} />)}
      </div>
    </div>
  );
}
