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

// Install fetch interceptor that injects Authorization header for /api/ calls
// and triggers logout on 401 responses
let currentToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

const originalFetch = window.fetch;
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
    token: localStorage.getItem(TOKEN_KEY),
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
      localStorage.removeItem(TOKEN_KEY);
      currentToken = null;
      setState({ user: null, token: null, initializing: false, busy: false, error: null });
    };
    return () => { onUnauthorized = null; };
  }, []);

  // Validate token on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
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
          localStorage.removeItem(TOKEN_KEY);
          setState({ user: null, token: null, initializing: false, busy: false, error: null });
        }
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setState({ user: null, token: null, initializing: false, busy: false, error: null });
      });
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    setState(s => ({ ...s, error: null, busy: true }));
    try {
      const res = await originalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();
      if (json.ok && json.data) {
        localStorage.setItem(TOKEN_KEY, json.data.token);
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
        localStorage.setItem(TOKEN_KEY, json.data.token);
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
    localStorage.removeItem(TOKEN_KEY);
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
