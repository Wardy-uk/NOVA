import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { IntegrationDefinition } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Find project root by walking up until we find package.json
function findProjectRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir; // fallback
}
const PROJECT_ROOT = findProjectRoot(__dirname);
const MS365_DATA_DIR = path.join(PROJECT_ROOT, 'data');
console.log(`[MS365] Token cache dir: ${MS365_DATA_DIR}`);

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: 'jira',
    name: 'Jira',
    description: 'Atlassian Jira Cloud. Syncs assigned issues with SLA data.',
    enabledKey: 'jira_enabled',
    authType: 'credentials',
    fields: [
      { key: 'jira_url', label: 'Jira URL', type: 'url', placeholder: 'https://yourorg.atlassian.net', required: true },
      { key: 'jira_username', label: 'Email', type: 'text', placeholder: 'you@company.com', required: true },
      { key: 'jira_token', label: 'API Token', type: 'password', placeholder: 'From id.atlassian.com/manage-profile/security/api-tokens', required: true },
    ],
  },
  {
    id: 'jira-servicedesk',
    name: 'Service Desk Config',
    description: 'Global Service Desk filters. Controls which Jira project and tiers appear across all users.',
    enabledKey: 'jira_sd_enabled',
    authType: 'credentials',
    fields: [
      { key: 'jira_sd_project', label: 'Project Key', type: 'text', placeholder: 'e.g. NT', required: false },
      { key: 'jira_sd_tiers', label: 'Exclude Tiers', type: 'text', placeholder: 'e.g. Development (comma-separated tiers to hide)', required: false },
    ],
  },
  {
    id: 'jira-onboarding',
    name: 'Jira (Global)',
    description: 'Global Jira connection via api.atlassian.com. Used for onboarding tickets, service desk, and all global Jira operations. Basic auth (email + API token).',
    enabledKey: 'jira_ob_enabled',
    authType: 'credentials',
    fields: [
      { key: 'jira_ob_cloud_id', label: 'Cloud ID', type: 'text', placeholder: 'From admin.atlassian.com → Settings (UUID)', required: true },
      { key: 'jira_ob_url', label: 'Jira URL (for browse links)', type: 'url', placeholder: 'https://yourorg.atlassian.net', required: false },
      { key: 'jira_ob_email', label: 'Email', type: 'text', placeholder: 'you@company.com', required: true },
      { key: 'jira_ob_token', label: 'API Token', type: 'password', placeholder: 'From id.atlassian.com/manage-profile/security/api-tokens', required: true },
      { key: 'jira_ob_project', label: 'Project Key', type: 'text', placeholder: 'NT', required: false },
      { key: 'assignment_projects', label: 'Round-Robin Projects', type: 'text', placeholder: 'NT,NTPJ — projects for auto-assignment (comma-separated)', required: false },
      { key: 'jira_ob_issue_type', label: 'Issue Type', type: 'text', placeholder: 'Service Request', required: false },
      { key: 'jira_ob_request_type_field', label: 'Request Type Field ID', type: 'text', placeholder: 'customfield_10010', required: false },
      { key: 'jira_ob_rt_qa_id', label: 'Delivery QA Request Type ID', type: 'text', placeholder: 'Request type ID for QA parent', required: false },
      { key: 'jira_ob_rt_onboarding_id', label: 'Onboarding Request Type ID', type: 'text', placeholder: 'Request type ID for child tickets', required: false },
      { key: 'jira_ob_link_type', label: 'Link Type Name', type: 'text', placeholder: 'Blocks', required: false },
    ],
  },
  {
    id: 'msgraph',
    name: 'Microsoft 365',
    description: 'Microsoft authentication for onboarding workflows.',
    enabledKey: 'msgraph_enabled',
    authType: 'device_code',
    fields: [],
  },
  {
    id: 'dynamics365',
    name: 'Dynamics 365',
    description: 'Microsoft Dynamics 365 CRM (nurtur-prod). Sign in with your Microsoft account to sync accounts.',
    enabledKey: 'd365_enabled',
    authType: 'device_code',
    fields: [
      { key: 'd365_base_url', label: 'Base URL', type: 'url', placeholder: 'https://nurtur-prod.crm11.dynamics.com', required: true },
      { key: 'd365_client_id', label: 'Client ID', type: 'text', placeholder: 'Azure AD app registration client ID', required: true },
      { key: 'd365_client_secret', label: 'Client Secret', type: 'password', placeholder: 'Azure AD app client secret', required: true },
      { key: 'd365_tenant_id', label: 'Tenant ID', type: 'text', placeholder: 'Azure AD directory (tenant) ID', required: true },
    ],
  },
  {
    id: 'sso',
    name: 'Entra ID SSO',
    description: 'Microsoft Entra ID single sign-on. Allows users to sign in with their Microsoft work account.',
    enabledKey: 'sso_enabled',
    authType: 'credentials',
    fields: [
      { key: 'sso_tenant_id', label: 'Tenant ID', type: 'text', placeholder: 'Azure AD directory (tenant) ID', required: true },
      { key: 'sso_client_id', label: 'Client ID', type: 'text', placeholder: 'Azure AD app registration client ID', required: true },
      { key: 'sso_client_secret', label: 'Client Secret', type: 'password', placeholder: 'Azure AD app registration client secret', required: true },
      { key: 'sso_base_url', label: 'Base URL', type: 'url', placeholder: 'https://nova.nurtur.tech (auto-detected if blank)', required: false },
      { key: 'sso_group_roles', label: 'Group → Role Mapping', type: 'group_roles', placeholder: '', required: false },
    ],
  },
  {
    id: 'sharepoint',
    name: 'SharePoint Online',
    description: 'Direct Microsoft Graph API for SharePoint file sync (delivery sheet). Uses app-level credentials — no interactive login needed.',
    enabledKey: 'sp_enabled',
    authType: 'credentials',
    fields: [
      { key: 'sp_tenant_id', label: 'Tenant ID', type: 'text', placeholder: 'Azure AD directory (tenant) ID', required: true },
      { key: 'sp_client_id', label: 'Client ID', type: 'text', placeholder: 'Azure AD app registration client ID', required: true },
      { key: 'sp_client_secret', label: 'Client Secret', type: 'password', placeholder: 'Azure AD app registration client secret', required: true },
      { key: 'sp_site_url', label: 'Site ID', type: 'text', placeholder: 'nurturcloud.sharepoint.com:/sites/Nurtur', required: false },
      { key: 'sp_drive_hint', label: 'Drive Name', type: 'text', placeholder: 'Documents', required: false },
      { key: 'sp_folder_path', label: 'Folder Path', type: 'text', placeholder: 'Clients/Tech/!Overview Documents', required: false },
      { key: 'sp_file_name', label: 'File Name', type: 'text', placeholder: 'Delivery sheet Master.xlsx', required: false },
    ],
  },
  {
    id: 'smtp',
    name: 'Email',
    description: 'Built-in email for invites and notifications. Only a From address is needed — sends directly. Optionally add an SMTP relay.',
    enabledKey: 'smtp_enabled',
    authType: 'credentials',
    fields: [
      { key: 'smtp_from', label: 'From Address', type: 'text', placeholder: 'noreply@nurtur.tech', required: true },
      { key: 'smtp_host', label: 'SMTP Relay (optional)', type: 'text', placeholder: 'Leave blank for direct delivery', required: false },
      { key: 'smtp_port', label: 'Port', type: 'text', placeholder: '587', required: false },
      { key: 'smtp_user', label: 'Relay Username', type: 'text', placeholder: 'Only if using a relay', required: false },
      { key: 'smtp_pass', label: 'Relay Password', type: 'password', placeholder: 'Only if using a relay', required: false },
    ],
  },
  {
    id: 'jira-oauth',
    name: 'Jira OAuth',
    description: 'Jira Cloud OAuth 3LO. Users connect their own Jira account. Configure app credentials from developer.atlassian.com.',
    enabledKey: 'jira_oauth_enabled',
    authType: 'credentials',
    fields: [
      { key: 'jira_oauth_client_id', label: 'OAuth Client ID', type: 'text', placeholder: 'From Atlassian developer console', required: true },
      { key: 'jira_oauth_client_secret', label: 'OAuth Client Secret', type: 'password', placeholder: 'From Atlassian developer console', required: true },
    ],
  },
  {
    id: 'azdo',
    name: 'Azure DevOps',
    description: 'Push brand settings to Azure DevOps repo. Creates branches and pull requests for site deployments.',
    enabledKey: 'azdo_enabled',
    authType: 'credentials',
    fields: [
      { key: 'azdo_org', label: 'Organization', type: 'text', placeholder: 'e.g. nurtur-group', required: true },
      { key: 'azdo_project', label: 'Project', type: 'text', placeholder: 'e.g. Website.Settings', required: true },
      { key: 'azdo_repo', label: 'Repository', type: 'text', placeholder: 'e.g. Website.Settings', required: true },
      { key: 'azdo_pat', label: 'PAT', type: 'password', placeholder: 'Personal Access Token (Code read/write)', required: true },
      { key: 'azdo_base_branch', label: 'Base Branch', type: 'text', placeholder: 'main (default)', required: false },
    ],
  },
  {
    id: 'bym-setup',
    name: 'BriefYourMarket Setup',
    description: 'Direct API integration — pushes brands, branches, logos, portal accounts, and districts to BriefYourMarket + BuildYourMarket instances.',
    enabledKey: 'bym_enabled',
    authType: 'credentials',
    fields: [
      { key: 'bym_api_key', label: 'API Key (Basic Auth, base64)', type: 'password', placeholder: 'Base64-encoded API key', required: true },
      { key: 'bym_url_template', label: 'Instance URL Template', type: 'url', placeholder: 'https://{0}.briefyourmarket.services/', required: true },
      { key: 'bym_build_api_url', label: 'BuildYourMarket API URL', type: 'url', placeholder: 'https://buildyourmarketapi-live.azurewebsites.net/', required: true },
      { key: 'bym_image_url', label: 'Image Service URL', type: 'url', placeholder: 'https://bymmedia-dev.azurewebsites.net', required: true },
      { key: 'bym_config_api_url', label: 'Config API URL (Robocop)', type: 'url', placeholder: 'https://configapi.briefyourmarket.com', required: false },
    ],
  },
  {
    id: 'business-central',
    name: 'Business Central',
    description: 'Microsoft Dynamics 365 Business Central. Syncs customers and sales orders for the Contracts screen.',
    enabledKey: 'bc_enabled',
    authType: 'credentials',
    fields: [
      { key: 'bc_tenant_id', label: 'Tenant ID', type: 'text', placeholder: 'Azure AD directory (tenant) ID', required: true },
      { key: 'bc_client_id', label: 'Client ID', type: 'text', placeholder: 'App registration client ID', required: true },
      { key: 'bc_client_secret', label: 'Client Secret', type: 'password', placeholder: 'App registration client secret', required: true },
      { key: 'bc_environment', label: 'Environment', type: 'text', placeholder: 'Production', required: true },
      { key: 'bc_company_id', label: 'Company ID', type: 'text', placeholder: 'BC company GUID', required: true },
    ],
  },
  {
    id: 'business-central-subscription-import',
    name: 'BC — Subscription Import',
    description: 'Custom Business Central API for pushing signed Adobe contracts into the Imported Customer Subscription Contracts staging tables. Uses the same app registration credentials as the main Business Central integration (Tenant ID, Client ID and Client Secret are reused) — only the BC environment and company differ, typically pointing at a test/sandbox environment.',
    enabledKey: 'bc_sub_enabled',
    authType: 'credentials',
    fields: [
      { key: 'bc_sub_environment', label: 'Environment', type: 'text', placeholder: 'e.g. DA-260318', required: true },
      { key: 'bc_sub_company_id', label: 'Company ID', type: 'text', placeholder: 'BC test company GUID', required: true },
    ],
  },
  {
    id: 'kpi-sql',
    name: 'KPI SQL Server',
    description: 'SQL Server connection for Jira Support DB KPI data. Used by the KPIs area to display team and agent metrics.',
    enabledKey: 'kpi_sql_enabled',
    authType: 'credentials',
    fields: [
      { key: 'kpi_sql_server', label: 'Server', type: 'text', placeholder: 'your-server.database.windows.net', required: true },
      { key: 'kpi_sql_database', label: 'Database', type: 'text', placeholder: 'JiraSupportDB', required: true },
      { key: 'kpi_sql_user', label: 'Username', type: 'text', placeholder: 'SQL username', required: true },
      { key: 'kpi_sql_password', label: 'Password', type: 'password', placeholder: 'SQL password', required: true },
      { key: 'kpi_jira_projects', label: 'Jira Projects (KPI)', type: 'text', placeholder: 'NT', required: false },
    ],
  },
  {
    id: 'adobe-sign',
    name: 'Adobe Sign',
    description: 'Adobe Acrobat Sign e-signature service. Send contracts for signature and track agreement status.',
    enabledKey: 'adobe_sign_enabled',
    authType: 'credentials',
    fields: [
      { key: 'adobe_sign_client_id', label: 'OAuth Client ID', type: 'text', placeholder: 'From Adobe Developer Console', required: true },
      { key: 'adobe_sign_client_secret', label: 'OAuth Client Secret', type: 'password', placeholder: 'From Adobe Developer Console', required: true },
      { key: 'adobe_sign_redirect_uri', label: 'Redirect URI', type: 'url', placeholder: 'https://nova.yourorg.com/api/adobe-sign/callback', required: true },
      { key: 'adobe_sign_api_base_url', label: 'API Base URL', type: 'text', placeholder: 'https://api.na1.adobesign.com (region-dependent)', required: true },
      { key: 'adobe_sign_refresh_token', label: 'Refresh Token', type: 'password', placeholder: 'Auto-populated after OAuth connection', required: false },
      { key: 'adobe_sign_terms_field_prefix', label: 'Terms Field Prefix', type: 'text', placeholder: 'contract terms (matches contract_terms_bym, contract terms yomdel, etc.)', required: false },
    ],
  },
  {
    id: 'contract-approvals',
    name: 'Contract Approvals',
    description: 'Approval workflow for contracts containing additional (non-pre-approved) terms. When configured, contracts with custom terms are held in NOVA, a webhook fires to your approval system (e.g. Power Automate → Teams), and the agreement is only released to Adobe Sign once an approver signs off. Leave the webhook empty to disable the approval workflow — contracts with custom terms will be blocked from sending.',
    enabledKey: 'contract_approvals_enabled',
    authType: 'credentials',
    fields: [
      { key: 'contract_approvals_webhook_url', label: 'Approval Webhook URL', type: 'url', placeholder: 'https://prod-XX.westeurope.logic.azure.com/workflows/... (Power Automate / Teams trigger)', required: false },
      { key: 'contract_approvals_webhook_secret', label: 'Shared Secret (optional)', type: 'password', placeholder: 'Used to sign webhook payloads and verify callbacks', required: false },
      { key: 'contract_approvals_callback_url', label: 'NOVA Callback URL (info only)', type: 'text', placeholder: 'https://nova.nurtur.tech/api/public/contract-approvals/callback — configure this URL in your Power Automate flow', required: false },
    ],
  },
  {
    id: 'llm',
    name: 'AI / LLM',
    description: 'LLM providers for agent reasoning — 3-tier routing across Anthropic, OpenAI, and OpenRouter.',
    enabledKey: 'llm_enabled',
    authType: 'credentials',
    fields: [
      { key: 'anthropic_api_key', label: 'Anthropic API Key', type: 'password', placeholder: 'sk-ant-...', required: true },
      { key: 'openai_api_key', label: 'OpenAI API Key', type: 'password', placeholder: 'sk-...', required: false },
      { key: 'openrouter_api_key', label: 'OpenRouter API Key', type: 'password', placeholder: 'sk-or-...', required: false },
      { key: 'llm_temperature', label: 'Temperature', type: 'text', placeholder: '0.3', required: false },
      { key: 'llm_max_tokens', label: 'Max Tokens', type: 'text', placeholder: '4096', required: false },
      { key: 'agent_model_routing', label: 'Tier Routing (JSON)', type: 'text', placeholder: '{"reasoning":{"primary":{"provider":"anthropic"}},...}', required: false },
    ],
  },
  {
    id: 'ai-agent',
    name: 'AI Agent',
    description: 'Autonomous agent loop — monitors Jira tickets, triages, and takes actions. Controls which projects the agent watches and whether it operates in shadow (observe-only) or live mode.',
    enabledKey: 'agent_enabled',
    authType: 'credentials',
    superAdminOnly: true,
    fields: [
      { key: 'agent_shadow_mode', label: 'Agent Mode', type: 'select', options: ['full_shadow', 'hybrid', 'live'], placeholder: 'full_shadow', required: false },
      { key: 'agent_hybrid_allowed_actions', label: 'Hybrid Allowed Actions (JSON)', type: 'text', placeholder: '["plugin_to_tpj","abuse_report"]', required: false },
      { key: 'agent_jira_project', label: 'Jira Projects', type: 'text', placeholder: 'NT,NTPJ', required: false },
      { key: 'agent_sweep_interval_ticks', label: 'Sweep Interval (ticks)', type: 'text', placeholder: '30', required: false },
      { key: 'agent_sweep_ai_request_hours', label: 'AI Request Stale (hours)', type: 'text', placeholder: '2', required: false },
      { key: 'agent_sweep_wor_chase_days', label: 'WOR Chase After (days)', type: 'text', placeholder: '5', required: false },
      { key: 'agent_sweep_wor_close_days', label: 'WOR Auto-Close After (days)', type: 'text', placeholder: '10', required: false },
      { key: 'agent_request_type_sweep_enabled', label: 'Request-Type Sweep Enabled', type: 'text', placeholder: 'true', required: false },
      { key: 'agent_request_type_sweep_project', label: 'Request-Type Sweep Project', type: 'text', placeholder: 'NT', required: false },
      { key: 'agent_request_type_sweep_limit', label: 'Request-Type Sweep Limit', type: 'text', placeholder: '50', required: false },
      { key: 'agent_teams_webhook_url', label: 'Teams Webhook URL (critical alerts)', type: 'url', placeholder: 'https://outlook.office.com/webhook/...', required: false },
      { key: 'agent_sla_breach_threshold_min', label: 'SLA Breach Alert (minutes)', type: 'text', placeholder: '30', required: false },
      { key: 'agent_unassigned_stale_min', label: 'Unassigned Stale (minutes)', type: 'text', placeholder: '15', required: false },
      { key: 'agent_capacity_threshold', label: 'Capacity Alert (tickets/agent)', type: 'text', placeholder: '10', required: false },
      { key: 'agent_risk_threshold', label: 'Risk Alert Threshold (0-100)', type: 'text', placeholder: '60', required: false },
      { key: 'agent_risk_alert_hours', label: 'Risk Alert Hours (HH:MM-HH:MM)', type: 'text', placeholder: '08:00-18:00', required: false },
      { key: 'agent_risk_alert_to', label: 'Risk Alert Webhook (override)', type: 'url', placeholder: 'Uses Teams Webhook if blank', required: false },
      { key: 'agent_comment_exclude_accounts', label: 'Exclude Account IDs (comma-separated)', type: 'text', placeholder: 'Jira account IDs to ignore (n8n bot, service accounts)', required: false },
      { key: 'agent_known_agent_names', label: 'Known Agent Names (comma-separated)', type: 'text', placeholder: 'Zoe Rees,Stephen Mitchell,Nick Ward', required: false },
      { key: 'agent_go_live_date', label: 'Agent Go-Live Date', type: 'text', placeholder: '2026-04-23', required: false },
      { key: 'agent_briefing_time', label: 'Daily Briefing Time (HH:MM)', type: 'text', placeholder: '07:00', required: false },
      { key: 'agent_briefing_email_enabled', label: 'Briefing Email', type: 'toggle', placeholder: 'true', required: false },
      { key: 'agent_kb_confluence_space', label: 'KB Confluence Space Key', type: 'text', placeholder: 'SUPPORT', required: false },
      { key: 'agent_kb_parent_page_id', label: 'KB Parent Page ID', type: 'text', placeholder: 'Confluence parent page ID for KB articles', required: false },
      { key: 'agent_weekend_mode', label: 'Out-of-Hours Reduced Mode', type: 'toggle', placeholder: 'true', required: false },
      { key: 'agent_backfill_enabled', label: 'Backfill Untriaged Tickets (every tick)', type: 'toggle', placeholder: 'true', required: false },
      { key: 'agent_backfill_batch_size', label: 'Backfill Batch Size (tickets/tick)', type: 'text', placeholder: '10', required: false },
      { key: 'assignment_max_per_run_cc', label: 'Assignment Max/Run — Customer Care', type: 'text', placeholder: '30', required: false },
      { key: 'assignment_max_per_run_t2', label: 'Assignment Max/Run — Tier 2', type: 'text', placeholder: '30', required: false },
      { key: 'agent_sweep_limit', label: 'Unassigned Sweep Fetch Limit (per run)', type: 'text', placeholder: '30', required: false },
      { key: 'agent_sweep_interval_ticks', label: 'Sweep Interval (ticks, ~1 tick/min)', type: 'text', placeholder: '30', required: false },
      { key: 'agent_sweep_max_age_hours', label: 'Sweep Max Ticket Age (hours, 0 = no cap)', type: 'text', placeholder: '0', required: false },
      { key: 'agent_working_hours', label: 'Working Hours (HH:MM-HH:MM)', type: 'text', placeholder: '08:00-18:00', required: false },
      { key: 'agent_working_days', label: 'Working Days (0=Sun, 6=Sat)', type: 'text', placeholder: '1,2,3,4,5', required: false },
      { key: 'abuse_report_db_connection', label: 'Abuse Report DB Connection', type: 'password', placeholder: 'Server=...;Database=...;User Id=...;Password=...', required: false },
      { key: 'abuse_report_admin_db_connection', label: 'Abuse Report Admin DB Connection', type: 'password', placeholder: 'Server=...;Database=...;User Id=...;Password=...', required: false },
    ],
  },
  {
    id: 'people-hr',
    name: 'People HR',
    description: 'PeopleHR API for team calendar sync — absences, holidays, and availability.',
    enabledKey: 'people_hr_enabled',
    authType: 'credentials',
    fields: [
      { key: 'people_hr_api_key', label: 'API Key', type: 'password', placeholder: 'PeopleHR API key', required: true },
      { key: 'people_hr_base_url', label: 'Base URL', type: 'url', placeholder: 'https://api.peoplehr.net', required: false },
    ],
  },
  {
    id: 'teams-webhook',
    name: 'Teams Webhook',
    description: 'Microsoft Teams incoming webhook for critical alerts and notifications.',
    enabledKey: 'teams_webhook_enabled',
    authType: 'credentials',
    fields: [
      { key: 'teams_webhook_url', label: 'Webhook URL', type: 'password', placeholder: 'https://outlook.office.com/webhook/...', required: true },
    ],
  },
  {
    id: 'kb-retrieval',
    name: 'Knowledge Base Retrieval',
    description: 'RAG-based knowledge base — indexes TFS docs and Confluence pages into a vector store for AI-assisted ticket triage.',
    enabledKey: 'kb_retrieval_enabled',
    authType: 'credentials',
    fields: [
      { key: 'tfs_docs_repo_url', label: 'TFS Docs Repo URL', type: 'url', placeholder: 'https://tfs.briefyourmarket.com/BYM2020/Core/_git/nurtur-docs', required: false },
      { key: 'tfs_docs_pat', label: 'TFS PAT (Code Read)', type: 'password', placeholder: 'Azure DevOps Personal Access Token', required: false },
      { key: 'tfs_docs_branch', label: 'TFS Branch', type: 'text', placeholder: 'main', required: false },
      { key: 'tfs_docs_sync_interval_min', label: 'TFS Sync Interval (min)', type: 'text', placeholder: '60', required: false },
      { key: 'confluence_site_url', label: 'Confluence Site URL', type: 'url', placeholder: 'https://yourorg.atlassian.net', required: false },
      { key: 'kb_confluence_space_keys', label: 'Confluence Space Keys', type: 'text', placeholder: 'SUPPORT,ENG (comma-separated)', required: false },
      { key: 'kb_confluence_email', label: 'KB Confluence Email', type: 'text', placeholder: 'Overrides Jira (Global) email for Confluence sync', required: false },
      { key: 'kb_confluence_token', label: 'KB Confluence API Token', type: 'password', placeholder: 'Overrides Jira (Global) token. Leave blank to use Jira token.', required: false },
      { key: 'confluence_sync_interval_min', label: 'Confluence Sync Interval (min)', type: 'text', placeholder: '60', required: false },
      { key: 'kb_embedding_model', label: 'Embedding Model', type: 'text', placeholder: 'text-embedding-3-small', required: false },
      { key: 'kb_chunk_target_tokens', label: 'Chunk Target Tokens', type: 'text', placeholder: '600', required: false },
      { key: 'kb_chunk_overlap_tokens', label: 'Chunk Overlap Tokens', type: 'text', placeholder: '80', required: false },
      { key: 'kb_top_k', label: 'Search Top-K', type: 'text', placeholder: '3', required: false },
    ],
  },
  {
    id: 'whisper',
    name: 'Whisper (Speech-to-Text)',
    description: 'OpenAI Whisper API for call recording transcription (used by Call Reviews).',
    enabledKey: 'whisper_enabled',
    authType: 'credentials',
    fields: [
      { key: 'whisper_api_url', label: 'Whisper API URL', type: 'url', placeholder: 'https://api.openai.com/v1/audio/transcriptions', required: true },
      { key: 'whisper_api_key', label: 'API Key (if different from OpenAI)', type: 'password', placeholder: 'Uses OpenAI key if blank', required: false },
    ],
  },
  {
    id: 'plaud',
    name: 'Plaud',
    description: 'Plaud voice recorder — imports the daily standup transcript and AI notes via the official Plaud MCP server (npx @plaud-ai/mcp). Auth is a one-time browser OAuth on the server (tokens auto-refresh); no API key needed. Use the "Connect" action to sign in.',
    enabledKey: 'plaud_enabled',
    authType: 'device_code',
    fields: [],
  },
  {
    id: 'agentic-brain',
    name: 'Agentic Brain',
    description: 'AgentBrain — the cross-customer issue router. It classifies + attributes support tickets (JSM + Zendesk) and POSTs issue cards into NOVA Risk Intelligence at /api/public/webhooks/issue-router, authenticated with the shared secret below (sent in the x-issue-router-secret header). Agree the secret with the AgentBrain owner and paste it here.',
    enabledKey: 'issue_router_enabled',
    authType: 'credentials',
    fields: [
      { key: 'issue_router_secret', label: 'Shared Secret', type: 'password', placeholder: 'Agreed with AgentBrain; sent in the x-issue-router-secret header', required: true },
    ],
  },
];

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function buildMcpConfig(
  id: string,
  settings: Record<string, string>,
  uvxCommand: string
): McpServerConfig | null {
  switch (id) {
    // Jira uses direct REST API (per-user credentials) — no MCP server needed.
    // Plaud uses the hosted MCP over HTTP with OAuth — registered directly in
    // index.ts with its OAuth provider, not here.
    case 'msgraph': {
      return {
        command: 'npx',
        args: ['@softeria/ms-365-mcp-server', '--preset', 'tasks,calendar,mail,files', '--org-mode'],
        env: {
          MS365_MCP_TOKEN_CACHE_PATH: path.join(MS365_DATA_DIR, '.ms365-token-cache.json'),
          MS365_MCP_SELECTED_ACCOUNT_PATH: path.join(MS365_DATA_DIR, '.ms365-selected-account.json'),
        },
      };
    }
    default:
      return null;
  }
}
