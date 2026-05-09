import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import type { PortalAuthPayload } from '../shared/portal-types.js';
import PortalLayout from './components/portal/PortalLayout.js';
import PortalLogin from './components/portal/PortalLogin.js';

const PortalHome = lazy(() => import('./components/portal/PortalHome.js'));
const PortalTicketList = lazy(() => import('./components/portal/PortalTicketList.js'));
const PortalTicketDetail = lazy(() => import('./components/portal/PortalTicketDetail.js'));
const PortalNewRequest = lazy(() => import('./components/portal/PortalNewRequest.js'));
const PortalKnowledgeBase = lazy(() => import('./components/portal/PortalKnowledgeBase.js'));
const PortalChat = lazy(() => import('./components/portal/PortalChat.js'));

type PortalView = 'home' | 'tickets' | 'ticket-detail' | 'new-request' | 'kb' | 'chat';

const PORTAL_TOKEN_KEY = 'portal_token';

function portalFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem(PORTAL_TOKEN_KEY);
  return fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
}

// Export for use in portal components
(window as any).__portalFetch = portalFetch;

function parseJwt(token: string): PortalAuthPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

function PortalApp() {
  const [user, setUser] = useState<PortalAuthPayload | null>(null);
  const [view, setView] = useState<PortalView>('home');
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(null);

  useEffect(() => {
    // Check for token in hash (from OIDC callback)
    const hash = window.location.hash;
    if (hash.startsWith('#token=')) {
      const token = hash.slice(7);
      localStorage.setItem(PORTAL_TOKEN_KEY, token);
      window.location.hash = '';
      const payload = parseJwt(token);
      if (payload) setUser(payload);
      return;
    }

    // Check stored token
    const stored = localStorage.getItem(PORTAL_TOKEN_KEY);
    if (stored) {
      const payload = parseJwt(stored);
      if (payload) {
        setUser(payload);
      } else {
        localStorage.removeItem(PORTAL_TOKEN_KEY);
      }
    }
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    setUser(null);
    setView('home');
  }, []);

  const handleViewTicket = useCallback((key: string) => {
    setSelectedTicketKey(key);
    setView('ticket-detail');
  }, []);

  if (!user) {
    return <PortalLogin />;
  }

  const fallback = (
    <div className="flex items-center justify-center h-64">
      <div className="animate-pulse flex flex-col items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-gray-200" />
        <div className="h-4 w-32 bg-gray-200 rounded" />
      </div>
    </div>
  );

  return (
    <PortalLayout user={user} currentView={view} onNavigate={setView} onLogout={handleLogout}>
      <Suspense fallback={fallback}>
        {view === 'home' && <PortalHome onNavigate={setView} onViewTicket={handleViewTicket} />}
        {view === 'tickets' && <PortalTicketList onViewTicket={handleViewTicket} />}
        {view === 'ticket-detail' && selectedTicketKey && (
          <PortalTicketDetail ticketKey={selectedTicketKey} onBack={() => setView('tickets')} />
        )}
        {view === 'new-request' && <PortalNewRequest onCreated={(key) => { handleViewTicket(key); }} />}
        {view === 'kb' && <PortalKnowledgeBase />}
        {view === 'chat' && <PortalChat />}
      </Suspense>
    </PortalLayout>
  );
}

const root = document.getElementById('portal-root');
if (root) {
  createRoot(root).render(<PortalApp />);
}
