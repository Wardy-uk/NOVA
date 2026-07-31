import type { FileSettingsQueries } from '../db/settings-store.js';
import type { PortalJiraService } from './portal-jira.js';
import type { PortalTicketCreateInput, PortalNetworkRequestInput, PortalOnboardingRequestInput, PortalMembershipApplicationInput, PortalOnboardingSetupInput } from '../../shared/portal-types.js';
import { execute, queryOne, query } from './database.js';
import { logError } from './error-log.js';
import { trackEvent } from './portal-analytics.js';
import { EscalationLogService } from './escalation-log-service.js';
import { broadcastPortalEvent } from '../routes/portal-events.js';
import type { OnboardingRecordQueries } from '../db/queries.js';
import type { GuildOnboardingService } from './guild-onboarding.js';
import type { EmailService } from './email.js';

const URGENCY_TO_PRIORITY_HINT: Record<string, string> = {
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
  property: 'NT',
  property_missing_listing: 'NT',
  property_incorrect_details: 'NT',
  property_media: 'NT',
  property_feed_sync: 'NT',
  property_status: 'NT',
  property_visibility: 'NT',
  account: 'NT',
  account_login: 'NT',
  account_new_user: 'NT',
  account_permissions: 'NT',
  account_details: 'NT',
  account_office_change: 'NT',
  account_remove_user: 'NT',
  email_marketing: 'NT',
  email_campaign: 'NT',
  email_triggers: 'NT',
  email_template: 'NTPJ',
  leadpro: 'NT',
  leadpro_missing: 'NT',
  leadpro_setup: 'NT',
  leadpro_access: 'NT',
  data_feeds: 'NT',
  feeds_property: 'NT',
  feeds_integration: 'NT',
  feeds_reporting: 'NT',
  listings: 'NT',
  listings_tours: 'NT',
  listings_media: 'NT',
  listings_management: 'NT',
  onboarding: 'NT',
  onboarding_branch: 'NT',
  onboarding_product: 'NT',
  onboarding_training: 'NT',
  billing: 'NT',
  billing_cancel: 'NT',
  billing_change: 'NT',
  billing_query: 'NT',
  security: 'NTPJ',
  security_vulnerability: 'NTPJ',
  security_ssl: 'NTPJ',
  security_access: 'NTPJ',
  letters: 'NTPJ',
  letters_market_appraisal: 'NTPJ',
  letters_mailshot: 'NTPJ',
  letters_general: 'NTPJ',
  general_request: 'NT',
  general_request_change: 'NT',
  general_request_info: 'NT',
  general_request_other: 'NT',
  followup: 'NT',
  followup_reopen: 'NT',
  followup_update: 'NT',
  followup_not_resolved: 'NT',
  complaint: 'NT',
  complaint_service: 'NT',
  complaint_response: 'NT',
  complaint_escalate: 'NT',
  other: 'NT',
  other_general: 'NT',
  other_feedback: 'NT',
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
    id: 'letters',
    name: 'Letters & Correspondence',
    description: 'Market appraisals, property mailshots, or printed correspondence',
    children: [
      { id: 'letters_market_appraisal', name: 'Market appraisal letter' },
      { id: 'letters_mailshot', name: 'Property mailshot or marketing letter' },
      { id: 'letters_general', name: 'Other printed correspondence' },
    ],
  },
  {
    id: 'security',
    name: 'Website Security',
    description: 'SSL certificates, suspicious activity, or vulnerability concerns',
    children: [
      { id: 'security_vulnerability', name: 'Suspicious activity or vulnerability' },
      { id: 'security_ssl', name: 'SSL or certificate issue' },
      { id: 'security_access', name: 'Unauthorised access concern' },
    ],
  },
  {
    id: 'general_request',
    name: 'General Service Request',
    description: 'A change, information request, or something that doesn\'t fit elsewhere',
    children: [
      { id: 'general_request_change', name: 'Request a change' },
      { id: 'general_request_info', name: 'Request information' },
      { id: 'general_request_other', name: 'Other service request' },
    ],
  },
  {
    id: 'followup',
    name: 'Reopened / Follow-up',
    description: 'Chase or reopen a previous request',
    children: [
      { id: 'followup_reopen', name: 'Reopen a resolved request' },
      { id: 'followup_update', name: 'Chase an open request' },
      { id: 'followup_not_resolved', name: 'Issue not fully resolved' },
    ],
  },
  {
    id: 'complaint',
    name: 'Complaint / Escalation',
    description: 'Raise a complaint or escalate an issue',
    children: [
      { id: 'complaint_service', name: 'Service complaint' },
      { id: 'complaint_response', name: 'Response time concern' },
      { id: 'complaint_escalate', name: 'Escalate an existing issue' },
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
    // Guild onboarding pipeline (backlog #8) — optional; null keeps the legacy
    // setup+QA path for all onboardings when Jira/records aren't wired.
    private records: OnboardingRecordQueries | null = null,
    private guild: GuildOnboardingService | null = null,
    private email: EmailService | null = null,
  ) {}

  async submitTicket(
    input: PortalTicketCreateInput,
    portalUserId: number,
    orgId: number,
    userEmail: string,
    userName: string,
  ): Promise<{ ticketKey: string }> {
    await trackEvent('form_completed', portalUserId, orgId, { category: input.category });

    const projectKey = this.getProjectForCategory(input.category, input.subcategory);
    const isComplaint = input.category.startsWith('complaint');
    const effectiveUrgency = isComplaint && input.urgency === 'Normal' ? 'High' : input.urgency;
    const priorityHint = URGENCY_TO_PRIORITY_HINT[effectiveUrgency] || 'Medium';
    const priority = await this.portalJira.resolveJiraPriority(priorityHint);

    const descParts = [input.description];
    if (input.url) descParts.push(`\n*URL/Page:* ${input.url}`);
    if (input.errorMessage) descParts.push(`\n*Error message:* ${input.errorMessage}`);

    const internalParts = [
      `*Portal submission by:* ${userName} (${userEmail})`,
      `*Category:* ${input.category}${input.subcategory ? ` > ${input.subcategory}` : ''}`,
      `*Account:* ${input.account || 'Not specified'}`,
      `*Contact preference:* ${input.contactPreference}`,
    ];
    if (input.category.startsWith('complaint')) {
      internalParts.push('⚠️ *COMPLAINT / ESCALATION — customer expressed dissatisfaction. Treat as complaint case.*');
    }
    if (input.url) internalParts.push(`*URL:* ${input.url}`);
    if (input.errorMessage) internalParts.push(`*Error:* ${input.errorMessage}`);
    if (input.browser) internalParts.push(`*Browser:* ${input.browser}`);
    if (input.os) internalParts.push(`*OS:* ${input.os}`);

    const labels = isComplaint ? ['complaint'] : [];

    let ticketKey: string;
    try {
      ticketKey = await this.portalJira.createTicket({
        projectKey,
        summary: input.subject,
        description: descParts.join('\n'),
        priority: priority || undefined,
        labels: labels.length > 0 ? labels : undefined,
        reporterEmail: userEmail,
        internalNote: internalParts.join('\n'),
      });
    } catch (err) {
      console.error('[portal-intake] Jira ticket creation failed:', err);
      await logError('portal-intake', err, { severity: 'critical', context: { phase: 'ticket', category: input.category } });
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

    if (isComplaint) {
      const escalationLog = new EscalationLogService();
      try {
        await escalationLog.log({
          ticket_key: ticketKey,
          escalation_type: 'complaint_portal',
          reason_code: 'customer_complaint',
          reason_label: `Portal complaint: ${input.subcategory || input.category}`,
          escalated_by: userName,
          notes: `Customer complaint submitted via portal. Category: ${input.category}${input.subcategory ? ` > ${input.subcategory}` : ''}. Account: ${input.account || 'Not specified'}.`,
          source: 'portal',
        });
      } catch (err) {
        console.warn('[portal-intake] Failed to log complaint escalation for', ticketKey, ':', err instanceof Error ? err.message : err);
      }

      broadcastPortalEvent(orgId, {
        type: 'ticket:complaint_alert',
        ticketKey,
        data: {
          category: input.category,
          subcategory: input.subcategory || null,
          account: input.account || null,
          priority: effectiveUrgency,
          submittedBy: userName,
        },
      });
    }

    return { ticketKey };
  }

  async submitNetworkRequest(
    input: PortalNetworkRequestInput,
    portalUserId: number,
    orgId: number,
    userEmail: string,
  ): Promise<{ ticketKey: string }> {
    await trackEvent('form_completed', portalUserId, orgId, { category: 'network_request' });

    // BC Account Number from the org's Customer Scope (Portal Admin → Orgs).
    // support_cc_email is the org's shared address that gets copied on every
    // raised ticket (added as a participant alongside any user-entered CC).
    const org = await queryOne<{ bc_account_number: string | null; support_cc_email: string | null }>(
      `SELECT bc_account_number, support_cc_email FROM portal_organisations WHERE id = ?`,
      [orgId],
    );
    const orgCc = (org?.support_cc_email || '').split(',').map(e => e.trim()).filter(Boolean);
    const ccEmails = [...new Set([...(input.ccEmails || []), ...orgCc])];

    let ticketKey: string;
    try {
      ticketKey = await this.portalJira.createNetworkRequest({
        bcAccount: org?.bc_account_number?.trim() || undefined,
        network: input.network,
        summary: input.summary,
        agentNameBranch: input.agentNameBranch,
        agentOfficeId: input.agentOfficeId,
        detail: input.detail,
        priority: input.priority,
        businessCriticalReason: input.businessCriticalReason,
        requestType: input.requestType,
        hubspotLink: input.hubspotLink,
        notes: input.notes,
        triagedForDevelopment: input.supportTeam === 'development',
        reporterEmail: userEmail,
        ccEmails,
      });
    } catch (err) {
      console.error('[portal-intake] Network request creation failed:', err);
      await logError('portal-intake', err, { severity: 'critical', context: { phase: 'network-request' } });
      throw new Error('We couldn\'t raise your ticket right now. Please try again, or contact us directly at support@nurtur.tech.');
    }

    await execute(
      `INSERT INTO portal_form_submissions (portal_user_id, jira_issue_key, form_data, category)
       VALUES (?, ?, ?, ?)`,
      [portalUserId, ticketKey, JSON.stringify(input), 'network_request'],
    );

    await trackEvent('ticket_created', portalUserId, orgId, { ticket_key: ticketKey, category: 'network_request' });

    return { ticketKey };
  }

  /** Onboarding Request → a "setup" ticket (build the systems) plus a linked "QA"
   *  ticket (test the build). Returns the setup key (used for attachments) and the
   *  QA key. */
  async submitOnboardingRequest(
    input: PortalOnboardingRequestInput,
    portalUserId: number,
    orgId: number,
    userEmail: string,
    userName: string,
  ): Promise<{ ticketKey: string; qaKey: string | null }> {
    await trackEvent('form_completed', portalUserId, orgId, { category: 'onboarding_request' });

    // Guild/BYM channel (backlog #8): one submission → a first-class onboarding
    // record + QA parent + 7 linked children, replacing the legacy setup+QA pair.
    // Gated per-org (portal_organisations.guild_onboarding_enabled), set by the
    // portal admin in Portal Admin → Org. Off for every org by default.
    if (this.records && this.guild) {
      const orgGuild = await queryOne<{ guild_onboarding_enabled: number }>(
        `SELECT guild_onboarding_enabled FROM portal_organisations WHERE id = ?`, [orgId],
      );
      if (orgGuild?.guild_onboarding_enabled) {
        return this.submitGuildOnboarding(input, portalUserId, orgId, userEmail, userName);
      }
    }

    const org = await queryOne<{ bc_account_number: string | null }>(
      `SELECT bc_account_number FROM portal_organisations WHERE id = ?`,
      [orgId],
    );

    // Standard head-office users flagged "include in setup" for this org — added
    // to the setup ticket so the team provisions them alongside the new office.
    const setupUsers = await query<{ display_name: string; email: string; role: string }>(
      `SELECT display_name, email, role FROM portal_users
       WHERE org_id = ? AND include_in_setup = 1 AND access_state <> 'removed'
       ORDER BY display_name`,
      [orgId],
    );

    let setupKey: string;
    try {
      setupKey = await this.portalJira.createOnboardingRequest({
        fields: input,
        reporterEmail: userEmail,
        reporterName: userName,
        bcAccount: org?.bc_account_number?.trim() || undefined,
        includeUsers: setupUsers.map(u => ({ name: u.display_name, email: u.email, accessLevel: u.role })),
      });
    } catch (err) {
      console.error('[portal-intake] Onboarding setup ticket creation failed:', err);
      await logError('portal-intake', err, { severity: 'critical', context: { phase: 'onboarding-setup' } });
      throw new Error('We couldn\'t create your onboarding request right now. Please try again, or contact us directly at support@nurtur.tech.');
    }

    // QA ticket — best-effort. A failure here must not lose the setup ticket the
    // customer just submitted, so log and continue.
    let qaKey: string | null = null;
    try {
      qaKey = await this.portalJira.createQaTicket({
        brand: input.brand,
        branch: input.branch,
        network: input.network,
        bymUrl: input.bymUrl,
        setupKey,
      });
      await this.portalJira.linkIssues(qaKey, setupKey);
    } catch (err) {
      console.warn('[portal-intake] Onboarding QA ticket/link failed for', setupKey, ':', err instanceof Error ? err.message : err);
    }

    // Record submissions so the customer can view/attach to these tickets.
    await execute(
      `INSERT INTO portal_form_submissions (portal_user_id, jira_issue_key, form_data, category)
       VALUES (?, ?, ?, ?)`,
      [portalUserId, setupKey, JSON.stringify(input), 'onboarding_request'],
    );
    if (qaKey) {
      await execute(
        `INSERT INTO portal_form_submissions (portal_user_id, jira_issue_key, form_data, category)
         VALUES (?, ?, ?, ?)`,
        [portalUserId, qaKey, JSON.stringify({ linkedSetup: setupKey }), 'onboarding_qa'],
      );
    }

    await trackEvent('ticket_created', portalUserId, orgId, { ticket_key: setupKey, category: 'onboarding_request' });

    return { ticketKey: setupKey, qaKey };
  }

  /** Guild/BYM onboarding (backlog #8): create the record, fan out the QA parent
   *  + 7 linked children, alert the onboarding inbox. `ticketKey` is the QA
   *  parent (the customer's single reference). */
  private async submitGuildOnboarding(
    input: PortalOnboardingRequestInput,
    portalUserId: number,
    orgId: number,
    userEmail: string,
    userName: string,
  ): Promise<{ ticketKey: string; qaKey: string | null }> {
    const ref = `GOB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
    const recordId = await this.records!.create({
      onboarding_ref: ref,
      channel: 'guild',
      org_id: orgId,
      office_name: input.brand,
      branch_name: input.branch,
      invoice_commencement_date: input.invoiceCommencementDate || null,
    });
    const record = await this.records!.getById(recordId);
    if (!record) throw new Error('Onboarding record vanished after creation');

    let result;
    try {
      result = await this.guild!.createForRecord(record);
    } catch (err) {
      console.error('[portal-intake] Guild onboarding creation failed:', err);
      await logError('portal-intake', err, { severity: 'critical', context: { phase: 'guild-onboarding', ref } });
      throw new Error('We couldn\'t create your onboarding right now. Please try again, or contact us directly at support@nurtur.tech.');
    }

    // Record the submission against the QA parent so the customer can view/attach.
    await execute(
      `INSERT INTO portal_form_submissions (portal_user_id, jira_issue_key, form_data, category)
       VALUES (?, ?, ?, ?)`,
      [portalUserId, result.parentKey, JSON.stringify({ ...input, onboardingRef: ref, childKeys: result.childKeys }), 'onboarding_request'],
    );

    // R2 alert — inbox from the org's Onboarding Configuration, else the global fallback.
    const orgCfg = await queryOne<{ onboarding_config: string | null }>(
      `SELECT onboarding_config FROM portal_organisations WHERE id = ?`, [orgId],
    );
    let inbox = this.settings.get('onboarding_inbox_email') || '';
    try { if (orgCfg?.onboarding_config) { const c = JSON.parse(orgCfg.onboarding_config); if (c.inboxEmail) inbox = c.inboxEmail; } } catch { /* use fallback */ }
    await this.notifyOnboardingInbox(record, result, userName, inbox).catch(err =>
      console.warn('[portal-intake] Onboarding inbox alert failed:', err instanceof Error ? err.message : err));

    await trackEvent('ticket_created', portalUserId, orgId, { ticket_key: result.parentKey, category: 'onboarding_request' });
    return { ticketKey: result.parentKey, qaKey: result.parentKey };
  }

  private async isGuildEnabled(orgId: number): Promise<boolean> {
    const row = await queryOne<{ guild_onboarding_enabled: number }>(
      `SELECT guild_onboarding_enabled FROM portal_organisations WHERE id = ?`, [orgId]);
    return !!row?.guild_onboarding_enabled;
  }

  private newRef(): string {
    return `GOB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
  }

  private async orgInbox(orgId: number): Promise<string> {
    const row = await queryOne<{ onboarding_config: string | null }>(
      `SELECT onboarding_config FROM portal_organisations WHERE id = ?`, [orgId]);
    let inbox = this.settings.get('onboarding_inbox_email') || '';
    try { if (row?.onboarding_config) { const c = JSON.parse(row.onboarding_config); if (c.inboxEmail) inbox = c.inboxEmail; } } catch { /* fallback */ }
    return inbox;
  }

  /** Step 1 (backlog #8) — Membership Application. Creates the onboarding record
   *  only; no tickets and no SLA until the setup form (step 2) arrives. */
  async submitMembershipApplication(
    input: PortalMembershipApplicationInput, portalUserId: number, orgId: number, userEmail: string, userName: string,
  ): Promise<{ recordId: number; ref: string }> {
    if (!this.records || !(await this.isGuildEnabled(orgId))) {
      throw new Error('Onboarding is not enabled for your organisation.');
    }
    await trackEvent('form_completed', portalUserId, orgId, { category: 'membership_application' });
    const ref = this.newRef();
    const recordId = await this.records.create({
      onboarding_ref: ref, channel: 'guild', org_id: orgId,
      office_name: input.brand, branch_name: input.branch,
      invoice_commencement_date: input.invoiceCommencementDate || null,
      stage: 'application', application_data: JSON.stringify(input),
      reporter_email: userEmail,
    });
    const inbox = await this.orgInbox(orgId);
    if (inbox && this.email?.isConfigured()) {
      const office = [input.brand, input.branch].filter(Boolean).join(' — ');
      await this.email.send({
        to: inbox,
        subject: `New Guild membership application — ${office}`,
        text: `A new Guild membership application was submitted by ${userName} for ${office}. The setup form (which creates the tickets) will follow. NOVA ref: ${ref}.`,
        html: `<p>A new Guild membership application was submitted by <strong>${userName}</strong> for <strong>${office}</strong>.</p><p>The setup form (which creates the tickets) will follow.</p><p>NOVA ref: ${ref}</p>`,
      }).catch(err => console.warn('[portal-intake] application inbox alert failed:', err instanceof Error ? err.message : err));
    }
    return { recordId, ref };
  }

  /** Step 2 (backlog #8) — Setup form (Standard or Multi-branch). Attaches to an
   *  existing application (if applicationId given) or creates a fresh record,
   *  then fires the QA parent + 7 children and starts the 30-day SLA. */
  async submitGuildSetup(
    input: PortalOnboardingSetupInput, portalUserId: number, orgId: number, userEmail: string, userName: string,
  ): Promise<{ ticketKey: string; recordId: number }> {
    if (!this.records || !this.guild || !(await this.isGuildEnabled(orgId))) {
      throw new Error('Onboarding is not enabled for your organisation.');
    }
    await trackEvent('form_completed', portalUserId, orgId, { category: 'onboarding_setup' });
    const now = new Date().toISOString();

    let recordId: number;
    if (input.applicationId) {
      const existing = await this.records.getById(input.applicationId);
      if (!existing || existing.org_id !== orgId) throw new Error('Application not found for your organisation.');
      recordId = existing.id;
      await this.records.update(recordId, {
        stage: 'setup', plan_type: input.planType, setup_date: now, setup_data: JSON.stringify(input),
        office_name: input.brand || existing.office_name, branch_name: input.branch || existing.branch_name,
        reporter_email: existing.reporter_email || userEmail,
      });
    } else {
      recordId = await this.records.create({
        onboarding_ref: this.newRef(), channel: 'guild', org_id: orgId,
        office_name: input.brand, branch_name: input.branch,
        invoice_commencement_date: input.invoiceCommencementDate || null,
        stage: 'setup', plan_type: input.planType,
        reporter_email: userEmail,
      });
      await this.records.update(recordId, { setup_date: now, setup_data: JSON.stringify(input) });
    }

    const record = await this.records.getById(recordId);
    if (!record) throw new Error('Onboarding record vanished after creation');

    let result;
    try {
      result = await this.guild.createForRecord(record);
    } catch (err) {
      console.error('[portal-intake] Guild setup creation failed:', err);
      await logError('portal-intake', err, { severity: 'critical', context: { phase: 'guild-setup', recordId } });
      throw new Error('We couldn\'t create your onboarding right now. Please try again, or contact us directly at support@nurtur.tech.');
    }

    await execute(
      `INSERT INTO portal_form_submissions (portal_user_id, jira_issue_key, form_data, category)
       VALUES (?, ?, ?, ?)`,
      [portalUserId, result.parentKey, JSON.stringify({ ...input, onboardingRef: record.onboarding_ref, childKeys: result.childKeys }), 'onboarding_request'],
    );
    await this.notifyOnboardingInbox(record, result, userName, await this.orgInbox(orgId)).catch(err =>
      console.warn('[portal-intake] Onboarding inbox alert failed:', err instanceof Error ? err.message : err));
    await trackEvent('ticket_created', portalUserId, orgId, { ticket_key: result.parentKey, category: 'onboarding_setup' });
    return { ticketKey: result.parentKey, recordId };
  }

  /** List application-stage records for the org, for the setup form's picker. */
  async listOpenApplications(orgId: number): Promise<Array<{ id: number; ref: string; office: string; brand: string | null; branch: string | null; submittedAt: string }>> {
    if (!this.records) return [];
    const rows = await this.records.listOpenApplications(orgId);
    return rows.map(r => ({
      id: r.id, ref: r.onboarding_ref,
      office: [r.office_name, r.branch_name].filter(Boolean).join(' — ') || '(unnamed)',
      brand: r.office_name, branch: r.branch_name,
      submittedAt: r.submission_date,
    }));
  }

  /** R2 — alert the onboarding inbox that a new Guild onboarding was submitted,
   *  linking back to the NOVA record. Best-effort; needs `onboarding_inbox_email`. */
  private async notifyOnboardingInbox(
    record: { id: number; onboarding_ref: string; office_name: string | null; branch_name: string | null },
    result: { parentKey: string; childKeys: Record<string, string> },
    submittedBy: string,
    inbox: string,
  ): Promise<void> {
    if (!inbox || !this.email || !this.email.isConfigured()) return;
    const base = (this.settings.get('app_base_url') || '').replace(/\/$/, '');
    const link = base ? `${base}/portal/#onboarding-record/${record.id}` : `Onboarding record #${record.id}`;
    const office = [record.office_name, record.branch_name].filter(Boolean).join(' — ') || 'New office';
    const children = Object.entries(result.childKeys).map(([k, v]) => `${k}: ${v}`).join(', ');
    await this.email.send({
      to: inbox,
      subject: `New Guild onboarding — ${office} (${result.parentKey})`,
      text: `A new Guild onboarding was submitted by ${submittedBy}.\n\nOffice/branch: ${office}\nQA parent: ${result.parentKey}\nChildren: ${children}\nRef: ${record.onboarding_ref}\n\nNOVA record: ${link}`,
      html: `<p>A new Guild onboarding was submitted by <strong>${submittedBy}</strong>.</p>`
        + `<p><strong>Office/branch:</strong> ${office}<br><strong>QA parent:</strong> ${result.parentKey}<br>`
        + `<strong>Children:</strong> ${children}<br><strong>Ref:</strong> ${record.onboarding_ref}</p>`
        + `<p><a href="${link}">Open the NOVA onboarding record</a></p>`,
    });
  }

  getProjectForCategory(category: string, subcategory?: string): string {
    if (subcategory) {
      const subKey = subcategory.toLowerCase();
      const subSettings = this.settings.get(`portal_category_project_${subKey}`);
      if (subSettings) return subSettings;
      if (CATEGORY_TO_PROJECT[subKey]) return CATEGORY_TO_PROJECT[subKey];
    }
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
