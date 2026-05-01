import { z } from 'zod';

// ── Match Operators ──

const EqualsOp = z.object({ equals: z.string() });
const ContainsOp = z.object({ contains: z.string() });
const StartsWithOp = z.object({ startsWith: z.string() });
const StartsWithAnyOp = z.object({ startsWithAny: z.array(z.string()).min(1) });
const ContainsAllOp = z.object({ containsAll: z.array(z.string()).min(1) });

const MatchOperator = z.union([EqualsOp, ContainsOp, StartsWithOp, StartsWithAnyOp, ContainsAllOp]);

const MatchBlock = z.object({
  subject: MatchOperator.optional(),
  description: MatchOperator.optional(),
  reporter_email: MatchOperator.optional(),
}).refine(m => m.subject || m.description || m.reporter_email, {
  message: 'At least one match field required',
});

// ── Conditional ──

const Conditional = z.object({
  type: z.literal('duplicate_open_ticket'),
  sameSubject: z.literal(true),
});

// ── Actions ──

const CloseAction = z.object({
  type: z.literal('close'),
  resolution: z.string(),
  note: z.string(),
});

const SetTierAction = z.object({
  type: z.literal('set_tier'),
  tier: z.string(),
  note: z.string(),
});

const PluginToTpjAction = z.object({
  type: z.literal('plugin_to_tpj'),
});

const RuleAction = z.discriminatedUnion('type', [CloseAction, SetTierAction, PluginToTpjAction]);

// ── Rule Schema ──

export const AutoRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Rule ID must be lowercase alphanumeric with hyphens'),
  match: MatchBlock,
  conditional: Conditional.optional(),
  action: RuleAction,
  dailyCap: z.number().int().positive().optional(),
  caseInsensitive: z.boolean().optional().default(true),
});

export type AutoRule = z.infer<typeof AutoRuleSchema>;
export type AutoRuleAction = z.infer<typeof RuleAction>;

// ── Initial Rules ──

const RULES_RAW: unknown[] = [
  {
    id: 'freedom-leisure-integration',
    match: {
      subject: { equals: 'Freedom Leisure Integration Check' },
      description: { contains: 'INTEGRATION RAN!' },
    },
    action: { type: 'close', resolution: 'No Fault Found', note: 'Automated integration health check confirming successful run.' },
  },
  {
    id: 'auction-house-success',
    match: {
      subject: { equals: 'Auction House Property Alerts - Success!' },
      description: { startsWith: 'The Auction House Property Alerts Task On BYM-AAPP01 Has Run Successfully.' },
    },
    action: { type: 'close', resolution: 'No Fault Found', note: 'Automated task success confirmation.' },
  },
  {
    id: 'triggers-not-firing',
    match: {
      reporter_email: { equals: 'trigger@briefyourmarket.com' },
      subject: { equals: 'Triggers Not Firing Report' },
      description: { contains: 'All triggers across BYM look to be working' },
    },
    action: { type: 'close', resolution: 'No Fault Found', note: 'Automated monitoring confirmation — all triggers reported working.' },
  },
  {
    id: 'auction-house-daily-status',
    match: {
      subject: { equals: 'Auction House Property Alerts Daily Task Status' },
      description: { containsAll: ['Last Result Code: 0', 'Result Meaning: Success'] },
    },
    action: { type: 'close', resolution: 'No Fault Found', note: 'Automated daily task status — successful run.' },
  },
  {
    id: 'digival-report-success',
    match: {
      subject: { startsWith: 'Digival Report was executed at' },
      description: { startsWith: 'Digival Usage' },
    },
    action: { type: 'close', resolution: 'No Fault Found', note: 'Automated Digival usage report — informational, no action required.' },
  },
  {
    id: 'mwu-tier-2',
    match: {
      subject: { equals: 'MWU Live Morning Report' },
    },
    action: { type: 'set_tier', tier: 'Tier 2', note: 'MWU morning report routed to Tier 2.' },
  },
  {
    id: 'smart-plugin-tpj',
    match: {
      subject: { startsWith: 'Smart Plugin Manager could not connect to' },
    },
    action: { type: 'plugin_to_tpj' },
  },
  {
    id: 'cia-letter-dedup',
    match: {
      subject: { equals: 'CIA Letter Alerting' },
    },
    conditional: { type: 'duplicate_open_ticket', sameSubject: true },
    action: { type: 'close', resolution: 'Duplicate', note: 'Auto-closed — duplicate of an existing open CIA Letter Alerting ticket.' },
  },
  {
    id: 'product-cancellation',
    match: {
      subject: {
        startsWithAny: [
          'Product Cancellation - Google SEO',
          'Product Cancellation - Ad Spend',
          'Product Cancellation - LeadPro (Social - Ad Spend)',
          'Product Cancellation - Management Fee',
          'Product Cancellation - Digital Marketing',
          'Product Cancellation - Communications Managed',
          'Product Cancellation - LeadPro (Social - Management Fee)',
        ],
      },
    },
    action: { type: 'close', resolution: 'No Fault Found', note: 'Automated product cancellation notification — informational, no action required.' },
  },
];

// Validate at import time — if this fails, the module throws and the engine refuses to start
export const AUTO_RULES: AutoRule[] = RULES_RAW.map((raw, i) => {
  const result = AutoRuleSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.issues.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
    throw new Error(`Auto-rule validation failed at index ${i}:\n${errors}`);
  }
  return result.data;
});

// Verify unique IDs
const ids = new Set<string>();
for (const rule of AUTO_RULES) {
  if (ids.has(rule.id)) throw new Error(`Duplicate auto-rule ID: '${rule.id}'`);
  ids.add(rule.id);
}
