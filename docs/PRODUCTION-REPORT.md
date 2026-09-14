# JARVIS — final production report

Commit under review: **`9b38019`** (plus `a6a07f7`, `ca98f67`) on branch `arena/01a09ed5-jarvis`.
Verification runs quoted in section C were executed on this exact tree.

---

## A. FINAL TECHNOLOGY STACK

| Layer | Technology |
| --- | --- |
| **Frontend** | React Native through **Expo SDK ~57** (`expo` 57.0.22) with **expo-router ~57.0.21** file-based routing, **React 19.2.3**, **React Native 0.86.3**, Reanimated 4.5.1, TypeScript ~6.0.3, New Architecture enabled. ~39 screens, `@expo/vector-icons`, `react-native-svg` (progress ring), `expo-secure-store` (tokens), `expo-notifications`, `expo-network`, `expo-keep-awake`, `expo-haptics`, `@react-native-async-storage/async-storage`. An Expo **web export** is served by the API as a companion client. |
| **Backend** | Node.js ≥ 20.11, TypeScript run directly with `tsx`, **Fastify 5.12.4**, zod 4 validation, `@fastify/cookie`, `@fastify/cors`, `@fastify/websocket`, `@fastify/rate-limit`, `nodemailer` 10. Layered `routes → services → repo → db`, plus `lib` (crypto, tokens, errors, sanitizing) and `realtime`. |
| **Database** | **SQLite** through `better-sqlite3` in **WAL** mode with foreign keys on, one file at `JARVIS_DB_FILE` (inside `JARVIS_DATA_DIR`), ~27 tables, additive `migrate()` with guarded `ALTER TABLE` column adds, per-user `change_seq` used for sync. No database file is ever committed. |
| **Authentication** | First-party: **scrypt** password hashing (N=16384, r=8, p=1, per-user salt); **HS256 JWT access tokens** (~2 h) carrying a session id; **opaque refresh tokens** (60 days) stored **SHA-256-hashed**, rotated on use, revoked per session with a reason; server-side session validity is checked on every REST request and every WebSocket handshake; per-IP rate limits on credential endpoints. **Email + password only — Google/Apple sign-in is not implemented.** |
| **Realtime** | WebSocket endpoint `/realtime?token=…&sessionId=…` on the same process. The server owns the Gang Timer clock (`clock_anchor_at` / `clock_paused_ms`) and broadcasts **state changes only**; clients derive the countdown locally from the anchor, with a 5 s polling fallback when the socket is unavailable, a 25 s client ping, and a configurable server heartbeat (`JARVIS_REALTIME_HEARTBEAT_MS`, default 15 s). Single in-process hub — no Redis, no broker. |
| **Notifications** | **Local** reminders are scheduled on-device with `expo-notifications` from server-defined rows, honouring per-category switches and quiet hours. **Remote push** goes through the **Expo push service** (`services/push/*`: token registry bound to the account, per-kind preferences, quiet hours, ticket + receipt polling, automatic removal of unregistered tokens); FCM/APNs credentials live in the EAS project, never in the repository. |
| **Deployment** | One Node process behind a TLS-terminating reverse proxy (Caddy/nginx/Cloudflare/platform LB), systemd or a container, with a **persistent volume** for the SQLite file; `.env` or process-manager variables; GitHub Actions for verification (typecheck, tests, web build) and an optionally dispatched APK job; EAS Build for Android artefacts; GitHub Releases for distribution. |
| **Android build system** | **EAS Build** (recommended; managed signing, no local Android toolchain) with `apps/mobile/eas.json` profiles: `development` → APK, `preview` → **APK**, `production` → **AAB** with `autoIncrement`. Local alternative: `expo prebuild --platform android` + Gradle. Package id `app.jarvis.mobile`, version `1.0.0`, `versionCode 1`. |

---

## B. WHAT WAS IMPLEMENTED

This final phase ("finish the remaining production-readiness work") added:

