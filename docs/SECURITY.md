# Security model and review

This document is the result of the pre-release security review: how JARVIS is built, what protects
each asset, and what was found and fixed. It is written so a reviewer can check each claim against the
code.

---

## 1. Assets and threat model

| Asset | Where it lives | Primary protections |
| --- | --- | --- |
| Account credentials | `users.password_hash` (SQLite) | scrypt, per-user salt, never logged or exported |
| Sessions | Access JWT (client) + `refresh_tokens` rows | 2 h access TTL, rotating 60-day refresh tokens, hashed at rest, server-side session ids |
| User content | SQLite tables scoped by `user_id` | Every handler resolves the user from the token; row-level queries are user-scoped |
| Reset links | `password_resets` rows + email | 32 random bytes, SHA-256 stored, single use, 30-minute expiry, no existence disclosure |
| Device push tokens | `push_tokens` | Bound to an authenticated account, revocable, re-pointed on account switch, never echoed back |
| Server secrets | Process environment / `.env` (gitignored) | Never serialised into responses; `/health` reports capability presence only |

Assumed attacker capabilities: an unauthenticated network client, a user with a valid account trying to
reach another account's data, someone who obtains a leaked or stolen token, and a malicious/abusive
client hammering the API. Out of scope: physical access to an unlocked device, a compromised host, and
a malicious mail provider.

## 2. Authentication

- **Password hashing** — scrypt (`N=16384, r=8, p=1`, 64-byte output, 16-byte random salt), stored as
  `scrypt$N$r$p$salt$hash`; verification uses `timingSafeEqual`. Login runs a dummy verification for
  unknown addresses so response timing does not reveal whether an account exists (`services/auth.ts`).
- **Access tokens** — HS256 JWTs, dependency-free implementation in `lib/tokens.ts`: the header
  algorithm is pinned to `HS256` (no `alg: none`, no HS/RS confusion), the signature comparison is
  constant-time, and `typ`, `sub`, `sid`, `iat` and `exp` are all validated (with 60 s of clock skew).
  Default TTL 2 h, configurable via `JARVIS_ACCESS_TTL`.
- **Refresh tokens** — 48 random bytes, stored only as a SHA-256 hash, rotated on every use. Replaying
  a token that was already exchanged revokes every session on the account (theft response).
- **Session revocation is immediate** — each access token carries the `sid` of the refresh row it was
  issued with. `authenticate()` and the WebSocket handshake check `sessionIsActive(sid)`, so sign-out,
  password change, password reset and account deletion kill outstanding access tokens at once instead
  of leaving them valid until expiry. (Added during this review; the previous behaviour, standard for
  stateless JWTs, left up to two hours of access after a password reset.)
- **Sign-out is per device** — `/api/auth/logout` revokes only the presented refresh token, so a phone
  can sign out without signing out a tablet. Replaying a *signed-out* token is rejected without
  revoking the other devices (only rotation-replay triggers family revocation).
- **Password change** — keeps the acting session alive, signs out every other session.
- **Password reset** — single-use token, 30-minute expiry, previous outstanding links invalidated when
  a new one is issued, all sessions revoked on success, and the response is byte-identical whether or
  not the address exists.

## 3. Authorisation and data isolation

- Every data route calls `requireUser`, which fails closed. There is no route that accepts an owner id
  from the client.
- Repository queries are scoped by `user_id`; lookups by id return 404 (not 403) for another user's
  row, so ids cannot be probed for existence.
- Group membership is checked server-side for group reads/writes; only the owner may delete a group or
  control the shared gang clock (start/pause/resume/skip/stop). Members can join, leave, set their own
  state and react.
- Gang WebSocket subscriptions go through `canAccessSession`, so a socket cannot subscribe to a
  session belonging to someone else.
- Tests: `tests/security.test.ts` (cross-account reads/writes/search/export, group ownership) and the
  acceptance suite (two-account isolation).

## 4. Input handling

- Every request body, query string and route parameter is validated with zod before use; validation
  failures return a 400 with field-level messages and never echo the input back wholesale.
- SQL is always parameterised. The only string interpolation into SQL is static fragments
  (`reviews.ts` builds `WHERE … AND …` from fixed clauses, `sync.ts` selects from a fixed table map).
- Request bodies are capped at 2 MB; WebSocket frames at 64 KB; the WebSocket inbound message union is
  validated.
- `POST /api/tasks/parse` and the natural-language capture path run through the shared parser, which is
  pure and unit tested.

## 5. Abuse resistance

- Credential endpoints have dedicated per-IP limits (`signup` 10/hour, `login` 30/15 min per IP and
  10/15 min per address, `forgot-password` 6/30 min, `refresh` 120/15 min, `reset` 20/hour).
- A global per-IP ceiling (600 requests/minute in production) protects read-heavy endpoints; `/health`
  is exempt so monitoring survives an incident.
- The limiter is in-process by design; this is the documented single-instance constraint.
- When behind a proxy, `JARVIS_TRUST_PROXY=true` makes the limiter use the real client address — the
  server warns at boot if it is not set.

## 6. Transport and headers

