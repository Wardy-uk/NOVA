/**
 * Built-in SMTP email service using nodemailer.
 * Reads SMTP config from settings; works independently of MS365 MCP.
 *
 * Settings keys: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from
 */
import nodemailer from 'nodemailer';
import type { SettingsQueries } from '../db/settings-store.js';

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

  /** Check if SMTP is configured */
  isConfigured(): boolean {
    const s = this.getSettings();
    return !!(s.smtp_host?.trim() && s.smtp_user?.trim() && s.smtp_pass?.trim());
  }

  private createTransport() {
    const s = this.getSettings();
    const port = parseInt(s.smtp_port || '587', 10);
    return nodemailer.createTransport({
      host: s.smtp_host,
      port,
      secure: port === 465,
      auth: {
        user: s.smtp_user,
        pass: s.smtp_pass,
      },
    });
  }

  async send(opts: EmailOptions): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('SMTP not configured. Set smtp_host, smtp_user, and smtp_pass in Admin > Integrations.');
    }
    const s = this.getSettings();
    const from = s.smtp_from?.trim() || s.smtp_user;
    const transport = this.createTransport();
    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  }

  /** Verify SMTP connection without sending */
  async verify(): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: 'SMTP not configured' };
    }
    try {
      const transport = this.createTransport();
      await transport.verify();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