**Phase 11 — sensitive logging**
1. `apps/api/src/lib/sanitize.ts`: `sanitizeUrl()` (keeps path + parameter names, redacts credential-shaped values), `LOG_REDACT_PATHS` (pino redaction net) and `redactSecretsInText()` (scrubs JWT/push-token shapes out of third-party text).
2. Fastify logger now sanitises the logged request URL and applies the redaction net; `buildServer()` accepts a caller-supplied logger (used by the new test to assert on real output).
3. Error-handler and rate-limit log lines now log sanitised URLs.
4. **Query-string authentication removed from REST routes** — only the WebSocket handshake parses its own `?token=` (a handshake cannot set headers).
5. Push/mail provider text is scrubbed before logging; recipient addresses stay redacted.
6. SQLite constraint failures return a generic message instead of driver text naming tables/columns.
7. `db/seed.ts` and `db/reset.ts` refuse to run with `NODE_ENV=production` unless `JARVIS_ALLOW_PROD_SEED` / `JARVIS_ALLOW_PROD_RESET` is set.
8. `.env.example` gained `JARVIS_EMAIL_TIMEOUT_MS` plus a documented `EXPO_PUBLIC_API_URL` block; `email/http.ts` now uses a dedicated mail timeout instead of the push timeout.
9. New suite `apps/api/tests/logging.test.ts` (2 tests) asserts nothing credential-shaped reaches a real log stream.

**Phase 12 — real device test plan**
10. `docs/DEVICE-TESTS.md`: 9 sections / ~60 checks covering authentication (including session restoration and sign-out-all-devices), tasks, Eisenhower matrix, Pomodoro backgrounding, the **two-device Gang Timer matrix** (join, start, pause, resume, end, statistics, radio loss, host disconnect, backgrounding, non-host permissions), offline/reconnect, notifications, export/change-password/delete, and accessibility. It is explicitly labelled **NOT YET EXECUTED** and marks Google sign-in as not implemented.

**Phases 13–14 — regression and failure handling**
11. List screens now show a real failure state with retry instead of a misleading empty state (`notes`, `calendar`, `planner`, `analytics`, `review`, `search`, `notifications`); the data hooks expose the query error for this.
12. `ErrorBlock` copy corrected — it no longer promises an automatic retry that does not exist.
13. Realtime client gained `ensureConnected()`: returning to the foreground reconnects immediately instead of waiting out a background backoff.
14. The About screen reads the server's live capability report instead of hard-coding the development machine's email configuration; a stale code comment on the forgot-password screen was corrected.
15. **Cross-account isolation fix:** the offline queue is now scoped to the account that queued each change (`lib/queue-scope.ts` + auth wiring + 4 unit tests). Previously, on a shared device, one user's queued changes could have been replayed under the next user's token.
16. Focus-timer maths extracted into a pure, unit-tested module (`lib/timer-math.ts`, 7 tests).
17. `docs/SECURITY.md` updated with the log-hygiene findings and new "found and fixed" rows; `README.md` and `docs/RELEASE.md` updated (device checklist gate, EAS/GitHub release steps).

---

## C. VERIFIED FUNCTION

Only what was actually executed is listed. Commands were run in this repository at commit `9b38019`.

| Command | Result |
| --- | --- |
| `npm run typecheck` (shared, api, mobile) | **0 errors** |
| `npm test` | **API 60/60 pass, 0 fail · mobile 16/16 pass, 0 fail** (76 tests) |
| `npm run build:web` | Expo web export written to `apps/mobile/dist` (served by the API) |

Per-suite API breakdown (`npx tsx --test apps/api/tests/<file>.test.ts`):

| Suite | Tests | Covers |
| --- | --- | --- |
| `api.test.ts` | 18 | routing, validation, auth, cross-account isolation, sync contract, gang permissions & clock, habits, notes, projects, notifications |
| `domain.test.ts` | 14 | shared rules: recurrence, Eisenhower classification, streaks, planning, scoring, heat maps, NL parsing |
| `rate-limit.test.ts` | 1 | per-route throttling |
| `acceptance.test.ts` | 9 | the 9 named end-to-end workflows, in-process |
| `production.test.ts` | 11 | production boot, weak-secret boot refusal, CORS allow-list, no stack traces, reset mail via a captured transport, unknown-address symmetry, provider-failure handling, push-token lifecycle, real account deletion, restart durability, global request ceiling |
| `security.test.ts` | 5 | per-device sign-out, rotation/replay family revocation, password change keeps the actor, cross-account isolation, group ownership |
| `logging.test.ts` | 2 | no credential in logs; URL sanitizer behaviour |

