import type { FileSettingsQueries } from '../db/settings-store.js';
import type { PortalJiraService } from './portal-jira.js';
import type { PortalTicketCreateInput } from '../../shared/portal-types.js';
import { execute, queryOne } from './database.js';
import { trackEvent } from './portal-analytics.js';

const URGENCY_TO_PRIORITY: Record<string, string> = {
  Normal: 'Medium',
  High: 'High',
  Critical: 'Highest',
};

const CATEGORY_TO_PROJECT: Record<string, string> = {
  website: 'NTPJ',
  website_content: 'NTPJ',
  website_broken: 'NTPJ',
  website_new_page: 'NTPJ',
  website_design: 'NTPJ',
  account: 'NT',
  email_marketing: 'NT',
  leadpro: 'NT',
  data_feeds: 'NT',
  listings: 'NT',
  onboarding: 'NT',
  billing: 'NT',
  other: 'NT',
};

interface CategoryDef {
  id: string;
  name: string;
  description?: string;
  children: Array<{ id: string; name: string }>;
}

const DEFAULT_CATEGORIES: CategoryDef[] = [
  {
    id: 'website',
    name: 'My Website',
    description: 'Content updates, page changes, or something isn\'t working',
    children: [
      { id: 'website_content', name: 'Update my website content' },
      { id: 'website_broken', name: 'Something on my website isn\'t working' },
      { id: 'website_new_page', name: 'New page or restructure' },
      { id: 'website_design', name: 'Design change' },
    ],
  },
  {
    id: 'account',
    name: 'My Account',
    description: 'Login, passwords, new users, or permissions',
    children: [
      { id: 'account_login', name: 'Login or password problem' },
      { id: 'account_new_user', name: 'New user setup' },
      { id: 'account_permissions', name: 'Permissions or access change' },
      { id: 'account_details', name: 'Update account details' },
    ],
  },
  {
    id: 'email_marketing',
    name: 'Email Marketing',
    description: 'Campaigns, triggers, templates, or sending issues',
    children: [
      { id: 'email_campaign', name: 'Campaign or sending issue' },
      { id: 'email_triggers', name: 'Triggers or automation' },
      { id: 'email_template', name: 'Template or approval' },
    ],
  },
  {
    id: 'leadpro',
    name: 'LeadPro & CRM',
    description: 'Leads, contacts, or CRM system issues',
    children: [
      { id: 'leadpro_missing', name: 'Missing or duplicate leads' },
      { id: 'leadpro_setup', name: 'Setup or configuration' },
      { id: 'leadpro_access', name: 'Access issue' },
    ],
  },
  {
    id: 'data_feeds',
    name: 'Data Feeds & Integrations',
    description: 'Property feeds, third-party connections, or API issues',
    children: [
      { id: 'feeds_property', name: 'Property feed issue' },
      { id: 'feeds_integration', name: 'Third-party connection' },
      { id: 'feeds_reporting', name: 'Reporting or analytics' },
    ],
  },
  {
    id: 'listings',
    name: 'Property Listings',
    description: 'Virtual tours, property media, or listing management',
    children: [
      { id: 'listings_tours', name: 'Virtual tours' },
      { id: 'listings_media', name: 'Property images or media' },
      { id: 'listings_management', name: 'Listing management' },
    ],
  },
  {
    id: 'onboarding',
    name: 'Onboarding & Setup',
    description: 'New branch, new product, or getting started',
    children: [
      { id: 'onboarding_branch', name: 'New branch setup' },
      { id: 'onboarding_product', name: 'New product setup' },
      { id: 'onboarding_training', name: 'Training request' },
    ],
  },
  {
    id: 'billing',
    name: 'Billing & Contracts',
    description: 'Cancellations, service changes, or account queries',
    children: [
      { id: 'billing_cancel', name: 'Cancellation or notice' },
      { id: 'billing_change', name: 'Service change' },
      { id: 'billing_query', name: 'Billing query' },
    ],
  },
  {
    id: 'other',
    name: 'Something Else',
    description: 'General enquiry',
    children: [
      { id: 'other_general', name: 'General query' },
      { id: 'other_feedback', name: 'Feedback or suggestion' },
    ],
  },
];

export class PortalIntakeService {
  constructor(
    private settings: FileSettingsQueries,
    private portalJira: PortalJiraService,
  ) {}

  async submitTicket(
    input: PortalTicketCreateInput,
    portalUserId: number,
    orgId: number,
    userEmail: string,
    userName: string,
  ): Promise<{ ticketKey: string }> {
    await trackEvent('form_completed', portalUserId, orgId, { category: input.category });

    const projectKey = this.getProjectForCategory(input.category);
    const priority = URGENCY_TO_PRIORITY[input.urgency] || 'Medium';

    const descParts = [input.description];
    if (input.url) descParts.push(`\n*URL/Page:* ${input.url}`);
    if (input.errorMessage) descParts.push(`\n*Error message:* ${input.errorMessage}`);

    const internalParts = [
      `*Portal submission by:* ${userName} (${userEmail})`,
      `*Category:* ${input.category}${input.subcategory ? ` > ${input.subcategory}` : ''}`,
      `*Account:* ${input.account || 'Not specified'}`,
      `*Contact preference:* ${input.contactPreference}`,
    ];
    if (input.url) internalParts.push(`*URL:* ${input.url}`);
    if (input.errorMessage) internalParts.push(`*Error:* ${input.errorMessage}`);
    if (input.browser) internalParts.push(`*Browser:* ${input.browser}`);
    if (input.os) internalParts.push(`*OS:* ${input.os}`);

    let ticketKey: string;
    try {
      ticketKey = await this.portalJira.createTicket({
        projectKey,
        summary: input.subject,
        description: descParts.join('\n'),
        priority,
        reporterEmail: userEmail,
        internalNote: internalParts.join('\n'),
      });
    } catch (err) {
      console.error('[portal-intake] Jira ticket creation failed:', err);
      throw new Error('We couldn\'t create your ticket right now. Please try again, or contact us directly at support@nurtur.tech.');
    }

    await execute(
      `INSERT INTO portal_form_submissions (portal_user_id, jira_issue_key, form_data, category)
       VALUES (?, ?, ?, ?)`,
      [portalUserId, ticketKey, JSON.stringify(input), input.category],
    );

    await trackEvent('ticket_created', portalUserId, orgId, {
      ticket_key: ticketKey,
      category: input.category,
    });

    return { ticketKey };
  }

  getProjectForCategory(category: string): string {
    const settingsProject = this.settings.get(`portal_category_project_${category.toLowerCase()}`);
    if (settingsProject) return settingsProject;
    return CATEGORY_TO_PROJECT[category.toLowerCase()] || this.settings.get('portal_jira_project_nt') || 'NT';
  }

  async getCategories(): Promise<CategoryDef[]> {
    const customJson = this.settings.get('portal_categories');
    if (customJson) {
      try {
        const parsed = JSON.parse(customJson) as CategoryDef[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (err) {
        console.warn('[portal-intake] Invalid portal_categories JSON, using defaults:', err instanceof Error ? err.message : err);
      }
    }
    return DEFAULT_CATEGORIES;
  }
}
