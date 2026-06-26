/**
 * Branded HTML email templates for N.O.V.A.
 * Dark theme matching the app UI (#272C33, #2f353d, #5ec1ca accent).
 */

function wrap(cardContent: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#1e2228;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1e2228;padding:40px 16px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%">
  <tr><td style="padding:0 0 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;letter-spacing:1px;color:#5ec1ca">N.O.V.A</span>
    <br><span style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:2px">Nurtur Operational Virtual Assistant</span>
  </td></tr>
  <tr><td style="background-color:#2f353d;border:1px solid #3a424d;border-radius:12px;padding:32px">
    ${cardContent}
  </td></tr>
  <tr><td style="padding:20px 0 0;text-align:center">
    <span style="font-size:11px;color:#4b5563">Nurtur Limited</span>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:4px 0 8px">
  <a href="${href}" style="display:inline-block;background-color:#5ec1ca;color:#272C33;font-size:14px;font-weight:600;text-decoration:none;padding:12px 32px;border-radius:8px">${label}</a>
</td></tr></table>`;
}

export function inviteHtml(opts: {
  name: string;
  username: string;
  tempPassword?: string;
  loginUrl: string;
  ssoEnabled: boolean;
}): string {
  const { name, username, tempPassword, loginUrl, ssoEnabled } = opts;
  const credentialsRow = tempPassword
    ? `<tr>
         <td style="padding:4px 0;color:#a0a0a0;font-size:13px;width:140px">Temporary password</td>
         <td style="padding:4px 0;color:#e5e5e5;font-size:13px;font-family:monospace">${tempPassword}</td>
       </tr>`
    : '';
  const ssoNote = ssoEnabled
    ? '<p style="margin:0 0 16px;color:#a0a0a0;font-size:13px">You can also click <strong style="color:#e5e5e5">Sign in with Microsoft</strong> on the login page.</p>'
    : '';
  const passwordNote = tempPassword
    ? '<p style="margin:0 0 16px;color:#a0a0a0;font-size:13px">Please change your password after your first login.</p>'
    : '';

  return wrap(`
    <p style="margin:0 0 20px;color:#e5e5e5;font-size:15px">Hi ${name},</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">You've been invited to <strong style="color:#e5e5e5">N.O.V.A</strong>. Here are your login details:</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#272C33;border:1px solid #3a424d;border-radius:8px;padding:12px 16px;width:100%">
      <tr>
        <td style="padding:4px 0;color:#a0a0a0;font-size:13px;width:140px">Username</td>
        <td style="padding:4px 0;color:#5ec1ca;font-size:13px;font-weight:600">${username}</td>
      </tr>
      ${credentialsRow}
    </table>
    ${passwordNote}${ssoNote}
    ${button(loginUrl, 'Sign In to N.O.V.A')}
  `);
}

export function passwordResetHtml(opts: {
  name: string;
  resetUrl: string;
}): string {
  return wrap(`
    <p style="margin:0 0 20px;color:#e5e5e5;font-size:15px">Hi ${opts.name},</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">We received a request to reset your password. Click the button below to choose a new one:</p>
    ${button(opts.resetUrl, 'Reset Password')}
    <p style="margin:16px 0 0;color:#6b7280;font-size:11px">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `);
}

export function setupPortalHtml(opts: {
  customerName?: string;
  accountName: string;
  portalUrl: string;
  expiryDays: number;
}): string {
  const greeting = opts.customerName ? `Hi ${opts.customerName},` : 'Hello,';
  return wrap(`
    <p style="margin:0 0 20px;color:#e5e5e5;font-size:15px">${greeting}</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">We're setting up <strong style="color:#e5e5e5">${opts.accountName}</strong> and need a few details from you — company info, brand colours, logos, and branch details.</p>
    <p style="margin:0 0 24px;color:#a0a0a0;font-size:13px">Click the button below to open your setup form. You can save your progress and come back at any time.</p>
    ${button(opts.portalUrl, 'Complete Your Setup')}
    <p style="margin:16px 0 0;color:#6b7280;font-size:11px">This link expires in ${opts.expiryDays} days. If you have any questions, reply to this email.</p>
  `);
}

export function standupPromptHtml(opts: {
  name: string;
  dateDisplay: string;
  submitUrl: string;
  queue?: { total: number; over5: number; oldest: string | null } | null;
}): string {
  const queueRows = opts.queue
    ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#272C33;border:1px solid #3a424d;border-radius:8px;padding:12px 16px;width:100%">
         <tr><td style="padding:4px 0;color:#a0a0a0;font-size:13px;width:160px">Open tickets</td><td style="padding:4px 0;color:#e5e5e5;font-size:13px;font-weight:600">${opts.queue.total}</td></tr>
         <tr><td style="padding:4px 0;color:#a0a0a0;font-size:13px">Over 5 days</td><td style="padding:4px 0;color:${opts.queue.over5 > 0 ? '#ef4444' : '#e5e5e5'};font-size:13px;font-weight:600">${opts.queue.over5}</td></tr>
         ${opts.queue.oldest ? `<tr><td style="padding:4px 0;color:#a0a0a0;font-size:13px">Oldest ticket</td><td style="padding:4px 0;color:#5ec1ca;font-size:13px;font-weight:600">${opts.queue.oldest}</td></tr>` : ''}
       </table>`
    : '';
  return wrap(`
    <p style="margin:0 0 16px;color:#e5e5e5;font-size:15px">Hi ${opts.name},</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">Before today's standup, please take 2 minutes to submit your numbers and commitments.</p>
    ${queueRows}
    ${button(opts.submitUrl, 'Submit my standup')}
    <p style="margin:16px 0 0;color:#a0a0a0;font-size:13px">See you at standup.</p>
  `);
}

