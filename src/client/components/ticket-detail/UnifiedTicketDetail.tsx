import { useRef, type ReactNode } from 'react';
import { GlassCard, StatusPill, isObj, timeAgo } from '../queue/index.js';
import { TicketBriefCard, type BriefFields } from '../TicketBriefCard.js';
import { AINextActionCard } from '../AINextActionCard.js';
import { AIAnalysisPanel } from '../AIAnalysisPanel.js';
import { TicketDetailsGrid } from './TicketDetailsGrid.js';
import { CommentComposer, type CommentComposerHandle } from './CommentComposer.js';
import { ActivityStream } from './ActivityStream.js';
import { TransitionBar } from './TransitionBar.js';
import { RiskFactorsCard } from './RiskFactorsCard.js';
import { ProposedResolutionCard } from './ProposedResolutionCard.js';
import { KBSourcesCard } from './KBSourcesCard.js';

export interface UnifiedTicketDetailProps {
  ticketKey: string;

  issue?: Record<string, unknown> | null;
  queueFields?: Record<string, unknown>;
  approvalRecord?: Record<string, unknown> | null;

  badges?: ReactNode;
  headerActions?: ReactNode;

  aiNextAction?: {
    forceGenerate?: boolean;
    compact?: boolean;
    pendingDecision?: any;
    onDecisionActioned?: () => void;
    callbacks?: Record<string, () => void>;
  };
  aiAnalysis?: {
    pendingApproval?: { id: number; status: string } | null;
    onApprovalActioned?: () => void;
    onUseDraft?: (draft: string) => void;
  };

  comments?: any[];
  transitions?: any[];
  conversationJson?: string;
  lastCustomerComment?: string;
  lastCustomerCommentAt?: string;
  lastAgentComment?: string;
  lastAgentCommentAt?: string;
  threadEntries?: any[];
  riskFactors?: any[];
  riskScore?: number;
  kbSources?: Array<{ title: string; url: string }>;
  proposedResolution?: string;
  proposedResolutionEditable?: boolean;
  onProposedResolutionEdit?: (newText: string) => void;

  compact?: boolean;
  editable?: boolean;
  commentConfig?: {
    internalOnly?: boolean;
    aiDraftSupport?: boolean;
    taggedAuthor?: string;
  };

  onRefresh?: () => void;
  onFieldChange?: (field: string, value: unknown) => void;

  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;

  briefFields?: BriefFields | null;
  briefTier?: string | null;

  aiDecisionContext?: ReactNode;

  threadComposer?: ReactNode;
}

function extractStr(obj: unknown, key: string): string {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  const v = o[key];
  if (typeof v === 'string') return v;
  if (isObj(v)) {
    if (typeof v.displayName === 'string') return v.displayName;
    if (typeof v.name === 'string') return v.name;
    if (typeof v.value === 'string') return v.value;
  }
  return '';
}

