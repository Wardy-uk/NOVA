import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

type PortalStatus =
  | 'Submitted'
  | 'Reviewed'
  | 'In Progress'
  | 'Awaiting Your Response'
  | 'Awaiting Third Party'
  | 'Resolved'
  | 'Closed';

type TicketSummary = {
  key: string;
  summary: string;
  status: PortalStatus;
  priority: string;
  created: string;
  updated: string;
  assignee: string | null;
  reporter: string | null;
  latestComment: string | null;
};

type TicketDetail = TicketSummary & {
  description: string | null;
  bcAccountNumber: string | null;
  comments: Array<{
    id: string;
    author: string;
    body: string;
    created: string;
    isInternal: boolean;
  }>;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    url: string;
  }>;
  statusHistory: Array<{
    from: PortalStatus | null;
    to: PortalStatus;
    changedAt: string;
    changedBy: string | null;
  }>;
  slaStatus: {
    name: string;
    remaining: string | null;
    breached: boolean;
  } | null;
};

type ChatSession = {
  id: number;
  portal_user_id: number;
  jira_issue_key: string | null;
  status: 'active' | 'resolved' | 'handed_off';
  started_at: string;
  ended_at: string | null;
  metadata: string | null;
};

type ChatMessage = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  metadata: string | null;
  created_at: string;
};

type SessionState = {
  stage: 'intent' | 'category' | 'detail' | 'summary' | 'confirmed';
  category: string | null;
  description: string | null;
  url: string | null;
  errorMessage: string | null;
  browser: string | null;
  subject: string | null;
};

const TEST_USER = {
  userId: -1,
  email: 'codex.portal.test@nurtur.tech',
  orgId: -1,
  orgName: 'Codex Test Organisation',
  role: 'requester' as const,
};

const CATEGORY_OPTIONS = [
  { id: 'website', name: 'My Website', description: 'Content updates or something not working' },
  { id: 'account', name: 'My Account', description: 'Login, passwords, users, permissions' },
  { id: 'billing', name: 'Billing & Contracts', description: 'Cancellations, service changes, queries' },
  { id: 'other', name: 'Something Else', description: 'General support requests and questions' },
];

const KB_ARTICLES = [
  { id: 501, title: 'Check portal ticket progress', view_count: 84, category: 'Support Portal' },
  { id: 502, title: 'Website change request checklist', view_count: 61, category: 'Website' },
  { id: 503, title: 'Reset account access and browser cache', view_count: 57, category: 'Accounts' },
];

const nowIso = () => new Date().toISOString();

