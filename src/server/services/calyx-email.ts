import nodemailer from 'nodemailer';
import type Database from 'better-sqlite3';

export function queueEmail(db: Database.Database, opts: {
  ticketId?: number;
  recipientEmail: string;
  eventType: string;
  subject: string;
  bodyHtml: string;
}): void {
  try {
    db.prepare(`
      INSERT INTO calyx_email_queue
        (ticket_id, recipient_email, event_type, subject, body_html, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
    `).run(opts.ticketId ?? null, opts.recipientEmail, opts.eventType, opts.subject, opts.bodyHtml);
  } catch (err) {
    console.error('[Calyx Email] Queue failed:', err);
  }
}

export function isNotificationEnabled(settings: Record<string, string>, eventType: string): boolean {
  const raw = settings.calyx_notifications;
  if (!raw) return true;
  try {
    const toggles = JSON.parse(raw) as Record<string, boolean>;
    return toggles[eventType] !== false;
  } catch {
    return true;
  }
}

export async function processEmailQueue(db: Database.Database, settings: Record<string, string>): Promise<void> {
  if (settings.calyx_smtp_enabled !== '1') return;

  const pending = db.prepare(`
    SELECT * FROM calyx_email_queue WHERE status = 'pending' AND attempts < 3
    ORDER BY created_at ASC LIMIT 20
  `).all() as any[];
  if (!pending.length) return;

  let transporter: nodemailer.Transporter;
  let fromAddr: string;
  let isEthereal = false;

  if (settings.calyx_smtp_host) {
    transporter = nodemailer.createTransport({
      host: settings.calyx_smtp_host,
      port: Number(settings.calyx_smtp_port) || 587,
      secure: Number(settings.calyx_smtp_port) === 465,
      auth: { user: settings.calyx_smtp_user, pass: settings.calyx_smtp_pass },
    });
    fromAddr = settings.calyx_smtp_from || settings.calyx_smtp_user;
  } else {
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    fromAddr = testAccount.user;
    isEthereal = true;
    console.log('[Calyx Email] No SMTP configured — using Ethereal test account:', testAccount.user);
  }

  for (const email of pending) {
    try {
      const info = await transporter.sendMail({
        from: fromAddr,
        to: email.recipient_email,
        subject: email.subject,
        html: email.body_html,
      });
      db.prepare(`UPDATE calyx_email_queue SET status='sent', last_attempt_at=datetime('now') WHERE id=?`).run(email.id);

      if (isEthereal) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        console.log(`[Calyx Email] Ethereal preview: ${previewUrl}`);
      }
    } catch (err: any) {
      db.prepare(`
        UPDATE calyx_email_queue
        SET attempts = attempts + 1, last_attempt_at = datetime('now'),
            status = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE 'pending' END,
            error = ?
        WHERE id = ?
      `).run(String(err?.message ?? err), email.id);
    }
  }
}
