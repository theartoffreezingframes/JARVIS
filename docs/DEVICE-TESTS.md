# JARVIS — real device test checklist

> **Status: NOT YET EXECUTED.**
> Nothing in this file has been run on a physical device or an emulator. It is the
> script a human tester must follow on real hardware before JARVIS is handed to
> real users.
>
> The machine that produced the production-readiness work has **no Android SDK, no
> Java/JDK, no Gradle, no `adb`, no Android device and no emulator**, and the
> sandbox has **no outbound internet access**. Automated coverage (60 API tests,
> 12 mobile unit tests, the 9 acceptance workflows in-process) is real and passing,
> but it is *not* a substitute for the checks below. Do not mark an item as passed
> until it has been performed on a device.

## How to use this file

- Copy the tables into your issue tracker, or tick the boxes in place.
- Record the build you tested: APK version + `versionCode` + the commit SHA it was
  built from, plus the device model, Android version and whether Google Play
  services are present.
- Every item has a **How to verify** line. If the observed behaviour differs, file
  a bug with the device, build and steps — do not "work around" it.
- Items marked **N/A (not implemented)** must stay unchecked: the feature does not
  exist in this build, so it cannot pass.

Build under test: `____________` (APK) · `versionCode ____` · commit `________`
Devices: `__________________________________________________________`
Testers / dates: `_________________________________________________`

---

