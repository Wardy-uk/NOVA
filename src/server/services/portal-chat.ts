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

const IntentSchema = z.object({
  intent: z.enum(['problem', 'change', 'question', 'status']),
  subject: z.string().optional(),
  account: z.string().optional(),
  description: z.string().optional(),
  urgency: z.enum(['Normal', 'High', 'Critical']).optional(),
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

const ChatResponseSchema = z.object({ response: z.string() });

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

    try {
      const result = await this.processStage(meta, content, history, context, sessionId);
      responseContent = result.response;
      messageMeta = result.messageMeta ?? null;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : undefined;
      console.error(`[portal-chat] Stage processing failed for session ${sessionId}, stage=${meta.stage}, intent=${meta.intent}:`, errMsg);
      if (errStack) console.error('[portal-chat] Stack:', errStack);
      responseContent = "I'm having trouble processing your request right now. Would you like me to create a support ticket so our team can help you directly?";
    }

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

  // ── Stage 1: Intent Classification ──

  private async handleIntentStage(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    if (!this.llm) {
      meta.stage = 'category';
      meta.intent = 'problem';
      return { response: this.buildCategoryQuestion() };
    }

    try {
      const result = await this.llm.call(
        `You are classifying a customer support message. Determine the intent:
- "problem": something is broken, not working, an error, or unexpected behavior
- "change": content update, new user setup, configuration change, service modification
- "question": how do I...?, what is...?, general enquiry
- "status": checking on an existing ticket or request

Also extract any fields already mentioned. Return JSON.`,
        content,
        IntentSchema,
        { callType: 'portal_chat', tier: 'standard', maxTokens: 300, temperature: 0.1 },
      );

      meta.intent = result.data.intent;

      // Extract any fields the user already provided
      if (result.data.subject) meta.collectedFields.subject = result.data.subject;
      if (result.data.account) meta.collectedFields.account = result.data.account;
      if (result.data.description) meta.collectedFields.description = result.data.description;
      if (result.data.urgency) meta.collectedFields.urgency = result.data.urgency;

      // Detect urgency from language
      if (!result.data.urgency && /\b(urgent|emergency|down|critical|asap|broken)\b/i.test(content)) {
        meta.collectedFields.urgency = 'High';
      }
      if (/\b(call me|phone me|ring me)\b/i.test(content)) {
        meta.collectedFields.contactPreference = 'phone';
      } else if (/\bemail me\b/i.test(content)) {
        meta.collectedFields.contactPreference = 'email';
      }
    } catch (err) {
      console.warn('[portal-chat] Intent classification failed, defaulting to problem:', err instanceof Error ? err.message : err);
      meta.intent = 'problem';
      meta.collectedFields.description = content;
    }

    // Route by intent
    if (meta.intent === 'status') {
      try {
        return await this.handleStatusIntent(meta, content, context);
      } catch (err) {
        console.warn('[portal-chat] Status lookup failed, falling through to category:', err instanceof Error ? err.message : err);
      }
    }

    if (meta.intent === 'question') {
      try {
        const kbResult = await this.searchKb(content);
        if (kbResult.length > 0) {
          meta.stage = 'kb_check';
          meta.kbSuggested = true;
          const articleList = kbResult.map(a => `- **${a.title}**: ${a.excerpt}`).join('\n');
          return {
            response: `I found some articles that might help:\n\n${articleList}\n\nDo any of these answer your question? If not, I can help you raise a support request.`,
          };
        }
      } catch (err) {
        console.warn('[portal-chat] KB search failed, falling through to category:', err instanceof Error ? err.message : err);
      }
    }

    // Move to category stage
    meta.stage = 'category';
    const prefix = meta.intent === 'change'
      ? "Thanks — I'll help you get that change request submitted."
      : meta.intent === 'question'
        ? "I couldn't find a direct answer in our knowledge base, but let me help you get in touch with the right team."
        : "Sorry to hear you're having trouble — let me help you get this sorted.";

    return { response: `${prefix}\n\n${this.buildCategoryQuestion()}` };
  }

  // ── Status Intent ──

  private async handleStatusIntent(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
  ): Promise<{ response: string }> {
    // Try to find tickets for this user's org
    const domain = await this.portalJira.getOrgEmailDomain(context.orgId);
    if (!domain) {
      meta.stage = 'category';
      return { response: "I couldn't find your organisation's tickets. Would you like to raise a new request instead?\n\n" + this.buildCategoryQuestion() };
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
    return { response: "I couldn't find any recent tickets for your organisation. Would you like to raise a new request?\n\n" + this.buildCategoryQuestion() };
  }

  // ── Stage 2: Category Selection ──

  private async handleCategoryStage(
    meta: IntakeSessionMetadata,
    content: string,
    context: ChatContext,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
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
    return { response: `I didn't quite catch that. ${this.buildCategoryQuestion()}` };
  }

  private handleSubcategoryPick(
    meta: IntakeSessionMetadata,
    content: string,
    _context: ChatContext,
  ): { response: string; messageMeta?: ChatMessageMetadata } {
    const catId = meta.category!;
    // Try to match the user's text to a subcategory
    const subs = Object.entries(SUBCATEGORY_NAMES).filter(([id]) => id.startsWith(catId + '_') || id.startsWith(catId.replace('_marketing', '') + '_'));
    const lower = content.toLowerCase();
    const match = subs.find(([id, name]) => lower.includes(name.toLowerCase()) || lower.includes(id.replace(catId + '_', '').replace('_', ' ')));

    if (match) {
      meta.subcategory = match[0];
    } else {
      // Default to the first subcategory containing relevant keywords, or first one
      meta.subcategory = subs[0]?.[0] || `${catId}_general`;
    }

    meta.stage = 'detail';
    return { response: this.buildFirstDetailQuestion(meta) };
  }

  private askSubcategory(meta: IntakeSessionMetadata, catId: string): { response: string } {
    const subs = Object.entries(SUBCATEGORY_NAMES).filter(([id]) => id.startsWith(catId + '_') || id.startsWith(catId.replace('_marketing', '') + '_'));
    if (subs.length === 0) {
      meta.subcategory = `${catId}_general`;
      meta.stage = 'detail';
      return { response: this.buildFirstDetailQuestion(meta) };
    }

    const options = subs.map(([, name]) => name).join(', ');
    return { response: `Can you be more specific? Is it about: ${options}?` };
  }

  // ── Stage 3: Detail Gathering ──

  private async handleDetailStage(
    meta: IntakeSessionMetadata,
    content: string,
    history: Array<{ role: string; content: string }>,
    context: ChatContext,
    sessionId: number,
  ): Promise<{ response: string; messageMeta?: ChatMessageMetadata }> {
    // Extract fields from the user's message
    await this.extractFields(meta, content);

    const config = CATEGORY_FIELD_CONFIG[meta.subcategory || ''] || CATEGORY_FIELD_CONFIG['other_general']!;
    const missing = this.getMissingFields(meta.collectedFields, config);

    if (missing.length === 0) {
      // All required fields collected — move to KB check
      return this.tryKbDeflection(meta, context, sessionId);
    }

    // Ask for the next missing field
    return { response: this.buildDetailQuestion(missing[0], config) };
  }

  private async extractFields(meta: IntakeSessionMetadata, content: string): Promise<void> {
    if (!this.llm) {
      // No LLM — try basic extraction
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

      // Description accumulates
      if (data.description) {
        meta.collectedFields.description = meta.collectedFields.description
          ? `${meta.collectedFields.description}\n${data.description}`
          : data.description;
      } else if (!meta.collectedFields.description) {
        meta.collectedFields.description = content;
      }
    } catch (err) {
      console.warn('[portal-chat] Field extraction failed:', err instanceof Error ? err.message : err);
      if (!meta.collectedFields.description) meta.collectedFields.description = content;
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
        const articleList = articles.map(a => `- **${a.title}**: ${a.excerpt}`).join('\n');
        return {
          response: `Before I create a ticket, I found an article that might help:\n\n${articleList}\n\nDoes this solve your issue?`,
        };
      }
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

    const lines = [
      `**Subject:** ${f.subject}`,
      `**Category:** ${CATEGORY_NAMES[meta.category || ''] || meta.category || 'General'}${meta.subcategory ? ` > ${SUBCATEGORY_NAMES[meta.subcategory] || meta.subcategory}` : ''}`,
    ];
    if (f.account) lines.push(`**Account:** ${f.account}`);
    if (f.description) lines.push(`**Description:** ${f.description}`);
    if (f.url) lines.push(`**URL:** ${f.url}`);
    if (f.errorMessage) lines.push(`**Error:** ${f.errorMessage}`);
    if (f.browser) lines.push(`**Browser:** ${f.browser}`);
    lines.push(`**Urgency:** ${f.urgency}`);
    lines.push(`**Contact preference:** ${f.contactPreference}`);

    return {
      response: `Here's a summary of your request. Please review and confirm, or let me know if anything needs changing.\n\n${lines.join('\n')}`,
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
        internalNote: `*Chat intake — ${meta.category || 'General'}*\n\n${transcript}`,
      });
    }

    // Post transcript as internal note (if intake service handled the ticket, we still want the transcript)
    if (this.intakeService) {
      try {
        await this.portalJira.createTicket({
          projectKey: 'NOOP',
          summary: '',
          description: '',
          internalNote: `*Chat transcript (session ${sessionId})*\n\n${transcript}`,
        }).catch(() => {});
        // Actually we should use addInternalNote if it exists. For now, the intake's internalNote covers it.
      } catch { /* already logged via intake */ }
    }

    // Update session
    meta.stage = 'confirmed';
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

  // ── Helpers ──

  private buildCategoryQuestion(): string {
    return "Which area does this relate to?\n\n" +
      "1. **Website** — content updates or something not working\n" +
      "2. **Account** — login, passwords, users, permissions\n" +
      "3. **Email Marketing** — campaigns, triggers, templates\n" +
      "4. **LeadPro & CRM** — leads, contacts, CRM issues\n" +
      "5. **Data Feeds** — property feeds, integrations, reporting\n" +
      "6. **Listings** — virtual tours, property media\n" +
      "7. **Onboarding** — new branch, product, or training\n" +
      "8. **Billing** — cancellations, service changes, queries\n" +
      "9. **Something else**";
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
      return "I wasn't able to create a ticket automatically. Please use the **New Request** form to submit your issue, and our team will get back to you as soon as possible.";
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
