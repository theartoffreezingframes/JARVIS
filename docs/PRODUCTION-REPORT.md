# JARVIS — production readiness report

Final report required by the release brief (section A–K). Everything below is written from
verification that was actually executed in this environment; anything that could not be executed is
named as such rather than assumed.

- **Repository**: `theartoffreezingframes/JARVIS`
- **Branch**: `arena/01a09ed5-jarvis`
- **Environment used for verification**: Linux container, **Node v22.22.3**, npm 10.9.8, no Android
  SDK/JDK, no device, **no outbound internet to Google or Expo push endpoints** (npm registry and
  GitHub are reachable). The API was run locally on `0.0.0.0:4000`.

---

## A. Final technology stack

| Layer | Technology |
| --- | --- |
| **Mobile app** | React Native via **Expo SDK 57** (`expo` 57.0.22), **expo-router** 57.0.21 (file-based routes), React 19.2.3, RN 0.86.3, Reanimated 4.5.1, TypeScript 6.0.3, New Architecture enabled. 39 route files (37 screens + 2 layouts). Secure token storage (`expo-secure-store`), local notifications (`expo-notifications`), browser OAuth (`expo-web-browser`), PKCE helpers (`expo-crypto`). Web export is a companion client, not a target platform. |
| **Backend** | Node 20+ (verified on 22), TypeScript executed by `tsx`, **Fastify 5.12.4**, zod 4 validation, `@fastify/cookie`, `@fastify/cors`, `@fastify/websocket`, nodemailer 10, **jose 6** (Google ID-token verification). Layering: `routes → services → repo → db` plus `lib/` and `realtime/`. |
| **Database** | **SQLite** via `better-sqlite3` 13 with **WAL** and foreign keys, one file (`JARVIS_DB_FILE`, default `<JARVIS_DATA_DIR>/jarvis.sqlite`), 27 tables, idempotent additive migrations. Per-user `change_seq` gives incremental offline sync without a change-log table. |
| **API surface** | REST under `/api` plus a WebSocket at `/realtime`. Session auth: `Authorization: Bearer` (query-string tokens are **not** accepted by REST). |
| **Authentication** | First-party. scrypt password hashing (N=16384, r=8, p=1, per-user salt); HS256 JWT access tokens (~2 h) carrying a **session id**; opaque refresh tokens (60 days) stored SHA-256-hashed, rotated on use, revoked per session with a reason (`rotated`/`logout`/`password`/`admin`). Session validity is checked on every request and every socket handshake. **Google Sign-In** is optional and disabled until configured. |
| **Realtime** | Single server-authoritative hub. The Gang Timer clock lives in `gang_sessions.clock_anchor_at` / `clock_paused_ms`; sockets carry **state changes only** (join/leave/state/control/reaction/presence), never per-second ticks. Clients derive the countdown from the server anchor and fall back to 5 s polling. |
| **Notifications** | Local scheduling driven by server-generated rows (works offline), plus optional remote push through Expo's relay (token registry bound to accounts, per-category preferences, quiet hours, ticket/receipt polling, dead-token pruning). |
| **Build and release** | **EAS Build** profiles in `apps/mobile/eas.json` (development/preview APK, production AAB), GitHub Actions CI (typecheck → tests → web build, plus a manual APK job), GitHub Releases for distribution. |
| **Deployment target** | One Node process behind a TLS-terminating reverse proxy (Caddy/nginx), persistent volume for SQLite. Single instance by design. |

---

## B. Every file and configuration changed

This work landed across a series of commits on top of the two original build commits (`0e5099d`,
`2dbf7f4`); the phases below are the production brief's phases.

**Phase 1 (audit) — no code changes.** Findings drove everything that follows.

**Phases 2–10 (commit `ca98f67`)**

