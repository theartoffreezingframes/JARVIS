/**
 * Where the app looks for its API.
 *
 * Kept free of React Native imports so the rules can be unit tested in plain
 * Node — this is the single most consequential piece of configuration in the
 * whole app, and shipping a release that quietly talks to `localhost` would make
 * every installation useless.
 *
 * Resolution order:
 *  1. `EXPO_PUBLIC_API_URL` — inlined at build time, so a build can be pointed at
 *     any server without touching code. This is how release APKs are configured.
 *  2. Web: the origin that served the bundle (the API serves the exported web app).
 *  3. Development native: the Metro host on port 4000 (the dev machine also runs
 *     the API).
 *  4. Otherwise: **empty**, which the UI reports as a configuration error. It is
 *     deliberately not a localhost URL.
 */

export interface BaseUrlInputs {
  /** `process.env.EXPO_PUBLIC_API_URL` */
  explicit?: string | null;
  platform: 'web' | 'ios' | 'android' | 'windows' | 'macos';
  /** `window.location.origin` on web. */
  webOrigin?: string | null;
  /** `Constants.expoConfig.hostUri` (e.g. `192.168.1.5:8081`) in development. */
  hostUri?: string | null;
  /** True for a bundled release build (no dev server). */
  isRelease: boolean;
  defaultPort?: number;
}

export const DEFAULT_API_PORT = 4000;

export function resolveApiBaseUrl(inputs: BaseUrlInputs): string {
  const port = inputs.defaultPort ?? DEFAULT_API_PORT;
  const explicit = inputs.explicit?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  if (inputs.platform === 'web') {
    if (inputs.webOrigin) return inputs.webOrigin.replace(/\/+$/, '');
    return `http://localhost:${port}`;
  }

  if (inputs.isRelease) return '';

  const host = inputs.hostUri?.split(':')[0];
  if (host) return `http://${host}:${port}`;
  return `http://localhost:${port}`;
}

/** True for addresses that only ever work on the machine that built the app. */
export function isPrivateAddress(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
    url,
  );
}

export function apiConfigurationMessage(): string {
  return (
    'This build was created without an API address. Ask whoever built it to rebuild with ' +
    'EXPO_PUBLIC_API_URL=https://your-jarvis-server (see the README).'
  );
}
