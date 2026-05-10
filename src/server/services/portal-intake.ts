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
  website: 'NT',
  email: 'NT',
  crm: 'NT',
  portal: 'NT',
  onboarding: 'NTPJ',
  setup: 'NTPJ',
  training: 'NTPJ',
};

const DEFAULT_CATEGORIES: Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }> = [
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

interface JiraComponent {
  id: string;
  name: string;
  description?: string;
}

export class PortalIntakeService {
  private categoryCache: Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }> | null = null;
  private categoryCacheTime = 0;
  private static CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

    const ticketKey = await this.portalJira.createTicket({
      projectKey,
      summary: input.subject,
      description: descParts.join('\n'),
      priority,
      components: input.category ? [input.category] : undefined,
      reporterEmail: userEmail,
      internalNote: internalParts.join('\n'),
    });

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
    // Return cached if still fresh
    if (this.categoryCache && (Date.now() - this.categoryCacheTime) < PortalIntakeService.CACHE_TTL_MS) {
      return this.categoryCache;
    }

    try {
      const categories = await this.fetchCategoriesFromJira();
      if (categories.length > 0) {
        this.categoryCache = categories;
        this.categoryCacheTime = Date.now();
        return categories;
      }
    } catch (err) {
      console.warn('[portal-intake] Failed to fetch Jira components, using defaults:', err instanceof Error ? err.message : err);
    }

    return DEFAULT_CATEGORIES;
  }

  async refreshCategories(): Promise<void> {
    this.categoryCache = null;
    this.categoryCacheTime = 0;
    await this.getCategories();
  }

  private async fetchCategoriesFromJira(): Promise<Array<{ id: string; name: string; children: Array<{ id: string; name: string }> }>> {
    const s = this.settings.getAll();
    if (s.jira_enabled !== 'true' || !s.jira_username || !s.jira_token) return [];

    const auth = 'Basic ' + Buffer.from(`${s.jira_username}:${s.jira_token}`).toString('base64');
    const cloudId = s.jira_cloud_id || '9357a1ba-0ad9-4ff0-964d-fad84dd30f96';
    const projects = ['NT', 'NTPJ'];
    const allComponents: Array<{ project: string; component: JiraComponent }> = [];

    for (const project of projects) {
      try {
        const resp = await fetch(
          `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${project}/components`,
          { headers: { Authorization: auth, Accept: 'application/json' } },
        );
        if (!resp.ok) continue;
        const components = await resp.json() as JiraComponent[];
        for (const c of components) {
          allComponents.push({ project, component: c });
        }
      } catch { /* skip project */ }
    }

    if (allComponents.length === 0) return [];

    // Group components into categories (top-level = components without '/')
    // Components named "Category/Subcategory" become parent/child
    const categoryMap = new Map<string, { id: string; name: string; children: Array<{ id: string; name: string }> }>();

    for (const { component } of allComponents) {
      const parts = component.name.split('/').map(p => p.trim());
      const parentName = parts[0];
      const parentId = parentName.toLowerCase().replace(/[^a-z0-9]+/g, '_');

      if (!categoryMap.has(parentId)) {
        categoryMap.set(parentId, { id: parentId, name: parentName, children: [] });
      }

      if (parts.length > 1) {
        const childName = parts.slice(1).join(' / ');
        const childId = `${parentId}_${childName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
        const cat = categoryMap.get(parentId)!;
        if (!cat.children.some(c => c.id === childId)) {
          cat.children.push({ id: childId, name: childName });
        }
      }
    }

    return [...categoryMap.values()];
  }
}
