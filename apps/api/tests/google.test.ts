/**
 * Google Sign-In — real verification, no network.
 *
 * The tests generate their own RSA key pair and install it as the key source,
 * so the *actual* verification code runs (RS256 signature, issuer, audience,
 * expiry, verified email). Only the location of the keys differs from
 * production, where the same code fetches Google's JWKS endpoint.
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import type { FastifyInstance } from 'fastify';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
const dir = mkdtempSync(join(tmpdir(), 'jarvis-google-'));

process.env.JARVIS_DB_FILE = join(dir, 'test.sqlite');
process.env.JARVIS_JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
process.env.JARVIS_LOG_LEVEL = 'silent';
process.env.NODE_ENV = 'test';
process.env.JARVIS_RATE_LIMIT_MULTIPLIER = '50';
process.env.JARVIS_GOOGLE_CLIENT_IDS = CLIENT_ID;

let app: FastifyInstance;
/** Whatever `jose` hands back for a private key (a WebCrypto CryptoKey in Node 22). */
type SigningKey = Awaited<ReturnType<(typeof import('jose'))['importPKCS8']>>;

let sign: (
  claims: Record<string, unknown>,
  options?: { key?: SigningKey; issuer?: string; audience?: string; expired?: boolean },
) => Promise<string>;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const hasBody = options.body !== undefined;
  const response = await app.inject({
    method,
    url,
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
    },
    ...(hasBody ? { payload: JSON.stringify(options.body) } : {}),
  });
  return { status: response.statusCode, json: response.body ? JSON.parse(response.body) : null };
}

let googleSubject = 0;

async function googleIdToken(
  overrides: Record<string, unknown> = {},
  tokenOptions: { audience?: string; expired?: boolean; issuer?: string } = {},
): Promise<string> {
  googleSubject += 1;
  return sign(
    {
      sub: `google-subject-${googleSubject}`,
      email: `user${googleSubject}@example.com`,
      email_verified: true,
      name: 'Google Person',
      ...overrides,
    },
    tokenOptions,
  );
}

before(async () => {
  const { buildServer } = await import('../src/server.js');
  const { setGoogleVerifier, createGoogleVerifier } = await import('../src/services/google.js');
  const { SignJWT, importPKCS8, exportJWK, createLocalJWKSet } = await import('jose');

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';

  // A second key that is NOT in the key set — used to prove forged tokens fail.
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherPkcs8 = other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const signingKey = await importPKCS8(pkcs8, 'RS256');
  const otherSigningKey = await importPKCS8(otherPkcs8, 'RS256');

  sign = async (claims, options = {}) => {
    const jwt = new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(options.issuer ?? 'https://accounts.google.com')
      .setAudience(options.audience ?? CLIENT_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 10);
    jwt.setExpirationTime(options.expired ? Math.floor(Date.now() / 1000) - 60 : '1h');
    return jwt.sign(options.key ?? signingKey);
  };

  // The real verifier, pointed at a locally held key set instead of Google's URL.
  setGoogleVerifier(
    createGoogleVerifier({
      clientIds: [CLIENT_ID],
      keys: createLocalJWKSet({ keys: [jwk] }),
    }),
  );

  // Expose the "other" key for the forged-token test.
  (globalThis as Record<string, unknown>).__otherSigningKey = otherSigningKey;

  ({ app } = await buildServer({ logger: false }));
  await app.ready();
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a verified Google ID token creates an isolated account', async () => {
  const idToken = await googleIdToken({ email: 'first@example.com' });
  const res = await call('POST', '/api/auth/google', { body: { idToken, deviceName: 'Pixel' } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.user.email, 'first@example.com');
  assert.equal(res.json.user.hasGoogle, true);
  assert.equal(res.json.user.hasPassword, false);
  assert.equal(res.json.user.emailVerified, true);
  assert.match(res.json.user.username, /^[a-z0-9._-]+$/);
  assert.ok(res.json.accessToken && res.json.refreshToken);

  // The new account starts empty and private.
  const tasks = await call('GET', '/api/tasks?view=all', { token: res.json.accessToken });
  assert.equal(tasks.status, 200);
  assert.equal(tasks.json.tasks.length, 0);
  assert.equal(tasks.json.tasks.some((t: any) => t.title), false);
});

test('the same Google subject signs in again instead of creating a second account', async () => {
  const first = await call('POST', '/api/auth/google', { body: { idToken: await googleIdToken({ sub: 'stable-sub' }) } });
  assert.equal(first.status, 201);
  const second = await call('POST', '/api/auth/google', { body: { idToken: await googleIdToken({ sub: 'stable-sub' }) } });
  assert.equal(second.status, 200);
  assert.equal(second.json.user.id, first.json.user.id);
});

test('a Google account cannot be entered with a password', async () => {
  const created = await call('POST', '/api/auth/google', {
    body: { idToken: await googleIdToken({ email: 'nopassword@example.com' }) },
  });
  assert.equal(created.status, 201);
  for (const attempt of ['correct-horse-1', 'Password123', 'hunter2hunter2']) {
    const login = await call('POST', '/api/auth/login', { body: { email: 'nopassword@example.com', password: attempt } });
    assert.equal(login.status, 401);
  }
});

test('a first password can be set from a live session, and only then is the old one required', async () => {
  const created = await call('POST', '/api/auth/google', {
    body: { idToken: await googleIdToken({ email: 'setpassword@example.com' }) },
  });
  assert.equal(created.status, 201);
  const token = created.json.accessToken as string;

  const set = await call('POST', '/api/auth/change-password', { token, body: { newPassword: 'FirstChoice123' } });
  assert.equal(set.status, 200, JSON.stringify(set.json));

  const login = await call('POST', '/api/auth/login', {
    body: { email: 'setpassword@example.com', password: 'FirstChoice123' },
  });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.hasPassword, true);

  // Now that a password exists it must be supplied.
  const second = await call('POST', '/api/auth/change-password', {
    token: login.json.accessToken,
    body: { newPassword: 'SecondChoice123' },
  });
  assert.equal(second.status, 400);

  const withCurrent = await call('POST', '/api/auth/change-password', {
    token: login.json.accessToken,
    body: { currentPassword: 'FirstChoice123', newPassword: 'SecondChoice123' },
  });
  assert.equal(withCurrent.status, 200);
});