| Area | Files |
| --- | --- |
| Production API configuration | `apps/api/src/env.ts` (production-required ≥32-char `JARVIS_JWT_SECRET`, configurable data dir/DB file, CORS allow-list, TTLs, timeouts, capability report, production warnings), `.env.example` |
| Backend hardening | `apps/api/src/server.ts` (graceful shutdown, leak-free `/health` + `/api/health`, global per-IP ceiling, security headers, static web serving with SPA fallback), `apps/api/src/lib/errors.ts`, `apps/api/src/http/rate-limit.ts` |
| Sessions and auth | `apps/api/src/http/auth-plugin.ts`, `apps/api/src/lib/tokens.ts`, `apps/api/src/services/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/repo/users.ts` (session ids, refresh rotation + reuse detection, per-device logout, password change keeps the actor) |
| Password reset by email | `apps/api/src/services/email/{index,transport,smtp,http,mailer}.ts` |
| Remote push | `apps/api/src/services/push/{expo,dispatch,queue}.ts`, `apps/api/src/repo/push.ts`, `apps/api/src/routes/push.ts` |
| Sync and offline correctness | `apps/api/src/services/sync.ts`, `apps/api/src/routes/sync.ts`, `apps/api/src/services/reconcile.ts` |
| Account lifecycle | `apps/api/src/routes/account.ts` (export, change email, **true cascading delete** with group-ownership transfer), `apps/api/src/db/{seed,reset}.ts` (refuse to run in production) |
| Mobile configuration | `apps/mobile/src/lib/api-url.ts` (release builds never fall back to localhost), `apps/mobile/src/lib/api.ts`, `apps/mobile/src/lib/storage.ts` |
| Mobile runtime reliability | `apps/mobile/src/lib/realtime.ts` (`ensureConnected`), `apps/mobile/src/lib/query.tsx` (foreground refresh), `apps/mobile/src/lib/offline.ts`, `apps/mobile/src/lib/timer.ts`, `apps/mobile/src/lib/timer-math.ts` |
| Mobile screens/hooks for loading, empty, failure+retry | `apps/mobile/src/components/ui.tsx` (`LoadingBlock`/`EmptyState`/`ErrorBlock`), `apps/mobile/src/hooks/*`, `apps/mobile/src/app/**` (notes, notifications, calendar, planner, analytics, review, search, tasks, dashboard) |
| Release tooling | `apps/mobile/eas.json`, `apps/mobile/app.json` (package `app.jarvis.mobile`, versioning, icons/splash), `.github/workflows/ci.yml`, `.gitignore`, `README.md`, `docs/DEPLOYMENT.md`, `docs/RELEASE.md`, `docs/SECURITY.md` |

**Phase 11 (log hygiene + honest states, commit `a6a07f7`)**

| Area | Files |
| --- | --- |
| Log hygiene | `apps/api/src/lib/sanitize.ts` (new — `sanitizeUrl`, `LOG_REDACT_PATHS`, `redactSecretsInText`), `apps/api/src/server.ts` (sanitised URL serializer, redaction net, sanitised error/rate-limit log lines), `apps/api/src/services/email/*`, `apps/api/src/services/push/*`, `apps/api/src/http/auth-plugin.ts` (query-string auth removed), `apps/api/src/lib/errors.ts` (no SQLite schema text in client errors) |
| Failure states | `apps/mobile/src/hooks/use*.ts`, screens above; `docs/DEVICE-TESTS.md` (new, manual script) |

**Phase 12/13 support (commit `9b38019`)**

| Area | Files |
| --- | --- |
| Offline queue per account | `apps/mobile/src/lib/queue-scope.ts` (new), `apps/mobile/src/lib/offline.ts`, `apps/mobile/src/lib/auth.tsx`, `apps/mobile/tests/queue-scope.test.ts` (new) |
| Release gates | `docs/RELEASE.md` (§6 download before publishing, §9 checklist gates on `docs/DEVICE-TESTS.md`), `.env.example` (`EXPO_PUBLIC_API_URL`) |

**Phase 14/15 (`c837636` and `c11a3f3` — this pass, including the report itself)**

