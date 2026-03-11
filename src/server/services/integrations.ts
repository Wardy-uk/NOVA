import path from 'path';
import { fileURLToPath } from 'url';
import type { IntegrationDefinition } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Project root: src/server/services/ → 3 levels up
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const MS365_DATA_DIR = path.join(PROJECT_ROOT, 'data');

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
    description: 'Planner tasks, To-Do lists, Calendar events, and flagged emails. Sign in with your Microsoft account.',
    enabledKey: 'msgraph_enabled',
    authType: 'device_code',
    fields: [],
  },
  {
    id: 'monday',
    name: 'Monday.com',
    description: 'Monday.com boards and items. Syncs active tasks from all or selected boards.',
    enabledKey: 'monday_enabled',
    authType: 'credentials',
    fields: [
      { key: 'monday_token', label: 'API Token', type: 'password', placeholder: 'Monday.com API token', required: true },
      { key: 'monday_board_ids', label: 'Board IDs', type: 'text', placeholder: 'Comma-separated (optional, blank = all)', required: false },
    ],
  },
  {
    id: 'dynamics365',
    name: 'Dynamics 365',
    description: 'Microsoft Dynamics 365 CRM (nurtur-prod). Sign in with your Microsoft account to sync accounts.',
    enabledKey: 'd365_enabled',
    authType: 'device_code',
    fields: [
      { key: 'd365_client_id', label: 'Client ID', type: 'text', placeholder: 'Azure AD app registration client ID', required: true },
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
    // Jira uses direct REST API (per-user credentials) — no MCP server needed
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
    case 'monday': {
      // Use globally-installed package directly to avoid npx cache corruption
      // (OpenTelemetry EPERM on Windows breaks npx cache)
      const mondayEntry = process.env.APPDATA
        ? `${process.env.APPDATA}\\npm\\node_modules\\@mondaydotcomorg\\monday-api-mcp\\dist\\index.js`
        : 'mcp-server-monday-api';
      return {
        command: 'node',
        args: [
          mondayEntry,
          '--read-only',
          '-t',
          settings.monday_token ?? '',
        ],
        env: {
          OTEL_SDK_DISABLED: 'true',
        },
      };
    }
    default:
      return null;
  }
}