test('a verified Google email links to the existing password account', async () => {
  const signup = await call('POST', '/api/auth/signup', {
    body: {
      email: 'linkme@example.com',
      password: 'LinkMePlease123',
      name: 'Link Me',
      username: 'linkme',
      timezone: 'UTC',
      timezoneOffsetMinutes: 0,
    },
  });
  assert.equal(signup.status, 201);
  const userId = signup.json.user.id as string;
  assert.equal(signup.json.user.hasGoogle, false);

  const google = await call('POST', '/api/auth/google', { body: { idToken: await googleIdToken({ email: 'linkme@example.com' }) } });
  assert.equal(google.status, 200);
  assert.equal(google.json.user.id, userId, 'must sign into the same account, not a new one');
  assert.equal(google.json.user.hasGoogle, true);
  assert.equal(google.json.user.hasPassword, true);

  // Both credentials now work, and the existing data is untouched.
  const passwordLogin = await call('POST', '/api/auth/login', {
    body: { email: 'linkme@example.com', password: 'LinkMePlease123' },
  });
  assert.equal(passwordLogin.status, 200);
  assert.equal(passwordLogin.json.user.id, userId);
});

test('a token signed by an unknown key is rejected', async () => {
  const forged = await sign(
    { sub: 'forged', email: 'forged@example.com', email_verified: true },
    { key: (globalThis as Record<string, any>).__otherSigningKey },
  );
  const res = await call('POST', '/api/auth/google', { body: { idToken: forged } });
  assert.equal(res.status, 401);
});

test('wrong audience, wrong issuer and expired tokens are rejected', async () => {
  const wrongAudience = await call('POST', '/api/auth/google', {
    body: { idToken: await googleIdToken({}, { audience: 'someone-elses-client-id' }) },
  });
  assert.equal(wrongAudience.status, 401);

  const expired = await call('POST', '/api/auth/google', { body: { idToken: await googleIdToken({}, { expired: true }) } });
  assert.equal(expired.status, 401);

  const wrongIssuer = await call('POST', '/api/auth/google', {
    body: { idToken: await googleIdToken({}, { issuer: 'https://evil.example.com' }) },
  });
  assert.equal(wrongIssuer.status, 401);
});

test('an unverified Google email is refused', async () => {
  const res = await call('POST', '/api/auth/google', {
    body: { idToken: await googleIdToken({ email: 'unverified@example.com', email_verified: false }) },
  });
  assert.equal(res.status, 400);
});

test('a garbage token is refused without leaking why', async () => {
  const res = await call('POST', '/api/auth/google', { body: { idToken: 'not-a-jwt-at-all-just-text' } });
  assert.equal(res.status, 401);
  assert.doesNotMatch(JSON.stringify(res.json), /jose|signature|JWKS|key/i);
});
