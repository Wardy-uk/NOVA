import { z } from 'zod';
import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { PortalJiraService } from './portal-jira.js';
import type { PortalIntakeService } from './portal-intake.js';
import type { PortalChatSession, PortalChatMessage } from '../../shared/portal-types.js';
import type { IntakeSessionMetadata, IntakeCollectedFields, ChatMessageMetadata } from '../../shared/portal-types.js';
import { trackEvent } from './portal-analytics.js';
import type { PortalPlaybookService } from './portal-playbooks.js';

// ── LLM Response Schemas ──

const ConversationalIntakeSchema = z.object({
  intent: z.enum(['problem', 'change', 'question', 'status']),
  isWebsiteRelated: z.boolean(),
  websiteSubcategory: z.enum(['website_content', 'website_broken', 'website_new_page', 'website_design']).optional(),
  isPropertyRelated: z.boolean().optional(),
  propertySubcategory: z.enum([
    'property_missing_listing', 'property_incorrect_details', 'property_media',
    'property_feed_sync', 'property_status', 'property_visibility',
  ]).optional(),
  isAccountRelated: z.boolean().optional(),
  accountSubcategory: z.enum([
    'account_login', 'account_new_user', 'account_permissions',
    'account_details', 'account_office_change', 'account_remove_user',
  ]).optional(),
  confidence: z.number(),
  subject: z.string().optional(),
  account: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  errorMessage: z.string().optional(),
  browser: z.string().optional(),
  urgency: z.enum(['Normal', 'High', 'Critical']).optional(),
  propertyAddress: z.string().optional(),
  listingId: z.string().optional(),
  affectedPortals: z.string().optional(),
  acknowledgment: z.string(),
  nextQuestion: z.string().optional(),
  readyForConfirmation: z.boolean(),
});

const CategoryPickSchema = z.object({
  category: z.string(),
  subcategory: z.string().optional(),
  confidence: z.number().optional(),
});

const FieldExtractSchema = z.object({
  subject: z.string().optional(),
  account: z.string().optional(),
  description: z.string().optional(),
  url: z.string().optional(),
  errorMessage: z.string().optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  urgency: z.enum(['Normal', 'High', 'Critical']).optional(),
  contactPreference: z.enum(['portal', 'email', 'phone']).optional(),
});

const ConversationalFollowUpSchema = z.object({
  question: z.string(),
});

// ── Vocabulary Firewall (runtime enforcement) ──
// Safety net: catches internal/technical terms that should never appear in customer-facing text.
// The LLM prompt is the first-line defence; this is the second.

const VOCABULARY_REPLACEMENTS: Array<[RegExp, string]> = [
  // Account/access internal terms
  [/\bRBAC\b/gi, 'access settings'],
  [/\bprovisioning\b/gi, 'setup'],
  [/\bdeprovisioning\b/gi, 'removal'],
  [/\bauthentication\b/gi, 'login'],
  [/\bauthori[sz]ation\b/gi, 'access'],
  [/\baccess control\b/gi, 'access settings'],
  [/\brole[- ]based\b/gi, 'access'],
  [/\bpermission matrix\b/gi, 'access settings'],
  [/\bpermission model\b/gi, 'access settings'],
  [/\bscopes\b/gi, 'access levels'],
  [/\bentities\b/gi, 'items'],
  [/\bservice account\b/gi, 'system account'],
  [/\bSSO\b/g, 'single sign-on'],
  [/\bSAML\b/g, 'login'],
  [/\bidentity provider\b/gi, 'login system'],
  [/\baccess permissions\b/gi, 'access'],
  [/\buser permissions\b/gi, 'access'],
  [/\brole permissions\b/gi, 'access'],
  [/\baccess rights\b/gi, 'access'],
  [/\bpermission levels\b/gi, 'access levels'],
  // Technical integration terms
  [/\bdata feed\b/gi, 'update'],
  [/\bdata pipeline\b/gi, 'update process'],
  [/\bwebhook\b/gi, 'notification'],
  [/\bendpoint\b/gi, 'service'],
  [/\bCRM sync\b/gi, 'update'],
  [/\bsyndication\b/gi, 'distribution'],
  [/\bAPI\b/g, 'system'],
  [/\bintegration\b/gi, 'connection'],
  // Classification/routing terms
  [/\btriage\b/gi, 'review'],
  [/\bcategori[sz]e\b/gi, 'sort'],
  [/\bclassify\b/gi, 'identify'],
  [/\broute\b/gi, 'direct'],
  [/\bintake\b/gi, 'request'],
  [/\bsubcategory\b/gi, 'type'],
  [/\btaxonomy\b/gi, 'categories'],
  [/\bconfidence\b/gi, 'certainty'],
];

