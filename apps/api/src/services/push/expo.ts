import { config } from '../../env.js';

/**
 * Expo push transport.
 *
 * Expo's push service is the standard way to reach Expo-built Android and iOS
 * apps: it relays to FCM/APNs using the credentials configured on the EAS
 * project, so no Firebase service-account JSON is needed in this repository.
 * A self-hosted gateway can be substituted with `JARVIS_PUSH_ENDPOINT`.
 */
export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  badge?: number;
  data?: Record<string, unknown>;
}

export interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const CHUNK = 100;

/** Expo accepts `ExponentPushToken[...]`, `ExpoPushToken[...]` or a raw native token. */
export function isValidPushToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  if (/^Expo(nent)?PushToken\[[A-Za-z0-9._~-]{8,}\]$/.test(token)) return true;
  // Native device tokens (FCM registration tokens / APNs hex) as a fallback.
  return /^[A-Za-z0-9:_-]{32,}$/.test(token);
}

export function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PushSendOutcome {
  /** Tokens Expo accepted into its queue. */
  accepted: number;
  /** Tokens that must be removed (uninstalled app / revoked token). */
  invalidTokens: string[];
  /** Ticket ids to poll for receipts, paired with the token they belong to. */
  tickets: Array<{ id: string; token: string }>;
  error?: string;
}

export async function sendExpoPush(messages: ExpoPushMessage[]): Promise<PushSendOutcome> {
  const outcome: PushSendOutcome = { accepted: 0, invalidTokens: [], tickets: [] };
  if (!messages.length) return outcome;

  for (const batch of chunk(messages)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.push.timeoutMs);
    try {
      const response = await fetch(config.push.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(config.push.accessToken ? { authorization: `Bearer ${config.push.accessToken}` } : {}),
        },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        outcome.error = `push service HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
        continue;
      }
      const payload = (await response.json()) as { data?: ExpoTicket[] };
      const tickets = payload.data ?? [];
      tickets.forEach((ticket, index) => {
        const token = batch[index]?.to;
        if (!token) return;
        if (ticket.status === 'ok') {
          outcome.accepted += 1;
          if (ticket.id) outcome.tickets.push({ id: ticket.id, token });
          return;
        }
        if (ticket.details?.error === 'DeviceNotRegistered') {
          outcome.invalidTokens.push(token);
        } else {
          outcome.error = `ticket error: ${ticket.message ?? ticket.details?.error ?? 'unknown'}`;
        }
      });
    } catch (error) {
      outcome.error = error instanceof Error ? `push request failed: ${error.message}` : 'push request failed';
    } finally {
      clearTimeout(timer);
    }
  }
  return outcome;
}

export interface ExpoReceipt {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/** Receipts tell us whether Expo actually delivered to the device. */
export async function fetchExpoReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  if (!ids.length) return {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.push.timeoutMs);
  try {
    const response = await fetch(config.push.receiptEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(config.push.accessToken ? { authorization: `Bearer ${config.push.accessToken}` } : {}),
      },
      body: JSON.stringify({ ids: ids.slice(0, 1000) }),
      signal: controller.signal,
    });
    if (!response.ok) return {};
    const payload = (await response.json()) as { data?: Record<string, ExpoReceipt> };
    return payload.data ?? {};
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
