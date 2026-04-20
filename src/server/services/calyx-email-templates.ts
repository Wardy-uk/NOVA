export function emailBase(content: string, ticketRef?: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
  <tr><td align="center" style="padding:24px 0">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;border:1px solid #e2e8f0">
      <tr><td style="background:#5ec1ca;padding:16px 24px">
        <span style="color:#fff;font-size:18px;font-weight:bold">Nurtur Support</span>
        ${ticketRef ? `<span style="float:right;color:rgba(255,255,255,0.8);font-size:13px;font-family:monospace">${ticketRef}</span>` : ''}
      </td></tr>
      <tr><td style="padding:24px">${content}</td></tr>
      <tr><td style="background:#f8fafc;padding:16px 24px;border-top:1px solid #e2e8f0">
        <p style="margin:0;font-size:12px;color:#94a3b8">Automated message from Nurtur Support. Do not reply directly.</p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function priorityColor(p: string): string {
  const map: Record<string, string> = { P1: '#dc2626', P2: '#ea580c', P3: '#ca8a04', P4: '#2563eb' };
  return map[p] || '#64748b';
}

function priorityBadge(p: string): string {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${priorityColor(p)};color:#fff;font-size:12px;font-weight:bold">${esc(p)}</span>`;
}

export function tmplTicketCreated(ticket: any, portalUrl: string): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  return {
    subject: `[${ref}] We've received your request: ${ticket.title}`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b">We've received your request</h2>
      <p style="color:#475569">Hi there, we've logged your request and our team will be in touch soon.</p>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Reference</td><td style="padding:8px 0;font-weight:bold;font-family:monospace">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(ticket.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Priority</td><td style="padding:8px 0">${priorityBadge(ticket.priority || 'P3')}</td></tr>
      </table>
      ${portalUrl ? `<a href="${esc(portalUrl)}" style="display:inline-block;padding:10px 24px;background:#5ec1ca;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">View in Portal</a>` : ''}
    `, ref),
  };
}

export function tmplFirstReply(ticket: any, replyBody: string, portalUrl: string): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  return {
    subject: `[${ref}] We've responded to your request`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b">New response on your request</h2>
      <div style="margin:16px 0;padding:16px;background:#f1f5f9;border-left:4px solid #5ec1ca;border-radius:4px;color:#334155">${replyBody}</div>
      ${portalUrl ? `<a href="${esc(portalUrl)}" style="display:inline-block;padding:10px 24px;background:#5ec1ca;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Reply via Portal</a>` : ''}
    `, ref),
  };
}

export function tmplResolved(ticket: any, csatUrl: string, portalUrl: string): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<a href="${esc(csatUrl)}&score=${n}" style="display:inline-block;width:40px;height:40px;line-height:40px;text-align:center;margin:0 4px;background:${n <= 2 ? '#fee2e2' : n === 3 ? '#fef3c7' : '#dcfce7'};border-radius:8px;text-decoration:none;font-size:20px">${n <= 2 ? '&#9733;' : n === 3 ? '&#9733;' : '&#9733;'}</a>`
  ).join('');
  return {
    subject: `[${ref}] Your request has been resolved`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b">Your request has been resolved</h2>
      <p style="color:#475569">We've marked <strong>${esc(ref)}</strong> — <em>${esc(ticket.title)}</em> — as resolved.</p>
      <p style="color:#475569">If you're not satisfied with the resolution, you can reopen the ticket via the portal.</p>
      <div style="text-align:center;margin:24px 0">
        <p style="color:#64748b;margin:0 0 8px">How did we do?</p>
        <div>${stars}</div>
      </div>
      ${portalUrl ? `<a href="${esc(portalUrl)}" style="display:inline-block;padding:10px 24px;background:#5ec1ca;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">View in Portal</a>` : ''}
    `, ref),
  };
}

export function tmplStatusWaiting(ticket: any, portalUrl: string): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  return {
    subject: `[${ref}] We're waiting for your response`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b">We need your input</h2>
      <p style="color:#475569">Your ticket <strong>${esc(ref)}</strong> is currently waiting for your response. The SLA timer has been paused until we hear back from you.</p>
      ${portalUrl ? `<a href="${esc(portalUrl)}" style="display:inline-block;padding:10px 24px;background:#5ec1ca;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Reply Now</a>` : ''}
    `, ref),
  };
}

export function tmplAssigned(ticket: any, agentName: string): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  const pColor = priorityColor(ticket.priority || 'P3');
  return {
    subject: `[${ref}] Ticket assigned to you: ${ticket.title}`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b">Ticket assigned to you</h2>
      <p style="color:#475569">Hi ${esc(agentName)}, you've been assigned the following ticket:</p>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Reference</td><td style="padding:8px 0;font-weight:bold;font-family:monospace">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(ticket.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Priority</td><td style="padding:8px 0"><span style="display:inline-block;padding:2px 8px;border-radius:4px;background:${pColor};color:#fff;font-size:12px;font-weight:bold">${esc(ticket.priority || 'P3')}</span></td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Status</td><td style="padding:8px 0">${esc(ticket.status || 'open')}</td></tr>
      </table>
    `, ref),
  };
}

