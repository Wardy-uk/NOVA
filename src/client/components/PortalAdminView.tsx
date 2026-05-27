import React, { useEffect, useState } from 'react';
import type { PortalMetrics } from '../../shared/portal-types.js';

const API = '/api/portal/admin';

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem('nova_auth_token') || sessionStorage.getItem('nova_auth_token') || '';
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function useFetch<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(path, { headers: authHeaders() })
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

interface KbDeflectionTarget {
  currentRate: number;
  targetMin: number;
  targetMax: number;
  status: 'below_target' | 'within_target' | 'above_target';
  sampleSize: number;
  periodDays: number;
}

const STATUS_STYLE: Record<KbDeflectionTarget['status'], { label: string; color: string; bg: string }> = {
  below_target: { label: 'Below Target', color: 'text-red-400', bg: 'bg-red-900/30' },
  within_target: { label: 'Within Target', color: 'text-green-400', bg: 'bg-green-900/30' },
  above_target: { label: 'Above Target', color: 'text-amber-400', bg: 'bg-amber-900/30' },
};

function MetricsPanel() {
  const { data: metrics, loading } = useFetch<PortalMetrics>(`${API}/metrics`);
  const { data: eventCounts } = useFetch<Record<string, number>>(`${API}/event-counts?days=30`);
  const { data: deflTarget } = useFetch<KbDeflectionTarget>(`${API}/kb-deflection-target?days=30`);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  const otherCards = metrics ? [
    { label: 'Chat Resolution', value: `${metrics.chatResolutionRate}%`, target: '20%' },
    { label: 'Form Completion', value: `${metrics.formCompletionRate}%`, target: '80%' },
    { label: 'KB Search Success', value: `${metrics.kbSearchSuccessRate}%`, target: '50%' },
    { label: 'Article Helpfulness', value: `${metrics.articleHelpfulness}%`, target: '70%' },
    { label: 'Portal Adoption', value: `${metrics.portalAdoption}%`, target: 'Trending up' },
  ] : [];

  const ds = deflTarget ? STATUS_STYLE[deflTarget.status] : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {deflTarget && ds ? (
          <div className={`bg-gray-800 rounded-lg p-4 border border-gray-700 ${ds.bg}`}>
            <div className="text-xs text-gray-400 uppercase tracking-wider">KB Deflection Rate</div>
            <div className="text-2xl font-bold text-white mt-1">{deflTarget.currentRate}%</div>
            <div className="text-xs text-gray-500 mt-1">
              Target: {deflTarget.targetMin}% – {deflTarget.targetMax}%
            </div>
            <span className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded ${ds.color} ${ds.bg}`}>
              {ds.label}
            </span>
            <div className="text-xs text-gray-600 mt-1">{deflTarget.sampleSize} events · {deflTarget.periodDays}d</div>
          </div>
        ) : metrics ? (
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-xs text-gray-400 uppercase tracking-wider">Deflection Rate</div>
            <div className="text-2xl font-bold text-white mt-1">{metrics.deflectionRate}%</div>
            <div className="text-xs text-gray-500 mt-1">Target: 30%</div>
          </div>
        ) : null}

        {otherCards.map(c => (
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
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: '',
    display_name: '',
    password: '',
    role: 'requester',
    org_id: '',
    create_org: false,
    organisation_name: '',
    organisation_domain: '',
  });
  const { data: users, loading } = useFetch<Array<{
    id: number;
    email: string;
    display_name: string;
    org_id: number;
    org_name: string;
    last_login: string;
    role: string;
    auth_type: 'oidc' | 'local' | 'internal';
    access_state: 'active' | 'disabled' | 'removed';
  }>>(`${API}/users`, [reloadKey]);
  const { data: orgs } = useFetch<Array<{ id: number; name: string; domain: string | null }>>(`${API}/organisations`, [reloadKey]);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  const refresh = () => setReloadKey(k => k + 1);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = form.create_org
        ? {
            email: form.email,
            display_name: form.display_name,
            password: form.password,
            role: form.role,
            organisation_name: form.organisation_name,
            organisation_domain: form.organisation_domain,
          }
        : {
            email: form.email,
            display_name: form.display_name,
            password: form.password,
            role: form.role,
            org_id: form.org_id ? Number(form.org_id) : null,
          };
      const res = await fetch(`${API}/users`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to create user');
      setForm({
        email: '',
        display_name: '',
        password: '',
        role: 'requester',
        org_id: '',
        create_org: false,
        organisation_name: '',
        organisation_domain: '',
      });
      setCreating(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  const changeAccess = async (id: number, access_state: 'active' | 'disabled') => {
    setError(null);
    try {
      const res = await fetch(`${API}/users/${id}/access`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ access_state }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to update access');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update access');
    }
  };

  const removeUser = async (id: number) => {
    setError(null);
    try {
      const res = await fetch(`${API}/users/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to remove user');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove user');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Portal users</h3>
          <p className="text-xs text-gray-400 mt-1">Create and manage local portal access without changing Ecosystem or NOVA sign-in.</p>
        </div>
        <button
          onClick={() => setCreating(v => !v)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          {creating ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {creating && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={form.display_name}
              onChange={e => setForm(prev => ({ ...prev, display_name: e.target.value }))}
              placeholder="Display name"
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
            />
            <input
              value={form.email}
              onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
              placeholder="Email address"
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
            />
            <input
              value={form.password}
              onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))}
              placeholder="Initial password"
              type="password"
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
            />
            <select
              value={form.role}
              onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
            >
              <option value="requester">Requester</option>
              <option value="org_admin">Organisation admin</option>
              <option value="admin">Portal admin</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.create_org}
              onChange={e => setForm(prev => ({ ...prev, create_org: e.target.checked }))}
            />
            Create a new organisation for this user
          </label>

          {form.create_org ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                value={form.organisation_name}
                onChange={e => setForm(prev => ({ ...prev, organisation_name: e.target.value }))}
                placeholder="Organisation name"
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
              />
              <input
                value={form.organisation_domain}
                onChange={e => setForm(prev => ({ ...prev, organisation_domain: e.target.value }))}
                placeholder="Organisation domain (optional)"
                className="px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
              />
            </div>
          ) : (
            <select
              value={form.org_id}
              onChange={e => setForm(prev => ({ ...prev, org_id: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm text-gray-100"
            >
              <option value="">Select organisation</option>
              {(orgs || []).map(org => (
                <option key={org.id} value={String(org.id)}>
                  {org.name}{org.domain ? ` (${org.domain})` : ''}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">Local users sign in with their email address and the password set here.</p>
            <button
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create portal user'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded bg-red-900/40 border border-red-800 text-sm text-red-200">{error}</div>
      )}

      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left px-4 py-2 text-gray-400">Name</th>
              <th className="text-left px-4 py-2 text-gray-400">Email</th>
              <th className="text-left px-4 py-2 text-gray-400">Organisation</th>
              <th className="text-left px-4 py-2 text-gray-400">Auth</th>
              <th className="text-left px-4 py-2 text-gray-400">Access</th>
              <th className="text-left px-4 py-2 text-gray-400">Role</th>
              <th className="text-left px-4 py-2 text-gray-400">Last Login</th>
              <th className="text-left px-4 py-2 text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {(users || []).map(u => (
              <tr key={u.id} className="text-gray-300">
                <td className="px-4 py-2">{u.display_name}</td>
                <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-2">{u.org_name}</td>
                <td className="px-4 py-2">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-gray-700 text-gray-200 uppercase">
                    {u.auth_type}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${
                    u.access_state === 'active'
                      ? 'bg-emerald-900/40 text-emerald-300'
                      : u.access_state === 'disabled'
                        ? 'bg-amber-900/40 text-amber-300'
                        : 'bg-red-900/40 text-red-300'
                  }`}>
                    {u.access_state}
                  </span>
                </td>
                <td className="px-4 py-2">{u.role}</td>
                <td className="px-4 py-2">{u.last_login ? new Date(u.last_login).toLocaleDateString() : '-'}</td>
                <td className="px-4 py-2">
                  {u.auth_type === 'local' && u.access_state !== 'removed' ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => changeAccess(u.id, u.access_state === 'disabled' ? 'active' : 'disabled')}
                        className="px-2 py-1 rounded bg-gray-700 text-xs text-gray-100 hover:bg-gray-600"
                      >
                        {u.access_state === 'disabled' ? 'Re-enable' : 'Disable'}
                      </button>
                      <button
                        onClick={() => removeUser(u.id)}
                        className="px-2 py-1 rounded bg-red-900/50 text-xs text-red-200 hover:bg-red-900/70"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">
                      {u.auth_type === 'local' ? 'Removed' : 'Managed by existing auth'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!users || users.length === 0) && (
          <div className="px-4 py-8 text-center text-gray-500">No portal users yet</div>
        )}
      </div>
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
  // Authentication
  { key: 'portal_auth_mode', placeholder: 'internal | oidc', group: 'Authentication' },
  { key: 'portal_oidc_issuer', placeholder: 'https://identity.nurtur.com', group: 'Authentication' },
  { key: 'portal_oidc_client_id', placeholder: 'Application client ID', group: 'Authentication' },
  { key: 'portal_oidc_client_secret', placeholder: 'Client secret', sensitive: true, group: 'Authentication' },
  { key: 'portal_oidc_redirect_uri', placeholder: 'https://nova.nurtur.local/api/portal/auth/callback', group: 'Authentication' },
  // General
  { key: 'portal_enabled', placeholder: 'true | false', group: 'General' },
  { key: 'portal_announcement_html', placeholder: 'HTML for announcement banner', group: 'General' },
  // Jira
  { key: 'portal_jira_project_nt', placeholder: 'NT', group: 'Jira' },
  { key: 'portal_jira_project_ntpj', placeholder: 'NTPJ', group: 'Jira' },
  // Chat
  { key: 'portal_chat_max_exchanges', placeholder: '10', group: 'Chat' },
  { key: 'portal_chat_handoff_threshold', placeholder: '3', group: 'Chat' },
  // Widget
  { key: 'portal_widget_enabled', placeholder: 'true | false', group: 'Widget' },
  { key: 'portal_widget_allowed_origins', placeholder: 'https://app1.nurtur.com,https://app2.nurtur.com', group: 'Widget' },
  { key: 'portal_widget_greeting', placeholder: 'Hi! How can we help you today?', group: 'Widget' },
  { key: 'portal_widget_brand_color', placeholder: '#1e40af', group: 'Widget' },
  // KB
  { key: 'portal_kb_sync_interval_minutes', placeholder: '30', group: 'KB' },
];

const KNOWN_KEYS = new Set(KNOWN_PORTAL_SETTINGS.map(s => s.key));

function SettingsPanel() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API}/settings`, { headers: authHeaders() })
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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
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
