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
      'On first launch, create an admin account. After logging in, head to Settings to connect your integrations (Jira, Microsoft 365, Monday.com, Dynamics 365).',
      'Once connected, N.O.V.A will automatically sync tasks from all your sources on a configurable interval. Your Command Centre dashboard will populate with KPIs and the morning standup will trigger automatically on your first visit each day.',
      'N.O.V.A uses role-based access: Admins can manage users, teams, and system settings. Editors can modify settings and data. Viewers have read-only access across the app.',
    ],
  },
  {
    title: 'Command Centre',
    content: [
      'Your home dashboard showing at-a-glance KPIs: total tasks, overdue count, due today/this week, completion rate, and average task age. Breakdowns by source, status, and category are also shown.',
      'Ask N.O.V.A — type a question or request and the AI assistant will analyse your tasks and provide suggestions. Use the source selector to choose which integrations to include in the analysis.',
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
      'The full task list aggregated from all connected sources: Jira, Microsoft Planner, To-Do, Calendar, Email, and Monday.com. Tasks are grouped by source with collapsible sections.',
      'Filter by source using the chips at the top. Toggle "Overdue only" to narrow down. Sort by due date, priority, or recently updated.',
      'Click Edit on any task to open the Task Drawer — a side panel with full details. For Planner and To-Do tasks, you can edit the title, status, and due date directly.',
      'Jira tasks show transitions (e.g. In Progress \u2192 Done) with optional comments, plus assignee reassignment via the user search picker.',
      'Email tasks — click Reply or Forward in the Task Drawer to compose a response. Replies go to the original sender; forwards prompt for a recipient.',
      'Calendar tasks — click Edit in the Task Drawer to modify the event subject, start/end time, and location. You can also create new calendar events and delete existing ones. Changes sync back to Outlook.',
      'Task badges show source, status, priority, age, and due date. Overdue tasks are highlighted in red.',
      'Create Task — use the Create Task form to add new Planner or To-Do tasks. Toggle batch mode to create multiple To-Do tasks at once by entering one title per line.',
    ],
  },
  {
    title: 'Standup',
    content: [
      'Three ritual modes accessed via tabs for structured daily workflow:',
      'Morning Standup — N.O.V.A analyses all your tasks and produces a prioritised briefing with key actions, blockers, and recommendations. Auto-triggers on first visit each day.',
      'Replan — Mid-day re-assessment. N.O.V.A reviews what\'s changed since the morning and suggests priority adjustments.',
      'End of Day — Review what you accomplished and what\'s rolling over to tomorrow.',
      'Each standup result is saved and persists until midnight. Use the Re-run button to regenerate if your situation has changed. Past results remain accessible in the standup history.',
    ],
  },
  {
    title: 'KPIs',
    content: [
      'Detailed analytics and metrics across all your task sources.',
      'Key metrics: completion rate, tasks by status, overdue breakdown, average age, SLA tracking, source distribution, and high-priority open count.',
      'Use this page to identify bottlenecks — which sources have the most overdue tasks, which are aging, and where your focus should be.',
    ],
  },
  {
    title: 'Delivery',
    content: [
      'Customer delivery tracking, combining data from the master Excel spreadsheet with local database entries.',
      'Brand Filter — switch between product tabs (BYM, KYM, Yomdel, etc.) to see accounts for each brand.',
      'Status Filter — multi-select status chips to show or hide entries. By default, "complete" entries are hidden. Available statuses: Not Started, WIP, In Progress, On Hold, Complete, Dead, Back to Sales.',
      'Starring — star important accounts for quick access. Stars appear in the panel at the top. Toggle between "My Stars" (personal) and "Team Stars" (shared with all users).',
      'Onboarding IDs — each delivery entry is auto-assigned a unique ID (e.g. BYM0001) based on the product brand prefix. IDs are visible in the table and drawer.',
      'Click any row to open the Delivery Drawer for editing. Spreadsheet rows will pre-fill the form fields (account, status, dates, MRR, notes, etc.) when creating a new database entry.',
      'SharePoint Sync — "Pull from SP" downloads the latest delivery sheet from SharePoint. "Push to SP" uploads local DB entries back to SharePoint as an xlsx file.',
      'Import xlsx to DB — the amber "Import xlsx to DB" button converts all rows from the local xlsx file into database entries with auto-assigned onboarding IDs. Existing entries are skipped (matched by product and account name).',
      'Column Sorting — click any column header to sort the table ascending or descending. Works across both database entries and spreadsheet rows. Click again to reverse the sort order.',
      'Inline Editing — click any cell on a database entry row to edit it in place. Status fields show a dropdown, date fields show a date picker, and number fields show a number input. Changes are saved automatically when you click away or press Enter.',
    ],
  },
  {
    title: 'CRM',
    content: [
      'Customer Relationship Management page for tracking customer health and business reviews.',
      'Customer health uses a RAG (Red/Amber/Green) system. Set health status, add notes, and track review dates.',
      'Business reviews can be scheduled and tracked with outcomes and follow-up actions.',
      'Dynamics 365 Integration — click "Sync from D365" to pull accounts from Dynamics 365 CRM into NOVA. Synced customers show a blue "D365" badge. The sync summary shows how many accounts were created, updated, and total synced.',
      'All CRM data is stored locally in the database. D365 sync is optional and uses the Dataverse Web API with MSAL authentication. Configure D365 credentials (URL, Client ID, Client Secret, Tenant ID) in Settings.',
    ],
  },
  {
    title: 'Onboarding',
    content: [
      'The Onboarding page (admin/editor only) manages the onboarding matrix and Jira ticket automation for new customer onboardings.',
      'Matrix Grid tab — a visual grid of sale types (rows) vs capabilities (columns). Click a cell to toggle whether a capability applies to a sale type. Amber cells have notes.',
      'Sale Types tab — manage product/sale types (e.g. BYM, Guild Enhanced, Ewemove). Add, edit, reorder, or deactivate sale types.',
      'Capabilities tab — manage delivery capabilities (e.g. Data Warehouse, Build, Leadpro). Each capability can have a short code and items associated with it.',
      'Items tab — select a capability from the dropdown, then manage the deliverable items for it. Items can be standard or bolt-on (optional add-ons). These items appear as checklists in the Jira ticket descriptions.',
      'Import from xlsx — the "Import from xlsx" button re-imports the entire onboarding matrix from OnboardingMatix.xlsx. This replaces all existing config data. Use this for initial setup or full resets.',
      'Ticket Creation — when ready to onboard a customer, the system creates Jira tickets in project NT: one parent "Quality Assurance" ticket and N child "Support Onboarding" tickets (one per capability). Each child ticket blocks the parent. The system is idempotent — retrying with the same onboarding reference will not create duplicates.',
      'Dry Run — test ticket creation without actually creating Jira tickets. The dry-run preview shows exactly what would be created.',
    ],
  },
  {
    title: 'Admin',
    content: [
      'The Admin page is accessible to admin users only (Admin button in the navigation bar).',
      'Users tab — view all registered users, change roles (admin/editor/viewer), assign users to teams, reset passwords, and delete accounts.',
      'Teams tab — create and manage teams. Assign users to teams for future team-scoped features.',
      'AI Keys tab — manage the global OpenAI API key used by all users. Individual users can also have a personal API key override, which takes priority over the global key when set.',
      'Feedback tab — view all feedback submitted by users (bugs, questions, feature requests). Update the status of each item or delete resolved entries.',
    ],
  },
  {
    title: 'Feedback',
    content: [
      'Use the envelope icon in the header bar to send feedback at any time.',
      'Choose a type: Report a Bug, Ask a Question, or Suggest a Feature. Add a title and optional description, then submit.',
      'Feedback is stored in the database and visible to admins in the Admin page. Use this to report issues or request new features without leaving the app.',
    ],
  },
  {
    title: 'Settings',
    content: [
      'Manage your integrations, sync frequency, and AI configuration.',
      'Integration Cards — each source (Jira, Microsoft 365, Monday.com, Dynamics 365) has its own card. Enter credentials, toggle enabled/disabled, and configure source-specific options.',
      'Microsoft 365 — per-source toggles for Planner, To-Do, Calendar, and Email. Each source can have its own sync interval. Configure email filters (flagged/unread/all) and days to pull (1\u201330 days).',
      'Sync Frequency — set a per-integration sync interval (1, 2, 5, 10, 15, or 30 minutes) or use the global default. O365 sources (Planner, To-Do, Calendar, Email) each have independent intervals. Every integration also has a "Sync Now" button for immediate refresh.',
      'Dynamics 365 — enter your Dataverse URL, Client ID, Client Secret, and Tenant ID. Use the connection test to verify before syncing.',
      'AI Settings — configure your OpenAI API key for N.O.V.A\'s AI features (standup analysis, Ask N.O.V.A). Per-user overrides can be set in Admin > AI Keys.',
      'Power Automate Bridge — optional integration for PA-based data flows. Has a global on/off toggle and per-source toggles (Planner, To-Do, Calendar, Email).',
      'Remember Me — when unchecked on the login page, your session is stored in sessionStorage (cleared when the browser closes). When checked, it uses localStorage for persistent sessions.',
    ],
  },
  {
    title: 'Roles & Permissions',
    content: [
      'N.O.V.A uses three roles to control access across the application:',
      'Admin — full access to all features. Can manage users, teams, and AI API keys via the Admin page. Can modify all settings and integrations.',
      'Editor — can modify settings, edit delivery entries, manage CRM data, and use all task features. Cannot access the Admin page.',
      'Viewer — read-only access. Can view tasks, dashboards, deliveries, and CRM data but cannot modify settings or edit entries.',
      'Per-user data — each user has their own focused tasks and standup history. Focusing a task only affects your view, not other users. Standups are generated per-user so each team member gets their own morning briefing.',
    ],
  },
  {
    title: 'Tips & Shortcuts',
    content: [
      'Focus workflow — mark the 3\u20135 most important tasks each morning using Focus buttons. Use the My Focus page as your daily driver instead of the full Tasks list.',
      'Star scoping — when starring delivery entries, "Team Stars" are visible to all users while "My Stars" are personal. Use team stars for shared priorities.',
      'Batch task creation — when creating To-Do tasks, toggle batch mode to enter multiple task titles (one per line) and create them all at once.',
      'Email filters — in Settings, set email to "flagged only" to reduce noise. Flagged emails sync as tasks so you can track them alongside everything else.',
      'Standup persistence — standup results save automatically and persist until midnight. No need to re-run unless your priorities change.',
      'Sync frequency — for fast-moving sources like Jira, set a lower sync interval (1\u20132 min). For slower sources like Monday, 10\u201315 min is fine. O365 sources can each have their own interval.',
      'Task editing — Planner, To-Do, and Calendar tasks can be edited directly in N.O.V.A. Email tasks support reply and forward. Changes sync back to the source automatically.',
      'Inline editing — for quick changes to delivery entries, click directly on a cell value in the table instead of opening the full drawer. Press Escape to cancel an edit.',
      'Import workflow — for new deployments, pull the delivery sheet from SharePoint first, then use "Import xlsx to DB" to bulk-create database entries with auto-assigned onboarding IDs.',
      'MCP auto-reconnect — if a connection to Jira, Monday.com, or Microsoft 365 drops unexpectedly, N.O.V.A will automatically reconnect on the next operation.',
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
