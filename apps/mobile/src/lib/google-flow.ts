/**
 * Google Sign-In — protocol helpers.
 *
 * Pure functions only, so the security-relevant parts of the OAuth 2.0 +
 * PKCE flow (redirect URI derivation, state, code challenge, response parsing)
 * can be unit-tested without a device or a network.
 *
 * Flow (Google's "OAuth 2.0 for Mobile & Desktop Apps"):
 *   1. generate `state` + `code_verifier`, derive `code_challenge = S256(verifier)`
 *   2. open the authorization endpoint in the system browser (ASWebAuthentication-
 *      style session on iOS, Chrome Custom Tabs on Android)
 *   3. the browser returns to the app with `?code=…&state=…`; `state` is compared
 *   4. exchange the code + verifier at the token endpoint (no client secret —
 *      the app is a public client, which is exactly what Google requires for
 *      Android/iOS client types)
 *   5. the returned ID token is verified by the JARVIS API, never by the app
 */
export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CLIENT_SUFFIX = '.apps.googleusercontent.com';
export const GOOGLE_SCOPES = ['openid', 'email', 'profile'] as const;

/** base64 (standard, padded) → base64url (unpadded), per RFC 7636 §A. */
export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Raw bytes → unpadded base64url (RFC 7636 §A), implemented without Buffer:
 * React Native has no Node buffers, and the code challenge must be identical
 * on every platform.
 */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_URL_ALPHABET[b0 >> 2];
    out += BASE64_URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += BASE64_URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += BASE64_URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Google's redirect for native client ids: the reversed client id, i.e.
 * `com.googleusercontent.apps.<id>:/oauth2redirect`. Both Android and iOS
 * client types use this shape, so the same derivation serves both.
 */
export function deriveRedirectUri(clientId: string): string {
  const trimmed = clientId.trim();
  const prefix = trimmed.endsWith(GOOGLE_CLIENT_SUFFIX)
    ? trimmed.slice(0, -GOOGLE_CLIENT_SUFFIX.length)
    : trimmed;
  return `com.googleusercontent.apps.${prefix}:/oauth2redirect`;
}

export interface GooglePlatformIds {
  android?: string | null;
  ios?: string | null;
  web?: string | null;
}

/**
 * Picks the client id for a platform. `null` means Google Sign-In is not
 * configured for that platform, and the UI must not offer it.
 */
export function googleClientIdForPlatform(platform: string, ids: GooglePlatformIds): string | null {
  if (platform === 'android') return ids.android?.trim() || null;
  if (platform === 'ios') return ids.ios?.trim() || null;
  if (platform === 'web') return ids.web?.trim() || null;
  return null;
}

export interface GoogleAuthUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  nonce: string;
  loginHint?: string | null;
}

export function buildGoogleAuthUrl(input: GoogleAuthUrlInput): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    // Always show the account chooser: a shared phone must not silently reuse
    // whichever Google account happens to be signed in on the browser.
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  if (input.loginHint) params.set('login_hint', input.loginHint);
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleRedirect {
  code: string | null;
  state: string | null;
  error: string | null;
  errorDescription: string | null;
}

/** Parses the URL the browser came back with (query string or fragment). */
export function parseGoogleRedirect(url: string): GoogleRedirect {
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const [search] = query.split('#');
  const params = new URLSearchParams(search ?? '');
  const hash = url.includes('#') ? url.slice(url.indexOf('#') + 1) : '';
  const hashParams = new URLSearchParams(hash);
  const pick = (key: string): string | null => params.get(key) ?? hashParams.get(key);
  return {
    code: pick('code'),
    state: pick('state'),
    error: pick('error'),
    errorDescription: pick('error_description'),
  };
}

export interface GoogleTokenResponse {
  id_token?: string;
  error?: string;
  error_description?: string;
}

/** Extracts the ID token from Google's token-endpoint response. */
export function readIdToken(payload: GoogleTokenResponse): string | null {
  if (payload.error) return null;
  const token = payload.id_token?.trim();
  return token && token.split('.').length === 3 ? token : null;
}
