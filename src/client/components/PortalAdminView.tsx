import React, { useEffect, useState } from 'react';
import type { PortalMetrics, PortalSupportRoute } from '../../shared/portal-types.js';
import { PORTAL_SUPPORT_ROUTE_LABELS, PORTAL_SUPPORT_ROUTE_ORDER, parseSupportRoutes } from '../../shared/portal-types.js';

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

type Tab = 'overview' | 'users' | 'orgs' | 'sessions' | 'settings' | 'about';

export default function PortalAdminView() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Portal Administration</h1>

      <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5">
        {(['overview', 'users', 'orgs', 'sessions', 'settings', 'about'] as Tab[]).map(t => (
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
      {tab === 'about' && <AboutPanel />}
    </div>
  );
}

// ── About / documentation ────────────────────────────────────────────────────

function AboutCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-lg p-5 space-y-2">
      <h2 className="text-sm font-semibold text-white uppercase tracking-wide">{title}</h2>
      <div className="text-sm text-gray-300 space-y-2 leading-relaxed">{children}</div>
    </div>
  );
}

function AboutPanel() {
  const roles: Array<{ name: string; can: string }> = [
    { name: 'Requester', can: 'Raise and track their own tickets. The default for new / self-service users.' },
    { name: 'Leader', can: 'Everything a Requester can, plus view every ticket in their organisation (not just their own).' },
    { name: 'Manager', can: 'Everything a Leader can, plus escalate a ticket (creates a linked Escalation request).' },
    { name: 'Org Admin', can: 'A senior customer contact. Full visibility of the organisation’s tickets.' },
    { name: 'Admin', can: 'Nurtur staff. Full access, including this Portal Administration area.' },
  ];
  const features: Array<{ name: string; desc: string }> = [
    { name: 'Get Help', desc: 'The guided AI chat / intake assistant that helps a customer describe their issue and deflect to KB where possible.' },
    { name: 'Knowledge Base', desc: 'Searchable help articles synced from Confluence.' },
    { name: 'Support', desc: 'The customer Support dashboard — a live view of their open support tickets, scoped to their organisation.' },
    { name: 'Onboarding', desc: 'The customer Onboarding dashboard — progress of their setup / go-live tickets.' },
    { name: 'Raise a Ticket', desc: 'The network intake form. Enables the route selector (Support / Development / Onboarding Request).' },
  ];
  const routes: Array<{ name: string; desc: string }> = [
    { name: 'Raise to Support', desc: 'A standard support request → lands in the NT service desk queue.' },
    { name: 'Triaged for Development', desc: 'A request that needs the dev team → raised and tagged for Tier 3 / Development.' },
    { name: 'Onboarding Request', desc: 'A full new-office / new-agent set-up form. Creates TWO linked tickets: a setup ticket (build the systems) and a QA ticket (test the build). Supports file attachments.' },
  ];

  return (
    <div className="space-y-4">
      <AboutCard title="What the portal is">
        <p>
          The customer portal is the self-service front door for Nurtur’s customers and networks.
          Customers sign in to raise and track tickets, chat with the Get Help assistant, search the
          knowledge base, watch their support &amp; onboarding progress, and — where enabled — submit network and
          onboarding requests that flow straight into Jira.
        </p>
        <p>Everything a customer sees is controlled per organisation from this admin area.</p>
      </AboutCard>

      <AboutCard title="Organisations">
        <p>An <strong>organisation</strong> is a customer tenant. Each portal user has one <strong>home organisation</strong> and can optionally be granted additional ones.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Home organisation</strong> — the org a user lands in. Set when the user is created and changed via <em>Users → Edit</em>.</li>
          <li><strong>Additional organisations</strong> — extra orgs a user can switch into, each with <strong>its own role</strong> (e.g. admin in one, viewer in another). Managed via the <em>Orgs</em> button on a user row. Internal <span className="font-mono">@nurtur.tech</span> staff automatically get read-only access to every org and don’t need these.</li>
          <li><strong>Domain</strong> — an email domain (e.g. <span className="font-mono">acme.co.uk</span>) that maps signed-in users and their tickets to this org.</li>
          <li><strong>BC Account # &amp; Reporters</strong> — the “customer scope”. A ticket belongs to the org if its BC Account matches <em>or</em> its reporter is in the reporter list. This scopes the Support &amp; Onboarding dashboards.</li>
          <li><strong>Branding</strong> — per-org logo, colours and font applied to the portal shell (can be auto-fetched from the org’s website).</li>
        </ul>
        <p className="text-gray-400 text-xs">Add orgs with <em>+ Add organisation</em> on the Orgs tab. Deleting an org shows exactly which users would be removed first (see below).</p>
      </AboutCard>

      <AboutCard title="Roles">
        <p>Roles are cumulative — each includes everything below it.</p>
        <ul className="space-y-1">
          {roles.map(r => (
            <li key={r.name} className="flex gap-2">
              <span className="shrink-0 font-medium text-teal-300 min-w-[90px]">{r.name}</span>
              <span>{r.can}</span>
            </li>
          ))}
        </ul>
        <p className="text-gray-400 text-xs">
          Auth types: <strong>oidc</strong> (Microsoft/Entra SSO), <strong>local</strong> (portal password) and <strong>internal</strong> (Nurtur staff via their NOVA login). Only local users can be lifecycle-managed (password / disable / remove) from here.
        </p>
      </AboutCard>

      <AboutCard title="Portal features (per organisation)">
        <p>Each org’s tabs are toggled independently on the Orgs tab:</p>
        <ul className="space-y-1">
          {features.map(f => (
            <li key={f.name} className="flex gap-2">
              <span className="shrink-0 font-medium text-teal-300 min-w-[130px]">{f.name}</span>
              <span>{f.desc}</span>
            </li>
          ))}
        </ul>
      </AboutCard>

      <AboutCard title="Raise-a-Ticket routes">
        <p>
          When <strong>Raise a Ticket</strong> is enabled, the form shows a route selector at the top. Tick which routes an org gets on the Orgs tab.
          If only one route is enabled the selector is hidden and that route is used automatically; if none are ticked it defaults to <strong>Support only</strong>.
        </p>
        <ul className="space-y-1">
          {routes.map(r => (
            <li key={r.name} className="flex gap-2">
              <span className="shrink-0 font-medium text-teal-300 min-w-[150px]">{r.name}</span>
              <span>{r.desc}</span>
            </li>
          ))}
        </ul>
      </AboutCard>

      <AboutCard title="Onboarding escalations">
        <p>Each org can have a configurable escalation policy (portal → <strong>Escalations</strong>, Org Admin+): a set of day thresholds where NOVA acts if an onboarding isn’t complete.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Progress updates</strong> go automatically to the onboarding’s <strong>requestor</strong> — not a broadcast list.</li>
          <li><strong>Escalations</strong> email the configured internal contacts (with an "also inform" cc list), once per level, deduped and audited.</li>
          <li>Counts in working days, sends only in working hours, and stays off until an admin adds recipients and enables it.</li>
        </ul>
      </AboutCard>

      <AboutCard title="Deleting an organisation">
        <p>Deleting is guarded. The confirmation lists every affected user before anything happens:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Users <strong>homed</strong> in the org are permanently removed, along with their portal data (chat, submissions; CSAT links are unlinked, not deleted).</li>
          <li>Anyone who also belongs to <strong>other organisations</strong> is flagged — move their home org first if you want to keep them.</li>
          <li>Users homed elsewhere who are only <strong>members</strong> keep their accounts and just lose this membership.</li>
        </ul>
        <p className="text-gray-400 text-xs">Jira tickets, Microsoft/Entra identities and NOVA staff logins are never affected — the portal only references them.</p>
      </AboutCard>
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [orgsForUserId, setOrgsForUserId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ display_name: '', role: 'requester', org_id: '', password: '' });
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

  const startEdit = (u: { id: number; display_name: string; role: string; org_id: number }) => {
    setEditingId(u.id);
    setEditForm({ display_name: u.display_name, role: u.role, org_id: String(u.org_id), password: '' });
    setError(null);
  };

  const saveEdit = async (id: number) => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        display_name: editForm.display_name,
        role: editForm.role,
      };
      if (editForm.org_id) body.org_id = Number(editForm.org_id);
      if (editForm.password) body.password = editForm.password;
      const res = await fetch(`${API}/users/${id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to update user');
      setEditingId(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user');
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
              <option value="leader">Leader (view all org tickets)</option>
              <option value="manager">Manager (leader + escalate)</option>
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
              <React.Fragment key={u.id}>
              <tr className="text-gray-300">
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
                  {u.access_state !== 'removed' ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(u)}
                        className="px-2 py-1 rounded bg-gray-700 text-xs text-gray-100 hover:bg-gray-600"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setOrgsForUserId(id => id === u.id ? null : u.id)}
                        className="px-2 py-1 rounded bg-gray-700 text-xs text-gray-100 hover:bg-gray-600"
                      >
                        Orgs
                      </button>
                      {u.auth_type === 'local' && (
                        <>
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
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-500">Removed</span>
                  )}
                </td>
              </tr>
              {editingId === u.id && (
                <tr className="bg-gray-900/60">
                  <td colSpan={8} className="px-4 py-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1 text-xs text-gray-400">
                        Display name
                        <input
                          value={editForm.display_name}
                          onChange={e => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                          className="px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-400">
                        Role
                        <select
                          value={editForm.role}
                          onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}
                          className="px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100"
                        >
                          <option value="requester">Requester</option>
                          <option value="leader">Leader (view all org tickets)</option>
                          <option value="manager">Manager (leader + escalate)</option>
                          <option value="org_admin">Organisation admin</option>
                          <option value="admin">Portal admin</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-gray-400">
                        Organisation
                        <select
                          value={editForm.org_id}
                          onChange={e => setEditForm(f => ({ ...f, org_id: e.target.value }))}
                          className="px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100"
                        >
                          {(orgs || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </label>
                      {u.auth_type === 'local' && (
                        <label className="flex flex-col gap-1 text-xs text-gray-400">
                          New password (optional)
                          <input
                            type="password"
                            value={editForm.password}
                            onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                            placeholder="Leave blank to keep"
                            className="px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100"
                          />
                        </label>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => saveEdit(u.id)}
                          disabled={saving}
                          className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 text-sm rounded bg-gray-700 text-gray-100 hover:bg-gray-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              {orgsForUserId === u.id && (
                <tr className="bg-gray-900/60">
                  <td colSpan={8} className="px-4 py-3">
                    <UserOrgMemberships user={u} orgs={orgs || []} />
                  </td>
                </tr>
              )}
            </React.Fragment>
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

// Extra organisations a user may switch into, on top of their home org. Home org is
// implicit and changed via Edit, not here. Internal staff need no rows — they get
// read-only view-as on every org automatically.
const MEMBERSHIP_ROLES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Same as home' },
  { value: 'requester', label: 'Requester' },
  { value: 'leader', label: 'Leader' },
  { value: 'manager', label: 'Manager' },
  { value: 'org_admin', label: 'Organisation admin' },
  { value: 'admin', label: 'Portal admin' },
];

function UserOrgMemberships({ user, orgs }: {
  user: { id: number; org_name: string; auth_type: 'oidc' | 'local' | 'internal' };
  orgs: Array<{ id: number; name: string }>;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [addOrgId, setAddOrgId] = useState('');
  const [addRole, setAddRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: memberships, loading } = useFetch<Array<{ org_id: number; org_name: string; role: string | null }>>(
    `${API}/users/${user.id}/orgs`,
    [user.id, reloadKey],
  );

  if (user.auth_type === 'internal') {
    return (
      <p className="text-xs text-gray-400">
        Internal staff can already view every organisation (read-only) and don't need memberships.
        Their home organisation is <span className="text-gray-200">{user.org_name}</span>.
      </p>
    );
  }

  const mutate = async (fn: () => Promise<Response>, resetAdd = false) => {
    setBusy(true);
    setError(null);
    try {
      const data = await (await fn()).json();
      if (!data.ok) throw new Error(data.error || 'Failed');
      if (resetAdd) { setAddOrgId(''); setAddRole(''); }
      setReloadKey(k => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  // POST upserts — used to both add a membership and change an existing role.
  const upsert = (orgId: number, role: string, resetAdd = false) => mutate(() => fetch(`${API}/users/${user.id}/orgs`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ org_id: orgId, role: role || undefined }),
  }), resetAdd);

  const remove = (orgId: number) => mutate(() => fetch(`${API}/users/${user.id}/orgs/${orgId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }));

  const granted = new Set((memberships || []).map(m => m.org_id));
  const available = orgs.filter(o => o.name !== user.org_name && !granted.has(o.id));
  const selectCls = 'px-2 py-1 text-xs bg-gray-900 border border-gray-600 rounded text-gray-100';

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Home organisation: <span className="text-gray-200">{user.org_name}</span> (role changed via Edit).
        Additional organisations below can be switched into, each with its own role — so a user can be an admin in one and a viewer in another.
      </p>

      {loading ? (
        <div className="h-6 bg-gray-800 rounded animate-pulse" />
      ) : (memberships || []).length === 0 ? (
        <p className="text-xs text-gray-500">No additional organisations.</p>
      ) : (
        <ul className="space-y-1.5">
          {(memberships || []).map(m => (
            <li key={m.org_id} className="flex items-center gap-2 text-xs text-gray-200">
              <span className="min-w-[180px] truncate">{m.org_name}</span>
              <select
                value={m.role || ''}
                disabled={busy}
                onChange={e => upsert(m.org_id, e.target.value)}
                className={selectCls}
                aria-label={`Role in ${m.org_name}`}
              >
                {MEMBERSHIP_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <button
                onClick={() => remove(m.org_id)}
                disabled={busy}
                aria-label={`Remove ${m.org_name}`}
                className="text-red-300 hover:text-red-200 disabled:opacity-50 text-sm leading-none"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Add organisation
          <select
            value={addOrgId}
            onChange={e => setAddOrgId(e.target.value)}
            className="px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100 min-w-[220px]"
          >
            <option value="">Select…</option>
            {available.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">
          Role
          <select value={addRole} onChange={e => setAddRole(e.target.value)} className="px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-100">
            {MEMBERSHIP_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <button
          onClick={() => upsert(Number(addOrgId), addRole, true)}
          disabled={!addOrgId || busy}
          className="px-3 py-1.5 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function OrgsPanel() {
  const [reloadKey, setReloadKey] = useState(0);
  const { data: orgs, loading } = useFetch<Array<{
    id: number; name: string; domain: string | null; user_count: number;
    bc_account_number: string | null; scope_reporters: string | null;
    feat_get_help: number; feat_kb: number; feat_support: number; feat_onboarding: number; feat_raise_ticket: number;
    support_routes: string | null;
    brand_website_url: string | null; brand_logo_url: string | null;
    brand_primary: string | null; brand_secondary: string | null; brand_font: string | null;
  }>>(`${API}/organisations`, [reloadKey]);

  if (loading) return <div className="animate-pulse h-48 bg-gray-800 rounded-lg" />;

  return (
    <div className="space-y-3">
      <AddOrg onCreated={() => setReloadKey(k => k + 1)} />
      {(orgs || []).map(o => (
        <OrgRow key={o.id} org={o} onSaved={() => setReloadKey(k => k + 1)} />
      ))}
      {(!orgs || orgs.length === 0) && (
        <div className="px-4 py-8 text-center text-gray-500 bg-gray-800 rounded-lg">No organisations yet</div>
      )}
      <p className="px-1 text-xs text-gray-500">
        A ticket belongs to the customer if its <span className="font-mono">BC Account #</span> matches
        <em> or</em> its reporter is in the reporter list. Both scope the customer Onboarding &amp; Support dashboards.
      </p>
    </div>
  );
}

function AddOrg({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organisations`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: name.trim(), domain: domain.trim() || undefined }),
      });
      const d = await res.json();
      if (d.ok) { setName(''); setDomain(''); setOpen(false); onCreated(); }
      else setError(d.error || 'Failed to create organisation');
    } catch {
      setError('Failed to create organisation');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'px-2 py-1 text-xs bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:ring-1 focus:ring-teal-500';

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-500 text-white font-medium">
        + Add organisation
      </button>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 space-y-2">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">New organisation</div>
      {error && <div className="text-xs text-red-300">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Organisation name" className={`${inputCls} flex-1 min-w-[200px]`} />
        <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="Email domain (optional) e.g. acme.co.uk" className={`${inputCls} flex-1 min-w-[200px]`} />
        <button onClick={create} disabled={saving || !name.trim()} className="px-3 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 font-medium">
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button onClick={() => { setOpen(false); setError(null); }} className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200">Cancel</button>
      </div>
    </div>
  );
}

interface DeletionImpact {
  orgName: string;
  homeUsers: Array<{ id: number; email: string; display_name: string; role: string; auth_type: string; other_memberships: number }>;
  memberOnlyCount: number;
}

function DeleteOrgModal({ orgId, orgName, onClose, onDeleted }: {
  orgId: number; orgName: string; onClose: () => void; onDeleted: () => void;
}) {
  const [impact, setImpact] = useState<DeletionImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organisations/${orgId}/deletion-impact`, { headers: authHeaders() });
        const d = await res.json();
        if (cancelled) return;
        if (d.ok) setImpact(d.data);
        else setError(d.error || 'Failed to load impact');
      } catch {
        if (!cancelled) setError('Failed to load impact');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orgId]);

  const homeUsers = impact?.homeUsers ?? [];
  const crossOrg = homeUsers.filter(u => u.other_memberships > 0);

  const doDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      // The admin has seen the full impact list, so force the cascade.
      const res = await fetch(`${API}/organisations/${orgId}?force=1`, { method: 'DELETE', headers: authHeaders() });
      const d = await res.json();
      if (d.ok) { onDeleted(); onClose(); }
      else setError(d.error || 'Failed to delete organisation');
    } catch {
      setError('Failed to delete organisation');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl border border-gray-700 max-w-lg w-full p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-white">Delete “{orgName}”?</h3>

        {loading ? (
          <div className="h-16 bg-gray-900 rounded animate-pulse" />
        ) : (
          <>
            {homeUsers.length === 0 ? (
              <p className="text-sm text-gray-300">No users are homed in this organisation. This removes the organisation and its Jira mapping.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-300">
                  These <strong>{homeUsers.length}</strong> user(s) are homed here and will be <strong className="text-red-300">permanently removed</strong> along with their portal data (chat, submissions; CSAT links unlinked):
                </p>
                <ul className="max-h-48 overflow-y-auto rounded border border-gray-700 divide-y divide-gray-700">
                  {homeUsers.map(u => (
                    <li key={u.id} className="px-3 py-2 text-xs text-gray-200 flex items-center justify-between gap-2">
                      <span className="truncate">
                        {u.display_name} <span className="text-gray-500">({u.email})</span>
                        <span className="ml-1 text-gray-500">· {u.role} · {u.auth_type}</span>
                      </span>
                      {u.other_memberships > 0 && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200 text-[10px] font-medium">
                          also in {u.other_memberships} other org{u.other_memberships === 1 ? '' : 's'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {crossOrg.length > 0 && (
                  <p className="text-xs text-amber-300">
                    ⚠ {crossOrg.length} of these also belong to other organisations. Deleting removes them entirely — to keep them, first move their home org via <strong>Users → Edit</strong>, then delete.
                  </p>
                )}
              </div>
            )}
            {(impact?.memberOnlyCount ?? 0) > 0 && (
              <p className="text-xs text-gray-400">
                {impact!.memberOnlyCount} user(s) homed elsewhere are members of this org — they keep their account and just lose this membership.
              </p>
            )}
          </>
        )}

        {error && <div className="text-xs text-red-300">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} disabled={deleting} className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-100 disabled:opacity-50">Cancel</button>
          <button onClick={doDelete} disabled={loading || deleting} className="px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 font-medium">
            {deleting ? 'Deleting…' : 'Delete organisation'}
          </button>
        </div>
      </div>
    </div>
  );
}

const FEATURE_DEFS: Array<{ key: 'getHelp' | 'kb' | 'support' | 'onboarding' | 'raiseTicket'; label: string }> = [
  { key: 'getHelp', label: 'Get Help' },
  { key: 'kb', label: 'Knowledge Base' },
  { key: 'support', label: 'Support' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'raiseTicket', label: 'Raise a Ticket' },
];

function OrgRow({ org, onSaved }: {
  org: {
    id: number; name: string; domain: string | null; user_count: number;
    bc_account_number: string | null; scope_reporters: string | null;
    feat_get_help: number; feat_kb: number; feat_support: number; feat_onboarding: number; feat_raise_ticket: number;
    support_routes: string | null;
    brand_website_url: string | null; brand_logo_url: string | null;
    brand_primary: string | null; brand_secondary: string | null; brand_font: string | null;
  };
  onSaved: () => void;
}) {
  const [bc, setBc] = useState(org.bc_account_number || '');
  const [reporters, setReporters] = useState(org.scope_reporters || '');
  const [routes, setRoutes] = useState<PortalSupportRoute[]>(parseSupportRoutes(org.support_routes));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [features, setFeatures] = useState({
    getHelp: !!org.feat_get_help, kb: !!org.feat_kb, support: !!org.feat_support, onboarding: !!org.feat_onboarding, raiseTicket: !!org.feat_raise_ticket,
  });
  const [brand, setBrand] = useState({
    websiteUrl: org.brand_website_url || '', logoUrl: org.brand_logo_url || '',
    primary: org.brand_primary || '', secondary: org.brand_secondary || '', font: org.brand_font || '',
  });
  const [fetchingBrand, setFetchingBrand] = useState(false);
  const [saving, setSaving] = useState(false);

  const origFeatures = { getHelp: !!org.feat_get_help, kb: !!org.feat_kb, support: !!org.feat_support, onboarding: !!org.feat_onboarding, raiseTicket: !!org.feat_raise_ticket };
  const origBrand = { websiteUrl: org.brand_website_url || '', logoUrl: org.brand_logo_url || '', primary: org.brand_primary || '', secondary: org.brand_secondary || '', font: org.brand_font || '' };
  const origRoutes = parseSupportRoutes(org.support_routes);
  const toggleRoute = (r: PortalSupportRoute) =>
    setRoutes(prev => prev.includes(r) ? prev.filter(x => x !== r) : PORTAL_SUPPORT_ROUTE_ORDER.filter(x => x === r || prev.includes(x)));
  const dirty =
    (bc.trim() || null) !== (org.bc_account_number || null) ||
    (reporters.trim() || null) !== (org.scope_reporters || null) ||
    routes.join(',') !== origRoutes.join(',') ||
    FEATURE_DEFS.some(f => features[f.key] !== origFeatures[f.key]) ||
    (Object.keys(brand) as Array<keyof typeof brand>).some(k => brand[k] !== origBrand[k]);

  const fetchBranding = async () => {
    if (!brand.websiteUrl.trim()) return;
    setFetchingBrand(true);
    try {
      const res = await fetch(`${API}/branding/fetch`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: brand.websiteUrl.trim() }),
      });
      const d = await res.json();
      if (d.ok) {
        setBrand(prev => ({
          websiteUrl: d.data.websiteUrl || prev.websiteUrl,
          logoUrl: d.data.logoUrl || prev.logoUrl,
          primary: d.data.primary || prev.primary,
          secondary: d.data.secondary || prev.secondary,
          font: d.data.font || prev.font,
        }));
      }
    } catch (err) {
      console.error('Failed to fetch branding:', err);
    } finally {
      setFetchingBrand(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/org-mapping/${org.id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          bc_account_number: bc.trim() || null,
          scope_reporters: reporters.trim() || null,
          features,
          support_routes: routes,
          branding: {
            websiteUrl: brand.websiteUrl.trim() || null,
            logoUrl: brand.logoUrl.trim() || null,
            primary: brand.primary.trim() || null,
            secondary: brand.secondary.trim() || null,
            font: brand.font.trim() || null,
          },
        }),
      });
      const d = await res.json();
      if (d.ok) onSaved();
    } catch (err) {
      console.error('Failed to save org scope:', err);
    } finally {
      setSaving(false);
    }
  };

  const hasBranding = !!(brand.websiteUrl || brand.logoUrl || brand.primary || brand.secondary || brand.font);

  const removeBranding = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/org-mapping/${org.id}`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ branding: { websiteUrl: null, logoUrl: null, primary: null, secondary: null, font: null } }),
      });
      const d = await res.json();
      if (d.ok) { setBrand({ websiteUrl: '', logoUrl: '', primary: '', secondary: '', font: '' }); onSaved(); }
    } catch (err) {
      console.error('Failed to remove branding:', err);
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'px-2 py-1 text-xs bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none focus:ring-1 focus:ring-teal-500';

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-semibold text-white">{org.name}</h3>
          <span className="text-xs font-mono text-gray-500">{org.domain || 'no domain'}</span>
          <span className="text-xs text-gray-500">{org.user_count} user{org.user_count === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete organisation"
            className="px-3 py-1.5 text-xs rounded bg-red-900/50 hover:bg-red-900/70 text-red-200 font-medium"
          >
            Delete
          </button>
        </div>
      </div>

      {confirmDelete && (
        <DeleteOrgModal orgId={org.id} orgName={org.name} onClose={() => setConfirmDelete(false)} onDeleted={onSaved} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Customer scope */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Customer scope</div>
          <input value={bc} onChange={e => setBc(e.target.value)} placeholder="BC Account # e.g. CU0002362" className={`w-full font-mono ${inputCls}`} />
          <textarea value={reporters} onChange={e => setReporters(e.target.value)} rows={3} placeholder="Reporters (one per line): email, display name, or account id" className={`w-full ${inputCls}`} />
        </div>

        {/* Features */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Portal features</div>
          {FEATURE_DEFS.map(f => (
            <label key={f.key} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={features[f.key]} onChange={e => setFeatures(prev => ({ ...prev, [f.key]: e.target.checked }))} className="rounded border-gray-600 bg-gray-900 text-teal-500 focus:ring-teal-500" />
              {f.label}
            </label>
          ))}
          <div className={`pt-2 space-y-1 ${features.raiseTicket ? '' : 'opacity-50'}`}>
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Raise-a-Ticket routes</div>
            {PORTAL_SUPPORT_ROUTE_ORDER.map(r => (
              <label key={r} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" checked={routes.includes(r)} onChange={() => toggleRoute(r)} className="rounded border-gray-600 bg-gray-900 text-teal-500 focus:ring-teal-500" />
                {PORTAL_SUPPORT_ROUTE_LABELS[r]}
              </label>
            ))}
            <p className="text-[10px] text-gray-500">
              {features.raiseTicket
                ? 'One route → selector hidden. None ticked → Support only.'
                : 'Applies when “Raise a Ticket” is enabled. None ticked → Support only.'}
            </p>
          </div>
        </div>

        {/* Branding */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Branding</div>
          <div className="flex gap-1">
            <input value={brand.websiteUrl} onChange={e => setBrand(p => ({ ...p, websiteUrl: e.target.value }))} placeholder="Website URL" className={`flex-1 ${inputCls}`} />
            <button onClick={fetchBranding} disabled={fetchingBrand || !brand.websiteUrl.trim()} title="Fetch branding from website" className="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-100 disabled:opacity-50 whitespace-nowrap">
              {fetchingBrand ? '…' : 'Fetch'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {brand.logoUrl
              ? <img src={brand.logoUrl} alt="logo" className="h-6 max-w-[64px] object-contain bg-white rounded px-1" />
              : <span className="text-xs text-gray-500">no logo</span>}
            <input value={brand.logoUrl.startsWith('data:') ? '' : brand.logoUrl} onChange={e => setBrand(p => ({ ...p, logoUrl: e.target.value }))} placeholder={brand.logoUrl.startsWith('data:') ? '(embedded image)' : 'Logo URL'} className={`flex-1 ${inputCls}`} />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input type="color" value={brand.primary || '#5ec1ca'} onChange={e => setBrand(p => ({ ...p, primary: e.target.value }))} className="w-6 h-6 bg-transparent border border-gray-600 rounded" />
              Primary
            </label>
            <label className="flex items-center gap-1 text-xs text-gray-400">
              <input type="color" value={brand.secondary || '#4ba8b0'} onChange={e => setBrand(p => ({ ...p, secondary: e.target.value }))} className="w-6 h-6 bg-transparent border border-gray-600 rounded" />
              Secondary
            </label>
          </div>
          <input value={brand.font} onChange={e => setBrand(p => ({ ...p, font: e.target.value }))} placeholder="Font (e.g. Inter)" className={`w-full ${inputCls}`} />
          {hasBranding && (
            <button onClick={removeBranding} disabled={saving} className="px-2 py-1 text-xs rounded bg-red-900/50 hover:bg-red-900/70 text-red-200 disabled:opacity-50">
              Remove branding
            </button>
          )}
        </div>
      </div>
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