const seededTickets = new Map<string, TicketDetail>([
  ['COD-101', {
    key: 'COD-101',
    summary: 'Homepage hero banner is showing the wrong Spring offer',
    status: 'Reviewed',
    priority: 'High',
    created: '2026-05-15T09:10:00.000Z',
    updated: '2026-05-17T08:35:00.000Z',
    assignee: 'Web Team',
    reporter: TEST_USER.email,
    latestComment: 'We have reviewed the requested content update and queued it for deployment.',
    description: 'Please swap the homepage hero banner to the Summer valuation offer and update the CTA copy.',
    bcAccountNumber: 'BC-44102',
    comments: [
      {
        id: 'c101-1',
        author: 'Support Team',
        body: 'We have reviewed the request and confirmed the assets needed for the homepage update.',
        created: '2026-05-16T10:45:00.000Z',
        isInternal: false,
      },
    ],
    attachments: [],
    statusHistory: [
      { from: 'Submitted', to: 'Reviewed', changedAt: '2026-05-16T10:44:00.000Z', changedBy: 'Support Team' },
      { from: null, to: 'Submitted', changedAt: '2026-05-15T09:10:00.000Z', changedBy: 'Codex Test User' },
    ],
    slaStatus: { name: 'Time to resolution', remaining: '18h 15m', breached: false },
  }],
  ['COD-102', {
    key: 'COD-102',
    summary: 'Login reset email is not arriving for the branch mailbox',
    status: 'Awaiting Your Response',
    priority: 'Medium',
    created: '2026-05-14T14:00:00.000Z',
    updated: '2026-05-16T15:20:00.000Z',
    assignee: 'Support Team',
    reporter: TEST_USER.email,
    latestComment: 'Please confirm which email address should receive the reset link.',
    description: 'The user cannot receive a password reset email and needs access restored before tomorrow morning.',
    bcAccountNumber: null,
    comments: [
      {
        id: 'c102-1',
        author: 'Support Team',
        body: 'Please confirm the exact mailbox address that should receive the reset link.',
        created: '2026-05-16T15:20:00.000Z',
        isInternal: false,
      },
    ],
    attachments: [],
    statusHistory: [
      { from: 'In Progress', to: 'Awaiting Your Response', changedAt: '2026-05-16T15:20:00.000Z', changedBy: 'Support Team' },
      { from: 'Reviewed', to: 'In Progress', changedAt: '2026-05-15T11:12:00.000Z', changedBy: 'Support Team' },
      { from: 'Submitted', to: 'Reviewed', changedAt: '2026-05-14T14:30:00.000Z', changedBy: 'Support Team' },
      { from: null, to: 'Submitted', changedAt: '2026-05-14T14:00:00.000Z', changedBy: 'Codex Test User' },
    ],
    slaStatus: { name: 'Time to resolution', remaining: '6h 40m', breached: false },
  }],
  ['COD-103', {
    key: 'COD-103',
    summary: 'Property feed mismatch on featured listing cards',
    status: 'Resolved',
    priority: 'High',
    created: '2026-05-10T07:55:00.000Z',
    updated: '2026-05-13T16:05:00.000Z',
    assignee: 'Integrations Team',
    reporter: TEST_USER.email,
    latestComment: 'The feed mapping was corrected and the listing cards are now updating normally.',
    description: 'Featured listing cards were showing stale prices after the last feed import.',
    bcAccountNumber: 'BC-44102',
    comments: [
      {
        id: 'c103-1',
        author: 'Integrations Team',
        body: 'The feed mapping was corrected and the listing cards are now updating normally.',
        created: '2026-05-13T16:05:00.000Z',
        isInternal: false,
      },
    ],
    attachments: [],
    statusHistory: [
      { from: 'In Progress', to: 'Resolved', changedAt: '2026-05-13T16:05:00.000Z', changedBy: 'Integrations Team' },
      { from: 'Reviewed', to: 'In Progress', changedAt: '2026-05-12T09:40:00.000Z', changedBy: 'Integrations Team' },
      { from: 'Submitted', to: 'Reviewed', changedAt: '2026-05-10T08:30:00.000Z', changedBy: 'Support Team' },
      { from: null, to: 'Submitted', changedAt: '2026-05-10T07:55:00.000Z', changedBy: 'Codex Test User' },
    ],
    slaStatus: null,
  }],
]);

let nextSessionId = 2001;
let nextMessageId = 9001;
let nextTicketNumber = 104;

const sessions: ChatSession[] = [];
const messagesBySession = new Map<number, ChatMessage[]>();
const sessionState = new Map<number, SessionState>();

function hasCodexTestCookie(req: IncomingMessage): boolean {
  return (req.headers.cookie ?? '').includes('portal_codex_test_user=1');
}

function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function sendText(res: ServerResponse, text: string, statusCode = 200): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain');
  res.end(text);
}

