import { useState, useEffect, useCallback } from 'react';
import type { IntegrationStatus } from '../../shared/types.js';

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations');
      const json = await res.json();
      if (json.ok) setIntegrations(json.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);

  const saveIntegration = useCallback(async (
    id: string,
    enabled: boolean,
    credentials: Record<string, string>
  ): Promise<{ ok: boolean; mcpStatus?: string; lastError?: string }> => {
    const res = await fetch(`/api/integrations/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, credentials }),
    });
    const json = await res.json();
    await fetchIntegrations();
    return json;
  }, [fetchIntegrations]);

  const reconnect = useCallback(async (id: string) => {
    await fetch(`/api/integrations/${id}/reconnect`, { method: 'POST' });
    await fetchIntegrations();
  }, [fetchIntegrations]);

  const startLogin = useCallback(async (id: string): Promise<{
    ok: boolean;
    deviceCodeUrl?: string;
    userCode?: string;
    rawOutput?: string;
  }> => {
    const res = await fetch(`/api/integrations/${id}/login`, { method: 'POST' });
    return res.json();
  }, []);

  const checkLoginStatus = useCallback(async (id: string): Promise<{
    ok: boolean;
    loggedIn: boolean;
    loginInProgress: boolean;
  }> => {
    const res = await fetch(`/api/integrations/${id}/login-status`);
    return res.json();
  }, []);

  const logout = useCallback(async (id: string) => {
    await fetch(`/api/integrations/${id}/logout`, { method: 'POST' });
    await fetchIntegrations();
  }, [fetchIntegrations]);

  return {
    integrations, loading, saveIntegration, reconnect,
    startLogin, checkLoginStatus, logout,
    refresh: fetchIntegrations,
  };
}