| Area | Files |
| --- | --- |
| Google Sign-In (new) | `apps/api/src/services/google.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/services/auth.ts`, `apps/api/src/lib/errors.ts` (503 `unavailable`), `apps/api/src/env.ts` (`JARVIS_GOOGLE_CLIENT_IDS`, capability report), `apps/api/src/db/schema.ts` + `apps/api/src/db/index.ts` (`google_sub`, `has_password`, partial unique index), `apps/api/src/repo/{users,rows,mappers}.ts`, `packages/shared/src/domain/{models,schemas}.ts`, `apps/mobile/src/lib/google-flow.ts` (new, pure PKCE/protocol helpers), `apps/mobile/src/lib/google.ts` (new, browser + PKCE flow), `apps/mobile/src/lib/auth.tsx`, `apps/mobile/src/app/sign-in.tsx`, `apps/mobile/src/app/sign-up.tsx`, `apps/mobile/src/app/settings/password.tsx` (set a first password), `apps/mobile/src/app/settings/about.tsx` (honest capability line) |
| Notification correctness (real bugs fixed) | `apps/api/src/routes/notifications.ts` (finished tasks are no longer re-announced; dedupe no longer resurrects read/cleared reminders), `apps/api/src/repo/notifications.ts` (soft dismissal + `dismissAll`), `apps/api/src/db/schema.ts` + `apps/api/src/db/index.ts` (`dismissed_at`) |
| Failure states, remaining screens | `apps/mobile/src/app/{habits,projects,groups,project/[id],group/[id],gang/[id]}.tsx`, `apps/mobile/src/app/(tabs)/{matrix,focus}.tsx`, `apps/mobile/src/app/task/[id].tsx`, `apps/mobile/src/app/note/[id].tsx` (a failed load no longer claims the note was deleted), `apps/mobile/src/app/settings/index.tsx` (no longer shows "loading" forever when the profile cannot be fetched), `apps/mobile/src/hooks/{useSocial,useLibrary,useFocus,useTasks}.ts` (hooks now expose `error`) |
| New automated tests | `apps/api/tests/google.test.ts` (9), `apps/api/tests/google-unconfigured.test.ts` (1), `apps/api/tests/realtime.test.ts` (4, real TCP sockets), `apps/api/tests/notifications.test.ts` (4), `apps/mobile/tests/google-flow.test.ts` (7) |
| Docs | `README.md`, `.env.example`, `docs/RELEASE.md` (new §4 Google Sign-In, renumbered), `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, `docs/DEVICE-TESTS.md`, `docs/PRODUCTION-REPORT.md` (this file) |
| Dependencies | `apps/api/package.json` (+`jose@^6`), `apps/mobile/package.json` (+`expo-web-browser`, `+expo-crypto`), `package-lock.json` |

**Configuration files reviewed for this report** (unchanged or documented): `apps/mobile/eas.json`,
`apps/mobile/app.json`, `.github/workflows/ci.yml`, `.gitignore`, `.env.example`.

---

## C. What was tested and confirmed working

Only the items in this section may be treated as verified. Everything else is listed in D or J.

### C1. Automated suites

| Command | Result |
| --- | --- |
| `npm run typecheck` (shared → api → mobile) | **0 errors** |
| `npm test` | **API 78/78 pass, 0 fail** · **mobile 23/23 pass, 0 fail** |
| `npm run build:web` | `Exported: dist` — 44 HTML files exported for the app's 37 screens |

**Continuous integration has been green on every commit of this pass** (`c837636` run 34829218128,
`c11a3f3` run 34829373608, `e22bb18` run 34830252251): a clean `npm ci` on a fresh GitHub runner,
then typecheck → tests → web build all succeeded, which also proves `package-lock.json` is
consistent (the same install path EAS uses).

Per-file test counts (all passing):

| Suite | Tests | What it proves |
| --- | --- | --- |
| `apps/api/tests/api.test.ts` | 18 | Full workflow create → classify → plan → focus → complete; recurring tasks; cross-account isolation; private groups; gang clock; sync idempotency; search filters; export/delete; daily review; 4xx-never-500 |
| `apps/api/tests/domain.test.ts` | 14 | Dates/timezones, quadrants, overload coaching, recurrence, planner capacity, NLP capture, scoring ratios, heat-map buckets, habit frequencies |
| `apps/api/tests/acceptance.test.ts` | 9 | The nine named acceptance workflows, including server+DB restart survival and offline create → reconnect sync exactly once |
| `apps/api/tests/production.test.ts` | 11 | Health leaks nothing, CORS allow-list, no stack traces, boot refusal on weak secret, reset link single-use/expiring, enumeration symmetry, mail failure handling, push token lifecycle, real account deletion, restart durability, global ceiling |
| `apps/api/tests/security.test.ts` | 5 | Per-device sign-out, refresh rotation + replay family revocation, password change keeps the actor, cross-account probing, group ownership |
| `apps/api/tests/logging.test.ts` | 2 | Credentials in a request URL never reach the log stream (real logger, captured output); `sanitizeUrl` unit behaviour |
| `apps/api/tests/google.test.ts` | 9 | **Real RS256 verification** with a locally held key set: valid token creates an isolated account, same subject re-signs-in, password login refused for Google-only accounts, first password from a live session (and required afterwards), linking to an existing password account via verified email, unknown-key/wrong-audience/wrong-issuer/expired rejection, unverified email refused, no internal detail leaked |
| `apps/api/tests/google-unconfigured.test.ts` | 1 | Unconfigured deployment answers **503** and `/health` reports `google: "not-configured"` |
| `apps/api/tests/realtime.test.ts` | 4 | **Real WebSocket over TCP**: handshake refused (4401) without a valid live session, ping/pong, non-host control dropped **over the socket** and `403` over REST, outsider cannot join, revoked sessions cannot reconnect |
| `apps/api/tests/notifications.test.ts` | 4 | Reminder generation + local-scheduling window, per-category suppression and re-enable, read/unread/read-all/delete/clear lifecycle, and that dismissed or read reminders do not come back |
| `apps/api/tests/rate-limit.test.ts` | 1 | Window behaviour of the limiter |
| `apps/mobile/tests/api-url.test.ts` | 5 | A release build never points at localhost; explicit origin always wins |
| `apps/mobile/tests/timer-math.test.ts` | 7 | Pomodoro phase maths from stored timestamps (backgrounding, clock jumps) |
| `apps/mobile/tests/queue-scope.test.ts` | 4 | Offline queue is per account: another account's queued work is never replayed with this session's token |
| `apps/mobile/tests/google-flow.test.ts` | 7 | PKCE base64url encoding matches the platform implementation, S256 challenge, redirect-URI derivation, `state` verification, cancellation/error parsing, token sanity checks |

### C2. Live API checks (running process, real HTTP)

| Probe | Observed |
| --- | --- |
| `GET /health` and `/api/health` | `200`, `ok: true`, capabilities present: `email: "none"`, `push: true`, `google: "not-configured"`, CORS mode, TLS flag — **no configuration values leaked** |
| `POST /api/auth/google` with a token, unconfigured deployment | **`503`** `{"error":"unavailable","message":"Google Sign-In is not enabled on this server"}` |
| `POST /api/auth/login` (demo account) | `200` with user, settings and both tokens |
| `GET /api/tasks?view=all&limit=2` | `200`, real rows (`Pay electricity bill`, …), camelCase payload |
| `GET /api/focus/presets` | `200` with presets derived from the account's own settings (not an empty array) |
| `GET /api/tasks?token=<valid JWT>` | **`401`** — a URL token no longer authenticates REST |
| `GET /reset-password?token=…` in the log | logged as `/reset-password?token=[redacted]` |
| `POST /api/auth/forgot-password` (unknown vs known address) | identical `200` bodies in production mode; the dev-only `devToken` field appears only for a registered address and is suppressed when `NODE_ENV=production` |
| Graceful shutdown (`SIGTERM`) | `shutting down` → `shutdown complete`, connections closed cleanly |

### C3. Regression review — every implemented feature (code-level, this pass)

| Feature | Status after review | Evidence |
| --- | --- | --- |
| Authentication / session management | **Working** | `routes/auth.ts` + `security.test.ts`; per-device logout, rotation, reuse detection |
| Google Sign-In | **Implemented, server verified; device leg unverified** | `services/google.ts`, `tests/google.test.ts` (9); mobile flow in `lib/google*.ts` + `google-flow.test.ts` (7). Live 503 when unconfigured |
| Tasks (CRUD, subtasks, tags, recurrence, NLP capture, reminders) | **Working** | `api.test.ts`, `acceptance.test.ts` w2, `domain.test.ts` NLP |
| Projects | **Working** | `routes/projects.ts`, workflow tests |
| Notes | **Working** | `routes/notes.ts`, `acceptance.test.ts` (notes in sync/export) |
| Calendar (month/week/day, drag to reschedule) | **Working** | `routes/planner.ts` `/calendar`, w4 acceptance, `(tabs)`/`calendar.tsx` |
| Daily planner (Must Do / Nice to Do + capacity) | **Working** | `domain.test.ts` planner + capacity warnings, `/planner` routes |
| Eisenhower Matrix (auto-classify, drag re-classify, overload coaching) | **Working** — completion control in the matrix was a **dead control** and is now wired to the real mutation | w3 acceptance, `domain.test.ts` quadrants, `(tabs)/matrix.tsx` |
| Pomodoro / focus timer (timestamp-driven, backgrounding, notifications) | **Working** | `lib/timer.ts` (DATE trigger), `timer-math.test.ts` (7), w5 acceptance |
| Gang Timer (server-authoritative clock, host-only controls, stats) | **Working** | w7 acceptance, `api.test.ts`, and the new `realtime.test.ts` over real sockets (non-host control dropped, `403` over REST) |
| Habits (streaks, frequencies, heat map) | **Working** | w6 acceptance, `domain.test.ts` habit scheduling |
| Analytics + heat maps (never "more work = better") | **Working** | `domain.test.ts` scoring ratios, `api.test.ts` analytics reflect real activity |
| Search and filtering | **Working** | `api.test.ts` search filters + isolation, `search.tsx` with error state |
| Daily review | **Working** | `api.test.ts` review save + roll-forward, `review.tsx` |
| Notifications (local + per-category + quiet hours + remote push) | **Working**, two real bugs fixed | `notifications.test.ts` (4), `production.test.ts` push lifecycle; **fixed**: finished tasks were re-announced, and read/cleared reminders were regenerated |
| Offline / reconnect / sync | **Working** | w8 acceptance (sync exactly once, no clobbering), `queue-scope.test.ts` (per-account queue) |
| Account / profile / settings (`Settings → Customize`) | **Working** | `routes/account.ts`; every section read back by the screens (`taskDisplay`, matrix, pomodoro, calendar, habits, appearance) |
| Password change | **Working** | `security.test.ts` (others signed out, actor kept) |
| Password reset | **Working** (delivery needs a mail provider) | `production.test.ts` (single-use, expiring, no enumeration, provider failure handled) |
| Sign out all devices | **Working** | `security.test.ts` + `realtime.test.ts` (revoked session cannot reconnect) |
| Account export / deletion | **Working** | `production.test.ts` real cascade delete + address freed; export route covered |
| Accessibility / error states | **Working** — every list/detail screen now distinguishes *loading*, *empty* and *failed* (with retry); no dead buttons remain (automated sweep of `<Button>`/`<Pressable>` found zero without a handler) | sweep + screen edits in this pass |
| Theming / personalization | **Working** | `lib/theme.ts`, `settings/appearance.tsx`, per-account settings |
| Leaderboards (optional, per group, disable-able) | **Working** | `routes/social.ts` + `settings` toggle; ratio-based, not volume-based |

### C4. What could **not** be tested here (stated, not assumed)

- **No APK was built.** This environment has no Java/JDK, no Android SDK, no Gradle and no EAS CLI.
  Everything about the Android build is *configuration*, verified by reading, not by building.
- **No physical device or emulator.** Local notifications, backgrounding, kill/reopen, radio switching,
  clock changes, two-device Gang Timer, tray delivery and accessibility on a real screen are unverified.
  The manual script for all of it is `docs/DEVICE-TESTS.md` — **not yet executed**.
- **No outbound internet to Google or Expo**: Google's JWKS endpoint and Expo's push endpoint are
  unreachable from this container, so live Google token verification, real push delivery and real
  password-reset email delivery were not exercised. (Server-side verification logic *is* tested with
  real RS256 signatures; the transport to Google is the untested part.)
- **No HTTPS deployment**: TLS behaviour behind a real proxied domain is documented, not observed.
- **`npm audit` reports 14 moderate advisories**, all inside Expo's build-time tooling
  (`@expo/config`, `@expo/config-plugins`, `uuid`, `decode-uri-component` via `query-string`). None are
  runtime dependencies of the shipped app or API, and none have a fix that does not break SDK 57.

---

## D. External setup still needed

| # | Item | Status | Required for |
| --- | --- | --- | --- |
| 1 | **Server host** (Node 20+, persistent volume) | Not configured here | The app has nothing to talk to |
| 2 | **Domain + HTTPS** (`https://api.example.com`) | Not configured here | Release builds refuse plain HTTP; reset links must be HTTPS |
| 3 | **`JARVIS_JWT_SECRET`** (≥32 random chars) | Not set here | Boot fails without it in production |
| 4 | **Email provider** (`JARVIS_EMAIL_*`, SMTP or HTTP) | Not configured here | Real password reset for real users |
| 5 | **EAS account + `eas init`** (writes `extra.eas.projectId`) | Not configured here | Building the APK; also required for remote push tokens |
| 6 | **Android signing** (EAS-managed keystore, recommended) | Not configured here | An installable, updatable APK |
| 7 | **Firebase/FCM credentials in EAS** (Android push) | Optional | Remote push delivery while the app is closed |
| 8 | **Google OAuth client id** (+ `JARVIS_GOOGLE_CLIENT_IDS`) | Optional | Google Sign-In; needs the release keystore's SHA-1. Without it the app shows no Google button |
| 9 | **GitHub Actions secrets**: `EXPO_TOKEN` secret + `API_URL` variable | Optional | The manual APK job in CI |
| 10 | **Play Console account** | Optional | Play Store distribution (the `production` profile produces an AAB) |