## 1. Authentication

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 1.1 | Email/password signup | Register a brand-new address from the app. You land in an empty workspace (no demo content, no other account's data). | ☐ |
| 1.2 | Login | Sign out, sign back in with the same credentials. Your data is still there. | ☐ |
| 1.3 | Logout | After logout the app returns to sign-in and the previous screens are not reachable with the back gesture. | ☐ |
| 1.4 | Wrong password | Login with a bad password shows a clear error and does not create a session. | ☐ |
| 1.5 | Session restoration | Kill the app, reopen it: you are still signed in without retyping a password. | ☐ |
| 1.6 | Expired access token | Leave the app open > 2 h (or change the device clock forward), then pull a screen: the app refreshes silently instead of dumping you to sign-in. | ☐ |
| 1.7 | Forgot password (request) | Request a reset for your address. The response is identical for an address that exists and one that does not (no account enumeration). | ☐ |
| 1.8 | Forgot password (delivery) | **Requires `JARVIS_EMAIL_*` on the server** (see `docs/DEPLOYMENT.md`). If no provider is configured the app says so and shows the token for local testing. | ☐ |
| 1.9 | Password reset | Open the emailed link on the phone, choose a new password, sign in with it. The old password no longer works. | ☐ |
| 1.10 | Reset token is single use | Re-open the same link: it is refused, with a clear message. | ☐ |
| 1.11 | Sign out all devices | On phone A change the password (Settings → Password) or sign out all sessions: phone B's next request is rejected and it returns to sign-in. | ☐ |
| 1.12 | Google sign-in | **N/A (not implemented).** There is no Google/OAuth client id in this build and no server-side OAuth flow. Do not test as if it existed. | N/A |

## 2. Tasks

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 2.1 | Create | New task from the Tasks tab and via quick capture; it appears immediately. | ☐ |
| 2.2 | Edit | Change title, due date, priority, project, estimate, tags; every change sticks. | ☐ |
| 2.3 | Complete | Ticking a task marks it done and it leaves the open list; the completion shows in analytics. | ☐ |
| 2.4 | Delete | Deleting removes it from the list and from search; the deletion syncs to a second device. | ☐ |
| 2.5 | Restart persistence | Force-stop the app, reopen: all of the above are still correct. | ☐ |
| 2.6 | Airplane-mode create | Create a task with no network: it is visible, marked as pending, and appears on the server after reconnecting exactly once (no duplicate). | ☐ |

## 3. Eisenhower matrix

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 3.1 | Correct initial quadrant | Create an urgent + important task: it lands in Do first. Create an unimportant, not-urgent task: it lands in Eliminate. | ☐ |
| 3.2 | Auto-move on priority change | Edit importance/urgency (or drag) and confirm the task moves to the matching quadrant without a reload. | ☐ |
| 3.3 | Cross-device agreement | Move a task on phone A; phone B shows it in the same quadrant after sync. | ☐ |
| 3.4 | Overload hint | A quadrant holding many tasks shows the overload suggestion (never "more work is better" framing). | ☐ |

## 4. Pomodoro / focus timer

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 4.1 | Start | Start a focus session; the countdown runs and the task is attached. | ☐ |
| 4.2 | Background | Home-button the app for 10 minutes, return: remaining time is correct (derived from a stored timestamp, not a paused JS timer). | ☐ |
| 4.3 | Device lock | Lock the phone during a session; unlock after the phase should have ended: the app shows the phase as finished. | ☐ |
| 4.4 | Pause / resume | Pause freezes the remaining time; resume continues from the same point. | ☐ |
| 4.5 | Stop | Stopping early keeps the seconds actually spent. | ☐ |
| 4.6 | Complete | Let a phase finish: you get haptics/sound per settings and auto-start follows your preferences. | ☐ |
| 4.7 | Analytics | The session appears in analytics/heat map with the real minutes. | ☐ |
| 4.8 | Notification | With notifications allowed, a scheduled "focus complete" notification fires even if the app is backgrounded. | ☐ |
| 4.9 | Clock change | Change the device clock forward/back mid-session: the timer stays sane (never negative, never past 100 %). | ☐ |

## 5. Gang Timer — two real devices, two real accounts

Use two phones signed into **different** accounts that share a group.

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 5.1 | Create | Device A (host) starts a gang session for the group with focus/break/rounds. | ☐ |
| 5.2 | Invite/join | Device B sees the invitation and joins. A sees B as a participant. | ☐ |
| 5.3 | Start | A starts the session; B's countdown begins in sync (within ~1 s, derived from the server anchor). | ☐ |
| 5.4 | Pause | A pauses; B shows paused with the same remaining time. | ☐ |
| 5.5 | Resume | A resumes; both continue in sync. | ☐ |
| 5.6 | Skip/round change | A skips to the next phase: B's phase and round number match A's. | ☐ |
| 5.7 | End | A ends the session; both devices show the final state and stop counting. | ☐ |
| 5.8 | Statistics | Both accounts get their own focus record for the session (check Analytics/heat map on each phone). | ☐ |
| 5.9 | Non-host permissions | B (participant) has no start/pause/skip/end controls; the server rejects a crafted request from B (403). | ☐ |
| 5.10 | Network loss | Turn off Wi-Fi **and** mobile data on B mid-session for ~2 minutes, then restore it: B reconnects and shows the correct phase/remaining time (no drift, no client-only timer). | ☐ |
| 5.11 | Host disconnect | Disconnect A entirely for a minute: the authoritative clock keeps advancing; on reconnect A and B agree. | ☐ |
| 5.12 | Backgrounding | Background both apps; on return the countdown is still aligned. | ☐ |
| 5.13 | Reaction | Send a reaction emoji from B: A sees it (no chat messages are involved). | ☐ |

## 6. Offline mode and sync

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 6.1 | Offline banner | Disabling the network shows the offline state with a queued-change count. | ☐ |
| 6.2 | Offline edits | Create, edit, complete and delete tasks/notes/habits while offline. | ☐ |
| 6.3 | Reconnect | Restore the network: queued changes upload without duplicates (check on a second device or after reload). | ☐ |
| 6.4 | No lost change | A change made offline while the same task was edited elsewhere: the server reports the conflict and nothing is silently overwritten. | ☐ |
| 6.5 | Retry safety | Kill the app while a change is queued, reopen with network: the change still lands (at most once). | ☐ |
| 6.6 | Server restart | Restart the API while the app is open: the app recovers (realtime reconnects, requests retry) without user action. | ☐ |
| 6.7 | API outage | Point the app at an unreachable API (or stop the server): every screen shows a failure state with a Retry action rather than a blank page or a fake success. | ☐ |

## 7. Notifications

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 7.1 | Local reminder | Schedule a task reminder 3 minutes out, force-stop the app: the notification still fires. | ☐ |
| 7.2 | Per-category toggle | Turn a category off in Settings → Notifications: that notification no longer appears; others still do. | ☐ |
| 7.3 | Quiet hours | Set quiet hours around the current time: non-critical notifications are suppressed. | ☐ |
| 7.4 | Permission denied | Deny notification permission in system settings: the app explains it instead of silently dropping reminders. | ☐ |
| 7.5 | Remote push | **Requires external credentials** (EAS project id + FCM credentials, see `docs/RELEASE.md`). With a token registered, Settings → Notifications → "Send test notification" must report real delivery, and a gang invitation must arrive with the app closed. Until those credentials exist the app reports `not-configured` and must not claim success. | ☐ |
| 7.6 | Token moves with account | Sign out and sign in as another user on the same device: the first account stops receiving pushes for that device. | ☐ |

## 8. Account and data

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 8.1 | Export | Settings → Data → export produces a complete JSON export (profile, settings, tasks, notes, habits, focus, groups) that opens and matches what is in the app. | ☐ |
| 8.2 | Change password | Changing the password keeps the current device signed in and signs other devices out. | ☐ |
| 8.3 | Profile changes | Name/username/timezone changes survive a restart and are visible to friends/groups. | ☐ |
| 8.4 | Delete account | With the correct password the account is deleted; the device returns to sign-in. | ☐ |
| 8.5 | Deleted account cannot authenticate | The old credentials are refused, and the email can be used to register again as a fresh account. | ☐ |
| 8.6 | No residue | On a second device the deleted account's data is gone; groups it owned survive with a new owner. | ☐ |

## 9. Cross-cutting

| # | Check | How to verify | Result |
|---|-------|---------------|--------|
| 9.1 | Theme/dark mode | Light, dark and system themes are readable; accent, density, radius, font scale and animation level all take effect. | ☐ |
| 9.2 | Dynamic text | Raise the system font size to maximum: no clipped or overlapping text on the main screens. | ☐ |
| 9.3 | Screen reader | TalkBack announces every interactive control; the Gang Timer and timer controls have labels, not bare icons. | ☐ |
| 9.4 | Reduced motion | With animations off, no transition harms comprehension. | ☐ |
| 9.5 | Large targets | All primary actions are comfortably tappable one-handed. | ☐ |
| 9.6 | Rotation / small screens | No layout breakage on a small (≤5") screen. | ☐ |
| 9.7 | Battery/data sanity | A 25-minute focus session and a gang session do not drain the battery abnormally or use background data continuously. | ☐ |

---

## What is already covered automatically (no device needed)

Run from the repository root: `npm run typecheck && npm test && npm run build:web`.

| Suite | What it proves | Count |
|-------|----------------|-------|
| `apps/api/tests/api.test.ts` | Endpoints, validation, auth, isolation, sync contract | 18 |
| `apps/api/tests/domain.test.ts` | Shared domain rules (recurrence, scoring, heat maps, NLP) | 14 |
| `apps/api/tests/rate-limit.test.ts` | Per-route throttling behaviour | 1 |
| `apps/api/tests/acceptance.test.ts` | The 9 end-to-end workflows, in-process | 9 |
| `apps/api/tests/production.test.ts` | Production boot, CORS allow-list, reset delivery, push lifecycle, deletion, restart survival, request ceiling | 11 |
| `apps/api/tests/security.test.ts` | Per-device sign-out, rotation/replay, password change, cross-account isolation, group ownership | 5 |
| `apps/api/tests/logging.test.ts` | No credential ever reaches the logs | 2 |
| `apps/mobile/tests/api-url.test.ts` | Release builds never fall back to a dev address | 5 |
| `apps/mobile/tests/timer-math.test.ts` | Timer maths under backgrounding, pause and clock jumps | 7 |

These suites are green on the current commit. They exercise the same code paths the
device tests above exercise through the UI, but they cannot prove rendering,
permissions, radio behaviour (Wi-Fi ↔ mobile data), notification delivery to the
system tray, or anything requiring two physical devices.
