import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { type BriefFields } from './TicketBriefCard.js';
import {
  UnifiedQueue,
  type UnifiedQueueConfig,
  type QueueActions,
  type FilterPill,
  type StatCard,
  type BulkAction,
  StatusPill,
  GlassCard,
  timeAgo,
  timeRemaining,
  URGENCY_COLORS,
} from './queue/index.js';
import { UnifiedTicketDetail } from './ticket-detail/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

interface ApprovalItem {
  id: number;
  ticket_id: string;
  ticket_summary: string;
  reporter_name: string | null;
  reporter_email: string | null;
  ai_response_adf: string | null;
  conversation_json: string | null;
  kb_sources: string | null;
  resume_url: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  edited_response_adf: string | null;
  decline_reason: string | null;
  priority: string | null;
  created_at: string;
  expires_at: string;
  source: string | null;
  action_type: string | null;
  confidence: number | null;
  reasoning: string | null;
  shadow_mode: boolean;
  decision_id: number | null;
  assignee_name: string | null;
  bc_account_number: string | null;
}

interface ApprovalStats {
  pending: number;
  approved: number;
  declined: number;
  declined_today: number;
  timed_out: number;
  today_decided: number;
  system_approved_today: number;
  system_expired_today: number;
}

interface ApprovalQueueViewProps {
  canInteract: boolean;
  onNavigateToAgent?: (ticketId: string) => void;
}

const API_BASE = '/api/approvals';

