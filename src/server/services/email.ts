/**
 * Standalone email service — sends directly to recipient's mail server
 * by resolving MX records. No external provider needed.
 *
 * If smtp_host is set, uses that as a relay instead.
 *
 * Settings keys:
 *   smtp_from  — sender address (required)
 *   smtp_host  — relay host (optional; omit for direct MX delivery)
 *   smtp_port  — relay port (default 25 for direct, 587 for relay)
 *   smtp_user  — relay auth user (optional)
 *   smtp_pass  — relay auth password (optional)
 */
import nodemailer from 'nodemailer';
import dns from 'dns';
import { promisify } from 'util';

const resolveMx = promisify(dns.resolveMx);

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

  isConfigured(): boolean {
    const s = this.getSettings();
    return !!(s.smtp_from?.trim());
  }

  /** Resolve the MX host for a recipient's domain */
  private async resolveMxHost(email: string): Promise<string> {
    const domain = email.split('@')[1];
    if (!domain) throw new Error(`Invalid email: ${email}`);
    try {
      const records = await resolveMx(domain);
      if (!records || records.length === 0) {
        // No MX records — fall back to A record (the domain itself)
        return domain;
      }
      // Sort by priority (lowest = highest priority) and pick the best
      records.sort((a, b) => a.priority - b.priority);
      return records[0].exchange;
    } catch (err) {
      throw new Error(`DNS MX lookup failed for ${domain}: ${err instanceof Error ? err.message : err}`);
    }
  }

  async send(opts: EmailOptions): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Email not configured. Set a From address in Admin > Integrations > Email.');
    }
    const s = this.getSettings();
    const from = s.smtp_from.trim();
    const relayHost = s.smtp_host?.trim();

    let host: string;
    let port: number;
    let auth: { user: string; pass: string } | undefined;
    let secure: boolean;

    if (relayHost) {
      // Relay mode
      host = relayHost;
      port = parseInt(s.smtp_port || '587', 10);
      secure = port === 465;
      auth = s.smtp_user?.trim() ? { user: s.smtp_user, pass: s.smtp_pass } : undefined;
    } else {
      // Direct MX delivery
      host = await this.resolveMxHost(opts.to);
      port = 25;
      secure = false;
      auth = undefined;
      console.log(`[Email] Direct delivery to ${opts.to} via MX host: ${host}`);
    }

    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      tls: { rejectUnauthorized: false },
      // Identify ourselves with the sender's domain
      name: from.split('@')[1] || 'localhost',
    });

    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  }

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