---

## E. Exact ordered deployment commands (backend)

```bash
# 1. Code
git clone https://github.com/<you>/JARVIS.git && cd JARVIS
git checkout <release-tag-or-commit>

# 2. Dependencies (Node 20.11+; verified on 22)
npm ci

# 3. Persistent storage
export JARVIS_DATA_DIR=/var/lib/jarvis
sudo mkdir -p "$JARVIS_DATA_DIR" && sudo chown "$USER" "$JARVIS_DATA_DIR"

# 4. Secrets and configuration (never committed) — /etc/jarvis.env
cat > /etc/jarvis.env <<'EOF'
NODE_ENV=production
PORT=4000
JARVIS_API_HOST=0.0.0.0
JARVIS_JWT_SECRET=<48 random bytes: node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))">
JARVIS_DATA_DIR=/var/lib/jarvis
JARVIS_PUBLIC_URL=https://api.example.com
JARVIS_ALLOWED_ORIGINS=https://app.example.com
JARVIS_TRUST_PROXY=true
JARVIS_EMAIL_PROVIDER=smtp
JARVIS_EMAIL_FROM=JARVIS <no-reply@example.com>
JARVIS_SMTP_HOST=smtp.example.com
JARVIS_SMTP_PORT=587
JARVIS_SMTP_USER=<user>
JARVIS_SMTP_PASSWORD=<password>
# Optional:
# JARVIS_GOOGLE_CLIENT_IDS=<android-client-id>,<ios-client-id>
# JARVIS_PUSH_ENABLED=true
EOF
sudo chmod 600 /etc/jarvis.env

# 5. Web client (optional; the API serves it from the same port)
EXPO_PUBLIC_API_URL=https://api.example.com npm run build:web

# 6. Start (migrations run safely on boot, WAL + foreign keys are set)
set -a && . /etc/jarvis.env && set +a
npm run start -w @jarvis/api          # or run it under systemd/your process manager

# 7. Verify
curl -fsS https://api.example.com/health | head -c 200    # {"ok":true,...}
```

