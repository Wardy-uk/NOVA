// ── Nurtur Product classification for NOVA closes ──
//
// The single place that decides what NOVA writes into Nurtur Product (customfield_13183)
// and Nurtur Product Sub Category (customfield_14527) when it closes an NT ticket whose
// Product is still empty. Service Delivery owns these tables: change a pattern or a
// mapping here, not at a call site.
//
// Two rules sit above everything in this file, and are enforced in
// utils/jira-resolve-fields.ts, not here:
//   1. A non-empty Product or Sub Category is never overwritten.
//   2. The field is never left empty on a close — the Quick Resolve validator requires it.
//      So when nothing below matches, the answer is Not A Nurtur Product PLUS the
//      `nova-product-unknown` label, which marks it for a human to correct. Not A Nurtur
//      Product is otherwise reserved for genuine noise (section 4.6).
//
// Why this exists: between Jun and Sep 2026 every NOVA close stamped Not A Nurtur Product
// unconditionally, overwriting agent-set values (NT-32366 lost Members Hub / feeds / "Feed
// Issue" to a thank_you close). 4,265 tickets in 90 days; most were alerts or real work.

/** Option values as Jira holds them. Writes go by value (`{ value }`), which Jira resolves
 *  to the option at write time, so these IDs are reference only — used by the backfill
 *  report and for anyone reading a changelog. */
export const NURTUR_PRODUCT_OPTIONS = {
  'Nurtur Direct Communications': '13098',
  'NDC AI Editor': '14473',
  'NDC AFE': '14474',
  'Nurtur Build': '13099',
  'Nurtur Lead Management': '13100',
  'Members Hub': '13101',
  'Starberry Websites': '13102',
  'Yomdel': '13104',
  'Nurtur Referrals': '13105',
  'Know Your Market': '13106',
  'Franchise Hub': '13758',
  'The Property Jungle - IOMart Website': '13759',
  'The Property Jungle - Wordpress Website': '13760',
  'The Property Jungle - M365': '13761',
  'Not A Nurtur Product': '13771',
  'Nexus (and Internal Tooling)': '13837',
  'EcoSystem': '13838',
  'Integrations': '13905',
  'AI': '13906',
  'AI Voice': '14439',
  'AI WhatsApp': '14440',
  'Social': '14652',
  'Finance': '14653',
  'System Alerts': '14654',
} as const;

export type NurturProduct = keyof typeof NURTUR_PRODUCT_OPTIONS;

export const NOT_A_NURTUR_PRODUCT: NurturProduct = 'Not A Nurtur Product';
export const PRODUCT_UNKNOWN_LABEL = 'nova-product-unknown';

export interface ProductClassifyInput {
  summary: string;
  description?: string | null;
  reporterEmail?: string | null;
  /** Why NOVA is closing: a quick-win type (`spam`, `thank_you`, …) or `auto_rule:<id>`. */
  closeKind?: string | null;
  /** Keys of linked issues — an STBY link identifies a Starberry site. */
  linkedIssueKeys?: string[];
}

export interface ProductClassification {
  product: NurturProduct;
  subCategory: string;
  /** Which rule matched, e.g. `4.1:pmta`. `fallback` when nothing did. */
  rule: string;
  confidence: 'high' | 'medium' | 'low';
  /** True only for the no-match fallback: the caller adds PRODUCT_UNKNOWN_LABEL. */
  unknown: boolean;
}

// ── 4.1 System Alerts ── automated monitoring and job output from our own platforms or
// suppliers. Matched on the subject; the WP Engine SPM row also needs the sender.

const WP_ENGINE_SENDER = /@(?:[a-z0-9-]+\.)*wpengine\.com$/i;

/** Smart Plugin Manager alert subjects. Only a match when the sender is WP Engine too —
 *  a customer's "Change of logo on website" is website work, not a plugin alert. */
export const SPM_SUBJECT = /\d+\s+plugins?\s+(?:were|was)\s+(?:not\s+)?updated|(?:theme|plugin)s?\s+(?:is|are)\s+consistently\s+failing|Smart Plugin Manager could not connect to/i;

