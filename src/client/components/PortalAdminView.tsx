import React, { useEffect, useState } from 'react';
import type { PortalMetrics } from '../../shared/portal-types.js';

const API = '/api/portal/admin';

function useFetch<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(path, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.json())
      .then(d => { if (d.ok) setData(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, deps);
  return { data, loading };
}

type Tab = 'overview' | 'users' | 'orgs' | 'sessions' | 'settings';

export default function PortalAdminView() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Portal Administration</h1>

      <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
        {(['overview', 'users', 'orgs', 'sessions', 'settings'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors capitalize ${
              tab === t ? 'bg-gray-700 text-white font-medium' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <MetricsPanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'orgs' && <OrgsPanel />}
      {tab === 'sessions' && <SessionsPanel />}
      {tab === 'settings' && <SettingsPanel />}
    </div>
  );
}

function MetricsPanel() {
  const { data: metrics, loading } = useFetch<PortalMetrics>(`${API}/metrics`);
  const { data: eventCounts } = useFetch<Record<string, number>>(`${API}/event-counts?days=30`);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  const cards = metrics ? [
    { label: 'Deflection Rate', value: `${metrics.deflectionRate}%`, target: '30%' },
    { label: 'Chat Resolution', value: `${metrics.chatResolutionRate}%`, target: '20%' },
    { label: 'Form Completion', value: `${metrics.formCompletionRate}%`, target: '80%' },
    { label: 'KB Search Success', value: `${metrics.kbSearchSuccessRate}%`, target: '50%' },
    { label: 'Article Helpfulness', value: `${metrics.articleHelpfulness}%`, target: '70%' },
    { label: 'Portal Adoption', value: `${metrics.portalAdoption}%`, target: 'Trending up' },
  ] : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {cards.map(c => (
          <div key={c.label} className="bg-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wider">{c.label}</div>
            <div className="text-2xl font-bold text-white mt-1">{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">Target: {c.target}</div>
          </div>
        ))}
      </div>

      {eventCounts && (
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Event Counts (30 days)</h3>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(eventCounts).map(([event, count]) => (
              <div key={event} className="flex justify-between text-sm">
                <span className="text-gray-400">{event.replace(/_/g, ' ')}</span>
                <span className="text-white font-medium">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersPanel() {
  const { data: users, loading } = useFetch<Array<{
    id: number; email: string; display_name: string; org_name: string; last_login: string; role: string;
  }>>(`${API}/users`);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left px-4 py-2 text-gray-400">Name</th>
            <th className="text-left px-4 py-2 text-gray-400">Email</th>
            <th className="text-left px-4 py-2 text-gray-400">Organisation</th>
            <th className="text-left px-4 py-2 text-gray-400">Role</th>
            <th className="text-left px-4 py-2 text-gray-400">Last Login</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {(users || []).map(u => (
            <tr key={u.id} className="text-gray-300">
              <td className="px-4 py-2">{u.display_name}</td>
              <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
              <td className="px-4 py-2">{u.org_name}</td>
              <td className="px-4 py-2">{u.role}</td>
              <td className="px-4 py-2">{u.last_login ? new Date(u.last_login).toLocaleDateString() : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(!users || users.length === 0) && (
        <div className="px-4 py-8 text-center text-gray-500">No portal users yet</div>
      )}
    </div>
  );
}

function OrgsPanel() {
  const { data: orgs, loading } = useFetch<Array<{
    id: number; name: string; domain: string | null; user_count: number;
  }>>(`${API}/organisations`);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left px-4 py-2 text-gray-400">Organisation</th>
            <th className="text-left px-4 py-2 text-gray-400">Domain</th>
            <th className="text-left px-4 py-2 text-gray-400">Users</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {(orgs || []).map(o => (
            <tr key={o.id} className="text-gray-300">
              <td className="px-4 py-2">{o.name}</td>
              <td className="px-4 py-2 font-mono text-xs">{o.domain || '-'}</td>
              <td className="px-4 py-2">{o.user_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(!orgs || orgs.length === 0) && (
        <div className="px-4 py-8 text-center text-gray-500">No organisations yet</div>
      )}
    </div>
  );
}

function SessionsPanel() {
  const { data: sessions, loading } = useFetch<Array<{
    id: number; display_name: string; email: string; org_name: string;
    status: string; started_at: string; jira_issue_key: string | null;
  }>>(`${API}/chat-sessions?limit=50`);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700">
            <th className="text-left px-4 py-2 text-gray-400">User</th>
            <th className="text-left px-4 py-2 text-gray-400">Org</th>
            <th className="text-left px-4 py-2 text-gray-400">Status</th>
            <th className="text-left px-4 py-2 text-gray-400">Started</th>
            <th className="text-left px-4 py-2 text-gray-400">Ticket</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-700">
          {(sessions || []).map(s => (
            <tr key={s.id} className="text-gray-300">
              <td className="px-4 py-2">{s.display_name}</td>
              <td className="px-4 py-2">{s.org_name}</td>
              <td className="px-4 py-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  s.status === 'active' ? 'bg-green-900/50 text-green-400' :
                  s.status === 'resolved' ? 'bg-blue-900/50 text-blue-400' :
                  'bg-yellow-900/50 text-yellow-400'
                }`}>
                  {s.status}
                </span>
              </td>
              <td className="px-4 py-2">{new Date(s.started_at).toLocaleString()}</td>
              <td className="px-4 py-2 font-mono">{s.jira_issue_key || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(!sessions || sessions.length === 0) && (
        <div className="px-4 py-8 text-center text-gray-500">No chat sessions yet</div>
      )}
    </div>
  );
}

const KNOWN_PORTAL_SETTINGS: Array<{ key: string; placeholder: string; sensitive?: boolean; group: string }> = [
  { key: 'portal_auth_mode', placeholder: 'internal | oidc', group: 'Authentication' },
  { key: 'portal_oidc_issuer', placeholder: 'https://login.microsoftonline.com/tenant-id/v2.0', group: 'Authentication' },
  { key: 'portal_oidc_client_id', placeholder: 'Application (client) ID', group: 'Authentication' },
  { key: 'portal_oidc_client_secret', placeholder: 'Client secret value', sensitive: true, group: 'Authentication' },
  { key: 'portal_oidc_redirect_uri', placeholder: 'https://nova.nurtur.local/api/portal/auth/callback', group: 'Authentication' },
  { key: 'portal_jira_project_nt', placeholder: 'NT', group: 'Jira' },
  { key: 'portal_widget_brand_color', placeholder: '#1e40af', group: 'Widget' },
  { key: 'portal_widget_greeting', placeholder: 'Hi! How can we help you today?', group: 'Widget' },
];

const KNOWN_KEYS = new Set(KNOWN_PORTAL_SETTINGS.map(s => s.key));

function SettingsPanel() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then(r => r.json())
      .then(d => { if (d.ok) setSettings(d.data || {}); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${API}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  const extraKeys = Object.keys(settings).filter(k => !KNOWN_KEYS.has(k)).sort();

  const renderRow = (key: string, placeholder: string, sensitive?: boolean) => (
    <div key={key} className="flex items-center gap-3">
      <label className="text-xs text-gray-400 w-64 flex-shrink-0 font-mono">{key}</label>
      <input
        type={sensitive ? 'password' : 'text'}
        placeholder={placeholder}
        value={settings[key] || ''}
        onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
        className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
      />
    </div>
  );

  const groups: Array<{ label: string; items: typeof KNOWN_PORTAL_SETTINGS }> = [];
  for (const s of KNOWN_PORTAL_SETTINGS) {
    const existing = groups.find(g => g.label === s.group);
    if (existing) existing.items.push(s);
    else groups.push({ label: s.group, items: [s] });
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-1">
      {groups.map(g => (
        <div key={g.label}>
          <h4 className="text-xs text-gray-500 uppercase tracking-wide mt-4 mb-2">{g.label}</h4>
          <div className="space-y-3">
            {g.items.map(s => renderRow(s.key, s.placeholder, s.sensitive))}
          </div>
        </div>
      ))}

      {extraKeys.length > 0 && (
        <div>
          <h4 className="text-xs text-gray-500 uppercase tracking-wide mt-4 mb-2">Other</h4>
          <div className="space-y-3">
            {extraKeys.map(key => renderRow(key, '', false))}
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