// ── Helpers ────────────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  highest: 'bg-red-500/20 text-red-400 border-red-500/30',
  major: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  minor: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  low: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
  lowest: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30',
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  draft_response: { label: 'Draft Response', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  plugin_to_tpj: { label: 'Route to TPJ', color: 'bg-violet-500/20 text-violet-400 border-violet-500/30' },
  escalate: { label: 'Escalate', color: 'bg-orange-500/20 text-orange-400 border-orange-500/30' },
  abuse_report: { label: 'Abuse Report', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  auto_close: { label: 'Auto-close', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  close: { label: 'Close', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  respond: { label: 'Respond', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  request_info: { label: 'Request Info', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  no_action: { label: 'No Action', color: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30' },
};

function extractAdfText(adfJson: string | null): string {
  if (!adfJson) return '';
  try {
    const doc = JSON.parse(adfJson);
    if (doc.draft_response || doc.reasoning_trace || doc.reasoning || doc.internal_note) {
      const parts: string[] = [];
      if (doc.draft_response) parts.push(doc.draft_response);
      else if (doc.internal_note) parts.push(typeof doc.internal_note === 'string' ? doc.internal_note : doc.internal_note.summary ?? JSON.stringify(doc.internal_note));
      if (doc.reasoning_trace) parts.push(`\nReasoning: ${doc.reasoning_trace}`);
      else if (doc.reasoning) parts.push(`\nReasoning: ${doc.reasoning}`);
      return parts.join('\n');
    }
    if (!doc.content) return adfJson;
    return doc.content.map((block: any) => {
      if (block.type === 'paragraph' || block.type === 'heading')
        return (block.content || []).map((i: any) => i.text || '').join('');
      if (block.type === 'bulletList' || block.type === 'orderedList')
        return (block.content || []).map((li: any) => (li.content || []).map((p: any) => (p.content || []).map((i: any) => i.text || '').join('')).join('')).map((t: string) => `• ${t}`).join('\n');
      return '';
    }).filter(Boolean).join('\n\n');
  } catch { return adfJson; }
}

function parseConversation(json: string | null): Array<{ role: string; text: string; author?: string }> {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      const msgs: Array<{ role: string; text: string; author?: string }> = [];
      if (parsed.summary || parsed.description)
        msgs.push({ role: 'customer', text: [parsed.summary, parsed.description].filter(Boolean).join('\n\n'), author: parsed.reporter ?? parsed.reporter_name ?? undefined });
      if (parsed.comments && Array.isArray(parsed.comments))
        for (const c of parsed.comments) msgs.push({ role: c.isInternal ? 'agent' : 'customer', text: c.body || c.text || '', author: c.author || c.authorName || undefined });
      if (msgs.length > 0) return msgs;
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map((msg: any) => ({ role: msg.role || msg.actorType || 'unknown', text: msg.body || msg.text || msg.content || '', author: msg.authorName || msg.author || undefined }));
  } catch { return []; }
}

function parseKbSources(json: string | null): Array<{ title: string; url: string }> {
  if (!json) return [];
  try { const data = JSON.parse(json); return Array.isArray(data) ? data : []; } catch { return []; }
}

function textToAdf(text: string): string {
  return JSON.stringify({ version: 1, type: 'doc', content: text.split('\n\n').filter(Boolean).map(para => ({ type: 'paragraph', content: [{ type: 'text', text: para }] })) });
}

function parseDraftResponse(outputJson: string | null): string | null {
  if (!outputJson) return null;
  try { return JSON.parse(outputJson).draft_response || null; } catch { return null; }
}

function confidenceStyle(c: number): { color: string; bg: string; label: string } {
  const pct = Math.round(c * 100);
  if (c >= 0.9) return { color: 'text-green-400', bg: 'bg-green-500', label: `${pct}%` };
  if (c >= 0.7) return { color: 'text-amber-400', bg: 'bg-amber-500', label: `${pct}%` };
  return { color: 'text-red-400', bg: 'bg-red-500', label: `${pct}%` };
}

// ── Row component ──────────────────────────────────────────────────────────

function ApprovalRow({ item, selected, focused }: { item: ApprovalItem; selected: boolean; focused: boolean }) {
  const expiry = timeRemaining(item.expires_at);
  const priStyle = PRIORITY_STYLES[(item.priority || 'normal').toLowerCase()] || PRIORITY_STYLES.normal;

  return (
    <div className={`px-3 py-3 transition-all duration-150 border-b border-[#2f353d]/50 ${
      selected ? 'bg-[#5ec1ca]/10' : focused ? 'bg-[#363d47]' : 'hover:bg-[#272c33]'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-mono font-semibold text-[#5ec1ca]">{item.ticket_id}</span>
        <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded ${item.source === 'nova_ai' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca]' : 'bg-violet-500/15 text-violet-400'}`}>
          {item.source === 'nova_ai' ? 'NOVA' : 'n8n'}
        </span>
        {item.shadow_mode && <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-purple-500/15 text-purple-400">SHADOW</span>}
        <StatusPill status={item.status} />
      </div>
      <div className="text-[11px] text-neutral-300 truncate mb-1">{item.ticket_summary}</div>
      <div className="flex items-center gap-3 text-[9px] text-neutral-500">
        <span className={`inline-block px-1.5 py-0.5 text-[9px] font-semibold rounded border ${priStyle}`}>{item.priority || 'Normal'}</span>
        <span>{item.reporter_name || item.reporter_email || 'Unknown'}</span>
        <span>{timeAgo(item.created_at)}</span>
        {item.status === 'pending' && (
          <span className={`font-medium ${URGENCY_COLORS[expiry.urgency]}`}>{expiry.text}</span>
        )}
      </div>
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────

function ApprovalDetail({
  item, canInteract, onDecide, actions, onNavigateToAgent,
}: {
  item: ApprovalItem;
  canInteract: boolean;
  onDecide: (id: number, action: 'approve' | 'decline' | 'cancel' | 'confirm' | 'execute', editedResponse?: string, declineReason?: string) => void;
  actions: QueueActions;
  onNavigateToAgent?: (ticketId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  useEffect(() => {
    setEditedText(extractAdfText(item.ai_response_adf));
    setEditing(false);
    setShowDeclineForm(false);
    setDeclineReason('');
  }, [item.id]);

  const [briefFields, setBriefFields] = useState<BriefFields | null>(null);
  useEffect(() => {
    if (!item.ticket_id) return;
    const token = localStorage.getItem('nova_auth_token') || '';
    fetch(`/api/jira/issues/${item.ticket_id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(json => { if (json.ok && json.data) setBriefFields((json.data.fields ?? json.data) as BriefFields); })
      .catch(() => {});
  }, [item.ticket_id]);

  const kbSources = parseKbSources(item.kb_sources);
  const originalText = extractAdfText(item.ai_response_adf);
  const hasEdits = editing && editedText !== originalText;
  const isPending = item.status === 'pending';
  const isShadow = item.shadow_mode && item.source === 'nova_ai';

  const handleApprove = () => {
    if (isShadow) { onDecide(item.id, 'execute', hasEdits ? editedText : undefined); }
    else if (hasEdits) { onDecide(item.id, 'approve', editedText); }
    else { onDecide(item.id, 'approve'); }
    actions.toast('Approved', 'ok');
  };

  const handleConfirm = () => { onDecide(item.id, 'confirm'); actions.toast('Confirmed', 'ok'); };

  const handleDecline = () => {
    if (!showDeclineForm) { setShowDeclineForm(true); return; }
    if (!declineReason.trim()) return;
    onDecide(item.id, 'decline', undefined, declineReason.trim());
    actions.toast('Declined', 'ok');
  };

  const handleExecute = () => { onDecide(item.id, 'execute'); actions.toast('Executed', 'ok'); };

  const aiDecisionContext = item.source === 'nova_ai' ? (
    <GlassCard className="p-4 space-y-3" accentGradient="#5ec1ca 30%, #9b6aed 70%" accent>
      <div className="text-[11px] font-bold uppercase tracking-wider text-[#5ec1ca]">AI Decision</div>
      <div className="flex items-center gap-2 flex-wrap">
        {item.action_type && (() => {
          const info = ACTION_LABELS[item.action_type] || { label: item.action_type.replace(/_/g, ' '), color: 'bg-neutral-500/20 text-neutral-400 border-neutral-500/30' };
          return <span className={`px-2.5 py-1 text-[12px] font-semibold rounded border ${info.color}`}>{info.label}</span>;
        })()}
        {item.confidence != null && (() => {
          const cs = confidenceStyle(item.confidence);
          return (
            <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-[12px] font-semibold rounded ${cs.color}`}>
              <span className="relative w-12 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                <span className={`absolute inset-y-0 left-0 rounded-full ${cs.bg}`} style={{ width: `${Math.round(item.confidence! * 100)}%` }} />
              </span>
              {cs.label}
            </span>
          );
        })()}
      </div>
      {item.reasoning && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Reasoning</div>
          <div className="text-[13px] text-neutral-300 whitespace-pre-wrap bg-[#1f242b] rounded px-3 py-2 border border-[#3a424d]">{item.reasoning}</div>
        </div>
      )}
      {item.action_type === 'draft_response' && (() => {
        const draft = parseDraftResponse(item.ai_response_adf);
        if (!draft) return null;
        return (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Draft Response</div>
            <div className="text-[13px] text-neutral-200 whitespace-pre-wrap bg-[#272C33] rounded-lg px-4 py-3 border-2 border-blue-500/30">{draft}</div>
          </div>
        );
      })()}
    </GlassCard>
  ) : undefined;

  const actionBar = isPending && canInteract ? (
    <div className="sticky bottom-0 bg-[#14171c]/95 backdrop-blur-sm border-t border-[#2f353d] -mx-5 px-5 py-3 flex items-center gap-2">
      {isShadow ? (
        <>
          <button onClick={handleConfirm} className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a]" style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)' }}>{'✓'} Confirm Correct</button>
          <button onClick={handleExecute} className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a]" style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}>Execute Action</button>
        </>
      ) : (
        <button onClick={handleApprove} className="px-4 py-2 text-xs rounded-lg font-bold text-[#0f172a]" style={{ background: 'linear-gradient(135deg, #10b981, #5ec1ca)' }}>
          {hasEdits ? 'Edit & Approve' : '✓ Approve'}
        </button>
      )}
      <button onClick={handleDecline} className="px-4 py-2 text-xs rounded-lg font-bold bg-red-900/30 text-red-400 border border-red-800/40 hover:bg-red-900/50">Decline</button>
      {showDeclineForm && (
        <input value={declineReason} onChange={e => setDeclineReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleDecline()} placeholder="Reason for decline..." className="flex-1 px-3 py-1.5 text-[11px] rounded-lg bg-[#1a1e24] border border-[#2f353d] text-neutral-200 placeholder-neutral-600" autoFocus />
      )}
    </div>
  ) : undefined;

  return (
    <div className="p-5 space-y-4">
      <UnifiedTicketDetail
        ticketKey={item.ticket_id}
        issue={briefFields as Record<string, unknown> | null}
        queueFields={{
          assignee: item.assignee_name,
          reporter: item.reporter_name,
          reporter_email: item.reporter_email,
          priority: item.priority,
          bc_account_number: item.bc_account_number,
          status: item.status,
          created: item.created_at,
          expires_at: item.expires_at,
          decided_by: item.decided_by,
          decided_at: item.decided_at,
          summary: item.ticket_summary,
        }}
        briefFields={briefFields}
        briefTier={(briefFields?.customfield_12981 as any)?.value ?? null}
        compact
        badges={<>
          <span className={`px-2 py-0.5 text-[10px] font-semibold rounded ${item.source === 'nova_ai' ? 'bg-[#5ec1ca]/15 text-[#5ec1ca]' : 'bg-violet-500/15 text-violet-400'}`}>
            {item.source === 'nova_ai' ? 'NOVA AI' : 'n8n AI'}
          </span>
          {isShadow && <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-purple-500/15 text-purple-400">SHADOW</span>}
        </>}
        headerActions={item.source === 'nova_ai' && onNavigateToAgent ? (
          <button onClick={() => onNavigateToAgent(item.ticket_id)} className="px-3 py-1.5 text-[11px] rounded-lg bg-[#5ec1ca]/15 text-[#5ec1ca] hover:bg-[#5ec1ca]/25 font-medium shrink-0">Review in Agent</button>
        ) : undefined}
        aiNextAction={{ compact: true }}
        aiDecisionContext={aiDecisionContext}
        conversationJson={item.conversation_json ?? undefined}
        proposedResolution={originalText || undefined}
        proposedResolutionEditable={isPending && canInteract}
        onProposedResolutionEdit={(text) => { setEditedText(text); setEditing(true); }}
        kbSources={kbSources}
        primaryActions={actionBar}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export function ApprovalQueueView({ canInteract, onNavigateToAgent }: ApprovalQueueViewProps) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [stats, setStats] = useState<ApprovalStats>({ pending: 0, approved: 0, declined: 0, declined_today: 0, timed_out: 0, today_decided: 0, system_approved_today: 0, system_expired_today: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const prevItemIdsRef = useRef<Set<number>>(new Set());

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${API_BASE}?${params}`);
      const json = await res.json();
      if (json.ok) {
        const newItems: ApprovalItem[] = json.data.items || json.data || [];
        prevItemIdsRef.current = new Set(newItems.map(it => it.id));
        setItems(newItems);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [statusFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats`);
      const json = await res.json();
      if (json.ok) setStats(json.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchItems(); fetchStats(); }, [fetchItems, fetchStats]);
  useEffect(() => {
    const i1 = setInterval(fetchItems, 15000);
    const i2 = setInterval(fetchStats, 15000);
    return () => { clearInterval(i1); clearInterval(i2); };
  }, [fetchItems, fetchStats]);

  useEffect(() => { prevItemIdsRef.current = new Set(); }, [statusFilter]);

  const handleDecide = async (id: number, action: 'approve' | 'decline' | 'cancel' | 'confirm' | 'execute', editedResponse?: string, declineReason?: string) => {
    try {
      const item = items.find(i => i.id === id);
      const isShadowAction = action === 'confirm' || action === 'execute' || (action === 'decline' && item?.shadow_mode);
      const useShadowEndpoint = isShadowAction && item?.decision_id;
      const url = useShadowEndpoint ? `/api/agent/decisions/${item!.decision_id}/decide` : `${API_BASE}/${id}/decide`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, editedResponse, declineReason }) });
      const json = await res.json();
      if (json.ok) { fetchItems(); fetchStats(); }
    } catch { /* silent */ }
  };

  const handleBulkDecide = async (action: 'approve' | 'decline', keys: string[]) => {
    const ids = keys.map(k => parseInt(k, 10));
    await Promise.all(ids.map(id => handleDecide(id, action)));
  };

  // Filter pills
  const filterPills: FilterPill[] = [
    { key: '', label: 'All' },
    { key: 'pending', label: 'Pending', count: stats.pending },
    { key: 'approved', label: 'Approved' },
    { key: 'declined', label: 'Declined' },
    { key: 'timed_out', label: 'Timed Out' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  const statCards: StatCard[] = [
    { label: 'Pending', value: stats.pending, color: '#f59e0b' },
    { label: 'Approved', value: stats.today_decided, color: '#22c55e', subtitle: stats.system_approved_today > 0 ? `+${stats.system_approved_today} auto` : undefined },
    { label: 'Declined', value: stats.declined_today, color: '#ef4444' },
    { label: 'Timed Out', value: stats.timed_out, color: '#6b7280' },
  ];

  const bulkActions: BulkAction[] = canInteract ? [
    { key: 'approve', label: 'Approve', variant: 'primary', onExecute: (keys) => handleBulkDecide('approve', keys) },
    { key: 'decline', label: 'Decline', variant: 'danger', onExecute: (keys) => handleBulkDecide('decline', keys) },
  ] : [];

  const config: UnifiedQueueConfig<ApprovalItem> = useMemo(() => ({
    title: 'AI Approval Queue',
    icon: <span>🤖</span>,
    accentGradient: '#5ec1ca 30%, #9b6aed 70%',

    fetchItems: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${API_BASE}?${params}`);
      const json = await res.json();
      return json.ok ? (json.data.items || json.data || []) : [];
    },
    pollIntervalMs: 15000,

    getKey: (i) => String(i.id),
    renderRow: (i, { selected, focused }) => <ApprovalRow item={i} selected={selected} focused={focused} />,

    filters: filterPills,
    activeFilter: statusFilter,
    onFilterChange: setStatusFilter,
    searchPlaceholder: 'Search by ticket ID or summary...',
    searchFn: (i, q) => i.ticket_id.toLowerCase().includes(q) || i.ticket_summary.toLowerCase().includes(q),

    stats: statCards,

    renderDetail: (item, queueActions) => (
      <ApprovalDetail item={item} canInteract={canInteract} onDecide={handleDecide} actions={queueActions} onNavigateToAgent={onNavigateToAgent} />
    ),

    selectable: canInteract && statusFilter === 'pending',
    bulkActions,

    keyboardShortcuts: [
      { key: 'a', label: 'approve' },
      { key: 'd', label: 'decline' },
      { key: 'e', label: 'execute' },
    ],
    onKeyAction: (key, item) => {
      if (!item || !canInteract || item.status !== 'pending') return false;
      if (key === 'a') { handleDecide(item.id, item.shadow_mode ? 'confirm' : 'approve'); return true; }
      if (key === 'd') { handleDecide(item.id, 'decline'); return true; }
      if (key === 'e' && item.shadow_mode) { handleDecide(item.id, 'execute'); return true; }
      return false;
    },
  }), [statusFilter, stats, canInteract, items]);

  return (
    <>
      {!canInteract && !loading && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-2.5 text-[13px] text-amber-400 flex items-center gap-2 mb-2">
          Read-only — you need AI Approver permissions to approve or decline tickets
        </div>
      )}
      <UnifiedQueue config={config} items={items} loading={loading} />
    </>
  );
}
