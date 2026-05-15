import { GlassCard, timeAgo, commentBodyToText } from '../queue/index.js';
import { AdfCommentBody } from '../AdfCommentBody.js';

interface JiraComment {
  id: string;
  body: unknown;
  author: { displayName?: string; display_name?: string; name?: string };
  created: string;
}

interface ConversationMessage {
  role: string;
  text: string;
  author?: string;
}

interface ThreadEntry {
  id: number;
  jira_key: string;
  user_id: number;
  user_display: string;
  kind: 'comment' | 'state_change' | 'accept' | 'return' | 'claim' | 'fasttrack';
  body: string | null;
  body_adf?: string | null;
  meta_json?: string | null;
  jira_sync_state: 'pending' | 'synced' | 'failed' | 'skip';
  jira_sync_error: string | null;
  created_at: string;
}

export interface ActivityStreamProps {
  ticketKey: string;
  comments?: JiraComment[];
  conversationJson?: string;
  lastCustomerComment?: string;
  lastCustomerCommentAt?: string;
  lastAgentComment?: string;
  lastAgentCommentAt?: string;
  threadEntries?: ThreadEntry[];
  maxHeight?: string;
}

function parseConversation(json: string | null): ConversationMessage[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      const msgs: ConversationMessage[] = [];
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

function ThreadEntryRow({ entry }: { entry: ThreadEntry }) {
  let isJiraOrigin = false;
  try {
    if (entry.meta_json) isJiraOrigin = (JSON.parse(entry.meta_json) as { source?: string }).source === 'jira';
  } catch { /* ignore */ }

  const kindColour = isJiraOrigin ? '#f59e0b' : ({
    comment: '#5ec1ca', accept: '#10b981', return: '#9b6aed',
    claim: '#64748b', fasttrack: '#f97316', state_change: '#64748b',
  } as Record<string, string>)[entry.kind];
  const icon = isJiraOrigin ? '\u{1F4E5}' : ({
    comment: '\u{1F4AC}', accept: '✓', return: '↩', claim: '◉', fasttrack: '\u{1F525}', state_change: '◈',
  } as Record<string, string>)[entry.kind];

  return (
    <div
      className="p-3 rounded-lg"
      style={{
        background: isJiraOrigin ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${isJiraOrigin ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.1)'}`,
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-[10px] font-bold" style={{ color: kindColour }}>
          <span>{icon}</span>
          <span className="uppercase tracking-wider">{isJiraOrigin ? 'AGENT REPLY' : entry.kind}</span>
          <span className="text-neutral-300 font-normal">{'·'} {entry.user_display}</span>
          {isJiraOrigin && <span className="text-[9px] text-neutral-500 font-normal">{'·'} from Jira</span>}
        </div>
        <div className="flex items-center gap-2">
          {!isJiraOrigin && entry.jira_sync_state === 'pending' && <span className="text-[9px] text-amber-400">syncing...</span>}
          {!isJiraOrigin && entry.jira_sync_state === 'failed' && <span className="text-[9px] text-red-400" title={entry.jira_sync_error || ''}>sync failed</span>}
          {!isJiraOrigin && entry.jira_sync_state === 'synced' && <span className="text-[9px] text-emerald-400">{'✓'} jira</span>}
          <span className="text-[10px] text-neutral-400">{timeAgo(entry.created_at)}</span>
        </div>
      </div>
      {entry.body_adf ? (
        (() => {
          try {
            return <AdfCommentBody body={JSON.parse(entry.body_adf)} className="text-[12px] text-neutral-100 leading-relaxed" issueKey={entry.jira_key} />;
          } catch {
            return entry.body ? <div className="text-[12px] text-neutral-100 whitespace-pre-wrap leading-relaxed">{entry.body}</div> : null;
          }
        })()
      ) : entry.body ? (
        <div className="text-[12px] text-neutral-100 whitespace-pre-wrap leading-relaxed">{entry.body}</div>
      ) : null}
    </div>
  );
}

export function ActivityStream({
  ticketKey,
  comments,
  conversationJson,
  lastCustomerComment,
  lastCustomerCommentAt,
  lastAgentComment,
  lastAgentCommentAt,
  threadEntries,
  maxHeight = '500px',
}: ActivityStreamProps) {
  // Priority 1: Thread entries (DevReview)
  if (threadEntries && threadEntries.length > 0) {
    return (
      <GlassCard className="p-4 flex flex-col">
        <div className="text-[11px] uppercase tracking-wider text-[#5ec1ca] font-bold mb-3">{'◈'} Activity</div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1" style={{ maxHeight, scrollbarWidth: 'thin', scrollbarColor: '#3a424d transparent' }}>
          {threadEntries.map(t => <ThreadEntryRow key={t.id} entry={t} />)}
        </div>
      </GlassCard>
    );
  }

  // Priority 2: Jira comments
  if (comments && comments.length > 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">
          Activity ({comments.length})
        </div>
        <div className="space-y-3 max-h-[500px] overflow-y-auto mt-scroll pr-1" style={{ maxHeight }}>
          {[...comments].reverse().map((c) => {
            const author = c.author?.displayName ?? c.author?.display_name ?? c.author?.name ?? 'Unknown';
            const bodyText = commentBodyToText(c.body);
            const isAdf = c.body && typeof c.body === 'object';
            return (
              <div
                key={c.id}
                className="p-3 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-neutral-200">{author}</span>
                  <span className="text-[10px] text-neutral-500">{timeAgo(c.created)}</span>
                </div>
                {isAdf ? (
                  <AdfCommentBody body={c.body} className="text-[12px] text-neutral-300" issueKey={ticketKey} />
                ) : (
                  <div className="text-[12px] text-neutral-300 whitespace-pre-wrap break-words leading-relaxed">
                    {bodyText || '(empty comment)'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </GlassCard>
    );
  }

  // Priority 3: Conversation JSON
  const conversation = parseConversation(conversationJson ?? null);
  if (conversation.length > 0) {
    return (
      <GlassCard className="p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-3">Conversation History</div>
        <div className="space-y-3 max-h-80 overflow-y-auto" style={{ maxHeight, scrollbarWidth: 'thin', scrollbarColor: '#3a424d transparent' }}>
          {conversation.map((msg, i) => {
            const isAI = msg.role === 'ai' || msg.role === 'assistant' || msg.role === 'bot' || msg.role === 'agent';
            return (
              <div key={i} className="flex gap-3">
                <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: isAI ? 'rgba(94,193,202,0.15)' : 'rgba(124,58,237,0.15)' }}>
                  {isAI ? '\u{1F916}' : '\u{1F4AC}'}
                </div>
                <div className="flex-1 min-w-0">
                  {msg.author && <div className="text-[11px] text-neutral-500 mb-0.5">{msg.author}</div>}
                  <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{msg.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    );
  }

  // Priority 4: Fallback last comments
  if (lastCustomerComment || lastAgentComment) {
    return (
      <GlassCard className="p-4">
        <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Recent Comments</div>
        <div className="space-y-3">
          {lastCustomerComment && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(124,58,237,0.15)' }}>{'\u{1F4AC}'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-neutral-500 mb-0.5">Customer{lastCustomerCommentAt ? ` · ${timeAgo(lastCustomerCommentAt)}` : ''}</div>
                <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{lastCustomerComment}</div>
              </div>
            </div>
          )}
          {lastAgentComment && (
            <div className="flex gap-3">
              <div className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm" style={{ background: 'rgba(94,193,202,0.15)' }}>{'\u{1F916}'}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-neutral-500 mb-0.5">Agent{lastAgentCommentAt ? ` · ${timeAgo(lastAgentCommentAt)}` : ''}</div>
                <div className="text-[13px] text-neutral-300 whitespace-pre-wrap">{lastAgentComment}</div>
              </div>
            </div>
          )}
        </div>
      </GlassCard>
    );
  }

  // Empty state
  return (
    <GlassCard className="p-4">
      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-3">Activity (0)</div>
      <div className="text-[11px] text-neutral-500 py-4 text-center">No comments yet</div>
    </GlassCard>
  );
}
