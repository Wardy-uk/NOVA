import React, { useEffect, useState } from 'react';
import type { GuildOnboardingRow, GuildMilestoneView } from '../../../shared/portal-types.js';
import PortalOnboardingDashboard from './PortalOnboardingDashboard.js';

// Guild/BYM onboarding tracker (backlog #8, R5) — the customer-facing, read-only
// view of their onboarding set-ups: 30-day SLA, milestone progress line, and
// live workstream statuses. Replaces the emailed spreadsheet status for Guild.
// When the org has no onboarding records (non-Guild orgs, or before the pipeline
// is live), it falls back to the original live-Jira onboarding dashboard.

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

const RAG_COLOR: Record<string, string> = { green: '#16a34a', amber: '#d97706', red: '#dc2626', met: '#2563eb' };
const STATE_COLOR: Record<GuildMilestoneView['state'], string> = {
  done: '#16a34a', in_progress: '#d97706', pending: '#9ca3af', na: '#d1d5db',
};
const STATE_LABEL: Record<GuildMilestoneView['state'], string> = {
  done: 'Done', in_progress: 'In progress', pending: 'Not started', na: 'N/A',
};

function office(r: GuildOnboardingRow): string {
  return [r.officeName, r.branchName].filter(Boolean).join(' — ') || '(unnamed set-up)';
}

function MilestoneLine({ milestones }: { milestones: GuildMilestoneView[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {milestones.map(m => (
        <div key={m.key} className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] bg-gray-50"
          style={{ borderColor: STATE_COLOR[m.state] }}
          title={`${m.label} — ${STATE_LABEL[m.state]}${m.detail ? ` (${m.detail})` : ''}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: STATE_COLOR[m.state] }} />
          <span className="text-gray-700">{m.label}</span>
        </div>
      ))}
    </div>
  );
}

function progressPct(row: GuildOnboardingRow): number {
  const ms = row.milestones.filter(m => m.state !== 'na');
  if (ms.length === 0) return 0;
  const done = ms.filter(m => m.state === 'done').length;
  return Math.round((done / ms.length) * 100);
}

function Row({ row }: { row: GuildOnboardingRow }) {
  const [open, setOpen] = useState(false);
  const pct = progressPct(row);
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
        <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{office(row)}</div>
          <div className="text-[11px] text-gray-500">Submitted {row.submissionDate.slice(0, 10)}{row.invoiceCommencementDate ? ` · invoice starts ${row.invoiceCommencementDate.slice(0, 10)}` : ''}</div>
        </div>
        {row.stage === 'application' ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">Awaiting setup form</span>
        ) : (
          <>
            {row.intsEscalationLevel > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Integration — day {row.intsEscalationLevel}</span>
            )}
            <span className="text-[11px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: RAG_COLOR[row.slaRag] }}>
              {row.slaRag === 'met' ? 'Complete' : row.slaBreached ? 'Over 30 days' : `${row.slaDaysRemaining} days left`}
            </span>
          </>
        )}
      </button>

      {/* Progress bar — completed milestones across the whole set-up */}
      <div className="px-4 pb-3 -mt-1 flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#16a34a' : '#0d9488' }} />
        </div>
        <span className="text-[11px] text-gray-500 tabular-nums w-9 text-right">{pct}%</span>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Milestones</div>
          <MilestoneLine milestones={row.milestones} />
        </div>
      )}
    </div>
  );
}

export default function PortalGuildOnboarding() {
  const [rows, setRows] = useState<GuildOnboardingRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await pf('/api/portal/dashboards/guild-onboarding');
        const d = await res.json();
        if (!active) return;
        if (d.ok) setRows(d.data.rows);
        else setError(d.error || 'Failed to load');
      } catch { if (active) setError('Failed to load'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  if (loading) return <div className="text-sm text-gray-500 p-2">Loading…</div>;
  // No records for this org → keep the original live-Jira onboarding view.
  if (error || !rows || rows.length === 0) return <PortalOnboardingDashboard />;

  const applications = rows.filter(r => r.stage === 'application');
  const inProgress = rows.filter(r => r.stage === 'setup' && r.slaRag !== 'met');
  const completed = rows.filter(r => r.stage === 'setup' && r.slaRag === 'met');
  const overSla = rows.filter(r => r.stage === 'setup' && r.slaBreached).length;
  const escalating = rows.filter(r => r.stage === 'setup' && r.intsEscalationLevel > 0).length;
  const tiles: Array<{ label: string; value: number; color?: string }> = [
    { label: 'In progress', value: inProgress.length },
    { label: 'Awaiting setup', value: applications.length },
    { label: 'Over 30 days', value: overSla, color: overSla > 0 ? '#dc2626' : undefined },
    { label: 'INTS escalating', value: escalating, color: escalating > 0 ? '#d97706' : undefined },
    { label: 'Completed', value: completed.length, color: completed.length > 0 ? '#16a34a' : undefined },
  ];
  const group = (title: string, list: GuildOnboardingRow[]) => list.length > 0 && (
    <div>
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 mt-4">{title}</div>
      <div className="space-y-2">{list.map(r => <Row key={r.id} row={r} />)}</div>
    </div>
  );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Onboarding</h1>
        <p className="text-sm text-gray-600">Your set-ups and their progress. The 30-day target starts when the setup form is submitted.</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="text-2xl font-bold" style={{ color: t.color || '#0f172a' }}>{t.value}</div>
            <div className="text-xs text-gray-500 mt-1">{t.label}</div>
          </div>
        ))}
      </div>
      {group('In progress', inProgress)}
      {group('Awaiting setup form', applications)}
      {group('Completed', completed)}
    </div>
  );
}
