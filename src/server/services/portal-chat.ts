import { z } from 'zod';
import { query, queryOne, execute } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';
import type { LlmService } from './llm-service.js';
import type { PortalJiraService } from './portal-jira.js';
import type { PortalIntakeService } from './portal-intake.js';
import type { PortalChatSession, PortalChatMessage } from '../../shared/portal-types.js';
import type { IntakeSessionMetadata, IntakeCollectedFields, ChatMessageMetadata } from '../../shared/portal-types.js';
import { PORTAL_CATEGORY_FIELD_CONFIG } from '../../shared/portal-category-field-config.js';
import { trackEvent } from './portal-analytics.js';
import type { PortalPlaybookService } from './portal-playbooks.js';
import { expandSearchTerms, cleanSearchTerms, rankAndFilter } from './kb-search-utils.js';

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
  isEmailMarketingRelated: z.boolean().optional(),
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

const SummarySynthesisSchema = z.object({
  subject: z.string(),
  description: z.string(),
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

// Patterns that strip category-label echo, parroted greetings, and echo prefixes from LLM output
const TONE_SANITIZATIONS: Array<[RegExp, string]> = [
  // "Thanks for those details about Website" / "about Account" etc.
  [/Thanks for those details about \*?\*?(?:Website|Account|Email|Property|Listing)\*?\*?\.?\s*/gi, 'Thanks for getting in touch. '],
  // "You mentioned hi, ..." or "You mentioned hello, ..." — strip parroted greeting
  [/You mentioned (?:hi|hello|hey|good (?:morning|afternoon|evening)),?\s*/gi, ''],
  // Echo-prefix phrases anywhere in the response (not just start-of-string)
  [/(?:^|(?<=\.\s)|(?<=,\s))(?:You mentioned|You said|You told us|You explained|You reported|You noted|You indicated|You stated|As you (?:mentioned|said|noted|explained))(?:\s+that)?,?\s+/gi, ''],
  // Garbled "You mentioned" fragments left empty after stripping (e.g. "You mentioned — could you...")
  [/^You mentioned\s*[-–—]\s*/i, ''],
  [/\.\s*You mentioned\s*[-–—]\s*/gi, '. '],
];

function sanitizeCustomerResponse(text: string, userMessage?: string): string {
  let result = text;
  for (const [pattern, replacement] of VOCABULARY_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of TONE_SANITIZATIONS) {
    result = result.replace(pattern, replacement);
  }
  if (userMessage) {
    result = stripVerbatimEcho(result, userMessage);
  }
  return result.replace(/  +/g, ' ').trim();
}

function stripVerbatimEcho(response: string, userMessage: string): string {
  const stripped = userMessage.replace(/^(hi|hello|hey|good\s+(?:morning|afternoon|evening))[\s,.!\-]*/i, '').trim();
  if (stripped.length < 12) return response;
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const emailMap: string[] = [];
  const safeStripped = stripped.replace(EMAIL_RE, (m) => { emailMap.push(m); return `__EMAIL${emailMap.length - 1}__`; });
  const sentences = safeStripped.match(/[^.!?]+[.!?]*/g) || [safeStripped];
  let result = response;
  for (const raw of sentences) {
    let sentence = raw.trim();
    if (sentence.length < 12) continue;
    // Preserve sentences containing email addresses — the email is valuable confirmation data
    if (/__EMAIL\d+__/.test(sentence)) continue;
    const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'gi');
    result = result.replace(pattern, '');
  }
  return result;
}

function descriptionLacksActionableDetail(desc: string | null): boolean {
  if (!desc) return true;
  const stripped = desc.replace(/^(hi|hello|hey|howdy|good (morning|afternoon|evening))[\s,.!\-]*/i, '').trim();
  if (stripped.length < 30) return true;

  // Purely abstract/vague phrasing that doesn't identify what's actually wrong —
  // even if long enough, these need the "what specifically?" follow-up.
  const VAGUE_ABSTRACT = /^(i'?m?\s+|we('re|\s+are)\s+|there('s|\s+is)\s+|i\s+have\s+|we\s+have\s+|i'?ve\s+got\s+|we'?ve\s+got\s+)?(having\s+)?(an?\s+|some\s+)?(issue|problem|trouble|difficulty|bit of (an?\s+)?trouble)s?\b/i;
  const VAGUE_SOMETHING = /\b(something('s|\s+is)?\s+(wrong|broken|not (right|working))|things?\s+(aren'?t|isn'?t|is not|are not)\s+(right|working)|not\s+(sure\s+)?what('s|\s+is)\s+(wrong|going on|happening)|it('s|\s+is)?\s+(just\s+)?(not\s+(right|working)|playing up|broken)|stuff('s|\s+is)?\s+(not\s+working|broken))\b/i;
  if (VAGUE_ABSTRACT.test(stripped) || VAGUE_SOMETHING.test(stripped)) {
    // Check if there's also a specific noun/target — if so, it's not purely vague
    const hasSpecificTarget = /\b(page|photo|image|listing|property|portal|rightmove|zoopla|email|campaign|phone\s*number|address|office|branch|template|floorplan|epc|virtual tour|media|price|website|login|password|user|account|report|data|newsletter|carousel|footer|click\s*track|bym|briefyourmarket|mailing\s+list|unsubscribe)\b/i.test(stripped);
    if (!hasSpecificTarget) return true;
  }

  return !/\b(error|broken|not working|not loading|can'?t log\s*in|can'?t access|won'?t load|missing|incorrect|password|expired|locked out|not showing|disappeared|update|change|remove|add user|remove user|new user|wrong|page|photo|image|listing|property|portal|rightmove|zoopla|email|campaign|phone number|address|office|branch|display|showing|hidden|visible|template|trigger|data|report|login|sign.?in|set.?up|floorplan|epc|virtual tour|media|price|description|sync|feed|click\s*track|newsletter|carousel|footer|unsubscribe|bym|briefyourmarket|scheduled\s+report|test\s+send|mailing\s+list|opt.?out|gdpr|check|investigate|look\s+into|confirm)\b/i.test(stripped);
}

function followUpLacksConcreteProblem(text: string): boolean {
  const stripped = stripGreeting(text);
  if (stripped.length < 15) return true;
  const hasProblemIndicator = /\b(error|broken|not working|not loading|can'?t|won'?t|missing|incorrect|wrong|outdated|old|need.{0,15}(updat|chang|fix|remov|add)|update|change|remove|add|not showing|not display|hidden|locked|expired|disappeared|playing up|not right|trouble|crash|down|slow|fail|stuck|won't|can not)\b/i.test(stripped);
  return !hasProblemIndicator;
}

function isLikelyAccountName(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (/\b(not working|not loading|aren'?t|broken|error|issue|problem|can'?t|won'?t|missing|need|help|change|update|fix|showing|display|not right|trouble|having|loading|photos?|images?)\b/i.test(lower)) return false;
  if (lower.length > 80) return false;
  if (/^(i |we |the |my |our |it |there |something |need |please |help )/i.test(lower)) return false;
  // Reject portal/channel names — these are answers to "which portal?" not account names
  if (/^(the\s+)?(website|rightmove|zoopla|onthemarket|on the market|primelocation|prime location|our (website|site)|the (website|site)|both|all of them|everywhere)$/i.test(lower)) return false;
  // Reject pure prepositions, articles, and very short non-name words
  if (/^(on|at|in|to|of|by|for|the|a|an|or|and|but|so|if|no|yes|ok|hi)$/i.test(lower)) return false;
  // Reject urgency/sentiment phrases that aren't company names
  if (/^(quite|very|really|extremely|fairly|rather|super|absolutely|completely|totally|utterly)\s+(urgent|important|critical|high|serious|bad|frustrated|annoyed|unhappy)/i.test(lower)) return false;
  if (/^(urgent|critical|high priority|asap|emergency)$/i.test(lower)) return false;
  // Reject correction/conversational phrases
  if (/^(actually|sorry|no wait|i meant|i mean|that'?s wrong|correction)/i.test(lower)) return false;
  // Reject strings under 3 characters (too short for any real company name)
  if (lower.length < 3) return false;
  return true;
}

function stripGreeting(text: string): string {
  return text.replace(/^(hi|hello|hey|howdy|good (morning|afternoon|evening))[\s,.!\-]*/i, '').trim();
}

function isPlaceholderOrgName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return lower === 'unknown organisation' || lower === 'unknown organization' || lower === 'unknown';
}

function cleanAccountName(raw: string): string {
  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^(on\s+)?our\s+(main\s+)?website\s*,?\s*(the\s+)?/i, '')
    .replace(/^(on\s+)?(the\s+)?(our\s+)?(website|site)\s+(for|at|with)\s+/i, '')
    .replace(/^(it'?s\s+)(for|at|with|from)\s+/i, '')
    .replace(/^it'?s\s+/i, '')
    .replace(/^(the\s+)?account\s+(is|for|name\s+is)\s+/i, '')
    .replace(/^(we\s+are|we'?re)\s+/i, '')
    .replace(/^(on\s+)?(the\s+)?/i, '')
    .replace(/\s+(website|site|portal|system|platform|rightmove|zoopla|onthemarket|primelocation)$/i, '')
    .replace(/'s\s*$/i, '')
    .replace(/\s+account'?s?\s*$/i, '')
    .replace(/\s+not\s+\S.*$/i, '')
    .replace(/\s+(is\s+)?(having|not working|broken|having issues|having problems|having trouble|is down|isn'?t working|won'?t|can'?t|doesn'?t|don'?t|needs?|but|and (we|they|i|it|the|our)|where|which|who|that|the\s+(website|site|portal|page|system|problem|issue|error|photos?|images?|listings?|login|password))\b.*$/i, '')
    .replace(/\s*[-–—]\s+.*$/i, '')
    .replace(/\s+(https?:\/\/|www\.)\S+$/i, '')
    .replace(/\s+\S+\.(?:co\.uk|com|org|net|agency|io|uk)\S*$/i, '')
    .replace(/[.,;:!?]+\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (cleaned.length < 3) return '';
  // Reject if cleaning left only a stopword/preposition
  if (/^(on|at|in|to|of|by|for|the|a|an|or|and|but|so|if|no|yes|ok|hi|it|is|was|are|be|do|go)$/i.test(cleaned)) return '';
  return cleaned;
}

function cleanEditValue(raw: string): string {
  return raw
    .replace(/^(just\s+(?:be\s+)?|simply\s+(?:be\s+)?|should\s+(?:just\s+)?(?:be\s+)?|needs?\s+to\s+(?:be\s+)?|to\s+(?:just\s+)?(?:be\s+)?|(?:could|can)\s+you\s+(?:just\s+)?(?:make\s+it\s+|change\s+(?:it\s+)?(?:to\s+)?)?|(?:make|set)\s+(?:it|that)\s+(?:to\s+)?(?:be\s+)?|(?:change|update)\s+(?:it|that)\s+to\s+|it\s+should\s+(?:just\s+)?(?:be|say)\s+|it\s+needs?\s+to\s+(?:be|say)\s+|please\s+(?:(?:change|update|set|make)\s+(?:it\s+)?(?:to\s+)?)?)/i, '')
    .replace(/\s*[.,;!?]+\s*$/g, '')
    .trim();
}

function cleanFieldBoundary(raw: string): string {
  return raw
    .replace(/\s*,?\s*(?:and\s+)?(?:also\s+)?(?:(?:change|update|set|correct|make|please)\s+)?(?:the\s+)?(?:subject|account|description|urgency|person|name|email|url|contact)\s+(?:to|should|needs?|is)\b.*$/i, '')
    .replace(/\s*[.,;!?]+\s*$/, '')
    .trim();
}

function containsCorrection(text: string): boolean {
  return /\b(actually|sorry|correction|no wait|i meant|that'?s wrong|not .+,?\s+(it'?s|should be|it should)|wrong .+,?\s+(it'?s|should be)|should be .+ not)\b/i.test(text);
}

function refreshStructuredFieldsFromCorrection(content: string, fields: IntakeCollectedFields): void {
  // URL correction: "the URL is X not Y" / "actually X.co.uk" / "should be X"
  const urlInContent = extractUrlFromText(content);
  if (urlInContent) fields.url = urlInContent;

  // Alphanumeric listing ref correction — preserve full multi-segment refs
  // Exclude Jira ticket references (NT-xxx, NTPJ-xxx)
  const alphanumMatch = content.match(/\b([A-Za-z]{2,5}[-_]\d{2,5}(?:[-_][A-Za-z0-9]{1,10})*)\b/);
  if (alphanumMatch && !isPhoneLikeValue(alphanumMatch[1]) && !/^(NT|NTPJ)-/i.test(alphanumMatch[1])) {
    fields.listingId = alphanumMatch[1];
  }

  // Property address correction — look for "should be X" / "it's actually X Street"
  const STREET_SUFFIXES = 'Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr|Close|Cl|Way|Place|Pl|Court|Ct|Crescent|Cres|Terrace|Gardens|Grove|Park|Square|Row|Mews|Hill|Rise|Walk|Green|Gate|Chase|Heath|Meadow|Vale|View';
  const addrCorrectionRe = new RegExp(`(?:should be|it'?s actually|correct (?:address|one) is)\\s+(\\d{1,5}\\s+[A-Z][A-Za-z]+(?:\\s+[A-Z][A-Za-z]+){0,3}(?:\\s+(?:${STREET_SUFFIXES})))`, 'i');
  const addrCorrectionMatch = content.match(addrCorrectionRe);
  if (addrCorrectionMatch) {
    fields.propertyAddress = addrCorrectionMatch[1].trim();
  }
}

function extractPhoneNumbers(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g);
  return matches || [];
}

function isPhoneLikeValue(val: string): boolean {
  const digits = val.replace(/\D/g, '');
  if (digits.length < 5) return false;
  // UK phone numbers starting with 0: full (10-11 digits) or partial (5+ digits like area code)
  if (digits.startsWith('0') && digits.length >= 5 && digits.length <= 13) return true;
  if (digits.length >= 11 && /^(44|353|1)/.test(digits)) return true;
  if (/^\+?\d{1,3}[\s-]?\(?\d{2,5}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}$/.test(val.trim())) return true;
  return false;
}

function briefContext(meta: IntakeSessionMetadata): string {
  const desc = meta.collectedFields.description || meta.openingMessage;
  if (!desc) return '';
  // Split into sentences, skip pure greetings, take the first substantive sentence
  const sentences = desc.split(/[.!?\n]/).map(s => s.trim()).filter(Boolean);
  const GREETING_ONLY = /^(hi|hello|hey|howdy|good\s+(morning|afternoon|evening|day)|dear\s+(sir|madam|sirs|team|all))s?$/i;
  const firstSubstantive = sentences.find(s => !GREETING_ONLY.test(s) && s.length > 5) || sentences[0] || '';
  return firstSubstantive.length > 80 ? firstSubstantive.slice(0, 77) + '...' : firstSubstantive;
}

const FRUSTRATION_PATTERNS = /\b(this is (completely |absolutely |totally |utterly |just )?ridiculous|speak to (someone|a (real )?person|a human)|talk to (someone|a (real )?person|a human)|real person|not a (chat)?bot|don'?t want.*(chat)?bot|this is useless|waste of time|you'?re useless|what a joke|fed up|sick of this|absolutely terrible|disgusting service|incompetent|get me a manager|escalate this|I('m| am) (absolutely |completely |totally |utterly |so )?furious|human (please|now|agent)|actual (person|human)|nobody is (fixing|helping|doing anything|listening|responding)|no one is (fixing|helping|doing anything|listening|responding)|been (broken|waiting|like this|an issue|a problem) for (days|weeks|ages|months|a while|over a week)|how (many|long|much longer) (times?|do I|more)|still (not|hasn'?t been|hasn'?t|isn'?t) (fixed|resolved|working|sorted|done)|completely (useless|unacceptable|ridiculous|furious)|utterly (useless|unacceptable|ridiculous|furious)|beyond (frustrated|annoyed|angry)|extremely (unhappy|frustrated|disappointed|annoyed)|so frustrated|so (angry|annoyed|disappointed|unhappy)|I('ve| have) (had enough|lost patience|been waiting)|unacceptable|appalling|disgraceful|atrocious|dreadful|(wow|oh),? (great|brilliant|fantastic|wonderful|amazing|excellent) service|thanks for nothing|I('m| am) starting to (wonder|lose|think)|does anyone (actually |even )?(read|check|look at|care|respond)|wonder(ing)? if anyone (reads|listens|cares|checks|responds))\b|[!?]{4,}/i;

const ATTACHMENT_PATTERNS = /\b(attached|attachment|see attached|photo attached|i'?ve attached|file attached|screenshot attached|attaching|i attach)\b/i;

const ESCALATION_CHASE_PATTERNS = /\b(raised this|already (raised|reported|logged|submitted|sent|told you|contacted|emailed)|following up|chasing|chase this|chasing this up|nobody has (helped|replied|responded|got back|come back|done anything)|no one has (helped|replied|responded|got back|come back|done anything)|been waiting|still (waiting|not (fixed|resolved|sorted|done|working|heard))|I ('ve|have) (already|previously) (raised|reported|logged|submitted|sent)|originally (raised|reported|logged)|weeks? ago|days? ago|months? ago|some time ago|a while (ago|back|now)|first (raised|reported|contacted|logged)|re-?raise|re-?open|follow.?up|getting? back to (you|this|me)|still (an issue|a problem|happening|broken|not right)|hasn'?t been (fixed|resolved|sorted|addressed|looked at|dealt with)|is not (fixed|resolved|sorted|done|working)|(marked|was|been) (resolved|closed|done|fixed) but|same (issue|problem|thing) (again|is back|has come back)|happen(ed|ing|s) again|it(('s| is| has) )?(come|came|coming) back|not actually (fixed|resolved|sorted|done)|problem (is back|came back|returned))\b/i;

const COMPLAINT_INTENT_PATTERNS = /\b(I('d| would) like to (make a |raise a |lodge a |file a )?complain(t)?|I want to (complain|make a complaint|raise a complaint|lodge a complaint|file a complaint)|formal complaint|raise a complaint|make a complaint|lodge a complaint|file a complaint|I('m| am) (making|raising|lodging|filing) a complaint|complaining about|complaint about|I need to escalate|I want to escalate|I('d| would) like to escalate|please escalate|escalate my (issue|request|case|ticket|problem|concern)|this needs escalating|needs? to be escalated|need this escalated|want this escalated|I('m| am) not (happy|satisfied)|not good enough|(really|very|so|extremely|incredibly|absolutely) (unhappy|disappointed|dissatisfied|frustrated)( with)?|very unhappy with|very disappointed with|extremely unhappy|extremely disappointed|totally unacceptable|completely unacceptable|your service (is|has been) (terrible|awful|dreadful|appalling|abysmal|shocking)|I('m| am) (really |very |so |extremely |incredibly |absolutely )?(unhappy|disappointed|dissatisfied|furious|livid) (and |& )?(need|want|demand|require)(s?| this| it)( to be)? escalat)\b/i;

// ── Category Field Config ──

const CATEGORY_FIELD_CONFIG = PORTAL_CATEGORY_FIELD_CONFIG;

const CATEGORY_NAMES: Record<string, string> = {
  website: 'My Website',
  account: 'My Account',
  email_marketing: 'Email Marketing',
  leadpro: 'LeadPro & CRM',
  data_feeds: 'Data Feeds & Integrations',
  listings: 'Property Listings',
  property: 'Property Listings',
  letters: 'Letters & Correspondence',
  onboarding: 'Onboarding & Setup',
  billing: 'Billing & Contracts',
  security: 'Website Security',
  general_request: 'General Service Request',
  followup: 'Reopened / Follow-up',
  complaint: 'Complaint / Escalation',
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
  letters_market_appraisal: 'Market appraisal letter',
  letters_mailshot: 'Property mailshot',
  letters_general: 'Other correspondence',
  onboarding_branch: 'New branch',
  onboarding_product: 'New product',
  onboarding_training: 'Training',
  billing_cancel: 'Cancellation',
  billing_change: 'Service change',
  billing_query: 'Billing query',
  security_vulnerability: 'Suspicious activity / vulnerability',
  security_ssl: 'SSL / certificate issue',
  security_access: 'Unauthorised access concern',
  general_request_change: 'Request a change',
  general_request_info: 'Request information',
  general_request_other: 'Other service request',
  followup_reopen: 'Reopen a request',
  followup_update: 'Chase an open request',
  followup_not_resolved: 'Issue not fully resolved',
  complaint_service: 'Service complaint',
  complaint_response: 'Response time concern',
  complaint_escalate: 'Escalate an issue',
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
  const t = text.trim();
  // Strong start-of-message affirmative
  if (/^(yes|yeah|yep|yup|please do|go ahead|do it|create (a )?ticket|raise (a )?(ticket|request)|submit (it|that)|that sounds good|ok|okay|sure|perfect|confirmed?|all good|that'?s (correct|right|fine|good)|looks? (good|correct|right|fine)|that looks? (good|correct|right|fine))\b/i.test(t)) return true;
  // Ticket-creation intent anywhere in the message
  if (/\b(create|raise|submit|log|open)\s+(a\s+)?(ticket|request|issue)\b/i.test(t)) return true;
  // "please submit" without a following object (e.g. "please submit" or "please submit it")
  if (/\bplease\s+submit\b/i.test(t)) return true;
  // Affirmative buried in a longer response (e.g. "that would be great, yes please")
  if (/\b(yes\s*please|go ahead|please do|sounds good|looks? good|that'?s (correct|right)|all good|no changes?)\b/i.test(t) && t.length < 120) return true;
  return false;
}

function isNegativeResponse(text: string): boolean {
  const t = text.trim();
  if (/^cancel\b/i.test(t) && BILLING_CANCELLATION_PATTERNS.test(t)) return false;
  return /^(no|nope|not yet|not now|don't|do not|cancel|never mind)\b/i.test(t);
}

function detectWebsiteFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  const lower = content.toLowerCase();

  // Admin-system / import-instance guard: operational platform requests are NOT website
  if (/\b(import\s+instance|admin\s+(panel|system|portal|dashboard|tool)|data\s+import|bulk\s+import|system\s+update|platform\s+update|instance\s+(update|upgrade|migration|change))\b/.test(lower)) {
    return { likely: false, subcategory: null };
  }

  // Email-marketing guard: if strong email marketing signals present, defer to email detection
  if (/\b(email\s+(campaign|template|editor|footer|carousel|marketing|newsletter|blast|send)|campaign\s+(stat|report|result)|click\s+track|open\s+rate|bounce\s+rate|test\s+send|scheduled\s+report|bym|briefyourmarket|brief\s+your\s+market|mailing\s+list|subscriber)\b/.test(lower)) {
    return { likely: false, subcategory: null };
  }

  // Broad website signals: explicit site words, named pages, or URLs
  const hasWebsiteSignal =
    /\b(website|web site|webpage|web page|homepage|home page|our site|the site|landing page|our page|contact page|about page|team page|staff page|services page|property page|branch page|office page|footer|header|banner|menu|navigation|nav bar)\b/.test(lower) ||
    /https?:\/\/[^\s]+/i.test(lower) ||
    /\b\w+\.(co\.uk|com|org|net|agency)\b/.test(lower);

  if (!hasWebsiteSignal) {
    // Administrative address changes (billing, registered, company, etc.) are account ops, not website
    const isAdminAddress = /\b(billing|registered|company|business|account|postal|mailing|correspondence|head office)\s+address\b/.test(lower);
    if (isAdminAddress) return { likely: false, subcategory: null };

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

function detectEmailMarketingFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  const lower = content.toLowerCase();

  // Guard: if explicit website context dominates ("on our website", "homepage"), bail out
  // unless there's a strong email signal alongside it
  const hasStrongEmailSignal = /\b(email|campaign|newsletter|mailchimp|bym|briefyourmarket|brief your market|mailing|subscriber|unsubscribe|email\s+editor|email\s+footer|click\s+track|open\s+rate|bounce\s+rate|send\s+report|test\s+send|scheduled\s+report|email\s+carousel|carousel\s+in\s+the\s+email)\b/.test(lower);
  if (!hasStrongEmailSignal) return { likely: false, subcategory: null };

  // Admin-system / import-instance guard: "import instance" or "admin panel" style ops
  // are not email-marketing even if "email" appears
  if (/\b(import\s+instance|admin\s+(panel|system|portal|dashboard|tool)|data\s+import|bulk\s+import)\b/.test(lower)) {
    return { likely: false, subcategory: null };
  }

  // Template requests → email_template
  if (/\b(email\s+template|marketing\s+template|html\s+template|newsletter\s+template|template\s+(design|build|create|update|change|amend|new)|new\s+template|build\s+(a|me|us|our)\s+template|create\s+(a|me|us|our)\s+template)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_template' };
  }

  // Click tracking, open rates, stats, reports → email_campaign
  if (/\b(click\s+track|link\s+click|click(s|ed)?\s+(not|aren'?t|isn'?t)\s+work|open\s+rate|bounce\s+rate|delivery\s+rate|send\s+report|campaign\s+(stat|report|result|performance|metric)|scheduled\s+report|email\s+(stat|report|result|analytic)|not\s+track|track(ing)?\s+(not|isn'?t|aren'?t)\s+work)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_campaign' };
  }

  // Carousel, email editor, design-within-email issues → email_campaign
  if (/\b(carousel\s+in\s+the\s+email|email\s+carousel|email\s+editor|editor\s+(not|isn'?t|won'?t)\s+(work|load|open|sav)|drag\s+and\s+drop\s+editor|email\s+builder|campaign\s+editor)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_campaign' };
  }

  // Email footer, header within emails → email_campaign
  if (/\b(email\s+footer|footer\s+(in|on|of)\s+(the\s+)?email|email\s+header|unsubscribe\s+link|footer\s+(detail|update|change|wrong|incorrect|needs))\b/.test(lower)) {
    return { likely: true, subcategory: 'email_campaign' };
  }

  // BYM campaign URLs, BYM instances, BYM platform → email_campaign
  if (/\b(bym|briefyourmarket|brief\s+your\s+market)\b/.test(lower) && /\b(campaign|url|link|instance|email|send|report|login|access)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_campaign' };
  }

  // Test send, sending issues → email_campaign
  if (/\b(test\s+send|send\s+test|test\s+email|email\s+(not\s+)?send|campaign\s+(not\s+)?send|failed\s+to\s+send|send\s+fail|not\s+been\s+sent|hasn'?t\s+been\s+sent|didn'?t\s+(get\s+)?send|not\s+receiv|haven'?t\s+receiv|didn'?t\s+receiv)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_campaign' };
  }

  // Triggers / automation
  if (/\b(email\s+trigger|trigger\s+email|automated?\s+email|email\s+automat|drip\s+campaign|autorespond)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_triggers' };
  }

  // Newsletter / mailing list / subscriber management
  if (/\b(newsletter|mailing\s+list|subscriber|email\s+list|contact\s+list|distribution\s+list|suppression\s+list)\b/.test(lower)) {
    return { likely: true, subcategory: 'email_campaign' };
  }

  // Generic email marketing issue (strong signal present but no specific subcategory)
  return { likely: true, subcategory: 'email_campaign' };
}

function detectLettersFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  const lower = content.toLowerCase();
  const hasLetterSignal = /\b(letter|letters|correspondence|mailshot|mail\s*shot|market\s*appraisal|printed|print\s+run|letter\s+template|direct\s+mail|postal|postcard|brochure)\b/.test(lower);
  if (!hasLetterSignal) return { likely: false, subcategory: null };
  if (/\b(market\s*appraisal|valuation\s+letter|appraisal\s+letter)\b/.test(lower)) {
    return { likely: true, subcategory: 'letters_market_appraisal' };
  }
  if (/\b(mailshot|mail\s*shot|property\s+mail|marketing\s+letter|direct\s+mail|postcard|brochure)\b/.test(lower)) {
    return { likely: true, subcategory: 'letters_mailshot' };
  }
  return { likely: true, subcategory: 'letters_general' };
}

function detectPropertyFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  const lower = content.toLowerCase();

  // Company-name guard: if "property/properties" appears only as part of a company name
  // (e.g. "Abbey Forth Property Management Ltd", "De Mel Property team", "Moss Properties"),
  // don't treat as property-listing intent. Strip company name patterns before checking.
  const COMPANY_PROPERTY_NAME = /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+Propert(?:y|ies)(?:\s+(?:Management|Group|Ltd|Limited|Services|Solutions|Team|Consultants?|Agents?|Advisors?))\b/gi;
  const contentWithoutCompanyNames = content.replace(COMPANY_PROPERTY_NAME, '');
  const lowerWithoutCompanyNames = contentWithoutCompanyNames.toLowerCase();
  const hasPropertyWordOutsideCompanyName = /\bpropert(y|ies)\b/.test(lowerWithoutCompanyNames);

  // Website-context guard: if "property" is used as website content (e.g. "property images on my website")
  // rather than real-estate listing intent, defer to website routing.
  const hasExplicitWebsiteContext = /\b(website|web site|our site|my site|the site|homepage|home page|web page|webpage)\b/.test(lower);
  const hasPortalListingSignal = /\b(rightmove|zoopla|onthemarket|on the market|primelocation|prime location|listing|listings|feed|feeds|syndication)\b/.test(lower);
  if (hasExplicitWebsiteContext && !hasPortalListingSignal && /\bpropert(y|ies)\b/.test(lower)) {
    return { likely: false, subcategory: null };
  }

  // If "property/properties" only appeared inside a company name and there are no other
  // property/listing signals, this is not a property request.
  if (!hasPropertyWordOutsideCompanyName && !hasPortalListingSignal &&
      !/\b(listing|listings|floorplan|floor plan|epc|energy performance|virtual tour|sold|stc|under offer|withdrawn)\b/.test(lower)) {
    return { likely: false, subcategory: null };
  }

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

const SITE_WIDE_PATTERNS = /\b(all\s+(our\s+)?(properties|listings|branches|offices)|every\s+(property|listing)|site[\s-]?wide|across\s+(the\s+)?(board|all|everything)|whole\s+(website|site|portfolio)|everything|all\s+of\s+(them|our|the)|not\s+just\s+one|multiple\s+(properties|listings)|several\s+(properties|listings)|none\s+of\s+(them|our|the)|affects?\s+(all|every|the\s+lot|multiple)|it'?s\s+all\s+of\s+them|no\s+specific\s+property|not\s+a\s+specific|not\s+(one\s+)?specific|not\s+about\s+a\s+(specific|particular)|not\s+a\s+particular|general\s+issue|doesn'?t\s+apply\s+to\s+(one|a\s+single)|not\s+(just\s+)?(one|a\s+single)\s+(property|listing)|all\s+listings|no\s+particular\s+(property|listing)|none\s+in\s+particular|the\s+(whole\s+)?feed|every(thing|\s+single\s+one))\b/i;

function extractPropertyFieldsFromText(content: string, fields: IntakeCollectedFields): void {
  // Site-wide indicator — customer says the issue affects all properties, not one specific one
  if (!fields.propertyAddress && SITE_WIDE_PATTERNS.test(content)) {
    fields.propertyAddress = 'All properties (site-wide)';
  }

  // Property address — look for street number + name patterns
  if (!fields.propertyAddress) {
    const addrMatch = content.match(/\b(\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}(?:\s+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Drive|Dr|Close|Cl|Way|Place|Pl|Court|Ct|Crescent|Cres|Terrace|Gardens|Grove|Park|Square|Row|Mews|Hill|Rise|Walk|Green|Gate|Chase|Heath|Meadow|Vale|View)))\b/i);
    if (addrMatch) fields.propertyAddress = addrMatch[1].trim();
  }

  // Listing / property ID
  if (!fields.listingId) {
    // Alphanumeric listing refs like ABC-12345, BP-2024-001, RM-45821-A, ABC-12345-XZ
    // Exclude Jira ticket references (NT-xxx, NTPJ-xxx) — those are follow-up refs, not listing IDs
    const alphanumMatch = content.match(/\b([A-Za-z]{2,5}[-_]\d{2,5}(?:[-_][A-Za-z0-9]{1,10})*)\b/);
    if (alphanumMatch && !isPhoneLikeValue(alphanumMatch[1]) && !/^(NT|NTPJ)-/i.test(alphanumMatch[1])) {
      fields.listingId = alphanumMatch[1];
    }
  }
  if (!fields.listingId) {
    const keywordIdMatch = content.match(/\b(?:property|listing|ref(?:erence)?|id)[\s:#]*(\d{4,})\b/i);
    if (keywordIdMatch && !isPhoneLikeValue(keywordIdMatch[1])) {
      fields.listingId = keywordIdMatch[1];
    } else if (!keywordIdMatch) {
      // Bare 5+ digit fallback — only if it doesn't look like a phone number
      const bareMatch = content.match(/\b(\d{5,})\b/);
      if (bareMatch) {
        const num = bareMatch[0];
        const beforeCtx = content.slice(Math.max(0, bareMatch.index! - 40), bareMatch.index!);
        const afterCtx = content.slice(bareMatch.index! + num.length, bareMatch.index! + num.length + 30);
        const isPhoneContext = /\b(phone|tel|telephone|call|ring|mobile|number|fax|contact|dial|landline)\s*[:.]?\s*$/i.test(beforeCtx) ||
          /^\s*[:.]?\s*\b(phone|tel|telephone|mobile|fax|landline)\b/i.test(afterCtx);
        // UK phone numbers are typically 10-11 contiguous digits; listing refs are shorter
        const isPhoneLikeLength = num.length >= 10 && num.length <= 13;
        // Numbers starting with 0 in the UK are almost always phone numbers (full or partial)
        const startsWithZero = num.startsWith('0');
        // 7-9 digit numbers starting with 0 are partial UK phone numbers (e.g. area codes)
        const isPartialPhone = startsWithZero && num.length >= 7;
        // International-prefix numbers (e.g. 447712345678 from +44...) are phone numbers
        const isInternationalPhone = num.length >= 11 && /^(44|353|1)/.test(num);
        // Check for formatted phone number nearby (+44, 0xxx xxx xxxx patterns)
        const hasPhoneFormat = /\+\d{1,3}\s*$/.test(beforeCtx) ||
          /\b0\d{2,4}\s+\d{3,4}\s+\d{3,4}\b/.test(content);
        if (!isPhoneContext && !isPartialPhone && !(isPhoneLikeLength && startsWithZero) && !isInternationalPhone && !hasPhoneFormat && !isPhoneLikeValue(num)) {
          fields.listingId = num;
        }
      }
    }
  }

  // Affected portals
  if (!fields.affectedPortals) {
    const portals: string[] = [];
    if (/\brightmove\b/i.test(content)) portals.push('Rightmove');
    if (/\bzoopla\b/i.test(content)) portals.push('Zoopla');
    if (/\b(onthemarket|on the market)\b/i.test(content)) portals.push('OnTheMarket');
    if (/\b(primelocation|prime location)\b/i.test(content)) portals.push('PrimeLocation');
    if (/\b(website|our site|the site|my site)\b/i.test(content)) portals.push('Website');
    // "both" or "all of them" / "everywhere" — means website + portals
    if (portals.length === 0 && /\b(both|all of them|everywhere|all portals)\b/i.test(content)) {
      portals.push('Website', 'Property portals');
    }
    if (portals.length > 0) fields.affectedPortals = portals.join(', ');
  }

  // Infer Website portal from URL — if a non-portal-domain URL is present, the issue
  // is almost certainly about the customer's own website
  if (!fields.affectedPortals && fields.url) {
    const urlLower = fields.url.toLowerCase();
    const isPortalUrl = /\b(rightmove|zoopla|onthemarket|primelocation)\b/.test(urlLower);
    if (!isPortalUrl) {
      fields.affectedPortals = 'Website';
    }
  }

  // Property status mentions
  if (!fields.propertyStatus) {
    const statusMatch = content.match(/\b(sold|stc|under offer|withdrawn|available|for sale|to let|to rent|let agreed)\b/i);
    if (statusMatch) fields.propertyStatus = statusMatch[1];
  }
}

// ── Account Setup / Office Changes Detection ──

const SECURITY_SENSITIVE_PATTERNS = /\b(remove.*(user|access|person|them|him|her|employee)|revoke.*(access|permissions?|login)|delete.*(user|account|access)|deactivate.*(user|login)|left the company|been (fired|let go|terminated|dismissed|made redundant)|no longer (works?|employed|with us)|was (fired|let go|terminated|dismissed|made redundant))\b/i;

const BILLING_CANCELLATION_PATTERNS = /\b(cancel\s+(?:a\s+|our\s+|my\s+|the\s+)?(?:product|service|subscription|contract|account|package|plan|module|add[- ]?on|licence|license|email\s+marketing|leadpro|crm)|(?:deactivate|disable|turn off|switch off|stop|end|terminate|close)\s+(?:a\s+|our\s+|my\s+|the\s+)?(?:product|service|subscription|contract|account|package|plan|module|add[- ]?on|licence|license|email\s+marketing|leadpro|crm)|(?:product|service|subscription|contract|package|plan|module|add[- ]?on|licence|license)\s+(?:cancellation|cancelled|canceled)|(?:we(?:'re| are)|i(?:'m| am)|we'?d like to|i'?d like to|want to|need to|wish to)\s+(?:cancel|deactivate|close|terminate)|(?:stop|end|terminate|close|cancel|deactivate)\s+(?:our|my)\s+(?:account|service|subscription|contract|email\s+marketing|leadpro|crm))\b/i;

const DATA_REMOVAL_PATTERNS = /\b((?:remove|delete|erase|wipe|purge|scrub)\s+(?:the\s+)?(?:email(?:\s+address)?|data|record|contact(?:\s+details)?|information|details|subscriber|recipient|mailing\s+list\s+entry)|(?:remove|delete|erase)\s+\S+@\S+|(?:email(?:\s+address)?|data|record|contact(?:\s+details)?|information|details)\s+(?:\S+\s+){0,5}(?:be\s+)?(?:removed|deleted|erased|wiped|purged|scrubbed)|(?:\S+@\S+)\s+(?:removed|deleted|taken off)\b|take\s+(?:\S+\s+)?off\s+(?:the\s+)?(?:mailing\s+list|system|database|email\s+list|list)|opt(?:ed)?\s*(?:out|them out)|unsubscribe|gdpr\s+(?:request|removal|deletion|erasure)|right\s+to\s+(?:be\s+forgotten|erasure|deletion)|data\s+(?:subject\s+)?(?:removal|deletion|erasure)\s+request)\b/i;

const ACTION_INVESTIGATION_PATTERNS = /\b(can\s+(?:you|we|someone)\s+(?:check|look\s+into|investigate|confirm|verify|find\s+out|sort|fix|resolve|action|look\s+at|review)|could\s+(?:you|we|someone)\s+(?:check|look\s+into|investigate|confirm|verify|find\s+out|sort|fix|resolve|action|look\s+at|review)|please\s+(?:check|look\s+into|investigate|confirm|verify|find\s+out|sort|fix|resolve|action|look\s+at|review)|need(?:s)?\s+(?:checking|investigating|looking\s+into|fixing|resolving|actioning|sorting|reviewing)|got\s+this\s+(?:email|message|request|complaint)\s+from|received\s+(?:a|an|this)\s+(?:email|message|request|complaint)\s+from|forwarding\s+(?:this|an?)\s+(?:email|message|request|complaint)|we'?ve\s+(?:had|received|got)\s+(?:a|an)\s+(?:email|message|request|complaint)|they(?:'ve| have)\s+(?:reported|raised|flagged|complained|asked|requested)|customer\s+(?:is\s+)?(?:reporting|saying|complaining|asking|requesting)|this\s+needs\s+(?:to\s+be\s+)?(?:looked\s+at|investigated|checked|fixed|resolved|sorted|actioned))\b/i;

const COMPLIANCE_SENSITIVE_PATTERNS = /\b(unsubscribed?\s+data|email(?:ed)?\s+(?:to\s+)?unsubscribed|sent\s+to\s+(?:someone\s+who\s+)?(?:has\s+)?unsubscribed|gdpr\s+(?:breach|violation|issue|concern|complaint)|data\s+(?:breach|protection|privacy)\s+(?:issue|concern|violation)|opted?\s+out\s+but\s+(?:still|keeps?|received?|getting)|still\s+(?:receiving|getting)\s+(?:email|marketing)|shouldn'?t\s+(?:be|have\s+been)\s+(?:email|contact|sent|market)|consent|mailing\s+(?:without|no)\s+(?:consent|permission)|suppression\s+list|do\s+not\s+(?:email|contact|mail)\s+list)\b/i;

function detectAccountFromKeywords(content: string): { likely: boolean; subcategory: string | null; securitySensitive: boolean } {
  const lower = content.toLowerCase();

  // Billing cancellation takes precedence — don't capture as account operation
  if (BILLING_CANCELLATION_PATTERNS.test(content)) {
    return { likely: false, subcategory: null, securitySensitive: false };
  }

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

  // Administrative address changes — billing, registered, company address (not website content)
  const hasAdminAddressSignal =
    /\b(billing\s+address|registered\s+address|company\s+address|business\s+address|account\s+address|postal\s+address|mailing\s+address|correspondence\s+address|head\s+office\s+address)\b/.test(lower) &&
    !/\b(website|web site|page|our site|shows?|display)\b/.test(lower);

  if (hasAdminAddressSignal) {
    return { likely: true, subcategory: 'account_details', securitySensitive: false };
  }

  const hasOfficeSignal =
    /\b(new (office|branch)|clos(e|ed|ing).*(office|branch)|merg(e|ed|ing).*(office|branch|offices|branches)|moved? offices?|offices?\s+has\s+moved|office.*(move|relocation|restructur|closing|opening|merger)|branch.*(move|relocation|restructur|closing|opening|merger|open|new|add)|(change|update|amend)\s+(our\s+|the\s+)?(office|branch)\s+address)\b/.test(lower) &&
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

// Internal product cancellation: admin/ops staff informing that a customer's product has been
// cancelled. Pattern: "{Company} have cancelled their {Product}" or "Product Cancellation - {Product}"
// or "cancellation processed" or "terminating their Guild Membership".
function detectInternalProductCancellation(content: string): { detected: boolean; account: string | null; product: string | null } {
  // "Product Cancellation - {Product} For {Account}" (subject-line pattern)
  const subjectLine = content.match(/Product Cancellation\s*[-–—]\s*(.+?)\s+[Ff]or\s+(.+?)(?:\.|$)/);
  if (subjectLine) {
    return { detected: true, product: subjectLine[1].trim(), account: subjectLine[2].trim() };
  }

  // "{Account} have/has cancelled their {Product} [product] [effective {date}]"
  // The "product effective" suffix is optional — matches "X have cancelled their Y" broadly
  const cancelledTheir = content.match(/\b([A-Z][A-Za-z0-9 &'.-]{2,60}?)\s+ha(?:ve|s)\s+cancelled\s+their\s+(.+?)(?:\s+product)?(?:\s+effective\b.*)?$/im);
  if (cancelledTheir) {
    let product = cancelledTheir[2].trim().replace(/\s*[.,;:]+\s*$/, '');
    if (product.length > 80) product = product.slice(0, 80);
    return { detected: true, account: cancelledTheir[1].trim(), product };
  }

  // "I have processed a cancellation for {account}" / "cancellation processed" / "Robertsons cancellation processed"
  const processedCancel = content.match(/\b(?:processed|confirmed)\s+a?\s*cancellation\s+(?:for\s+)?(?:the\s+)?(?:above\s+)?(?:customer\s+)?(?:(?:as\s+)?of\s+)?/i);
  const cancelProcessedSuffix = content.match(/\b([A-Z][A-Za-z0-9 &'.-]{2,40}?)(?:'s)?\s+cancellation\s+(?:processed|confirmed)\b/i);
  if (processedCancel || cancelProcessedSuffix) {
    const acct = cancelProcessedSuffix ? cancelProcessedSuffix[1].trim() : null;
    return { detected: true, account: acct, product: null };
  }

  // "terminating their Guild Membership" / "who is terminating their {Product}"
  const terminatingMembership = content.match(/\bterminating\s+their\s+(.+?)(?:\.\s|\s*$)/i);
  if (terminatingMembership && /\b(please\s+(?:reply|confirm|be aware)|update\s+your\s+records|receipt)\b/i.test(content)) {
    const officeName = content.match(/Office\s+Name\s*[:：]\s*([^\n.]+)/i);
    return {
      detected: true,
      account: officeName ? officeName[1].trim() : null,
      product: terminatingMembership[1].trim(),
    };
  }

  return { detected: false, account: null, product: null };
}

function cleanCancellationAccountName(raw: string | null): string | null {
  if (!raw) return null;
  let cleaned = raw.trim().replace(/[.,;:!?]+\s*$/, '').trim();
  // Drop if it looks like a sentence fragment rather than a company name
  if (/^(I |we |the |that |this |it |please |hi |hello |dear )/i.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length > 8) return null;
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  return cleaned;
}

// Genuine customer termination/notice: the customer themselves wants to end services.
// Pattern: "formally give notice", "cancel our website/services", "end our contract".
// Must NOT match internal product cancellation patterns (handled above).
function detectCustomerTermination(content: string): { detected: boolean; account: string | null } {
  // Skip if this is an internal/admin cancellation
  if (detectInternalProductCancellation(content).detected) return { detected: false, account: null };

  const hasTerminationSignal =
    /\b(formal(?:ly)?\s+(?:give|serve|submit|provide)\s+(?:my|our)?\s*notice|give\s+(?:my|our)\s+\d+\s*days?\s*notice|end\s+(?:our|my)\s+(?:website|services?|contract|agreement|subscription)\s+with)\b/i.test(content);

  const hasServiceEndSignal =
    /\b(we\s+would\s+like\s+to\s+cancel\s+our\s+website|cancel\s+our\s+(?:website|service|hosting|contract)\s+with|terminate\s+(?:our|my)\s+(?:services?|contract|agreement|website))\b/i.test(content);

  if (!hasTerminationSignal && !hasServiceEndSignal) return { detected: false, account: null };

  // Try to extract account from message
  const accountMatch = content.match(/\b(?:for|account\s*[:：]?\s*)([A-Z][A-Za-z0-9 &'.-]{2,40})\b/i);
  return { detected: true, account: accountMatch ? accountMatch[1].trim() : null };
}

function detectBillingFromKeywords(content: string): { likely: boolean; subcategory: string | null } {
  if (!BILLING_CANCELLATION_PATTERNS.test(content)) return { likely: false, subcategory: null };
  const lower = content.toLowerCase();
  if (/\b(cancel|deactivate|disable|terminate|end|stop|close)\b/.test(lower)) {
    return { likely: true, subcategory: 'billing_cancel' };
  }
  if (/\b(change|upgrade|downgrade|switch|modify|amend)\s+(?:our|my|the|a)?\s*(?:product|service|subscription|contract|package|plan)\b/.test(lower)) {
    return { likely: true, subcategory: 'billing_change' };
  }
  return { likely: true, subcategory: 'billing_cancel' };
}

function extractAccountFieldsFromText(content: string, fields: IntakeCollectedFields): void {
  if (!fields.affectedPersonEmail) {
    const emailMatch = content.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    if (emailMatch) fields.affectedPersonEmail = emailMatch[1];
  }

  if (!fields.affectedPersonName) {
    const namePatterns = [
      // Labeled: "Name: Chris Clark" or "Name - Chris Clark"
      /\bname\s*[:：\-–—]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/,
      // Prose-form: "I'm Sarah Jones", "My name is Sarah Jones", "This is Sarah Jones calling/here"
      /\b(?:I'?m|my name is|this is)\s+([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
      /\b(?:remove|set ?up|add|create|for)\s+(?:(?:the\s+)?user\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:left|was fired|was let go|has left|is leaving|joined|started|needs?)\b/,
      /\b(?:(?:their|the|her|his)\s+name\s+is|name\s*[:]\s*|called)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/,
      /\b(?:it'?s\s+(?:for\s+)?|this\s+is\s+(?:for\s+)?)([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(?:'s)?\s+(?:email|access|account|login|password)\b/,
      /\b(?:the\s+)?(?:user|person|employee|staff\s+member)\s+(?:is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/,
      // Name immediately before email: "Lauren Walker, lauren.walker@..." or "Lauren Walker lauren.walker@..."
      /\b([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,\s]+[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    ];
    for (const pattern of namePatterns) {
      const match = content.match(pattern);
      if (match) { fields.affectedPersonName = match[1].trim(); break; }
    }
  }

  if (!fields.officeBranch) {
    const branchPatterns = [
      // Labeled: "Branch: Washington" or "Branch - Washington"
      /\b(?:branch|office)\s*[:：\-–—]\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\b/i,
      /\b(?:our |the )?(?:new |old )?(\w+(?:\s+\w+)?)\s+(?:office|branch)\b/i,
      /\b(?:office|branch)\s+(?:in|at)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
      // "for {Branch} branch please" / "for {Branch} please"
      /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:branch|office)\b/i,
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

function extractDataRemovalContext(content: string, fields: IntakeCollectedFields): void {
  if (!fields.affectedPersonEmail) {
    const emailMatch = content.match(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/);
    if (emailMatch) fields.affectedPersonEmail = emailMatch[1];
  }
  if (!fields.account) {
    const removalAccountPatterns = [
      /\bfrom\s+(?:the\s+)?(?:our\s+)?([A-Z][A-Za-z0-9 &'.-]{2,40}?)\s+account\b/i,
      /\bon\s+(?:the\s+)?(?:our\s+)?([A-Z][A-Za-z0-9 &'.-]{2,40}?)\s+(?:account|system|platform)\b/i,
      /\bfrom\s+(?:our\s+)?([A-Z][A-Za-z0-9 &'.-]{2,40}?)\s+(?:mailing\s+list|email\s+(?:list|system|marketing)|system|platform|database|crm)\b/i,
      /\bfrom\s+([A-Z][A-Za-z0-9 &'.-]{2,40}?)(?:'s)?\s+(?:data|records?|emails?|contacts?)\b/i,
      /\b(?:for|from)\s+([A-Z][A-Za-z0-9 &'.-]{2,40}?)\s*(?:[.!?]?\s*$|,|\s+please\b)/i,
    ];
    for (const pat of removalAccountPatterns) {
      const m = content.match(pat);
      if (m) {
        const captured = m[1].trim();
        if (!/\b(the|this|that|my|our|a|an|it|their|your)\b/i.test(captured) && captured.length >= 2) {
          fields.account = captured;
          break;
        }
      }
    }
  }
}

function detectCrossDomainAmbiguity(content: string): { ambiguous: boolean; domains: string[]; clarificationQuestion: string | null } {
  const lower = content.toLowerCase();

  const hasAccountSignals = /\b(can'?t (see|access|get|log)|permission|new (user|starter|office|branch)|locked out|password)\b/.test(lower);
  const hasWebsiteSignals = /\b(website|web site|our site|the site|page|homepage|display|showing)\b/.test(lower);
  // Strip company names containing "property/properties" before checking for property signals
  const COMPANY_PROP_RE = /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+Propert(?:y|ies)(?:\s+(?:Management|Group|Ltd|Limited|Services|Solutions|Team|Consultants?|Agents?|Advisors?))\b/gi;
  const contentForPropertyCheck = content.replace(COMPANY_PROP_RE, '').toLowerCase();
  const hasPropertySignals = /\b(property|properties|listing|listings|rightmove|zoopla|onthemarket)\b/.test(contentForPropertyCheck);
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
  // Protocol-prefixed URLs (highest confidence)
  const httpMatch = content.match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/i);
  if (httpMatch) return httpMatch[0].replace(/[.,;:!?)]+$/, '');

  // www-prefixed URLs
  const wwwMatch = content.match(/\bwww\.[a-z0-9][-a-z0-9]*(?:\.[a-z]{2,})+(?:\/[^\s<>"{}|\\^`\[\]]*)*/i);
  if (wwwMatch) return wwwMatch[0].replace(/[.,;:!?)]+$/, '');

  // Bare domain URLs with common TLDs (only when not preceded by @ to avoid emails)
  const domainMatch = content.match(/(?<!\S@)(?<!\w)\b([a-z0-9][-a-z0-9]*\.(?:co\.uk|com|org|net|agency|io|uk|biz|tech|info)(?:\/[^\s<>"{}|\\^`\[\]]*)*)/i);
  if (domainMatch) {
    const candidate = domainMatch[0].replace(/[.,;:!?)]+$/, '');
    // Reject if it's just a file extension or email-like fragment
    if (candidate.includes('.') && candidate.length > 5) return candidate;
  }

  return null;
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

    // Auto-populate account from authenticated org — portal users already belong
    // to an org, so don't repeatedly prompt them for something we already know.
    // Skip placeholder values so "Unknown Organisation" never leaks into customer-facing text.
    if (!meta.collectedFields.account && context.orgName && !isPlaceholderOrgName(context.orgName)) {
      meta.collectedFields.account = context.orgName;
    }

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
          messageMeta = { type: 'confirmed' as const, ticketKey, intent: meta.intent };
          meta.stage = 'confirmed';
          meta.offeredTicketCreation = false;
        } else if (userMessageCount >= handoffThreshold && meta.stage !== 'kb_check' && !meta.offeredTicketCreation) {
          responseContent += '\n\nShall I raise a ticket for you? That way one of the team can pick this up directly.';
          meta.offeredTicketCreation = true;
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      console.error(`[portal-chat] Stage processing failed for session ${sessionId}, stage=${meta.stage}, intent=${meta.intent}:`, errMsg);
      if (errStack) console.error('[portal-chat] Stack:', errStack);
      if (meta.submissionFailed) {
        responseContent = "I'm sorry — I wasn't able to process that. Please contact us directly at **support@nurtur.tech** and we'll help you from there.";
        meta.stage = 'confirmed';
      } else {
        responseContent = "I'm having trouble processing your request right now. Shall I log a ticket so the team can pick this up?";
        meta.offeredTicketCreation = true;
      }
    }

    // Runtime vocabulary firewall — catches jargon leaks from LLM and echo
    responseContent = sanitizeCustomerResponse(responseContent, content);

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

    // Always attempt URL capture from every message — ensures URLs bundled with
    // ticket-request language or conversational responses are never missed.
    if (!meta.collectedFields.url) {
      const url = extractUrlFromText(content);
      if (url) meta.collectedFields.url = url;
    }

    // Recovery: if the last assistant message offered a handoff but the flag
    // wasn't properly persisted, re-set it so the affirmative check below fires.
    if (!meta.offeredTicketCreation && stage !== 'confirmed' && stage !== 'summary' && isAffirmativeResponse(content)) {
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
      if (lastAssistant && /\bwould you like me to create a (?:support )?ticket\b/i.test(lastAssistant.content)) {
        console.log(`[portal-chat] session=${sessionId} recovering offeredTicketCreation from history`);
        meta.offeredTicketCreation = true;
      }
    }

    if (meta.offeredTicketCreation && stage !== 'confirmed') {
      if (isAffirmativeResponse(content)) {
        meta.offeredTicketCreation = false;

        // Frustration-driven handoff: the customer explicitly asked for a human,
        // so skip the summary card and create the ticket immediately.
        if (meta.frustrationHandoffOffered) {
          meta.frustrationHandoffOffered = false;
          const ticketKey = await this.forceHandoff(meta, context, sessionId, history);
          return {
            response: `I've created ticket **${ticketKey}** and a team member will follow up with you directly. You can track its progress in **My Tickets**.`,
            messageMeta: { type: 'confirmed' as const, ticketKey },
          };
        }

        // Normal offer — route through summary review before submission
        return await this.buildSummaryCard(meta);
      }

      if (isNegativeResponse(content)) {
        meta.offeredTicketCreation = false;
      }
    }

    // Follow-up with ticket reference wins over frustration handling —
    // "NT-123 is still not fixed" is a follow-up case, not just frustration.
    if (meta.frustrationDetected && ESCALATION_CHASE_PATTERNS.test(content) && /\b(NT|NTPJ)-\d+\b/i.test(content)) {
      meta.frustrationDetected = false;
    }

    // Frustration override — offer handoff immediately from any stage except confirmed
    if (meta.frustrationDetected && stage !== 'confirmed' && stage !== 'summary') {
      meta.frustrationDetected = false; // consume the flag
      meta.offeredTicketCreation = true;
      meta.frustrationHandoffOffered = true;

      // Preserve operational detail from the frustration message before empathy return
      extractPropertyFieldsFromText(content, meta.collectedFields);
      extractAccountFieldsFromText(content, meta.collectedFields);
      if (!meta.collectedFields.description) {
        meta.collectedFields.description = content;
      }
      if (!meta.category) {
        if (COMPLAINT_INTENT_PATTERNS.test(content)) {
          meta.category = 'complaint';
          meta.conversational = true;
          meta.complaintDetected = true;
          meta.collectedFields.urgency = 'High';
          if (/\b(escalat)\b/i.test(content)) {
            meta.subcategory = 'complaint_escalate';
          } else if (/\b(waiting|response|replied|got back)\b/i.test(content)) {
            meta.subcategory = 'complaint_response';
          } else {
            meta.subcategory = 'complaint_service';
          }
        } else {
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
      }
      if (ATTACHMENT_PATTERNS.test(content)) {
        meta.attachmentMentioned = true;
      }

      const empathy = this.buildEmpathyAcknowledgement(meta);
      return {
        response: `${empathy} Let me get someone on the team to look into this for you — shall I raise a ticket now?`,
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
        if (isAffirmativeResponse(content)) {
          // Natural-language confirmation — submit as-is
          try {
            const result = await this.confirmAndSubmit(sessionId, {}, context, { skipMessage: true });
            return {
              response: `I've created ticket **${result.ticketKey}**. You can track its progress in **My Tickets**, and our team will follow up if anything else is needed.`,
              messageMeta: { type: 'confirmed' as const, ticketKey: result.ticketKey },
            };
          } catch (err) {
            console.error('[portal-chat] Summary-stage submission failed:', err instanceof Error ? err.message : err);
            meta.submissionFailed = true;
            meta.stage = 'confirmed';
            return {
              response: "I'm sorry — I wasn't able to create the ticket right now. Please contact us directly at **support@nurtur.tech** and we'll get this sorted for you. You can include the details from this conversation in your email.",
            };
          }
        }
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

    // Extract fields from opening message via regex (account patterns, URL, browser, etc.)
    this.extractFieldsRegex(meta, content);
    extractPropertyFieldsFromText(content, meta.collectedFields);
    extractAccountFieldsFromText(content, meta.collectedFields);

    if (this.llm) {
      return this.handleIntentWithLlm(meta, content, context, sessionId);
    }
    return await this.handleIntentWithoutLlm(meta, content);
  }

  private async handleIntentWithLlm(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // H0a: Internal product cancellation fast-track — admin/ops staff notifying that a
    // customer has cancelled a product. These are internal instructions, not customer-facing
    // intake. Detect the pattern and route directly to billing_cancel with full detail preservation.
    const internalCancelDetection = detectInternalProductCancellation(content);
    if (internalCancelDetection.detected) {
      const cleanedAccount = cleanCancellationAccountName(internalCancelDetection.account);
      meta.category = 'billing';
      meta.subcategory = 'billing_cancel';
      meta.conversational = true;
      meta.stage = 'detail';
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
      if (cleanedAccount) meta.collectedFields.account = cleanedAccount;
      if (internalCancelDetection.product) {
        meta.collectedFields.subject = `Product Cancellation — ${internalCancelDetection.product}` +
          (cleanedAccount ? ` for ${cleanedAccount}` : '');
      }
      const summaryResult = await this.buildSummaryCard(meta);
      const ackParts = ['Understood — I\'ll get that cancellation raised.'];
      if (internalCancelDetection.product && cleanedAccount) {
        ackParts[0] = `Understood — I'll raise the cancellation of ${internalCancelDetection.product} for ${cleanedAccount}.`;
      }
      return {
        response: `${ackParts[0]}\n\n${summaryResult.response}`,
        messageMeta: summaryResult.messageMeta,
      };
    }

    // H0b: Genuine customer cancellation / termination / notice — the customer (not admin)
    // is requesting to end services. Acknowledge receipt, do NOT accept or confirm the
    // termination, and route to a human agent.
    const customerTerminationDetection = detectCustomerTermination(content);
    if (customerTerminationDetection.detected) {
      const cleanedTermAccount = cleanCancellationAccountName(customerTerminationDetection.account);
      meta.category = 'billing';
      meta.subcategory = 'billing_cancel';
      meta.conversational = true;
      meta.stage = 'detail';
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
      if (cleanedTermAccount) meta.collectedFields.account = cleanedTermAccount;
      const config = CATEGORY_FIELD_CONFIG[meta.subcategory] || CATEGORY_FIELD_CONFIG['other_general']!;
      const missing = this.getMissingFields(meta.collectedFields, config);
      const ack = "Thank you for letting us know — I've noted your request. A member of our team will be in touch to discuss this with you directly.";
      if (missing.includes('account')) {
        return { response: `${ack}\n\nCould you confirm which account this is for so I can pass it to the right person?` };
      }
      const summaryResult = await this.buildSummaryCard(meta);
      return {
        response: `${ack}\n\n${summaryResult.response}`,
        messageMeta: summaryResult.messageMeta,
      };
    }

    // H0: Billing cancellation fast-track — pre-empt security-sensitive check so product/service
    // cancellation ("cancel our account", "deactivate the email marketing") routes to billing,
    // not user removal.
    const billingDetection = detectBillingFromKeywords(content);
    if (billingDetection.likely) {
      meta.category = 'billing';
      meta.subcategory = billingDetection.subcategory || 'billing_cancel';
      meta.conversational = true;
      meta.stage = 'detail';
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
      const config = CATEGORY_FIELD_CONFIG[meta.subcategory] || CATEGORY_FIELD_CONFIG['other_general']!;
      const missing = this.getMissingFields(meta.collectedFields, config);
      if (missing.length === 0) {
        const summaryResult = await this.buildSummaryCard(meta);
        return {
          response: `Understood — I'll get your cancellation request raised.\n\n${summaryResult.response}`,
          messageMeta: summaryResult.messageMeta,
        };
      }
      const ack = "Understood — I'll get your cancellation request raised.";
      const question = missing.includes('account') ? 'Which account is this for?' : 'Could you let me know which product or service you need cancelled?';
      return { response: `${ack}\n\n${question}` };
    }

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
        const summaryResult = await this.buildSummaryCard(meta);
        return {
          response: `Understood — I'll get ${personName}'s access removed urgently.\n\n${summaryResult.response}`,
          messageMeta: summaryResult.messageMeta,
        };
      }

      if (personName) {
        return { response: `Understood — I'll get ${personName}'s access removed urgently. Could you confirm their email address so I can get this raised?` };
      }
      if (personEmail) {
        return { response: `Understood — I'll get ${personEmail} removed urgently. Could you confirm the name of the person to be removed?` };
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

    // H1c: Data-removal / privacy fast-track — explicit requests to remove an email address,
    // data, or record from a named account. Pre-empts LLM to avoid misrouting into
    // website-content or email-marketing paths.
    if (DATA_REMOVAL_PATTERNS.test(content)) {
      meta.category = 'account';
      meta.subcategory = 'account_remove_user';
      meta.conversational = true;
      meta.stage = 'detail';
      extractAccountFieldsFromText(content, meta.collectedFields);
      extractDataRemovalContext(content, meta.collectedFields);

      const email = meta.collectedFields.affectedPersonEmail;
      const account = meta.collectedFields.account;
      const hasDescription = !!meta.collectedFields.description;
      if (!hasDescription) meta.collectedFields.description = content;

      const ackParts: string[] = ["Understood — I'll get that removal sorted."];
      if (email) ackParts[0] = `Understood — I'll get ${email} removed.`;
      if (account && !isPlaceholderOrgName(account)) ackParts[0] = ackParts[0].replace(/\.$/, ` from the ${account} account.`);

      const missing: string[] = [];
      if (!email) missing.push('the email address to be removed');
      if (!account || isPlaceholderOrgName(account)) missing.push('which account this is for');
      if (missing.length === 0) {
        const summaryResult = await this.buildSummaryCard(meta);
        return {
          response: `${ackParts[0]}\n\n${summaryResult.response}`,
          messageMeta: summaryResult.messageMeta,
        };
      }
      return { response: `${ackParts[0]}\n\nCould you confirm ${missing.join(' and ')}?` };
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
   IMPORTANT: Requests to correct business details (phone numbers, addresses, opening hours, office/branch details, contact information) that display ON THE WEBSITE are almost always website content updates — set isWebsiteRelated=true and websiteSubcategory=website_content for these.
   EXCEPTION — ADMIN ADDRESS CHANGES: Requests to update a billing address, registered address, company address, postal address, or account address are ADMINISTRATIVE changes (not website content) — set isAccountRelated=true, accountSubcategory=account_details. "Office has moved" / "change office address" / "new office address" → isAccountRelated=true, accountSubcategory=account_office_change.
   If website-related, classify:
   - website_content: updating text, images, phone numbers, addresses, staff details, opening hours, branch/office details, contact information on an existing page
   - website_broken: something on the website is not working, displaying wrong, or erroring
   - website_new_page: requesting a new page to be added to the website
   - website_design: visual/layout/styling changes, redesign requests

3. PROPERTY / LISTING CLASSIFICATION — is this about a property listing?
   Set isPropertyRelated=true for issues with: property listings, Rightmove/Zoopla/OnTheMarket feeds, property photos/floorplans/EPCs, listing visibility, property sync, sold/STC status, property details being wrong on portals, missing listings, feed issues.
   Set isPropertyRelated=false for: website design/content (even if the website shows properties), account/login, email marketing, billing, or unclear requests.
   COMPANY NAME GUARD: If "property" or "properties" appears ONLY as part of a company name (e.g. "Abbey Forth Property Management", "De Mel Property team", "Moss Properties"), do NOT treat the request as property-related. The word "property" in a company name has no bearing on whether this is a listing issue. Look for actual listing/feed/portal intent beyond the company name.
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

5. EMAIL MARKETING CLASSIFICATION — is this about email campaigns, newsletters, or the email marketing platform (BYM/BriefYourMarket)?
   Set isEmailMarketingRelated=true for: campaign sending issues, click tracking not working, email stats/reports, carousel or editor problems within the email tool, email footer updates, newsletter issues, test sends, scheduled reports, BYM platform issues, email template requests, mailing list management, unsubscribe/opt-out issues.
   Set isEmailMarketingRelated=false for: website content (even if "email address on the website" — that's website_content), account login, property listings, billing, or unclear requests.
   IMPORTANT: "email" in context of "email address on our website" or "change the email on the contact page" is website_content, NOT email marketing. Email marketing means the campaign/newsletter/bulk-email sending platform.

6. INTENT OVERRIDE — if the customer is clearly asking for an action (check, investigate, fix, look into, confirm something is wrong) or reporting a compliance-sensitive issue (emails sent to unsubscribed data, GDPR concern), classify as intent=problem or intent=change even if the phrasing sounds like a question. "Can you check why emails went to unsubscribed contacts?" is a problem report, not a knowledge-base question.

7. FIELD EXTRACTION — capture details already provided. Include subject, account, description, url, errorMessage, browser, urgency (only if explicit), propertyAddress, listingId, affectedPortals. Preserve the customer's exact words in description — do not rewrite or summarise. If they mention a phone number, include the phone number. If they mention an address, include the address verbatim.
   NAME/EMAIL PRESERVATION: When the customer provides a person's name, email address, branch, or other structured details in their message (e.g. "Name: Chris Clark, Email: chris@example.com, Branch: Washington" or "Lauren Walker, lauren.walker@example.com"), capture ALL of these in the description field verbatim. Do NOT ask for information that has already been provided in the message.

8. ACKNOWLEDGMENT — write 1-2 sentences that show you understood the customer's specific problem.
   PRIMARY RULE: Use the customer's own words to describe their problem. If they said "she can't see anything", say "she can't see anything". If they said "the number is wrong", say "the number is wrong". Do not translate their words into technical or internal vocabulary.
   MANDATORY DETAIL INCLUSION — you MUST include these in the acknowledgement when the customer provides them:
   - Phone numbers: include the EXACT phone number(s) mentioned (e.g. "0161 555 1234"). Never drop or omit phone numbers.
   - Addresses: include the EXACT address or location mentioned. Never summarise to "your address".
   - Person names: include the EXACT name mentioned (e.g. "Sarah Jenkins"). Never replace with "the user" or "them".
   - Reference numbers: include any ticket/reference/listing numbers verbatim.
   - Error messages: include the specific error text if provided.
   If they said "the phone number on our contact page is wrong — it shows 0161 555 1234 but should be 0161 555 6789", your acknowledgement MUST include both numbers and "contact page".
   If they mentioned multiple issues, acknowledge ALL of them, not just the primary one.
   NEVER paraphrase away specifics. "I can help with that update" is a VIOLATION. "I can see the phone number on your contact page needs updating from 0161 555 1234 to 0161 555 6789" is correct.
   ANTI-ECHO RULES:
   - NEVER start with "Thanks for those details about {X}" where X is a category label like "Website", "Account", "Email", or "Property". These are internal classification labels and must never appear in customer-facing text.
   - NEVER parrot back the customer's greeting. If they said "Hi, the phone number is wrong", acknowledge the phone number issue — do NOT include "hi" or any greeting they used.
   - NEVER repeat the customer's full sentence verbatim as a quote. Demonstrate understanding through your own natural wording that incorporates their key details.
   - Good: "I can see the phone number on your contact page needs updating from 0161 555 1234 to 0161 555 6789."
   - Bad: "You mentioned hi, the phone number on our contact page is wrong."
   - Bad: "Thanks for those details about Website."
   VOCABULARY FIREWALL (safety net) — never use ANY of these terms in the acknowledgement or any customer-facing text:
   - Technical: feed, syndication, API, integration, CRM sync, data feed, data pipeline, webhook, endpoint
   - Account/access internal: RBAC, provisioning, deprovisioning, authentication, authorisation, authorization, access control, role-based, permission matrix, permission model, scopes, entities, service account, SSO, SAML, identity provider, access permissions, user permissions, role permissions, access rights
   - Classification: triage, categorise, classify, route, intake, subcategory, Website (as a noun by itself), Account (as a category label)
   Instead, use the customer's vocabulary. If they said "can't get in", say "can't get in", not "authentication issue". If they said "she can't see anything", say "she can't see anything", not "access permissions issue".
   URGENCY RULE: If the customer uses words like "urgent", "urgently", "URGENT", "asap", "emergency", "critical", or "down", START the acknowledgement by recognising the urgency (e.g. "I can see this is urgent — " or "Understood, I'll treat this as a priority — ") before addressing their details. Never ignore explicit urgency signals.
   ACCOUNT/ORG RULE: If the account field is unknown or not provided, do NOT include any placeholder like "Unknown Organisation" in the acknowledgement. Simply omit the account reference.

9. NEXT QUESTION — if you need more information to action this, write ONE natural follow-up question. Only ask for what's genuinely missing. If they've given enough detail, omit this field. Never ask the customer to diagnose the technical cause or identify which system is at fault. Never ask "which system" or "which platform".

10. MULTI-ISSUE HANDLING — if the customer describes more than one issue (e.g. "I'm locked out AND the new users aren't set up"), capture ALL issues in the description field as separate items. The acknowledgement must reference every issue they raised. Do not collapse multiple issues into a single category.

11. READY FOR CONFIRMATION — set readyForConfirmation=true if you have at minimum: what the problem is AND which property or account is affected. Otherwise false.

Set confidence 0.0-1.0 for how certain you are about the classification. If both isWebsiteRelated and isPropertyRelated could apply, set the more specific one to true and the other to false.`,
        content,
        ConversationalIntakeSchema,
        { callType: 'portal_chat', tier: 'standard', maxTokens: 500, temperature: 0.2 },
      );

      const d = result.data;
      meta.intent = d.intent;

      // Populate extracted fields (don't overwrite URL from regex)
      if (d.subject) meta.collectedFields.subject = d.subject;
      if (d.account && isLikelyAccountName(d.account)) {
        const cleaned = cleanAccountName(d.account);
        if (cleaned) {
          // Prefer longer/more complete account name from regex over LLM truncation
          if (!meta.collectedFields.account || cleaned.length >= meta.collectedFields.account.length) {
            meta.collectedFields.account = cleaned;
          }
        }
      }
      if (d.url && !meta.collectedFields.url) meta.collectedFields.url = d.url;
      if (d.errorMessage) meta.collectedFields.errorMessage = d.errorMessage;
      if (d.browser) meta.collectedFields.browser = d.browser;
      if (d.urgency) meta.collectedFields.urgency = d.urgency;
      if (d.propertyAddress) meta.collectedFields.propertyAddress = d.propertyAddress;
      if (d.listingId && !isPhoneLikeValue(d.listingId)) meta.collectedFields.listingId = d.listingId;
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

      // Action-intent guard: override question→KB deflection when the message
      // clearly requests action/investigation or involves compliance-sensitive topics.
      const isActionRequest = ACTION_INVESTIGATION_PATTERNS.test(content);
      const isComplianceSensitive = COMPLIANCE_SENSITIVE_PATTERNS.test(content);
      const questionIsActuallyAction = d.intent === 'question' && (isActionRequest || isComplianceSensitive);
      if (questionIsActuallyAction) {
        // Re-classify: compliance issues are problems, investigation requests are changes
        meta.intent = isComplianceSensitive ? 'problem' : 'change';
      }

      // Route question intent — try KB first (skipped if action guard fired)
      if (d.intent === 'question' && !questionIsActuallyAction) {
        try {
          const kbResult = await this.searchKb(content);
          if (kbResult.length > 0) {
            meta.stage = 'kb_check';
            meta.kbSuggested = true;
            const ack = d.acknowledgment || '';
            const kbLead = ack
              ? `${ack}\n\nI found an article that might answer this:`
              : 'I found some articles that might help:';
            return {
              response: kbLead,
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

      // F1: Deterministic follow-up gate — when a Jira ticket reference is present with
      // escalation/chase language, route to follow-up BEFORE LLM-driven domain routing
      // to prevent inconsistent LLM classifications from stealing follow-up messages.
      const hasTicketRef = /\b(NT|NTPJ)-\d+\b/i.test(content);
      if (hasTicketRef && ESCALATION_CHASE_PATTERNS.test(content)) {
        meta.conversational = true;
        meta.stage = 'detail';
        meta.escalationDetected = true;
        meta.category = 'followup';
        meta.subcategory = 'followup_not_resolved';

        const refMatch = content.match(/\b(NT|NTPJ)-\d+\b/i);
        if (refMatch) {
          const refKey = refMatch[0].toUpperCase();
          meta.followUpTicketKey = refKey;
          const domain = await this.portalJira.getOrgEmailDomain(context.orgId);
          if (domain) {
            try {
              const refTicket = await queryOne<{ issue_key: string; summary: string; status: string }>(
                `SELECT issue_key, summary, status FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
                [refKey, `%@${domain}`],
              );
              if (refTicket) {
                meta.followUpTicketKey = refTicket.issue_key;
                meta.followUpTicketSummary = refTicket.summary;
                const statusLower = refTicket.status.toLowerCase();
                if (statusLower === 'resolved' || statusLower === 'closed') {
                  meta.subcategory = 'followup_reopen';
                }
                const ack = d.acknowledgment || `I can see your original request **${refTicket.issue_key}** — "${refTicket.summary}" (currently **${refTicket.status}**).`;
                return { response: `${ack}\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?` };
              }
            } catch { /* fall through to generic follow-up with key still set */ }
          }
          const ack = d.acknowledgment || `I can see you're following up on **${refKey}**.`;
          return { response: `${ack}\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?` };
        }
      }

      // Letters precedence gate — if the customer clearly wants letters/correspondence,
      // don't let incidental website mentions route to the website path.
      // Guard: skip only when website signals dominate AND letters mention is incidental.
      const lettersBeforeWebsite = detectLettersFromKeywords(content);
      const hasExplicitWebsiteWords = /\b(website|web site|our site|my site|the site|homepage|home page|web page|webpage)\b/i.test(content);
      const websiteIsIncidental = hasExplicitWebsiteWords && (() => {
        const lower = content.toLowerCase();
        // Website is incidental if it appears only as a reference/address context
        // (e.g. "my website is example.com" or "include our website address on the letter")
        // rather than as a request for website work (e.g. "update my website")
        const websiteActionPattern = /\b(update|change|fix|edit|amend|check|look at|review|redesign|rebuild)\s+(my |our |the )?(website|web site|site|homepage|home page|web page|webpage)\b/;
        const websiteComplaintPattern = /\b(website|web site|site|homepage|home page|web page|webpage)\s+(\w+\s+){0,3}(is|isn.?t|are|aren.?t|not|won.?t|can.?t|has|have|looks?|needs?|doesn.?t|don.?t|shows?|showing|displaying)\b/;
        const hasWebsiteAction = websiteActionPattern.test(lower) || websiteComplaintPattern.test(lower);
        if (hasWebsiteAction) return false;
        // If website words appear but no action/complaint directed at the website, it's incidental
        return true;
      })();
      if (lettersBeforeWebsite.likely && (!hasExplicitWebsiteWords || websiteIsIncidental)) {
        meta.category = 'letters';
        meta.subcategory = lettersBeforeWebsite.subcategory || 'letters_general';
        meta.conversational = true;
        meta.stage = 'detail';
        const config = CATEGORY_FIELD_CONFIG[meta.subcategory] || CATEGORY_FIELD_CONFIG['letters_general']!;
        const missing = this.getMissingFields(meta.collectedFields, config);
        if (missing.length === 0) {
          const ack = d.acknowledgment || "Thanks — I'll get your correspondence request raised with our production team.";
          const summaryResult = await this.buildSummaryCard(meta);
          return { response: `${ack}\n\n${summaryResult.response}`, messageMeta: summaryResult.messageMeta };
        }
        const ack = d.acknowledgment || "Thanks — I'll get your correspondence request raised with our production team.";
        const question = d.nextQuestion || this.buildConversationalQuestion(missing[0], meta);
        return { response: `${ack}\n\n${question}` };
      }

      // Pre-empt: admin address changes misclassified as website content → reroute to account
      const ADMIN_ADDR_RE = /\b(billing|registered|company|business|account|postal|mailing|correspondence|head\s+office)\s+address\b/i;
      const OFFICE_MOVE_RE = /\b(office\s+has\s+moved|change\s+(our\s+|the\s+)?(office|branch)\s+address|update\s+(our\s+|the\s+)?(office|branch)\s+address|moved?\s+offices?)\b/i;
      if (d.isWebsiteRelated && !/\b(website|web site|page|our site|the site|display|showing)\b/i.test(content)) {
        if (ADMIN_ADDR_RE.test(content)) {
          d.isWebsiteRelated = false;
          d.isAccountRelated = true;
          if (!d.accountSubcategory) d.accountSubcategory = 'account_details';
          if (d.confidence < 0.6) d.confidence = 0.7;
        } else if (OFFICE_MOVE_RE.test(content)) {
          d.isWebsiteRelated = false;
          d.isAccountRelated = true;
          if (!d.accountSubcategory) d.accountSubcategory = 'account_office_change';
          if (d.confidence < 0.6) d.confidence = 0.7;
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
            const summaryResult = await this.buildSummaryCard(meta);
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
        const urgentWeb = /\b(urgent|urgently|asap|emergency|critical|down)\b/i.test(content);
        if (urgentWeb) meta.collectedFields.urgency = meta.collectedFields.urgency || 'High';
        const ack = d.acknowledgment || (urgentWeb ? "I can see this is urgent — let me get this picked up quickly." : "Thanks for getting in touch.");
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
            const summaryResult = await this.buildSummaryCard(meta);
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
        const ack = d.acknowledgment || "Thanks for getting in touch.";
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
            const summaryResult = await this.buildSummaryCard(meta);
            return {
              response: `${ack}\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }

          if (personName) {
            return { response: `${ack} Could you confirm their email address so I can get this raised?` };
          }
          if (personEmail) {
            const emailAck = d.acknowledgment || `Understood — I'll get ${personEmail} removed urgently.`;
            return { response: `${emailAck} Could you confirm the name of the person to be removed?` };
          }
          return { response: `${ack} Could you confirm their name and email address so I can get this raised?` };
        }

        if (d.accountSubcategory) {
          meta.subcategory = d.accountSubcategory;
          meta.stage = 'detail';

          const missing = this.getAccountMissingFields(meta.collectedFields, meta.subcategory);
          if (missing.length === 0) {
            const ack = d.acknowledgment || 'Thanks for providing all those details.';
            const summaryResult = await this.buildSummaryCard(meta);
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

      // LLM-driven email marketing classification
      if (d.isEmailMarketingRelated && d.confidence >= 0.5) {
        meta.category = 'email_marketing';
        meta.conversational = true;
        meta.stage = 'detail';
        // Use deterministic subcategory detection for precision
        const emailDetect = detectEmailMarketingFromKeywords(content);
        meta.subcategory = emailDetect.subcategory || 'email_campaign';
        const configKey = meta.subcategory as keyof typeof CATEGORY_FIELD_CONFIG;
        const config = CATEGORY_FIELD_CONFIG[configKey];
        if (config) {
          const missing = this.getMissingFields(meta.collectedFields, config);
          if (missing.length === 0) {
            const ack = d.acknowledgment || "Thanks — I'll get this raised with our email marketing team.";
            const summaryResult = await this.buildSummaryCard(meta);
            return { response: `${ack}\n\n${summaryResult.response}`, messageMeta: summaryResult.messageMeta };
          }
          const ack = d.acknowledgment || "Thanks — I'll get this raised with our email marketing team.";
          const question = d.nextQuestion || this.buildConversationalQuestion(missing[0], meta);
          return { response: `${ack}\n\n${question}` };
        }
        const ack = d.acknowledgment || "Thanks — I'll get this raised with our email marketing team.";
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening?` };
      }

      // Deterministic email marketing detection — catches signals the LLM may miss
      const emailDetect = detectEmailMarketingFromKeywords(content);
      if (emailDetect.likely) {
        meta.category = 'email_marketing';
        meta.subcategory = emailDetect.subcategory || 'email_campaign';
        meta.conversational = true;
        meta.stage = 'detail';
        const configKey = meta.subcategory as keyof typeof CATEGORY_FIELD_CONFIG;
        const config = CATEGORY_FIELD_CONFIG[configKey];
        if (config) {
          const missing = this.getMissingFields(meta.collectedFields, config);
          if (missing.length === 0) {
            const defaultAck = meta.subcategory === 'email_template'
              ? "Thanks — I'll get your template request raised with our production team."
              : "Thanks — I'll get this raised with our email marketing team.";
            const ack = d.acknowledgment || defaultAck;
            const summaryResult = await this.buildSummaryCard(meta);
            return { response: `${ack}\n\n${summaryResult.response}`, messageMeta: summaryResult.messageMeta };
          }
          const defaultAck = meta.subcategory === 'email_template'
            ? "Thanks — I'll get your template request raised with our production team."
            : "Thanks — I'll get this raised with our email marketing team.";
          const ack = d.acknowledgment || defaultAck;
          const question = d.nextQuestion || this.buildConversationalQuestion(missing[0], meta);
          return { response: `${ack}\n\n${question}` };
        }
        const ack = d.acknowledgment || "Thanks — I'll get this raised with our email marketing team.";
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening?` };
      }

      // (Letters detection moved above website check for precedence — see lettersBeforeWebsite)

      // Complaint / escalation intent — checked BEFORE disambiguation so mixed-domain
      // complaint messages stay on the complaint path rather than hitting domain clarification.
      if (COMPLAINT_INTENT_PATTERNS.test(content)) {
        meta.conversational = true;
        meta.stage = 'detail';
        meta.category = 'complaint';
        meta.complaintDetected = true;
        meta.collectedFields.urgency = 'High';

        // Preserve whatever detail they included alongside the complaint
        if (!meta.collectedFields.description) {
          meta.collectedFields.description = content;
        }
        extractAccountFieldsFromText(content, meta.collectedFields);

        // Try to infer subcategory from language
        if (/\b(escalat|needs? escalat|want.* escalat|please escalat)\b/i.test(content)) {
          meta.subcategory = 'complaint_escalate';
        } else if (/\b(waiting|response|replied|got back|no reply|haven'?t heard)\b/i.test(content)) {
          meta.subcategory = 'complaint_response';
        } else {
          meta.subcategory = 'complaint_service';
        }

        const ack = d.acknowledgment || "I'm sorry to hear that — I want to make sure your complaint is properly recorded and dealt with.";
        const hasAccount = !!meta.collectedFields.account;
        const hasDetail = content.length > 80;

        if (hasAccount && hasDetail) {
          const summaryResult = await this.buildSummaryCard(meta);
          return {
            response: `${ack}\n\n${summaryResult.response}`,
            messageMeta: summaryResult.messageMeta,
          };
        }

        const followUp = !hasDetail
          ? "Could you tell me what happened and what outcome you're looking for?"
          : "Could you let me know which account this relates to?";

        return { response: `${ack}\n\n${followUp}` };
      }

      // Cross-domain disambiguation check — only when no single domain won above
      // (runs after complaint check so complaint+domain messages stay complaint-aware)
      const ambiguity = detectCrossDomainAmbiguity(content);
      if (ambiguity.ambiguous && ambiguity.clarificationQuestion && !meta.disambiguationAsked) {
        meta.disambiguationAsked = true;
        meta.disambiguationDomain = ambiguity.domains.join(',');
        meta.stage = 'detail';
        meta.conversational = true;
        const isUrgentDisambig = /\b(urgent|urgently|asap|emergency|critical|down)\b/i.test(content);
        if (isUrgentDisambig) meta.collectedFields.urgency = meta.collectedFields.urgency || 'High';
        const ack = isUrgentDisambig
          ? (d.acknowledgment || "I can see this is urgent — let me make sure this gets to the right team quickly.")
          : (d.acknowledgment || "Thanks for getting in touch.");
        return { response: `${ack}\n\n${ambiguity.clarificationQuestion}` };
      }

      // F5: Escalation/chase detection — messages referencing prior tickets/requests
      // should trigger conversational follow-up, never the category picker.
      // Checked BEFORE vague domain signals so follow-up language isn't swallowed
      // by coincidental domain keywords in the complaint.
      if (ESCALATION_CHASE_PATTERNS.test(content)) {
        meta.conversational = true;
        meta.stage = 'detail';
        meta.escalationDetected = true;
        meta.category = 'followup';
        meta.subcategory = 'followup_not_resolved';

        const refMatch = content.match(/\b(NT|NTPJ)-\d+\b/i);
        if (refMatch) {
          const refKey = refMatch[0].toUpperCase();
          meta.followUpTicketKey = refKey;
          const domain = await this.portalJira.getOrgEmailDomain(context.orgId);
          if (domain) {
            try {
              const refTicket = await queryOne<{ issue_key: string; summary: string; status: string }>(
                `SELECT issue_key, summary, status FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
                [refKey, `%@${domain}`],
              );
              if (refTicket) {
                meta.followUpTicketKey = refTicket.issue_key;
                meta.followUpTicketSummary = refTicket.summary;
                const statusLower = refTicket.status.toLowerCase();
                if (statusLower === 'resolved' || statusLower === 'closed') {
                  meta.subcategory = 'followup_reopen';
                }
                const ack = d.acknowledgment || `I can see your original request **${refTicket.issue_key}** — "${refTicket.summary}" (currently **${refTicket.status}**).`;
                return { response: `${ack}\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?` };
              }
            } catch { /* fall through to generic chase with key still set */ }
          }
          const ack = d.acknowledgment || `I can see you're following up on **${refKey}**.`;
          return { response: `${ack}\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?` };
        }

        const ack = d.acknowledgment || "I can see you've been in touch about this before — sorry it's not been resolved yet.";
        return { response: `${ack}\n\nCould you tell me a bit more about the issue you originally raised so I can get this picked up?` };
      }

      // H2: Vague-but-domain-signalled fallback — if ANY domain signal is present,
      // route to conversational clarification instead of the category picker.
      // The picker is the last resort for genuinely unclassifiable input only.
      const vagueAccountSignal = detectAccountFromKeywords(content);
      const vagueEmailMarketingSignal = detectEmailMarketingFromKeywords(content);
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
            const summaryResult = await this.buildSummaryCard(meta);
            return {
              response: `Understood — I'll get ${personName}'s access removed urgently.\n\n${summaryResult.response}`,
              messageMeta: summaryResult.messageMeta,
            };
          }
          if (personName) {
            return { response: `Understood — I'll get ${personName}'s access removed urgently. Could you confirm their email address so I can get this raised?` };
          }
          const personEmail = meta.collectedFields.affectedPersonEmail;
          if (personEmail) {
            return { response: `Understood — I'll get ${personEmail} removed urgently. Could you confirm the name of the person to be removed?` };
          }
          return { response: `Understood — I'll get this raised urgently. Could you confirm their name and email address so I can get this raised?` };
        }
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening?` };
      }

      if (vagueEmailMarketingSignal.likely) {
        meta.category = 'email_marketing';
        meta.conversational = true;
        meta.subcategory = vagueEmailMarketingSignal.subcategory || 'email_campaign';
        meta.stage = 'detail';
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me a bit more about what's happening with the email marketing?` };
      }

      if (vagueWebsiteSignal.likely) {
        meta.category = 'website';
        meta.conversational = true;
        meta.subcategory = vagueWebsiteSignal.subcategory || 'website_content';
        meta.stage = 'detail';
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me a bit more — is something not displaying correctly, or do you need some content updated?` };
      }

      if (vaguePropertySignal.likely) {
        meta.category = 'property';
        meta.conversational = true;
        meta.subcategory = vaguePropertySignal.subcategory || 'property_visibility';
        meta.stage = 'detail';
        extractPropertyFieldsFromText(content, meta.collectedFields);
        const ack = d.acknowledgment || "Thanks for getting in touch.";
        return { response: `${ack}\n\nCould you tell me which property is affected and where you're seeing the issue?` };
      }

      // Genuinely unclassifiable — stay conversational, ask a broad clarifying question
      // instead of dropping to the category picker grid.
      meta.stage = 'detail';
      meta.conversational = true;
      meta.category = 'other';
      meta.subcategory = 'other_general';
      const isUrgentGeneral = /\b(urgent|urgently|asap|emergency|critical|down)\b/i.test(content);
      if (isUrgentGeneral) meta.collectedFields.urgency = meta.collectedFields.urgency || 'High';
      const prefix = isUrgentGeneral
        ? "I can see this is urgent — let me get this picked up quickly."
        : d.intent === 'change'
          ? "Thanks — I'll help you get that change request submitted."
          : d.intent === 'question'
            ? "I couldn't find a direct answer in our knowledge base, but let me help you get in touch with the right team."
            : "Sorry to hear you're having trouble — let me help you get this sorted.";

      return { response: `${prefix}\n\nCould you tell me a bit more about what's going on so I can point this in the right direction?` };
    } catch (err) {
      console.warn('[portal-chat] Conversational intake LLM call failed:', err instanceof Error ? err.message : err);
      return await this.handleIntentWithoutLlm(meta, content);
    }
  }

  private async handleIntentWithoutLlm(
    meta: IntakeSessionMetadata,
    content: string,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // H0 (no-LLM): Billing cancellation fast-track
    const billingDetectionNoLlm = detectBillingFromKeywords(content);
    if (billingDetectionNoLlm.likely) {
      meta.category = 'billing';
      meta.subcategory = billingDetectionNoLlm.subcategory || 'billing_cancel';
      meta.conversational = true;
      meta.stage = 'detail';
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
      return { response: "Understood — I'll get your cancellation request raised.\n\nWhich account is this for, and which product or service needs cancelling?" };
    }

    // F5: Escalation/chase detection — checked first so follow-up language
    // isn't swallowed by coincidental domain keywords.
    if (ESCALATION_CHASE_PATTERNS.test(content)) {
      meta.conversational = true;
      meta.stage = 'detail';
      meta.escalationDetected = true;
      meta.category = 'followup';
      meta.subcategory = 'followup_not_resolved';

      const refMatch = content.match(/\b(NT|NTPJ)-\d+\b/i);
      if (refMatch) {
        meta.followUpTicketKey = refMatch[0].toUpperCase();
        return { response: `I can see you're following up on **${meta.followUpTicketKey}** — sorry it's not been resolved yet.\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?` };
      }
      return { response: "I can see you've been in touch about this before — sorry it's not been resolved yet.\n\nCould you tell me a bit more about the issue you originally raised so I can get this picked up?" };
    }

    // Complaint / escalation intent — no-LLM fallback
    if (COMPLAINT_INTENT_PATTERNS.test(content)) {
      meta.conversational = true;
      meta.stage = 'detail';
      meta.category = 'complaint';
      meta.complaintDetected = true;
      meta.collectedFields.urgency = 'High';
      if (!meta.collectedFields.description) {
        meta.collectedFields.description = content;
      }
      extractAccountFieldsFromText(content, meta.collectedFields);

      if (/\b(escalat|needs? escalat|want.* escalat|please escalat)\b/i.test(content)) {
        meta.subcategory = 'complaint_escalate';
      } else if (/\b(waiting|response|replied|got back|no reply|haven'?t heard)\b/i.test(content)) {
        meta.subcategory = 'complaint_response';
      } else {
        meta.subcategory = 'complaint_service';
      }

      return { response: "I'm sorry to hear that — I want to make sure your complaint is properly recorded and dealt with.\n\nCould you tell me what happened and what outcome you're looking for?" };
    }

    // Deterministic email marketing detection (no-LLM fallback)
    const fallbackEmailDetect = detectEmailMarketingFromKeywords(content);
    if (fallbackEmailDetect.likely) {
      meta.category = 'email_marketing';
      meta.subcategory = fallbackEmailDetect.subcategory || 'email_campaign';
      meta.conversational = true;
      meta.stage = 'detail';
      const defaultMsg = meta.subcategory === 'email_template'
        ? "Thanks — I'll get your template request raised with our production team.\n\nWhich template is this for, and what changes do you need?"
        : "Thanks — I'll get this raised with our email marketing team.\n\nCould you tell me a bit more about what's happening?";
      return { response: defaultMsg };
    }

    // Deterministic letters detection (no-LLM fallback)
    // Guard: skip only when website signals dominate AND letters mention is incidental
    const lettersSignalNoLlm = detectLettersFromKeywords(content);
    const noLlmWebsiteWords = /\b(website|web site|our site|my site|the site|homepage|home page|web page|webpage)\b/i.test(content);
    const noLlmWebsiteIncidental = noLlmWebsiteWords && (() => {
      const lower = content.toLowerCase();
      const websiteActionPattern = /\b(update|change|fix|edit|amend|check|look at|review|redesign|rebuild)\s+(\w+\s+){0,4}(my |our |the )?(website|web site|site|homepage|home page|web page|webpage)\b/;
      const websiteComplaintPattern = /\b(website|web site|site|homepage|home page|web page|webpage)\s+(\w+\s+){0,3}(is|isn.?t|are|aren.?t|not|won.?t|can.?t|has|have|looks?|needs?|doesn.?t|don.?t|shows?|showing|displaying)\b/;
      return !(websiteActionPattern.test(lower) || websiteComplaintPattern.test(lower));
    })();
    if (lettersSignalNoLlm.likely && (!noLlmWebsiteWords || noLlmWebsiteIncidental)) {
      meta.category = 'letters';
      meta.subcategory = lettersSignalNoLlm.subcategory || 'letters_general';
      meta.conversational = true;
      meta.stage = 'detail';
      return { response: "Thanks — I'll get your correspondence request raised with our production team.\n\nCould you let me know which account this is for and any details about what you need?" };
    }

    // H1c (no-LLM): Data-removal / privacy fast-track
    if (DATA_REMOVAL_PATTERNS.test(content)) {
      meta.category = 'account';
      meta.subcategory = 'account_remove_user';
      meta.conversational = true;
      meta.stage = 'detail';
      extractAccountFieldsFromText(content, meta.collectedFields);
      extractDataRemovalContext(content, meta.collectedFields);
      if (!meta.collectedFields.description) meta.collectedFields.description = content;

      const email = meta.collectedFields.affectedPersonEmail;
      const account = meta.collectedFields.account;
      const ackParts: string[] = ["Understood — I'll get that removal sorted."];
      if (email) ackParts[0] = `Understood — I'll get ${email} removed.`;
      if (account && !isPlaceholderOrgName(account)) ackParts[0] = ackParts[0].replace(/\.$/, ` from the ${account} account.`);

      const missing: string[] = [];
      if (!email) missing.push('the email address to be removed');
      if (!account || isPlaceholderOrgName(account)) missing.push('which account this is for');
      if (missing.length === 0) {
        return await this.buildSummaryCard(meta);
      }
      return { response: `${ackParts[0]}\n\nCould you confirm ${missing.join(' and ')}?` };
    }

    // Check property first when portal indicators are present — avoids
    // website detection winning on messages like "not showing on Zoopla or our website"
    const propertyDetection = detectPropertyFromKeywords(content);
    if (propertyDetection.likely) {
      return await this.handlePropertyFallback(meta, content, propertyDetection);
    }

    // Account / access / office change detection (before website, to catch login/access)
    const accountDetection = detectAccountFromKeywords(content);
    if (accountDetection.likely) {
      // But check if website display is the actual complaint — website wins in that case
      const websiteCheck = detectWebsiteFromKeywords(content);
      if (websiteCheck.likely && /\b(website|web site|our site|the site|page|display|showing)\b/i.test(content) && /\b(wrong|incorrect|outdated|old|shows?|update|change)\b/i.test(content)) {
        // Website display complaint takes priority — fall through to website detection below
      } else {
        return await this.handleAccountFallback(meta, content, accountDetection);
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
          return await this.buildSummaryCard(meta);
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

    // Not recognisably a website or property request — stay conversational
    meta.intent = 'problem';
    meta.stage = 'detail';
    meta.conversational = true;
    meta.category = 'other';
    meta.subcategory = 'other_general';
    const isUrgentNoLlm = /\b(urgent|urgently|asap|emergency|critical|down)\b/i.test(content);
    if (isUrgentNoLlm) meta.collectedFields.urgency = meta.collectedFields.urgency || 'High';
    const noLlmPrefix = isUrgentNoLlm
      ? "I can see this is urgent — let me get this picked up quickly."
      : "Thanks for getting in touch.";
    return { response: `${noLlmPrefix} Could you tell me a bit more about what's going on so I can get this to the right team?` };
  }

  private async handlePropertyFallback(
    meta: IntakeSessionMetadata,
    content: string,
    detection: { likely: boolean; subcategory: string | null },
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    meta.intent = 'problem';
    meta.category = 'property';
    meta.conversational = true;
    meta.stage = 'detail';
    extractPropertyFieldsFromText(content, meta.collectedFields);

    if (detection.subcategory) {
      meta.subcategory = detection.subcategory;
      const missing = this.getPropertyMissingFields(meta.collectedFields, meta.subcategory);

      if (missing.length === 0) {
        return await this.buildSummaryCard(meta);
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

  private async handleAccountFallback(
    meta: IntakeSessionMetadata,
    content: string,
    detection: { likely: boolean; subcategory: string | null; securitySensitive: boolean },
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
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
        const summaryResult = await this.buildSummaryCard(meta);
        return {
          response: `Understood — I'll get ${personName}'s access removed urgently.\n\n${summaryResult.response}`,
          messageMeta: summaryResult.messageMeta,
        };
      }

      if (personName) {
        return { response: `Understood — I'll get ${personName}'s access removed urgently. Could you confirm their email address so I can get this raised?` };
      }
      if (personEmail) {
        return { response: `Understood — I'll get ${personEmail} removed urgently. Could you confirm the name of the person to be removed?` };
      }
      return { response: `Understood — I'll get this raised urgently. Could you confirm their name and email address so I can get this raised?` };
    }

    if (detection.subcategory) {
      meta.subcategory = detection.subcategory;
      const missing = this.getAccountMissingFields(meta.collectedFields, meta.subcategory);

      if (missing.length === 0) {
        return await this.buildSummaryCard(meta);
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
      meta.stage = 'detail';
      meta.conversational = true;
      meta.category = 'other';
      meta.subcategory = 'other_general';
      return { response: "I couldn't find your organisation's tickets. Would you like to raise a new request instead? If so, just describe what you need and I'll get it sorted." };
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
          const isFollowUp = ESCALATION_CHASE_PATTERNS.test(content);
          if (isFollowUp) {
            meta.followUpTicketKey = ticket.issue_key;
            meta.followUpTicketSummary = ticket.summary;
            meta.category = 'followup';
            meta.conversational = true;
            meta.stage = 'detail';

            const statusLower = ticket.status.toLowerCase();
            if (statusLower === 'resolved' || statusLower === 'closed') {
              meta.subcategory = 'followup_reopen';
            } else {
              meta.subcategory = 'followup_not_resolved';
            }

            return {
              response: `I can see your original request **${ticket.issue_key}** — "${ticket.summary}" (currently **${ticket.status}**).\n\nI'll raise a follow-up linked to that ticket so the team has full context. Could you let me know what still needs attention or what's changed since the original request?`,
            };
          }

          meta.stage = 'confirmed';
          return {
            response: `Here's the status of **${ticket.issue_key}**:\n\n- **Summary:** ${ticket.summary}\n- **Status:** ${ticket.status}\n- **Assignee:** ${ticket.assignee_display || 'Unassigned'}\n- **Last updated:** ${new Date(ticket.updated_at).toLocaleDateString()}\n\nYou can view full details in the "My Tickets" section. Is there anything else I can help with?`,
          };
        }
      } catch { /* fall through */ }

      // Cache miss but ticket ref present + chase language — still enter follow-up path
      if (ESCALATION_CHASE_PATTERNS.test(content)) {
        meta.followUpTicketKey = ticketKey;
        meta.category = 'followup';
        meta.conversational = true;
        meta.stage = 'detail';
        meta.subcategory = 'followup_not_resolved';
        meta.escalationDetected = true;
        return {
          response: `I can see you're following up on **${ticketKey}** — sorry it's not been resolved yet.\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?`,
        };
      }
    }

    // Follow-up without a ticket reference — enter follow-up path if chase language detected
    if (ESCALATION_CHASE_PATTERNS.test(content)) {
      meta.conversational = true;
      meta.stage = 'detail';
      meta.escalationDetected = true;
      meta.category = 'followup';
      meta.subcategory = 'followup_not_resolved';
      return { response: "I can see you've been in touch about this before — sorry it's not been resolved yet.\n\nCould you let me know the ticket reference or describe the original issue so I can link this follow-up?" };
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

    meta.stage = 'detail';
    meta.conversational = true;
    meta.category = 'other';
    meta.subcategory = 'other_general';
    return { response: "I couldn't find any recent tickets for your organisation. Would you like to raise a new request? Just describe what you need and I'll take it from there." };
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

    // Fallback: if conversational, stay conversational rather than re-showing the picker
    if (meta.conversational) {
      meta.stage = 'detail';
      meta.subcategory = meta.subcategory || 'other_general';
      return { response: "No problem — could you describe what's happening in a bit more detail? That'll help me make sure it gets to the right team." };
    }
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

    // In conversational mode, ask naturally instead of showing a picker grid
    if (meta.conversational) {
      meta.subcategory = subs[0]?.[0] || `${catId}_general`;
      meta.stage = 'detail';
      return { response: 'Could you tell me a bit more about what you need so I can make sure this gets to the right person?' };
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
    // Bare-affirmative handoff confirmation: if the last assistant message offered
    // a handoff and the user replied with a short "yes"/"ok"/etc., route to the
    // summary card rather than treating it as a detail-gathering response.
    if (isAffirmativeResponse(content) && content.trim().length < 30) {
      const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
      if (lastAssistant && /\bwould you like me to create a (?:support )?ticket\b/i.test(lastAssistant.content)) {
        console.log(`[portal-chat] session=${sessionId} detail-stage bare-affirmative handoff confirmation`);
        meta.offeredTicketCreation = false;
        return await this.buildSummaryCard(meta);
      }
    }

    // Early ticket-request interception: if the customer asks to create/raise a ticket
    // before summary has been shown, extract any new fields then show the summary
    // for review instead of bypassing straight to submission.
    const TICKET_REQUEST = /\b(raise|create|submit|log|open|just\s+(raise|create|log))\s+(a\s+)?(support\s+)?(ticket|request|case|issue)\b/i;
    if (TICKET_REQUEST.test(content) && meta.stage !== 'summary') {
      // Extract any details bundled in the same message
      await this.extractFields(meta, content);
      const url = extractUrlFromText(content);
      if (url && !meta.collectedFields.url) meta.collectedFields.url = url;
      await this.synthesizeSummaryFields(meta);
      return await this.buildSummaryCard(meta);
    }

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
        return await this.buildSummaryCard(meta);
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
        meta.offeredTicketCreation = true;
        return {
          response: "I think this one's best handled by the team directly. Shall I raise a ticket for you?",
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

    // Silent reclassification: when initially unclassifiable (category=other),
    // use the follow-up message to refine the category without exposing taxonomy.
    if (meta.category === 'other' && meta.conversational) {
      const fullText = meta.openingMessage ? `${meta.openingMessage} ${content}` : content;
      const propSig = detectPropertyFromKeywords(fullText);
      const accSig = detectAccountFromKeywords(fullText);
      const webSig = detectWebsiteFromKeywords(fullText);

      if (propSig.likely) {
        meta.category = 'property';
        meta.subcategory = propSig.subcategory || 'property_visibility';
        extractPropertyFieldsFromText(content, meta.collectedFields);
      } else if (accSig.likely) {
        meta.category = 'account';
        meta.subcategory = accSig.subcategory || 'account_login';
        extractAccountFieldsFromText(content, meta.collectedFields);
        if (accSig.securitySensitive) {
          meta.securitySensitive = true;
          meta.collectedFields.urgency = 'High';
        }
      } else if (webSig.likely) {
        meta.category = 'website';
        meta.subcategory = webSig.subcategory || 'website_content';
      }
    }

    // Correction detection: if the user is correcting previously provided details,
    // overwrite stale structured fields before normal extraction runs
    if (containsCorrection(content)) {
      refreshStructuredFieldsFromCorrection(content, meta.collectedFields);
      // Force description re-synthesis so the summary reflects corrections
      meta.synthesisDone = false;
      meta.synthesizedDescription = undefined;
    }

    // Extract fields from the user's message
    await this.extractFields(meta, content);

    // Short-answer name fallback: if we just asked for a person's name and the user
    // replied with a short proper-name answer, accept it directly.
    if (!meta.collectedFields.affectedPersonName &&
        (meta.subcategory === 'account_remove_user' || meta.subcategory === 'account_new_user') &&
        content.trim().length <= 60) {
      const nameCandidate = content.trim().replace(/^(it'?s|they'?re|their name is|his name is|her name is|the name is|name is|name:?|the person is|the user is|user:?|person:?|called|the employee is)\s+/i, '').replace(/[.,!?]+$/, '').trim();
      if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(nameCandidate)) {
        meta.collectedFields.affectedPersonName = nameCandidate;
      } else if (/^[a-z]{2,}(?:\s+[a-z]{2,}){1,2}$/.test(nameCandidate) &&
                 !/\b(the|and|for|not|can|was|has|but|are|get|all|new|yes|our|you|its|his|her|who|how|why)\b/.test(nameCandidate)) {
        const titleCased = nameCandidate.replace(/\b[a-z]/g, c => c.toUpperCase());
        meta.collectedFields.affectedPersonName = titleCased;
      }
    }

    // Multi-turn recovery: if key fields are still missing, re-extract from the full
    // accumulated description which contains all user messages so far.
    const fullDesc = meta.collectedFields.description;
    if (fullDesc && fullDesc !== content) {
      if (!meta.collectedFields.account) this.extractFieldsRegex(meta, fullDesc);
      if (meta.category === 'property') extractPropertyFieldsFromText(fullDesc, meta.collectedFields);
      if (meta.category === 'account') extractAccountFieldsFromText(fullDesc, meta.collectedFields);
    }

    // Short-answer fallback: if account is still missing and the response is a short
    // direct answer (likely replying to "which account?"), treat it as the account name.
    // Reject text that looks like a complaint/description rather than an account name.
    // Guards: don't capture when the vague gate is active (user is describing their
    // problem), and don't capture text that matches already-extracted field values.
    const justAskedVagueGate = meta.vagueGateAsked && !meta.vagueGateVerified;
    const f = meta.collectedFields;
    if (!f.account && content.length <= 60 && !justAskedVagueGate) {
      const trimmed = content.replace(/^(it'?s\s+|the\s+|we'?re\s+|i'?m\s+(with|at|from)\s+)/i, '').trim();
      const isConversational = /\b(something|wrong|broken|not working|can'?t|won'?t|issue|problem|help|need|please|trouble|having|showing|display|error|missing|page|update|change|fix|login|password|access|photo|image|listing|website|rightmove|zoopla|onthemarket|on the market|primelocation|prime location|portal|portals|our site|the site|my site|both|all of them|everywhere)\b/i.test(trimmed);
      const matchesOtherField = !!(
        (f.affectedPortals && f.affectedPortals.toLowerCase().includes(trimmed.toLowerCase())) ||
        (f.propertyAddress && f.propertyAddress.toLowerCase() === trimmed.toLowerCase()) ||
        (f.officeBranch && f.officeBranch.toLowerCase() === trimmed.toLowerCase()) ||
        (f.affectedPersonName && f.affectedPersonName.toLowerCase() === trimmed.toLowerCase())
      );
      if (trimmed.length >= 2 && !isConversational && !matchesOtherField && isLikelyAccountName(trimmed) && !/^(yes|no|yeah|nope|ok|sure|please|thanks?|hi|hello)\b/i.test(trimmed)) {
        const cleaned = cleanAccountName(trimmed);
        if (cleaned) f.account = cleaned;
      }
    }

    // Explicit account mention in longer messages — "the account is X", "account name is X", "we're X"
    if (!f.account && content.length > 60 && !justAskedVagueGate) {
      const explicitAccountPatterns = [
        /\b(?:the\s+)?account\s+(?:name\s+)?(?:is|for)\s+["']?([A-Za-z][A-Za-z0-9 &'.-]{2,40})["']?/i,
        /\b(?:we(?:'re| are)|i(?:'m| am) (?:with|at|from))\s+([A-Za-z][A-Za-z0-9 &'.-]{2,40})\b/i,
        /\b(?:it'?s|this is)\s+(?:for\s+)?([A-Za-z][A-Za-z0-9 &'.-]{2,40})\s+(?:account|branch|office)\b/i,
      ];
      for (const pat of explicitAccountPatterns) {
        const m = content.match(pat);
        if (m) {
          const candidate = m[1].trim();
          if (isLikelyAccountName(candidate)) {
            const cleaned = cleanAccountName(candidate);
            if (cleaned) { f.account = cleaned; break; }
          }
        }
      }
    }

    // Follow-up ticket reference hydration: if the session is in follow-up mode
    // and the user just provided a ticket reference, hydrate it now.
    if (meta.category === 'followup' && !meta.followUpTicketKey) {
      const refMatch = content.match(/\b(NT|NTPJ)-\d+\b/i);
      if (refMatch) {
        const refKey = refMatch[0].toUpperCase();
        meta.followUpTicketKey = refKey;
        const domain = await this.portalJira.getOrgEmailDomain(context.orgId);
        if (domain) {
          try {
            const refTicket = await queryOne<{ issue_key: string; summary: string; status: string }>(
              `SELECT issue_key, summary, status FROM jira_issue_cache WHERE issue_key = ? AND reporter_email LIKE ?`,
              [refKey, `%@${domain}`],
            );
            if (refTicket) {
              meta.followUpTicketKey = refTicket.issue_key;
              meta.followUpTicketSummary = refTicket.summary;
              const statusLower = refTicket.status.toLowerCase();
              if (statusLower === 'resolved' || statusLower === 'closed') {
                meta.subcategory = 'followup_reopen';
              }
              return {
                response: `I've found your original request **${refTicket.issue_key}** — "${refTicket.summary}" (currently **${refTicket.status}**).\n\nI'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?`,
              };
            }
          } catch { /* fall through — key is still set */ }
        }
        return {
          response: `I've noted your reference **${refKey}**. I'll raise a follow-up linked to that ticket. Could you let me know what still needs attention?`,
        };
      }
    }

    // Vague-journey problem gate: if description exists but lacks actionable detail,
    // ask what's actually wrong before gathering account/URL/etc.
    // Phase 1: initial gate. Phase 2: re-check the follow-up itself.
    // Complaint sessions skip the vague gate — the complaint intent itself is the
    // actionable detail, and generic "what specifically?" wording undermines the
    // complaint-aware path the customer is already on.
    if (meta.conversational && !meta.complaintDetected) {
      if (!meta.vagueGateAsked) {
        if (descriptionLacksActionableDetail(meta.collectedFields.description)) {
          meta.vagueGateAsked = true;
          return {
            response: "Could you give me a bit more detail on what's happening — is something not working as expected, or is there something you need changed?",
          };
        }
      } else if (!meta.vagueGateVerified) {
        // The vague gate was asked — now verify the follow-up contains a concrete problem.
        // Stricter than the initial check: require an actual problem/action indicator,
        // not just a domain noun. "it's about our website" is not enough;
        // "the phone number on our website is wrong" is.
        if (followUpLacksConcreteProblem(content)) {
          meta.vagueGateVerified = true;
          meta.vagueGateSecondAsked = true;
          return {
            response: "No problem — to make sure I pass this on correctly, could you describe what's going wrong or what needs to change? For example, is something missing, showing incorrectly, or not working?",
          };
        }
        meta.vagueGateVerified = true;
      } else if (meta.vagueGateSecondAsked) {
        meta.vagueGateSecondAsked = false;
        // Verify the response to the second question actually contains a concrete problem.
        // If still vague, append what they said but continue — three questions would be frustrating.
        if (followUpLacksConcreteProblem(content)) {
          console.log(`[portal-chat] Vague gate: response to second question still lacks concrete problem, continuing with what we have`);
        }
      }
    }

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

    // Track clarification rounds — if extraction isn't making progress, stop looping
    const prevMissing = meta.lastMissingCount ?? missing.length + 1;
    meta.detailRounds = (meta.detailRounds || 0) + 1;
    meta.lastMissingCount = missing.length;

    const maxDetailRounds = 3;
    if (meta.detailRounds >= maxDetailRounds && missing.length >= prevMissing) {
      // Extraction stalled — progress to summary with what we have
      console.log(`[portal-chat] Detail stage stalled after ${meta.detailRounds} rounds with ${missing.length} fields still missing — progressing to summary`);
      return this.tryKbDeflection(meta, context, sessionId);
    }

    // Reset round counter when extraction makes progress
    if (missing.length < prevMissing) {
      meta.detailRounds = 0;
    }

    // Portal/channel clarification loop prevention: if we've already asked about
    // affectedPortals once and the customer's response didn't resolve it, don't
    // block progress — default to 'Website' if a URL exists, otherwise skip the field.
    if (missing[0] === 'affectedPortals' && meta.portalClarificationAsked) {
      console.log(`[portal-chat] Portal clarification already asked — defaulting and progressing`);
      meta.collectedFields.affectedPortals = 'Website';
      const remainingMissing = missing.filter(f => f !== 'affectedPortals');
      if (remainingMissing.length === 0) {
        return this.tryKbDeflection(meta, context, sessionId);
      }
      // Continue with next missing field below using remainingMissing[0]
      missing.splice(0, 1);
    }

    // Track portal clarification — set flag when we're about to ask
    if (missing[0] === 'affectedPortals') {
      meta.portalClarificationAsked = true;
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
      if (data.account && !meta.collectedFields.account && isLikelyAccountName(data.account)) { const cleaned = cleanAccountName(data.account); if (cleaned) meta.collectedFields.account = cleaned; }
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
        // Description grew — force re-synthesis so new detail is reflected in summary
        if (meta.synthesisDone) {
          meta.synthesisDone = false;
          meta.synthesizedDescription = undefined;
        }
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

    // Account/brand name — multiple patterns for natural phrasing
    // Use non-greedy match and stop before common problem/conversational words
    if (!f.account) {
      // High-confidence: company names with estate agent suffixes
      // Each word must be capitalized to avoid matching whole sentences
      const companyRe = /\b((?:[A-Z][a-z]+|[A-Z]&[A-Z]|[A-Z]{2,})(?:\s+(?:&\s+)?(?:[A-Z][a-z]+|[A-Z]&[A-Z]|[A-Z]{2,})){0,4}\s+(?:Estate\s+Agents?|Estates?|Properties|Lettings|Homes?|Realty|Group|Ltd|Limited|Associates|Partners))\b/;
      const companyMatch = content.match(companyRe);
      if (companyMatch) {
        const candidate = companyMatch[1].trim();
        if (isLikelyAccountName(candidate)) {
          const cleaned = cleanAccountName(candidate);
          if (cleaned) f.account = cleaned;
        }
      }
    }
    if (!f.account) {
      const ACCOUNT_STOP = /\s+(?:is|are|has|have|was|were|not|but|and|who|which|where|that|having|isn'?t|aren'?t|can'?t|won'?t|doesn'?t|don'?t|need|broken|down|website|site|page|portal|system|platform|the|photos?|images?|listings?|login|password|access|keeps?|shows?|display|error|problem|issue|when|because|since|however|also|their|our|my|its?)\b/i;
      const accountPatterns = [
        /\b(?:for|account(?:\s+name)?[:：]?\s+)([A-Za-z][A-Za-z0-9 &'.-]{2,40})\b/i,
        /\b([A-Za-z][A-Za-z0-9 &'.-]{2,40})\s+account\b/i,
        /\b(?:it'?s|this is|we'?re|i'?m (?:with|at|from))\s+([A-Za-z][A-Za-z0-9 &'.-]{2,40})\b/i,
        /\baccount\s+(?:is|called)\s+([A-Za-z0-9 &'.-]{2,40})\b/i,
      ];
      for (const pat of accountPatterns) {
        const m = content.match(pat);
        if (m && !/\b(the|this|that|my|our|a|an|it)\b/i.test(m[1].trim())) {
          let captured = m[1].trim();
          const stopMatch = captured.match(ACCOUNT_STOP);
          if (stopMatch) captured = captured.slice(0, stopMatch.index!).trim();
          // Stop at URL boundaries — don't let domain names leak into account name
          const urlBoundary = captured.match(/\s+(https?:\/\/|www\.|\S+\.(?:co\.uk|com|org|net|agency|io|uk))/i);
          if (urlBoundary) captured = captured.slice(0, urlBoundary.index!).trim();
          if (captured.length >= 2) {
            const cleaned = cleanAccountName(captured);
            if (cleaned) { f.account = cleaned; break; }
          }
        }
      }
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

    const missing = this.getMissingFields(meta.collectedFields, config);

    if (meta.conversational) {
      if (missing.length === 0) {
        return "Thanks — I think I have everything I need. Let me put together a summary for you.";
      }
      const firstQ = this.buildConversationalQuestion(missing[0], meta);
      return `Thanks for that. ${firstQ}`;
    }

    if (missing.length === 0) {
      return "Got it — I think I have everything I need. Let me put together a summary for you.";
    }

    const firstQ = this.buildDetailQuestion(missing[0], config);
    return `Got it. ${firstQ}`;
  }

  // ── Stage 4: KB Deflection ──

  private async tryKbDeflection(
    meta: IntakeSessionMetadata,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    if (meta.kbSuggested) {
      return await this.buildSummaryCard(meta);
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
        const subj = meta.collectedFields.subject;
        const kbIntro = subj
          ? `Before I raise a ticket about "${subj}", I found an article that might help:`
          : 'Before I create a ticket, I found an article that might help:';
        return {
          response: kbIntro,
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

    await this.synthesizeSummaryFields(meta);
    return await this.buildSummaryCard(meta);
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
    await this.synthesizeSummaryFields(meta);
    return await this.buildSummaryCard(meta);
  }

  // ── Stage 5: Summary Card ──

  private async buildSummaryCard(meta: IntakeSessionMetadata): Promise<{ response: string; messageMeta: ChatMessageMetadata }> {
    meta.stage = 'summary';

    await this.synthesizeSummaryFields(meta);

    // Auto-generate subject if missing
    if (!meta.collectedFields.subject) {
      if (meta.synthesizedSubject) {
        // Prefer LLM-synthesized subject
        const subName = SUBCATEGORY_NAMES[meta.subcategory || ''];
        if (subName) {
          meta.collectedFields.subject = `[Portal] ${subName} — ${meta.synthesizedSubject}`.slice(0, 250);
        } else {
          meta.collectedFields.subject = `[Portal] ${meta.synthesizedSubject}`.slice(0, 250);
        }
      } else {
        const rawDesc = meta.collectedFields.description || '';
        const cleanedDesc = stripGreeting(rawDesc);
        if (meta.conversational && cleanedDesc) {
          const sentences = cleanedDesc.split(/[\n]/).map(s => s.trim()).filter(s => s.length > 10);
          const VAGUE_OPENER = /^(i('m|\s+am)\s+(having|experiencing)|we('re|\s+are)\s+(having|experiencing)|there('s|\s+is)\s+(an?|some)|i\s+have\s+(an?|some)|we\s+have\s+(an?|some)|i'?ve\s+got|we'?ve\s+got|something\s+is|i\s+need\s+help|can\s+you\s+help|i\s+need\s+some\s+help|hi\s+i\s+need)\b/i;
          const CONVERSATIONAL_FRAG = /^(yes|no|yeah|yep|nope|ok|okay|sure|thanks?|thank you|please|hi|hello|hey|cheers|great|perfect|that'?s?\s+(it|correct|right|the one))[\s.,!]*$/i;
          const issueSentence = sentences.find(s =>
            !VAGUE_OPENER.test(s) &&
            !CONVERSATIONAL_FRAG.test(s) &&
            s.length > 15 &&
            (s.length > 40 || /\b(error|broken|not working|missing|wrong|incorrect|can'?t|won'?t|update|change|remove|add|showing|display|page|photo|image|listing|property|login|password)\b/i.test(s))
          ) || sentences.find(s => !VAGUE_OPENER.test(s) && s.length > 15) || sentences[0] || cleanedDesc.slice(0, 120);
          let subjectBody = issueSentence;
          const clauseBreak = subjectBody.match(/^(.{20,80}?)[.,;!?\-—]\s/);
          if (clauseBreak && subjectBody.length > 100) {
            subjectBody = clauseBreak[1];
          }
          if (subjectBody.length > 100) subjectBody = subjectBody.slice(0, 97) + '...';
          const subName = SUBCATEGORY_NAMES[meta.subcategory || ''];
          if (subName) {
            const maxBodyLen = 250 - `[Portal] ${subName} — `.length;
            const truncBody = subjectBody.length > maxBodyLen ? subjectBody.slice(0, maxBodyLen - 3) + '...' : subjectBody;
            meta.collectedFields.subject = `[Portal] ${subName} — ${truncBody}`;
          } else {
            meta.collectedFields.subject = `[Portal] ${subjectBody}`.slice(0, 250);
          }
        } else {
          const catName = CATEGORY_NAMES[meta.category || ''] || 'Support';
          const subName = SUBCATEGORY_NAMES[meta.subcategory || ''];
          const descSnippet = cleanedDesc.slice(0, 120);
          meta.collectedFields.subject = subName
            ? `[Portal] ${catName} — ${subName}: ${descSnippet}`.slice(0, 250)
            : `[Portal] ${catName}: ${descSnippet}`.slice(0, 250);
        }
      }
    }

    const f = meta.collectedFields;
    const messageMeta: ChatMessageMetadata = {
      type: 'summary_card',
      fields: {
        ...f,
        description: meta.synthesizedDescription || f.description,
        category: meta.category,
        subcategory: meta.subcategory,
        followUpTicketKey: meta.followUpTicketKey || undefined,
        followUpTicketSummary: meta.followUpTicketSummary || undefined,
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
    if (meta.followUpTicketKey) lines.push(`**Related ticket:** ${meta.followUpTicketKey}${meta.followUpTicketSummary ? ` — ${meta.followUpTicketSummary}` : ''}`);
    if (f.account && !isPlaceholderOrgName(f.account)) lines.push(`**Account:** ${f.account}`);
    if (f.propertyAddress) lines.push(`**Property:** ${f.propertyAddress}`);
    if (f.listingId) lines.push(`**Listing ref:** ${f.listingId}`);
    if (f.affectedPortals) lines.push(`**Affected:** ${f.affectedPortals}`);
    if (f.affectedPersonName) lines.push(`**Person:** ${f.affectedPersonName}`);
    if (f.affectedPersonEmail) lines.push(`**Person's email:** ${f.affectedPersonEmail}`);
    if (f.officeBranch) lines.push(`**Office/branch:** ${f.officeBranch}`);
    if (f.description) {
      if (meta.synthesizedDescription) {
        lines.push(`**Description:** ${meta.synthesizedDescription}`);
      } else {
        // Fallback: clean up multi-turn transcript noise
        const descLines = stripGreeting(f.description).split('\n').filter(line => {
          const t = line.trim();
          if (t.length < 3) return false;
          if (/^(yes|no|yeah|yep|nope|ok|okay|sure|thanks?|thank you|that'?s? (it|correct|right|the one)|please|hi|hello|hey|cheers|great|perfect)[\s.,!]*$/i.test(t)) return false;
          const tLower = t.toLowerCase();
          if (f.account && (tLower === f.account.toLowerCase() || tLower === `the account is ${f.account.toLowerCase()}` || tLower === f.account.toLowerCase() + '.')) return false;
          if (f.affectedPersonEmail && tLower.includes(f.affectedPersonEmail.toLowerCase()) && t.length < f.affectedPersonEmail.length + 20) return false;
          if (f.browser && tLower === f.browser.toLowerCase()) return false;
          if (f.url && (t === f.url || tLower === f.url.toLowerCase())) return false;
          if (f.affectedPersonName && (tLower === f.affectedPersonName.toLowerCase() || tLower === f.affectedPersonName.toLowerCase() + '.')) return false;
          if (f.officeBranch && (tLower === f.officeBranch.toLowerCase() || tLower === `the ${f.officeBranch.toLowerCase()} office`)) return false;
          if (t.length < 20 && !/\b(error|broken|wrong|missing|not|can'?t|won'?t|need|update|change|issue|problem|showing|display|locked|expired)\b/i.test(t)) return false;
          return true;
        });
        const seen = new Set<string>();
        const dedupedLines = descLines.filter(line => {
          const key = line.trim().toLowerCase().replace(/[.,!?\s]+/g, ' ');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        // Join filtered lines into prose instead of preserving transcript line breaks
        const cleanDesc = dedupedLines.map(l => {
          const t = l.trim();
          // Ensure each segment ends with punctuation for readability
          return /[.!?]$/.test(t) ? t : `${t}.`;
        }).join(' ').replace(/\.\s*\./g, '.').replace(/\s{2,}/g, ' ').trim();
        if (cleanDesc) lines.push(`**Description:** ${cleanDesc}`);
      }
    }
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

  // ── Summary Synthesis ──

  private async synthesizeSummaryFields(meta: IntakeSessionMetadata): Promise<void> {
    if (meta.synthesisDone) return;
    if (!this.llm) return;
    const rawDesc = meta.collectedFields.description;
    if (!rawDesc) return;

    const isMultiTurn = rawDesc.includes('\n');
    const isLong = rawDesc.length > 80;
    const hasConversationalNoise = meta.conversational && /\b(yes|yeah|no|ok|sure|thanks|hi|hello|hey)\b/i.test(rawDesc);
    const hasGreeting = meta.conversational && /^(hi|hello|hey|howdy|good (morning|afternoon|evening))[\s,.!\-]/i.test(rawDesc);
    if (!isMultiTurn && !isLong && !hasConversationalNoise && !hasGreeting) { meta.synthesisDone = true; return; }

    try {
      const subName = SUBCATEGORY_NAMES[meta.subcategory || ''] || CATEGORY_NAMES[meta.category || ''] || 'Support';
      const contextParts: string[] = [`Request type: ${subName}`];
      if (meta.collectedFields.account) contextParts.push(`Account: ${meta.collectedFields.account}`);
      if (meta.collectedFields.propertyAddress) contextParts.push(`Property: ${meta.collectedFields.propertyAddress}`);
      if (meta.collectedFields.listingId) contextParts.push(`Listing ref: ${meta.collectedFields.listingId}`);
      if (meta.collectedFields.url) contextParts.push(`URL: ${meta.collectedFields.url}`);
      if (meta.collectedFields.errorMessage) contextParts.push(`Error: ${meta.collectedFields.errorMessage}`);
      if (meta.collectedFields.affectedPersonName) contextParts.push(`Person: ${meta.collectedFields.affectedPersonName}`);
      if (meta.collectedFields.affectedPersonEmail) contextParts.push(`Email: ${meta.collectedFields.affectedPersonEmail}`);

      const complaintNote = meta.complaintDetected
        ? '\n\nThis is a COMPLAINT. The subject should reflect the complaint nature (e.g. "Complaint: repeated login failures not resolved"). The description should preserve the customer\'s dissatisfaction context and desired outcome.'
        : '';

      const result = await this.llm.call(
        `Summarise a customer support conversation into a clean ticket.

Generate:
1. SUBJECT: Concise ticket subject (max 80 chars). Describe the specific issue, not the emotion or greeting. Bad: "Having trouble with website". Good: "Phone number incorrect on contact page". Do NOT include any prefix like "[Portal]".
2. DESCRIPTION: 1-3 sentence prose summary for a support agent. State what is wrong, what is affected, and include specific details (addresses, phone numbers, names, URLs, error messages) verbatim. No greetings, pleasantries, conversational filler, or "the customer said" framing. Write as a direct problem statement.${complaintNote}

${contextParts.join('\n')}`,
        rawDesc,
        SummarySynthesisSchema,
        { callType: 'portal_chat', tier: 'standard', maxTokens: 300, temperature: 0.2 },
      );

      if (result.data.subject && result.data.subject.length > 5) {
        meta.synthesizedSubject = result.data.subject;
      }
      if (result.data.description && result.data.description.length > 10) {
        meta.synthesizedDescription = result.data.description;
      }
      meta.synthesisDone = true;
    } catch (err) {
      console.warn('[portal-chat] Summary synthesis failed:', err instanceof Error ? err.message : err);
      if (!meta.synthesisRetried) {
        meta.synthesisRetried = true;
      } else {
        meta.synthesisDone = true;
      }
    }
  }

  // ── Stage 5b: Summary Edit ──

  private async handleSummaryEdit(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    const f = meta.collectedFields;
    let anyApplied = false;

    // Correction detection: overwrite stale structured fields when correction language is present
    if (containsCorrection(content)) {
      refreshStructuredFieldsFromCorrection(content, f);
      meta.synthesisDone = false;
      meta.synthesizedDescription = undefined;
    }

    // Split multi-field edit messages into segments so each field is processed independently.
    // "change the subject to X and the account to Y" → ["change the subject to X", "the account to Y"]
    const EDIT_SPLIT = /\s*(?:,\s*(?:and\s+)?|\s+and\s+)(?=(?:(?:(?:change|update|set|correct|make)\s+)?(?:the\s+)?|also\s+)(?:subject|account|description|urgency|person|name|email|url|contact)\b|(?:mark\s+(?:it|this)\s+(?:as\s+)?|(?:this|it)\s+(?:is|should\s+be)\s+)(?:urgent|high|critical|normal)\b)/i;
    const segments = content.split(EDIT_SPLIT).map(s => s.replace(/^(and\s+)?(also,?\s+)?/i, '').trim()).filter(s => s.length > 0);

    for (const segment of segments) {
      let segmentApplied = false;

      const subjectMatch = segment.match(/(?:change|update|set|correct)\s+(?:the\s+)?subject\s+(?:to|should be)\s+["']?(.+?)["']?\s*$/i)
        || segment.match(/(?:the\s+)?subject\s+(?:should|needs to)\s+(?:be|say)\s+["']?(.+?)["']?\s*$/i);
      if (subjectMatch) { f.subject = cleanEditValue(cleanFieldBoundary(subjectMatch[1].trim())); meta.synthesizedSubject = undefined; segmentApplied = true; }

      if (!segmentApplied) {
        const accountMatch = segment.match(/(?:change|update|set|correct)\s+(?:the\s+)?account\s+(?:to|should be)\s+["']?(.+?)["']?\s*$/i)
          || segment.match(/(?:the\s+)?account\s+(?:should|needs to|is actually)\s+(?:be|say)?\s*["']?(.+?)["']?\s*$/i)
          || segment.match(/(?:actually,?\s+)?(?:the\s+)?account\s+(?:is|name is)\s+["']?(.+?)["']?\s*$/i);
        if (accountMatch) { const cleaned = cleanAccountName(cleanFieldBoundary(accountMatch[1].trim())); if (cleaned) { f.account = cleaned; segmentApplied = true; } }
      }

      if (!segmentApplied) {
        const descMatch = segment.match(/(?:change|update|set|correct)\s+(?:the\s+)?description\s+(?:to\s+(?:say\s+)?|should\s+(?:be|say)\s+)["']?(.+?)["']?\s*$/i)
          || segment.match(/(?:the\s+)?description\s+(?:should|needs to)\s+(?:be|say)\s+["']?(.+?)["']?\s*$/i);
        if (descMatch) { f.description = cleanEditValue(cleanFieldBoundary(descMatch[1].trim())); meta.synthesizedDescription = undefined; meta.synthesisDone = false; segmentApplied = true; }
      }

      if (!segmentApplied) {
        const urgencyMatch = segment.match(/(?:change|set|update|make)\s+(?:the\s+)?urgency\s+(?:to\s+)?(normal|high|critical)/i)
          || segment.match(/(?:this\s+is|it'?s|mark(?:\s+(?:it|this))?(?:\s+as)?)\s+(urgent|high|critical)/i);
        if (urgencyMatch) {
          const val = urgencyMatch[1].toLowerCase();
          f.urgency = val === 'critical' ? 'Critical' : val === 'high' || val === 'urgent' ? 'High' : 'Normal';
          segmentApplied = true;
        }
      }

      if (!segmentApplied) {
        const personNameMatch = segment.match(/(?:change|update|correct)\s+(?:the\s+)?(?:person|name)\s+(?:to|should be)\s+["']?(.+?)["']?\s*$/i)
          || segment.match(/(?:the\s+)?(?:person'?s?\s+)?name\s+(?:should|is actually|is)\s+["']?(.+?)["']?\s*$/i);
        if (personNameMatch) { f.affectedPersonName = cleanFieldBoundary(personNameMatch[1].trim()); segmentApplied = true; }
      }

      if (!segmentApplied) {
        const personEmailMatch = segment.match(/(?:change|update|correct)\s+(?:the\s+)?(?:person'?s?\s+)?email\s+(?:to|should be)\s+["']?(.+?)["']?\s*$/i)
          || segment.match(/(?:the\s+)?email\s+(?:should|is actually|is)\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
        if (personEmailMatch) { f.affectedPersonEmail = personEmailMatch[1].trim(); segmentApplied = true; }
      }

      if (segmentApplied) anyApplied = true;
    }

    // If no regex matched any segment, try LLM extraction with multi-field awareness
    if (!anyApplied) {
      if (this.llm) {
        try {
          const result = await this.llm.call(
            `The customer is editing their support request summary. They may be changing ONE or MULTIPLE fields at once. Extract ALL field values they want to change. Only include fields they explicitly mention updating.\nStrip filler words from values — e.g. "just be", "should be", "needs to be", "simply" — return only the actual content.\nReturn JSON with only the changed fields.`,
            content,
            FieldExtractSchema,
            { callType: 'portal_chat', tier: 'standard', maxTokens: 400, temperature: 0.1 },
          );
          const d = result.data;
          if (d.subject) { f.subject = cleanEditValue(d.subject); meta.synthesizedSubject = undefined; }
          if (d.account) { const cleaned = cleanAccountName(d.account); if (cleaned) f.account = cleaned; }
          if (d.description) { f.description = cleanEditValue(d.description); meta.synthesizedDescription = undefined; meta.synthesisDone = false; }
          if (d.url) f.url = d.url;
          if (d.errorMessage) f.errorMessage = d.errorMessage;
          if (d.browser) f.browser = d.browser;
          if (d.os) f.os = d.os;
          if (d.urgency) f.urgency = d.urgency;
          if (d.contactPreference) f.contactPreference = d.contactPreference;
        } catch (err) {
          console.warn('[portal-chat] Summary edit extraction failed:', err instanceof Error ? err.message : err);
        }
      }
      const url = extractUrlFromText(content);
      if (url) f.url = url;
      extractAccountFieldsFromText(content, f);
      extractPropertyFieldsFromText(content, f);
    }

    return await this.buildSummaryCard(meta);
  }

  // ── Stage 6: Confirmation (called from route, not from sendMessage) ──

  async confirmAndSubmit(
    sessionId: number,
    fields: Partial<IntakeCollectedFields> & { category?: string; subcategory?: string },
    context: ChatContext,
    options?: { skipMessage?: boolean },
  ): Promise<{ ticketKey: string }> {
    const session = await queryOne<{ metadata: string | null }>(
      `SELECT metadata FROM portal_chat_sessions WHERE id = ?`,
      [sessionId],
    );
    const meta = parseMetadata(session?.metadata ?? null);

    // Merge any edits from the summary card
    if (fields.subject !== undefined) meta.collectedFields.subject = fields.subject;
    if (fields.account !== undefined) meta.collectedFields.account = fields.account ? cleanAccountName(fields.account) : fields.account;
    if (fields.description !== undefined) {
      meta.collectedFields.description = fields.description;
      // Customer explicitly edited description — their version is canonical
      meta.synthesizedDescription = undefined;
    }
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

    // Prepend follow-up reference to description so agents see the link
    let baseDescription = meta.synthesizedDescription || f.description || 'See chat transcript';
    if (meta.followUpTicketKey) {
      baseDescription = `Follow-up to ${meta.followUpTicketKey}${meta.followUpTicketSummary ? ` ("${meta.followUpTicketSummary}")` : ''}.\n\n${baseDescription}`;
    }

    // Use intake service if available, otherwise create directly
    let ticketKey: string;

    if (this.intakeService) {
      const result = await this.intakeService.submitTicket(
        {
          subject: f.subject || `[Portal] Support request from ${context.userName}`,
          category: meta.category || 'other',
          subcategory: meta.subcategory || undefined,
          description: baseDescription,
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
        description: baseDescription,
        priority: urgencyHint[f.urgency] || 'Medium',
        reporterEmail: context.userEmail,
        internalNote: `*Chat intake — ${meta.category || 'General'}*${meta.ambiguityNote ? `\n\n⚠️ ${meta.ambiguityNote}` : ''}${meta.securitySensitive ? '\n\n🔒 Security-sensitive: user removal / access revocation — treat as urgent' : ''}${meta.complaintDetected ? '\n\n⚠️ COMPLAINT / ESCALATION — customer expressed dissatisfaction. Treat as complaint case.' : ''}\n\n${transcript}`,
      });
    }

    // Link follow-up ticket to original if applicable
    if (meta.followUpTicketKey) {
      try {
        await this.portalJira.linkIssues(ticketKey, meta.followUpTicketKey);
      } catch (err) {
        console.warn('[portal-chat] Failed to link follow-up ticket:', err instanceof Error ? err.message : err);
      }
    }

    // Update session
    meta.stage = 'confirmed';
    meta.offeredTicketCreation = false;
    await execute(
      `UPDATE portal_chat_sessions SET jira_issue_key = ?, status = 'handed_off', metadata = ? WHERE id = ?`,
      [ticketKey, JSON.stringify(meta), sessionId],
    );

    // Store confirmation message (skip when called from natural-language confirmation
    // in processStage — sendMessage will insert the message with metadata instead)
    if (!options?.skipMessage) {
      const confirmMsg = `I've created ticket **${ticketKey}**. You can track its progress in your tickets page.`;
      await execute(
        `INSERT INTO portal_chat_messages (session_id, role, content)
         VALUES (?, 'assistant', ?)`,
        [sessionId, confirmMsg],
      );
    }

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
    // Property identifier is not needed for feed-sync issues (often system-wide)
    // or when the customer has already indicated a site-wide scope
    const siteWideSubcategories = ['property_feed_sync'];
    const isSiteWide = fields.propertyAddress?.toLowerCase().includes('site-wide') ||
      fields.propertyAddress?.toLowerCase().includes('all properties');
    if (!fields.propertyAddress && !fields.listingId && !isSiteWide && !siteWideSubcategories.includes(subcategory)) {
      missing.push('propertyIdentifier');
    }
    if (!fields.affectedPortals && ['property_missing_listing', 'property_feed_sync', 'property_visibility', 'property_incorrect_details'].includes(subcategory)) {
      // Don't ask for portal when a website URL already makes the answer obvious
      const urlImpliesWebsite = fields.url && !/\b(rightmove|zoopla|onthemarket|primelocation)\b/i.test(fields.url);
      if (!urlImpliesWebsite) {
        missing.push('affectedPortals');
      }
    }
    if (!fields.account) missing.push('account');
    return missing;
  }

  private buildPropertyFollowUp(field: string, meta: IntakeSessionMetadata): string {
    const ctx = briefContext(meta);

    const withContext = (question: string): string => {
      if (!ctx || ctx.length < 8 || /^(hi|hello|hey|good\s)/i.test(ctx)) return question;
      const lc = ctx.toLowerCase().startsWith('i ') ? ctx : ctx.charAt(0).toLowerCase() + ctx.slice(1);
      return `I can see ${lc} — ${question.charAt(0).toLowerCase() + question.slice(1)}`;
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
      if (!fields.affectedPersonName || !fields.affectedPersonEmail) missing.push('affectedPerson');
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
      if (!ctx || ctx.length < 8 || /^(hi|hello|hey|good\s)/i.test(ctx)) return question;
      const lc = ctx.toLowerCase().startsWith('i ') ? ctx : ctx.charAt(0).toLowerCase() + ctx.slice(1);
      return `I can see ${lc} — ${question.charAt(0).toLowerCase() + question.slice(1)}`;
    };

    switch (field) {
      case 'description':
        if (meta.subcategory === 'account_login') return "What happens when you try to log in — do you get an error message, or does something else happen?";
        if (meta.subcategory === 'account_new_user') return "Could you let me know what access they'll need?";
        if (meta.subcategory === 'account_permissions') return "What are you trying to access, and what happens when you try?";
        if (meta.subcategory === 'account_office_change') return "Could you tell me a bit more about what needs to change?";
        if (meta.subcategory === 'account_details') return "What details need updating?";
        return "Could you describe what's happening in a bit more detail?";
      case 'affectedPerson': {
        const hasName = !!meta.collectedFields.affectedPersonName;
        const hasEmail = !!meta.collectedFields.affectedPersonEmail;
        if (meta.subcategory === 'account_remove_user') {
          if (hasEmail && !hasName) return withContext("Could you confirm the name of the person to be removed?");
          if (hasName && !hasEmail) return withContext("Could you confirm their email address?");
          return withContext("Could you confirm their name and email address?");
        }
        if (hasEmail && !hasName) return withContext("Could you let me know the person's name?");
        if (hasName && !hasEmail) return withContext("Could you let me know the person's email address?");
        return withContext("Could you let me know the person's name and email address?");
      }
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
    const ctxUsable = context && context.length >= 8 && !/^(hi|hello|hey|good\s)/i.test(context);

    if (parts.length > 0 && ctxUsable) {
      return `Thanks for letting us know about ${parts.join(' and ')} — I can see ${context.toLowerCase().startsWith('i ') ? context : context.charAt(0).toLowerCase() + context.slice(1)}.`;
    }
    if (parts.length > 0) {
      return `Thanks for letting us know about ${parts.join(' and ')}.`;
    }
    if (meta.subcategory === 'account_login') {
      return ctxUsable ? `Sorry to hear you're having trouble getting in — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "Sorry to hear you're having trouble getting in.";
    }
    if (meta.subcategory === 'account_new_user') {
      return ctxUsable ? `I'll help you get that set up — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "I'll help you get that new user set up.";
    }
    if (meta.subcategory === 'account_office_change') {
      return ctxUsable ? `I'll help you with that — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "I'll help you with that office change.";
    }
    return ctxUsable ? `Thanks for getting in touch — ${context.charAt(0).toLowerCase() + context.slice(1)}.` : "Thanks for getting in touch.";
  }

  private async buildAccountConversationalFollowUp(
    field: string,
    meta: IntakeSessionMetadata,
    history: Array<{ role: string; content: string }>,
  ): Promise<string> {
    if (this.llm && history.length >= 2) {
      try {
        const recentExchange = history.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n');
        const fieldLabel = field === 'affectedPerson'
          ? (meta.collectedFields.affectedPersonEmail && !meta.collectedFields.affectedPersonName
            ? "the person's name (their email is already provided)"
            : meta.collectedFields.affectedPersonName && !meta.collectedFields.affectedPersonEmail
              ? "the person's email address (their name is already provided)"
              : "the affected person's name and email")
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
- Keep it short and natural (one sentence)
- Don't repeat information they've already provided
- Don't start with "You mentioned..." or quote the customer's words back to them
- Don't parrot their greeting or opening sentence
- NEVER ask "which system" or "which platform"
- NEVER use ANY of these terms: RBAC, provisioning, deprovisioning, authentication, authorisation, authorization, access control, role-based, permission matrix, permission model, scopes, entities, service account, SSO, SAML, identity provider, triage, categorise, classify, route, access permissions, user permissions, role permissions, access rights, user access, permission levels
- NEVER reveal multi-system provisioning (setting up one user may affect many systems — the customer sees one request)
- Use the customer's vocabulary for their problem (e.g. if they said "can't get in", say "can't get in") but don't echo full sentences.`,
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
    const isAccountOrBilling = meta.category === 'account' || meta.category === 'billing';
    switch (field) {
      case 'description':
        if (meta.subcategory === 'website_content') return 'Could you tell me what needs changing and where on the page?';
        if (meta.subcategory === 'website_broken') return "Could you describe what's happening and what you'd expect to see instead?";
        if (meta.subcategory === 'website_new_page') return 'Could you describe what the new page should contain and where it should sit in the navigation?';
        if (meta.subcategory === 'website_design') return 'Could you describe the design changes you have in mind?';
        if (meta.category === 'complaint') return "Could you tell me what happened and what outcome you're looking for?";
        if (isAccountOrBilling) return 'Could you describe what you need in a bit more detail?';
        return 'Could you describe what you need in a bit more detail?';
      case 'account':
        if (isAccountOrBilling) return 'Which account or company is this for?';
        return 'Which account or website is this for?';
      case 'url':
        if (isAccountOrBilling) return 'Could you share a few more details about what needs to happen?';
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
- Keep it short and natural (one sentence)
- Don't repeat information they've already provided
- Don't start with "You mentioned..." or quote the customer's words back to them
- Don't parrot their greeting or opening sentence
- NEVER use technical jargon like "feed", "syndication", "API", "integration", "CRM", "data sync", "data pipeline", "portal feed", "authentication", "authorisation", "access control"
- Use the customer's vocabulary for their problem (e.g. if they said "not showing on Rightmove", say "not showing on Rightmove") but don't echo full sentences.`,
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
    // Account/billing requests should never ask for URL — redirect to a more appropriate field
    if (field === 'url' && (meta.category === 'account' || meta.category === 'billing')) {
      return this.buildConversationalQuestion('description', meta);
    }

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
- Keep it short and natural (one sentence)
- Don't repeat information they've already provided
- Don't start with "You mentioned..." or quote the customer's words back to them
- Don't parrot their greeting or opening sentence
- Don't use internal jargon, category names, or technical terms (feed, syndication, API, CRM, RBAC, provisioning, authentication, authorisation, access control, role-based, permission)
- Use the customer's vocabulary for their problem (e.g. if they said "not working", say "not working" — don't translate to jargon) but don't echo full sentences`,
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
    const urgent = f.urgency === 'High' || f.urgency === 'Critical';
    const parts: string[] = [];

    if (f.affectedPersonName) parts.push(`the issue with ${f.affectedPersonName}`);
    if (f.propertyAddress) parts.push(f.propertyAddress);
    if (f.listingId && !f.propertyAddress) parts.push(`listing ${f.listingId}`);
    if (f.officeBranch) parts.push(`the ${f.officeBranch} office`);
    // Only echo portals when specific (e.g. "Rightmove"), not bare category words
    if (f.affectedPortals && !/^(website|listing|email|account)$/i.test(f.affectedPortals)) parts.push(f.affectedPortals);
    if (f.url) parts.push(f.url);
    // Only echo account when it's a real company name, not a placeholder
    if (f.account && parts.length === 0 && !isPlaceholderOrgName(f.account)) parts.push(f.account);

    const urgencyPrefix = urgent ? "I can see this is urgent — " : '';
    if (parts.length > 0) {
      const base = urgent
        ? `thanks for letting us know about ${parts.slice(0, 2).join(' on ')}.`
        : `Thanks for letting us know about ${parts.slice(0, 2).join(' on ')}.`;
      return `${urgencyPrefix}${base}`;
    }
    return urgent ? "I can see this is urgent — I'll get this looked at quickly." : 'Thanks for getting in touch.';
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

    const originalTerms = cleanSearchTerms(searchQuery.split(/\s+/)).slice(0, 8);
    if (originalTerms.length === 0) return [];

    const allTerms = expandSearchTerms(originalTerms);

    const likeConditions = allTerms.map(() => `(body_text LIKE ? OR title LIKE ?)`).join(' OR ');
    const params: unknown[] = [];
    allTerms.forEach((t) => { params.push(`%${t}%`, `%${t}%`); });

    const articles = await query<{ title: string; body_text: string }>(
      `SELECT TOP 15 title, LEFT(body_text, 500) AS body_text
       FROM portal_kb_articles
       WHERE ${likeConditions}`,
      params,
    );

    const ranked = rankAndFilter(
      articles,
      a => a.title,
      a => a.body_text,
      originalTerms,
      allTerms,
      3,
    );

    if (ranked.length > 0) {
      return ranked.map(({ item: a }) => ({
        title: a.title,
        excerpt: a.body_text.slice(0, 300),
      }));
    }

    // Fallback: live Confluence CQL search when local table has no match
    return this.searchConfluenceLive(originalTerms, allTerms);
  }

  private async searchConfluenceLive(
    originalTerms: string[],
    allTerms: string[],
  ): Promise<Array<{ title: string; excerpt: string }>> {
    try {
      const siteUrl = (this.settings.get('confluence_base_url') || this.settings.get('confluence_site_url') || this.settings.get('jira_url'))?.trim();
      const email = (this.settings.get('confluence_user') || this.settings.get('kb_confluence_email') || this.settings.get('jira_username') || this.settings.get('jira_email') || this.settings.get('jira_ob_email'))?.trim();
      const token = (this.settings.get('confluence_api_token') || this.settings.get('kb_confluence_token') || this.settings.get('jira_token') || this.settings.get('jira_api_token') || this.settings.get('jira_ob_token'))?.trim();
      const spaceKey = this.settings.get('kb_confluence_space')
        || this.settings.get('kb_confluence_space_keys')?.split(',')[0]?.trim()
        || 'NT';

      if (!siteUrl || !email || !token) return [];

      const searchText = originalTerms.join(' ');
      const cql = `text ~ "${searchText}" AND space = "${spaceKey}" AND type = "page" ORDER BY lastmodified DESC`;
      const url = `${siteUrl.replace(/\/wiki\/?$/, '').replace(/\/$/, '')}/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=8&expand=body.view`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        console.warn(`[portal-chat] Confluence live KB search failed: ${res.status}`);
        return [];
      }

      const json = await res.json() as { results?: Array<{ title: string; body?: { view?: { value: string } } }> };
      const results = json.results ?? [];

      const parsed = results.map(r => {
        const bodyHtml = r.body?.view?.value || '';
        const bodyText = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        return { title: r.title, body_text: bodyText };
      });

      const ranked = rankAndFilter(
        parsed,
        r => r.title,
        r => r.body_text,
        originalTerms,
        allTerms,
        3,
      );

      return ranked.map(({ item }) => ({
        title: item.title,
        excerpt: item.body_text.slice(0, 300),
      }));
    } catch (err) {
      console.warn('[portal-chat] Confluence live KB search error:', err instanceof Error ? err.message : err);
      return [];
    }
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
      summary: f.subject || `[Portal] ${catName} — handoff from ${context.userName}`.slice(0, 250),
      description: f.description || 'Customer requested human assistance. See transcript in internal notes.',
      priority: f.urgency === 'Critical' ? 'Highest' : f.urgency === 'High' ? 'High' : 'Medium',
      reporterEmail: context.userEmail,
      internalNote: `*${meta.frustrationHandoffOffered ? 'Customer requested human handoff' : 'Auto-handoff (max exchanges reached)'}${` (session ${sessionId})`}*${meta.ambiguityNote ? `\n\n⚠️ ${meta.ambiguityNote}` : ''}${meta.securitySensitive ? '\n\n🔒 Security-sensitive: user removal / access revocation — treat as urgent' : ''}\n\n${transcript}`,
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
        summary: `[Portal] Chat support request from ${context.userName}${!isPlaceholderOrgName(context.orgName) ? ` (${context.orgName})` : ''}`.slice(0, 250),
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
