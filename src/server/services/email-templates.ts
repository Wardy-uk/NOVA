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
