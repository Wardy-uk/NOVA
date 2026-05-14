import React, { useState, useEffect } from 'react';

interface PortalLoginProps {
  onInternalAuth?: () => void;
}

export default function PortalLogin({ onInternalAuth }: PortalLoginProps) {
  const error = new URLSearchParams(window.location.search).get('error');
  const [authMode, setAuthMode] = useState<'oidc' | 'internal' | null>(null);

  useEffect(() => {
    fetch('/api/portal/auth/mode')
      .then(r => r.json())
      .then(d => { if (d.ok) setAuthMode(d.data.mode); })
      .catch(() => setAuthMode('oidc'));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="mb-6">
          <div className="w-16 h-16 mx-auto rounded-xl bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
            N
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Nurtur Support Portal</h1>
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
        ) : authMode === 'internal' ? (
          <button
            onClick={onInternalAuth}
            className="inline-flex items-center justify-center w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
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
            className="inline-flex items-center justify-center w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Sign in with Nurtur
          </button>
        )}

        <p className="mt-6 text-xs text-gray-500">
          By signing in, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
}
