import React, { useEffect, useState } from 'react';

const pf = (window as any).__portalFetch as (path: string, opts?: RequestInit) => Promise<Response>;

interface OrgUser {
  id: number;
  email: string;
  display_name: string;
  role: string;
  auth_type: string;
  access_state: string;
  include_in_setup: number;
}

const ROLES = [
  { value: 'requester', label: 'Requester' },
  { value: 'leader', label: 'Leader' },
  { value: 'manager', label: 'Manager' },
  { value: 'org_admin', label: 'Organisation admin' },
  { value: 'admin', label: 'Admin' },
];

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand text-sm';

export default function PortalOrgUsers() {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState({ email: '', display_name: '', role: 'leader', include_in_setup: true });

  const load = async () => {
    try {
      const res = await pf('/api/portal/org-users');
      const d = await res.json();
      if (d.ok) setUsers(d.data);
      else setError(d.error || 'Failed to load users');
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await pf('/api/portal/org-users', { method: 'POST', body: JSON.stringify(body) });
      const d = await res.json();
      if (!d.ok) { setError(d.error || 'Failed to save'); return false; }
      await load();
      return true;
    } catch {
      setError('Failed to save');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const updateUser = (u: OrgUser, patch: Partial<OrgUser>) =>
    save({ email: u.email, display_name: patch.display_name ?? u.display_name, role: patch.role ?? u.role, include_in_setup: (patch.include_in_setup ?? u.include_in_setup) ? true : false });

  const remove = async (u: OrgUser) => {
    if (!window.confirm(`Remove ${u.display_name || u.email} from this organisation's portal?`)) return;
    setBusy(true);
    try {
      const res = await pf(`/api/portal/org-users/${u.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!d.ok) setError(d.error || 'Failed to remove');
      else await load();
    } finally {
      setBusy(false);
    }
  };

  const addUser = async () => {
    if (!add.email.trim()) { setError('Email is required'); return; }
    const ok = await save({ ...add });
    if (ok) setAdd({ email: '', display_name: '', role: 'leader', include_in_setup: true });
  };

  if (loading) return <div className="max-w-4xl mx-auto animate-pulse h-64 bg-gray-100 rounded-xl" />;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Users</h1>
        <p className="text-sm text-gray-600">
          Your organisation's portal users. Tick <strong>Include in setup</strong> to auto-add someone (e.g. head-office
          contacts) whenever a new office is set up via an Onboarding Request.
        </p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium text-center">Include in setup</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id}>
                <td className="px-4 py-2 text-gray-900">{u.display_name || '—'}</td>
                <td className="px-4 py-2 text-gray-600">{u.email}</td>
                <td className="px-4 py-2">
                  <select value={u.role} disabled={busy} onChange={e => updateUser(u, { role: e.target.value })} className="px-2 py-1 border border-gray-300 rounded-md text-sm">
                    {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2 text-center">
                  <input type="checkbox" checked={!!u.include_in_setup} disabled={busy} onChange={e => updateUser(u, { include_in_setup: e.target.checked ? 1 : 0 })} className="rounded border-gray-300 text-brand focus:ring-brand" />
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => remove(u)} disabled={busy} className="text-red-500 hover:text-red-600 text-xs disabled:opacity-50">Remove</button>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Add a user</h2>
        <div className="flex flex-wrap items-end gap-3">
          <input className={`${inputCls} flex-1 min-w-[200px]`} placeholder="Email" value={add.email} onChange={e => setAdd(a => ({ ...a, email: e.target.value }))} />
          <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder="Name" value={add.display_name} onChange={e => setAdd(a => ({ ...a, display_name: e.target.value }))} />
          <select className={inputCls} value={add.role} onChange={e => setAdd(a => ({ ...a, role: e.target.value }))}>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={add.include_in_setup} onChange={e => setAdd(a => ({ ...a, include_in_setup: e.target.checked }))} className="rounded border-gray-300 text-brand focus:ring-brand" />
            Include in setup
          </label>
          <button onClick={addUser} disabled={busy || !add.email.trim()} className="px-5 py-2 bg-brand text-white font-medium rounded-lg hover:bg-brand-dark disabled:opacity-50">
            {busy ? 'Saving…' : 'Add user'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Adding a user gives them portal access and lists them in the NOVA admin — the two stay in sync.</p>
      </div>
    </div>
  );
}
