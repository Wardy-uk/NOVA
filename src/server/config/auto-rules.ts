import { z } from 'zod';

// ── Match Operators ──

const EqualsOp = z.object({ equals: z.string() });
const ContainsOp = z.object({ contains: z.string() });
const StartsWithOp = z.object({ startsWith: z.string() });
const StartsWithAnyOp = z.object({ startsWithAny: z.array(z.string()).min(1) });
const ContainsAllOp = z.object({ containsAll: z.array(z.string()).min(1) });
const RegexOp = z.object({ regex: z.string() });

const MatchOperator = z.union([EqualsOp, ContainsOp, StartsWithOp, StartsWithAnyOp, ContainsAllOp, RegexOp]);

const MatchBlock = z.object({
  subject: MatchOperator.optional(),
  description: MatchOperator.optional(),
  reporter_email: MatchOperator.optional(),
}).refine(m => m.subject || m.description || m.reporter_email, {
  message: 'At least one match field required',
});

// ── Conditional ──

const DuplicateConditional = z.object({
  type: z.literal('duplicate_open_ticket'),
  sameSubject: z.literal(true),
  sameReporter: z.literal(true).optional(),
});

const PreEmptionConditional = z.object({
  type: z.literal('pre_emption'),
  /** Max failed attempts before permanently skipping this ticket */
  maxRetries: z.number().int().positive().optional().default(3),
  /** Comment body substrings that indicate a human or automation already actioned this */
  actionedIndicators: z.array(z.string()).optional(),
});

const Conditional = z.discriminatedUnion('type', [DuplicateConditional, PreEmptionConditional]);

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
  requestType: z.string().optional(),
  priority: z.string().optional(),
});

const PluginToTpjAction = z.object({
  type: z.literal('plugin_to_tpj'),
});

const AbuseReportAction = z.object({
  type: z.literal('abuse_report'),
});

const AssignAction = z.object({
  type: z.literal('assign'),
  team: z.string(),
  comment: z.string(),
  note: z.string().optional(),
});

const TagAction = z.object({
  type: z.literal('tag'),
  note: z.string(),
  sub_category: z.string().optional(),
});

const RuleAction = z.discriminatedUnion('type', [CloseAction, SetTierAction, PluginToTpjAction, AbuseReportAction, AssignAction, TagAction]);

// ── Rule Schema ──

export const AutoRuleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'Rule ID must be lowercase alphanumeric with hyphens'),
  match: MatchBlock,
  /** 'all' = every field must match (default). 'any' = at least one field must match. */
  matchMode: z.enum(['all', 'any']).optional().default('all'),
  conditional: Conditional.optional(),
  action: RuleAction,
  dailyCap: z.number().int().positive().optional(),
  caseInsensitive: z.boolean().optional().default(true),
  /** If true, this rule requires human approval before executing (e.g. abuse_report phase A) */
  requiresApproval: z.boolean().optional().default(false),
});

export type AutoRule = z.infer<typeof AutoRuleSchema>;
export type AutoRuleAction = z.infer<typeof RuleAction>;

// ── Initial Rules ──