function notFound(res: ServerResponse): void {
  sendJson(res, { ok: false, error: 'Not found' }, 404);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getTicketArray(): TicketSummary[] {
  return [...seededTickets.values()].map(({ description, bcAccountNumber, comments, attachments, statusHistory, slaStatus, ...summary }) => summary);
}

function filterTickets(url: URL): TicketSummary[] {
  const status = url.searchParams.get('status') || 'all';
  const search = (url.searchParams.get('search') || '').toLowerCase();
  const page = Number(url.searchParams.get('page') || '1');
  const pageSize = Number(url.searchParams.get('pageSize') || '20');

  let tickets = getTicketArray();
  if (status === 'open') {
    tickets = tickets.filter(ticket => ticket.status !== 'Resolved' && ticket.status !== 'Closed');
  } else if (status === 'resolved') {
    tickets = tickets.filter(ticket => ticket.status === 'Resolved' || ticket.status === 'Closed');
  }

  if (search) {
    tickets = tickets.filter(ticket =>
      ticket.key.toLowerCase().includes(search)
      || ticket.summary.toLowerCase().includes(search),
    );
  }

  const offset = (page - 1) * pageSize;
  return tickets.slice(offset, offset + pageSize);
}

function createAssistantMessage(sessionId: number, content: string, metadata?: Record<string, unknown>): ChatMessage {
  return {
    id: nextMessageId++,
    session_id: sessionId,
    role: 'assistant',
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
    created_at: nowIso(),
  };
}

function createUserMessage(sessionId: number, content: string): ChatMessage {
  return {
    id: nextMessageId++,
    session_id: sessionId,
    role: 'user',
    content,
    metadata: null,
    created_at: nowIso(),
  };
}

function createSummaryMetadata(state: SessionState): Record<string, unknown> {
  const description = state.description || 'Customer needs help with a support request.';
  return {
    type: 'summary_card',
    fields: {
      subject: state.subject || `[Portal] ${state.category || 'Support'} request: ${description}`.slice(0, 120),
      category: state.category || 'other',
      subcategory: null,
      account: 'Codex Test Branch',
      description,
      url: state.url,
      errorMessage: state.errorMessage,
      browser: state.browser || 'Chrome',
      os: null,
      urgency: 'High',
      contactPreference: 'portal',
    },
  };
}

function resolveCategoryName(input: string): { id: string; name: string } | null {
  const lower = input.toLowerCase();
  for (const category of CATEGORY_OPTIONS) {
    if (lower.includes(category.name.toLowerCase()) || lower === category.id) {
      return { id: category.id, name: category.name };
    }
  }
  if (/\bsite|page|banner|website\b/i.test(input)) return { id: 'website', name: 'My Website' };
  if (/\blogin|password|account|access\b/i.test(input)) return { id: 'account', name: 'My Account' };
  if (/\bbill|invoice|contract\b/i.test(input)) return { id: 'billing', name: 'Billing & Contracts' };
  return null;
}

function upsertConfirmedTicket(fields: Record<string, unknown>): string {
  const ticketKey = `COD-${nextTicketNumber++}`;
  const createdAt = nowIso();
  const summary = String(fields.subject || 'Codex test support request');
  const description = String(fields.description || 'Codex test description');
  const detail: TicketDetail = {
    key: ticketKey,
    summary,
    status: 'Submitted',
    priority: String(fields.urgency || 'High'),
    created: createdAt,
    updated: createdAt,
    assignee: 'Support Team',
    reporter: TEST_USER.email,
    latestComment: 'Your request has been received in the Codex test workspace.',
    description,
    bcAccountNumber: 'BC-TEST',
    comments: [
      {
        id: `${ticketKey}-c1`,
        author: 'Support Team',
        body: 'Your request has been received in the Codex test workspace.',
        created: createdAt,
        isInternal: false,
      },
    ],
    attachments: [],
    statusHistory: [
      { from: null, to: 'Submitted', changedAt: createdAt, changedBy: 'Codex Test User' },
    ],
    slaStatus: { name: 'Time to resolution', remaining: '23h 59m', breached: false },
  };
  seededTickets.set(ticketKey, detail);
  return ticketKey;
}

export function codexPortalMockPlugin(): Plugin {
  return {
    name: 'codex-portal-mock-plugin',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const url = new URL(req.url, 'http://127.0.0.1:5173');
        const path = url.pathname;

        // Evaluation bypass: when mockBypass=chat cookie is set, let chat routes
        // fall through to the Express backend via Vite proxy so the real
        // portal-chat.ts logic is exercised instead of the hardcoded mock flow.
        const hasMockBypass = (req.headers.cookie ?? '').includes('mockBypass=chat');
        if (hasMockBypass && (path.startsWith('/api/portal/chat') || path === '/api/portal/auth/codex-test-login')) {
          return next();
        }

        if (path === '/api/portal/auth/mode') {
          sendJson(res, { ok: true, data: { mode: 'oidc', codexTestUserEnabled: true } });
          return;
        }

        if (path === '/api/portal/auth/login') {
          sendJson(res, { ok: true, data: { url: '/portal?codexTestUser=1' } });
          return;
        }

        if (path === '/api/portal/auth/codex-test-login' && req.method === 'POST') {
          sendJson(res, { ok: true, data: { token: 'codex-test-token', user: TEST_USER } });
          return;
        }

        if (!hasCodexTestCookie(req)) return next();

        if (path === '/api/portal/home-summary') {
          const orgOpenCount = getTicketArray().filter(ticket => ticket.status !== 'Resolved' && ticket.status !== 'Closed').length;
          sendJson(res, {
            ok: true,
            data: {
              orgOpenCount,
              announcement: '<strong>Codex test data:</strong> this portal is seeded for local validation of ticket status, history, and chat confirmation flows.',
            },
          });
          return;
        }

        if (path === '/api/portal/kb/popular') {
          sendJson(res, { ok: true, data: KB_ARTICLES });
          return;
        }

        if (path === '/api/portal/tickets') {
          const tickets = filterTickets(url);
          sendJson(res, { ok: true, data: { tickets, total: getTicketArray().length } });
          return;
        }

        const ticketDetailMatch = path.match(/^\/api\/portal\/tickets\/([^/]+)$/);
        if (ticketDetailMatch) {
          const detail = seededTickets.get(ticketDetailMatch[1]);
          if (!detail) {
            notFound(res);
            return;
          }
          sendJson(res, { ok: true, data: detail });
          return;
        }

        if (path === '/api/portal/chat/sessions' && req.method === 'GET') {
          sendJson(res, { ok: true, data: [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at)) });
          return;
        }

        if (path === '/api/portal/chat/sessions' && req.method === 'POST') {
          const session: ChatSession = {
            id: nextSessionId++,
            portal_user_id: TEST_USER.userId,
            jira_issue_key: null,
            status: 'active',
            started_at: nowIso(),
            ended_at: null,
            metadata: null,
          };
          sessions.unshift(session);
          messagesBySession.set(session.id, []);
          sessionState.set(session.id, {
            stage: 'intent',
            category: null,
            description: null,
            url: null,
            errorMessage: null,
            browser: null,
            subject: null,
          });
          sendJson(res, { ok: true, data: session });
          return;
        }

        const sessionGetMatch = path.match(/^\/api\/portal\/chat\/sessions\/(\d+)$/);
        if (sessionGetMatch && req.method === 'GET') {
          const sessionId = Number(sessionGetMatch[1]);
          const session = sessions.find(item => item.id === sessionId);
          if (!session) {
            notFound(res);
            return;
          }
          sendJson(res, { ok: true, data: { session, messages: messagesBySession.get(sessionId) || [] } });
          return;
        }

        const sessionMessageMatch = path.match(/^\/api\/portal\/chat\/sessions\/(\d+)\/messages$/);
        if (sessionMessageMatch && req.method === 'POST') {
          const sessionId = Number(sessionMessageMatch[1]);
          const body = await readJsonBody(req);
          const content = String(body.content || '').trim();
          const session = sessions.find(item => item.id === sessionId);
          const state = sessionState.get(sessionId);
          if (!session || !state) {
            notFound(res);
            return;
          }

          const conversation = messagesBySession.get(sessionId) || [];
          const userMessage = createUserMessage(sessionId, content);
          conversation.push(userMessage);

          let assistant: ChatMessage;
          if (state.stage === 'intent') {
            state.stage = 'category';
            assistant = createAssistantMessage(
              sessionId,
              'Which area does this relate to?',
              { type: 'category_picker', categories: CATEGORY_OPTIONS },
            );
          } else if (state.stage === 'category') {
            const category = resolveCategoryName(content) || { id: 'other', name: 'Something Else' };
            state.category = category.id;
            state.stage = 'detail';
            assistant = createAssistantMessage(
              sessionId,
              `Got it — **${category.name}**. Please describe what should be happening and what is happening instead. If relevant, include the page URL or any error message you can see.`,
            );
          } else {
            state.description = state.description ? `${state.description}\n${content}` : content;
            const urlMatch = content.match(/https?:\/\/\S+/i);
            if (urlMatch) state.url = urlMatch[0];
            if (/error|failed|invalid|denied/i.test(content)) state.errorMessage = content;
            if (/chrome|edge|firefox|safari/i.test(content)) state.browser = content.match(/chrome|edge|firefox|safari/i)?.[0] ?? null;
            state.subject = state.subject || `[Portal] ${state.category || 'support'} request: ${content}`.slice(0, 120);
            state.stage = 'summary';
            assistant = createAssistantMessage(
              sessionId,
              "Here's a summary of your request. Please review and confirm, or let me know if anything needs changing.",
              createSummaryMetadata(state),
            );
          }

          conversation.push(assistant);
          messagesBySession.set(sessionId, conversation);
          sendJson(res, { ok: true, data: assistant });
          return;
        }

        const sessionConfirmMatch = path.match(/^\/api\/portal\/chat\/sessions\/(\d+)\/confirm$/);
        if (sessionConfirmMatch && req.method === 'POST') {
          const sessionId = Number(sessionConfirmMatch[1]);
          const body = await readJsonBody(req);
          const fields = (body.fields as Record<string, unknown> | undefined) || {};
          const session = sessions.find(item => item.id === sessionId);
          const state = sessionState.get(sessionId);
          if (!session || !state) {
            notFound(res);
            return;
          }
          const ticketKey = upsertConfirmedTicket(fields);
          session.jira_issue_key = ticketKey;
          session.status = 'handed_off';
          state.stage = 'confirmed';
          sendJson(res, { ok: true, data: { ticketKey } });
          return;
        }

        const sessionEndMatch = path.match(/^\/api\/portal\/chat\/sessions\/(\d+)\/end$/);
        if (sessionEndMatch && req.method === 'POST') {
          const session = sessions.find(item => item.id === Number(sessionEndMatch[1]));
          if (session) {
            session.status = 'resolved';
            session.ended_at = nowIso();
          }
          sendJson(res, { ok: true });
          return;
        }

        if (path.startsWith('/api/portal/')) {
          sendText(res, 'Codex portal mock route not implemented', 501);
          return;
        }

        next();
      });
    },
  };
}