Then terminate TLS in front of it (Caddy example in `docs/DEPLOYMENT.md` §4), keep the process on a
**single instance** (SQLite + in-process rate limiting and realtime hub), and schedule WAL-safe backups:

```bash
sqlite3 "$JARVIS_DATA_DIR/jarvis.sqlite" ".backup '/var/backups/jarvis-$(date +%F).sqlite'"
```

---

## F. Exact APK build command

**Recommended (EAS, no local Android toolchain):**

```bash
npm install -g eas-cli          # or use npx eas-cli@latest
eas login
cd apps/mobile
eas init                        # writes extra.eas.projectId into app.json — commit it

EXPO_PUBLIC_API_URL=https://api.example.com \
  eas build --platform android --profile preview
```

`preview` is configured as `"buildType": "apk"` in `apps/mobile/eas.json`, so it produces an
**installable APK** (the `production` profile produces an AAB for Play). EAS generates and stores the
Android keystore on first build.

**Local alternative (requires JDK 17 + Android SDK):**

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://api.example.com npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

Signing for the local path: put the keystore outside the repository and reference it from
`android/gradle.properties` (or `~/.gradle/gradle.properties`); never commit it.

---

## G. Exact APK output / artifact location

| Path | What it is |
| --- | --- |
| EAS build page URL + QR code printed by `eas build` | Download the built APK; also listed by `eas build:list` |
| GitHub Actions artifact **`jarvis-preview-apk`** (manual job) | APK + `.sha256` checksum, retained 14 days |
| `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` | Local Gradle output only |
| `apps/mobile/android/app/build/outputs/bundle/release/app-release.aab` | Local Gradle AAB (Play) |

