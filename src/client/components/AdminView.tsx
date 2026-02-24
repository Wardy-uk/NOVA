import { useState, useEffect, useCallback } from 'react';

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

type Tab = 'users' | 'teams' | 'ai-keys';

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

  // Team form
  const [newTeamName, setNewTeamName] = useState('');

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

  useEffect(() => { fetchData(); fetchAiKeys(); }, [fetchData, fetchAiKeys]);

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
        {([['users', 'Users'], ['teams', 'Teams'], ['ai-keys', 'AI Keys']] as const).map(([key, label]) => (
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
