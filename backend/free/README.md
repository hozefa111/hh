# Free prototype backend — same 3 Patti PRO application

Firebase stays on **Spark**. Do not enable Blaze or deploy the Cloud Functions codebase for this variant. This Worker is an API adapter for the existing game, not another application, authentication environment or scoreboard.

## Architecture

- Cloudflare **Workers Free**, with a SQLite Durable Object coordinator and durable alarms. No paid resources are provisioned by this configuration.
- Existing Firebase Auth identifies players. ID tokens are signature/audience/issuer checked, followed by account disable/revocation verification. Existing explicit administrator roles remain required.
- The unchanged game service and shared rules engine validate commands, bots, legal moves, timeouts, scoring and lifecycle.
- Firestore Spark remains the canonical database. Real REST read/write transactions persist public room projections, each human's private hand, per-user command receipts, profile links, session metadata and deterministic `rounds/online_<handId>` records atomically.
- Human lifetime rankings continue reading the existing round ledger; bots remain session-only participants. No second scoreboard is created.
- The Durable Object stores a recovery copy and schedules the next bot/human deadline. On restart, pending rooms are reconciled from canonical Firestore before play continues.
- Existing RTDB connections remain the presence signal. The Worker checks all tracked rooms with one RTDB read, every five seconds during unpaused play and every 30 seconds between hands/while paused. A real disconnect pauses the hand and preserves remaining time; reconnect is detected on the next presence check, then the admin resumes. This prototype therefore has bounded disconnect detection latency, rather than a deployed Firebase presence trigger.
- A fresh presence check precedes automatic moves. If presence cannot be read, the alarm fails closed and retries; it does not invent a move.
- Private hands and secret teams never enter Worker responses, RTDB presence, logs or persistent client storage. Firestore rules still protect own-hand projections even against room admins.

## Free-tier limits

Use a Cloudflare Free account; do not attach this prototype to Workers Paid. Free quotas are hard service limits, **not a promise of unlimited hosting**. Exceeding Cloudflare, Firestore or RTDB free quotas can interrupt the prototype; upgrading is not automatic here. Public prototype abuse can exhaust daily quotas. Keep the admission/admin workflow enabled.

One serialized coordinator is deliberate for a small prototype. It is not a large-scale deployment design. Firebase Spark daily Firestore writes and RTDB monthly bandwidth remain limits. Sessions do not expire or stop at a score target; finished/voided records are retained.

Official limits: [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Firestore free quota](https://firebase.google.com/docs/firestore/quotas).

## Credentials and deployment

1. Create/verify a **free** Cloudflare account. Authorize Wrangler with its browser OAuth flow. Do not paste passwords or long-lived API tokens into chat.
2. Use a dedicated service account in the existing Firebase project. Its server-only credential needs Firestore transactional access, Firebase Authentication account lookup, and RTDB administrative access; scope permissions to this project. Never bundle a service-account file or private key in the web assets/APK/repository. Do not use a human refresh token as a production backend credential.
3. Store that JSON through `wrangler secret put FIREBASE_SERVICE_ACCOUNT`. `FIREBASE_PROJECT_ID` is public configuration. Local `.dev.vars*`, `.wrangler/` and generated bundles are gitignored.
4. Before changing production rules, confirm the data/rule backup, existing administrator UID mapping and emulator regression/privacy checks. Tighten the legacy permissive rules in a controlled rollout; preserve all historic records. RTDB and Firestore rules must be deployed compatibly with the tracker.
5. Run `npm ci && npm run verify` in this directory. Start only **demo-project** Firebase emulators, then run `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 KALI_WORKER_INTEGRATION=1 npm test`.
6. `wrangler deploy` publishes the API and SQLite Durable Object migrations. Record the actual returned HTTPS origin. No assumed or invented deployment URL is valid.
7. Configure that exact API base in both shared browser assets and native authentication handoff; rebuild/sync the assets. Verify real phones/browser participants, secret-card isolation, human deadlines, bots, reconnection and unified round persistence on the deployed backend before a signed release.

The existing `functions/online` deployment is retained as an optional future Blaze adapter; it must not be deployed as part of this free prototype.

## Verified deployment status

The API is deployed at `https://three-patti-pro-online.three-patti-free-backend.workers.dev/`. Firebase stays on Spark; Cloud Functions/Tasks were not deployed. The service-account credential is a Worker secret, never a bundled client file. Restrictive Firestore/RTDB rules were deployed after backups, and the established tracker administrator retains access.

Actual hosted verification completed two four-seat hands and one six-seat hand with separate human identities and bots, exact 250-point captures, real 30-second legal timeout, private-hand denial even for admin, admin-last Ready, session persistence, disconnect/reconnect and void-without-score checks. The native-origin browser completed the real one-use exchange and restored the exact UID without ignoring HTTPS errors.

All verification-only game data and three synthetic Auth identities were removed. The original six players, 324 rounds and 19 sessions remain unchanged; all 372 original top-level document fields were compared against the private backup.

The existing web Home/online invitation URLs are published and point to this backend. Native app code `0dd8017` passed 192 Release JVM tests and 43 instrumentation tests each on API 30/35. The same-package stable-signed APK bundles the actual deployed endpoint. Physical-phone frame performance, real microphone availability and every Android vendor build are not certified by these tests.
