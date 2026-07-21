import React from 'react';
import type { PortalAuthPayload } from '../../../shared/portal-types.js';

interface Props {
  user: PortalAuthPayload;
  multiOrg?: boolean;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-2">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="text-sm text-gray-600 space-y-2 leading-relaxed">{children}</div>
    </div>
  );
}

const ROLES: Array<{ name: string; can: string }> = [
  { name: 'Requester', can: 'Raise requests and track the ones they’ve submitted.' },
  { name: 'Leader', can: 'As Requester, plus see every request across the whole organisation — not just their own.' },
  { name: 'Manager', can: 'As Leader, plus escalate a request when it needs more urgent attention.' },
  { name: 'Organisation Admin', can: 'A senior contact for the organisation, with full visibility of its requests.' },
];

export default function PortalAbout({ user, multiOrg }: Props) {
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">About this portal</h1>
        <p className="text-sm text-gray-600">A quick guide to what you can do here and how it works.</p>
      </div>

      <Card title="What the portal is for">
        <p>
          This is your support portal with the Nurtur team. From here you can raise new requests, track their progress,
          search the knowledge base for answers, and — depending on what’s enabled for your organisation — see live
          dashboards of your support and onboarding work.
        </p>
        <p>Everything you see is scoped to your organisation, so you only ever see your own account’s information.</p>
      </Card>

      <Card title="Your organisation">
        <p>
          You’re signed in under <strong>{user.orgName}</strong>. Your requests, tickets and dashboards all belong to this
          organisation.
        </p>
        {multiOrg && (
          <p>
            Because you have access to more than one organisation, you’ll see an <strong>organisation switcher</strong> in
            the top bar. Switching changes everything on screen to that organisation. Some may be <em>view-only</em> — you
            can look but not make changes until you switch back to your own.
          </p>
        )}
      </Card>

      <Card title="Roles &amp; what they can do">
        <p>Access builds up by role — each one can do everything the one above it can, and a bit more:</p>
        <ul className="space-y-1">
          {ROLES.map(r => (
            <li key={r.name} className="flex gap-2">
              <span className="shrink-0 font-medium text-brand min-w-[150px]">{r.name}</span>
              <span>{r.can}</span>
            </li>
          ))}
        </ul>
        <p className="text-gray-500 text-xs">
          Need someone’s access changed? Contact the Nurtur team and we’ll sort it.
        </p>
      </Card>

      <Card title="What’s on each tab">
        <ul className="space-y-1.5">
          <li><strong>Home</strong> — your starting point, with any announcements and a snapshot of open requests.</li>
          <li><strong>My Tickets</strong> — every request you (or your organisation) can see, with its live status and history.</li>
          <li><strong>Raise a Ticket</strong> — submit a new request (see below). Only shown if enabled for your organisation.</li>
          <li><strong>Support</strong> / <strong>Onboarding</strong> — live dashboards of your support and onboarding tickets, where enabled.</li>
          <li><strong>Knowledge Base</strong> — searchable help articles; often the fastest way to an answer.</li>
          <li><strong>Users</strong> — <em>(Organisation Admins)</em> manage your organisation's portal users and their roles. Tick <strong>Include in setup</strong> to auto-add head-office contacts whenever a new office is set up.</li>
          <li><strong>Escalations</strong> — <em>(Organisation Admins)</em> set the schedule for onboarding progress updates and escalations for your organisation.</li>
        </ul>
      </Card>

      <Card title="Raising a request">
        <p>When you raise a ticket you’ll pick what you need at the top of the form:</p>
        <ul className="space-y-1.5">
          <li><strong>Raise to Support</strong> — a standard support request; it goes into the Nurtur support queue.</li>
          <li><strong>Triaged for Development</strong> — something that needs the development team.</li>
          <li>
            <strong>Onboarding Request</strong> — a full set-up form for a new office or agent. It captures everything the
            team needs to build the systems and lets you attach documents. Submitting it creates the setup work <em>and</em>
            a linked quality-assurance check automatically.
          </li>
        </ul>
        <p className="text-gray-500 text-xs">
          You’ll only see the options your organisation has been set up with — if just one applies, the form skips straight to it.
        </p>
      </Card>

      <Card title="Need a hand?">
        <p>
          If you can’t find what you need, use the knowledge base or email{' '}
          <a href="mailto:support@nurtur.tech" className="text-brand hover:underline">support@nurtur.tech</a> and we’ll help.
        </p>
      </Card>
    </div>
  );
}
