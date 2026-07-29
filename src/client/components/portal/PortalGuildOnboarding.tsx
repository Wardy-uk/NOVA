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

function Row({ row }: { row: GuildOnboardingRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
        <span className="text-gray-400 text-xs">{open ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{office(row)}</div>
          <div className="text-[11px] text-gray-500">Submitted {row.submissionDate.slice(0, 10)}{row.invoiceCommencementDate ? ` · invoice starts ${row.invoiceCommencementDate}` : ''}</div>
        </div>
        {row.intsEscalationLevel > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">Integration — day {row.intsEscalationLevel}</span>
        )}
        <span className="text-[11px] px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: RAG_COLOR[row.slaRag] }}>
          {row.slaRag === 'met' ? 'Complete' : row.slaBreached ? 'Over 30 days' : `${row.slaDaysRemaining} days left`}
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-100">
          <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Progress</div>
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

  const open = rows.filter(r => r.slaRag !== 'met');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Onboarding</h1>
        <p className="text-sm text-gray-600">Your set-ups and their progress. Each has a 30-day target from submission.</p>
      </div>
      <div className="space-y-2">
        {open.map(r => <Row key={r.id} row={r} />)}
      </div>
      {rows.some(r => r.slaRag === 'met') && (
        <div>
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2 mt-4">Completed</div>
          <div className="space-y-2">{rows.filter(r => r.slaRag === 'met').map(r => <Row key={r.id} row={r} />)}</div>
        </div>
      )}
    </div>
  );
}
