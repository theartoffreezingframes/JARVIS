# JARVIS

A personal productivity system that runs on your own server.

JARVIS follows one loop — **capture → prioritise → plan → focus → complete → review → improve** — and
implements each step as a real feature rather than a placeholder: an Eisenhower matrix you can drag
between quadrants, a daily planner with capacity warnings, a timestamp-based Pomodoro, habit streaks
and heat maps, a calendar you can reschedule by dragging, notes, analytics, groups, and a
**server-authoritative Gang Timer** for focus sessions with other people.

It is a native Android/iOS app (Expo + React Native) backed by a small Fastify + SQLite service that
you control. There is no vendor account, no cloud dependency for core features, and no demo data
unless you tap **Try demo data** inside your own account.

---

## Contents

- [Features](#features)
- [Technology](#technology)
- [Repository layout](#repository-layout)
- [Run it locally](#run-it-locally)
- [Configuration](#configuration)
- [Deploy the backend](#deploy-the-backend)
- [Build the Android APK](#build-the-android-apk)
- [Install the APK on a phone](#install-the-apk-on-a-phone)
- [Tests and verification](#tests-and-verification)
- [Security](#security)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)

---

## Features

**Capture and organise**

- Natural-language task capture (*"Pay the electricity bill tomorrow at 6pm #home !high"*) with a
  confirmation step before anything is saved.
- Tasks with projects, tags, subtasks, estimates, priorities, due dates and recurrence.
- Global search with filters across tasks, notes, projects and habits.

**Prioritise and plan**

- Eisenhower matrix with drag-to-reclassify, per-account quadrant names/descriptions and overload
  suggestions.
- Daily planner with Must Do / Nice to Do ordering, capacity warnings and one-tap roll-forward.
- Calendar with month / week / day views and drag-to-reschedule.
- Daily review that closes the loop and can move unfinished work forward.

**Focus and habit**

- Pomodoro timer with configurable durations, auto-start, sound, haptics, ring/bar/digits countdown
  and optional keep-screen-awake. The countdown is derived from stored timestamps, so it stays
  correct while the app is backgrounded or the screen is off.
- Focus history, daily targets and per-project focus totals.
- Habits with streaks, weekday schedules, reminders and heat maps.

**Together**

- Friends and private groups (invite codes; group visibility is enforced server-side).
- **Gang Timer**: a shared focus session whose phase, round and remaining time come from one
  authoritative server clock (`clock_anchor_at`). Clients derive the countdown locally and resync
  over WebSocket, so a dropped connection, a backgrounded app or a restarted server cannot desync it.
  Only state changes travel over the socket — never a per-second tick, and there is no chat.
- Reactions and participant state, with the host (and only the host) controlling the shared clock.

**Around all of it**

- Offline support: reads come from a local cache, writes queue as operations and replay with
  conflict-safe three-way merge.
- Analytics and heat maps computed from real records only, with metrics you choose.
- Notifications with per-category switches, quiet hours and real remote push when the server has push
  credentials configured.
- Per-account customisation: themes (light/dark/system), presets, accent, density, radius, animation
  level, font scale, dashboard widgets, task display, matrix labels, Pomodoro settings, calendar
  working hours, habit display.
- Data export (JSON/CSV) and real account deletion.

## Technology

| Layer | Choice | Why |
| --- | --- | --- |
| Mobile app | Expo SDK 57, React Native 0.86, Expo Router, TypeScript | One codebase for Android and iOS, native UI (no webview), file-based routing |
| State/data | React context + a small query cache with offline queue | No heavyweight data layer; the sync engine is explicit and testable |
| Realtime | WebSocket (`@fastify/websocket`) with a polling fallback | State-change broadcast only; the gang clock is timestamp-derived |
| Backend | Node 20+, Fastify 5, zod 4 | Fast, small, fully typed, one process |
| Database | SQLite (better-sqlite3) in WAL mode | Real relational storage with zero operational overhead |
| Auth | HS256 access tokens + rotating opaque refresh tokens, scrypt password hashing | Standard, dependency-free, revocable |

## Repository layout

```
apps/api          Fastify API: routes, repos (SQL access), services (business logic),
                  realtime gateway, email + push delivery, SQLite schema and migrations
apps/mobile       Expo app: src/app (screens, expo-router), src/components, src/hooks,
                  src/lib (api, auth, sync, offline, timer, theme, push)
packages/shared   Domain models, zod schemas and pure logic used by both sides
docs/             Deployment, release and security documentation
```

## Run it locally

Requirements: **Node.js ≥ 20.11** and npm. Android/iOS builds additionally need a phone with Expo Go
(for development) or a Java/Android SDK toolchain (for local release builds — see below).

```bash
git clone https://github.com/<you>/JARVIS.git
cd JARVIS
npm install

# terminal 1 — API on http://localhost:4000 (SQLite file in apps/api/data/)
npm run dev

# terminal 2 — Expo dev server (press "a" for Android, "i" for iOS, "w" for web)
npm run mobile
```

Optional sample workspace (`demo@jarvis.app` / `Demo1234!`, plus three other seeded accounts):

```bash
npm run seed
```

The API also serves an exported web build, which is handy for a quick look without a device:

```bash
npm run preview        # build the web app and serve it from the API at :4000
```

In development the app discovers the API automatically: on a device it uses the Metro host on port
4000, and on web it uses the origin that served the page. Pointing a build somewhere else is a
build-time setting — see below.

## Configuration

Nothing is hard-coded and nothing secret is committed. Copy the template and edit it:

```bash
cp .env.example .env      # the API reads it automatically; .env is gitignored
```

The settings that matter (the full list with explanations is in [`.env.example`](.env.example)):

| Variable | Required | Purpose |
| --- | --- | --- |
| `JARVIS_JWT_SECRET` | production | ≥ 32 random characters; the server refuses to start without it |
| `JARVIS_DATA_DIR` | production | Persistent directory for the SQLite file and backups |
| `JARVIS_PUBLIC_URL` | production | `https://api.example.com` — used for password-reset links |
| `JARVIS_ALLOWED_ORIGINS` | when serving the web app from another origin | Exact CORS allow-list; empty means same-origin only |
| `JARVIS_EMAIL_*` | for password reset | SMTP or a transactional API; without it, reset mail cannot be delivered |
| `EXPO_PUBLIC_API_URL` | **release builds** | The API origin compiled into the app, e.g. `https://api.example.com` |

> `EXPO_PUBLIC_*` values are embedded in the client bundle. Never put a secret there.

Mint a secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## Deploy the backend

Full instructions, including reverse-proxy TLS configuration, systemd/Docker/Fly.io examples,
backups, upgrade procedure and troubleshooting: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

The short version: run one Node process on a host with a persistent volume, put it behind Caddy or
nginx for HTTPS, set the variables above, and check `GET /health`:

```bash
curl -s https://api.example.com/health
# {"ok":true,"status":"healthy","service":"jarvis-api","version":"1.0.0",
#  "env":"production","uptimeSeconds":42,"realtimeClients":0,
#  "capabilities":{"email":"smtp","push":true,"cors":"1 origin(s) allow-listed","https":true,...}}
```

TLS is terminated by the proxy, not by the app. A release build of the mobile app requires `https://`
— never disable Android cleartext traffic to work around a plain-HTTP server.

## Build the Android APK

The app uses Expo's managed workflow (no `android/` folder is committed; it is generated on demand).
Choose one of two paths — full details and signing notes are in **[docs/RELEASE.md](docs/RELEASE.md)**.

**Option A — EAS cloud build (recommended, produces the APK without a local Android SDK)**

```bash
cd apps/mobile
npx eas-cli@latest login                      # free Expo account
npx eas-cli@latest init                       # writes extra.eas.projectId into app.json
EXPO_PUBLIC_API_URL=https://api.example.com \
  npx eas-cli@latest build --platform android --profile preview
```

`preview` is configured in [`apps/mobile/eas.json`](apps/mobile/eas.json) to produce an installable
**APK**; `production` produces an **AAB** for Google Play. When the build finishes, EAS prints a
download URL and a QR code — that URL is the artifact location.

**Option B — build locally (needs JDK 17 + Android SDK, and your own signing key)**

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://api.example.com npx expo prebuild --platform android
cd android
./gradlew assembleRelease      # APK  → app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease        # AAB  → app/build/outputs/bundle/release/app-release.aab
```

**APK location:** for local builds,
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`. A local `assembleRelease` build
is signed with the debug key unless you configure a release keystore, which is fine for testing and
not acceptable for distribution — configure signing or use EAS-managed credentials.

## Install the APK on a phone

1. Transfer the APK to the phone (download the EAS link, or copy the file over USB/cloud storage).
2. Open it. Android will ask to allow installs from that app — enable it for your browser/file manager
   (Settings → Apps → Special access → Install unknown apps).
3. Confirm the install and open JARVIS.
4. Sign up. Your workspace starts empty and private; there is no shared demo account.
5. Allow notifications when asked (needed for reminders) and optionally grant the battery-optimisation
   exemption so reminders survive aggressive power management.

The build must have been created with `EXPO_PUBLIC_API_URL` pointing at your HTTPS API — a build made
without it shows a plain "Server not configured" message instead of failing mysteriously.

## Tests and verification

```bash
npm test              # API (integration, domain, rate limiter, production, security) + mobile unit tests
npm run typecheck     # shared, api and mobile — all strict TypeScript
```

The API suite boots the real server against a temporary SQLite file: routing, validation,
authentication, authorisation, sync conflicts, gang clock behaviour, rate limits, push
registrations, password reset (with a captured email transport) and restart durability are all
exercised. Anything that has not been run is not claimed as working.

## Security

Design notes, threat model and the review performed before release: **[docs/SECURITY.md](docs/SECURITY.md)**.
Highlights:

- scrypt password hashing with per-user salts; passwords are never logged or exported.
- Short-lived access tokens with rotating refresh tokens; replaying a rotated token revokes the family.
- Session ids are tracked server-side, so sign-out, password change and password reset invalidate
  tokens immediately instead of waiting for expiry.
- Password reset uses single-use, hashed, 30-minute tokens and never reveals whether an address exists.
- Per-IP rate limits on credential endpoints plus a global request ceiling; no arbitrary-origin CORS.
- Every query is parameterised; every handler scopes rows to the authenticated user.
- Errors returned to clients never contain stack traces or internal details.

## Known limitations

Stated plainly so nobody is surprised in production:

- **SQLite means one instance.** Workers, multiple replicas or horizontal autoscaling are not
  supported; the rate limiter and realtime hub keep state in memory. Run a single process with a
  persistent volume. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#scaling-and-its-limits).
- **Password reset needs a mail provider.** Without `JARVIS_EMAIL_*` credentials the API answers
  identically but cannot deliver — the server logs say so, and the app never claims an email was sent
  when it was not.
- **Remote push needs an EAS project id** (and, for Android, credentials configured on that EAS
  project). Local reminders work with neither. The app reports the exact status in
  Settings → Notifications instead of pretending.
- **iOS builds need an Apple Developer account** for device distribution; Android APKs do not.
- **The web build is a companion**, not the product: native-only behaviour (background timers,
  notification scheduling) is naturally limited there.

## Contributing

1. Branch from `main`.
2. Keep the layering: UI → hooks → `src/lib` → API; API → routes → services → repo.
3. Add tests for behaviour changes (`apps/api/tests`, `apps/mobile/tests`).
4. Run `npm run typecheck && npm test` before opening a pull request.
5. Never commit secrets, keystores, `.env` files or database files — `.gitignore` blocks the usual
   suspects, but check `git status` before committing.
