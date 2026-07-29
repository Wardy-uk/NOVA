import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import type { PortalAuthPayload, PortalOrgFeatures, PortalOrgBranding, PortalOrgMembershipSummary } from '../shared/portal-types.js';
import { PORTAL_ROLE_RANK } from '../shared/portal-types.js';
import PortalLayout from './components/portal/PortalLayout.js';
import PortalLogin from './components/portal/PortalLogin.js';
import PortalToastContainer, { showPortalToast } from './components/portal/PortalToast.js';

const PortalHome = lazy(() => import('./components/portal/PortalHome.js'));
const PortalTicketList = lazy(() => import('./components/portal/PortalTicketList.js'));
const PortalTicketDetail = lazy(() => import('./components/portal/PortalTicketDetail.js'));
const PortalNewRequest = lazy(() => import('./components/portal/PortalNewRequest.js'));
const PortalRaiseTicket = lazy(() => import('./components/portal/PortalRaiseTicket.js'));
const PortalKnowledgeBase = lazy(() => import('./components/portal/PortalKnowledgeBase.js'));
const PortalChat = lazy(() => import('./components/portal/PortalChat.js'));
const PortalCSAT = lazy(() => import('./components/portal/PortalCSAT.js'));
const PortalOnboardingDashboard = lazy(() => import('./components/portal/PortalGuildOnboarding.js'));
const PortalSupportDashboard = lazy(() => import('./components/portal/PortalSupportDashboard.js'));
const PortalAbout = lazy(() => import('./components/portal/PortalAbout.js'));
const PortalEscalations = lazy(() => import('./components/portal/PortalEscalations.js'));
const PortalOrgUsers = lazy(() => import('./components/portal/PortalOrgUsers.js'));

type PortalView = 'home' | 'tickets' | 'ticket-detail' | 'new-request' | 'raise-ticket' | 'kb' | 'chat' | 'onboarding-dashboard' | 'support-dashboard' | 'about' | 'escalations' | 'org-users';

const PORTAL_TOKEN_KEY = 'portal_token';
const NOVA_TOKEN_KEY = 'token';
// The org the user has switched into. The server treats this as a request, not a
// fact — it validates membership and falls back to the home org if not entitled.
const ACTIVE_ORG_KEY = 'portal_active_org';
const CODEX_TEST_USER_KEY = 'portal_codex_test_user';
const CODEX_TEST_USER: PortalAuthPayload = {
  userId: -1,
  email: 'codex.portal.test@nurtur.tech',
  orgId: -1,
  orgName: 'Codex Test Organisation',
  role: 'requester',
};

function getNovaToken(): string | null {
  return localStorage.getItem(NOVA_TOKEN_KEY);
}

let refreshInFlight: Promise<string | null> | null = null;

function getTokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
}

function isTokenExpired(token: string): boolean {
  const expiry = getTokenExpiry(token);
  if (!expiry) return false;
  return Date.now() >= expiry;
}

async function ensureFreshToken(): Promise<string | null> {
  const portalToken = localStorage.getItem(PORTAL_TOKEN_KEY);
  const novaToken = getNovaToken();
  const token = portalToken || novaToken;
  if (!token) return null;

  const expiry = getTokenExpiry(token);
  // Token already expired — clear and bail (force re-login)
  if (expiry && Date.now() >= expiry) {
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    return null;
  }
  if (!expiry || expiry - Date.now() > 10 * 60 * 1000) return token;

  // Token expires within 10 minutes — refresh it
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/portal/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        localStorage.removeItem(PORTAL_TOKEN_KEY);
        return null;
      }
      const body = await res.json();
      if (body.data?.token) {
        localStorage.setItem(PORTAL_TOKEN_KEY, body.data.token);
        return body.data.token as string;
      }
      return token;
    } catch {
      return token;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function getActiveOrgId(): string | null {
  return localStorage.getItem(ACTIVE_ORG_KEY);
}

async function portalFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = await ensureFreshToken();
  if (!token && !path.includes('/auth/')) {
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    window.location.href = '/portal';
    return new Response(JSON.stringify({ ok: false, error: 'Session expired' }), { status: 401 });
  }
  const activeOrg = getActiveOrgId();
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(activeOrg ? { 'X-Portal-Org': activeOrg } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401) {
    localStorage.removeItem(PORTAL_TOKEN_KEY);
    window.location.href = '/portal';
  }
  return res;
}

