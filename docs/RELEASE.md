# Releasing JARVIS for Android

This is the end-to-end release process: point the app at your API, build a signed APK, publish it on
GitHub, and hand real users an installable file.

> Everything below is about Android, because that is what can be sideloaded today. iOS builds need an
> Apple Developer account ($99/year) and either TestFlight or the App Store; the same EAS commands
> apply with `--platform ios`.

---

## 0. Before the first release

Three things must exist, in this order:

1. **A reachable HTTPS API** — see [DEPLOYMENT.md](DEPLOYMENT.md). Note its origin, e.g.
   `https://api.example.com`.
2. **An Expo account** (free) — `npx eas-cli@latest register` / `login`.
3. **A decision about push notifications.** Local reminders work with no extra setup. For *remote*
   push (gang invitations arriving with the app closed) you need an EAS project and, for Android, FCM
   credentials attached to it — see [Push credentials](#4-push-credentials-optional).

---

## 1. Point the app at your API

The API origin is compiled into the bundle at build time:

```bash
export EXPO_PUBLIC_API_URL=https://api.example.com
```

- Set it for **every** release profile. A build without it ships the "Server not configured" screen
  instead of silently calling `localhost` (that fallback only exists for development).
- It is read in `apps/mobile/src/lib/api-url.ts`, which is unit tested so this cannot regress quietly.
- Changing it later requires a rebuild. That is deliberate: no runtime remote-config service, no
  hidden redirects.

## 2. Initialise the EAS project (once)

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init
```

`init` adds `extra.eas.projectId` to `apps/mobile/app.json` and links the project to your Expo
account. Commit that change — a project id is not a secret.

`apps/mobile/eas.json` defines the three profiles:

| Profile | Output | Use |
| --- | --- | --- |
| `development` | APK, internal distribution | Testers who want a dev-style build against a staging API |
| `preview` | **APK**, internal distribution | The build you hand to real users / test on a device |
| `production` | **AAB**, `autoIncrement` versions | Google Play submission |

## 3. Build the APK

```bash
cd apps/mobile
EXPO_PUBLIC_API_URL=https://api.example.com \
  npx eas-cli@latest build --platform android --profile preview
```

When it completes you get:

- a download URL (`https://expo.dev/artifacts/eas/<id>.apk`),
- a QR code to install straight onto a phone,
- an entry in `npx eas-cli@latest build:list`.

**Artifact location:** the EAS URL above. If you build locally instead, the file is
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.

### Local (offline) builds

Requires JDK 17 and the Android SDK (`ANDROID_HOME` set):

```bash
cd apps/mobile
npx expo prebuild --platform android          # generates android/ (gitignored; additive, never --clean)
EXPO_PUBLIC_API_URL=https://api.example.com npx expo run:android --variant release   # tethered test
cd android && ./gradlew assembleRelease       # APK
```

`android/` is generated output and is gitignored. Do not commit it, and never run
`expo prebuild --clean` on a checkout that has local native changes.

## 4. Push credentials (optional)

Remote push goes through Expo's push service:

- **Android:** create a Firebase project, add an Android app with package `app.jarvis.mobile`, then
  upload the FCM service-account JSON to EAS:
  `npx eas-cli@latest credentials --platform android` → *Google Service Account*.
  Alternatively place `google-services.json` in `apps/mobile/` — it is gitignored, so it stays local.
- **iOS:** EAS manages the APNs key for you (`eas credentials --platform ios`).

Never commit `google-services.json`, `GoogleService-Info.plist` or service-account JSON. The server
needs no FCM credentials of its own; it posts to `https://exp.host/--/api/v2/push/send` and the
device's Expo push token identifies the install.

## 5. Signing

**EAS-managed (recommended).** On the first Android build EAS offers to generate a keystore and stores
it on your account: nothing sensitive ever lives in the repository.

```bash
npx eas-cli@latest credentials --platform android     # list / download / upload
```

Keep an offline copy of the keystore and its passwords in a password manager. **If you lose the
signing key you can never update the published app again** — you would have to ship a new package id.

**Local signing.** Generate a keystore and keep it outside the repository:

```bash
keytool -genkeypair -v -keystore ~/keys/jarvis-release.keystore \
  -alias jarvis -keyalg RSA -keysize 2048 -validity 10000
```

Then reference it from `android/gradle.properties` (generated, gitignored) with
`JARVIS_UPLOAD_STORE_FILE`, `JARVIS_UPLOAD_KEY_ALIAS`, and the passwords in
`~/.gradle/gradle.properties` (never in the project). `.gitignore` already blocks `*.jks`,
`*.keystore`, `keystore.properties`, `credentials.json`, `play-service-account*.json` and `.env*`.

## 6. Publish the GitHub Release

```bash
gh release create v1.0.0 \
  --title "JARVIS 1.0.0 — Android" \
  --notes "First public release.

**Install:** download the APK below, open it on your phone, allow installs from your browser,
and sign up. Requires an account on a JARVIS API (see the README for hosting one).

Highlights:
- capture → plan → focus → review loop with offline support
- Eisenhower matrix, daily planner, calendar drag-to-reschedule
- habits with streaks and heat maps
- Gang Timer with server-authoritative sync
- JSON/CSV export and real account deletion

The API this build points at is https://api.example.com." \
  /path/to/app-release.apk
```

Attach the APK (and its SHA-256 checksum, which is good practice):

```bash
sha256sum app-release.apk > app-release.apk.sha256
```

Bump `expo.version` in `apps/mobile/app.json` for every user-visible release; `eas.json` increments
the Android `versionCode` automatically in the `production` profile.

## 7. Installing it on an Android phone

1. Open the release page and download `app-release.apk` (or scan the EAS QR code).
2. Tap the file. Android asks for permission to install from that source — allow it for the browser or
   file manager, then confirm.
3. Open JARVIS and sign up. If the build was made without `EXPO_PUBLIC_API_URL` you will see
   "Server not configured" instead of a login screen.
4. Grant notification permission when prompted; optionally exclude JARVIS from battery optimisation so
   reminders are not delayed.
5. Updates: install the newer APK over the old one (same signing key). Data lives on the server, so
   nothing is lost.

## 8. Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- installs dependencies,
- typechecks all three workspaces,
- runs the full API and mobile test suites,
- builds the Expo web bundle,
- and (on manual dispatch, when an `EXPO_TOKEN` repository secret exists) builds a preview APK and
  uploads it as a workflow artifact.

No workflow publishes anything automatically and no workflow prints secrets. To enable the optional
APK job, add `EXPO_TOKEN` in **Settings → Secrets and variables → Actions** (create it at
expo.dev → Account settings → Access tokens).

## 9. Release checklist

- [ ] API deployed over HTTPS with a persistent volume; `curl https://api.example.com/health` is `ok`
- [ ] `JARVIS_JWT_SECRET` is a fresh, strong secret; `JARVIS_ALLOWED_ORIGINS` lists your web origin
- [ ] An email provider is configured and a password-reset email actually arrives
- [ ] `npm run typecheck && npm test` pass on the release commit
- [ ] `EXPO_PUBLIC_API_URL` is exported for the build
- [ ] APK built with the `preview` profile (or local `assembleRelease`) and installed on a real phone
- [ ] Sign-up, sign-in, task creation, focus session, gang session, notification and export all
      exercised on that device against the production API
- [ ] APK attached to a tagged GitHub Release with a checksum
- [ ] Keystore backed up outside the repository
