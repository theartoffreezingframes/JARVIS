import type { NotificationKind, NotificationPreferences } from '@jarvis/shared';
import { config } from '../../env.js';
import { deletePushTokens, listPushTokens } from '../../repo/push.js';
import { parseSettings } from '../../repo/mappers.js';
import { findUserById, getSettingsRow } from '../../repo/users.js';
import { fetchExpoReceipts, isValidPushToken, sendExpoPush, type ExpoPushMessage } from './expo.js';

/**
 * Remote push delivery.
 *
 * Design rules:
 *  - a notification row is the source of truth; push is best-effort delivery of it;
 *  - nothing is sent unless a real device token is registered for that account;
 *  - per-category preferences and quiet hours are respected, exactly like the
 *    in-app list and the locally scheduled notifications;
 *  - tokens the push service rejects as unregistered are deleted, so a
 *    reinstalled app never blocks delivery;
 *  - every failure is logged server-side and never surfaced to a user.
 */

const KIND_PREFERENCE: Record<NotificationKind, keyof NotificationPreferences | null> = {
  task_reminder: 'taskReminder',
  deadline: 'deadline',
  overdue: 'overdue',
  habit_reminder: 'habitReminder',
  focus_scheduled: 'focusScheduled',
  gang_invite: 'gangInvite',
  gang_upcoming: 'gangUpcoming',
  daily_planning: 'dailyPlanning',
  daily_review: 'dailyReview',
};

interface PendingReceipt {
  token: string;
  at: number;
}

/** Ticket ids awaiting a receipt check (24 h is Expo's receipt window; we keep 1 h). */
const pendingReceipts = new Map<string, PendingReceipt>();
let receiptTimer: NodeJS.Timeout | null = null;

export function pushEnabled(): boolean {
  return config.push.enabled;
}

export function pendingReceiptCount(): number {
  return pendingReceipts.size;
}

/** Formats a quiet-hours check in the user's own timezone offset. */
function inQuietHours(prefs: NotificationPreferences, nowMs: number, timezoneOffsetMinutes: number): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const minutes = parseClock(prefs.quietHoursStart);
  const end = parseClock(prefs.quietHoursEnd);
  if (minutes === null || end === null) return false;
  const local = new Date(nowMs + timezoneOffsetMinutes * 60_000);
  const current = local.getUTCHours() * 60 + local.getUTCMinutes();
  // Windows that cross midnight (22:00 → 07:00) wrap around.
  return minutes <= end ? current >= minutes && current < end : current >= minutes || current < end;
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

export interface PushDispatchInput {
  title: string;
  body: string;
  kind: NotificationKind;
  data?: Record<string, unknown>;
}

/**
 * Sends one notification to every device the user has registered.
 * Resolves after the push service responded (or immediately when disabled).
 */
export async function dispatchPushToUser(userId: string, input: PushDispatchInput): Promise<number> {
  if (!config.push.enabled) return 0;

  const rows = listPushTokens(userId).filter((row) => row.enabled === 1 && isValidPushToken(row.token));
  if (!rows.length) return 0;

  const user = findUserById(userId);
  if (!user) return 0;
  const settings = parseSettings(user, getSettingsRow(userId));
  const preferenceKey = KIND_PREFERENCE[input.kind];
  if (preferenceKey && settings.notifications[preferenceKey] === false) return 0;
  // Quiet hours are interpreted in the user's own timezone offset.
  if (inQuietHours(settings.notifications, Date.now(), user.tz_offset_minutes ?? 0)) return 0;

  const messages: ExpoPushMessage[] = rows.map((row) => ({
    to: row.token,
    title: input.title,
    body: input.body,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: { ...(input.data ?? {}), kind: input.kind },
  }));

  const outcome = await sendExpoPush(messages);
  if (outcome.invalidTokens.length) {
    const removed = deletePushTokens(outcome.invalidTokens);
    console.log(`[push] removed ${removed} token(s) the push service reported as unregistered`);
  }
  if (outcome.error) console.error(`[push] ${outcome.error}`);
  for (const ticket of outcome.tickets) pendingReceipts.set(ticket.id, { token: ticket.token, at: Date.now() });
  ensureReceiptPolling();
  return outcome.accepted;
}

/** Convenience wrapper for a notification row that was just stored. */
export interface PushableNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  sessionId?: string | null;
  groupId?: string | null;
  entityId?: string | null;
}

export async function dispatchNotificationPush(userId: string, notification: PushableNotification): Promise<void> {
  const data: Record<string, unknown> = {};
  if (notification.sessionId) data.sessionId = notification.sessionId;
  if (notification.groupId) data.groupId = notification.groupId;
  if (notification.entityId) data.entityId = notification.entityId;
  await dispatchPushToUser(userId, {
    title: notification.title,
    body: notification.body,
    kind: notification.kind,
    data,
  });
}

/**
 * Receipt polling: Expo reports *delivery* asynchronously. Tokens whose receipt
 * says `DeviceNotRegistered` are cleaned up here too.
 */
function ensureReceiptPolling(): void {
  if (receiptTimer || !pendingReceipts.size) return;
  receiptTimer = setInterval(() => {
    void checkReceipts();
  }, 60_000);
  receiptTimer.unref?.();
}

export async function checkReceipts(): Promise<void> {
  if (!pendingReceipts.size) {
    if (receiptTimer) {
      clearInterval(receiptTimer);
      receiptTimer = null;
    }
    return;
  }
  const ids = [...pendingReceipts.keys()];
  const receipts = await fetchExpoReceipts(ids);
  const invalid: string[] = [];
  for (const [id, receipt] of Object.entries(receipts)) {
    const entry = pendingReceipts.get(id);
    pendingReceipts.delete(id);
    if (!entry) continue;
    if (receipt.status === 'error') {
      if (receipt.details?.error === 'DeviceNotRegistered') invalid.push(entry.token);
      else console.error(`[push] receipt error: ${receipt.message ?? receipt.details?.error ?? 'unknown'}`);
    }
  }
  // Tickets without a receipt yet stay queued, but not forever.
  const cutoff = Date.now() - 60 * 60_000;
  for (const [id, entry] of pendingReceipts) if (entry.at < cutoff) pendingReceipts.delete(id);
  if (invalid.length) {
    const removed = deletePushTokens(invalid);
    console.log(`[push] removed ${removed} token(s) after delivery receipts`);
  }
}

/** Test helper. */
export function resetPushState(): void {
  pendingReceipts.clear();
  if (receiptTimer) {
    clearInterval(receiptTimer);
    receiptTimer = null;
  }
}
