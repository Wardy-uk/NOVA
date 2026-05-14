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
const NOVA_TOKEN_KEY = 'token';

function getNovaToken(): string | null {
  return localStorage.getItem(NOVA_TOKEN_KEY);
}

function portalFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  // In internal mode, use NOVA JWT; in OIDC mode, use portal token
  const portalToken = localStorage.getItem(PORTAL_TOKEN_KEY);
  const novaToken = getNovaToken();
  const token = portalToken || novaToken;
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
  const [authMode, setAuthMode] = useState<'oidc' | 'internal' | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      // Fetch auth mode
      try {
        const modeRes = await fetch('/api/portal/auth/mode');
        const modeData = await modeRes.json();
        if (modeData.ok) setAuthMode(modeData.data.mode);
      } catch {
        setAuthMode('oidc');
      }

      // Check for OIDC token in hash (from OIDC callback)
      const hash = window.location.hash;
      if (hash.startsWith('#token=')) {
        const token = hash.slice(7);
        localStorage.setItem(PORTAL_TOKEN_KEY, token);
        window.location.hash = '';
        const payload = parseJwt(token);
        if (payload) { setUser(payload); setChecking(false); return; }
      }

      // Check stored portal token (OIDC mode)
      const stored = localStorage.getItem(PORTAL_TOKEN_KEY);
      if (stored) {
        const payload = parseJwt(stored);
        if (payload) { setUser(payload); setChecking(false); return; }
        localStorage.removeItem(PORTAL_TOKEN_KEY);
      }

      // Internal mode: try NOVA JWT — probe a portal endpoint to check access
      const novaToken = getNovaToken();
      if (novaToken) {
        try {
          const res = await fetch('/api/portal/kb/categories', {
            headers: { Authorization: `Bearer ${novaToken}` },
          });
          if (res.ok) {
            // NOVA JWT works for portal — extract user info from it
            const jwt = parseNovaJwt(novaToken);
            if (jwt) {
              setUser({
                userId: jwt.id,
                email: jwt.username + '@nurtur.tech',
                orgId: 0,
                orgName: 'Nurtur Limited',
                role: 'admin',
              });
              setChecking(false);
              return;
            }
          }
        } catch { /* fall through to login */ }
      }

      setChecking(false);
    })();
  }, []);

  const handleInternalAuth = useCallback(() => {
    const novaToken = getNovaToken();
    if (!novaToken) {
      // Redirect to NOVA login, then back to portal
      window.location.href = '/?redirect=/portal';
      return;
    }
    // Try using the NOVA token — reload to trigger the auth check
    window.location.reload();
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

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-cyan-100">
        <div className="animate-pulse text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <PortalLogin onInternalAuth={handleInternalAuth} />;
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

function parseNovaJwt(token: string): { id: number; username: string; role: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

const root = document.getElementById('portal-root');
if (root) {
  createRoot(root).render(<PortalApp />);
}
