import { useState, useEffect, useCallback, useMemo } from 'react';

interface Agent {
  AgentId: number;
  AgentKey: string;
  AgentName: string;
  AgentSurname: string;
  TierCode: string;
  Team: string;
  Department: string | null;
  IsActive: boolean;
  IsAvailable: boolean;
  MaxTickets: number;
  MaxTicketsCustomerCare: number;
  MaxTicketsT2T3: number;
}

interface EditState {
  Department: string;
  Team: string;
  TierCode: string;
  IsActive: boolean;
  MaxTickets: number;
  MaxTicketsCustomerCare: number;
  MaxTicketsT2T3: number;
}

type Toast = { message: string; type: 'success' | 'error' };

const TH = 'px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-400 font-semibold bg-[#272C33] border-b border-[#3a424d] whitespace-nowrap';
const TD = 'px-3 py-2 text-[13px] text-neutral-300 border-b border-[#3a424d]';
const INPUT = 'bg-[#272C33] border border-[#3a424d] rounded px-2 py-1 text-[12px] text-neutral-300 focus:border-[#5ec1ca] focus:outline-none transition-colors';

function getToken(): string {
  return localStorage.getItem('nova_token') || '';
}

function editStateFromAgent(a: Agent): EditState {
  return {
    Department: a.Department || '',
    Team: a.Team || '',
    TierCode: a.TierCode || 'T1',
    IsActive: a.IsActive,
    MaxTickets: a.MaxTickets,
    MaxTicketsCustomerCare: a.MaxTicketsCustomerCare,
    MaxTicketsT2T3: a.MaxTicketsT2T3,
  };
}

function hasChanges(original: Agent, edit: EditState): boolean {
  return (
    (original.Department || '') !== edit.Department ||
    (original.Team || '') !== edit.Team ||
    original.TierCode !== edit.TierCode ||
    original.IsActive !== edit.IsActive ||
    original.MaxTickets !== edit.MaxTickets ||
    original.MaxTicketsCustomerCare !== edit.MaxTicketsCustomerCare ||
    original.MaxTicketsT2T3 !== edit.MaxTicketsT2T3
  );
}

