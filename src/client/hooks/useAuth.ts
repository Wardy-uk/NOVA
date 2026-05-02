import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  auth_provider: string;
  team_id: number | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  initializing: boolean; // true only during initial token validation
  busy: boolean;         // true during login/register actions
  error: string | null;
}

const TOKEN_KEY = 'nova_auth_token';
const REMEMBER_KEY = 'nova_remember_me';

function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

function storeToken(token: string, rememberMe: boolean) {
  localStorage.setItem(REMEMBER_KEY, rememberMe ? 'true' : 'false');
  if (rememberMe) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}

function clearToken(reason: string) {
  console.warn('[useAuth] clearToken called:', reason, new Error().stack);
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

// Install fetch interceptor that injects Authorization header for /api/ calls
// and verifies token with /api/auth/me before triggering logout on 401s
let currentToken: string | null = getStoredToken();
let onUnauthorized: (() => void) | null = null;
let verifyingToken = false;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // Only intercept /api/ calls (but not /api/auth/ to avoid loops)
  if (currentToken && url.startsWith('/api/') && !url.startsWith('/api/auth/')) {
    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${currentToken}`);
    }
    init = { ...init, headers };
  }

  const response = await originalFetch(input, init);

  // On 401 from a non-auth endpoint, verify the NOVA token is actually dead
  // before clearing — external service 401s (Jira, Confluence, etc.) must not
  // wipe a valid session.
  if (response.status === 401 && !url.startsWith('/api/auth/') && currentToken && onUnauthorized && !verifyingToken) {
    verifyingToken = true;
    try {
      const verify = await originalFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (verify.status === 401) {
        console.warn('[useAuth] Token confirmed invalid by /api/auth/me — logging out');
        onUnauthorized();
      }
    } catch {
      // Network error during verify — don't clear, could be transient
    } finally {
      verifyingToken = false;
    }
  }

  return response;
};

// Only one useAuth instance should manage token lifecycle (SSO extraction,
// validation, clearing). Secondary instances in child components just read
// the shared module-level state without destructive side effects.
let primaryInitDone = false;
let sharedAuthState: AuthState | null = null;

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    if (sharedAuthState?.user) return { ...sharedAuthState };
    return {
      user: null,
      token: getStoredToken(),
      initializing: true,
      busy: false,
      error: null,
    };
  });

  // Publish auth state for secondary instances
  useEffect(() => {
    sharedAuthState = state;
  }, [state]);

  // Sync token to interceptor
  useEffect(() => {
    currentToken = state.token;
  }, [state.token]);

  // Register unauthorized handler (only from primary instance)
  useEffect(() => {
    if (!primaryInitDone) return;
    onUnauthorized = () => {
      clearToken('401 verified by /api/auth/me');
      currentToken = null;
      setState({ user: null, token: null, initializing: false, busy: false, error: null });
    };
    return () => { onUnauthorized = null; };
  }, []);

  // Validate token on mount
  useEffect(() => {
    // Secondary instances: sync from storage, never clear on failure
    if (primaryInitDone) {
      const token = getStoredToken();
      if (token) {
        originalFetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.json())
          .then(json => {
            if (json.ok && json.data?.user) {
              setState({ user: json.data.user, token, initializing: false, busy: false, error: null });
            } else {
              setState(s => ({ ...s, token: null, initializing: false }));
            }
          })
          .catch(() => {
            setState(s => ({ ...s, initializing: false }));
          });
      } else {
        setState(s => ({ ...s, initializing: false }));
      }
      return;
    }
    primaryInitDone = true;

    // 1. Check for SSO token in URL hash (from callback redirect)
    const hash = window.location.hash;
    const ssoTokenMatch = hash.match(/sso_token=([^&]+)/);
    if (ssoTokenMatch) {
      const token = ssoTokenMatch[1];
      window.history.replaceState(null, '', window.location.pathname);
      storeToken(token, true);
      currentToken = token;

      originalFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.json())
        .then(json => {
          if (json.ok && json.data?.user) {
            setState({ user: json.data.user, token, initializing: false, busy: false, error: null });
          } else {
            clearToken('SSO token rejected by /api/auth/me');
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
      window.history.replaceState(null, '', window.location.pathname);
      setState({ user: null, token: null, initializing: false, busy: false, error: `Microsoft sign-in failed: ${ssoError}` });
      return;
    }

    // 3. Normal stored token validation
    const token = getStoredToken();
    if (!token) {
      setState({ user: null, token: null, initializing: false, busy: false, error: null });
      return;
    }

    originalFetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => {
        if (r.status === 401) {
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
