import { useIntegrations } from '../hooks/useIntegrations.js';
import { IntegrationCard } from './IntegrationCard.js';
import { PABridgeCard } from './PABridgeCard.js';
import { AISettingsCard } from './AISettingsCard.js';

export function SettingsView() {
  const { integrations, loading, saveIntegration, reconnect, startLogin, checkLoginStatus, logout, refresh } = useIntegrations();

  if (loading) {
    return <div className="py-20 text-center text-neutral-500">Loading integrations...</div>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xs text-neutral-500 uppercase tracking-widest mb-4">
        Integrations
      </h2>
      {integrations.map((integ) => (
        <IntegrationCard
          key={integ.id}
          integration={integ}
          onSave={saveIntegration}
          onReconnect={reconnect}
          onStartLogin={startLogin}
          onCheckLoginStatus={checkLoginStatus}
          onLogout={logout}
          onRefresh={refresh}
        />
      ))}

      <h2 className="text-xs text-neutral-500 uppercase tracking-widest mb-4 mt-8">
        Power Automate Bridge
      </h2>
      <PABridgeCard />

      <h2 className="text-xs text-neutral-500 uppercase tracking-widest mb-4 mt-8">
        AI Assistant
      </h2>
      <AISettingsCard />
    </div>
  );
}
