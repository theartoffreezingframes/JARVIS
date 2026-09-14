import { config, type EmailConfig } from '../../env.js';
import type { EmailMessage, EmailSendResult, EmailTransport } from './transport.js';

/**
 * HTTP transport for transactional email APIs.
 *
 * Resend, SendGrid and Postmark each take a slightly different JSON body, so the
 * shapes live here and nothing else in the codebase needs to know which vendor
 * is in use. `generic` posts a neutral `{from,to,subject,text,html}` payload for
 * self-hosted or bespoke gateways.
 */
export class HttpTransport implements EmailTransport {
  readonly kind = 'http' as const;
  readonly description: string;
  private readonly email: EmailConfig;
  private readonly fromAddress: string;

  constructor(email: EmailConfig) {
    this.email = email;
    this.fromAddress = extractAddress(email.from);
    this.description = `${email.http.vendor} API ${email.http.url}`;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { vendor, url, apiKey } = this.email.http;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.push.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey
            ? vendor === 'sendgrid'
              ? { authorization: `Bearer ${apiKey}` }
              : vendor === 'postmark'
                ? { 'x-postmark-server-token': apiKey }
                : { authorization: `Bearer ${apiKey}` }
            : {}),
        },
        body: JSON.stringify(body(vendor, this.email.from, this.fromAddress, message)),
        signal: controller.signal,
      });
      const text = await response.text().catch(() => '');
      if (!response.ok) {
        return {
          ok: false,
          permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
          error: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
        };
      }
      let id: string | undefined;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const found = parsed.id ?? parsed.messageId ?? parsed.MessageID;
        if (typeof found === 'string') id = found;
      } catch {
        /* Providers do not always return JSON; an empty body is still a success. */
      }
      return { ok: true, id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, permanent: false, error: `request failed: ${message}`.slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  }
}

function extractAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return match?.[1] ?? from;
}

function body(
  vendor: EmailConfig['http']['vendor'],
  from: string,
  fromAddress: string,
  message: EmailMessage,
): Record<string, unknown> {
  switch (vendor) {
    case 'resend':
      return { from, to: [message.to], subject: message.subject, text: message.text, html: message.html };
    case 'sendgrid':
      return {
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: fromAddress, name: nameOf(from) },
        subject: message.subject,
        content: [
          { type: 'text/plain', value: message.text },
          ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
        ],
      };
    case 'postmark':
      return {
        From: from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        MessageStream: 'outbound',
      };
    default:
      return { from, to: message.to, subject: message.subject, text: message.text, html: message.html };
  }
}

function nameOf(from: string): string {
  const match = /^(.*)<[^>]+>$/.exec(from);
  return (match?.[1] ?? '').trim().replace(/^"|"$/g, '') || 'JARVIS';
}
