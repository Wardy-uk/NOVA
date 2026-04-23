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

export interface CustomGuardrailDef {
  id: string;
  description: string;
  severity: 'block' | 'warn';
  pattern: string;
  enabled: boolean;
}

const BUILTIN_IDS = new Set<string>();

export class Guardrails {
  private rules: GuardrailRule[];
  private settings: SettingsQueries;

  constructor(settings: SettingsQueries) {
    this.settings = settings;
    this.rules = buildDefaultRules();
    for (const r of this.rules) BUILTIN_IDS.add(r.id);
    this.loadOverrides();
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

  getRules(): Array<{ id: string; description: string; severity: string; enabled: boolean; builtin: boolean; pattern?: string }> {
    return this.rules.map(r => ({
      id: r.id,
      description: r.description,
      severity: r.severity,
      enabled: r.enabled,
      builtin: BUILTIN_IDS.has(r.id),
      ...(!BUILTIN_IDS.has(r.id) && (r as any)._pattern ? { pattern: (r as any)._pattern } : {}),
    }));
  }

  setRuleEnabled(ruleId: string, enabled: boolean): boolean {
    const rule = this.rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    this.saveOverrides();
    return true;
  }

  addCustomRule(def: CustomGuardrailDef): { ok: boolean; error?: string } {
    if (BUILTIN_IDS.has(def.id)) return { ok: false, error: 'Cannot use a built-in rule ID' };
    if (this.rules.find(r => r.id === def.id)) return { ok: false, error: 'Rule ID already exists' };
    if (!def.id.match(/^[a-z0-9_]+$/)) return { ok: false, error: 'Rule ID must be lowercase alphanumeric with underscores' };
    try { new RegExp(def.pattern, 'i'); } catch { return { ok: false, error: 'Invalid regex pattern' }; }
    this.rules.push(this.buildCustomRule(def));
    this.saveCustomRules();
    return { ok: true };
  }

  updateCustomRule(ruleId: string, def: Partial<CustomGuardrailDef>): { ok: boolean; error?: string } {
    if (BUILTIN_IDS.has(ruleId)) return { ok: false, error: 'Cannot edit built-in rules' };
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return { ok: false, error: 'Rule not found' };
    if (def.pattern) {
      try { new RegExp(def.pattern, 'i'); } catch { return { ok: false, error: 'Invalid regex pattern' }; }
    }
    const existing = this.getCustomDefs().find(d => d.id === ruleId);
    if (!existing) return { ok: false, error: 'Custom rule data not found' };
    const updated = { ...existing, ...def, id: ruleId };
    this.rules[idx] = this.buildCustomRule(updated);
    this.saveCustomRules();
    return { ok: true };
  }

  deleteCustomRule(ruleId: string): { ok: boolean; error?: string } {
    if (BUILTIN_IDS.has(ruleId)) return { ok: false, error: 'Cannot delete built-in rules' };
    const idx = this.rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return { ok: false, error: 'Rule not found' };
    this.rules.splice(idx, 1);
    this.saveCustomRules();
    return { ok: true };
  }

  private buildCustomRule(def: CustomGuardrailDef): GuardrailRule {
    const regex = new RegExp(def.pattern, 'i');
    const rule: GuardrailRule & { _pattern: string } = {
      id: def.id,
      description: def.description,
      severity: def.severity,
      enabled: def.enabled,
      _pattern: def.pattern,
      check: (d: AgentDecision): GuardrailViolation | null => {
        const draft = (d.output.draft_response as string) ?? (d.output.response as string) ?? '';
        if (!draft) return null;
        const match = draft.match(regex);
        if (match) {
          return { rule: def.id, severity: def.severity, detail: `${def.description} — matched: "${match[0]}"` };
        }
        return null;
      },
    };
    return rule;
  }

  private getCustomDefs(): CustomGuardrailDef[] {
    try {
      const json = this.settings.get('agent_custom_guardrails');
      if (!json) return [];
      return JSON.parse(json) as CustomGuardrailDef[];
    } catch { return []; }
  }

  private loadOverrides(): void {
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

  private loadCustomRules(): void {
    for (const def of this.getCustomDefs()) {
      if (!this.rules.find(r => r.id === def.id)) {
        this.rules.push(this.buildCustomRule(def));
      }
    }
  }

  private saveOverrides(): void {
    const overrides: Record<string, { enabled: boolean }> = {};
    for (const rule of this.rules) {
      if (BUILTIN_IDS.has(rule.id)) {
        overrides[rule.id] = { enabled: rule.enabled };
      }
    }
    this.settings.set('agent_guardrail_overrides', JSON.stringify(overrides));
  }

  private saveCustomRules(): void {
    const defs: CustomGuardrailDef[] = [];
    for (const rule of this.rules) {
      if (BUILTIN_IDS.has(rule.id)) continue;
      defs.push({
        id: rule.id,
        description: rule.description,
        severity: rule.severity,
        pattern: (rule as any)._pattern ?? '',
        enabled: rule.enabled,
      });
    }
    this.settings.set('agent_custom_guardrails', JSON.stringify(defs));
  }
}
