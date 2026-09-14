/**
 * Google Sign-In (OpenID Connect) — server side.
 *
 * The mobile app runs the OAuth 2.0 + PKCE flow in the system browser and hands
 * the resulting ID token to this server, which is the only party allowed to
 * decide whether the token is genuine:
 *
 *  - the signature is checked against Google's published JWKS
 *    (RS256, keyed by the `kid` header, cached by `jose`);
 *  - `iss` must be Google's issuer, `aud` must be one of this deployment's
 *    configured client ids, and `exp`/`iat` must be valid;
 *  - `email_verified` must be true before an email address is trusted.
 *
 * Nothing about the flow trusts the client: a forged or replayed token fails
 * closed. Accounts are keyed by Google's immutable `sub`, and linking to an
 * existing password account happens only through a verified email address.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { config } from '../env.js';
import { AppError } from '../lib/errors.js';
import { hashPassword, newId } from '../lib/crypto.js';
import {
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
  findUserByUsername,
  linkGoogleSub,
} from '../repo/users.js';
import type { UserRow } from '../repo/rows.js';
import { issueTokens, type IssuedTokens } from './auth.js';

/** Both spellings are emitted by Google depending on the token endpoint used. */
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export interface GoogleIdentity {
  /** Google's stable user id (`sub`). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface GoogleVerifierOptions {
  /** Accepted audiences. Empty means "feature not configured". */
  clientIds: readonly string[];
  /** Injectable key source; production uses Google's JWKS endpoint. */
  keys?: JWTVerifyGetKey;
  clockToleranceSeconds?: number;
}

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

/**
 * Builds a verifier. The JWKS is fetched lazily and cached in-process by jose,
 * so a rotation on Google's side is picked up without a redeploy.
 */
export function createGoogleVerifier(options: GoogleVerifierOptions): GoogleVerifier {
  const keys = options.keys ?? createRemoteJWKSet(new URL(GOOGLE_JWKS_URL), { timeoutDuration: 5_000 });
  const audiences = options.clientIds.filter(Boolean);

  return {
    async verify(idToken: string): Promise<GoogleIdentity> {
      if (!audiences.length) {
        throw AppError.badRequest('Google sign-in is not configured on this server');
      }
      if (!idToken || idToken.length > 8192) {
        throw AppError.unauthorized('Sign-in could not be completed. Please try again.');
      }
      let payload;
      try {
        const result = await jwtVerify(idToken, keys, {
          issuer: GOOGLE_ISSUERS,
          audience: [...audiences],
          algorithms: ['RS256'],
          clockTolerance: options.clockToleranceSeconds ?? 60,
        });
        payload = result.payload;
      } catch {
        // A single generic message: never echo the reason back to a client.
        throw AppError.unauthorized('Google sign-in could not be verified. Please try again.');
      }

      const subject = typeof payload.sub === 'string' ? payload.sub : '';
      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
      if (!subject) throw AppError.unauthorized('Google sign-in could not be verified. Please try again.');
      if (!email || !emailVerified) {
        throw AppError.badRequest('Your Google account has no verified email address, so it cannot be used here.');
      }

      return {
        subject,
        email,
        emailVerified,
        name: typeof payload.name === 'string' ? payload.name : null,
        picture: typeof payload.picture === 'string' ? payload.picture : null,
      };
    },
  };
}

export const googleVerifier = createGoogleVerifier({ clientIds: config.google.clientIds });

/**
 * The verifier actually used at runtime.
 *
 * Production keeps the default (Google's JWKS). Tests — and any future
 * deployment that prefers to pin keys — install their own key source; the
 * verification rules themselves are unchanged.
 */
let installedVerifier: GoogleVerifier | null = null;

export function setGoogleVerifier(verifier: GoogleVerifier | null): void {
  installedVerifier = verifier;
}

export function activeGoogleVerifier(): GoogleVerifier {
  return installedVerifier ?? googleVerifier;
}

export function googleSignInAvailable(): boolean {
  return config.google.clientIds.length > 0;
}

/**
 * A password that nobody can supply.
 *
 * Google-only accounts still get a real scrypt hash of random bytes so the
 * column is never empty (and a password attempt costs the same work as any
 * other failed login); `has_password` is what actually disables password login.
 */
async function unusablePasswordHash(): Promise<string> {
  return hashPassword(newId('nologin') + newId('nologin'));
}

function usernameFromEmail(email: string): string {
  const base = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, '') ?? '';
  const candidate = base.replace(/^[._-]+/, '').slice(0, 24);
  return candidate.length >= 3 ? candidate : `user${candidate}`;
}

function uniqueUsername(email: string): string {
  const base = usernameFromEmail(email);
  if (!findUserByUsername(base)) return base;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffixed = `${base}${Math.floor(Math.random() * 9000) + 1000}`.slice(0, 30);
    if (!findUserByUsername(suffixed)) return suffixed;
  }
  return `${base}${Date.now().toString(36)}`.slice(0, 30);
}

export interface GoogleSignInResult {
  user: UserRow;
  tokens: IssuedTokens;
  /** True when this sign-in created the account. */
  created: boolean;
  /** True when a existing password account was linked to the Google subject. */
  linked: boolean;
}

export interface GoogleSignInInput {
  idToken: string;
  deviceName?: string | null;
  timezone?: string;
  timezoneOffsetMinutes?: number;
  /** Injectable verifier; tests pass their own, callers use the default. */
  verifier?: GoogleVerifier;
}

export async function signInWithGoogle(input: GoogleSignInInput): Promise<GoogleSignInResult> {
  if (!googleSignInAvailable()) {
    throw AppError.unavailable('Google sign-in is not enabled on this server');
  }
  const verifier = input.verifier ?? activeGoogleVerifier();
  const identity = await verifier.verify(input.idToken);

  // 1. The Google subject is the primary key of the link — it never changes.
  const existing = findUserByGoogleSub(identity.subject);
  if (existing) {
    return { user: existing, tokens: issueTokens(existing, input.deviceName ?? null), created: false, linked: false };
  }

  // 2. A verified Google email matches an account created with a password:
  //    link it. (Google has proven control of the address, which is the same
  //    proof a password reset would require.)
  const byEmail = findUserByEmail(identity.email);
  if (byEmail) {
    linkGoogleSub(byEmail.id, identity.subject);
    const linked = findUserByGoogleSub(identity.subject)!;
    return { user: linked, tokens: issueTokens(linked, input.deviceName ?? null), created: false, linked: true };
  }

  // 3. First sign-in: create the account. No password exists yet — the account
  //    owner can set one from Settings (proved by holding a live session).
  const created = createUser({
    email: identity.email,
    username: uniqueUsername(identity.email),
    name: identity.name?.trim() || usernameFromEmail(identity.email),
    passwordHash: await unusablePasswordHash(),
    timezone: input.timezone ?? 'UTC',
    timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? 0,
    googleSub: identity.subject,
    hasPassword: false,
    emailVerified: true,
    avatarUrl: identity.picture,
  });
  return { user: created, tokens: issueTokens(created, input.deviceName ?? null), created: true, linked: false };
}

export { GOOGLE_ISSUERS, GOOGLE_JWKS_URL };
