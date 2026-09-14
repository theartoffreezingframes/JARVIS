/**
 * Remote push registration.
 *
 * Local notifications (scheduled on-device from server-defined reminders) keep
 * working with no push infrastructure at all. This module adds *remote* push on
 * top: the device registers a real Expo push token with the API so the server can
 * reach it when something happens that no local schedule could know about — a
 * gang session starting right now, for example.
 *
 * Nothing here pretends to succeed: every failure mode is reported as a status the
 * Settings screen can show, and the token is only ever registered while a user is
 * signed in (the server ties it to that account and re-points it on account
 * switch).
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';
import { deviceId, readJson, writeJson } from './storage';

export type PushRegistrationStatus =
  | 'registered'
  | 'denied'
  | 'unsupported'
  | 'not-configured'
  | 'offline'
  | 'error';

export interface PushRegistrationResult {
  status: PushRegistrationStatus;
  detail?: string;
}

export const pushTokenKey = 'push.token';

/** The EAS project id is what ties a token to the right app on Expo's servers. */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const fromExtra = extra?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra) return fromExtra;
  const fromEas = (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return typeof fromEas === 'string' && fromEas ? fromEas : null;
}

export function pushSupported(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

async function ensurePermission(): Promise<'granted' | 'denied'> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'denied';
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'granted' : 'denied';
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 120, 80, 120],
  });
}

export async function registerForPush(): Promise<PushRegistrationResult> {
  if (!pushSupported()) return { status: 'unsupported', detail: 'Remote push is available on Android and iOS.' };

  const projectId = easProjectId();
  if (!projectId) {
    return {
      status: 'not-configured',
      detail: 'This build has no EAS project id, so it cannot obtain a push token. Local reminders still work.',
    };
  }

  let permission: 'granted' | 'denied';
  try {
    permission = await ensurePermission();
    await ensureChannel();
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : 'Notification permission failed' };
  }
  if (permission === 'denied') {
    return { status: 'denied', detail: 'Notifications are turned off for JARVIS in system settings.' };
  }

  let token: string;
  try {
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch (error) {
    return {
      status: 'error',
      detail:
        error instanceof Error
          ? `Could not obtain a push token: ${error.message}`
          : 'Could not obtain a push token. Remote push needs a development or release build (not Expo Go).',
    };
  }

  try {
    await api.post('/api/push/tokens', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      deviceId: await deviceId(),
      deviceName: Constants.deviceName ?? null,
    });
  } catch (error) {
    const status = (error as { isOffline?: boolean })?.isOffline ? 'offline' : 'error';
    return { status, detail: error instanceof Error ? error.message : 'Could not register this device' };
  }

  await writeJson(pushTokenKey, token);
  return { status: 'registered', detail: token };
}

/** Removes this device's registration so a signed-out phone stops receiving pushes. */
export async function unregisterFromPush(): Promise<void> {
  const token = await readJson<string | null>(pushTokenKey, null);
  if (!token) return;
  try {
    await api.delete('/api/push/tokens', { body: { token } });
  } catch {
    /* Offline sign-out still clears the local token; the server drops it on next sign-in. */
  }
  await writeJson(pushTokenKey, null);
}

/** Sends a real test notification to this account's devices and reports the truth. */
export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await api.post<{ ok: boolean; accepted: number; devices: number }>('/api/push/test');
    return {
      ok: result.ok,
      message:
        result.accepted > 0
          ? `Sent to ${result.accepted} of ${result.devices} registered device(s).`
          : 'The push service did not accept the notification. Check the Firebase credentials configured for the EAS project.',
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not send the test notification' };
  }
}
