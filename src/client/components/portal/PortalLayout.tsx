import React from 'react';
import type { PortalAuthPayload } from '../../../shared/portal-types.js';

type PortalView = 'home' | 'tickets' | 'ticket-detail' | 'new-request' | 'kb' | 'chat';

interface Props {
  user: PortalAuthPayload;
  currentView: PortalView;
  onNavigate: (view: PortalView) => void;
  onLogout: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ view: PortalView; label: string; icon: string }> = [
  { view: 'home', label: 'Home', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { view: 'tickets', label: 'My Tickets', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { view: 'kb', label: 'Knowledge Base', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { view: 'new-request', label: 'New Request', icon: 'M12 4v16m8-8H4' },
  { view: 'chat', label: 'Chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
];

export default function PortalLayout({ user, currentView, onNavigate, onLogout, children }: Props) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <span className="text-xl font-heading font-extrabold tracking-tight text-brand">nurtur</span>
              <span className="text-sm font-medium text-gray-400">|</span>
              <span className="text-sm font-medium text-gray-500">Support Portal</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium text-gray-900">{user.email}</div>
                <div className="text-xs text-gray-500">{user.orgName}</div>
              </div>
              <button
                onClick={onLogout}
                className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md hover:bg-gray-100 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {NAV_ITEMS.map(item => (
              <button
                key={item.view}
                onClick={() => onNavigate(item.view)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  currentView === item.view || (item.view === 'tickets' && currentView === 'ticket-detail')
                    ? 'border-brand text-brand'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between text-xs text-gray-400">
          <span>Powered by Nurtur</span>
          <a href="mailto:support@nurtur.tech" className="hover:text-gray-600">Need help? Contact us</a>
        </div>
      </footer>
    </div>
  );
}
