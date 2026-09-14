import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailConfig } from '../../env.js';
import type { EmailMessage, EmailSendResult, EmailTransport } from './transport.js';

/**
 * SMTP transport.
 *
 * Works with any standards-compliant mail server: a transactional provider,
 * Google/Microsoft workspace mail, or your own Postfix. Credentials come from
 * the environment and are never logged.
 */
export class SmtpTransport implements EmailTransport {
  readonly kind = 'smtp' as const;
  readonly description: string;
  private readonly transporter: Transporter;

  constructor(email: EmailConfig) {
    const { host, port, secure, user, password, requireTls } = email.smtp;
    this.description = `smtp://${host}:${port}${secure ? ' (implicit TLS)' : ' (STARTTLS)'}`;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: requireTls && !secure,
      auth: user ? { user, pass: password ?? '' } : undefined,
      // Bounded so a hung mail server cannot pile up sockets.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      pool: true,
      maxConnections: 3,
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: (this.transporter.options as { from?: string }).from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { ok: true, id: info.messageId };
    } catch (error) {
      return classify(error);
    }
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

/** Nodemailer errors carry a stable `code`; map them to permanent/transient. */
export function classify(error: unknown): EmailSendResult {
  const code = (error as { code?: string })?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  const permanent = ['EENVELOPE', 'EADDRESS', 'EMESSAGE', 'EAUTH', '550', '553', '554'].includes(code);
  return { ok: false, permanent, error: `${code || 'error'}: ${message}`.slice(0, 400) };
}
