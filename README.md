# JARVIS

**A personal productivity system that closes the loop:** capture → prioritize → plan → focus →
complete → review → improve.

JARVIS is a real native mobile app (Expo / React Native) with a real backend (Fastify + SQLite),
real authentication, real persistence, a server-authoritative group focus timer, and offline
support with conflict-safe sync. There are no mock screens, no fake API responses and no
placeholder buttons: if something cannot work in your deployment, the app says so instead of
pretending.

---

## Contents

- [Features](#features)
- [Architecture](#architecture)
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

### Accounts and sign-in
- Email + password sign-in with a private workspace created at signup.
- **Google Sign-In** (optional): when the operator configures Google client ids, the app offers
  “Continue with Google”. The ID token is verified by the API against Google's published keys —
  signature, issuer, audience, expiry and a verified email address — and a Google account is linked
  to an existing email account only through that verified address. Unconfigured deployments answer
  `503` and the app hides the button, so no unusable option is ever shown.
- Per-device sessions: signing out on one phone leaves your other devices signed in; changing the
  password signs the others out.

### Capture and organize
- **Tasks** with subtasks, tags, priorities, estimates, due dates/times, recurring rules, projects
  and a natural-language quick-capture ("Submit the report tomorrow at 5pm every weekday") that
  always shows what it understood before saving.
- **Eisenhower matrix** with drag-to-reclassify, per-quadrant names you can edit, and overload
  suggestions — framed as "take something out", never as "do more".
- **Projects** with progress, next actions, linked notes and health.
- **Notes** that can be attached to a task or project, searched, and pinned.
- **Habits** with streaks, weekday schedules, reminders and a completion heat map.

### Plan and focus
- **Calendar** (month / week / day) with drag-to-reschedule, working hours and default durations.
- **Daily planner** with Must Do / Nice to Do, time blocks, capacity warnings and reordering.
- **Pomodoro focus timer** whose remaining time is derived from stored timestamps, so it survives
  backgrounding, device sleep and app restarts; sessions write real focus records.
- **Gang Timer**: a server-authoritative group focus session (no chat). The server owns the clock
  anchor; devices derive the countdown from it and receive only state changes over WebSocket, with
  polling as a fallback. Reactions are permitted; controls are host-only.

### Review and improve
- **Daily review**: what moved, what slipped, tomorrow's top task, mood and energy.
- **Analytics and heat maps** computed from your own records only — completion, focus minutes,
  habit consistency, planning accuracy. Nothing rewards raw volume.
- **Global search** across tasks, notes, projects and habits with filters.
- **Notifications**: local reminders scheduled on-device from your settings, plus optional remote
  push (Expo push service) for events no local schedule can know about, such as a gang invitation.
- **Friends and private groups**: productivity-focused social features, owner-only administration,
  and per-group leaderboards that are off by default.
- **Full customization**: light/dark/system themes, accents, density, radius, animation level, font
  scale, dashboard widgets, task defaults and display, matrix wording, Pomodoro behaviour, calendar
  and habit preferences — all persisted per account.
- **Offline mode**: queued operations with idempotent replay, per-user revision numbers and
  conflict reporting that never silently overwrites your work.
- **Data control**: full JSON/CSV export and true account deletion.

## Architecture

```
            ┌───────────────────────────────┐
            │  Expo app (Android / iOS / web)│
            │  expo-router · React 19 · RN 86│
            └───────────────┬───────────────┘
        Authorization header│ /api/*     WebSocket │ /realtime
                            ▼                       ▼
            ┌───────────────────────────────────────────────┐
            │  Fastify API (Node 20+)                        │
            │  zod validation · scrypt · JWT + rotating      │
            │  refresh tokens · per-IP rate limits · CORS    │
            │  allow-list · request logging that redacts     │
            ├───────────────┬──────────────┬────────────────┤
            │  Repos (SQL)  │ Services     │ Realtime hub   │
            └───────┬───────┴──────┬───────┴────────────────┘
                    │              │
              ┌─────▼─────┐   ┌────▼───────────┐
              │ SQLite    │   │ Email (SMTP /  │
              │ WAL + FK  │   │ HTTP provider) │
              │ persistence│  └────────────────┘
              └───────────┘   ┌────────────────┐
                              │ Expo push relay│
                              └────────────────┘
```

- **`packages/shared`** holds the domain: models, zod schemas and pure logic (recurrence,
  Eisenhower classification, habit streaks, planning, scoring, heat maps, NL parsing). Both sides
  import it, so a rule cannot diverge between client and server.
- **`apps/api`** is layered: `routes` (HTTP) → `services` (business rules) → `repo` (SQL) with
  `db` (schema + migrations), `lib` (crypto, tokens, errors, sanitizing) and `realtime`.
- **`apps/mobile`** separates `app` (screens), `components` (UI kit), `hooks` (data), and `lib`
  (api, auth, query cache, offline queue, realtime, timer, theme, push, storage).
- Sync is pull-based and idempotent: every user row carries a monotonically increasing `seq`; the
  client pulls `since=<cursor>`, receives deletions as tombstones, and pushes queued operations with
  client-generated ids so a retried write can never duplicate.

## Repository layout

```
apps/api          Fastify API: routes, repos, services, realtime gateway, email + push delivery,
                  SQLite schema and migrations, tests
apps/mobile       Expo app: src/app (screens, expo-router), src/components, src/hooks,
                  src/lib (api, auth, sync, offline, timer, theme, push)
packages/shared   Domain models, zod schemas and the pure logic both sides share
docs/             DEPLOYMENT.md · RELEASE.md · SECURITY.md
```

## Run it locally

Requirements: **Node.js 20.11+** and npm 10+. For the mobile app you also need the Expo Go app
(quickest) or a device/emulator.

```bash
npm install
npm run dev            # API + web client on http://localhost:4000
```

In a second terminal:

```bash
npm run mobile         # Expo dev server (press "a" for Android, "i" for iOS, "w" for web)
```

Optional demo content (three friends, two groups, ten weeks of history, an active gang session):

```bash
npm run seed           # demo@jarvis.app / Demo1234!  (development only)
npm run reset:db       # delete the local database and start fresh
```

The API serves the exported web client from the same port, so `http://localhost:4000` is a complete
working app. The mobile client finds the API automatically in development (Metro host, port 4000).

## Configuration

Every server variable is documented in **[`.env.example`](.env.example)** — copy it to `.env`
(gitignored) or export the values in your process manager. The essentials:

| Variable | Purpose | Required in production |
| --- | --- | --- |
| `NODE_ENV` | Enables production behaviour (strict config, quiet logs) | Yes |
| `PORT` / `JARVIS_API_HOST` | Listen address | Yes |
| `JARVIS_JWT_SECRET` | Signs access tokens (≥32 characters, random) | **Yes** — boot fails without it |
| `JARVIS_DATA_DIR` / `JARVIS_DB_FILE` | Persistent SQLite location | Yes (persistent volume) |
| `JARVIS_PUBLIC_URL` | Public HTTPS origin, used in reset emails | Yes with email |
| `JARVIS_ALLOWED_ORIGINS` | CORS allow-list when a browser uses another origin | When serving the web client cross-origin |
| `JARVIS_EMAIL_*` | SMTP or HTTP provider for password-reset mail | For real users |
| `JARVIS_PUSH_*` | Expo push relay (no secrets needed by default) | Optional |
| `JARVIS_GOOGLE_CLIENT_IDS` | Enables `POST /api/auth/google`; empty means the app hides Google sign-in and the route answers 503 | Optional |
| `EXPO_PUBLIC_API_URL` (client, build time) | The HTTPS API origin the APK talks to | **Yes** for release builds |
| `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` (client, build time) | Google OAuth client ids (public identifiers, never a secret) | Optional |

Nothing secret ever ships in the app bundle: `EXPO_PUBLIC_*` is public by definition and is only
used for the API origin. A release build without `EXPO_PUBLIC_API_URL` does not fall back to
localhost — it shows a plain "server not configured" message instead of failing mysteriously.

## Deploy the backend

Any host that can run Node.js 20 and mount a persistent volume works (a small VPS, Fly.io,
Railway, Render, a container on your own server…). The full walkthrough — including TLS via a
reverse proxy, systemd, backups, upgrades and troubleshooting — is in
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Short version:

```bash
npm ci
NODE_ENV=production JARVIS_JWT_SECRET=… npm run start -w @jarvis/api
curl -fsS https://api.example.com/health
```

## Build the Android APK

Two supported paths — full detail, signing and store notes in
**[docs/RELEASE.md](docs/RELEASE.md)**.

**Recommended: EAS (no local Android toolchain needed)**

```bash
npm install -g eas-cli
eas login
cd apps/mobile
eas init                                     # writes extra.eas.projectId
EXPO_PUBLIC_API_URL=https://api.example.com eas build -p android --profile preview
```

The `preview` profile produces an installable **APK** (the `production` profile produces an AAB for
Google Play). EAS prints a download URL and a QR code when the build finishes.

**Local build (requires JDK 17 + Android SDK)**

```bash
cd apps/mobile
npx expo prebuild --platform android          # never --clean
cd android && ./gradlew assembleRelease
# → apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Install the APK on a phone

1. Download the APK from the EAS link or from your GitHub Release (see
   **[docs/RELEASE.md](docs/RELEASE.md)**).
2. Open it on the device; Android asks you to allow installing from that app (Chrome/Files) the
   first time — that is the normal "unknown sources" prompt for sideloaded apps.
3. Accept the notification permission so reminders can be shown. Decline it and everything else
   still works; the app tells you reminders are off.
4. Sign up with your own email — you land in an empty, private workspace. Nothing is shared with
   anyone unless you create or join a group.

## Tests and verification

```bash
npm run typecheck     # shared, api and mobile — strict TypeScript
npm test              # API (integration, domain, rate limiter, acceptance, production, security,
                      #      log hygiene, realtime WebSocket, notifications, Google sign-in) + mobile units
npm run build:web     # exports the web client the API serves
```

**Physical-device testing is outstanding.** The automated suites run headless and cannot prove
rendering, system permissions, radio switching, notification delivery to the system tray or
two-device realtime behaviour. The complete manual script — including the two-device Gang Timer
matrix and the offline/reconnect cases — is **[docs/DEVICE-TESTS.md](docs/DEVICE-TESTS.md)**, and it
is explicitly marked as not yet executed. Treat the app as release-candidate until that checklist is
green on real hardware.

## Security

Design notes, threat model and the review performed before release:
**[docs/SECURITY.md](docs/SECURITY.md)**. Highlights:

- scrypt password hashing with per-user salts; passwords are never logged or exported.
- Short-lived access tokens with rotating refresh tokens; replaying a rotated token revokes the family.
- Session ids are tracked server-side, so sign-out, password change and password reset invalidate
  tokens immediately instead of waiting for expiry.
- Password reset uses single-use, hashed, 30-minute tokens and never reveals whether an address exists.
- Per-IP rate limits on credential endpoints plus a global request ceiling; no arbitrary-origin CORS.
- Every query is parameterised; every handler scopes rows to the authenticated user.
- Request URLs are sanitised before logging, so a token in a URL (the WebSocket handshake, the
  emailed reset link) never reaches a log file.
- Errors returned to clients never contain stack traces or internal details.

## Known limitations

Stated plainly so nobody is surprised in production:

- **SQLite means one instance.** Workers, multiple replicas or horizontal autoscaling are not
  supported; the rate limiter and realtime hub keep state in memory. Run a single process with a
  persistent volume. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Password reset needs a mail provider.** Without `JARVIS_EMAIL_*` credentials the API answers
  identically but cannot deliver — the server logs say so, and the app never claims an email was sent
  when it was not.
- **Remote push needs an EAS project id** (and, for Android, credentials configured on that EAS
  project). Local reminders work with neither. The app reports the exact status in
  Settings → Notifications instead of pretending.
- **Apple sign-in is not implemented**, and Google Sign-In only appears when the deployment
  configures Google client ids (see `.env.example`). A build without them shows no Google button at
  all — nothing is faked. Google sign-in is also *not verified on a physical device* in this
  repository: the server side is covered by tests (`apps/api/tests/google.test.ts`), the device leg
  needs the manual checklist.
- **iOS builds need an Apple Developer account** for device distribution; Android APKs do not.
- **The web build is a companion**, not the product: native-only behaviour (background timers,
  notification scheduling) is naturally limited there.

## Contributing

1. `npm install && npm run typecheck && npm test` must pass.
2. Keep the layering: no SQL in routes, no business rules in components, shared rules in
   `packages/shared`.
3. Add a test for behaviour you change; never relax an existing test to make a change pass.
4. Never commit `.env` files, keystores, service-account JSON or database files — `.gitignore`
   covers them, and CI checks nothing secret is required to build.