No APK was produced in this environment (no Android toolchain) — the paths above are the documented
outputs of the two supported commands.

---

## H. GitHub Release process

```bash
# 1. Build and download the APK (section F). Keep it next to the repository.
# 2. Checksum
sha256sum app-release.apk > app-release.apk.sha256

# 3. Tag and publish (tag matches app.json version 1.0.0)
gh release create v1.0.0 \
  --title "JARVIS 1.0.0 — Android" \
  --notes-file release-notes.md \
  app-release.apk app-release.apk.sha256

# 4. Verify
gh release view v1.0.0
```

`release-notes.md` should state: what changed, the API origin the build points at, the minimum Android
version (7.0 / API 24), that sign-in is email + password (plus Google only if you configured it), and
that the checksum is published. Template in `docs/RELEASE.md` §7.

**Continuous integration**: `.github/workflows/ci.yml` runs `npm ci` → `npm run typecheck` → `npm test`
→ `npm run build:web` on every push/PR, and an APK job that runs **only on manual dispatch**
(`workflow_dispatch`, `build_apk: true`). It requires the repository secret `EXPO_TOKEN` and the
repository variable `API_URL`, fails fast with an explanatory message when they are missing, downloads
the built APK, writes a SHA-256 and uploads both as artifacts. It never publishes secrets and never
prints credentials.