export function tmplSlaWarning(ticket: any, metric: string, minutesRemaining: number): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  const timeStr = minutesRemaining < 60 ? `${minutesRemaining} min${minutesRemaining !== 1 ? 's' : ''}` : `${Math.floor(minutesRemaining / 60)}h ${minutesRemaining % 60}m`;
  return {
    subject: `\u26A0\uFE0F SLA at risk: [${ref}]`,
    html: emailBase(`
      <div style="text-align:center;margin:0 0 24px">
        <div style="display:inline-block;padding:16px 32px;background:#fef3c7;border:2px solid #f59e0b;border-radius:12px">
          <p style="margin:0;font-size:14px;color:#92400e;font-weight:bold">SLA WARNING</p>
          <p style="margin:8px 0 0;font-size:28px;color:#b45309;font-weight:bold">${timeStr} remaining</p>
        </div>
      </div>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Ticket</td><td style="padding:8px 0;font-family:monospace">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(ticket.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Metric</td><td style="padding:8px 0">${esc(metric)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Priority</td><td style="padding:8px 0">${priorityBadge(ticket.priority || 'P3')}</td></tr>
      </table>
    `, ref),
  };
}

export function tmplSlaBreached(ticket: any, metric: string, breachMins: number): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  const timeStr = breachMins < 60 ? `${breachMins} min${breachMins !== 1 ? 's' : ''}` : `${Math.floor(breachMins / 60)}h ${breachMins % 60}m`;
  return {
    subject: `\uD83D\uDEA8 SLA breached: [${ref}]`,
    html: emailBase(`
      <div style="text-align:center;margin:0 0 24px">
        <div style="display:inline-block;padding:16px 32px;background:#fee2e2;border:2px solid #dc2626;border-radius:12px">
          <p style="margin:0;font-size:14px;color:#991b1b;font-weight:bold">SLA BREACHED</p>
          <p style="margin:8px 0 0;font-size:28px;color:#dc2626;font-weight:bold">${timeStr} overdue</p>
        </div>
      </div>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Ticket</td><td style="padding:8px 0;font-family:monospace">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(ticket.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Metric</td><td style="padding:8px 0">${esc(metric)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Priority</td><td style="padding:8px 0">${priorityBadge(ticket.priority || 'P3')}</td></tr>
      </table>
    `, ref),
  };
}

export function tmplSloWarning(ticket: any, sloName: string, minutesRemaining: number): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  const timeStr = minutesRemaining < 60 ? `${minutesRemaining} min${minutesRemaining !== 1 ? 's' : ''}` : `${Math.floor(minutesRemaining / 60)}h ${minutesRemaining % 60}m`;
  return {
    subject: `\u26A0\uFE0F SLO at risk: [${ref}] \u2014 ${sloName}`,
    html: emailBase(`
      <div style="text-align:center;margin:0 0 24px">
        <div style="display:inline-block;padding:16px 32px;background:#fef3c7;border:2px solid #f59e0b;border-radius:12px">
          <p style="margin:0;font-size:14px;color:#92400e;font-weight:bold">SLO AT RISK</p>
          <p style="margin:4px 0 0;font-size:16px;color:#92400e">${esc(sloName)}</p>
          <p style="margin:8px 0 0;font-size:28px;color:#b45309;font-weight:bold">${timeStr} remaining</p>
        </div>
      </div>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Ticket</td><td style="padding:8px 0;font-family:monospace">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(ticket.title)}</td></tr>
      </table>
    `, ref),
  };
}