Mobile: `api-url.test.ts` (5) — a release build never falls back to a dev address; `timer-math.test.ts` (7) — timer survives backgrounding, pause and clock jumps; `queue-scope.test.ts` (4) — queued work never crosses accounts.

Live checks against the running API (development mode, `http://127.0.0.1:4000`):

- `GET /health` and `GET /api/health` → **200**, leak-free capability report; web client `GET /` → **200**.
- `POST /api/auth/login` (demo account) → **200**; `GET /api/tasks` → **200**, camelCase contract.
- `GET /api/tasks?token=<valid access token>` → **401** (a URL can no longer authenticate an API call).
- `GET /reset-password?token=…` → **200**, and the server log records `"/reset-password?token=[redacted]"` — the marker value never appears (this was a **real leak before the fix**, visible in the pre-fix log as `"url":"/reset-password?token=abc"`).
- Push event path verified live: creating a gang session queued real dispatch attempts to the push transport (logged as connection failures because this sandbox has **no outbound internet**); with a real Expo project id and network, the same path delivers.

Verified end-to-end by automation: account signup/login/logout/refresh/rotation/replay handling; password reset with a real captured email; per-device session revocation; cross-account data isolation; sync push/pull idempotency and conflict reporting; gang clock arithmetic and host-only control; habit streaks and heat-map aggregation; calendar/planner/matrix payload correctness; account deletion cascades and group-ownership transfer; restart durability; CORS allow-list; rate limiting; log hygiene.

---

## D. DEVICE TESTS NOT PERFORMED

**No physical-device testing was performed, and none is claimed.**

This environment has **no Android device, no emulator, no Java/JDK, no Android SDK, no Gradle, no `adb` and no EAS CLI**, and the sandbox has **no outbound internet access**. Consequently:

- **No APK was built here.** The build configuration (`apps/mobile/eas.json`, `app.json`, icons/splash assets, `versionCode`, package id) was authored and reviewed, but the artefact must come from EAS or a host with the Android toolchain.
- **`docs/DEVICE-TESTS.md` has not been executed.** Every check in it — including background/resume behaviour, notification delivery to the system tray, Wi-Fi ↔ mobile-data switching, two-device Gang Timer synchronisation, and accessibility with a real screen reader — remains outstanding.
- Remote push delivery and real email delivery could not be observed end-to-end (no outbound network, no credentials).

The automated suite is real and green, but it cannot prove rendering, OS permissions, radio behaviour or two-device timing. Treat the app as **release-candidate** until the checklist is green on real hardware.

---

## E. EXTERNAL SERVICES REQUIRED

| # | Service | Status | Why |
| --- | --- | --- | --- |
| 1 | **Backend hosting** (Node 20+, persistent volume) | **REQUIRED — NOT YET CONFIGURED** | The app is useless without a reachable API; SQLite needs durable storage |
| 2 | **HTTPS domain** (e.g. `api.example.com`) | **REQUIRED — NOT YET CONFIGURED** | Release builds never fall back to plain HTTP; reset links must be HTTPS |
| 3 | **Email provider** (SMTP, or Resend/SendGrid/Postmark HTTP API) | **REQUIRED for real users — NOT YET CONFIGURED** | Without it, password reset cannot deliver; the API answers identically and says so in logs |
| 4 | **Google OAuth client** (plus the sign-in flow itself) | **OPTIONAL — NOT IMPLEMENTED** | Only needed if Google sign-in is wanted; it does not exist in this build and is labelled as such in About |
| 5 | **EAS / Expo account** | **REQUIRED for the recommended APK path — NOT YET CONFIGURED** | `npx eas-cli init` writes `extra.eas.projectId`; without it, remote push tokens cannot be issued and EAS builds cannot be attributed |
| 6 | **Android signing credentials** | **REQUIRED for distribution — NOT YET CONFIGURED** | EAS-managed keystore (recommended) or a local keystore; without a stable key, updates cannot be installed over an old build |
| 7 | **Push credentials** (FCM service account for Android, attached to the EAS project) | **OPTIONAL — NOT YET CONFIGURED** | Remote push only; local reminders work without it. The app reports the exact status instead of pretending |
| 8 | **GitHub Actions secrets** (`EXPO_TOKEN`, `API_URL` variable) | **OPTIONAL — NOT YET CONFIGURED** | Only for the manually dispatched APK workflow; ordinary CI needs no secrets and publishes nothing |