export function UnifiedTicketDetail(props: UnifiedTicketDetailProps) {
  const {
    ticketKey, issue, queueFields, badges, headerActions,
    aiNextAction, aiAnalysis,
    comments, transitions, conversationJson,
    lastCustomerComment, lastCustomerCommentAt, lastAgentComment, lastAgentCommentAt,
    threadEntries,
    riskFactors, riskScore, kbSources,
    proposedResolution, proposedResolutionEditable, onProposedResolutionEdit,
    compact, editable, commentConfig,
    onRefresh, onFieldChange,
    primaryActions, secondaryActions,
    briefFields, briefTier,
    aiDecisionContext, threadComposer,
  } = props;

  const composerRef = useRef<CommentComposerHandle>(null);

  const summary = (issue?.summary as string) ?? (queueFields?.summary as string) ?? (queueFields?.ticket_summary as string) ?? ticketKey;
  const statusName = issue?.status
    ? (isObj(issue.status) ? (issue.status as any).name : String(issue.status))
    : (queueFields?.status as string) ?? (queueFields?.ticket_status as string) ?? '';
  const reporter = extractStr(issue, 'reporter') || (queueFields?.reporter as string) || (queueFields?.reporter_name as string) || '';
  const updated = (issue?.updated as string) ?? (queueFields?.updated as string) ?? null;
  const score = queueFields?.score as number | undefined;

  const handleUseDraft = (draft: string) => {
    composerRef.current?.setDraft(draft);
    composerRef.current?.setType('public');
    aiAnalysis?.onUseDraft?.(draft);
  };

  const handleRefresh = () => {
    onRefresh?.();
  };

  // Build brief fields from issue or explicit briefFields
  const computedBriefFields: BriefFields | null = briefFields ?? (issue as BriefFields | null);
  const computedBriefTier = briefTier ?? (() => {
    const tierRaw = issue?.customfield_12981;
    return typeof tierRaw === 'string' ? tierRaw : (tierRaw as any)?.value ?? null;
  })();

  const padding = compact ? 'p-3' : 'p-4';

  return (
    <>
      {/* Header */}
      <GlassCard accent className={padding}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <a
                href={`https://nurturtech.atlassian.net/browse/${ticketKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-mono font-bold text-[#5ec1ca] hover:underline"
              >
                {ticketKey}
              </a>
              {statusName && <StatusPill status={statusName} />}
              {badges}
            </div>
            <h2
              className="text-xl font-bold text-neutral-100 leading-tight"
              style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
            >
              {summary}
            </h2>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-neutral-300 flex-wrap">
              {reporter && (
                <>
                  <span>Reporter: <span className="text-neutral-100 font-semibold">{reporter}</span></span>
                  <span className="text-neutral-600">{'·'}</span>
                </>
              )}
              {updated && (
                <>
                  <span>Updated <span className="text-neutral-100">{timeAgo(updated)}</span> ago</span>
                  <span className="text-neutral-600">{'·'}</span>
                </>
              )}
              {score != null && <span className="text-[10px] text-neutral-500">Score: {score}</span>}
            </div>
          </div>
          {headerActions && (
            <div className="flex items-center gap-2 shrink-0">
              {headerActions}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Body: two-column grid */}
      <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* Left column: info + AI */}
        <div className="space-y-4">
          {computedBriefFields && (
            <TicketBriefCard ticketKey={ticketKey} fields={computedBriefFields} tier={computedBriefTier} compact={compact} />
          )}

          {aiNextAction && (
            <AINextActionCard
              ticketKey={ticketKey}
              compact={aiNextAction.compact}
              forceGenerate={aiNextAction.forceGenerate}
              pendingDecision={aiNextAction.pendingDecision}
              onDecisionActioned={aiNextAction.onDecisionActioned}
            />
          )}

          {aiAnalysis && (
            <AIAnalysisPanel
              ticketKey={ticketKey}
              pendingApproval={aiAnalysis.pendingApproval}
              onApprovalActioned={aiAnalysis.onApprovalActioned}
              onUseDraft={handleUseDraft}
            />
          )}

          {aiDecisionContext}

          <RiskFactorsCard
            ticketKey={ticketKey}
            riskFactors={riskFactors}
            riskScore={riskScore}
          />

          <ProposedResolutionCard
            responseText={proposedResolution}
            editable={proposedResolutionEditable}
            onEdit={onProposedResolutionEdit}
          />

          <KBSourcesCard sources={kbSources} />

          <TicketDetailsGrid
            issue={issue ?? null}
            queueFields={queueFields}
            editable={editable}
            onFieldChange={onFieldChange}
            ticketKey={ticketKey}
          />

          {primaryActions}
          {secondaryActions}
        </div>

        {/* Right column: transitions + comments + activity */}
        <div className="space-y-4">
          {transitions && transitions.length > 0 && (
            <TransitionBar
              ticketKey={ticketKey}
              transitions={transitions}
              onTransitioned={handleRefresh}
            />
          )}

          {threadComposer ?? (
            <CommentComposer
              ref={composerRef}
              ticketKey={ticketKey}
              onCommentPosted={handleRefresh}
              internalOnly={commentConfig?.internalOnly}
              aiDraftSupport={commentConfig?.aiDraftSupport}
              taggedAuthor={commentConfig?.taggedAuthor}
            />
          )}

          <ActivityStream
            ticketKey={ticketKey}
            comments={comments}
            conversationJson={conversationJson}
            lastCustomerComment={lastCustomerComment}
            lastCustomerCommentAt={lastCustomerCommentAt}
            lastAgentComment={lastAgentComment}
            lastAgentCommentAt={lastAgentCommentAt}
            threadEntries={threadEntries}
          />
        </div>
      </div>
    </>
  );
}
