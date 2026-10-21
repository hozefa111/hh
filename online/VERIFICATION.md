# Kali Ki Tidi implementation and release verification

3 Patti PRO candidate: Android 2.7.0, version code 21, existing application ID
`com.hozefa.threepattipro.nativeapp`. The online game is part of this application.

## Delivered implementation

- Existing Home gains Play Online; existing manual/voice entry, Players, Rankings,
  profiles, sessions and History are retained.
- Complete four/six-seat 250-point gameplay: configured decks, secure deal,
  clockwise auction with rotating 155 opener and permanent PASS, Hukum, distinct
  direct/called partners, follow-suit, tricks and contract evaluation.
- Approved human admission, seats, waiting lists, bots, reconnection pauses,
  server deadlines, legal timeout moves, hand results and admin-last Ready.
- Completed human online hands enter existing Hukum rounds exactly once. Current
  session totals start at zero; lifetime human records remain unified. Bots keep
  session history without becoming ordinary lifetime player profiles.
- Server-only canonical hands and secret teams, own-hand reads, membership-bound
  presence, serialized commands and immutable online ledgers.
- Responsive emerald/gold table, card/turn/trick/result motion, reduced motion and
  bundled Android asset-loader screen with single-use native Auth exchange.

## Actual passing verification

Runtime web/backend commit: `d35320ee6eeda1a847569e58c71ddb23c56b0bf0`.
Native integration and backend fixture commit:
`e1b9b7179b57bd1b5cd01fe875d95de82c64eb17`.
Those are the previously verified baseline commits. The free-backend changes below
are subsequent implementation and have separate evidence.

| Check | Actual result |
| --- | --- |
| Shared/backend unit tests | 47 passed; includes 100 seeded full-hand simulations |
| Firebase security integration | 6 passed |
| Full browser multiplayer/regression | 13 checks passed |
| Network-failure browser checks | 2 passed |
| Legacy names/history browser checks | 2 passed |
| Native-origin browser checks | 2 passed; separate from Android instrumentation |
| Android JVM, Sandbox | 189 passed, zero failures/errors |
| Android JVM, Release | 189 passed, zero failures/errors |
| Android API 30 instrumentation | 43 passed, zero failures/skips |
| Android API 35 instrumentation | 43 passed, zero failures/skips |
| Signed Release/Sandbox/test APK assembly | Passed locally |
| Shared assets and backend engine checksum parity | Passed |
| New production backend dependency audit | Zero known advisories |

Web CI: https://github.com/hozefa111/hh/actions/runs/39482892895

Android CI: https://github.com/hozefa111/Apk/actions/runs/39482724841

Android's 43 methods include 39 existing tracker tests and four online tests.
The latter exercise Home entry, safe bundled loading, invite prefill and actual
native-to-WebView Firebase Auth identity restoration, including Activity recreation.
A discovered offline administrator-restoration regression was corrected and the
full suites were rerun successfully. Cached roles cannot enable offline writes;
pending local role writes are rejected and server authorization remains required.

Browser verification includes separate human clients completing all ten tricks,
a six-seat game with five bots, exact 250-point captures, legal highlights,
private-hand restrictions, admission/seat races, disconnect/reconnect, timeout
idempotency, session isolation and unchanged manual tracker operation. Deadline
dispatch uses an emulator-only tick; this does not certify production Cloud Tasks.

New backend versions are Firebase Admin 14.5.0 and Functions 7.4.0, using Node 22
and Firebase CLI 15.34.0. Java 21 is used for current emulator tooling. Existing
notification backend dependencies were not changed.

## Signed candidate evidence

APK SHA-256:
`2e41d77385e4720961b6cf8168754e729de2a033c68a0127c5a04bce09157127`

Stable signing certificate SHA-256, matching the preserved v2.6.2 baseline:
`dc0697a03526612bc54c3d9ad0b4a10e9ed9b3b6ad22e4e53269f904a72ba9b4`

The keystore stays outside the repositories. A signed candidate exists, but it
has not been published as a final APK release.

## Remaining release gates

**Release readiness: blocked on hosted rollout and physical-device verification.**

1. Firebase CLI authorization succeeded. A read-only production audit/back-up
   captured 421 Firestore documents, 38 Auth identities and deployed rules; RTDB
   is empty and its rules were backed up. Historic player/round/session records remain unchanged. The sole established
   signed-in tracker account received an explicit administrator role before the
   tested restrictive Firestore/RTDB rules were deployed successfully. A dedicated
   backend service account has only project-scoped database/auth access.
   Billing is disabled. The user explicitly requires a free prototype: **do not
   enable Blaze or deploy the Cloud Functions/Tasks adapter**.
2. The replacement API uses Cloudflare Workers Free + SQLite Durable Object
   alarms, existing Firebase Auth, and transactional Firestore REST persistence.
   Cloudflare device authorization and server-secret provisioning succeeded.
   The Worker deployed at `https://three-patti-pro-online.three-patti-free-backend.workers.dev/`,
   and both shared/native clients are configured to that origin. The newly created
   domain currently returns a TLS handshake failure through the execution network;
   hosted gameplay is not yet verified. No new final APK has been certified.
3. Physical-phone gameplay, microphone/voice availability, native sharing,
   update/install behavior, large text and animation/frame performance require
   device QA. Instrumentation evidence covers API 30 and 35 emulators; it does
   not claim universal Android-version or physical-device certification.

No destructive migration was run. The existing main web application and native
release branch were not merged or published. The v2.6.2 APK baseline and original
Git commits remain available for recovery. See `online/README.md` for rollout.

## Review sources

- Web/backend draft: https://github.com/hozefa111/hh/pull/1
- Same-APK draft: https://github.com/hozefa111/Apk/pull/11

Local evidence is retained in `/workspace/output/kali-verification/`, including
hosted web artifacts, native XML reports, screenshots, build logs and signatures.

## Free-backend local verification

- Six adapter tests passed, including repeated four/six-seat hands, unified
  score idempotency, profile ownership and private projections.
- Real Firestore REST emulator integration passed: complete six-seat hand,
  exactly 250 captured points, one unified round and native-compatible timestamps.
- Actual local Cloudflare Worker/Durable Object runtime passed a complete
  six-seat bot hand with a real 30-second human card timeout, late manual-action
  rejection, single-use native exchange, origin restrictions and final scores.
  The final timeout-enabled run took approximately 76 seconds. One earlier run
  timed out and was rerun; it is not counted as a passing result.
- Wrangler deployment dry run passed. This is not a production deployment.
- Free-backend dependency audit: zero known advisories at verification time.

See `backend/free/README.md` for prototype quotas and presence-check latency.
These local checks do not replace hosted or physical-device verification.
