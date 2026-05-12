import { useMemo } from 'react';
import { getTier } from '../utils/taskHelpers.js';
import type { Task } from '../../shared/types.js';

// ── Types ──

export interface BriefFields {
  summary?: string;
  status?: { name?: string } | string;
  reporter?: { displayName?: string } | null;
  assignee?: { displayName?: string } | null;
  updated?: string;
  customfield_12981?: { value?: string } | string;
  customfield_13184?: unknown; // TL;DR (ADF or string)
  customfield_13185?: unknown; // Agent Summary
  customfield_13186?: { value?: string; name?: string } | string | null; // Escalation Reason
  customfield_13212?: unknown; // Troubleshooting Performed
  customfield_13213?: unknown; // Environment
  customfield_13214?: unknown; // Expected Outcome
  description?: unknown;
  [k: string]: unknown;
}

export interface TicketBriefCardProps {
  ticketKey: string;
  fields: BriefFields;
  tier?: string | null;
  compact?: boolean;
}

// ── ADF → plain text ──

function adfToText(adf: unknown): string {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;
  try {
    const walk = (node: any): string => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (node.text) return node.text;
      if (Array.isArray(node.content)) return node.content.map(walk).join('');
      return '';
    };
    return walk(adf);
  } catch { return ''; }
}

// ── Tier-aware field selection ──

type BriefFieldKey = 'tldr' | 'escalationReason' | 'agentSummary' | 'troubleshooting' | 'expectedOutcome' | 'environment';

const TIER_FIELDS: Record<string, BriefFieldKey[]> = {
  t1: ['tldr', 'troubleshooting'],
  t2: ['tldr', 'escalationReason', 'agentSummary', 'troubleshooting'],
  t3: ['tldr', 'escalationReason', 'agentSummary', 'troubleshooting', 'expectedOutcome', 'environment'],
  default: ['tldr', 'escalationReason', 'agentSummary', 'troubleshooting', 'expectedOutcome', 'environment'],
};

export function getBriefFieldsForTier(tier: string | null | undefined): BriefFieldKey[] {
  if (!tier) return TIER_FIELDS.default;
  const normalized = tier.toLowerCase().replace(/\s+/g, '').replace(/tier/i, 't');
  if (normalized.includes('1') || normalized === 't1') return TIER_FIELDS.t1;
  if (normalized.includes('2') || normalized === 't2') return TIER_FIELDS.t2;
  return TIER_FIELDS.t3;
}

// ── Visual primitives ──

function BriefField({ label, value, mono }: { label: string; value: string | undefined | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold mb-1.5">{label}</div>
      <div
        className={`leading-relaxed whitespace-pre-wrap break-words ${mono ? 'font-mono text-[12px] text-emerald-200' : 'text-[13px] text-neutral-50'}`}
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px',
          padding: '12px 14px',
          maxHeight: mono ? '320px' : 'none',
          overflowY: mono ? 'auto' : 'visible',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function TierChip({ tier }: { tier: string }) {
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(155,106,237,0.15)', color: '#c4b5fd', border: '1px solid rgba(155,106,237,0.3)' }}
    >
      {tier}
    </span>
  );
}

// ── Main component ──

export function TicketBriefCard({ ticketKey, fields, tier, compact }: TicketBriefCardProps) {
  const resolved = useMemo(() => {
    const tldr = adfToText(fields.customfield_13184);
    const agentSummary = adfToText(fields.customfield_13185);
    const troubleshooting = adfToText(fields.customfield_13212);
    const expectedOutcome = adfToText(fields.customfield_13214);
    const environment = adfToText(fields.customfield_13213);
    const rawEsc = fields.customfield_13186;
    const escalationReason = typeof rawEsc === 'string' ? rawEsc
      : (rawEsc && typeof rawEsc === 'object') ? ((rawEsc as any).value ?? (rawEsc as any).name ?? null)
      : null;
    const description = adfToText(fields.description);
    const bcAccountNumber = (fields.customfield_14626 as string) ?? (fields as any).bc_account_number ?? null;
    return { tldr, agentSummary, troubleshooting, expectedOutcome, environment, escalationReason, description, bcAccountNumber };
  }, [fields]);

  const visibleFields = getBriefFieldsForTier(tier);
  const hasAnyBrief = resolved.tldr || resolved.agentSummary || resolved.troubleshooting || resolved.expectedOutcome;

  const fieldMap: Record<BriefFieldKey, { label: string; value: string | null; mono?: boolean }> = {
    tldr: { label: 'TL;DR', value: resolved.tldr || null },
    escalationReason: { label: 'Escalation Reason', value: resolved.escalationReason },
    agentSummary: { label: 'Agent Summary', value: resolved.agentSummary || null },
    troubleshooting: { label: 'Troubleshooting Performed', value: resolved.troubleshooting || null, mono: true },
    expectedOutcome: { label: 'Expected Outcome', value: resolved.expectedOutcome || null },
    environment: { label: 'Environment', value: resolved.environment || null, mono: true },
  };

  return (
    <div
      className={`rounded-2xl overflow-hidden ${compact ? 'p-3' : 'p-5'}`}
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.015) 100%)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="text-[11px] uppercase tracking-wider text-[#c4b5fd] font-bold">
          ⌘ The Brief
        </div>
        <span className="text-[11px] font-mono font-bold text-[#5ec1ca]">{ticketKey}</span>
        {tier && <TierChip tier={tier} />}
        {fields.status && (
          <span className="text-[10px] text-neutral-500">
            · {typeof fields.status === 'string' ? fields.status : fields.status.name}
          </span>
        )}
      </div>

      {/* BC Account Number — always shown */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[#94a3b8] font-bold">BC Account</span>
        {resolved.bcAccountNumber ? (
          <span className="text-[13px] text-amber-300 font-mono font-semibold">{resolved.bcAccountNumber}</span>
        ) : (
          <span className="text-[11px] text-red-400 italic">Not set</span>
        )}
      </div>

      {/* Brief fields — tier-aware */}
      {visibleFields.map((key) => {
        const f = fieldMap[key];
        return <BriefField key={key} label={f.label} value={f.value} mono={f.mono} />;
      })}

      {/* Fallback: show description if no escalation macro fields */}
      {!hasAnyBrief && resolved.description && (
        <BriefField label="Description" value={resolved.description} />
      )}

      {/* Empty state */}
      {!hasAnyBrief && !resolved.description && (
        <div className="text-[11px] text-neutral-500 italic p-4 text-center">
          No escalation brief captured — this ticket may have been transitioned without using the escalation screen.
        </div>
      )}
    </div>
  );
}

// ── Helper to extract brief props from a Task object ──

export function briefPropsFromTask(task: Task): TicketBriefCardProps | null {
  if (task.source !== 'jira') return null;
  const rd = (task.raw_data && typeof task.raw_data === 'object') ? task.raw_data as Record<string, unknown> : null;
  if (!rd) return null;

  const fields = rd as BriefFields;
  const tier = getTier(task);
  const ticketKey = task.source_id || task.title?.match(/^[A-Z]+-\d+/)?.[0] || '';

  return { ticketKey, fields, tier };
}