---

## F. ENVIRONMENT VARIABLES

Values are never printed here; see `.env.example` for the annotated template.

| Variable | Purpose | Required in production? | Secret or public? |
| --- | --- | --- | --- |
| `NODE_ENV` | Enables production behaviour (strict config, quiet logs) | Yes (`production`) | Public |
| `PORT` | HTTP listen port (default 4000) | Yes if not default | Public |
| `JARVIS_API_PORT` | Alternative port (used only if `PORT` is unset) | No | Public |
| `JARVIS_API_HOST` | Bind address (keep `0.0.0.0` behind a proxy) | Recommended | Public |
| `JARVIS_JWT_SECRET` | Signs access tokens (≥32 chars) | **Yes — boot fails without a strong value** | **Secret** |
| `JARVIS_PUBLIC_URL` | Public HTTPS origin, used in reset links | Yes when email is configured | Public |
| `JARVIS_ALLOWED_ORIGINS` | CORS allow-list (comma separated) | Yes when a browser client uses another origin | Public |
| `JARVIS_TRUST_PROXY` | Trust `X-Forwarded-*` from the proxy | Yes behind a proxy | Public |
| `JARVIS_LOG_LEVEL` | Log level (`info` recommended) | No | Public |
| `JARVIS_EXPOSE_DEV_SECRETS` | Development-only: return reset tokens in API responses | **No — ignored in production** | Public |
| `JARVIS_DEV_SECRET` | Development-only fixed dev signing secret | **No — never in production** | **Secret (dev only)** |
| `JARVIS_DATA_DIR` | Persistent directory for database + backups | **Yes** | Public |
| `JARVIS_DB_FILE` | Explicit SQLite path (default `<DATA_DIR>/jarvis.sqlite`) | No | Public |
| `JARVIS_BACKUP_DIR` | Where backup tooling writes | No | Public |
| `JARVIS_ACCESS_TTL` | Access-token lifetime in seconds (default 7200) | No | Public |
| `JARVIS_REFRESH_TTL_DAYS` | Refresh-token lifetime (default 60) | No | Public |
| `JARVIS_RATE_LIMIT_MULTIPLIER` | Rate-limit multiplier (production must stay `1`) | No | Public |
| `JARVIS_EMAIL_PROVIDER` | `smtp` \| `http` \| empty (disabled) | Yes for reset mail | Public |
| `JARVIS_EMAIL_FROM` | From header of reset mail | Yes with email | Public |
| `JARVIS_EMAIL_REPLY_TO` | Optional reply-to | No | Public |
| `JARVIS_EMAIL_TIMEOUT_MS` | Abort a provider request (default 10000) | No | Public |
| `JARVIS_SMTP_HOST` / `_PORT` / `_SECURE` / `_REQUIRE_TLS` | SMTP endpoint and TLS behaviour | Yes when `smtp` | Public |
| `JARVIS_SMTP_USER` / `JARVIS_SMTP_PASSWORD` | SMTP credentials | Yes when `smtp` needs auth | **Secret** |
| `JARVIS_EMAIL_API_URL` | HTTP provider endpoint | Yes when `http` | Public |
| `JARVIS_EMAIL_API_KEY` | HTTP provider API key | Yes when `http` | **Secret** |
| `JARVIS_EMAIL_API_VENDOR` | `resend` \| `sendgrid` \| `postmark` \| `generic` | Yes when `http` | Public |
| `JARVIS_REALTIME_HEARTBEAT_MS` | WebSocket heartbeat (default 15000) | No | Public |
| `JARVIS_PUSH_ENABLED` | Enable remote push dispatch | No | Public |
| `JARVIS_PUSH_TIMEOUT_MS` | Push/receipt request timeout | No | Public |
| `JARVIS_PUSH_ENDPOINT` | Push send endpoint (default Expo) | No | Public |
| `JARVIS_PUSH_RECEIPT_ENDPOINT` | Push receipt endpoint (default Expo) | No | Public |
| `JARVIS_PUSH_ACCESS_TOKEN` | Expo push security token, if enabled on the project | Only if Expo push security is on | **Secret** |
| `JARVIS_WEB_ROOT` | Path to the exported web build to serve | No | Public |
| `EXPO_PUBLIC_API_URL` | **Build-time** API origin baked into the app | **Yes for release builds** | Public by definition |

