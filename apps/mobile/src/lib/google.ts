/**
 * Google Sign-In — device flow.
 *
 * Runs Google's OAuth 2.0 + PKCE flow in the system browser and returns the ID
 * token for the API to verify. There is no client secret in the app (a mobile
 * app is a public client; Google's Android/iOS client types are bound to the
 * package name + signing certificate instead), and nothing here is trusted by
 * the server.
 *
 * The feature is only offered when the build actually carries a client id:
 * `googleSignInAvailable()` returns false otherwise, and the sign-in screens
 * render no button at all. It is never faked.
 */
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import {
  GOOGLE_TOKEN_ENDPOINT,
  base64ToBase64Url,
  buildGoogleAuthUrl,
  bytesToBase64Url,
  deriveRedirectUri,
  googleClientIdForPlatform,
  parseGoogleRedirect,
  readIdToken,
  type GooglePlatformIds,
  type GoogleTokenResponse,
} from './google-flow';

/**
 * Client ids are public identifiers (they ship inside the app binary). The
 * *secret* is never present — for native client types Google does not issue a
 * usable one, and the server never needs it.
 */
export const googleClientIds: GooglePlatformIds = {
  android: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
  ios: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
  web: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
};

export class GoogleSignInError extends Error {
  readonly cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = 'GoogleSignInError';
    this.cancelled = cancelled;
  }
}

/** True only on a native platform whose client id is configured in this build. */
export function googleSignInAvailable(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  return googleClientIdForPlatform(Platform.OS, googleClientIds) !== null;
}

async function randomBase64Url(bytes: number): Promise<string> {
  return bytesToBase64Url(await Crypto.getRandomBytesAsync(bytes));
}

async function codeChallengeFor(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return base64ToBase64Url(digest);
}

/** Exchanges the authorization code (plus PKCE verifier) for an ID token. */
async function exchangeCode(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  nonce: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
    nonce: input.nonce,
  });
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenResponse;
  const idToken = readIdToken(payload);
  if (!idToken) {
    throw new GoogleSignInError(
      payload.error === 'invalid_grant'
        ? 'That Google sign-in attempt expired. Please try again.'
        : 'Google did not return a usable token. Please try again.',
    );
  }
  return idToken;
}

/**
 * Opens the Google account chooser and resolves with an ID token.
 *
 * Throws `GoogleSignInError` with `cancelled: true` when the person backs out,
 * so callers can stay silent instead of showing an error.
 */
export async function runGoogleSignIn(options: { loginHint?: string | null } = {}): Promise<string> {
  const clientId = googleClientIdForPlatform(Platform.OS, googleClientIds);
  if (!clientId) {
    throw new GoogleSignInError('Google Sign-In is not configured in this build.');
  }
  const redirectUri = process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI?.trim() || deriveRedirectUri(clientId);

  // CSRF protection (state), replay protection (nonce) and PKCE (verifier).
  const state = await randomBase64Url(16);
  const nonce = await randomBase64Url(16);
  const codeVerifier = await randomBase64Url(32);

  const authUrl = buildGoogleAuthUrl({
    clientId,
    redirectUri,
    state,
    nonce,
    codeChallenge: await codeChallengeFor(codeVerifier),
    loginHint: options.loginHint ?? null,
  });

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);
  if (result.type !== 'success' || !result.url) {
    throw new GoogleSignInError('Sign-in was cancelled.', true);
  }

  const redirect = parseGoogleRedirect(result.url);
  if (redirect.error) {
    throw new GoogleSignInError(
      redirect.error === 'access_denied' ? 'Sign-in was cancelled.' : 'Google could not complete the sign-in.',
      redirect.error === 'access_denied',
    );
  }
  if (!redirect.code) throw new GoogleSignInError('Google did not return an authorization code.');
  if (!redirect.state || redirect.state !== state) {
    // A mismatched state means the response did not come from the request we
    // started — discard it rather than exchanging the code.
    throw new GoogleSignInError('Sign-in could not be verified. Please try again.');
  }

  return exchangeCode({ clientId, code: redirect.code, codeVerifier, redirectUri, nonce });
}
