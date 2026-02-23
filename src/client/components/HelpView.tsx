import { useState } from 'react';

interface Section {
  title: string;
  content: string[];
}

const SECTIONS: Section[] = [
  {
    title: 'Getting Started',
    content: [
      'N.O.V.A (Nurtur Operational Virtual Assistant) is a personal productivity dashboard that aggregates your tasks, calendar, email, and delivery tracking into one place.',
      'On first launch, create an admin account. After logging in, head to Settings to connect your integrations (Jira, Microsoft 365, Monday.com).',
      'Once connected, N.O.V.A will automatically sync tasks from all your sources on a configurable interval. Your Command Centre dashboard will populate with KPIs and the morning standup will trigger automatically on your first visit each day.',
    ],
  },
  {
    title: 'Command Centre',
    content: [
      'Your home dashboard showing at-a-glance KPIs: total tasks, overdue count, due today/this week, completion rate, and average task age.',
      'Ask N.O.V.A — type a question or request and the AI assistant will analyse your tasks and provide suggestions. You can select which sources to include.',
      'The morning standup triggers automatically on your first visit each day. It analyses your tasks and prepares a prioritised briefing.',
      'Quick links let you jump to My Focus, Tasks, or Standup directly from the dashboard.',
    ],
  },
  {
    title: 'My Focus',
    content: [
      'A dedicated view for tasks you\'ve marked as "focused" — your personal workstream for the day.',
      'Focus a task by clicking the Focus button on any task card (in Tasks, Standup, or Command Centre). Unfocus to remove it.',
      'Focused tasks appear in a priority list. Use this to build a short, actionable queue rather than wading through all your tasks.',
    ],
  },
  {
    title: 'Tasks',
    content: [
      'The full task list aggregated from all connected sources: Jira, Microsoft Planner, To-Do, Calendar, Email, and Monday.com.',
      'Filter by source using the chips at the top. Toggle "Overdue only" to narrow down. Sort by due date, priority, or age.',
      'Click Edit on any task to open the Task Drawer — a side panel with full details. For Planner and To-Do tasks, you can edit the title, status, and due date directly.',
      'Jira tasks show transitions (e.g. In Progress → Done) with optional comments, plus assignee reassignment.',
      'Task badges show source, status, priority, age, and due date. Overdue tasks are highlighted in red.',
    ],
  },
  {
    title: 'Standup',
    content: [
      'Three ritual modes for structured daily workflow:',
      'Morning Standup — N.O.V.A analyses all your tasks and produces a prioritised briefing with key actions, blockers, and recommendations. Auto-triggers on first visit each day.',
      'Replan — Mid-day re-assessment. N.O.V.A reviews what\'s changed since the morning and suggests priority adjustments.',
      'End of Day — Review what you accomplished and what\'s rolling over to tomorrow.',
      'Each standup result is saved and persists until midnight. Use the Re-run button to regenerate if your situation has changed.',
    ],
  },
  {
    title: 'KPIs',
    content: [
      'Detailed analytics and metrics across all your task sources.',
      'Key metrics: completion rate, tasks by status, overdue breakdown, average age, SLA tracking, and source distribution.',
      'Use this page to identify bottlenecks — which sources have the most overdue tasks, which are aging, and where your focus should be.',
    ],
  },
  {
    title: 'Delivery',
    content: [
      'Customer delivery tracking, combining data from the master Excel spreadsheet with local database entries.',
      'Brand Filter — switch between product tabs (BYM, KYM, Yomdel, etc.) to see accounts for each brand.',
      'Status Filter — toggle statuses on/off. By default, "complete" entries are hidden. Click a status chip to show/hide it.',
      'Starring — star important accounts for quick access. Stars appear in the panel at the top. Toggle between "My Stars" and "Team Stars" to see personal vs shared starred items.',
      'Click any row to open the Delivery Drawer for editing. Spreadsheet rows will pre-fill the form when creating a new database entry.',
      'SharePoint Sync — pull the latest delivery sheet from SharePoint (requires Microsoft 365 connection with admin approval). The Sync from SharePoint button is in the delivery header.',
    ],
  },
  {
    title: 'CRM',
    content: [
      'Customer Relationship Management page for tracking customer health and business reviews.',
      'Customer health uses a RAG (Red/Amber/Green) system. Set health status, add notes, and track review dates.',
      'Business reviews can be scheduled and tracked with outcomes and follow-up actions.',
      'All CRM data is stored locally in the database — no external CRM integration required (Dynamics 365 integration is on the roadmap).',
    ],
  },
  {
    title: 'Settings',
    content: [
      'Manage your integrations, sync frequency, and AI configuration.',
      'Integration Cards — each source (Jira, Microsoft 365, Monday.com) has its own card. Enter credentials, toggle enabled/disabled, and configure source-specific options.',
      'Microsoft 365 — per-source toggles for Planner, To-Do, Calendar, and Email. Configure email filters (flagged/unread/all) and days to pull.',
      'Sync Frequency — set a per-integration sync interval (1, 2, 5, 10, 15, or 30 minutes) or use the global default. Each integration also has a "Sync Now" button for immediate refresh.',
      'AI Settings — configure your OpenAI API key for N.O.V.A\'s AI features (standup analysis, Ask N.O.V.A).',
      'Power Automate Bridge — optional integration for PA-based data flows (can be toggled on/off per source).',
    ],
  },
  {
    title: 'Tips & Shortcuts',
    content: [
      'Focus workflow — star the 3-5 most important tasks each morning using Focus buttons. Use the My Focus page as your daily driver instead of the full Tasks list.',
      'Star scoping — when starring delivery entries, "Team Stars" are visible to all users while "My Stars" are personal. Use team stars for shared priorities.',
      'Email filters — in Settings, set email to "flagged only" to reduce noise. Flagged emails sync as tasks so you can track them alongside everything else.',
      'Standup persistence — standup results save automatically and persist until midnight. No need to re-run unless your priorities change.',
      'Sync frequency — for fast-moving sources like Jira, set a lower sync interval (1-2 min). For slower sources like Monday, 10-15 min is fine.',
      'Task editing — Planner and To-Do tasks can be edited directly in N.O.V.A. Changes sync back to the source automatically.',
    ],
  },
];

function CollapsibleSection({ section, defaultOpen }: { section: Section; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#363d47] transition-colors"
      >
        <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
          {section.title}
        </h3>
        <span className="text-neutral-500 text-sm font-mono">{open ? '\u2212' : '+'}</span>
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-2.5">
          {section.content.map((paragraph, i) => (
            <p key={i} className="text-sm text-neutral-300 leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function HelpView() {
  const [allOpen, setAllOpen] = useState(false);
  const [key, setKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
            Help & User Guide
          </h2>
          <p className="text-xs text-neutral-500 mt-1">
            Everything you need to know about N.O.V.A
          </p>
        </div>
        <button
          onClick={() => {
            setAllOpen(!allOpen);
            setKey((k) => k + 1);
          }}
          className="px-3 py-1.5 text-xs rounded transition-colors bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200 border border-[#3a424d]"
        >
          {allOpen ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      <div key={key} className="space-y-3">
        {SECTIONS.map((section) => (
          <CollapsibleSection
            key={section.title}
            section={section}
            defaultOpen={allOpen}
          />
        ))}
      </div>

      <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d] mt-6">
        <p className="text-xs text-neutral-500 text-center">
          N.O.V.A — Nurtur Operational Virtual Assistant
        </p>
      </div>
    </div>
  );
}