---

## G. EXACT BACKEND DEPLOYMENT PROCESS

```bash
# 1. Get the code
git clone https://github.com/<you>/JARVIS.git && cd JARVIS

# 2. Install dependencies (workspaces)
npm ci

# 3. Choose the persistent data location (must survive redeploys)
export JARVIS_DATA_DIR=/var/lib/jarvis
mkdir -p "$JARVIS_DATA_DIR"   # and make it a mounted volume on your platform

# 4. Configure the environment (never commit this file)
cat > /etc/jarvis.env <<'EOF'
NODE_ENV=production
PORT=4000
JARVIS_API_HOST=0.0.0.0
JARVIS_JWT_SECRET=<48-byte random string, e.g. node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))">
JARVIS_PUBLIC_URL=https://api.example.com
JARVIS_ALLOWED_ORIGINS=https://app.example.com
JARVIS_TRUST_PROXY=true
JARVIS_DATA_DIR=/var/lib/jarvis
JARVIS_EMAIL_PROVIDER=smtp
JARVIS_EMAIL_FROM=JARVIS <no-reply@example.com>
JARVIS_SMTP_HOST=smtp.example.com
JARVIS_SMTP_PORT=587
JARVIS_SMTP_USER=<smtp user>
JARVIS_SMTP_PASSWORD=<smtp password>
EOF
```

```bash
# 5. Optional: build and serve the web client from the same process
npm run build:web           # writes apps/mobile/dist, picked up automatically

# 6. Migrations run automatically and safely on boot (additive, idempotent)
#    — there is no separate migration step and no destructive operation.

# 7. Start the API (pick one)
set -a && . /etc/jarvis.env && set +a
npm run start -w @jarvis/api                 # foreground / container CMD
# or with systemd:
#   ExecStart=/usr/bin/npm run start -w /opt/JARVIS/apps/api
#   EnvironmentFile=/etc/jarvis.env

# 8. Health check (never rate-limited, never leaks configuration)
curl -fsS https://api.example.com/health
# {"ok":true,"status":"healthy","service":"jarvis-api","env":"production",...,
#  "capabilities":{"email":"smtp","push":true,"cors":"1 origin(s) allow-listed","https":true,...}}
```

```bash
# 9. TLS: terminate it in front of the process (this server speaks plain HTTP on
#    the private network). Caddy example:
#    api.example.com {
#      reverse_proxy 127.0.0.1:4000
#    }
#    Keep the proxy read timeout above JARVIS_REALTIME_HEARTBEAT_MS for WebSockets.

# 10. Backups (WAL-safe, no downtime)
sqlite3 /var/lib/jarvis/jarvis.sqlite ".backup '/var/backups/jarvis-$(date +%F).sqlite'"
```

Operational notes: keep the process at **one replica** (SQLite + in-memory rate limiter and realtime hub); restart to upgrade (migrations are additive, no downtime-free requirement assumed); `npm run seed` / `npm run reset:db` refuse to run in production.

---

## H. EXACT ANDROID APK BUILD PROCESS

**Recommended (EAS — no local Android toolchain):**

```bash
npm install -g eas-cli
eas login                                  # Expo account (free tier is enough)
cd apps/mobile
eas init                                   # adds extra.eas.projectId to app.json (commit it)

EXPO_PUBLIC_API_URL=https://api.example.com \
  eas build --platform android --profile preview
```

- `preview` produces an installable **APK** (`"android": { "buildType": "apk" }` in `apps/mobile/eas.json`).
- `production` produces an **AAB** for Google Play with automatic `versionCode` increments.
- EAS prints a download URL and a QR code; the build also appears in `eas build:list`.
- Keep the signing key: EAS offers to generate and store it on first build (`eas credentials`). Back it up — losing it means never being able to update the installed app.
- **APK vs AAB:** an APK installs directly on a device (sideload/enterprise); an AAB is an upload format for Google Play, which then generates per-device APKs. For "hand someone a file", use the `preview` APK.

**Local alternative (requires JDK 17 + Android SDK):**

```bash
cd apps/mobile
npx expo prebuild --platform android        # never --clean: it would delete working native config
cd android && ./gradlew assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

**Artifact locations:** EAS link/QR (`https://expo.dev/artifacts/eas/<id>.apk`), the GitHub Actions artifact `jarvis-preview-apk` when the manual APK job is dispatched, or the Gradle path above.

