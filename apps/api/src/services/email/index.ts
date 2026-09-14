import { config } from '../../env.js';
import { HttpTransport } from './http.js';
import { SmtpTransport } from './smtp.js';
import type { EmailMessage, EmailSendResult, EmailTransport } from './transport.js';

export type { EmailMessage, EmailSendResult, EmailTransport } from './transport.js';

/** Used when no provider is configured: succeeds loudly to the operator, never pretends. */
class NoopTransport implements EmailTransport {
  readonly kind = 'none' as const;
  readonly description = 'no provider configured (email disabled)';
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.warn(
      `[email] dropped message to ${redact(message.to)} — no provider configured. ` +
        'Set JARVIS_EMAIL_PROVIDER + credentials to deliver password-reset mail.',
    );
    return { ok: false, permanent: false, error: 'no-email-provider-configured' };
  }
}

/** In-memory transport for tests and local verification. */
export class CaptureTransport implements EmailTransport {
  readonly kind = 'capture' as const;
  readonly description = 'capture (in-memory, tests only)';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    return { ok: true, id: `capture-${this.sent.length}` };
  }
}

export function redact(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain || !local) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

let transport: EmailTransport | null = null;

export function resolveTransport(): EmailTransport {
  if (transport) return transport;
  if (config.email.provider === 'smtp' && config.email.smtp.host) {
    transport = new SmtpTransport(config.email);
  } else if (config.email.provider === 'http' && config.email.http.url) {
    transport = new HttpTransport(config.email);
  } else {
    transport = new NoopTransport();
  }
  return transport;
}

/** Overrides the transport — used by the test suite. */
export function setTransport(next: EmailTransport | null): void {
  transport = next;
}

/** Verifies SMTP connectivity once at boot so misconfiguration shows up in logs, not at 3am. */
export async function verifyEmailTransport(): Promise<{ ok: boolean; detail: string }> {
  const current = resolveTransport();
  if (current.kind !== 'smtp') return { ok: current.kind !== 'none', detail: current.description };
  try {
    await (current as SmtpTransport).verify();
    return { ok: true, detail: current.description };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `SMTP connection failed: ${message}` };
  }
}

export async function closeEmailTransport(): Promise<void> {
  await transport?.close?.();
  transport = null;
}
