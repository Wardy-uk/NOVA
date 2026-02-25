import { useState, useEffect, useCallback } from 'react';
import { OnboardingConfigView } from './OnboardingConfigView.js';

interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string;
  team_id: number | null;
  auth_provider: string;
  created_at: string;
}

interface Team {
  id: number;
  name: string;
  description: string | null;
}

type Tab = 'users' | 'teams' | 'milestones' | 'ai-keys' | 'integrations' | 'onboarding';

interface MilestoneTemplate {
  id: number;
  name: string;
  day_offset: number;
  sort_order: number;
  checklist_json: string;
  active: number;
}

interface SaleType {
  id: number;
  name: string;
  sort_order: number;
  active: number;
}

interface MatrixOffset {
  sale_type_id: number;
  template_id: number;
  day_offset: number;
}

interface IntegrationConfig {
  id: string;
  name: string;
  fields: Array<{ key: string; label: string; type: string; placeholder?: string; required: boolean }>;
  values: Record<string, string>;
  enabled: boolean;
}

const ROLES = ['admin', 'editor', 'viewer'] as const;

export function AdminView() {
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // AI key state
  const [globalKeyInfo, setGlobalKeyInfo] = useState<{ masked: string; hasKey: boolean }>({ masked: '', hasKey: false });
  const [newGlobalKey, setNewGlobalKey] = useState('');

  // Integration config state
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [integValues, setIntegValues] = useState<Record<string, Record<string, string>>>({});
  const [integSaving, setIntegSaving] = useState<string | null>(null);

  // Milestone template state
  const [milestoneTemplates, setMilestoneTemplates] = useState<MilestoneTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<MilestoneTemplate | null>(null);
  const [newTemplate, setNewTemplate] = useState({ name: '', day_offset: '0', sort_order: '0' });
  const [showAddTemplate, setShowAddTemplate] = useState(false);

  // Milestone matrix state
  const [saleTypes, setSaleTypes] = useState<SaleType[]>([]);
  const [matrixOffsets, setMatrixOffsets] = useState<MatrixOffset[]>([]);
  const [matrixEdits, setMatrixEdits] = useState<Map<string, number>>(new Map());
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [selectedSaleTypeId, setSelectedSaleTypeId] = useState<number | null>(null);

  // Team form
  const [newTeamName, setNewTeamName] = useState('');

  // Add User form
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', password: '', display_name: '', email: '', role: 'viewer' });

  const clearMessages = () => { setError(null); setSuccess(null); };

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      const json = await res.json();
      if (json.ok) {
        setUsers(json.data.users);
        setTeams(json.data.teams);
      } else {
        setError(json.error || 'Failed to load users');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    }
    setLoading(false);
  }, []);

  const fetchAiKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai-keys');
      const json = await res.json();
      if (json.ok) {
        setGlobalKeyInfo({ masked: json.data.globalKey, hasKey: json.data.hasGlobalKey });
      }
    } catch { /* ignore */ }
  }, []);

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations');
      const json = await res.json();
      if (json.ok) {
        const withFields = (json.data as IntegrationConfig[]).filter(i => i.fields.length > 0);
        setIntegrations(withFields);
        const vals: Record<string, Record<string, string>> = {};
        for (const integ of withFields) {
          vals[integ.id] = { ...integ.values };
        }
        setIntegValues(vals);
      }
    } catch { /* ignore */ }
  }, []);

  const saveIntegConfig = async (integId: string) => {
    clearMessages();
    setIntegSaving(integId);
    try {
      const integ = integrations.find(i => i.id === integId);
      if (!integ) return;
      const res = await fetch(`/api/integrations/${integId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: integ.enabled,
          credentials: integValues[integId] ?? {},
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess(`${integ.name} configuration saved`);
        fetchIntegrations();
      } else {
        setError(json.error || 'Save failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIntegSaving(null);
    }
  };

  const fetchMilestones = useCallback(async () => {
    try {
      const res = await fetch('/api/milestones/templates');
      const json = await res.json();
      if (json.ok) setMilestoneTemplates(json.data);
    } catch { /* ignore */ }
  }, []);

  const fetchSaleTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding/config/sale-types');
      const json = await res.json();
      if (json.ok) setSaleTypes(json.data);
    } catch { /* ignore */ }
  }, []);

  const fetchMatrixOffsets = useCallback(async () => {
    try {
      const res = await fetch('/api/milestones/matrix');
      const json = await res.json();
      if (json.ok) setMatrixOffsets(json.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchData(); fetchAiKeys(); fetchIntegrations(); fetchMilestones(); fetchSaleTypes(); fetchMatrixOffsets(); }, [fetchData, fetchAiKeys, fetchIntegrations, fetchMilestones, fetchSaleTypes, fetchMatrixOffsets]);

  const updateUser = async (id: number, updates: Record<string, unknown>) => {
    clearMessages();
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess('User updated');
        fetchData();
      } else {
        setError(json.error || 'Update failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const deleteUser = async (id: number, username: string) => {
    clearMessages();
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setSuccess(`User "${username}" deleted`);
        fetchData();
      } else {
        setError(json.error || 'Delete failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const createUser = async () => {
    clearMessages();
    if (!newUser.username.trim() || !newUser.password) return;
    if (newUser.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess('User created');
        setNewUser({ username: '', password: '', display_name: '', email: '', role: 'viewer' });
        setShowAddUser(false);
        fetchData();
      } else {
        setError(json.error || 'Create failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const resetPassword = async (id: number, username: string) => {
    clearMessages();
    const password = prompt(`Enter new password for "${username}" (min 6 chars):`);
    if (!password) return;
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    try {
      const res = await fetch(`/api/admin/users/${id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.ok) setSuccess(`Password reset for "${username}"`);
      else setError(json.error || 'Reset failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  const createTeam = async () => {
    clearMessages();
    if (!newTeamName.trim()) return;
    try {
      const res = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess('Team created');
        setNewTeamName('');
        fetchData();
      } else {
        setError(json.error || 'Create failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const deleteTeam = async (id: number, name: string) => {
    clearMessages();
    if (!confirm(`Delete team "${name}"? Users in this team will be unassigned.`)) return;
    try {
      const res = await fetch(`/api/admin/teams/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) { setSuccess(`Team "${name}" deleted`); fetchData(); }
      else setError(json.error || 'Delete failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  // ── Milestone matrix helpers ──

  const getMatrixValue = (saleTypeId: number, templateId: number): number | null => {
    const editKey = `${saleTypeId}:${templateId}`;
    if (matrixEdits.has(editKey)) return matrixEdits.get(editKey)!;
    const existing = matrixOffsets.find(o => o.sale_type_id === saleTypeId && o.template_id === templateId);
    return existing ? existing.day_offset : null;
  };

  const setMatrixValue = (saleTypeId: number, templateId: number, value: number) => {
    setMatrixEdits(prev => {
      const next = new Map(prev);
      next.set(`${saleTypeId}:${templateId}`, value);
      return next;
    });
    setMatrixDirty(true);
  };

  const saveMatrix = async () => {
    if (matrixEdits.size === 0) return;
    setMatrixSaving(true);
    clearMessages();
    const updates: Array<{ sale_type_id: number; template_id: number; day_offset: number }> = [];
    for (const [key, dayOffset] of matrixEdits) {
      const [stId, tId] = key.split(':').map(Number);
      updates.push({ sale_type_id: stId, template_id: tId, day_offset: dayOffset });
    }
    try {
      const res = await fetch('/api/milestones/matrix', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const json = await res.json();
      if (json.ok) {
        setMatrixOffsets(json.data);
        setMatrixEdits(new Map());
        setMatrixDirty(false);
        setSuccess('Matrix saved');
      } else {
        setError(json.error || 'Save failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
    setMatrixSaving(false);
  };

  const addSaleTypeToMatrix = async () => {
    if (!selectedSaleTypeId) return;
    clearMessages();
    // Pre-populate with template defaults
    const updates: Array<{ sale_type_id: number; template_id: number; day_offset: number }> = [];
    const activeTemplates = milestoneTemplates.filter(t => t.active);
    for (const tmpl of activeTemplates) {
      updates.push({ sale_type_id: selectedSaleTypeId, template_id: tmpl.id, day_offset: tmpl.day_offset });
    }
    try {
      const res = await fetch('/api/milestones/matrix', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const json = await res.json();
      if (json.ok) {
        setMatrixOffsets(json.data);
        setSuccess('Sale type added to matrix');
      } else {
        setError(json.error || 'Failed to add sale type');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add sale type');
    }
    setSelectedSaleTypeId(null);
  };

  const removeSaleTypeFromMatrix = async (stId: number) => {
    if (!confirm('Remove this sale type from the milestone matrix?')) return;
    try {
      const res = await fetch(`/api/milestones/matrix/${stId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) {
        setMatrixOffsets(prev => prev.filter(o => o.sale_type_id !== stId));
        setSuccess('Sale type removed from matrix');
      }
    } catch { /* ignore */ }
  };

  const createMilestoneTemplate = async () => {
    clearMessages();
    if (!newTemplate.name.trim()) return;
    try {
      const res = await fetch('/api/milestones/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTemplate.name.trim(),
          day_offset: parseInt(newTemplate.day_offset, 10) || 0,
          sort_order: parseInt(newTemplate.sort_order, 10) || 0,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess('Milestone template created');
        setNewTemplate({ name: '', day_offset: '0', sort_order: '0' });
        setShowAddTemplate(false);
        fetchMilestones();
      } else {
        setError(json.error || 'Create failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const updateMilestoneTemplate = async (id: number, updates: Record<string, unknown>) => {
    clearMessages();
    try {
      const res = await fetch(`/api/milestones/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess('Template updated');
        setEditingTemplate(null);
        fetchMilestones();
      } else {
        setError(json.error || 'Update failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const deleteMilestoneTemplate = async (id: number, name: string) => {
    clearMessages();
    if (!confirm(`Delete milestone template "${name}"?`)) return;
    try {
      const res = await fetch(`/api/milestones/templates/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.ok) { setSuccess(`Template "${name}" deleted`); fetchMilestones(); }
      else setError(json.error || 'Delete failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const saveGlobalKey = async () => {
    clearMessages();
    if (!newGlobalKey.trim()) return;
    try {
      const res = await fetch('/api/admin/ai-keys/global', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newGlobalKey.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        setSuccess('Global AI key updated');
        setNewGlobalKey('');
        fetchAiKeys();
      } else {
        setError(json.error || 'Save failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border-2 border-[#5ec1ca] border-t-transparent rounded-full animate-spin" />
        <span className="ml-3 text-sm text-neutral-400">Loading admin panel...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold font-[var(--font-heading)] text-neutral-100">
        Admin
      </h2>

      {/* Messages */}
      {error && (
        <div className="p-3 bg-red-950/50 border border-red-900 rounded text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-950/50 border border-green-900 rounded text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2">
        {([['users', 'Users'], ['teams', 'Teams'], ['milestones', 'Milestones'], ['onboarding', 'Onboarding'], ['ai-keys', 'AI Keys'], ['integrations', 'Integrations']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setTab(key); clearMessages(); }}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              tab === key
                ? 'bg-[#5ec1ca] text-[#272C33] font-semibold'
                : 'bg-[#2f353d] text-neutral-400 hover:bg-[#363d47] hover:text-neutral-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="space-y-4">
          {/* Add User toggle + form */}
          <div className="flex items-center">
            <button
              onClick={() => { setShowAddUser(true); setNewUser({ username: '', password: '', display_name: '', email: '', role: 'viewer' }); }}
              className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-sm hover:bg-[#4db0b9] transition-colors"
            >
              + Add User
            </button>
          </div>
          {showAddUser && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddUser(false)}>
              <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-sm font-semibold text-neutral-100 mb-4">Add User</h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Username <span className="text-red-500">*</span></label>
                    <input type="text" placeholder="Username" value={newUser.username}
                      onChange={(e) => setNewUser(u => ({ ...u, username: e.target.value }))}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Password <span className="text-red-500">*</span></label>
                    <input type="password" placeholder="Min 6 characters" value={newUser.password}
                      onChange={(e) => setNewUser(u => ({ ...u, password: e.target.value }))}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Display Name</label>
                    <input type="text" placeholder="Display Name" value={newUser.display_name}
                      onChange={(e) => setNewUser(u => ({ ...u, display_name: e.target.value }))}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Email</label>
                    <input type="email" placeholder="Email" value={newUser.email}
                      onChange={(e) => setNewUser(u => ({ ...u, email: e.target.value }))}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600" />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Role</label>
                    <select value={newUser.role}
                      onChange={(e) => setNewUser(u => ({ ...u, role: e.target.value }))}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca]">
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-5">
                  <button onClick={() => setShowAddUser(false)}
                    className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                    Cancel
                  </button>
                  <button onClick={createUser} disabled={!newUser.username.trim() || !newUser.password}
                    className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-sm hover:bg-[#4db0b9] transition-colors disabled:opacity-40">
                    Create User
                  </button>
                </div>
              </div>
            </div>
          )}

        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#3a424d] text-xs text-neutral-500 uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Team</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-[#3a424d]/50 hover:bg-[#363d47] transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-neutral-200">{user.display_name || user.username}</div>
                    <div className="text-[10px] text-neutral-500">@{user.username}</div>
                  </td>
                  <td className="px-4 py-3 text-neutral-400">{user.email || '-'}</td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateUser(user.id, { role: e.target.value })}
                      className="bg-[#272C33] text-neutral-300 text-xs rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.team_id ?? ''}
                      onChange={(e) => updateUser(user.id, { team_id: e.target.value ? parseInt(e.target.value) : null })}
                      className="bg-[#272C33] text-neutral-300 text-xs rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca]"
                    >
                      <option value="">No team</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => resetPassword(user.id, user.username)}
                        className="px-2 py-1 text-[10px] rounded bg-[#272C33] text-neutral-400 hover:text-amber-400 transition-colors"
                        title="Reset password"
                      >
                        Reset PW
                      </button>
                      <button
                        onClick={() => deleteUser(user.id, user.username)}
                        className="px-2 py-1 text-[10px] rounded bg-[#272C33] text-neutral-400 hover:text-red-400 transition-colors"
                        title="Delete user"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="text-center py-8 text-sm text-neutral-500">No users found</div>
          )}
        </div>
        </div>
      )}

      {/* Teams Tab */}
      {tab === 'teams' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="New team name..."
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createTeam()}
              className="bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors flex-1 placeholder:text-neutral-600"
            />
            <button
              onClick={createTeam}
              disabled={!newTeamName.trim()}
              className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-sm hover:bg-[#4db0b9] transition-colors disabled:opacity-40"
            >
              Create Team
            </button>
          </div>
          <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#3a424d] text-xs text-neutral-500 uppercase tracking-wider">
                  <th className="text-left px-4 py-3">Team</th>
                  <th className="text-left px-4 py-3">Members</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const memberCount = users.filter((u) => u.team_id === team.id).length;
                  return (
                    <tr key={team.id} className="border-b border-[#3a424d]/50 hover:bg-[#363d47] transition-colors">
                      <td className="px-4 py-3 text-neutral-200">{team.name}</td>
                      <td className="px-4 py-3 text-neutral-400">{memberCount} member{memberCount !== 1 ? 's' : ''}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => deleteTeam(team.id, team.name)}
                          className="px-2 py-1 text-[10px] rounded bg-[#272C33] text-neutral-400 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {teams.length === 0 && (
              <div className="text-center py-8 text-sm text-neutral-500">No teams yet. Create one above.</div>
            )}
          </div>
        </div>
      )}

      {/* Milestones Tab */}
      {tab === 'milestones' && (
        <MilestonesTab
          milestoneTemplates={milestoneTemplates}
          saleTypes={saleTypes}
          matrixOffsets={matrixOffsets}
          matrixEdits={matrixEdits}
          matrixDirty={matrixDirty}
          matrixSaving={matrixSaving}
          editingTemplate={editingTemplate}
          showAddTemplate={showAddTemplate}
          newTemplate={newTemplate}
          selectedSaleTypeId={selectedSaleTypeId}
          getMatrixValue={getMatrixValue}
          setMatrixValue={setMatrixValue}
          saveMatrix={saveMatrix}
          addSaleTypeToMatrix={addSaleTypeToMatrix}
          removeSaleTypeFromMatrix={removeSaleTypeFromMatrix}
          setSelectedSaleTypeId={setSelectedSaleTypeId}
          setShowAddTemplate={setShowAddTemplate}
          setNewTemplate={setNewTemplate}
          createMilestoneTemplate={createMilestoneTemplate}
          updateMilestoneTemplate={updateMilestoneTemplate}
          deleteMilestoneTemplate={deleteMilestoneTemplate}
          setEditingTemplate={setEditingTemplate}
        />
      )}

      {/* AI Keys Tab */}
      {tab === 'ai-keys' && (
        <div className="space-y-4">
          {/* Global key */}
          <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
            <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-3">
              Global OpenAI API Key
            </h3>
            <p className="text-xs text-neutral-500 mb-3">
              Used by all users unless they have a personal override.
            </p>
            {globalKeyInfo.hasKey && (
              <div className="text-xs text-neutral-400 mb-2 font-mono">{globalKeyInfo.masked}</div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="sk-..."
                value={newGlobalKey}
                onChange={(e) => setNewGlobalKey(e.target.value)}
                className="bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors flex-1 placeholder:text-neutral-600"
              />
              <button
                onClick={saveGlobalKey}
                disabled={!newGlobalKey.trim()}
                className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-sm hover:bg-[#4db0b9] transition-colors disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>

          {/* Per-user overrides */}
          <div className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
            <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold mb-3">
              Per-User AI Key Overrides
            </h3>
            <p className="text-xs text-neutral-500 mb-3">
              Users with a personal key will use it instead of the global key.
            </p>
            <div className="space-y-2">
              {users.map((user) => (
                <UserKeyRow key={user.id} user={user} onSuccess={() => { setSuccess('User key updated'); }} onError={setError} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Integrations Tab */}
      {tab === 'integrations' && (
        <div className="space-y-4">
          <p className="text-xs text-neutral-500">
            Configure credentials for integrations that require setup. Users sign in via Settings.
          </p>
          {integrations.length === 0 && (
            <div className="text-center py-8 text-sm text-neutral-500">
              No integrations require admin configuration.
            </div>
          )}
          {integrations.map((integ) => (
            <div key={integ.id} className="border border-[#3a424d] rounded-lg px-5 py-4 bg-[#2f353d]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs text-[#5ec1ca] uppercase tracking-widest font-semibold">
                  {integ.name}
                </h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  integ.enabled ? 'bg-green-900/40 text-green-400' : 'bg-[#272C33] text-neutral-600'
                }`}>
                  {integ.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="space-y-3">
                {integ.fields.map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs text-neutral-400 mb-1">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={integValues[integ.id]?.[field.key] ?? ''}
                      onChange={(e) => {
                        setIntegValues(prev => ({
                          ...prev,
                          [integ.id]: { ...prev[integ.id], [field.key]: e.target.value },
                        }));
                      }}
                      onFocus={() => {
                        if (field.type === 'password' && (integValues[integ.id]?.[field.key] ?? '').includes('****')) {
                          setIntegValues(prev => ({
                            ...prev,
                            [integ.id]: { ...prev[integ.id], [field.key]: '' },
                          }));
                        }
                      }}
                      placeholder={field.placeholder}
                      className="w-full bg-[#272C33] border border-[#3a424d] rounded px-3 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-600 focus:border-[#5ec1ca] focus:outline-none"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3">
                <button
                  onClick={() => saveIntegConfig(integ.id)}
                  disabled={integSaving === integ.id}
                  className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-sm hover:bg-[#4db0b9] transition-colors disabled:opacity-40"
                >
                  {integSaving === integ.id ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Onboarding Config Tab */}
      {tab === 'onboarding' && (
        <OnboardingConfigView />
      )}
    </div>
  );
}

// ── Milestones Tab (Matrix + Template CRUD) ──

function MilestonesTab({
  milestoneTemplates, saleTypes, matrixOffsets, matrixEdits, matrixDirty, matrixSaving,
  editingTemplate, showAddTemplate, newTemplate, selectedSaleTypeId,
  getMatrixValue, setMatrixValue, saveMatrix, addSaleTypeToMatrix, removeSaleTypeFromMatrix,
  setSelectedSaleTypeId, setShowAddTemplate, setNewTemplate,
  createMilestoneTemplate, updateMilestoneTemplate, deleteMilestoneTemplate, setEditingTemplate,
}: {
  milestoneTemplates: MilestoneTemplate[];
  saleTypes: SaleType[];
  matrixOffsets: MatrixOffset[];
  matrixEdits: Map<string, number>;
  matrixDirty: boolean;
  matrixSaving: boolean;
  editingTemplate: MilestoneTemplate | null;
  showAddTemplate: boolean;
  newTemplate: { name: string; day_offset: string; sort_order: string };
  selectedSaleTypeId: number | null;
  getMatrixValue: (stId: number, tId: number) => number | null;
  setMatrixValue: (stId: number, tId: number, v: number) => void;
  saveMatrix: () => void;
  addSaleTypeToMatrix: () => void;
  removeSaleTypeFromMatrix: (stId: number) => void;
  setSelectedSaleTypeId: (id: number | null) => void;
  setShowAddTemplate: (v: boolean) => void;
  setNewTemplate: (v: { name: string; day_offset: string; sort_order: string }) => void;
  createMilestoneTemplate: () => void;
  updateMilestoneTemplate: (id: number, updates: Record<string, unknown>) => void;
  deleteMilestoneTemplate: (id: number, name: string) => void;
  setEditingTemplate: (t: MilestoneTemplate | null) => void;
}) {
  const activeTemplates = milestoneTemplates.filter(t => t.active).sort((a, b) => a.sort_order - b.sort_order || a.day_offset - b.day_offset);
  // Sale types that have rows in the matrix
  const matrixSaleTypeIds = new Set(matrixOffsets.map(o => o.sale_type_id));
  const matrixSaleTypes = saleTypes.filter(st => matrixSaleTypeIds.has(st.id) && st.active).sort((a, b) => a.sort_order - b.sort_order);
  // Sale types available to add (active, not already in matrix)
  const availableSaleTypes = saleTypes.filter(st => st.active && !matrixSaleTypeIds.has(st.id));

  return (
    <div className="space-y-6">
      {/* Matrix section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-100">Milestone Timeline by Sale Type</h3>
            <p className="text-xs text-neutral-500 mt-0.5">Day offsets from order date. Each sale type can have different timelines.</p>
          </div>
          <div className="flex items-center gap-2">
            {matrixDirty && (
              <button
                onClick={saveMatrix}
                disabled={matrixSaving}
                className="px-4 py-1.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-xs hover:bg-[#4db0b9] transition-colors disabled:opacity-50"
              >
                {matrixSaving ? 'Saving...' : 'Save Changes'}
              </button>
            )}
          </div>
        </div>

        {activeTemplates.length === 0 ? (
          <div className="text-center py-8 text-sm text-neutral-500">No active milestone templates. Add templates below first.</div>
        ) : (
          <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-auto">
            <table className="text-[11px] border-collapse w-full table-fixed">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#2f353d]">
                  <th className="sticky left-0 z-20 bg-[#2f353d] text-left px-3 py-2.5 text-neutral-500 border-b border-r border-[#3a424d] min-w-[140px]">
                    Sale Type
                  </th>
                  {activeTemplates.map(tmpl => (
                    <th
                      key={tmpl.id}
                      className="px-2 py-2.5 text-neutral-400 font-normal border-b border-[#3a424d] min-w-[80px] text-center"
                      title={`${tmpl.name} (default: Day ${tmpl.day_offset})`}
                    >
                      <div className="leading-tight">{tmpl.name}</div>
                    </th>
                  ))}
                  <th className="sticky right-0 bg-[#2f353d] border-b border-l border-[#3a424d] w-8" />
                </tr>
              </thead>
              <tbody>
                {matrixSaleTypes.map(st => (
                  <tr key={st.id} className="hover:bg-[#363d47]/50">
                    <td className="sticky left-0 bg-[#2f353d] px-3 py-2 text-neutral-200 border-r border-b border-[#3a424d] whitespace-nowrap font-medium">
                      {st.name}
                    </td>
                    {activeTemplates.map(tmpl => {
                      const val = getMatrixValue(st.id, tmpl.id);
                      const isEdited = matrixEdits.has(`${st.id}:${tmpl.id}`);
                      return (
                        <td
                          key={tmpl.id}
                          className={`border border-[#3a424d]/30 text-center transition-colors ${
                            isEdited ? 'bg-amber-900/30' : 'bg-transparent'
                          }`}
                        >
                          <input
                            type="number"
                            value={val ?? tmpl.day_offset}
                            onChange={e => setMatrixValue(st.id, tmpl.id, parseInt(e.target.value) || 0)}
                            className={`w-full text-center font-mono text-xs py-2 bg-transparent border-none outline-none transition-colors ${
                              isEdited ? 'text-amber-300' : 'text-neutral-300'
                            } focus:text-[#5ec1ca] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                          />
                        </td>
                      );
                    })}
                    <td className="sticky right-0 bg-[#2f353d] border-b border-l border-[#3a424d]/30 text-center px-1">
                      <button
                        onClick={() => removeSaleTypeFromMatrix(st.id)}
                        className="text-neutral-600 hover:text-red-400 transition-colors text-xs"
                        title="Remove from matrix"
                      >
                        {'\u2715'}
                      </button>
                    </td>
                  </tr>
                ))}
                {matrixSaleTypes.length === 0 && (
                  <tr>
                    <td colSpan={activeTemplates.length + 2} className="text-center py-6 text-neutral-500 text-xs">
                      No sale types in matrix. Add one below.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Add sale type to matrix */}
        {availableSaleTypes.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <select
              value={selectedSaleTypeId ?? ''}
              onChange={e => setSelectedSaleTypeId(e.target.value ? parseInt(e.target.value) : null)}
              className="bg-[#272C33] border border-[#3a424d] rounded px-3 py-1.5 text-xs text-neutral-300 focus:outline-none focus:border-[#5ec1ca]"
            >
              <option value="">Add sale type to matrix...</option>
              {availableSaleTypes.map(st => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </select>
            <button
              onClick={addSaleTypeToMatrix}
              disabled={!selectedSaleTypeId}
              className="px-3 py-1.5 text-xs rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9] disabled:opacity-40 transition-colors"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Template management section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-neutral-100">Milestone Templates</h3>
          <button
            onClick={() => { setShowAddTemplate(true); setNewTemplate({ name: '', day_offset: '0', sort_order: '0' }); }}
            className="px-3 py-1.5 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-xs hover:bg-[#4db0b9] transition-colors"
          >
            + Add Template
          </button>
        </div>

        {showAddTemplate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddTemplate(false)}>
            <div className="bg-[#2f353d] border border-[#3a424d] rounded-lg p-6 w-full max-w-md shadow-xl" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-neutral-100 mb-4">New Milestone Template</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Name <span className="text-red-500">*</span></label>
                  <input type="text" value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    placeholder="e.g. Welcome Call Completed"
                    className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca] placeholder:text-neutral-600" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Default Day Offset</label>
                    <input type="number" value={newTemplate.day_offset}
                      onChange={(e) => setNewTemplate({ ...newTemplate, day_offset: e.target.value })}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca]" />
                  </div>
                  <div>
                    <label className="block text-xs text-neutral-400 mb-1">Sort Order</label>
                    <input type="number" value={newTemplate.sort_order}
                      onChange={(e) => setNewTemplate({ ...newTemplate, sort_order: e.target.value })}
                      className="w-full bg-[#272C33] text-neutral-300 text-sm rounded px-3 py-2 border border-[#3a424d] outline-none focus:border-[#5ec1ca]" />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button onClick={() => setShowAddTemplate(false)}
                  className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors">
                  Cancel
                </button>
                <button onClick={createMilestoneTemplate} disabled={!newTemplate.name.trim()}
                  className="px-4 py-2 bg-[#5ec1ca] text-[#272C33] font-semibold rounded text-sm hover:bg-[#4db0b9] transition-colors disabled:opacity-40">
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#3a424d] text-[10px] text-neutral-500 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-center px-3 py-2.5 w-[100px]">Default Day</th>
                <th className="text-center px-3 py-2.5 w-[70px]">Order</th>
                <th className="text-center px-3 py-2.5 w-[70px]">Active</th>
                <th className="text-right px-4 py-2.5 w-[120px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {milestoneTemplates.map(tmpl => (
                <tr key={tmpl.id} className="border-b border-[#3a424d]/50 hover:bg-[#363d47] transition-colors">
                  <td className="px-4 py-2.5">
                    {editingTemplate?.id === tmpl.id ? (
                      <input type="text" value={editingTemplate.name}
                        onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                        className="bg-[#272C33] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] w-full" />
                    ) : (
                      <span className={`text-neutral-200 ${!tmpl.active ? 'line-through opacity-50' : ''}`}>{tmpl.name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-neutral-400">
                    {editingTemplate?.id === tmpl.id ? (
                      <input type="number" value={editingTemplate.day_offset}
                        onChange={e => setEditingTemplate({ ...editingTemplate, day_offset: parseInt(e.target.value) || 0 })}
                        className="bg-[#272C33] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] w-16 text-center" />
                    ) : (
                      tmpl.day_offset
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-neutral-500">
                    {editingTemplate?.id === tmpl.id ? (
                      <input type="number" value={editingTemplate.sort_order}
                        onChange={e => setEditingTemplate({ ...editingTemplate, sort_order: parseInt(e.target.value) || 0 })}
                        className="bg-[#272C33] text-neutral-200 text-xs rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] w-14 text-center" />
                    ) : (
                      tmpl.sort_order
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => updateMilestoneTemplate(tmpl.id, { active: tmpl.active ? 0 : 1 })}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                        tmpl.active ? 'bg-green-900/40 text-green-400 hover:bg-green-900/60' : 'bg-[#272C33] text-neutral-600 hover:text-neutral-400'
                      }`}
                    >
                      {tmpl.active ? 'Active' : 'Off'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {editingTemplate?.id === tmpl.id ? (
                        <>
                          <button
                            onClick={() => updateMilestoneTemplate(tmpl.id, { name: editingTemplate.name, day_offset: editingTemplate.day_offset, sort_order: editingTemplate.sort_order })}
                            className="px-2.5 py-1 text-[10px] rounded bg-[#5ec1ca] text-[#272C33] font-semibold hover:bg-[#4db0b9]"
                          >Save</button>
                          <button onClick={() => setEditingTemplate(null)} className="px-2 py-1 text-[10px] text-neutral-400 hover:text-neutral-200">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditingTemplate({ ...tmpl })} className="px-2.5 py-1 text-[10px] rounded bg-[#272C33] text-neutral-400 hover:text-[#5ec1ca]">Edit</button>
                          <button onClick={() => deleteMilestoneTemplate(tmpl.id, tmpl.name)} className="px-2.5 py-1 text-[10px] rounded bg-[#272C33] text-neutral-400 hover:text-red-400">Del</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {milestoneTemplates.length === 0 && (
            <div className="text-center py-6 text-sm text-neutral-500">No milestone templates yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserKeyRow({ user, onSuccess, onError }: { user: UserRow; onSuccess: () => void; onError: (msg: string) => void }) {
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/ai-keys/user/${user.id}`)
      .then((r) => r.json())
      .then((json) => { if (json.ok) setHasKey(json.data.hasKey); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [user.id]);

  const save = async () => {
    try {
      const res = await fetch(`/api/admin/ai-keys/user/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() || null }),
      });
      const json = await res.json();
      if (json.ok) { onSuccess(); setKey(''); setHasKey(!!key.trim()); }
      else onError(json.error || 'Save failed');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  if (!loaded) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-300 w-32 truncate">{user.display_name || user.username}</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${hasKey ? 'bg-green-900/40 text-green-400' : 'bg-[#272C33] text-neutral-600'}`}>
        {hasKey ? 'Custom key' : 'Uses global'}
      </span>
      <input
        type="password"
        placeholder={hasKey ? 'Replace key...' : 'Set override...'}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="bg-[#272C33] text-neutral-300 text-xs rounded px-2 py-1 border border-[#3a424d] outline-none focus:border-[#5ec1ca] transition-colors flex-1 placeholder:text-neutral-600"
      />
      <button
        onClick={save}
        className="px-2 py-1 text-[10px] rounded bg-[#272C33] text-neutral-400 hover:text-[#5ec1ca] transition-colors"
      >
        {key.trim() ? 'Save' : hasKey ? 'Clear' : 'Save'}
      </button>
    </div>
  );
}
