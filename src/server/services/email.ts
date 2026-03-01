/**
 * Standalone email service — sends directly via MX lookup by default.
 * No external SMTP provider required.
 *
 * If smtp_host is configured in settings, uses that relay instead.
 * Otherwise does direct delivery (resolves recipient MX records).
 *
 * Settings keys (all optional for direct mode):
 *   smtp_from  — sender address (required)
 *   smtp_host  — relay host (optional; omit for direct delivery)
 *   smtp_port  — relay port (default 587)
 *   smtp_user  — relay auth user
 *   smtp_pass  — relay auth password
 */
import nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export class EmailService {
  private getSettings: () => Record<string, string>;

  constructor(settingsGetter: () => Record<string, string>) {
    this.getSettings = settingsGetter;
  }

  /** Check if at minimum a from address is configured */
  isConfigured(): boolean {
    const s = this.getSettings();
    return !!(s.smtp_from?.trim());
  }

  private createTransport() {
    const s = this.getSettings();
    const host = s.smtp_host?.trim();

    if (host) {
      // Relay mode — use configured SMTP server
      const port = parseInt(s.smtp_port || '587', 10);
      return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: s.smtp_user?.trim()
          ? { user: s.smtp_user, pass: s.smtp_pass }
          : undefined,
      });
    }

    // Direct mode — resolve MX records and deliver directly
    return nodemailer.createTransport({
      direct: true,
      name: s.smtp_from?.split('@')[1] || 'localhost',
    } as any);
  }

  async send(opts: EmailOptions): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Email not configured. Set a From address in Admin > Integrations > Email.');
    }
    const s = this.getSettings();
    const from = s.smtp_from.trim();
    const transport = this.createTransport();
    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  }

  /** Test the email config by sending a test message */
  async sendTest(to: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.send({
        to,
        subject: 'N.O.V.A — Test Email',
        text: 'This is a test email from N.O.V.A. If you received this, email is working.',
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
