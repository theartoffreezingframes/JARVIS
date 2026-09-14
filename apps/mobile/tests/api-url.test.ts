/**
 * API-origin resolution tests.
 *
 * These encode the promise that a release build never points at a development
 * address: if `EXPO_PUBLIC_API_URL` is missing in a release, the app reports a
 * configuration error instead of silently calling `http://localhost:4000` (which
 * cannot work on a real phone).
 */
/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateAddress, resolveApiBaseUrl } from '../src/lib/api-url.js';

test('an explicit EXPO_PUBLIC_API_URL always wins and is normalised', () => {
  assert.equal(
    resolveApiBaseUrl({
      explicit: 'https://api.example.com/',
      platform: 'android',
      isRelease: true,
    }),
    'https://api.example.com',
  );
  assert.equal(
    resolveApiBaseUrl({ explicit: '  https://staging.example.com  ', platform: 'ios', isRelease: false }),
    'https://staging.example.com',
  );
});

test('a release build without a configured URL reports a configuration error', () => {
  assert.equal(
    resolveApiBaseUrl({ explicit: '', platform: 'android', hostUri: null, isRelease: true }),
    '',
    'a release must never fall back to localhost',
  );
  assert.equal(resolveApiBaseUrl({ explicit: null, platform: 'ios', isRelease: true }), '');
});

test('development builds find the API on the Metro host', () => {
  assert.equal(
    resolveApiBaseUrl({ platform: 'android', hostUri: '192.168.1.20:8081', isRelease: false }),
    'http://192.168.1.20:4000',
  );
  assert.equal(
    resolveApiBaseUrl({ platform: 'ios', hostUri: '10.0.0.5:8081', isRelease: false }),
    'http://10.0.0.5:4000',
  );
  assert.equal(
    resolveApiBaseUrl({ platform: 'android', hostUri: null, isRelease: false }),
    'http://localhost:4000',
  );
});

test('the web build talks to whatever origin served it', () => {
  assert.equal(
    resolveApiBaseUrl({ platform: 'web', webOrigin: 'https://app.example.com', isRelease: false }),
    'https://app.example.com',
  );
  assert.equal(resolveApiBaseUrl({ platform: 'web', webOrigin: 'https://app.example.com/', isRelease: true }), 'https://app.example.com');
});

test('private addresses are recognised', () => {
  for (const url of [
    'http://localhost:4000',
    'http://127.0.0.1:4000',
    'http://192.168.0.10:4000',
    'http://10.1.2.3:4000',
    'http://172.16.5.5:4000',
  ]) {
    assert.equal(isPrivateAddress(url), true, url);
  }
  for (const url of ['https://api.example.com', 'https://jarvis.fly.dev', 'http://8.8.8.8:4000']) {
    assert.equal(isPrivateAddress(url), false, url);
  }
});