function sanitizeCustomerResponse(text: string): string {
  let result = text;
  for (const [pattern, replacement] of VOCABULARY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function extractPhoneNumbers(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g);
  return matches || [];
}

function briefContext(meta: IntakeSessionMetadata): string {
  const desc = meta.collectedFields.description || meta.openingMessage;
  if (!desc) return '';
  const firstSentence = desc.split(/[.!?\n]/)[0]?.trim() || '';
  return firstSentence.length > 80 ? firstSentence.slice(0, 77) + '...' : firstSentence;
}

const FRUSTRATION_PATTERNS = /\b(this is (completely |absolutely |totally |utterly |just )?ridiculous|speak to (someone|a (real )?person|a human)|talk to (someone|a (real )?person|a human)|real person|not a (chat)?bot|don'?t want.*(chat)?bot|this is useless|waste of time|you'?re useless|what a joke|fed up|sick of this|absolutely terrible|disgusting service|incompetent|get me a manager|escalate this|I('m| am) (absolutely |completely |totally |utterly |so )?furious|human (please|now|agent)|actual (person|human)|nobody is (fixing|helping|doing anything|listening|responding)|no one is (fixing|helping|doing anything|listening|responding)|been (broken|waiting|like this|an issue|a problem) for (days|weeks|ages|months|a while|over a week)|how (many|long|much longer) (times?|do I|more)|still (not|hasn'?t been|hasn'?t|isn'?t) (fixed|resolved|working|sorted|done)|completely (useless|unacceptable|ridiculous|furious)|utterly (useless|unacceptable|ridiculous|furious)|beyond (frustrated|annoyed|angry)|extremely (unhappy|frustrated|disappointed|annoyed)|so frustrated|so (angry|annoyed|disappointed|unhappy)|I('ve| have) (had enough|lost patience|been waiting)|unacceptable|appalling|disgraceful|atrocious|dreadful|(wow|oh),? (great|brilliant|fantastic|wonderful|amazing|excellent) service|thanks for nothing|I('m| am) starting to (wonder|lose|think)|does anyone (actually |even )?(read|check|look at|care|respond)|wonder(ing)? if anyone (reads|listens|cares|checks|responds))\b|[!?]{4,}/i;

const ATTACHMENT_PATTERNS = /\b(attached|attachment|see attached|photo attached|i'?ve attached|file attached|screenshot attached|attaching|i attach)\b/i;

const ESCALATION_CHASE_PATTERNS = /\b(raised this|already (raised|reported|logged|submitted|sent|told you|contacted|emailed)|following up|chasing|chase this|chasing this up|nobody has (helped|replied|responded|got back|come back|done anything)|no one has (helped|replied|responded|got back|come back|done anything)|been waiting|still (waiting|not (fixed|resolved|sorted|done|working|heard))|I ('ve|have) (already|previously) (raised|reported|logged|submitted|sent)|originally (raised|reported|logged)|weeks? ago|days? ago|months? ago|some time ago|a while (ago|back|now)|first (raised|reported|contacted|logged)|re-?raise|re-?open|follow.?up|getting? back to (you|this|me)|still (an issue|a problem|happening|broken|not right)|hasn'?t been (fixed|resolved|sorted|addressed|looked at|dealt with))\b/i;

// ── Category Field Config ──

const CATEGORY_FIELD_CONFIG: Record<string, { url: boolean; browser: boolean; errorMessage: boolean; account: boolean; description_hint: string }> = {
  website_content:    { url: true,  browser: false, errorMessage: false, account: true,  description_hint: 'What content needs changing? Include the page URL and exact text or image to update.' },
  website_broken:     { url: true,  browser: true,  errorMessage: true,  account: true,  description_hint: 'What should be happening vs what is happening? Include any error messages.' },
  website_new_page:   { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Describe the new page — content, navigation placement.' },
  website_design:     { url: true,  browser: false, errorMessage: false, account: true,  description_hint: 'What design changes? Attach reference images.' },
  account_login:      { url: false, browser: true,  errorMessage: true,  account: true,  description_hint: 'Which login? What happens when you try?' },
  account_new_user:   { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Name, email, which systems.' },
  account_permissions:{ url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Which user, what access needed.' },
  account_details:    { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'What details need updating.' },
  account_office_change: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which office/branch, what change.' },
  account_remove_user:   { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Who needs removing, email address.' },
  email_campaign:     { url: false, browser: false, errorMessage: true,  account: true,  description_hint: 'Which campaign, what went wrong.' },
  email_triggers:     { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Which trigger, what should it be doing.' },
  email_template:     { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Which template, what changes.' },
  leadpro_missing:    { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'When did the lead come in, which source, reference numbers.' },
  leadpro_setup:      { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'What needs configuring.' },
  leadpro_access:     { url: false, browser: true,  errorMessage: true,  account: true,  description_hint: 'What happens when you try to access.' },
  feeds_property:     { url: false, browser: false, errorMessage: true,  account: true,  description_hint: 'Which feed, when did it last work, CRM error messages.' },
  feeds_integration:  { url: false, browser: false, errorMessage: true,  account: true,  description_hint: 'Which integration, what system.' },
  feeds_reporting:    { url: true,  browser: false, errorMessage: false, account: true,  description_hint: 'Which report or view.' },
  listings_tours:     { url: true,  browser: true,  errorMessage: false, account: true,  description_hint: 'Property address or listing ref.' },
  listings_media:     { url: true,  browser: false, errorMessage: false, account: true,  description_hint: 'Which property, what images.' },
  listings_management:{ url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Which listings, what action.' },
  property_missing_listing:    { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property, where is it missing from.' },
  property_incorrect_details:  { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property, what details are wrong.' },
  property_media:              { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property, what media is affected.' },
  property_feed_sync:          { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property, which portals affected.' },
  property_status:             { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property, what status issue.' },
  property_visibility:         { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property, where is it not visible.' },
  onboarding_branch:  { url: false, browser: false, errorMessage: false, account: false, description_hint: 'Branch name, address, products needed.' },
  onboarding_product: { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Which product.' },
  onboarding_training:{ url: false, browser: false, errorMessage: false, account: true,  description_hint: 'What training, how many attendees.' },
  billing_cancel:     { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Which service, specific date.' },
  billing_change:     { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'What service change.' },
  billing_query:      { url: false, browser: false, errorMessage: false, account: true,  description_hint: 'Billing question.' },
  other_general:      { url: false, browser: false, errorMessage: false, account: false, description_hint: 'How can we help.' },
  other_feedback:     { url: false, browser: false, errorMessage: false, account: false, description_hint: 'Feedback or suggestion.' },
};

const CATEGORY_NAMES: Record<string, string> = {
  website: 'My Website',
  account: 'My Account',
  email_marketing: 'Email Marketing',
  leadpro: 'LeadPro & CRM',
  data_feeds: 'Data Feeds & Integrations',
  listings: 'Property Listings',
  property: 'Property Listings',
  onboarding: 'Onboarding & Setup',
  billing: 'Billing & Contracts',
  other: 'Something Else',
};

const SUBCATEGORY_NAMES: Record<string, string> = {
  website_content: 'Content update',
  website_broken: 'Something broken',
  website_new_page: 'New page',
  website_design: 'Design change',
  account_login: 'Login / password',
  account_new_user: 'New user',
  account_permissions: 'Permissions',
  account_details: 'Account details',
  account_office_change: 'Office / branch change',
  account_remove_user: 'User removal',
  email_campaign: 'Campaign issue',
  email_triggers: 'Triggers / automation',
  email_template: 'Template',
  leadpro_missing: 'Missing leads',
  leadpro_setup: 'Setup',
  leadpro_access: 'Access issue',
  feeds_property: 'Property feed',
  feeds_integration: 'Integration',
  feeds_reporting: 'Reporting',
  listings_tours: 'Virtual tours',
  listings_media: 'Property media',
  listings_management: 'Listing management',
  property_missing_listing: 'Missing listing',
  property_incorrect_details: 'Incorrect property details',
  property_media: 'Property photos / media',
  property_feed_sync: 'Property update issue',
  property_status: 'Property status issue',
  property_visibility: 'Property visibility issue',
  onboarding_branch: 'New branch',
  onboarding_product: 'New product',
  onboarding_training: 'Training',
  billing_cancel: 'Cancellation',
  billing_change: 'Service change',
  billing_query: 'Billing query',
  other_general: 'General query',
  other_feedback: 'Feedback',
};

interface ChatContext {
  orgName: string;
  userName: string;
  userEmail: string;
  orgId: number;
  portalUserId: number;
}

function emptyFields(): IntakeCollectedFields {
  return {
    subject: null,
    account: null,
    description: null,
    url: null,
    errorMessage: null,
    browser: null,
    os: null,
    urgency: 'Normal',
    contactPreference: 'portal',
    propertyAddress: null,
    listingId: null,
    affectedPortals: null,
    propertyStatus: null,
    affectedPersonName: null,
    affectedPersonEmail: null,
    officeBranch: null,
  };
}

function defaultMetadata(): IntakeSessionMetadata {
  return {
    stage: 'intent',
    intent: null,
    category: null,
    subcategory: null,
    collectedFields: emptyFields(),
    kbSuggested: false,
    deflected: false,
  };
}

function parseMetadata(raw: string | null): IntakeSessionMetadata {
  if (!raw) return defaultMetadata();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.stage) return parsed as IntakeSessionMetadata;
    // Legacy sessions without stage — treat as old-style
    return defaultMetadata();
  } catch {
    return defaultMetadata();
  }
}

function normaliseChoice(text: string): string {
  return text.trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isAffirmativeResponse(text: string): boolean {
  return /^(yes|yeah|yep|please do|go ahead|do it|create (a )?ticket|raise (a )?(ticket|request)|submit (it|that)|that sounds good|ok|okay|sure)\b/i.test(text.trim());
}

function isNegativeResponse(text: string): boolean {
  return /^(no|nope|not yet|not now|don't|do not|cancel|never mind)\b/i.test(text.trim());
}

function detectWebsiteFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  const lower = content.toLowerCase();

  // Broad website signals: explicit site words, named pages, or URLs
  const hasWebsiteSignal =
    /\b(website|web site|webpage|web page|homepage|home page|our site|the site|landing page|our page|contact page|about page|team page|staff page|services page|property page|branch page|office page|footer|header|banner|menu|navigation|nav bar)\b/.test(lower) ||
    /https?:\/\/[^\s]+/i.test(lower) ||
    /\b\w+\.(co\.uk|com|org|net|agency)\b/.test(lower);

  if (!hasWebsiteSignal) {
    // Content-change language that strongly implies website even without explicit "website" word
    const impliedWebsite = /\b(phone number.*(wrong|incorrect|needs|change|update|outdated|old)|address.*(wrong|incorrect|needs|change|update|outdated|old)|opening hours.*(wrong|incorrect|needs|change|update|outdated|old)|office.*(wrong|incorrect|needs|change|update|outdated|old|details)|branch.*(wrong|incorrect|needs|change|update|outdated|old|details)|contact (details|info|information).*(wrong|incorrect|needs|change|update|outdated|old)|our (phone|number|address|hours|logo|image|photo|office|branch|contact|details).*(wrong|incorrect|outdated|old|needs|change|update))\b/.test(lower);
    if (!impliedWebsite) return { likely: false, subcategory: null };
  }

  if (/\b(not working|isn.?t working|broken|error|down|can.?t (access|load|see)|won.?t (load|work|display)|blank|500|404|crash|displaying wrong|shows wrong|isn.?t displaying|not displaying|not loading|won.?t load)\b/.test(lower)) {
    return { likely: true, subcategory: 'website_broken' };
  }
  if (/\b(new page|add a page|add.* page|create.* page|new section|need a page)\b/.test(lower)) {
    return { likely: true, subcategory: 'website_new_page' };
  }
  if (/\b(design|layout|colour|color|font|style|rebrand|look and feel|redesign|theme)\b/.test(lower)) {
    return { likely: true, subcategory: 'website_design' };
  }
  if (/\b(change|update|edit|replace|remove|add|wrong|incorrect|outdated|old|amend|modify|text|wording|image|photo|number|address|phone|hours|logo|staff|team|email address|needs updating|needs changing)\b/.test(lower)) {
    return { likely: true, subcategory: 'website_content' };
  }
  return { likely: true, subcategory: null };
}

function detectPropertyFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  const lower = content.toLowerCase();

  const hasPropertySignal =
    /\b(property|properties|listing|listings|rightmove|zoopla|onthemarket|on the market|primelocation|prime location)\b/.test(lower) ||
    /\b(feed|feeds|syndication|portal|portals)\b/.test(lower) && /\b(property|listing|house|flat|apartment|branch|office)\b/.test(lower) ||
    /\b(floorplan|floor plan|epc|energy performance|virtual tour|property (photo|image|picture))\b/.test(lower) ||
    /\b(sold|stc|under offer|withdrawn|available|for sale|to let|to rent)\b/.test(lower) && /\b(still|showing|appearing|displaying|not|wrong|incorrect)\b/.test(lower);

  if (!hasPropertySignal) return { likely: false, subcategory: null };

  if (/\b(missing|not showing|not appearing|disappeared|removed|can.?t (see|find)|not (visible|there|listed))\b/.test(lower)) {
    if (/\b(photo|image|picture|floorplan|floor plan|epc|media|video)\b/.test(lower)) {
      return { likely: true, subcategory: 'property_media' };
    }
    return { likely: true, subcategory: 'property_missing_listing' };
  }
  if (/\b(wrong|incorrect|outdated|old|inaccurate|needs (updating|changing)|price|description|address|details)\b/.test(lower)) {
    return { likely: true, subcategory: 'property_incorrect_details' };
  }
  if (/\b(photo|image|picture|floorplan|floor plan|epc|media|video|gallery)\b/.test(lower)) {
    return { likely: true, subcategory: 'property_media' };
  }
  if (/\b(sync|syncing|updating|update|feed|not (appearing|showing) everywhere|delay)\b/.test(lower)) {
    return { likely: true, subcategory: 'property_feed_sync' };
  }
  if (/\b(sold|stc|under offer|withdrawn|available|status|state)\b/.test(lower)) {
    return { likely: true, subcategory: 'property_status' };
  }
  if (/\b(not (visible|showing|displaying)|visibility|hidden|can.?t see)\b/.test(lower)) {
    return { likely: true, subcategory: 'property_visibility' };
  }

  return { likely: true, subcategory: null };
}

function extractPropertyFieldsFromText(content: string, fields: IntakeCollectedFields): void {
  // Property address — look for street number + name patterns
  if (!fields.propertyAddress) {
    const addrMatch = content.match(/\b(\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}(?:\s+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr|Close|Cl|Way|Place|Pl|Court|Ct|Crescent|Cres|Terrace|Gardens|Grove|Park|Square|Row|Mews|Hill|Rise|Walk|Green|Gate|Chase|Heath|Meadow|Vale|View)))\b/i);
    if (addrMatch) fields.propertyAddress = addrMatch[1].trim();
  }

  // Listing / property ID
  if (!fields.listingId) {
    const idMatch = content.match(/\b(?:property|listing|ref(?:erence)?|id)[\s:#]*(\d{4,})\b/i) ||
                    content.match(/\b(\d{5,})\b/);
    if (idMatch) fields.listingId = idMatch[1];
  }

  // Affected portals
  if (!fields.affectedPortals) {
    const portals: string[] = [];
    if (/\brightmove\b/i.test(content)) portals.push('Rightmove');
    if (/\bzoopla\b/i.test(content)) portals.push('Zoopla');
    if (/\b(onthemarket|on the market)\b/i.test(content)) portals.push('OnTheMarket');
    if (/\b(primelocation|prime location)\b/i.test(content)) portals.push('PrimeLocation');
    if (/\bwebsite\b/i.test(content)) portals.push('Website');
    if (portals.length > 0) fields.affectedPortals = portals.join(', ');
  }

  // Property status mentions
  if (!fields.propertyStatus) {
    const statusMatch = content.match(/\b(sold|stc|under offer|withdrawn|available|for sale|to let|to rent|let agreed)\b/i);
    if (statusMatch) fields.propertyStatus = statusMatch[1];
  }
}

// ── Account Setup / Office Changes Detection ──

const SECURITY_SENSITIVE_PATTERNS = /\b(remove.*(user|access|account|person|them|him|her|employee)|revoke.*(access|permissions?|login)|delete.*(user|account|access)|deactivate.*(user|account)|left the company|been (fired|let go|terminated|dismissed|made redundant)|no longer (works?|employed|with us)|was (fired|let go|terminated|dismissed|made redundant))\b/i;

function detectAccountFromKeywords(content: string): { likely: boolean; subcategory: string | null; securitySensitive: boolean } {
  const lower = content.toLowerCase();

  const securitySensitive = SECURITY_SENSITIVE_PATTERNS.test(content);
  if (securitySensitive) {
    return { likely: true, subcategory: 'account_remove_user', securitySensitive: true };
  }

  const hasLoginSignal =
    /\b(can'?t (log ?in|sign ?in|get ?in|access)|locked out|password.*(not|isn'?t|won'?t|stopped|expired|reset|forgot|forgotten)|forgot(ten)? (my )?password|login (isn'?t|not|won'?t) work|reset (my )?password|sign ?in (problem|issue|error|fail))\b/.test(lower);

  if (hasLoginSignal) {
    return { likely: true, subcategory: 'account_login', securitySensitive: false };
  }

  const hasNewUserSignal =
    /\b(new (user|starter|employee|team member|person|staff|member|joiner)|set ?up.*(user|account|access|person|someone|starter)|add.*(user|person|someone|member|employee)|create.*(user|account|login)|need.*(user|account|access).*(set ?up|creat|add))\b/.test(lower);

  if (hasNewUserSignal) {
    return { likely: true, subcategory: 'account_new_user', securitySensitive: false };
  }

  const hasPermissionSignal =
    /\b(permission|permissions|can'?t see.*(report|data|lead|dashboard|information)|admin access|access.*(wrong|changed|missing|lost|revoked|restricted)|role.*(change|update|wrong)|need access|grant access|give access)\b/.test(lower) &&
    !/\b(website|web site|page|our site|listing|rightmove|zoopla)\b/.test(lower);

  if (hasPermissionSignal) {
    return { likely: true, subcategory: 'account_permissions', securitySensitive: false };
  }

  const hasOfficeSignal =
    /\b(new (office|branch)|clos(e|ed|ing).*(office|branch)|merg(e|ed|ing).*(office|branch|offices|branches)|moved? offices?|office.*(move|relocation|restructur|closing|opening|merger)|branch.*(move|relocation|restructur|closing|opening|merger|open|new|add))\b/.test(lower) &&
    !/\b(website|web site|page|our site|shows?|display|address.*wrong|address.*incorrect|address.*outdated)\b/.test(lower);

  if (hasOfficeSignal) {
    return { likely: true, subcategory: 'account_office_change', securitySensitive: false };
  }

  const hasAccountDetailSignal =
    /\b(account.*(detail|setting|config|update|change)|change.*(account|company) (name|detail|address|email)|update.*(account|company) (name|detail|address|email))\b/.test(lower) &&
    !/\b(website|web site|page|our site)\b/.test(lower);

  if (hasAccountDetailSignal) {
    return { likely: true, subcategory: 'account_details', securitySensitive: false };
  }

  // F4: Broad "access" signal — the word "access" in any context (including technical
  // phrasings like "API endpoint access") indicates an account/permission concern.
  // Routes to conversational clarification, not direct classification.
  const hasBroadAccessSignal =
    /\b(access)\b/.test(lower) &&
    !/\b(website|web site|page|our site|listing|rightmove|zoopla|property|properties)\b/.test(lower);

  if (hasBroadAccessSignal) {
    return { likely: true, subcategory: 'account_permissions', securitySensitive: false };
  }

  return { likely: false, subcategory: null, securitySensitive: false };
}

function extractAccountFieldsFromText(content: string, fields: IntakeCollectedFields): void {
  if (!fields.affectedPersonEmail) {
    const emailMatch = content.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/);
    if (emailMatch) fields.affectedPersonEmail = emailMatch[1];
  }

  if (!fields.affectedPersonName) {
    const namePatterns = [
      /\b(?:remove|set ?up|add|create|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:left|was fired|was let go|has left|is leaving|joined|started|needs?)\b/,
    ];
    for (const pattern of namePatterns) {
      const match = content.match(pattern);
      if (match) { fields.affectedPersonName = match[1].trim(); break; }
    }
  }

  if (!fields.officeBranch) {
    const branchPatterns = [
      /\b(?:our |the )?(?:new |old )?(\w+(?:\s+\w+)?)\s+(?:office|branch)\b/i,
      /\b(?:office|branch)\s+(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
    ];
    for (const pattern of branchPatterns) {
      const match = content.match(pattern);
      if (match && !/\b(new|old|our|the|this|that|my|main|head)\b/i.test(match[1])) {
        fields.officeBranch = match[1].trim();
        break;
      }
    }
  }
}

function detectCrossDomainAmbiguity(content: string): { ambiguous: boolean; domains: string[]; clarificationQuestion: string | null } {
  const lower = content.toLowerCase();

  const hasAccountSignals = /\b(can'?t (see|access|get|log)|permission|new (user|starter|office|branch)|locked out|password)\b/.test(lower);
  const hasWebsiteSignals = /\b(website|web site|our site|the site|page|homepage|display|showing)\b/.test(lower);
  const hasPropertySignals = /\b(property|properties|listing|listings|rightmove|zoopla|onthemarket)\b/.test(lower);
  const hasDataSignals = /\b(report|data|leads?|performance|dashboard)\b/.test(lower) && !hasAccountSignals;

  const domains: string[] = [];
  if (hasAccountSignals) domains.push('account');
  if (hasWebsiteSignals) domains.push('website');
  if (hasPropertySignals) domains.push('property');
  if (hasDataSignals) domains.push('data');

  if (domains.length <= 1) return { ambiguous: false, domains, clarificationQuestion: null };

  // Website display + office/account context → website wins, no disambiguation needed
  if (hasWebsiteSignals && /\b(shows?|display|address|wrong|incorrect|outdated|old|updating|update)\b/.test(lower)) {
    return { ambiguous: false, domains: ['website'], clarificationQuestion: null };
  }

  // Property signals + account context → property wins if listing-specific vocabulary present
  if (hasPropertySignals && !hasAccountSignals) {
    return { ambiguous: false, domains: ['property'], clarificationQuestion: null };
  }

  // Genuine ambiguity — build a symptom-focused clarification question
  let question: string | null = null;

  if (domains.includes('account') && domains.includes('website')) {
    question = "What specifically isn't working — is it that you can't log in or access something, or is something displaying incorrectly on the website?";
  } else if (domains.includes('account') && domains.includes('data')) {
    if (/\bnew\b/.test(lower)) {
      question = "Is this for someone or something that was recently set up, or has it been working before and stopped?";
    } else {
      question = "What happens when you try to access this — do you get an error, or can you get in but the information just isn't there?";
    }
  } else if (domains.includes('account') && domains.includes('property')) {
    question = "Is this about the property listing itself, or about being able to access or manage the property in the system?";
  }

  return { ambiguous: question !== null, domains, clarificationQuestion: question };
}

function extractUrlFromText(content: string): string | null {
  const match = content.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/i);
  return match ? match[0].replace(/[.,;:!?)]+$/, '') : null;
}

export class PortalChatService {
  private playbookService: PortalPlaybookService | null = null;
  private intakeService: PortalIntakeService | null = null;

  constructor(
    private settings: FileSettingsQueries,
    private llm: LlmService | null,
    private portalJira: PortalJiraService,
  ) {}

  setPlaybookService(service: PortalPlaybookService): void {
    this.playbookService = service;
  }

  setIntakeService(service: PortalIntakeService): void {
    this.intakeService = service;
  }

  async startSession(portalUserId: number): Promise<PortalChatSession> {
    const meta = defaultMetadata();
    const result = await queryOne<{ id: number }>(
      `INSERT INTO portal_chat_sessions (portal_user_id, status, metadata)
       OUTPUT INSERTED.id VALUES (?, 'active', ?)`,
      [portalUserId, JSON.stringify(meta)],
    );

    const session = await queryOne<PortalChatSession>(
      `SELECT * FROM portal_chat_sessions WHERE id = ?`,
      [result!.id],
    );

    return session!;
  }

  async sendMessage(
    sessionId: number,
    content: string,
    context: ChatContext,
  ): Promise<PortalChatMessage> {
    // Store user message
    await execute(
      `INSERT INTO portal_chat_messages (session_id, role, content)
       VALUES (?, 'user', ?)`,
      [sessionId, content],
    );

    // Load session metadata
    const session = await queryOne<{ metadata: string | null }>(
      `SELECT metadata FROM portal_chat_sessions WHERE id = ?`,
      [sessionId],
    );
    const meta = parseMetadata(session?.metadata ?? null);

    // Get conversation history
    const history = await query<{ role: string; content: string }>(
      `SELECT role, content FROM portal_chat_messages
       WHERE session_id = ? ORDER BY created_at`,
      [sessionId],
    );

    let responseContent: string;
    let messageMeta: ChatMessageMetadata | null = null;

    // Frustration detection — skip thresholds and offer handoff immediately
    if (FRUSTRATION_PATTERNS.test(content)) {
      meta.frustrationDetected = true;
      console.log(`[portal-chat] Frustration detected in session ${sessionId}`);
    }

    // Read configurable thresholds
    const maxExchanges = parseInt(this.settings.get('portal_chat_max_exchanges') || '10', 10);
    const handoffThreshold = parseInt(this.settings.get('portal_chat_handoff_threshold') || '3', 10);

    try {
      const result = await this.processStage(meta, content, history, context, sessionId);
      responseContent = result.response;
      messageMeta = result.messageMeta ?? null;
      if (messageMeta) {
        messageMeta.intent = meta.intent;
      } else {
        messageMeta = { intent: meta.intent };
      }

      // Post-stage handoff checks based on configurable thresholds
      const userMessageCount = history.filter(m => m.role === 'user').length;
      if (meta.stage !== 'summary' && meta.stage !== 'confirmed') {
        if (userMessageCount >= maxExchanges && (meta.stage === 'detail' || meta.stage === 'category')) {
          // Force handoff — create ticket with whatever we have
          const ticketKey = await this.forceHandoff(meta, context, sessionId, history);
          responseContent = `I've gone ahead and created ticket **${ticketKey}** with the details we've gathered so far. A team member will follow up with you.`;
          meta.stage = 'confirmed';
          meta.offeredTicketCreation = false;
        } else if (userMessageCount >= handoffThreshold && meta.stage !== 'kb_check' && !meta.offeredTicketCreation) {
          responseContent += '\n\nWould you like me to create a ticket so a team member can assist directly?';
          meta.offeredTicketCreation = true;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      console.error(`[portal-chat] Stage processing failed for session ${sessionId}, stage=${meta.stage}, intent=${meta.intent}:`, errMsg);
      if (errStack) console.error('[portal-chat] Stack:', errStack);
      responseContent = "I'm having trouble processing your request right now. Would you like me to create a support ticket so our team can help you directly?";
      meta.offeredTicketCreation = true;
    }

    // Runtime vocabulary firewall — catches jargon leaks from LLM and template paths
    responseContent = sanitizeCustomerResponse(responseContent);

    // Persist updated metadata (best-effort — don't let this block the response)
    try {
      await execute(
        `UPDATE portal_chat_sessions SET metadata = ? WHERE id = ?`,
        [JSON.stringify(meta), sessionId],
      );
    } catch (metaErr) {
      console.error('[portal-chat] Failed to persist session metadata:', metaErr instanceof Error ? metaErr.message : metaErr);
    }

    // Store assistant message
    try {
      await execute(
        `INSERT INTO portal_chat_messages (session_id, role, content, metadata)
         VALUES (?, 'assistant', ?, ?)`,
        [sessionId, responseContent, messageMeta ? JSON.stringify(messageMeta) : null],
      );
    } catch (insertErr) {
      // Fallback: try without metadata column in case it doesn't exist on older DBs
      console.warn('[portal-chat] Insert with metadata failed, retrying without:', insertErr instanceof Error ? insertErr.message : insertErr);
      await execute(
        `INSERT INTO portal_chat_messages (session_id, role, content)
         VALUES (?, 'assistant', ?)`,
        [sessionId, responseContent],
      );
    }

    const message = await queryOne<PortalChatMessage>(
      `SELECT TOP 1 * FROM portal_chat_messages
       WHERE session_id = ? AND role = 'assistant'
       ORDER BY created_at DESC`,
      [sessionId],
    );

    return message!;
  }

  private async processStage(
    meta: IntakeSessionMetadata,
    content: string,
    history: Array<{ role: string; content: string }>,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    const stage = meta.stage;
    console.log(`[portal-chat] session=${sessionId} stage=${stage} intent=${meta.intent} category=${meta.category}`);

    if (meta.offeredTicketCreation && stage !== 'confirmed') {
      if (isAffirmativeResponse(content)) {
        meta.offeredTicketCreation = false;
        const ticketKey = await this.forceHandoff(meta, context, sessionId, history);
        return {
          response: `I've created ticket **${ticketKey}** with the information you've shared so far. You can track its progress in **My Tickets**, and our team will follow up if anything else is needed.`,
        };
      }

      if (isNegativeResponse(content)) {
        meta.offeredTicketCreation = false;
      }
    }

    // Frustration override — offer handoff immediately from any stage except confirmed
    if (meta.frustrationDetected && stage !== 'confirmed' && stage !== 'summary') {
      meta.frustrationDetected = false; // consume the flag
      meta.offeredTicketCreation = true;

      // Preserve operational detail from the frustration message before empathy return
      extractPropertyFieldsFromText(content, meta.collectedFields);
      extractAccountFieldsFromText(content, meta.collectedFields);
      if (!meta.collectedFields.description) {
        meta.collectedFields.description = content;
      }
      if (!meta.category) {
        const propertyDetection = detectPropertyFromKeywords(content);
        if (propertyDetection.likely) {
          meta.category = 'property';
          meta.conversational = true;
          meta.subcategory = propertyDetection.subcategory || 'property_visibility';
        } else {
          const accountDetection = detectAccountFromKeywords(content);
          if (accountDetection.likely) {
            meta.category = 'account';
            meta.conversational = true;
            meta.subcategory = accountDetection.subcategory || 'account_login';
            if (accountDetection.securitySensitive) {
              meta.securitySensitive = true;
              meta.collectedFields.urgency = 'High';
            }
          }
        }
      }
      if (ATTACHMENT_PATTERNS.test(content)) {
        meta.attachmentMentioned = true;
      }

      const empathy = this.buildEmpathyAcknowledgement(meta);
      return {
        response: `${empathy} Would you like me to create a ticket right now so a member of our team can help you directly? Just say yes and I'll put one together for you.`,
      };
    }

    switch (stage) {
      case 'intent':
        return this.handleIntentStage(meta, content, context, sessionId);

      case 'category':
        return this.handleCategoryStage(meta, content, context);

      case 'detail':
        return this.handleDetailStage(meta, content, history, context, sessionId);

      case 'kb_check':
        return this.handleKbCheckResponse(meta, content, context, sessionId);

      case 'summary':
        return this.handleSummaryEdit(meta, content, context);

      case 'confirmed':
        return { response: 'This conversation has already been completed. Start a new conversation if you need more help.' };

      default:
        console.warn(`[portal-chat] Unknown stage "${stage}" for session ${sessionId}, resetting to intent`);
        meta.stage = 'intent';
        return this.handleIntentStage(meta, content, context, sessionId);
    }
  }

  // ── Stage 1: Conversational Intent + Classification ──

  private async handleIntentStage(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // Always capture opening message verbatim — this is the highest-quality signal
    if (!meta.collectedFields.description) {
      meta.collectedFields.description = content;
    }
    if (!meta.openingMessage) {
      meta.openingMessage = content;
    }

    // Extract URL via regex (reliable, no LLM needed)
    const detectedUrl = extractUrlFromText(content);
    if (detectedUrl) meta.collectedFields.url = detectedUrl;

    // Detect urgency / contact preference from language
    if (/\b(urgent|emergency|down|critical|asap)\b/i.test(content)) {
      meta.collectedFields.urgency = 'High';
    }
    if (/\b(call me|phone me|ring me)\b/i.test(content)) {
      meta.collectedFields.contactPreference = 'phone';
    } else if (/\bemail me\b/i.test(content)) {
      meta.collectedFields.contactPreference = 'email';
    }

    // Detect attachment mentions
    if (ATTACHMENT_PATTERNS.test(content)) {
      meta.attachmentMentioned = true;
    }

    // Extract domain-specific fields from opening message
    extractPropertyFieldsFromText(content, meta.collectedFields);
    extractAccountFieldsFromText(content, meta.collectedFields);

    if (this.llm) {
      return this.handleIntentWithLlm(meta, content, context, sessionId);
    }
    return this.handleIntentWithoutLlm(meta, content);
  }

  private async handleIntentWithLlm(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // H1: Security-sensitive fast-track — pre-empt LLM entirely for urgent removal/revocation.
    // These signals are unambiguous and must never reach the category picker or disambiguation.
    if (SECURITY_SENSITIVE_PATTERNS.test(content)) {
      meta.category = 'account';
      meta.subcategory = 'account_remove_user';
      meta.conversational = true;
      meta.securitySensitive = true;
      meta.collectedFields.urgency = 'High';
      meta.stage = 'detail';
      extractAccountFieldsFromText(content, meta.collectedFields);

      const personName = meta.collectedFields.affectedPersonName;
      const personEmail = meta.collectedFields.affectedPersonEmail;

      if (personName && personEmail) {
        const summaryResult = this.buildSummaryCard(meta);
        return {
          response: `Understood — I'll get ${personName}'s access removed urgently.\n\n${summaryResult.response}`,
          messageMeta: summaryResult.messageMeta,
        };
      }

      if (personName) {
        return { response: `Understood — I'll get ${personName}'s access removed urgently. Could you confirm their email address so I can get this raised?` };
      }
      return { response: `Understood — I'll get this raised urgently. Could you confirm their name and email address so I can get this raised?` };
    }

    // H1b: Frustration + urgency fast-track — frustrated customers with domain signals skip LLM classification
    if (meta.frustrationDetected && SECURITY_SENSITIVE_PATTERNS.test(content)) {
      meta.frustrationDetected = false;
      meta.category = 'account';
      meta.subcategory = 'account_remove_user';
      meta.securitySensitive = true;
      meta.collectedFields.urgency = 'High';
      meta.stage = 'detail';
      extractAccountFieldsFromText(content, meta.collectedFields);
      const missing = !meta.collectedFields.affectedPersonEmail ? 'email address' : 'name';
      return { response: `I understand this is urgent — I'll get this raised right away. Could you confirm their ${missing}?` };
    }

    try {
      const result = await this.llm!.call(
        `You are a support assistant for a web technology company (estate agent websites, email marketing, CRM, property feeds). A customer has just described their issue.

Analyse the message and return structured JSON:

1. INTENT — what they need:
   - problem: something is broken, not working, showing errors
   - change: content update, modification, new setup
   - question: how to, what is, general enquiry
   - status: checking on an existing ticket or request

2. WEBSITE CLASSIFICATION — is this about their website?
   Set isWebsiteRelated=true ONLY for website content, design, or functionality issues.
   Set isWebsiteRelated=false for: email marketing, CRM/LeadPro, account/login, data feeds, billing, property portal feeds (Rightmove/Zoopla), property listings, or unclear requests.
   IMPORTANT: Requests to correct business details (phone numbers, addresses, opening hours, office/branch details, contact information) are almost always website content updates — set isWebsiteRelated=true and websiteSubcategory=website_content for these.
   If website-related, classify:
   - website_content: updating text, images, phone numbers, addresses, staff details, opening hours, branch/office details, contact information on an existing page
   - website_broken: something on the website is not working, displaying wrong, or erroring
   - website_new_page: requesting a new page to be added to the website
   - website_design: visual/layout/styling changes, redesign requests

3. PROPERTY / LISTING CLASSIFICATION — is this about a property listing?
   Set isPropertyRelated=true for issues with: property listings, Rightmove/Zoopla/OnTheMarket feeds, property photos/floorplans/EPCs, listing visibility, property sync, sold/STC status, property details being wrong on portals, missing listings, feed issues.
   Set isPropertyRelated=false for: website design/content (even if the website shows properties), account/login, email marketing, billing, or unclear requests.
   IMPORTANT: If a customer mentions a property not showing "on the website" AND also mentions portals (Rightmove/Zoopla), prefer isPropertyRelated=true.
   If someone says "property isn't showing" without specifying where, set isPropertyRelated=true (it's more likely a listing/feed issue than a website issue).
   If property-related, classify:
   - property_missing_listing: listing not appearing on a portal or website
   - property_incorrect_details: wrong price, description, address, or other details
   - property_media: missing or wrong photos, floorplans, EPCs, virtual tours
   - property_feed_sync: updates not appearing across portals, sync delays
   - property_status: sold/STC/withdrawn properties showing wrong status
   - property_visibility: general visibility problems, listing hidden or not findable

4. ACCOUNT / ACCESS CLASSIFICATION — login, users, permissions, office/branch changes.
   Set isAccountRelated=true for: login/password, new user setup, user removal, permission/access, office/branch changes, account config.
   Set isAccountRelated=false for: website content/design, property listings, email marketing, billing, or unclear requests.
   Routing rules: "can't log in to update the website" → login (isAccountRelated=true). "Website shows wrong office address" → website display (isWebsiteRelated=true). User removal/access revocation → SECURITY-SENSITIVE (accountSubcategory=account_remove_user, urgent).
   Subcategories: account_login, account_new_user, account_permissions, account_details, account_office_change, account_remove_user.

5. FIELD EXTRACTION — capture details already provided. Include subject, account, description, url, errorMessage, browser, urgency (only if explicit), propertyAddress, listingId, affectedPortals. Preserve the customer's exact words in description — do not rewrite or summarise. If they mention a phone number, include the phone number. If they mention an address, include the address verbatim.

6. ACKNOWLEDGMENT — write 1-2 sentences that MIRROR the customer's specific details back to them.
   PRIMARY RULE: Always use the customer's own words to describe their problem. If they said "she can't see anything", say "she can't see anything". If they said "the number is wrong", say "the number is wrong". Do not translate their words into technical or internal vocabulary.
   MANDATORY DETAIL INCLUSION — you MUST include these in the acknowledgement when the customer provides them:
   - Phone numbers: include the EXACT phone number(s) mentioned (e.g. "0161 555 1234"). Never drop or omit phone numbers.
   - Addresses: include the EXACT address or location mentioned. Never summarise to "your address".
   - Person names: include the EXACT name mentioned (e.g. "Sarah Jenkins"). Never replace with "the user" or "them".
   - Reference numbers: include any ticket/reference/listing numbers verbatim.
   - Error messages: include the specific error text if provided.
   If they said "the phone number on our contact page is wrong — it shows 0161 555 1234 but should be 0161 555 6789", your acknowledgement MUST include both numbers and "contact page".
   If they mentioned multiple issues, acknowledge ALL of them, not just the primary one.
   NEVER paraphrase away specifics. "I can help with that update" is a VIOLATION. "I can see the phone number on your contact page needs updating from 0161 555 1234 to 0161 555 6789" is correct.
   VOCABULARY FIREWALL (safety net) — never use ANY of these terms in the acknowledgement or any customer-facing text:
   - Technical: feed, syndication, API, integration, CRM sync, data feed, data pipeline, webhook, endpoint
   - Account/access internal: RBAC, provisioning, deprovisioning, authentication, authorisation, authorization, access control, role-based, permission matrix, permission model, scopes, entities, service account, SSO, SAML, identity provider, access permissions, user permissions, role permissions, access rights
   - Classification: triage, categorise, classify, route, intake, subcategory
   Instead, mirror the customer's vocabulary. If they said "can't get in", say "can't get in", not "authentication issue". If they said "she can't see anything", say "she can't see anything", not "access permissions issue".

7. NEXT QUESTION — if you need more information to action this, write ONE natural follow-up question. Only ask for what's genuinely missing. If they've given enough detail, omit this field. Never ask the customer to diagnose the technical cause or identify which system is at fault. Never ask "which system" or "which platform".

8. MULTI-ISSUE HANDLING — if the customer describes more than one issue (e.g. "I'm locked out AND the new users aren't set up"), capture ALL issues in the description field as separate items. The acknowledgement must reference every issue they raised. Do not collapse multiple issues into a single category.

9. READY FOR CONFIRMATION — set readyForConfirmation=true if you have at minimum: what the problem is AND which property or account is affected. Otherwise false.

Set confidence 0.0-1.0 for how certain you are about the classification. If both isWebsiteRelated and isPropertyRelated could apply, set the more specific one to true and the other to false.`,
        content,
        ConversationalIntakeSchema,
        { callType: 'portal_chat', tier: 'standard', maxTokens: 500, temperature: 0.2 },
      );

      const d = result.data;
      meta.intent = d.intent;

      // Populate extracted fields (don't overwrite URL from regex)
      if (d.subject) meta.collectedFields.subject = d.subject;
      if (d.account) meta.collectedFields.account = d.account;
      if (d.url && !meta.collectedFields.url) meta.collectedFields.url = d.url;
      if (d.errorMessage) meta.collectedFields.errorMessage = d.errorMessage;
      if (d.browser) meta.collectedFields.browser = d.browser;
      if (d.urgency) meta.collectedFields.urgency = d.urgency;
      if (d.propertyAddress) meta.collectedFields.propertyAddress = d.propertyAddress;
      if (d.listingId) meta.collectedFields.listingId = d.listingId;
      if (d.affectedPortals) meta.collectedFields.affectedPortals = d.affectedPortals;
      // Never replace raw customer message with LLM summary — it loses operational detail.
      // If the LLM extracted additional context, append it; otherwise keep raw message intact.
      if (d.description && meta.openingMessage && d.description !== meta.openingMessage) {
        const raw = meta.openingMessage;
        const llmAdds = d.description;
        // Only append LLM enrichment if it contains info not already in the raw message
        const rawLower = raw.toLowerCase();
        if (!rawLower.includes(llmAdds.toLowerCase().slice(0, 40))) {
          meta.collectedFields.description = `${raw}\n\n${llmAdds}`;
        }
        // else: LLM just rephrased the same content — keep raw
      }

      // Route status intent
      if (d.intent === 'status') {
        try {
          return await this.handleStatusIntent(meta, content, context);
        } catch (err) {
          console.warn('[portal-chat] Status lookup failed:', err instanceof Error ? err.message : err);
        }
      }

      // Route question intent — try KB first
      if (d.intent === 'question') {
        try {
          const kbResult = await this.searchKb(content);
          if (kbResult.length > 0) {
            meta.stage = 'kb_check';
            meta.kbSuggested = true;
            return {
              response: 'I found some articles that might help:',
              messageMeta: {
                type: 'kb_suggestions' as const,
                articles: kbResult.map(a => ({ id: 0, title: a.title, excerpt: a.excerpt })),
              },
            };
          }
          await this.logKbGap(content, meta.category, sessionId);
        } catch (err) {
          console.warn('[portal-chat] KB search failed:', err instanceof Error ? err.message : err);
        }
      }

      // Website conversational intake — the core behavioural change
      if (d.isWebsiteRelated && d.confidence >= 0.6) {
        meta.category = 'website';
        meta.conversational = true;

        if (d.websiteSubcategory) {
          meta.subcategory = d.websiteSubcategory;
          meta.stage = 'detail';

          const config = CATEGORY_FIELD_CONFIG[meta.subcategory] || CATEGORY_FIELD_CONFIG['other_general']!;
          const missing = this.getMissingFields(meta.collectedFields, config);

          if (missing.length === 0) {
            const ack = d.acknowledgment || 'Thanks for providing all those details.';
            const summaryResult = this.buildSummaryCard(meta);
            return {
              response: `${ack}\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }

          const ack = d.acknowledgment;
          const question = d.nextQuestion || this.buildConversationalQuestion(missing[0], meta);
          const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
          return { response: `${ack}\n\n${question}${fileNote}` };
        }

        // Website-related but no specific subcategory — conversational clarification
        meta.stage = 'detail';
        meta.subcategory = 'website_content'; // default, may refine later
        const ack = d.acknowledgment || "Thanks for getting in touch about your website.";
        const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
        return { response: `${ack}\n\nCould you tell me a bit more — is something not displaying correctly, or do you need some content updated?${fileNote}` };
      }

      // Moderate confidence (0.4–0.6) — possibly website, ask conversationally instead of showing category picker
      if (d.isWebsiteRelated && d.confidence >= 0.4) {
        meta.conversational = true;
        meta.category = 'website';
        meta.subcategory = 'website_content';
        meta.stage = 'detail';
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        const fileNote2 = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
        return { response: `${ack}\n\nCould you tell me a bit more about what needs to happen?${fileNote2}` };
      }

      // Property / listing conversational intake
      if (d.isPropertyRelated && d.confidence >= 0.6) {
        meta.category = 'property';
        meta.conversational = true;

        // Extract property-specific fields from text via regex too
        extractPropertyFieldsFromText(content, meta.collectedFields);

        if (d.propertySubcategory) {
          meta.subcategory = d.propertySubcategory;
          meta.stage = 'detail';

          const config = CATEGORY_FIELD_CONFIG[meta.subcategory] || CATEGORY_FIELD_CONFIG['property_visibility']!;
          const missing = this.getPropertyMissingFields(meta.collectedFields, meta.subcategory);

          if (missing.length === 0) {
            const ack = d.acknowledgment || 'Thanks for providing all those details.';
            const summaryResult = this.buildSummaryCard(meta);
            return {
              response: `${ack}\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }

          const ack = d.acknowledgment;
          const question = d.nextQuestion || this.buildPropertyFollowUp(missing[0], meta);
          const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
          return { response: `${ack}\n\n${question}${fileNote}` };
        }

        // Property-related but no specific subcategory — ask conversationally
        meta.stage = 'detail';
        meta.subcategory = 'property_visibility';
        const ack = d.acknowledgment || "Thanks for getting in touch about your property listing.";
        const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
        return { response: `${ack}\n\nCould you tell me which property is affected and where you're seeing the issue?${fileNote}` };
      }

      // Moderate confidence (0.4–0.6) for property — ask conversationally
      if (d.isPropertyRelated && d.confidence >= 0.4) {
        meta.conversational = true;
        meta.category = 'property';
        meta.subcategory = 'property_visibility';
        meta.stage = 'detail';
        extractPropertyFieldsFromText(content, meta.collectedFields);
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening with the property?${fileNote}` };
      }

      // Account / access / office change conversational intake
      if (d.isAccountRelated && d.confidence >= 0.6) {
        meta.category = 'account';
        meta.conversational = true;
        extractAccountFieldsFromText(content, meta.collectedFields);

        // Security-sensitive fast-track: user removal / access revocation
        if (d.accountSubcategory === 'account_remove_user' || SECURITY_SENSITIVE_PATTERNS.test(content)) {
          meta.subcategory = 'account_remove_user';
          meta.securitySensitive = true;
          meta.collectedFields.urgency = 'High';
          meta.stage = 'detail';

          const personName = meta.collectedFields.affectedPersonName;
          const personEmail = meta.collectedFields.affectedPersonEmail;
          const ack = personName
            ? (d.acknowledgment || `Understood — I'll get ${personName}'s access removed urgently.`)
            : (d.acknowledgment || "Understood — I'll get this raised urgently.");

          if (personName && personEmail) {
            const summaryResult = this.buildSummaryCard(meta);
            return {
              response: `${ack}\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }

          if (personName) {
            return { response: `${ack} Could you confirm their email address so I can get this raised?` };
          }
          return { response: `${ack} Could you confirm their name and email address so I can get this raised?` };
        }

        if (d.accountSubcategory) {
          meta.subcategory = d.accountSubcategory;
          meta.stage = 'detail';

          const missing = this.getAccountMissingFields(meta.collectedFields, meta.subcategory);
          if (missing.length === 0) {
            const ack = d.acknowledgment || 'Thanks for providing all those details.';
            const summaryResult = this.buildSummaryCard(meta);
            return {
              response: `${ack}\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }

          const ack = d.acknowledgment;
          const question = d.nextQuestion || this.buildAccountFollowUp(missing[0], meta);
          return { response: `${ack}\n\n${question}` };
        }

        // Account-related but no specific subcategory — conversational follow-up
        meta.stage = 'detail';
        meta.subcategory = 'account_login';
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening?` };
      }

      // Moderate confidence (0.4–0.6) for account — ask conversationally
      if (d.isAccountRelated && d.confidence >= 0.4) {
        meta.conversational = true;
        meta.category = 'account';
        meta.subcategory = 'account_login';
        meta.stage = 'detail';
        extractAccountFieldsFromText(content, meta.collectedFields);
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me a bit more about what you need?` };
      }

      // Cross-domain disambiguation check — only when no single domain won above
      const ambiguity = detectCrossDomainAmbiguity(content);
      if (ambiguity.ambiguous && ambiguity.clarificationQuestion && !meta.disambiguationAsked) {
        meta.disambiguationAsked = true;
        meta.disambiguationDomain = ambiguity.domains.join(',');
        meta.stage = 'detail';
        meta.conversational = true;
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\n${ambiguity.clarificationQuestion}` };
      }

      // H2: Vague-but-domain-signalled fallback — if ANY domain signal is present,
      // route to conversational clarification instead of the category picker.
      // The picker is the last resort for genuinely unclassifiable input only.
      const vagueAccountSignal = detectAccountFromKeywords(content);
      const vagueWebsiteSignal = detectWebsiteFromKeywords(content);
      const vaguePropertySignal = detectPropertyFromKeywords(content);

      if (vagueAccountSignal.likely) {
        meta.category = 'account';
        meta.conversational = true;
        meta.subcategory = vagueAccountSignal.subcategory || 'account_login';
        meta.stage = 'detail';
        extractAccountFieldsFromText(content, meta.collectedFields);
        if (vagueAccountSignal.securitySensitive) {
          meta.securitySensitive = true;
          meta.collectedFields.urgency = 'High';
          const personName = meta.collectedFields.affectedPersonName;
          if (personName && meta.collectedFields.affectedPersonEmail) {
            const summaryResult = this.buildSummaryCard(meta);
            return {
              response: `Understood — I'll get ${personName}'s access removed urgently.\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }
          if (personName) {
            return { response: `Understood — I'll get ${personName}'s access removed urgently. Could you confirm their email address so I can get this raised?` };
          }
          return { response: `Understood — I'll get this raised urgently. Could you confirm their name and email address so I can get this raised?` };
        }
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening?` };
      }

      if (vagueWebsiteSignal.likely) {
        meta.category = 'website';
        meta.conversational = true;
        meta.subcategory = vagueWebsiteSignal.subcategory || 'website_content';
        meta.stage = 'detail';
        const ack = d.acknowledgment || "Thanks for getting in touch about your website.";
        return { response: `${ack}\n\nCould you tell me a bit more — is something not displaying correctly, or do you need some content updated?` };
      }

      if (vaguePropertySignal.likely) {
        meta.category = 'property';
        meta.conversational = true;
        meta.subcategory = vaguePropertySignal.subcategory || 'property_visibility';
        meta.stage = 'detail';
        extractPropertyFieldsFromText(content, meta.collectedFields);
        const ack = d.acknowledgment || "Thanks for getting in touch about your property listing.";
        return { response: `${ack}\n\nCould you tell me which property is affected and where you're seeing the issue?` };
      }

      // F5: Escalation/chase detection — messages referencing prior tickets/requests
      // should trigger conversational follow-up, never the category picker.
      if (ESCALATION_CHASE_PATTERNS.test(content)) {
        meta.conversational = true;
        meta.stage = 'detail';
        meta.escalationDetected = true;
        const ack = d.acknowledgment || "I can see you've been in touch about this before — sorry it's not been resolved yet.";
        return { response: `${ack}\n\nCould you tell me a bit more about the issue you originally raised so I can get this picked up?` };
      }

      // Genuinely unclassifiable — no domain signal detected at all. Category picker is appropriate.
      meta.stage = 'category';
      const prefix = d.intent === 'change'
        ? "Thanks — I'll help you get that change request submitted."
        : d.intent === 'question'
          ? "I couldn't find a direct answer in our knowledge base, but let me help you get in touch with the right team."
          : "Sorry to hear you're having trouble — let me help you get this sorted.";

      const q = this.buildCategoryQuestion();
      return { response: `${prefix}\n\n${q.text}`, messageMeta: q.messageMeta };
    } catch (err) {
      console.warn('[portal-chat] Conversational intake LLM call failed:', err instanceof Error ? err.message : err);
      return this.handleIntentWithoutLlm(meta, content);
    }
  }

  private handleIntentWithoutLlm(
    meta: IntakeSessionMetadata,
    content: string,
  ): { response: string; messageMeta?: ChatMessageMetadata } {
    // Check property first when portal indicators are present — avoids
    // website detection winning on messages like "not showing on Zoopla or our website"
    const propertyDetection = detectPropertyFromKeywords(content);
    if (propertyDetection.likely) {
      return this.handlePropertyFallback(meta, content, propertyDetection);
    }

    // Account / access / office change detection (before website, to catch login/access)
    const accountDetection = detectAccountFromKeywords(content);
    if (accountDetection.likely) {
      // But check if website display is the actual complaint — website wins in that case
      const websiteCheck = detectWebsiteFromKeywords(content);
      if (websiteCheck.likely && /\b(website|web site|our site|the site|page|display|showing)\b/i.test(content) && /\b(wrong|incorrect|outdated|old|shows?|update|change)\b/i.test(content)) {
        // Website display complaint takes priority — fall through to website detection below
      } else {
        return this.handleAccountFallback(meta, content, accountDetection);
      }
    }

    const websiteDetection = detectWebsiteFromKeywords(content);

    if (websiteDetection.likely) {
      meta.intent = /\b(not working|isn.?t working|broken|error|down|can.?t|won.?t)\b/i.test(content) ? 'problem' : 'change';
      meta.category = 'website';
      meta.conversational = true;
      meta.stage = 'detail';

      if (websiteDetection.subcategory) {
        meta.subcategory = websiteDetection.subcategory;

        const config = CATEGORY_FIELD_CONFIG[meta.subcategory] || CATEGORY_FIELD_CONFIG['other_general']!;
        const missing = this.getMissingFields(meta.collectedFields, config);

        if (missing.length === 0) {
          return this.buildSummaryCard(meta);
        }

        const nextMissing = missing.find(f => f !== 'description') || missing[0];
        const question = this.buildConversationalQuestion(nextMissing, meta);
        const ack = this.buildTemplateAcknowledgement(meta);
        const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
        return { response: `${ack} ${question}${fileNote}` };
      }

      // Website likely but can't determine subcategory — ask conversationally
      meta.subcategory = 'website_content';
      const ack = this.buildTemplateAcknowledgement(meta);
      const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
      return { response: `${ack} Could you tell me a bit more — is something not displaying correctly, or do you need some content updated?${fileNote}` };
    }

    // F5: Escalation/chase detection — before picker fallback
    if (ESCALATION_CHASE_PATTERNS.test(content)) {
      meta.conversational = true;
      meta.stage = 'detail';
      meta.escalationDetected = true;
      return { response: "I can see you've been in touch about this before — sorry it's not been resolved yet.\n\nCould you tell me a bit more about the issue you originally raised so I can get this picked up?" };
    }

    // Not recognisably a website or property request — fall through to category picker
    meta.intent = 'problem';
    meta.stage = 'category';
    const q = this.buildCategoryQuestion();
    return { response: q.text, messageMeta: q.messageMeta };
  }

  private handlePropertyFallback(
    meta: IntakeSessionMetadata,
    content: string,
    detection: { likely: boolean; subcategory: string | null },
  ): { response: string; messageMeta?: ChatMessageMetadata } {
    meta.intent = 'problem';
    meta.category = 'property';
    meta.conversational = true;
    meta.stage = 'detail';
    extractPropertyFieldsFromText(content, meta.collectedFields);

    if (detection.subcategory) {
      meta.subcategory = detection.subcategory;
      const missing = this.getPropertyMissingFields(meta.collectedFields, meta.subcategory);

      if (missing.length === 0) {
        return this.buildSummaryCard(meta);
      }

      const question = this.buildPropertyFollowUp(missing[0], meta);
      const propAck = this.buildTemplateAcknowledgement(meta);
      const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
      return { response: `${propAck} ${question}${fileNote}` };
    }

    meta.subcategory = 'property_visibility';
    const propAck = this.buildTemplateAcknowledgement(meta);
    const fileNote = meta.attachmentMentioned ? "\n\nYou'll be able to upload files when we get to the summary step." : '';
    return { response: `${propAck} Could you tell me which property is affected and where you're seeing the issue?${fileNote}` };
  }

  private handleAccountFallback(
    meta: IntakeSessionMetadata,
    content: string,
    detection: { likely: boolean; subcategory: string | null; securitySensitive: boolean },
  ): { response: string; messageMeta?: ChatMessageMetadata } {
    meta.intent = 'change';
    meta.category = 'account';
    meta.conversational = true;
    meta.stage = 'detail';
    extractAccountFieldsFromText(content, meta.collectedFields);

    if (detection.securitySensitive) {
      meta.subcategory = 'account_remove_user';
      meta.securitySensitive = true;
      meta.collectedFields.urgency = 'High';

      const personName = meta.collectedFields.affectedPersonName;
      const personEmail = meta.collectedFields.affectedPersonEmail;

      if (personName && personEmail) {
        const summaryResult = this.buildSummaryCard(meta);
        return {
          response: `Understood — I'll get ${personName}'s access removed urgently.\n\n${summaryResult.response}`,
          messageMeta: summaryResult.messageMeta,
        };
      }

      if (personName) {
        return { response: `Understood — I'll get ${personName}'s access removed urgently. Could you confirm their email address so I can get this raised?` };
      }
      return { response: `Understood — I'll get this raised urgently. Could you confirm their name and email address so I can get this raised?` };
    }

    if (detection.subcategory) {
      meta.subcategory = detection.subcategory;
      const missing = this.getAccountMissingFields(meta.collectedFields, meta.subcategory);

      if (missing.length === 0) {
        return this.buildSummaryCard(meta);
      }

      const ack = this.buildAccountAcknowledgement(meta);
      const question = this.buildAccountFollowUp(missing[0], meta);
      return { response: `${ack} ${question}` };
    }

    meta.subcategory = 'account_login';
    const ack = this.buildAccountAcknowledgement(meta);
    return { response: `${ack} Could you tell me a bit more about what's happening?` };
  }

  // ── Status Intent ──

  private async handleStatusIntent(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // Try to find tickets for this user's org
    const domain = await this.portalJira.getOrgEmailDomain(context.orgId);
    if (!domain) {
      meta.stage = 'category';
      const q = this.buildCategoryQuestion();
      return { response: "I couldn't find your organisation's tickets. Would you like to raise a new request instead?\n\n" + q.text, messageMeta: q.messageMeta };
    }

    // Look for a ticket reference in the message
    const ticketMatch = content.match(/\b(NT|NTPJ)-\d+\b/i);

    if (ticketMatch) {
      const ticketKey = ticketMatch[0].toUpperCase();
      try {
        const ticket = await queryOne<{ issue_key: string; summary: string; status: string; assignee_display: string | null; updated_at: string }>(
          `SELECT issue_key, summary, status, assignee_display, updated_at FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
          [ticketKey, `%@${domain}`],
        );
        if (ticket) {
          meta.stage = 'confirmed';
          return {
            response: `Here's the status of **${ticket.issue_key}**:\n\n- **Summary:** ${ticket.summary}\n- **Status:** ${ticket.status}\n- **Assignee:** ${ticket.assignee_display || 'Unassigned'}\n- **Last updated:** ${new Date(ticket.updated_at).toLocaleDateString()}\n\nYou can view full details in the "My Tickets" section. Is there anything else I can help with?`,
          };
        }
      } catch { /* fall through */ }
    }

    // Show recent tickets
    const recent = await query<{ issue_key: string; summary: string; status: string; updated_at: string }>(
      `SELECT TOP 5 issue_key, summary, status, updated_at FROM jira_issue_cache WHERE reporter_email LIKE ? ORDER BY updated_at DESC`,
      [`%@${domain}`],
    );

    if (recent.length > 0) {
      const list = recent.map(t => `- **${t.issue_key}**: ${t.summary} — *${t.status}*`).join('\n');
      meta.stage = 'confirmed';
      return {
        response: `Here are your most recent tickets:\n\n${list}\n\nYou can view full details in the "My Tickets" section. Would you like to raise a new request, or is there anything else I can help with?`,
      };
    }

    meta.stage = 'category';
    const q = this.buildCategoryQuestion();
    return { response: "I couldn't find any recent tickets for your organisation. Would you like to raise a new request?\n\n" + q.text, messageMeta: q.messageMeta };
  }

  // ── Stage 2: Category Selection ──

  private async handleCategoryStage(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    const explicitChoice = this.matchCategoryOrSubcategoryChoice(content);
    if (explicitChoice.category) {
      meta.category = explicitChoice.category;
      if (explicitChoice.subcategory) {
        meta.subcategory = explicitChoice.subcategory;
        meta.stage = 'detail';
        return { response: this.buildFirstDetailQuestion(meta) };
      }
      return this.askSubcategory(meta, explicitChoice.category);
    }

    // If we already have a category (e.g. user picked from the list), check for subcategory
    if (meta.category && !meta.subcategory) {
      return this.handleSubcategoryPick(meta, content, context);
    }

    // Use LLM to map user's response to a category
    if (this.llm) {
      try {
        const categoryList = Object.entries(CATEGORY_NAMES).map(([id, name]) => `${id}: ${name}`).join('\n');
        const subcategoryList = Object.entries(SUBCATEGORY_NAMES).map(([id, name]) => `${id}: ${name}`).join('\n');

        const result = await this.llm.call(
          `Map the user's response to the best matching category and optional subcategory.

Top-level categories:
${categoryList}

Subcategories:
${subcategoryList}

Return the category ID (e.g. "website") and optionally a subcategory ID (e.g. "website_broken"). If unsure, set confidence below 0.5.`,
          content,
          CategoryPickSchema,
          { callType: 'portal_chat', tier: 'standard', maxTokens: 200, temperature: 0.1 },
        );

        const catId = result.data.category;
        const subId = result.data.subcategory;

        if (CATEGORY_NAMES[catId]) {
          meta.category = catId;
          if (subId && CATEGORY_FIELD_CONFIG[subId]) {
            meta.subcategory = subId;
            meta.stage = 'detail';
            return { response: this.buildFirstDetailQuestion(meta) };
          }
          // Ask for subcategory
          return this.askSubcategory(meta, catId);
        }
      } catch (err) {
        console.warn('[portal-chat] Category classification failed:', err instanceof Error ? err.message : err);
      }
    }

    // Fallback: re-ask
    const q = this.buildCategoryQuestion();
    return { response: `I didn't quite catch that. ${q.text}`, messageMeta: q.messageMeta };
  }

  private handleSubcategoryPick(
    meta: IntakeSessionMetadata,
    content: string,
    _context: ChatContext,
  ): { response: string; messageMeta?: ChatMessageMetadata } {
    const catId = meta.category!;
    const subs = Object.entries(SUBCATEGORY_NAMES).filter(([id]) => id.startsWith(catId + '_') || id.startsWith(catId.replace('_marketing', '') + '_'));
    const selectedId = this.matchSubcategoryChoice(catId, content);
    const match = selectedId ? subs.find(([id]) => id === selectedId) : null;

    if (match) {
      meta.subcategory = match[0];
    } else {
      // Default to the first subcategory containing relevant keywords, or first one
      meta.subcategory = subs[0]?.[0] || `${catId}_general`;
    }

    meta.stage = 'detail';
    return { response: this.buildFirstDetailQuestion(meta) };
  }

  private askSubcategory(meta: IntakeSessionMetadata, catId: string): { response: string; messageMeta?: ChatMessageMetadata } {
    const subs = Object.entries(SUBCATEGORY_NAMES).filter(([id]) => id.startsWith(catId + '_') || id.startsWith(catId.replace('_marketing', '') + '_'));
    if (subs.length === 0) {
      meta.subcategory = `${catId}_general`;
      meta.stage = 'detail';
      return { response: this.buildFirstDetailQuestion(meta) };
    }

    const categories = subs.map(([id, name]) => ({ id, name, description: '' }));
    return {
      response: 'Can you be more specific?',
      messageMeta: { type: 'subcategory_picker', categories },
    };
  }

  // ── Stage 3: Detail Gathering ──

  private async handleDetailStage(
    meta: IntakeSessionMetadata,
    content: string,
    history: Array<{ role: string; content: string }>,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // Handle disambiguation response — route based on the customer's clarifying answer
    if (meta.disambiguationAsked && !meta.category) {
      meta.disambiguationAsked = false; // consume the flag — never ask a second time
      const resolved = this.resolveDisambiguation(content, meta.disambiguationDomain || '');
      meta.category = resolved.category;
      meta.subcategory = resolved.subcategory;
      if (resolved.ambiguityNote) meta.ambiguityNote = resolved.ambiguityNote;

      extractAccountFieldsFromText(content, meta.collectedFields);

      const missing = meta.category === 'account'
        ? this.getAccountMissingFields(meta.collectedFields, meta.subcategory || '')
        : meta.category === 'property'
          ? this.getPropertyMissingFields(meta.collectedFields, meta.subcategory || '')
          : this.getMissingFields(meta.collectedFields, CATEGORY_FIELD_CONFIG[meta.subcategory || ''] || CATEGORY_FIELD_CONFIG['other_general']!);

      if (missing.length === 0) {
        return this.buildSummaryCard(meta);
      }

      const question = meta.category === 'account'
        ? this.buildAccountFollowUp(missing[0], meta)
        : meta.category === 'property'
          ? this.buildPropertyFollowUp(missing[0], meta)
          : this.buildConversationalQuestion(missing[0], meta);

      return { response: `Thanks for clarifying. ${question}` };
    }

    // Track exchanges for "other" intent — offer handoff after threshold
    if (meta.intent === 'question' && (meta.category === 'other' || !meta.category)) {
      const threshold = parseInt(this.settings.get('portal_chat_handoff_threshold') || '3', 10);
      meta.otherExchangeCount = (meta.otherExchangeCount || 0) + 1;
      if (meta.otherExchangeCount >= threshold) {
        return {
          response: "I'm not sure I'm able to resolve this through chat. Would you like me to **create a support ticket** so a team member can help?",
        };
      }
    }

    // Detect attachment mentions
    const attachmentJustMentioned = !meta.attachmentMentioned && ATTACHMENT_PATTERNS.test(content);
    if (attachmentJustMentioned) {
      meta.attachmentMentioned = true;
    }
    const attachmentAck = attachmentJustMentioned
      ? "Noted — you'll be able to upload files when we get to the summary step.\n\n"
      : '';

    // Extract fields from the user's message
    await this.extractFields(meta, content);

    // Use domain-specific field checks
    const missing = meta.category === 'property'
      ? this.getPropertyMissingFields(meta.collectedFields, meta.subcategory || '')
      : meta.category === 'account'
        ? this.getAccountMissingFields(meta.collectedFields, meta.subcategory || '')
        : this.getMissingFields(meta.collectedFields, CATEGORY_FIELD_CONFIG[meta.subcategory || ''] || CATEGORY_FIELD_CONFIG['other_general']!);

    if (missing.length === 0) {
      // All required fields collected — move to KB check
      return this.tryKbDeflection(meta, context, sessionId);
    }

    // Ask for the next missing field — conversational or generic
    if (meta.conversational) {
      if (meta.category === 'property') {
        const question = await this.buildPropertyConversationalFollowUp(missing[0], meta, history);
        return { response: `${attachmentAck}${question}` };
      }
      if (meta.category === 'account') {
        const question = await this.buildAccountConversationalFollowUp(missing[0], meta, history);
        return { response: `${attachmentAck}${question}` };
      }
      const question = await this.buildConversationalFollowUp(missing[0], meta, history);
      return { response: `${attachmentAck}${question}` };
    }
    const config = CATEGORY_FIELD_CONFIG[meta.subcategory || ''] || CATEGORY_FIELD_CONFIG['other_general']!;
    return { response: `${attachmentAck}${this.buildDetailQuestion(missing[0], config)}` };
  }

  private async extractFields(meta: IntakeSessionMetadata, content: string): Promise<void> {
    // Regex fallback — catch structured data the LLM might miss
    this.extractFieldsRegex(meta, content);

    // Domain-specific regex extraction
    if (meta.category === 'property') {
      extractPropertyFieldsFromText(content, meta.collectedFields);
    }
    if (meta.category === 'account') {
      extractAccountFieldsFromText(content, meta.collectedFields);
    }

    if (!this.llm) {
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
      return;
    }

    try {
      const result = await this.llm.call(
        `Extract ticket fields from this customer support message. Only include fields that are clearly stated. Do not guess.
Return JSON with only the fields present in the message.`,
        content,
        FieldExtractSchema,
        { callType: 'portal_chat', tier: 'standard', maxTokens: 400, temperature: 0.1 },
      );

      const data = result.data;
      if (data.subject && !meta.collectedFields.subject) meta.collectedFields.subject = data.subject;
      if (data.account && !meta.collectedFields.account) meta.collectedFields.account = data.account;
      if (data.url && !meta.collectedFields.url) meta.collectedFields.url = data.url;
      if (data.errorMessage && !meta.collectedFields.errorMessage) meta.collectedFields.errorMessage = data.errorMessage;
      if (data.browser && !meta.collectedFields.browser) meta.collectedFields.browser = data.browser;
      if (data.os && !meta.collectedFields.os) meta.collectedFields.os = data.os;
      if (data.urgency) meta.collectedFields.urgency = data.urgency;
      if (data.contactPreference) meta.collectedFields.contactPreference = data.contactPreference;

      // Accumulate raw content, not LLM rewrites — append the user's actual words
      if (!meta.collectedFields.description) {
        meta.collectedFields.description = content;
      } else if (content !== meta.openingMessage) {
        // Multi-turn: append this follow-up message verbatim
        meta.collectedFields.description = `${meta.collectedFields.description}\n${content}`;
      }
    } catch (err) {
      console.warn('[portal-chat] Field extraction failed:', err instanceof Error ? err.message : err);
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
    }
  }

  private extractFieldsRegex(meta: IntakeSessionMetadata, content: string): void {
    const f = meta.collectedFields;

    // URL
    if (!f.url) {
      const url = extractUrlFromText(content);
      if (url) f.url = url;
    }

    // Email address (contact preference hint)
    if (!f.contactPreference || f.contactPreference === 'portal') {
      if (/\b(email me|reply by email|send.*email)\b/i.test(content)) f.contactPreference = 'email';
      if (/\b(call me|phone me|ring me)\b/i.test(content)) f.contactPreference = 'phone';
    }

    // Phone numbers — preserve verbatim (common in change requests)
    // Not extracted as a field but presence validates the description has operational data

    // Browser detection
    if (!f.browser) {
      const browserMatch = content.match(/\b(Chrome|Firefox|Safari|Edge|Opera|Brave|Internet Explorer|IE)\b/i);
      if (browserMatch) f.browser = browserMatch[1];
    }

    // OS detection
    if (!f.os) {
      const osMatch = content.match(/\b(Windows|Mac\s?OS|macOS|Linux|iOS|Android|iPad|iPhone)\b/i);
      if (osMatch) f.os = osMatch[1];
    }

    // Account/brand name — look for "for [Name]" or "[Name] account" patterns
    if (!f.account) {
      const accountMatch = content.match(/\b(?:for|account(?:\s+name)?[:：]?\s+)([A-Z][A-Za-z0-9 &'-]{2,40})\b/);
      if (accountMatch) f.account = accountMatch[1].trim();
    }
  }

  private getMissingFields(
    fields: IntakeCollectedFields,
    config: { url: boolean; browser: boolean; errorMessage: boolean; account: boolean },
  ): string[] {
    const missing: string[] = [];
    if (!fields.description) missing.push('description');
    if (config.account && !fields.account) missing.push('account');
    if (config.url && !fields.url) missing.push('url');
    if (config.errorMessage && !fields.errorMessage) missing.push('errorMessage');
    if (config.browser && !fields.browser) missing.push('browser');
    return missing;
  }

  private buildDetailQuestion(field: string, config: { description_hint: string }): string {
    switch (field) {
      case 'description':
        return `Could you describe the issue in more detail? ${config.description_hint}`;
      case 'account':
        return "Which account or website is this for?";
      case 'url':
        return "Could you share the URL or page where this is happening?";
      case 'errorMessage':
        return "Are there any error messages showing? If so, please copy and paste them.";
      case 'browser':
        return "Which browser are you using? (e.g. Chrome, Edge, Firefox)";
      default:
        return "Could you provide any more details?";
    }
  }

  private buildFirstDetailQuestion(meta: IntakeSessionMetadata): string {
    const config = CATEGORY_FIELD_CONFIG[meta.subcategory || ''] || CATEGORY_FIELD_CONFIG['other_general']!;
    const catName = CATEGORY_NAMES[meta.category || ''] || meta.category;
    const subName = SUBCATEGORY_NAMES[meta.subcategory || ''] || meta.subcategory;

    const missing = this.getMissingFields(meta.collectedFields, config);
    if (missing.length === 0) {
      return `Got it — **${catName}** > **${subName}**. I think I have everything I need. Let me put together a summary for you.`;
    }

    const firstQ = this.buildDetailQuestion(missing[0], config);
    return `Got it — **${catName}** > **${subName}**. ${firstQ}`;
  }

  // ── Stage 4: KB Deflection ──

  private async tryKbDeflection(
    meta: IntakeSessionMetadata,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    if (meta.kbSuggested) {
      return this.buildSummaryCard(meta);
    }

    try {
      const searchQuery = [
        meta.collectedFields.subject,
        meta.collectedFields.description,
        meta.category,
      ].filter(Boolean).join(' ').slice(0, 300);

      const articles = await this.searchKb(searchQuery);
      if (articles.length > 0) {
        meta.stage = 'kb_check';
        meta.kbSuggested = true;
        return {
          response: 'Before I create a ticket, I found an article that might help:',
          messageMeta: {
            type: 'kb_suggestions' as const,
            articles: articles.map(a => ({ id: 0, title: a.title, excerpt: a.excerpt })),
          },
        };
      }
      // No KB match — log the gap
      await this.logKbGap(searchQuery, meta.category, sessionId);
    } catch (err) {
      console.warn('[portal-chat] KB deflection search failed:', err instanceof Error ? err.message : err);
    }

    return this.buildSummaryCard(meta);
  }

  private async handleKbCheckResponse(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    const affirmative = /^(yes|yeah|yep|that helps|solved|fixed|thanks|thank you|perfect)\b/i.test(content.trim());

    if (affirmative) {
      meta.stage = 'confirmed';
      meta.deflected = true;

      await execute(
        `UPDATE portal_chat_sessions SET status = 'resolved' WHERE id = ?`,
        [sessionId],
      ).catch(err => console.warn('[portal-chat] Failed to mark session resolved:', err instanceof Error ? err.message : err));

      await trackEvent('intake_kb_deflection', context.portalUserId, context.orgId, {
        session_id: sessionId,
        category: meta.category,
      }).catch(err => console.warn('[portal-chat] Failed to track deflection event:', err instanceof Error ? err.message : err));

      return { response: "Great, glad that helped! If you need anything else, just start a new conversation." };
    }

    // User said no — continue to summary
    return this.buildSummaryCard(meta);
  }

  // ── Stage 5: Summary Card ──

  private buildSummaryCard(meta: IntakeSessionMetadata): { response: string; messageMeta: ChatMessageMetadata } {
    meta.stage = 'summary';

    // Auto-generate subject if missing
    if (!meta.collectedFields.subject) {
      const catName = CATEGORY_NAMES[meta.category || ''] || 'Support';
      const subName = SUBCATEGORY_NAMES[meta.subcategory || ''];
      const desc = meta.collectedFields.description?.slice(0, 80) || '';
      meta.collectedFields.subject = subName
        ? `[Portal] ${catName} — ${subName}: ${desc}`.slice(0, 250)
        : `[Portal] ${catName}: ${desc}`.slice(0, 250);
    }

    const f = meta.collectedFields;
    const messageMeta: ChatMessageMetadata = {
      type: 'summary_card',
      fields: {
        ...f,
        category: meta.category,
        subcategory: meta.subcategory,
      },
    };

    const lines = [`**Subject:** ${f.subject}`];
    if (meta.conversational) {
      // Customer-friendly request type — no internal taxonomy
      const friendlyType = SUBCATEGORY_NAMES[meta.subcategory || ''] || CATEGORY_NAMES[meta.category || ''] || 'Support request';
      lines.push(`**Request type:** ${friendlyType}`);
    } else {
      lines.push(`**Category:** ${CATEGORY_NAMES[meta.category || ''] || meta.category || 'General'}${meta.subcategory ? ` > ${SUBCATEGORY_NAMES[meta.subcategory] || meta.subcategory}` : ''}`);
    }
    if (f.account) lines.push(`**Account:** ${f.account}`);
    if (f.propertyAddress) lines.push(`**Property:** ${f.propertyAddress}`);
    if (f.listingId) lines.push(`**Listing ref:** ${f.listingId}`);
    if (f.affectedPortals) lines.push(`**Affected:** ${f.affectedPortals}`);
    if (f.affectedPersonName) lines.push(`**Person:** ${f.affectedPersonName}`);
    if (f.affectedPersonEmail) lines.push(`**Person's email:** ${f.affectedPersonEmail}`);
    if (f.officeBranch) lines.push(`**Office/branch:** ${f.officeBranch}`);
    if (f.description) lines.push(`**Description:** ${f.description}`);
    if (f.url) lines.push(`**URL:** ${f.url}`);
    if (f.errorMessage) lines.push(`**Error:** ${f.errorMessage}`);
    if (f.browser) lines.push(`**Browser:** ${f.browser}`);
    if (f.propertyStatus) lines.push(`**Status issue:** ${f.propertyStatus}`);
    lines.push(`**Urgency:** ${f.urgency}`);
    lines.push(`**Contact preference:** ${f.contactPreference}`);

    const attachmentNote = meta.attachmentMentioned
      ? '\n\nYou mentioned an attachment — you\'ll be able to upload files before submitting.'
      : '';

    return {
      response: `Here's a summary of your request. Please review and confirm, or let me know if anything needs changing.\n\n${lines.join('\n')}${attachmentNote}`,
      messageMeta,
    };
  }

  // ── Stage 5b: Summary Edit ──

  private async handleSummaryEdit(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // User is chatting from the summary stage — they want to edit something
    await this.extractFields(meta, content);
    // Re-show summary card with updated fields
    return this.buildSummaryCard(meta);
  }

  // ── Stage 6: Confirmation (called from route, not from sendMessage) ──

  async confirmAndSubmit(
    sessionId: number,
    fields: Partial<IntakeCollectedFields> & { category?: string; subcategory?: string },
    context: ChatContext,
  ): Promise<{ ticketKey: string }> {
    const session = await queryOne<{ metadata: string | null }>(
      `SELECT metadata FROM portal_chat_sessions WHERE id = ?`,
      [sessionId],
    );
    const meta = parseMetadata(session?.metadata ?? null);

    // Merge any edits from the summary card
    if (fields.subject !== undefined) meta.collectedFields.subject = fields.subject;
    if (fields.account !== undefined) meta.collectedFields.account = fields.account;
    if (fields.description !== undefined) meta.collectedFields.description = fields.description;
    if (fields.url !== undefined) meta.collectedFields.url = fields.url;
    if (fields.errorMessage !== undefined) meta.collectedFields.errorMessage = fields.errorMessage;
    if (fields.browser !== undefined) meta.collectedFields.browser = fields.browser;
    if (fields.os !== undefined) meta.collectedFields.os = fields.os;
    if (fields.urgency !== undefined) meta.collectedFields.urgency = fields.urgency ?? 'Normal';
    if (fields.contactPreference !== undefined) meta.collectedFields.contactPreference = fields.contactPreference ?? 'portal';
    if (fields.category !== undefined) meta.category = fields.category;
    if (fields.subcategory !== undefined) meta.subcategory = fields.subcategory;

    const f = meta.collectedFields;

    // Build transcript for internal note
    const history = await query<{ role: string; content: string; created_at: string }>(
      `SELECT role, content, created_at FROM portal_chat_messages WHERE session_id = ? ORDER BY created_at`,
      [sessionId],
    );
    const transcript = history.map(m => `[${m.role}]: ${m.content}`).join('\n\n');

    // Use intake service if available, otherwise create directly
    let ticketKey: string;

    if (this.intakeService) {
      const result = await this.intakeService.submitTicket(
        {
          subject: f.subject || `[Portal] Support request from ${context.userName}`,
          category: meta.category || 'other',
          subcategory: meta.subcategory || undefined,
          description: f.description || 'See chat transcript',
          account: f.account || undefined,
          url: f.url || undefined,
          errorMessage: f.errorMessage || undefined,
          browser: f.browser || undefined,
          os: f.os || undefined,
          urgency: f.urgency,
          contactPreference: f.contactPreference,
        },
        context.portalUserId,
        context.orgId,
        context.userEmail,
        context.userName,
      );
      ticketKey = result.ticketKey;
    } else {
      // Direct creation fallback — pass hint name, createTicket resolves against the Jira instance
      const projectKey = this.settings.get('portal_jira_project_nt') || 'NT';
      const urgencyHint: Record<string, string> = { Normal: 'Medium', High: 'High', Critical: 'Highest' };

      ticketKey = await this.portalJira.createTicket({
        projectKey,
        summary: f.subject || `[Portal] Support request from ${context.userName}`,
        description: f.description || 'See chat transcript',
        priority: urgencyHint[f.urgency] || 'Medium',
        reporterEmail: context.userEmail,
        internalNote: `*Chat intake — ${meta.category || 'General'}*${meta.ambiguityNote ? `\n\n⚠️ ${meta.ambiguityNote}` : ''}${meta.securitySensitive ? '\n\n🔒 Security-sensitive: user removal / access revocation — treat as urgent' : ''}\n\n${transcript}`,
      });
    }

    // Update session
    meta.stage = 'confirmed';
    meta.offeredTicketCreation = false;
    await execute(
      `UPDATE portal_chat_sessions SET jira_issue_key = ?, status = 'handed_off', metadata = ? WHERE id = ?`,
      [ticketKey, JSON.stringify(meta), sessionId],
    );

    // Store confirmation message
    const confirmMsg = `I've created ticket **${ticketKey}**. You can track its progress in your tickets page.`;
    await execute(
      `INSERT INTO portal_chat_messages (session_id, role, content)
       VALUES (?, 'assistant', ?)`,
      [sessionId, confirmMsg],
    );

    await trackEvent('intake_confirmed', context.portalUserId, context.orgId, {
      session_id: sessionId,
      ticket_key: ticketKey,
      category: meta.category,
      intent: meta.intent,
    });

    return { ticketKey };
  }

  // ── Conversational Helpers ──

  private getFirstMissingField(meta: IntakeSessionMetadata): string | null {
    const config = CATEGORY_FIELD_CONFIG[meta.subcategory || ''] || CATEGORY_FIELD_CONFIG['other_general']!;
    const missing = this.getMissingFields(meta.collectedFields, config);
    return missing[0] || null;
  }

  private getPropertyMissingFields(fields: IntakeCollectedFields, subcategory: string): string[] {
    const missing: string[] = [];
    if (!fields.description) missing.push('description');
    if (!fields.propertyAddress && !fields.listingId) missing.push('propertyIdentifier');
    if (!fields.affectedPortals && ['property_missing_listing', 'property_feed_sync', 'property_visibility', 'property_incorrect_details'].includes(subcategory)) {
      missing.push('affectedPortals');
    }
    if (!fields.account) missing.push('account');
    return missing;
  }

  private buildPropertyFollowUp(field: string, meta: IntakeSessionMetadata): string {
    const ctx = briefContext(meta);

    const withContext = (question: string): string => {
      if (!ctx) return question;
      const lc = ctx.toLowerCase().startsWith('i ') ? ctx : ctx.charAt(0).toLowerCase() + ctx.slice(1);
      return `You mentioned ${lc} — ${question.charAt(0).toLowerCase() + question.slice(1)}`;
    };

    switch (field) {
      case 'description':
        if (meta.subcategory === 'property_missing_listing') return "Could you describe what's happening — is the listing missing completely, or is some information not showing?";
        if (meta.subcategory === 'property_incorrect_details') return 'What details are incorrect, and what should they say instead?';
        if (meta.subcategory === 'property_media') return "Could you describe the issue with the photos or media — are they missing, showing the wrong images, or not uploading?";
        if (meta.subcategory === 'property_feed_sync') return "Could you describe what's not updating and when you first noticed it?";
        if (meta.subcategory === 'property_status') return "What status is showing, and what should it be?";
        return 'Could you describe the issue in a bit more detail?';
      case 'propertyIdentifier':
        return withContext('Which property is affected? An address or listing reference would help us look into this.');
      case 'affectedPortals':
        return withContext('Is this affecting your website, property portals like Rightmove or Zoopla, or both?');
      case 'account':
        return withContext('Which account or branch is this for?');
      default:
        return withContext('Could you share a few more details?');
    }
  }

  private getAccountMissingFields(fields: IntakeCollectedFields, subcategory: string): string[] {
    const missing: string[] = [];
    if (!fields.description) missing.push('description');
    if (subcategory === 'account_new_user' || subcategory === 'account_remove_user') {
      if (!fields.affectedPersonName && !fields.affectedPersonEmail) missing.push('affectedPerson');
    }
    if (subcategory === 'account_office_change') {
      if (!fields.officeBranch) missing.push('officeBranch');
    }
    if (!fields.account) missing.push('account');
    return missing;
  }

  private buildAccountFollowUp(field: string, meta: IntakeSessionMetadata): string {
    const ctx = briefContext(meta);

    const withContext = (question: string): string => {
      if (!ctx) return question;
      const lc = ctx.toLowerCase().startsWith('i ') ? ctx : ctx.charAt(0).toLowerCase() + ctx.slice(1);
      return `You mentioned ${lc} — ${question.charAt(0).toLowerCase() + question.slice(1)}`;
    };

    switch (field) {
      case 'description':
        if (meta.subcategory === 'account_login') return "What happens when you try to log in — do you get an error message, or does something else happen?";
        if (meta.subcategory === 'account_new_user') return "Could you let me know what access they'll need?";
        if (meta.subcategory === 'account_permissions') return "What are you trying to access, and what happens when you try?";
        if (meta.subcategory === 'account_office_change') return "Could you tell me a bit more about what needs to change?";
        if (meta.subcategory === 'account_details') return "What details need updating?";
        return "Could you describe what's happening in a bit more detail?";
      case 'affectedPerson':
        if (meta.subcategory === 'account_remove_user') return withContext("Could you confirm their name and email address?");
        return withContext("Could you let me know the person's name and email address?");
      case 'officeBranch':
        return withContext("Which office or branch is this for?");
      case 'account':
        return withContext("Which account or company is this for?");
      default:
        return withContext("Could you share a few more details?");
    }
  }

  private buildAccountAcknowledgement(meta: IntakeSessionMetadata): string {
    const f = meta.collectedFields;
    const parts: string[] = [];
    if (f.affectedPersonName) parts.push(f.affectedPersonName);
    if (f.officeBranch) parts.push(`the ${f.officeBranch} office`);

    const context = briefContext(meta);

    if (parts.length > 0 && context) {
      return `Thanks for letting us know about ${parts.join(' and ')} — I can see ${context.toLowerCase().startsWith('i ') ? context : context.charAt(0).toLowerCase() + context.slice(1)}.`;
    }
    if (parts.length > 0) {
      return `Thanks for letting us know about ${parts.join(' and ')}.`;
    }
    if (meta.subcategory === 'account_login') {
      return context ? `Sorry to hear you're having trouble getting in — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "Sorry to hear you're having trouble getting in.";
    }
    if (meta.subcategory === 'account_new_user') {
      return context ? `I'll help you get that set up — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "I'll help you get that new user set up.";
    }
    if (meta.subcategory === 'account_office_change') {
      return context ? `I'll help you with that — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "I'll help you with that office change.";
    }
    return context ? `Thanks for getting in touch — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "Thanks for getting in touch.";
  }

  private async buildAccountConversationalFollowUp(
    field: string,
    meta: IntakeSessionMetadata,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (this.llm && history.length >= 2) {
      try {
        const recentExchange = history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
        const fieldLabel = field === 'affectedPerson' ? "the affected person's name and email"
          : field === 'officeBranch' ? 'which office or branch'
          : field === 'account' ? 'account or company name'
          : field;

        const result = await this.llm.call(
          `You are a friendly support assistant helping a customer with an account/access request. Based on the conversation so far, ask for the missing piece of information naturally.

Missing information: ${fieldLabel}
${meta.collectedFields.description ? `Customer's request so far: ${meta.collectedFields.description.slice(0, 200)}` : ''}

Recent conversation:
${recentExchange}

Rules:
- Ask ONE question only
- Reference what they've already told you where it makes sense
- Keep it short and natural (one sentence)
- Don't repeat information they've already provided
- NEVER ask "which system" or "which platform"
- NEVER use ANY of these terms: RBAC, provisioning, deprovisioning, authentication, authorisation, authorization, access control, role-based, permission matrix, permission model, scopes, entities, service account, SSO, SAML, identity provider, triage, categorise, classify, route, access permissions, user permissions, role permissions, access rights, user access, permission levels
- NEVER reveal multi-system provisioning (setting up one user may affect many systems — the customer sees one request)
- ALWAYS use the customer's own words to describe their problem. If they said "can't get in", say "can't get in". If they said "she can't see anything", say "she can't see anything". Do not rephrase into technical vocabulary.`,
          `Ask for: ${fieldLabel}`,
          ConversationalFollowUpSchema,
          { callType: 'portal_chat', tier: 'standard', maxTokens: 150, temperature: 0.3 },
        );

        if (result.data.question) return result.data.question;
      } catch (err) {
        console.warn('[portal-chat] Account follow-up generation failed:', err instanceof Error ? err.message : err);
      }
    }

    return this.buildAccountFollowUp(field, meta);
  }

  private buildConversationalQuestion(field: string, meta: IntakeSessionMetadata): string {
    switch (field) {
      case 'description':
        if (meta.subcategory === 'website_content') return 'Could you tell me what needs changing and where on the page?';
        if (meta.subcategory === 'website_broken') return "Could you describe what's happening and what you'd expect to see instead?";
        if (meta.subcategory === 'website_new_page') return 'Could you describe what the new page should contain and where it should sit in the navigation?';
        if (meta.subcategory === 'website_design') return 'Could you describe the design changes you have in mind?';
        return 'Could you describe what you need in a bit more detail?';
      case 'account':
        return 'Which account or website is this for?';
      case 'url':
        return 'Which page is this on? A URL would be ideal if you have it.';
      case 'errorMessage':
        return 'Are there any error messages showing when this happens?';
      case 'browser':
        return 'Which browser are you using when you see this?';
      default:
        return 'Could you share a few more details?';
    }
  }

  private async buildPropertyConversationalFollowUp(
    field: string,
    meta: IntakeSessionMetadata,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (this.llm && history.length >= 2) {
      try {
        const recentExchange = history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
        const fieldLabel = field === 'propertyIdentifier' ? 'which property is affected (address or reference)'
          : field === 'affectedPortals' ? 'where the issue is appearing (website, Rightmove, Zoopla, etc.)'
          : field === 'account' ? 'account or branch name'
          : field;

        const result = await this.llm.call(
          `You are a friendly support assistant helping a customer with a property listing issue. Based on the conversation so far, ask for the missing piece of information naturally.

Missing information: ${fieldLabel}
${meta.collectedFields.description ? `Customer's issue so far: ${meta.collectedFields.description.slice(0, 200)}` : ''}

Recent conversation:
${recentExchange}

Rules:
- Ask ONE question only
- Reference what they've already told you where it makes sense
- Keep it short and natural (one sentence)
- Don't repeat information they've already provided
- NEVER use technical jargon like "feed", "syndication", "API", "integration", "CRM", "data sync", "data pipeline", "portal feed", "authentication", "authorisation", "access control"
- ALWAYS use the customer's own words — if they said "not showing on Rightmove", say "not showing on Rightmove". Mirror their vocabulary, do not translate it.`,
          `Ask for: ${fieldLabel}`,
          ConversationalFollowUpSchema,
          { callType: 'portal_chat', tier: 'standard', maxTokens: 150, temperature: 0.3 },
        );

        if (result.data.question) return result.data.question;
      } catch (err) {
        console.warn('[portal-chat] Property follow-up generation failed:', err instanceof Error ? err.message : err);
      }
    }

    return this.buildPropertyFollowUp(field, meta);
  }

  private async buildConversationalFollowUp(
    field: string,
    meta: IntakeSessionMetadata,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    // Try LLM-generated contextual question; fall back to template
    if (this.llm && history.length >= 2) {
      try {
        const recentExchange = history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
        const fieldLabel = field === 'errorMessage' ? 'error message' : field === 'contactPreference' ? 'contact preference' : field;

        const result = await this.llm.call(
          `You are a friendly support assistant helping a customer with a website request. Based on the conversation so far, ask for the missing piece of information naturally.

Missing field: ${fieldLabel}
${meta.collectedFields.description ? `Customer's request so far: ${meta.collectedFields.description.slice(0, 200)}` : ''}

Recent conversation:
${recentExchange}

Rules:
- Ask ONE question only
- Reference what they've already told you where it makes sense
- Keep it short and natural (one sentence)
- Don't repeat information they've already provided
- Don't use internal jargon, category names, or technical terms (feed, syndication, API, CRM, RBAC, provisioning, authentication, authorisation, access control, role-based, permission)
- ALWAYS use the customer's own words to describe their problem — mirror their vocabulary, do not translate it`,
          `Ask for: ${fieldLabel}`,
          ConversationalFollowUpSchema,
          { callType: 'portal_chat', tier: 'standard', maxTokens: 150, temperature: 0.3 },
        );

        if (result.data.question) return result.data.question;
      } catch (err) {
        console.warn('[portal-chat] Conversational follow-up generation failed:', err instanceof Error ? err.message : err);
      }
    }

    return this.buildConversationalQuestion(field, meta);
  }

  private resolveDisambiguation(response: string, domainsStr: string): { category: string; subcategory: string; ambiguityNote: string | null } {
    const lower = response.toLowerCase();
    const domains = domainsStr.split(',');

    // Check for clear account/access signals in the response
    if (/\b(can'?t (log ?in|sign ?in|get ?in|access)|error|locked|password|permission|new (user|starter|person)|set ?up|recently (added|set ?up|created|opened)|just (opened|started|set ?up))\b/.test(lower)) {
      const subcategory = /\b(log ?in|sign ?in|password|locked|error)\b/.test(lower) ? 'account_login'
        : /\b(new|set ?up|recently|just)\b/.test(lower) ? 'account_new_user'
        : 'account_permissions';
      return { category: 'account', subcategory, ambiguityNote: null };
    }

    // Check for website display signals
    if (/\b(website|displaying|showing|page|wrong.*(address|info|details)|outdated|old.*showing)\b/.test(lower)) {
      return { category: 'website', subcategory: 'website_content', ambiguityNote: null };
    }

    // Check for property signals
    if (/\b(listing|property|rightmove|zoopla|portal|not (showing|appearing))\b/.test(lower)) {
      return { category: 'property', subcategory: 'property_visibility', ambiguityNote: null };
    }

    // Check for data/reporting signals
    if (/\b(report|data|dashboard|information|not there|missing|blank|empty|nothing|just.*not.*there)\b/.test(lower)) {
      if (domains.includes('account')) {
        return { category: 'account', subcategory: 'account_permissions', ambiguityNote: null };
      }
    }

    // Ambiguity persists — route to safe default with note
    const safeDefault = domains.includes('account') ? 'account' : domains[0] || 'account';
    const safeSubcategory = safeDefault === 'account' ? 'account_permissions'
      : safeDefault === 'website' ? 'website_content'
      : safeDefault === 'property' ? 'property_visibility'
      : 'other_general';

    return {
      category: safeDefault,
      subcategory: safeSubcategory,
      ambiguityNote: `Customer's description was ambiguous between ${domains.join(' and ')}. After one clarifying exchange, routed to ${safeDefault} as the operationally safe default. Support agent should verify whether other factors are involved.`,
    };
  }

  private buildEmpathyAcknowledgement(meta: IntakeSessionMetadata): string {
    const f = meta.collectedFields;
    const details: string[] = [];
    if (f.propertyAddress) details.push(`the issue with ${f.propertyAddress}`);
    else if (f.listingId) details.push(`the issue with listing ${f.listingId}`);
    if (f.affectedPortals) details.push(`on ${f.affectedPortals}`);
    if (f.affectedPersonName) details.push(`the issue with ${f.affectedPersonName}'s access`);
    if (f.officeBranch) details.push(`the ${f.officeBranch} office`);

    if (details.length > 0) {
      return `I understand this is frustrating, and I can see you've been dealing with ${details.join(' ')} — I'm sorry about that.`;
    }
    if (f.description && f.description.length > 20) {
      return "I can see this is frustrating, and I hear you — I'm sorry you're having to chase this.";
    }
    return "I can see this is frustrating — I'm sorry.";
  }

  private buildTemplateAcknowledgement(meta: IntakeSessionMetadata): string {
    const f = meta.collectedFields;
    const parts: string[] = [];

    if (f.affectedPersonName) parts.push(`the issue with ${f.affectedPersonName}`);
    if (f.propertyAddress) parts.push(f.propertyAddress);
    if (f.listingId && !f.propertyAddress) parts.push(`listing ${f.listingId}`);
    if (f.officeBranch) parts.push(`the ${f.officeBranch} office`);
    if (f.affectedPortals) parts.push(f.affectedPortals);
    if (f.url) parts.push(f.url);
    if (f.account && parts.length === 0) parts.push(f.account);

    const phones = extractPhoneNumbers(f.description || '');
    const phoneSuffix = phones.length > 0 ? ` (${phones.slice(0, 2).join(', ')})` : '';

    if (parts.length > 0) {
      return `Thanks for those details about ${parts.slice(0, 2).join(' on ')}${phoneSuffix}.`;
    }
    if (phoneSuffix) {
      return `Thanks for letting us know about that${phoneSuffix}.`;
    }
    return 'Thanks for letting us know.';
  }

  // ── Helpers ──

  private buildCategoryQuestion(): { text: string; messageMeta: ChatMessageMetadata } {
    const descriptions: Record<string, string> = {
      website: 'Content updates or something not working',
      account: 'Login, passwords, users, permissions',
      email_marketing: 'Campaigns, triggers, templates',
      leadpro: 'Leads, contacts, CRM issues',
      data_feeds: 'Property feeds, integrations, reporting',
      listings: 'Virtual tours, property media',
      onboarding: 'New branch, product, or training',
      billing: 'Cancellations, service changes, queries',
      other: 'Something else',
    };
    const categories = Object.entries(CATEGORY_NAMES).map(([id, name]) => ({
      id,
      name,
      description: descriptions[id] || '',
    }));
    return {
      text: 'Which area does this relate to?',
      messageMeta: { type: 'category_picker', categories },
    };
  }

  private matchCategoryOrSubcategoryChoice(content: string): { category: string | null; subcategory: string | null } {
    const normalised = normaliseChoice(content);
    if (!normalised) return { category: null, subcategory: null };

    for (const [id, name] of Object.entries(CATEGORY_NAMES)) {
      if (normalised === normaliseChoice(id) || normalised === normaliseChoice(name)) {
        return { category: id, subcategory: null };
      }
    }

    for (const [id, name] of Object.entries(SUBCATEGORY_NAMES)) {
      if (normalised === normaliseChoice(id) || normalised === normaliseChoice(name)) {
        return { category: this.getCategoryIdForSubcategory(id), subcategory: id };
      }
    }

    return { category: null, subcategory: null };
  }

  private matchSubcategoryChoice(categoryId: string, content: string): string | null {
    const normalised = normaliseChoice(content);
    if (!normalised) return null;

    const subcategories = Object.entries(SUBCATEGORY_NAMES).filter(([id]) =>
      id.startsWith(`${categoryId}_`) || id.startsWith(`${categoryId.replace('_marketing', '')}_`),
    );

    for (const [id, name] of subcategories) {
      if (normalised === normaliseChoice(id) || normalised === normaliseChoice(name)) {
        return id;
      }
    }

    return null;
  }

  private getCategoryIdForSubcategory(subcategoryId: string): string {
    if (subcategoryId.startsWith('email_')) return 'email_marketing';
    if (subcategoryId.startsWith('feeds_')) return 'data_feeds';
    if (subcategoryId.startsWith('listings_')) return 'listings';
    if (subcategoryId.startsWith('property_')) return 'property';
    const [topLevel] = subcategoryId.split('_');
    return topLevel || 'other';
  }

  private async searchKb(searchQuery: string): Promise<Array<{ title: string; excerpt: string }>> {
    if (!searchQuery || searchQuery.length < 3) return [];

    const terms = searchQuery.split(/\s+/).filter(t => t.length > 2).slice(0, 5);
    if (terms.length === 0) return [];

    const likeConditions = terms.map(() => `(body_text LIKE ? OR title LIKE ?)`).join(' OR ');
    const params: unknown[] = [];
    terms.forEach((t) => { params.push(`%${t}%`, `%${t}%`); });

    const articles = await query<{ title: string; body_text: string }>(
      `SELECT TOP 3 title, LEFT(body_text, 500) AS body_text
       FROM portal_kb_articles
       WHERE ${likeConditions}
       ORDER BY view_count DESC`,
      params,
    );

    return articles.map(a => ({
      title: a.title,
      excerpt: a.body_text.slice(0, 300),
    }));
  }

  private async logKbGap(queryText: string, category: string | null, sessionId: number): Promise<void> {
    try {
      await execute(
        `INSERT INTO kb_gap_log (ticket_id, category, reason, source, query_text)
         VALUES (?, ?, 'No KB article matched portal chat query', 'portal_chat', ?)`,
        [`session-${sessionId}`, category || 'unknown', queryText.slice(0, 1000)],
      );
    } catch (err) {
      console.warn('[portal-chat] Failed to log KB gap:', err instanceof Error ? err.message : err);
    }
  }

  private async forceHandoff(
    meta: IntakeSessionMetadata,
    context: ChatContext,
    sessionId: number,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const f = meta.collectedFields;
    const transcript = history.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
    const projectKey = this.settings.get('portal_jira_project_nt') || 'NT';
    const catName = CATEGORY_NAMES[meta.category || ''] || 'General';

    const ticketKey = await this.portalJira.createTicket({
      projectKey,
      summary: f.subject || `[Portal] ${catName} — auto-handoff from ${context.userName}`.slice(0, 250),
      description: f.description || 'Chat conversation exceeded exchange limit. See transcript in internal notes.',
      priority: f.urgency === 'Critical' ? 'Highest' : f.urgency === 'High' ? 'High' : 'Medium',
      reporterEmail: context.userEmail,
      internalNote: `*Auto-handoff (max exchanges reached, session ${sessionId})*${meta.ambiguityNote ? `\n\n⚠️ ${meta.ambiguityNote}` : ''}${meta.securitySensitive ? '\n\n🔒 Security-sensitive: user removal / access revocation — treat as urgent' : ''}\n\n${transcript}`,
    });

    meta.stage = 'confirmed';
    meta.offeredTicketCreation = false;
    await execute(
      `UPDATE portal_chat_sessions SET jira_issue_key = ?, status = 'handed_off', metadata = ? WHERE id = ?`,
      [ticketKey, JSON.stringify(meta), sessionId],
    );

    await trackEvent('handoff_with_summary', context.portalUserId, context.orgId, {
      session_id: sessionId,
      ticket_key: ticketKey,
      reason: 'max_exchanges',
    });

    return ticketKey;
  }

  // ── Legacy Handoff (kept for old sessions) ──

  async handleHandoff(
    sessionId: number,
    context: ChatContext,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const transcript = history.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
    const projectKey = this.settings.get('portal_jira_project_nt') || 'NT';

    try {
      const ticketKey = await this.portalJira.createTicket({
        projectKey,
        summary: `[Portal] Chat support request from ${context.userName} (${context.orgName})`.slice(0, 250),
        description: `Support chat conversation - user requested human assistance.\n\nPlease review the chat transcript in the internal notes.`,
        priority: 'Medium',
        reporterEmail: context.userEmail,
        internalNote: `*Full Chat Transcript (session ${sessionId})*\n\n${transcript}`,
      });

      await execute(
        `UPDATE portal_chat_sessions SET jira_issue_key = ?, status = 'handed_off' WHERE id = ?`,
        [ticketKey, sessionId],
      );

      await trackEvent('handoff_raw_transcript', context.portalUserId, context.orgId, {
        session_id: sessionId,
        ticket_key: ticketKey,
      });

      return `I've created support ticket **${ticketKey}** and a team member will follow up with you. You can track the progress of this ticket in your portal under "My Tickets".\n\nIs there anything else I can help with?`;
    } catch (err) {
      console.error('[portal-chat] Handoff failed:', err);
      return "I wasn't able to create a ticket automatically. Please try starting a new conversation and I'll help you get this logged.";
    }
  }

  async endSession(sessionId: number): Promise<void> {
    await execute(
      `UPDATE portal_chat_sessions SET status = 'resolved', ended_at = GETUTCDATE() WHERE id = ? AND status = 'active'`,
      [sessionId],
    );
  }

  async getSession(sessionId: number, portalUserId: number): Promise<{ session: PortalChatSession; messages: PortalChatMessage[] } | null> {
    const session = await queryOne<PortalChatSession>(
      `SELECT * FROM portal_chat_sessions WHERE id = ? AND portal_user_id = ?`,
      [sessionId, portalUserId],
    );
    if (!session) return null;

    const messages = await query<PortalChatMessage>(
      `SELECT * FROM portal_chat_messages WHERE session_id = ? ORDER BY created_at`,
      [sessionId],
    );

    return { session, messages };
  }

  async listSessions(portalUserId: number): Promise<PortalChatSession[]> {
    return query<PortalChatSession>(
      `SELECT * FROM portal_chat_sessions WHERE portal_user_id = ? ORDER BY started_at DESC`,
      [portalUserId],
    );
  }
}