const RULES_RAW: unknown[] = [
  // ── Hybrid detector replacements (WP-69) ──
  // These replace HybridActionDetector — all plugin/abuse detection now lives here.

  {
    id: 'smart-plugin-tpj',
    match: {
      subject: { regex: '\\d+\\s+plugins?\\s+(?:were|was)\\s+not\\s+updated' },
      reporter_email: { equals: 'smart.plugin.manager@wpengine.com' },
    },
    matchMode: 'any',
    conditional: { type: 'pre_emption', maxRetries: 3, actionedIndicators: ['moved your request into'] },
    action: { type: 'plugin_to_tpj' },
  },
  {
    id: 'smart-plugin-connect-fail',
    match: {
      subject: { contains: 'Smart Plugin Manager could not connect' },
    },
    conditional: { type: 'pre_emption', maxRetries: 3, actionedIndicators: ['moved your request into'] },
    action: { type: 'plugin_to_tpj' },
  },
  {
    id: 'smart-plugin-persistent-fail',
    match: {
      subject: { contains: 'consistently failing to update' },
    },
    conditional: { type: 'pre_emption', maxRetries: 3, actionedIndicators: ['moved your request into'] },
    action: { type: 'plugin_to_tpj' },
  },
  {
    id: 'abuse-report',
    match: {
      subject: { equals: 'Received Abuse Report' },
      description: { containsAll: ['Instance ID:', 'Contact ID:', 'Instance URL:'] },
    },
    conditional: { type: 'pre_emption', maxRetries: 3, actionedIndicators: ['Abuse report processed', 'n8n Automations'] },
    action: { type: 'abuse_report' },
    requiresApproval: true,
  },

  // ── Existing auto-close rules ──

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
      subject: { contains: 'Triggers Not Firing Report' },
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
      subject: {
        startsWithAny: [
          'MWU Live Morning Report',
          'BriefYourMarket Scheduled Report: DW check',
        ],
      },
    },
    action: {
      type: 'set_tier',
      tier: 'Tier 2',
      requestType: 'Incident',
      priority: 'Critical',
      note: 'MWU/DW check report routed to Tier 2 as Critical Incident.',
    },
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
    id: 'general-same-reporter-dedup',
    match: {
      subject: { regex: '.{10,}' },
    },
    conditional: { type: 'duplicate_open_ticket', sameSubject: true, sameReporter: true },
    action: { type: 'close', resolution: 'Duplicate', note: 'Auto-closed — same reporter already has an open ticket with an identical subject.' },
  },
  {
    id: 'cia-letter-assign',
    match: {
      subject: { equals: 'CIA Letter Alerting' },
    },
    action: {
      type: 'assign',
      team: 'Customer Care',
      comment: 'This CIA Letter alert has been assigned for triage. Please check the CIA instance to confirm letters are being processed correctly.',
      note: 'Auto-assigned by NOVA — CIA Letter Alerting ticket, routed to Customer Care for CIA instance verification.',
    },
  },
  // ── Vendor / spam / non-support email auto-close (Snag 1 — NT-18602) ──
  // These catch automated vendor emails, subscription notifications, marketing,
  // and system notifications that are not customer support requests.
  {
    id: 'vendor-subscription-notification',
    match: {
      subject: { regex: '\\b(?:subscription|renewal|billing|payment|receipt|invoice)\\s+(?:confirmation|notification|reminder|update|receipt|processed|successful|renewed|auto-renewed)\\b' },
    },
    matchMode: 'all',
    action: {
      type: 'close',
      resolution: 'No Fault Found',
      note: 'Vendor/subscription notification — not a support request. Auto-closed by NOVA.',
    },
  },
  {
    id: 'vendor-domain-autoclose',
    match: {
      reporter_email: { regex: '@(?:cookieyes\\.com|stripe\\.com|sendgrid\\.(?:com|net)|mailchimp\\.com|hubspot\\.com|intercom\\.io|zendesk\\.com|freshdesk\\.com|wpengine\\.com|cloudflare\\.com|github\\.com|azure(?:comm)?\\.com|noreply\\..*|no-reply\\..*)$' },
      subject: { regex: '\\b(?:subscription|renewal|billing|payment|receipt|invoice|notification|alert|update|reminder|newsletter|digest|summary|report|usage)\\b' },
    },
    matchMode: 'any',
    action: {
      type: 'close',
      resolution: 'No Fault Found',
      note: 'Non-support email from known vendor/automated domain. Auto-closed by NOVA.',
    },
  },
  {
    id: 'noreply-automated-email',
    match: {
      reporter_email: { regex: '^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster)@' },
    },
    action: {
      type: 'close',
      resolution: 'No Fault Found',
      note: 'Automated system email (noreply/mailer-daemon). Auto-closed by NOVA.',
    },
  },

  // ── Supplier / Vendor invoice routing (Bug 1 — NT-18458) ──
  // These remain as tag-only for finance routing (invoices need human review)
  {
    id: 'supplier-invoice-domain',
    match: {
      reporter_email: { regex: '@(?:heartinternet\\.co\\.uk|heart\\.co\\.uk)$' },
    },
    action: {
      type: 'tag',
      note: 'Supplier / Vendor invoice detected (matched sender domain). Leaving open for manual routing to finance.',
      sub_category: 'Supplier / Vendor',
    },
  },
  {
    id: 'supplier-invoice-subject',
    match: {
      subject: { regex: '\\b(?:invoice|payment confirmation|payment received|statement of account|remittance advice)\\b' },
    },
    action: {
      type: 'tag',
      note: 'Supplier / Vendor invoice detected (matched subject keywords). Leaving open for manual routing to finance.',
      sub_category: 'Supplier / Vendor',
    },
  },

  // ── Template change routing to Production (Snag 8 — NT-18609) ──
  {
    id: 'template-change-subject',
    match: {
      subject: { regex: '\\b(?:template|campaign\\s+template|email\\s+template|design\\s+amend|colour\\s+change|color\\s+change|header\\s+change|footer\\s+change|font\\s+change|layout\\s+change|html\\s+template|test\\s+of\\s+html)\\b' },
    },
    action: {
      type: 'set_tier',
      tier: 'Production',
      requestType: 'Service Request',
      note: 'Template/design change request detected — routed to Production team (Kayleigh/Isabel).',
    },
  },
  {
    id: 'template-change-description',
    match: {
      description: { regex: '#[0-9a-fA-F]{3,8}|\\b(?:template\\s+(?:change|update|amend|edit|modif)|design\\s+(?:change|update|amend)|brand(?:ing)?\\s+(?:change|update)|colour\\s+scheme|color\\s+scheme)\\b' },
      subject: { regex: '\\b(?:template|design|brand|html|campaign)\\b' },
    },
    matchMode: 'all',
    action: {
      type: 'set_tier',
      tier: 'Production',
      requestType: 'Service Request',
      note: 'Template/design change request detected (hex colours or design keywords in description) — routed to Production team (Kayleigh/Isabel).',
    },
  },

  {
    id: 'product-cancellation',
    match: {
      subject: {
        // Match all "Product Cancellation - X" EXCEPT products that need manual processing:
        //   - BriefYourMarket (requires CRM deprovisioning)
        //   - LeadPro variants except (Social - *) (require platform changes)
        // Excluded: BriefYourMarket, LeadPro, LeadPro (Autocaller), LeadPro (Dashboard),
        //           LeadPro (Instant Valuation Tool), LeadPro (Lead Responder)
        regex: '^Product Cancellation - (?!BriefYourMarket |LeadPro(?! \\(Social))',
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
