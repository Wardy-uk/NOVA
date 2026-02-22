import { useState, useEffect, useRef } from 'react';
import type { IntegrationStatus } from '../../shared/types.js';

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
        setFeedback({
          type: result.mcpStatus === 'connected' ? 'success' : 'error',
          message: result.mcpStatus === 'connected'
            ? 'Saved and connected'
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
        setFeedback({ type: 'error', message: 'Failed to start login' });
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

  const isDeviceCode = integration.authType === 'device_code';

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
          onClick={() => setEnabled(!enabled)}
          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${enabled ? 'bg-[#5ec1ca]' : 'bg-neutral-700'}`}
        >
          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <p className="text-xs text-neutral-500 mb-4">{integration.description}</p>

      {/* Credential fields (for credentials auth type) */}
      {enabled && !isDeviceCode && (
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

      {/* Device code auth (for device_code auth type) */}
      {enabled && isDeviceCode && (
        <div className="mb-4">
          {integration.loggedIn ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-green-400">Signed in to Microsoft 365</span>
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
