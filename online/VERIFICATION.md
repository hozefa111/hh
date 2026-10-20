# Kali Ki Tidi integration verification

Release candidate: 3 Patti PRO 2.7.0 (Android code 21).
Branches: `kali-tidi-multiplayer` in `hozefa111/hh` and `hozefa111/Apk`.

## Implemented integration

- Existing Home gains Play Online; manual/voice tracker screens remain available.
- Shared deck, auction, trick, partner, bot and original Hukum scoring engine.
- Server-authoritative rooms, approvals, seats, waiting lists, reconnect, deadlines,
  timeout plays, session lifecycle and admin-last Ready.
- Human online hands enter existing `rounds` exactly once; bot records stay in
  session history without becoming human lifetime player records.
- Responsive felt-table UI, card/legal-move motion, public partner reveal, results,
  session scorecards, reduced motion and native Android asset-loader integration.
- Own-hand-only reads, server-owned secret deals, membership-bound presence and
  immutable online ledgers. Existing manual administrator operations retained.

## Verification evidence

The local test logs and screenshots are retained in
`/workspace/output/kali-verification/`. Latest local results:

- Shared/backend rules: 47 tests passed.
- Firebase rules: 6 emulator integration tests passed.
- Browser multiplayer: final 13-check run passed, including full four-human and
  six-seat bot hands, original tracker regression, presence restrictions and races.
- Network failure handling: 2 browser checks passed.
- Legacy bot/historic labels: 2 browser checks passed.
- Native-origin browser behavior: 2 checks passed (not Android instrumentation).
- Android JVM: 189 tests per Sandbox and Release variant, zero failures/errors.
- Signed Android release, Sandbox and instrumentation APK assembly: passed.
- Bundled shared asset checksums and backend engine parity: passed during build.
- Stable certificate SHA-256:
  `dc0697a03526612bc54c3d9ad0b4a10e9ed9b3b6ad22e4e53269f904a72ba9b4`.

Emulator tests use synthetic accounts and records only.

Production Firebase has not been modified. Web main and the existing native
release branch have not been merged or deployed.

Signed candidate APK SHA-256 (verification artifact, not a released APK):
`47270ee1b241229839a7f61ed60e0770b53439766a5fb237ba2837dfb0d00f7b`.

Android draft PR: https://github.com/hozefa111/Apk/pull/11

## Release gates

**Not approved for final APK release.** A successful local build does not satisfy
these remaining gates:

1. Authorized Firebase deployment identity is unavailable in this environment.
   Provision existing administrator UIDs, audit/backup deployed data, deploy tested
   rules and the new functions codebase, then enable guest Auth safely. See README.
2. Real hosted Cloud Tasks/IAM, presence, account exchange and concurrent-device
   behavior require staging verification. Local tests use an emulator-only task
   tick, not the production dispatcher.
3. Local Android device instrumentation could not execute: the machine has no KVM
   and the software emulator became unresponsive. No new instrumentation methods
   are reported as passed. API 30/35 CI and actual-phone verification remain required.
4. Real-phone animation smoothness, native sharing/voice preservation, app updates
   and lifecycle behavior require device checks. Browser screenshots do not prove
   Android device performance.

The existing stable signing configuration is kept outside the repositories.
No signing secrets or production data are included in the implementation.