export function standupAccountabilityHtml(opts: {
  dateDisplay: string;
  submitted: number;
  totalAgents: number;
  delivered: number;
  missed: number;
  pending: number;
  agents: Array<{ name: string; commitments: number; delivered: number; missed: number; pending: number }>;
  sessionUrl: string;
}): string {
  const agentRows = opts.agents
    .map(
      (a) => `<tr>
        <td style="padding:6px 0;color:#e5e5e5;font-size:13px">${a.name}</td>
        <td style="padding:6px 8px;color:#a0a0a0;font-size:12px;text-align:right">${a.commitments}</td>
        <td style="padding:6px 8px;color:#10b981;font-size:12px;text-align:right">${a.delivered}</td>
        <td style="padding:6px 8px;color:#ef4444;font-size:12px;text-align:right">${a.missed}</td>
        <td style="padding:6px 0 6px 8px;color:#f59e0b;font-size:12px;text-align:right">${a.pending}</td>
      </tr>`,
    )
    .join('');
  return wrap(`
    <p style="margin:0 0 8px;color:#e5e5e5;font-size:15px;font-weight:600">Standup accountability — ${opts.dateDisplay}</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px"><strong style="color:#e5e5e5">${opts.submitted} of ${opts.totalAgents}</strong> agents submitted &nbsp;·&nbsp; <span style="color:#10b981">${opts.delivered} delivered</span> &nbsp;·&nbsp; <span style="color:#ef4444">${opts.missed} missed</span> &nbsp;·&nbsp; <span style="color:#f59e0b">${opts.pending} awaiting review</span></p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#272C33;border:1px solid #3a424d;border-radius:8px;padding:12px 16px">
      <tr style="border-bottom:1px solid #3a424d">
        <td style="padding:0 0 6px;color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:1px">Agent</td>
        <td style="padding:0 8px 6px;color:#6b7280;font-size:10px;text-transform:uppercase;text-align:right">Total</td>
        <td style="padding:0 8px 6px;color:#6b7280;font-size:10px;text-transform:uppercase;text-align:right">Done</td>
        <td style="padding:0 8px 6px;color:#6b7280;font-size:10px;text-transform:uppercase;text-align:right">Miss</td>
        <td style="padding:0 0 6px 8px;color:#6b7280;font-size:10px;text-transform:uppercase;text-align:right">Pend</td>
      </tr>
      ${agentRows}
    </table>
    ${button(opts.sessionUrl, 'Open in N.O.V.A')}
  `);
}

export function one21PrepAgentHtml(opts: {
  name: string;
  dateDisplay: string;
  intro: string;
  questions: string[];
  submitUrl: string;
}): string {
  const questionRows = opts.questions
    .map((q) => `<tr><td style="padding:6px 0;color:#a0a0a0;font-size:13px">• ${q}</td></tr>`)
    .join('');
  return wrap(`
    <p style="margin:0 0 16px;color:#e5e5e5;font-size:15px">Hi ${opts.name},</p>
    <p style="margin:0 0 12px;color:#a0a0a0;font-size:13px">Your 1-2-1 is on <strong style="color:#e5e5e5">${opts.dateDisplay}</strong>.</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">${opts.intro}</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#272C33;border:1px solid #3a424d;border-radius:8px;padding:12px 16px;width:100%">
      ${questionRows}
    </table>
    ${button(opts.submitUrl, 'Add my answers')}
    <p style="margin:16px 0 0;color:#a0a0a0;font-size:13px">Your answers come straight back to me before we meet — thank you.</p>
  `);
}