export function isWpEngineSpmAlert(summary: string, reporterEmail?: string | null): boolean {
  return WP_ENGINE_SENDER.test((reporterEmail ?? '').trim()) && SPM_SUBJECT.test(summary);
}

interface SubjectRule { id: string; pattern: RegExp; subCategory: string }

export const SYSTEM_ALERT_RULES: SubjectRule[] = [
  { id: 'pmta', pattern: /BYM Domains (?:Removed|Will be Removed) From PMTA/i, subCategory: 'NDC - PMTA/DKIM' },
  { id: 'cia-letter', pattern: /CIA Letter Alerting/i, subCategory: 'NDC - CIA Letter Alerting' },
  { id: 'auction-house', pattern: /Auction House Property Alerts/i, subCategory: 'NDC - Auction House Alerts' },
  { id: 'welcome-triggers', pattern: /Welcome trigger contacts OK/i, subCategory: 'NDC - Welcome Triggers' },
  { id: 'triggers-not-firing', pattern: /Triggers Not Firing Report/i, subCategory: 'NDC - Triggers' },
  // The real subject has a long dash before "investigate"; anchor on the start instead.
  { id: 'failed-jobs', pattern: /^Failed Jobs/i, subCategory: 'NDC - Failed Jobs' },
  { id: 'mwu', pattern: /MWU Live Morning Report/i, subCategory: 'Integrations - MWU' },
  { id: 'freedom-leisure', pattern: /Freedom Leisure Integration Check/i, subCategory: 'Integrations - Freedom Leisure' },
  { id: 'pfg', pattern: /PFG Interaction Stats was executed/i, subCategory: 'Integrations - PFG' },
  { id: 'scheduled-reports', pattern: /Digival Report was executed|AllAgentsForPropertySales|AllHouseBuildersForPropertySales/i, subCategory: 'NDC - Scheduled Reports' },
  { id: 'wpe-status', pattern: /WP Engine['’]s Status Page/i, subCategory: 'Websites - WP Engine Status' },
  { id: 'site-monitoring', pattern: /\[site-monitoring\]|is currently down/i, subCategory: 'Websites - Site Monitoring' },
  { id: 'deliverability', pattern: /MxToolbox Blacklist|DMARC weekly digest|Email Security Check Results|Let['’]s Encrypt certificates/i, subCategory: 'NDC - Deliverability' },
  { id: 'cloudamqp', pattern: /\[CloudAMQP\]/i, subCategory: 'Lead Management - Infrastructure' },
  { id: 'property-alerts', pattern: /New property alerts registration|A user has unsubscribed from property alerts/i, subCategory: 'Websites - Property Alerts' },
];

// ── 4.2 Cancellations ── "Product Cancellation - <Product> For <Client>", plus notices of
// termination. The Product is the thing being cancelled, not Not A Nurtur Product.

// Greedy up to the LAST " For ": "Site For Life For Smith & Co" cancels "Site For Life".
export const CANCELLATION_SUBJECT = /^Product Cancellation\s*[-–—]\s*(?:(.+)\s+For\s+.+|(.+))$/i;
const TERMINATION_NOTICE = /notice of termination|termination notice|notice to terminate/i;

/** `website` means apply the website rule (4.4). */
type CancellationTarget = NurturProduct | 'website' | 'feed';

export const CANCELLATION_RULES: Array<{ id: string; pattern: RegExp; target: CancellationTarget }> = [
  // Ad Spend before anything else: "Ad Spend Admin Fee (Search)" is still Social.
  { id: 'social', pattern: /ad\s*spend|management fee\s*\(social\)|\bsocial\b/i, target: 'Social' },
  { id: 'property-boost', pattern: /property boost/i, target: 'Nurtur Lead Management' },
  { id: 'ndc', pattern: /digi-?val|guild package|\bdkim\b|\bspf\b/i, target: 'Nurtur Direct Communications' },
  { id: 'website', pattern: /hosting|database licen[cs]e|can you just|site for life|support\s*(?:&|and)\s*maintenance/i, target: 'website' },
  { id: 'feed', pattern: /\bfeed\b/i, target: 'feed' },
];

/** A feed that goes to a portal / CRM / third party is Integrations; into the client's
 *  own website, the website rule. Neither said → unknown. */
const FEED_TO_THIRD_PARTY = /portal|\bcrm\b|rightmove|zoopla|on\s?the\s?market|\botm\b|reapit|jupix|alto|vebra|dezrez|third[- ]party/i;
const FEED_TO_WEBSITE = /website|\bsite\b/i;

// ── 4.3 Finance ── invoices, remittances, DD changes, payment and billing queries.

export const FINANCE_RULES: SubjectRule[] = [
  { id: 'remittance', pattern: /remittance/i, subCategory: 'Finance - Remittance' },
  { id: 'direct-debit', pattern: /direct\s*debit|\bdd\s+(?:mandate|change|instruction)/i, subCategory: 'Finance - Direct Debit' },
  { id: 'duplicate-payment', pattern: /duplicate\s+payment|paid\s+twice|double\s+(?:charged|payment)/i, subCategory: 'Finance - Duplicate Payment' },
  { id: 'refund', pattern: /\brefund/i, subCategory: 'Finance - Refund' },
  { id: 'statement', pattern: /statement\s+of\s+account|account\s+statement/i, subCategory: 'Finance - Statement' },
  { id: 'billing-details', pattern: /billing\s+(?:details?|address|contact)|change\s+of\s+(?:billing|bank)\s+details|bank\s+details/i, subCategory: 'Finance - Billing Details' },
  { id: 'invoice', pattern: /\binvoices?\b/i, subCategory: 'Finance - Invoice' },
  { id: 'payment', pattern: /\bbalance\b|payment\s+(?:query|queries|confirmation|received|reminder|overdue)|outstanding\s+(?:balance|payment|invoice)|overdue/i, subCategory: 'Finance - Payment Query' },
];

// ── 4.4 Website ── customer website change requests, outages, DNS, CMS, CMP certificates.

export const WEBSITE_REQUEST = /\bwebsite|\bweb\s?site|\bweb\s?page|home\s?page|landing\s+page|office\s+pages?|lettings\s+page|meet\s+the\s+team|\blogo\b|\bdns\b|redirect|\bcms\b|wordpress|cmp\s+certificate|site\s+(?:is\s+)?down/i;

export function websiteProduct(text: string, linkedIssueKeys: string[] = []): { product: NurturProduct; platform: string; confidence: 'high' | 'medium' } {
  if (/starberry/i.test(text) || linkedIssueKeys.some(k => /^STBY-/i.test(k))) {
    return { product: 'Starberry Websites', platform: 'Starberry', confidence: 'high' };
  }
  if (/iomart/i.test(text)) {
    return { product: 'The Property Jungle - IOMart Website', platform: 'IOMart', confidence: 'high' };
  }
  // Platform unknown → the Wordpress site, which is the bulk of the estate (section 4.4).
  return { product: 'The Property Jungle - Wordpress Website', platform: 'Wordpress', confidence: 'medium' };
}

// ── 4.5 Customer product tickets ── NOVA has no LLM product classifier yet, so these are
// deliberately few and unambiguous. Anything they miss falls back to the review label,
// which is the right outcome for a guess.

export const CUSTOMER_PRODUCT_RULES: Array<{ id: string; pattern: RegExp; product: NurturProduct; subCategory: string }> = [
  { id: 'reapit-foundations', pattern: /reapit\s+foundations/i, product: 'Integrations', subCategory: 'Reapit Foundations' },
  // eXp sends one of these per new agent, with an identical subject each time.
  { id: 'exp-new-agent', pattern: /notification of new agent joining/i, product: 'Nurtur Lead Management', subCategory: 'eXp - New Agent Onboarding' },
  { id: 'leadpro', pattern: /lead\s?pro\b/i, product: 'Nurtur Lead Management', subCategory: 'LeadPro' },
  { id: 'members-hub', pattern: /members\s?hub/i, product: 'Members Hub', subCategory: 'Members Hub' },
  { id: 'franchise-hub', pattern: /franchise\s?hub/i, product: 'Franchise Hub', subCategory: 'Franchise Hub' },
  { id: 'kym', pattern: /know\s+your\s+market/i, product: 'Know Your Market', subCategory: 'Know Your Market' },
  { id: 'ai-editor', pattern: /ai\s+editor/i, product: 'NDC AI Editor', subCategory: 'AI Editor' },
  { id: 'ndc', pattern: /briefyourmarket|brief\s+your\s+market|nurtur\s+direct\s+communications|\bndc\b/i, product: 'Nurtur Direct Communications', subCategory: 'NDC' },
];

// ── 4.6 Not A Nurtur Product ── only genuine noise.

/** Close kinds that already mean "noise": quick-win types and the auto-rules that close
 *  vendor, noreply and auto-reply mail. Checked after 4.1/4.2, so a WP Engine status page
 *  that the vendor-domain rule closes is still a System Alert. */
export const NOISE_CLOSE_KINDS: Record<string, string> = {
  spam: 'Spam / Phishing',
  vendor_email: 'Vendor Marketing',
  survey_feedback: 'Vendor Marketing',
  auto_reply: 'Auto-reply / Bounce',
  out_of_office: 'Out of Office',
  'auto_rule:vendor-subscription-notification': 'Vendor Marketing',
  'auto_rule:vendor-domain-autoclose': 'Vendor Marketing',
  'auto_rule:noreply-automated-email': 'Auto-reply / Bounce',
  'auto_rule:auto-reply-out-of-office': 'Out of Office',
};

/** Auto-replies and bounces, by subject prefix or sender. Checked before Finance and
 *  Website: "Automatic reply: Invoice 1234" is an auto-reply, not a finance ticket. */
const AUTO_REPLY_SUBJECT = /^(?:Automatic reply|Auto:|AutoReply|Auto-Reply|Out of Office|OOO:|I am out of the office|Away from the office|On annual leave|Undeliverable|Undelivered Mail|Delivery Status Notification|Mail delivery failed|Delivery has failed|Returned mail)/i;
const BOUNCE_SENDER = /^(?:mailer-daemon|postmaster)@/i;

export const NOISE_RULES: SubjectRule[] = [
  { id: 'job-application', pattern: /job\s+application|application\s+for\s+(?:the\s+)?(?:role|position|post)|\bcv\b|curriculum vitae/i, subCategory: 'Job Application' },
  { id: 'own-marketing-bounce', pattern: /are you missing valuations/i, subCategory: 'Own Marketing Bounce-back' },
  { id: 'supplier-admin', pattern: /\bgdap\b|microsoft\s+partner|microsoft\s+365\s+(?:offer|promotion|trial)|m365\s+(?:offer|promo)/i, subCategory: 'Supplier / Admin Notice' },
  { id: 'third-party-ack', pattern: /ster-?kinekor|\bekco\b|cyber\s+solutions|\[(?:ticket|case|request)\s*#?\s*\d+\]|(?:ticket|case|request)\s+(?:#?\s*\d+\s+)?(?:has\s+been\s+)?(?:received|created|logged|opened)|we\s+have\s+received\s+your\s+(?:request|email|enquiry)/i, subCategory: 'Third-party Ticket Acknowledgement' },
];

// ── Classifier ──

/** Strip reply/forward prefixes so "RE: Product Cancellation - …" still reads as one. */
export function stripReplyPrefixes(summary: string): string {
  return summary.replace(/^(?:\s*(?:re|fw|fwd|aw|tr)\s*:\s*)+/i, '').trim();
}

function result(product: NurturProduct, subCategory: string, rule: string, confidence: ProductClassification['confidence']): ProductClassification {
  return { product, subCategory, rule, confidence, unknown: false };
}

function classifyCancellation(cancelled: string, fullText: string, linked: string[]): ProductClassification {
  const sub = `Cancellation - ${cancelled}`;
  for (const r of CANCELLATION_RULES) {
    if (!r.pattern.test(cancelled)) continue;
    if (r.target === 'website') {
      const w = websiteProduct(fullText, linked);
      return result(w.product, sub, `4.2:${r.id}`, w.confidence);
    }
    if (r.target === 'feed') {
      if (FEED_TO_THIRD_PARTY.test(fullText)) return result('Integrations', sub, '4.2:feed-third-party', 'medium');
      if (FEED_TO_WEBSITE.test(fullText)) {
        const w = websiteProduct(fullText, linked);
        return result(w.product, sub, '4.2:feed-website', 'medium');
      }
      break; // a feed with no destination named → unknown
    }
    return result(r.target, sub, `4.2:${r.id}`, 'high');
  }
  return { product: NOT_A_NURTUR_PRODUCT, subCategory: sub, rule: 'fallback', confidence: 'low', unknown: true };
}

/**
 * Decide the Product for a ticket whose Product is empty. Always returns an answer — the
 * field cannot be left empty on a close — and `unknown: true` when that answer is the
 * fallback rather than a match.
 *
 * Order (first match wins): 4.1 System Alerts → 4.2 Cancellations → noise NOVA has already
 * identified (close kind / auto-reply / bounce) → 4.3 Finance → 4.4 Website → 4.5 Customer
 * product → 4.6 remaining noise patterns → fallback.
 */
export function classifyNurturProduct(input: ProductClassifyInput): ProductClassification {
  const rawSummary = (input.summary ?? '').trim();
  const summary = stripReplyPrefixes(rawSummary);
  const description = input.description ?? '';
  const fullText = `${summary}\n${description}`;
  const linked = input.linkedIssueKeys ?? [];
  const closeKind = input.closeKind ?? '';

  // 4.1 System Alerts
  if (isWpEngineSpmAlert(summary, input.reporterEmail)) {
    return result('System Alerts', 'Websites - WP Engine SPM', '4.1:wpe-spm', 'high');
  }
  for (const r of SYSTEM_ALERT_RULES) {
    if (r.pattern.test(summary)) return result('System Alerts', r.subCategory, `4.1:${r.id}`, 'high');
  }

  // 4.2 Cancellations
  const cancellation = summary.match(CANCELLATION_SUBJECT);
  if (cancellation) return classifyCancellation((cancellation[1] ?? cancellation[2]).trim(), fullText, linked);
  if (TERMINATION_NOTICE.test(summary)) {
    return classifyCancellation(summary, fullText, linked);
  }

  // Noise NOVA has already identified. Ahead of Finance on purpose: phishing dressed as an
  // invoice is 4.6, not 4.3.
  const noiseKind = NOISE_CLOSE_KINDS[closeKind];
  if (noiseKind) return result(NOT_A_NURTUR_PRODUCT, noiseKind, `4.6:${closeKind}`, 'high');
  if (AUTO_REPLY_SUBJECT.test(rawSummary) || BOUNCE_SENDER.test(input.reporterEmail ?? '')) {
    return result(NOT_A_NURTUR_PRODUCT, 'Auto-reply / Bounce', '4.6:auto-reply', 'high');
  }

  // 4.3 Finance
  for (const r of FINANCE_RULES) {
    if (r.pattern.test(summary)) return result('Finance', r.subCategory, `4.3:${r.id}`, 'medium');
  }

  // 4.4 Website
  if (WEBSITE_REQUEST.test(summary)) {
    const w = websiteProduct(fullText, linked);
    return result(w.product, `Website - ${w.platform}`, '4.4:website', w.confidence);
  }

  // 4.5 Customer product — subject first, then the body.
  for (const r of CUSTOMER_PRODUCT_RULES) {
    if (r.pattern.test(summary)) return result(r.product, r.subCategory, `4.5:${r.id}`, 'medium');
  }
  for (const r of CUSTOMER_PRODUCT_RULES) {
    if (r.pattern.test(description)) return result(r.product, r.subCategory, `4.5:${r.id}`, 'low');
  }

  // 4.6 Remaining noise
  for (const r of NOISE_RULES) {
    if (r.pattern.test(fullText)) return result(NOT_A_NURTUR_PRODUCT, r.subCategory, `4.6:${r.id}`, 'medium');
  }

  return { product: NOT_A_NURTUR_PRODUCT, subCategory: 'Unclassified', rule: 'fallback', confidence: 'low', unknown: true };
}