export function tmplMajorIncident(incident: any, ticket: any, isUpdate: boolean, isResolved: boolean): { subject: string; html: string } {
  const ref = ticket?.reference || `TKT-${ticket?.id || '?'}`;
  const prefix = isResolved ? '\u2705' : '\uD83D\uDEA8';
  const verb = isResolved ? 'resolved' : isUpdate ? 'update' : 'declared';
  return {
    subject: `${prefix} Major incident ${verb}: ${incident.title || ticket?.title || 'Incident'}`,
    html: emailBase(`
      <div style="padding:16px;background:${isResolved ? '#dcfce7' : '#fee2e2'};border-radius:8px;margin:0 0 16px">
        <h2 style="margin:0;color:${isResolved ? '#166534' : '#991b1b'}">${prefix} Major Incident ${isResolved ? 'Resolved' : isUpdate ? 'Update' : 'Declared'}</h2>
      </div>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Title</td><td style="padding:8px 0;font-weight:bold">${esc(incident.title || ticket?.title || '')}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Ticket</td><td style="padding:8px 0;font-family:monospace">${esc(ref)}</td></tr>
        ${incident.impact_statement ? `<tr><td style="padding:8px 0;color:#64748b">Impact</td><td style="padding:8px 0">${esc(incident.impact_statement)}</td></tr>` : ''}
      </table>
      ${incident.latest_comm ? `<div style="margin:16px 0;padding:16px;background:#f1f5f9;border-left:4px solid #5ec1ca;border-radius:4px"><strong>Latest Update:</strong><br>${esc(incident.latest_comm)}</div>` : ''}
    `, ref),
  };
}

export function tmplCsatSurvey(ticket: any, surveyUrl: string): { subject: string; html: string } {
  const ref = ticket.reference || `TKT-${ticket.id}`;
  const stars = [1, 2, 3, 4, 5].map(n =>
    `<a href="${esc(surveyUrl)}&score=${n}" style="display:inline-block;width:48px;height:48px;line-height:48px;text-align:center;margin:0 4px;background:${n <= 2 ? '#fee2e2' : n === 3 ? '#fef3c7' : '#dcfce7'};border-radius:8px;text-decoration:none;font-size:24px">${'&#9733;'}</a>`
  ).join('');
  return {
    subject: `How did we do? [${ref}]`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#1e293b;text-align:center">How did we do?</h2>
      <p style="color:#475569;text-align:center">Your ticket <strong>${esc(ref)}</strong> — <em>${esc(ticket.title)}</em> — was recently resolved. We'd love your feedback.</p>
      <div style="text-align:center;margin:24px 0">
        <p style="color:#64748b;margin:0 0 12px">Click a star to rate your experience:</p>
        <div>${stars}</div>
      </div>
    `, ref),
  };
}

export function tmplChangeApproved(change: any, agentName: string): { subject: string; html: string } {
  const ref = change.reference || `CHG-${change.id}`;
  return {
    subject: `[${ref}] Your change request has been approved`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#166534">Change Request Approved</h2>
      <p style="color:#475569">Your change request <strong>${esc(ref)}</strong> has been approved by ${esc(agentName)}.</p>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Reference</td><td style="padding:8px 0;font-family:monospace;font-weight:bold">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(change.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Approved by</td><td style="padding:8px 0">${esc(agentName)}</td></tr>
      </table>
    `, ref),
  };
}

export function tmplChangeRejected(change: any, agentName: string, reason: string): { subject: string; html: string } {
  const ref = change.reference || `CHG-${change.id}`;
  return {
    subject: `[${ref}] Your change request was not approved`,
    html: emailBase(`
      <h2 style="margin:0 0 16px;color:#dc2626">Change Request Not Approved</h2>
      <p style="color:#475569">Your change request <strong>${esc(ref)}</strong> was not approved by ${esc(agentName)}.</p>
      <table style="width:100%;margin:16px 0;border-collapse:collapse">
        <tr><td style="padding:8px 0;color:#64748b;width:120px">Reference</td><td style="padding:8px 0;font-family:monospace;font-weight:bold">${esc(ref)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Title</td><td style="padding:8px 0">${esc(change.title)}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b">Rejected by</td><td style="padding:8px 0">${esc(agentName)}</td></tr>
      </table>
      ${reason ? `<div style="margin:16px 0;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px"><strong>Reason:</strong> ${esc(reason)}</div>` : ''}
    `, ref),
  };
}
