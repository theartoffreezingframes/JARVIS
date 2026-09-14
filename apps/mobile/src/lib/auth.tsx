/**
 * Session state.
 *
 * Holds the signed-in user, their settings and the tokens (kept in the OS
 * keychain). Every other hook reads the profile from here so preferences such as
 * the 24-hour clock or the first day of the week stay consistent app-wide.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { UserSettings } from '@jarvis/shared';
import { api, ApiError, setSessionExpiredHandler } from './api';
import { clearLocalData, readJson, tokenStore, writeJson, storageKeys } from './storage';
import type { DeepPartial } from './types';
import { clearQueryCache, invalidate } from './query';
import { realtime } from './realtime';
import { applyThemeSettings } from './theme';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  timezone: string;
  timezoneOffsetMinutes: number;
  createdAt: number;
  emailVerified: boolean;
  weekStartsOn: number;
  use24Hour: boolean;
}

interface AuthPayload {
  user: SessionUser;
  settings: UserSettings;
  accessToken: string;
  refreshToken: string;
}

interface MePayload {
  user: SessionUser;
  settings: UserSettings;
}

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut';

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  settings: UserSettings | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    name: string;
    username: string;
    timezone: string;
    timezoneOffsetMinutes: number;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  forgotPassword: (email: string) => Promise<string | null>;
  resetPassword: (token: string, password: string) => Promise<void>;
  updateProfile: (patch: Partial<SessionUser> & { avatarUrl?: string | null }) => Promise<void>;
  updateSettings: (patch: DeepPartial<UserSettings>) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  changeEmail: (email: string, password: string) => Promise<void>;
  refreshMe: () => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyMe = useCallback((payload: MePayload) => {
    setUser(payload.user);
    setSettings(payload.settings);
  }, []);

  const loadMe = useCallback(async () => {
    const me = await api.get<MePayload>('/api/me');
    applyMe(me);
    return me;
  }, [applyMe]);

  const signOut = useCallback(async () => {
    const refreshToken = await tokenStore.getRefresh();
    try {
      if (refreshToken) await api.post('/api/auth/logout', { refreshToken }, { skipAuth: true });
    } catch {
      /* signing out locally always succeeds */
    }
    realtime.disconnect();
    await tokenStore.clear();
    clearQueryCache();
    setUser(null);
    setSettings(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      void signOut();
    });
    return () => setSessionExpiredHandler(null);
  }, [signOut]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const refreshToken = await tokenStore.getRefresh();
      if (!refreshToken) {
        setStatus('signedOut');
        return;
      }
      try {
        const me = await api.get<MePayload>('/api/me');
        if (cancelled) return;
        applyMe(me);
        setStatus('signedIn');
        realtime.reconnect();
      } catch (loadError) {
        if (cancelled) return;
        if (loadError instanceof ApiError && loadError.isAuth) {
          await tokenStore.clear();
          setStatus('signedOut');
        } else {
          // Offline start with a stored session: show the app with cached data.
          const cached = await readJson<MePayload | null>('cache.session', null);
          if (cached) {
            applyMe(cached);
            setStatus('signedIn');
          } else {
            setStatus('signedOut');
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyMe]);

  useEffect(() => {
    if (status === 'signedIn' && user && settings) {
      void writeJson('cache.session', { user, settings });
    }
  }, [status, user, settings]);

  // Customization lives on the account, so the theme follows the user across
  // devices: preference, preset, accent, density, corner style, motion, font size.
  useEffect(() => {
    if (!settings) return;
    applyThemeSettings({
      preference: settings.theme,
      preset: settings.appearance?.preset ?? 'indigo',
      accentColor: settings.accentColor,
      density: settings.appearance?.density ?? 'comfortable',
      radiusStyle: settings.appearance?.radiusStyle ?? 'rounded',
      animationLevel: settings.appearance?.animationLevel ?? 'full',
      fontScale: settings.appearance?.fontScale ?? 1,
    });
  }, [settings]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      try {
        const payload = await api.post<AuthPayload>(
          '/api/auth/login',
          { email: email.trim().toLowerCase(), password, deviceName: 'mobile' },
          { skipAuth: true },
        );
        await tokenStore.set(payload.accessToken, payload.refreshToken);
        applyMe({ user: payload.user, settings: payload.settings });
        setStatus('signedIn');
        realtime.reconnect();
        invalidate('dashboard', 'tasks', 'habits', 'analytics');
      } catch (signInError) {
        setError(toMessage(signInError));
        throw signInError;
      }
    },
    [applyMe],
  );

  const signUp = useCallback<AuthContextValue['signUp']>(
    async (input) => {
      setError(null);
      try {
        const payload = await api.post<AuthPayload>(
          '/api/auth/signup',
          { ...input, email: input.email.trim().toLowerCase(), deviceName: 'mobile' },
          { skipAuth: true },
        );
        await tokenStore.set(payload.accessToken, payload.refreshToken);
        applyMe({ user: payload.user, settings: payload.settings });
        setStatus('signedIn');
        realtime.reconnect();
      } catch (signUpError) {
        setError(toMessage(signUpError));
        throw signUpError;
      }
    },
    [applyMe],
  );

  const forgotPassword = useCallback(async (email: string) => {
    const result = await api.post<{ ok: boolean; devToken?: string | null }>(
      '/api/auth/forgot-password',
      { email: email.trim().toLowerCase() },
      { skipAuth: true },
    );
    // When the deployment has no mail provider configured the API returns the
    // token directly so the reset flow is still usable — the UI says so.
    return result.devToken ?? null;
  }, []);

  const resetPassword = useCallback(
    async (token: string, password: string) => {
      const payload = await api.post<AuthPayload>('/api/auth/reset-password', { token, password }, { skipAuth: true });
      // The server issues a fresh session on a successful reset, so the user
      // lands straight in their workspace instead of signing in again.
      await tokenStore.set(payload.accessToken, payload.refreshToken);
      applyMe({ user: payload.user, settings: payload.settings });
      setStatus('signedIn');
      realtime.reconnect();
    },
    [applyMe],
  );

  const refreshMe = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const updateProfile = useCallback<AuthContextValue['updateProfile']>(
    async (patch) => {
      const payload = await api.patch<MePayload>('/api/me', patch);
      applyMe(payload);
      invalidate('me');
    },
    [applyMe],
  );

  const updateSettings = useCallback<AuthContextValue['updateSettings']>(
    async (patch) => {
      const payload = await api.patch<{ settings: UserSettings; user?: SessionUser }>('/api/me/settings', patch);
      setSettings(payload.settings);
      if (payload.user) setUser(payload.user);
      invalidate('dashboard');
    },
    [],
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.post('/api/auth/change-password', { currentPassword, newPassword });
  }, []);

  const changeEmail = useCallback(async (email: string, password: string) => {
    const payload = await api.post<MePayload>('/api/me/email', { email: email.trim().toLowerCase(), password });
    applyMe(payload);
  }, [applyMe]);

  const deleteAccount = useCallback<AuthContextValue['deleteAccount']>(
    async (password) => {
      await api.delete('/api/me', { method: 'DELETE', body: { password, confirm: 'DELETE' } });
      await clearLocalData();
      clearQueryCache();
      setUser(null);
      setSettings(null);
      setStatus('signedOut');
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      settings,
      error,
      signIn,
      signUp,
      signOut,
      forgotPassword,
      resetPassword,
      updateProfile,
      updateSettings,
      changePassword,
      changeEmail,
      refreshMe,
      deleteAccount,
    }),
    [
      status,
      user,
      settings,
      error,
      signIn,
      signUp,
      signOut,
      forgotPassword,
      resetPassword,
      updateProfile,
      updateSettings,
      changePassword,
      changeEmail,
      refreshMe,
      deleteAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