export function one21PrepManagerHtml(opts: {
  agentName: string;
  dateDisplay: string;
  intro: string;
  summary: string | null;
  whatsImproved: string[];
  needsAttention: string[];
  talkingPoints: string[];
  openUrl: string;
}): string {
  const list = (items: string[]) =>
    items.length
      ? items.map((i) => `<tr><td style="padding:5px 0;color:#a0a0a0;font-size:13px">• ${i}</td></tr>`).join('')
      : '<tr><td style="padding:5px 0;color:#6b7280;font-size:13px">—</td></tr>';
  const section = (title: string, color: string, items: string[]) => `
    <p style="margin:16px 0 4px;color:${color};font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:600">${title}</p>
    <table cellpadding="0" cellspacing="0" width="100%">${list(items)}</table>`;
  return wrap(`
    <p style="margin:0 0 8px;color:#e5e5e5;font-size:15px;font-weight:600">1-2-1 prep — ${opts.agentName}</p>
    <p style="margin:0 0 6px;color:#a0a0a0;font-size:13px">Scheduled for <strong style="color:#e5e5e5">${opts.dateDisplay}</strong>.</p>
    <p style="margin:0 0 16px;color:#a0a0a0;font-size:13px">${opts.intro}</p>
    ${opts.summary ? `<p style="margin:0 0 8px;color:#e5e5e5;font-size:14px">${opts.summary}</p>` : '<p style="margin:0 0 8px;color:#f59e0b;font-size:13px">Auto-prep summary was unavailable — open NOVA for the latest numbers.</p>'}
    ${section("What's improved", '#10b981', opts.whatsImproved)}
    ${section('Needs attention', '#ef4444', opts.needsAttention)}
    ${section('Talking points', '#5ec1ca', opts.talkingPoints)}
    <div style="height:8px"></div>
    ${button(opts.openUrl, 'Open in N.O.V.A')}
  `);
}

export function one21WeeklyKpiHtml(opts: {
  name: string;
  weekDisplay: string;
  rows: Array<{ label: string; value: string; rag: 'green' | 'amber' | 'red' | 'grey' }>;
  openUrl: string;
}): string {
  const ragColor: Record<string, string> = { green: '#10b981', amber: '#f59e0b', red: '#ef4444', grey: '#6b7280' };
  const rows = opts.rows
    .map((r) => `<tr>
      <td style="padding:7px 0;color:#a0a0a0;font-size:13px;width:160px">${r.label}</td>
      <td style="padding:7px 8px;color:#e5e5e5;font-size:13px;font-weight:600;text-align:right">${r.value}</td>
      <td style="padding:7px 0 7px 10px;text-align:right"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background-color:${ragColor[r.rag]}"></span></td>
    </tr>`)
    .join('');
  return wrap(`
    <p style="margin:0 0 8px;color:#e5e5e5;font-size:15px">Hi ${opts.name},</p>
    <p style="margin:0 0 20px;color:#a0a0a0;font-size:13px">Here's your KPI summary for <strong style="color:#e5e5e5">${opts.weekDisplay}</strong> (rolling 30-day averages).</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background-color:#272C33;border:1px solid #3a424d;border-radius:8px;padding:12px 16px;width:100%">
      ${rows}
    </table>
    ${button(opts.openUrl, 'Open in N.O.V.A')}
    <p style="margin:16px 0 0;color:#6b7280;font-size:11px">Questions about any of these? Bring them to your next 1-2-1.</p>
  `);
}

export function trainingReminderHtml(opts: {
  displayName: string;
  completionPct: number;
  totalItems: number;
  missingCount: number;
  novaUrl: string;
  categories: Array<{ name: string; scored: number; total: number; pct: number }>;
}): string {
  const categoryRows = opts.categories
    .filter(c => c.pct < 100)
    .map(c => {
      const barColor = c.pct < 40 ? '#ef4444' : c.pct < 70 ? '#d97706' : '#059669';
      return `<tr>
        <td style="padding:6px 0;color:#e5e5e5;font-size:13px">${c.name}</td>
        <td style="padding:6px 8px;width:120px">
          <div style="background:#1e2228;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${barColor};height:100%;width:${c.pct}%;border-radius:4px"></div>
          </div>
        </td>
        <td style="padding:6px 0;color:#a0a0a0;font-size:12px;text-align:right;white-space:nowrap">${c.scored}/${c.total} (${c.pct}%)</td>
      </tr>`;
    })
    .join('');

  return wrap(`
    <p style="margin:0 0 20px;color:#e5e5e5;font-size:15px">Hi ${opts.displayName},</p>
    <p style="margin:0 0 16px;color:#a0a0a0;font-size:13px">Your training matrix is <strong style="color:#e5e5e5">${opts.completionPct}% complete</strong> — ${opts.missingCount} of ${opts.totalItems} items still need a score.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
      ${categoryRows}
    </table>
    <p style="margin:0 0 24px;color:#a0a0a0;font-size:13px">Please take a few minutes to update your scores. It helps us understand team capability and identify training needs.</p>
    ${button(opts.novaUrl, 'Update My Training Matrix')}
  `);
}
