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
  // Default categories — can be extended via settings
  website: 'NT',
  email: 'NT',
  crm: 'NT',
  portal: 'NT',
  onboarding: 'NTPJ',
  setup: 'NTPJ',
  training: 'NTPJ',
};

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

    // Build description
    const descParts = [input.description];
    if (input.url) descParts.push(`\n*URL/Page:* ${input.url}`);
    if (input.errorMessage) descParts.push(`\n*Error message:* ${input.errorMessage}`);

    // Build internal note with all structured fields
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

    const ticketKey = await this.portalJira.createTicket({
      projectKey,
      summary: input.subject,
      description: descParts.join('\n'),
      priority,
      components: input.category ? [input.category] : undefined,
      reporterEmail: userEmail,
      internalNote: internalParts.join('\n'),
    });

    // Store form submission for analytics
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

  async getCategories(): Promise<Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }>> {
    // Return a static category tree for now — can be enhanced to read from Jira components
    return [
      {
        id: 'website',
        name: 'Website',
        children: [
          { id: 'website_content', name: 'Content Issue' },
          { id: 'website_technical', name: 'Technical Issue' },
          { id: 'website_design', name: 'Design Change' },
        ],
      },
      {
        id: 'email',
        name: 'Email Marketing',
        children: [
          { id: 'email_template', name: 'Template Issue' },
          { id: 'email_delivery', name: 'Delivery Problem' },
          { id: 'email_setup', name: 'Campaign Setup' },
        ],
      },
      {
        id: 'crm',
        name: 'CRM / LeadPro',
        children: [
          { id: 'crm_access', name: 'Access / Login' },
          { id: 'crm_data', name: 'Data Issue' },
          { id: 'crm_integration', name: 'Integration' },
        ],
      },
      {
        id: 'portal',
        name: 'Portal / Valuation Tool',
        children: [
          { id: 'portal_access', name: 'Access Issue' },
          { id: 'portal_bug', name: 'Bug Report' },
          { id: 'portal_feature', name: 'Feature Request' },
        ],
      },
      {
        id: 'onboarding',
        name: 'Onboarding',
        children: [
          { id: 'onboarding_setup', name: 'Setup Query' },
          { id: 'onboarding_training', name: 'Training' },
        ],
      },
      {
        id: 'other',
        name: 'Other',
        children: [
          { id: 'other_general', name: 'General Query' },
          { id: 'other_billing', name: 'Billing' },
          { id: 'other_feedback', name: 'Feedback' },
        ],
      },
    ];
  }
}
