/**
 * Persistence helpers.
 *
 * Tokens live in the OS keychain (SecureStore) with an AsyncStorage fallback for
 * web, where SecureStore is unavailable. Everything else — cached screens and the
 * offline operation queue — uses AsyncStorage with a namespaced key scheme.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const NS = 'jarvis.';
const secureAvailable = Platform.OS !== 'web';

export const storageKeys = {
  refreshToken: 'auth.refresh',
  accessToken: 'auth.access',
  cachedQueries: 'cache.queries',
  pendingOps: 'offline.pending',
  lastSyncedSeq: 'sync.seq',
  deviceId: 'sync.deviceId',
  onboarding: 'app.onboarding',
  focusTimer: 'focus.timer',
} as const;

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(NS + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    // Storage pressure is never worth crashing a user's session over.
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(NS + key);
  } catch {
    /* ignore */
  }
}

async function secureSet(key: string, value: string | null): Promise<void> {
  if (!secureAvailable) {
    if (value === null) await AsyncStorage.removeItem(NS + key);
    else await AsyncStorage.setItem(NS + key, value);
    return;
  }
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
}

async function secureGet(key: string): Promise<string | null> {
  if (!secureAvailable) return AsyncStorage.getItem(NS + key);
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return AsyncStorage.getItem(NS + key);
  }
}

export const tokenStore = {
  async getAccess(): Promise<string | null> {
    return secureGet(storageKeys.accessToken);
  },
  async getRefresh(): Promise<string | null> {
    return secureGet(storageKeys.refreshToken);
  },
  async set(access: string | null, refresh: string | null): Promise<void> {
    await Promise.all([secureSet(storageKeys.accessToken, access), secureSet(storageKeys.refreshToken, refresh)]);
  },
  async clear(): Promise<void> {
    await Promise.all([secureSet(storageKeys.accessToken, null), secureSet(storageKeys.refreshToken, null)]);
  },
};

/** A stable per-install id so sync operations can be attributed to a device. */
export async function deviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(NS + storageKeys.deviceId);
  if (existing) return existing;
  const created = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  await AsyncStorage.setItem(NS + storageKeys.deviceId, created);
  return created;
}

export async function clearLocalData(): Promise<void> {
  await tokenStore.clear();
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((key) => key.startsWith(NS));
  if (ours.length) await AsyncStorage.multiRemove(ours);
}
