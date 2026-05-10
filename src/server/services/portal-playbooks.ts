import { query } from './database.js';
import type { FileSettingsQueries } from '../db/settings-store.js';

interface Playbook {
  id: string;
  name: string;
  trigger_categories: string[];
  trigger_keywords: string[];
  steps: PlaybookStep[];
  resolution_message: string;
}

interface PlaybookStep {
  type: 'ask' | 'check' | 'action' | 'confirm';
  prompt?: string;
  check?: string;
  action?: string;
}

interface PlaybookMatchResult {
  response: string;
  playbookId: string;
  resolved: boolean;
}

interface ChatContext {
  orgName: string;
  userName: string;
  userEmail: string;
  orgId: number;
  portalUserId: number;
}

const DEFAULT_PLAYBOOKS: Playbook[] = [
  {
    id: 'password_reset',
    name: 'Password / Access Reset',
    trigger_categories: ['Access', 'Login', 'Password'],
    trigger_keywords: ['password', 'can\'t log in', 'cannot login', 'locked out', 'reset password', 'access denied', 'forgot password'],
    steps: [
      { type: 'action', action: 'search_kb' },
      { type: 'confirm', prompt: 'Did the self-service reset steps resolve your issue?' },
    ],
    resolution_message: 'You can reset your password via the self-service portal. Go to the login page and click "Forgot Password". Enter your email address and follow the instructions in the reset email. If you don\'t receive the email within a few minutes, check your spam folder.\n\nIf the self-service reset doesn\'t work, I can create a support ticket for our team to assist you.',
  },
  {
    id: 'known_error',
    name: 'Known Error Lookup',
    trigger_categories: ['Error', 'Bug'],
    trigger_keywords: ['error', 'not working', 'broken', 'bug', 'crash', 'fails', 'failure', 'issue with'],
    steps: [
      { type: 'check', check: 'match_known_error' },
      { type: 'action', action: 'provide_workaround' },
    ],
    resolution_message: 'I found information about this issue in our knowledge base.',
  },
  {
    id: 'config_howto',
    name: 'Configuration How-To',
    trigger_categories: ['Configuration', 'Setup', 'Template'],
    trigger_keywords: ['how to', 'how do i', 'configure', 'set up', 'setup', 'change setting', 'template', 'branding', 'feed'],
    steps: [
      { type: 'action', action: 'search_kb' },
    ],
    resolution_message: 'Here are the steps from our knowledge base.',
  },
  {
    id: 'status_check',
    name: 'Ticket Status Check',
    trigger_categories: ['Status'],
    trigger_keywords: ['status', 'update on', 'what\'s happening', 'progress', 'my ticket', 'any update', 'when will'],
    steps: [
      { type: 'check', check: 'lookup_tickets' },
    ],
    resolution_message: 'Here\'s the current status of your tickets.',
  },
  {
    id: 'system_status',
    name: 'System Status / Downtime',
    trigger_categories: ['Outage', 'Downtime'],
    trigger_keywords: ['is it down', 'system down', 'outage', 'maintenance', 'not loading', 'unavailable', 'site down', 'can\'t access'],
    steps: [
      { type: 'check', check: 'check_incidents' },
    ],
    resolution_message: 'I\'ve checked our system status for you.',
  },
];

export class PortalPlaybookService {
  constructor(private settings: FileSettingsQueries) {}

  private getPlaybooks(): Playbook[] {
    try {
      const custom = this.settings.get('portal_playbooks');
      if (custom) return JSON.parse(custom);
    } catch { /* use defaults */ }
    return DEFAULT_PLAYBOOKS;
  }

  async tryMatch(
    userMessage: string,
    sessionId: number,
    context: ChatContext,
  ): Promise<PlaybookMatchResult | null> {
    const lower = userMessage.toLowerCase();
    const playbooks = this.getPlaybooks();

    const matched = playbooks.find(pb =>
      pb.trigger_keywords.some(kw => lower.includes(kw.toLowerCase()))
    );

    if (!matched) return null;

    // Execute playbook steps
    for (const step of matched.steps) {
      if (step.type === 'check' && step.check === 'check_incidents') {
        return this.handleIncidentCheck(matched.id, context);
      }
      if (step.type === 'check' && step.check === 'lookup_tickets') {
        return this.handleTicketLookup(matched.id, context);
      }
    }

    return {
      response: matched.resolution_message,
      playbookId: matched.id,
      resolved: false,
    };
  }

  private async handleIncidentCheck(playbookId: string, context: ChatContext): Promise<PlaybookMatchResult> {
    try {
      const incidents = await query<{ title: string; severity: string; status: string; started_at: string }>(
        `SELECT TOP 5 title, severity, status, started_at FROM agent_incidents
         WHERE status IN ('investigating', 'identified', 'monitoring')
         ORDER BY started_at DESC`,
      );

      if (incidents.length > 0) {
        const list = incidents.map(i =>
          `- **${i.title}** (${i.severity}) — Status: ${i.status}, since ${new Date(i.started_at).toLocaleString()}`
        ).join('\n');
        return {
          response: `There are currently **${incidents.length}** active incident(s):\n\n${list}\n\nOur team is working on resolving these. If your issue is related to one of these incidents, no further action is needed — we'll update you when it's resolved.`,
          playbookId,
          resolved: true,
        };
      }

      return {
        response: 'All systems are currently operational. There are no known incidents or outages at this time.\n\nIf you\'re experiencing an issue, could you describe what\'s happening? I can help troubleshoot or create a support ticket.',
        playbookId,
        resolved: true,
      };
    } catch {
      return {
        response: 'I wasn\'t able to check the system status at the moment. If you\'re experiencing an issue, please describe what\'s happening and I\'ll help you from there.',
        playbookId,
        resolved: false,
      };
    }
  }

  private async handleTicketLookup(playbookId: string, context: ChatContext): Promise<PlaybookMatchResult> {
    try {
      const tickets = await query<{ issue_key: string; summary: string; status: string; updated: string }>(
        `SELECT TOP 5 issue_key, summary, status, updated FROM jira_issue_cache
         WHERE organisation = ? AND status NOT IN ('Closed', 'Resolved', 'Done')
         ORDER BY updated DESC`,
        [context.orgName],
      );

      if (tickets.length === 0) {
        return {
          response: 'I couldn\'t find any open tickets for your organisation. If you have a specific ticket reference number, please share it and I can look it up directly.',
          playbookId,
          resolved: true,
        };
      }

      const list = tickets.map(t =>
        `- **${t.issue_key}**: ${t.summary} — *${t.status}* (updated ${new Date(t.updated).toLocaleDateString()})`
      ).join('\n');

      return {
        response: `Here are your organisation's open tickets:\n\n${list}\n\nWould you like more details on any of these, or is there a specific ticket you're asking about?`,
        playbookId,
        resolved: true,
      };
    } catch {
      return {
        response: 'I wasn\'t able to look up your tickets right now. Could you share the ticket reference number? I can try to find it directly.',
        playbookId,
        resolved: false,
      };
    }
  }
}
