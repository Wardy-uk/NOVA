import type { IntegrationDefinition } from '../../shared/types.js';

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
    case 'jira':
      return {
        command: uvxCommand,
        args: ['mcp-atlassian'],
        env: {
          JIRA_URL: settings.jira_url ?? '',
          JIRA_USERNAME: settings.jira_username ?? '',
          JIRA_API_TOKEN: settings.jira_token ?? '',
        },
      };
    case 'msgraph':
      return {
        command: 'npx',
        args: ['@softeria/ms-365-mcp-server', '--preset', 'tasks,calendar,mail'],
      };
    case 'monday':
      return {
        command: 'npx',
        args: [
          '@mondaydotcomorg/monday-api-mcp@latest',
          '--read-only',
          '-t',
          settings.monday_token ?? '',
        ],
      };
    default:
      return null;
  }
}