// Export for use in portal components
(window as any).__portalFetch = portalFetch;

function shadeHex(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) * (1 + amt));
  const g = clamp(((n >> 8) & 0xff) * (1 + amt));
  const b = clamp((n & 0xff) * (1 + amt));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Apply per-org branding by overriding the Tailwind theme CSS variables at runtime.
function applyBranding(b: PortalOrgBranding | null): void {
  const root = document.documentElement;
  if (!b) return;
  if (b.primary) {
    root.style.setProperty('--color-brand', b.primary);
    root.style.setProperty('--color-brand-dark', shadeHex(b.primary, -0.18));
  }
  if (b.secondary) root.style.setProperty('--color-brand-secondary', b.secondary);
  if (b.font) {
    root.style.setProperty('--font-sans', `'${b.font}', ui-sans-serif, sans-serif`);
    root.style.setProperty('--font-heading', `'${b.font}', ui-sans-serif, sans-serif`);
    if (!document.getElementById('org-brand-font')) {
      const link = document.createElement('link');
      link.id = 'org-brand-font';
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(b.font).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`;
      document.head.appendChild(link);
    }
  }
}

function parseJwt(token: string): PortalAuthPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

async function fetchCodexTestSession(): Promise<{ token: string; user: PortalAuthPayload } | null> {
  try {
    const res = await fetch('/api/portal/auth/codex-test-login', { method: 'POST' });
    const data = await res.json();
    if (data.ok && data.data?.token && data.data?.user) {
      return data.data as { token: string; user: PortalAuthPayload };
    }
  } catch {
    return null;
  }
  return null;
}

function wantsCodexTestUserFromUrl(): boolean {
  return new URL(window.location.href).searchParams.get('codexTestUser') === '1';
}

function hasStoredCodexTestUser(): boolean {
  return localStorage.getItem(CODEX_TEST_USER_KEY) === '1';
}

function enableStoredCodexTestUser(): void {
  localStorage.setItem(CODEX_TEST_USER_KEY, '1');
  document.cookie = 'portal_codex_test_user=1; path=/; SameSite=Lax';
}

function clearStoredCodexTestUser(): void {
  localStorage.removeItem(CODEX_TEST_USER_KEY);
  document.cookie = 'portal_codex_test_user=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
}

function PortalApp() {
  const [user, setUser] = useState<PortalAuthPayload | null>(null);
  const [features, setFeatures] = useState<PortalOrgFeatures | null>(null);
  const [branding, setBranding] = useState<PortalOrgBranding | null>(null);
  const [view, setView] = useState<PortalView>('home');
  const [selectedTicketKey, setSelectedTicketKey] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'oidc' | 'internal' | null>(null);
  const [checking, setChecking] = useState(true);
  const [orgs, setOrgs] = useState<PortalOrgMembershipSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const wantsCodexTestUser = wantsCodexTestUserFromUrl() || hasStoredCodexTestUser();

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

      if (wantsCodexTestUser) {
        const session = await fetchCodexTestSession();
        if (session) {
          localStorage.setItem(PORTAL_TOKEN_KEY, session.token);
          enableStoredCodexTestUser();
          setUser(session.user);
          url.searchParams.delete('codexTestUser');
          window.history.replaceState({}, '', url.toString());
          setChecking(false);
          return;
        }

        enableStoredCodexTestUser();
        setUser(CODEX_TEST_USER);
        url.searchParams.delete('codexTestUser');
        window.history.replaceState({}, '', url.toString());
        setChecking(false);
        return;
      }

      // Check stored portal token (OIDC/local mode)
      const stored = localStorage.getItem(PORTAL_TOKEN_KEY);
      if (stored) {
        if (isTokenExpired(stored)) {
          localStorage.removeItem(PORTAL_TOKEN_KEY);
        } else {
          const payload = parseJwt(stored);
          if (payload) { setUser(payload); setChecking(false); return; }
          localStorage.removeItem(PORTAL_TOKEN_KEY);
        }
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
    localStorage.removeItem(ACTIVE_ORG_KEY);
    clearStoredCodexTestUser();
    setUser(null);
    setView('home');
  }, []);

  // Switching org changes branding, feature flags and every piece of data on screen.
  // Reload rather than try to invalidate it all — it is a rare, deliberate action.
  const handleSwitchOrg = useCallback((orgId: number) => {
    localStorage.setItem(ACTIVE_ORG_KEY, String(orgId));
    window.location.reload();
  }, []);

  const handleViewTicket = useCallback((key: string) => {
    setSelectedTicketKey(key);
    setView('ticket-detail');
  }, []);

  // Which orgs can this user switch into? Most customers get exactly one.
  useEffect(() => {
    if (!user) { setOrgs([]); setActiveOrgId(null); return; }
    let cancelled = false;
    portalFetch('/api/portal/my-orgs')
      .then(r => r.json())
      .then(d => {
        if (cancelled || !d.ok) return;
        setOrgs(d.data.orgs);
        setActiveOrgId(d.data.activeOrgId);
        // The server has the final say. If it refused our requested org (revoked
        // membership, stale localStorage) it falls back to the home org — mirror
        // that locally so we stop sending a header it will keep rejecting.
        if (String(d.data.activeOrgId) !== getActiveOrgId()) {
          localStorage.setItem(ACTIVE_ORG_KEY, String(d.data.activeOrgId));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // Fetch per-org feature toggles once authenticated
  useEffect(() => {
    if (!user) { setFeatures(null); return; }
    let cancelled = false;
    portalFetch('/api/portal/features')
      .then(r => r.json())
      .then(d => { if (!cancelled && d.ok) setFeatures(d.data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // Fetch + apply per-org branding once authenticated
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    portalFetch('/api/portal/branding')
      .then(r => r.json())
      .then(d => { if (!cancelled && d.ok) { setBranding(d.data); applyBranding(d.data); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // The user's effective role in the org they're currently viewing. A user can be
  // e.g. org_admin in one org and viewer in another, so nav/guards key off this,
  // not the home-org role in the token.
  const effectiveRole = orgs.find(o => o.orgId === activeOrgId)?.role ?? user?.role ?? 'requester';

  // Until features load, keep Get Help + KB visible (existing default) but treat
  // the customer dashboards as opt-in so they don't flash for orgs without them.
  const resolvedFeatures: PortalOrgFeatures = features ?? { getHelp: true, kb: true, support: false, onboarding: false };

  // Redirect away from a view the org isn't allowed to see
  useEffect(() => {
    if (!features) return;
    if ((view === 'support-dashboard' && !features.support) ||
        (view === 'onboarding-dashboard' && !features.onboarding) ||
        (view === 'raise-ticket' && !features.raiseTicket) ||
        (view === 'about' && PORTAL_ROLE_RANK[effectiveRole] < PORTAL_ROLE_RANK.manager) ||
        (view === 'escalations' && PORTAL_ROLE_RANK[effectiveRole] < PORTAL_ROLE_RANK.org_admin) ||
        (view === 'org-users' && PORTAL_ROLE_RANK[effectiveRole] < PORTAL_ROLE_RANK.org_admin) ||
        (view === 'kb' && !features.kb) ||
        (view === 'chat' && !features.getHelp)) {
      setView('home');
    }
  }, [features, view, effectiveRole]);

  // SSE connection for real-time portal events
  const sseRef = useRef<EventSource | null>(null);
  const sseRetryRef = useRef(1000);
  const ticketRefreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user) return;

    let closed = false;

    const connect = () => {
      if (closed) return;
      const token = localStorage.getItem(PORTAL_TOKEN_KEY) || localStorage.getItem(NOVA_TOKEN_KEY);
      if (!token) return;

      const es = new EventSource(`/api/portal/events?token=${encodeURIComponent(token)}`);
      sseRef.current = es;

      es.onopen = () => { sseRetryRef.current = 1000; };

      es.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data);
          if (event.type === 'connected') return;

          const key = event.ticketKey;
          if (event.type === 'ticket:status_change') {
            showPortalToast(`Ticket ${key}: status changed to ${event.data?.to || 'Unknown'}`, key);
          } else if (event.type === 'ticket:assignment_change') {
            showPortalToast(`Ticket ${key}: assigned to ${event.data?.to || 'Unassigned'}`, key);
          } else if (event.type === 'ticket:comment') {
            showPortalToast(`New comment on ${key} by ${event.data?.author || 'someone'}`, key);
          }

          // If viewing the affected ticket, trigger a refresh
          if (ticketRefreshRef.current && key === selectedTicketKey) {
            ticketRefreshRef.current();
          }
        } catch { /* ignore malformed events */ }
      };

      es.onerror = () => {
        es.close();
        sseRef.current = null;
        if (!closed) {
          const delay = Math.min(sseRetryRef.current, 30000);
          sseRetryRef.current = delay * 2;
          setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [user, selectedTicketKey]);

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
    <PortalLayout
      user={user}
      currentView={view}
      onNavigate={setView}
      onLogout={handleLogout}
      features={resolvedFeatures}
      logoUrl={branding?.logoUrl || null}
      orgs={orgs}
      activeOrgId={activeOrgId}
      onSwitchOrg={handleSwitchOrg}
      role={effectiveRole}
    >
      <Suspense fallback={fallback}>
        {view === 'home' && <PortalHome onNavigate={setView} onViewTicket={handleViewTicket} portalUser={user} features={resolvedFeatures} />}
        {view === 'tickets' && <PortalTicketList onViewTicket={handleViewTicket} />}
        {view === 'ticket-detail' && selectedTicketKey && (
          <PortalTicketDetail ticketKey={selectedTicketKey} onBack={() => setView('tickets')} onRefreshRef={ticketRefreshRef} />
        )}
        {view === 'new-request' && <PortalNewRequest onCreated={(key) => { handleViewTicket(key); }} onNavigate={setView} />}
        {view === 'raise-ticket' && resolvedFeatures.raiseTicket && <PortalRaiseTicket onCreated={(key) => { handleViewTicket(key); }} routes={resolvedFeatures.supportRoutes} />}
        {view === 'kb' && resolvedFeatures.kb && <PortalKnowledgeBase onNavigate={setView} />}
        {view === 'chat' && resolvedFeatures.getHelp && <PortalChat autoStart onNavigateToTicket={handleViewTicket} />}
        {view === 'support-dashboard' && resolvedFeatures.support && <PortalSupportDashboard isAdmin={PORTAL_ROLE_RANK[effectiveRole] >= PORTAL_ROLE_RANK.org_admin} />}
        {view === 'onboarding-dashboard' && resolvedFeatures.onboarding && <PortalOnboardingDashboard />}
        {view === 'about' && PORTAL_ROLE_RANK[effectiveRole] >= PORTAL_ROLE_RANK.manager && <PortalAbout user={user} multiOrg={orgs.length > 1} orgName={orgs.find(o => o.orgId === activeOrgId)?.orgName} isAdmin={PORTAL_ROLE_RANK[effectiveRole] >= PORTAL_ROLE_RANK.org_admin} />}
        {view === 'escalations' && PORTAL_ROLE_RANK[effectiveRole] >= PORTAL_ROLE_RANK.org_admin && <PortalEscalations />}
        {view === 'org-users' && PORTAL_ROLE_RANK[effectiveRole] >= PORTAL_ROLE_RANK.org_admin && <PortalOrgUsers />}
      </Suspense>
      <PortalToastContainer onViewTicket={handleViewTicket} />
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

// Any /portal/csat/<segment> is a feedback link. Route ALL of them to the CSAT
// page (which shows a clear error for unknown/malformed tokens) rather than
// falling through to the portal app — e.g. an unsubstituted ${issue.key}.
const CSAT_PREFIX_RE = /^\/portal\/csat\/(.+)$/;

function CsatRoute() {
  const match = window.location.pathname.match(CSAT_PREFIX_RE);
  if (!match) return null;
  // Decode the raw segment; the CSAT page validates it against the API.
  let token = match[1];
  try { token = decodeURIComponent(token); } catch { /* keep raw */ }
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>}>
      <PortalCSAT token={token} />
    </Suspense>
  );
}

const root = document.getElementById('portal-root');
if (root) {
  const csatMatch = CSAT_PREFIX_RE.test(window.location.pathname);
  createRoot(root).render(csatMatch ? <CsatRoute /> : <PortalApp />);
}
