/**
 * The single HTTP entry point for the app.
 *
 * Responsibilities: resolve the API origin (dev server, explicit override, or the
 * origin that served the web build), attach the access token, transparently refresh
 * an expired access token once, and turn every failure into an `ApiError` the UI can
 * explain to a person.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { tokenStore } from './storage';

const DEFAULT_PORT = 4000;

function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  if (Platform.OS === 'web') {
    // The web export is served by the API itself, so same-origin requests work.
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    return `http://localhost:${DEFAULT_PORT}`;
  }

  // In development, the Metro host is the machine running the API as well.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    '';
  const host = hostUri.split(':')[0];
  if (host) return `http://${host}:${DEFAULT_PORT}`;
  return `http://localhost:${DEFAULT_PORT}`;
}

export const API_BASE_URL = resolveBaseUrl();

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The request never reached the server (or timed out) — safe to queue and retry. */
  get isOffline(): boolean {
    return this.status === 0;
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Internal: prevents infinite refresh loops. */
  retryOnAuth?: boolean;
  skipAuth?: boolean;
}

let refreshing: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = await tokenStore.getRefresh();
    if (!refreshToken) return false;
    try {
      const response = await fetch(buildUrl('/api/auth/refresh'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as { accessToken: string; refreshToken: string };
      await tokenStore.set(payload.accessToken, payload.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => {
        refreshing = null;
      }, 0);
    }
  })();
  return refreshing;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, timeoutMs = 20_000, retryOnAuth = true, skipAuth } = options;
  const token = skipAuth ? null : await tokenStore.getAccess();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    const aborted = (error as { name?: string })?.name === 'AbortError';
    throw new ApiError(0, aborted ? 'timeout' : 'offline', aborted ? 'The request timed out' : 'You appear to be offline');
  }
  clearTimeout(timer);

  if (response.status === 401 && retryOnAuth && !skipAuth) {
    const refreshed = await refreshSession();
    if (refreshed) return apiRequest<T>(path, { ...options, retryOnAuth: false });
    onSessionExpired?.();
    throw new ApiError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const shape = (payload ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(
      response.status,
      shape.error ?? 'error',
      shape.message ?? friendlyStatus(response.status),
      shape.details,
    );
  }

  return payload as T;
}

function friendlyStatus(status: number): string {
  if (status === 400) return 'That request looked invalid';
  if (status === 403) return 'You do not have access to that';
  if (status === 404) return 'We could not find that';
  if (status === 409) return 'That conflicts with existing data';
  if (status === 429) return 'Too many attempts. Please wait a moment';
  if (status >= 500) return 'Something went wrong on our side';
  return 'Unexpected response';
}

/** Convenience wrappers used by every hook module. */
export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET', query }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
};

export function realtimeUrl(token: string, sessionId?: string | null): string {
  const base = API_BASE_URL.replace(/^http/, 'ws');
  const params = new URLSearchParams({ token });
  if (sessionId) params.set('sessionId', sessionId);
  return `${base}/realtime?${params.toString()}`;
}
