# 3 Patti PRO online gameplay

Kali Ki Tidi is the online card-playing mode of the existing game. It shares
Firebase Auth, human `players`, Hukum `rounds`, `sessions`, scoring and lifetime
statistics. It does not create an independent lifetime leaderboard.

## Free prototype deployment (current requirement)

The user requires **no paid plan**. Firebase Spark remains in place. Use
[`backend/free/README.md`](../backend/free/README.md) for the Workers Free +
SQLite Durable Object API adapter. The Cloud Functions instructions below
describe the earlier optional Blaze adapter and **must not be executed for this
free prototype**. Account authorization, deployed endpoint configuration,
controlled security-rule rollout and hosted verification are still release gates.

## Run and verify

Use Node 22, Java 21, Firebase CLI 15.34.0 and Python 3. Functions v7
requires a current emulator CLI; CLI 14 invokes removed runtime configuration APIs. Install dependencies with `npm ci` and
`npm ci --prefix functions/online`, then `npm run build` and `npm test`.
Install the browser with `npx playwright install chromium`.

Start `python3 -m http.server 8765 --bind 127.0.0.1` in a separate terminal, then:

```
npx firebase-tools@15.34.0 emulators:exec --project demo-three-patti \
  --only auth,firestore,database,functions \
  'npm run test:rules && npm run test:browser'
```

The browser test seeds synthetic emulator accounts and fixtures itself. Never
point it at production. Artifacts default to `test-results/kali`; override with
`KALI_ARTIFACT_DIR`. A running local emulator can also be tested with the two
scripts individually. The game page accepts `?emulator=1` only on localhost or
the Android asset-loader origin. The existing tracker supports the same local
opt-in for regression tests.

`npm run sync:android` bundles the same game assets into the existing Android
project at `../Apk/3PattiProNative`. Override that project root with
`KALI_ANDROID_ROOT`. Generated `online/runtime` JavaScript targets Chrome 67;
`compat.js` supplies modern array/object/UUID helpers for older WebViews.
The source of truth is `online/client.js`, `online/shared/engine.js` and
`online/shared/bot.js`, not the generated copies.

## State, security and data compatibility

- `onlineState/{room}` is server-only canonical state. Clients cannot read its
  deal, hands, real secret partner, receipts or score-finalization state.
- `onlineRooms/{room}` contains an explicit public projection; per-user private
  hand documents and membership records live beneath it. Even the room owner
  cannot read another player's hand. Waiting/invited users only see public state.
- Commands derive identity from verified Firebase tokens and check revision,
  seat, role, phase, deadline and legal moves. Command receipts make retries
  idempotent. A turn generation protects timeout tasks against stale delivery. Hand actions
  also carry the current hand ID and generation: unrelated waiting-list updates
  cannot invalidate an otherwise current move; a changed turn still rejects it.
- Ordinary card plays do not rewrite global session metadata, unchanged private
  hands or unchanged room memberships. This avoids waking legacy tracker listeners
  on every card and keeps waiting-list size out of the per-move write count.
- Completed hands create `rounds/online_{handId}` in the same transaction as
  canonical totals and the completed-hand history. There is no second credit
  when a session stops. Online records are immutable to clients.
- Human `playerIds` drive existing lifetime statistics. Full `participantIds`,
  participant snapshots and score changes retain bots for session results.
  Bots never become ordinary human player documents.
- New rounds use explicit `sessionId`; legacy timestamp membership is retained
  only between legacy/manual records. Mode is fixed for each session; deck suits
  can be changed between hands, resetting Ready while preserving old snapshots.
- Human profile links are owned by Auth UID. Names do not prove identity, and
  an administrator cannot silently claim a profile already linked to another UID.
- Existing tracker administrator privileges require an `admin` token claim or
  server-provisioned `admins/{uid}` record. Guests do not become administrators.
- Tracker backups/rename/clear operations preserve immutable online records.
  Restore never overwrites server-owned online records. Ordinary historic manual
  operations remain available to authorized administrators.
- No private cards enter persistent Firestore cache, service-worker cache,
  localStorage, a share URL or a native Javascript bridge. Native authentication
  uses an expiring single-use exchange, not tokens in URLs. Native administrator
  sign-in returns to the existing Home login controls, preventing a separate
  WebView account from overriding the native identity on the next resume.

## Game behavior

Four or six seats, configurable 40/42-card decks and exactly 250 captured points.
The default bidder opens 155 automatically; raises and play proceed clockwise.
PASS is permanent. The bidder calls any deck card outside their own hand. In
six-player mode the direct and called partner may be the same identity; that
identity is credited once. Secret identity remains hidden until the called card
is played. No early forced called-card play or early contract completion occurs.

