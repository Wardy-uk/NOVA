import { useState, useEffect, useRef, useCallback } from 'react';
import type { IntegrationStatus } from '../../shared/types.js';

const O365_SYNC_SOURCES = [
  { key: 'planner', label: 'Planner', desc: 'Task boards and assignments' },
  { key: 'todo', label: 'To-Do', desc: 'Personal task lists' },
  { key: 'calendar', label: 'Calendar', desc: 'Next 7 days of events' },
  { key: 'email', label: 'Email', desc: 'Flagged emails only' },
];

const STATUS_DOTS: Record<string, string> = {
  connected: 'bg-green-400',
  connecting: 'bg-yellow-400 animate-pulse',
  disconnected: 'bg-neutral-600',
  unavailable: 'bg-red-500',
  error: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Not connected',
  unavailable: 'Unavailable',
  error: 'Error',
};

interface Props {
  integration: IntegrationStatus;
  onSave: (id: string, enabled: boolean, credentials: Record<string, string>) => Promise<{ ok: boolean; mcpStatus?: string; lastError?: string }>;
  onReconnect: (id: string) => Promise<void>;
  onStartLogin: (id: string) => Promise<{ ok: boolean; deviceCodeUrl?: string; userCode?: string; rawOutput?: string }>;
  onCheckLoginStatus: (id: string) => Promise<{ ok: boolean; loggedIn: boolean; loginInProgress: boolean }>;
  onLogout: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function IntegrationCard({ integration, onSave, onReconnect, onStartLogin, onCheckLoginStatus, onLogout, onRefresh }: Props) {
  const [enabled, setEnabled] = useState(integration.enabled);
  const [values, setValues] = useState<Record<string, string>>({ ...integration.values });
  const [saving, setSaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Device code login state
  const [loginPending, setLoginPending] = useState(false);
  const [deviceCode, setDeviceCode] = useState<{ url: string; code: string | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleFieldChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleFieldFocus = (key: string, fieldType: string) => {
    if (fieldType === 'password' && values[key]?.includes('****')) {
      setValues((prev) => ({ ...prev, [key]: '' }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const result = await onSave(integration.id, enabled, values);
      if (result.ok) {
        const isOk = result.mcpStatus === 'connected' || result.mcpStatus === 'configured';
        setFeedback({
          type: isOk ? 'success' : 'error',
          message: result.mcpStatus === 'connected'
            ? 'Saved and connected'
            : result.mcpStatus === 'configured'
            ? 'Saved — sign in when ready'
            : `Saved. Status: ${result.mcpStatus ?? 'disconnected'}${result.lastError ? ` — ${result.lastError}` : ''}`,
        });
      } else {
        setFeedback({ type: 'error', message: 'Save failed' });
      }
    } catch {
      setFeedback({ type: 'error', message: 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  const handleReconnect = async () => {
    setReconnecting(true);
    setFeedback(null);
    await onReconnect(integration.id);
    setReconnecting(false);
  };

  const handleLogin = async () => {
    setLoginPending(true);
    setFeedback(null);
    setDeviceCode(null);

    try {
      const result = await onStartLogin(integration.id);
      if (result.ok) {
        setDeviceCode({
          url: result.deviceCodeUrl ?? 'https://microsoft.com/devicelogin',
          code: result.userCode ?? null,
        });

        // Start polling for login completion
        pollRef.current = setInterval(async () => {
          const status = await onCheckLoginStatus(integration.id);
          if (status.loggedIn) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDeviceCode(null);
            setLoginPending(false);
            setFeedback({ type: 'success', message: 'Signed in successfully' });
            await onRefresh();
          }
        }, 3000);
      } else {
        setLoginPending(false);
        setFeedback({ type: 'error', message: (result as { error?: string }).error || 'Failed to start login' });
      }
    } catch {
      setLoginPending(false);
      setFeedback({ type: 'error', message: 'Failed to start login' });
    }
  };

  const handleLogout = async () => {
    setFeedback(null);
    await onLogout(integration.id);
    setFeedback({ type: 'success', message: 'Signed out' });
  };

  // Auto-save when enable/disable toggle is changed
  const handleToggleEnabled = async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    setFeedback(null);
    try {
      const result = await onSave(integration.id, newEnabled, values);
      if (result.ok && newEnabled) {
        const isOk = result.mcpStatus === 'connected' || result.mcpStatus === 'configured';
        setFeedback({
          type: isOk ? 'success' : 'error',
          message: result.mcpStatus === 'connected'
            ? 'Enabled and connected'
            : result.mcpStatus === 'configured'
            ? 'Enabled — sign in when ready'
            : `Enabled. Status: ${result.mcpStatus ?? 'connecting...'}`,
        });
      }
    } catch {
      setEnabled(!newEnabled); // revert
    }
  };

  const [syncingSource, setSyncingSource] = useState<string | null>(null);

  const handleSyncSource = async (source: string) => {
    setSyncingSource(source);
    try {
      await fetch(`/api/tasks/sync/${source}`, { method: 'POST' });
    } catch { /* ignore */ }
    setSyncingSource(null);
  };

  const isDeviceCode = integration.authType === 'device_code';
  const isMsgraph = integration.id === 'msgraph';

  // O365 per-source sync toggles (only for msgraph)
  const [syncToggles, setSyncToggles] = useState<Record<string, boolean>>({});
  const [syncIntervals, setSyncIntervals] = useState<Record<string, string>>({});
  const [emailFilter, setEmailFilter] = useState('flagged');
  const [emailDays, setEmailDays] = useState('7');

  const loadSyncToggles = useCallback(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => {
        const settings: Record<string, string> = d.data ?? d;
        if (isMsgraph) {
          const toggles: Record<string, boolean> = {};
          const intervals: Record<string, string> = {};
          for (const s of O365_SYNC_SOURCES) {
            toggles[s.key] = settings[`sync_${s.key}_enabled`] !== 'false';
            intervals[s.key] = settings[`sync_${s.key}_interval_minutes`] ?? '';
          }
          setSyncToggles(toggles);
          setSyncIntervals(intervals);
          setEmailFilter(settings['email_filter'] ?? 'flagged');
          setEmailDays(settings['email_days'] ?? '7');
        } else {
          // Non-O365 integration — load its own interval
          const key = `sync_${integration.id}_interval_minutes`;
          setSyncIntervals({ [integration.id]: settings[key] ?? '' });
        }
      })
      .catch(() => {});
  }, [isMsgraph, integration.id]);

  useEffect(() => { loadSyncToggles(); }, [loadSyncToggles]);

  const saveSetting = async (key: string, value: string) => {
    try {
      await fetch(`/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
    } catch { /* ignore */ }
  };

  const saveEmailSetting = saveSetting;

  const toggleSyncSource = async (source: string, on: boolean) => {
    setSyncToggles((prev) => ({ ...prev, [source]: on }));
    try {
      await fetch(`/api/settings/sync_${source}_enabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: on ? 'true' : 'false' }),
      });
    } catch {
      setSyncToggles((prev) => ({ ...prev, [source]: !on }));
    }
  };

  return (
    <div className="border border-[#3a424d] rounded-lg p-4">
      {/* Header: name + status + toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_DOTS[integration.mcpStatus] ?? 'bg-neutral-600'}`} />
          <h3 className="text-sm font-semibold">{integration.name}</h3>
          <span className="text-xs text-neutral-500">{STATUS_LABELS[integration.mcpStatus] ?? integration.mcpStatus}</span>
          {integration.toolCount > 0 && (
            <span className="text-xs text-neutral-600">{integration.toolCount} tools</span>
          )}
        </div>
        <button
          onClick={handleToggleEnabled}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${enabled ? 'bg-[#5ec1ca]' : 'bg-neutral-700'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <p className="text-xs text-neutral-500 mb-4">{integration.description}</p>

      {/* Credential fields */}
      {enabled && integration.fields.length > 0 && (
        <div className="space-y-3 mb-4">
          {integration.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-neutral-400 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input
                type={field.type === 'password' ? 'password' : 'text'}
                value={values[field.key] ?? ''}
                onChange={(e) => handleFieldChange(field.key, e.target.value)}
                onFocus={() => handleFieldFocus(field.key, field.type)}
                placeholder={field.placeholder}
                className="w-full bg-[#2f353d] border border-[#3a424d] rounded px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* Sync interval + Sync Now for non-O365 integrations (jira, monday) */}
      {enabled && !isMsgraph && (
        <div className="mb-4">
          <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">
            Sync Frequency
          </label>
          <div className="flex items-center gap-2">
            <select
              value={syncIntervals[integration.id] ?? ''}
              onChange={(e) => {
                setSyncIntervals((prev) => ({ ...prev, [integration.id]: e.target.value }));
                saveSetting(`sync_${integration.id}_interval_minutes`, e.target.value);
              }}
              className="bg-[#2f353d] border border-[#3a424d] rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
            >
              <option value="">Default (global)</option>
              <option value="1">Every 1 minute</option>
              <option value="2">Every 2 minutes</option>
              <option value="5">Every 5 minutes</option>
              <option value="10">Every 10 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
            </select>
            <button
              onClick={() => handleSyncSource(integration.id)}
              disabled={syncingSource === integration.id}
              className="px-3 py-1.5 text-[10px] bg-[#2f353d] hover:bg-[#363d47] text-neutral-300 hover:text-neutral-100 rounded border border-[#3a424d] transition-colors disabled:opacity-50"
            >
              {syncingSource === integration.id ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          <p className="text-[10px] text-neutral-600 mt-1">
            Overrides the global default for this integration.
          </p>
        </div>
      )}

      {/* Device code auth (for device_code auth type) */}
      {enabled && isDeviceCode && (
        <div className="mb-4">
          {integration.loggedIn ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-green-400">Signed in to {integration.name}</span>
              <button
                onClick={handleLogout}
                className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : deviceCode ? (
            <div className="space-y-3">
              <p className="text-xs text-neutral-300">
                Open this URL in your browser and enter the code:
              </p>
              <div className="flex items-center gap-3">
                <a
                  href={deviceCode.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  {deviceCode.url}
                </a>
              </div>
              {deviceCode.code && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400">Code:</span>
                  <code className="px-2 py-1 bg-[#363d47] rounded text-sm font-mono text-neutral-100 tracking-wider">
                    {deviceCode.code}
                  </code>
                </div>
              )}
              <p className="text-xs text-neutral-500 animate-pulse">
                Waiting for you to sign in...
              </p>
            </div>
          ) : (
            <button
              onClick={handleLogin}
              disabled={loginPending}
              className="px-4 py-2 text-xs bg-[#5ec1ca] hover:bg-[#4ba8b0] text-[#272C33] font-semibold rounded transition-colors disabled:opacity-50"
            >
              {loginPending ? 'Starting login...' : 'Sign in with Microsoft'}
            </button>
          )}
        </div>
      )}

      {/* O365 sync source toggles */}
      {isMsgraph && enabled && integration.mcpStatus === 'connected' && (
        <div className="mb-4 space-y-1.5">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
            O365 Sync Sources
          </div>
          {O365_SYNC_SOURCES.map((s) => (
            <div
              key={s.key}
              className="flex items-center justify-between px-3 py-2 rounded bg-[#2f353d]"
            >
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => toggleSyncSource(s.key, !syncToggles[s.key])}
                  className={`relative w-8 h-[18px] rounded-full transition-colors ${
                    syncToggles[s.key] ? 'bg-[#5ec1ca]' : 'bg-[#3a424d]'
                  }`}
                >
                  <span
                    className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                      syncToggles[s.key] ? 'left-[16px]' : 'left-[2px]'
                    }`}
                  />
                </button>
                <div>
                  <span className={`text-xs ${syncToggles[s.key] ? 'text-neutral-200' : 'text-neutral-500'}`}>
                    {s.label}
                  </span>
                  <span className="text-[10px] text-neutral-600 ml-2">{s.desc}</span>
                </div>
              </div>
              {syncToggles[s.key] && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={syncIntervals[s.key] ?? ''}
                    onChange={(e) => {
                      setSyncIntervals((prev) => ({ ...prev, [s.key]: e.target.value }));
                      saveSetting(`sync_${s.key}_interval_minutes`, e.target.value);
                    }}
                    className="bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-[10px] text-neutral-300 focus:border-[#5ec1ca] focus:outline-none"
                  >
                    <option value="">Default</option>
                    <option value="1">1 min</option>
                    <option value="2">2 min</option>
                    <option value="5">5 min</option>
                    <option value="10">10 min</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                  </select>
                  <button
                    onClick={() => handleSyncSource(s.key)}
                    disabled={syncingSource === s.key}
                    className="px-2 py-1 text-[10px] bg-[#272C33] hover:bg-[#363d47] text-neutral-400 hover:text-neutral-200 rounded border border-[#3a424d] transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {syncingSource === s.key ? 'Syncing...' : 'Sync'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Email sync settings */}
      {isMsgraph && enabled && integration.mcpStatus === 'connected' && syncToggles['email'] && (
        <div className="mb-4 space-y-2">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">
            Email Settings
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Filter</label>
              <select
                value={emailFilter}
                onChange={(e) => {
                  setEmailFilter(e.target.value);
                  saveEmailSetting('email_filter', e.target.value);
                }}
                className="w-full bg-[#2f353d] border border-[#3a424d] rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
              >
                <option value="flagged">Flagged only</option>
                <option value="unread">Unread only</option>
                <option value="unread_and_flagged">Unread + Flagged</option>
                <option value="all">All emails</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-neutral-500 mb-1">Days to pull</label>
              <select
                value={emailDays}
                onChange={(e) => {
                  setEmailDays(e.target.value);
                  saveEmailSetting('email_days', e.target.value);
                }}
                className="w-full bg-[#2f353d] border border-[#3a424d] rounded px-2.5 py-1.5 text-xs text-neutral-200 focus:border-[#5ec1ca] focus:outline-none"
              >
                <option value="1">Last 1 day</option>
                <option value="3">Last 3 days</option>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="0">No limit</option>
              </select>
            </div>
          </div>
          <p className="text-[10px] text-neutral-600">
            Changes apply on next sync cycle.
          </p>
        </div>
      )}

      {/* Error display */}
      {integration.lastError && integration.mcpStatus === 'error' && (
        <div className="mb-3 p-2 bg-red-950/50 border border-red-900 rounded text-red-400 text-xs break-all">
          {integration.lastError}
        </div>
      )}

      {/* Feedback */}
      {feedback && (
        <div className={`mb-3 p-2 rounded text-xs ${
          feedback.type === 'success'
            ? 'bg-green-950/50 border border-green-900 text-green-400'
            : 'bg-red-950/50 border border-red-900 text-red-400'
        }`}>
          {feedback.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 text-xs bg-[#363d47] hover:bg-[#3a424d] rounded border border-[#3a424d] transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {integration.mcpStatus === 'error' && (
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            className="px-3 py-1.5 text-xs bg-[#363d47] hover:bg-[#3a424d] rounded border border-[#3a424d] transition-colors disabled:opacity-50"
          >
            {reconnecting ? 'Reconnecting...' : 'Retry Connection'}
          </button>
        )}
      </div>
    </div>
  );
}
