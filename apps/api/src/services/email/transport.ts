/**
 * Email transport contract.
 *
 * Every provider implements the same tiny interface, so swapping SMTP for a
 * transactional API (or for a capture transport in tests) never touches the
 * authentication code that sends password-reset mail.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always sent — readable everywhere and safe for links. */
  text: string;
  /** Optional HTML alternative. */
  html?: string;
}

export interface EmailSendResult {
  ok: boolean;
  /** Provider message id when the provider returns one. */
  id?: string;
  /**
   * True when the failure is permanent for this recipient (invalid address,
   * suppression list) as opposed to a transient transport problem. Callers use
   * this only for logging; they never surface it to the user.
   */
  permanent?: boolean;
  error?: string;
}

export interface EmailTransport {
  readonly kind: 'none' | 'smtp' | 'http' | 'capture';
  /** One-line description used in boot logs and `/health`. Never contains secrets. */
  readonly description: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
  close?(): Promise<void>;
}