export function AgentAdminView() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [edits, setEdits] = useState<Record<number, EditState>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('All');

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/kpi-data/agent-admin', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const json = await res.json();
      if (json.ok) {
        setAgents(json.data);
        // Initialize edits from fresh data
        const initial: Record<number, EditState> = {};
        for (const a of json.data) {
          initial[a.AgentId] = editStateFromAgent(a);
        }
        setEdits(initial);
      } else {
        setError(json.error || 'Failed to load agents');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  // Unique departments for filter dropdown
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.Department) set.add(a.Department);
    }
    return Array.from(set).sort();
  }, [agents]);

  // Filtered agents
  const filtered = useMemo(() => {
    let list = agents;
    if (deptFilter !== 'All') {
      list = list.filter(a => (a.Department || '') === deptFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        a =>
          a.AgentName.toLowerCase().includes(q) ||
          a.AgentSurname.toLowerCase().includes(q) ||
          a.AgentKey.toLowerCase().includes(q)
      );
    }
    return list;
  }, [agents, search, deptFilter]);

  const updateEdit = (agentId: number, field: keyof EditState, value: any) => {
    setEdits(prev => ({
      ...prev,
      [agentId]: { ...prev[agentId], [field]: value },
    }));
  };

  const saveRow = async (agent: Agent) => {
    const edit = edits[agent.AgentId];
    if (!edit) return;
    setSaving(prev => ({ ...prev, [agent.AgentId]: true }));
    try {
      const res = await fetch(`/api/kpi-data/agent-admin/${agent.AgentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          Department: edit.Department || null,
          Team: edit.Team,
          TierCode: edit.TierCode,
          IsActive: edit.IsActive,
          MaxTickets: edit.MaxTickets,
          MaxTicketsCustomerCare: edit.MaxTicketsCustomerCare,
          MaxTicketsT2T3: edit.MaxTicketsT2T3,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        // Update the local agent record to match saved state
        setAgents(prev =>
          prev.map(a =>
            a.AgentId === agent.AgentId
              ? {
                  ...a,
                  Department: edit.Department || null,
                  Team: edit.Team,
                  TierCode: edit.TierCode,
                  IsActive: edit.IsActive,
                  MaxTickets: edit.MaxTickets,
                  MaxTicketsCustomerCare: edit.MaxTicketsCustomerCare,
                  MaxTicketsT2T3: edit.MaxTicketsT2T3,
                }
              : a
          )
        );
        setToast({ message: `Saved ${agent.AgentName} ${agent.AgentSurname}`, type: 'success' });
      } else {
        setToast({ message: json.error || 'Save failed', type: 'error' });
      }
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Save failed', type: 'error' });
    } finally {
      setSaving(prev => ({ ...prev, [agent.AgentId]: false }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-neutral-100">Agent Admin</h2>
        <button
          onClick={fetchAgents}
          className="text-neutral-400 hover:text-[#5ec1ca] transition-colors"
          title="Refresh"
        >
          <svg
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className={`${INPUT} w-64`}
        />
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          className={INPUT}
        >
          <option value="All">All Departments</option>
          {departments.map(d => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {/* Row count */}
      {!loading && !error && (
        <div className="text-[11px] text-neutral-500">
          {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
          {filtered.length !== agents.length ? ` (of ${agents.length} total)` : ''}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded bg-red-900/20 border border-red-800/30 text-[12px] text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-[#3a424d] rounded-lg bg-[#2f353d] overflow-x-auto max-h-[70vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-neutral-500">Loading...</div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={TH}>Agent Name</th>
                <th className={TH}>Email</th>
                <th className={TH}>Tier</th>
                <th className={TH}>Team</th>
                <th className={TH}>Department</th>
                <th className={`${TH} text-center`}>Active</th>
                <th className={`${TH} text-right`}>Max Tickets</th>
                <th className={`${TH} text-right`}>Max CC</th>
                <th className={`${TH} text-right`}>Max T2T3</th>
                <th className={`${TH} text-center`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(agent => {
                const edit = edits[agent.AgentId];
                if (!edit) return null;
                const modified = hasChanges(agent, edit);
                const isSaving = saving[agent.AgentId] || false;
                const isNT = edit.Department === 'NT';
                const inactive = !edit.IsActive;

                return (
                  <tr
                    key={agent.AgentId}
                    className={`hover:bg-[#343a42] transition-colors ${
                      inactive ? 'opacity-40' : ''
                    }`}
                  >
                    {/* Agent Name (read-only) */}
                    <td className={`${TD} whitespace-nowrap font-medium ${isNT ? 'text-[#5ec1ca]' : ''}`}>
                      {agent.AgentName} {agent.AgentSurname}
                    </td>

                    {/* Email / AgentKey (read-only) */}
                    <td className={`${TD} text-neutral-500 text-[11px]`}>{agent.AgentKey}</td>

                    {/* TierCode */}
                    <td className={TD}>
                      <select
                        value={edit.TierCode}
                        onChange={e => updateEdit(agent.AgentId, 'TierCode', e.target.value)}
                        className={`${INPUT} w-16`}
                      >
                        <option value="T1">T1</option>
                        <option value="T2">T2</option>
                        <option value="T3">T3</option>
                      </select>
                    </td>

                    {/* Team */}
                    <td className={TD}>
                      <input
                        type="text"
                        value={edit.Team}
                        onChange={e => updateEdit(agent.AgentId, 'Team', e.target.value)}
                        className={`${INPUT} w-28`}
                      />
                    </td>

                    {/* Department */}
                    <td className={TD}>
                      <input
                        type="text"
                        value={edit.Department}
                        onChange={e => updateEdit(agent.AgentId, 'Department', e.target.value)}
                        className={`${INPUT} w-20 ${isNT ? 'border-[#5ec1ca]/40 text-[#5ec1ca]' : ''}`}
                      />
                    </td>

                    {/* IsActive */}
                    <td className={`${TD} text-center`}>
                      <button
                        onClick={() => updateEdit(agent.AgentId, 'IsActive', !edit.IsActive)}
                        className={`w-9 h-5 rounded-full relative transition-colors ${
                          edit.IsActive ? 'bg-[#5ec1ca]' : 'bg-[#3a424d]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                            edit.IsActive ? 'left-[18px]' : 'left-0.5'
                          }`}
                        />
                      </button>
                    </td>

                    {/* MaxTickets */}
                    <td className={`${TD} text-right`}>
                      <input
                        type="number"
                        min={0}
                        value={edit.MaxTickets}
                        onChange={e => updateEdit(agent.AgentId, 'MaxTickets', Number(e.target.value) || 0)}
                        className={`${INPUT} w-16 text-right`}
                      />
                    </td>

                    {/* MaxTicketsCustomerCare */}
                    <td className={`${TD} text-right`}>
                      <input
                        type="number"
                        min={0}
                        value={edit.MaxTicketsCustomerCare}
                        onChange={e =>
                          updateEdit(agent.AgentId, 'MaxTicketsCustomerCare', Number(e.target.value) || 0)
                        }
                        className={`${INPUT} w-16 text-right`}
                      />
                    </td>

                    {/* MaxTicketsT2T3 */}
                    <td className={`${TD} text-right`}>
                      <input
                        type="number"
                        min={0}
                        value={edit.MaxTicketsT2T3}
                        onChange={e =>
                          updateEdit(agent.AgentId, 'MaxTicketsT2T3', Number(e.target.value) || 0)
                        }
                        className={`${INPUT} w-16 text-right`}
                      />
                    </td>

                    {/* Save */}
                    <td className={`${TD} text-center`}>
                      {modified && (
                        <button
                          onClick={() => saveRow(agent)}
                          disabled={isSaving}
                          className={`px-3 py-1.5 text-xs rounded font-semibold transition-colors ${
                            isSaving
                              ? 'bg-[#5ec1ca]/50 text-[#272C33] cursor-wait'
                              : 'bg-[#5ec1ca] text-[#272C33] hover:bg-[#4db0b9]'
                          }`}
                        >
                          {isSaving ? 'Saving...' : 'Save'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-neutral-500 text-[13px]">
                    No agents found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-green-900/80 border border-green-700/50 text-green-300'
              : 'bg-red-900/80 border border-red-700/50 text-red-300'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
