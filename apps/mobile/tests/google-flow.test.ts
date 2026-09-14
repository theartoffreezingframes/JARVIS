/**
 * Google Sign-In protocol helpers.
 *
 * These are the parts that must be exactly right for the flow to be safe:
 * the PKCE challenge encoding, the redirect URI Google will accept, the state
 * check, and the parsing of what the browser hands back. All pure, so they run
 * here without a device.
 */
/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  base64ToBase64Url,
  buildGoogleAuthUrl,
  bytesToBase64Url,
  deriveRedirectUri,
  googleClientIdForPlatform,
  parseGoogleRedirect,
  readIdToken,
} from '../src/lib/google-flow.js';

const ANDROID_CLIENT_ID = '1234567890-abcdefghijklmnop.apps.googleusercontent.com';
const IOS_CLIENT_ID = '0987654321-zyxwvutsrqponmlk.apps.googleusercontent.com';

test('the redirect URI is Google\'s reversed-client-id scheme for both native client types', () => {
  assert.equal(
    deriveRedirectUri(ANDROID_CLIENT_ID),
    'com.googleusercontent.apps.1234567890-abcdefghijklmnop:/oauth2redirect',
  );
  assert.equal(deriveRedirectUri(IOS_CLIENT_ID), 'com.googleusercontent.apps.0987654321-zyxwvutsrqponmlk:/oauth2redirect');
  // A client id that is already a bare prefix keeps working.
  assert.equal(deriveRedirectUri('1234567890-abc'), 'com.googleusercontent.apps.1234567890-abc:/oauth2redirect');
});

test('base64url encoding matches the platform implementation padding-free', () => {
  for (let length = 1; length <= 9; length += 1) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
    const expected = Buffer.from(bytes).toString('base64url');
    assert.equal(bytesToBase64Url(bytes), expected, `length ${length}`);
    assert.equal(/[+/=]/.test(bytesToBase64Url(bytes)), false);
  }
  assert.equal(base64ToBase64Url('a+b/c=='), 'a-b_c');
});

test('the authorization URL requests a code with S256 PKCE and a fresh state', () => {
  const url = new URL(
    buildGoogleAuthUrl({
      clientId: ANDROID_CLIENT_ID,
      redirectUri: deriveRedirectUri(ANDROID_CLIENT_ID),
      state: 'state-value',
      nonce: 'nonce-value',
      codeChallenge: 'challenge-value',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('client_id'), ANDROID_CLIENT_ID);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-value');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('nonce'), 'nonce-value');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  // Never silently reuse the browser's Google session on a shared phone.
  assert.equal(url.searchParams.get('prompt'), 'select_account');
  assert.equal(url.searchParams.get('redirect_uri'), 'com.googleusercontent.apps.1234567890-abcdefghijklmnop:/oauth2redirect');
});

test('an optional login hint is passed through and is not required', () => {
  const withHint = new URL(
    buildGoogleAuthUrl({
      clientId: ANDROID_CLIENT_ID,
      redirectUri: 'x:/y',
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
      loginHint: 'person@example.com',
    }),
  );
  assert.equal(withHint.searchParams.get('login_hint'), 'person@example.com');

  const withoutHint = new URL(
    buildGoogleAuthUrl({ clientId: ANDROID_CLIENT_ID, redirectUri: 'x:/y', state: 's', nonce: 'n', codeChallenge: 'c' }),
  );
  assert.equal(withoutHint.searchParams.has('login_hint'), false);
});

test('the browser response is parsed from both the query string and the fragment', () => {
  assert.deepEqual(
    parseGoogleRedirect('com.googleusercontent.apps.123-abc:/oauth2redirect?code=the-code&state=the-state'),
    { code: 'the-code', state: 'the-state', error: null, errorDescription: null },
  );
  const fragmented = parseGoogleRedirect('https://example.com/cb#code=frag-code&state=frag-state');
  assert.equal(fragmented.code, 'frag-code');
  assert.equal(fragmented.state, 'frag-state');

  const refused = parseGoogleRedirect('com.googleusercontent.apps.123-abc:/oauth2redirect?error=access_denied');
  assert.equal(refused.error, 'access_denied');
  assert.equal(refused.code, null);

  // A cancelled flow yields nothing to exchange.
  assert.deepEqual(parseGoogleRedirect('jarvis://oauth2redirect'), {
    code: null,
    state: null,
    error: null,
    errorDescription: null,
  });
});

test('only a well-formed ID token is accepted from the token endpoint', () => {
  assert.equal(readIdToken({ id_token: 'a.b.c' }), 'a.b.c');
  assert.equal(readIdToken({ id_token: '  a.b.c  ' }), 'a.b.c');
  assert.equal(readIdToken({ id_token: 'not-a-jwt' }), null);
  assert.equal(readIdToken({ error: 'invalid_grant', error_description: 'bad code' }), null);
  assert.equal(readIdToken({}), null);
});

test('a platform without a configured client id is reported as unavailable', () => {
  assert.equal(googleClientIdForPlatform('android', { android: ANDROID_CLIENT_ID }), ANDROID_CLIENT_ID);
  assert.equal(googleClientIdForPlatform('ios', { ios: ` ${IOS_CLIENT_ID} ` }), IOS_CLIENT_ID);
  assert.equal(googleClientIdForPlatform('android', { ios: IOS_CLIENT_ID }), null);
  assert.equal(googleClientIdForPlatform('android', { android: '   ' }), null);
  assert.equal(googleClientIdForPlatform('web', { web: ANDROID_CLIENT_ID }), ANDROID_CLIENT_ID);
  assert.equal(googleClientIdForPlatform('web', {}), null);
});