- TLS is terminated by a reverse proxy (Caddy/nginx/Cloudflare/ALB); the app never serves plain HTTP in
  production and the Android client does **not** disable cleartext protection. A release build refuses
  to fall back to `http://localhost`.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy` and a restrictive `Permissions-Policy` are sent on every response.
- CORS is an explicit allow-list. With none configured, production is same-origin only — no wildcard,
  no credential-bearing cross-origin access for arbitrary sites. Development reflects any origin so
  Expo Go and local previews work.

## 7. Secrets and logging

- No secret is committed: `.gitignore` blocks `.env*`, `*.jks`, `*.keystore`, `keystore.properties`,
  `*.p8`, `*.p12`, `*.pem`, `credentials.json`, `play-service-account*.json`, `google-services.json`,
  `GoogleService-Info.plist` and database files. `EXPO_PUBLIC_*` is public by definition and is only
  used for the API origin.
- A production boot fails loudly if `JARVIS_JWT_SECRET` is missing, shorter than 32 characters, or a
  known placeholder; weak-secret boot enforcement is covered by a test that spawns a real process.
- Request logging is disabled in production (`disableRequestLogging`), and error responses are
  sanitised: 5xx bodies contain `{error, message, requestId}` with the stack kept in the server log.
- **Request URLs are sanitised before they are logged.** Query strings are the one place a
  credential legitimately appears in a URL — the WebSocket handshake is `/realtime?token=…` because a
  handshake cannot set headers, and the emailed link is `/reset-password?token=…`. `lib/sanitize.ts`
  keeps the path and the parameter *names* an operator needs, and replaces the values of anything
  credential-shaped (`token`, `access_token`, `password`, `secret`, `key`, `code`, …) with
  `[redacted]`. `apps/api/tests/logging.test.ts` boots the server with a real logger writing to a
  stream and fails if any of those values reaches it.
- A pino redaction net (`LOG_REDACT_PATHS`) additionally censors credential-shaped *fields*
  (`authorization`, `*.password`, `*.token`, `*.jwt`, `*.apiKey`, …) on anything a future log line
  might pass in.
- **No REST route accepts a token in the query string.** Only the WebSocket gateway parses its own
  `?token=`, so a URL cannot be used to authenticate an API call (it returns 401).
- Third-party text (push-service and mail-provider responses) is scrubbed of JWT-shaped and
  `ExponentPushToken[...]`-shaped strings before it is logged; recipient addresses are redacted.
- Reset tokens are never returned in production responses and never logged.
- SQLite constraint failures return a generic client message instead of the driver text, which names
  tables and columns.
- `db/seed` and `db/reset` refuse to run with `NODE_ENV=production` unless `JARVIS_ALLOW_PROD_SEED` /
  `JARVIS_ALLOW_PROD_RESET` is set: the demo account has a published password and the reset script
  deletes every real account.

## 8. Deletion and export

- `GET /api/me/export` returns the account's own profile (without the password hash), settings and all
  entities, as JSON or CSV.
- `DELETE /api/me` is a **real deletion**: the `users` row is removed inside a transaction and every
  dependent table cascades (tasks, projects, notes, habits, completions, focus sessions, groups,
  memberships, notifications, activity days, sync ledger, device tokens, settings). Groups the account
  owned are transferred to their longest-standing other member instead of being destroyed for everyone;
  a group with no other members goes with the account. `audit_log` keeps an anonymous user id so abuse
  can still be investigated, with no contact details attached.
- This replaced the earlier behaviour of anonymising the user row and leaving content in place.

## 9. Found and fixed during this review

| Issue | Severity | Resolution |
| --- | --- | --- |
| Access tokens stayed valid for up to 2 h after password change/reset/sign-out | Medium | Session ids are now recorded on refresh tokens and checked on every authenticated request and socket handshake |
| CORS effectively reflected any origin | Medium | Explicit allow-list; production defaults to same-origin only |
| Password reset could not deliver mail and returned the token to a developer UI in non-production | High (functional) | Pluggable SMTP/HTTP email provider with env credentials; tokens stay in the email, hashed at rest, single use, 30-minute expiry |
| No global request ceiling (per-endpoint limits only) | Low | Added a per-IP ceiling with `/health` exempt |
| Sign-out on one device signed out all devices | Medium | Logout revokes only the presented refresh token |
| Stale sign-out tokens could trigger family-wide revocation | Low | Revocation reasons distinguish rotation (theft) from logout/password |
| Account deletion left all content behind under an anonymised row | Medium | True cascading deletion with group-ownership transfer |
| `.gitignore` did not cover `*.keystore`, FCM/Play credential files or env variants | Low | Patterns added at the repository root |
| `GET /api/focus/presets` returned an empty array | Low (fake feature) | Returns real presets derived from account settings, with an offline fallback in the client |
| Access tokens and password-reset tokens were written to logs inside request URLs (`/realtime?token=…`, `/reset-password?token=…`) | Medium (log disclosure) | Request-URL sanitisation plus a redaction net; verified by `apps/api/tests/logging.test.ts` |
| Any REST route accepted `?token=` as authentication | Low | Query-string auth removed from the API; the WebSocket handshake keeps its own parser |
| SQLite constraint text (table and column names) was returned to clients | Low | Replaced with a generic message |
| The demo seed and database-reset scripts could be run against a production database | Low | Both refuse when `NODE_ENV=production` unless explicitly forced |

## 10. Known, accepted limitations

- **SQLite + in-process state = one instance.** Horizontal scaling would break the rate limiter and the
  realtime hub. Documented in DEPLOYMENT.md.
- **Access tokens are bearer tokens.** Anyone who extracts one from a device can use it until it
  expires *or* its session is revoked. Tokens are stored in the OS keychain (`expo-secure-store`) and
  never in logs.
- **Email enumeration through signup.** `POST /api/auth/signup` reports that an address is already
  registered. This is a deliberate usability trade-off; login and password reset do not leak it.
- **No second factor.** Out of scope for this release.
- **Rate limiting is per IP**, so clients behind one NAT share a bucket.

## 11. Reporting a vulnerability

Open a private security advisory on the GitHub repository, or contact the maintainer directly. Please
include the affected endpoint or screen, a minimal reproduction, and the impact you believe it has.
