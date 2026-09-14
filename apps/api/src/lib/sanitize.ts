/**
 * Log hygiene.
 *
 * Query strings reach the request logger verbatim, and two of our own routes put
 * credentials there: the realtime handshake carries an access token
 * (`/realtime?token=…`, because a WebSocket handshake cannot set headers) and the
 * password-reset landing page carries a single-use reset token
 * (`/reset-password?token=…`). Logging a raw URL therefore logs credentials.
 *
 * `sanitizeUrl` keeps the path plus the *names* of the query parameters — which is
 * everything an operator needs to debug routing — and removes the values of any
 * parameter that is credential-shaped. Unknown parameters keep short values so
 * ordinary debugging (paging cursors, filters) still works.
 */
const SENSITIVE_PARAM =
  /^(token|access_?token|refresh_?token|id_?token|code|password|secret|api_?key|key|authorization|auth|session|sid|sig|signature|otp|reset)$/i;

const MAX_URL = 300;
const MAX_VALUE = 80;

function truncate(value: string, max = MAX_URL): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Rewrites a request URL so it is safe to log. Never returns a raw secret. */
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '/';
  const queryAt = url.indexOf('?');
  const path = truncate(queryAt === -1 ? url : url.slice(0, queryAt), MAX_VALUE);
  if (queryAt === -1) return path;

  const query = url.slice(queryAt + 1);
  if (!query) return path;

  const parts: string[] = [];
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const equals = pair.indexOf('=');
    if (equals === -1) {
      parts.push(SENSITIVE_PARAM.test(decodeURIComponent(pair)) ? `${pair}=[redacted]` : pair);
      continue;
    }
    const rawName = pair.slice(0, equals);
    const rawValue = pair.slice(equals + 1);
    let name = rawName;
    try {
      name = decodeURIComponent(rawName);
    } catch {
      /* keep the raw name */
    }
    parts.push(SENSITIVE_PARAM.test(name) ? `${rawName}=[redacted]` : `${rawName}=${truncate(rawValue, MAX_VALUE)}`);
  }
  return parts.length ? truncate(`${path}?${parts.join('&')}`) : path;
}

/**
 * Field names that must never be serialised into a log line, whatever object they
 * appear on. This is the safety net behind the URL sanitizer: a future `log.info`
 * that happens to pass a user row or a token response cannot leak credentials.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  'password',
  'currentPassword',
  'newPassword',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.jwt',
  '*.secret',
  '*.apiKey',
  '*.api_key',
  '*.passwordHash',
  '*.token_hash',
];

/**
 * Last-resort scrub for free text that came from a third party (a push service or
 * mail provider response, for example). Anything that *looks* like a credential is
 * replaced before the text is logged.
 */
const JWT_LIKE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const EXPO_TOKEN = /Expo(nent)?PushToken\[[A-Za-z0-9._~-]+\]/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi;

export function redactSecretsInText(text: string): string {
  return truncate(
    text.replace(JWT_LIKE, '[redacted-jwt]').replace(EXPO_TOKEN, '[redacted-push-token]').replace(BEARER, 'Bearer [redacted]'),
    400,
  );
}
