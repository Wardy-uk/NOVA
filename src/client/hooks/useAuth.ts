import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  auth_provider: string;
  team_id: number | null;
  teams?: string[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  initializing: boolean; // true only during initial token validation
  busy: boolean;         // true during login/register actions
  error: string | null;
}

console.log('[AUTH DEBUG BUILD] useAuth module loaded — instrumented build for token-wipe diagnosis');

// Watchdog: polls localStorage every 500ms for 30s after module load.
// If the token vanishes, logs the exact moment.
let _watchdogToken = localStorage.getItem('nova_auth_token');
const _watchdog = setInterval(() => {
  const now = localStorage.getItem('nova_auth_token');
  if (_watchdogToken && !now) {
    console.error('[AUTH WATCHDOG] Token VANISHED from localStorage!',
      '\n  sessionStorage:', !!sessionStorage.getItem('nova_auth_token'),
      '\n  interceptor currentToken:', !!currentToken,
      '\n  timestamp:', new Date().toISOString());
    // Don't clear interval — keep watching in case it comes back or vanishes again
  } else if (!_watchdogToken && now) {
    console.log('[AUTH WATCHDOG] Token APPEARED in localStorage. length:', now.length);
  }
  _watchdogToken = now;
}, 500);
setTimeout(() => clearInterval(_watchdog), 30000);

const TOKEN_KEY = 'nova_auth_token';
const REMEMBER_KEY = 'nova_remember_me';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