> This environment has no Android toolchain, so **no APK was produced here**. The commands above are the reviewed process, not a record of a completed build.

---

## I. GITHUB RELEASE PROCESS

1. **Build the APK** — EAS `--profile preview` (section H), or dispatch the manual `apk` job in `.github/workflows/ci.yml` (requires the `EXPO_TOKEN` secret and the `API_URL` repository variable).
2. **Download the artifact** — from the EAS URL/QR, or from the workflow's `jarvis-preview-apk` artifact (which also contains a SHA-256 checksum).
3. **Create the release** — tag it with the version in `app.json`:
   ```bash
   gh release create v1.0.0 --title "JARVIS 1.0.0 — Android" --notes-file docs/RELEASE-NOTES-v1.0.0.md
   ```
4. **Attach the APK** (and its checksum):
   ```bash
   gh release upload v1.0.0 app-release.apk app-release.apk.sha256
   ```
5. **Release notes** — state what changed, which API origin the build points at, the minimum Android version, and that Google sign-in is not supported. `docs/RELEASE.md` section 6 contains a ready-to-edit template.
6. **Users download it** — from the release page they open `app-release.apk`, allow installation from that source ("unknown apps"), and sign up with their own email, which creates a private workspace.

**If GitHub Actions is configured:** `ci.yml` runs on every push/PR — install, typecheck all three workspaces, run the full API + mobile suites, build the web bundle. A second job (`apk`) exists but only runs on **manual dispatch** with `build_apk` checked; it fails fast if `EXPO_TOKEN`/`API_URL` are missing, builds with EAS, downloads the APK, writes a checksum, and uploads both as a workflow artifact. Nothing is published automatically and **no workflow prints a secret**.

---

## J. PRODUCTION BLOCKERS

### BLOCKERS — must be done before real users can safely use the app

1. **Deploy the API over HTTPS** with a persistent volume and a strong `JARVIS_JWT_SECRET`; set `JARVIS_ALLOWED_ORIGINS` and `JARVIS_TRUST_PROXY`. Without this there is nothing for the app to talk to.
2. **Configure an email provider** (`JARVIS_EMAIL_*`). Until then, password reset cannot deliver for real users.
3. **Build and sign the APK** (EAS account + `eas init` + signing credentials). No distributable artefact exists yet, and nothing in this repository has ever been installed on a device.
4. **Execute `docs/DEVICE-TESTS.md` on real hardware.** Until that passes, real-device behaviour — background timers, notifications in the tray, offline/reconnect, two-device Gang Timer, accessibility — is unvalidated.
5. **Verify a real password reset end-to-end** after (2): request → email arrives → link opens → new password works, and the token is refused on reuse.

### WARNINGS — should be completed before a public launch

1. **SQLite means one instance.** No horizontal scaling, no HA; the rate limiter and realtime hub keep state in memory. Documented in `docs/DEPLOYMENT.md`.
2. **Remote push is inert** until an EAS project id exists and (for Android) FCM credentials are attached. The app will say so plainly; local reminders still work.
3. **Rate limits are per IP**, so users behind one NAT share a bucket.
4. **No second factor** and no social sign-in; account takeover resistance rests on password strength plus session revocation.
5. **Backups and monitoring are manual.** Set up the cron backup and an uptime check on `/health` before users depend on it.
6. **Demo seeding must never run in production** — now guarded, but keep `NODE_ENV=production` everywhere.
7. **The web build is a companion**, not a supported target: background timers and notification scheduling are native-only.

### OPTIONAL — later

Play Store listing (AAB + privacy policy), iOS build (Apple Developer account), error tracking (e.g. Sentry), object-storage backups, richer group moderation, and the deliberately absent AI features (task breakdown, estimates) — the domain layer has the seams for them, and they were left out rather than faked.

---

## K. FINAL VERDICT

**NOT YET READY FOR REAL USERS**

The code, configuration, tests and documentation are in place and green (76/76 automated tests, clean typecheck, working web build), and the security review produced genuine fixes. But required external services (hosting, HTTPS domain, email provider, EAS/signing) are **not configured**, no signed APK has been built, and **no physical-device validation has been performed**. Until those are done, the honest verdict is *not yet ready*.