Each completed hand uses the original contract-bid score formula. Session totals
start at zero, persist across hands and stay independent of lifetime totals.
The default bidder advances only after a completed hand. Bots automatically Ready;
all other humans Ready first, and the seated admin is the final Ready action.
There is no score target or hand-count limit. Stop can finish or void an unfinished
hand; void never awards scores.

Human bid/play turns have a server-owned 30-second deadline. Bidding timeout is
PASS. Card timeout uses the shared legal list and a deterministic public-information
policy: retain a known teammate's winning trick, feed points on the last play,
prefer affordable valuable wins and use low-point/low-strength discards otherwise.
Leading decisions use previously played cards to identify remaining master cards
and publicly demonstrated suit voids. Bots use only their own cards and the public
projection, with Easy and Normal policies. Automatic history records distinguish
bot actions from human timeout actions.

RTDB connection records are restricted to the authenticated participant and a
server-maintained `onlineAcl` membership. Clients obtain presence access through
the authenticated API after joining; the membership trigger revokes removed
participants. Clients cannot grant their own access or write another UID. The
server rechecks live connection records before a human timeout.

RTDB connection records pause a genuine disconnected hand. Remaining time and
cards are preserved; admin resumes after reconnection. Backgrounding an otherwise
connected device is ordinary inactivity, so server deadlines still apply.

## Optional Cloud Functions deployment (requires Blaze; not the free prototype)

Existing historic player, round and session records were preserved. The free
prototype rollout added an explicit role for the established administrator and
deployed the tested restrictive Firestore/RTDB rules after private backups.
See `VERIFICATION.md` for the current deployment state.

1. Obtain an authorized Firebase deployment identity for `patti-pro-a61d8`.
   Provision each existing administrator's Auth UID in `admins/{uid}` through a
   trusted operator/Admin SDK **before** tightening rules or shipping the new role
   checks. Do not use a published password example as credentials.
2. Audit the existing authentication configuration before changing it. The
   production audit found Anonymous Auth already enabled and the default RTDB
   already present in **us-central1**. Do not recreate either or enable guests
   blindly while permissive legacy rules remain. Preserve existing identities.
3. Confirm Functions billing and required APIs. Grant the runtime service identity
   the required Firestore/Auth/RTDB access, task-enqueue/invoke permissions and
   IAM service-account signing permission for custom-token exchange. Verify the
   single-use exchange on a real installed APK.
4. Audit currently deployed rules and back up existing data. The checked-in rules
   are the tested replacement; do not append them underneath a permissive global
   allow rule. Inventory any collections used by older deployed clients first.
5. Deploy the new functions codebase with
   `firebase deploy --project patti-pro-a61d8 --only functions:kali-online`, then
   the tested Firestore and RTDB rules. Existing notification functions are a
   separate codebase and must not be deleted or redeployed accidentally.
6. After restrictive rules are verified, enable Anonymous Auth in this same
   project. Verify real Cloud Tasks deadlines, multi-device reconnection and the configured
   allowed origins. Emulator tests use an emulator-only tick endpoint because
   the emulator does not provide a clock-driven production task dispatcher.
7. Ship updated web/native clients before enabling live rooms for users. Older
   clients infer one global active session and do not understand online sources.
   Review the preview, then merge/publish; main's existing Pages workflow publishes
   automatically. The feature branch is not a production deployment.
8. Run native instrumentation on responsive Android devices/emulators, verify the
   stable signing certificate and perform actual-device motion/performance checks.
   An assembled or signed APK alone is not a release-readiness certificate.

Rollback must finish/pause active rooms first. Keep completed ledgers and history;
do not delete online collections or restore an old permissive ruleset. The v2.6.2
APK baseline is preserved outside source control for recovery/review.

## Android integration

The original package remains `com.hozefa.threepattipro.nativeapp`. `OnlineGameActivity`
loads bundled assets through AndroidX WebViewAssetLoader with file/content access
and arbitrary top-level navigation disabled. The existing Home and loading fallback
both offer Play Online. Native manual/voice entry and the rest of the tracker remain
native. Room invitations register an Android intent handler; public-domain automatic
App Link verification is not configured and manual room codes remain available.

Build with the existing Gradle project and stable `THREE_PATTI_*` signing setup.
`OnlineGameTest` covers the Home entry, safe embedded table load and invite prefill;
other existing native suites still cover the tracker. Device tests require a real,
responsive Android runtime. Never report them as passed from compilation alone.

The Android sync also generates an emulator-only backend fixture and asset SHA-256
manifest. Gradle verifies the bundled files and shared backend engine before
building. Android CI runs the existing native suite plus online smoke tests on
API 30/35, including a real native-to-WebView Auth round trip against emulators.
These are configured checks; consult actual CI results rather than assuming they
ran. An updated Android System WebView is required for the online module.
