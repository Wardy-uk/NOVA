import { useState, useEffect, useCallback } from 'react';

export interface AuthUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  auth_provider: string;
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

function getTokenStorage(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === 'false' ? sessionStorage : localStorage;
}

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

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

// Install fetch interceptor that injects Authorization header for /api/ calls
// and triggers logout on 401 responses
let currentToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

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

  // Auto-logout on 401 (but not for auth endpoints)
  if (response.status === 401 && !url.startsWith('/api/auth/') && onUnauthorized) {
    onUnauthorized();
  }

  return response;
};

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: getStoredToken(),
    initializing: true,
    busy: false,
    error: null,
  });

  // Sync token to interceptor
  useEffect(() => {
    currentToken = state.token;
  }, [state.token]);

  // Register unauthorized handler
  useEffect(() => {
    onUnauthorized = () => {
      clearToken();
      currentToken = null;
      setState({ user: null, token: null, initializing: false, busy: false, error: null });
    };
    return () => { onUnauthorized = null; };
  }, []);

  // Validate token on mount
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setState({ user: null, token: null, initializing: false, busy: false, error: null });
      return;
    }

    originalFetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(json => {
        if (json.ok && json.data?.user) {
          setState({ user: json.data.user, token, initializing: false, busy: false, error: null });
        } else {
          clearToken();
          setState({ user: null, token: null, initializing: false, busy: false, error: null });
        }
      })
      .catch(() => {
        clearToken();
        setState({ user: null, token: null, initializing: false, busy: false, error: null });
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
        currentToken = json.data.token; // sync immediately — useEffect runs too late
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
        storeToken(json.data.token, true); // always remember on register
        currentToken = json.data.token; // sync immediately — useEffect runs too late
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
    clearToken();
    currentToken = null;
    setState({ user: null, token: null, initializing: false, busy: false, error: null });
  }, []);

  return {
    user: state.user,
    initializing: state.initializing,
    busy: state.busy,
    error: state.error,
    isAuthenticated: !!state.user,
    login,
    register,
    logout,
  };
}
