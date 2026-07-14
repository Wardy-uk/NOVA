import React from 'react';
import type { PortalAuthPayload, PortalOrgFeatures, PortalOrgMembershipSummary } from '../../../shared/portal-types.js';

type PortalView = 'home' | 'tickets' | 'ticket-detail' | 'new-request' | 'raise-ticket' | 'kb' | 'chat' | 'onboarding-dashboard' | 'support-dashboard';

interface Props {
  user: PortalAuthPayload;
  currentView: PortalView;
  onNavigate: (view: PortalView) => void;
  onLogout: () => void;
  children: React.ReactNode;
  features?: PortalOrgFeatures;
  logoUrl?: string | null;
  orgs?: PortalOrgMembershipSummary[];
  activeOrgId?: number | null;
  onSwitchOrg?: (orgId: number) => void;
}

// Nav items gated by a per-org feature flag carry a `feature` key.
const NAV_ITEMS: Array<{ view: PortalView; label: string; icon: string; feature?: keyof PortalOrgFeatures }> = [
  { view: 'home', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { view: 'tickets', label: 'My Tickets', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { view: 'raise-ticket', label: 'Raise a Ticket', icon: 'M12 4v16m8-8H4', feature: 'raiseTicket' },
  { view: 'support-dashboard', label: 'Support', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', feature: 'support' },
  { view: 'onboarding-dashboard', label: 'Onboarding', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', feature: 'onboarding' },
  { view: 'kb', label: 'Knowledge Base', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', feature: 'kb' },
];

export default function PortalLayout({ user, currentView, onNavigate, onLogout, children, features, logoUrl, orgs, activeOrgId, onSwitchOrg }: Props) {
  const navItems = NAV_ITEMS.filter(item => !item.feature || !features || features[item.feature]);

  // Only show the switcher when there is somewhere to switch to.
  const canSwitch = !!onSwitchOrg && !!orgs && orgs.length > 1;
  const active = orgs?.find(o => o.orgId === activeOrgId) ?? null;
  const viewingReadOnly = active?.canWrite === false;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header role="banner" className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              {logoUrl
                ? <img src={logoUrl} alt={user.orgName || 'Logo'} className="h-8 max-w-[160px] object-contain" />
                : <span className="text-xl font-heading font-extrabold tracking-tight text-brand">nurtur</span>}
              <span className="text-sm font-medium text-gray-600" aria-hidden="true">|</span>
              <span className="text-sm font-medium text-gray-600">Support Portal</span>
            </div>

            <div className="flex items-center gap-4">
              {canSwitch && (
                <label className="flex items-center gap-2">
                  <span className="sr-only">Organisation</span>
                  <select
                    value={activeOrgId ?? ''}
                    onChange={e => onSwitchOrg!(Number(e.target.value))}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-900 max-w-[220px] focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
                  >
                    {orgs!.map(o => (
                      <option key={o.orgId} value={o.orgId}>
                        {o.orgName}{o.kind === 'view-as' ? ' (view only)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium text-gray-900">{user.email}</div>
                <div className="text-xs text-gray-600">{user.orgName}</div>
              </div>
              <button
                onClick={onLogout}
                aria-label="Sign out"
                className="text-sm text-gray-600 hover:text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        {viewingReadOnly && (
          <div role="status" className="bg-amber-50 border-t border-amber-200">
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2 text-sm text-amber-900">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span>
                Viewing <strong>{active?.orgName}</strong> as they see it. Read-only — switch back to your own organisation to make changes.
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <nav role="navigation" aria-label="Main navigation" className="flex gap-1 -mb-px overflow-x-auto">
            {navItems.map(item => {
              const isActive = currentView === item.view || (item.view === 'tickets' && currentView === 'ticket-detail');
              return (
                <button
                  key={item.view}
                  onClick={() => onNavigate(item.view)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none ${
                    isActive
                      ? 'border-brand text-brand'
                      : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main role="main" className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer role="contentinfo" className="bg-white border-t border-gray-200 py-4">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-gray-600">
          <span>Powered by Nurtur</span>
          <a href="mailto:support@nurtur.tech" className="hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 outline-none rounded">Need help? Contact us</a>
        </div>
      </footer>
    </div>
  );
}
