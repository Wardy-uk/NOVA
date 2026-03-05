declare const __APP_VERSION__: string;

interface ReleaseEntry {
  version: string;
  date: string;
  items: string[];
}

const RELEASE_NOTES: ReleaseEntry[] = [
  {
    version: '1.1.16',
    date: '5 Mar 2026',
    items: [
      'Push to Git — push template files to Azure DevOps with PR creation',
      'Design role with AzDO push permissions',
      'Pin as Homepage — set any page as your default landing page',
      'Welcome Pack — save read-only snapshot of customer setup data',
      'SharePoint sync diagnostic logging with collapsible UI log viewer',
      'Fix: logo thumbnails, SP sync header import, portal branch button',
    ],
  },
  {
    version: '1.1.15',
    date: '4 Mar 2026',
    items: [
      'Customer Setup Portal with magic link access for external customers',
      'BYM API integration — direct API setup replacing Onboarding.Tool',
      'Setup execution engine with dry-run validation',
      'Brand settings, branches, logos, and Build tab (portal accounts + districts)',
    ],
  },
  {
    version: '1.1.12',
    date: '3 Mar 2026',
    items: [
      'Rules-based AI Insights + Briefings (no more OpenAI dependency)',
      'Milestone task assignment to specific users',
      'Traffic light indicators on delivery cards',
      'Development tier exclusion from global ticket views',
      'Security hardening — redacted settings, admin-only endpoints',
      'Toast notifications for SLA breach, milestone overdue, feedback reply',
      'No Next Reply + Missed Commitment detection rules',
    ],
  },
  {
    version: '1.1.10',
    date: '3 Mar 2026',
    items: [
      'Per-user Jira REST API — removed MCP dependency entirely',
      'Multi-role support with checkbox assignment',
      'Inline-editable user display names and emails',
      'Jira search pagination (all results beyond 100-item cap)',
      'SSO base URL auto-detection from host header',
    ],
  },
  {
    version: '1.1.7',
    date: '2 Mar 2026',
    items: [
      'Problem ticket scan runs in background (non-blocking UI)',
      'SD Kanban full-width layout — no more horizontal scrollbar',
      'New AI rule: Missed Update Commitment detection',
      'Problem tickets: reason count filter chips',
      'Problem tickets: Open in Jira links on issue keys',
      'Release notes popup on new deployments',
    ],
  },
  {
    version: '1.1.6',
    date: '1 Mar 2026',
    items: [
      'Self-service password reset via branded email',
      'Branded HTML invite emails matching N.O.V.A dark theme',
      'Bulk user import with optional invite sending',
      'Direct MX email delivery — no external SMTP provider needed',
    ],
  },
  {
    version: '1.1.5',
    date: '1 Mar 2026',
    items: [
      'AI Problem Ticket Detection — 9-rule engine + LLM sentiment analysis',
      'Problem ticket alerts with severity P1/P2/P3, ignore/lift workflow',
      'Notification mark-all-read persistence fix (24h dedup)',
      'Jira REST client migrated to /search/jql (Atlassian deprecation)',
      'SD "All Tickets Kanban" view with drag-and-drop transitions',
      'Light mode badge theming — WCAG AA contrast across all views',
    ],
  },
  {
    version: '1.1.0',
    date: '28 Feb 2026',
    items: [
      'Chat to NOVA — conversational AI assistant',
      'Service Desk Dashboard with SLA KPI cards',
      'Notifications bell with overdue/SLA alerts',
      'Team workload view with colour-coded load table',
      'Activity audit log across all entities',
      'Jira OAuth 3LO — connect personal Jira accounts',
      'Jira SLA prioritisation with weighted urgency scoring',
      'Kanban drag-and-drop transitions to Jira',
    ],
  },
  {
    version: '1.0.9',
    date: '28 Feb 2026',
    items: [
      'Delivery UX improvements — date range filter, milestone-gated tickets',
      'Onboarding Calendar with monthly milestone grid',
      'Entra ID SSO integration',
      'Configurable role permissions per area',
      'SharePoint sync for delivery spreadsheet',
    ],
  },
];

interface Props {
  onClose: () => void;
}

export function ReleaseNotesModal({ onClose }: Props) {
  const handleClose = () => {
    localStorage.setItem('nova_release_notes_seen', __APP_VERSION__);
    onClose();
  };

  const current = RELEASE_NOTES[0];
  const older = RELEASE_NOTES.slice(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="bg-[#2f353d] border border-[#3a424d] rounded-lg w-full max-w-lg mx-4 shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3a424d]">
          <h3 className="text-sm font-semibold text-neutral-100">
            What's New in v{current?.version ?? __APP_VERSION__}
          </h3>
          <button onClick={handleClose} className="text-neutral-500 hover:text-neutral-300 text-sm">{'\u2715'}</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto max-h-[70vh] space-y-5">
          {/* Current release */}
          {current && (
            <div>
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-2">
                {current.date}
              </div>
              <ul className="space-y-1.5">
                {current.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs text-neutral-200">
                    <span className="text-[#5ec1ca] mt-0.5 flex-shrink-0">{'\u2022'}</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Older releases */}
          {older.length > 0 && (
            <div className="border-t border-[#3a424d] pt-4">
              <div className="text-[10px] text-neutral-600 uppercase tracking-wider mb-3">Previous Releases</div>
              <div className="space-y-4">
                {older.map((release) => (
                  <div key={release.version}>
                    <div className="text-[11px] text-neutral-400 font-medium mb-1">
                      v{release.version} — {release.date}
                    </div>
                    <ul className="space-y-0.5">
                      {release.items.map((item, i) => (
                        <li key={i} className="flex gap-2 text-[11px] text-neutral-500">
                          <span className="mt-0.5 flex-shrink-0">{'\u2022'}</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#3a424d] flex justify-end">
          <button
            onClick={handleClose}
            className="px-5 py-2 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