---

## I. How another Android user installs it

1. Open the GitHub Release page (or the link you share) and download `app-release.apk`.
2. Android asks to allow installing from this source (Browsers/Files) — allow it for that app only.
3. Tap the APK → **Install** → **Open**.
4. On first launch the app shows the sign-in screen (no demo account is created). New users tap
   *Create an account*: the workspace starts empty and isolated.
5. Permission prompts appear in context: notifications when you first create an account or set a
   reminder. Until granted, the app says reminders cannot be shown (it does not pretend otherwise).
6. Optional: verify the file with `sha256sum app-release.apk` against the published checksum.
7. Minimum Android version: 7.0 (API 24) — Expo's Gradle plugin default (`minSdk` 24) since
   `app.json` sets no override. The APK is signed; updates require the same signing key.

---

## J. Blockers, warnings, optional

**BLOCKER — must be done before real users can rely on the app**

1. Deploy the API over HTTPS with a persistent volume and a strong `JARVIS_JWT_SECRET`
   (`NODE_ENV=production`, `JARVIS_PUBLIC_URL`, `JARVIS_ALLOWED_ORIGINS`, `JARVIS_TRUST_PROXY`).
2. Configure an email provider (`JARVIS_EMAIL_*`) and verify one real reset end to end
   (request → mail → link → new password → the old link is refused).