function storeToken(token: string, rememberMe: boolean) {
  console.error('[AUTH DEBUG] storeToken called', { token: token?.substring(0, 20), rememberMe, stack: new Error().stack });
  localStorage.setItem(REMEMBER_KEY, rememberMe ? 'true' : 'false');
  if (rememberMe) {
    localStorage.setItem(TOKEN_KEY, token);
    console.log('[STORE] wrote to localStorage, verify:', localStorage.getItem(TOKEN_KEY)?.substring(0, 20));
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    console.error('[AUTH DEBUG] storeToken REMOVING from localStorage (rememberMe=false)', new Error().stack);
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}

function clearToken(reason: string) {
  console.error('[AUTH DEBUG] clearToken called:', reason,
    '\n  localStorage had token:', !!localStorage.getItem(TOKEN_KEY),
    '\n  sessionStorage had token:', !!sessionStorage.getItem(TOKEN_KEY),
    '\n  interceptor currentToken:', !!currentToken,
    '\n  stack:', new Error().stack);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

// Fetch interceptor: injects Authorization header for /api/ calls.
// NEVER reacts to 401s — only /api/auth/me validation in the useEffect
// is allowed to clear the token.
let currentToken: string | null = getStoredToken();

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // DEBUG: log every fetch to /api/
  if (url.startsWith('/api/')) {
    const existingAuth = new Headers(init?.headers).get('Authorization');
    console.log('[FETCH]', url,
      'interceptor-token:', !!currentToken,
      'localStorage-token:', !!localStorage.getItem('nova_auth_token'),
      'sessionStorage-token:', !!sessionStorage.getItem('nova_auth_token'),
      'pre-existing-auth-header:', existingAuth ? `"${existingAuth.substring(0, 15)}..."` : 'none');
  }

  if (currentToken && !localStorage.getItem('nova_auth_token') && !sessionStorage.getItem('nova_auth_token')) {
    localStorage.setItem('nova_auth_token', currentToken);
    console.error('[AUTH SELF-HEAL] Re-persisted token to localStorage');
  }

  if (currentToken && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${currentToken}`);
    init = { ...init, headers };
  }

  const response = await originalFetch(input, init);

  // DEBUG: log 401 responses
  if (url.startsWith('/api/') && response.status === 401) {
    console.error('[FETCH 401]', url,
      'interceptor-token:', !!currentToken,
      'localStorage-token:', !!localStorage.getItem('nova_auth_token'),
      'sessionStorage-token:', !!sessionStorage.getItem('nova_auth_token'));
  }

  return response;
};

// Only one useAuth instance should manage token lifecycle (SSO extraction,
// validation, clearing). Secondary instances in child components just read
// the shared module-level state without destructive side effects.
let primaryInitDone = false;
let sharedAuthState: AuthState | null = null;

export function useAuth() {
  const [state, _setStateRaw] = useState<AuthState>(() => {
    const init = sharedAuthState?.user
      ? { ...sharedAuthState }
      : { user: null, token: getStoredToken(), initializing: true, busy: false, error: null };
    console.log('[AUTH DEBUG] useState initializer:', { hasUser: !!init.user, hasToken: !!init.token, sharedHasUser: !!sharedAuthState?.user });
    return init;
  });

  // Wrapped setState that logs when token becomes null
  const setState = useCallback((update: AuthState | ((prev: AuthState) => AuthState)) => {
    _setStateRaw(prev => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (prev.token && !next.token) {
        console.error('[AUTH DEBUG] setState NULLING token!',
          '\n  prev.token:', prev.token?.substring(0, 20),
          '\n  next.token:', next.token,
          '\n  next.user:', next.user?.username ?? 'null',
          '\n  localStorage:', !!localStorage.getItem(TOKEN_KEY),
          '\n  stack:', new Error().stack);
      }
      return next;
    });
  }, []);

  // Publish auth state for secondary instances
  useEffect(() => {
    sharedAuthState = state;
  }, [state]);

  // Sync token to interceptor
  useEffect(() => {
    const prev = currentToken;
    currentToken = state.token;
    if (prev && !state.token) {
      console.error('[AUTH DEBUG] SYNC EFFECT nulled currentToken! prev existed, state.token is now null.',
        '\n  localStorage:', !!localStorage.getItem(TOKEN_KEY),
        '\n  sessionStorage:', !!sessionStorage.getItem(TOKEN_KEY),
        '\n  stack:', new Error().stack);
    } else if (prev !== state.token) {
      console.log('[AUTH DEBUG] Sync effect: currentToken changed.',
        'prev:', !!prev, '→ state.token:', !!state.token);
    }
  }, [state.token]);

  // Validate token on mount
  useEffect(() => {
    // Secondary instances: read shared state, never touch the token.
    // The primary instance owns the token lifecycle.
    if (primaryInitDone) {
      console.log('[AUTH DEBUG] Secondary useAuth instance mounted. sharedAuthState user:', sharedAuthState?.user?.username ?? 'null');
      if (sharedAuthState?.user) {
        setState({ ...sharedAuthState, initializing: false });
      } else {
        // Primary hasn't finished validating yet — try reading token ourselves
        const token = getStoredToken();
        if (token) {
          originalFetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(r => r.ok ? r.json() : null)
            .then(json => {
              if (json?.ok && json.data?.user) {
                setState({ user: json.data.user, token, initializing: false, busy: false, error: null });
              } else {
                // DON'T clear the token — just mark as not initializing.
                // The primary instance is the only one that can clear.
                setState(s => ({ ...s, initializing: false }));
              }
            })
            .catch(() => {
              setState(s => ({ ...s, initializing: false }));
            });
        } else {
          setState(s => ({ ...s, initializing: false }));
        }
      }
      return;
    }
    primaryInitDone = true;
    console.log('[AUTH DEBUG] Primary useAuth instance initializing. Token in localStorage:', !!localStorage.getItem(TOKEN_KEY), 'sessionStorage:', !!sessionStorage.getItem(TOKEN_KEY));

    // 1. Check for SSO token in URL hash (from callback redirect)
    const hash = window.location.hash;
    const ssoTokenMatch = hash.match(/sso_token=([^&]+)/);
    if (ssoTokenMatch) {
      const token = ssoTokenMatch[1];
      console.log('[AUTH DEBUG] SSO hash found. Token length:', token.length);
      window.history.replaceState(null, '', window.location.pathname);
      storeToken(token, true);
      console.log('[AUTH DEBUG] After storeToken(true): localStorage has token:', !!localStorage.getItem(TOKEN_KEY), 'sessionStorage:', !!sessionStorage.getItem(TOKEN_KEY));
      currentToken = token;

      originalFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(json => {
          console.log('[AUTH DEBUG] SSO /api/auth/me responded. ok:', json.ok, 'has user:', !!json.data?.user, 'localStorage still has token:', !!localStorage.getItem(TOKEN_KEY));
          if (json.ok && json.data?.user) {
            setState({ user: json.data.user, token, initializing: false, busy: false, error: null });
          } else {
            clearToken('SSO token rejected by /api/auth/me');
            console.error('[AUTH DEBUG] Nulling currentToken (SSO rejected)');
            currentToken = null;
            setState({ user: null, token: null, initializing: false, busy: false, error: 'SSO login failed. Please try again.' });
          }
        })
        .catch(() => {
          // Network error — keep the token, it might be valid once connectivity returns
          setState(s => ({ ...s, initializing: false, error: 'Network error during SSO login — retrying on next navigation.' }));
        });
      return;
    }

    // 2. Check for SSO error in query params
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get('sso_error');
    if (ssoError) {
      console.error('[AUTH DEBUG] SSO error in query params:', ssoError);
      window.history.replaceState(null, '', window.location.pathname);
      setState({ user: null, token: null, initializing: false, busy: false, error: `Microsoft sign-in failed: ${ssoError}` });
      return;
    }

    // 3. Normal stored token validation
    const token = getStoredToken();
    if (!token) {
      console.error('[AUTH DEBUG] No stored token found during primary init. localStorage:', !!localStorage.getItem(TOKEN_KEY), 'sessionStorage:', !!sessionStorage.getItem(TOKEN_KEY));
      setState({ user: null, token: null, initializing: false, busy: false, error: null });
      return;
    }
    console.log('[AUTH DEBUG] Found stored token, validating with /api/auth/me. Token length:', token.length);

    originalFetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (r.status === 401) {
          console.error('[AUTH DEBUG] /api/auth/me returned 401. Response status:', r.status);
          clearToken('stored token rejected 401 by /api/auth/me');
          setState({ user: null, token: null, initializing: false, busy: false, error: null });
          return null;
        }
        return r.json();
      })
      .then(json => {
        if (!json) return;
        if (json.ok && json.data?.user) {
          setState({ user: json.data.user, token, initializing: false, busy: false, error: null });
        } else {
          console.error('[AUTH DEBUG] /api/auth/me returned non-ok JSON:', JSON.stringify(json).substring(0, 200));
          clearToken('stored token invalid (non-ok response from /api/auth/me)');
          setState({ user: null, token: null, initializing: false, busy: false, error: null });
        }
      })
      .catch(() => {
        // Network error — keep the token, don't destroy a valid session over a transient blip
        setState(s => ({ ...s, initializing: false }));
      });
  }, []);

  const login = useCallback(async (username: string, password: string, rememberMe = true): Promise<boolean> => {
    setState(s => ({ ...s, error: null, busy: true }));
    try {
      const res = await originalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        storeToken(json.data.token, rememberMe);
        currentToken = json.data.token;
        setState({ user: json.data.user, token: json.data.token, initializing: false, busy: false, error: null });
        return true;
      }
      setState(s => ({ ...s, busy: false, error: json.error || 'Login failed' }));
      return false;
    } catch {
      setState(s => ({ ...s, busy: false, error: 'Network error' }));
      return false;
    }
  }, []);

  const loginWithSso = useCallback(async (): Promise<void> => {
    setState(s => ({ ...s, error: null, busy: true }));
    try {
      const res = await originalFetch('/api/auth/sso/login');
      const json = await res.json();
      if (json.ok && json.data?.url) {
        window.location.href = json.data.url;
      } else {
        setState(s => ({ ...s, busy: false, error: json.error || 'SSO not available' }));
      }
    } catch {
      setState(s => ({ ...s, busy: false, error: 'Network error' }));
    }
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string): Promise<boolean> => {
    setState(s => ({ ...s, error: null, busy: true }));
    try {
      const res = await originalFetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, display_name: displayName }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        storeToken(json.data.token, true);
        currentToken = json.data.token;
        setState({ user: json.data.user, token: json.data.token, initializing: false, busy: false, error: null });
        return true;
      }
      setState(s => ({ ...s, busy: false, error: json.error || 'Registration failed' }));
      return false;
    } catch {
      setState(s => ({ ...s, busy: false, error: 'Network error' }));
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    console.error('[AUTH DEBUG] logout() called', new Error().stack);
    clearToken('user logout');
    currentToken = null;
    setState({ user: null, token: null, initializing: false, busy: false, error: null });
  }, []);

  return {
    user: state.user,
    token: state.token,
    initializing: state.initializing,
    busy: state.busy,
    error: state.error,
    isAuthenticated: !!state.user,
    login,
    loginWithSso,
    register,
    logout,
  };
}
