import React, { useState, useEffect } from 'react';

interface PortalLoginProps {
  onInternalAuth?: () => void;
}

export default function PortalLogin({ onInternalAuth }: PortalLoginProps) {
  const error = new URLSearchParams(window.location.search).get('error');
  const [authMode, setAuthMode] = useState<'oidc' | 'internal' | null>(null);
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false);
  const [localEmail, setLocalEmail] = useState('');
  const [localPassword, setLocalPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submittingLocal, setSubmittingLocal] = useState(false);
  const [codexTestUserEnabled, setCodexTestUserEnabled] = useState(() => {
    const host = window.location.hostname;
    return host === '127.0.0.1' || host === 'localhost';
  });

  useEffect(() => {
    fetch('/api/portal/auth/mode')
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          setAuthMode(d.data.mode);
          setCodexTestUserEnabled(d.data.codexTestUserEnabled === true);
          setLocalLoginEnabled(d.data.localLoginEnabled === true);
        }
      })
      .catch(() => setAuthMode('oidc'));
  }, []);

  return (
    <div role="main" aria-label="Portal login" className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-cyan-100 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="mb-6">
          <div className="mt-2">
            <span className="text-3xl font-heading font-extrabold tracking-tight text-brand">nurtur</span>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Support Portal</h1>
          <p className="mt-2 text-gray-600">Sign in to manage your support requests and access the knowledge base.</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error === 'nova_auth_required'
              ? 'Please log in to NOVA first, then return here.'
              : 'Authentication failed. Please try again.'}
          </div>
        )}

        {authMode === null ? (
          <div className="py-3 text-gray-400 text-sm">Loading...</div>
        ) : (
          <div className="space-y-3">
            {authMode === 'internal' ? (
              <button
                onClick={onInternalAuth}
                className="inline-flex items-center justify-center w-full px-6 py-3 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
              >
                Access Portal
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/portal/auth/login');
                    const data = await res.json();
                    if (data.ok && data.data.url) {
                      window.location.href = data.data.url;
                    }
                  } catch { /* ignore */ }
                }}
                className="inline-flex items-center justify-center w-full px-6 py-3 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
              >
                Sign in with Nurtur
              </button>
            )}

            {authMode !== 'internal' && localLoginEnabled && (
              <div className="pt-3 border-t border-gray-200 text-left space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Sign in with email</h2>
                  <p className="mt-1 text-xs text-gray-500">For portal users created directly by an administrator.</p>
                </div>
                <input
                  value={localEmail}
                  onChange={e => setLocalEmail(e.target.value)}
                  type="email"
                  placeholder="Email address"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <input
                  value={localPassword}
                  onChange={e => setLocalPassword(e.target.value)}
                  type="password"
                  placeholder="Password"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand"
                />
                {localError && (
                  <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{localError}</div>
                )}
                <button
                  onClick={async () => {
                    setSubmittingLocal(true);
                    setLocalError(null);
                    try {
                      const res = await fetch('/api/portal/auth/local-login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: localEmail, password: localPassword }),
                      });
                      const data = await res.json();
                      if (!data.ok || !data.data?.token) {
                        throw new Error(data.error || 'Unable to sign in');
                      }
                      localStorage.setItem('portal_token', data.data.token);
                      window.location.href = '/portal';
                    } catch (err) {
                      setLocalError(err instanceof Error ? err.message : 'Unable to sign in');
                    } finally {
                      setSubmittingLocal(false);
                    }
                  }}
                  disabled={submittingLocal}
                  className="inline-flex items-center justify-center w-full px-6 py-3 border border-gray-900 text-gray-900 font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {submittingLocal ? 'Signing in...' : 'Sign in with email'}
                </button>
              </div>
            )}

            {codexTestUserEnabled && (
              <button
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('codexTestUser', '1');
                  window.location.href = url.toString();
                }}
                className="inline-flex items-center justify-center w-full px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
              >
                Use Codex Test User
              </button>
            )}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-500">
          By signing in, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}
