# 3 Patti PRO 2.7.0 — free online prototype verification

Kali Ki Tidi is part of the existing application, package
`com.hozefa.threepattipro.nativeapp`, version code 21. Manual/voice round entry,
existing players, profiles, rankings, sessions and history remain available.

## Deployment

- Existing web Home: https://hozefa111.github.io/hh/
- Online/share entry: https://hozefa111.github.io/hh/online/index.html
- Authoritative API: https://three-patti-pro-online.three-patti-free-backend.workers.dev/
- Firebase remains Spark, billing disabled. No paid Functions/Tasks deployment.
- Cloudflare Workers Free with SQLite Durable Object alarms reuses Firebase Auth
  and transactional Firestore persistence; private credentials stay server-side.
- Native/shared assets and native Auth handoff use the same deployed API origin.

## Actual verification

| Check | Actual result |
| --- | --- |
| Shared rules/service tests | 48 passed locally, including malformed seat-target regression |
| Firebase privacy/rules integration | 6 passed |
| Browser multiplayer/regression | 13 passed |
| Network, legacy names and native-origin browser | 2 + 2 + 2 passed |
| Free adapter tests | 6 passed, repeated four/six-seat hands |
| Real Firestore REST emulator | 1 passed, full hand with unified records/timestamps |
| Actual local Worker/Durable Object runtime | 1 passed; full bot hand, real 30-second timeout, late-action denial |
| Native Release JVM | 192 passed |
| Android API 30 instrumentation | 43 passed, zero failures/errors/skips |
| Android API 35 instrumentation | 43 passed, zero failures/errors/skips |
| Stable signed Release assembly | Passed |
| Backend dependency audit | Zero known advisories |

Verified native application source: `0dd80174878a5dfcad05b583fed155a0b3ee3885`.
A later emulator-fixture-only update mirrors the additional server seat-target
validation; it does not change APK application code or bundled assets.

Web CI (47-test baseline plus all adapter/browser checks):
https://github.com/hozefa111/hh/actions/runs/39517818857

Native CI:
https://github.com/hozefa111/Apk/actions/runs/39517839257

The final malformed-target server check adds the 48th unit test and is verified
separately before deployment. The earlier local Worker test timeout was not
counted as a pass; the complete timeout-enabled rerun passed in about 76 seconds.

## Real hosted multiplayer

Separate human identities completed two four-seat hands and one six-seat hand
with bots. Each hand captured exactly 250 card points and produced one equivalent
Hukum record in the existing rounds collection. Default bidders advanced 1→2→3
across the four-seat hands; admin-last Ready preserved session totals.

Hosted checks verified non-admin creation denial, admission/seats, private-hand
denial even for admin, canonical state privacy, unrelated-user room denial,
a real human timeout, preserved session history, disconnect/pause/reconnect with
identical cards, resumed timing and void without score/cursor advancement.
The native-origin browser restored the same UID through the deployed one-use
custom-token exchange, with no page errors and no ignored HTTPS errors.

## Existing data and security

Private backups captured 421 Firestore documents (372 top-level plus 49 nested),
38 original Auth identities and deployed rules. All 372 original top-level
document fields were compared after verification and remain unchanged. Current
counts are the original six players, 324 rounds and 19 sessions. Verification-only
rooms, profiles, score records and three synthetic Auth users were removed.

The sole established signed-in tracker account retains an explicit administrator
role. Guest identity does not grant administration. Restrictive Firestore/RTDB
rules replace the permissive legacy access; private hands and canonical deals
are not publicly readable. No destructive migration or historical rewrite ran.

## APK evidence

APK SHA-256:
`cd928b035ea52079d541e508eb29e4490cf35e0fe17bc54291d552d96fc1cd55`

Stable signing certificate SHA-256, matching the v2.6.2 baseline:
`dc0697a03526612bc54c3d9ad0b4a10e9ed9b3b6ad22e4e53269f904a72ba9b4`

The keystore and service-account keys remain outside both repositories. The APK
contains the deployed free endpoint and no private credential files.

## Practical limits

This is a free prototype, not unlimited hosting. Cloudflare/Firebase free quotas
can interrupt service when exhausted; no paid upgrade was enabled. Presence is
checked within five seconds during unpaused play and 30 seconds between hands
or while paused; true disconnects preserve state and require admin resume.
Physical-phone frame performance, real microphone availability and every vendor
Android variant have not been tested here. API 30/35 evidence is from emulators.

Source changes are in web PR #1 plus the final input-validation follow-up, and
native PR #11. Local sanitized evidence is in `/workspace/output/kali-verification/`.
