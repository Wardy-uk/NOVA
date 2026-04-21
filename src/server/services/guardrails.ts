import type { AgentDecision } from './agent-types.js';
import type { SettingsQueries } from '../db/settings-store.js';

export interface GuardrailViolation {
  rule: string;
  severity: 'block' | 'warn';
  detail: string;
}

export interface GuardrailResult {
  allowed: boolean;
  violations: GuardrailViolation[];
}

interface GuardrailRule {
  id: string;
  description: string;
  severity: 'block' | 'warn';
  enabled: boolean;
  check: (decision: AgentDecision) => GuardrailViolation | null;
}

const PROHIBITED_PHRASES = [
  { pattern: /\b(refund|credit|compensat)/i, rule: 'no_financial_promises', desc: 'Never promise refunds, credits, or compensation' },
  { pattern: /\b(blame|fault of|caused by the team|caused by the product)\b/i, rule: 'no_blame', desc: 'Never blame the product, another team, or a specific person' },
  { pattern: /\b(internal note|agent name|internal process)/i, rule: 'no_internal_exposure', desc: 'Never share internal notes, agent names, or internal processes' },
  { pattern: /\b(will be fixed by|will be released|timeline for the fix|eta for|expected release)\b/i, rule: 'no_timeline_commitments', desc: 'Never commit to timelines for bug fixes or feature requests' },
];

function buildDefaultRules(): GuardrailRule[] {
  return [
    {
      id: 'no_close_dev_tier',
      description: 'Never close a ticket at Development tier',
      severity: 'block',
      enabled: true,
      check: (d) => {
        if (d.action !== 'transition') return null;
        const status = (d.inputs.status as string) ?? '';
        const tier = (d.inputs.currentTier as string) ?? '';
        if (tier.toLowerCase().includes('development') || status.toLowerCase().includes('development')) {
          return { rule: 'no_close_dev_tier', severity: 'block', detail: `Cannot close/transition ticket at Development tier (status: ${status}, tier: ${tier})` };
        }
        return null;
      },
    },
    {
      id: 'no_close_waiting_partner',
      description: 'Never close a ticket with status "Waiting on Partner"',
      severity: 'block',
      enabled: true,
      check: (d) => {
        if (d.action !== 'transition') return null;
        const status = (d.inputs.status as string) ?? '';
        if (status.toLowerCase().includes('waiting on partner')) {
          return { rule: 'no_close_waiting_partner', severity: 'block', detail: `Cannot close ticket in "${status}" status` };
        }
        return null;
      },
    },
    {
      id: 'no_priority_change_without_reason',
      description: 'Never change priority without logging the reason',
      severity: 'block',
      enabled: true,
      check: (d) => {
        if (d.action !== 'update_fields') return null;
        const fields = d.output.fields as Record<string, unknown> | undefined;
        if (!fields?.priority) return null;
        const priorityReason = d.output.priority_reason as string | undefined;
        if (!priorityReason && !d.reasoning) {
          return { rule: 'no_priority_change_without_reason', severity: 'block', detail: 'Priority change attempted without documented reason' };
        }
        return null;
      },
    },
    {
      id: 'ticket_ref_in_response',
      description: 'Customer-facing responses must include ticket reference',
      severity: 'warn',
      enabled: true,
      check: (d) => {
        if (d.action !== 'draft_response' && d.action !== 'respond' && d.action !== 'chase') return null;
        const draft = (d.output.draft_response as string) ?? (d.output.response as string) ?? '';
        if (!draft) return null;
        if (!draft.includes(d.ticketKey)) {
          return { rule: 'ticket_ref_in_response', severity: 'warn', detail: `Draft response does not include ticket reference ${d.ticketKey}` };
        }
        return null;
      },
    },
    ...PROHIBITED_PHRASES.map(p => ({
      id: p.rule,
      description: p.desc,
      severity: 'block' as const,
      enabled: true,
      check: (d: AgentDecision): GuardrailViolation | null => {
        const draft = (d.output.draft_response as string) ?? (d.output.response as string) ?? '';
        if (!draft) return null;
        const match = draft.match(p.pattern);
        if (match) {
          return { rule: p.rule, severity: 'block', detail: `${p.desc} — matched: "${match[0]}"` };
        }
        return null;
      },
    })),
  ];
}

export class Guardrails {
  private rules: GuardrailRule[];
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
    this.rules = buildDefaultRules();
    this.loadCustomRules();
  }

  validate(decision: AgentDecision): GuardrailResult {
    const violations: GuardrailViolation[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      const violation = rule.check(decision);
      if (violation) {
        violations.push(violation);
      }
    }

    const blocked = violations.some(v => v.severity === 'block');
    return { allowed: !blocked, violations };
  }

  getRules(): Array<{ id: string; description: string; severity: string; enabled: boolean }> {
    return this.rules.map(r => ({
      id: r.id,
      description: r.description,
      severity: r.severity,
      enabled: r.enabled,
    }));
  }

  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    this.saveCustomRules();
    return true;
  }

  private loadCustomRules(): void {
    try {
      const json = this.settings.get('agent_guardrail_overrides');
      if (!json) return;
      const overrides = JSON.parse(json) as Record<string, { enabled?: boolean }>;
      for (const [id, override] of Object.entries(overrides)) {
        const rule = this.rules.find(r => r.id === id);
        if (rule && typeof override.enabled === 'boolean') {
          rule.enabled = override.enabled;
        }
      }
    } catch {
      // ignore malformed config
    }
  }

  private saveCustomRules(): void {
    const overrides: Record<string, { enabled: boolean }> = {};
    for (const rule of this.rules) {
      overrides[rule.id] = { enabled: rule.enabled };
    }
    this.settings.set('agent_guardrail_overrides', JSON.stringify(overrides));
  }
}
