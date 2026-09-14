import { config } from '../../env.js';
import { redact, resolveTransport } from './index.js';
import type { EmailMessage, EmailSendResult } from './transport.js';

/**
 * Application-level mail: the only place that knows what JARVIS emails look like.
 * The reset link is deliberately the single source of truth for the token, so
 * there is exactly one place where a token could leak — and it logs nothing.
 */
export interface PasswordResetMail {
  to: string;
  name: string;
  /** Single-use, time-limited reset URL containing the raw token. */
  resetUrl: string;
  expiresInMinutes: number;
}

export function passwordResetMessage(mail: PasswordResetMail): EmailMessage {
  const subject = 'Reset your JARVIS password';
  const text = [
    `Hi ${mail.name},`,
    '',
    'Someone asked to reset the password for your JARVIS account. If that was you, open this link:',
    '',
    mail.resetUrl,
    '',
    `The link can be used once and expires in ${mail.expiresInMinutes} minutes.`,
    'If you did not ask for this, you can ignore this email — your password stays unchanged.',
    '',
    '— JARVIS',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:24px">
  <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
    <tr><td>
      <h1 style="font-size:20px;margin:0 0 12px">Reset your JARVIS password</h1>
      <p style="color:#333;line-height:1.5">Hi ${escapeHtml(mail.name)},</p>
      <p style="color:#333;line-height:1.5">Someone asked to reset the password for your JARVIS account. If that was you, use the button below.</p>
      <p style="margin:24px 0">
        <a href="${escapeHtml(mail.resetUrl)}" style="background:#2f6fed;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">Choose a new password</a>
      </p>
      <p style="color:#666;font-size:13px;line-height:1.5">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(mail.resetUrl)}</span></p>
      <p style="color:#666;font-size:13px;line-height:1.5">The link works once and expires in ${mail.expiresInMinutes} minutes. If you did not ask for this, ignore this email — your password stays unchanged.</p>
    </td></tr>
  </table>
</body></html>`;

  return { to: mail.to, subject, text, html };
}

export async function sendPasswordResetEmail(mail: PasswordResetMail): Promise<EmailSendResult> {
  const transport = resolveTransport();
  const result = await transport.send(passwordResetMessage(mail));
  if (!result.ok) {
    // Log the address redacted and never the token or URL.
    console.error(`[email] password reset delivery failed for ${redact(mail.to)} via ${transport.kind}: ${result.error}`);
  } else {
    console.log(`[email] password reset sent to ${redact(mail.to)} via ${transport.kind}`);
  }
  return result;
}

/** Public base URL used to build the reset link. */
export function publicBaseUrl(): string {
  if (config.publicUrl) return config.publicUrl;
  // Fallback for local development only; production requires JARVIS_PUBLIC_URL.
  return `http://localhost:${config.port}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
