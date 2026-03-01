import { useState, useEffect } from 'react';
import { useIntegrations } from '../hooks/useIntegrations.js';
import { useAuth } from '../hooks/useAuth.js';
import { IntegrationCard } from './IntegrationCard.js';
import { PABridgeCard } from './PABridgeCard.js';
import { AISettingsCard } from './AISettingsCard.js';

// Global/service-account integrations managed in Admin (not user-facing)
const ADMIN_ONLY_INTEGRATIONS = new Set(['jira-onboarding', 'jira-servicedesk', 'sso', 'jira-oauth', 'smtp']);

// Map integration IDs to the data source(s) they populate locally
const INTEGRATION_SOURCES: Record<string, string[]> = {
  jira: ['jira'],
  msgraph: ['planner', 'todo', 'calendar', 'email'],
  monday: ['monday'],
  dynamics365: ['dynamics365'],
};

export function SettingsView() {
  const { integrations, loading, saveIntegration, reconnect, startLogin, checkLoginStatus, logout, refresh } = useIntegrations();
  const auth = useAuth();
  const isViewer = auth.user?.role === 'viewer';
  const userIntegrations = integrations.filter((i) => !ADMIN_ONLY_INTEGRATIONS.has(i.id));

  if (loading) {
    return <div className="py-20 text-center text-neutral-500">Loading integrations...</div>;
  }

  return (
    <div className={`space-y-4 ${isViewer ? 'pointer-events-none opacity-70' : ''}`}>
      <div className="mb-6">
        <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
          My Settings
        </h2>
        <p className="text-[11px] text-neutral-500 mt-0.5">
          Personal integrations and preferences for your account
        </p>
      </div>
      {isViewer && (
        <div className="p-3 bg-amber-950/30 border border-amber-900/50 rounded text-amber-400 text-xs">
          View-only mode. Contact an admin to make changes.
        </div>
      )}
      <h2 className="text-xs text-neutral-500 uppercase tracking-widest mb-4">
        Connections & Sync
      </h2>
      {userIntegrations.map((integ) => (
        <IntegrationCard
          key={integ.id}
          integration={integ}
          onSave={saveIntegration}
          onReconnect={reconnect}
          onStartLogin={startLogin}
          onCheckLoginStatus={checkLoginStatus}
          onLogout={logout}
          onRefresh={refresh}
          onDeleteRecords={
            INTEGRATION_SOURCES[integ.id]
              ? async () => {
                  const sources = INTEGRATION_SOURCES[integ.id];
                  for (const src of sources) {
                    const res = await fetch(`/api/data/source/${src}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error(`Failed to delete ${src} data`);
                  }
                }
              : undefined
          }
        />
      ))}

      <JiraOAuthCard />

      <h2 className="text-xs text-neutral-500 uppercase tracking-widest mb-4 mt-8">
        Power Automate Bridge
      </h2>
      <PABridgeCard />

      <h2 className="text-xs text-neutral-500 uppercase tracking-widest mb-4 mt-8">
        AI Preferences
      </h2>
      <AISettingsCard />
    </div>
  );
}

function JiraOAuthCard() {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/auth/jira/status')
      .then(r => r.json())
      .then(json => { if (json.ok) setStatus(json); })
      .catch(() => {});
  }, []);

  if (!status?.configured) return null;

  const connect = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/jira/login');
      const json = await res.json();
      if (json.ok && json.url) {
        window.location.href = json.url;
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const disconnect = async () => {
    await fetch('/api/auth/jira/disconnect', { method: 'DELETE' });
    setStatus({ configured: true, connected: false });
  };

  return (
    <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-200">Jira Account</h3>
          <p className="text-[10px] text-neutral-500 mt-0.5">
            {status.connected ? 'Your Jira account is connected via OAuth.' : 'Connect your Jira account for personal ticket access.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.connected ? (
            <>
              <span className="text-[10px] text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Connected
              </span>
              <button
                onClick={disconnect}
                className="px-3 py-1.5 text-[10px] text-neutral-400 hover:text-red-400 transition-colors border border-[#3a424d] rounded"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={loading}
              className="px-3 py-1.5 text-xs bg-[#5ec1ca] text-[#272C33] font-semibold rounded hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect Jira'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