3. Build and sign the APK with EAS (`eas init` + `preview` profile) and attach it to a tagged release.
4. Execute `docs/DEVICE-TESTS.md` on at least two real devices, including the two-device Gang Timer
   matrix, the Pomodoro background test and offline create → reconnect.
5. Adopt the **release keystore** and never lose it (EAS-managed or a backed-up local keystore).

**WARNING — matters for real users, not fatal**

1. **SQLite = one instance.** No horizontal scaling; keep a single replica and back up with `.backup`.
2. **Remote push is inert until configured** (`extra.eas.projectId` + FCM credentials in EAS). Local
   reminders work regardless; the About screen and the push panel report the real state.
3. **Google Sign-In is unverified on a device.** The server side is tested; the browser round-trip
   needs a device test with a real Google OAuth client.
4. **Email delivery, push delivery and HTTPS were not observed here** (no egress; no deployment).
5. **`npm audit`**: 14 moderate advisories inside Expo's build tooling; no runtime exposure.
6. **Fastify deprecation notice** at boot (`disableRequestLogging` → `logController` in Fastify 6).
   Cosmetic; credential scrubbing is unaffected.
7. Rate limits are per IP, so users behind one NAT share a bucket; the WebSocket endpoint
   (`/realtime`) sits outside the HTTP limiter — handshakes require a live session and frames are
   schema-validated, but there is no per-socket message budget yet.
8. **`JARVIS_ALLOWED_ORIGINS` is empty by default** in production: browsers get no CORS grant until you
   set it. The Android app is native and unaffected.
9. **Google/Apple sign-in is not the only gap in identity**: there is no email-verification flow for
   password accounts, no 2FA and no social recovery — document that in your support policy.
10. The web export is a companion (no system notifications, no background timers).

**OPTIONAL — quality, not correctness**

1. Play Store listing (AAB, privacy policy, content rating).
2. iOS build (needs an Apple Developer account; the code is cross-platform but untested there).
3. Sentry or similar error tracking, uptime monitoring on `/health`.
4. Off-box backups and a documented restore drill.
5. Google Sign-In client ids for iOS/web.
6. Richer group moderation and admin tooling.

---

## K. Final verdict

# NOT YET READY FOR REAL USERS

The repository is complete and internally verified — 101 automated tests pass (API 78, mobile 23, re-run after this pass's edits),
typechecking is clean in all three workspaces, the web build exports, and the security review produced
genuine fixes this pass (Google ID-token verification with real signature checks, WebSocket
authentication/authorisation proven over real sockets, notification de-duplication bugs, dead
controls, and honest failure states across every list and detail screen).

It is **not** ready to hand to real users yet, because the things that remain are exactly the ones that
cannot be done inside this environment and cannot be faked: a deployed HTTPS backend with a real email
provider, a signed APK produced by an EAS account, and a physical-device pass of
`docs/DEVICE-TESTS.md`. Until those are done — and until Google Sign-In, push delivery and the reset
email are each exercised once against the real services — the honest verdict stays **not yet ready**.
Everything listed in J is ordered so those steps are mechanical rather than exploratory.
